const fs = require('fs');
const path = '/home/fotokash-backend/src/server.js';
let c = fs.readFileSync(path, 'utf8');

// Ajouter le middleware maintenance après le parsing JSON
let parseIdx = c.indexOf("app.use(express.urlencoded");
if (parseIdx === -1) {
  console.log('urlencoded not found');
  process.exit();
}
let afterParse = c.indexOf('\n', parseIdx) + 1;

let maintenanceMiddleware = `
// Mode maintenance
app.use(async (req, res, next) => {
  if (req.path === '/api/health' || req.path.startsWith('/api/admin') || req.path === '/api/auth/login') return next();
  try {
    var { pool } = require('./config/database');
    var result = await pool.query("SELECT value FROM app_settings WHERE key = 'maintenance_mode'");
    if (result.rows[0] && result.rows[0].value === 'true') {
      return res.status(503).json({ error: 'FotoKash est en maintenance. Revenez bientot.', maintenance: true });
    }
  } catch(e) {}
  next();
});

`;

c = c.substring(0, afterParse) + maintenanceMiddleware + c.substring(afterParse);
fs.writeFileSync(path, c, 'utf8');
console.log('Maintenance middleware added');
