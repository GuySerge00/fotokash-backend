const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const cloudinary = require('../config/cloudinary');

const router = express.Router();

// Config multer pour upload temporaire en mémoire
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 Mo max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Seules les images sont acceptées.'));
  },
});

// Générer un code QR court unique
function generateQRCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// POST /api/photos/upload — Upload de photos (photographe connecté)
router.post('/upload', authMiddleware, upload.array('photos', 50), async (req, res) => {
  try {
    const { event_id } = req.body;

    if (!event_id) {
      return res.status(400).json({ error: 'ID de l\'événement requis.' });
    }

    // Vérifier que l'événement appartient au photographe
    const eventCheck = await pool.query(
      'SELECT id FROM events WHERE id = $1 AND photographer_id = $2',
      [event_id, req.user.id]
    );
    if (eventCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Événement introuvable.' });
    }

    const uploadedPhotos = [];

    for (const file of req.files) {
      const qr_code_id = generateQRCode();

      // Redimensionner pour le web (garder l'original aussi)
      const webBuffer = await sharp(file.buffer)
        .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();

      // Créer le thumbnail
      const thumbBuffer = await sharp(file.buffer)
        .resize(400, 400, { fit: 'cover' })
        .jpeg({ quality: 75 })
        .toBuffer();

      // Ajouter le filigrane sur la version aperçu
      const watermarkedBuffer = await sharp(webBuffer)
        .composite([{
          input: Buffer.from(
            `<svg width="400" height="100">
              <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"
                    font-size="48" font-weight="bold" fill="rgba(255,255,255,0.4)"
                    transform="rotate(-30, 200, 50)">FotoKash</text>
            </svg>`
          ),
          gravity: 'center',
        }])
        .toBuffer();

      // Upload vers Cloudinary : original (privé) + watermarked (public) + thumbnail
      const [originalUpload, watermarkUpload, thumbUpload] = await Promise.all([
        cloudinary.uploader.upload_stream({ folder: `fotokash/${event_id}/originals`, resource_type: 'image' }, file.buffer),
        cloudinary.uploader.upload_stream({ folder: `fotokash/${event_id}/watermarked`, resource_type: 'image' }, watermarkedBuffer),
        cloudinary.uploader.upload_stream({ folder: `fotokash/${event_id}/thumbnails`, resource_type: 'image' }, thumbBuffer),
      ].map(uploadPromise => uploadPromise));

      // Générer le QR code
      const qrCodeDataUrl = await QRCode.toDataURL(`https://fotokash.com/p/${qr_code_id}`, {
        width: 300,
        margin: 2,
        color: { dark: '#E8593C', light: '#FFFFFF' },
      });

      // Extraire les métadonnées
      const metadata = await sharp(file.buffer).metadata();

      // Insérer en base de données
      const result = await pool.query(
        `INSERT INTO photos (event_id, photographer_id, original_url, watermarked_url, thumbnail_url, qr_code_id, qr_code_url, width, height, file_size)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, qr_code_id, watermarked_url, thumbnail_url, created_at`,
        [event_id, req.user.id,
         originalUpload?.secure_url || 'pending',
         watermarkUpload?.secure_url || 'pending',
         thumbUpload?.secure_url || 'pending',
         qr_code_id, qrCodeDataUrl,
         metadata.width, metadata.height, file.size]
      );

      uploadedPhotos.push(result.rows[0]);

      // TODO: Ajouter à la job queue pour traitement IA facial
      // photoProcessingQueue.add({ photoId: result.rows[0].id, buffer: file.buffer });
    }

    res.status(201).json({
      message: `${uploadedPhotos.length} photo(s) uploadée(s) avec succès.`,
      photos: uploadedPhotos,
    });
  } catch (err) {
    console.error('Erreur upload :', err);
    res.status(500).json({ error: 'Erreur lors de l\'upload.' });
  }
});

// GET /api/photos/event/:eventId/public — Galerie publique (côté client)
router.get('/event/:eventId/public', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, watermarked_url, thumbnail_url, qr_code_id, faces_count, created_at
       FROM photos
       WHERE event_id = $1 AND is_processed = true
       ORDER BY created_at DESC`,
      [req.params.eventId]
    );

    res.json({ photos: result.rows });
  } catch (err) {
    console.error('Erreur galerie publique :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// GET /api/photos/qr/:code — Accès par QR code
router.get('/qr/:code', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.watermarked_url, p.thumbnail_url, p.qr_code_id,
              e.name as event_name, e.slug as event_slug
       FROM photos p
       JOIN events e ON e.id = p.event_id
       WHERE p.qr_code_id = $1`,
      [req.params.code]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Photo introuvable.' });
    }

    res.json({ photo: result.rows[0] });
  } catch (err) {
    console.error('Erreur QR :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /api/photos/face-search — Recherche par selfie (côté client)
router.post('/face-search', upload.single('selfie'), async (req, res) => {
  try {
    const { event_id } = req.body;

    if (!req.file || !event_id) {
      return res.status(400).json({ error: 'Selfie et ID événement requis.' });
    }

    // Envoyer le selfie au micro-service Python pour extraction du vecteur
    const axios = require('axios');
    const FormData = require('form-data');

    const formData = new FormData();
    formData.append('image', req.file.buffer, { filename: 'selfie.jpg' });

    const aiResponse = await axios.post(
      `${process.env.FACE_AI_SERVICE_URL}/extract-embedding`,
      formData,
      { headers: formData.getHeaders(), timeout: 10000 }
    );

    const selfieEmbedding = aiResponse.data.embedding;

    if (!selfieEmbedding) {
      return res.status(400).json({ error: 'Aucun visage détecté dans le selfie. Réessayez avec un meilleur éclairage.' });
    }

    // Recherche vectorielle dans pgvector — photos de cet événement uniquement
    const embeddingStr = `[${selfieEmbedding.join(',')}]`;

    const result = await pool.query(
      `SELECT DISTINCT p.id, p.watermarked_url, p.thumbnail_url, p.qr_code_id,
              1 - (fe.embedding <=> $1::vector) as similarity
       FROM face_embeddings fe
       JOIN photos p ON p.id = fe.photo_id
       WHERE fe.event_id = $2
         AND 1 - (fe.embedding <=> $1::vector) > 0.85
       ORDER BY similarity DESC
       LIMIT 50`,
      [embeddingStr, event_id]
    );

    res.json({
      matched_photos: result.rows,
      count: result.rows.length,
    });
  } catch (err) {
    console.error('Erreur recherche faciale :', err);
    res.status(500).json({ error: 'Erreur lors de la recherche. Réessayez.' });
  }
});

// GET /api/photos/:id/download — Télécharger la version HD (après paiement)
router.get('/:id/download', async (req, res) => {
  try {
    const { transaction_id } = req.query;

    if (!transaction_id) {
      return res.status(400).json({ error: 'ID de transaction requis.' });
    }

    // Vérifier que la transaction est complétée et inclut cette photo
    const txCheck = await pool.query(
      `SELECT id, photos_purchased FROM transactions
       WHERE id = $1 AND status = 'completed' AND $2 = ANY(photos_purchased)`,
      [transaction_id, req.params.id]
    );

    if (txCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Paiement non vérifié pour cette photo.' });
    }

    // Récupérer l'URL originale (HD, sans filigrane)
    const photo = await pool.query(
      'SELECT original_url FROM photos WHERE id = $1',
      [req.params.id]
    );

    if (photo.rows.length === 0) {
      return res.status(404).json({ error: 'Photo introuvable.' });
    }

    // Enregistrer le téléchargement
    await pool.query(
      'INSERT INTO downloads (transaction_id, photo_id, ip_address) VALUES ($1, $2, $3)',
      [transaction_id, req.params.id, req.ip]
    );

    res.json({ download_url: photo.rows[0].original_url });
  } catch (err) {
    console.error('Erreur téléchargement :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
