const fs = require('fs');

// STEP 1: AdminLayout.css — ajouter media queries
const layoutCss = '/home/fotokash-frontend/src/admin/AdminLayout.css';
let css1 = fs.readFileSync(layoutCss, 'utf8');

if (!css1.includes('@media')) {
  css1 += `

/* ═══ RESPONSIVE MOBILE ═══ */
@media (max-width: 768px) {
  .admin-main {
    margin-left: 0;
    padding: 16px;
    padding-bottom: 90px;
  }
}
`;
  fs.writeFileSync(layoutCss, css1);
  console.log('STEP 1: AdminLayout.css responsive ajoute');
} else {
  console.log('STEP 1: SKIP - deja responsive');
}

// STEP 2: AdminSidebar.css — cacher sidebar sur mobile
const sidebarCss = '/home/fotokash-frontend/src/admin/components/AdminSidebar.css';
let css2 = fs.readFileSync(sidebarCss, 'utf8');

if (!css2.includes('@media')) {
  css2 += `
}

/* ═══ RESPONSIVE MOBILE ═══ */
@media (max-width: 768px) {
  .admin-sidebar {
    display: none;
  }
}
@media (min-width: 769px) {
  .admin-bottom-nav {
    display: none !important;
  }
}

.admin-bottom-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: #0a0a0f;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  justify-content: space-around;
  align-items: center;
  padding: 8px 0 20px;
  z-index: 100;
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}
.admin-bottom-nav button {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 8px;
  font-family: 'DM Sans', system-ui, sans-serif;
  position: relative;
}
.admin-bottom-nav button .nav-icon {
  color: #8b8b9e;
  transition: color 0.2s;
}
.admin-bottom-nav button.active .nav-icon {
  color: #E8593C;
}
.admin-bottom-nav button .nav-label {
  font-size: 10px;
  font-weight: 500;
  color: #8b8b9e;
  transition: color 0.2s;
}
.admin-bottom-nav button.active .nav-label {
  font-weight: 700;
  color: #E8593C;
}
.admin-bottom-nav button .nav-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #E8593C;
  margin-top: -1px;
}
`;
  fs.writeFileSync(sidebarCss, css2);
  console.log('STEP 2: AdminSidebar.css responsive + bottom nav styles ajoutes');
} else {
  console.log('STEP 2: SKIP - deja responsive');
}

// STEP 3: AdminLayout.jsx — ajouter bottom nav mobile
const layoutJsx = '/home/fotokash-frontend/src/admin/AdminLayout.jsx';
let jsx = fs.readFileSync(layoutJsx, 'utf8');

if (jsx.includes('admin-bottom-nav')) {
  console.log('STEP 3: SKIP - bottom nav deja present');
} else {
  // Ajouter la bottom nav avant la fermeture du toast stack div
  const bottomNav = `
      {/* ADMIN BOTTOM NAV MOBILE */}
      <div className="admin-bottom-nav">
        {[
          { id: 'dashboard', label: 'Dashboard', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg> },
          { id: 'photographers', label: 'Photos', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> },
          { id: 'subscriptions', label: 'Plans', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> },
          { id: 'logs', label: 'Logs', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> },
          { id: 'settings', label: 'Config', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> },
        ].map((item) => (
          <button key={item.id} className={currentPage === item.id ? 'active' : ''} onClick={() => handleNavigate(item.id)}>
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
            {currentPage === item.id && <span className="nav-dot" />}
          </button>
        ))}
      </div>`;

  // Injecter avant le toast stack
  const toastAnchor = '      {/* Toast stack */}';
  if (jsx.includes(toastAnchor)) {
    jsx = jsx.replace(toastAnchor, bottomNav + '\n' + toastAnchor);
    console.log('STEP 3: Bottom nav admin injecte');
  } else {
    console.log('STEP 3: ERREUR - toast anchor non trouve');
  }

  fs.writeFileSync(layoutJsx, jsx);
}

console.log('\nTOUT OK: Admin responsive applique');
