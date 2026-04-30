const express = require('express');
const { pool } = require('../config/database');
const { authMiddleware, ownsResource } = require('../middleware/auth');
const axios = require('axios');

const router = express.Router();

// POST /api/live/:id/start
router.post('/:id/start', authMiddleware, ownsResource('event'), async (req, res) => {
  try {
    const result = await pool.query(
      "UPDATE events SET is_live = true, live_started_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *",
      [req.params.id]
    );
    res.json({ event: result.rows[0], message: "Mode live active" });
  } catch (err) {
    console.error("Erreur start live:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
});

// POST /api/live/:id/stop
router.post('/:id/stop', authMiddleware, ownsResource('event'), async (req, res) => {
  try {
    const result = await pool.query(
      "UPDATE events SET is_live = false, updated_at = NOW() WHERE id = $1 RETURNING *",
      [req.params.id]
    );
    res.json({ event: result.rows[0], message: "Mode live desactive" });
  } catch (err) {
    console.error("Erreur stop live:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
});

// GET /api/live/:slug - Page live publique
router.get('/:slug', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT e.id, e.name, e.slug, e.date, e.is_live, e.live_started_at, e.cover_url, p.studio_name as photographer_name, p.phone as photographer_phone, p.plan as photographer_plan, COALESCE(sp.mobile_money_enabled, false) as mobile_money_enabled, COUNT(ph.id) as photos_count FROM events e JOIN photographers p ON p.id = e.photographer_id LEFT JOIN subscription_plans sp ON sp.id = p.plan LEFT JOIN photos ph ON ph.event_id = e.id AND ph.is_processed = true WHERE e.slug = $1 AND e.is_public = true GROUP BY e.id, p.studio_name, p.phone, p.plan, sp.mobile_money_enabled",
      [req.params.slug]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Evenement introuvable." });
    }
    res.json({ event: result.rows[0] });
  } catch (err) {
    console.error("Erreur live page:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
});

// POST /api/live/:slug/search - Recherche selfie live
router.post('/:slug/search', async (req, res) => {
  try {
    const { selfie } = req.body;
    if (!selfie) return res.status(400).json({ error: "Selfie requis." });

    const eventResult = await pool.query(
      "SELECT id, is_live FROM events WHERE slug = $1 AND is_public = true",
      [req.params.slug]
    );
    if (eventResult.rows.length === 0) return res.status(404).json({ error: "Evenement introuvable." });
    const event = eventResult.rows[0];

    let embedding;
    try {
      const imgBuffer = Buffer.from(selfie, "base64");
      const FormData = require("form-data");
      const formData = new FormData();
      formData.append("image", imgBuffer, { filename: "selfie.jpg" });
      const faceRes = await axios.post((process.env.FACE_AI_SERVICE_URL || "http://localhost:5000") + "/extract-embedding", formData, { headers: formData.getHeaders(), timeout: 10000 });
      embedding = faceRes.data.embedding;
    } catch (faceErr) {
      console.error("Erreur face-service:", faceErr.message);
      return res.status(400).json({ error: "Impossible de detecter un visage dans le selfie." });
    }
    if (!embedding) return res.status(400).json({ error: "Aucun visage detecte." });

    const thresholdResult = await pool.query("SELECT value FROM app_settings WHERE key = 'face_similarity_threshold'");
    const threshold = thresholdResult.rows.length > 0 ? parseFloat(thresholdResult.rows[0].value) : 0.3;

    const embeddingStr = "[" + embedding.join(",") + "]";
    const visitorCountResult = await pool.query("SELECT COUNT(*) as count FROM live_visitors WHERE event_id = $1", [event.id]);
    const visitorNumber = parseInt(visitorCountResult.rows[0].count) + 1;

    const visitorResult = await pool.query(
      "INSERT INTO live_visitors (event_id, selfie_embedding, visitor_number) VALUES ($1, $2, $3) RETURNING id, visitor_number",
      [event.id, embeddingStr, visitorNumber]
    );
    const visitor = visitorResult.rows[0];

    const matchResult = await pool.query(
      "SELECT p.id, p.thumbnail_url, p.watermarked_url, p.original_url, p.qr_code_id, 1 - (fe.embedding <=> $1) as similarity FROM face_embeddings fe JOIN photos p ON p.id = fe.photo_id WHERE fe.event_id = $2 AND 1 - (fe.embedding <=> $1) >= $3 ORDER BY similarity DESC",
      [embeddingStr, event.id, threshold]
    );

    for (const match of matchResult.rows) {
      await pool.query("INSERT INTO live_matches (visitor_id, photo_id, similarity) VALUES ($1, $2, $3) ON CONFLICT (visitor_id, photo_id) DO NOTHING", [visitor.id, match.id, match.similarity]);
    }
    await pool.query("UPDATE live_visitors SET matched_count = $1 WHERE id = $2", [matchResult.rows.length, visitor.id]);

    res.json({ visitor_id: visitor.id, visitor_number: visitor.visitor_number, matches: matchResult.rows, total: matchResult.rows.length });
  } catch (err) {
    console.error("Erreur live search:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
});

// POST /api/live/:slug/refresh - Polling nouvelles photos
router.post('/:slug/refresh', async (req, res) => {
  try {
    const { visitor_id } = req.body;
    if (!visitor_id) return res.status(400).json({ error: "visitor_id requis." });

    const visitorResult = await pool.query(
      "SELECT lv.id, lv.selfie_embedding, lv.event_id FROM live_visitors lv JOIN events e ON e.id = lv.event_id WHERE lv.id = $1 AND e.slug = $2",
      [visitor_id, req.params.slug]
    );
    if (visitorResult.rows.length === 0) return res.status(404).json({ error: "Visiteur introuvable." });

    const visitor = visitorResult.rows[0];
    const embeddingStr = visitor.selfie_embedding;

    const thresholdResult = await pool.query("SELECT value FROM app_settings WHERE key = 'face_similarity_threshold'");
    const threshold = thresholdResult.rows.length > 0 ? parseFloat(thresholdResult.rows[0].value) : 0.3;

    const matchResult = await pool.query(
      "SELECT p.id, p.thumbnail_url, p.watermarked_url, p.original_url, p.qr_code_id, 1 - (fe.embedding <=> $1) as similarity FROM face_embeddings fe JOIN photos p ON p.id = fe.photo_id WHERE fe.event_id = $2 AND 1 - (fe.embedding <=> $1) >= $3 ORDER BY similarity DESC",
      [embeddingStr, visitor.event_id, threshold]
    );

    for (const match of matchResult.rows) {
      await pool.query("INSERT INTO live_matches (visitor_id, photo_id, similarity) VALUES ($1, $2, $3) ON CONFLICT (visitor_id, photo_id) DO NOTHING", [visitor.id, match.id, match.similarity]);
    }
    await pool.query("UPDATE live_visitors SET matched_count = $1 WHERE id = $2", [matchResult.rows.length, visitor.id]);

    res.json({ matches: matchResult.rows, total: matchResult.rows.length });
  } catch (err) {
    console.error("Erreur live refresh:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
});

// GET /api/live/:id/dashboard - Stats live photographe
router.get('/:id/dashboard', authMiddleware, ownsResource('event'), async (req, res) => {
  try {
    const eventId = req.params.id;
    const stats = await pool.query(
      "SELECT (SELECT COUNT(*) FROM photos WHERE event_id = $1) as photos_count, (SELECT COUNT(*) FROM live_visitors WHERE event_id = $1) as visitors_count, (SELECT COUNT(*) FROM live_matches lm JOIN live_visitors lv ON lv.id = lm.visitor_id WHERE lv.event_id = $1) as matches_count, (SELECT COUNT(*) FROM transactions WHERE event_id = $1 AND status = 'completed') as purchases_count",
      [eventId]
    );
    const visitors = await pool.query(
      "SELECT id, visitor_number, matched_count, created_at FROM live_visitors WHERE event_id = $1 ORDER BY created_at DESC LIMIT 20",
      [eventId]
    );
    res.json({ stats: stats.rows[0], visitors: visitors.rows });
  } catch (err) {
    console.error("Erreur live dashboard:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
});

module.exports = router;
