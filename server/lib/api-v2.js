"use strict";
/**
 * Phase-2 API: returns, staff, POS, soft-delete, order badges, delivery distance.
 */
const crypto = require("crypto");
const { sanitizeText, createRateLimiter, clientIp } = require("./security");
const {
  normalizeOrderStatus, canTransition, appendHistory, customerCanCancel, customerCanReturn,
} = require("./orders");
const { pushAudit } = require("./audit");
const { haversineKm, storeCoords, mapsLink, ensureHttpsUrl, parseCoord } = require("./geo");
const {
  ALL_PERMS, publicStaff, hasPerm, createStaff, updateStaff, authenticateStaff, normalizePerms,
} = require("./staff");
const pos = require("./pos");

function mountV2(app, ctx) {
  const {
    saveDb, auth, requireAdmin, requireUser, publicUser, emailOk,
    sessions, findProduct, isAllowedImageUrl,
  } = ctx;
  const mail = () => ctx.mail;
  const rlPos = createRateLimiter({ windowMs: 5 * 60 * 1000, max: 60 });

  function adminSession(req) {
    return auth(req);
  }

  function guard(perm) {
    return (req, res, next) => {
      let s = adminSession(req);
      if (!s) return res.status(401).json({ error: "admin required" });
      if (s.type === "pos") {
        if (perm !== "pos" && perm !== "reports") {
          return res.status(403).json({ error: "forbidden", need: perm });
        }
        req.adminSession = s;
        return next();
      }
      if (s.type !== "admin") return res.status(401).json({ error: "admin required" });
      /* live-refresh staff permissions from DB */
      if (!s.owner && s.staffId) {
        const row = (ctx.db.staff || []).find((x) => x.id === s.staffId);
        if (!row || row.active === false) {
          const t = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
          if (t) sessions.delete(t);
          return res.status(401).json({ error: "admin required" });
        }
        s.permissions = row.permissions || [];
        s.name = row.name || s.name;
      }
      if (!hasPerm(s, perm)) return res.status(403).json({ error: "forbidden", need: perm });
      req.adminSession = s;
      next();
    };
  }

  function rateOr429(res, check) {
    if (check.ok) return false;
    res.setHeader("Retry-After", String(Math.ceil((check.retryAfterMs || 60000) / 1000)));
    res.status(429).json({ error: "rate_limited" });
    return true;
  }

  /* ---------- order badges / counts ---------- */
  app.get("/api/admin/badges/orders", guard("orders"), (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const orders = ctx.db.orders || [];
    const awaitingConfirm = orders.filter((o) => normalizeOrderStatus(o.status) === "new").length;
    const awaitingHesab = orders.filter((o) =>
      o.payment === "hesab" && ["awaiting_payment", "receipt_submitted", "under_review"].indexOf(o.paymentStatus) >= 0
    ).length;
    const awaitingReturns = orders.filter((o) => {
      const s = normalizeOrderStatus(o.status);
      return s === "return_requested" || s === "return_approved";
    }).length;
    res.json({ awaitingConfirm, awaitingHesab, awaitingReturns, at: Date.now() });
  });

  /* ---------- returns list ---------- */
  app.get("/api/admin/returns", guard("returns"), (req, res) => {
    const { resolveOrderReturnRequest } = require("./returns-ops");
    const list = (ctx.db.orders || [])
      .filter((o) => {
        if (!o) return false;
        if (o.returnRequest) return true;
        const st = normalizeOrderStatus(o.status);
        if (["return_requested", "return_approved", "return_rejected", "return_completed", "partially_returned"].indexOf(st) >= 0) return true;
        return (o.items || []).some((it) => it && it.returnRequest && it.returnRequest.requestedAt);
      })
      .map((o) => ({
        id: o.id,
        status: o.status,
        date: o.date,
        total: o.total,
        customer: o.customer,
        items: o.items,
        returnRequest: resolveOrderReturnRequest(o),
        customerLocation: o.customerLocation || null,
      }));
    res.json({ returns: list });
  });

  app.post("/api/admin/orders/:id/return-resolve", guard("returns"), (req, res) => {
    const o = ctx.db.orders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: "not_found" });
    const { resolveOrderReturnRequest, normalizeReturnMethod } = require("./returns-ops");
    /* Ensure order.returnRequest exists from item returns before approve */
    if (!o.returnRequest) {
      const resolved = resolveOrderReturnRequest(o);
      if (resolved) o.returnRequest = Object.assign({}, resolved);
    }
    const next = normalizeOrderStatus((req.body || {}).status);
    const check = canTransition(o.status, next, { actor: "admin" });
    if (!check.ok) return res.status(400).json({ error: check.error });
    if (check.noop) return res.json({ order: o });
    if (next === "return_completed") {
      const rr = o.returnRequest;
      if (rr && !rr.stockRestored) {
        const method = normalizeReturnMethod(rr.method) || rr.method || "pickup_store";
        const atStore = method === "pickup_store"
          || rr.returnPickupStatus === "returned_to_store"
          || rr.returnPickupStatus === "completed"
          || !!rr.returnedToStoreAt;
        if (!atStore) {
          return res.status(400).json({
            error: "not_returned_to_store",
            message: "ابتدا کالا باید به فروشگاه برگشته و ثبت returned_to_store شود.",
          });
        }
      }
    }
    const prev = o.status;
    o.status = next;
    if (o.returnRequest) {
      /* Preserve method / pickup / reason — only annotate resolution */
      if (o.returnRequest.method) {
        o.returnRequest.method = normalizeReturnMethod(o.returnRequest.method) || o.returnRequest.method;
      }
      o.returnRequest.resolvedAt = Date.now();
      o.returnRequest.resolvedBy = (req.adminSession && (req.adminSession.name || req.adminSession.staffId)) || "admin";
      o.returnRequest.resolveNote = sanitizeText((req.body || {}).note, 500);
    }
    if (next === "return_completed") {
      const rr = o.returnRequest;
      if (rr && !rr.stockRestored) {
        const { applyStockDelta } = require("./variant-stock");
        (o.items || []).forEach((it) => {
          const p = findProduct(it.name, it.code);
          if (p) applyStockDelta(p, it.qty || 1, +1, it.color, it.size);
        });
        rr.stockRestored = true;
        rr.returnPickupStatus = "completed";
        if (!rr.returnedToStoreAt) rr.returnedToStoreAt = Date.now();
        if (rr.refundStatus === "not_ready" || !rr.refundStatus) rr.refundStatus = "approved";
      }
    }
    appendHistory(o, { status: next, by: "admin", note: sanitizeText((req.body || {}).note, 500), from: prev });
    pushAudit(ctx.db, { actor: (req.adminSession && req.adminSession.staffId) || "admin", action: "return_resolve", entityType: "order", entityId: o.id, meta: { status: next } });
    saveDb();
    if (mail() && o.customer && o.customer.email) {
      mail().orderStatus(o.customer.email, o, sanitizeText((req.body || {}).note, 500)).catch(() => {});
    }
    res.json({ order: o });
  });

  /* customer return request (delivered only + return window) */
  app.post("/api/orders/:id/return-request", requireUser, (req, res) => {
    const o = ctx.db.orders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: "not_found" });
    const s = auth(req);
    if (!(s && s.type === "admin") && o.userId !== s.userId) return res.status(403).json({ error: "forbidden" });
    const { customerMayRequestReturn, resolveReasonSnapshot, normalizeReturnMethod } = require("./returns-ops");
    const win = customerMayRequestReturn(o);
    if (!win.ok) return res.status(400).json({ error: win.error || "return_not_allowed" });
    const b = req.body || {};
    /* No silent default — customer must explicitly choose a return method. */
    const method = normalizeReturnMethod(b.method);
    if (method !== "pickup_customer" && method !== "pickup_store") {
      return res.status(400).json({ error: "return_method_required" });
    }
    const reasonId = sanitizeText(b.reasonId, 40);
    let reason = sanitizeText(b.reason, 200);
    let reasonTitleSnapshot = reason;
    if (reasonId) {
      const snap = resolveReasonSnapshot(ctx.db, reasonId, reason);
      if (!snap.active) return res.status(400).json({ error: "inactive_reason" });
      reasonTitleSnapshot = snap.reasonTitleSnapshot || reason;
      reason = reasonTitleSnapshot;
      if (snap.requireNote && !sanitizeText(b.details, 1000)) {
        return res.status(400).json({ error: "details_required" });
      }
    }
    const details = sanitizeText(b.details, 1000);
    if (!reason && !reasonId) return res.status(400).json({ error: "return_reason_required" });
    if (!reason) return res.status(400).json({ error: "reason_required" });
    let pickup = null;
    if (method === "pickup_customer") {
      const lat = parseCoord(b.lat != null ? b.lat : (o.customerLocation && o.customerLocation.lat));
      const lng = parseCoord(b.lng != null ? b.lng : (o.customerLocation && o.customerLocation.lng));
      const address = sanitizeText(b.address || (o.customer && o.customer.address), 400);
      const phone = sanitizeText(b.phone || (o.customer && o.customer.phone), 40);
      if (!address || !phone) return res.status(400).json({ error: "address_phone_required" });
      pickup = {
        address, phone,
        lat: lat != null ? lat : null,
        lng: lng != null ? lng : null,
        mapsUrl: (lat != null && lng != null) ? mapsLink(lat, lng) : (o.customerLocation && o.customerLocation.mapsUrl) || null,
      };
    } else {
      const sc = storeCoords(ctx.db.stores);
      pickup = sc ? {
        address: (sc.store && (sc.store.address || sc.store.name)) || "",
        phone: (sc.store && sc.store.phone) || "",
        lat: sc.lat, lng: sc.lng,
        mapsUrl: (sc.store && (sc.store.mapsUrl || sc.store.map)) || mapsLink(sc.lat, sc.lng),
        storeName: sc.store && sc.store.name,
      } : { address: "", phone: "", mapsUrl: null };
    }
    const check = canTransition(o.status, "return_requested", { actor: "customer" });
    if (!check.ok) return res.status(400).json({ error: check.error });
    o.status = "return_requested";
    o.returnRequest = {
      method, reason, details,
      reasonId: reasonId || null,
      reasonTitleSnapshot,
      requestedAt: Date.now(),
      pickup,
      returnPickupStatus: method === "pickup_customer" ? "not_assigned" : "n/a",
      refundStatus: "not_ready",
      approvedRefundAmount: Number(o.total) || 0,
      stockRestored: false,
    };
    appendHistory(o, { status: "return_requested", by: "customer", note: reason });
    saveDb();
    if (mail() && o.customer && o.customer.email) {
      mail().orderStatus(o.customer.email, o, reason).catch(() => {});
    }
    if (mail()) mail().orderAdminNotify(Object.assign({}, o, { status: "return_requested" })).catch(() => {});
    res.json({ order: o });
  });

  /* soft-delete customer */
  app.post("/api/admin/customers/:id/soft-delete", guard("customers"), (req, res) => {
    const confirm = String((req.body || {}).confirm || "");
    if (confirm !== "DELETE") return res.status(400).json({ error: "confirm_required" });
    const u = (ctx.db.users || []).find((x) => x.id === req.params.id);
    if (!u) return res.status(404).json({ error: "not_found" });
    if (u.deletedAt) return res.json({ ok: true, already: true });
    u.deletedAt = Date.now();
    u.status = "deleted";
    u.active = false;
    u.verified = false;
    /* anonymize PII but keep id for order linkage */
    const stamp = String(u.id).slice(0, 8);
    u.name = "حذف‌شده";
    u.email = "deleted+" + stamp + "@invalid.local";
    u.phone = "";
    u.address = "";
    u.addr = {};
    u.pass = hashDisabled();
    pushAudit(ctx.db, { actor: (req.adminSession && req.adminSession.staffId) || "admin", action: "customer_soft_delete", entityType: "user", entityId: u.id });
    saveDb();
    res.json({ ok: true, customer: publicUser(u) });
  });

  function hashDisabled() {
    return "$2a$12$disableddisableddisabledduXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"; /* invalid bcrypt — login fails */
  }

  /* ---------- staff CRUD (owner only) ---------- */
  app.get("/api/admin/staff", guard("staff"), (req, res) => {
    if (!hasPerm(req.adminSession, "staff") && !req.adminSession.owner) {
      return res.status(403).json({ error: "forbidden" });
    }
    res.json({ staff: (ctx.db.staff || []).map(publicStaff), permissions: ALL_PERMS });
  });

  app.post("/api/admin/staff", guard("staff"), (req, res) => {
    if (!req.adminSession.owner && req.adminSession.role !== "owner") {
      return res.status(403).json({ error: "owner_only" });
    }
    const out = createStaff(ctx.db, req.body || {}, "owner");
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    pushAudit(ctx.db, { actor: "owner", action: "staff_create", entityType: "staff", entityId: out.staff.id });
    saveDb();
    res.json(out);
  });

  app.put("/api/admin/staff/:id", guard("staff"), (req, res) => {
    if (!req.adminSession.owner && req.adminSession.role !== "owner") {
      return res.status(403).json({ error: "owner_only" });
    }
    const out = updateStaff(ctx.db, req.params.id, req.body || {}, { allowPerms: true });
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    pushAudit(ctx.db, { actor: "owner", action: "staff_update", entityType: "staff", entityId: req.params.id });
    saveDb();
    res.json(out);
  });

  app.post("/api/admin/staff-login", (req, res) => {
    const b = req.body || {};
    const password = String(b.password || "");
    const login = String(b.id || b.email || "").trim();
    /* Prefer env owner password first */
    if (password && password === ctx.ADMIN_PASSWORD) {
      const t = crypto.randomBytes(24).toString("hex");
      sessions.set(t, { type: "admin", owner: true, role: "owner", name: "Owner", permissions: ALL_PERMS.slice() });
      return res.json({ token: t, owner: true, permissions: ALL_PERMS.slice(), name: "Owner" });
    }
    const s = authenticateStaff(ctx.db, login, password);
    if (!s) return res.status(401).json({ error: "bad credentials" });
    const t = crypto.randomBytes(24).toString("hex");
    sessions.set(t, {
      type: "admin", owner: false, role: s.role || "staff",
      staffId: s.id, name: s.name, permissions: s.permissions || [],
    });
    pushAudit(ctx.db, { actor: s.id, action: "staff_login", entityType: "staff", entityId: s.id });
    saveDb();
    res.json({ token: t, owner: false, permissions: s.permissions || [], name: s.name, staffId: s.id });
  });

  app.get("/api/admin/me", requireAdmin, (req, res) => {
    let s = auth(req);
    if (s && !s.owner && s.staffId) {
      const row = (ctx.db.staff || []).find((x) => x.id === s.staffId);
      if (!row || row.active === false) {
        const t = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
        if (t) sessions.delete(t);
        return res.status(401).json({ error: "admin auth required" });
      }
      s.permissions = normalizePerms ? normalizePerms(row.permissions) : (row.permissions || []);
      s.name = row.name || s.name;
    }
    res.setHeader("Cache-Control", "no-store");
    res.json({
      owner: !!s.owner,
      role: s.role || (s.owner ? "owner" : "staff"),
      name: s.name || "admin",
      permissions: s.owner ? ALL_PERMS.slice() : (s.permissions || []),
      staffId: s.staffId || null,
    });
  });

  /* ---------- POS ---------- */
  app.get("/api/pos/products/search", guard("pos"), (req, res) => {
    const q = String(req.query.q || "").trim();
    const all = ctx.db.products || [];
    const hits = !q ? all.slice(0, 40) : all.filter((p) => {
      const hay = [p.name, p.name_en, p.code, p.barcode, p.sku].join(" ").toLowerCase();
      return hay.indexOf(q.toLowerCase()) >= 0;
    }).slice(0, 40);
    res.setHeader("Cache-Control", "no-store");
    res.json({
      products: hits.map((p) => ({
        name: p.name, name_en: p.name_en, code: p.code || p.barcode || p.sku || "",
        price: p.price, discount: p.discount || 0, stock: p.stock, cost: p.cost != null ? p.cost : null,
        image: Array.isArray(p.images) && p.images[0] ? p.images[0] : (p.image || ""),
      })),
    });
  });

  app.post("/api/pos/sale", guard("pos"), (req, res) => {
    if (rateOr429(res, rlPos(clientIp(req) + ":sale"))) return;
    const out = pos.createSale(ctx.db, req.body || {}, {
      staffId: req.adminSession.staffId,
      name: req.adminSession.name || "admin",
      owner: !!req.adminSession.owner,
    });
    if (out.error) return res.status(out.status || 400).json(out);
    pushAudit(ctx.db, { actor: req.adminSession.staffId || "admin", action: "pos_sale", entityType: "pos_sale", entityId: out.sale.id });
    saveDb();
    res.json(out);
  });

  app.post("/api/pos/return", guard("pos"), (req, res) => {
    const out = pos.createPosReturn(ctx.db, req.body || {}, {
      staffId: req.adminSession.staffId, name: req.adminSession.name || "admin",
    });
    if (out.error) return res.status(out.status || 400).json(out);
    pushAudit(ctx.db, { actor: req.adminSession.staffId || "admin", action: "pos_return", entityType: "pos_sale", entityId: out.return.id });
    saveDb();
    res.json(out);
  });

  app.get("/api/pos/sales", guard("pos"), (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    let list = (ctx.db.posSales || []).slice();
    const staffId = String(req.query.staffId || "").trim();
    const fromTs = req.query.from ? (Date.parse(req.query.from) || Number(req.query.from) || 0) : 0;
    const toTs = req.query.to ? (Date.parse(req.query.to) || Number(req.query.to) || Date.now()) : 0;
    if (staffId) list = list.filter((s) => s.staffId === staffId);
    if (fromTs) list = list.filter((s) => (s.date || 0) >= fromTs);
    if (toTs) list = list.filter((s) => (s.date || 0) <= toTs);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 200));
    res.json({ sales: list.slice(0, limit) });
  });

  app.post("/api/pos/shift/open", guard("pos"), (req, res) => {
    const out = pos.openShift(ctx.db, req.body || {}, {
      staffId: req.adminSession.staffId, name: req.adminSession.name || "admin",
    });
    if (out.error) return res.status(out.status || 400).json(out);
    saveDb();
    res.json(out);
  });

  app.post("/api/pos/shift/cash", guard("pos"), (req, res) => {
    const out = pos.cashMove(ctx.db, req.body || {}, {
      staffId: req.adminSession.staffId, name: req.adminSession.name || "admin",
    });
    if (out.error) return res.status(out.status || 400).json(out);
    saveDb();
    res.json(out);
  });

  app.post("/api/pos/shift/close", guard("pos"), (req, res) => {
    const out = pos.closeShift(ctx.db, req.body || {}, {
      staffId: req.adminSession.staffId, name: req.adminSession.name || "admin",
    });
    if (out.error) return res.status(out.status || 400).json(out);
    pushAudit(ctx.db, { actor: req.adminSession.staffId || "admin", action: "pos_shift_close", entityType: "pos_shift", entityId: out.shift.id });
    saveDb();
    res.json(out);
  });

  app.get("/api/pos/shifts", guard("pos"), (req, res) => {
    res.json({ shifts: (ctx.db.posShifts || []).slice(0, 100), moves: (ctx.db.posCashMoves || []).slice(0, 200) });
  });

  app.get("/api/pos/reports", guard("reports"), (req, res) => {
    const report = pos.buildReports(ctx.db, { from: req.query.from, to: req.query.to });
    res.setHeader("Cache-Control", "no-store");
    res.json({ report });
  });

  /* delivery distance helper for client (also enforced on order create) */
  app.post("/api/delivery/check", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const cfg = (ctx.db.config && ctx.db.config.delivery) || {};
    if (cfg.enabled === false) return res.json({ ok: false, error: "delivery_disabled" });
    const lat = parseCoord((req.body || {}).lat);
    const lng = parseCoord((req.body || {}).lng);
    if (lat == null || lng == null) return res.status(400).json({ error: "location_required" });
    const sc = storeCoords(ctx.db.stores);
    if (!sc) return res.status(400).json({ error: "store_coords_missing" });
    const km = haversineKm(sc.lat, sc.lng, lat, lng);
    const maxKm = Number(cfg.maxKm) || 0;
    const allowed = maxKm <= 0 || km <= maxKm;
    res.json({
      ok: allowed,
      km: Math.round(km * 100) / 100,
      maxKm,
      mapsUrl: mapsLink(lat, lng),
      store: { lat: sc.lat, lng: sc.lng, name: sc.store && sc.store.name },
      error: allowed ? null : "out_of_range",
    });
  });

  return { guard, hasPerm, ensureHttpsUrl };
}

module.exports = { mountV2 };
