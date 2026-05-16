const fs = require('fs');
const f = '/home/fotokash-frontend/src/App.jsx';
let c = fs.readFileSync(f, 'utf8');

// STEP 1: Ajouter CSS responsive dans globalCSS
const oldCSS = "input, select, textarea { font-family: ${T.font}; }\n`;";
const newCSS = 'input, select, textarea { font-family: ${T.font}; }\n' +
  '  @media (max-width: 768px) {\n' +
  '    .desktop-tab-bar { display: none !important; }\n' +
  '    .desktop-header-extras { display: none !important; }\n' +
  '    .dashboard-content { padding: 16px !important; padding-bottom: 90px !important; }\n' +
  '    .header-main { padding: 12px 16px !important; }\n' +
  '  }\n' +
  '  @media (min-width: 769px) {\n' +
  '    .mobile-bottom-nav { display: none !important; }\n' +
  '  }\n' +
  '`;';

if (c.includes(oldCSS)) {
  c = c.replace(oldCSS, newCSS);
  console.log('STEP 1: CSS responsive ajoute');
} else {
  console.log('STEP 1: SKIP - CSS deja modifie ou pattern non trouve');
}

// STEP 2: className sur tab bar
const oldTabBar = '<div style={{\n        display: "flex", gap: 4, padding: "12px 28px",';
const newTabBar = '<div className="desktop-tab-bar" style={{\n        display: "flex", gap: 4, padding: "12px 28px",';
if (c.includes(oldTabBar) && !c.includes('className="desktop-tab-bar"')) {
  c = c.replace(oldTabBar, newTabBar);
  console.log('STEP 2: className desktop-tab-bar ajoute');
} else {
  console.log('STEP 2: SKIP');
}

// STEP 3: className sur header extras
const oldExtras = '<div style={{ display: "flex", alignItems: "center", gap: 16 }}>\n          {liveCount > 0 && (';
const newExtras = '<div className="desktop-header-extras" style={{ display: "flex", alignItems: "center", gap: 16 }}>\n          {liveCount > 0 && (';
if (c.includes(oldExtras) && !c.includes('className="desktop-header-extras"')) {
  c = c.replace(oldExtras, newExtras);
  console.log('STEP 3: className desktop-header-extras ajoute');
} else {
  console.log('STEP 3: SKIP');
}

// STEP 4: className sur dashboard content
const oldContent = '<div style={{ padding: "28px", maxWidth: 1100, margin: "0 auto" }}>';
const newContent = '<div className="dashboard-content" style={{ padding: "28px", maxWidth: 1100, margin: "0 auto" }}>';
if (c.includes(oldContent) && !c.includes('className="dashboard-content"')) {
  c = c.replace(oldContent, newContent);
  console.log('STEP 4: className dashboard-content ajoute');
} else {
  console.log('STEP 4: SKIP');
}

// STEP 5: className sur header
const oldHeader = '<header style={{\n        display: "flex", justifyContent: "space-between", alignItems: "center",\n        padding: "16px 28px",';
const newHeader = '<header className="header-main" style={{\n        display: "flex", justifyContent: "space-between", alignItems: "center",\n        padding: "16px 28px",';
if (c.includes(oldHeader) && !c.includes('className="header-main"')) {
  c = c.replace(oldHeader, newHeader);
  console.log('STEP 5: className header-main ajoute');
} else {
  console.log('STEP 5: SKIP');
}

// STEP 6: Injecter bottom nav mobile
if (c.includes('mobile-bottom-nav')) {
  console.log('STEP 6: SKIP - bottom nav deja present');
} else {
  const bottomNav = [
    '',
    '      {/* BOTTOM NAV MOBILE */}',
    '      <div className="mobile-bottom-nav" style={{',
    '        position: "fixed", bottom: 0, left: 0, right: 0,',
    '        background: T.card, borderTop: `1px solid ${T.border}`,',
    '        display: "flex", justifyContent: "space-around", alignItems: "center",',
    '        padding: "8px 0 20px", zIndex: 100,',
    '        backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",',
    '      }}>',
    '        {tabs.map((t) => {',
    '          const isActive = tab === t.id;',
    '          return (',
    '            <button key={t.id} onClick={() => { setTab(t.id); onNavigate("dashboard", { tab: t.id }); }} style={{',
    '              display: "flex", flexDirection: "column", alignItems: "center", gap: 3,',
    '              background: "none", border: "none", cursor: "pointer",',
    '              padding: "4px 12px", position: "relative", fontFamily: T.font,',
    '            }}>',
    '              <div style={{ color: isActive ? T.accent : T.textMuted, transition: "color 0.2s" }}>{t.icon}</div>',
    '              <span style={{ fontSize: 10, fontWeight: isActive ? 700 : 500, color: isActive ? T.accent : T.textMuted, transition: "color 0.2s" }}>{t.label}</span>',
    '              {isActive && <div style={{ width: 4, height: 4, borderRadius: "50%", background: T.accent, marginTop: -1 }} />}',
    '              {t.badge > 0 && <div style={{ position: "absolute", top: 0, right: 6, width: 14, height: 14, borderRadius: "50%", background: T.red, color: "#fff", fontSize: 8, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{t.badge}</div>}',
    '            </button>',
    '          );',
    '        })}',
    '      </div>',
  ].join('\n');

  const anchor = '{tab === "account" && <AccountTab token={token} />}\n      </div>\n    </div>';
  if (c.includes(anchor)) {
    c = c.replace(anchor, '{tab === "account" && <AccountTab token={token} />}\n      </div>' + bottomNav + '\n    </div>');
    console.log('STEP 6: Bottom nav mobile injecte');
  } else {
    console.log('STEP 6: ERREUR - anchor non trouve');
  }
}

fs.writeFileSync(f, c);
console.log('\nTOUT OK: Modifications responsive appliquees');
