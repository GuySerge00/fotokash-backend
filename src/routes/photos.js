const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const QRCode = require('qrcode');
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const cloudinary = require('../config/cloudinary');
const faceQueue = require('../jobs/faceProcessing');
const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Seules les images sont acceptees.'));
  },
});
function generateQRCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}
function uploadToCloudinary(buffer, options) {
  var b64 = 'data:image/jpeg;base64,' + buffer.toString('base64');
  return cloudinary.uploader.upload(b64, options);
}
router.post('/upload', authMiddleware, upload.array('photos', 50), async (req, res) => {
  try {
    var event_id = req.body.event_id;
    if (!event_id) return res.status(400).json({ error: 'ID evenement requis.' });
    var eventCheck = await pool.query('SELECT id FROM events WHERE id = $1 AND photographer_id = $2', [event_id, req.user.id]);
    if (eventCheck.rows.length === 0) return res.status(403).json({ error: 'Evenement introuvable.' });

    // Vérifier la limite de photos du plan
    var planCheck = await pool.query('SELECT sp.photo_limit FROM subscription_plans sp WHERE sp.id = $1', [req.user.plan || 'free']);
    var photoLimit = planCheck.rows[0] ? planCheck.rows[0].photo_limit : 100;
    var currentPhotos = await pool.query('SELECT COUNT(*) as count FROM photos WHERE event_id = $1', [event_id]);
    var currentCount = parseInt(currentPhotos.rows[0].count);
    var newCount = req.files.length;
    if (currentCount + newCount > photoLimit) {
      return res.status(403).json({
        error: 'Limite atteinte : votre plan ' + (req.user.plan || 'free').toUpperCase() + ' autorise ' + photoLimit + ' photos par événement. Vous en avez déjà ' + currentCount + '.'
      });
    }
    var uploadedPhotos = [];
    for (var i = 0; i < req.files.length; i++) {
      var file = req.files[i];
      var qr_code_id = generateQRCode();
      // Compresser l'original pour Cloudinary (max 10Mo)
      var originalBuffer = file.buffer;
      if (file.size > 9 * 1024 * 1024) {
        originalBuffer = await sharp(file.buffer).resize(3000, 3000, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
      }
      var webBuffer = await sharp(file.buffer).resize(1920, 1920, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
      var thumbBuffer = await sharp(file.buffer).resize(400, 400, { fit: 'cover' }).jpeg({ quality: 75 }).toBuffer();
      var wmResult = await pool.query("SELECT value FROM app_settings WHERE key = 'watermark_text'");
      var wmText = wmResult.rows[0] ? wmResult.rows[0].value : 'FOTOKASH';
      var webMeta = await sharp(webBuffer).metadata(); var svgW = webMeta.width; var svgH = webMeta.height; var svgWatermark = '<svg width="' + svgW + '" height="' + svgH + '"><text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" font-size="' + Math.max(Math.floor(svgW / 16), 20) + '" font-weight="bold" fill="rgba(255,255,255,0.4)" transform="rotate(-25, ' + Math.floor(svgW/2) + ', ' + Math.floor(svgH/2) + ')">' + wmText + '</text></svg>';

      var watermarkedBuffer = await sharp(webBuffer).composite([{ input: Buffer.from(svgWatermark), gravity: 'center' }]).toBuffer();
      var results = await Promise.all([
        uploadToCloudinary(originalBuffer, { folder: 'fotokash/' + event_id + '/originals', resource_type: 'image' }),
        uploadToCloudinary(watermarkedBuffer, { folder: 'fotokash/' + event_id + '/watermarked', resource_type: 'image' }),
        uploadToCloudinary(thumbBuffer, { folder: 'fotokash/' + event_id + '/thumbnails', resource_type: 'image' }),
      ]);
      var qrCodeDataUrl = await QRCode.toDataURL('https://fotokash.com/p/' + qr_code_id, { width: 300, margin: 2, color: { dark: '#E8593C', light: '#FFFFFF' } });
      var metadata = await sharp(file.buffer).metadata();
      var row = await pool.query(
        'INSERT INTO photos (event_id, photographer_id, original_url, watermarked_url, thumbnail_url, qr_code_id, qr_code_url, width, height, file_size) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, qr_code_id, watermarked_url, thumbnail_url, created_at',
        [event_id, req.user.id, results[0].secure_url, results[1].secure_url, results[2].secure_url, qr_code_id, qrCodeDataUrl, metadata.width, metadata.height, file.size]
      );
      uploadedPhotos.push(row.rows[0]);
// Ajouter le job de traitement facial
      faceQueue.add({ photoId: row.rows[0].id, eventId: event_id, imageUrl: results[0].secure_url });
    }
    res.status(201).json({ message: uploadedPhotos.length + ' photo(s) uploadee(s).', photos: uploadedPhotos });
  } catch (err) {
    console.error('Erreur upload :', err);
    res.status(500).json({ error: 'Erreur upload.' });
  }
});
router.get('/event/:eventId/public', async (req, res) => {
  try {
    var planCheck = await pool.query(
      `SELECT sp.mobile_money_enabled FROM events e 
       JOIN photographers p ON p.id = e.photographer_id 
       LEFT JOIN subscription_plans sp ON sp.id = p.plan 
       WHERE e.id = $1`, [req.params.eventId]
    );
    var isFree = !planCheck.rows[0]?.mobile_money_enabled;
    var fields = isFree
      ? 'id, original_url, watermarked_url, thumbnail_url, qr_code_id, faces_count, created_at'
      : 'id, watermarked_url, thumbnail_url, qr_code_id, faces_count, created_at';
    var result = await pool.query('SELECT ' + fields + ' FROM photos WHERE event_id = $1 ORDER BY created_at DESC', [req.params.eventId]);
    res.json({ photos: result.rows });
  } catch (err) { res.status(500).json({ error: 'Erreur serveur.' }); }
});router.get('/qr/:code', async (req, res) => {
  try {
    var result = await pool.query('SELECT p.id, p.original_url, p.watermarked_url, p.thumbnail_url, p.qr_code_id, e.name as event_name, e.slug as event_slug FROM photos p JOIN events e ON e.id = p.event_id WHERE p.qr_code_id = $1', [req.params.code]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Photo introuvable.' });
    res.json({ photo: result.rows[0] });
  } catch (err) { res.status(500).json({ error: 'Erreur serveur.' }); }
});
router.post('/face-search', upload.single('selfie'), async (req, res) => {
  try {
    console.log('Face search request received, event_id:', req.body.event_id, 'file:', req.file ? req.file.size : 'none');
    var event_id = req.body.event_id;
    if (!req.file || !event_id) return res.status(400).json({ error: 'Selfie et ID evenement requis.' });
    var axios = require('axios');
    var FormData = require('form-data');
    var formData = new FormData();
    formData.append('image', req.file.buffer, { filename: 'selfie.jpg' });
    var aiResponse = await axios.post(process.env.FACE_AI_SERVICE_URL + '/extract-embedding', formData, { headers: formData.getHeaders(), timeout: 10000 });
    var selfieEmbedding = aiResponse.data.embedding;
    console.log('Face AI response:', selfieEmbedding ? 'embedding OK (' + selfieEmbedding.length + 'd)' : 'NO EMBEDDING');
    if (!selfieEmbedding) return res.status(400).json({ error: 'Aucun visage detecte.' });
    var embeddingStr = '[' + selfieEmbedding.join(',') + ']';
    var planCheck = await pool.query(
      'SELECT sp.mobile_money_enabled FROM events e JOIN photographers p ON p.id = e.photographer_id LEFT JOIN subscription_plans sp ON sp.id = p.plan WHERE e.id = $1', [event_id]
    );
    var isFree = !planCheck.rows[0] || !planCheck.rows[0].mobile_money_enabled;
    var photoFields = isFree
      ? 'p.id, p.original_url, p.watermarked_url, p.thumbnail_url, p.qr_code_id'
      : 'p.id, p.watermarked_url, p.thumbnail_url, p.qr_code_id';
    var thresholdRes = await pool.query("SELECT value FROM app_settings WHERE key = 'face_search_threshold'");
    var faceThreshold = thresholdRes.rows[0] ? parseFloat(thresholdRes.rows[0].value) : 0.6;
    console.log('Face search threshold:', faceThreshold);
    var result = await pool.query('SELECT DISTINCT ' + photoFields + ', 1 - (fe.embedding <=> $1::vector) as similarity FROM face_embeddings fe JOIN photos p ON p.id = fe.photo_id WHERE fe.event_id = $2 AND 1 - (fe.embedding <=> $1::vector) > ' + faceThreshold + ' ORDER BY similarity DESC LIMIT 50', [embeddingStr, event_id]);
    console.log('Face search results:', result.rows.length, 'matches found');
    res.json({ matched_photos: result.rows, count: result.rows.length });
  } catch (err) { console.error('Face search error:', err.message); res.status(500).json({ error: 'Erreur recherche.' }); }
});
router.get('/:id/download', async (req, res) => {
  try {
    var transaction_id = req.query.transaction_id;
    if (!transaction_id) return res.status(400).json({ error: 'ID transaction requis.' });
    var txCheck = await pool.query('SELECT id FROM transactions WHERE id = $1 AND status = $2 AND $3 = ANY(photos_purchased)', [transaction_id, 'completed', req.params.id]);
    if (txCheck.rows.length === 0) return res.status(403).json({ error: 'Paiement non verifie.' });
    var photo = await pool.query('SELECT original_url FROM photos WHERE id = $1', [req.params.id]);
    if (photo.rows.length === 0) return res.status(404).json({ error: 'Photo introuvable.' });
    await pool.query('INSERT INTO downloads (transaction_id, photo_id, ip_address) VALUES ($1, $2, $3)', [transaction_id, req.params.id, req.ip]);
    res.json({ download_url: photo.rows[0].original_url });
  } catch (err) { res.status(500).json({ error: 'Erreur serveur.' }); }
});

// GET /api/photos/pricing — Tarifs dynamiques depuis app_settings
router.get('/pricing', async (req, res) => {
  try {
    var result = await pool.query(
      "SELECT key, value FROM app_settings WHERE key IN ('photo_price_1', 'photo_price_6', 'photo_price_10', 'watermark_text')"
    );
    var pricing = {};
    result.rows.forEach(function(r) { pricing[r.key] = r.value; });
    res.json({
      price1: parseInt(pricing.photo_price_1) || 200,
      price6: parseInt(pricing.photo_price_6) || 500,
      price10: parseInt(pricing.photo_price_10) || 1000,
      watermarkText: pricing.watermark_text || 'FOTOKASH',
    });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /api/photos/free-download — Enregistrer un téléchargement gratuit
router.post('/free-download', async (req, res) => {
  try {
    var photoIds = req.body.photo_ids;
    if (!photoIds || !Array.isArray(photoIds) || photoIds.length === 0) {
      return res.status(400).json({ error: 'IDs photos requis.' });
    }

    for (var i = 0; i < photoIds.length; i++) {
      var photo = await pool.query('SELECT id, original_url FROM photos WHERE id = $1', [photoIds[i]]);
      if (photo.rows.length > 0) {
        await pool.query(
          'INSERT INTO downloads (transaction_id, photo_id, ip_address) VALUES ($1, $2, $3)',
          [null, photoIds[i], req.ip]
        );
      }
    }

    // Récupérer les URLs originales
    var result = await pool.query(
      'SELECT id, original_url FROM photos WHERE id = ANY($1)',
      [photoIds]
    );

    res.json({
      message: photoIds.length + ' téléchargement(s) enregistré(s).',
      photos: result.rows
    });
  } catch (err) {
    console.error('Erreur free download:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});


// DELETE /api/photos/:id - Supprimer une photo
router.delete('/:id', async (req, res) => {
  try {
    var photoId = req.params.id;
    // Supprimer les face_embeddings liees
    await pool.query('DELETE FROM face_embeddings WHERE photo_id = $1', [photoId]);
    // Supprimer les downloads lies
    await pool.query('DELETE FROM downloads WHERE photo_id = $1', [photoId]);
    // Supprimer la photo
    var result = await pool.query('DELETE FROM photos WHERE id = $1 RETURNING id', [photoId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Photo introuvable.' });
    }
    res.json({ message: 'Photo supprimee.' });
  } catch (err) {
    console.error('Erreur suppression photo:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});


// GET /api/photos/platform - Infos publiques de la plateforme
router.get('/platform', async (req, res) => {
  try {
    var result = await pool.query(
      "SELECT key, value FROM app_settings WHERE key IN ('platform_name', 'platform_email', 'maintenance_mode')"
    );
    var settings = {};
    result.rows.forEach(function(r) { settings[r.key] = r.value; });
    res.json({
      name: settings.platform_name || 'FotoKash',
      email: settings.platform_email || 'contact@fotokash.com',
      maintenance: settings.maintenance_mode === 'true',
    });
  } catch (err) {
    res.json({ name: 'FotoKash', email: 'contact@fotokash.com', maintenance: false });
  }
});

module.exports = router;
