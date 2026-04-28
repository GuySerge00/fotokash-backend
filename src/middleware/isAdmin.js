// middleware/isAdmin.js
// Middleware pour protéger les routes admin FotoKash

const isAdmin = (req, res, next) => {
  // Vérifie que l'utilisateur est authentifié (via le middleware auth existant)
  if (!req.user) {
    return res.status(401).json({ error: 'Non authentifié' });
  }

  // Vérifie le rôle admin
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Accès refusé. Droits administrateur requis.' });
  }

  next();
};

module.exports = isAdmin;
