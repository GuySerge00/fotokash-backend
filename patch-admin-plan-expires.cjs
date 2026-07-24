const fs = require('fs');
const path = 'src/routes/admin.js';
let src = fs.readFileSync(path, 'utf8');
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const bkdir = '/root/backups-fotokash/' + ts + '-admin-js-planexpires';
fs.mkdirSync(bkdir, { recursive: true });
fs.writeFileSync(bkdir + '/admin.js', src);
console.log('Backup : ' + bkdir + '/admin.js');

const anchor = "'UPDATE photographers SET plan = $1, photo_limit = $2, updated_at = NOW() WHERE id = $3 RETURNING id, studio_name, email, plan, photo_limit',";
const count = src.split(anchor).length - 1;
if (count !== 1) { console.error('Ancre trouvee ' + count + ' fois. Abandon.'); process.exit(1); }
const replacement = "'UPDATE photographers SET plan = $1, photo_limit = $2, plan_expires_at = NULL, updated_at = NOW() WHERE id = $3 RETURNING id, studio_name, email, plan, photo_limit, plan_expires_at',";
src = src.split(anchor).join(replacement);

fs.writeFileSync(path, src);
console.log('admin.js patche : override manuel de plan efface plan_expires_at (pas d\'expiration auto).');
