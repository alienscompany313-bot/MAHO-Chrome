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

const {
  hashPassword, verifyPassword, needsPasswordRehash,
  hashOpaque, verifyOpaque, randomCode6, randomToken, sessionToken,
  createRateLimiter, clientIp, sanitizeText,
} = require("./lib/security");
const { buildMailer } = require("./lib/email");
const {
  normalizeOrderStatus, canTransition, appendHistory, allowedAdminActions,
  customerCanCancel, customerCanReturn, customerCancelInfo, applyApprovedCancelWindow,
} = require("./lib/orders");
const { pushAudit } = require("./lib/audit");
const { extendMigrate } = require("./lib/migrate-extra");
const { mountExtra } = require("./lib/api-extra");
const { mountV2 } = require("./lib/api-v2");
const { mountV3 } = require("./lib/api-v3");
const { mountEngagement, maybeSendFeedbackRequest } = require("./lib/api-engagement");
const { mountOpsSuite } = require("./lib/api-ops-suite");
const { mountOrderOps } = require("./lib/api-order-ops");
const { mountRetention } = require("./lib/api-retention");
const { newLineId, normalizeOrderItems, mapOrderStatusToItem } = require("./lib/order-items");
const { evaluateOrderValueDiscount } = require("./lib/order-discounts");
const { resolvePickupStore, eligiblePickupStores } = require("./lib/store-inventory");
const { assertPaymentAllowed, assertAtLeastOneEnabled, ensurePaymentMethods, normalizePaymentMethods } = require("./lib/payments");
const { haversineKm, storeCoords, mapsLink, ensureHttpsUrl } = require("./lib/geo");
const { ALL_PERMS, hasPerm: staffHasPerm, normalizePerms } = require("./lib/staff");
const {
  checkStock, applyStockDelta, colorKey,
} = require("./lib/variant-stock");
const { mountProductPage, buildSitemapXml } = require("./lib/product-page");

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
  fromEmail: process.env.MAIL_FROM_EMAIL || process.env.SMTP_FROM_EMAIL || "info@mahomarket.com",
  fromName: process.env.MAIL_FROM_NAME || process.env.SMTP_FROM_NAME || "MAHO Market",
  replyTo: process.env.SMTP_REPLY_TO || "support@mahomarket.com",
  ordersEmail: process.env.ORDERS_NOTIFY_EMAIL || "orders@mahomarket.com",
  secure: process.env.SMTP_SECURE === "true" || process.env.SMTP_SECURE === "1",
};
const SITE_URL = String(process.env.SITE_URL || process.env.PUBLIC_URL || "").replace(/\/+$/, "") || "";
const TOKEN_PEPPER = process.env.TOKEN_PEPPER || ADMIN_PASSWORD;
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

let mailTransport = null;
if (EMAIL_ENABLED) {
  mailTransport = nodemailer.createTransport({
    host: SMTP.host,
    port: SMTP.port,
    secure: SMTP.secure || SMTP.port === 465,
    auth: { user: SMTP.user, pass: SMTP.pass },
  });
}

function sendRawMail({ to, subject, html, text, from, replyTo }) {
  if (!EMAIL_ENABLED || !mailTransport) return Promise.resolve(false);
  return mailTransport.sendMail({
    from: from || (`"${SMTP.fromName}" <${SMTP.fromEmail}>`),
    to, subject, html, text,
    replyTo: replyTo || SMTP.replyTo,
  }).then(() => true).catch((e) => {
    console.error("mail error", (e && e.message) ? String(e.message).slice(0, 160) : "send_failed");
    return false;
  });
}

let mail = null;
function initMail(siteFallback) {
  mail = buildMailer({
    sendRaw: sendRawMail,
    fromName: SMTP.fromName,
    fromEmail: SMTP.fromEmail,
    replyTo: SMTP.replyTo,
    siteUrl: SITE_URL || siteFallback || "https://mahomarket.com",
    logoUrl: "",
    ordersNotifyEmail: SMTP.ordersEmail,
    getStorePhone: () => {
      const s = (db.stores && db.stores[0]) || {};
      return s.phone || (db.config && db.config.footerPhone) || (db.config && db.config.content && db.config.content.footerPhone) || "";
    },
    getOfficialWhatsApp: () => {
      const cfg = db.config || {};
      const c = cfg.content || {};
      return String(cfg.officialWhatsAppNumber || cfg.whatsapp || c.officialWhatsAppNumber || c.footerPhone || "").trim();
    },
  });
}

/* legacy plain helper kept for any leftover callers */
function sendMail(to, subject, text) {
  return sendRawMail({ to, subject, text, html: `<pre style="font-family:Tahoma">${String(text || "").replace(/</g, "&lt;")}</pre>` });
}

/* -------------------- CORS -------------------- */
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
initMail(ALLOWED_ORIGINS[0] || "");

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
/* Seed from website/data.json ONLY when creating a brand-new DB file.
   Existing production db.json / DATA_DIR is never wiped or re-seeded. */
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

const DEFAULT_ICON_REGISTRY = [
  { id: "dress", type: "sprite", label: "لباس", label_en: "Dress" },
  { id: "coat", type: "sprite", label: "مانتو", label_en: "Coat" },
  { id: "shirt", type: "sprite", label: "بلوز", label_en: "Blouse" },
  { id: "scarf", type: "sprite", label: "شال", label_en: "Scarf" },
  { id: "bag", type: "sprite", label: "کیف", label_en: "Bag" },
  { id: "heel", type: "sprite", label: "کفش", label_en: "Shoes" },
  { id: "ring", type: "sprite", label: "زیور", label_en: "Jewelry" },
  { id: "watch", type: "sprite", label: "ساعت", label_en: "Watch" },
  { id: "sparkles", type: "sprite", label: "زیبایی", label_en: "Beauty" },
  { id: "perfume", type: "sprite", label: "عطر", label_en: "Perfume" },
  { id: "gift", type: "sprite", label: "هدیه", label_en: "Gift" },
];
const MAHO_MAP_URL = "https://maps.app.goo.gl/8SJq7HECgYeGkCJD9";
const MAHO_LAT = "34.51162312730907";
const MAHO_LNG = "69.12056249589499";
const LEGACY_MAHO_MAPS = [
  "https://maps.app.goo.gl/U6miPMFLBSY6woFo6",
];

function parseLatLngFromText(url) {
  const s = String(url || "");
  const m = s.match(/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/)
    || s.match(/!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/)
    || s.match(/[?&](?:q|ll|sll|center|destination|daddr)=(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/)
    || s.match(/(-?\d{1,3}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})/);
  if (!m) return null;
  const la = parseFloat(m[1]), lo = parseFloat(m[2]);
  if (!isFinite(la) || !isFinite(lo) || la < -90 || la > 90 || lo < -180 || lo > 180) return null;
  return [la, lo];
}

function isMahoStore(s) {
  const n = String((s && s.name) || "") + " " + String((s && s.name_en) || "");
  return /MAHO/i.test(n);
}

/** Additive, non-destructive migration. Never clears products/orders/users/uploads. */
function migrateDb(data) {
  if (!data || typeof data !== "object") return false;
  let changed = false;
  data.config = data.config || {};

  /* --- icon registry --- */
  if (!Array.isArray(data.config.icons) || !data.config.icons.length) {
    data.config.icons = DEFAULT_ICON_REGISTRY.map((x) => Object.assign({}, x));
    changed = true;
  } else {
    const have = new Set(data.config.icons.map((x) => x && x.id).filter(Boolean));
    DEFAULT_ICON_REGISTRY.forEach((def) => {
      if (!have.has(def.id)) {
        data.config.icons.push(Object.assign({}, def));
        changed = true;
      }
    });
  }

  /* --- categories: stable key, order, enabled --- */
  if (Array.isArray(data.config.categories)) {
    data.config.categories.forEach((c, i) => {
      if (!c || typeof c !== "object") return;
      if (c.order == null || c.order === "") { c.order = i; changed = true; }
      if (c.enabled == null) { c.enabled = true; changed = true; }
      if (!c.key) {
        c.key = "cat_" + i + "_" + Date.now().toString(36);
        changed = true;
      }
    });
  }

  /* --- stores: separate map URL from lat/lng --- */
  if (Array.isArray(data.stores)) {
    data.stores.forEach((s) => {
      if (!s || typeof s !== "object") return;
      if (s.mapUrl && !s.map) { s.map = s.mapUrl; changed = true; }
      const hasLat = s.lat != null && s.lat !== "" && isFinite(parseFloat(s.lat));
      const hasLng = s.lng != null && s.lng !== "" && isFinite(parseFloat(s.lng));
      if (!hasLat || !hasLng) {
        const extracted = parseLatLngFromText(s.map || s.mapUrl || "");
        if (extracted) {
          if (!hasLat) { s.lat = String(extracted[0]); changed = true; }
          if (!hasLng) { s.lng = String(extracted[1]); changed = true; }
        }
      }
      if (isMahoStore(s)) {
        const mapStr = String(s.map || "");
        if (!mapStr || LEGACY_MAHO_MAPS.indexOf(mapStr) !== -1) {
          s.map = MAHO_MAP_URL;
          changed = true;
        }
        if (s.lat == null || s.lat === "" || !isFinite(parseFloat(s.lat))) {
          s.lat = MAHO_LAT; changed = true;
        }
        if (s.lng == null || s.lng === "" || !isFinite(parseFloat(s.lng))) {
          s.lng = MAHO_LNG; changed = true;
        }
      }
    });
  }
  if (extendMigrate(data)) changed = true;
  return changed;
}

let db;
function loadDb() {
  const existed = fs.existsSync(DB_FILE);
  try { db = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch (_) {
    /* Only seed when there is no usable DB file yet */
    db = defaultDb();
    migrateDb(db);
    saveDb();
    return;
  }
  db.products = db.products || []; db.stores = db.stores || []; db.config = db.config || {};
  db.users = db.users || []; db.orders = db.orders || [];
  db.seqCustomer = db.seqCustomer || 0; db.seqOrder = db.seqOrder || 0;
  db.auditLog = db.auditLog || [];
  db.passwordResets = db.passwordResets || [];
  db.pendingSignups = db.pendingSignups || [];
  db.idempotencyKeys = db.idempotencyKeys || {};
  if (migrateDb(db)) saveDb();
  if (!existed) { /* unreachable after catch, kept for clarity */ }
}
function saveDb() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

/* -------------------- helpers -------------------- */
function hashPw(pw) { return hashPassword(pw); }
function verifyPw(pw, stored) { return verifyPassword(pw, stored); }
function genCode() { return randomCode6(); }
function token() { return sessionToken(); }
function nextCustomerNo() { db.seqCustomer += 1; return "MO" + String(db.seqCustomer).padStart(6, "0"); }
function nextOrderNo() { db.seqOrder += 1; return "MAHO-" + String(100000 + db.seqOrder); }
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || ""));
function publicUser(u) {
  return u ? {
    id: u.id, name: u.name, phone: u.phone, email: u.email,
    address: u.address, addr: u.addr || {}, customerNo: u.customerNo, payments: u.payments || [],
    status: u.status || (u.verified ? "active" : "pending"), verified: !!u.verified,
    marketingConsent: u.marketingConsent === true,
    blocked: u.blocked === true,
    blockedAt: u.blockedAt || null,
    blockReason: u.blockReason || "",
  } : null;
}
function publicConfig(c) {
  const out = Object.assign({}, c || {});
  return out;
}

function normalizeStatus(s) { return normalizeOrderStatus(s); }
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
function scrubIconEntry(ic) {
  if (!ic || typeof ic !== "object") return null;
  const id = String(ic.id || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  if (!id) return null;
  const type = String(ic.type || "sprite");
  const label = String(ic.label || "").slice(0, 80);
  const label_en = String(ic.label_en || "").slice(0, 80);
  if (type === "emoji") {
    const emoji = String(ic.emoji || "").replace(/[<>&"'`\\/]/g, "").slice(0, 8);
    if (!emoji) return null;
    return { id: id, type: "emoji", emoji: emoji, label: label, label_en: label_en };
  }
  if (type === "image") {
    const url = isAllowedImageUrl(ic.url) ? ic.url : "";
    if (!url || /\.svg(\?|$)/i.test(url)) return null; /* no raw SVG uploads as icons */
    return { id: id, type: "image", url: url, label: label, label_en: label_en };
  }
  /* sprite — id must match built-in symbol names only (alphanumeric) */
  return { id: id, type: "sprite", label: label, label_en: label_en };
}

function scrubImageFields(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(scrubImageFields);
  const out = {};
  Object.keys(obj).forEach((k) => {
    const v = obj[k];
    if ((k === "image" || k === "logo" || k === "heroImage" || k === "url") && typeof v === "string") {
      out[k] = isAllowedImageUrl(v) ? v : "";
    } else if (k === "images" && Array.isArray(v)) {
      out[k] = v.filter(isAllowedImageUrl);
    } else if (k === "icons" && Array.isArray(v)) {
      out[k] = v.map(scrubIconEntry).filter(Boolean);
    } else if (v && typeof v === "object") {
      out[k] = scrubImageFields(v);
    } else {
      out[k] = v;
    }
  });
  return out;
}

function clampStoreCoords(stores) {
  if (!Array.isArray(stores)) return stores;
  return stores.map((s) => {
    if (!s || typeof s !== "object") return s;
    const out = Object.assign({}, s);
    if (out.mapUrl && !out.map) out.map = out.mapUrl;
    if (out.lat != null && out.lat !== "") {
      const la = parseFloat(out.lat);
      if (!isFinite(la) || la < -90 || la > 90) delete out.lat;
      else out.lat = String(la);
    }
    if (out.lng != null && out.lng !== "") {
      const lo = parseFloat(out.lng);
      if (!isFinite(lo) || lo < -180 || lo > 180) delete out.lng;
      else out.lng = String(lo);
    }
    return out;
  });
}

const sessions = new Map();
function auth(req) {
  const t = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  return t ? sessions.get(t) : null;
}
/** Refresh staff permissions from DB so owner changes apply without manual cache clear. */
function syncAdminSession(s) {
  if (!s || s.type !== "admin") return s;
  if (s.owner || s.role === "owner") {
    s.permissions = ALL_PERMS.slice();
    return s;
  }
  if (!s.staffId) return s;
  const row = (db.staff || []).find((x) => x.id === s.staffId);
  if (!row || row.active === false) return null;
  s.permissions = normalizePerms(row.permissions);
  s.name = row.name || s.name;
  s.role = row.role || "staff";
  return s;
}
function requireAdmin(req, res, next) {
  let s = auth(req);
  if (!s || s.type !== "admin") return res.status(401).json({ error: "admin auth required" });
  s = syncAdminSession(s);
  if (!s) {
    const t = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    if (t) sessions.delete(t);
    return res.status(401).json({ error: "admin auth required" });
  }
  req.adminSession = s;
  next();
}
function requireAdminPerm(perm) {
  return (req, res, next) => {
    requireAdmin(req, res, () => {
      if (!staffHasPerm(req.adminSession, perm)) {
        return res.status(403).json({ error: "forbidden", need: perm });
      }
      next();
    });
  };
}
function requireAdminAnyPerm(perms) {
  const list = Array.isArray(perms) ? perms : [perms];
  return (req, res, next) => {
    requireAdmin(req, res, () => {
      if (list.some((p) => staffHasPerm(req.adminSession, p))) return next();
      return res.status(403).json({ error: "forbidden", need: list[0] });
    });
  };
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
  limits: { fileSize: 5 * 1024 * 1024, files: 8 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME[file.mimetype]) return cb(new Error("only jpeg/png/webp/gif allowed"));
    cb(null, true);
  },
});

function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45) return "image/webp";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  return null;
}

/* -------------------- app -------------------- */
const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(self)");
  next();
});
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
/* refresh mail logo from config if present */
if (mail && db.config && db.config.logo && String(db.config.logo).startsWith("/uploads/")) {
  initMail(ALLOWED_ORIGINS[0] || "");
  mail = buildMailer({
    sendRaw: sendRawMail,
    fromName: SMTP.fromName,
    fromEmail: SMTP.fromEmail,
    replyTo: SMTP.replyTo,
    siteUrl: SITE_URL || ALLOWED_ORIGINS[0] || "https://mahomarket.com",
    logoUrl: (SITE_URL || "") + db.config.logo,
    ordersNotifyEmail: SMTP.ordersEmail,
  });
}

app.get("/api/health", (req, res) => res.json({
  ok: true,
  env: NODE_ENV,
  email: EMAIL_ENABLED,
  devCodes: ALLOW_DEV_CODES,
  products: db.products.length,
  orders: db.orders.length,
  customers: db.users.length,
}));

app.get("/api/catalog", (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.json({ products: db.products, stores: db.stores, config: publicConfig(db.config) });
});

/* -------------------- SEO: robots + sitemap (public) -------------------- */
const PUBLIC_SITE = SITE_URL || "https://mahomarket.com";
app.get("/robots.txt", (req, res) => {
  res.type("text/plain");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.send(
    "User-agent: *\n" +
    "Allow: /\n" +
    "Disallow: /admin.html\n" +
    "Disallow: /pos.html\n" +
    "Disallow: /driver.html\n" +
    "Disallow: /delivery.html\n" +
    "Disallow: /api/\n" +
    "Disallow: /uploads/proofs/\n" +
    "\nSitemap: " + PUBLIC_SITE + "/sitemap.xml\n"
  );
});
app.get("/sitemap.xml", (req, res) => {
  res.type("application/xml");
  res.setHeader("Cache-Control", "public, max-age=300");
  /* Homepage + active products from live db.products (no hard-coded SKUs). */
  res.send(buildSitemapXml(db.products, PUBLIC_SITE));
});

/* Prefer apex host when request Host is www. (proxy / direct). Safe no-op for localhost. */
app.use((req, res, next) => {
  const host = String(req.headers.host || "").toLowerCase();
  if (host === "www.mahomarket.com") {
    return res.redirect(301, "https://mahomarket.com" + req.originalUrl);
  }
  next();
});

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
  sessions.set(t, { type: "admin", owner: true, role: "owner", name: "Owner", permissions: ALL_PERMS.slice() });
  res.json({ token: t, owner: true, permissions: ALL_PERMS.slice(), name: "Owner" });
});

app.get("/api/admin/state", requireAdmin, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const s = req.adminSession || {};
  const canSettings = !!(s.owner || staffHasPerm(s, "settings"));
  let config = db.config || {};
  if (!canSettings) {
    /* Staff without settings must not receive secrets / payment credentials */
    const raw = config;
    config = {
      categories: raw.categories,
      showcase: raw.showcase,
      icons: raw.icons,
      content: raw.content,
      sectionCats: raw.sectionCats,
      heroSlides: raw.heroSlides,
      heroSliderIntervalSec: raw.heroSliderIntervalSec,
      heroImage: raw.heroImage,
      logo: raw.logo,
      orderApproval: raw.orderApproval,
      delivery: raw.delivery ? {
        enabled: raw.delivery.enabled,
        perKm: raw.delivery.perKm,
        freeKm: raw.delivery.freeKm,
        urgentFee: raw.delivery.urgentFee,
        minOrder: raw.delivery.minOrder,
        maxKm: raw.delivery.maxKm,
        outOfRangePolicy: raw.delivery.outOfRangePolicy,
        proofPhotoRequired: raw.delivery.proofPhotoRequired,
        gpsRequired: raw.delivery.gpsRequired,
        timeslots: raw.delivery.timeslots,
      } : undefined,
      paymentMethods: raw.paymentMethods,
      hesab: raw.hesab ? { enabled: raw.hesab.enabled, showOnSite: raw.hesab.showOnSite } : undefined,
      hesabBanner: raw.hesabBanner ? {
        enabled: raw.hesabBanner.enabled,
        text: raw.hesabBanner.text,
        text_en: raw.hesabBanner.text_en,
        placement: raw.hesabBanner.placement,
        order: raw.hesabBanner.order,
      } : undefined,
    };
  }
  res.json({ products: db.products, stores: db.stores, config: config });
});

app.put("/api/admin/catalog", requireAdminAnyPerm(["products", "settings"]), (req, res) => {
  const b = scrubImageFields(req.body || {});
  if (Array.isArray(b.products)) db.products = b.products;
  if (Array.isArray(b.stores)) db.stores = clampStoreCoords(b.stores);
  if (b.config && typeof b.config === "object") {
    if (b.config.paymentMethods) {
      const next = normalizePaymentMethods({ paymentMethods: b.config.paymentMethods, hesab: b.config.hesab || db.config.hesab });
      if (!assertAtLeastOneEnabled(next)) {
        return res.status(400).json({ error: "at_least_one_payment_required" });
      }
      b.config.paymentMethods = next;
      if (b.config.hesab) b.config.hesab.enabled = !!next.hesab.enabled;
    }
    if (b.config.hesabBanner && b.config.hesabBanner.link) {
      const { ensureHttpsUrl: httpsU } = require("./lib/geo");
      b.config.hesabBanner.link = httpsU(b.config.hesabBanner.link);
    }
    /* Sanitize editable site content — plain text only (XSS-safe) */
    if (b.config.content && typeof b.config.content === "object") {
      const { sanitizeText: st } = require("./lib/security");
      const clean = {};
      Object.keys(b.config.content).forEach((k) => {
        const v = b.config.content[k];
        if (typeof v === "string") clean[k] = st(v, 2000);
        else if (Array.isArray(v)) {
          clean[k] = v.map((row) => {
            if (!row || typeof row !== "object") return row;
            const out = {};
            Object.keys(row).forEach((rk) => {
              out[rk] = typeof row[rk] === "string" ? st(row[rk], 500) : row[rk];
            });
            return out;
          });
        } else clean[k] = v;
      });
      b.config.content = clean;
      const prev = JSON.stringify((db.config && db.config.content) || {});
      const next = JSON.stringify(clean);
      if (prev !== next) {
        const { pushAudit } = require("./lib/audit");
        pushAudit(db, {
          actor: (req.adminSession && (req.adminSession.name || req.adminSession.staffId)) || "admin",
          action: "site_content_updated",
          entityType: "config",
          entityId: "content",
          meta: { keys: Object.keys(clean) },
        });
      }
    }
    if (b.config.officialWhatsAppNumber != null) {
      b.config.officialWhatsAppNumber = sanitizeText(String(b.config.officialWhatsAppNumber), 40);
    }
    db.config = Object.assign({}, db.config, b.config);
  }
  migrateDb(db);
  ensurePaymentMethods(db.config);
  saveDb();
  res.json({ ok: true, products: db.products.length });
});

app.post("/api/admin/upload", requireAdminAnyPerm(["products", "settings"]), (req, res) => {
  upload.array("files", 8)(req, res, (err) => {
    if (err) {
      const msg = err.message || "upload failed";
      const status = /file too large|File too large/i.test(msg) ? 413 : 400;
      return res.status(status).json({ error: msg });
    }
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: "no files" });
    const urls = [];
    for (const f of files) {
      try {
        const buf = fs.readFileSync(f.path);
        const sniffed = sniffImage(buf);
        if (!sniffed || !ALLOWED_MIME[sniffed]) {
          try { fs.unlinkSync(f.path); } catch (_) {}
          return res.status(400).json({ error: "invalid_image_signature" });
        }
        /* rewrite extension if needed */
        const wantExt = ALLOWED_MIME[sniffed];
        if (!f.filename.endsWith(wantExt)) {
          const neu = f.filename.replace(/\.[^.]+$/, "") + wantExt;
          const neuPath = path.join(UPLOAD_DIR, neu);
          fs.renameSync(f.path, neuPath);
          urls.push("/uploads/" + neu);
        } else {
          urls.push("/uploads/" + f.filename);
        }
      } catch (e) {
        try { fs.unlinkSync(f.path); } catch (_) {}
        return res.status(400).json({ error: "upload_validation_failed" });
      }
    }
    pushAudit(db, { actor: "admin", action: "upload", entityType: "file", entityId: urls[0] || "" });
    saveDb();
    res.json({ urls: urls, url: urls[0] });
  });
});

app.get("/api/admin/orders", requireAdminPerm("orders"), (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const { filterOrdersForAdmin, getRetentionConfig } = require("./lib/retention");
  const showArchived = String(req.query.archived || "") === "1" || String(req.query.showArchived || "") === "1";
  const list = filterOrdersForAdmin(db.orders || [], getRetentionConfig(db), showArchived);
  res.json({ orders: list, showArchived });
});
app.get("/api/admin/customers", requireAdminPerm("customers"), (req, res) =>
  res.json({ customers: db.users.map(publicUser) })
);
app.post("/api/admin/orders/:id/status", requireAdminPerm("orders"), (req, res) => {
  const o = db.orders.find((x) => x.id === req.params.id);
  if (!o) return res.status(404).json({ error: "not found" });
  const prev = normalizeStatus(o.status);
  const next = normalizeStatus((req.body || {}).status);
  const force = !!(req.body || {}).force;
  const check = canTransition(prev, next, { force, actor: "admin" });
  if (!check.ok) return res.status(400).json({ error: check.error || "invalid_transition" });
  if (check.noop) return res.json({ order: o, actions: allowedAdminActions(o.status) });
  if (prev !== "cancelled" && next === "cancelled") decStock(o.items, 1);
  o.status = next;
  if (next === "confirmed" && prev !== "confirmed") {
    applyApprovedCancelWindow(o);
  }
  try {
    const oi = require("./lib/order-items");
    oi.normalizeOrderItems(o);
    (o.items || []).forEach((it) => {
      if (!it || !it.lineId) return;
      if (next === "cancelled" && it.itemStatus !== "cancelled" && it.itemStatus !== "rejected") {
        oi.setItemStatus(o, it.lineId, "cancelled", { by: "admin", note: "order_status" });
      } else if (next === "confirmed" && it.itemStatus === "pending") {
        oi.setItemStatus(o, it.lineId, "approved", { by: "admin", note: "order_confirm" });
      } else if (next === "dispatched" && (it.itemStatus === "approved" || it.itemStatus === "pending")) {
        oi.setItemStatus(o, it.lineId, "shipped", { by: "admin", note: "order_dispatch" });
      } else if (next === "delivered" && (it.itemStatus === "shipped" || it.itemStatus === "approved")) {
        oi.setItemStatus(o, it.lineId, "delivered", { by: "admin", note: "order_deliver" });
      }
    });
    /* Keep explicit order status from admin action (aggregate may differ for mixed) */
    o.status = next;
  } catch (_) {}
  appendHistory(o, {
    status: next,
    paymentStatus: o.paymentStatus || null,
    by: "admin",
    note: sanitizeText((req.body || {}).note, 500),
  });
  if (o.deliveryQr && (next === "cancelled" || next === "delivered")) {
    o.deliveryQr.revoked = true;
  }
  pushAudit(db, { actor: "admin", action: "order_status", entityType: "order", entityId: o.id, meta: { from: prev, to: next } });
  const isPickup = o.delivery && (o.delivery.method === "pickup" || o.delivery.method === "store_pickup");
  if (next === "delivered") {
    try {
      const { applyDeliveryReturnPolicy, fulfillmentType } = require("./lib/returns-ops");
      applyDeliveryReturnPolicy(db, o);
      o.fulfillmentType = fulfillmentType(o);
    } catch (_) {}
  }
  saveDb();
  if (o.customer && o.customer.email && emailOk(o.customer.email) && mail) {
    if (isPickup && next === "dispatched" && typeof mail.pickupReady === "function") {
      const store = o.pickupStore || resolvePickupStore(db, o.delivery && o.delivery.storeId) || (db.stores && db.stores[0]) || {};
      mail.pickupReady(o.customer.email, o, store, o.lang || "fa").catch(() => {});
    } else if (isPickup && next === "delivered" && typeof mail.pickupCompleted === "function") {
      mail.pickupCompleted(o.customer.email, o, o.lang || "fa").catch(() => {});
    } else if (!(isPickup && (next === "dispatched" || next === "delivered"))) {
      mail.orderStatus(o.customer.email, o, sanitizeText((req.body || {}).note, 500)).catch(() => {});
    } else if (isPickup && next !== "dispatched" && next !== "delivered") {
      mail.orderStatus(o.customer.email, o, sanitizeText((req.body || {}).note, 500)).catch(() => {});
    }
  }
  if (next === "delivered") {
    maybeSendFeedbackRequest({
      db, saveDb, TOKEN_PEPPER,
      SITE_URL: SITE_URL || ALLOWED_ORIGINS[0] || "https://mahomarket.com",
      mail,
    }, o);
  }
  res.json({ order: o, actions: allowedAdminActions(o.status, o) });
});

/* -------------------- auth -------------------- */
const rlRegister = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 12 });
const rlVerify = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 30 });
const rlLogin = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 40 });
const rlOrderHit = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 25 });

app.post("/api/auth/register", (req, res) => {
  const ip = clientIp(req);
  const hit = rlRegister(ip + ":reg");
  if (!hit.ok) {
    res.setHeader("Retry-After", String(Math.ceil((hit.retryAfterMs || 60000) / 1000)));
    return res.status(429).json({ error: "rate_limited" });
  }
  const b = req.body || {};
  const name = sanitizeText(b.name, 80), phone = sanitizeText(b.phone, 40);
  const email = String(b.email || "").trim().toLowerCase(), address = sanitizeText(b.address, 300);
  const password = String(b.password || "");
  const addr = b.addr && typeof b.addr === "object" ? b.addr : {};
  if (!name || !phone || !email || !password) return res.status(400).json({ error: "missing fields" });
  if (password.length < 8) return res.status(400).json({ error: "weak_password" });
  if (!emailOk(email)) return res.status(400).json({ error: "bad email" });
  if (db.users.some((u) => (u.email || "").toLowerCase() === email && u.verified !== false && u.status !== "pending")) {
    return res.status(409).json({ error: "email exists" });
  }
  if (!EMAIL_ENABLED && !ALLOW_DEV_CODES) {
    return res.status(503).json({ error: "email not configured" });
  }
  const code = genCode();
  db.pendingSignups = (db.pendingSignups || []).filter((p) => p.email !== email);
  db.pendingSignups.push({
    email, name, phone, address, addr,
    passHash: hashPw(password),
    codeHash: hashOpaque(code, TOKEN_PEPPER),
    exp: Date.now() + 10 * 60 * 1000,
    attempts: 0,
    lastSent: Date.now(),
    ip,
    marketingConsent: b.marketingConsent === true,
  });
  /* also keep memory map for backward compat during roll-out — no plaintext password */
  pendingReg.set(email, { exp: Date.now() + 10 * 60 * 1000 });
  saveDb();
  if (mail) mail.verificationCode(email, code, name).catch(() => {});
  else sendMail(email, "MAHO Market — کود تأیید", "کود تأیید: " + code);
  const out = { pending: true, status: "pending" };
  if (ALLOW_DEV_CODES) out.devCode = code;
  res.json(out);
});

app.post("/api/auth/verify", (req, res) => {
  const ip = clientIp(req);
  const hit = rlVerify(ip + ":verify");
  if (!hit.ok) return res.status(429).json({ error: "rate_limited" });
  const b = req.body || {};
  const email = String(b.email || "").trim().toLowerCase();
  const code = String(b.code || "").trim();
  const pending = (db.pendingSignups || []).find((p) => p.email === email);
  if (!pending || pending.exp < Date.now()) return res.status(400).json({ error: "no pending or expired" });
  pending.attempts = (pending.attempts || 0) + 1;
  if (pending.attempts > 5) {
    saveDb();
    return res.status(429).json({ error: "too_many_attempts" });
  }
  if (!verifyOpaque(code, pending.codeHash, TOKEN_PEPPER)) {
    saveDb();
    return res.status(400).json({ error: "bad code" });
  }
  db.pendingSignups = db.pendingSignups.filter((p) => p.email !== email);
  pendingReg.delete(email);
  /* replace unverified duplicate if any */
  db.users = db.users.filter((u) => (u.email || "").toLowerCase() !== email || u.verified);
  const user = {
    id: crypto.randomUUID(), name: pending.name, phone: pending.phone, email: pending.email,
    address: pending.address, addr: pending.addr || {}, pass: pending.passHash, verified: true,
    status: "active",
    marketingConsent: pending.marketingConsent === true,
    customerNo: nextCustomerNo(), payments: [], createdAt: Date.now(),
  };
  db.users.push(user); saveDb();
  const t = token(); sessions.set(t, { type: "user", userId: user.id });
  if (mail) mail.welcome(user.email, { name: user.name, email: user.email }).catch(() => {});
  res.json({
    token: t, user: publicUser(user),
    welcomeUrl: "/welcome.html?name=" + encodeURIComponent(user.name || "") + "&email=" + encodeURIComponent(user.email || ""),
  });
});

app.post("/api/auth/login", (req, res) => {
  const ip = clientIp(req);
  const hit = rlLogin(ip + ":login");
  if (!hit.ok) return res.status(429).json({ error: "rate_limited" });
  const b = req.body || {};
  const id = String(b.id || b.email || b.phone || "").trim().toLowerCase();
  const password = String(b.password || "");
  const u = db.users.find((x) =>
    [x.email, x.phone, x.id].some((v) => v && String(v).toLowerCase() === id)
  );
  if (!u || !verifyPw(password, u.pass)) return res.status(401).json({ error: "bad credentials" });
  if (u.deletedAt || u.status === "deleted") return res.status(403).json({ error: "account_deleted" });
  if (u.verified === false || u.status === "pending") {
    return res.status(403).json({ error: "unverified", message: "حساب هنوز تأیید نشده است." });
  }
  if (needsPasswordRehash(u.pass)) {
    u.pass = hashPw(password);
    saveDb();
  }
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
function findProduct(name, code) {
  if (code) {
    const byCode = db.products.find((p) => p && (p.code === code || p.barcode === code || p.sku === code));
    if (byCode) return byCode;
  }
  return db.products.find((p) => p && p.name === name);
}
function decStock(items, sign) {
  (items || []).forEach((it) => {
    const p = findProduct(it.name, it.code);
    if (!p) return;
    applyStockDelta(p, it.qty || 1, sign, it.color, it.size);
  });
}
app.post("/api/orders", (req, res) => {
  const ip = clientIp(req);
  const hit = rlOrderHit(ip);
  if (!hit.ok) {
    res.setHeader("Retry-After", String(Math.ceil((hit.retryAfterMs || 60000) / 1000)));
    return res.status(429).json({ error: "rate_limited" });
  }
  const b = req.body || {};
  const idem = String(b.idempotencyKey || req.headers["idempotency-key"] || "").trim();
  if (idem && db.idempotencyKeys && db.idempotencyKeys[idem]) {
    const prevId = db.idempotencyKeys[idem];
    const prev = db.orders.find((x) => x.id === prevId);
    if (prev) return res.json({ order: prev, idempotent: true });
  }
  const rawItems = Array.isArray(b.items) ? b.items : [];
  if (!rawItems.length) return res.status(400).json({ error: "empty order" });
  const customer = b.customer || {};
  const sAuth = auth(req);
  if (!(sAuth && sAuth.type === "user")) {
    return res.status(401).json({ error: "login_required", message: "برای ثبت سفارش ابتدا وارد حساب تأییدشده شوید." });
  }
  const userRow = db.users.find((u) => u.id === sAuth.userId);
  if (!userRow || userRow.deletedAt || userRow.status === "deleted") {
    return res.status(403).json({ error: "account_deleted" });
  }
  if (userRow.verified === false || userRow.status === "pending") {
    return res.status(403).json({ error: "unverified" });
  }
  if (userRow.blocked === true) {
    return res.status(403).json({
      error: "account_blocked",
      message: "حساب شما مسدود است و امکان ثبت سفارش جدید ندارید.",
      blockReason: userRow.blockReason || "",
    });
  }
  if (!customer.name || !customer.phone || !customer.address) {
    return res.status(400).json({ error: "missing customer" });
  }
  if (customer.email && !emailOk(customer.email)) {
    return res.status(400).json({ error: "bad email" });
  }

  /* Server-side price & stock validation (atomic-ish via single-threaded event loop + immediate save) */
  const items = [];
  for (const it of rawItems) {
    const p = findProduct(it.name, it.code) || (it.code && db.products.find((x) => x.code === it.code));
    if (!p) return res.status(400).json({ error: "unknown_item", item: it.name });
    const qty = Math.max(1, parseInt(it.qty, 10) || 1);
    const size = sanitizeText(it.size, 40);
    const color = sanitizeText(it.color, 40);
    const chk = checkStock(p, qty, color, size);
    if (!chk.ok) {
      return res.status(409).json({
        error: "insufficient stock",
        item: p.name,
        stock: chk.stock,
        size: size || undefined,
        color: colorKey(color) || undefined,
      });
    }
    const disc = Math.min(95, Math.max(0, parseFloat(p.discount) || 0));
    const unit = disc > 0 ? Math.round((p.price || 0) * (1 - disc / 100)) : (p.price || 0);
    const imgs = Array.isArray(p.images) && p.images.length ? p.images : (p.image ? [p.image] : []);
    items.push({
      lineId: newLineId(),
      name: p.name, name_en: p.name_en || "", code: p.code || "",
      price: unit, listPrice: p.price || 0, discount: disc,
      qty: qty, size: size, color: color,
      image: imgs[0] || "",
      itemStatus: "pending",
      refundedAmount: 0,
      stockRestored: false,
    });
  }

  const itemsTotal = items.reduce((s, it) => s + (it.price || 0) * (it.qty || 1), 0);
  const s = sAuth;
  const payment = sanitizeText(b.payment || "whatsapp", 40) || "whatsapp";
  const payCheck = assertPaymentAllowed(db.config, payment);
  if (!payCheck.ok) {
    return res.status(400).json({ error: payCheck.error || "payment_disabled", payment: payCheck.payment || payment });
  }
  const hesabCfg = (db.config && db.config.hesab) || {};
  if (payment === "hesab" && hesabCfg.link) {
    hesabCfg.link = ensureHttpsUrl(hesabCfg.link);
  }
  const needsPay = (payment === "bank" || payment === "card" || payment === "hesab");
  const autoApprove = ((db.config && db.config.orderApproval) || "manual") === "auto";
  const delCfg = (db.config && db.config.delivery) || {};
  const wantsDeliver = b.delivery && (b.delivery.method === "deliver" || b.delivery.method === "delivery");
  if (wantsDeliver && delCfg.enabled === false) {
    return res.status(400).json({ error: "delivery_disabled" });
  }
  if (wantsDeliver) {
    const phoneOk = sanitizeText(customer.phone || userRow.phone, 40);
    const addrOk = sanitizeText(customer.address || userRow.address, 400);
    if (!phoneOk || !addrOk) {
      return res.status(400).json({ error: "address_phone_required", message: "برای دلیوری آدرس و شماره تماس لازم است." });
    }
  }

  let customerLocation = null;
  if (b.customerLocation && b.customerLocation.lat != null && b.customerLocation.lng != null) {
    const la = parseFloat(b.customerLocation.lat), lo = parseFloat(b.customerLocation.lng);
    if (isFinite(la) && isFinite(lo) && la >= -90 && la <= 90 && lo >= -180 && lo <= 180) {
      customerLocation = {
        lat: la, lng: lo,
        accuracy: b.customerLocation.accuracy != null ? Number(b.customerLocation.accuracy) : null,
        at: Date.now(),
        mapsUrl: mapsLink(la, lo),
      };
    }
  }

  let deliveryFee = 0;
  let deliveryKm = null;
  let deliveryWarning = null;
  if (wantsDeliver) {
    const sc = storeCoords(db.stores);
    if (customerLocation && sc) {
      deliveryKm = haversineKm(sc.lat, sc.lng, customerLocation.lat, customerLocation.lng);
      const maxKm = Number(delCfg.maxKm) || 0;
      if (maxKm > 0 && deliveryKm > maxKm) {
        const policy = String(delCfg.outOfRangePolicy || "warn");
        if (policy === "block") {
          return res.status(400).json({
            error: "out_of_delivery_range",
            km: Math.round(deliveryKm * 100) / 100,
            maxKm,
            message: "آدرس شما خارج از محدوده دلیوری است.",
          });
        }
        deliveryWarning = {
          error: "out_of_delivery_range_warn",
          km: Math.round(deliveryKm * 100) / 100,
          maxKm,
          message: "موقعیت شما خارج از محدوده دلیوری است؛ سفارش با آدرس نوشتاری ثبت می‌شود.",
        };
      }
      const expected = (deliveryKm <= (delCfg.freeKm || 0)) ? 0 : Math.round(deliveryKm) * (delCfg.perKm || 0);
      const urgent = (b.delivery.time === "urgent" || b.delivery.urgent) ? (delCfg.urgentFee || 0) : 0;
      deliveryFee = expected + urgent;
    } else if (b.delivery && b.delivery.fee != null) {
      /* GPS optional — allow written-address delivery without coords */
      deliveryFee = Math.max(0, Number(b.delivery.fee) || 0);
    }
    if (delCfg.minOrder && itemsTotal < Number(delCfg.minOrder)) {
      return res.status(400).json({ error: "min_order", minOrder: delCfg.minOrder });
    }
  }

  if (b.delivery) {
    b.delivery.km = deliveryKm != null ? Math.round(deliveryKm * 100) / 100 : b.delivery.km;
    b.delivery.fee = deliveryFee;
  }

  const wantsPickup = b.delivery && (b.delivery.method === "pickup" || b.delivery.method === "store_pickup");
  let pickupStore = null;
  if (wantsPickup) {
    const storeId = (b.delivery && (b.delivery.storeId || b.pickupStoreId)) || b.pickupStoreId;
    if (storeId) {
      pickupStore = resolvePickupStore(db, storeId);
    }
    if (!pickupStore) {
      const eligible = eligiblePickupStores(db, items, customerLocation && customerLocation.lat, customerLocation && customerLocation.lng);
      if (!eligible.length) {
        return res.status(400).json({ error: "no_pickup_store", message: "فروشگاه واجد شرایط برای تحویل حضوری یافت نشد." });
      }
      pickupStore = resolvePickupStore(db, eligible[0].id) || eligible[0];
    }
    if (b.delivery) b.delivery.storeId = pickupStore.id;
  }

  const fulfillment = wantsDeliver ? "delivery" : "pickup";
  const discEval = evaluateOrderValueDiscount(db, itemsTotal, fulfillment);
  const discountTotal = Math.max(0, Number(discEval.amount) || 0);

  const orderLang = String(b.lang || b.locale || "fa").toLowerCase().indexOf("en") === 0 ? "en" : "fa";
  const initialStatus = autoApprove && !needsPay ? "confirmed" : "new";
  const initialItemStatus = mapOrderStatusToItem(initialStatus);
  items.forEach((it) => { it.itemStatus = initialItemStatus; });
  const order = {
    id: nextOrderNo(), date: Date.now(),
    items: items,
    itemsTotal: itemsTotal, deliveryFee: deliveryFee, discountTotal: discountTotal,
    total: Math.max(0, itemsTotal - discountTotal + deliveryFee),
    discountSnapshot: discEval.snapshot || null,
    discountMessage: discEval.messageFa || "",
    delivery: b.delivery || null,
    pickupStore: pickupStore,
    customerLocation: customerLocation,
    customerNo: userRow.customerNo || "",
    customer: {
      name: sanitizeText(customer.name || userRow.name, 80),
      phone: sanitizeText(customer.phone || userRow.phone, 40),
      email: sanitizeText(customer.email || userRow.email, 120),
      address: sanitizeText(customer.address || userRow.address, 400),
      note: sanitizeText(customer.note, 500),
      customerNo: userRow.customerNo || "",
      city: sanitizeText(customer.city || (customer.addr && customer.addr.city), 80),
      addr: customer.addr && typeof customer.addr === "object" ? customer.addr : (userRow.addr || {}),
    },
    payment: payment,
    paymentStatus: needsPay ? "awaiting_payment" : null,
    status: initialStatus,
    userId: userRow.id,
    guest: false,
    lang: orderLang,
    statusHistory: [],
    hesabReceipts: [],
    shipments: [],
    deliveryNote: sanitizeText(b.deliveryNote || customer.note, 500),
  };
  if (order.status === "confirmed") applyApprovedCancelWindow(order);
  appendHistory(order, { status: order.status, paymentStatus: order.paymentStatus, by: "user", note: "ثبت سفارش" });
  normalizeOrderItems(order);

  /* decrement stock after building order (product + color + size when variants exist) */
  for (const it of items) {
    const p = findProduct(it.name, it.code);
    if (!p) continue;
    const adj = applyStockDelta(p, it.qty, -1, it.color, it.size);
    if (!adj.ok) {
      return res.status(409).json({
        error: "insufficient stock",
        item: it.name,
        stock: adj.stock,
        size: it.size || undefined,
        color: colorKey(it.color) || undefined,
      });
    }
  }

  db.orders.unshift(order);
  if (idem) {
    db.idempotencyKeys = db.idempotencyKeys || {};
    db.idempotencyKeys[idem] = order.id;
    /* prune old keys opportunistically */
    const keys = Object.keys(db.idempotencyKeys);
    if (keys.length > 500) {
      keys.slice(0, keys.length - 400).forEach((k) => { delete db.idempotencyKeys[k]; });
    }
  }
  saveDb();

  const trackUrl = (SITE_URL || "https://mahomarket.com") + "/#orders";
  if (order.customer.email && emailOk(order.customer.email) && mail) {
    mail.orderConfirmation(order.customer.email, order, trackUrl, order.lang).catch((err) => {
      pushAudit(db, { actor: "system", action: "email_failed", entityType: "order", entityId: order.id, meta: { kind: "orderConfirmation", message: String((err && err.message) || err).slice(0, 120) } });
      try { saveDb(); } catch (_) {}
    });
  }
  if (mail) {
    mail.orderAdminNotify(order).catch((err) => {
      pushAudit(db, { actor: "system", action: "email_failed", entityType: "order", entityId: order.id, meta: { kind: "orderAdminNotify", message: String((err && err.message) || err).slice(0, 120) } });
      try { saveDb(); } catch (_) {}
    });
  }

  res.json({ order: order, warning: deliveryWarning || undefined });
});
app.get("/api/orders", requireUser, (req, res) => {
  const {
    normalizeOrderItems,
    customerItemStatusLabel,
    customerOrderAggregateLabel,
    itemStatusTimestamp,
    publicItem,
  } = require("./lib/order-items");
  const { filterOrdersForCustomer, getRetentionConfig } = require("./lib/retention");
  const mine = filterOrdersForCustomer(
    (db.orders || []).filter((o) => o && o.userId === req.user.id),
    getRetentionConfig(db)
  );
  const list = mine.map((o) => {
    normalizeOrderItems(o);
    const aggregateLabel = customerOrderAggregateLabel(o);
    const items = (o.items || []).map((it) => {
      const pub = publicItem(it) || it;
      const label = customerItemStatusLabel(o, it);
      const ts = itemStatusTimestamp(it, o);
      return Object.assign({}, pub, {
        statusLabelFa: label,
        statusAt: ts,
      });
    });
    return Object.assign({}, o, {
      items,
      statusLabelFa: aggregateLabel,
      aggregateFlags: o.aggregateFlags || {},
      archived: !!o.archived,
    });
  });
  res.json({ orders: list });
});
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
  const s = auth(req);
  const actor = s && s.type === "admin" ? "admin" : "customer";
  const check = canTransition(o.status, "cancelled", { actor });
  if (!check.ok) return res.status(400).json({ error: check.error || "cannot_cancel" });
  if (check.noop) return res.json({ order: o });
  if (actor === "customer") {
    const info = customerCancelInfo(o);
    if (!info.ok) {
      return res.status(400).json({
        error: info.error || "cannot_cancel",
        cancelDeadline: info.cancelDeadline || null,
        remainingMs: info.remainingMs != null ? info.remainingMs : 0,
      });
    }
  }
  o.status = "cancelled";
  decStock(o.items, 1);
  appendHistory(o, { status: "cancelled", by: actor });
  if (o.deliveryQr) o.deliveryQr.revoked = true;
  saveDb();
  if (o.customer && o.customer.email && emailOk(o.customer.email) && mail) {
    mail.orderStatus(o.customer.email, o, "").catch(() => {});
  }
  res.json({ order: o });
});
app.post("/api/orders/:id/return", (req, res) => {
  /* Legacy endpoint — redirect semantics to delivered-only return request */
  const o = findOrderForReq(req);
  if (!o) return res.status(404).json({ error: "not found" });
  if (!customerCanReturn(o.status)) return res.status(400).json({ error: "return_only_after_delivered" });
  return res.status(400).json({ error: "use_return_request", message: "از /api/orders/:id/return-request با method استفاده کنید." });
});

/* -------------------- static website -------------------- */
mountExtra(app, {
  get db() { return db; },
  saveDb, auth, requireAdmin, requireAdminPerm, requireAdminAnyPerm, staffHasPerm,
  requireUser, publicUser, emailOk,
  get mail() { return mail; },
  TOKEN_PEPPER, SITE_URL: SITE_URL || ALLOWED_ORIGINS[0] || "https://mahomarket.com",
  UPLOAD_DIR, ALLOW_DEV_CODES, sessions, findProduct, scrubImageFields, isAllowedImageUrl, isDataUrl,
});
mountV2(app, {
  get db() { return db; },
  saveDb, auth, requireAdmin, requireAdminPerm, requireAdminAnyPerm, staffHasPerm,
  requireUser, publicUser, emailOk,
  get mail() { return mail; },
  sessions, findProduct, isAllowedImageUrl,
  ADMIN_PASSWORD,
});
mountV3(app, {
  get db() { return db; },
  saveDb, auth, requireAdmin, requireAdminPerm, requireAdminAnyPerm, staffHasPerm,
  requireUser, publicUser, emailOk,
  get mail() { return mail; },
  sessions, UPLOAD_DIR, ADMIN_PASSWORD,
  TOKEN_PEPPER, SITE_URL: SITE_URL || ALLOWED_ORIGINS[0] || "https://mahomarket.com",
  maybeSendFeedbackRequest,
});
mountEngagement(app, {
  get db() { return db; },
  saveDb, requireAdmin, requireAdminPerm, requireAdminAnyPerm, staffHasPerm,
  get mail() { return mail; },
  TOKEN_PEPPER, SITE_URL: SITE_URL || ALLOWED_ORIGINS[0] || "https://mahomarket.com",
});
mountOpsSuite(app, {
  get db() { return db; },
  saveDb, auth, requireAdmin, requireAdminPerm, requireAdminAnyPerm, staffHasPerm,
  requireUser,
  get mail() { return mail; },
  UPLOAD_DIR,
  SITE_URL: SITE_URL || ALLOWED_ORIGINS[0] || "https://mahomarket.com",
  requireDriver: (req, res, next) => {
    const s = auth(req);
    if (!s || s.type !== "driver") return res.status(401).json({ error: "driver_auth_required" });
    req.driverSession = s;
    next();
  },
});
mountOrderOps(app, {
  get db() { return db; },
  saveDb, auth, requireAdmin, requireUser, publicUser,
  sessions, findProduct,
  get mail() { return mail; },
});
mountRetention(app, {
  get db() { return db; },
  saveDb, auth, requireAdmin, requireAdminPerm, requireAdminAnyPerm, staffHasPerm,
  DATA_DIR,
});

/* Product SEO pages — SSR from live db.products (code/SKU). No catalog hardcoding. */
mountProductPage(app, {
  getDb: () => db,
  siteUrl: PUBLIC_SITE,
});

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
