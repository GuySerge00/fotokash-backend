const express = require('express');
const { pool } = require('../config/database');
const { authMiddleware, ownsResource } = require('../middleware/auth');

const archiver = require('archiver');
const https = require('https');
const http = require('http');
const router = express.Router();

// Générer un slug unique à partir du nom
function generateOwnerPin() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateOwnerPin() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

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
              COALESCE(SUM(CASE WHEN t.status = 'completed' THEN t.amount ELSE 0 END), 0) as revenue,
              sp.event_retention_days,
              CASE WHEN sp.event_retention_days IS NOT NULL
                THEN EXTRACT(DAY FROM (e.created_at + (sp.event_retention_days || ' days')::INTERVAL) - NOW())::int
                ELSE NULL
              END as days_remaining
       FROM events e
       LEFT JOIN photos p ON p.event_id = e.id
       LEFT JOIN transactions t ON t.event_id = e.id
       LEFT JOIN downloads d ON d.photo_id = p.id
       LEFT JOIN photographers ph ON ph.id = e.photographer_id
       LEFT JOIN subscription_plans sp ON sp.id = ph.plan
       WHERE e.photographer_id = $1 AND e.deleted_at IS NULL
       GROUP BY e.id, sp.event_retention_days
       ORDER BY e.created_at DESC`,
      [req.user.id]
    );

    res.json({ events: result.rows });
  } catch (err) {
    console.error('Erreur liste événements :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /api/events — Créer un événement (avec vérification limite du plan)
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name, date, description } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Le nom de l\'événement est requis.' });
    }

    // Vérifier la limite d'événements du plan
    const planCheck = await pool.query(
      'SELECT sp.event_limit FROM subscription_plans sp WHERE sp.id = $1',
      [req.user.plan || 'free']
    );
    const eventLimit = planCheck.rows[0]?.event_limit;

    if (eventLimit) {
      const currentCount = await pool.query(
        'SELECT COUNT(*) as count FROM events WHERE photographer_id = $1 AND deleted_at IS NULL',
        [req.user.id]
      );
      if (parseInt(currentCount.rows[0].count) >= eventLimit) {
        return res.status(403).json({
          error: `Limite atteinte : votre plan ${(req.user.plan || 'free').toUpperCase()} autorise ${eventLimit} événement(s). Passez à un plan supérieur.`
        });
      }
    }

    const slug = generateSlug(name);

    const result = await pool.query(
      `INSERT INTO events (photographer_id, name, slug, date, description, status, owner_pin)
       VALUES ($1, $2, $3, $4, $5, 'live', $6)
       RETURNING *`,
      [req.user.id, name, slug, date || null, description || null, generateOwnerPin()]
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
    // Verifier si evenement soft-deleted
    var checkDel = await pool.query(
      'SELECT e.id, e.name, e.deleted_at, p.studio_name as photographer_name, p.phone as photographer_phone FROM events e JOIN photographers p ON p.id = e.photographer_id WHERE e.slug = $1',
      [req.params.slug]
    );
    if (checkDel.rows.length > 0 && checkDel.rows[0].deleted_at) {
      return res.status(410).json({
        deleted: true,
        event_name: checkDel.rows[0].name,
        photographer_name: checkDel.rows[0].photographer_name,
        photographer_phone: checkDel.rows[0].photographer_phone,
      });
    }
    const result = await pool.query(
      `SELECT e.id, e.name, e.slug, e.date, e.cover_url, e.description,
              p.studio_name as photographer_name,
              p.phone as photographer_phone,
              p.plan as photographer_plan,
              COALESCE(sp.mobile_money_enabled, false) as mobile_money_enabled,
              COALESCE(sp.commission_rate, 0) as commission_rate,
              COUNT(ph.id) as photos_count
       FROM events e
       JOIN photographers p ON p.id = e.photographer_id
       LEFT JOIN subscription_plans sp ON sp.id = p.plan
       LEFT JOIN photos ph ON ph.event_id = e.id AND ph.is_processed = true
       WHERE e.slug = $1 AND e.is_public = true AND e.deleted_at IS NULL
       GROUP BY e.id, p.studio_name, p.phone, p.plan, sp.mobile_money_enabled, sp.commission_rate`,
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

// DELETE /api/events/:id — Soft delete d'un événement (garde les infos photographe)
router.delete('/:id', authMiddleware, ownsResource('event'), async (req, res) => {
  try {
    const eventId = req.params.id;
    // Soft delete : marquer comme supprime + nettoyer le contenu
    await pool.query('DELETE FROM live_matches WHERE visitor_id IN (SELECT id FROM live_visitors WHERE event_id = $1)', [eventId]);
    await pool.query('DELETE FROM live_visitors WHERE event_id = $1', [eventId]);
    await pool.query('DELETE FROM face_embeddings WHERE event_id = $1', [eventId]);
    // Downloads conservés pour l'historique des stats admin
    await pool.query('DELETE FROM transactions WHERE event_id = $1', [eventId]);
    await pool.query('DELETE FROM photos WHERE event_id = $1', [eventId]);
    // Marquer l'evenement comme supprime au lieu de le supprimer
    await pool.query("UPDATE events SET deleted_at = NOW(), is_public = false WHERE id = $1", [eventId]);
    res.json({ message: 'Événement et contenu supprimés.' });
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

// POST /api/events/:slug/verify-owner — Vérifier le code propriétaire
router.post('/:slug/verify-owner', async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin || pin.length !== 6) {
      return res.status(400).json({ error: 'Code PIN à 6 chiffres requis.' });
    }
    const eventResult = await pool.query(
      `SELECT e.id, e.name, e.slug, e.owner_pin
       FROM events e
       WHERE e.slug = $1 AND e.is_public = true AND e.deleted_at IS NULL`,
      [req.params.slug]
    );
    if (eventResult.rows.length === 0) {
      return res.status(404).json({ error: 'Événement introuvable.' });
    }
    const event = eventResult.rows[0];
    if (event.owner_pin !== pin) {
      return res.status(403).json({ error: 'Code incorrect.' });
    }
    // PIN correct — renvoyer toutes les photos HD
    const photosResult = await pool.query(
      `SELECT id, original_url, watermarked_url, thumbnail_url, qr_code_id
       FROM photos
       WHERE event_id = $1 AND is_processed = true
       ORDER BY created_at ASC`,
      [event.id]
    );
    // Enregistrer les téléchargements owner
    for (const photo of photosResult.rows) {
      await pool.query(
        `INSERT INTO downloads (photo_id, download_type)
         VALUES ($1, 'owner')
         ON CONFLICT DO NOTHING`,
        [photo.id]
      ).catch(() => {});
    }
    res.json({
      success: true,
      photos: photosResult.rows.map(p => ({
        id: p.id,
        original_url: p.original_url,
        thumbnail_url: p.thumbnail_url,
        qr_code_id: p.qr_code_id
      }))
    });
  } catch (err) {
    console.error('Erreur verify-owner:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /api/events/:slug/verify-owner — Vérifier le code propriétaire
router.post('/:slug/verify-owner', async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin || pin.length !== 6) {
      return res.status(400).json({ error: 'Code PIN à 6 chiffres requis.' });
    }
    const eventResult = await pool.query(
      `SELECT e.id, e.name, e.slug, e.owner_pin
       FROM events e
       WHERE e.slug = $1 AND e.is_public = true AND e.deleted_at IS NULL`,
      [req.params.slug]
    );
    if (eventResult.rows.length === 0) {
      return res.status(404).json({ error: 'Événement introuvable.' });
    }
    const event = eventResult.rows[0];
    if (event.owner_pin !== pin) {
      return res.status(403).json({ error: 'Code incorrect.' });
    }
    // PIN correct — renvoyer toutes les photos HD
    const photosResult = await pool.query(
      `SELECT id, original_url, watermarked_url, thumbnail_url, qr_code_id
       FROM photos
       WHERE event_id = $1 AND is_processed = true
       ORDER BY created_at ASC`,
      [event.id]
    );
    // Enregistrer les téléchargements owner
    for (const photo of photosResult.rows) {
      await pool.query(
        `INSERT INTO downloads (photo_id, download_type)
         VALUES ($1, 'owner')
         ON CONFLICT DO NOTHING`,
        [photo.id]
      ).catch(() => {});
    }
    res.json({
      success: true,
      photos: photosResult.rows.map(p => ({
        id: p.id,
        original_url: p.original_url,
        thumbnail_url: p.thumbnail_url,
        qr_code_id: p.qr_code_id
      }))
    });
  } catch (err) {
    console.error('Erreur verify-owner:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// GET /api/events/:slug/owner-download-zip — Télécharger toutes les photos en ZIP (mode propriétaire)
router.get('/:slug/owner-download-zip', async (req, res) => {
  try {
    const { pin } = req.query;
    if (!pin || pin.length !== 6) {
      return res.status(400).json({ error: 'Code PIN requis.' });
    }
    const eventResult = await pool.query(
      `SELECT e.id, e.name, e.slug, e.owner_pin
       FROM events e
       WHERE e.slug = $1 AND e.is_public = true AND e.deleted_at IS NULL`,
      [req.params.slug]
    );
    if (eventResult.rows.length === 0) {
      return res.status(404).json({ error: 'Événement introuvable.' });
    }
    const event = eventResult.rows[0];
    if (event.owner_pin !== pin) {
      return res.status(403).json({ error: 'Code incorrect.' });
    }
    const photosResult = await pool.query(
      `SELECT id, original_url, qr_code_id
       FROM photos
       WHERE event_id = $1 AND is_processed = true
       ORDER BY created_at ASC`,
      [event.id]
    );
    if (photosResult.rows.length === 0) {
      return res.status(404).json({ error: 'Aucune photo trouvée.' });
    }
    const photos = photosResult.rows;

    // Enregistrer les téléchargements owner
    for (const photo of photos) {
      await pool.query(
        `INSERT INTO downloads (photo_id, download_type)
         VALUES ($1, 'owner')
         ON CONFLICT DO NOTHING`,
        [photo.id]
      ).catch(() => {});
    }

    // Préparer le ZIP en streaming
    const slugClean = event.slug.replace(/[^a-z0-9-]/g, '');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="fotokash-' + slugClean + '.zip"');

    const archive = new archiver.ZipArchive({ zlib: { level: 5 } });
    archive.on('error', (err) => {
      console.error('Erreur ZIP:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Erreur création ZIP.' });
    });
    archive.pipe(res);

    // Ajouter chaque photo au ZIP
    let index = 1;
    for (const photo of photos) {
      const url = photo.original_url;
      if (!url) continue;
      const fileName = 'photo-' + String(index).padStart(3, '0') + '.jpg';
      try {
        const imageBuffer = await new Promise((resolve, reject) => {
          const client = url.startsWith('https') ? https : http;
          client.get(url, (imgRes) => {
            if (imgRes.statusCode === 301 || imgRes.statusCode === 302) {
              // Follow redirect
              client.get(imgRes.headers.location, (imgRes2) => {
                const chunks = [];
                imgRes2.on('data', (chunk) => chunks.push(chunk));
                imgRes2.on('end', () => resolve(Buffer.concat(chunks)));
                imgRes2.on('error', reject);
              }).on('error', reject);
              return;
            }
            const chunks = [];
            imgRes.on('data', (chunk) => chunks.push(chunk));
            imgRes.on('end', () => resolve(Buffer.concat(chunks)));
            imgRes.on('error', reject);
          }).on('error', reject);
        });
        archive.append(imageBuffer, { name: fileName });
        index++;
      } catch (err) {
        console.error('Erreur téléchargement photo ' + photo.id + ':', err.message);
      }
    }

    await archive.finalize();
  } catch (err) {
    console.error('Erreur owner-download-zip:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
