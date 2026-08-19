"use strict";
/**
 * Order-value (threshold) discount rules — Admin-managed, server-calculated.
 * Snapshot applied rule onto the order so history stays stable.
 */
const crypto = require("crypto");
const { sanitizeText } = require("./security");

function ensureDiscountRules(db) {
  db.config = db.config || {};
  let changed = false;
  if (!Array.isArray(db.config.orderValueDiscounts)) {
    db.config.orderValueDiscounts = [];
    changed = true;
  }
  return changed;
}

function publicRule(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name || "",
    minAmount: Number(r.minAmount) || 0,
    type: r.type === "fixed" ? "fixed" : "percent",
    value: Number(r.value) || 0,
    active: r.active !== false,
    startAt: r.startAt || null,
    endAt: r.endAt || null,
    appliesTo: r.appliesTo || "both", /* delivery | pickup | both */
    stackWithProductDiscount: r.stackWithProductDiscount !== false,
    stackWithCoupons: !!r.stackWithCoupons,
    priority: Number(r.priority) || 0,
  };
}

function normalizeRule(body, existing) {
  const base = existing || {};
  const type = String(body.type || base.type || "percent") === "fixed" ? "fixed" : "percent";
  let value = Number(body.value != null ? body.value : base.value) || 0;
  if (type === "percent") value = Math.max(0, Math.min(95, value));
  else value = Math.max(0, value);
  const appliesTo = ["delivery", "pickup", "both"].indexOf(String(body.appliesTo || base.appliesTo || "both")) >= 0
    ? String(body.appliesTo || base.appliesTo || "both")
    : "both";
  return {
    id: base.id || ("ovd_" + crypto.randomBytes(5).toString("hex")),
    name: sanitizeText(body.name != null ? body.name : base.name, 80) || "",
    minAmount: Math.max(0, Number(body.minAmount != null ? body.minAmount : base.minAmount) || 0),
    type,
    value,
    active: body.active != null ? !!body.active : (base.active !== false),
    startAt: body.startAt != null ? (body.startAt ? Number(body.startAt) : null) : (base.startAt || null),
    endAt: body.endAt != null ? (body.endAt ? Number(body.endAt) : null) : (base.endAt || null),
    appliesTo,
    stackWithProductDiscount: body.stackWithProductDiscount != null
      ? !!body.stackWithProductDiscount
      : (base.stackWithProductDiscount !== false),
    stackWithCoupons: body.stackWithCoupons != null ? !!body.stackWithCoupons : !!base.stackWithCoupons,
    priority: Number(body.priority != null ? body.priority : base.priority) || 0,
    updatedAt: Date.now(),
    createdAt: base.createdAt || Date.now(),
  };
}

function ruleActiveNow(rule, now) {
  if (!rule || rule.active === false) return false;
  const t = typeof now === "number" ? now : Date.now();
  if (rule.startAt && t < Number(rule.startAt)) return false;
  if (rule.endAt && t > Number(rule.endAt)) return false;
  return true;
}

function methodMatches(rule, fulfillment) {
  const a = rule.appliesTo || "both";
  if (a === "both") return true;
  if (a === "pickup") return fulfillment === "pickup" || fulfillment === "store_pickup";
  if (a === "delivery") return fulfillment === "deliver" || fulfillment === "delivery";
  return true;
}

/**
 * Pick best applicable rule: highest minAmount among matches; tie-break by priority then value.
 */
function selectBestRule(rules, subtotal, fulfillment, now) {
  const sub = Number(subtotal) || 0;
  const eligible = (rules || []).filter((r) =>
    ruleActiveNow(r, now) && methodMatches(r, fulfillment) && sub >= (Number(r.minAmount) || 0)
  );
  if (!eligible.length) return null;
  eligible.sort((a, b) => {
    const ma = Number(a.minAmount) || 0;
    const mb = Number(b.minAmount) || 0;
    if (mb !== ma) return mb - ma;
    const pa = Number(a.priority) || 0;
    const pb = Number(b.priority) || 0;
    if (pb !== pa) return pb - pa;
    return (Number(b.value) || 0) - (Number(a.value) || 0);
  });
  return eligible[0];
}

function computeDiscountAmount(rule, subtotal) {
  if (!rule) return 0;
  const sub = Math.max(0, Number(subtotal) || 0);
  let amt = 0;
  if (rule.type === "fixed") amt = Number(rule.value) || 0;
  else amt = Math.round(sub * ((Number(rule.value) || 0) / 100) * 100) / 100;
  if (amt > sub) amt = sub;
  if (amt < 0) amt = 0;
  return Math.round(amt * 100) / 100;
}

function nextTierProgress(rules, subtotal, fulfillment, now) {
  const sub = Number(subtotal) || 0;
  const future = (rules || [])
    .filter((r) => ruleActiveNow(r, now) && methodMatches(r, fulfillment) && (Number(r.minAmount) || 0) > sub)
    .sort((a, b) => (Number(a.minAmount) || 0) - (Number(b.minAmount) || 0));
  if (!future.length) return null;
  const r = future[0];
  const need = Math.max(0, (Number(r.minAmount) || 0) - sub);
  return {
    rule: publicRule(r),
    amountNeeded: Math.round(need * 100) / 100,
    messageFa: "با " + need.toLocaleString("en-US") + " افغانی خرید بیشتر، " +
      (r.type === "fixed"
        ? ((Number(r.value) || 0).toLocaleString("en-US") + " افغانی")
        : ((Number(r.value) || 0) + "٪")) +
      " تخفیف بگیرید.",
  };
}

function evaluateOrderValueDiscount(db, subtotal, fulfillment, now) {
  ensureDiscountRules(db);
  const rules = db.config.orderValueDiscounts || [];
  const best = selectBestRule(rules, subtotal, fulfillment, now);
  const amount = computeDiscountAmount(best, subtotal);
  const progress = nextTierProgress(rules, subtotal, fulfillment, now);
  let messageFa = "";
  if (best && amount > 0) {
    messageFa = "به دلیل رسیدن مبلغ سفارش به " +
      (Number(best.minAmount) || 0).toLocaleString("en-US") +
      " افغانی، " +
      (best.type === "fixed"
        ? (amount.toLocaleString("en-US") + " افغانی")
        : ((Number(best.value) || 0) + "٪ (" + amount.toLocaleString("en-US") + " افغانی)")) +
      " تخفیف دریافت کردید.";
  }
  return {
    amount,
    rule: best ? publicRule(best) : null,
    snapshot: best
      ? {
          id: best.id,
          name: best.name,
          minAmount: best.minAmount,
          type: best.type,
          value: best.value,
          amount,
          appliedAt: Date.now(),
        }
      : null,
    messageFa,
    nextTier: progress,
  };
}

function listRules(db) {
  ensureDiscountRules(db);
  return (db.config.orderValueDiscounts || []).map(publicRule);
}

function upsertRule(db, body, id) {
  ensureDiscountRules(db);
  const list = db.config.orderValueDiscounts;
  if (id) {
    const idx = list.findIndex((r) => r.id === id);
    if (idx < 0) return { ok: false, error: "not_found", status: 404 };
    list[idx] = normalizeRule(body, list[idx]);
    return { ok: true, rule: publicRule(list[idx]) };
  }
  const row = normalizeRule(body, null);
  list.push(row);
  return { ok: true, rule: publicRule(row) };
}

function deleteRule(db, id) {
  ensureDiscountRules(db);
  const before = db.config.orderValueDiscounts.length;
  db.config.orderValueDiscounts = db.config.orderValueDiscounts.filter((r) => r.id !== id);
  if (db.config.orderValueDiscounts.length === before) return { ok: false, error: "not_found", status: 404 };
  return { ok: true };
}

module.exports = {
  ensureDiscountRules,
  publicRule,
  listRules,
  upsertRule,
  deleteRule,
  evaluateOrderValueDiscount,
  selectBestRule,
  computeDiscountAmount,
};
