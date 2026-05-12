// fix-soft-delete.cjs
// Implémente le soft delete des événements + contact photographe pour événements supprimés
// Usage: node fix-soft-delete.cjs

const fs = require('fs');
const FILE = '/home/fotokash-backend/src/routes/events.js';

let code = fs.readFileSync(FILE, 'utf8');
let changes = 0;

// ============================================================
// 1. Remplacer le DELETE physique par un soft delete
// ============================================================
const OLD_DELETE = `// DELETE /api/events/:id — Supprimer un événement et tout son contenu
router.delete('/:id', authMiddleware, ownsResource('event'), async (req, res) => {
  try {
    const eventId = req.params.id;
    // Supprimer dans l'ordre pour respecter les foreign keys
    await pool.query('DELETE FROM live_matches WHERE visitor_id IN (SELECT id FROM live_visitors WHERE event_id = $1)', [eventId]);
    await pool.query('DELETE FROM live_visitors WHERE event_id = $1', [eventId]);
    await pool.query('DELETE FROM face_embeddings WHERE event_id = $1', [eventId]);
    await pool.query('DELETE FROM downloads WHERE photo_id IN (SELECT id FROM photos WHERE event_id = $1)', [eventId]);
    await pool.query('DELETE FROM transactions WHERE event_id = $1', [eventId]);
    await pool.query('DELETE FROM photos WHERE event_id = $1', [eventId]);
    await pool.query('DELETE FROM events WHERE id = $1', [eventId]);
    res.json({ message: 'Événement et contenu supprimés.' });`;

const NEW_DELETE = `// DELETE /api/events/:id — Soft delete d'un événement (garde les infos photographe)
router.delete('/:id', authMiddleware, ownsResource('event'), async (req, res) => {
  try {
    const eventId = req.params.id;
    // Soft delete : marquer comme supprime + nettoyer le contenu
    await pool.query('DELETE FROM live_matches WHERE visitor_id IN (SELECT id FROM live_visitors WHERE event_id = $1)', [eventId]);
    await pool.query('DELETE FROM live_visitors WHERE event_id = $1', [eventId]);
    await pool.query('DELETE FROM face_embeddings WHERE event_id = $1', [eventId]);
    await pool.query('DELETE FROM downloads WHERE photo_id IN (SELECT id FROM photos WHERE event_id = $1)', [eventId]);
    await pool.query('DELETE FROM transactions WHERE event_id = $1', [eventId]);
    await pool.query('DELETE FROM photos WHERE event_id = $1', [eventId]);
    // Marquer l'evenement comme supprime au lieu de le supprimer
    await pool.query("UPDATE events SET deleted_at = NOW(), is_public = false WHERE id = $1", [eventId]);
    res.json({ message: 'Événement et contenu supprimés.' });`;

if (code.includes(OLD_DELETE)) {
  code = code.replace(OLD_DELETE, NEW_DELETE);
  changes++;
  console.log('OK: DELETE transforme en soft delete.');
} else {
  console.error('ERREUR: Bloc DELETE non trouve!');
}

// ============================================================
// 2. Modifier la route GET /:slug/public pour gérer les événements soft-deleted
//    Retourner les infos du photographe même si l'événement est supprimé
// ============================================================
const OLD_PUBLIC_ROUTE = `// GET /api/events/:slug/public — Page publique d'un événement (côté client)
router.get('/:slug/public', async (req, res) => {
  try {
    const result = await pool.query(
      \`SELECT e.id, e.name, e.slug, e.date, e.cover_url, e.description,
              p.studio_name as photographer_name,
              p.phone as photographer_phone,
              p.plan as photographer_plan,
              COALESCE(sp.mobile_money_enabled, false) as mobile_money_enabled,
              COALESCE(sp.commission_rate, 0) as commission_rate,
              COUNT(ph.id) as photos_count
       FROM events e
       JOIN photographers p ON p.id = e.photographer_id
       LEFT JOIN subscription_plans sp ON sp.id = p.plan
       LEFT JOIN photos ph ON ph.event_id = e.id AND ph.is_processed = true
       WHERE e.slug = $1 AND e.is_public = true
       GROUP BY e.id, p.studio_name, p.phone, p.plan, sp.mobile_money_enabled, sp.commission_rate\`,
      [req.params.slug]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Événement introuvable.' });
    }
    res.json({ event: result.rows[0] });`;

const NEW_PUBLIC_ROUTE = `// GET /api/events/:slug/public — Page publique d'un événement (côté client)
router.get('/:slug/public', async (req, res) => {
  try {
    // D'abord vérifier si l'événement existe (même supprimé)
    const checkDeleted = await pool.query(
      \`SELECT e.id, e.name, e.deleted_at,
              p.studio_name as photographer_name,
              p.phone as photographer_phone
       FROM events e
       JOIN photographers p ON p.id = e.photographer_id
       WHERE e.slug = $1\`,
      [req.params.slug]
    );
    // Si l'événement est soft-deleted, retourner les infos du photographe
    if (checkDeleted.rows.length > 0 && checkDeleted.rows[0].deleted_at) {
      return res.status(410).json({
        deleted: true,
        event_name: checkDeleted.rows[0].name,
        photographer_name: checkDeleted.rows[0].photographer_name,
        photographer_phone: checkDeleted.rows[0].photographer_phone,
      });
    }
    const result = await pool.query(
      \`SELECT e.id, e.name, e.slug, e.date, e.cover_url, e.description,
              p.studio_name as photographer_name,
              p.phone as photographer_phone,
              p.plan as photographer_plan,
              COALESCE(sp.mobile_money_enabled, false) as mobile_money_enabled,
              COALESCE(sp.commission_rate, 0) as commission_rate,
              COUNT(ph.id) as photos_count
       FROM events e
       JOIN photographers p ON p.id = e.photographer_id
       LEFT JOIN subscription_plans sp ON sp.id = p.plan
       LEFT JOIN photos ph ON ph.event_id = e.id AND ph.is_processed = true
       WHERE e.slug = $1 AND e.is_public = true AND e.deleted_at IS NULL
       GROUP BY e.id, p.studio_name, p.phone, p.plan, sp.mobile_money_enabled, sp.commission_rate\`,
      [req.params.slug]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Événement introuvable.' });
    }
    res.json({ event: result.rows[0] });`;

if (code.includes(OLD_PUBLIC_ROUTE)) {
  code = code.replace(OLD_PUBLIC_ROUTE, NEW_PUBLIC_ROUTE);
  changes++;
  console.log('OK: Route publique modifiee pour gerer le soft delete.');
} else {
  console.error('ERREUR: Route publique non trouvee!');
}

fs.writeFileSync(FILE, code, 'utf8');
console.log('');
console.log('=== DONE === (' + changes + ' corrections appliquees)');
console.log('Prochaine etape: systemctl restart fotokash-backend');
