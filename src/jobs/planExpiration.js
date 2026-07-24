const cron = require('node-cron');
const { pool } = require('../config/database');

async function runPlanExpirationCheck() {
  console.log('[PLAN-EXPIRATION] Verification des plans expires...');
  const expired = await pool.query(`
    SELECT id, studio_name, plan
    FROM photographers
    WHERE plan_expires_at IS NOT NULL
      AND plan_expires_at < NOW()
      AND plan != 'free'
  `);
  if (expired.rows.length === 0) {
    console.log('[PLAN-EXPIRATION] Aucun plan expire.');
    return;
  }
  const freePlan = await pool.query("SELECT photo_limit FROM subscription_plans WHERE id = 'free'");
  const freeLimit = freePlan.rows[0] ? freePlan.rows[0].photo_limit : null;

  for (const row of expired.rows) {
    await pool.query(
      "UPDATE photographers SET plan = 'free', photo_limit = $1, plan_expires_at = NULL, updated_at = NOW() WHERE id = $2",
      [freeLimit, row.id]
    );
    console.log('[PLAN-EXPIRATION] ' + row.studio_name + ' (' + row.id + ') retrograde de ' + row.plan + ' vers free.');
  }
  console.log('[PLAN-EXPIRATION] ' + expired.rows.length + ' photographe(s) retrograde(s).');
}

function startPlanExpirationJob() {
  // Tous les jours a 3h UTC (apres le cleanup evenements a 2h)
  cron.schedule('0 3 * * *', () => {
    runPlanExpirationCheck().catch((err) => console.error('[PLAN-EXPIRATION] Erreur :', err.message));
  });
  console.log('[CRON] Job de verification des plans expires programme (tous les jours a 03:00 UTC).');
}

module.exports = { startPlanExpirationJob, runPlanExpirationCheck };
