const express = require('express');
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const router = express.Router();

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

// GET /api/earnings/history — Historique des ventes
router.get('/history', authMiddleware, async (req, res) => {
  try {
    var userId = req.user.id;
    var limit = parseInt(req.query.limit) || 20;
    var offset = parseInt(req.query.offset) || 0;

    var plan = req.user.plan || 'free';
    var planRes = await pool.query('SELECT commission_rate FROM subscription_plans WHERE id = $1', [plan]);
    var commissionRate = planRes.rows[0] ? parseFloat(planRes.rows[0].commission_rate) : 0;

    var result = await pool.query(
      `SELECT t.id, t.amount, t.payment_method, t.status, t.created_at, t.phone,
              e.name as event_name, e.slug as event_slug,
              array_length(t.photos_purchased, 1) as photos_count
       FROM transactions t
       LEFT JOIN events e ON e.id = t.event_id
       WHERE t.photographer_id = $1
       ORDER BY t.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    var countRes = await pool.query(
      "SELECT COUNT(*) as total FROM transactions WHERE photographer_id = $1",
      [userId]
    );

    // Revenus par événement
    var byEvent = await pool.query(
      `SELECT e.name, e.slug, COUNT(t.id) as sales, COALESCE(SUM(t.amount), 0) as revenue
       FROM transactions t
       JOIN events e ON e.id = t.event_id
       WHERE t.photographer_id = $1 AND t.status = 'completed'
       GROUP BY e.id, e.name, e.slug
       ORDER BY revenue DESC
       LIMIT 10`,
      [userId]
    );

    // Revenus par mois (6 derniers mois)
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
      by_month: byMonth.rows
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

module.exports = router;
