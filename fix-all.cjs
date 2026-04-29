const fs = require('fs');
const path = require('path');

function fixFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  let c = fs.readFileSync(filePath, 'utf8');
  let count = 0;
  let regex = /\[([^\]]+)\]\(http[s]?:\/\/[^)]+\)/g;
  c = c.replace(regex, function(match, text) {
    count++;
    return text;
  });
  // Fix aussi mailto:
  let regex2 = /\[([^\]]+)\]\(mailto:[^)]+\)/g;
  c = c.replace(regex2, function(match, text) {
    count++;
    return text;
  });
  if (count > 0) {
    fs.writeFileSync(filePath, c, 'utf8');
    console.log(filePath, ':', count, 'fixes');
  }
}

// Fixer tous les fichiers JS dans src/
const srcDir = '/home/fotokash-backend/src';
function walkDir(dir) {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const full = path.join(dir, f);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walkDir(full);
    else if (f.endsWith('.js') || f.endsWith('.jsx')) fixFile(full);
  }
}

walkDir(srcDir);
// Aussi les fichiers racine
fixFile('/home/fotokash-backend/package.json');
console.log('All done!');
