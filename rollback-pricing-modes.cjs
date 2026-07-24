const { Client } = require('pg');
require('dotenv').config();
const c = new Client({ connectionString: process.env.DATABASE_URL });
(async () => {
  await c.connect();
  await c.query('BEGIN');
  try {
    await c.query('ALTER TABLE photographers DROP CONSTRAINT IF EXISTS photographers_default_pricing_mode_chk');
    await c.query('ALTER TABLE events DROP CONSTRAINT IF EXISTS events_pricing_mode_chk');
    await c.query('ALTER TABLE photographers DROP COLUMN IF EXISTS default_pricing_mode');
    await c.query('ALTER TABLE photographers DROP COLUMN IF EXISTS default_unit_price');
    await c.query('ALTER TABLE events DROP COLUMN IF EXISTS pricing_mode');
    await c.query('ALTER TABLE events DROP COLUMN IF EXISTS unit_price');
    await c.query('ALTER TABLE events DROP COLUMN IF EXISTS custom_tiers');
    await c.query("DELETE FROM app_settings WHERE key IN ('min_base_unit_price','pricing_reference_base')");
    await c.query('COMMIT');
    console.log('Rollback termine.');
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('Echec rollback : ' + e.message);
    process.exit(1);
  } finally {
    await c.end();
  }
})();
