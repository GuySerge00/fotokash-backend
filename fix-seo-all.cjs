const fs = require('fs');
const { execSync } = require('child_process');

function log(msg) { console.log('\n✅ ' + msg); }
function warn(msg) { console.log('⚠️  ' + msg); }
function run(cmd) {
  console.log('  → ' + cmd);
  try { return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }); }
  catch (e) { console.error('  ❌ Erreur: ' + e.message); return null; }
}

// STEP 1: generateSitemap.js
log('STEP 1: Creation de generateSitemap.js');
const utilsDir = '/home/fotokash-backend/src/utils';
if (!fs.existsSync(utilsDir)) fs.mkdirSync(utilsDir, { recursive: true });

fs.writeFileSync(utilsDir + '/generateSitemap.js', [
  "const { pool } = require('../config/database');",
  "",
  "const SITE_URL = 'https://fotokash.com';",
  "const STATIC_PAGES = [",
  "  { path: '/', priority: '1.0', changefreq: 'weekly' },",
  "  { path: '/login', priority: '0.5', changefreq: 'monthly' },",
  "  { path: '/register', priority: '0.5', changefreq: 'monthly' },",
  "];",
  "",
  "function escapeXml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }",
  "",
  "async function generateSitemap() {",
  "  const urls = [];",
  "  const now = new Date().toISOString().split('T')[0];",
  "  for (const pg of STATIC_PAGES) {",
  "    urls.push({ loc: SITE_URL + pg.path, lastmod: now, changefreq: pg.changefreq, priority: pg.priority });",
  "  }",
  "  try {",
  "    const r = await pool.query(\"SELECT slug, updated_at FROM events WHERE slug IS NOT NULL AND is_published = true ORDER BY updated_at DESC\");",
  "    for (const ev of r.rows) {",
  "      urls.push({ loc: SITE_URL + '/e/' + ev.slug, lastmod: ev.updated_at ? new Date(ev.updated_at).toISOString().split('T')[0] : now, changefreq: 'weekly', priority: '0.7' });",
  "    }",
  "  } catch (err) { console.error('Sitemap events error:', err.message); }",
  "  let xml = '<?xml version=\"1.0\" encoding=\"UTF-8\"?>\\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\\n';",
  "  for (const u of urls) {",
  "    xml += '  <url>\\n    <loc>' + escapeXml(u.loc) + '</loc>\\n    <lastmod>' + u.lastmod + '</lastmod>\\n    <changefreq>' + u.changefreq + '</changefreq>\\n    <priority>' + u.priority + '</priority>\\n  </url>\\n';",
  "  }",
  "  xml += '</urlset>';",
  "  return xml;",
  "}",
  "",
  "module.exports = { generateSitemap };",
].join('\n'));
log('generateSitemap.js cree');

// STEP 2: sitemapRoute.js
log('STEP 2: Creation de sitemapRoute.js');
fs.writeFileSync('/home/fotokash-backend/src/routes/sitemapRoute.js', [
  "const express = require('express');",
  "const router = express.Router();",
  "const { generateSitemap } = require('../utils/generateSitemap');",
  "",
  "let cachedSitemap = null;",
  "let cacheTime = 0;",
  "const CACHE_DURATION = 60 * 60 * 1000;",
  "",
  "router.get('/sitemap.xml', async (req, res) => {",
  "  try {",
  "    const now = Date.now();",
  "    if (!cachedSitemap || (now - cacheTime) > CACHE_DURATION) {",
  "      cachedSitemap = await generateSitemap();",
  "      cacheTime = now;",
  "    }",
  "    res.set('Content-Type', 'application/xml');",
  "    res.set('Cache-Control', 'public, max-age=3600');",
  "    res.send(cachedSitemap);",
  "  } catch (err) {",
  "    console.error('Erreur sitemap:', err);",
  "    res.status(500).send('Erreur generation sitemap');",
  "  }",
  "});",
  "",
  "module.exports = router;",
].join('\n'));
log('sitemapRoute.js cree');

// STEP 3: Inject route in server.js
log('STEP 3: Injection route sitemap dans server.js');
const serverPath = '/home/fotokash-backend/src/server.js';
let serverCode = fs.readFileSync(serverPath, 'utf8');
if (serverCode.includes('sitemapRoute')) {
  warn('Route sitemap deja presente — skip');
} else {
  const match = serverCode.match(/app\.use\('\/api\//);
  if (match) {
    const idx = serverCode.indexOf(match[0]);
    const injection = "// SEO: Sitemap dynamique\nconst sitemapRoute = require('./routes/sitemapRoute');\napp.use(sitemapRoute);\n\n";
    serverCode = serverCode.slice(0, idx) + injection + serverCode.slice(idx);
    fs.writeFileSync(serverPath, serverCode);
    log('Route sitemap injectee dans server.js');
  } else {
    warn('Impossible de trouver app.use dans server.js');
  }
}

// STEP 4: robots.txt
log('STEP 4: Mise a jour robots.txt');
const robotsTxt = "User-agent: *\nAllow: /\nAllow: /e/\nDisallow: /dashboard\nDisallow: /admin\nDisallow: /api/\nDisallow: /p/\nDisallow: /live/\n\nSitemap: https://fotokash.com/sitemap.xml\n";
fs.writeFileSync('/home/fotokash-frontend/public/robots.txt', robotsTxt);
fs.writeFileSync('/home/fotokash-frontend/dist/robots.txt', robotsTxt);
if (fs.existsSync('/home/fotokash-frontend/dist/sitemap.xml')) {
  fs.unlinkSync('/home/fotokash-frontend/dist/sitemap.xml');
  log('Ancien sitemap.xml statique supprime');
}
log('robots.txt mis a jour');

// STEP 5: SEOHead component
log('STEP 5: Creation composant SEOHead');
const compDir = '/home/fotokash-frontend/src/components';
if (!fs.existsSync(compDir)) fs.mkdirSync(compDir, { recursive: true });

fs.writeFileSync(compDir + '/SEOHead.jsx', [
  "import { useEffect } from 'react';",
  "",
  "const SITE_URL = 'https://fotokash.com';",
  "const DEFAULT_TITLE = 'FotoKash - Achetez vos photos par reconnaissance faciale';",
  "const DEFAULT_DESC = 'Plateforme de vente de photos evenementielles. Retrouvez vos photos par reconnaissance faciale et payez via Mobile Money.';",
  "",
  "export default function SEOHead({ title, description, path, noindex = false }) {",
  "  useEffect(() => {",
  "    const pageTitle = title ? title + ' | FotoKash' : DEFAULT_TITLE;",
  "    const pageDesc = description || DEFAULT_DESC;",
  "    const rawPath = path || window.location.pathname;",
  "    const cleanPath = rawPath === '/' ? '/' : rawPath.replace(/\\/+$/, '');",
  "    const canonicalUrl = SITE_URL + cleanPath;",
  "",
  "    document.title = pageTitle;",
  "",
  "    function setMeta(attr, val, content) {",
  "      let el = document.querySelector('meta[' + attr + '=\"' + val + '\"]');",
  "      if (!el) { el = document.createElement('meta'); el.setAttribute(attr, val); document.head.appendChild(el); }",
  "      el.setAttribute('content', content);",
  "    }",
  "",
  "    let canon = document.querySelector('link[rel=\"canonical\"]');",
  "    if (!canon) { canon = document.createElement('link'); canon.setAttribute('rel', 'canonical'); document.head.appendChild(canon); }",
  "    canon.setAttribute('href', canonicalUrl);",
  "",
  "    setMeta('name', 'description', pageDesc);",
  "    setMeta('name', 'robots', noindex ? 'noindex, nofollow' : 'index, follow');",
  "    setMeta('property', 'og:title', pageTitle);",
  "    setMeta('property', 'og:description', pageDesc);",
  "    setMeta('property', 'og:url', canonicalUrl);",
  "    setMeta('property', 'og:type', 'website');",
  "    setMeta('property', 'og:site_name', 'FotoKash');",
  "  }, [title, description, path, noindex]);",
  "",
  "  return null;",
  "}",
].join('\n'));
log('SEOHead.jsx cree');

// STEP 6: Inject SEOHead in App.jsx
log('STEP 6: Injection SEOHead dans App.jsx');
const appPath = '/home/fotokash-frontend/src/App.jsx';
let appCode = fs.readFileSync(appPath, 'utf8');

if (appCode.includes('SEOHead')) {
  warn('SEOHead deja present dans App.jsx — skip');
} else {
  // Add import at top
  const firstImport = appCode.indexOf('import ');
  if (firstImport >= 0) {
    appCode = appCode.slice(0, firstImport) + "import SEOHead from './components/SEOHead';\n" + appCode.slice(firstImport);
  }

  // Find main component
  const mainMatch = appCode.match(/(function\s+(?:FotoKashApp|App)\s*\([^)]*\)\s*\{)/);
  if (mainMatch) {
    const seoBlock = [
      "",
      "  // SEO: balise canonical dynamique",
      "  const seoConfig = (() => {",
      "    const p = typeof window !== 'undefined' ? window.location.pathname : '/';",
      "    if (p.startsWith('/dashboard') || p.startsWith('/admin')) return { noindex: true };",
      "    if (p.startsWith('/p/')) return { title: 'Telechargement Photo', noindex: true };",
      "    if (p.startsWith('/live/')) return { title: 'Evenement en direct', noindex: true };",
      "    if (p.startsWith('/e/')) return { title: 'Galerie Photos' };",
      "    if (p === '/login') return { title: 'Connexion Photographe' };",
      "    if (p === '/register') return { title: 'Inscription Photographe' };",
      "    return {};",
      "  })();",
      "",
    ].join('\n');
    appCode = appCode.replace(mainMatch[0], mainMatch[0] + seoBlock);

    // Find first return ( after main component and inject <SEOHead />
    const afterComp = appCode.indexOf(mainMatch[0]) + mainMatch[0].length;
    const retIdx = appCode.indexOf('return (', afterComp);
    if (retIdx >= 0) {
      const openParen = appCode.indexOf('(', retIdx);
      const firstTag = appCode.indexOf('<', openParen);
      if (firstTag >= 0) {
        appCode = appCode.slice(0, firstTag) + '<SEOHead {...seoConfig} />\n      ' + appCode.slice(firstTag);
      }
    }
  }
  fs.writeFileSync(appPath, appCode);
  log('SEOHead injecte dans App.jsx');
}

// STEP 7: Rebuild frontend
log('STEP 7: Rebuild du frontend');
const buildOut = run('cd /home/fotokash-frontend && npm run build 2>&1');
if (buildOut) {
  if (buildOut.includes('error') || buildOut.includes('Error')) {
    warn('Build a peut-etre echoue:');
    console.log(buildOut.slice(-500));
  } else {
    log('Frontend rebuild OK');
  }
}
// Re-write robots.txt in dist
fs.writeFileSync('/home/fotokash-frontend/dist/robots.txt', robotsTxt);

// STEP 8: Nginx
log('STEP 8: Mise a jour Nginx');
const nginxPath = '/etc/nginx/sites-available/fotokash';
let nginxCode = fs.readFileSync(nginxPath, 'utf8');

if (nginxCode.includes('rewrite ^(.+)/$ $1 permanent')) {
  warn('Directives SEO deja dans Nginx — skip');
} else {
  const nginxInsert = [
    '',
    '    # SEO: supprimer trailing slash',
    '    rewrite ^(.+)/$ $1 permanent;',
    '',
    '    # SEO: proxy sitemap vers backend',
    '    location = /sitemap.xml {',
    '        proxy_pass http://127.0.0.1:3001/sitemap.xml;',
    '        proxy_set_header Host $host;',
    '        proxy_set_header X-Real-IP $remote_addr;',
    '    }',
    '',
    '    # SEO: headers securite',
    '    add_header X-Frame-Options "SAMEORIGIN" always;',
    '    add_header X-Content-Type-Options "nosniff" always;',
    '    add_header Referrer-Policy "strict-origin-when-cross-origin" always;',
    '',
    '    ',
  ].join('\n');

  if (nginxCode.includes('location /api/ {')) {
    nginxCode = nginxCode.replace('location /api/ {', nginxInsert + 'location /api/ {');
    fs.writeFileSync(nginxPath, nginxCode);
    const testRes = run('nginx -t 2>&1');
    if (testRes && testRes.includes('successful')) {
      run('systemctl reload nginx');
      log('Nginx recharge');
    } else {
      warn('nginx -t echoue ! Verifie manuellement');
      if (testRes) console.log(testRes);
    }
  } else {
    warn('Pattern "location /api/" non trouve dans Nginx');
  }
}

// STEP 9: Restart backend
log('STEP 9: Redemarrage backend');
run('systemctl restart fotokash-backend 2>&1');
log('Backend redemarre');

// VERIFICATIONS
console.log('\n' + '='.repeat(50));
console.log('VERIFICATIONS');
console.log('='.repeat(50));
const s1 = run('curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/sitemap.xml');
console.log('  Sitemap backend: HTTP ' + (s1 ? s1.trim() : 'ERREUR'));
console.log('  robots.txt dist/: ' + (fs.existsSync('/home/fotokash-frontend/dist/robots.txt') ? 'OK' : 'MANQUANT'));
const s2 = run('curl -s -o /dev/null -w "%{http_code}" https://fotokash.com/sitemap.xml 2>/dev/null');
console.log('  Sitemap via Nginx: HTTP ' + (s2 ? s2.trim() : 'ERREUR'));
const s3 = run('curl -s -o /dev/null -w "%{http_code}" https://fotokash.com/robots.txt 2>/dev/null');
console.log('  robots.txt via Nginx: HTTP ' + (s3 ? s3.trim() : 'ERREUR'));

console.log('\n' + '='.repeat(50));
console.log('PROCHAINES ETAPES MANUELLES');
console.log('='.repeat(50));
console.log('  1. Google Search Console > Sitemaps > Ajouter: https://fotokash.com/sitemap.xml');
console.log('  2. Indexation > Pages > Inspecter URLs problematiques > Demander indexation');
console.log('  3. Test: curl -ILs https://fotokash.com/login/');
console.log('='.repeat(50));
console.log('TERMINE !');
