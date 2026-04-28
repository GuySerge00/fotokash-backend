const Bull = require('bull');
const axios = require('axios');
const FormData = require('form-data');
const { pool } = require('../config/database');

const FACE_AI_URL = process.env.FACE_AI_SERVICE_URL || 'http://localhost:5000';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Creer la queue
const faceQueue = new Bull('face-processing', REDIS_URL, {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

// Worker : traiter chaque photo
faceQueue.process(5, async (job) => {
  var photoId = job.data.photoId;
  var eventId = job.data.eventId;
  var imageUrl = job.data.imageUrl;

  console.log('[FaceAI] Traitement photo:', photoId);

  try {
    // Telecharger l image depuis Cloudinary
    var imgResponse = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
    var imageBuffer = Buffer.from(imgResponse.data);

    // Envoyer au microservice Python
    var formData = new FormData();
    formData.append('image', imageBuffer, { filename: 'photo.jpg', contentType: 'image/jpeg' });

    var aiResponse = await axios.post(FACE_AI_URL + '/detect-faces', formData, {
      headers: formData.getHeaders(),
      timeout: 60000,
      maxContentLength: 50 * 1024 * 1024,
    });

    var faces = aiResponse.data.faces;
    console.log('[FaceAI] Photo', photoId, ':', faces.length, 'visage(s) detecte(s)');

    // Stocker chaque embedding dans pgvector
    for (var i = 0; i < faces.length; i++) {
      var face = faces[i];
      var embeddingStr = '[' + face.embedding.join(',') + ']';

    await pool.query(
    'INSERT INTO face_embeddings (photo_id, event_id, embedding, bbox_x, bbox_y, bbox_w, bbox_h, confidence) VALUES ($1, $2, $3::vector, $4, $5, $6, $7, $8)',
        [
          photoId,
          eventId,
          embeddingStr,
          face.bbox.x,
          face.bbox.y,
          face.bbox.w,
          face.bbox.h,
          face.confidence,
        ]
      );
    }

    // Mettre a jour le compteur de visages sur la photo
    await pool.query(
      'UPDATE photos SET faces_count = $1, is_processed = true WHERE id = $2',
      [faces.length, photoId]
    );

    console.log('[FaceAI] Photo', photoId, 'traitee avec succes');
    return { photoId: photoId, facesFound: faces.length };

  } catch (err) {
    console.error('[FaceAI] Erreur photo', photoId, ':', err.message, err.response ? err.response.data : '', err.stack);

    // Marquer comme traitee meme en erreur (0 visages)
    await pool.query(
      'UPDATE photos SET faces_count = 0, is_processed = true WHERE id = $1',
      [photoId]
    ).catch(function() {});

    throw err;
  }
});

// Evenements de la queue
faceQueue.on('completed', function(job, result) {
  console.log('[FaceAI] Job', job.id, 'termine:', result.facesFound, 'visage(s)');
});

faceQueue.on('failed', function(job, err) {
  console.error('[FaceAI] Job', job.id, 'echoue:', err.message);
});

faceQueue.on('error', function(err) {
  console.error('[FaceAI] Erreur queue:', err.message);
});

module.exports = faceQueue;