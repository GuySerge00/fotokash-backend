const { pool } = require('../config/database');

const VALID_MODES = ['degressive', 'fixed', 'free', 'tiers'];

async function loadPricingSettings() {
  const r = await pool.query(
    "SELECT key, value FROM app_settings WHERE key IN ('photo_price_1','photo_price_3','photo_price_5','min_base_unit_price','pricing_reference_base')"
  );
  const s = {};
  r.rows.forEach(function(row) { s[row.key] = row.value; });
  return {
    p1: parseInt(s.photo_price_1) || 200,
    p3: parseInt(s.photo_price_3) || 500,
    p5: parseInt(s.photo_price_5) || 1000,
    minBase: parseInt(s.min_base_unit_price) || 100,
    refBase: parseInt(s.pricing_reference_base) || 200,
  };
}

function roundMM(x) { return Math.round(x / 25) * 25; }

function degressiveTotal(photoCount, base, cfg) {
  if (photoCount <= 0) return 0;
  const scale = base / cfg.refBase;
  if (photoCount >= 5) return cfg.p5 * scale;
  if (photoCount >= 3) return cfg.p3 * scale;
  return photoCount * cfg.p1 * scale;
}

// Calcule un montant pour un mode+unite donnes, sans lecture DB d'evenement.
// Reutilise par computePriceForEvent ET par l'apercu de prix (profil photographe).
function computeAmountForMode(mode, unit, photoCount, cfg) {
  if (VALID_MODES.indexOf(mode) === -1) mode = 'degressive';

  if (mode === 'free') {
    return { amount: 0, mode: 'free', currency: 'XOF' };
  }
  if (mode === 'fixed') {
    let u = (unit != null ? unit : cfg.refBase);
    if (u < cfg.minBase) u = cfg.minBase;
    return { amount: roundMM(photoCount * u), mode: 'fixed', unitPrice: u, currency: 'XOF' };
  }
  let base = (unit != null ? unit : cfg.refBase);
  if (base < cfg.minBase) base = cfg.minBase;
  const amount = (base === cfg.refBase)
    ? Math.round(degressiveTotal(photoCount, base, cfg))
    : roundMM(degressiveTotal(photoCount, base, cfg));
  return { amount: amount, mode: 'degressive', unitPrice: base, currency: 'XOF' };
}

// Mode effectif = override evenement > defaut photographe. Pas de branchement par plan.
async function computePriceForEvent(eventId, photoCount) {
  const cfg = await loadPricingSettings();
  const q = await pool.query(
    "SELECT e.pricing_mode AS ev_mode, e.unit_price AS ev_unit, " +
    "p.default_pricing_mode AS ph_mode, p.default_unit_price AS ph_unit " +
    "FROM events e JOIN photographers p ON p.id = e.photographer_id WHERE e.id = $1",
    [eventId]
  );

  if (q.rowCount === 0) {
    return computeAmountForMode('degressive', cfg.refBase, photoCount, cfg);
  }

  const row = q.rows[0];
  const mode = row.ev_mode || row.ph_mode || 'degressive';
  const unit = (row.ev_unit != null ? row.ev_unit : row.ph_unit);
  return computeAmountForMode(mode, unit, photoCount, cfg);
}

// Apercu (1/3/5 photos) pour un mode+prix candidats, avant sauvegarde du profil.
async function computePricePreview(mode, unit) {
  const cfg = await loadPricingSettings();
  return {
    price1: computeAmountForMode(mode, unit, 1, cfg).amount,
    price3: computeAmountForMode(mode, unit, 3, cfg).amount,
    price5: computeAmountForMode(mode, unit, 5, cfg).amount,
    minBase: cfg.minBase,
  };
}

module.exports = { computePriceForEvent, computePricePreview, computeAmountForMode, degressiveTotal, loadPricingSettings, VALID_MODES };
