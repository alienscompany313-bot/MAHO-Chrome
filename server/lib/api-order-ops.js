"use strict";
/**
 * Order item ops, customer block, store inventory, pickup stores,
 * order-value discounts, staff deactivate, reorder — additive API surface.
 */
const { sanitizeText } = require("./security");
const { pushAudit } = require("./audit");
const { hasPerm, updateStaff, publicStaff } = require("./staff");
const { appendHistory, normalizeOrderStatus, applyApprovedCancelWindow } = require("./orders");
const {
  normalizeOrderItems, approveItems, rejectItems, cancelItem, requestItemReturn,
  createShipment, markShipmentDelivered, findLine, publicItem, itemReturnEligible,
  customerCanCancelItem, refreshOrderTotals, newLineId, setItemStatus,
} = require("./order-items");
const {
  eligiblePickupStores, resolvePickupStore, setStoreAvailability, ensureStoreStock,
} = require("./store-inventory");
const {
  listRules, upsertRule, deleteRule, evaluateOrderValueDiscount, ensureDiscountRules,
} = require("./order-discounts");
const { applyStockDelta, checkStock, availableStock } = require("./variant-stock");
const { resolveReasonSnapshot } = require("./returns-ops");

function mountOrderOps(app, ctx) {
  const { saveDb, auth, requireAdmin, requireUser, sessions } = ctx;
  const mail = () => ctx.mail;

  function guard(perm) {
    return (req, res, next) => {
      let s = auth(req);
      if (!s || s.type !== "admin") return res.status(401).json({ error: "admin required" });
      if (!s.owner && s.staffId) {
        const row = (ctx.db.staff || []).find((x) => x.id === s.staffId);
        if (!row || row.active === false) {
          const t = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
          if (t) sessions.delete(t);
          return res.status(401).json({ error: "admin required" });
        }
        s.permissions = row.permissions || [];
      }
      if (!hasPerm(s, perm)) return res.status(403).json({ error: "forbidden", need: perm });
      req.adminSession = s;
      next();
    };
  }

  function findOrder(id) {
    return (ctx.db.orders || []).find((o) => o && o.id === id) || null;
  }

  function restockLines(lines) {
    (lines || []).forEach((it) => {
      const p = ctx.findProduct(it.name, it.code);
      if (!p) return;
      applyStockDelta(p, it.qty, 1, it.color, it.size);
    });
  }

  /* ---------- Item approve / reject ---------- */
  app.post("/api/admin/orders/:id/items/approve", guard("orders"), (req, res) => {
    const o = findOrder(req.params.id);
    if (!o) return res.status(404).json({ error: "not_found" });
    normalizeOrderItems(o);
    const lineIds = Array.isArray(req.body && req.body.lineIds) ? req.body.lineIds : [];
    const r = approveItems(o, lineIds, { by: (req.adminSession && req.adminSession.name) || "admin" });
    if (!r.ok) return res.status(400).json({ error: "nothing_approved", results: r.results });
    pushAudit(ctx.db, {
      actor: req.adminSession.name || "admin",
      action: "items_approve",
      entityType: "order",
      entityId: o.id,
      meta: { lineIds },
    });
    saveDb();
    res.json({ ok: true, order: publicOrderLite(o), results: r.results });
  });

  app.post("/api/admin/orders/:id/items/reject", guard("orders"), (req, res) => {
    const o = findOrder(req.params.id);
    if (!o) return res.status(404).json({ error: "not_found" });
    normalizeOrderItems(o);
    const lineIds = Array.isArray(req.body && req.body.lineIds) ? req.body.lineIds : [];
    const reason = sanitizeText((req.body && req.body.reason) || "", 400);
    const r = rejectItems(o, lineIds, {
      by: (req.adminSession && req.adminSession.name) || "admin",
      reason,
    });
    if (!r.ok) return res.status(400).json({ error: "nothing_rejected", results: r.results });
    restockLines(r.restock);
    pushAudit(ctx.db, {
      actor: req.adminSession.name || "admin",
      action: "items_reject",
      entityType: "order",
      entityId: o.id,
      meta: { lineIds, reason },
    });
    saveDb();
    if (o.customer && o.customer.email && mail() && mail().orderStatus) {
      mail().orderStatus(o.customer.email, o, reason || "رد آیتم", o.lang || "fa").catch(() => {});
    }
    res.json({ ok: true, order: publicOrderLite(o), results: r.results });
  });

  /* ---------- Item ship / deliver (same transition helpers as bulk) ---------- */
  app.post("/api/admin/orders/:id/items/ship", guard("orders"), (req, res) => {
    const o = findOrder(req.params.id);
    if (!o) return res.status(404).json({ error: "not_found" });
    normalizeOrderItems(o);
    const lineIds = Array.isArray(req.body && req.body.lineIds) ? req.body.lineIds : [];
    const ids = lineIds.length
      ? lineIds
      : (o.items || []).filter((it) => it && it.itemStatus === "approved").map((it) => it.lineId);
    if (!ids.length) return res.status(400).json({ error: "nothing_to_ship" });
    const r = createShipment(o, ids, {
      by: (req.adminSession && req.adminSession.name) || "admin",
      method: (o.delivery && o.delivery.method) || "deliver",
    });
    if (!r.ok) return res.status(r.status || 400).json({ error: r.error, lineId: r.lineId });
    pushAudit(ctx.db, {
      actor: req.adminSession.name || "admin",
      action: "items_ship",
      entityType: "order",
      entityId: o.id,
      meta: { shipmentId: r.shipment.id, lineIds: ids },
    });
    saveDb();
    res.json({ ok: true, shipment: r.shipment, order: publicOrderLite(o) });
  });

  app.post("/api/admin/orders/:id/items/deliver", guard("orders"), (req, res) => {
    const o = findOrder(req.params.id);
    if (!o) return res.status(404).json({ error: "not_found" });
    normalizeOrderItems(o);
    const lineIds = Array.isArray(req.body && req.body.lineIds) ? req.body.lineIds : [];
    const ids = lineIds.length
      ? lineIds
      : (o.items || []).filter((it) => it && it.itemStatus === "shipped").map((it) => it.lineId);
    const results = [];
    ids.forEach((id) => {
      const line = findLine(o, id);
      if (!line) { results.push({ lineId: id, ok: false, error: "not_found" }); return; }
      if (line.itemStatus !== "shipped") {
        results.push({ lineId: id, ok: false, error: "not_shipped" });
        return;
      }
      results.push(Object.assign({ lineId: id }, setItemStatus(o, id, "delivered", {
        by: (req.adminSession && req.adminSession.name) || "admin",
        note: "item delivered",
      })));
    });
    if (!results.some((r) => r.ok)) return res.status(400).json({ error: "nothing_delivered", results });
    /* Keep shipment records in sync when present */
    (o.shipments || []).forEach((shp) => {
      if (!shp || shp.status === "delivered") return;
      const lids = shp.lineIds || [];
      if (lids.length && lids.every((lid) => {
        const ln = findLine(o, lid);
        return ln && ln.itemStatus === "delivered";
      })) {
        shp.status = "delivered";
        shp.deliveredAt = Date.now();
      }
    });
    pushAudit(ctx.db, {
      actor: req.adminSession.name || "admin",
      action: "items_deliver",
      entityType: "order",
      entityId: o.id,
      meta: { lineIds: ids },
    });
    saveDb();
    res.json({ ok: true, order: publicOrderLite(o), results });
  });

  /* ---------- Partial shipment ---------- */
  app.post("/api/admin/orders/:id/shipments", guard("orders"), (req, res) => {
    const o = findOrder(req.params.id);
    if (!o) return res.status(404).json({ error: "not_found" });
    const lineIds = Array.isArray(req.body && req.body.lineIds) ? req.body.lineIds : [];
    const r = createShipment(o, lineIds, {
      by: (req.adminSession && req.adminSession.name) || "admin",
      driverId: req.body && req.body.driverId,
      method: req.body && req.body.method,
    });
    if (!r.ok) return res.status(r.status || 400).json({ error: r.error, lineId: r.lineId });
    pushAudit(ctx.db, {
      actor: req.adminSession.name || "admin",
      action: "shipment_create",
      entityType: "order",
      entityId: o.id,
      meta: { shipmentId: r.shipment.id, lineIds },
    });
    saveDb();
    if (o.customer && o.customer.email && mail() && mail().orderStatus) {
      const note = "ارسال جزئی: " + lineIds.join(", ");
      mail().orderStatus(o.customer.email, o, note, o.lang || "fa").catch(() => {});
    }
    res.json({ ok: true, shipment: r.shipment, order: publicOrderLite(o) });
  });

  app.post("/api/admin/orders/:id/shipments/:sid/deliver", guard("orders"), (req, res) => {
    const o = findOrder(req.params.id);
    if (!o) return res.status(404).json({ error: "not_found" });
    const r = markShipmentDelivered(o, req.params.sid, {
      by: (req.adminSession && req.adminSession.name) || "admin",
    });
    if (!r.ok) return res.status(r.status || 400).json({ error: r.error });
    pushAudit(ctx.db, {
      actor: req.adminSession.name || "admin",
      action: "shipment_deliver",
      entityType: "order",
      entityId: o.id,
      meta: { shipmentId: req.params.sid },
    });
    saveDb();
    res.json({ ok: true, shipment: r.shipment, order: publicOrderLite(o) });
  });

  /* ---------- Customer item cancel ---------- */
  app.post("/api/orders/:id/items/:lineId/cancel", requireUser, (req, res) => {
    const o = findOrder(req.params.id);
    if (!o) return res.status(404).json({ error: "not_found" });
    if (String(o.userId) !== String(req.user.id)) return res.status(403).json({ error: "forbidden" });
    const reason = sanitizeText((req.body && req.body.reason) || "", 400);
    const r = cancelItem(o, req.params.lineId, {
      actor: "customer",
      by: "customer",
      reason,
      recordRefund: true,
    });
    if (!r.ok) return res.status(r.status || 400).json({ error: r.error, remainingMs: r.remainingMs });
    restockLines(r.restock);
    pushAudit(ctx.db, {
      actor: req.user.email || req.user.id,
      action: "item_cancel_customer",
      entityType: "order",
      entityId: o.id,
      meta: { lineId: req.params.lineId, reason },
    });
    saveDb();
    res.json({ ok: true, item: publicItem(r.line), order: publicOrderLite(o), refundable: r.refundable });
  });

  app.get("/api/orders/:id/items/:lineId/cancel-info", requireUser, (req, res) => {
    const o = findOrder(req.params.id);
    if (!o) return res.status(404).json({ error: "not_found" });
    if (String(o.userId) !== String(req.user.id)) return res.status(403).json({ error: "forbidden" });
    const line = findLine(o, req.params.lineId);
    res.json(customerCanCancelItem(o, line));
  });

  /* ---------- Customer item return ---------- */
  app.post("/api/orders/:id/items/:lineId/return-request", requireUser, (req, res) => {
    const o = findOrder(req.params.id);
    if (!o) return res.status(404).json({ error: "not_found" });
    if (String(o.userId) !== String(req.user.id)) return res.status(403).json({ error: "forbidden" });
    const body = req.body || {};
    let reasonTitle = "";
    if (body.reasonId) {
      const snap = resolveReasonSnapshot(ctx.db, body.reasonId, body.reason);
      if (!snap.active) return res.status(400).json({ error: "inactive_reason" });
      body.reasonTitleSnapshot = snap.reasonTitleSnapshot || body.reason;
      reasonTitle = body.reasonTitleSnapshot;
      if (!body.reason) body.reason = reasonTitle;
      if (snap.requireNote && !String(body.details || "").trim()) {
        return res.status(400).json({ error: "details_required" });
      }
    }
    const r = requestItemReturn(o, req.params.lineId, body, { by: "customer" });
    if (!r.ok) return res.status(r.status || 400).json({ error: r.error });
    pushAudit(ctx.db, {
      actor: req.user.email || req.user.id,
      action: "item_return_request",
      entityType: "order",
      entityId: o.id,
      meta: { lineId: req.params.lineId, reason: body.reason || reasonTitle },
    });
    saveDb();
    if (mail() && mail().orderAdminNotify) {
      mail().orderAdminNotify(o, "درخواست برگشت آیتم").catch(() => {});
    }
    res.json({ ok: true, item: publicItem(r.line), order: publicOrderLite(o) });
  });

  app.get("/api/orders/:id/items/:lineId/return-info", requireUser, (req, res) => {
    const o = findOrder(req.params.id);
    if (!o) return res.status(404).json({ error: "not_found" });
    if (String(o.userId) !== String(req.user.id)) return res.status(403).json({ error: "forbidden" });
    const line = findLine(o, req.params.lineId);
    res.json(itemReturnEligible(o, line));
  });

  /* ---------- Reorder ---------- */
  app.post("/api/orders/:id/reorder", requireUser, (req, res) => {
    const o = findOrder(req.params.id);
    if (!o) return res.status(404).json({ error: "not_found" });
    if (String(o.userId) !== String(req.user.id)) return res.status(403).json({ error: "forbidden" });
    const lineIds = Array.isArray(req.body && req.body.lineIds) ? req.body.lineIds.map(String) : null;
    normalizeOrderItems(o);
    const targets = (o.items || []).filter((it) => {
      if (!it) return false;
      if (lineIds && lineIds.indexOf(String(it.lineId)) < 0) return false;
      return true;
    });
    const added = [];
    const skipped = [];
    targets.forEach((it) => {
      const p = ctx.findProduct(it.name, it.code);
      if (!p || p.active === false || p.deleted) {
        skipped.push({ code: it.code, name: it.name, reason: "unavailable" });
        return;
      }
      const chk = checkStock(p, it.qty || 1, it.color, it.size);
      if (!chk.ok) {
        skipped.push({
          code: p.code,
          name: p.name,
          reason: "out_of_stock",
          stock: availableStock(p, it.color, it.size),
        });
        return;
      }
      const disc = Math.min(95, Math.max(0, parseFloat(p.discount) || 0));
      const listPrice = Number(p.price) || 0;
      const price = disc > 0 ? Math.round(listPrice * (1 - disc / 100)) : listPrice;
      added.push({
        code: p.code,
        name: p.name,
        name_en: p.name_en || "",
        price,
        listPrice,
        discount: disc || 0,
        qty: Math.max(1, parseInt(it.qty, 10) || 1),
        size: it.size || "",
        color: it.color || "",
        image: (p.images && p.images[0]) || p.image || it.image || "",
      });
    });
    res.json({ ok: true, items: added, skipped });
  });

  /* ---------- Block / unblock customer ---------- */
  app.post("/api/admin/customers/:id/block", guard("customers"), (req, res) => {
    const u = (ctx.db.users || []).find((x) => x && x.id === req.params.id);
    if (!u) return res.status(404).json({ error: "not_found" });
    if (u.status === "deleted") return res.status(400).json({ error: "account_deleted" });
    u.blocked = true;
    u.blockedAt = Date.now();
    u.blockedBy = (req.adminSession && (req.adminSession.name || req.adminSession.staffId)) || "admin";
    u.blockReason = sanitizeText((req.body && req.body.reason) || "", 400);
    pushAudit(ctx.db, {
      actor: u.blockedBy,
      action: "customer_block",
      entityType: "user",
      entityId: u.id,
      meta: { reason: u.blockReason },
    });
    saveDb();
    res.json({ ok: true, user: ctx.publicUser(u) });
  });

  app.post("/api/admin/customers/:id/unblock", guard("customers"), (req, res) => {
    const u = (ctx.db.users || []).find((x) => x && x.id === req.params.id);
    if (!u) return res.status(404).json({ error: "not_found" });
    u.blocked = false;
    u.unblockedAt = Date.now();
    u.unblockedBy = (req.adminSession && (req.adminSession.name || req.adminSession.staffId)) || "admin";
    pushAudit(ctx.db, {
      actor: u.unblockedBy,
      action: "customer_unblock",
      entityType: "user",
      entityId: u.id,
      meta: {},
    });
    saveDb();
    res.json({ ok: true, user: ctx.publicUser(u) });
  });

  /* ---------- Staff deactivate ---------- */
  app.post("/api/admin/staff/:id/deactivate", guard("staff"), (req, res) => {
    const s = req.adminSession;
    if (!s.owner && s.role !== "owner") return res.status(403).json({ error: "owner_only" });
    const target = (ctx.db.staff || []).find((x) => x.id === req.params.id);
    if (!target) return res.status(404).json({ error: "not_found" });
    if (target.role === "owner") return res.status(400).json({ error: "cannot_deactivate_owner" });
    if (s.staffId && s.staffId === target.id) return res.status(400).json({ error: "cannot_deactivate_self" });
    target.active = false;
    target.deactivatedAt = Date.now();
    target.deactivatedBy = s.name || s.staffId || "owner";
    /* Kill sessions */
    for (const [tok, sess] of sessions.entries()) {
      if (sess && sess.staffId === target.id) sessions.delete(tok);
    }
    pushAudit(ctx.db, {
      actor: target.deactivatedBy,
      action: "staff_deactivate",
      entityType: "staff",
      entityId: target.id,
      meta: {},
    });
    saveDb();
    res.json({ ok: true, staff: publicStaff(target) });
  });

  app.post("/api/admin/staff/:id/reactivate", guard("staff"), (req, res) => {
    const s = req.adminSession;
    if (!s.owner && s.role !== "owner") return res.status(403).json({ error: "owner_only" });
    const r = updateStaff(ctx.db, req.params.id, { active: true }, { allowPerms: false });
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    const target = (ctx.db.staff || []).find((x) => x.id === req.params.id);
    if (target) {
      target.deactivatedAt = null;
      target.reactivatedAt = Date.now();
      target.reactivatedBy = s.name || "owner";
    }
    pushAudit(ctx.db, {
      actor: s.name || "owner",
      action: "staff_reactivate",
      entityType: "staff",
      entityId: req.params.id,
      meta: {},
    });
    saveDb();
    res.json({ ok: true, staff: r.staff });
  });

  /* ---------- Store inventory ---------- */
  app.put("/api/admin/products/:code/store-stock/:storeId", guard("products"), (req, res) => {
    const code = decodeURIComponent(req.params.code);
    const p = (ctx.db.products || []).find((x) => x && String(x.code) === code);
    if (!p) return res.status(404).json({ error: "not_found" });
    ensureStoreStock(p);
    const r = setStoreAvailability(p, req.params.storeId, req.body || {});
    if (!r.ok) return res.status(400).json({ error: r.error });
    pushAudit(ctx.db, {
      actor: (req.adminSession && req.adminSession.name) || "admin",
      action: "store_stock_update",
      entityType: "product",
      entityId: code,
      meta: { storeId: req.params.storeId },
    });
    saveDb();
    res.json({ ok: true, storeIds: p.storeIds, storeStock: p.storeStock });
  });

  /* ---------- Pickup eligible stores ---------- */
  app.post("/api/checkout/pickup-stores", (req, res) => {
    const items = Array.isArray(req.body && req.body.items) ? req.body.items : [];
    const lat = req.body && req.body.lat != null ? Number(req.body.lat) : null;
    const lng = req.body && req.body.lng != null ? Number(req.body.lng) : null;
    const stores = eligiblePickupStores(ctx.db, items, Number.isFinite(lat) ? lat : null, Number.isFinite(lng) ? lng : null);
    res.json({ stores, locationUsed: Number.isFinite(lat) && Number.isFinite(lng) });
  });

  /* ---------- Order-value discount rules ---------- */
  app.get("/api/admin/order-value-discounts", guard("settings"), (req, res) => {
    ensureDiscountRules(ctx.db);
    res.json({ rules: listRules(ctx.db) });
  });

  app.post("/api/admin/order-value-discounts", guard("settings"), (req, res) => {
    const r = upsertRule(ctx.db, req.body || {});
    pushAudit(ctx.db, {
      actor: (req.adminSession && req.adminSession.name) || "admin",
      action: "discount_rule_create",
      entityType: "order_value_discount",
      entityId: r.rule && r.rule.id,
      meta: {},
    });
    saveDb();
    res.json(r);
  });

  app.put("/api/admin/order-value-discounts/:id", guard("settings"), (req, res) => {
    const r = upsertRule(ctx.db, req.body || {}, req.params.id);
    if (!r.ok) return res.status(r.status || 400).json({ error: r.error });
    pushAudit(ctx.db, {
      actor: (req.adminSession && req.adminSession.name) || "admin",
      action: "discount_rule_update",
      entityType: "order_value_discount",
      entityId: req.params.id,
      meta: {},
    });
    saveDb();
    res.json(r);
  });

  app.delete("/api/admin/order-value-discounts/:id", guard("settings"), (req, res) => {
    const r = deleteRule(ctx.db, req.params.id);
    if (!r.ok) return res.status(r.status || 400).json({ error: r.error });
    pushAudit(ctx.db, {
      actor: (req.adminSession && req.adminSession.name) || "admin",
      action: "discount_rule_delete",
      entityType: "order_value_discount",
      entityId: req.params.id,
      meta: {},
    });
    saveDb();
    res.json(r);
  });

  app.post("/api/checkout/order-value-discount", (req, res) => {
    const subtotal = Number(req.body && req.body.subtotal) || 0;
    const fulfillment = (req.body && req.body.fulfillment) || "delivery";
    const ev = evaluateOrderValueDiscount(ctx.db, subtotal, fulfillment);
    res.json(ev);
  });
}

function publicOrderLite(o) {
  if (!o) return null;
  normalizeOrderItems(o);
  refreshOrderTotals(o);
  return {
    id: o.id,
    status: o.status,
    aggregateFlags: o.aggregateFlags || {},
    itemsTotal: o.itemsTotal,
    discountTotal: o.discountTotal,
    deliveryFee: o.deliveryFee,
    total: o.total,
    items: (o.items || []).map(publicItem),
    shipments: o.shipments || [],
    discountSnapshot: o.discountSnapshot || null,
    pickupStore: o.pickupStore || null,
  };
}

module.exports = { mountOrderOps, publicOrderLite };
