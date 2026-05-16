const fs = require('fs');

// STEP 1: Retirer logout de la bottom nav
const layoutJsx = '/home/fotokash-frontend/src/admin/AdminLayout.jsx';
let jsx = fs.readFileSync(layoutJsx, 'utf8');

// Supprimer l'item logout
jsx = jsx.replace(
  /\{ id: 'logout'.*?\},\s*\n\s*/,
  ''
);

// Remettre handleNavigate simple (retirer le ternaire logout)
jsx = jsx.replace(
  "onClick={() => item.id === 'logout' ? onLogout() : handleNavigate(item.id)}",
  "onClick={() => handleNavigate(item.id)}"
);

console.log('STEP 1: logout retire de bottom nav');

// STEP 2: Ajouter un header mobile dans AdminLayout avec logo + logout
// On l'ajoute juste avant <main>
if (jsx.includes('admin-mobile-header')) {
  console.log('STEP 2: SKIP - header mobile deja present');
} else {
  jsx = jsx.replace(
    '<main className="admin-main">',
    [
      '      {/* HEADER MOBILE ADMIN */}',
      '      <div className="admin-mobile-header">',
      '        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>',
      '          <div style={{ width: 32, height: 32, background: "linear-gradient(135deg, #E8593C, #d44a2f)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12, color: "#fff" }}>FK</div>',
      '          <span style={{ fontSize: 16, fontWeight: 600, color: "#f0f0f5" }}>FotoKash <span style={{ fontSize: 10, fontWeight: 600, color: "#E8593C", background: "rgba(232,89,60,0.1)", padding: "2px 8px", borderRadius: 20, marginLeft: 4 }}>Admin</span></span>',
      '        </div>',
      '        <button onClick={onLogout} style={{ background: "none", border: "none", cursor: "pointer", color: "#8b8b9e", display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontFamily: "DM Sans, system-ui, sans-serif" }}>',
      '          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
      '        </button>',
      '      </div>',
      '      <main className="admin-main">',
    ].join('\n')
  );
  console.log('STEP 2: header mobile admin ajoute');
}

fs.writeFileSync(layoutJsx, jsx);

// STEP 3: Ajouter le CSS du header mobile
const layoutCss = '/home/fotokash-frontend/src/admin/AdminLayout.css';
let css = fs.readFileSync(layoutCss, 'utf8');

if (!css.includes('admin-mobile-header')) {
  css += `
.admin-mobile-header {
  display: none;
}
@media (max-width: 768px) {
  .admin-mobile-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    background: #0a0a0f;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    position: sticky;
    top: 0;
    z-index: 50;
  }
}
`;
  fs.writeFileSync(layoutCss, css);
  console.log('STEP 3: CSS header mobile ajoute');
} else {
  console.log('STEP 3: SKIP');
}

console.log('\nTOUT OK');
