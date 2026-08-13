"use strict";
/* ===========================================================
   MAHO backend API
   Central catalog, customer accounts (email-verified), orders,
   and admin management. JSON-file persistence (no native deps).
   =========================================================== */
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
let nodemailer = null;
try { nodemailer = require("nodemailer"); } catch (_) { /* email optional */ }

const PORT = process.env.PORT || 4000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "maho1234";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const SEED_FILE = path.join(__dirname, "..", "website", "data.json");

/* SMTP (optional). When not configured, verification codes are returned in the
   API response (dev mode) so the flow works without an email provider. */
const SMTP = {
  host: process.env.SMTP_HOST || "",
  port: parseInt(process.env.SMTP_PORT || "587", 10),
  user: process.env.SMTP_USER || "",
  pass: process.env.SMTP_PASS || "",
  from: process.env.SMTP_FROM || process.env.SMTP_USER || "MAHO <no-reply@maho.local>",
};
const EMAIL_ENABLED = !!(nodemailer && SMTP.host && SMTP.user && SMTP.pass);
const ALLOW_DEV_CODES = process.env.ALLOW_DEV_CODES ? process.env.ALLOW_DEV_CODES === "true" : !EMAIL_ENABLED;

let mailer = null;
if (EMAIL_ENABLED) {
  mailer = nodemailer.createTransport({ host: SMTP.host, port: SMTP.port, secure: SMTP.port === 465, auth: { user: SMTP.user, pass: SMTP.pass } });
}
function sendMail(to, subject, text) {
  if (!EMAIL_ENABLED) return Promise.resolve(false);
  return mailer.sendMail({ from: SMTP.from, to: to, subject: subject, text: text }).then(() => true).catch((e) => { console.error("mail error", e.message); return false; });
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
  // ensure arrays exist
  db.products = db.products || []; db.stores = db.stores || []; db.config = db.config || {};
  db.users = db.users || []; db.orders = db.orders || [];
  db.seqCustomer = db.seqCustomer || 0; db.seqOrder = db.seqOrder || 0;
}
let saveTimer = null;
function saveDb() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveDb, 150); }

/* -------------------- helpers -------------------- */
function hashPw(pw, salt) { salt = salt || crypto.randomBytes(16).toString("hex"); const h = crypto.scryptSync(String(pw), salt, 32).toString("hex"); return salt + ":" + h; }
function verifyPw(pw, stored) { try { const [salt, h] = String(stored).split(":"); return crypto.scryptSync(String(pw), salt, 32).toString("hex") === h; } catch (_) { return false; } }
function genCode() { return String(Math.floor(100000 + Math.random() * 900000)); }
function token() { return crypto.randomBytes(24).toString("hex"); }
function nextCustomerNo() { db.seqCustomer += 1; return "MO" + String(db.seqCustomer).padStart(6, "0"); }
function nextOrderNo() { db.seqOrder += 1; return "MAHO-" + String(100000 + db.seqOrder); }
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || ""));
function publicUser(u) { return u ? { id: u.id, name: u.name, phone: u.phone, email: u.email, address: u.address, customerNo: u.customerNo, payments: u.payments || [] } : null; }
function publicConfig(c) { c = c || {}; return { whatsapp: c.whatsapp || "", logo: c.logo || "", bank: c.bank || {}, paymentLink: c.paymentLink || "", content: c.content || {} }; }

/* sessions: token -> {type, userId} (in-memory) */
const sessions = new Map();
function auth(req) { const t = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim(); return t ? sessions.get(t) : null; }
function requireAdmin(req, res, next) { const s = auth(req); if (!s || s.type !== "admin") return res.status(401).json({ error: "admin auth required" }); next(); }
function requireUser(req, res, next) { const s = auth(req); if (!s || s.type !== "user") return res.status(401).json({ error: "login required" }); const u = db.users.find((x) => x.id === s.userId); if (!u) return res.status(401).json({ error: "user not found" }); req.user = u; next(); }

/* pending email verifications: email(lower) -> {code, data, exp} */
const pendingReg = new Map();
const pendingEmailChange = new Map(); // userId -> {code, email, exp}

/* -------------------- app -------------------- */
const app = express();
app.use(cors());
app.use(express.json({ limit: "6mb" }));

loadDb();

app.get("/api/health", (req, res) => res.json({ ok: true, email: EMAIL_ENABLED, devCodes: ALLOW_DEV_CODES, products: db.products.length, orders: db.orders.length, customers: db.users.length }));

/* public catalog */
app.get("/api/catalog", (req, res) => res.json({ products: db.products, stores: db.stores, config: publicConfig(db.config) }));

/* -------------------- admin -------------------- */
app.post("/api/admin/login", (req, res) => {
  if (String((req.body || {}).password || "") !== ADMIN_PASSWORD) return res.status(401).json({ error: "wrong password" });
  const t = token(); sessions.set(t, { type: "admin" }); res.json({ token: t });
});
app.get("/api/admin/state", requireAdmin, (req, res) => res.json({ products: db.products, stores: db.stores, config: db.config }));
app.put("/api/admin/catalog", requireAdmin, (req, res) => {
  const b = req.body || {};
  if (Array.isArray(b.products)) db.products = b.products;
  if (Array.isArray(b.stores)) db.stores = b.stores;
  if (b.config && typeof b.config === "object") db.config = b.config;
  saveDb(); res.json({ ok: true });
});
app.get("/api/admin/orders", requireAdmin, (req, res) => res.json({ orders: db.orders }));
app.get("/api/admin/customers", requireAdmin, (req, res) => res.json({ customers: db.users.map(publicUser) }));

/* -------------------- auth -------------------- */
app.post("/api/auth/register", (req, res) => {
  const b = req.body || {};
  const name = String(b.name || "").trim(), phone = String(b.phone || "").trim();
  const email = String(b.email || "").trim(), address = String(b.address || "").trim();
  const password = String(b.password || "");
  if (!name || !phone || !email || !password) return res.status(400).json({ error: "missing fields" });
  if (!emailOk(email)) return res.status(400).json({ error: "bad email" });
  if (db.users.some((u) => (u.email || "").toLowerCase() === email.toLowerCase())) return res.status(409).json({ error: "email exists" });
  const code = genCode();
  pendingReg.set(email.toLowerCase(), { code: code, exp: Date.now() + 15 * 60000, data: { name, phone, email, address, password } });
  const body = "کد تأیید حساب شما در MAHO: " + code + "\nMAHO verification code: " + code;
  sendMail(email, "MAHO — کد تأیید / verification code", body);
  const out = { pending: true };
  if (ALLOW_DEV_CODES) out.devCode = code;
  res.json(out);
});
app.post("/api/auth/verify", (req, res) => {
  const b = req.body || {}; const email = String(b.email || "").trim().toLowerCase(); const code = String(b.code || "").trim();
  const p = pendingReg.get(email);
  if (!p || p.exp < Date.now()) return res.status(400).json({ error: "no pending or expired" });
  if (p.code !== code) return res.status(400).json({ error: "bad code" });
  pendingReg.delete(email);
  const d = p.data;
  const user = { id: crypto.randomUUID(), name: d.name, phone: d.phone, email: d.email, address: d.address, pass: hashPw(d.password), verified: true, customerNo: nextCustomerNo(), payments: [], createdAt: Date.now() };
  db.users.push(user); saveDb();
  const t = token(); sessions.set(t, { type: "user", userId: user.id });
  res.json({ token: t, user: publicUser(user) });
});
app.post("/api/auth/login", (req, res) => {
  const b = req.body || {}; const id = String(b.id || "").trim().toLowerCase(); const password = String(b.password || "");
  const u = db.users.find((x) => [x.email, x.phone, x.id].some((v) => v && String(v).toLowerCase() === id) && verifyPw(password, x.pass));
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
  if (b.password) u.pass = hashPw(String(b.password));
  if (Array.isArray(b.payments)) u.payments = b.payments;
  let emailPending = false;
  if (b.email && String(b.email).trim().toLowerCase() !== (u.email || "").toLowerCase()) {
    const email = String(b.email).trim();
    if (!emailOk(email)) return res.status(400).json({ error: "bad email" });
    if (db.users.some((x) => x.id !== u.id && (x.email || "").toLowerCase() === email.toLowerCase())) return res.status(409).json({ error: "email exists" });
    const code = genCode();
    pendingEmailChange.set(u.id, { code: code, email: email, exp: Date.now() + 15 * 60000 });
    sendMail(email, "MAHO — تأیید ایمیل جدید", "کد تأیید ایمیل جدید: " + code);
    emailPending = true;
    saveDb();
    const out = { user: publicUser(u), emailPending: true };
    if (ALLOW_DEV_CODES) out.devCode = code;
    return res.json(out);
  }
  saveDb(); res.json({ user: publicUser(u) });
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
  (items || []).forEach((it) => { const p = findProduct(it.name); if (p && p.stock != null && p.stock !== "") { const n = parseInt(p.stock, 10); if (!isNaN(n)) p.stock = Math.max(0, n + sign * (it.qty || 1)); } });
}
app.post("/api/orders", (req, res) => {
  const b = req.body || {};
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) return res.status(400).json({ error: "empty order" });
  const customer = b.customer || {};
  if (!customer.name || !customer.phone || !customer.address) return res.status(400).json({ error: "missing customer" });
  // validate stock
  for (const it of items) { const p = findProduct(it.name); if (p && p.stock != null && p.stock !== "") { if (parseInt(p.stock, 10) < (it.qty || 1)) return res.status(409).json({ error: "insufficient stock", item: it.name }); } }
  const total = items.reduce((s, it) => s + (it.price || 0) * (it.qty || 1), 0);
  const s = auth(req);
  const order = {
    id: nextOrderNo(), date: Date.now(),
    items: items.map((it) => ({ name: it.name, name_en: it.name_en || "", code: it.code || "", price: it.price || 0, qty: it.qty || 1, size: it.size || "", color: it.color || "" })),
    total: total, customer: customer, payment: b.payment || "whatsapp",
    status: (b.payment === "bank" || b.payment === "card" || b.payment === "hesab") ? "awaiting_payment" : "pending",
    userId: s && s.type === "user" ? s.userId : null,
  };
  db.orders.unshift(order);
  decStock(order.items, -1);
  saveDb();
  if (customer.email && emailOk(customer.email)) {
    const lines = order.items.map((it) => "• " + it.name + (it.size ? " " + it.size : "") + (it.color ? " " + it.color : "") + " x" + it.qty + " = " + (it.price * it.qty)).join("\n");
    sendMail(customer.email, "MAHO — تأیید سفارش " + order.id, "سفارش شما ثبت شد.\nشماره سفارش: " + order.id + "\n\n" + lines + "\n\nمجموع: " + total);
  }
  res.json({ order: order });
});
app.get("/api/orders", requireUser, (req, res) => res.json({ orders: db.orders.filter((o) => o.userId === req.user.id) }));
function findOrderForReq(req) {
  const s = auth(req); const o = db.orders.find((x) => x.id === req.params.id); if (!o) return null;
  if (s && s.type === "admin") return o;
  if (s && s.type === "user" && o.userId === s.userId) return o;
  return null;
}
app.post("/api/orders/:id/cancel", (req, res) => {
  const o = findOrderForReq(req); if (!o) return res.status(404).json({ error: "not found" });
  if (o.status !== "cancelled") { o.status = "cancelled"; decStock(o.items, 1); saveDb(); }
  res.json({ order: o });
});
app.post("/api/orders/:id/return", (req, res) => {
  const o = findOrderForReq(req); if (!o) return res.status(404).json({ error: "not found" });
  o.status = "return_requested"; saveDb();
  res.json({ order: o });
});

app.listen(PORT, () => console.log("MAHO backend on :" + PORT + " (email=" + EMAIL_ENABLED + ", devCodes=" + ALLOW_DEV_CODES + ")"));
