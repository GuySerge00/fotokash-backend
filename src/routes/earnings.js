const express = require('express');
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const router = express.Router();

function fcfa(n) {
  return new Intl.NumberFormat('fr-FR').format(Math.round(n)) + ' F';
}

function periodLabel(period, startDate, endDate) {
  if (period === 'today') return "Aujourd'hui";
  if (period === '7d') return '7 derniers jours';
  if (period === '30d') return '30 derniers jours';
  if (period === 'custom' && startDate && endDate) return startDate + ' au ' + endDate;
  return '30 derniers jours';
}

function buildPeriodFilter(period, startDate, endDate, paramOffset) {
  var clause = '';
  var params = [];
  if (period === 'today') {
    clause = 'AND DATE(t.created_at) = CURRENT_DATE';
  } else if (period === '7d') {
    clause = "AND t.created_at >= NOW() - INTERVAL '7 days'";
  } else if (period === '30d') {
    clause = "AND t.created_at >= NOW() - INTERVAL '30 days'";
  } else if (period === 'custom' && startDate && endDate) {
    clause = 'AND t.created_at >= $' + paramOffset + " AND t.created_at < ($" + (paramOffset + 1) + "::date + INTERVAL '1 day')";
    params = [startDate, endDate];
  } else {
    clause = "AND t.created_at >= NOW() - INTERVAL '30 days'";
  }
  return { clause: clause, params: params };
}

async function getExportData(userId, period, startDate, endDate) {
  var filter = buildPeriodFilter(period, startDate, endDate, 2);

  var photographerRes = await pool.query('SELECT studio_name, phone, plan FROM photographers WHERE id = $1', [userId]);
  var photographer = photographerRes.rows[0] || {};

  var planRes = await pool.query('SELECT commission_rate FROM subscription_plans WHERE id = $1', [photographer.plan || 'free']);
  var commissionRate = planRes.rows[0] ? parseFloat(planRes.rows[0].commission_rate) : 0;

  var revRes = await pool.query(
    `SELECT COALESCE(SUM(t.amount),0) as total_revenue, COUNT(*) as total_sales
     FROM transactions t WHERE t.photographer_id = $1 AND t.status = 'completed' ${filter.clause}`,
    [userId, ...filter.params]
  );
  var totalRevenue = parseFloat(revRes.rows[0].total_revenue);
  var totalSales = parseInt(revRes.rows[0].total_sales);
  var commissionAmount = Math.round(totalRevenue * commissionRate / 100);
  var netRevenue = totalRevenue - commissionAmount;

  var byEvent = await pool.query(
    `SELECT e.name, COUNT(t.id) as sales, COALESCE(SUM(t.amount),0) as revenue
     FROM transactions t JOIN events e ON e.id = t.event_id
     WHERE t.photographer_id = $1 AND t.status = 'completed' ${filter.clause}
     GROUP BY e.id, e.name ORDER BY revenue DESC`,
    [userId, ...filter.params]
  );

  var txRes = await pool.query(
    `SELECT t.id, t.created_at, t.amount, t.payment_method, t.status, e.name as event_name, t.photos_purchased
     FROM transactions t LEFT JOIN events e ON e.id = t.event_id
     WHERE t.photographer_id = $1 ${filter.clause}
     ORDER BY t.created_at DESC`,
    [userId, ...filter.params]
  );

  return {
    photographer: photographer,
    periodLabel: periodLabel(period, startDate, endDate),
    totalRevenue: totalRevenue,
    totalSales: totalSales,
    commissionRate: commissionRate,
    commissionAmount: commissionAmount,
    netRevenue: netRevenue,
    byEvent: byEvent.rows,
    transactions: txRes.rows
  };
}

// GET /api/earnings — Solde du photographe
router.get('/', authMiddleware, async (req, res) => {
  try {
    var userId = req.user.id;
    var plan = req.user.plan || 'free';

    // Taux de commission du plan
    var planRes = await pool.query('SELECT commission_rate FROM subscription_plans WHERE id = $1', [plan]);
    var commissionRate = planRes.rows[0] ? parseFloat(planRes.rows[0].commission_rate) : 0;

    // Revenus bruts (transactions completed)
    var revRes = await pool.query(
      "SELECT COALESCE(SUM(amount), 0) as total_revenue, COUNT(*) as total_sales FROM transactions WHERE photographer_id = $1 AND status = 'completed'",
      [userId]
    );
    var totalRevenue = parseFloat(revRes.rows[0].total_revenue);
    var totalSales = parseInt(revRes.rows[0].total_sales);

    // Commission FotoKash
    var totalCommission = Math.round(totalRevenue * commissionRate / 100);

    // Retraits approuvés
    var withRes = await pool.query(
      "SELECT COALESCE(SUM(amount), 0) as total_withdrawn FROM withdrawals WHERE photographer_id = $1 AND status = 'approved'",
      [userId]
    );
    var totalWithdrawn = parseFloat(withRes.rows[0].total_withdrawn);

    // Solde disponible
    var availableBalance = totalRevenue - totalCommission - totalWithdrawn;

    // Minimum retrait
    var minRes = await pool.query("SELECT value FROM app_settings WHERE key = 'min_withdrawal_amount'");
    var minWithdrawal = minRes.rows[0] ? parseInt(minRes.rows[0].value) : 1000;

    // Retraits en attente
    var pendingRes = await pool.query(
      "SELECT COALESCE(SUM(amount), 0) as pending FROM withdrawals WHERE photographer_id = $1 AND status = 'pending'",
      [userId]
    );
    var pendingWithdrawal = parseFloat(pendingRes.rows[0].pending);

    res.json({
      total_revenue: totalRevenue,
      commission_rate: commissionRate,
      total_commission: totalCommission,
      total_withdrawn: totalWithdrawn,
      pending_withdrawal: pendingWithdrawal,
      available_balance: availableBalance - pendingWithdrawal,
      min_withdrawal: minWithdrawal,
      total_sales: totalSales,
      plan: plan
    });
  } catch (err) {
    console.error('Erreur earnings:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// GET /api/earnings/history — Historique des ventes (avec filtre de periode)
router.get('/history', authMiddleware, async (req, res) => {
  try {
    var userId = req.user.id;
    var limit = parseInt(req.query.limit) || 20;
    var offset = parseInt(req.query.offset) || 0;
    var period = req.query.period || '30d';
    var startDate = req.query.startDate;
    var endDate = req.query.endDate;

    // Construction securisee du filtre de periode : uniquement des parametres lies, jamais de concatenation SQL
    var periodClause = '';
    var periodParams = [];
    var paramOffset = 2; // $1 = userId deja utilise

    if (period === 'today') {
      periodClause = 'AND DATE(t.created_at) = CURRENT_DATE';
    } else if (period === '7d') {
      periodClause = "AND t.created_at >= NOW() - INTERVAL '7 days'";
    } else if (period === '30d') {
      periodClause = "AND t.created_at >= NOW() - INTERVAL '30 days'";
    } else if (period === 'custom' && startDate && endDate) {
      periodClause = `AND t.created_at >= $${paramOffset} AND t.created_at < ($${paramOffset + 1}::date + INTERVAL '1 day')`;
      periodParams = [startDate, endDate];
    } else {
      periodClause = "AND t.created_at >= NOW() - INTERVAL '30 days'";
    }

    var plan = req.user.plan || 'free';
    var planRes = await pool.query('SELECT commission_rate FROM subscription_plans WHERE id = $1', [plan]);
    var commissionRate = planRes.rows[0] ? parseFloat(planRes.rows[0].commission_rate) : 0;

    var limitParamIdx = paramOffset + periodParams.length;
    var offsetParamIdx = limitParamIdx + 1;

    var result = await pool.query(
      `SELECT t.id, t.reference, t.amount, t.payment_method, t.status, t.created_at,
              e.name as event_name, e.slug as event_slug,
              array_length(t.photos_purchased, 1) as photos_count,
              t.photos_purchased as photo_ids
       FROM transactions t
       LEFT JOIN events e ON e.id = t.event_id
       WHERE t.photographer_id = $1 ${periodClause}
       ORDER BY t.created_at DESC
       LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}`,
      [userId, ...periodParams, limit, offset]
    );

    var countRes = await pool.query(
      `SELECT COUNT(*) as total FROM transactions t WHERE t.photographer_id = $1 ${periodClause}`,
      [userId, ...periodParams]
    );

    // Revenus par evenement (filtre sur la meme periode)
    var byEvent = await pool.query(
      `SELECT e.name, e.slug, COUNT(t.id) as sales, COALESCE(SUM(t.amount), 0) as revenue
       FROM transactions t
       JOIN events e ON e.id = t.event_id
       WHERE t.photographer_id = $1 AND t.status = 'completed' ${periodClause}
       GROUP BY e.id, e.name, e.slug
       ORDER BY revenue DESC
       LIMIT 10`,
      [userId, ...periodParams]
    );

    // Revenus par mois (6 derniers mois, non filtre par periode : vue d'ensemble long terme)
    var byMonth = await pool.query(
      `SELECT TO_CHAR(created_at, 'YYYY-MM') as month, COALESCE(SUM(amount), 0) as revenue, COUNT(*) as sales
       FROM transactions
       WHERE photographer_id = $1 AND status = 'completed' AND created_at > NOW() - INTERVAL '6 months'
       GROUP BY month
       ORDER BY month ASC`,
      [userId]
    );

    res.json({
      transactions: result.rows,
      total: parseInt(countRes.rows[0].total),
      commission_rate: commissionRate,
      by_event: byEvent.rows,
      by_month: byMonth.rows,
      period: period
    });
  } catch (err) {
    console.error('Erreur earnings history:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// GET /api/earnings/withdrawals — Mes demandes de retrait
router.get('/withdrawals', authMiddleware, async (req, res) => {
  try {
    var result = await pool.query(
      'SELECT * FROM withdrawals WHERE photographer_id = $1 ORDER BY requested_at DESC',
      [req.user.id]
    );
    res.json({ withdrawals: result.rows });
  } catch (err) {
    console.error('Erreur withdrawals:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /api/earnings/withdraw — Demander un retrait
router.post('/withdraw', authMiddleware, async (req, res) => {
  try {
    var { amount, phone } = req.body;
    if (!amount || !phone) return res.status(400).json({ error: 'Montant et numero requis.' });

    amount = parseFloat(amount);

    // Minimum retrait
    var minRes = await pool.query("SELECT value FROM app_settings WHERE key = 'min_withdrawal_amount'");
    var minAmount = minRes.rows[0] ? parseInt(minRes.rows[0].value) : 1000;
    if (amount < minAmount) return res.status(400).json({ error: 'Montant minimum: ' + minAmount + ' FCFA.' });

    // Calculer le solde disponible
    var userId = req.user.id;
    var plan = req.user.plan || 'free';
    var planRes = await pool.query('SELECT commission_rate FROM subscription_plans WHERE id = $1', [plan]);
    var commissionRate = planRes.rows[0] ? parseFloat(planRes.rows[0].commission_rate) : 0;

    var revRes = await pool.query(
      "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE photographer_id = $1 AND status = 'completed'",
      [userId]
    );
    var totalRevenue = parseFloat(revRes.rows[0].total);
    var totalCommission = Math.round(totalRevenue * commissionRate / 100);

    var withRes = await pool.query(
      "SELECT COALESCE(SUM(amount), 0) as total FROM withdrawals WHERE photographer_id = $1 AND status IN ('approved', 'pending')",
      [userId]
    );
    var totalWithdrawnOrPending = parseFloat(withRes.rows[0].total);
    var available = totalRevenue - totalCommission - totalWithdrawnOrPending;

    if (amount > available) return res.status(400).json({ error: 'Solde insuffisant. Disponible: ' + Math.floor(available) + ' FCFA.' });

    var result = await pool.query(
      'INSERT INTO withdrawals (photographer_id, amount, phone) VALUES ($1, $2, $3) RETURNING *',
      [userId, amount, phone]
    );

    res.status(201).json({ message: 'Demande de retrait envoyee.', withdrawal: result.rows[0] });
  } catch (err) {
    console.error('Erreur withdraw:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// GET /api/earnings/export/pdf — Export releve PDF (resume + detail par evenement)
router.get('/export/pdf', authMiddleware, async (req, res) => {
  try {
    var period = req.query.period || '30d';
    var startDate = req.query.startDate;
    var endDate = req.query.endDate;
    var data = await getExportData(req.user.id, period, startDate, endDate);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="fotokash-releve.pdf"');

    var doc = new PDFDocument({ size: 'A4', margin: 0 });
    doc.pipe(res);

    var pageWidth = doc.page.width;
    var accent = '#E8593C';
    var textDark = '#1a1a1f';
    var textMuted = '#6a6a70';
    var borderLight = '#e5e5e5';

    // Fond blanc (par defaut PDFKit), pas besoin de rect

    // En-tete
    doc.fillColor(textDark).fontSize(20).text('FotoKash', 40, 30);
    doc.fillColor(textMuted).fontSize(10).text('Releve de revenus photographe', 40, 55);

    doc.fillColor(accent).fontSize(11).text(data.photographer.studio_name || '', 40, 30, { align: 'right', width: pageWidth - 80 });
    doc.fillColor(textDark).fontSize(9.5).text('Photographe', 40, 46, { align: 'right', width: pageWidth - 80 });
    doc.fillColor(textMuted).fontSize(9.5).text(data.photographer.phone || '', 40, 59, { align: 'right', width: pageWidth - 80 });
    doc.fillColor(textMuted).fontSize(9.5).text(data.periodLabel, 40, 72, { align: 'right', width: pageWidth - 80 });

    doc.moveTo(0, 100).lineTo(pageWidth, 100).lineWidth(2).stroke(accent);

    // Resume
    var colWidth = (pageWidth - 80) / 3;
    var summaryY = 130;
    doc.fillColor(textMuted).fontSize(8).text('REVENU BRUT', 40, summaryY);
    doc.fillColor(textDark).fontSize(15).text(fcfa(data.totalRevenue), 40, summaryY + 14);

    doc.fillColor(textMuted).fontSize(8).text('COMMISSION', 40 + colWidth, summaryY);
    doc.fillColor(textDark).fontSize(15).text(fcfa(data.commissionAmount), 40 + colWidth, summaryY + 14);

    doc.fillColor(accent).fontSize(8).text('REVENU NET', 40 + colWidth * 2, summaryY);
    doc.fillColor(accent).fontSize(15).text(fcfa(data.netRevenue), 40 + colWidth * 2, summaryY + 14);

    // Detail par evenement
    var tableY = summaryY + 60;
    doc.fillColor(textDark).fontSize(10).text('DETAIL PAR EVENEMENT', 40, tableY);
    tableY += 20;

    doc.fillColor(textMuted).fontSize(9);
    doc.text('Evenement', 40, tableY, { width: 260 });
    doc.text('Photos', 300, tableY, { width: 80, align: 'center' });
    doc.text('Revenu', 380, tableY, { width: pageWidth - 420, align: 'right' });
    tableY += 16;
    doc.moveTo(40, tableY).lineTo(pageWidth - 40, tableY).lineWidth(0.5).stroke(borderLight);
    tableY += 8;

    if (data.byEvent.length === 0) {
      doc.fillColor(textMuted).fontSize(10).text('Aucune vente sur cette periode.', 40, tableY);
    } else {
      data.byEvent.forEach(function(ev) {
        doc.fillColor(textDark).fontSize(9.5);
        doc.text(ev.name, 40, tableY, { width: 260 });
        doc.text(String(ev.sales), 300, tableY, { width: 80, align: 'center' });
        doc.text(fcfa(ev.revenue), 380, tableY, { width: pageWidth - 420, align: 'right' });
        tableY += 18;
        doc.moveTo(40, tableY - 4).lineTo(pageWidth - 40, tableY - 4).lineWidth(0.5).stroke(borderLight);
      });
    }

    doc.fillColor(textMuted).fontSize(8).text('Document genere automatiquement par FotoKash - fotokash.com', 40, doc.page.height - 40, { width: pageWidth - 80, align: 'center' });

    doc.end();
  } catch (err) {
    console.error('Erreur export PDF:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// GET /api/earnings/export/excel — Export complet Excel (resume + evenements + transactions detaillees)
router.get('/export/excel', authMiddleware, async (req, res) => {
  try {
    var period = req.query.period || '30d';
    var startDate = req.query.startDate;
    var endDate = req.query.endDate;
    var data = await getExportData(req.user.id, period, startDate, endDate);

    var workbook = new ExcelJS.Workbook();
    workbook.creator = 'FotoKash';
    workbook.created = new Date();

    var accentColor = 'FFE8593C';
    var headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B0B0F' } };

    // Feuille Resume
    var summarySheet = workbook.addWorksheet('Resume');
    summarySheet.columns = [{ width: 28 }, { width: 24 }];
    summarySheet.addRow(['FotoKash - Releve de revenus']).font = { bold: true, size: 14 };
    summarySheet.addRow([data.photographer.studio_name || '']).font = { bold: true, color: { argb: accentColor } };
    summarySheet.addRow(['Photographe']);
    summarySheet.addRow([data.photographer.phone || '']);
    summarySheet.addRow(['Periode: ' + data.periodLabel]);
    summarySheet.addRow([]);
    var r1 = summarySheet.addRow(['Revenu brut', data.totalRevenue]);
    var r2 = summarySheet.addRow(['Commission (' + data.commissionRate + '%)', data.commissionAmount]);
    var r3 = summarySheet.addRow(['Revenu net', data.netRevenue]);
    var r4 = summarySheet.addRow(['Nombre de ventes', data.totalSales]);
    [r1, r2, r3].forEach(function(row) { row.getCell(2).numFmt = '#,##0 "F"'; });
    r3.font = { bold: true, color: { argb: accentColor } };

    // Feuille Evenements
    var eventSheet = workbook.addWorksheet('Evenements');
    eventSheet.columns = [
      { header: 'Evenement', key: 'name', width: 32 },
      { header: 'Ventes', key: 'sales', width: 12 },
      { header: 'Revenu', key: 'revenue', width: 16 }
    ];
    eventSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    eventSheet.getRow(1).fill = headerFill;
    data.byEvent.forEach(function(ev) {
      eventSheet.addRow({ name: ev.name, sales: parseInt(ev.sales), revenue: parseFloat(ev.revenue) });
    });
    eventSheet.getColumn('revenue').numFmt = '#,##0 "F"';

    // Feuille Transactions (detail complet avec IDs photos)
    var txSheet = workbook.addWorksheet('Transactions');
    txSheet.columns = [
      { header: 'Date', key: 'date', width: 18 },
      { header: 'Evenement', key: 'event', width: 26 },
      { header: 'Moyen de paiement', key: 'method', width: 18 },
      { header: 'Montant', key: 'amount', width: 14 },
      { header: 'Statut', key: 'status', width: 14 },
      { header: 'ID transaction', key: 'txid', width: 38 },
      { header: 'ID(s) photo(s)', key: 'photoids', width: 50 }
    ];
    txSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    txSheet.getRow(1).fill = headerFill;
    data.transactions.forEach(function(tx) {
      txSheet.addRow({
        date: new Date(tx.created_at).toLocaleString('fr-FR'),
        event: tx.event_name || '-',
        method: tx.payment_method || '-',
        amount: parseFloat(tx.amount),
        status: tx.status,
        txid: tx.id,
        photoids: (tx.photos_purchased || []).join(', ')
      });
    });
    txSheet.getColumn('amount').numFmt = '#,##0 "F"';

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="fotokash-releve.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Erreur export Excel:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
