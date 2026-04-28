const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const isAdmin = require('../middleware/isAdmin');
const { authMiddleware: auth } = require('../middleware/auth');

// Toutes les routes admin nécessitent auth + admin
router.use(auth);
router.use(isAdmin);

// GET /api/admin/dashboard/stats
router.get('/dashboard/stats', async (req, res) => {
  try {
    const { period = 'today' } = req.query;

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
      `SELECT COUNT(*) as active_events FROM events WHERE status = 'active'`
    );
    const newEventsResult = await pool.query(
      `SELECT COUNT(*) as new_events FROM events e WHERE 1=1 ${dateFilter.replace(/t\./g, 'e.')}`
    );

    const photographersResult = await pool.query(
      `SELECT COUNT(*) as total_photographers, COUNT(*) FILTER (WHERE status = 'active' OR status IS NULL) as active_photographers FROM photographers WHERE role != 'admin' OR role IS NULL`
    );
    const newPhotographersResult = await pool.query(
      `SELECT COUNT(*) as new_photographers FROM photographers p WHERE (role != 'admin' OR role IS NULL) ${dateFilter.replace(/t\./g, 'p.')}`
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

    const searchFilter = search
      ? `AND (LOWER(p.studio_name) LIKE LOWER('%${search.replace(/'/g, "''")}%') OR LOWER(p.email) LIKE LOWER('%${search.replace(/'/g, "''")}%'))`
      : '';

    const query = `
      SELECT 
        p.id, p.studio_name, p.email, p.phone, p.plan, p.photo_limit,
        p.role, p.status, p.created_at,
        COUNT(DISTINCT e.id) as total_events,
        COUNT(DISTINCT ph.id) as total_photos,
        COALESCE(SUM(CASE WHEN t.status = 'completed' THEN t.amount ELSE 0 END), 0) as total_revenue,
        MAX(p.created_at) as last_activity
      FROM photographers p
      LEFT JOIN events e ON e.photographer_id = p.id
      LEFT JOIN photos ph ON ph.photographer_id = p.id
      LEFT JOIN transactions t ON t.photographer_id = p.id
      WHERE (p.role != 'admin' OR p.role IS NULL) ${statusFilter} ${searchFilter}
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `;
    const result = await pool.query(query);

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
        COUNT(DISTINCT e.id) as total_events,
        COUNT(DISTINCT ph.id) as total_photos,
        COALESCE(SUM(CASE WHEN t.status = 'completed' THEN t.amount ELSE 0 END), 0) as total_revenue,
        COUNT(DISTINCT CASE WHEN t.status = 'completed' THEN t.id END) as total_sales
      FROM photographers p
      LEFT JOIN events e ON e.photographer_id = p.id
      LEFT JOIN photos ph ON ph.photographer_id = p.id
      LEFT JOIN transactions t ON t.photographer_id = p.id
      WHERE p.id = $1
      GROUP BY p.id
    `;
    const result = await pool.query(photographerQuery, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Photographe introuvable.' });
    }

    const eventsQuery = `
      SELECT id, name, slug, date, status, created_at,
        (SELECT COUNT(*) FROM photos WHERE event_id = e.id) as photo_count
      FROM events e
      WHERE photographer_id = $1
      ORDER BY created_at DESC
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
    const { name, price, commission_rate, photo_limit, event_limit, mobile_money_enabled } = req.body;

    const result = await pool.query(
      `UPDATE subscription_plans 
       SET name = COALESCE($1, name),
           price = COALESCE($2, price),
           commission_rate = COALESCE($3, commission_rate),
           photo_limit = COALESCE($4, photo_limit),
           event_limit = $5,
           mobile_money_enabled = COALESCE($6, mobile_money_enabled)
       WHERE id = $7
       RETURNING *`,
      [name, price, commission_rate, photo_limit, event_limit, mobile_money_enabled, id]
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
    switch (period) {
      case 'today': dateFilter = "AND DATE(t.created_at) = CURRENT_DATE"; break;
      case '7d': dateFilter = "AND t.created_at >= NOW() - INTERVAL '7 days'"; break;
      case '30d': dateFilter = "AND t.created_at >= NOW() - INTERVAL '30 days'"; break;
      default: dateFilter = "AND t.created_at >= NOW() - INTERVAL '30 days'";
    }

    const result = await pool.query(`
      SELECT 
        p.plan,
        sp.commission_rate,
        COUNT(t.id) as total_sales,
        COALESCE(SUM(t.amount), 0) as total_revenue,
        COALESCE(SUM(t.amount * sp.commission_rate / 100), 0) as total_commission,
        COALESCE(SUM(t.amount - (t.amount * sp.commission_rate / 100)), 0) as photographer_revenue
      FROM transactions t
      JOIN photographers p ON t.photographer_id = p.id
      JOIN subscription_plans sp ON p.plan = sp.id
      WHERE t.status = 'completed' ${dateFilter}
      GROUP BY p.plan, sp.commission_rate
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

    const planDistribution = await pool.query(`
      SELECT plan, COUNT(*) as count 
      FROM photographers 
      WHERE role != 'admin' OR role IS NULL
      GROUP BY plan
    `);

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
        revenue: parseFloat(totals.rows[0]?.total_revenue || 0),
        commission: parseFloat(totals.rows[0]?.total_commission || 0),
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
    const { action = '', page = 1, limit = 30 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let actionFilter = '';
    if (action) actionFilter = `WHERE action = '${action.replace(/'/g, "''")}'`;

    const countResult = await pool.query(`SELECT COUNT(*) as total FROM admin_logs ${actionFilter}`);
    const result = await pool.query(
      `SELECT * FROM admin_logs ${actionFilter} ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [parseInt(limit), offset]
    );

    const actions = await pool.query('SELECT DISTINCT action FROM admin_logs ORDER BY action');

    res.json({
      logs: result.rows,
      total: parseInt(countResult.rows[0].total),
      page: parseInt(page),
      totalPages: Math.ceil(parseInt(countResult.rows[0].total) / parseInt(limit)),
      actions: actions.rows.map(a => a.action),
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
  try {
    const { id } = req.params;

    // Vérifier que ce n'est pas un admin
    const check = await pool.query('SELECT id, role, studio_name FROM photographers WHERE id = $1', [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Photographe introuvable.' });
    }
    if (check.rows[0].role === 'admin') {
      return res.status(403).json({ error: 'Impossible de supprimer un compte admin.' });
    }

    const name = check.rows[0].studio_name;

    // Supprimer dans l'ordre pour respecter les foreign keys
    await pool.query('DELETE FROM downloads WHERE transaction_id IN (SELECT id FROM transactions WHERE photographer_id = $1)', [id]);
    await pool.query('DELETE FROM face_embeddings WHERE event_id IN (SELECT id FROM events WHERE photographer_id = $1)', [id]);
    await pool.query('DELETE FROM transactions WHERE photographer_id = $1', [id]);
    await pool.query('DELETE FROM photos WHERE photographer_id = $1', [id]);
    await pool.query('DELETE FROM events WHERE photographer_id = $1', [id]);
    await pool.query('DELETE FROM photographers WHERE id = $1', [id]);

    // Log
    await pool.query(
      `INSERT INTO admin_logs (action, entity_type, entity_id, actor_id, actor_name, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ['photographer_deleted', 'photographer', id, req.user.id, req.user.studio_name, JSON.stringify({ deleted_name: name })]
    );

    res.json({ message: `Photographe "${name}" supprimé avec tout son contenu.` });
  } catch (error) {
    console.error('Erreur suppression photographe:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;