const crypto = require('crypto');

// TODO A VERIFIER : recuperer l'URL de base exacte depuis le Cockpit Jeko
// (Settings > Webhook & API). La doc publique utilise un placeholder.
const BASE_URL = process.env.JEKO_BASE_URL || 'https://api.jeko.africa';

function getHeaders() {
  const apiKey = process.env.JEKO_API_KEY;
  const apiKeyId = process.env.JEKO_API_KEY_ID;
  if (!apiKey || !apiKeyId) {
    throw new Error('JEKO_API_KEY ou JEKO_API_KEY_ID manquant dans les variables d\'environnement');
  }
  return {
    'X-API-KEY': apiKey,
    'X-API-KEY-ID': apiKeyId,
    'Content-Type': 'application/json',
  };
}

// Jeko utilise directement ces libelles (pas de prefixe _money comme GeniusPay)
const METHOD_MAP = {
  orange: 'orange',
  mtn: 'mtn',
  wave: 'wave',
  moov: 'moov',
};

function mapPaymentMethod(method) {
  if (!method) return undefined;
  return METHOD_MAP[method] || method;
}

async function initiatePayment(params) {
  const amount = params.amount;
  const orderId = params.orderId;
  const method = params.method;
  const slug = params.slug;
  const basePath = params.basePath || '/e/';

  const storeId = process.env.JEKO_STORE_ID;
  if (!storeId) {
    throw new Error('JEKO_STORE_ID manquant dans les variables d\'environnement');
  }

  // On force orderId en string : c'est un entier Postgres au depart (txId),
  // et il doit matcher exactement la valeur stockee dans la colonne
  // `reference` (text) ainsi que la valeur renvoyee par le webhook Jeko.
  const orderIdStr = String(orderId);

  const frontendUrl = (process.env.FRONTEND_URL || '').split(',')[0].trim() || 'https://fotokash.com';
  const returnBase = frontendUrl + basePath + slug + '?tx=' + orderIdStr + '&payment=';

  // On envoie notre propre orderId comme "reference" : Jeko nous le renverra
  // tel quel dans apiTransactionableDetails.reference du webhook, ce qui
  // permet de faire la correlation sans avoir a stocker leur ID interne.
  const body = {
    storeId: storeId,
    amountCents: Math.round(amount * 100),
    currency: 'XOF',
    reference: orderIdStr,
    paymentDetails: {
      type: 'redirect',
      data: {
        paymentMethod: mapPaymentMethod(method),
        successUrl: returnBase + 'success',
        errorUrl: returnBase + 'error',
      },
    },
  };

  let response;
  try {
    response = await fetch(BASE_URL + '/partner_api/payment_requests', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    throw new Error('[JekoAdapter] Erreur reseau lors de l\'initiation du paiement : ' + networkErr.message);
  }

  const json = await response.json();

  if (!response.ok) {
    const errMsg = (json && (json.message || json.error)) || 'Erreur inconnue';
    throw new Error('[JekoAdapter] Echec initiation paiement (HTTP ' + response.status + ') : ' + JSON.stringify(errMsg));
  }

  // Confirme par un appel test reel (magasin sandbox) : redirectUrl et id
  // sont bien a la racine de la reponse.
  const redirectUrl = json.redirectUrl;
  const jekoRequestId = json.id;

  if (!redirectUrl) {
    throw new Error('[JekoAdapter] Reponse Jeko inattendue, URL de redirection introuvable : ' + JSON.stringify(json));
  }

  return {
    // IMPORTANT : on renvoie l'ID Jeko (jekoRequestId), pas orderIdStr.
    // Confirme par test reel : /partner_api/payment_requests ne supporte
    // pas de filtre ?reference= (404), seul GET .../{id} fonctionne. Cet
    // ID doit donc etre stocke tel quel dans la colonne `reference` en
    // base pour que checkPaymentStatus() et le webhook (voir
    // parseWebhookStatus) puissent le retrouver.
    transactionId: jekoRequestId,
    raw: {
      ...json,
      redirectUrl,
      jekoRequestId,
      orderId: orderIdStr,
      // Compat : routes/payments.js lit raw.payment_url / raw.checkout_url
      // (convention snake_case des autres adapters). Jeko renvoie du camelCase,
      // donc on duplique le champ pour que l'extraction existante fonctionne
      // sans toucher a payments.js.
      payment_url: redirectUrl,
    },
  };
}

async function checkPaymentStatus(reference) {
  // `reference` doit etre l'ID Jeko (voir transactionId dans initiatePayment).
  // Confirme par test reel : GET /partner_api/payment_requests/{id}, avec
  // "status" a la racine de la reponse.
  let response;
  try {
    response = await fetch(BASE_URL + '/partner_api/payment_requests/' + encodeURIComponent(reference), {
      method: 'GET',
      headers: getHeaders(),
    });
  } catch (networkErr) {
    throw new Error('[JekoAdapter] Erreur reseau lors de la verification du statut : ' + networkErr.message);
  }

  const json = await response.json();

  if (!response.ok) {
    const errMsg = (json && (json.message || json.error)) || 'Erreur inconnue';
    throw new Error('[JekoAdapter] Echec verification statut (HTTP ' + response.status + ') : ' + JSON.stringify(errMsg));
  }

  return {
    reference: reference,
    status: mapJekoStatus(json.status),
  };
}

function mapJekoStatus(status) {
  if (status === 'success') return 'completed';
  if (status === 'error') return 'failed';
  return 'pending';
}

// IMPORTANT : Jeko signe le RAW body (octets bruts), pas le JSON reparse.
// Cette fonction suppose que req.rawBody (Buffer) est disponible sur la
// requete -- a mettre en place cote route si ce n'est pas deja le cas,
// par exemple via :
//   app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }))
// ou une route dediee avec express.raw() pour le endpoint webhook Jeko.
function verifyWebhookSignature(req) {
  const signature = req.headers['jeko-signature'];
  const secret = process.env.JEKO_WEBHOOK_SECRET;

  if (!signature || !secret) return false;
  if (!req.rawBody) {
    console.error('[JekoAdapter] req.rawBody absent : verification de signature impossible. Voir commentaire dans jekoAdapter.js');
    return false;
  }

  const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  } catch (e) {
    return false;
  }
}

function parseWebhookStatus(payload) {
  // IMPORTANT : on correle sur transactionDetails.id (l'ID Jeko), pas
  // .reference, car c'est cet ID qui est stocke dans la colonne `reference`
  // en base depuis la correction de transactionId dans initiatePayment.
  const details = payload.transactionDetails || {};
  const providerTransactionId = details.id;
  const status = payload.status;

  return {
    providerTransactionId,
    status: mapJekoStatus(status),
  };
}

module.exports = { initiatePayment, verifyWebhookSignature, parseWebhookStatus, checkPaymentStatus };
