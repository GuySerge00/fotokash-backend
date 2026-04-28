// routes/admin.js
// Routes API pour le Panel Admin FotoKash

const express = require('express');
const router = express.Router();
const pool = require('../config/db'); // ton pool PostgreSQL existant
const isAdmin = require('../middleware/isAdmin');
const auth = require('../middleware/auth'); // ton middleware auth existant

// Toutes les routes admin nécessitent auth + admin
router.use(auth);
router.use(isAdmin);

// ============================================
// GET /api/admin/dashboard/stats
// Retourne les 4 KPIs principaux
// Query params: period = today | 7d | 30d | custom&start=...&end=...
// ============================================
router.get('/dashboard/stats', async (req, res) => {
  try {
    const { period = 'today', start, end } = req.query;

    // Construire le filtre date selon la période
    let dateFilter = '';
    let dateParams = [];

    switch (period) {
      case 'today':
        dateFilter = "AND DATE(p.created_at) = CURRENT_DATE";
        break;
      case '7d':
        dateFilter = "AND p.created_at >= NOW() - INTERVAL '7 days'";
        break;
      case '30d':
        dateFilter = "AND p.created_at >= NOW() - INTERVAL '30 days'";
        break;
      case 'custom':
        if (start && end) {
          dateFilter = "AND p.created_at BETWEEN $1 AND $2";
          dateParams = [start, end];
        }
        break;
      default:
        dateFilter = "AND DATE(p.created_at) = CURRENT_DATE";
    }

    // 1. Revenus totaux
    const revenueQuery = `
      SELECT COALESCE(SUM(amount), 0) as total_revenue
      FROM purchases p
      WHERE status = 'completed' ${dateFilter}
    `;
    const revenueResult = await pool.query(revenueQuery, dateParams);

    // Revenus de la période précédente (pour le % de variation)
    let prevDateFilter = '';
    let prevDateParams = [];
    switch (period) {
      case 'today':
        prevDateFilter = "AND DATE(p.created_at) = CURRENT_DATE - INTERVAL '1 day'";
        break;
      case '7d':
        prevDateFilter = "AND p.created_at BETWEEN NOW() - INTERVAL '14 days' AND NOW() - INTERVAL '7 days'";
        break;
      case '30d':
        prevDateFilter = "AND p.created_at BETWEEN NOW() - INTERVAL '60 days' AND NOW() - INTERVAL '30 days'";
        break;
      default:
        prevDateFilter = "AND DATE(p.created_at) = CURRENT_DATE - INTERVAL '1 day'";
    }

    const prevRevenueQuery = `
      SELECT COALESCE(SUM(amount), 0) as prev_revenue
      FROM purchases p
      WHERE status = 'completed' ${prevDateFilter}
    `;
    const prevRevenueResult = await pool.query(prevRevenueQuery, prevDateParams);

    // 2. Photos vendues
    const photosQuery = `
      SELECT COUNT(*) as total_photos
      FROM purchase_items pi
      JOIN purchases p ON pi.purchase_id = p.id
      WHERE p.status = 'completed' ${dateFilter}
    `;
    const photosResult = await pool.query(photosQuery, dateParams);

    const prevPhotosQuery = `
      SELECT COUNT(*) as prev_photos
      FROM purchase_items pi
      JOIN purchases p ON pi.purchase_id = p.id
      WHERE p.status = 'completed' ${prevDateFilter}
    `;
    const prevPhotosResult = await pool.query(prevPhotosQuery, prevDateParams);

    // 3. Événements actifs
    const eventsQuery = `
      SELECT COUNT(*) as active_events
      FROM events
      WHERE status = 'active'
    `;
    const eventsResult = await pool.query(eventsQuery);

    // Nouveaux événements dans la période
    const newEventsQuery = `
      SELECT COUNT(*) as new_events
      FROM events e
      WHERE 1=1 ${dateFilter.replace(/p\./g, 'e.')}
    `;
    const newEventsResult = await pool.query(newEventsQuery, dateParams);

    // 4. Photographes
    const photographersQuery = `
      SELECT 
        COUNT(*) as total_photographers,
        COUNT(*) FILTER (WHERE status = 'active') as active_photographers
      FROM users
      WHERE role = 'photographer'
    `;
    const photographersResult = await pool.query(photographersQuery);

    // Nouveaux photographes dans la période
    const newPhotographersQuery = `
      SELECT COUNT(*) as new_photographers
      FROM users u
      WHERE role = 'photographer' ${dateFilter.replace(/p\./g, 'u.')}
    `;
    const newPhotographersResult = await pool.query(newPhotographersQuery, dateParams);

    // Calculer les variations en %
    const currentRevenue = parseFloat(revenueResult.rows[0].total_revenue);
    const prevRevenue = parseFloat(prevRevenueResult.rows[0].prev_revenue);
    const revenueChange = prevRevenue > 0
      ? Math.round(((currentRevenue - prevRevenue) / prevRevenue) * 100)
      : currentRevenue > 0 ? 100 : 0;

    const currentPhotos = parseInt(photosResult.rows[0].total_photos);
    const prevPhotos = parseInt(prevPhotosResult.rows[0].prev_photos);
    const photosChange = prevPhotos > 0
      ? Math.round(((currentPhotos - prevPhotos) / prevPhotos) * 100)
      : currentPhotos > 0 ? 100 : 0;

    res.json({
      revenue: {
        total: currentRevenue,
        change: revenueChange,
        currency: 'F CFA'
      },
      photos: {
        total: currentPhotos,
        change: photosChange
      },
      events: {
        active: parseInt(eventsResult.rows[0].active_events),
        new: parseInt(newEventsResult.rows[0].new_events)
      },
      photographers: {
        total: parseInt(photographersResult.rows[0].total_photographers),
        active: parseInt(photographersResult.rows[0].active_photographers),
        new: parseInt(newPhotographersResult.rows[0].new_photographers)
      }
    });

  } catch (error) {
    console.error('Erreur dashboard stats:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// GET /api/admin/dashboard/revenue-chart
// Données pour le graphe des revenus (7 derniers jours)
// ============================================
router.get('/dashboard/revenue-chart', async (req, res) => {
  try {
    const { days = 7 } = req.query;

    const query = `
      SELECT 
        DATE(created_at) as date,
        COALESCE(SUM(amount), 0) as revenue
      FROM purchases
      WHERE status = 'completed'
        AND created_at >= NOW() - INTERVAL '${parseInt(days)} days'
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `;
    const result = await pool.query(query);

    // Remplir les jours manquants avec 0
    const chartData = [];
    const today = new Date();
    for (let i = parseInt(days) - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const dayNames = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

      const found = result.rows.find(r => r.date.toISOString().split('T')[0] === dateStr);
      chartData.push({
        date: dateStr,
        day: dayNames[date.getDay()],
        revenue: found ? parseFloat(found.revenue) : 0
      });
    }

    res.json({ chartData });

  } catch (error) {
    console.error('Erreur revenue chart:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// GET /api/admin/dashboard/recent-sales
// Dernières ventes (5 plus récentes)
// ============================================
router.get('/dashboard/recent-sales', async (req, res) => {
  try {
    const query = `
      SELECT 
        p.id,
        p.amount,
        p.created_at,
        e.name as event_name,
        COUNT(pi.id) as photo_count
      FROM purchases p
      JOIN events e ON p.event_id = e.id
      LEFT JOIN purchase_items pi ON pi.purchase_id = p.id
      WHERE p.status = 'completed'
      GROUP BY p.id, p.amount, p.created_at, e.name
      ORDER BY p.created_at DESC
      LIMIT 5
    `;
    const result = await pool.query(query);

    res.json({
      sales: result.rows.map(row => ({
        id: row.id,
        eventName: row.event_name,
        photoCount: parseInt(row.photo_count),
        amount: parseFloat(row.amount),
        date: row.created_at
      }))
    });

  } catch (error) {
    console.error('Erreur recent sales:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
