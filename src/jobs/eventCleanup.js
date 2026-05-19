const cron = require('node-cron');
const { pool } = require('../config/database');

/**
 * Cron job : Suppression automatique des événements expirés
 * Tourne tous les jours à 2h du matin (UTC)
 */
function startEventCleanupJob() {
  cron.schedule('0 2 * * *', async () => {
    console.log('[CRON] Vérification des événements expirés...');
    
    try {
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
        console.log('[CRON] Aucun événement expiré.');
        return;
      }

      console.log(`[CRON] ${expiredEvents.rows.length} événement(s) expiré(s) trouvé(s).`);

      for (const event of expiredEvents.rows) {
        try {
          await pool.query('DELETE FROM live_matches WHERE visitor_id IN (SELECT id FROM live_visitors WHERE event_id = $1)', [event.id]);
          await pool.query('DELETE FROM live_visitors WHERE event_id = $1', [event.id]);
          await pool.query('DELETE FROM face_embeddings WHERE event_id = $1', [event.id]);
          // Downloads conservés pour l'historique des stats admin
          await pool.query('DELETE FROM transactions WHERE event_id = $1', [event.id]);
          await pool.query('DELETE FROM photos WHERE event_id = $1', [event.id]);
          await pool.query("UPDATE events SET deleted_at = NOW(), is_public = false WHERE id = $1", [event.id]);

          console.log(`[CRON] ✓ Supprimé : "${event.name}" (photographe: ${event.studio_name}, rétention: ${event.event_retention_days}j)`);
        } catch (err) {
          console.error(`[CRON] ✗ Erreur suppression événement ${event.id}:`, err.message);
        }
      }

      console.log('[CRON] Nettoyage terminé.');
    } catch (err) {
      console.error('[CRON] Erreur globale:', err.message);
    }
  });

  console.log('[CRON] Job de nettoyage des événements programmé (tous les jours à 02:00 UTC).');
}

module.exports = { startEventCleanupJob };
