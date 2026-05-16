const fs = require('fs');
const f = '/home/fotokash-frontend/src/App.jsx';
let c = fs.readFileSync(f, 'utf8');

if (c.includes('BOTTOM NAV MOBILE')) {
  console.log('Bottom nav JSX deja present - skip');
  process.exit(0);
}

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

// Trouver le bon point d'insertion
const anchor = '{tab === "account" && <AccountTab token={token} />}\n      </div>';
const anchorIdx = c.indexOf(anchor);

if (anchorIdx === -1) {
  console.log('ERREUR: anchor non trouve. Recherche alternative...');
  // Essai sans newline exact
  const alt = c.indexOf('{tab === "account" && <AccountTab token={token} />}');
  if (alt === -1) {
    console.log('ERREUR: AccountTab non trouve');
    process.exit(1);
  }
  // Trouver le </div> suivant
  const afterAlt = c.indexOf('</div>', alt);
  if (afterAlt === -1) {
    console.log('ERREUR: </div> apres AccountTab non trouve');
    process.exit(1);
  }
  const insertPoint = afterAlt + 6; // apres </div>
  c = c.slice(0, insertPoint) + bottomNav + c.slice(insertPoint);
  console.log('Bottom nav injecte (methode alternative)');
} else {
  const insertPoint = anchorIdx + anchor.length;
  c = c.slice(0, insertPoint) + bottomNav + c.slice(insertPoint);
  console.log('Bottom nav injecte');
}

fs.writeFileSync(f, c);
console.log('OK: fichier sauvegarde');
