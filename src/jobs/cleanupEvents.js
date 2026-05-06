const { pool } = require('../config/database');

async function cleanupExpiredEvents() {
  try {
    console.log('[CLEANUP] Verification des evenements expires...');

    const result = await pool.query(`
      SELECT e.id, e.name, e.created_at, sp.event_retention_days, p.studio_name
      FROM events e
      JOIN photographers p ON p.id = e.photographer_id
      JOIN subscription_plans sp ON sp.id = p.plan
      WHERE sp.event_retention_days IS NOT NULL
      AND e.created_at < NOW() - (sp.event_retention_days || ' days')::INTERVAL
    `);

    if (result.rows.length === 0) {
      console.log('[CLEANUP] Aucun evenement expire.');
      return { deleted: 0 };
    }

    console.log('[CLEANUP] ' + result.rows.length + ' evenement(s) expire(s) trouve(s).');

    for (const event of result.rows) {
      console.log('[CLEANUP] Suppression: "' + event.name + '" (photographe: ' + event.studio_name + ', cree le: ' + event.created_at + ')');

      await pool.query('DELETE FROM live_matches WHERE visitor_id IN (SELECT id FROM live_visitors WHERE event_id = $1)', [event.id]);
      await pool.query('DELETE FROM live_visitors WHERE event_id = $1', [event.id]);
      await pool.query('DELETE FROM face_embeddings WHERE event_id = $1', [event.id]);
      await pool.query('DELETE FROM downloads WHERE photo_id IN (SELECT id FROM photos WHERE event_id = $1)', [event.id]);
      await pool.query('DELETE FROM transactions WHERE event_id = $1', [event.id]);
      await pool.query('DELETE FROM photos WHERE event_id = $1', [event.id]);
      await pool.query('DELETE FROM events WHERE id = $1', [event.id]);

      await pool.query(
        "INSERT INTO admin_logs (action, entity_type, entity_id, actor_id, actor_name, details) VALUES ($1, $2, $3, $4, $5, $6)",
        ['auto_delete', 'event', event.id, null, 'SYSTEM', JSON.stringify({ event_name: event.name, photographer: event.studio_name, retention_days: event.event_retention_days })]
      );
    }

    console.log('[CLEANUP] ' + result.rows.length + ' evenement(s) supprime(s).');
    return { deleted: result.rows.length };
  } catch (err) {
    console.error('[CLEANUP] Erreur:', err.message);
    return { error: err.message };
  }
}

if (require.main === module) {
  cleanupExpiredEvents().then((result) => {
    console.log('[CLEANUP] Resultat:', result);
    process.exit(0);
  });
}

module.exports = { cleanupExpiredEvents };
