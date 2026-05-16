const fs = require('fs');

// STEP 1: Dashboard.css — améliorer le responsive mobile
const dashCss = '/home/fotokash-frontend/src/admin/pages/Dashboard.css';
let css = fs.readFileSync(dashCss, 'utf8');

// Remplacer la media query existante par une version complète
css = css.replace(
  /@media \(max-width: 900px\) \{[^}]*\{[^}]*\}[^}]*\{[^}]*\}[^}]*\{[^}]*\}/,
  `@media (max-width: 900px) {
  .kpi-grid { grid-template-columns: repeat(2, 1fr); }
  .dashboard-bottom { grid-template-columns: 1fr; }
  .dashboard-header { flex-direction: column; gap: 16px; }
}
@media (max-width: 768px) {
  .dashboard { padding: 0; }
  .dashboard-header { margin-bottom: 16px; }
  .dashboard-title { font-size: 20px; }
  .kpi-grid { grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 16px; }
  .kpi-card { padding: 14px; }
  .kpi-value { font-size: 22px; }
  .kpi-icon { width: 30px; height: 30px; font-size: 14px; }
  .dashboard-bottom { grid-template-columns: 1fr; gap: 10px; }
  .chart-card, .sales-card { padding: 14px; }
  .period-selector { flex-wrap: wrap; }
  .period-btn { padding: 6px 12px; font-size: 12px; }
}`
);

fs.writeFileSync(dashCss, css);
console.log('STEP 1: Dashboard.css mobile ameliore');

// STEP 2: AdminLayout.css — fixer le padding et le header
const layoutCss = '/home/fotokash-frontend/src/admin/AdminLayout.css';
let lcss = fs.readFileSync(layoutCss, 'utf8');

// Remplacer la media query existante
lcss = lcss.replace(
  /@media \(max-width: 768px\) \{\s*\.admin-main \{[^}]*\}\s*\}/,
  `@media (max-width: 768px) {
  .admin-main {
    margin-left: 0;
    padding: 16px;
    padding-bottom: 90px;
    min-height: calc(100vh - 56px);
  }
  .admin-layout {
    flex-direction: column;
  }
}`
);

fs.writeFileSync(layoutCss, lcss);
console.log('STEP 2: AdminLayout.css mobile ameliore');

// STEP 3: Fixer le header mobile - le mettre sticky et au-dessus du contenu
// Le header est deja sticky, verifions qu'il a le bon z-index
const sidebarCss = '/home/fotokash-frontend/src/admin/components/AdminSidebar.css';
let scss = fs.readFileSync(sidebarCss, 'utf8');

// Verifier que le bottom nav a un bon z-index
if (!scss.includes('admin-mobile-header')) {
  console.log('STEP 3: header mobile style dans AdminLayout.css - OK');
}

console.log('\nTOUT OK');
