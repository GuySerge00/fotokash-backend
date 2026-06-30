const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const { pool } = require('../config/database');

const router = express.Router();

// Calcul du prix selon les packs (dynamique depuis app_settings)
async function calculatePrice(photoCount) {
  try {
    const result = await pool.query("SELECT key, value FROM app_settings WHERE key IN ('photo_price_1','photo_price_6','photo_price_10')");
    const prices = {};
    result.rows.forEach(r => { prices[r.key] = parseInt(r.value); });
    const p1 = prices.photo_price_1 || 200;
    const p6 = prices.photo_price_6 || 500;
    const p10 = prices.photo_price_10 || 1000;
    if (photoCount >= 11) return p10;
    if (photoCount >= 6) return p6;
    return photoCount * p1;
  } catch (err) {
    console.error('Erreur lecture tarifs:', err.message);
    if (photoCount >= 11) return 1000;
    if (photoCount >= 6) return 500;
    return photoCount * 200;
  }
}

// Vérifie la signature HMAC envoyée par le provider/agrégateur
function verifyWebhookSignature(req) {
  const signature = req.headers['x-webhook-signature'];
  if (!signature) return false;

  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!secret) {
    console.error('PAYMENT_WEBHOOK_SECRET non défini dans .env');
    return false;
  }

  const payload = JSON.stringify(req.body);
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false; // longueurs différentes = signature invalide
  }
}

// POST /api/payments/initiate — Initier un paiement Mobile Money
router.post('/initiate', async (req, res) => {
  try {
    const { event_id, photo_ids, payment_method, phone_number } = req.body;

    if (!event_id || !photo_ids?.length || !payment_method || !phone_number) {
      return res.status(400).json({ error: 'Tous les champs sont requis.' });
    }

    if (!['orange', 'mtn', 'wave'].includes(payment_method)) {
      return res.status(400).json({ error: 'Moyen de paiement invalide.' });
    }

    const photosCheck = await pool.query(
      'SELECT id FROM photos WHERE id = ANY($1) AND event_id = $2',
      [photo_ids, event_id]
    );

    if (photosCheck.rows.length !== photo_ids.length) {
      return res.status(400).json({ error: 'Certaines photos sont invalides.' });
    }

    const eventResult = await pool.query(
      'SELECT photographer_id FROM events WHERE id = $1',
      [event_id]
    );

    const amount = await calculatePrice(photo_ids.length);

    const transaction = await pool.query(
      `INSERT INTO transactions (event_id, photographer_id, client_phone, payment_method, amount, photos_purchased, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING id, amount, status`,
      [event_id, eventResult.rows[0].photographer_id, phone_number, payment_method, amount, photo_ids]
    );

    const txId = transaction.rows[0].id;

    let providerResponse;

    try {
      switch (payment_method) {
        case 'orange':
          providerResponse = await initiateOrangeMoney(phone_number, amount, txId);
          break;
        case 'mtn':
          providerResponse = await initiateMTNMomo(phone_number, amount, txId);
          break;
        case 'wave':
          providerResponse = await initiateWave(phone_number, amount, txId);
          break;
      }
    } catch (payErr) {
      await pool.query(
        "UPDATE transactions SET status = 'failed' WHERE id = $1",
        [txId]
      );
      console.error('Erreur paiement provider :', payErr.message);
      return res.status(502).json({ error: 'Le service de paiement est indisponible. Réessayez.' });
    }

    await pool.query(
      'UPDATE transactions SET provider_transaction_id = $1 WHERE id = $2',
      [providerResponse?.transactionId || 'pending', txId]
    );

    res.json({
      transaction_id: txId,
      amount,
      status: 'pending',
      message: `Validez le paiement de ${amount} FCFA sur votre téléphone.`,
    });
  } catch (err) {
    console.error('Erreur initiation paiement :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /api/payments/callback — Webhook du provider Mobile Money
router.post('/callback', async (req, res) => {
  try {
    if (!verifyWebhookSignature(req)) {
      console.warn('Webhook rejeté : signature invalide', req.ip);
      return res.status(401).json({ error: 'Signature invalide.' });
    }

    const { transaction_id, status, provider_id } = req.body;

    const tx = await pool.query(
      'SELECT id, status FROM transactions WHERE provider_transaction_id = $1 OR id = $2',
      [provider_id || '', transaction_id || '']
    );

    if (tx.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction introuvable.' });
    }

    if (tx.rows[0].status !== 'pending') {
      console.log(`Webhook ignoré : transaction ${tx.rows[0].id} déjà au statut ${tx.rows[0].status}`);
      return res.json({ message: 'Callback déjà traité.' });
    }

    const newStatus = status === 'success' ? 'completed' : 'failed';

    await pool.query(
      `UPDATE transactions
       SET status = $1, completed_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE NULL END
       WHERE id = $2 AND status = 'pending'`,
      [newStatus, tx.rows[0].id]
    );

    res.json({ message: 'Callback traité.' });
  } catch (err) {
    console.error('Erreur callback :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// GET /api/payments/:id/status — Vérifier le statut d'un paiement
router.get('/:id/status', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, amount, status, payment_method, photos_purchased, completed_at FROM transactions WHERE id = $1',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction introuvable.' });
    }

    res.json({ transaction: result.rows[0] });
  } catch (err) {
    console.error('Erreur statut :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ===== Fonctions d'intégration Mobile Money =====

async function initiateOrangeMoney(phone, amount, orderId) {
  const response = await axios.post(
    `${process.env.ORANGE_MONEY_API_URL}/webpayment`,
    {
      merchant_key: process.env.ORANGE_MONEY_API_KEY,
      currency: 'OUV',
      order_id: orderId,
      amount,
      return_url: `${process.env.FRONTEND_URL}/payment/success`,
      cancel_url: `${process.env.FRONTEND_URL}/payment/cancel`,
      notif_url: `${process.env.BACKEND_URL}/api/payments/callback`,
      lang: 'fr',
    },
    { headers: { 'Authorization': `Bearer ${process.env.ORANGE_MONEY_TOKEN}` } }
  );
  return { transactionId: response.data?.pay_token || orderId };
}

async function initiateMTNMomo(phone, amount, orderId) {
  const response = await axios.post(
    `${process.env.MTN_MOMO_API_URL}/collection/v1_0/requesttopay`,
    {
      amount: String(amount),
      currency: 'XOF',
      externalId: orderId,
      payer: { partyIdType: 'MSISDN', partyId: phone },
      payerMessage: `FotoKash - Achat photos`,
      payeeNote: `Transaction ${orderId}`,
    },
    {
      headers: {
        'X-Reference-Id': orderId,
        'Ocp-Apim-Subscription-Key': process.env.MTN_MOMO_API_KEY,
        'X-Target-Environment': process.env.MTN_MOMO_ENVIRONMENT || 'sandbox',
      },
    }
  );
  return { transactionId: orderId };
}

async function initiateWave(phone, amount, orderId) {
  const response = await axios.post(
    `${process.env.WAVE_API_URL}/checkout/sessions`,
    {
      amount: String(amount),
      currency: 'XOF',
      error_url: `${process.env.FRONTEND_URL}/payment/cancel`,
      success_url: `${process.env.FRONTEND_URL}/payment/success?tx=${orderId}`,
    },
    { headers: { 'Authorization': `Bearer ${process.env.WAVE_API_KEY}` } }
  );
  return { transactionId: response.data?.id || orderId };
}

module.exports = router;
