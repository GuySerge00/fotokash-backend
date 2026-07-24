const fs = require('fs');
const path = 'src/routes/payments.js';
let src = fs.readFileSync(path, 'utf8');
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const bkdir = '/root/backups-fotokash/' + ts + '-payments-js-subscriptions';
fs.mkdirSync(bkdir, { recursive: true });
fs.writeFileSync(bkdir + '/payments.js', src);
console.log('Backup : ' + bkdir + '/payments.js');

const anchor = "    const tx = await pool.query(\n      'SELECT id, status FROM transactions WHERE reference = $1',\n      [providerTransactionId || '']\n    );\n\n    if (tx.rows.length === 0) {\n      return res.status(404).json({ error: 'Transaction introuvable.' });\n    }\n\n    if (tx.rows[0].status !== 'pending') {\n      console.log('Webhook ignore : transaction ' + tx.rows[0].id + ' deja au statut ' + tx.rows[0].status);\n      return res.json({ message: 'Callback deja traite.' });\n    }\n\n    await pool.query(\n      \"UPDATE transactions SET status = $1, completed_at = CASE WHEN $3 = 'completed' THEN NOW() ELSE NULL END WHERE id = $2 AND status = 'pending'\",\n      [newStatus, tx.rows[0].id, newStatus]\n    );\n\n    res.json({ message: 'Callback traite.' });";

const count = src.split(anchor).length - 1;
if (count !== 1) {
  console.error('Ancre trouvee ' + count + ' fois (attendu 1). Abandon, fichier inchange.');
  process.exit(1);
}

const replacement = "    const tx = await pool.query(\n      'SELECT id, status FROM transactions WHERE reference = $1',\n      [providerTransactionId || '']\n    );\n\n    if (tx.rows.length > 0) {\n      if (tx.rows[0].status !== 'pending') {\n        console.log('Webhook ignore : transaction ' + tx.rows[0].id + ' deja au statut ' + tx.rows[0].status);\n        return res.json({ message: 'Callback deja traite.' });\n      }\n      await pool.query(\n        \"UPDATE transactions SET status = $1, completed_at = CASE WHEN $3 = 'completed' THEN NOW() ELSE NULL END WHERE id = $2 AND status = 'pending'\",\n        [newStatus, tx.rows[0].id, newStatus]\n      );\n      return res.json({ message: 'Callback traite.' });\n    }\n\n    // Pas trouve dans transactions -> tenter subscription_payments (upgrade de plan photographe).\n    const sub = await pool.query(\n      'SELECT id, photographer_id, plan_id, status FROM subscription_payments WHERE reference = $1',\n      [providerTransactionId || '']\n    );\n\n    if (sub.rows.length === 0) {\n      return res.status(404).json({ error: 'Transaction introuvable.' });\n    }\n\n    if (sub.rows[0].status !== 'pending') {\n      console.log('Webhook ignore : paiement abonnement ' + sub.rows[0].id + ' deja au statut ' + sub.rows[0].status);\n      return res.json({ message: 'Callback deja traite.' });\n    }\n\n    await pool.query(\n      \"UPDATE subscription_payments SET status = $1, completed_at = CASE WHEN $3 = 'completed' THEN NOW() ELSE NULL END WHERE id = $2 AND status = 'pending'\",\n      [newStatus, sub.rows[0].id, newStatus]\n    );\n\n    if (newStatus === 'completed') {\n      const planData = await pool.query('SELECT photo_limit FROM subscription_plans WHERE id = $1', [sub.rows[0].plan_id]);\n      await pool.query(\n        \"UPDATE photographers SET plan = $1, photo_limit = $2, plan_expires_at = NOW() + INTERVAL '30 days', updated_at = NOW() WHERE id = $3\",\n        [sub.rows[0].plan_id, planData.rows[0] ? planData.rows[0].photo_limit : null, sub.rows[0].photographer_id]\n      );\n      console.log('[SUBSCRIPTION] Photographe ' + sub.rows[0].photographer_id + ' passe au plan ' + sub.rows[0].plan_id + ' (expire dans 30 jours)');\n    }\n\n    res.json({ message: 'Callback traite.' });";

src = src.split(anchor).join(replacement);
fs.writeFileSync(path, src);
console.log('payments.js patche : callback correle desormais transactions ET subscription_payments.');
