const { pool } = require('../config/database');

const SITE_URL = 'https://fotokash.com';
const STATIC_PAGES = [
  { path: '/', priority: '1.0', changefreq: 'weekly' },
  { path: '/login', priority: '0.5', changefreq: 'monthly' },
  { path: '/register', priority: '0.5', changefreq: 'monthly' },
];

function escapeXml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

async function generateSitemap() {
  const urls = [];
  const now = new Date().toISOString().split('T')[0];
  for (const pg of STATIC_PAGES) {
    urls.push({ loc: SITE_URL + pg.path, lastmod: now, changefreq: pg.changefreq, priority: pg.priority });
  }
  try {
    const r = await pool.query("SELECT slug, updated_at FROM events WHERE slug IS NOT NULL AND is_published = true ORDER BY updated_at DESC");
    for (const ev of r.rows) {
      urls.push({ loc: SITE_URL + '/e/' + ev.slug, lastmod: ev.updated_at ? new Date(ev.updated_at).toISOString().split('T')[0] : now, changefreq: 'weekly', priority: '0.7' });
    }
  } catch (err) { console.error('Sitemap events error:', err.message); }
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  for (const u of urls) {
    xml += '  <url>\n    <loc>' + escapeXml(u.loc) + '</loc>\n    <lastmod>' + u.lastmod + '</lastmod>\n    <changefreq>' + u.changefreq + '</changefreq>\n    <priority>' + u.priority + '</priority>\n  </url>\n';
  }
  xml += '</urlset>';
  return xml;
}

module.exports = { generateSitemap };