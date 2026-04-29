const fs = require('fs');
const path = '/home/fotokash-backend/src/routes/photos.js';
let c = fs.readFileSync(path, 'utf8');

// Trouver le début et la fin de la route face-search
let start = c.indexOf("'/face-search'");
// Remonter au début de la ligne router.post
start = c.lastIndexOf('router', start);

// Trouver la fin: le prochain router.get ou router.post
let afterRoute = c.indexOf("router.get('/:id/download'", start);
if (afterRoute === -1) afterRoute = c.indexOf("router.get('/pricing'", start);

let before = c.substring(0, start);
let after = c.substring(afterRoute);

console.log('Removing from index', start, 'to', afterRoute);

let newRoute = `router.post('/face-search', upload.single('selfie'), async (req, res) => {
  try {
    console.log('Face search request received, event_id:', req.body.event_id, 'file:', req.file ? req.file.size : 'none');
    var event_id = req.body.event_id;
    if (!req.file || !event_id) return res.status(400).json({ error: 'Selfie et ID evenement requis.' });
    var axios = require('axios');
    var FormData = require('form-data');
    var formData = new FormData();
    formData.append('image', req.file.buffer, { filename: 'selfie.jpg' });
    var aiResponse = await axios.post(process.env.FACE_AI_SERVICE_URL + '/extract-embedding', formData, { headers: formData.getHeaders(), timeout: 10000 });
    var selfieEmbedding = aiResponse.data.embedding;
    console.log('Face AI response:', selfieEmbedding ? 'embedding OK (' + selfieEmbedding.length + 'd)' : 'NO EMBEDDING');
    if (!selfieEmbedding) return res.status(400).json({ error: 'Aucun visage detecte.' });
    var embeddingStr = '[' + selfieEmbedding.join(',') + ']';
    var planCheck = await pool.query(
      'SELECT sp.mobile_money_enabled FROM events e JOIN photographers p ON p.id = e.photographer_id LEFT JOIN subscription_plans sp ON sp.id = p.plan WHERE e.id = $1', [event_id]
    );
    var isFree = !planCheck.rows[0] || !planCheck.rows[0].mobile_money_enabled;
    var photoFields = isFree
      ? 'p.id, p.original_url, p.watermarked_url, p.thumbnail_url, p.qr_code_id'
      : 'p.id, p.watermarked_url, p.thumbnail_url, p.qr_code_id';
    var result = await pool.query('SELECT DISTINCT ' + photoFields + ', 1 - (fe.embedding <=> $1::vector) as similarity FROM face_embeddings fe JOIN photos p ON p.id = fe.photo_id WHERE fe.event_id = $2 AND 1 - (fe.embedding <=> $1::vector) > 0.6 ORDER BY similarity DESC LIMIT 50', [embeddingStr, event_id]);
    console.log('Face search results:', result.rows.length, 'matches found');
    res.json({ matched_photos: result.rows, count: result.rows.length });
  } catch (err) { console.error('Face search error:', err.message); res.status(500).json({ error: 'Erreur recherche.' }); }
});
`;

c = before + newRoute + after;
fs.writeFileSync(path, c, 'utf8');
console.log('Route replaced successfully');

// Verify
let check = fs.readFileSync(path, 'utf8');
let bad = (check.match(/\]\(http/g) || []).length;
console.log('Remaining corruptions in file:', bad);
