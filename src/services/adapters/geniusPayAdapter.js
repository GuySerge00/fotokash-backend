const crypto = require('crypto');

const BASE_URL = 'https://geniuspay.ci/api/v1/merchant';

function getHeaders() {
  const apiKey = process.env.GENIUSPAY_API_KEY;
  const apiSecret = process.env.GENIUSPAY_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new Error('GENIUSPAY_API_KEY ou GENIUSPAY_API_SECRET manquant dans les variables d\'environnement');
  }
  return {
    'X-API-Key': apiKey,
    'X-API-Secret': apiSecret,
    'Content-Type': 'application/json',
  };
}

const METHOD_MAP = {
  orange: 'orange_money',
  mtn: 'mtn_money',
  wave: 'wave',
};

function mapPaymentMethod(method) {
  if (!method) return undefined;
  return METHOD_MAP[method] || method;
}

async function initiatePayment(params) {
  const amount = params.amount;
  const phone = params.phone;
  const orderId = params.orderId;
  const method = params.method;
  const slug = params.slug;
  const basePath = params.basePath || '/e/';

  const frontendUrl = (process.env.FRONTEND_URL || '').split(',')[0].trim() || 'https://fotokash.com';
  const returnBase = frontendUrl + basePath + slug + '?tx=' + orderId + '&payment=';

  const body = {
    amount: amount,
    currency: 'XOF',
    payment_method: mapPaymentMethod(method),
    description: 'FotoKash - commande ' + orderId,
    customer: {
      phone: phone,
    },
    metadata: {
      order_id: orderId,
    },
    success_url: returnBase + 'success',
    error_url: returnBase + 'error',
  };

  let response;
  try {
    response = await fetch(BASE_URL + '/payments', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    throw new Error('[GeniusPayAdapter] Erreur reseau lors de l\'initiation du paiement : ' + networkErr.message);
  }

  const json = await response.json();

  if (!response.ok || !json.success) {
    const errCode = json && json.error ? json.error.code : 'UNKNOWN_ERROR';
    const errMsg = json && json.error ? json.error.message : 'Erreur inconnue';
    throw new Error('[GeniusPayAdapter] Echec initiation paiement (' + errCode + ') : ' + errMsg);
  }

  const data = json.data;

  return {
    transactionId: data.reference,
    raw: data,
  };
}

async function checkPaymentStatus(reference) {
  let response;
  try {
    response = await fetch(BASE_URL + '/payments/' + reference, {
      method: 'GET',
      headers: getHeaders(),
    });
  } catch (networkErr) {
    throw new Error('[GeniusPayAdapter] Erreur reseau lors de la verification du statut : ' + networkErr.message);
  }

  const json = await response.json();

  if (!response.ok || !json.success) {
    const errCode = json && json.error ? json.error.code : 'UNKNOWN_ERROR';
    const errMsg = json && json.error ? json.error.message : 'Erreur inconnue';
    throw new Error('[GeniusPayAdapter] Echec verification statut (' + errCode + ') : ' + errMsg);
  }

  const data = json.data;
  return {
    reference: data.reference,
    status: data.status,
  };
}

function verifyWebhookSignature(req) {
  const signature = req.headers['x-webhook-signature'];
  const timestamp = req.headers['x-webhook-timestamp'];
  const secret = process.env.GENIUSPAY_WEBHOOK_SECRET;

  if (!signature || !timestamp || !secret) return false;

  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Math.abs(now - ts) > 300) {
    return false;
  }

  const payload = JSON.stringify(req.body);
  const dataToSign = timestamp + '.' + payload;
  const expected = crypto.createHmac('sha256', secret).update(dataToSign).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch (e) {
    return false;
  }
}

function parseWebhookStatus(payload) {
  const data = payload.data || {};
  const reference = data.reference;
  const event = payload.event;
  const status = data.status;

  let mappedStatus;
  if (event === 'payment.initiated') {
    mappedStatus = 'pending';
  } else if (status === 'completed') {
    mappedStatus = 'completed';
  } else if (status === 'refunded') {
    mappedStatus = 'refunded';
  } else if (status === 'cancelled' || status === 'expired' || status === 'failed') {
    mappedStatus = 'failed';
  } else {
    mappedStatus = 'pending';
  }

  return {
    providerTransactionId: reference,
    status: mappedStatus,
  };
}

module.exports = { initiatePayment, verifyWebhookSignature, parseWebhookStatus, checkPaymentStatus };
