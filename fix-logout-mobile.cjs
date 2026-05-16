const fs = require('fs');
const f = '/home/fotokash-frontend/src/App.jsx';
let c = fs.readFileSync(f, 'utf8');

if (c.includes('mobile-logout-btn')) {
  console.log('SKIP: bouton logout mobile deja present');
  process.exit(0);
}

// Ajouter le CSS pour le bouton mobile
c = c.replace(
  '.mobile-bottom-nav { display: none !important; }',
  '.mobile-bottom-nav { display: none !important; }\n    .mobile-logout-btn { display: none !important; }'
);
c = c.replace(
  '.desktop-tab-bar { display: none !important; }',
  '.desktop-tab-bar { display: none !important; }\n    .mobile-logout-btn { display: flex !important; }'
);

// Ajouter le bouton logout dans le header, juste avant la fermeture de </header>
const logoutBtn = [
  '',
  '        <button className="mobile-logout-btn" onClick={onLogout} style={{',
  '          background: "none", border: "none", color: T.textMuted,',
  '          cursor: "pointer", display: "none", alignItems: "center",',
  '          fontSize: 12, padding: 6,',
  '        }}>',
  '          {Icon.LogOut(18)}',
  '        </button>',
].join('\n');

// Trouver la fin du header - juste avant </header>
// Le header contient desktop-header-extras, on insere apres ce div et avant </header>
const headerEnd = c.indexOf('      </header>');
if (headerEnd === -1) {
  console.log('ERREUR: </header> non trouve');
  process.exit(1);
}

c = c.slice(0, headerEnd) + logoutBtn + '\n' + c.slice(headerEnd);
console.log('OK: bouton logout mobile ajoute');

fs.writeFileSync(f, c);
