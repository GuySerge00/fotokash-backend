const fs = require('fs');
const path = '/home/fotokash-backend/src/routes/photos.js';
let c = fs.readFileSync(path, 'utf8');

let exportIdx = c.indexOf('module.exports');
let newRoute = `
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

`;

c = c.substring(0, exportIdx) + newRoute + c.substring(exportIdx);
fs.writeFileSync(path, c, 'utf8');
console.log('Platform route added');
