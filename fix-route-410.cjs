const fs = require('fs');
const FILE = '/home/fotokash-backend/src/routes/events.js';
let code = fs.readFileSync(FILE, 'utf8');

var OLD_QUERY = "WHERE e.slug = $1 AND e.is_public = true\n       GROUP BY";
var NEW_BLOCK = "WHERE e.slug = $1 AND e.is_public = true AND e.deleted_at IS NULL\n       GROUP BY";

// Etape 1: Ajouter le filtre deleted_at IS NULL a la requete existante
if (code.includes(OLD_QUERY)) {
  code = code.replace(OLD_QUERY, NEW_BLOCK);
  console.log("OK: Filtre deleted_at IS NULL ajoute.");
} else if (code.includes("AND e.deleted_at IS NULL")) {
  console.log("SKIP: Filtre deja present.");
} else {
  console.error("ERREUR: Query anchor non trouvee!");
  process.exit(1);
}

// Etape 2: Ajouter le check soft delete avant la requete principale
var ROUTE_START = "router.get('/:slug/public', async (req, res) => {\n  try {";

var CHECK_DELETED = "router.get('/:slug/public', async (req, res) => {\n  try {\n" +
"    // Verifier si evenement soft-deleted\n" +
"    var checkDel = await pool.query(\n" +
"      'SELECT e.id, e.name, e.deleted_at, p.studio_name as photographer_name, p.phone as photographer_phone FROM events e JOIN photographers p ON p.id = e.photographer_id WHERE e.slug = $1',\n" +
"      [req.params.slug]\n" +
"    );\n" +
"    if (checkDel.rows.length > 0 && checkDel.rows[0].deleted_at) {\n" +
"      return res.status(410).json({\n" +
"        deleted: true,\n" +
"        event_name: checkDel.rows[0].name,\n" +
"        photographer_name: checkDel.rows[0].photographer_name,\n" +
"        photographer_phone: checkDel.rows[0].photographer_phone,\n" +
"      });\n" +
"    }";

if (code.includes("checkDel")) {
  console.log("SKIP: Check soft delete deja present.");
} else if (code.includes(ROUTE_START)) {
  code = code.replace(ROUTE_START, CHECK_DELETED);
  console.log("OK: Check soft delete 410 ajoute.");
} else {
  console.error("ERREUR: Route start anchor non trouvee!");
  process.exit(1);
}

fs.writeFileSync(FILE, code, 'utf8');
console.log("\n=== DONE ===");
console.log("Prochaine etape: systemctl restart fotokash-backend");

