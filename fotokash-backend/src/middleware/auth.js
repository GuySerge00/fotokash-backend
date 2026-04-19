const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');

// Vérifie le token JWT et attache le photographe à req.user
const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token manquant. Veuillez vous connecter.' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const result = await pool.query(
      'SELECT id, studio_name, email, plan, photo_limit FROM photographers WHERE id = $1',
      [decoded.id]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Compte introuvable.' });
    }

    req.user = result.rows[0];
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expirée. Reconnectez-vous.' });
    }
    return res.status(401).json({ error: 'Token invalide.' });
  }
};

// Optionnel : vérifie si le photographe possède la ressource
const ownsResource = (resourceType) => async (req, res, next) => {
  try {
    const resourceId = req.params.id;
    let query;

    switch (resourceType) {
      case 'event':
        query = 'SELECT id FROM events WHERE id = $1 AND photographer_id = $2';
        break;
      case 'photo':
        query = 'SELECT id FROM photos WHERE id = $1 AND photographer_id = $2';
        break;
      default:
        return next();
    }

    const result = await pool.query(query, [resourceId, req.user.id]);
    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Accès refusé.' });
    }

    next();
  } catch (err) {
    return res.status(500).json({ error: 'Erreur de vérification.' });
  }
};

module.exports = { authMiddleware, ownsResource };
