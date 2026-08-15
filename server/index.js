"use strict";
/* ===========================================================
   MAHO backend API — production-hardened
   Central catalog, accounts, orders, secure image uploads.
   Refuses to start with weak/missing ADMIN_PASSWORD.
   In NODE_ENV=production: SMTP required, no devCodes.
   =========================================================== */
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
let nodemailer = null;
try { nodemailer = require("nodemailer"); } catch (_) { /* optional until production check */ }

const PORT = process.env.PORT || 4000;
const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PROD = NODE_ENV === "production";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(DATA_DIR, "uploads");
const DB_FILE = path.join(DATA_DIR, "db.json");
const SEED_FILE = path.join(__dirname, "..", "website", "data.json");
const WEBSITE_DIR = path.join(__dirname, "..", "website");
const ROOT_DIR = path.join(__dirname, "..");

const WEAK_PASSWORDS = new Set([
  "maho1234", "password", "password123", "password1234", "admin", "admin123", "12345678",
  "123456789012", "qwerty123456", "changeme", "letmein", "welcome123",
  "maho", "mahoadmin", "secret", "passw0rd", "adminadmin",
]);

function isWeakPassword(pw) {
  const s = String(pw || "");
  if (s.length < 12) return "ADMIN_PASSWORD must be at least 12 characters";
  if (WEAK_PASSWORDS.has(s.toLowerCase())) return "ADMIN_PASSWORD is too common / previously used as a default";
  if (!/[A-Za-z]/.test(s) || !/[0-9]/.test(s)) return "ADMIN_PASSWORD must include letters and numbers";
  return null;
}

/* -------------------- startup security gates -------------------- */
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  console.error("FATAL: ADMIN_PASSWORD is required. Set a strong password via the environment (no default).");
  process.exit(1);
}
{
  const weak = isWeakPassword(ADMIN_PASSWORD);
  if (weak) {
    console.error("FATAL: " + weak);
    process.exit(1);
  }
}

const SMTP = {
  host: process.env.SMTP_HOST || "",
  port: parseInt(process.env.SMTP_PORT || "587", 10),
  user: process.env.SMTP_USER || "",
  pass: process.env.SMTP_PASS || "",
  from: process.env.SMTP_FROM || process.env.SMTP_USER || "MAHO <no-reply@maho.local>",
};
const EMAIL_ENABLED = !!(nodemailer && SMTP.host && SMTP.user && SMTP.pass);

/* Dev codes only when explicitly enabled AND not production. Never in production. */
const ALLOW_DEV_CODES = !IS_PROD && process.env.ALLOW_DEV_CODES === "true";

if (IS_PROD) {
  if (process.env.ALLOW_DEV_CODES === "true") {
    console.error("FATAL: ALLOW_DEV_CODES must be false (or unset) in production.");
    process.exit(1);
  }
  if (!EMAIL_ENABLED) {
    console.error("FATAL: Production requires configured SMTP (SMTP_HOST, SMTP_USER, SMTP_PASS).");
    process.exit(1);
  }
}

let mailer = null;
if (EMAIL_ENABLED) {
  mailer = nodemailer.createTransport({
    host: SMTP.host, port: SMTP.port, secure: SMTP.port === 465,
    auth: { user: SMTP.user, pass: SMTP.pass },
  });
}
function sendMail(to, subject, text) {
  if (!EMAIL_ENABLED) return Promise.resolve(false);
  return mailer.sendMail({ from: SMTP.from, to: to, subject: subject, text: text })
    .then(() => true)
    .catch((e) => { console.error("mail error", e.message); return false; });
}

/* -------------------- CORS -------------------- */
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function corsOrigin(origin, cb) {
  /* Non-browser / same-origin requests may omit Origin */
  if (!origin) return cb(null, true);
  if (ALLOWED_ORIGINS.length === 0) {
    if (IS_PROD) return cb(new Error("CORS blocked: set ALLOWED_ORIGINS in production"));
    return cb(null, true); /* permissive only in development */
  }
  if (ALLOWED_ORIGINS.indexOf(origin) !== -1) return cb(null, true);
  return cb(new Error("CORS blocked for origin " + origin));
}

/* -------------------- persistence -------------------- */
function defaultDb() {
  let seed = { products: [], stores: [], config: {} };
  try { seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf8")); } catch (_) {}
  return {
    products: seed.products || [],
    stores: seed.stores || [],
    config: seed.config || {},
    users: [],
    orders: [],
    seqCustomer: 0,
    seqOrder: 0,
  };
}
let db;
function loadDb() {
  try { db = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch (_) { db = defaultDb(); saveDb(); }
  db.products = db.products || []; db.stores = db.stores || []; db.config = db.config || {};
  db.users = db.users || []; db.orders = db.orders || [];
  db.seqCustomer = db.seqCustomer || 0; db.seqOrder = db.seqOrder || 0;
}
function saveDb() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

/* -------------------- helpers -------------------- */
function hashPw(pw, salt) {
  salt = salt || crypto.randomBytes(16).toString("hex");
  const h = crypto.scryptSync(String(pw), salt, 32).toString("hex");
  return salt + ":" + h;
}
function verifyPw(pw, stored) {
  try {
    const [salt, h] = String(stored).split(":");
    return crypto.scryptSync(String(pw), salt, 32).toString("hex") === h;
  } catch (_) { return false; }
}
function genCode() { return String(Math.floor(100000 + Math.random() * 900000)); }
function token() { return crypto.randomBytes(24).toString("hex"); }
function nextCustomerNo() { db.seqCustomer += 1; return "MO" + String(db.seqCustomer).padStart(6, "0"); }
function nextOrderNo() { db.seqOrder += 1; return "MAHO-" + String(100000 + db.seqOrder); }
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || ""));
function publicUser(u) {
  return u ? {
    id: u.id, name: u.name, phone: u.phone, email: u.email,
    address: u.address, addr: u.addr || {}, customerNo: u.customerNo, payments: u.payments || [],
  } : null;
}
function publicConfig(c) { return Object.assign({}, c || {}); }

function normalizeStatus(s) {
  const v = String(s || "");
  if (v === "confirmed" || v.indexOf("تایید شده") >= 0 || v.indexOf("تأیید شده") >= 0) return "confirmed";
  if (v === "cancelled" || v.indexOf("لغو") >= 0) return "cancelled";
  if (v === "awaiting_payment" || v.indexOf("انتظار پرداخت") >= 0) return "awaiting_payment";
  if (v === "return_requested" || v.indexOf("برگشت") >= 0) return "return_requested";
  if (v === "pending" || v.indexOf("انتظار") >= 0) return "pending";
  return v || "pending";
}
function orderEmailBody(order) {
  const lines = (order.items || []).map((it) =>
    "• " + it.name + (it.size ? " " + it.size : "") + (it.color ? " " + it.color : "") +
    " x" + it.qty + " = " + (it.price * it.qty)
  ).join("\n");
  return "سفارش شما ثبت شد.\nشماره سفارش: " + order.id + "\n\n" + lines + "\n\nمجموع: " + (order.total || 0);
}

function isDataUrl(v) { return typeof v === "string" && /^data:/i.test(v); }
function isAllowedImageUrl(v) {
  if (typeof v !== "string" || !v) return false;
  if (isDataUrl(v)) return false;
  if (v.startsWith("/uploads/")) return true;
  try {
    const u = new URL(v, "http://localhost");
    return u.protocol === "http:" || u.protocol === "https:";
  } catch (_) { return false; }
}
function scrubImageFields(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(scrubImageFields);
  const out = {};
  Object.keys(obj).forEach((k) => {
    const v = obj[k];
    if ((k === "image" || k === "logo" || k === "heroImage") && typeof v === "string") {
      out[k] = isAllowedImageUrl(v) ? v : "";
    } else if (k === "images" && Array.isArray(v)) {
      out[k] = v.filter(isAllowedImageUrl);
    } else if (v && typeof v === "object") {
      out[k] = scrubImageFields(v);
    } else {
      out[k] = v;
    }
  });
  return out;
}

const sessions = new Map();
function auth(req) {
  const t = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  return t ? sessions.get(t) : null;
}
function requireAdmin(req, res, next) {
  const s = auth(req);
  if (!s || s.type !== "admin") return res.status(401).json({ error: "admin auth required" });
  next();
}
function requireUser(req, res, next) {
  const s = auth(req);
  if (!s || s.type !== "user") return res.status(401).json({ error: "login required" });
  const u = db.users.find((x) => x.id === s.userId);
  if (!u) return res.status(401).json({ error: "user not found" });
  req.user = u;
  next();
}

const pendingReg = new Map();
const pendingEmailChange = new Map();

/* -------------------- uploads -------------------- */
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (_) {}

const ALLOWED_MIME = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = ALLOWED_MIME[file.mimetype] || path.extname(file.originalname).toLowerCase() || ".bin";
      cb(null, crypto.randomBytes(16).toString("hex") + ext);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024, files: 8 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME[file.mimetype]) return cb(new Error("only jpeg/png/webp/gif allowed"));
    cb(null, true);
  },
});

/* -------------------- app -------------------- */
const app = express();
app.use(cors({
  origin: corsOrigin,
  credentials: true,
}));
app.use((err, req, res, next) => {
  if (err && /CORS blocked/i.test(String(err.message || err))) {
    return res.status(403).json({ error: "origin not allowed" });
  }
  next(err);
});
app.use(express.json({ limit: "1mb" })); /* catalog JSON only — images go through /upload */

loadDb();

app.get("/api/health", (req, res) => res.json({
  ok: true,
  env: NODE_ENV,
  email: EMAIL_ENABLED,
  devCodes: ALLOW_DEV_CODES,
  products: db.products.length,
  orders: db.orders.length,
  customers: db.users.length,
}));

app.get("/api/catalog", (req, res) =>
  res.json({ products: db.products, stores: db.stores, config: publicConfig(db.config) })
);

/* public uploads */
app.use("/uploads", express.static(UPLOAD_DIR, {
  fallthrough: false,
  setHeaders: (res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  },
}));

/* -------------------- admin -------------------- */
app.post("/api/admin/login", (req, res) => {
  if (String((req.body || {}).password || "") !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "wrong password" });
  }
  const t = token();
  sessions.set(t, { type: "admin" });
  res.json({ token: t });
});

app.get("/api/admin/state", requireAdmin, (req, res) =>
  res.json({ products: db.products, stores: db.stores, config: db.config })
);

app.put("/api/admin/catalog", requireAdmin, (req, res) => {
  const b = scrubImageFields(req.body || {});
  if (Array.isArray(b.products)) db.products = b.products;
  if (Array.isArray(b.stores)) db.stores = b.stores;
  if (b.config && typeof b.config === "object") db.config = b.config;
  saveDb();
  res.json({ ok: true, products: db.products.length });
});

app.post("/api/admin/upload", requireAdmin, (req, res) => {
  upload.array("files", 8)(req, res, (err) => {
    if (err) {
      const msg = err.message || "upload failed";
      const status = /file too large|File too large/i.test(msg) ? 413 : 400;
      return res.status(status).json({ error: msg });
    }
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: "no files" });
    const urls = files.map((f) => "/uploads/" + f.filename);
    res.json({ urls: urls, url: urls[0] });
  });
});

app.get("/api/admin/orders", requireAdmin, (req, res) => res.json({ orders: db.orders }));
app.get("/api/admin/customers", requireAdmin, (req, res) =>
  res.json({ customers: db.users.map(publicUser) })
);
app.post("/api/admin/orders/:id/status", requireAdmin, (req, res) => {
  const o = db.orders.find((x) => x.id === req.params.id);
  if (!o) return res.status(404).json({ error: "not found" });
  const prev = normalizeStatus(o.status);
  const next = normalizeStatus((req.body || {}).status);
  if (prev !== "cancelled" && next === "cancelled") decStock(o.items, 1);
  o.status = next;
  saveDb();
  if (next === "confirmed" && o.customer && o.customer.email && emailOk(o.customer.email)) {
    sendMail(o.customer.email, "MAHO — تایید سفارش " + o.id, orderEmailBody(o));
  }
  res.json({ order: o });
});

/* -------------------- auth -------------------- */
app.post("/api/auth/register", (req, res) => {
  const b = req.body || {};
  const name = String(b.name || "").trim(), phone = String(b.phone || "").trim();
  const email = String(b.email || "").trim(), address = String(b.address || "").trim();
  const password = String(b.password || "");
  const addr = b.addr && typeof b.addr === "object" ? b.addr : {};
  if (!name || !phone || !email || !password) return res.status(400).json({ error: "missing fields" });
  if (!emailOk(email)) return res.status(400).json({ error: "bad email" });
  if (db.users.some((u) => (u.email || "").toLowerCase() === email.toLowerCase())) {
    return res.status(409).json({ error: "email exists" });
  }
  if (!EMAIL_ENABLED && !ALLOW_DEV_CODES) {
    return res.status(503).json({ error: "email not configured" });
  }
  const code = genCode();
  pendingReg.set(email.toLowerCase(), {
    code: code, exp: Date.now() + 15 * 60000,
    data: { name, phone, email, address, addr, password },
  });
  sendMail(email, "MAHO — کد تأیید / verification code",
    "کد تأیید حساب شما در MAHO: " + code + "\nMAHO verification code: " + code);
  const out = { pending: true };
  if (ALLOW_DEV_CODES) out.devCode = code;
  res.json(out);
});

app.post("/api/auth/verify", (req, res) => {
  const b = req.body || {};
  const email = String(b.email || "").trim().toLowerCase();
  const code = String(b.code || "").trim();
  const p = pendingReg.get(email);
  if (!p || p.exp < Date.now()) return res.status(400).json({ error: "no pending or expired" });
  if (p.code !== code) return res.status(400).json({ error: "bad code" });
  pendingReg.delete(email);
  const d = p.data;
  const user = {
    id: crypto.randomUUID(), name: d.name, phone: d.phone, email: d.email,
    address: d.address, addr: d.addr || {}, pass: hashPw(d.password), verified: true,
    customerNo: nextCustomerNo(), payments: [], createdAt: Date.now(),
  };
  db.users.push(user); saveDb();
  const t = token(); sessions.set(t, { type: "user", userId: user.id });
  res.json({ token: t, user: publicUser(user) });
});

app.post("/api/auth/login", (req, res) => {
  const b = req.body || {};
  const id = String(b.id || "").trim().toLowerCase();
  const password = String(b.password || "");
  const u = db.users.find((x) =>
    [x.email, x.phone, x.id].some((v) => v && String(v).toLowerCase() === id) && verifyPw(password, x.pass)
  );
  if (!u) return res.status(401).json({ error: "bad credentials" });
  const t = token(); sessions.set(t, { type: "user", userId: u.id });
  res.json({ token: t, user: publicUser(u) });
});

/* -------------------- profile -------------------- */
app.get("/api/me", requireUser, (req, res) => res.json({ user: publicUser(req.user) }));
app.put("/api/me", requireUser, (req, res) => {
  const b = req.body || {}; const u = req.user;
  if (b.name != null) u.name = String(b.name).trim();
  if (b.phone != null) u.phone = String(b.phone).trim();
  if (b.address != null) u.address = String(b.address).trim();
  if (b.addr && typeof b.addr === "object") u.addr = b.addr;
  if (b.password) u.pass = hashPw(String(b.password));
  if (Array.isArray(b.payments)) u.payments = b.payments;
  if (b.email && String(b.email).trim().toLowerCase() !== (u.email || "").toLowerCase()) {
    const email = String(b.email).trim();
    if (!emailOk(email)) return res.status(400).json({ error: "bad email" });
    if (db.users.some((x) => x.id !== u.id && (x.email || "").toLowerCase() === email.toLowerCase())) {
      return res.status(409).json({ error: "email exists" });
    }
    if (!EMAIL_ENABLED && !ALLOW_DEV_CODES) {
      return res.status(503).json({ error: "email not configured" });
    }
    const code = genCode();
    pendingEmailChange.set(u.id, { code: code, email: email, exp: Date.now() + 15 * 60000 });
    sendMail(email, "MAHO — تأیید ایمیل جدید", "کد تأیید ایمیل جدید: " + code);
    saveDb();
    const out = { user: publicUser(u), emailPending: true };
    if (ALLOW_DEV_CODES) out.devCode = code;
    return res.json(out);
  }
  saveDb();
  res.json({ user: publicUser(u) });
});
app.post("/api/me/verify-email", requireUser, (req, res) => {
  const u = req.user; const code = String((req.body || {}).code || "").trim();
  const p = pendingEmailChange.get(u.id);
  if (!p || p.exp < Date.now()) return res.status(400).json({ error: "no pending or expired" });
  if (p.code !== code) return res.status(400).json({ error: "bad code" });
  u.email = p.email; pendingEmailChange.delete(u.id); saveDb();
  res.json({ user: publicUser(u) });
});

/* -------------------- orders -------------------- */
function findProduct(name) { return db.products.find((p) => p.name === name); }
function decStock(items, sign) {
  (items || []).forEach((it) => {
    const p = findProduct(it.name);
    if (p && p.stock != null && p.stock !== "") {
      const n = parseInt(p.stock, 10);
      if (!isNaN(n)) p.stock = Math.max(0, n + sign * (it.qty || 1));
    }
  });
}
app.post("/api/orders", (req, res) => {
  const b = req.body || {};
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) return res.status(400).json({ error: "empty order" });
  const customer = b.customer || {};
  if (!customer.name || !customer.phone || !customer.address) {
    return res.status(400).json({ error: "missing customer" });
  }
  for (const it of items) {
    const p = findProduct(it.name);
    if (p && p.stock != null && p.stock !== "") {
      if (parseInt(p.stock, 10) < (it.qty || 1)) {
        return res.status(409).json({ error: "insufficient stock", item: it.name });
      }
    }
  }
  const itemsTotal = items.reduce((s, it) => s + (it.price || 0) * (it.qty || 1), 0);
  const s = auth(req);
  const needsPay = (b.payment === "bank" || b.payment === "card" || b.payment === "hesab");
  const autoApprove = ((db.config && db.config.orderApproval) || "manual") === "auto";
  const deliveryFee = (b.delivery && Number(b.delivery.fee)) || 0;
  const order = {
    id: nextOrderNo(), date: Date.now(),
    items: items.map((it) => ({
      name: it.name, name_en: it.name_en || "", code: it.code || "",
      price: it.price || 0, qty: it.qty || 1, size: it.size || "", color: it.color || "",
    })),
    itemsTotal: itemsTotal, deliveryFee: deliveryFee, total: itemsTotal + deliveryFee,
    delivery: b.delivery || null, customerNo: (customer && customer.customerNo) || "",
    customer: customer, payment: b.payment || "whatsapp",
    status: needsPay ? "awaiting_payment" : (autoApprove ? "confirmed" : "pending"),
    userId: s && s.type === "user" ? s.userId : null,
  };
  db.orders.unshift(order);
  decStock(order.items, -1);
  saveDb();
  if (customer.email && emailOk(customer.email)) {
    sendMail(customer.email, "MAHO — تأیید سفارش " + order.id, orderEmailBody(order));
  }
  res.json({ order: order });
});
app.get("/api/orders", requireUser, (req, res) =>
  res.json({ orders: db.orders.filter((o) => o.userId === req.user.id) })
);
function findOrderForReq(req) {
  const s = auth(req);
  const o = db.orders.find((x) => x.id === req.params.id);
  if (!o) return null;
  if (s && s.type === "admin") return o;
  if (s && s.type === "user" && o.userId === s.userId) return o;
  return null;
}
app.post("/api/orders/:id/cancel", (req, res) => {
  const o = findOrderForReq(req);
  if (!o) return res.status(404).json({ error: "not found" });
  if (normalizeStatus(o.status) !== "cancelled") {
    o.status = "cancelled"; decStock(o.items, 1); saveDb();
  }
  res.json({ order: o });
});
app.post("/api/orders/:id/return", (req, res) => {
  const o = findOrderForReq(req);
  if (!o) return res.status(404).json({ error: "not found" });
  o.status = "return_requested"; saveDb();
  res.json({ order: o });
});

/* -------------------- static website -------------------- */
app.use(express.static(WEBSITE_DIR, { extensions: ["html"] }));
app.use("/downloads", express.static(path.join(ROOT_DIR, "downloads")));
app.get("/icon-192.png", (req, res) => res.sendFile(path.join(ROOT_DIR, "icon-192.png")));
app.get("/icon-512.png", (req, res) => res.sendFile(path.join(ROOT_DIR, "icon-512.png")));
app.get("/", (req, res) => res.sendFile(path.join(WEBSITE_DIR, "index.html")));

app.listen(PORT, () => {
  console.log(
    "MAHO backend on :" + PORT +
    " env=" + NODE_ENV +
    " email=" + EMAIL_ENABLED +
    " devCodes=" + ALLOW_DEV_CODES +
    " uploads=" + UPLOAD_DIR +
    " cors=" + (ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS.join(",") : (IS_PROD ? "RESTRICTED" : "dev-open"))
  );
});
