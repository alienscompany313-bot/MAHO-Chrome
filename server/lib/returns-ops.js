"use strict";
/**
 * Return window, managed reasons, analytics, pickup/refund helpers.
 * Additive only — never wipes orders/products.
 */
const crypto = require("crypto");
const { sanitizeText } = require("./security");
const { normalizeOrderStatus } = require("./orders");

const DEFAULT_RETURN_REASONS = [
  { title: "سایز مناسب نبود", titleEn: "Size issue", requireNote: false },
  { title: "کیفیت مطابق انتظار نبود", titleEn: "Quality issue", requireNote: false },
  { title: "رنگ/مدل متفاوت بود", titleEn: "Color/model mismatch", requireNote: false },
  { title: "سفارش اشتباه ارسال شد", titleEn: "Wrong item sent", requireNote: false },
  { title: "سایر", titleEn: "Other", requireNote: true },
];

function now() { return Date.now(); }

function ensureReturnsOps(data) {
  if (!data || typeof data !== "object") return false;
  let changed = false;
  data.config = data.config || {};
  if (!data.config.returns || typeof data.config.returns !== "object") {
    data.config.returns = {
      returnWindowDays: 7,
      returnPickupPhotoRequired: false,
    };
    changed = true;
  } else {
    const r = data.config.returns;
    if (r.returnWindowDays == null) { r.returnWindowDays = 7; changed = true; }
    if (r.returnPickupPhotoRequired == null) { r.returnPickupPhotoRequired = false; changed = true; }
  }
  if (!Array.isArray(data.returnReasons)) {
    data.returnReasons = DEFAULT_RETURN_REASONS.map((x, i) => ({
      id: "rr_" + crypto.randomBytes(6).toString("hex"),
      title: x.title,
      titleEn: x.titleEn,
      requireNote: !!x.requireNote,
      active: true,
      sortOrder: i,
      createdAt: now(),
      updatedAt: now(),
    }));
    changed = true;
  }
  /* Additive marketingConsent default for existing users (false = opt-in required) */
  (data.users || []).forEach((u) => {
    if (u && u.marketingConsent == null) {
      u.marketingConsent = false;
      changed = true;
    }
  });
  return changed;
}

function getReturnWindowDays(db) {
  const n = parseInt(db && db.config && db.config.returns && db.config.returns.returnWindowDays, 10);
  if (!Number.isFinite(n) || n < 0) return 7;
  return Math.min(365, n);
}

function isStorePickupOrder(order) {
  const m = order && order.delivery && order.delivery.method;
  return m === "pickup" || m === "store_pickup" || m === "store";
}

function fulfillmentType(order) {
  return isStorePickupOrder(order) ? "store_pickup" : "delivery";
}

/** Snapshot return policy when order is handed to customer (delivered). */
function applyDeliveryReturnPolicy(db, order, at) {
  if (!order) return;
  const ts = typeof at === "number" ? at : now();
  order.deliveredAt = order.deliveredAt || ts;
  if (order.returnWindowDaysAtDelivery == null) {
    order.returnWindowDaysAtDelivery = getReturnWindowDays(db);
  }
  if (order.returnDeadlineAt == null) {
    const days = order.returnWindowDaysAtDelivery;
    order.returnDeadlineAt = ts + (days * 24 * 60 * 60 * 1000);
  }
  if (!order.fulfillmentType) order.fulfillmentType = fulfillmentType(order);
}

function returnWindowInfo(order, nowTs) {
  const t = typeof nowTs === "number" ? nowTs : now();
  if (!order) return { ok: false, error: "not_found" };
  const st = normalizeOrderStatus(order.status);
  if (st !== "delivered" && !(order.returnRequest && order.returnRequest.requestedAt)) {
    if (["return_requested", "return_approved", "return_rejected", "return_completed"].indexOf(st) >= 0) {
      return { ok: true, existing: true, deadline: order.returnDeadlineAt || null };
    }
  }
  if (order.lateReturnApproved) {
    return {
      ok: true,
      lateOverride: true,
      deadline: order.returnDeadlineAt || null,
      remainingMs: null,
    };
  }
  const deadline = Number(order.returnDeadlineAt) || 0;
  if (!deadline) {
    /* Legacy delivered orders without snapshot: allow return (backward compatible) */
    return { ok: true, legacy: true, deadline: null, remainingMs: null };
  }
  if (t > deadline) {
    return { ok: false, error: "return_window_expired", deadline, remainingMs: 0 };
  }
  return { ok: true, deadline, remainingMs: deadline - t };
}

function customerMayRequestReturn(order, nowTs) {
  if (!order) return { ok: false, error: "not_found" };
  if (order.returnRequest && order.returnRequest.requestedAt) {
    return { ok: false, error: "return_already_requested" };
  }
  const st = normalizeOrderStatus(order.status);
  if (st !== "delivered") return { ok: false, error: "return_only_after_delivered" };
  return returnWindowInfo(order, nowTs);
}

function publicReturnReason(r) {
  if (!r) return null;
  return {
    id: r.id,
    title: r.title,
    titleEn: r.titleEn || "",
    requireNote: !!r.requireNote,
    active: r.active !== false,
    sortOrder: r.sortOrder || 0,
    createdAt: r.createdAt || null,
    updatedAt: r.updatedAt || null,
  };
}

function listReturnReasons(db, { activeOnly } = {}) {
  ensureReturnsOps(db);
  let list = (db.returnReasons || []).slice();
  if (activeOnly) list = list.filter((r) => r && r.active !== false);
  list.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  return list.map(publicReturnReason);
}

function createReturnReason(db, body) {
  ensureReturnsOps(db);
  const title = sanitizeText(body.title, 120);
  if (!title) return { ok: false, error: "missing_title", status: 400 };
  const row = {
    id: "rr_" + crypto.randomBytes(6).toString("hex"),
    title,
    titleEn: sanitizeText(body.titleEn, 120) || "",
    requireNote: !!body.requireNote,
    active: body.active !== false,
    sortOrder: Number.isFinite(parseInt(body.sortOrder, 10))
      ? parseInt(body.sortOrder, 10)
      : (db.returnReasons.length + 1),
    createdAt: now(),
    updatedAt: now(),
  };
  db.returnReasons.push(row);
  return { ok: true, reason: publicReturnReason(row) };
}

function updateReturnReason(db, id, body) {
  const r = (db.returnReasons || []).find((x) => x && x.id === id);
  if (!r) return { ok: false, error: "not_found", status: 404 };
  if (body.title != null) r.title = sanitizeText(body.title, 120) || r.title;
  if (body.titleEn != null) r.titleEn = sanitizeText(body.titleEn, 120) || "";
  if (body.requireNote != null) r.requireNote = !!body.requireNote;
  if (body.active != null) r.active = !!body.active;
  if (body.sortOrder != null && Number.isFinite(parseInt(body.sortOrder, 10))) {
    r.sortOrder = parseInt(body.sortOrder, 10);
  }
  r.updatedAt = now();
  return { ok: true, reason: publicReturnReason(r) };
}

function deleteReturnReason(db, id) {
  const idx = (db.returnReasons || []).findIndex((x) => x && x.id === id);
  if (idx < 0) return { ok: false, error: "not_found", status: 404 };
  const used = (db.orders || []).some((o) =>
    o && o.returnRequest && (o.returnRequest.reasonId === id)
  );
  if (used) {
    db.returnReasons[idx].active = false;
    db.returnReasons[idx].updatedAt = now();
    return { ok: true, archived: true, reason: publicReturnReason(db.returnReasons[idx]) };
  }
  db.returnReasons.splice(idx, 1);
  return { ok: true, deleted: true };
}

function resolveReasonSnapshot(db, reasonId, fallbackTitle) {
  const r = (db.returnReasons || []).find((x) => x && x.id === reasonId);
  if (r) {
    return {
      reasonId: r.id,
      reasonTitleSnapshot: r.title,
      requireNote: !!r.requireNote,
      active: r.active !== false,
    };
  }
  return {
    reasonId: reasonId || null,
    reasonTitleSnapshot: sanitizeText(fallbackTitle, 200) || "",
    requireNote: false,
    active: false,
  };
}

function isCashPayment(order) {
  const p = String((order && order.payment) || "").toLowerCase();
  /* whatsapp = COD / pay-on-delivery in this project — treat as cash for driver refund */
  return p === "cash" || p === "cod" || p === "whatsapp" || p === "نقد" || p === "نقدی";
}

function approvedRefundAmount(order) {
  if (!order) return 0;
  const rr = order.returnRequest || {};
  if (rr.approvedRefundAmount != null && Number.isFinite(Number(rr.approvedRefundAmount))) {
    return Number(rr.approvedRefundAmount);
  }
  return Number(order.total) || 0;
}

function returnReasonAnalytics(db, { from, to, productCode, fulfillment } = {}) {
  ensureReturnsOps(db);
  const orders = (db.orders || []).filter((o) => o && o.returnRequest);
  const fromN = from ? Number(from) : 0;
  const toN = to ? Number(to) : 0;
  const filtered = orders.filter((o) => {
    const at = o.returnRequest.requestedAt || 0;
    if (fromN && at < fromN) return false;
    if (toN && at > toN) return false;
    if (fulfillment) {
      const ft = o.fulfillmentType || fulfillmentType(o);
      if (ft !== fulfillment) return false;
    }
    if (productCode) {
      const code = String(productCode).toLowerCase();
      const hit = (o.items || []).some((it) => String(it.code || "").toLowerCase() === code);
      if (!hit) return false;
    }
    return true;
  });
  const total = filtered.length || 1;
  const byReason = {};
  filtered.forEach((o) => {
    const title = o.returnRequest.reasonTitleSnapshot || o.returnRequest.reason || "—";
    const key = o.returnRequest.reasonId || title;
    if (!byReason[key]) byReason[key] = { reasonId: o.returnRequest.reasonId || null, title, count: 0 };
    byReason[key].count++;
  });
  const reasons = Object.keys(byReason).map((k) => {
    const r = byReason[k];
    return {
      reasonId: r.reasonId,
      title: r.title,
      count: r.count,
      percentage: Math.round((r.count / total) * 1000) / 10,
    };
  }).sort((a, b) => b.count - a.count);

  const byProduct = {};
  filtered.forEach((o) => {
    (o.items || []).forEach((it) => {
      const code = it.code || it.name || "—";
      if (!byProduct[code]) {
        byProduct[code] = { code: it.code || "", name: it.name || "", count: 0, reasons: {} };
      }
      byProduct[code].count++;
      const rt = o.returnRequest.reasonTitleSnapshot || o.returnRequest.reason || "—";
      byProduct[code].reasons[rt] = (byProduct[code].reasons[rt] || 0) + 1;
    });
  });
  const products = Object.keys(byProduct).map((k) => {
    const p = byProduct[k];
    const topReasons = Object.keys(p.reasons).map((t) => ({ title: t, count: p.reasons[t] }))
      .sort((a, b) => b.count - a.count);
    return { code: p.code, name: p.name, count: p.count, topReasons };
  }).sort((a, b) => b.count - a.count);

  return { totalReturns: filtered.length, reasons, products };
}

function bayesianDriverRank(drivers) {
  /* Wilson-ish: score = (avg * n + C * prior) / (n + C) */
  const C = 5;
  const prior = 4;
  return (drivers || []).map((d) => {
    const n = d.feedbackCount || d.ratingCount || 0;
    const avg = d.avgRating != null ? d.avgRating : prior;
    const score = n > 0 ? ((avg * n) + (C * prior)) / (n + C) : 0;
    return Object.assign({}, d, { rankScore: Math.round(score * 100) / 100, rawAvg: avg });
  }).sort((a, b) => (b.rankScore || 0) - (a.rankScore || 0));
}

module.exports = {
  ensureReturnsOps,
  getReturnWindowDays,
  isStorePickupOrder,
  fulfillmentType,
  applyDeliveryReturnPolicy,
  returnWindowInfo,
  customerMayRequestReturn,
  publicReturnReason,
  listReturnReasons,
  createReturnReason,
  updateReturnReason,
  deleteReturnReason,
  resolveReasonSnapshot,
  isCashPayment,
  approvedRefundAmount,
  returnReasonAnalytics,
  bayesianDriverRank,
  DEFAULT_RETURN_REASONS,
};
