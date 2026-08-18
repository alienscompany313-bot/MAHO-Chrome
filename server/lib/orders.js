"use strict";
/**
 * Order status machine + helpers. Non-destructive; preserves legacy statuses.
 */

const ORDER_FLOW = ["new", "confirmed", "dispatched", "delivered"];
const RETURN_FLOW = ["return_requested", "return_approved", "return_rejected", "return_completed"];
const TERMINAL = new Set(["delivered", "cancelled", "return_completed", "return_rejected"]);
/** Normal delivery: customer may cancel for 2h after admin approval (overridable for tests). */
const CUSTOMER_CANCEL_WINDOW_MS = (() => {
  const n = parseInt(process.env.CUSTOMER_CANCEL_WINDOW_MS || "", 10);
  if (Number.isFinite(n) && n > 0) return n;
  return 2 * 60 * 60 * 1000;
})();

const LEGACY_MAP = {
  pending: "new",
  awaiting_payment: "new",
  return_approved: "return_approved",
  return_rejected: "return_rejected",
  return_completed: "return_completed",
  returned: "return_completed",
};

function normalizeOrderStatus(s) {
  const v = String(s || "").trim();
  if (!v) return "new";
  if (LEGACY_MAP[v]) return LEGACY_MAP[v];
  if (v === "confirmed" || v.indexOf("تایید شده") >= 0 || v.indexOf("تأیید شده") >= 0) return "confirmed";
  if (v === "dispatched" || v.indexOf("ارسال") >= 0) return "dispatched";
  if (v === "delivered" || (v.indexOf("تحویل") >= 0 && v.indexOf("برگشت") < 0)) return "delivered";
  if (v === "cancelled" || v.indexOf("لغو") >= 0) return "cancelled";
  if (v === "return_requested" || v === "return_approved" || v === "return_rejected" || v === "return_completed") return v;
  if (v.indexOf("برگشت") >= 0 && v.indexOf("رد") >= 0) return "return_rejected";
  if (v.indexOf("برگشت") >= 0 && (v.indexOf("تأیید") >= 0 || v.indexOf("تایید") >= 0)) return "return_approved";
  if (v.indexOf("برگشت") >= 0 && (v.indexOf("تکمیل") >= 0 || v.indexOf("دریافت") >= 0)) return "return_completed";
  if (v.indexOf("برگشت") >= 0) return "return_requested";
  if (v === "new" || v === "pending" || v.indexOf("انتظار") >= 0) return "new";
  return v;
}

/** Delivery عادی = method deliver and not urgent */
function isNormalDeliveryOrder(order) {
  const d = (order && order.delivery) || {};
  if (d.method !== "deliver") return false;
  return String(d.time || "normal") !== "urgent";
}

/**
 * On admin confirm: store approvedAt + cancelDeadline (approvedAt + 2h) for normal delivery.
 */
function applyApprovedCancelWindow(order, at) {
  if (!order || typeof order !== "object") return;
  const ts = typeof at === "number" ? at : Date.now();
  order.approvedAt = ts;
  if (isNormalDeliveryOrder(order)) {
    order.cancelDeadline = ts + CUSTOMER_CANCEL_WINDOW_MS;
  } else {
    order.cancelDeadline = null;
  }
}

/**
 * Server-side cancel eligibility for customers (also drives UI countdown).
 * @returns {{ ok: boolean, error?: string, remainingMs?: number|null, cancelDeadline?: number|null }}
 */
function customerCancelInfo(order, now) {
  if (!order || typeof order !== "object") {
    return { ok: false, error: "not_found" };
  }
  const t = typeof now === "number" ? now : Date.now();
  const st = normalizeOrderStatus(order.status);
  if (st === "new") {
    return { ok: true, remainingMs: null, cancelDeadline: order.cancelDeadline || null };
  }
  if (st === "dispatched" || st === "delivered") {
    return { ok: false, error: "customer_cannot_cancel_shipped", remainingMs: 0, cancelDeadline: order.cancelDeadline || null };
  }
  if (st !== "confirmed") {
    return { ok: false, error: "customer_cannot_cancel", remainingMs: 0, cancelDeadline: order.cancelDeadline || null };
  }
  if (!isNormalDeliveryOrder(order)) {
    return { ok: false, error: "customer_cannot_cancel_after_confirm", remainingMs: 0, cancelDeadline: null };
  }
  const approvedAt = Number(order.approvedAt) || 0;
  let deadline = Number(order.cancelDeadline) || 0;
  if (!deadline && approvedAt) deadline = approvedAt + CUSTOMER_CANCEL_WINDOW_MS;
  if (!deadline) {
    return { ok: false, error: "customer_cannot_cancel_after_confirm", remainingMs: 0, cancelDeadline: null };
  }
  if (t >= deadline) {
    return { ok: false, error: "cancel_window_expired", remainingMs: 0, cancelDeadline: deadline };
  }
  return { ok: true, remainingMs: deadline - t, cancelDeadline: deadline };
}

function canTransition(from, to, { force, actor } = {}) {
  const a = normalizeOrderStatus(from);
  const b = normalizeOrderStatus(to);
  if (a === b) return { ok: true, noop: true };
  if (force) return { ok: true };

  /* customer cancel: new always; confirmed allowed here — window checked via customerCancelInfo */
  if (b === "cancelled") {
    if (actor === "customer") {
      if (a === "new" || a === "confirmed") return { ok: true };
      return { ok: false, error: "customer_cannot_cancel_shipped" };
    }
    if (a === "delivered" || a === "return_completed") return { ok: false, error: "cannot_cancel_delivered" };
    if (RETURN_FLOW.indexOf(a) >= 0 && a !== "return_requested") return { ok: false, error: "cannot_cancel_return" };
    return { ok: true };
  }

  /* customer return: only after delivered */
  if (b === "return_requested") {
    if (a === "delivered") return { ok: true };
    return { ok: false, error: "return_only_after_delivered" };
  }

  if (b === "return_approved") {
    if (a === "return_requested") return { ok: true };
    return { ok: false, error: "invalid_return_approve" };
  }
  if (b === "return_rejected") {
    if (a === "return_requested" || a === "return_approved") return { ok: true };
    return { ok: false, error: "invalid_return_reject" };
  }
  if (b === "return_completed") {
    if (a === "return_approved" || a === "return_requested") return { ok: true };
    return { ok: false, error: "invalid_return_complete" };
  }

  if (TERMINAL.has(a) && RETURN_FLOW.indexOf(b) < 0) {
    return { ok: false, error: "terminal_status" };
  }

  const ai = ORDER_FLOW.indexOf(a);
  const bi = ORDER_FLOW.indexOf(b);
  if (ai < 0 || bi < 0) return { ok: false, error: "unknown_status" };
  if (bi === ai + 1) return { ok: true };
  return { ok: false, error: "invalid_transition" };
}

function appendHistory(order, entry) {
  if (!Array.isArray(order.statusHistory)) order.statusHistory = [];
  order.statusHistory.push(Object.assign({ at: Date.now() }, entry));
}

function allowedAdminActions(status, order) {
  const s = normalizeOrderStatus(status);
  const pickup = order && order.delivery && (order.delivery.method === "pickup" || order.delivery.method === "store_pickup");
  const actions = [];
  if (s === "new" || s === "pending") {
    actions.push({ id: "confirmed", label: "تأیید سفارش" });
    actions.push({ id: "cancelled", label: "لغو سفارش" });
  } else if (s === "confirmed") {
    if (pickup) actions.push({ id: "dispatched", label: "آماده تحویل از فروشگاه" });
    else actions.push({ id: "dispatched", label: "ارسال شد" });
    actions.push({ id: "cancelled", label: "لغو سفارش" });
  } else if (s === "dispatched") {
    if (pickup) actions.push({ id: "delivered", label: "تحویل به مشتری" });
    else actions.push({ id: "delivered", label: "رسید / تحویل شد" });
    actions.push({ id: "cancelled", label: "لغو سفارش" });
  } else if (s === "return_requested") {
    actions.push({ id: "return_approved", label: "تأیید برگشت" });
    actions.push({ id: "return_rejected", label: "رد برگشت" });
  } else if (s === "return_approved") {
    actions.push({ id: "return_completed", label: "دریافت / تکمیل برگشت" });
    actions.push({ id: "return_rejected", label: "رد برگشت" });
  }
  return actions;
}

/** @deprecated Prefer customerCancelInfo(order). Accepts order object or legacy status string. */
function customerCanCancel(orderOrStatus, now) {
  if (orderOrStatus && typeof orderOrStatus === "object") {
    return customerCancelInfo(orderOrStatus, now).ok;
  }
  return normalizeOrderStatus(orderOrStatus) === "new";
}

function customerCanReturn(status) {
  return normalizeOrderStatus(status) === "delivered";
}

function statusLabelFa(code, order) {
  const pickup = order && order.delivery && (order.delivery.method === "pickup" || order.delivery.method === "store_pickup");
  const m = {
    new: "منتظر تأیید",
    pending: "منتظر تأیید",
    confirmed: pickup ? "در حال آماده‌سازی" : "تأییدشده",
    dispatched: pickup ? "آماده تحویل از فروشگاه" : "ارسال‌شده",
    delivered: pickup ? "تحویل شد (فروشگاه)" : "تحویل‌شده",
    cancelled: "لغوشده",
    return_requested: "درخواست برگشت",
    return_approved: "برگشت تأییدشده",
    return_rejected: "برگشت ردشده",
    return_completed: "برگشت تکمیل‌شده",
    awaiting_payment: "منتظر تأیید پرداخت حساب‌پی",
    receipt_submitted: "رسید فرستاده شد",
    under_review: "در حال بررسی پرداخت",
    payment_confirmed: "پرداخت تأیید شد",
    payment_rejected: "پرداخت رد شد",
  };
  return m[normalizeOrderStatus(code)] || m[code] || code || "—";
}

module.exports = {
  ORDER_FLOW,
  RETURN_FLOW,
  CUSTOMER_CANCEL_WINDOW_MS,
  normalizeOrderStatus,
  canTransition,
  appendHistory,
  allowedAdminActions,
  isNormalDeliveryOrder,
  applyApprovedCancelWindow,
  customerCancelInfo,
  customerCanCancel,
  customerCanReturn,
  statusLabelFa,
};
