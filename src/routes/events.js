const express = require('express');
const { pool } = require('../config/database');
const { authMiddleware, ownsResource } = require('../middleware/auth');

const router = express.Router();

// Générer un slug unique à partir du nom
function generateSlug(name) {
  const base = name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const suffix = Math.random().toString(36).substring(2, 6);
  return `${base}-${suffix}`;
}

// GET /api/events — Lister mes événements (photographe connecté)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT e.*,
              COUNT(DISTINCT p.id) as photos_count,
              COUNT(DISTINCT CASE WHEN d.id IS NOT NULL THEN p.id END) as photos_sold,
              COALESCE(SUM(CASE WHEN t.status = 'completed' THEN t.amount ELSE 0 END), 0) as revenue
       FROM events e
       LEFT JOIN photos p ON p.event_id = e.id
       LEFT JOIN transactions t ON t.event_id = e.id
       LEFT JOIN downloads d ON d.photo_id = p.id
       WHERE e.photographer_id = $1
       GROUP BY e.id
       ORDER BY e.created_at DESC`,
      [req.user.id]
    );

    res.json({ events: result.rows });
  } catch (err) {
    console.error('Erreur liste événements :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /api/events — Créer un événement
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name, date, description } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Le nom de l\'événement est requis.' });
    }

    const slug = generateSlug(name);

    const result = await pool.query(
      `INSERT INTO events (photographer_id, name, slug, date, description, status)
       VALUES ($1, $2, $3, $4, $5, 'live')
       RETURNING *`,
      [req.user.id, name, slug, date || null, description || null]
    );

    res.status(201).json({
      event: result.rows[0],
      share_url: `fotokash.com/e/${slug}`,
    });
  } catch (err) {
    console.error('Erreur création événement :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// GET /api/events/:slug/public — Page publique d'un événement (côté client)
router.get('/:slug/public', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT e.id, e.name, e.slug, e.date, e.cover_url, e.description,
              p.studio_name as photographer_name,
              COUNT(ph.id) as photos_count
       FROM events e
       JOIN photographers p ON p.id = e.photographer_id
       LEFT JOIN photos ph ON ph.event_id = e.id AND ph.is_processed = true
       WHERE e.slug = $1 AND e.is_public = true
       GROUP BY e.id, p.studio_name`,
      [req.params.slug]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Événement introuvable.' });
    }

    res.json({ event: result.rows[0] });
  } catch (err) {
    console.error('Erreur événement public :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// PUT /api/events/:id — Modifier un événement
router.put('/:id', authMiddleware, ownsResource('event'), async (req, res) => {
  try {
    const { name, date, description, status, is_public } = req.body;

    const result = await pool.query(
      `UPDATE events
       SET name = COALESCE($1, name),
           date = COALESCE($2, date),
           description = COALESCE($3, description),
           status = COALESCE($4, status),
           is_public = COALESCE($5, is_public),
           updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [name, date, description, status, is_public, req.params.id]
    );

    res.json({ event: result.rows[0] });
  } catch (err) {
    console.error('Erreur modification événement :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// DELETE /api/events/:id — Supprimer un événement
router.delete('/:id', authMiddleware, ownsResource('event'), async (req, res) => {
  try {
    await pool.query('DELETE FROM events WHERE id = $1', [req.params.id]);
    res.json({ message: 'Événement supprimé.' });
  } catch (err) {
    console.error('Erreur suppression :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// GET /api/events/:id/stats — Stats détaillées d'un événement
router.get('/:id/stats', authMiddleware, ownsResource('event'), async (req, res) => {
  try {
    const stats = await pool.query(
      `SELECT
        COUNT(DISTINCT p.id) as total_photos,
        COUNT(DISTINCT d.photo_id) as photos_sold,
        COUNT(DISTINCT fe.cluster_id) as unique_faces,
        COALESCE(SUM(CASE WHEN t.status = 'completed' THEN t.amount ELSE 0 END), 0) as revenue,
        COUNT(DISTINCT CASE WHEN t.status = 'completed' THEN t.id END) as transactions_count
       FROM events e
       LEFT JOIN photos p ON p.event_id = e.id
       LEFT JOIN face_embeddings fe ON fe.event_id = e.id
       LEFT JOIN transactions t ON t.event_id = e.id
       LEFT JOIN downloads d ON d.photo_id = p.id
       WHERE e.id = $1`,
      [req.params.id]
    );

    // Revenus par moyen de paiement
    const byMethod = await pool.query(
      `SELECT payment_method, SUM(amount) as total, COUNT(*) as count
       FROM transactions
       WHERE event_id = $1 AND status = 'completed'
       GROUP BY payment_method`,
      [req.params.id]
    );

    res.json({
      stats: stats.rows[0],
      revenue_by_method: byMethod.rows,
    });
  } catch (err) {
    console.error('Erreur stats :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
