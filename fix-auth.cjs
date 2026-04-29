const fs = require('fs');
const path = '/home/fotokash-backend/src/routes/auth.js';
let c = fs.readFileSync(path, 'utf8');
let lines = c.split('\n');

// Ligne 44 (index 43) - supprimer le "nano ..." et garder juste le code
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('nano /home/fotokash-backend')) {
    console.log('Found at line', i+1, ':', lines[i].trim());
    // Extraire juste la partie code après le chemin nano
    let codeStart = lines[i].indexOf('res.status');
    if (codeStart !== -1) {
      lines[i] = '    ' + lines[i].substring(codeStart);
      console.log('Fixed to:', lines[i].trim());
    }
  }
}

fs.writeFileSync(path, lines.join('\n'), 'utf8');
console.log('Done');
