const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const isAdmin = require('../middleware/isAdmin');
const { authMiddleware: auth } = require('../middleware/auth');
const jekoPayout = require('../services/jekoPayout');

// Toutes les routes admin nécessitent auth + admin
router.use(auth);
router.use(isAdmin);

// GET /api/admin/dashboard/stats
router.get('/dashboard/stats', async (req, res) => {
  try {
    const { period = 'today', startDate, endDate } = req.query;

    let dateFilter = '';
    let prevDateFilter = '';

    switch (period) {
      case 'today':
        dateFilter = "AND DATE(t.created_at) = CURRENT_DATE";
        prevDateFilter = "AND DATE(t.created_at) = CURRENT_DATE - INTERVAL '1 day'";
        break;
      case '7d':
        dateFilter = "AND t.created_at >= NOW() - INTERVAL '7 days'";
        prevDateFilter = "AND t.created_at BETWEEN NOW() - INTERVAL '14 days' AND NOW() - INTERVAL '7 days'";
        break;
      case '30d':
        dateFilter = "AND t.created_at >= NOW() - INTERVAL '30 days'";
        prevDateFilter = "AND t.created_at BETWEEN NOW() - INTERVAL '60 days' AND NOW() - INTERVAL '30 days'";
        break;
      case 'custom': {
        const isValidDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime());
        if (isValidDate(startDate) && isValidDate(endDate)) {
          dateFilter = "AND t.created_at >= '" + startDate + "' AND t.created_at < ('" + endDate + "'::date + INTERVAL '1 day')";
          const daysDiff = Math.max(0, Math.round((new Date(endDate) - new Date(startDate)) / (1000*60*60*24)));
          prevDateFilter = "AND t.created_at >= ('" + startDate + "'::date - INTERVAL '" + daysDiff + " days') AND t.created_at < '" + startDate + "'";
        } else {
          dateFilter = "AND DATE(t.created_at) = CURRENT_DATE";
          prevDateFilter = "AND DATE(t.created_at) = CURRENT_DATE - INTERVAL '1 day'";
        }
        break;
      }
      default:
        dateFilter = "AND DATE(t.created_at) = CURRENT_DATE";
        prevDateFilter = "AND DATE(t.created_at) = CURRENT_DATE - INTERVAL '1 day'";
    }

    const revenueResult = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total_revenue FROM transactions t WHERE status = 'completed' ${dateFilter}`
    );
    const prevRevenueResult = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as prev_revenue FROM transactions t WHERE status = 'completed' ${prevDateFilter}`
    );

    const photosResult = await pool.query(
      `SELECT COALESCE(SUM(array_length(photos_purchased, 1)), 0) as total_photos FROM transactions t WHERE status = 'completed' ${dateFilter}`
    );

// Téléchargements (HD + QR)
    const downloadsResult = await pool.query(
      `SELECT COUNT(*) as total_downloads FROM downloads d WHERE 1=1 ${dateFilter.replace(/t\.created_at/g, 'd.downloaded_at')}`
    );
    const prevDownloadsResult = await pool.query(
      `SELECT COUNT(*) as prev_downloads FROM downloads d WHERE 1=1 ${prevDateFilter.replace(/t\.created_at/g, 'd.downloaded_at')}`
    );
    const prevPhotosResult = await pool.query(
      `SELECT COALESCE(SUM(array_length(photos_purchased, 1)), 0) as prev_photos FROM transactions t WHERE status = 'completed' ${prevDateFilter}`
    );

    const eventsResult = await pool.query(
      `SELECT COUNT(*) as active_events FROM events WHERE status = 'live' AND deleted_at IS NULL`
    );
    const newEventsResult = await pool.query(
      `SELECT COUNT(*) as new_events FROM events e WHERE e.deleted_at IS NULL ${dateFilter.replace(/t\./g, 'e.')}`
    );

    const photographersResult = await pool.query(
      `SELECT COUNT(*) as total_photographers, COUNT(*) FILTER (WHERE status = 'active' OR status IS NULL) as active_photographers FROM photographers WHERE (role != 'admin' OR role IS NULL) AND deleted_at IS NULL`
    );
    const newPhotographersResult = await pool.query(
      `SELECT COUNT(*) as new_photographers FROM photographers p WHERE (role != 'admin' OR role IS NULL) AND p.deleted_at IS NULL ${dateFilter.replace(/t\./g, 'p.')}`
    );

    const currentRevenue = parseFloat(revenueResult.rows[0].total_revenue);
    const prevRevenue = parseFloat(prevRevenueResult.rows[0].prev_revenue);
    const revenueChange = prevRevenue > 0 ? Math.round(((currentRevenue - prevRevenue) / prevRevenue) * 100) : currentRevenue > 0 ? 100 : 0;

    const currentPhotos = parseInt(photosResult.rows[0].total_photos);
    const prevPhotos = parseInt(prevPhotosResult.rows[0].prev_photos);
    const photosChange = prevPhotos > 0 ? Math.round(((currentPhotos - prevPhotos) / prevPhotos) * 100) : currentPhotos > 0 ? 100 : 0;

    res.json({
      revenue: { total: currentRevenue, change: revenueChange, currency: 'F CFA' },
      photos: { total: currentPhotos, change: photosChange },
      events: { active: parseInt(eventsResult.rows[0].active_events), new: parseInt(newEventsResult.rows[0].new_events) },
      downloads: {
        total: parseInt(downloadsResult.rows[0].total_downloads),
        change: (() => {
          const curr = parseInt(downloadsResult.rows[0].total_downloads);
          const prev = parseInt(prevDownloadsResult.rows[0].prev_downloads);
          return prev > 0 ? Math.round(((curr - prev) / prev) * 100) : curr > 0 ? 100 : 0;
        })(),
      },
      photographers: { total: parseInt(photographersResult.rows[0].total_photographers), active: parseInt(photographersResult.rows[0].active_photographers), new: parseInt(newPhotographersResult.rows[0].new_photographers) }
    });
  } catch (error) {
    console.error('Erreur dashboard stats:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/admin/dashboard/revenue-chart
router.get('/dashboard/revenue-chart', async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const numDays = parseInt(days);

    const result = await pool.query(
      `SELECT DATE(created_at) as date, COALESCE(SUM(amount), 0) as revenue FROM transactions WHERE status = 'completed' AND created_at >= NOW() - INTERVAL '${numDays} days' GROUP BY DATE(created_at) ORDER BY date ASC`
    );

    const chartData = [];
    const today = new Date();
    const dayNames = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

    for (let i = numDays - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const found = result.rows.find(r => {
        const rowDate = new Date(r.date).toISOString().split('T')[0];
        return rowDate === dateStr;
      });
      chartData.push({ date: dateStr, day: dayNames[date.getDay()], revenue: found ? parseFloat(found.revenue) : 0 });
    }

    res.json({ chartData });
  } catch (error) {
    console.error('Erreur revenue chart:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/admin/dashboard/recent-sales
router.get('/dashboard/recent-sales', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.id, t.amount, t.currency, t.payment_method, t.created_at, t.photos_purchased, e.name as event_name FROM transactions t JOIN events e ON t.event_id = e.id WHERE t.status = 'completed' ORDER BY t.created_at DESC LIMIT 5`
    );

    res.json({
      sales: result.rows.map(row => ({
        id: row.id,
        eventName: row.event_name,
        photoCount: row.photos_purchased ? row.photos_purchased.length : 0,
        amount: parseFloat(row.amount),
        currency: row.currency || 'XOF',
        paymentMethod: row.payment_method,
        date: row.created_at
      }))
    });
  } catch (error) {
    console.error('Erreur recent sales:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// GET /api/admin/photographers
// Liste tous les photographes avec leurs stats
// ============================================
router.get('/photographers', async (req, res) => {
  try {
    const { search = '', status = 'all' } = req.query;

    let statusFilter = '';
    if (status === 'active') statusFilter = "AND p.status = 'active'";
    if (status === 'inactive') statusFilter = "AND p.status = 'inactive'";

    const params = [];
    let searchFilter = '';
    if (search) {
      params.push('%' + search + '%');
      searchFilter = `AND (LOWER(p.studio_name) LIKE LOWER(${params.length}) OR LOWER(p.email) LIKE LOWER(${params.length}))`;
    }

    const query = `
      SELECT
        p.id, p.studio_name, p.email, p.phone, p.plan, p.photo_limit,
        p.role, p.status, p.created_at,
        COALESCE((SELECT COUNT(*) FROM events e WHERE e.photographer_id = p.id AND e.deleted_at IS NULL), 0) as total_events,
        COALESCE((SELECT COUNT(*) FROM photos ph WHERE ph.photographer_id = p.id), 0) as total_photos,
        COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.photographer_id = p.id AND t.status = 'completed'), 0) as total_revenue,
        p.created_at as last_activity
      FROM photographers p
      WHERE (p.role != 'admin' OR p.role IS NULL) AND p.deleted_at IS NULL ${statusFilter} ${searchFilter}
      ORDER BY p.created_at DESC
    `;
    const result = await pool.query(query, params);

    res.json({
      photographers: result.rows.map(row => ({
        id: row.id,
        studioName: row.studio_name,
        email: row.email,
        phone: row.phone,
        plan: row.plan || 'free',
        photoLimit: row.photo_limit,
        role: row.role,
        status: row.status || 'active',
        createdAt: row.created_at,
        totalEvents: parseInt(row.total_events),
        totalPhotos: parseInt(row.total_photos),
        totalRevenue: parseFloat(row.total_revenue),
      })),
      total: result.rows.length
    });
  } catch (error) {
    console.error('Erreur liste photographes:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// PATCH /api/admin/photographers/:id/status
// Activer ou désactiver un photographe
// ============================================
router.patch('/photographers/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['active', 'inactive'].includes(status)) {
      return res.status(400).json({ error: 'Statut invalide. Utilisez "active" ou "inactive".' });
    }

    const result = await pool.query(
      'UPDATE photographers SET status = $1, updated_at = NOW() WHERE id = $2 AND (role != $3 OR role IS NULL) RETURNING id, studio_name, email, status',
      [status, id, 'admin']
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Photographe introuvable.' });
    }

    // Email automatique
    try {
      const { sendEmail, emailTemplate } = require('../config/mailer');
      const p = result.rows[0];
      if (status === 'active') {
        await sendEmail({
          to: p.email,
          subject: 'FotoKash - Votre compte est actif !',
          html: emailTemplate('Bienvenue sur FotoKash !', '<p>Bonjour ' + p.studio_name + ',</p><p>Votre compte photographe a ete active avec succes. Vous pouvez maintenant vous connecter, creer des evenements et uploader vos photos.</p><p>Bonne utilisation !</p>', 'Se connecter', 'https://fotokash.com')
        });
      } else {
        await sendEmail({
          to: p.email,
          subject: 'FotoKash - Compte desactive',
          html: emailTemplate('Compte desactive', '<p>Bonjour ' + p.studio_name + ',</p><p>Votre compte photographe a ete desactive par l administrateur. Si vous pensez qu il s agit d une erreur, veuillez nous contacter.</p>', null, null)
        });
      }
    } catch (emailErr) { console.error('[EMAIL] Erreur notification statut:', emailErr.message); }

    res.json({
      message: `Photographe ${status === 'active' ? 'activé' : 'désactivé'} avec succès.`,
      photographer: result.rows[0]
    });
  } catch (error) {
    console.error('Erreur changement statut:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// GET /api/admin/photographers/:id
// Détails d'un photographe avec stats complètes
// ============================================
router.get('/photographers/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const photographerQuery = `
      SELECT
        p.id, p.studio_name, p.email, p.phone, p.plan, p.photo_limit,
        p.role, p.status, p.created_at, p.updated_at,
        COALESCE((SELECT COUNT(*) FROM events e WHERE e.photographer_id = p.id AND e.deleted_at IS NULL), 0) as total_events,
        COALESCE((SELECT COUNT(*) FROM photos ph WHERE ph.photographer_id = p.id), 0) as total_photos,
        COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.photographer_id = p.id AND t.status = 'completed'), 0) as total_revenue,
        COALESCE((SELECT COUNT(*) FROM transactions t WHERE t.photographer_id = p.id AND t.status = 'completed'), 0) as total_sales
      FROM photographers p
      WHERE p.id = $1
    `;
    const result = await pool.query(photographerQuery, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Photographe introuvable.' });
    }

    const eventsQuery = `
      SELECT e.id, e.name, e.slug, e.date, e.status, e.created_at,
        (SELECT COUNT(*) FROM photos WHERE event_id = e.id) as photo_count,
        sp.event_retention_days,
        CASE WHEN sp.event_retention_days IS NOT NULL
          THEN EXTRACT(DAY FROM (e.created_at + (sp.event_retention_days || ' days')::INTERVAL) - NOW())
          ELSE NULL
        END as days_remaining
      FROM events e
      JOIN photographers p ON p.id = e.photographer_id
      LEFT JOIN subscription_plans sp ON sp.id = p.plan
      WHERE e.photographer_id = $1
      ORDER BY e.created_at DESC
      LIMIT 10
    `;
    const eventsResult = await pool.query(eventsQuery, [id]);

    const row = result.rows[0];
    res.json({
      photographer: {
        id: row.id,
        studioName: row.studio_name,
        email: row.email,
        phone: row.phone,
        plan: row.plan || 'free',
        photoLimit: row.photo_limit,
        role: row.role,
        status: row.status || 'active',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        totalEvents: parseInt(row.total_events),
        totalPhotos: parseInt(row.total_photos),
        totalRevenue: parseFloat(row.total_revenue),
        totalSales: parseInt(row.total_sales),
      },
      events: eventsResult.rows.map(e => ({
        id: e.id,
        name: e.name,
        slug: e.slug,
        date: e.date,
        status: e.status,
        photoCount: parseInt(e.photo_count),
        createdAt: e.created_at,
        retentionDays: e.event_retention_days,
        daysRemaining: e.days_remaining ? parseInt(e.days_remaining) : null,
      }))
    });
  } catch (error) {
    console.error('Erreur détails photographe:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// GET /api/admin/plans
// Liste tous les plans d'abonnement
// ============================================
router.get('/plans', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM subscription_plans ORDER BY price ASC');
    res.json({ plans: result.rows });
  } catch (error) {
    console.error('Erreur liste plans:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// PUT /api/admin/plans/:id
// Modifier un plan d'abonnement
// ============================================
router.put('/plans/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, price, commission_rate, photo_limit, event_limit, mobile_money_enabled, photo_editing_level } = req.body;

    const result = await pool.query(
      `UPDATE subscription_plans 
       SET name = COALESCE($1, name),
           price = COALESCE($2, price),
           commission_rate = COALESCE($3, commission_rate),
           photo_limit = COALESCE($4, photo_limit),
           event_limit = $5,
           mobile_money_enabled = COALESCE($6, mobile_money_enabled),
           photo_editing_level = COALESCE($7, photo_editing_level)
       WHERE id = $8
       RETURNING *`,
      [name, price, commission_rate, photo_limit, event_limit, mobile_money_enabled, photo_editing_level, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Plan introuvable.' });
    }

    res.json({ message: 'Plan mis à jour.', plan: result.rows[0] });
  } catch (error) {
    console.error('Erreur modification plan:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// PATCH /api/admin/photographers/:id/plan
// Changer le plan d'un photographe
// ============================================
router.patch('/photographers/:id/plan', async (req, res) => {
  try {
    const { id } = req.params;
    const { plan } = req.body;

    const planCheck = await pool.query('SELECT * FROM subscription_plans WHERE id = $1', [plan]);
    if (planCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Plan invalide.' });
    }

    const planData = planCheck.rows[0];
    const result = await pool.query(
      'UPDATE photographers SET plan = $1, photo_limit = $2, updated_at = NOW() WHERE id = $3 RETURNING id, studio_name, email, plan, photo_limit',
      [plan, planData.photo_limit, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Photographe introuvable.' });
    }

    // Email automatique changement de plan
    try {
      const { sendEmail, emailTemplate } = require('../config/mailer');
      const p = result.rows[0];
      await sendEmail({
        to: p.email,
        subject: 'FotoKash - Votre plan a ete mis a jour',
        html: emailTemplate('Plan mis a jour', '<p>Bonjour ' + p.studio_name + ',</p><p>Votre plan a ete change en <strong>' + planData.name.toUpperCase() + '</strong>.</p><p>Limite photos : ' + planData.photo_limit + ' par evenement</p><p>Bonne utilisation !</p>', 'Voir mon compte', 'https://fotokash.com')
      });
    } catch (emailErr) { console.error('[EMAIL] Erreur notification plan:', emailErr.message); }

    res.json({ message: `Plan changé en ${planData.name}.`, photographer: result.rows[0] });
  } catch (error) {
    console.error('Erreur changement plan:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// GET /api/admin/commissions
// Stats des commissions FotoKash
// ============================================
router.get('/commissions', async (req, res) => {
  try {
    const { period = '30d' } = req.query;
    let dateFilter = '';
    let prevDateFilter = '';
    switch (period) {
      case 'today':
        dateFilter = "AND DATE(t.created_at) = CURRENT_DATE";
        prevDateFilter = "AND DATE(t.created_at) = CURRENT_DATE - INTERVAL '1 day'";
        break;
      case '7d':
        dateFilter = "AND t.created_at >= NOW() - INTERVAL '7 days'";
        prevDateFilter = "AND t.created_at >= NOW() - INTERVAL '14 days' AND t.created_at < NOW() - INTERVAL '7 days'";
        break;
      case '30d':
        dateFilter = "AND t.created_at >= NOW() - INTERVAL '30 days'";
        prevDateFilter = "AND t.created_at >= NOW() - INTERVAL '60 days' AND t.created_at < NOW() - INTERVAL '30 days'";
        break;
      default:
        dateFilter = "AND t.created_at >= NOW() - INTERVAL '30 days'";
        prevDateFilter = "AND t.created_at >= NOW() - INTERVAL '60 days' AND t.created_at < NOW() - INTERVAL '30 days'";
    }
    const result = await pool.query(`
      SELECT
        sp.id as plan,
        sp.commission_rate,
        COUNT(t.id) as total_sales,
        COALESCE(SUM(t.amount), 0) as total_revenue,
        COALESCE(SUM(t.amount * sp.commission_rate / 100), 0) as total_commission,
        COALESCE(SUM(t.amount - (t.amount * sp.commission_rate / 100)), 0) as photographer_revenue
      FROM subscription_plans sp
      LEFT JOIN photographers p ON p.plan = sp.id
      LEFT JOIN transactions t ON t.photographer_id = p.id AND t.status = 'completed' ${dateFilter}
      GROUP BY sp.id, sp.commission_rate
      ORDER BY total_revenue DESC
    `);
    const totals = await pool.query(`
      SELECT
        COALESCE(SUM(t.amount), 0) as total_revenue,
        COALESCE(SUM(t.amount * sp.commission_rate / 100), 0) as total_commission
      FROM transactions t
      JOIN photographers p ON t.photographer_id = p.id
      JOIN subscription_plans sp ON p.plan = sp.id
      WHERE t.status = 'completed' ${dateFilter}
    `);
    const prevTotals = await pool.query(`
      SELECT
        COALESCE(SUM(t.amount), 0) as total_revenue,
        COALESCE(SUM(t.amount * sp.commission_rate / 100), 0) as total_commission
      FROM transactions t
      JOIN photographers p ON t.photographer_id = p.id
      JOIN subscription_plans sp ON p.plan = sp.id
      WHERE t.status = 'completed' ${prevDateFilter}
    `);
    const planDistribution = await pool.query(`
      SELECT plan, COUNT(*) as count
      FROM photographers
      WHERE role != 'admin' OR role IS NULL
      GROUP BY plan
    `);
    const curRevenue = parseFloat(totals.rows[0]?.total_revenue || 0);
    const curCommission = parseFloat(totals.rows[0]?.total_commission || 0);
    const prevRevenue = parseFloat(prevTotals.rows[0]?.total_revenue || 0);
    const prevCommission = parseFloat(prevTotals.rows[0]?.total_commission || 0);
    const curMargin = curRevenue > 0 ? (curCommission / curRevenue) * 100 : 0;
    const prevMargin = prevRevenue > 0 ? (prevCommission / prevRevenue) * 100 : 0;
    res.json({
      byPlan: result.rows.map(r => ({
        plan: r.plan,
        commissionRate: parseFloat(r.commission_rate),
        totalSales: parseInt(r.total_sales),
        totalRevenue: parseFloat(r.total_revenue),
        totalCommission: parseFloat(r.total_commission),
        photographerRevenue: parseFloat(r.photographer_revenue),
      })),
      totals: {
        revenue: curRevenue,
        commission: curCommission,
        margin: Math.round(curMargin * 100) / 100,
        marginDelta: Math.round((curMargin - prevMargin) * 100) / 100,
      },
      planDistribution: planDistribution.rows.map(r => ({
        plan: r.plan || 'free',
        count: parseInt(r.count),
      })),
    });
  } catch (error) {
    console.error('Erreur commissions:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// GET /api/admin/logs
// Liste les logs d'activité
// ============================================
router.get('/logs', async (req, res) => {
  try {
    const { action = '', period = '', search = '', page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let conditions = [];
    let params = [];
    if (action) { params.push(action); conditions.push(`action = $${params.length}`); }
    if (period === 'today') conditions.push("created_at >= CURRENT_DATE");
    else if (period === '7d') conditions.push("created_at >= NOW() - INTERVAL '7 days'");
    else if (period === '30d') conditions.push("created_at >= NOW() - INTERVAL '30 days'");
    if (search) {
      params.push('%' + search + '%');
      const idx = params.length;
      conditions.push(`(actor_name ILIKE $${idx} OR details::text ILIKE $${idx} OR CAST(entity_id AS TEXT) ILIKE $${idx})`);
    }
    const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const countResult = await pool.query(`SELECT COUNT(*) as total FROM admin_logs ${whereClause}`, params);

    const limitParamIndex = params.length + 1;
    const offsetParamIndex = params.length + 2;
    const result = await pool.query(
      `SELECT * FROM admin_logs ${whereClause} ORDER BY created_at DESC LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}`,
      [...params, parseInt(limit), offset]
    );

    const actions = await pool.query('SELECT DISTINCT action FROM admin_logs ORDER BY action');

    let baseConditions = [];
    let baseParams = [];
    if (action) { baseParams.push(action); baseConditions.push(`action = $${baseParams.length}`); }
    if (search) {
      baseParams.push('%' + search + '%');
      const idx = baseParams.length;
      baseConditions.push(`(actor_name ILIKE $${idx} OR details::text ILIKE $${idx} OR CAST(entity_id AS TEXT) ILIKE $${idx})`);
    }
    const baseWhere = baseConditions.length ? 'WHERE ' + baseConditions.join(' AND ') : '';
    const countsResult = await pool.query(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) as today,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as last7,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') as last30
       FROM admin_logs ${baseWhere}`,
      baseParams
    );

    res.json({
      logs: result.rows,
      total: parseInt(countResult.rows[0].total),
      page: parseInt(page),
      totalPages: Math.ceil(parseInt(countResult.rows[0].total) / parseInt(limit)),
      actions: actions.rows.map(a => a.action),
      periodCounts: {
        all: parseInt(countsResult.rows[0].total),
        today: parseInt(countsResult.rows[0].today),
        '7d': parseInt(countsResult.rows[0].last7),
        '30d': parseInt(countsResult.rows[0].last30),
      },
    });
  } catch (error) {
    console.error('Erreur logs:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// POST /api/admin/logs
// Ajouter un log (utilisé par d'autres routes)
// ============================================
router.post('/logs', async (req, res) => {
  try {
    const { action, entity_type, entity_id, details } = req.body;
    const result = await pool.query(
      `INSERT INTO admin_logs (action, entity_type, entity_id, actor_id, actor_name, details)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [action, entity_type, entity_id || null, req.user.id, req.user.studio_name, JSON.stringify(details || {})]
    );
    res.json({ log: result.rows[0] });
  } catch (error) {
    console.error('Erreur ajout log:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// GET /api/admin/settings
// Liste tous les paramètres
// ============================================
router.get('/settings', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM app_settings ORDER BY key');
    res.json({ settings: result.rows });
  } catch (error) {
    console.error('Erreur settings:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// PUT /api/admin/settings
// Modifier les paramètres (batch update)
// ============================================
router.put('/settings', async (req, res) => {
  try {
    const { settings } = req.body;
    if (!settings || !Array.isArray(settings)) {
      return res.status(400).json({ error: 'Format invalide.' });
    }

    for (const s of settings) {
      await pool.query(
        'UPDATE app_settings SET value = $1, updated_at = NOW() WHERE key = $2',
        [String(s.value), s.key]
      );
    }

    await pool.query(
      `INSERT INTO admin_logs (action, entity_type, actor_id, actor_name, details)
       VALUES ($1, $2, $3, $4, $5)`,
      ['settings_updated', 'system', req.user.id, req.user.studio_name,
       JSON.stringify({ keys: settings.map(s => s.key) })]
    );

    const result = await pool.query('SELECT * FROM app_settings ORDER BY key');
    res.json({ message: 'Paramètres mis à jour.', settings: result.rows });
  } catch (error) {
    console.error('Erreur update settings:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// DELETE /api/admin/photographers/:id
// Supprimer un photographe et tout son contenu
// ============================================
router.delete('/photographers/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const check = await pool.query('SELECT id, role, studio_name FROM photographers WHERE id = $1', [id]);
    if (check.rows.length === 0) {
      client.release();
      return res.status(404).json({ error: 'Photographe introuvable.' });
    }
    if (check.rows[0].role === 'admin') {
      client.release();
      return res.status(403).json({ error: 'Impossible de supprimer un compte admin.' });
    }
    const name = check.rows[0].studio_name;

    await client.query('BEGIN');
    // Soft delete : compte, events et photos marques supprimes.
    // transactions, downloads, withdrawals conserves pour toujours (historique stats admin).
    await client.query('DELETE FROM face_embeddings WHERE event_id IN (SELECT id FROM events WHERE photographer_id = $1)', [id]);
    const photosToPurge = await client.query('SELECT id FROM photos WHERE photographer_id = $1 AND deleted_at IS NULL', [id]);
    await client.query('UPDATE photos SET deleted_at = NOW() WHERE photographer_id = $1', [id]);
    await client.query("UPDATE events SET deleted_at = NOW(), is_public = false WHERE photographer_id = $1", [id]);
    await client.query("UPDATE photographers SET deleted_at = NOW(), status = 'inactive' WHERE id = $1", [id]);
    await client.query('COMMIT');
    client.release();

    const { purgeCloudinaryForPhotos } = require('../utils/cloudinaryCleanup');
    const photoIdsToPurge = photosToPurge.rows.map(r => r.id);
    purgeCloudinaryForPhotos(photoIdsToPurge).catch(err => {
      console.error('[CLOUDINARY-PURGE] Erreur non bloquante:', err.message);
    });

    await pool.query(
      'INSERT INTO admin_logs (action, entity_type, entity_id, actor_id, actor_name, details) VALUES ($1, $2, $3, $4, $5, $6)',
      ['photographer_deleted', 'photographer', id, req.user.id, req.user.studio_name, JSON.stringify({ deleted_name: name })]
    );
    res.json({ message: 'Photographe "' + name + '" supprime (compte et contenu desactives, historique conserve).' });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    console.error('Erreur suppression photographe:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// POST /api/admin/photographers
// Creer un compte photographe (par l'admin)
// ============================================
router.post('/photographers', async (req, res) => {
  try {
    var bcrypt = require('bcryptjs');
    var studio_name = (req.body.studio_name || '').trim();
    var email = (req.body.email || '').trim().toLowerCase();
    var phone = (req.body.phone || '').trim();
    var plan = req.body.plan || 'free';
    if (!studio_name || !email) {
      return res.status(400).json({ error: 'Nom du studio et email requis.' });
    }
    if (['free', 'pro', 'business'].indexOf(plan) === -1) {
      return res.status(400).json({ error: 'Plan invalide.' });
    }
    var existing = await pool.query('SELECT id FROM photographers WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Cet email est deja utilise.' });
    }
    var defaultPassword = 'FotoKash2026!';
    var password_hash = await bcrypt.hash(defaultPassword, 12);

    var planResult = await pool.query('SELECT photo_limit FROM subscription_plans WHERE id = $1', [plan]);
    var photoLimit = planResult.rows[0] ? planResult.rows[0].photo_limit : 100;

    var result = await pool.query(
      `INSERT INTO photographers (studio_name, email, password_hash, phone, plan, photo_limit, status, role)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', 'photographer')
       RETURNING id, studio_name, email, phone, plan, photo_limit, role, status, created_at`,
      [studio_name, email, password_hash, phone || null, plan, photoLimit]
    );

    await pool.query(
      `INSERT INTO admin_logs (action, entity_type, entity_id, actor_id, actor_name, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ['photographer_created_by_admin', 'photographer', result.rows[0].id, req.user.id, req.user.studio_name, JSON.stringify({ email: email, plan: plan })]
    );

    res.json({ photographer: result.rows[0], defaultPassword: defaultPassword });
  } catch (error) {
    console.error('Erreur creation photographe:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// PATCH /api/admin/photographers/:id/password
// Reinitialiser le mot de passe d'un photographe
// ============================================
router.patch('/photographers/:id/password', async (req, res) => {
  try {
    var id = req.params.id;
    var bcrypt = require('bcryptjs');
    var defaultPassword = 'FotoKash2026!';
    var hash = await bcrypt.hash(defaultPassword, 12);
    var result = await pool.query(
      'UPDATE photographers SET password_hash = $1, updated_at = NOW() WHERE id = $2 AND (role != $3 OR role IS NULL) RETURNING id, studio_name, email',
      [hash, id, 'admin']
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Photographe introuvable.' });
    }
    await pool.query(
      'INSERT INTO admin_logs (action, entity_type, entity_id, actor_id, actor_name, details) VALUES ($1, $2, $3, $4, $5, $6)',
      ['password_reset', 'photographer', id, req.user.id, req.user.studio_name, JSON.stringify({ reset_for: result.rows[0].email })]
    );
    res.json({ message: 'Mot de passe reinitialise. Nouveau mot de passe : ' + defaultPassword, defaultPassword: defaultPassword });
  } catch (error) {
    console.error('Erreur reset password:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});




// ============================================
// GET /api/admin/withdrawals — Liste des demandes de retrait
// ============================================
router.get('/withdrawals', async (req, res) => {
  try {
    var status = req.query.status || 'all';
    var allowedStatuses = ['pending', 'approved', 'rejected'];
    var where = '';
    var params = [];
    if (status !== 'all') {
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ error: 'Statut invalide.' });
      }
      where = 'WHERE w.status = $1';
      params.push(status);
    }
    var result = await pool.query(
      'SELECT w.*, p.studio_name, p.email, p.phone as photographer_phone, p.plan FROM withdrawals w JOIN photographers p ON p.id = w.photographer_id ' + where + ' ORDER BY w.requested_at DESC',
      params
    );
    res.json({ withdrawals: result.rows });
  } catch (err) {
    console.error('Erreur admin withdrawals:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ============================================
// PUT /api/admin/withdrawals/:id — Approuver/Rejeter un retrait
// ============================================
router.put('/withdrawals/:id', async (req, res) => {
  var DOLLAR = String.fromCharCode(36);
  try {
    var { id } = req.params;
    var { status, admin_note, manual } = req.body;
    if (!status || !['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Statut invalide. Utilisez approved ou rejected.' });
    }

    if (status === 'rejected') {
      var rejectResult = await pool.query(
        'UPDATE withdrawals SET status = ' + DOLLAR + '1, admin_note = ' + DOLLAR + '2, processed_at = NOW() WHERE id = ' + DOLLAR + '3 AND status = ' + DOLLAR + '4 RETURNING *',
        [status, admin_note || null, id, 'pending']
      );
      if (rejectResult.rows.length === 0) {
        return res.status(404).json({ error: 'Demande introuvable ou deja traitee.' });
      }
      await pool.query(
        'INSERT INTO admin_logs (action, entity_type, entity_id, actor_id, actor_name, details) VALUES (' + DOLLAR + '1, ' + DOLLAR + '2, ' + DOLLAR + '3, ' + DOLLAR + '4, ' + DOLLAR + '5, ' + DOLLAR + '6)',
        ['reject_withdrawal', 'withdrawal', id, req.user.id, req.user.studio_name, JSON.stringify({ amount: rejectResult.rows[0].amount, phone: rejectResult.rows[0].phone, note: admin_note })]
      );
      return res.json({ message: 'Retrait rejete.', withdrawal: rejectResult.rows[0] });
    }

    // Traitement manuel : le retrait a deja ete paye autrement (ex: appli
    // Jeko directement) - on marque juste approuve, sans appel a l'API.
    if (manual === true) {
      var manualResult = await pool.query(
        'UPDATE withdrawals SET status = ' + DOLLAR + '1, admin_note = ' + DOLLAR + '2, processed_at = NOW(), payout_error = NULL WHERE id = ' + DOLLAR + '3 AND status = ' + DOLLAR + '4 RETURNING *',
        [status, admin_note || null, id, 'pending']
      );
      if (manualResult.rows.length === 0) {
        return res.status(404).json({ error: 'Demande introuvable ou deja traitee.' });
      }
      await pool.query(
        'INSERT INTO admin_logs (action, entity_type, entity_id, actor_id, actor_name, details) VALUES (' + DOLLAR + '1, ' + DOLLAR + '2, ' + DOLLAR + '3, ' + DOLLAR + '4, ' + DOLLAR + '5, ' + DOLLAR + '6)',
        ['approve_withdrawal_manual', 'withdrawal', id, req.user.id, req.user.studio_name, JSON.stringify({ amount: manualResult.rows[0].amount, net_amount: manualResult.rows[0].net_amount, phone: manualResult.rows[0].phone, note: admin_note })]
      );
      return res.json({ message: 'Retrait marque comme traite manuellement.', withdrawal: manualResult.rows[0] });
    }

    // Approbation automatique : declenche un vrai transfert Jeko avant de marquer approuve.
    var lookup = await pool.query(
      'SELECT w.*, p.studio_name FROM withdrawals w JOIN photographers p ON p.id = w.photographer_id WHERE w.id = ' + DOLLAR + '1 AND w.status = ' + DOLLAR + '2',
      [id, 'pending']
    );
    if (lookup.rows.length === 0) {
      return res.status(404).json({ error: 'Demande introuvable ou deja traitee.' });
    }
    var w = lookup.rows[0];

    if (!w.operator || w.net_amount == null) {
      return res.status(400).json({ error: 'Cette demande ne contient pas d\'operateur/montant net (ancienne demande sans le nouveau format). Traitement manuel requis.' });
    }

    var transferId;
    var contactId;
    try {
      contactId = await jekoPayout.getOrCreateContact(w.studio_name, w.operator, w.phone);
      var transfer = await jekoPayout.initiateTransfer(contactId, parseFloat(w.net_amount));
      transferId = transfer.id;
    } catch (payoutErr) {
      console.error('Erreur transfert Jeko payout:', payoutErr);
      await pool.query(
        'UPDATE withdrawals SET payout_error = ' + DOLLAR + '1 WHERE id = ' + DOLLAR + '2',
        [payoutErr.message, id]
      );
      return res.status(502).json({ error: 'Echec du transfert Jeko : ' + payoutErr.message });
    }

    var result = await pool.query(
      'UPDATE withdrawals SET status = ' + DOLLAR + '1, admin_note = ' + DOLLAR + '2, processed_at = NOW(), jeko_contact_id = ' + DOLLAR + '3, jeko_transfer_id = ' + DOLLAR + '4, payout_error = NULL WHERE id = ' + DOLLAR + '5 RETURNING *',
      [status, admin_note || null, contactId, transferId, id]
    );

    await pool.query(
      'INSERT INTO admin_logs (action, entity_type, entity_id, actor_id, actor_name, details) VALUES (' + DOLLAR + '1, ' + DOLLAR + '2, ' + DOLLAR + '3, ' + DOLLAR + '4, ' + DOLLAR + '5, ' + DOLLAR + '6)',
      ['approve_withdrawal', 'withdrawal', id, req.user.id, req.user.studio_name, JSON.stringify({ amount: result.rows[0].amount, net_amount: result.rows[0].net_amount, phone: result.rows[0].phone, jeko_transfer_id: transferId, note: admin_note })]
    );

    res.json({ message: 'Retrait approuve et transfere.', withdrawal: result.rows[0] });
  } catch (err) {
    console.error('Erreur update withdrawal:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// GET /api/admin/transactions - Liste complete de toutes les transactions
// (reference, moyen de paiement, telephone du payeur, statut) - vue admin
// uniquement, jamais exposee au photographe.
router.get('/transactions', async (req, res) => {
  var D = String.fromCharCode(36);
  try {
    var status = req.query.status || '';
    var search = req.query.search || '';
    var page = parseInt(req.query.page) || 1;
    var limit = parseInt(req.query.limit) || 30;
    var offset = (page - 1) * limit;
    var conditions = [];
    var params = [];
    if (status) {
      params.push(status);
      conditions.push('t.status = ' + D + params.length);
    }
    if (search) {
      params.push('%' + search + '%');
      var idx = params.length;
      conditions.push('(t.reference ILIKE ' + D + idx + ' OR e.name ILIKE ' + D + idx + ' OR p.studio_name ILIKE ' + D + idx + ')');
    }
    var whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    var countSql = 'SELECT COUNT(*) as total FROM transactions t LEFT JOIN events e ON e.id = t.event_id LEFT JOIN photographers p ON p.id = t.photographer_id ' + whereClause;
    var countResult = await pool.query(countSql, params);
    var limitIdx = params.length + 1;
    var offsetIdx = params.length + 2;
    var selectSql = 'SELECT t.id, t.reference, t.amount, t.payment_method, t.phone, t.status, t.created_at, t.completed_at, array_length(t.photos_purchased, 1) as photos_count, e.name as event_name, e.slug as event_slug, p.studio_name, p.email as photographer_email FROM transactions t LEFT JOIN events e ON e.id = t.event_id LEFT JOIN photographers p ON p.id = t.photographer_id ' + whereClause + ' ORDER BY t.created_at DESC LIMIT ' + D + limitIdx + ' OFFSET ' + D + offsetIdx;
    var result = await pool.query(selectSql, [...params, limit, offset]);

    var searchConditions = [];
    var searchParams = [];
    if (search) {
      searchParams.push('%' + search + '%');
      var sidx = searchParams.length;
      searchConditions.push('(t.reference ILIKE ' + D + sidx + ' OR e.name ILIKE ' + D + sidx + ' OR p.studio_name ILIKE ' + D + sidx + ')');
    }
    var searchWhere = searchConditions.length ? 'WHERE ' + searchConditions.join(' AND ') : '';
    var statsSql = 'SELECT ' +
      'COUNT(*) as all_count, ' +
      "COUNT(*) FILTER (WHERE t.status = 'completed') as completed_count, " +
      "COUNT(*) FILTER (WHERE t.status = 'pending') as pending_count, " +
      "COUNT(*) FILTER (WHERE t.status = 'failed') as failed_count, " +
      'COALESCE(SUM(t.amount), 0) as total_volume ' +
      'FROM transactions t LEFT JOIN events e ON e.id = t.event_id LEFT JOIN photographers p ON p.id = t.photographer_id ' + searchWhere;
    var statsResult = await pool.query(statsSql, searchParams);
    var stats = statsResult.rows[0];

    res.json({
      transactions: result.rows,
      total: parseInt(countResult.rows[0].total),
      page: page,
      totalPages: Math.ceil(parseInt(countResult.rows[0].total) / limit),
      counts: {
        all: parseInt(stats.all_count),
        completed: parseInt(stats.completed_count),
        pending: parseInt(stats.pending_count),
        failed: parseInt(stats.failed_count),
      },
      totalVolume: parseFloat(stats.total_volume),
    });
  } catch (err) {
    console.error('Erreur liste transactions admin:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.get('/transactions/export/csv', async (req, res) => {
  var D = String.fromCharCode(36);
  try {
    var status = req.query.status || '';
    var search = req.query.search || '';
    var conditions = [];
    var params = [];
    if (status) {
      params.push(status);
      conditions.push('t.status = ' + D + params.length);
    }
    if (search) {
      params.push('%' + search + '%');
      var idx = params.length;
      conditions.push('(t.reference ILIKE ' + D + idx + ' OR e.name ILIKE ' + D + idx + ' OR p.studio_name ILIKE ' + D + idx + ')');
    }
    var whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    var selectSql = 'SELECT t.reference, t.created_at, p.studio_name, p.email as photographer_email, e.name as event_name, t.payment_method, t.phone, t.amount, t.status FROM transactions t LEFT JOIN events e ON e.id = t.event_id LEFT JOIN photographers p ON p.id = t.photographer_id ' + whereClause + ' ORDER BY t.created_at DESC';
    var result = await pool.query(selectSql, params);

    var statusLabels = { pending: 'En attente', completed: 'Completee', failed: 'Echouee' };
    var lines = ['Reference;Date;Photographe;Email;Evenement;Moyen;Telephone;Montant;Statut'];
    result.rows.forEach(function(t) {
      var row = [
        t.reference || '',
        new Date(t.created_at).toLocaleString('fr-FR'),
        t.studio_name || '',
        t.photographer_email || '',
        t.event_name || '',
        t.payment_method || '',
        t.phone || '',
        t.amount,
        statusLabels[t.status] || t.status,
      ];
      lines.push(row.join(';'));
    });
    var csv = lines.join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="fotokash-transactions.csv"');
    res.send('\uFEFF' + csv);
  } catch (err) {
    console.error('Erreur export transactions:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;

// GET /api/admin/events/expiring - Evenements proches de l'expiration
router.get('/events/expiring', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT e.id, e.name, e.created_at, e.slug, p.studio_name, p.plan,
        sp.event_retention_days,
        e.created_at + (sp.event_retention_days || ' days')::INTERVAL as expires_at,
        EXTRACT(DAY FROM (e.created_at + (sp.event_retention_days || ' days')::INTERVAL) - NOW()) as days_remaining
      FROM events e
      JOIN photographers p ON p.id = e.photographer_id
      JOIN subscription_plans sp ON sp.id = p.plan
      WHERE sp.event_retention_days IS NOT NULL
      ORDER BY days_remaining ASC
    `);
    res.json({ events: result.rows });
  } catch (err) {
    console.error("Erreur events expiring:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
});

// POST /api/admin/events/cleanup - Declencher le nettoyage manuellement
router.post('/events/cleanup', async (req, res) => {
  try {
    const { runEventCleanup } = require('../jobs/eventCleanup');
    const result = await runEventCleanup();
    res.json(result);
  } catch (err) {
    console.error("Erreur cleanup:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
});

// GET /api/admin/events/:eventId/photos - Voir toutes les photos d'un evenement (admin only)
router.get('/events/:eventId/photos', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, original_url, watermarked_url, thumbnail_url, qr_code_id, width, height, file_size, created_at FROM photos WHERE event_id = $1 ORDER BY created_at DESC',
      [req.params.eventId]
    );
    const event = await pool.query('SELECT name, slug FROM events WHERE id = $1', [req.params.eventId]);
    res.json({ photos: result.rows, event: event.rows[0] || null });
  } catch (err) {
    console.error("Erreur admin photos:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
});

// POST /api/admin/send-email - Envoyer un email a un photographe
router.post('/send-email', async (req, res) => {
  try {
    const { photographer_id, subject, message } = req.body;
    if (!photographer_id || !subject || !message) {
      return res.status(400).json({ error: "Photographe, sujet et message requis." });
    }
    const pResult = await pool.query('SELECT email, studio_name FROM photographers WHERE id = $1', [photographer_id]);
    if (pResult.rows.length === 0) return res.status(404).json({ error: "Photographe introuvable." });
    
    const photographer = pResult.rows[0];
    const { sendEmail, emailTemplate } = require('../config/mailer');
    const html = emailTemplate(
      subject,
      '<p>' + message.replace(/\n/g, '<br>') + '</p>',
      'Acceder a FotoKash',
      'https://fotokash.com'
    );
    const result = await sendEmail({ to: photographer.email, subject: 'FotoKash - ' + subject, html });
    
    if (result.success) {
      await pool.query(
        "INSERT INTO admin_logs (action, entity_type, entity_id, actor_id, actor_name, details) VALUES ($1, $2, $3, $4, $5, $6)",
        ['send_email', 'photographer', photographer_id, req.user.id, req.user.studio_name, JSON.stringify({ to: photographer.email, subject })]
      );
      res.json({ message: "Email envoye a " + photographer.email });
    } else {
      res.status(500).json({ error: "Erreur envoi: " + result.error });
    }
  } catch (err) {
    console.error("Erreur send-email:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
});

// PATCH /api/admin/photographers/:id/info - Modifier les infos du photographe
router.patch('/photographers/:id/info', async (req, res) => {
  try {
    const { id } = req.params;
    const { studio_name, email, phone } = req.body;
    
    if (!studio_name && !email && !phone) {
      return res.status(400).json({ error: "Aucune donnee a modifier." });
    }

    const result = await pool.query(
      'UPDATE photographers SET studio_name = COALESCE($1, studio_name), email = COALESCE($2, email), phone = COALESCE($3, phone), updated_at = NOW() WHERE id = $4 AND (role != $5 OR role IS NULL) RETURNING id, studio_name, email, phone',
      [studio_name || null, email || null, phone || null, id, 'admin']
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Photographe introuvable." });
    }

    await pool.query(
      "INSERT INTO admin_logs (action, entity_type, entity_id, actor_id, actor_name, details) VALUES ($1, $2, $3, $4, $5, $6)",
      ['update_info', 'photographer', id, req.user.id, req.user.studio_name, JSON.stringify({ studio_name, email, phone })]
    );

    res.json({ message: "Informations mises a jour.", photographer: result.rows[0] });
  } catch (err) {
    console.error("Erreur update info:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
});
