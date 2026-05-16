const fs = require('fs');
const f = '/home/fotokash-frontend/src/App.jsx';
let c = fs.readFileSync(f, 'utf8');

// 1. Rendre le nav landing responsive
c = c.replace(
  'padding: "20px 32px", borderBottom: `1px solid ${T.border}`,',
  'padding: "16px 20px", borderBottom: `1px solid ${T.border}`, flexWrap: "wrap", gap: 10,'
);

// 2. Réduire la taille des boutons nav sur mobile — on raccourcit les textes
// Pas besoin de changer les textes, juste réduire le padding du Btn sur petit écran
// Ajoutons une classe au nav
c = c.replace(
  '<nav style={{\n        display: "flex", justifyContent: "space-between", alignItems: "center",',
  '<nav className="landing-nav" style={{\n        display: "flex", justifyContent: "space-between", alignItems: "center",'
);

// 3. Ajouter le CSS responsive pour le nav landing dans globalCSS
c = c.replace(
  '  @media (max-width: 768px) {',
  '  @media (max-width: 768px) {\n    .landing-nav { padding: 12px 14px !important; }\n    .landing-nav button { padding: 8px 14px !important; font-size: 12px !important; }'
);

fs.writeFileSync(f, c);
console.log('OK: landing nav responsive');
