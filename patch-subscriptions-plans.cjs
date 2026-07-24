const fs = require('fs');
const path = 'src/routes/subscriptions.js';
let src = fs.readFileSync(path, 'utf8');
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const bkdir = '/root/backups-fotokash/' + ts + '-subscriptions-js-plans';
fs.mkdirSync(bkdir, { recursive: true });
fs.writeFileSync(bkdir + '/subscriptions.js', src);
console.log('Backup : ' + bkdir + '/subscriptions.js');

const anchor = "module.exports = router;";
const count = src.split(anchor).length - 1;
if (count !== 1) { console.error('Ancre trouvee ' + count + ' fois. Abandon.'); process.exit(1); }

const insert =
`// GET /api/subscriptions/plans — Liste des plans disponibles (pour le photographe).
router.get('/plans', authMiddleware, async (req, res) => {
  try {
    var result = await pool.query('SELECT * FROM subscription_plans ORDER BY price ASC');
    res.json({ plans: result.rows });
  } catch (err) {
    console.error('Erreur liste plans :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

` + anchor;

src = src.split(anchor).join(insert);
fs.writeFileSync(path, src);
console.log('subscriptions.js patche : GET /plans ajoutee.');
