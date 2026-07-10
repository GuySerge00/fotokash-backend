const activeProviderName = process.env.PAYMENT_PROVIDER || 'mock';
let activeAdapter;
switch (activeProviderName) {
  case 'mock':
    activeAdapter = require('./adapters/mockAdapter');
    break;
  case 'cinetpay':
    activeAdapter = require('./adapters/cinetPayAdapter');
    break;
  case 'jeko':
    activeAdapter = require('./adapters/jekoAdapter');
    break;
  case 'paydunya':
    activeAdapter = require('./adapters/paydunyaAdapter');
    break;
  case 'geniuspay':
    activeAdapter = require('./adapters/geniusPayAdapter');
    break;
  default:
    throw new Error('Provider de paiement inconnu : ' + activeProviderName);
}
async function initiatePayment(params) {
  return activeAdapter.initiatePayment(params);
}
function verifyWebhookSignature(req) {
  return activeAdapter.verifyWebhookSignature(req);
}
function parseWebhookStatus(payload) {
  return activeAdapter.parseWebhookStatus(payload);
}
async function checkPaymentStatus(reference) {
  return activeAdapter.checkPaymentStatus(reference);
}
function getActiveProviderName() {
  return activeProviderName;
}
module.exports = {
  initiatePayment,
  verifyWebhookSignature,
  parseWebhookStatus,
  checkPaymentStatus,
  getActiveProviderName,
};
