const fs = require('fs');
const files = [
  '/home/fotokash-backend/src/routes/admin.js',
  '/home/fotokash-backend/src/routes/auth.js',
  '/home/fotokash-backend/src/routes/events.js',
  '/home/fotokash-backend/src/routes/photos.js',
  '/home/fotokash-backend/src/server.js',
  '/home/fotokash-backend/src/middleware/auth.js',
  '/home/fotokash-backend/src/middleware/isAdmin.js',
  '/home/fotokash-backend/src/config/database.js',
  '/home/fotokash-backend/src/config/cloudinary.js',
  '/home/fotokash-backend/src/jobs/faceProcessing.js',
];

let totalFixes = 0;

files.forEach(function(filePath) {
  if (!fs.existsSync(filePath)) return;
  let c = fs.readFileSync(filePath, 'utf8');
  let before = c.length;
  
  // Fix [xxx.yyy](http://xxx.yyy) -> xxx.yyy
  let regex = /\[([a-zA-Z0-9_]+\.[a-zA-Z0-9_.]+)\]\(http[s]?:\/\/[^)]+\)/g;
  let matches = c.match(regex);
  if (matches) {
    totalFixes += matches.length;
    c = c.replace(regex, '$1');
    fs.writeFileSync(filePath, c, 'utf8');
    console.log(filePath + ': ' + matches.length + ' fixes');
  }
  
  // Fix [xxx@yyy](mailto:xxx@yyy) -> xxx@yyy
  let regex2 = /\[([^\]]+)\]\(mailto:[^)]+\)/g;
  let matches2 = c.match(regex2);
  if (matches2) {
    totalFixes += matches2.length;
    c = c.replace(regex2, '$1');
    fs.writeFileSync(filePath, c, 'utf8');
    console.log(filePath + ': ' + matches2.length + ' mailto fixes');
  }
});

console.log('Total fixes:', totalFixes);
