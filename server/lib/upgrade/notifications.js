"use strict";

const crypto = require("crypto");

function ensureNotes(db) {
  if (!Array.isArray(db.orderNotifications)) db.orderNotifications = [];
}

function summaryOf(order) {
  const c = order.customer || {};
  return {
    orderId: order.id,
    name: c.name || "",
    phone: c.phone || "",
    total: order.total || 0,
    currency: "AFN",
    payment: order.payment || "",
    paymentStatus: order.paymentStatus || "",
    status: order.status || "",
    createdAt: order.date || Date.now(),
  };
}

function createForOrder(db, order) {
  ensureNotes(db);
  if (!order || !order.id) return null;
  if (db.orderNotifications.some((n) => n && n.orderId === order.id)) {
    return db.orderNotifications.find((n) => n.orderId === order.id);
  }
  const row = {
    id: "ntf_" + crypto.randomBytes(6).toString("hex"),
    orderId: order.id,
    createdAt: Date.now(),
    readAt: null,
    summary: summaryOf(order),
  };
  db.orderNotifications.unshift(row);
  if (db.orderNotifications.length > 400) db.orderNotifications.length = 400;
  return row;
}

function listForAdmin(db) {
  ensureNotes(db);
  const unread = db.orderNotifications.filter((n) => n && !n.readAt).length;
  return {
    unread: unread,
    notifications: db.orderNotifications.slice(0, 40),
  };
}

function markRead(db, id) {
  ensureNotes(db);
  if (id === "all") {
    db.orderNotifications.forEach((n) => { if (n && !n.readAt) n.readAt = Date.now(); });
    return listForAdmin(db);
  }
  const row = db.orderNotifications.find((n) => n && n.id === id);
  if (!row) return null;
  row.readAt = row.readAt || Date.now();
  return listForAdmin(db);
}

module.exports = { ensureNotes, createForOrder, listForAdmin, markRead, summaryOf };
