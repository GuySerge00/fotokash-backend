const fs = require('fs');
const path = '/home/fotokash-backend/src/routes/photos.js';
let c = fs.readFileSync(path, 'utf8');

// Remplacer le seuil fixe 0.3 par une valeur dynamique depuis app_settings
let old = "> 0.3 ORDER BY";
let idx = c.indexOf(old);
if (idx === -1) {
  old = "> 0.6 ORDER BY";
  idx = c.indexOf(old);
}

if (idx !== -1) {
  // Ajouter la lecture du seuil avant la requête de recherche
  let searchLine = "var result = await pool.query";
  let searchIdx = c.indexOf(searchLine, idx - 500);
  
  let thresholdCode = `var thresholdResult = await pool.query("SELECT value FROM app_settings WHERE key = 'face_search_threshold'");
    var threshold = thresholdResult.rows[0] ? parseFloat(thresholdResult.rows[0].value) : 0.6;
    console.log('Using face search threshold:', threshold);
    `;
  
  c = c.substring(0, searchIdx) + thresholdCode + c.substring(searchIdx);
  
  // Remplacer le seuil fixe par la variable
  c = c.replace(/> 0\.[36] ORDER BY/g, '> ' + "' + threshold + '" + ' ORDER BY');
  
  // Hmm c'est dans une string SQL, approche differente
  // Annuler et refaire proprement
}

// Approche plus simple: reconstruire la requete
// Trouver la ligne de la requete
let queryIdx = c.indexOf("(fe.embedding <=> $1::vector) > 0.");
if (queryIdx !== -1) {
  let thresholdVal = c.substring(queryIdx + 35, queryIdx + 38);
  console.log('Current threshold in query:', thresholdVal);
  
  // Remplacer > 0.X par > $3 et ajouter threshold comme parametre
  // Trouver la requete complete
  let queryStart = c.lastIndexOf("pool.query('SELECT", queryIdx);
  let queryEnd = c.indexOf(');', queryIdx);
  let fullQuery = c.substring(queryStart, queryEnd + 2);
  console.log('Query found, length:', fullQuery.length);
}

console.log('Switching to simpler approach...');

// Approche la plus simple: lire le seuil et l'injecter dans la string
c = fs.readFileSync(path, 'utf8');

// Ajouter la lecture du seuil juste avant "var result = await pool.query"
let resultIdx = c.indexOf("var result = await pool.query('SELECT DISTINCT");
if (resultIdx !== -1) {
  let thresholdRead = `var thresholdRes = await pool.query("SELECT value FROM app_settings WHERE key = 'face_search_threshold'");
    var faceThreshold = thresholdRes.rows[0] ? parseFloat(thresholdRes.rows[0].value) : 0.6;
    console.log('Face search threshold:', faceThreshold);
    `;
  c = c.substring(0, resultIdx) + thresholdRead + c.substring(resultIdx);
  
  // Remplacer > 0.3 ou > 0.6 par > ' + faceThreshold + '
  c = c.replace(/> 0\.3 ORDER/, "> ' + faceThreshold + ' ORDER");
  c = c.replace(/> 0\.6 ORDER/, "> ' + faceThreshold + ' ORDER");
  
  console.log('Threshold made dynamic');
} else {
  console.log('Result query not found');
}

fs.writeFileSync(path, c, 'utf8');
console.log('Done');
