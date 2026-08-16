"use strict";
/**
 * Order status machine + helpers. Non-destructive; preserves legacy statuses.
 */

const ORDER_FLOW = ["new", "confirmed", "dispatched", "delivered"];
const TERMINAL = new Set(["delivered", "cancelled"]);

const LEGACY_MAP = {
  pending: "new",
  awaiting_payment: "new",
};

function normalizeOrderStatus(s) {
  const v = String(s || "").trim();
  if (!v) return "new";
  if (v === "confirmed" || v.indexOf("تایید شده") >= 0 || v.indexOf("تأیید شده") >= 0) return "confirmed";
  if (v === "dispatched" || v.indexOf("ارسال") >= 0) return "dispatched";
  if (v === "delivered" || v.indexOf("تحویل") >= 0 || v.indexOf("رسید") >= 0) return "delivered";
  if (v === "cancelled" || v.indexOf("لغو") >= 0) return "cancelled";
  if (v === "new" || v === "pending" || v.indexOf("انتظار") >= 0) return v === "pending" ? "new" : (v === "new" ? "new" : "new");
  if (v === "return_requested" || v.indexOf("برگشت") >= 0) return "return_requested";
  if (v === "awaiting_payment") return "new"; /* order status; payment tracked separately */
  return LEGACY_MAP[v] || v;
}

function canTransition(from, to, { force } = {}) {
  const a = normalizeOrderStatus(from);
  const b = normalizeOrderStatus(to);
  if (a === b) return { ok: true, noop: true };
  if (force) return { ok: true };
  if (TERMINAL.has(a) && !force) {
    return { ok: false, error: "terminal_status" };
  }
  if (b === "cancelled") {
    if (a === "delivered") return { ok: false, error: "cannot_cancel_delivered" };
    return { ok: true };
  }
  if (b === "return_requested") {
    if (a === "delivered" || a === "dispatched" || a === "confirmed") return { ok: true };
    return { ok: false, error: "invalid_return" };
  }
  const ai = ORDER_FLOW.indexOf(a);
  const bi = ORDER_FLOW.indexOf(b);
  if (ai < 0 || bi < 0) return { ok: false, error: "unknown_status" };
  if (bi === ai + 1) return { ok: true };
  /* allow skip only new -> confirmed (already adjacent) */
  return { ok: false, error: "invalid_transition" };
}

function appendHistory(order, entry) {
  if (!Array.isArray(order.statusHistory)) order.statusHistory = [];
  order.statusHistory.push(Object.assign({ at: Date.now() }, entry));
}

function allowedAdminActions(status) {
  const s = normalizeOrderStatus(status);
  const actions = [];
  if (s === "new" || s === "pending") {
    actions.push({ id: "confirmed", label: "تأیید سفارش" });
    actions.push({ id: "cancelled", label: "لغو سفارش" });
  } else if (s === "confirmed") {
    actions.push({ id: "dispatched", label: "ارسال شد" });
    actions.push({ id: "cancelled", label: "لغو سفارش" });
  } else if (s === "dispatched") {
    actions.push({ id: "delivered", label: "رسید / تحویل شد" });
    actions.push({ id: "cancelled", label: "لغو سفارش" });
  }
  return actions;
}

module.exports = {
  ORDER_FLOW,
  normalizeOrderStatus,
  canTransition,
  appendHistory,
  allowedAdminActions,
};
