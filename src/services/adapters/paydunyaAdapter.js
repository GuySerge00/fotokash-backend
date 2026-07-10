const crypto = require('crypto');

// PayDunya a deux URLs de base distinctes (contrairement a Jeko qui n'a
// qu'une seule URL de prod) :
//   - Sandbox    : https://app.paydunya.com/sandbox-api/v1
//   - Production : https://app.paydunya.com/api/v1
const BASE_URL = process.env.PAYDUNYA_BASE_URL || 'https://app.paydunya.com/sandbox-api/v1';

function getHeaders() {
  const masterKey = process.env.PAYDUNYA_MASTER_KEY;
  const privateKey = process.env.PAYDUNYA_PRIVATE_KEY;
  const token = process.env.PAYDUNYA_TOKEN;
  if (!masterKey || !privateKey || !token) {
    throw new Error('PAYDUNYA_MASTER_KEY, PAYDUNYA_PRIVATE_KEY ou PAYDUNYA_TOKEN manquant dans les variables d\'environnement');
  }
  return {
    'Content-Type': 'application/json',
    'PAYDUNYA-MASTER-KEY': masterKey,
    'PAYDUNYA-PRIVATE-KEY': privateKey,
    'PAYDUNYA-TOKEN': token,
  };
}

// TODO A VERIFIER : codes de "channels" confirmes pour la Cote d'Ivoire.
// La doc publique ne montre que des exemples Senegal/Benin (orange-money-senegal,
// mtn-benin...). A confirmer par un test reel ou aupres du support PayDunya
// avant de restreindre les moyens de paiement affiches sur leur page.
const METHOD_MAP = {
  orange: 'orange-money-ci',
  mtn: 'mtn-ci',
  wave: 'wave-ci',
  moov: 'moov-ci',
};

function mapPaymentMethod(method) {
  if (!method) return undefined;
  return METHOD_MAP[method];
}

async function initiatePayment(params) {
  const amount = params.amount;
  const orderId = params.orderId;
  const method = params.method;
  const slug = params.slug;
  const basePath = params.basePath || '/e/';

  const orderIdStr = String(orderId);
  const frontendUrl = (process.env.FRONTEND_URL || '').split(',')[0].trim() || 'https://fotokash.com';
  const returnBase = frontendUrl + basePath + slug + '?tx=' + orderIdStr + '&payment=';

  const storeName = process.env.PAYDUNYA_STORE_NAME || 'FotoKash';
  const channel = mapPaymentMethod(method);

  const body = {
    invoice: {
      total_amount: Math.round(amount),
      description: 'Achat photos FotoKash - commande ' + orderIdStr,
      // Si on a pu mapper la methode, on restreint le choix affiche sur la
      // page PayDunya a ce seul canal ; sinon on laisse PayDunya proposer
      // toutes les methodes disponibles.
      ...(channel ? { channels: [channel] } : {}),
    },
    store: {
      name: storeName,
    },
    // On stocke notre propre orderId ici a titre indicatif/secours : le
    // "token" renvoye par PayDunya (ci-dessous) est LEUR identifiant et sert
    // de veritable cle de correlation (voir commentaire sur transactionId).
    custom_data: {
      orderId: orderIdStr,
    },
    actions: {
      return_url: returnBase + 'success',
      cancel_url: returnBase + 'error',
      // FRONTEND_URL et le backend sont derriere le meme domaine (nginx
      // proxy /api/* vers le backend) : pas besoin d'une variable separee.
      // Route reelle confirmee : router.post('/callback', ...) monte sous
      // /api/payments (voir server.js).
      callback_url: frontendUrl + '/api/payments/callback',
    },
  };

  let response;
  try {
    response = await fetch(BASE_URL + '/checkout-invoice/create', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    throw new Error('[PayDunyaAdapter] Erreur reseau lors de l\'initiation du paiement : ' + networkErr.message);
  }

  const json = await response.json();

  if (!response.ok || json.response_code !== '00') {
    throw new Error('[PayDunyaAdapter] Echec initiation paiement (HTTP ' + response.status + ') : ' + JSON.stringify(json));
  }

  const redirectUrl = json.response_text;
  const paydunyaToken = json.token;

  if (!redirectUrl || !paydunyaToken) {
    throw new Error('[PayDunyaAdapter] Reponse PayDunya inattendue : ' + JSON.stringify(json));
  }

  return {
    // IMPORTANT : contrairement a jekoAdapter/geniusPayAdapter, on renvoie ICI
    // le token PayDunya (et non notre orderIdStr) comme transactionId. C'est
    // la seule valeur utilisable pour interroger /checkout-invoice/confirm/{token}
    // et pour la correlation webhook (voir parseWebhookStatus). A verifier/
    // adapter dans routes/payments.js si ce fichier suppose que transactionId
    // == notre propre orderId (comme c'est le cas pour Jeko/GeniusPay).
    transactionId: paydunyaToken,
    raw: {
      ...json,
      redirectUrl,
      payment_url: redirectUrl,
      orderId: orderIdStr,
    },
  };
}

async function checkPaymentStatus(reference) {
  // `reference` doit etre le token PayDunya (voir note dans initiatePayment).
  let response;
  try {
    response = await fetch(BASE_URL + '/checkout-invoice/confirm/' + encodeURIComponent(reference), {
      method: 'GET',
      headers: getHeaders(),
    });
  } catch (networkErr) {
    throw new Error('[PayDunyaAdapter] Erreur reseau lors de la verification du statut : ' + networkErr.message);
  }

  const json = await response.json();

  if (!response.ok) {
    throw new Error('[PayDunyaAdapter] Echec verification statut (HTTP ' + response.status + ') : ' + JSON.stringify(json));
  }

  // Confirme par un appel test reel (sandbox) : "status" est a la racine
  // de la reponse, pas sous "invoice".
  const status = json.status;

  return {
    reference: reference,
    status: mapPaydunyaStatus(status),
  };
}

function mapPaydunyaStatus(status) {
  if (status === 'completed') return 'completed';
  if (status === 'failed' || status === 'cancelled') return 'failed';
  return 'pending';
}

// IMPORTANT : contrairement a Jeko/GeniusPay (JSON + signature HMAC sur le
// corps brut), PayDunya poste son IPN en application/x-www-form-urlencoded,
// avec toutes les donnees imbriquees sous la cle "data". La route Express
// pour ce webhook doit donc utiliser express.urlencoded({ extended: true })
// et NON express.json() -- A VERIFIER/AJOUTER cote routes/payments.js avant
// de considerer cette integration comme fonctionnelle.
//
// La verification n'est PAS une signature HMAC du corps : PayDunya renvoie
// le hash SHA-512 de votre PAYDUNYA_MASTER_KEY (une valeur constante, qui ne
// depend pas des donnees de la transaction). C'est plus faible qu'une vraie
// signature de payload -- c'est pourquoi on ne doit JAMAIS faire confiance
// au webhook seul : toujours re-verifier via checkPaymentStatus() (confirm)
// avant de valider une transaction cote FotoKash.
function verifyWebhookSignature(req) {
  const data = req.body && req.body.data;
  const masterKey = process.env.PAYDUNYA_MASTER_KEY;

  if (!data || !data.hash || !masterKey) return false;

  const expectedHash = crypto.createHash('sha512').update(masterKey).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(data.hash, 'hex'), Buffer.from(expectedHash, 'hex'));
  } catch (e) {
    return false;
  }
}

function parseWebhookStatus(payload) {
  const data = payload.data || payload;
  const invoice = data.invoice || {};

  return {
    // Doit correspondre au token PayDunya stocke comme `reference` en base
    // (voir transactionId dans initiatePayment).
    providerTransactionId: invoice.token,
    status: mapPaydunyaStatus(data.status),
  };
}

module.exports = { initiatePayment, verifyWebhookSignature, parseWebhookStatus, checkPaymentStatus };
