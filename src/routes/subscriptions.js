const express = require('express');
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const paymentProvider = require('../services/paymentProvider');
const router = express.Router();

// POST /api/subscriptions/upgrade/initiate — Le photographe paie pour changer de plan.
router.post('/upgrade/initiate', authMiddleware, async (req, res) => {
  try {
    var planId = req.body.plan_id;
    var paymentMethod = req.body.payment_method;
    var phoneNumber = req.body.phone_number;

    if (!planId || !paymentMethod || !phoneNumber) {
      return res.status(400).json({ error: 'Tous les champs sont requis.' });
    }
    if (['orange', 'mtn', 'wave'].indexOf(paymentMethod) === -1) {
      return res.status(400).json({ error: 'Moyen de paiement invalide.' });
    }

    var planCheck = await pool.query('SELECT * FROM subscription_plans WHERE id = $1', [planId]);
    if (planCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Plan invalide.' });
    }
    var plan = planCheck.rows[0];
    if (parseFloat(plan.price) <= 0) {
      return res.status(400).json({ error: 'Ce plan ne necessite pas de paiement.' });
    }

    var payment = await pool.query(
      "INSERT INTO subscription_payments (photographer_id, plan_id, amount, payment_method, phone, provider, status) VALUES ($1, $2, $3, $4, $5, $6, 'pending') RETURNING id",
      [req.user.id, planId, plan.price, paymentMethod, phoneNumber, paymentProvider.getActiveProviderName()]
    );
    var paymentId = payment.rows[0].id;

    var providerResponse;
    try {
      providerResponse = await paymentProvider.initiatePayment({
        amount: plan.price,
        phone: phoneNumber,
        orderId: paymentId,
        method: paymentMethod,
        slug: '',
        basePath: '/dashboard/abonnement',
      });
    } catch (payErr) {
      await pool.query("UPDATE subscription_payments SET status = 'failed' WHERE id = $1", [paymentId]);
      console.error('Erreur paiement abonnement :', payErr.message);
      return res.status(502).json({ error: 'Le service de paiement est indisponible. Reessayez.' });
    }

    var reference = (providerResponse && providerResponse.transactionId) || 'pending';
    var paymentUrl = (providerResponse && providerResponse.raw && (providerResponse.raw.payment_url || providerResponse.raw.checkout_url)) || null;

    await pool.query('UPDATE subscription_payments SET reference = $1 WHERE id = $2', [reference, paymentId]);

    res.json({
      payment_id: paymentId,
      amount: plan.price,
      status: 'pending',
      payment_url: paymentUrl,
      message: paymentUrl
        ? 'Ouvrez la fenetre de paiement pour valider votre transaction.'
        : 'Validez le paiement de ' + plan.price + ' FCFA sur votre telephone.',
    });
  } catch (err) {
    console.error('Erreur initiation upgrade :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// GET /api/subscriptions/upgrade/:id/status — Poll du statut, meme pattern que /payments/:id/status.
router.get('/upgrade/:id/status', authMiddleware, async (req, res) => {
  try {
    var result = await pool.query(
      'SELECT id, status, plan_id FROM subscription_payments WHERE id = $1 AND photographer_id = $2',
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Paiement introuvable.' });
    }
    res.json({ payment: result.rows[0] });
  } catch (err) {
    console.error('Erreur statut upgrade :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// GET /api/subscriptions/plans — Liste des plans disponibles (pour le photographe).
router.get('/plans', authMiddleware, async (req, res) => {
  try {
    var result = await pool.query('SELECT * FROM subscription_plans ORDER BY price ASC');
    res.json({ plans: result.rows });
  } catch (err) {
    console.error('Erreur liste plans :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
