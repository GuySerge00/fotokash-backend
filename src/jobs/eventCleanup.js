const cron = require('node-cron');
const { pool } = require('../config/database');
/**
 * Nettoyage des événements expirés
 * Politique : soft-delete des photos + événement, transactions et downloads
 * conservés pour toujours (historique stats admin et photographe)
 * Utilisable en tâche planifiée (cron) ou déclenchée manuellement (admin)
 */
async function runEventCleanup() {
  console.log('[CLEANUP] Vérification des événements expirés...');
  const expiredEvents = await pool.query(`
    SELECT e.id, e.name, e.created_at, p.studio_name, sp.event_retention_days
    FROM events e
    JOIN photographers p ON p.id = e.photographer_id
    JOIN subscription_plans sp ON sp.id = p.plan
    WHERE e.deleted_at IS NULL
      AND sp.event_retention_days IS NOT NULL
      AND e.created_at + (sp.event_retention_days || ' days')::INTERVAL < NOW()
  `);
  if (expiredEvents.rows.length === 0) {
    console.log('[CLEANUP] Aucun événement expiré.');
    return { deleted: 0 };
  }
  console.log(`[CLEANUP] ${expiredEvents.rows.length} événement(s) expiré(s) trouvé(s).`);
  let deletedCount = 0;
  for (const event of expiredEvents.rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM live_matches WHERE visitor_id IN (SELECT id FROM live_visitors WHERE event_id = $1)', [event.id]);
      await client.query('DELETE FROM live_visitors WHERE event_id = $1', [event.id]);
      await client.query('DELETE FROM face_embeddings WHERE event_id = $1', [event.id]);
      // transactions et downloads conservés pour toujours
      const photosToPurge = await client.query('SELECT id FROM photos WHERE event_id = $1 AND deleted_at IS NULL', [event.id]);
      await client.query('UPDATE photos SET deleted_at = NOW() WHERE event_id = $1', [event.id]);
      await client.query("UPDATE events SET deleted_at = NOW(), is_public = false WHERE id = $1", [event.id]);
      await client.query('COMMIT');
      deletedCount++;
      console.log(`[CLEANUP] ✓ Nettoyé : "${event.name}" (photographe: ${event.studio_name}, rétention: ${event.event_retention_days}j)`);

      const { purgeCloudinaryForPhotos } = require('../utils/cloudinaryCleanup');
      const photoIdsToPurge = photosToPurge.rows.map(r => r.id);
      purgeCloudinaryForPhotos(photoIdsToPurge).catch(err => {
        console.error('[CLOUDINARY-PURGE] Erreur non bloquante:', err.message);
      });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[CLEANUP] ✗ Erreur nettoyage événement ${event.id}:`, err.message);
    } finally {
      client.release();
    }
  }
  console.log('[CLEANUP] Nettoyage terminé.');
  return { deleted: deletedCount };
}

function startEventCleanupJob() {
  cron.schedule('0 2 * * *', async () => {
    try {
      await runEventCleanup();
    } catch (err) {
      console.error('[CRON] Erreur globale:', err.message);
    }
  });
  console.log('[CRON] Job de nettoyage des événements programmé (tous les jours à 02:00 UTC).');
}

module.exports = { startEventCleanupJob, runEventCleanup };
