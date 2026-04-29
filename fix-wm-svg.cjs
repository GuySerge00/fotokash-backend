const fs = require('fs');
const path = '/home/fotokash-backend/src/routes/photos.js';
let c = fs.readFileSync(path, 'utf8');

let old = "width=\"400\" height=\"100\"";
let newStr = "width=\"800\" height=\"200\"";
c = c.replace(old, newStr);

// Aussi ajuster le transform rotate pour centrer sur la nouvelle taille
let oldRotate = "rotate(-30, 200, 50)";
let newRotate = "rotate(-25, 400, 100)";
c = c.replace(oldRotate, newRotate);

fs.writeFileSync(path, c, 'utf8');
console.log('Watermark SVG size increased to 800x200');
