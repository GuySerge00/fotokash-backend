const express = require('express');
const { pool } = require('../config/database');
const { authMiddleware, ownsResource } = require('../middleware/auth');

const archiver = require('archiver');
const https = require('https');
const http = require('http');
const rateLimit = require('express-rate-limit');
const router = express.Router();

// GET /api/events/public — Annuaire public des événements actifs
router.get('/public', async (req, res) => {
  try {
    const { search } = req.query;
    const params = [];
    let where = "WHERE e.is_public = true AND e.deleted_at IS NULL AND e.status = 'live'";

    if (search && search.trim()) {
      params.push('%' + search.trim() + '%');
      where += " AND (e.name ILIKE $1 OR e.location ILIKE $1)";
    }

    const result = await pool.query(
      "SELECT e.id, e.name, e.slug, e.date, e.location, e.cover_url, " +
      "e.is_live, e.live_started_at, e.created_at, COUNT(p.id)::int AS photos_count " +
      "FROM events e LEFT JOIN photos p ON p.event_id = e.id " +
      where + " GROUP BY e.id " +
      "ORDER BY e.is_live DESC, e.live_started_at DESC NULLS LAST, e.created_at DESC LIMIT 100",
      params
    );
    res.json({ events: result.rows });
  } catch (err) {
    console.error('Erreur annuaire evenements public :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

const ownerPinLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 15, // 15 tentatives max par IP par heure
  message: { error: 'Trop de tentatives. Réessayez dans une heure.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Générer un slug unique à partir du nom
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
async function validatePricingOverride(mode, unitRaw) {
  if (mode === undefined || mode === null || mode === '') return { mode: null, unit: null };
  const { VALID_MODES, loadPricingSettings } = require('../services/pricing');
  if (VALID_MODES.indexOf(mode) === -1) {
    return { error: 'Mode de tarification invalide.' };
  }
  let unit = null;
  if (mode === 'fixed' || mode === 'degressive') {
    unit = parseInt(unitRaw, 10);
    if (!Number.isFinite(unit) || unit <= 0) {
      return { error: 'Prix unitaire invalide.' };
    }
    const cfg = await loadPricingSettings();
    if (unit < cfg.minBase) {
      return { error: 'Le prix unitaire minimum autorise est de ' + cfg.minBase + ' FCFA.' };
    }
  }
  return { mode, unit };
}

router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name, date, description, pricing_mode, unit_price } = req.body;
    const pricingCheck = await validatePricingOverride(pricing_mode, unit_price);
    if (pricingCheck.error) {
      return res.status(400).json({ error: pricingCheck.error });
    }

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
      `INSERT INTO events (photographer_id, name, slug, date, description, status, owner_pin, pricing_mode, unit_price)
       VALUES ($1, $2, $3, $4, $5, 'live', $6, $7, $8)
       RETURNING *`,
      [req.user.id, name, slug, date || null, description || null, generateOwnerPin(), pricingCheck.mode, pricingCheck.unit]
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
    const { name, date, description, status, is_public, pricing_mode, unit_price, clear_pricing_override } = req.body;

    const pricingCheck = await validatePricingOverride(pricing_mode, unit_price);
    if (pricingCheck.error) {
      return res.status(400).json({ error: pricingCheck.error });
    }

    let result;
    if (clear_pricing_override) {
      result = await pool.query(
        `UPDATE events
         SET name = COALESCE($1, name),
             date = COALESCE($2, date),
             description = COALESCE($3, description),
             status = COALESCE($4, status),
             is_public = COALESCE($5, is_public),
             pricing_mode = NULL,
             unit_price = NULL,
             updated_at = NOW()
         WHERE id = $6
         RETURNING *`,
        [name, date, description, status, is_public, req.params.id]
      );
    } else {
      result = await pool.query(
        `UPDATE events
         SET name = COALESCE($1, name),
             date = COALESCE($2, date),
             description = COALESCE($3, description),
             status = COALESCE($4, status),
             is_public = COALESCE($5, is_public),
             pricing_mode = COALESCE($6, pricing_mode),
             unit_price = CASE WHEN $6 IS NOT NULL THEN $7 ELSE unit_price END,
             updated_at = NOW()
         WHERE id = $8
         RETURNING *`,
        [name, date, description, status, is_public, pricingCheck.mode, pricingCheck.unit, req.params.id]
      );
    }

    res.json({ event: result.rows[0] });
  } catch (err) {
    console.error('Erreur modification événement :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// DELETE /api/events/:id — Soft delete d'un événement (garde les infos photographe)
router.delete('/:id', authMiddleware, ownsResource('event'), async (req, res) => {
  const client = await pool.connect();
  try {
    const eventId = req.params.id;
    await client.query('BEGIN');

    await client.query('DELETE FROM live_matches WHERE visitor_id IN (SELECT id FROM live_visitors WHERE event_id = $1)', [eventId]);
    await client.query('DELETE FROM live_visitors WHERE event_id = $1', [eventId]);
    await client.query('DELETE FROM face_embeddings WHERE event_id = $1', [eventId]);

    // transactions et downloads conservés pour toujours (historique stats admin + photographe)
    // photos en soft-delete (pas de suppression physique en base, respecte la FK downloads_photo_id_fkey)
    const photosToPurge = await client.query('SELECT id FROM photos WHERE event_id = $1 AND deleted_at IS NULL', [eventId]);
    await client.query('UPDATE photos SET deleted_at = NOW() WHERE event_id = $1', [eventId]);

    await client.query("UPDATE events SET deleted_at = NOW(), is_public = false WHERE id = $1", [eventId]);

    await client.query('COMMIT');
    res.json({ message: 'Événement et contenu supprimés.' });

    const { purgeCloudinaryForPhotos } = require('../utils/cloudinaryCleanup');
    const photoIdsToPurge = photosToPurge.rows.map(r => r.id);
    purgeCloudinaryForPhotos(photoIdsToPurge).catch(err => {
      console.error('[CLOUDINARY-PURGE] Erreur non bloquante:', err.message);
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur suppression :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  } finally {
    client.release();
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
router.post('/:slug/verify-owner', ownerPinLimiter, async (req, res) => {
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
       WHERE event_id = $1 AND is_processed = true AND deleted_at IS NULL
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
router.get('/:slug/owner-download-zip', ownerPinLimiter, async (req, res) => {
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
       WHERE event_id = $1 AND is_processed = true AND deleted_at IS NULL
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


// PATCH /api/events/:id/cover — Definir une photo comme couverture de l'evenement
router.patch('/:id/cover', authMiddleware, ownsResource('event'), async (req, res) => {
  try {
    const { photo_url } = req.body;
    if (!photo_url) return res.status(400).json({ error: 'photo_url requis.' });
    await pool.query(
      'UPDATE events SET cover_url = $1, updated_at = NOW() WHERE id = $2',
      [photo_url, req.params.id]
    );
    res.json({ success: true, cover_url: photo_url });
  } catch (err) {
    console.error('Erreur cover patch:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
