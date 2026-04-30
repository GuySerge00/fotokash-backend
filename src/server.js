const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Import des routes
const authRoutes = require('./routes/auth');
const eventRoutes = require('./routes/events');
const photoRoutes = require('./routes/photos');
const paymentRoutes = require('./routes/payments');
const adminRoutes = require('./routes/admin');
const liveRoutes = require('./routes/live');

const app = express();
const PORT = process.env.PORT || 3001;

// Trust proxy (nécessaire sur Railway, Render, etc.)
app.set('trust proxy', 1);

// ===== SÉCURITÉ =====
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL === '*' ? '*' : (process.env.FRONTEND_URL || 'http://localhost:3000'),
  credentials: process.env.FRONTEND_URL !== '*',
}));

// Rate limiting global
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5000,
  message: { error: 'Trop de requêtes. Réessayez dans quelques minutes.' },
}));

// Rate limiting spécifique pour la recherche faciale (plus coûteuse)
const faceSearchLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 500,
  message: { error: 'Trop de recherches. Attendez un moment.' },
});

// ===== PARSING =====
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Mode maintenance
app.use(async (req, res, next) => {
  if (req.path === '/api/health' || req.path.startsWith('/api/admin') || req.path === '/api/auth/login') return next();
  try {
    var { pool } = require('./config/database');
    var result = await pool.query("SELECT value FROM app_settings WHERE key = 'maintenance_mode'");
    if (result.rows[0] && result.rows[0].value === 'true') {
      return res.status(503).json({ error: 'FotoKash est en maintenance. Revenez bientot.', maintenance: true });
    }
  } catch(e) {}
  next();
});


// ===== ROUTES API =====
app.use('/api/auth', authRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/photos', photoRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/live', liveRoutes);

// ===== ROUTE DE SANTÉ =====
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'FotoKash API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ===== GESTION DES ERREURS =====
app.use((err, req, res, next) => {
  console.error('Erreur serveur :', err);

  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Fichier trop volumineux. Maximum 25 Mo.' });
  }

  if (err.code === 'LIMIT_FILE_COUNT') {
    return res.status(400).json({ error: 'Maximum 50 photos par upload.' });
  }

  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Erreur serveur interne.'
      : err.message,
  });
});

// Route 404
app.use((req, res) => {
  res.status(404).json({ error: 'Route introuvable.' });
});

// ===== DÉMARRAGE =====
console.log('ENV VARS:', Object.keys(process.env).filter(k => k.includes('DATABASE') || k.includes('PG') || k.includes('NODE')));
app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════╗
  ║         FotoKash API Server               ║
  ║         Port: ${PORT}                        ║
  ║         Env: ${process.env.NODE_ENV || 'development'}              ║
  ╚═══════════════════════════════════════════╝

  Routes disponibles :
  • POST   /api/auth/signup          → Inscription
  • POST   /api/auth/login           → Connexion
  • GET    /api/auth/me              → Profil

  • GET    /api/events               → Mes événements
  • POST   /api/events               → Créer événement
  • GET    /api/events/:slug/public  → Page publique
  • PUT    /api/events/:id           → Modifier
  • DELETE /api/events/:id           → Supprimer

  • POST   /api/photos/upload        → Upload photos
  • GET    /api/photos/event/:id/public → Galerie publique
  • GET    /api/photos/qr/:code      → Accès par QR
  • POST   /api/photos/face-search   → Recherche faciale
  • GET    /api/photos/:id/download  → Télécharger HD

  • POST   /api/payments/initiate    → Initier paiement
  • POST   /api/payments/callback    → Webhook provider
  • GET    /api/payments/:id/status  → Statut paiement
  `);
});

module.exports = app;
