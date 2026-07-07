const cloudinary = require('../config/cloudinary');
const { pool } = require('../config/database');

function extractPublicId(url) {
  if (!url) return null;
  const match = url.match(/\/upload\/v\d+\/(.+)\.\w+$/);
  return match ? match[1] : null;
}

async function purgeCloudinaryForPhotos(photoIds) {
  if (!photoIds || photoIds.length === 0) return { purged: 0, failed: 0 };

  const result = await pool.query(
    'SELECT id, original_url, watermarked_url, thumbnail_url FROM photos WHERE id = ANY($1) AND deleted_at IS NOT NULL',
    [photoIds]
  );

  const skipped = photoIds.length - result.rows.length;
  if (skipped > 0) {
    console.warn(`[CLOUDINARY-PURGE] ${skipped} photo(s) ignoree(s) car non marquee(s) deleted_at (garde-fou de securite).`);
  }

  let purged = 0;
  let failed = 0;

  for (const photo of result.rows) {
    const urls = [photo.original_url, photo.watermarked_url, photo.thumbnail_url];
    for (const url of urls) {
      const publicId = extractPublicId(url);
      if (!publicId) {
        console.error(`[CLOUDINARY-PURGE] Impossible d'extraire le public_id pour photo ${photo.id}, url: ${url}`);
        failed++;
        continue;
      }
      try {
        const res = await cloudinary.uploader.destroy(publicId);
        if (res.result === 'ok' || res.result === 'not found') {
          purged++;
        } else {
          console.error(`[CLOUDINARY-PURGE] Resultat inattendu pour ${publicId}:`, res.result);
          failed++;
        }
      } catch (err) {
        console.error(`[CLOUDINARY-PURGE] Erreur suppression ${publicId}:`, err.message);
        failed++;
      }
    }
  }

  console.log(`[CLOUDINARY-PURGE] ${purged} fichier(s) purge(s), ${failed} echec(s), sur ${result.rows.length} photo(s).`);
  return { purged, failed };
}

module.exports = { purgeCloudinaryForPhotos, extractPublicId };
