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

// Normalise un numero local ivoirien (ex: 0749938359 ou 07 49 93 83 59)
// vers le format international attendu par Jeko (+225XXXXXXXXXX).
function normalizePhone(phone) {
  var digits = String(phone).replace(/\D/g, '');
  if (digits.length === 10 && digits[0] === '0') {
    digits = digits.slice(1);
  }
  return '+225' + digits;
}

// Recherche un contact Jeko existant par numero de telephone + operateur ;
// le cree s'il n'existe pas encore. Evite de dupliquer des contacts a
// chaque retrait pour un meme photographe/operateur.
async function getOrCreateContact(name, paymentMethod, phone) {
  var normalized = normalizePhone(phone);

  var listResponse;
  try {
    listResponse = await fetch(BASE_URL + '/partner_api/contacts', {
      method: 'GET',
      headers: getHeaders(),
    });
  } catch (networkErr) {
    throw new Error('[JekoPayout] Erreur reseau lors de la liste des contacts : ' + networkErr.message);
  }
  var listJson = await listResponse.json();
  if (!listResponse.ok) {
    throw new Error('[JekoPayout] Echec liste contacts (HTTP ' + listResponse.status + ') : ' + JSON.stringify(listJson));
  }

  var existing = (Array.isArray(listJson) ? listJson : []).find(function(c) {
    return c.paymentMethod === paymentMethod &&
      c.identifier && c.identifier.number === normalized;
  });
  if (existing) return existing.id;

  var createResponse;
  try {
    createResponse = await fetch(BASE_URL + '/partner_api/contacts', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        name: name,
        paymentMethod: paymentMethod,
        identifier: { number: normalized },
      }),
    });
  } catch (networkErr) {
    throw new Error('[JekoPayout] Erreur reseau lors de la creation du contact : ' + networkErr.message);
  }
  var createJson = await createResponse.json();
  if (!createResponse.ok) {
    throw new Error('[JekoPayout] Echec creation contact (HTTP ' + createResponse.status + ') : ' + JSON.stringify(createJson));
  }
  return createJson.id;
}

// Declenche un transfert reel (pay-out) vers un contact deja connu.
// amountFcfa : montant NET en FCFA (deja diminue des frais de retrait) ;
// la conversion en centimes se fait ici.
async function initiateTransfer(contactId, amountFcfa) {
  var storeId = process.env.JEKO_STORE_ID;
  if (!storeId) {
    throw new Error('JEKO_STORE_ID manquant dans les variables d\'environnement');
  }

  var response;
  try {
    response = await fetch(BASE_URL + '/partner_api/transfers', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        storeId: storeId,
        contactId: contactId,
        amountCents: Math.round(amountFcfa * 100),
        currency: 'XOF',
      }),
    });
  } catch (networkErr) {
    throw new Error('[JekoPayout] Erreur reseau lors du transfert : ' + networkErr.message);
  }
  var json = await response.json();
  if (!response.ok) {
    throw new Error('[JekoPayout] Echec transfert (HTTP ' + response.status + ') : ' + JSON.stringify(json));
  }
  return json;
}

module.exports = { getOrCreateContact, initiateTransfer, normalizePhone };