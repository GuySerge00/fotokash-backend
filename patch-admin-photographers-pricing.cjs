const fs = require('fs');
const path = 'src/routes/admin.js';
function replaceOnce(content, find, replace, label) {
  const parts = content.split(find);
  if (parts.length !== 2) throw new Error('Ancre "' + label + '" trouvee ' + (parts.length - 1) + ' fois. Abandon.');
  return parts.join(replace);
}
let src = fs.readFileSync(path, 'utf8');
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const bkdir = '/root/backups-fotokash/' + ts + '-admin-js-pricing';
fs.mkdirSync(bkdir, { recursive: true });
fs.writeFileSync(bkdir + '/admin.js', src);
console.log('Backup : ' + bkdir + '/admin.js');

src = replaceOnce(
  src,
  `        p.id, p.studio_name, p.email, p.phone, p.plan, p.photo_limit,
        p.role, p.status, p.created_at, p.updated_at,`,
  `        p.id, p.studio_name, p.email, p.phone, p.plan, p.photo_limit,
        p.role, p.status, p.created_at, p.updated_at,
        p.default_pricing_mode, p.default_unit_price,`,
  'SELECT pricing fields'
);

// Ancre elargie jusqu'a totalEvents/totalPhotos, specifiques a cette route -> unique
src = replaceOnce(
  src,
  `        plan: row.plan || 'free',
        photoLimit: row.photo_limit,
        role: row.role,
        status: row.status || 'active',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        totalEvents: parseInt(row.total_events),`,
  `        plan: row.plan || 'free',
        photoLimit: row.photo_limit,
        defaultPricingMode: row.default_pricing_mode || 'degressive',
        defaultUnitPrice: row.default_unit_price,
        role: row.role,
        status: row.status || 'active',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        totalEvents: parseInt(row.total_events),`,
  'objet photographer pricing'
);

src = replaceOnce(
  src,
  `      SELECT e.id, e.name, e.slug, e.date, e.status, e.created_at,
        (SELECT COUNT(*) FROM photos WHERE event_id = e.id) as photo_count,
        sp.event_retention_days,`,
  `      SELECT e.id, e.name, e.slug, e.date, e.status, e.created_at,
        e.pricing_mode, e.unit_price,
        (SELECT COUNT(*) FROM photos WHERE event_id = e.id) as photo_count,
        sp.event_retention_days,`,
  'SELECT events pricing override'
);

src = replaceOnce(
  src,
  `        photoCount: parseInt(e.photo_count),
        createdAt: e.created_at,`,
  `        photoCount: parseInt(e.photo_count),
        pricingMode: e.pricing_mode,
        unitPrice: e.unit_price,
        createdAt: e.created_at,`,
  'objet events pricing override'
);

fs.writeFileSync(path, src);
console.log('admin.js patche : GET /photographers/:id renvoie pricing par defaut + surcharges evenements.');
