const fs = require('fs');
const path = '/home/fotokash-backend/src/routes/photos.js';
let c = fs.readFileSync(path, 'utf8');

c = c.replace('font-size="48"', 'font-size="50"');

fs.writeFileSync(path, c, 'utf8');
console.log('Watermark size changed to 50px');
