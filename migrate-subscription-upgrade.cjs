const { Client } = require('pg');
require('dotenv').config();
const c = new Client({ connectionString: process.env.DATABASE_URL });

async function addColumn(table, col, ddl) {
  await c.query('ALTER TABLE ' + table + ' ADD COLUMN IF NOT EXISTS ' + col + ' ' + ddl);
  console.log('  colonne ok : ' + table + '.' + col);
}

(async () => {
  await c.connect();
  await c.query('BEGIN');
  try {
    console.log('-- photographers --');
    await addColumn('photographers', 'plan_expires_at', 'TIMESTAMP');

    console.log('-- subscription_payments --');
    await c.query(`
      CREATE TABLE IF NOT EXISTS subscription_payments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        photographer_id UUID NOT NULL REFERENCES photographers(id),
        plan_id VARCHAR NOT NULL REFERENCES subscription_plans(id),
        amount NUMERIC NOT NULL,
        payment_method VARCHAR,
        phone VARCHAR,
        provider VARCHAR,
        status VARCHAR NOT NULL DEFAULT 'pending',
        reference VARCHAR,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMP
      )
    `);
    console.log('  table ok : subscription_payments');

    await c.query('CREATE INDEX IF NOT EXISTS idx_subscription_payments_reference ON subscription_payments(reference)');
    await c.query('CREATE INDEX IF NOT EXISTS idx_subscription_payments_photographer ON subscription_payments(photographer_id)');
    console.log('  index ok');

    await c.query('COMMIT');
    console.log('\nMigration terminee avec succes.');
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('\nECHEC — ROLLBACK. Aucune modification appliquee.');
    console.error(e.message);
    process.exit(1);
  } finally {
    await c.end();
  }
})();
