const crypto = require('crypto');
async function initiatePayment(params) {
  const amount = params.amount;
  const phone = params.phone;
  const orderId = params.orderId;
  const method = params.method;
  console.log('[MockAdapter] Simulation paiement : ' + amount + ' FCFA, ' + phone + ', methode ' + method + ', commande ' + orderId);
  return {
    transactionId: 'mock_' + orderId + '_' + Date.now(),
    raw: { simulated: true },
  };
}
async function checkPaymentStatus(reference) {
  // Simule une confirmation après ~6 secondes pour tester le polling en local
  const createdAtMatch = reference.match(/_(\d+)$/);
  const createdAt = createdAtMatch ? parseInt(createdAtMatch[1], 10) : Date.now();
  const elapsed = Date.now() - createdAt;
  return {
    reference: reference,
    status: elapsed > 6000 ? 'completed' : 'pending',
  };
}
function verifyWebhookSignature(req) {
  const signature = req.headers['x-webhook-signature'];
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!signature || !secret) return false;
  const payload = JSON.stringify(req.body);
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch (e) {
    return false;
  }
}
function parseWebhookStatus(payload) {
  const transactionId = payload.transaction_id;
  const status = payload.status;
  const providerId = payload.provider_id;
  return {
    providerTransactionId: providerId || transactionId,
    status: status === 'success' ? 'completed' : 'failed',
  };
}
module.exports = { initiatePayment, verifyWebhookSignature, parseWebhookStatus, checkPaymentStatus };
