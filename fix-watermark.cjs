const fs = require('fs');
const path = '/home/fotokash-backend/src/routes/photos.js';
let c = fs.readFileSync(path, 'utf8');

// Trouver la ligne du watermark SVG
let idx = c.indexOf('svgWatermark');
if (idx === -1) {
  console.log('svgWatermark not found');
  process.exit();
}

// Trouver le début de la ligne
let lineStart = c.lastIndexOf('\n', idx) + 1;
let lineEnd = c.indexOf('\n', idx);
let oldLine = c.substring(lineStart, lineEnd);
console.log('OLD:', oldLine.trim().substring(0, 80));

// Ajouter la lecture du watermark depuis app_settings avant cette ligne
let watermarkRead = `      var wmResult = await pool.query("SELECT value FROM app_settings WHERE key = 'watermark_text'");
      var wmText = wmResult.rows[0] ? wmResult.rows[0].value : 'FOTOKASH';
      var svgWatermark = '<svg width="400" height="100"><text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" font-size="48" font-weight="bold" fill="rgba(255,255,255,0.4)" transform="rotate(-30, 200, 50)">' + wmText + '</text></svg>';`;

// Remplacer la ligne
c = c.substring(0, lineStart) + watermarkRead + '\n' + c.substring(lineEnd);

fs.writeFileSync(path, c, 'utf8');
console.log('Watermark made dynamic');
