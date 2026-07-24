const express = require('express');
const { pool } = require('../config/database');
const paymentProvider = require('../services/paymentProvider');
const { computePriceForEvent } = require('../services/pricing');

const router = express.Router();

async function calculatePrice(photoCount) {
  try {
    const result = await pool.query("SELECT key, value FROM app_settings WHERE key IN ('photo_price_1','photo_price_3','photo_price_5')");
    const prices = {};
    result.rows.forEach(function(r) { prices[r.key] = parseInt(r.value); });
    const p1 = prices.photo_price_1 || 200;
    const p3 = prices.photo_price_3 || 500;
    const p5 = prices.photo_price_5 || 1000;
    if (photoCount >= 5) return p5;
    if (photoCount >= 3) return p3;
    return photoCount * p1;
  } catch (err) {
    console.error('Erreur lecture tarifs:', err.message);
    if (photoCount >= 5) return 1000;
    if (photoCount >= 3) return 500;
    return photoCount * 200;
  }
}

router.post('/initiate', async (req, res) => {
  try {
    const event_id = req.body.event_id;
    const photo_ids = req.body.photo_ids;
    const payment_method = req.body.payment_method;
    const phone_number = req.body.phone_number;
    const context = req.body.context === 'live' ? 'live' : 'client';
    const basePath = context === 'live' ? '/live/' : '/e/';

    if (!event_id || !photo_ids || !photo_ids.length || !payment_method || !phone_number) {
      return res.status(400).json({ error: 'Tous les champs sont requis.' });
    }

    if (['orange', 'mtn', 'wave'].indexOf(payment_method) === -1) {
      return res.status(400).json({ error: 'Moyen de paiement invalide.' });
    }

    const photosCheck = await pool.query(
      'SELECT id FROM photos WHERE id = ANY($1) AND event_id = $2 AND deleted_at IS NULL',
      [photo_ids, event_id]
    );

    if (photosCheck.rows.length !== photo_ids.length) {
      return res.status(400).json({ error: 'Certaines photos sont invalides.' });
    }

    const eventResult = await pool.query(
      'SELECT photographer_id, slug FROM events WHERE id = $1',
      [event_id]
    );

    const pricing = await computePriceForEvent(event_id, photo_ids.length);
    const amount = pricing.amount;
    const providerName = paymentProvider.getActiveProviderName();

    const transaction = await pool.query(
      "INSERT INTO transactions (event_id, photographer_id, phone, payment_method, provider, amount, photos_purchased, status) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending') RETURNING id, amount, status",
      [event_id, eventResult.rows[0].photographer_id, phone_number, payment_method, providerName, amount, photo_ids]
    );

    const txId = transaction.rows[0].id;
    let providerResponse;

    try {
      providerResponse = await paymentProvider.initiatePayment({
        amount: amount,
        phone: phone_number,
        orderId: txId,
        method: payment_method,
        slug: eventResult.rows[0].slug,
        basePath: basePath,
      });
    } catch (payErr) {
      await pool.query("UPDATE transactions SET status = 'failed' WHERE id = $1", [txId]);
      console.error('Erreur paiement provider :', payErr.message);
      return res.status(502).json({ error: 'Le service de paiement est indisponible. Réessayez.' });
    }

    const reference = (providerResponse && providerResponse.transactionId) || 'pending';
    const paymentUrl = (providerResponse && providerResponse.raw && (providerResponse.raw.payment_url || providerResponse.raw.checkout_url)) || null;

    await pool.query(
      'UPDATE transactions SET reference = $1 WHERE id = $2',
      [reference, txId]
    );

    res.json({
      transaction_id: txId,
      amount: amount,
      status: 'pending',
      payment_url: paymentUrl,
      message: paymentUrl
        ? 'Ouvrez la fenetre de paiement pour valider votre transaction.'
        : 'Validez le paiement de ' + amount + ' FCFA sur votre telephone.',
    });
  } catch (err) {
    console.error('Erreur initiation paiement :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.post('/callback', async (req, res) => {
  try {
    if (!paymentProvider.verifyWebhookSignature(req)) {
      console.warn('Webhook rejete : signature invalide', req.ip);
      return res.status(401).json({ error: 'Signature invalide.' });
    }

    const parsed = paymentProvider.parseWebhookStatus(req.body);
    const providerTransactionId = parsed.providerTransactionId;
    const newStatus = parsed.status;

    const tx = await pool.query(
      'SELECT id, status FROM transactions WHERE reference = $1',
      [providerTransactionId || '']
    );

    if (tx.rows.length > 0) {
      if (tx.rows[0].status !== 'pending') {
        console.log('Webhook ignore : transaction ' + tx.rows[0].id + ' deja au statut ' + tx.rows[0].status);
        return res.json({ message: 'Callback deja traite.' });
      }
      await pool.query(
        "UPDATE transactions SET status = $1, completed_at = CASE WHEN $3 = 'completed' THEN NOW() ELSE NULL END WHERE id = $2 AND status = 'pending'",
        [newStatus, tx.rows[0].id, newStatus]
      );
      return res.json({ message: 'Callback traite.' });
    }

    // Pas trouve dans transactions -> tenter subscription_payments (upgrade de plan photographe).
    const sub = await pool.query(
      'SELECT id, photographer_id, plan_id, status FROM subscription_payments WHERE reference = $1',
      [providerTransactionId || '']
    );

    if (sub.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction introuvable.' });
    }

    if (sub.rows[0].status !== 'pending') {
      console.log('Webhook ignore : paiement abonnement ' + sub.rows[0].id + ' deja au statut ' + sub.rows[0].status);
      return res.json({ message: 'Callback deja traite.' });
    }

    await pool.query(
      "UPDATE subscription_payments SET status = $1, completed_at = CASE WHEN $3 = 'completed' THEN NOW() ELSE NULL END WHERE id = $2 AND status = 'pending'",
      [newStatus, sub.rows[0].id, newStatus]
    );

    if (newStatus === 'completed') {
      const planData = await pool.query('SELECT photo_limit FROM subscription_plans WHERE id = $1', [sub.rows[0].plan_id]);
      await pool.query(
        "UPDATE photographers SET plan = $1, photo_limit = $2, plan_expires_at = NOW() + INTERVAL '30 days', updated_at = NOW() WHERE id = $3",
        [sub.rows[0].plan_id, planData.rows[0] ? planData.rows[0].photo_limit : null, sub.rows[0].photographer_id]
      );
      console.log('[SUBSCRIPTION] Photographe ' + sub.rows[0].photographer_id + ' passe au plan ' + sub.rows[0].plan_id + ' (expire dans 30 jours)');
    }

    res.json({ message: 'Callback traite.' });
  } catch (err) {
    console.error('Erreur callback :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.get('/:id/status', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, amount, status, payment_method, provider, reference, photos_purchased, completed_at FROM transactions WHERE id = $1',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction introuvable.' });
    }

    let tx = result.rows[0];

    if (tx.status === 'pending' && tx.reference && tx.reference !== 'pending') {
      try {
        const liveStatus = await paymentProvider.checkPaymentStatus(tx.reference);
        if (['completed', 'failed', 'cancelled', 'expired'].indexOf(liveStatus.status) !== -1) {
          const mappedStatus = liveStatus.status === 'completed' ? 'completed' : 'failed';
          const updated = await pool.query(
            "UPDATE transactions SET status = $1, completed_at = CASE WHEN $3 = 'completed' THEN NOW() ELSE NULL END WHERE id = $2 AND status = 'pending' RETURNING id, amount, status, payment_method, provider, photos_purchased, completed_at",
            [mappedStatus, tx.id, mappedStatus]
          );
          if (updated.rows.length > 0) {
            tx = updated.rows[0];
          }
        }
      } catch (checkErr) {
        console.error('Verification active du statut echouee :', checkErr.message);
      }
    }

    res.json({
      transaction: {
        id: tx.id,
        amount: tx.amount,
        status: tx.status,
        payment_method: tx.payment_method,
        provider: tx.provider,
        photos_purchased: tx.photos_purchased,
        completed_at: tx.completed_at,
      },
    });
  } catch (err) {
    console.error('Erreur statut :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
