const fs = require('fs');
const path = 'src/routes/auth.js';
let src = fs.readFileSync(path, 'utf8');
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const bkdir = '/root/backups-fotokash/' + ts + '-auth-js-planexpires';
fs.mkdirSync(bkdir, { recursive: true });
fs.writeFileSync(bkdir + '/auth.js', src);
console.log('Backup : ' + bkdir + '/auth.js');

const anchor = "SELECT p.id, p.studio_name, p.email, p.phone, p.plan, p.photo_limit, p.role, p.status, p.created_at, p.has_seen_onboarding,";
const count = src.split(anchor).length - 1;
if (count !== 1) { console.error('Ancre trouvee ' + count + ' fois. Abandon.'); process.exit(1); }
const replacement = "SELECT p.id, p.studio_name, p.email, p.phone, p.plan, p.photo_limit, p.role, p.status, p.created_at, p.has_seen_onboarding, p.plan_expires_at,";
src = src.split(anchor).join(replacement);

fs.writeFileSync(path, src);
console.log('auth.js patche : /me expose plan_expires_at.');
