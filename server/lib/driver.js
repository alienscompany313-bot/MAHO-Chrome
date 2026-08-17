"use strict";
/**
 * Delivery driver accounts + order assignment + status transitions.
 * Drivers are stored in db.drivers[] (separate from staff) with hashed passwords.
 */
const crypto = require("crypto");
const { hashPassword, verifyPassword, sanitizeText } = require("./security");
const { appendHistory, normalizeOrderStatus } = require("./orders");

const DRIVER_FLOW = ["assigned", "picked_up", "in_transit", "delivered", "failed"];

function publicDriver(d) {
  if (!d) return null;
  return {
    id: d.id,
    name: d.name,
    email: d.email || "",
    phone: d.phone || "",
    active: d.active !== false,
    createdAt: d.createdAt || null,
  };
}

function ensureDrivers(db) {
  if (!Array.isArray(db.drivers)) { db.drivers = []; return true; }
  return false;
}

function createDriver(db, body, actor) {
  ensureDrivers(db);
  const name = sanitizeText(body.name, 80);
  const email = String(body.email || "").trim().toLowerCase();
  const phone = sanitizeText(body.phone, 40);
  const password = String(body.password || "");
  if (!name || password.length < 8) return { error: "invalid_fields", status: 400 };
  if (email && db.drivers.some((x) => x.email === email && x.active !== false)) {
    return { error: "email_exists", status: 409 };
  }
  const row = {
    id: crypto.randomUUID(),
    name,
    email,
    phone,
    pass: hashPassword(password),
    active: true,
    createdAt: Date.now(),
    createdBy: actor || "owner",
  };
  db.drivers.push(row);
  return { driver: publicDriver(row) };
}

function updateDriver(db, id, body) {
  ensureDrivers(db);
  const d = db.drivers.find((x) => x.id === id);
  if (!d) return { error: "not_found", status: 404 };
  if (body.name != null) d.name = sanitizeText(body.name, 80);
  if (body.email != null) d.email = String(body.email || "").trim().toLowerCase();
  if (body.phone != null) d.phone = sanitizeText(body.phone, 40);
  if (body.active != null) d.active = !!body.active;
  if (body.password && String(body.password).length >= 8) d.pass = hashPassword(String(body.password));
  return { driver: publicDriver(d) };
}

function authenticateDriver(db, login, password) {
  ensureDrivers(db);
  const id = String(login || "").trim().toLowerCase();
  const d = db.drivers.find((x) =>
    x.active !== false && [x.email, x.phone, x.id].some((v) => v && String(v).toLowerCase() === id)
  );
  if (!d || !verifyPassword(password, d.pass)) return null;
  return d;
}

function canDriverTransition(from, to) {
  const a = String(from || "assigned");
  const b = String(to || "");
  const allowed = {
    assigned: ["picked_up", "failed"],
    picked_up: ["in_transit", "failed", "delivered"],
    in_transit: ["delivered", "failed"],
    delivered: [],
    failed: ["picked_up", "in_transit"],
  };
  return (allowed[a] || []).indexOf(b) >= 0;
}

function assignDriver(db, order, driverId, actor) {
  ensureDrivers(db);
  const d = db.drivers.find((x) => x.id === driverId && x.active !== false);
  if (!d) return { error: "driver_not_found", status: 404 };
  const st = normalizeOrderStatus(order.status);
  if (st === "cancelled" || st === "delivered") return { error: "cannot_assign", status: 400 };
  order.driverId = d.id;
  order.driverName = d.name;
  order.driverStatus = order.driverStatus || "assigned";
  order.assignedAt = Date.now();
  appendHistory(order, {
    status: order.status,
    by: actor || "admin",
    note: "assign_driver:" + d.name,
    driverId: d.id,
    driverStatus: order.driverStatus,
  });
  return { order, driver: publicDriver(d) };
}

function driverFacingOrder(o) {
  if (!o) return null;
  const c = o.customer || {};
  const loc = o.customerLocation || {};
  return {
    id: o.id,
    date: o.date,
    status: o.status,
    driverStatus: o.driverStatus || "assigned",
    payment: o.payment,
    paymentStatus: o.paymentStatus,
    collectAmount: o.paymentStatus === "payment_confirmed" ? 0 : o.total,
    customer: {
      name: c.name || "",
      phone: c.phone || "",
      address: c.address || "",
    },
    customerLocation: loc.lat != null ? {
      lat: loc.lat, lng: loc.lng, mapsUrl: loc.mapsUrl || null,
    } : null,
    items: (o.items || []).map((it) => ({
      name: it.name, name_en: it.name_en, qty: it.qty, size: it.size, color: it.color,
    })),
    deliveryNote: o.deliveryNote || c.note || "",
    deliveryProofUrl: o.deliveryProof && o.deliveryProof.url ? "/api/driver/proof/" + encodeURIComponent(o.id) : null,
    assignedAt: o.assignedAt || null,
  };
}

function applyDriverStatus(db, order, driver, body, opts) {
  const next = String(body.status || "").trim();
  if (order.driverId !== driver.id) return { error: "not_your_order", status: 403 };
  /* Idempotent: same status already applied */
  if (String(order.driverStatus || "assigned") === next) {
    return { order, noop: true };
  }
  if (!canDriverTransition(order.driverStatus || "assigned", next)) {
    return { error: "invalid_driver_transition", status: 400 };
  }
  if (next === "failed") {
    const reason = sanitizeText(body.reason, 500);
    if (!reason) return { error: "fail_reason_required", status: 400 };
    order.deliveryFailReason = reason;
  }
  const note = sanitizeText(body.note, 500);
  order.driverStatus = next;
  const proofRequired = !!(opts && opts.proofRequired);
  if (next === "delivered") {
    if (proofRequired && !(body.proofUrl || (order.deliveryProof && order.deliveryProof.url))) {
      return { error: "proof_required", status: 400 };
    }
  }
  const loc = body.lat != null && body.lng != null ? {
    lat: parseFloat(body.lat), lng: parseFloat(body.lng), at: Date.now(),
  } : null;
  if (next === "delivered") {
    order.deliveredAt = Date.now();
    order.deliveredByDriverId = driver.id;
    order.deliveredByDriverName = driver.name;
  }
  appendHistory(order, {
    status: order.status,
    by: "driver:" + driver.id,
    driverName: driver.name,
    driverStatus: next,
    note: note || (next === "failed" ? order.deliveryFailReason : ""),
    location: loc,
    at: Date.now(),
  });
  if (next === "delivered" && (normalizeOrderStatus(order.status) === "dispatched" || normalizeOrderStatus(order.status) === "confirmed")) {
    order.status = "delivered";
  }
  return { order };
}

module.exports = {
  DRIVER_FLOW,
  publicDriver,
  ensureDrivers,
  createDriver,
  updateDriver,
  authenticateDriver,
  canDriverTransition,
  assignDriver,
  driverFacingOrder,
  applyDriverStatus,
};
