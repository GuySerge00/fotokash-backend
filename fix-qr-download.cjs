const fs = require('fs');
const path = '/home/fotokash-backend/src/routes/photos.js';
let c = fs.readFileSync(path, 'utf8');

// Trouver la route /qr/:code et ajouter original_url
let old = "SELECT p.id, p.watermarked_url, p.thumbnail_url, p.qr_code_id, e.name as event_name, e.slug as event_slug FROM photos p";
let newStr = "SELECT p.id, p.original_url, p.watermarked_url, p.thumbnail_url, p.qr_code_id, e.name as event_name, e.slug as event_slug FROM photos p";

if (c.includes(old)) {
  c = c.replace(old, newStr);
  console.log('Added original_url to QR route');
} else {
  console.log('QR route not found or already has original_url');
  // Chercher la variante
  let idx = c.indexOf("qr_code_id, e.name");
  if (idx !== -1) {
    console.log('Found near:', c.substring(idx - 50, idx + 30));
  }
}

fs.writeFileSync(path, c, 'utf8');
console.log('Done');
