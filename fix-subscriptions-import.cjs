const fs = require('fs');
const path = 'src/routes/subscriptions.js';
let src = fs.readFileSync(path, 'utf8');
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const bkdir = '/root/backups-fotokash/' + ts + '-subscriptions-js-fiximport';
fs.mkdirSync(bkdir, { recursive: true });
fs.writeFileSync(bkdir + '/subscriptions.js', src);
console.log('Backup : ' + bkdir + '/subscriptions.js');

const anchor = "const authMiddleware = require('../middleware/authMiddleware');";
const count = src.split(anchor).length - 1;
if (count !== 1) { console.error('Ancre trouvee ' + count + ' fois. Abandon.'); process.exit(1); }
src = src.split(anchor).join("const { authMiddleware } = require('../middleware/auth');");

fs.writeFileSync(path, src);
console.log('subscriptions.js corrige : import authMiddleware aligne sur le pattern reel.');
