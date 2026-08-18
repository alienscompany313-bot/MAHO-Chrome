"use strict";
/**
 * Phase-3 API: POS login, product catalog, drivers, payment methods, hero slides helpers.
 */
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { sanitizeText, createRateLimiter, clientIp } = require("./security");
const { pushAudit } = require("./audit");
const { ALL_PERMS, hasPerm, authenticateStaff, normalizePerms } = require("./staff");
const pos = require("./pos");
const {
  publicDriver, createDriver, updateDriver, authenticateDriver,
  assignDriver, driverFacingOrder, applyDriverStatus, ensureDrivers,
} = require("./driver");
const {
  normalizePaymentMethods, assertAtLeastOneEnabled, METHOD_KEYS,
} = require("./payments");
const { ensureHttpsUrl } = require("./geo");
const { normalizeOrderStatus } = require("./orders");

function mountV3(app, ctx) {
  const {
    saveDb, auth, requireAdmin, requireAdminPerm, requireAdminAnyPerm, sessions, UPLOAD_DIR, ADMIN_PASSWORD,
  } = ctx;
  const mail = () => ctx.mail;
  const rlPos = createRateLimiter({ windowMs: 5 * 60 * 1000, max: 40 });
  const rlDriver = createRateLimiter({ windowMs: 5 * 60 * 1000, max: 80 });
  const guardProof = typeof requireAdminAnyPerm === "function"
    ? requireAdminAnyPerm(["orders", "delivery"])
    : requireAdmin;
  const guardHttps = typeof requireAdminAnyPerm === "function"
    ? requireAdminAnyPerm(["settings", "products"])
    : requireAdmin;

  const ALLOWED_MIME = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
  };
  const proofUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => {
        const dir = path.join(UPLOAD_DIR, "proofs");
        try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
        cb(null, dir);
      },
      filename: (_req, file, cb) => {
        const ext = ALLOWED_MIME[file.mimetype] || ".jpg";
        cb(null, "proof-" + crypto.randomBytes(16).toString("hex") + ext);
      },
    }),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (!ALLOWED_MIME[file.mimetype]) return cb(new Error("only jpeg/png/webp"));
      cb(null, true);
    },
  });

  function posSession(req) {
    return auth(req);
  }

  function requirePosSession(req, res, next) {
    const s = posSession(req);
    if (!s) return res.status(401).json({ error: "pos_auth_required" });
    if (s.type === "admin" && hasPerm(s, "pos")) {
      req.posSession = s;
      return next();
    }
    if (s.type === "pos" && hasPerm(s, "pos")) {
      req.posSession = s;
      return next();
    }
    return res.status(403).json({ error: "forbidden", need: "pos" });
  }

  function requireOwner(req, res, next) {
    const s = auth(req);
    if (!s || s.type !== "admin" || !(s.owner || s.role === "owner")) {
      return res.status(403).json({ error: "owner_only" });
    }
    req.adminSession = s;
    next();
  }

  function requireDriver(req, res, next) {
    const s = auth(req);
    if (!s || s.type !== "driver" || !s.driverId) {
      return res.status(401).json({ error: "driver_auth_required" });
    }
    req.driverSession = s;
    next();
  }

  /* ---------- Independent POS login (no admin portal required) ---------- */
  app.post("/api/pos/login", (req, res) => {
    const hit = rlPos(clientIp(req) + ":login");
    if (!hit.ok) {
      res.setHeader("Retry-After", String(Math.ceil((hit.retryAfterMs || 60000) / 1000)));
      return res.status(429).json({ error: "rate_limited" });
    }
    const b = req.body || {};
    const password = String(b.password || "");
    const login = String(b.id || b.email || b.username || "").trim();
    if (!login || !password) return res.status(400).json({ error: "missing_fields" });

    /* Owner can enter POS with admin password + optional empty id marked as owner */
    if (password === ADMIN_PASSWORD && (!login || login.toLowerCase() === "owner" || login === ADMIN_PASSWORD)) {
      const t = crypto.randomBytes(24).toString("hex");
      sessions.set(t, {
        type: "pos", owner: true, role: "owner", name: "Owner",
        staffId: null, permissions: ["pos", "reports"],
      });
      return res.json({
        token: t, owner: true, name: "Owner", permissions: ["pos", "reports"], workspace: "pos",
      });
    }

    const s = authenticateStaff(ctx.db, login, password);
    if (!s) return res.status(401).json({ error: "bad_credentials" });
    if (s.active === false) return res.status(403).json({ error: "inactive" });
    const perms = normalizePerms(s.permissions);
    if (perms.indexOf("pos") < 0) return res.status(403).json({ error: "no_pos_permission" });
    const t = crypto.randomBytes(24).toString("hex");
    sessions.set(t, {
      type: "pos", owner: false, role: s.role || "staff",
      staffId: s.id, name: s.name, permissions: ["pos"].concat(perms.indexOf("reports") >= 0 ? ["reports"] : []),
    });
    pushAudit(ctx.db, { actor: s.id, action: "pos_login", entityType: "staff", entityId: s.id });
    saveDb();
    res.json({
      token: t, owner: false, name: s.name, staffId: s.id,
      permissions: sessions.get(t).permissions, workspace: "pos",
    });
  });

  app.post("/api/pos/logout", (req, res) => {
    const t = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    if (t) sessions.delete(t);
    res.json({ ok: true });
  });

  app.get("/api/pos/me", requirePosSession, (req, res) => {
    const s = req.posSession;
    res.json({
      name: s.name || "",
      staffId: s.staffId || null,
      owner: !!s.owner,
      permissions: s.permissions || ["pos"],
      type: s.type,
    });
  });

  app.get("/api/pos/products", requirePosSession, (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const products = pos.listPosProducts(ctx.db, {
      q: req.query.q, cat: req.query.cat, stock: req.query.stock,
    });
    const cats = Array.from(new Set((ctx.db.products || []).map((p) => p.cat || p.category || "").filter(Boolean)));
    res.json({ products, categories: cats, lowStockDefault: 3 });
  });

  /* ---------- Payment methods admin ---------- */
  app.put("/api/admin/payment-methods", requireAdmin, (req, res) => {
    const s = req.adminSession || auth(req);
    if (!hasPerm(s, "settings") && !s.owner) return res.status(403).json({ error: "forbidden" });
    const body = req.body || {};
    const next = normalizePaymentMethods({ paymentMethods: body.methods || body, hesab: ctx.db.config.hesab });
    if (!assertAtLeastOneEnabled(next)) {
      return res.status(400).json({ error: "at_least_one_payment_required" });
    }
    ctx.db.config.paymentMethods = next;
    if (ctx.db.config.hesab) ctx.db.config.hesab.enabled = !!next.hesab.enabled;
    pushAudit(ctx.db, { actor: s.staffId || "admin", action: "payment_methods_update", entityType: "config", entityId: "paymentMethods" });
    saveDb();
    res.json({ paymentMethods: next });
  });

  app.get("/api/payment-methods", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ paymentMethods: normalizePaymentMethods(ctx.db.config || {}) });
  });

  /* ---------- Drivers (owner manage) ---------- */
  app.get("/api/admin/drivers", requireAdmin, (req, res) => {
    const s = auth(req);
    if (!s.owner && !hasPerm(s, "drivers") && !hasPerm(s, "delivery")) {
      return res.status(403).json({ error: "forbidden" });
    }
    ensureDrivers(ctx.db);
    res.json({ drivers: (ctx.db.drivers || []).map(publicDriver) });
  });

  app.post("/api/admin/drivers", requireOwner, (req, res) => {
    const out = createDriver(ctx.db, req.body || {}, "owner");
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    pushAudit(ctx.db, { actor: "owner", action: "driver_create", entityType: "driver", entityId: out.driver.id });
    saveDb();
    res.json(out);
  });

  app.put("/api/admin/drivers/:id", requireOwner, (req, res) => {
    const out = updateDriver(ctx.db, req.params.id, req.body || {});
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    pushAudit(ctx.db, { actor: "owner", action: "driver_update", entityType: "driver", entityId: req.params.id });
    saveDb();
    res.json(out);
  });

  app.post("/api/admin/orders/:id/assign-driver", requireAdmin, (req, res) => {
    const s = req.adminSession || auth(req);
    if (!hasPerm(s, "orders") && !hasPerm(s, "delivery") && !s.owner) {
      return res.status(403).json({ error: "forbidden" });
    }
    const o = (ctx.db.orders || []).find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: "not_found" });
    const out = assignDriver(ctx.db, o, String((req.body || {}).driverId || ""), s.staffId || "admin");
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    pushAudit(ctx.db, {
      actor: s.staffId || "admin", action: "assign_driver", entityType: "order", entityId: o.id,
      meta: { driverId: out.driver.id, driverName: out.driver.name },
    });
    saveDb();
    res.json(out);
  });

  /* ---------- Driver login + workspace ---------- */
  app.post("/api/driver/login", (req, res) => {
    const hit = rlDriver(clientIp(req) + ":login");
    if (!hit.ok) return res.status(429).json({ error: "rate_limited" });
    const b = req.body || {};
    const d = authenticateDriver(ctx.db, b.id || b.email || b.username, b.password);
    if (!d) return res.status(401).json({ error: "bad_credentials" });
    if (d.active === false) return res.status(403).json({ error: "inactive" });
    const t = crypto.randomBytes(24).toString("hex");
    sessions.set(t, { type: "driver", driverId: d.id, name: d.name });
    pushAudit(ctx.db, { actor: d.id, action: "driver_login", entityType: "driver", entityId: d.id });
    saveDb();
    res.json({ token: t, name: d.name, driverId: d.id, workspace: "driver" });
  });

  app.post("/api/driver/logout", (req, res) => {
    const t = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    if (t) sessions.delete(t);
    res.json({ ok: true });
  });

  app.get("/api/driver/me", requireDriver, (req, res) => {
    res.json({ name: req.driverSession.name, driverId: req.driverSession.driverId });
  });

  app.get("/api/driver/orders", requireDriver, (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const id = req.driverSession.driverId;
    const list = (ctx.db.orders || [])
      .filter((o) => o.driverId === id && normalizeOrderStatus(o.status) !== "cancelled")
      .map(driverFacingOrder);
    res.json({ orders: list });
  });

  app.post("/api/driver/orders/:id/status", requireDriver, (req, res) => {
    const o = (ctx.db.orders || []).find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: "not_found" });
    const driver = (ctx.db.drivers || []).find((d) => d.id === req.driverSession.driverId);
    if (!driver) return res.status(401).json({ error: "driver_auth_required" });
    const proofRequired = !!(ctx.db.config.delivery && ctx.db.config.delivery.proofPhotoRequired);
    const out = applyDriverStatus(ctx.db, o, driver, req.body || {}, { proofRequired });
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    pushAudit(ctx.db, {
      actor: driver.id, action: "driver_status", entityType: "order", entityId: o.id,
      meta: { driverStatus: o.driverStatus, note: (req.body || {}).note || "" },
    });
    saveDb();
    if (mail() && o.customer && o.customer.email && (o.driverStatus === "delivered" || o.driverStatus === "failed" || o.driverStatus === "in_transit")) {
      mail().orderStatus(o.customer.email, o, (req.body || {}).note || o.deliveryFailReason || "", o.lang || "fa").catch(() => {});
    }
    if (o.driverStatus === "delivered" && typeof ctx.maybeSendFeedbackRequest === "function") {
      ctx.maybeSendFeedbackRequest({
        db: ctx.db,
        saveDb,
        TOKEN_PEPPER: ctx.TOKEN_PEPPER,
        SITE_URL: ctx.SITE_URL,
        mail: mail(),
      }, o);
    }
    res.json({ order: driverFacingOrder(o) });
  });

  app.post("/api/driver/orders/:id/proof", requireDriver, (req, res) => {
    proofUpload.single("file")(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message || "upload_failed" });
      const o = (ctx.db.orders || []).find((x) => x.id === req.params.id);
      if (!o) return res.status(404).json({ error: "not_found" });
      if (o.driverId !== req.driverSession.driverId) return res.status(403).json({ error: "not_your_order" });
      if (!req.file) return res.status(400).json({ error: "no_file" });
      const rel = "/uploads/proofs/" + req.file.filename;
      o.deliveryProof = {
        url: rel,
        at: Date.now(),
        driverId: req.driverSession.driverId,
        driverName: req.driverSession.name,
        token: crypto.randomBytes(18).toString("hex"),
      };
      pushAudit(ctx.db, {
        actor: req.driverSession.driverId, action: "delivery_proof", entityType: "order", entityId: o.id,
      });
      saveDb();
      res.json({ ok: true, proofUrl: "/api/driver/proof/" + encodeURIComponent(o.id) });
    });
  });

  /* Auth-gated proof fetch (guessable public URL avoided) */
  app.get("/api/driver/proof/:id", (req, res) => {
    const s = auth(req);
    const o = (ctx.db.orders || []).find((x) => x.id === req.params.id);
    if (!o || !o.deliveryProof || !o.deliveryProof.url) return res.status(404).json({ error: "not_found" });
    const ok =
      (s && s.type === "admin") ||
      (s && s.type === "driver" && s.driverId === o.driverId) ||
      (s && s.type === "pos" && hasPerm(s, "pos"));
    if (!ok) return res.status(403).json({ error: "forbidden" });
    const abs = path.join(UPLOAD_DIR, "proofs", path.basename(o.deliveryProof.url));
    if (!fs.existsSync(abs)) return res.status(404).json({ error: "missing_file" });
    res.setHeader("Cache-Control", "private, no-store");
    res.sendFile(abs);
  });

  /* Admin view of proof with admin token */
  app.get("/api/admin/orders/:id/proof", guardProof, (req, res) => {
    const o = (ctx.db.orders || []).find((x) => x.id === req.params.id);
    if (!o || !o.deliveryProof) return res.status(404).json({ error: "not_found" });
    const abs = path.join(UPLOAD_DIR, "proofs", path.basename(o.deliveryProof.url));
    if (!fs.existsSync(abs)) return res.status(404).json({ error: "missing_file" });
    res.setHeader("Cache-Control", "private, no-store");
    res.sendFile(abs);
  });

  /* Hesab banner / hero slides saved via catalog; ensure HTTPS on banner link helper */
  app.post("/api/admin/normalize-https", guardHttps, (req, res) => {
    const u = ensureHttpsUrl((req.body || {}).url);
    res.json({ url: u });
  });
}

module.exports = { mountV3 };
