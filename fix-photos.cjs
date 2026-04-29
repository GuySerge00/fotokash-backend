const fs = require('fs');
const path = '/home/fotokash-backend/src/routes/photos.js';
let c = fs.readFileSync(path, 'utf8');

// Corriger toutes les corruptions markdown [xxx](http://xxx)
let count = 0;
let regex = /\[([^\]]+)\]\(http[s]?:\/\/[^)]+\)/g;
c = c.replace(regex, function(match, text) {
  count++;
  return text;
});

fs.writeFileSync(path, c, 'utf8');
console.log('Fixed', count, 'corruptions');

// Vérifier
let check = fs.readFileSync(path, 'utf8');
let remaining = (check.match(/\]\(http/g) || []).length;
console.log('Remaining:', remaining);
