const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/signup — Inscription photographe
router.post('/signup', async (req, res) => {
  try {
    const { studio_name, email, password, phone } = req.body;

    if (!studio_name || !email || !password) {
      return res.status(400).json({ error: 'Nom du studio, email et mot de passe requis.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Le mot de passe doit faire au moins 6 caractères.' });
    }

    // Vérifier si l'email existe déjà
    const existing = await pool.query('SELECT id FROM photographers WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Cet email est déjà utilisé.' });
    }

    // Hasher le mot de passe
    const password_hash = await bcrypt.hash(password, 12);

    // Créer le compte
    const result = await pool.query(
      `INSERT INTO photographers (studio_name, email, password_hash, phone)
       VALUES ($1, $2, $3, $4)
       RETURNING id, studio_name, email, plan, photo_limit, created_at`,
      [studio_name, email.toLowerCase(), password_hash, phone || null]
    );

    const photographer = result.rows[0];

    // Générer le token JWT
    const token = jwt.sign(
      { id: photographer.id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.status(201).json({
      message: 'Compte créé avec succès !',
      token,
      user: photographer,
    });
  } catch (err) {
    console.error('Erreur inscription :', err);
    res.status(500).json({ error: 'Erreur serveur.', detail: err.message });
  }
});

// POST /api/auth/login — Connexion
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email et mot de passe requis.' });
    }

    // Chercher le photographe
    const result = await pool.query(
      'SELECT id, studio_name, email, password_hash, plan, photo_limit FROM photographers WHERE email = $1',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
    }

    const photographer = result.rows[0];

    // Vérifier le mot de passe
    const validPassword = await bcrypt.compare(password, photographer.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
    }

    // Générer le token
    const token = jwt.sign(
      { id: photographer.id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    // Ne pas renvoyer le hash du mot de passe
    delete photographer.password_hash;

    res.json({
      message: 'Connexion réussie !',
      token,
      user: photographer,
    });
  } catch (err) {
    console.error('Erreur connexion :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// GET /api/auth/me — Profil du photographe connecté
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.studio_name, p.email, p.phone, p.plan, p.photo_limit, p.created_at,
              COUNT(DISTINCT ph.id) as total_photos,
              COUNT(DISTINCT e.id) as total_events,
              COALESCE(SUM(CASE WHEN t.status = 'completed' THEN t.amount ELSE 0 END), 0) as total_revenue
       FROM photographers p
       LEFT JOIN photos ph ON ph.photographer_id = p.id
       LEFT JOIN events e ON e.photographer_id = p.id
       LEFT JOIN transactions t ON t.photographer_id = p.id
       WHERE p.id = $1
       GROUP BY p.id`,
      [req.user.id]
    );

    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('Erreur profil :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
