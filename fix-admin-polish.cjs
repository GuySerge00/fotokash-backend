const fs = require('fs');

// STEP 1: Dashboard.css — améliorer la media query mobile
const dashCss = '/home/fotokash-frontend/src/admin/pages/Dashboard.css';
let css = fs.readFileSync(dashCss, 'utf8');

// Remplacer la media query 768px existante
css = css.replace(
  /@media \(max-width: 768px\) \{[^}]*(?:\{[^}]*\}[^}]*)*\}/,
  `@media (max-width: 768px) {
  .dashboard { padding: 0; }
  .dashboard-header { margin-bottom: 16px; flex-direction: column; gap: 12px; }
  .dashboard-title { font-size: 20px; }
  .dashboard-subtitle { font-size: 12px; }
  .kpi-grid { grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 16px; }
  .kpi-card { padding: 14px; }
  .kpi-card:last-child { grid-column: 1 / -1; flex-direction: row; align-items: center; justify-content: space-between; }
  .kpi-card:last-child .kpi-content { flex-direction: row; align-items: center; gap: 12px; }
  .kpi-value { font-size: 22px; }
  .kpi-icon { width: 30px; height: 30px; font-size: 14px; }
  .dashboard-bottom { grid-template-columns: 1fr; gap: 10px; }
  .chart-card, .sales-card { padding: 14px; }
  .period-selector { flex-wrap: nowrap; }
  .period-btn { padding: 6px 10px; font-size: 11px; }
}`
);

fs.writeFileSync(dashCss, css);
console.log('STEP 1: Dashboard.css mobile ameliore');

// STEP 2: Dashboard.jsx — Visiteurs pleine largeur + header filtres sur une ligne
const dashJsx = '/home/fotokash-frontend/src/admin/pages/Dashboard.jsx';
let jsx = fs.readFileSync(dashJsx, 'utf8');

// Rendre la carte visiteurs pleine largeur sur mobile
jsx = jsx.replace(
  'display: "inline-flex", alignItems: "center", gap: 12, marginBottom: 20',
  'display: "flex", alignItems: "center", gap: 12, marginBottom: 16, width: "100%", justifyContent: "space-between"'
);

// Raccourcir les labels période pour mobile
jsx = jsx.replace(
  "{ key: '7d', label: '7 jours' },",
  "{ key: '7d', label: '7j' },"
);
jsx = jsx.replace(
  "{ key: '30d', label: '30 jours' },",
  "{ key: '30d', label: '30j' },"
);

fs.writeFileSync(dashJsx, jsx);
console.log('STEP 2: Dashboard.jsx visiteurs pleine largeur + labels courts');

console.log('\nTOUT OK');
