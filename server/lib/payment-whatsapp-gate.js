"use strict";
/**
 * WhatsApp may only be invoked for the explicit canonical payment method "whatsapp".
 * Non-WhatsApp methods (hesab/Account Pay, bank, card, …) must never fall through
 * to a WhatsApp deep-link / message builder.
 */

const CANONICAL_WHATSAPP = "whatsapp";

function isCanonicalWhatsAppPayment(method) {
  return String(method || "").trim().toLowerCase() === CANONICAL_WHATSAPP;
}

/** Regression counter: 1 only for WhatsApp method, else 0. */
function whatsappInvokeCount(method) {
  return isCanonicalWhatsAppPayment(method) ? 1 : 0;
}

module.exports = {
  CANONICAL_WHATSAPP,
  isCanonicalWhatsAppPayment,
  whatsappInvokeCount,
};
