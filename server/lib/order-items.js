"use strict";
/**
 * Item-level order operations — additive, backward-compatible.
 * Legacy orders without line status normalize from order-level status.
 */
const crypto = require("crypto");
const {
  normalizeOrderStatus,
  customerCancelInfo,
  applyApprovedCancelWindow,
  appendHistory,
  isNormalDeliveryOrder,
  CUSTOMER_CANCEL_WINDOW_MS,
} = require("./orders");
const { customerMayRequestReturn, returnWindowInfo, getReturnWindowDays } = require("./returns-ops");

const ITEM_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
  "shipped",
  "delivered",
  "return_requested",
  "return_approved",
  "return_rejected",
  "return_completed",
];

const ACTIVE_FULFILL = new Set(["approved", "shipped", "delivered", "return_requested", "return_approved", "return_rejected", "return_completed"]);
const FINAL_NEGATIVE = new Set(["rejected", "cancelled", "return_completed", "return_rejected"]);

function newLineId() {
  return "li_" + crypto.randomBytes(6).toString("hex");
}

function mapOrderStatusToItem(st) {
  const s = normalizeOrderStatus(st);
  if (s === "new" || s === "pending") return "pending";
  if (s === "confirmed") return "approved";
  if (s === "dispatched") return "shipped";
  if (s === "delivered") return "delivered";
  if (s === "cancelled") return "cancelled";
  if (s === "return_requested") return "return_requested";
  if (s === "return_approved") return "return_approved";
  if (s === "return_rejected") return "return_rejected";
  if (s === "return_completed") return "return_completed";
  return "pending";
}

/** Ensure every line has lineId + itemStatus (idempotent). */
function normalizeOrderItems(order) {
  if (!order || !Array.isArray(order.items)) return false;
  let changed = false;
  const fallback = mapOrderStatusToItem(order.status);
  order.items.forEach((it, idx) => {
    if (!it || typeof it !== "object") return;
    if (!it.lineId) {
      it.lineId = "li_legacy_" + String(order.id || "o").replace(/\W/g, "").slice(-8) + "_" + idx;
      changed = true;
    }
    if (!it.itemStatus || ITEM_STATUSES.indexOf(it.itemStatus) < 0) {
      it.itemStatus = fallback;
      changed = true;
    }
    if (it.qty == null) { it.qty = 1; changed = true; }
    if (it.refundedAmount == null) { it.refundedAmount = 0; changed = true; }
    if (it.cancelledAt === undefined) { it.cancelledAt = null; changed = true; }
    if (it.rejectedAt === undefined) { it.rejectedAt = null; changed = true; }
    if (it.shippedAt === undefined) { it.shippedAt = null; changed = true; }
    if (it.deliveredAt === undefined) { it.deliveredAt = null; changed = true; }
  });
  if (!Array.isArray(order.shipments)) {
    order.shipments = [];
    changed = true;
  }
  return changed;
}

function findLine(order, lineId) {
  normalizeOrderItems(order);
  return (order.items || []).find((it) => it && String(it.lineId) === String(lineId)) || null;
}

function lineUnitPaid(it) {
  const price = Number(it.price) || 0;
  return price;
}

function lineSubtotal(it) {
  return lineUnitPaid(it) * (Number(it.qty) || 0);
}

function activeLinesSubtotal(order) {
  normalizeOrderItems(order);
  return (order.items || []).reduce((sum, it) => {
    if (!it || FINAL_NEGATIVE.has(it.itemStatus)) return sum;
    return sum + lineSubtotal(it);
  }, 0);
}

/**
 * Allocate order-level discount across active (non-cancelled/rejected) lines by subtotal weight.
 */
function allocateDiscount(order, line) {
  const disc = Number(order.discountTotal) || 0;
  if (disc <= 0) return 0;
  const active = (order.items || []).filter((it) => it && !FINAL_NEGATIVE.has(it.itemStatus));
  const total = active.reduce((s, it) => s + lineSubtotal(it), 0);
  if (total <= 0) return 0;
  return Math.round((lineSubtotal(line) / total) * disc * 100) / 100;
}

function refundableForLine(order, line) {
  const sub = lineSubtotal(line);
  const allocatedDisc = allocateDiscount(order, line);
  const net = Math.max(0, sub - allocatedDisc);
  const already = Number(line.refundedAmount) || 0;
  return Math.max(0, Math.round((net - already) * 100) / 100);
}

function aggregateOrderStatus(order) {
  normalizeOrderItems(order);
  const items = order.items || [];
  if (!items.length) return normalizeOrderStatus(order.status);

  const counts = {};
  ITEM_STATUSES.forEach((s) => { counts[s] = 0; });
  items.forEach((it) => { counts[it.itemStatus] = (counts[it.itemStatus] || 0) + 1; });
  const n = items.length;
  const all = (s) => counts[s] === n;
  const some = (s) => counts[s] > 0;
  const nonePendingLike = counts.pending === 0;

  /* Mixed aggregates — compute flags before early returns so labels stay accurate */
  order.aggregateFlags = order.aggregateFlags || {};
  order.aggregateFlags.partiallyApproved = some("approved") && (some("pending") || some("rejected") || some("cancelled"));
  order.aggregateFlags.partiallyRejected = some("rejected") && !all("rejected");
  order.aggregateFlags.partiallyFulfilled = some("shipped") || some("delivered");
  order.aggregateFlags.partiallyCancelled = some("cancelled") && !all("cancelled");
  order.aggregateFlags.partiallyReturned =
    (some("return_completed") || some("return_requested") || some("return_approved"))
    && !all("return_completed")
    && !(all("return_requested") || all("return_approved"));

  if (all("cancelled")) return "cancelled";
  if (all("rejected")) return "cancelled";
  if (all("return_completed")) return "return_completed";
  if (all("delivered")) return "delivered";
  if (all("shipped")) return "dispatched";
  if (all("approved")) return "confirmed";
  if (all("pending")) return "new";
  if (all("return_requested")) return "return_requested";
  if (all("return_approved")) return "return_approved";

  /* Full return flow only when no active fulfillment lines remain */
  if (some("return_requested") && !some("pending") && !some("approved") && !some("shipped") && !some("delivered")) {
    return "return_requested";
  }
  if (some("return_approved") && !some("pending") && !some("approved") && !some("shipped") && !some("delivered")) {
    return "return_approved";
  }

  /* Partial return with remaining delivered/shipped items */
  if (order.aggregateFlags.partiallyReturned && some("delivered") && !some("pending") && !some("approved") && !some("shipped")) {
    return "partially_returned";
  }
  if (order.aggregateFlags.partiallyReturned && (some("delivered") || some("shipped"))) {
    return "partially_returned";
  }

  if (some("delivered") && (some("shipped") || some("approved") || some("pending"))) return "dispatched";
  if (some("shipped") && (some("approved") || some("pending"))) return "dispatched";
  if (some("approved") && some("pending")) return "confirmed";
  if (some("approved") && (some("rejected") || some("cancelled")) && nonePendingLike) return "confirmed";
  if (some("pending")) return "new";
  if (some("delivered")) return "delivered";
  if (some("shipped")) return "dispatched";
  if (some("approved")) return "confirmed";
  return normalizeOrderStatus(order.status);
}

function refreshOrderTotals(order) {
  normalizeOrderItems(order);
  const itemsTotal = (order.items || []).reduce((s, it) => {
    if (!it || FINAL_NEGATIVE.has(it.itemStatus)) return s;
    return s + lineSubtotal(it);
  }, 0);
  const deliveryFee = Number(order.deliveryFee) || 0;
  /* Keep historical discount snapshot; re-clamp so total never negative */
  let discountTotal = Number(order.discountTotal) || 0;
  if (discountTotal > itemsTotal) discountTotal = itemsTotal;
  order.itemsTotal = Math.round(itemsTotal * 100) / 100;
  order.discountTotal = Math.round(discountTotal * 100) / 100;
  order.total = Math.max(0, Math.round((itemsTotal - discountTotal + deliveryFee) * 100) / 100);
  const agg = aggregateOrderStatus(order);
  order.status = agg;
  return order;
}

function setItemStatus(order, lineId, nextStatus, meta) {
  meta = meta || {};
  const line = findLine(order, lineId);
  if (!line) return { ok: false, error: "line_not_found", status: 404 };
  const prev = line.itemStatus;
  if (prev === nextStatus) return { ok: true, noop: true, line };
  line.itemStatus = nextStatus;
  line.statusHistory = Array.isArray(line.statusHistory) ? line.statusHistory : [];
  line.statusHistory.push({
    from: prev,
    to: nextStatus,
    at: Date.now(),
    by: meta.by || "admin",
    reason: meta.reason || "",
  });
  if (nextStatus === "rejected") {
    line.rejectedAt = Date.now();
    line.rejectReason = meta.reason || "";
  }
  if (nextStatus === "cancelled") {
    line.cancelledAt = Date.now();
    line.cancelReason = meta.reason || "";
  }
  if (nextStatus === "shipped") line.shippedAt = Date.now();
  if (nextStatus === "delivered") line.deliveredAt = Date.now();
  if (nextStatus === "approved" && !order.approvedAt) {
    applyApprovedCancelWindow(order);
  }
  refreshOrderTotals(order);
  appendHistory(order, {
    status: order.status,
    by: meta.by || "admin",
    note: meta.note || ("item " + lineId + " → " + nextStatus),
    lineId,
  });
  return { ok: true, line, order };
}

function approveItems(order, lineIds, meta) {
  const ids = lineIds && lineIds.length ? lineIds : (order.items || []).filter((it) => it.itemStatus === "pending").map((it) => it.lineId);
  const results = [];
  ids.forEach((id) => {
    const line = findLine(order, id);
    if (!line) { results.push({ lineId: id, ok: false, error: "not_found" }); return; }
    if (line.itemStatus !== "pending") { results.push({ lineId: id, ok: false, error: "not_pending" }); return; }
    results.push(Object.assign({ lineId: id }, setItemStatus(order, id, "approved", meta)));
  });
  return { ok: results.some((r) => r.ok), results, order };
}

function rejectItems(order, lineIds, meta) {
  meta = meta || {};
  const ids = lineIds && lineIds.length ? lineIds : (order.items || []).filter((it) => it.itemStatus === "pending").map((it) => it.lineId);
  const results = [];
  const restock = [];
  ids.forEach((id) => {
    const line = findLine(order, id);
    if (!line) { results.push({ lineId: id, ok: false, error: "not_found" }); return; }
    if (line.itemStatus !== "pending" && line.itemStatus !== "approved") {
      results.push({ lineId: id, ok: false, error: "not_rejectable" });
      return;
    }
    if (!meta.reason && line.itemStatus === "approved") {
      /* reason preferred but not hard-required for pending */
    }
    const r = setItemStatus(order, id, "rejected", meta);
    if (r.ok && !line.stockRestored) {
      restock.push(line);
      line.stockRestored = true;
    }
    results.push(Object.assign({ lineId: id }, r));
  });
  return { ok: results.some((r) => r.ok), results, restock, order };
}

function customerCanCancelItem(order, line, now) {
  normalizeOrderItems(order);
  if (!line) return { ok: false, error: "line_not_found" };
  if (FINAL_NEGATIVE.has(line.itemStatus)) return { ok: false, error: "already_final" };
  if (line.itemStatus === "shipped" || line.itemStatus === "delivered") {
    return { ok: false, error: "customer_cannot_cancel_shipped" };
  }
  if (line.itemStatus === "rejected") return { ok: false, error: "already_rejected" };
  /* Reuse order-level cancel window rules */
  const info = customerCancelInfo(order, now);
  if (order.status === "new" || line.itemStatus === "pending") {
    return { ok: true, remainingMs: info.remainingMs, cancelDeadline: info.cancelDeadline };
  }
  if (!info.ok) return info;
  if (line.itemStatus !== "approved" && line.itemStatus !== "pending") {
    return { ok: false, error: "customer_cannot_cancel" };
  }
  return info;
}

function cancelItem(order, lineId, meta) {
  meta = meta || {};
  const line = findLine(order, lineId);
  if (!line) return { ok: false, error: "line_not_found", status: 404 };
  if (meta.actor === "customer") {
    const gate = customerCanCancelItem(order, line, meta.now);
    if (!gate.ok) return { ok: false, error: gate.error, status: 400, remainingMs: gate.remainingMs };
  } else if (line.itemStatus === "delivered" || line.itemStatus === "return_completed") {
    return { ok: false, error: "cannot_cancel_delivered", status: 400 };
  }
  if (line.itemStatus === "cancelled") return { ok: false, error: "already_cancelled", status: 409 };
  const refundable = refundableForLine(order, line);
  const r = setItemStatus(order, lineId, "cancelled", meta);
  if (!r.ok) return r;
  const restock = [];
  if (!line.stockRestored) {
    restock.push(line);
    line.stockRestored = true;
  }
  if (meta.recordRefund && refundable > 0) {
    line.refundedAmount = (Number(line.refundedAmount) || 0) + refundable;
  }
  /* If all items cancelled → order cancelled */
  refreshOrderTotals(order);
  return { ok: true, line, restock, refundable, order };
}

function itemReturnEligible(order, line, now) {
  normalizeOrderItems(order);
  if (!line) return { ok: false, error: "line_not_found" };
  if (line.itemStatus !== "delivered") return { ok: false, error: "return_only_after_delivered" };
  if (line.returnRequest) return { ok: false, error: "return_already_requested" };
  /* Prefer per-item deliveredAt; fall back to order deliveredAt / return window */
  const probe = {
    status: "delivered",
    deliveredAt: line.deliveredAt || order.deliveredAt,
    returnDeadlineAt: line.returnDeadlineAt || order.returnDeadlineAt,
    returnWindowDaysAtDelivery: order.returnWindowDaysAtDelivery,
    lateReturnApproved: order.lateReturnApproved || line.lateReturnApproved,
  };
  const win = returnWindowInfo(probe, now);
  if (!win.ok) return { ok: false, error: win.error || "return_window_expired", deadline: win.deadline };
  return { ok: true, deadline: win.deadline };
}

function requestItemReturn(order, lineId, body, meta) {
  meta = meta || {};
  const line = findLine(order, lineId);
  if (!line) return { ok: false, error: "line_not_found", status: 404 };
  const elig = itemReturnEligible(order, line, meta.now);
  if (!elig.ok) return { ok: false, error: elig.error, status: 400 };
  const method = String((body && body.method) || "");
  if (method !== "pickup_store" && method !== "pickup_customer") {
    return { ok: false, error: "return_method_required", status: 400 };
  }
  if (!(body && (body.reasonId || body.reason))) {
    return { ok: false, error: "return_reason_required", status: 400 };
  }
  const refundable = refundableForLine(order, line);
  line.returnRequest = {
    method,
    reason: String(body.reason || "").slice(0, 500),
    details: String(body.details || "").slice(0, 1000),
    reasonId: body.reasonId || null,
    reasonTitleSnapshot: body.reasonTitleSnapshot || String(body.reason || "").slice(0, 200),
    requestedAt: Date.now(),
    refundStatus: "not_ready",
    approvedRefundAmount: refundable,
    stockRestored: false,
    returnPickupStatus: method === "pickup_customer" ? "not_assigned" : "n_a",
  };
  setItemStatus(order, lineId, "return_requested", { by: meta.by || "customer", reason: body.reason });
  return { ok: true, line, order };
}

function createShipment(order, lineIds, meta) {
  meta = meta || {};
  normalizeOrderItems(order);
  const ids = Array.isArray(lineIds) ? lineIds.map(String) : [];
  if (!ids.length) return { ok: false, error: "no_lines", status: 400 };
  const lines = [];
  for (const id of ids) {
    const line = findLine(order, id);
    if (!line) return { ok: false, error: "line_not_found", status: 404, lineId: id };
    if (line.itemStatus !== "approved") {
      return { ok: false, error: "line_not_approved", status: 400, lineId: id };
    }
    lines.push(line);
  }
  const shipment = {
    id: "shp_" + crypto.randomBytes(6).toString("hex"),
    createdAt: Date.now(),
    dispatchedAt: Date.now(),
    deliveredAt: null,
    method: meta.method || ((order.delivery && order.delivery.method) || "deliver"),
    driverId: meta.driverId || order.driverId || null,
    lineIds: lines.map((l) => l.lineId),
    quantities: lines.map((l) => ({ lineId: l.lineId, qty: Number(l.qty) || 1 })),
    by: meta.by || "admin",
    status: "dispatched",
  };
  order.shipments.push(shipment);
  lines.forEach((l) => {
    setItemStatus(order, l.lineId, "shipped", { by: meta.by || "admin", note: "shipment " + shipment.id });
  });
  return { ok: true, shipment, order };
}

function markShipmentDelivered(order, shipmentId, meta) {
  meta = meta || {};
  normalizeOrderItems(order);
  const shp = (order.shipments || []).find((s) => s && s.id === shipmentId);
  if (!shp) return { ok: false, error: "shipment_not_found", status: 404 };
  shp.status = "delivered";
  shp.deliveredAt = Date.now();
  (shp.lineIds || []).forEach((id) => {
    const line = findLine(order, id);
    if (line && line.itemStatus === "shipped") {
      setItemStatus(order, id, "delivered", { by: meta.by || "admin" });
      if (!line.returnDeadlineAt && order.returnDeadlineAt) line.returnDeadlineAt = order.returnDeadlineAt;
    }
  });
  refreshOrderTotals(order);
  return { ok: true, shipment: shp, order };
}

function statusLabelItemFa(code) {
  const m = {
    pending: "در انتظار تأیید",
    approved: "تأیید شد",
    rejected: "رد شد",
    cancelled: "لغو شد",
    preparing: "در حال آماده‌سازی",
    ready_pickup: "آماده تحویل از فروشگاه",
    ready_ship: "آماده ارسال",
    handed_to_driver: "تحویل به درایور",
    in_transit: "در مسیر",
    shipped: "ارسال شد",
    delivered: "تحویل داده شد",
    return_requested: "درخواست برگشت ثبت شد",
    return_approved: "برگشت تأیید شد",
    return_awaiting_pickup: "در انتظار جمع‌آوری",
    return_driver_en_route: "درایور در مسیر جمع‌آوری",
    return_collected: "جنس برگشتی جمع‌آوری شد",
    return_to_store: "به فروشگاه برگشت",
    return_reviewing: "در حال بررسی برگشتی",
    return_rejected: "برگشت رد شد",
    return_completed: "برگشت تکمیل شد",
    refund_pending: "بازپرداخت در انتظار",
    refund_completed: "بازپرداخت انجام شد",
  };
  return m[code] || code;
}

/**
 * Human-readable Dari status for one line, considering order-level return/driver context.
 */
function customerItemStatusLabel(order, item) {
  if (!item) return "";
  normalizeOrderItems(order);
  const st = item.itemStatus || mapOrderStatusToItem(order && order.status);
  const rr = (order && order.returnRequest) || (item && item.returnRequest) || null;
  const isPickup = order && order.delivery && (
    order.delivery.method === "pickup" || order.delivery.method === "store_pickup" || order.delivery.method === "store"
  );

  if (rr && (st === "return_requested" || st === "return_approved" || st === "return_completed" || st.indexOf("return") === 0)) {
    const rps = rr.returnPickupStatus || "";
    if (rr.refundStatus === "paid" || rr.cashRefundPaid) return statusLabelItemFa("refund_completed");
    if (st === "return_completed") return statusLabelItemFa("return_completed");
    if (rps === "returned_to_store") return statusLabelItemFa("return_to_store");
    if (rps === "picked_up" || rr.pickupConfirmed) return statusLabelItemFa("return_collected");
    if (rps === "on_the_way") return statusLabelItemFa("return_driver_en_route");
    if (rps === "assigned" || rps === "not_assigned") return statusLabelItemFa("return_awaiting_pickup");
    if (st === "return_approved") return statusLabelItemFa("return_approved");
    if (st === "return_requested") return statusLabelItemFa("return_requested");
    if (rr.refundStatus === "approved" || rr.refundStatus === "pending") return statusLabelItemFa("refund_pending");
  }

  if (st === "approved" && isPickup) return statusLabelItemFa("preparing");
  if (st === "shipped" && isPickup) return statusLabelItemFa("ready_pickup");
  if (st === "approved" && !isPickup) {
    if (order && order.driverStatus === "picked_up") return statusLabelItemFa("handed_to_driver");
    if (order && order.driverStatus === "in_transit") return statusLabelItemFa("in_transit");
    return statusLabelItemFa("ready_ship");
  }
  if (st === "shipped") {
    if (order && order.driverStatus === "in_transit") return statusLabelItemFa("in_transit");
    if (order && order.driverStatus === "picked_up") return statusLabelItemFa("handed_to_driver");
    return statusLabelItemFa("shipped");
  }
  return statusLabelItemFa(st);
}

function itemStatusTimestamp(item, order) {
  if (!item) return null;
  const st = item.itemStatus;
  if (st === "delivered" && item.deliveredAt) return item.deliveredAt;
  if (st === "shipped" && item.shippedAt) return item.shippedAt;
  if (st === "cancelled" && item.cancelledAt) return item.cancelledAt;
  if (st === "rejected" && item.rejectedAt) return item.rejectedAt;
  if (st === "return_completed" && item.returnRequest && item.returnRequest.completedAt) {
    return item.returnRequest.completedAt;
  }
  const rr = order && order.returnRequest;
  if (rr) {
    if (rr.cashRefundPaidAt) return rr.cashRefundPaidAt;
    if (rr.pickedUpAt) return rr.pickedUpAt;
    if (rr.completedAt) return rr.completedAt;
  }
  return null;
}

/** Aggregate Dari label for mixed multi-item orders. */
function customerOrderAggregateLabel(order) {
  if (!order) return "";
  normalizeOrderItems(order);
  aggregateOrderStatus(order);
  const flags = order.aggregateFlags || {};
  const items = order.items || [];
  const statuses = items.map((it) => it.itemStatus);
  const some = (s) => statuses.indexOf(s) >= 0;
  const allSame = statuses.length && statuses.every((s) => s === statuses[0]);

  if (flags.partiallyReturned || (some("return_completed") && !statuses.every((s) => s === "return_completed"))) {
    return "بخشی برگشت داده شد";
  }
  if (flags.partiallyCancelled || (some("cancelled") && !statuses.every((s) => s === "cancelled"))) {
    return "بخشی لغو شد";
  }
  if (some("delivered") && (some("shipped") || some("approved") || some("pending"))) {
    return "بخشی تحویل داده شد";
  }
  if (some("shipped") && (some("approved") || some("pending"))) {
    return "بخشی ارسال شد";
  }
  if (flags.partiallyRejected || (some("rejected") && !statuses.every((s) => s === "rejected"))) {
    return "بخشی رد شد";
  }
  if (flags.partiallyApproved || (some("approved") && some("pending"))) {
    return "بخشی تأیید شد";
  }
  if (allSame) {
    return customerItemStatusLabel(order, items[0]);
  }
  /* Fallback to order-level mapping */
  const code = order.status || aggregateOrderStatus(order);
  const orderMap = {
    new: "در انتظار تأیید",
    pending: "در انتظار تأیید",
    confirmed: "تأیید شد",
    dispatched: "ارسال شد",
    delivered: "تحویل داده شد",
    cancelled: "لغو شد",
    return_requested: "درخواست برگشت ثبت شد",
    return_approved: "برگشت تأیید شد",
    return_rejected: "برگشت رد شد",
    return_completed: "برگشت تکمیل شد",
  };
  return orderMap[code] || statusLabelItemFa(code) || String(code || "");
}

function publicItem(it) {
  if (!it) return null;
  return {
    lineId: it.lineId,
    name: it.name,
    name_en: it.name_en,
    code: it.code,
    price: it.price,
    listPrice: it.listPrice,
    discount: it.discount,
    qty: it.qty,
    size: it.size,
    color: it.color,
    image: it.image,
    itemStatus: it.itemStatus,
    rejectReason: it.rejectReason || "",
    cancelReason: it.cancelReason || "",
    shippedAt: it.shippedAt,
    deliveredAt: it.deliveredAt,
    cancelledAt: it.cancelledAt,
    returnRequest: it.returnRequest || null,
    refundedAmount: it.refundedAmount || 0,
  };
}

module.exports = {
  ITEM_STATUSES,
  CUSTOMER_CANCEL_WINDOW_MS,
  newLineId,
  normalizeOrderItems,
  findLine,
  lineSubtotal,
  refundableForLine,
  allocateDiscount,
  aggregateOrderStatus,
  refreshOrderTotals,
  setItemStatus,
  approveItems,
  rejectItems,
  customerCanCancelItem,
  cancelItem,
  itemReturnEligible,
  requestItemReturn,
  createShipment,
  markShipmentDelivered,
  publicItem,
  statusLabelItemFa,
  customerItemStatusLabel,
  customerOrderAggregateLabel,
  itemStatusTimestamp,
  mapOrderStatusToItem,
  FINAL_NEGATIVE,
  ACTIVE_FULFILL,
};
