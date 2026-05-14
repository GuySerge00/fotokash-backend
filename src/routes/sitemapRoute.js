const express = require('express');
const router = express.Router();
const { generateSitemap } = require('../utils/generateSitemap');

let cachedSitemap = null;
let cacheTime = 0;
const CACHE_DURATION = 60 * 60 * 1000;

router.get('/sitemap.xml', async (req, res) => {
  try {
    const now = Date.now();
    if (!cachedSitemap || (now - cacheTime) > CACHE_DURATION) {
      cachedSitemap = await generateSitemap();
      cacheTime = now;
    }
    res.set('Content-Type', 'application/xml');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(cachedSitemap);
  } catch (err) {
    console.error('Erreur sitemap:', err);
    res.status(500).send('Erreur generation sitemap');
  }
});

module.exports = router;