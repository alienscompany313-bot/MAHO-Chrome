"use strict";
/**
 * Additional MAHO API routes mounted onto the existing Express app.
 * Keeps index.js smaller while adding auth/reset, stock, QR, HesabPay, etc.
 */
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const QRCode = require("qrcode");
const {
  hashPassword, verifyPassword, needsPasswordRehash,
  hashOpaque, verifyOpaque, randomCode6, randomToken, sessionToken,
  createRateLimiter, clientIp, sanitizeText,
} = require("./security");
const { normalizeOrderStatus, canTransition, appendHistory, allowedAdminActions } = require("./orders");
const { pushAudit } = require("./audit");

function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45) return "image/webp";
  return null;
}

function mountExtra(app, ctx) {
  const {
    saveDb, auth, requireAdmin, requireUser, publicUser, emailOk,
    TOKEN_PEPPER, SITE_URL, UPLOAD_DIR, ALLOW_DEV_CODES, sessions,
    findProduct, scrubImageFields, isAllowedImageUrl, isDataUrl,
  } = ctx;
  const mail = () => ctx.mail;

  const rlAuth = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 30 });
  const rlCode = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 10 });
  const rlReset = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 8 });
  const rlOrder = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 20 });
  const rlReceipt = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 12 });

  const RECEIPT_MIME = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
  const receiptUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
      filename: (_req, file, cb) => {
        const ext = RECEIPT_MIME[file.mimetype] || ".bin";
        cb(null, "rcpt_" + crypto.randomBytes(14).toString("hex") + ext);
      },
    }),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (!RECEIPT_MIME[file.mimetype]) return cb(new Error("only jpeg/png/webp allowed"));
      cb(null, true);
    },
  });

  function rateOr429(res, check) {
    if (check.ok) return false;
    res.setHeader("Retry-After", String(Math.ceil((check.retryAfterMs || 60000) / 1000)));
    res.status(429).json({ error: "rate_limited" });
    return true;
  }

  function publicCustomer(u) {
    if (!u) return null;
    const orders = (ctx.db.orders || []).filter((o) => o.userId === u.id || (o.customer && o.customer.email && u.email && o.customer.email.toLowerCase() === u.email.toLowerCase()));
    const spent = orders.reduce((s, o) => s + (Number(o.total) || 0), 0);
    return {
      id: u.id,
      name: u.name,
      phone: u.phone,
      email: u.email,
      address: u.address,
      customerNo: u.customerNo,
      status: u.status || (u.verified ? "active" : "pending"),
      verified: !!u.verified,
      guest: false,
      createdAt: u.createdAt || null,
      orderCount: orders.length,
      totalSpent: spent,
    };
  }

  /* ---------- stock snapshot (no-cache) ---------- */
  app.get("/api/stock", (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    const items = (ctx.db.products || []).map((p) => ({
      code: p.code || "",
      name: p.name,
      stock: p.stock == null || p.stock === "" ? null : Number(p.stock),
      price: p.price,
      discount: p.discount || 0,
    }));
    res.json({ at: Date.now(), products: items });
  });

  /* ---------- password reset ---------- */
  app.post("/api/auth/forgot-password", (req, res) => {
    const ip = clientIp(req);
    if (rateOr429(res, rlReset(ip + ":forgot"))) return;
    const email = String((req.body || {}).email || "").trim().toLowerCase();
    /* Always same response — do not reveal whether email exists */
    const okMsg = { ok: true, message: "اگر حسابی با این ایمیل وجود داشته باشد، لینک بازیابی فرستاده می‌شود." };
    if (!emailOk(email)) return res.json(okMsg);
    const u = ctx.db.users.find((x) => (x.email || "").toLowerCase() === email);
    if (!u) return res.json(okMsg);
    const raw = randomToken(32);
    const tokenHash = hashOpaque(raw, TOKEN_PEPPER);
    ctx.db.passwordResets = (ctx.db.passwordResets || []).filter((r) => r.email !== email);
    ctx.db.passwordResets.push({
      email, tokenHash, exp: Date.now() + 30 * 60 * 1000, used: false, createdAt: Date.now(),
    });
    saveDb();
    const resetUrl = (SITE_URL || "https://mahomarket.com") + "/welcome.html?reset=1&token=" + encodeURIComponent(raw) + "&email=" + encodeURIComponent(email);
    if (mail()) {
      mail().passwordReset(email, { resetUrl, name: u.name }).catch(() => {});
    }
    pushAudit(ctx.db, { actor: "system", action: "password_reset_requested", entityType: "user", entityId: u.id });
    saveDb();
    res.json(okMsg);
  });

  app.post("/api/auth/reset-password", (req, res) => {
    const ip = clientIp(req);
    if (rateOr429(res, rlReset(ip + ":reset"))) return;
    const b = req.body || {};
    const email = String(b.email || "").trim().toLowerCase();
    const token = String(b.token || "").trim();
    const password = String(b.password || "");
    if (!emailOk(email) || !token || password.length < 8) {
      return res.status(400).json({ error: "invalid_request" });
    }
    const row = (ctx.db.passwordResets || []).find((r) => r.email === email && !r.used && r.exp > Date.now());
    if (!row || !verifyOpaque(token, row.tokenHash, TOKEN_PEPPER)) {
      return res.status(400).json({ error: "invalid_or_expired" });
    }
    const u = ctx.db.users.find((x) => (x.email || "").toLowerCase() === email);
    if (!u) return res.status(400).json({ error: "invalid_or_expired" });
    u.pass = hashPassword(password);
    row.used = true;
    /* revoke user sessions */
    sessions.forEach((val, key) => {
      if (val && val.type === "user" && val.userId === u.id) sessions.delete(key);
    });
    pushAudit(ctx.db, { actor: u.id, action: "password_reset_completed", entityType: "user", entityId: u.id });
    saveDb();
    res.json({ ok: true });
  });

  /* ---------- resend verification ---------- */
  app.post("/api/auth/resend-code", (req, res) => {
    const ip = clientIp(req);
    if (rateOr429(res, rlCode(ip + ":resend"))) return;
    const email = String((req.body || {}).email || "").trim().toLowerCase();
    if (!emailOk(email)) return res.status(400).json({ error: "bad_email" });
    const pending = (ctx.db.pendingSignups || []).find((p) => p.email === email);
    if (!pending) return res.status(400).json({ error: "no_pending" });
    if (pending.lastSent && Date.now() - pending.lastSent < 60000) {
      return res.status(429).json({ error: "wait_resend", retryAfterMs: 60000 - (Date.now() - pending.lastSent) });
    }
    const code = randomCode6();
    pending.codeHash = hashOpaque(code, TOKEN_PEPPER);
    pending.exp = Date.now() + 10 * 60 * 1000;
    pending.attempts = 0;
    pending.lastSent = Date.now();
    saveDb();
    if (mail()) mail().verificationCode(email, code, pending.name).catch(() => {});
    const out = { ok: true };
    if (ALLOW_DEV_CODES) out.devCode = code;
    res.json(out);
  });

  /* ---------- admin customers enriched + export-safe ---------- */
  app.get("/api/admin/customers/table", requireAdmin, (req, res) => {
    const members = (ctx.db.users || []).map(publicCustomer);
    /* guest orders as pseudo-rows */
    const guestMap = new Map();
    (ctx.db.orders || []).filter((o) => o.guest || !o.userId).forEach((o) => {
      const c = o.customer || {};
      const key = (c.email || c.phone || o.id || "").toLowerCase();
      if (!key) return;
      if (!guestMap.has(key)) {
        guestMap.set(key, {
          id: "guest:" + key,
          name: c.name || "مهمان",
          phone: c.phone || "",
          email: c.email || "",
          customerNo: o.customerNo || "",
          status: "guest",
          verified: false,
          guest: true,
          createdAt: o.date || null,
          orderCount: 0,
          totalSpent: 0,
        });
      }
      const g = guestMap.get(key);
      g.orderCount += 1;
      g.totalSpent += Number(o.total) || 0;
    });
    res.setHeader("Cache-Control", "no-store");
    res.json({ customers: members.concat([...guestMap.values()]) });
  });

  app.get("/api/admin/audit", requireAdmin, (req, res) => {
    res.json({ auditLog: (ctx.db.auditLog || []).slice(0, 200) });
  });

  /* ---------- order detail + actions for admin ---------- */
  app.get("/api/admin/orders/:id", requireAdmin, (req, res) => {
    const o = ctx.db.orders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: "not_found" });
    res.json({
      order: o,
      actions: allowedAdminActions(o.status),
      mapsUrl: o.customerLocation && o.customerLocation.lat != null
        ? `https://www.google.com/maps?q=${encodeURIComponent(o.customerLocation.lat + "," + o.customerLocation.lng)}`
        : null,
    });
  });

  app.post("/api/admin/orders/:id/note", requireAdmin, (req, res) => {
    const o = ctx.db.orders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: "not_found" });
    o.adminNote = sanitizeText((req.body || {}).note, 1000);
    pushAudit(ctx.db, { actor: "admin", action: "order_note", entityType: "order", entityId: o.id });
    saveDb();
    res.json({ order: o });
  });

  /* ---------- delivery QR ---------- */
  function issueDeliveryToken(order) {
    const raw = randomToken(24);
    order.deliveryQr = {
      tokenHash: hashOpaque(raw, TOKEN_PEPPER),
      createdAt: Date.now(),
      revoked: false,
      exp: null,
    };
    return raw;
  }

  app.post("/api/admin/orders/:id/delivery-qr", requireAdmin, async (req, res) => {
    const o = ctx.db.orders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: "not_found" });
    const st = normalizeOrderStatus(o.status);
    if (st === "cancelled") return res.status(400).json({ error: "cancelled" });
    const raw = issueDeliveryToken(o);
    pushAudit(ctx.db, { actor: "admin", action: "delivery_qr_issue", entityType: "order", entityId: o.id });
    saveDb();
    const pageUrl = (SITE_URL || "") + "/delivery.html?o=" + encodeURIComponent(o.id) + "&t=" + encodeURIComponent(raw);
    let dataUrl = "";
    try { dataUrl = await QRCode.toDataURL(pageUrl, { margin: 1, width: 280 }); } catch (_) {}
    res.json({ url: pageUrl, qrDataUrl: dataUrl, orderId: o.id });
  });

  app.post("/api/admin/orders/:id/delivery-qr/revoke", requireAdmin, (req, res) => {
    const o = ctx.db.orders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: "not_found" });
    if (o.deliveryQr) o.deliveryQr.revoked = true;
    pushAudit(ctx.db, { actor: "admin", action: "delivery_qr_revoke", entityType: "order", entityId: o.id });
    saveDb();
    res.json({ ok: true });
  });

  app.get("/api/delivery/:orderId", (req, res) => {
    const o = ctx.db.orders.find((x) => x.id === req.params.orderId);
    const token = String(req.query.t || "");
    if (!o || !o.deliveryQr || o.deliveryQr.revoked) return res.status(404).json({ error: "not_found" });
    const st = normalizeOrderStatus(o.status);
    if (st === "cancelled" || st === "delivered") {
      /* limited view still ok if token valid, but mark inactive */
    }
    if (!verifyOpaque(token, o.deliveryQr.tokenHash, TOKEN_PEPPER)) {
      return res.status(403).json({ error: "forbidden" });
    }
    const c = o.customer || {};
    const mapsUrl = o.customerLocation && o.customerLocation.lat != null
      ? `https://www.google.com/maps?q=${encodeURIComponent(o.customerLocation.lat + "," + o.customerLocation.lng)}`
      : null;
    res.setHeader("Cache-Control", "no-store");
    res.json({
      id: o.id,
      status: o.status,
      payment: o.payment,
      paymentStatus: o.paymentStatus || null,
      total: o.total,
      collectAmount: o.paymentStatus === "payment_confirmed" ? 0 : o.total,
      customer: { name: c.name, phone: c.phone, address: c.address },
      items: (o.items || []).map((it) => ({ name: it.name, qty: it.qty, size: it.size, color: it.color })),
      deliveryNote: o.deliveryNote || o.adminNote || "",
      mapsUrl,
      inactive: st === "cancelled" || st === "delivered" || !!o.deliveryQr.revoked,
    });
  });

  /* ---------- guest order track ---------- */
  app.post("/api/orders/track", (req, res) => {
    const b = req.body || {};
    const id = String(b.orderId || b.id || "").trim();
    const email = String(b.email || "").trim().toLowerCase();
    const o = ctx.db.orders.find((x) => x.id === id);
    if (!o || !email || !(o.customer && (o.customer.email || "").toLowerCase() === email)) {
      return res.status(404).json({ error: "not_found" });
    }
    res.json({
      order: {
        id: o.id, date: o.date, status: o.status, paymentStatus: o.paymentStatus,
        total: o.total, items: o.items, payment: o.payment, guest: !!o.guest,
      },
    });
  });

  function canSubmitHesabReceipt(req, o, email) {
    const s = auth(req);
    return (s && s.type === "admin")
      || (s && s.type === "user" && o.userId === s.userId)
      || (email && o.customer && (o.customer.email || "").toLowerCase() === email);
  }

  /* ---------- HesabPay receipt ---------- */
  app.post("/api/orders/:id/hesab-receipt", (req, res) => {
    if (rateOr429(res, rlReceipt(clientIp(req) + ":rcpt"))) return;
    const o = ctx.db.orders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: "not_found" });
    const b = req.body || {};
    const email = String(b.email || (o.customer && o.customer.email) || "").toLowerCase();
    if (!canSubmitHesabReceipt(req, o, email)) return res.status(403).json({ error: "forbidden" });
    if (o.payment !== "hesab") return res.status(400).json({ error: "not_hesab" });
    const receiptUrl = isAllowedImageUrl(b.receiptUrl) ? b.receiptUrl : "";
    if (!receiptUrl && !b.txnId) return res.status(400).json({ error: "receipt_required" });
    o.hesabReceipt = {
      url: receiptUrl,
      txnId: sanitizeText(b.txnId, 80),
      amount: Number(b.amount) || o.total,
      note: sanitizeText(b.note, 500),
      submittedAt: Date.now(),
    };
    o.paymentStatus = "receipt_submitted";
    appendHistory(o, { status: o.status, paymentStatus: o.paymentStatus, by: "customer", note: "رسید حساب‌پی" });
    saveDb();
    if (mail() && o.customer && o.customer.email) {
      mail().orderStatus(o.customer.email, o, "رسید پرداخت شما دریافت شد و در حال بررسی است.").catch(() => {});
    }
    res.json({ order: o });
  });

  app.post("/api/orders/:id/hesab-receipt-upload", (req, res) => {
    if (rateOr429(res, rlReceipt(clientIp(req) + ":rcptup"))) return;
    receiptUpload.single("file")(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message || "upload_failed" });
      const o = ctx.db.orders.find((x) => x.id === req.params.id);
      if (!o) return res.status(404).json({ error: "not_found" });
      const email = String((req.body && req.body.email) || (o.customer && o.customer.email) || "").toLowerCase();
      if (!canSubmitHesabReceipt(req, o, email)) return res.status(403).json({ error: "forbidden" });
      if (o.payment !== "hesab") return res.status(400).json({ error: "not_hesab" });
      if (!req.file) return res.status(400).json({ error: "file_required" });
      try {
        const buf = fs.readFileSync(req.file.path);
        const sniffed = sniffImage(buf);
        if (!sniffed || !RECEIPT_MIME[sniffed]) {
          try { fs.unlinkSync(req.file.path); } catch (_) {}
          return res.status(400).json({ error: "invalid_image" });
        }
      } catch (_) {
        return res.status(400).json({ error: "read_failed" });
      }
      const receiptUrl = "/uploads/" + path.basename(req.file.filename);
      o.hesabReceipt = {
        url: receiptUrl,
        txnId: sanitizeText((req.body && req.body.txnId) || "", 80),
        amount: Number((req.body && req.body.amount)) || o.total,
        note: sanitizeText((req.body && req.body.note) || "", 500),
        submittedAt: Date.now(),
      };
      o.paymentStatus = "receipt_submitted";
      appendHistory(o, { status: o.status, paymentStatus: o.paymentStatus, by: "customer", note: "آپلود رسید حساب‌پی" });
      saveDb();
      if (mail() && o.customer && o.customer.email) {
        mail().orderStatus(o.customer.email, o, "رسید پرداخت شما دریافت شد و در حال بررسی است.").catch(() => {});
      }
      res.json({ order: o, url: receiptUrl });
    });
  });

  app.post("/api/admin/orders/:id/payment-status", requireAdmin, (req, res) => {
    const o = ctx.db.orders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: "not_found" });
    const next = String((req.body || {}).paymentStatus || "");
    const allowed = ["awaiting_payment", "receipt_submitted", "under_review", "payment_confirmed", "payment_rejected"];
    if (allowed.indexOf(next) < 0) return res.status(400).json({ error: "bad_status" });
    o.paymentStatus = next;
    appendHistory(o, {
      status: o.status, paymentStatus: next, by: "admin",
      note: sanitizeText((req.body || {}).note, 500),
    });
    pushAudit(ctx.db, { actor: "admin", action: "payment_status", entityType: "order", entityId: o.id, meta: { paymentStatus: next } });
    saveDb();
    if (mail && o.customer && o.customer.email) {
      mail().orderStatus(o.customer.email, o, sanitizeText((req.body || {}).note, 500)).catch(() => {});
    }
    res.json({ order: o });
  });

  /* ---------- link guest order to new account ---------- */
  app.post("/api/orders/:id/claim", requireUser, (req, res) => {
    const o = ctx.db.orders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: "not_found" });
    const u = ctx.requireUserUser ? null : null;
    const user = ctx.db.users.find((x) => x.id === auth(req).userId);
    if (!user) return res.status(401).json({ error: "login_required" });
    const email = (user.email || "").toLowerCase();
    if (!o.guest && o.userId && o.userId !== user.id) return res.status(403).json({ error: "forbidden" });
    if (o.customer && o.customer.email && o.customer.email.toLowerCase() !== email) {
      return res.status(403).json({ error: "email_mismatch" });
    }
    o.userId = user.id;
    o.guest = false;
    o.customerNo = user.customerNo || o.customerNo;
    saveDb();
    res.json({ order: o });
  });

  /* ---------- secure headers helper already applied in index ---------- */
  return { publicCustomer, issueDeliveryToken, rlAuth, rlCode, rlOrder, rateOr429 };
}

module.exports = { mountExtra };
