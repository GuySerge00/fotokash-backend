const fs = require('fs');
const path = 'src/server.js';
let src = fs.readFileSync(path, 'utf8');
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const bkdir = '/root/backups-fotokash/' + ts + '-server-js-subscriptions';
fs.mkdirSync(bkdir, { recursive: true });
fs.writeFileSync(bkdir + '/server.js', src);
console.log('Backup : ' + bkdir + '/server.js');

const routeAnchor = "app.use('/api/earnings', earningsRoutes);";
if (src.split(routeAnchor).length - 1 !== 1) { console.error('Ancre route non unique. Abandon.'); process.exit(1); }
src = src.split(routeAnchor).join(routeAnchor + "\napp.use('/api/subscriptions', require('./routes/subscriptions'));");

const cronImportAnchor = "const { startEventCleanupJob } = require(\"./jobs/eventCleanup\");";
if (src.split(cronImportAnchor).length - 1 !== 1) { console.error('Ancre import cron non unique. Abandon.'); process.exit(1); }
src = src.split(cronImportAnchor).join(cronImportAnchor + "\nconst { startPlanExpirationJob } = require(\"./jobs/planExpiration\");");

const cronStartAnchor = "startEventCleanupJob();";
if (src.split(cronStartAnchor).length - 1 !== 1) { console.error('Ancre demarrage cron non unique. Abandon.'); process.exit(1); }
src = src.split(cronStartAnchor).join(cronStartAnchor + "\nstartPlanExpirationJob();");

fs.writeFileSync(path, src);
console.log('server.js patche : route /api/subscriptions + cron planExpiration enregistres.');
