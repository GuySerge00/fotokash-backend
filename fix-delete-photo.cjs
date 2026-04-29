const fs = require('fs');
const path = '/home/fotokash-backend/src/routes/photos.js';
let c = fs.readFileSync(path, 'utf8');

// Ajouter la route DELETE avant module.exports
let exportIdx = c.indexOf('module.exports');
if (exportIdx === -1) {
  console.log('module.exports not found');
  process.exit();
}

let newRoute = `
// DELETE /api/photos/:id - Supprimer une photo
router.delete('/:id', async (req, res) => {
  try {
    var photoId = req.params.id;
    // Supprimer les face_embeddings liees
    await pool.query('DELETE FROM face_embeddings WHERE photo_id = $1', [photoId]);
    // Supprimer les downloads lies
    await pool.query('DELETE FROM downloads WHERE photo_id = $1', [photoId]);
    // Supprimer la photo
    var result = await pool.query('DELETE FROM photos WHERE id = $1 RETURNING id', [photoId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Photo introuvable.' });
    }
    res.json({ message: 'Photo supprimee.' });
  } catch (err) {
    console.error('Erreur suppression photo:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

`;

c = c.substring(0, exportIdx) + newRoute + c.substring(exportIdx);
fs.writeFileSync(path, c, 'utf8');
console.log('Delete photo route added');
