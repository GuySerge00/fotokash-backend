const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

const rateLimit = require('express-rate-limit');
const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 tentatives max par IP
  message: { error: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

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

    const existing = await pool.query('SELECT id FROM photographers WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Cet email est déjà utilisé.' });
    }

    const password_hash = await bcrypt.hash(password, 12);

    // Plan FREE par défaut avec ses limites
    const result = await pool.query(
      `INSERT INTO photographers (studio_name, email, password_hash, phone, plan, photo_limit, status, role)
       VALUES ($1, $2, $3, $4, 'free', 100, 'inactive', 'photographer')
       RETURNING id, studio_name, email, plan, photo_limit, role, status, created_at`,
      [studio_name, email.toLowerCase(), password_hash, phone || null]
    );

    const photographer = result.rows[0];

    const token = jwt.sign(
      { id: photographer.id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    // Log inscription dans admin_logs
    await pool.query(
      `INSERT INTO admin_logs (action, entity_type, entity_id, actor_id, actor_name, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ['photographer_registered', 'photographer', photographer.id, photographer.id,
       photographer.studio_name, JSON.stringify({ email: photographer.email, plan: photographer.plan })]
    );

    res.status(201).json({
      message: "Inscription réussie ! Votre compte est en attente d'activation par l'administrateur. Vous recevrez une notification dès que votre compte sera activé.",
      pending: true,
    });
  } catch (err) {
    console.error('Erreur inscription :', err);
    res.status(500).json({ error: 'Erreur serveur.', detail: err.message });
  }
});

// POST /api/auth/login — Connexion
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email et mot de passe requis.' });
    }

    const result = await pool.query(
      'SELECT id, studio_name, email, password_hash, plan, photo_limit, role, status, deleted_at, has_seen_onboarding FROM photographers WHERE email = $1',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
    }

    const photographer = result.rows[0];

    // Bloquer la connexion si compte désactivé ou supprimé
    if (photographer.status === 'inactive' || photographer.deleted_at) {
      return res.status(403).json({ error: 'Votre compte a été désactivé. Contactez l\'administrateur.' });
    }

    const validPassword = await bcrypt.compare(password, photographer.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
    }

    const token = jwt.sign(
      { id: photographer.id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

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
      `SELECT p.id, p.studio_name, p.email, p.phone, p.plan, p.photo_limit, p.role, p.status, p.created_at, p.has_seen_onboarding,
              COALESCE((SELECT COUNT(*) FROM photos ph WHERE ph.photographer_id = p.id), 0) as total_photos,
              COALESCE((SELECT COUNT(*) FROM events e WHERE e.photographer_id = p.id), 0) as total_events,
              COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.photographer_id = p.id AND t.status = 'completed'), 0) as total_revenue
       FROM photographers p
       WHERE p.id = $1`,
      [req.user.id]
    );

    // Récupérer les infos du plan
    const planResult = await pool.query(
      'SELECT * FROM subscription_plans WHERE id = $1',
      [result.rows[0]?.plan || 'free']
    );

    const user = result.rows[0];
    user.plan_details = planResult.rows[0] || null;

    res.json({ user });
  } catch (err) {
    console.error('Erreur profil :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// PUT /api/auth/change-password — Changer son mot de passe
router.put('/change-password', authMiddleware, async (req, res) => {
  try {
    var currentPassword = req.body.current_password;
    var newPassword = req.body.new_password;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Mot de passe actuel et nouveau requis.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Le nouveau mot de passe doit faire au moins 6 caracteres.' });
    }
    var result = await pool.query('SELECT password_hash FROM photographers WHERE id = $1', [req.user.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Compte introuvable.' });
    }
    var validPassword = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Mot de passe actuel incorrect.' });
    }
    var newHash = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE photographers SET password_hash = $1, updated_at = NOW() WHERE id = $2', [newHash, req.user.id]);
    res.json({ message: 'Mot de passe modifie avec succes !' });
  } catch (err) {
    console.error('Erreur changement mot de passe:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
