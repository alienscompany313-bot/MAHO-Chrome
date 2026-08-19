"use strict";
/**
 * Staff accounts + permission checks.
 * Owner = env ADMIN_PASSWORD (full access). Staff = db.staff[] with hashed passwords.
 */
const { hashPassword, verifyPassword, sanitizeText } = require("./security");

const ALL_PERMS = [
  "orders", "delivery", "pos", "products", "customers", "returns", "reports", "settings", "staff", "drivers", "marketing",
];

function normalizePerms(list) {
  const set = new Set();
  (Array.isArray(list) ? list : []).forEach((p) => {
    const k = String(p || "").trim().toLowerCase();
    if (ALL_PERMS.indexOf(k) >= 0) set.add(k);
  });
  return Array.from(set);
}

function publicStaff(s) {
  if (!s) return null;
  return {
    id: s.id,
    name: s.name,
    email: s.email || "",
    phone: s.phone || "",
    role: s.role || "staff",
    permissions: normalizePerms(s.permissions),
    active: s.active !== false,
    createdAt: s.createdAt || null,
  };
}

function hasPerm(session, perm) {
  if (!session) return false;
  if (session.type === "pos") {
    const p = String(perm || "").toLowerCase();
    return p === "pos" || p === "reports" || p === "any";
  }
  if (session.type === "driver") {
    return String(perm || "").toLowerCase() === "delivery" || perm === "any";
  }
  if (session.type !== "admin") return false;
  if (session.owner) return true; /* bootstrap ADMIN_PASSWORD */
  if (session.role === "owner") return true;
  const perms = normalizePerms(session.permissions);
  if (!perms.length) return false; /* default: no access */
  if (perm === "any") return true;
  return perms.indexOf(String(perm || "").toLowerCase()) >= 0;
}

function requirePerm(getSession, perm) {
  return function (req, res, next) {
    const s = getSession(req);
    if (!s || s.type !== "admin") return res.status(401).json({ error: "admin required" });
    if (!hasPerm(s, perm)) return res.status(403).json({ error: "forbidden", need: perm });
    req.adminSession = s;
    next();
  };
}

function createStaff(db, body, actor) {
  db.staff = db.staff || [];
  const name = sanitizeText(body.name, 80);
  const email = String(body.email || "").trim().toLowerCase();
  const phone = sanitizeText(body.phone, 40);
  const password = String(body.password || "");
  if (!name || password.length < 8) return { error: "invalid_fields", status: 400 };
  if (email && db.staff.some((x) => x.email === email && x.active !== false)) {
    return { error: "email_exists", status: 409 };
  }
  const row = {
    id: require("crypto").randomUUID(),
    name,
    email,
    phone,
    pass: hashPassword(password),
    role: "staff",
    permissions: normalizePerms(body.permissions),
    active: true,
    createdAt: Date.now(),
    createdBy: actor || "owner",
  };
  db.staff.push(row);
  return { staff: publicStaff(row) };
}

function updateStaff(db, id, body, { allowPerms }) {
  const s = (db.staff || []).find((x) => x.id === id);
  if (!s) return { error: "not_found", status: 404 };
  if (body.name != null) s.name = sanitizeText(body.name, 80);
  if (body.email != null) s.email = String(body.email || "").trim().toLowerCase();
  if (body.phone != null) s.phone = sanitizeText(body.phone, 40);
  if (body.active != null) s.active = !!body.active;
  if (allowPerms && body.permissions != null) s.permissions = normalizePerms(body.permissions);
  if (body.password && String(body.password).length >= 8) s.pass = hashPassword(String(body.password));
  return { staff: publicStaff(s) };
}

function authenticateStaff(db, login, password) {
  const id = String(login || "").trim().toLowerCase();
  const s = (db.staff || []).find((x) =>
    x.active !== false && [x.email, x.phone, x.id].some((v) => v && String(v).toLowerCase() === id)
  );
  if (!s || !verifyPassword(password, s.pass)) return null;
  return s;
}

module.exports = {
  ALL_PERMS,
  normalizePerms,
  publicStaff,
  hasPerm,
  requirePerm,
  createStaff,
  updateStaff,
  authenticateStaff,
};
