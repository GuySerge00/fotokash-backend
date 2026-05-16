const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

// GET /api/seo/event/:slug — HTML minimal avec méta tags pour bots/crawlers
router.get('/event/:slug', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT e.name, e.slug, e.date, e.description, e.cover_url,
              p.studio_name as photographer_name,
              COUNT(ph.id) as photos_count
       FROM events e
       JOIN photographers p ON p.id = e.photographer_id
       LEFT JOIN photos ph ON ph.event_id = e.id AND ph.is_processed = true
       WHERE e.slug = $1 AND e.is_public = true AND e.deleted_at IS NULL
       GROUP BY e.id, p.studio_name`,
      [req.params.slug]
    );

    if (result.rows.length === 0) {
      return res.status(404).send('Not found');
    }

    const e = result.rows[0];
    const title = e.name + ' | FotoKash';
    const desc = (e.description || 'Retrouvez vos photos par reconnaissance faciale')
      + ' — ' + e.photos_count + ' photos par ' + e.photographer_name;
    const url = 'https://fotokash.com/e/' + e.slug;
    const image = e.cover_url || 'https://fotokash.com/og-image.png';
    const dateStr = e.date ? new Date(e.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<meta name="description" content="${desc}">
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="${image}">
<meta property="og:locale" content="fr_CI">
<meta property="og:site_name" content="FotoKash">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${image}">
<link rel="canonical" href="${url}">
</head>
<body>
<h1>${e.name}</h1>
<p>${dateStr} — ${e.photographer_name}</p>
<p>${e.photos_count} photos</p>
<p>${desc}</p>
<a href="${url}">Voir les photos sur FotoKash</a>
</body>
</html>`);
  } catch (err) {
    console.error('SEO route error:', err);
    res.status(500).send('Error');
  }
});

// GET /api/seo/sitemap.xml — Sitemap dynamique
router.get('/sitemap.xml', async (req, res) => {
  try {
    const events = await pool.query(
      `SELECT slug, updated_at FROM events WHERE is_public = true AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 500`
    );

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    xml += '  <url><loc>https://fotokash.com/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>\n';
    xml += '  <url><loc>https://fotokash.com/login</loc><changefreq>monthly</changefreq><priority>0.5</priority></url>\n';
    xml += '  <url><loc>https://fotokash.com/signup</loc><changefreq>monthly</changefreq><priority>0.5</priority></url>\n';

    for (const e of events.rows) {
      const lastmod = e.updated_at ? new Date(e.updated_at).toISOString().split('T')[0] : '';
      xml += `  <url><loc>https://fotokash.com/e/${e.slug}</loc>${lastmod ? '<lastmod>' + lastmod + '</lastmod>' : ''}<changefreq>weekly</changefreq><priority>0.8</priority></url>\n`;
    }

    xml += '</urlset>';
    res.setHeader('Content-Type', 'application/xml');
    res.send(xml);
  } catch (err) {
    console.error('Sitemap error:', err);
    res.status(500).send('Error');
  }
});

module.exports = router;
