"use strict";
/**
 * Independent payment method toggles (additive defaults).
 */

const METHOD_KEYS = ["whatsapp", "hesab", "bank", "card"];

const DEFAULT_LABELS = {
  whatsapp: { label: "سفارش واتساپ / پرداخت هنگام تحویل", label_en: "WhatsApp order / cash on delivery" },
  hesab: { label: "حساب‌پی (HesabPay)", label_en: "HesabPay" },
  bank: { label: "انتقال بانکی", label_en: "Bank transfer" },
  card: { label: "پرداخت آنلاین با کارت", label_en: "Online card payment" },
};

function normalizePaymentMethods(cfg) {
  const src = (cfg && cfg.paymentMethods && typeof cfg.paymentMethods === "object") ? cfg.paymentMethods : {};
  const hesabEnabled = cfg && cfg.hesab && cfg.hesab.enabled !== false;
  const out = {};
  METHOD_KEYS.forEach((k) => {
    const row = src[k] && typeof src[k] === "object" ? src[k] : {};
    const defs = DEFAULT_LABELS[k];
    let enabled = row.enabled != null ? !!row.enabled : true;
    if (k === "hesab" && row.enabled == null && cfg && cfg.hesab && cfg.hesab.enabled === false) {
      enabled = false;
    }
    if (k === "hesab" && hesabEnabled === false && row.enabled == null) enabled = false;
    out[k] = {
      enabled,
      label: String(row.label || defs.label),
      label_en: String(row.label_en || defs.label_en),
      description: String(row.description || ""),
      description_en: String(row.description_en || ""),
    };
  });
  return out;
}

function ensurePaymentMethods(config) {
  if (!config || typeof config !== "object") return false;
  const before = JSON.stringify(config.paymentMethods || null) + JSON.stringify((config.hesab && config.hesab.enabled));
  config.paymentMethods = normalizePaymentMethods(config);
  /* Prefer explicit config.hesab.enabled when true (catalog updates often send hesab without paymentMethods). */
  if (config.hesab && typeof config.hesab === "object") {
    if (config.hesab.enabled === true) {
      config.paymentMethods.hesab.enabled = true;
    } else if (config.paymentMethods.hesab.enabled === false) {
      config.hesab.enabled = false;
    } else {
      config.hesab.enabled = !!config.paymentMethods.hesab.enabled;
    }
  }
  return (JSON.stringify(config.paymentMethods) + JSON.stringify((config.hesab && config.hesab.enabled))) !== before;
}

function enabledPaymentMethods(config) {
  const m = normalizePaymentMethods(config || {});
  return METHOD_KEYS.filter((k) => m[k].enabled);
}

function assertPaymentAllowed(config, payment) {
  const key = String(payment || "whatsapp").trim().toLowerCase();
  const m = normalizePaymentMethods(config || {});
  if (!METHOD_KEYS.includes(key)) return { ok: false, error: "invalid_payment" };
  if (!m[key].enabled) return { ok: false, error: "payment_disabled", payment: key };
  return { ok: true, payment: key };
}

function assertAtLeastOneEnabled(methods) {
  const m = methods && typeof methods === "object" ? methods : {};
  const any = METHOD_KEYS.some((k) => {
    const row = m[k];
    return row && row.enabled !== false;
  });
  return any;
}

module.exports = {
  METHOD_KEYS,
  DEFAULT_LABELS,
  normalizePaymentMethods,
  ensurePaymentMethods,
  enabledPaymentMethods,
  assertPaymentAllowed,
  assertAtLeastOneEnabled,
};
