"use strict";
/**
 * Staff accounts + permission checks.
 * Owner = env ADMIN_PASSWORD (full access). Staff = db.staff[] with hashed passwords.
 *
 * Coarse keys (legacy) remain authoritative. Granular keys refine when assigned;
 * having the parent coarse key grants related granular actions.
 */
const { hashPassword, verifyPassword, sanitizeText } = require("./security");

const ALL_PERMS = [
  "orders", "delivery", "pos", "products", "customers", "returns", "reports", "settings", "staff", "drivers", "marketing",
  /* granular (additive) */
  "orders_approve", "orders_reject", "orders_fulfill", "orders_cancel", "orders_ship",
  "returns_reasons", "returns_assign", "returns_refund", "returns_analytics",
  "customers_block", "customers_edit",
  "marketing_send", "marketing_export", "marketing_giveaway",
  "marketing_giveaway_draw", "marketing_giveaway_notify", "marketing_giveaway_claim",
  "stores", "inventory", "discounts_rules", "staff_manage",
  /* data retention */
  "retention_view", "retention_edit", "retention_preview", "retention_archive", "retention_delete", "retention_history",
];

const PERM_PARENT = {
  orders_approve: "orders",
  orders_reject: "orders",
  orders_fulfill: "orders",
  orders_cancel: "orders",
  orders_ship: "orders",
  returns_reasons: "returns",
  returns_assign: "returns",
  returns_refund: "returns",
  returns_analytics: "returns",
  customers_block: "customers",
  customers_edit: "customers",
  marketing_send: "marketing",
  marketing_export: "marketing",
  marketing_giveaway: "marketing",
  marketing_giveaway_draw: "marketing_giveaway",
  marketing_giveaway_notify: "marketing_giveaway",
  marketing_giveaway_claim: "marketing_giveaway",
  stores: "settings",
  inventory: "products",
  discounts_rules: "settings",
  staff_manage: "staff",
  retention_view: "settings",
  retention_edit: "settings",
  retention_preview: "settings",
  retention_archive: "settings",
  retention_history: "settings",
  /* permanent delete has NO parent — Owner or explicit grant only */
};

const PERM_GROUPS = [
  { id: "sales", title: "فروش / Orders & Sales", keys: ["orders", "orders_approve", "orders_reject", "orders_fulfill", "orders_cancel", "orders_ship", "pos", "reports"] },
  { id: "customers", title: "مشتریان", keys: ["customers", "customers_edit", "customers_block"] },
  { id: "marketing", title: "بازاریابی", keys: ["marketing", "marketing_send", "marketing_export", "marketing_giveaway", "marketing_giveaway_draw", "marketing_giveaway_notify", "marketing_giveaway_claim"] },
  { id: "returns", title: "برگشتی‌ها", keys: ["returns", "returns_reasons", "returns_assign", "returns_refund", "returns_analytics"] },
  { id: "delivery", title: "رانندگان / Delivery", keys: ["drivers", "delivery"] },
  { id: "staff", title: "کارمندان", keys: ["staff", "staff_manage"] },
  { id: "stores", title: "فروشگاه‌ها / Inventory", keys: ["products", "inventory", "stores", "settings", "discounts_rules"] },
  { id: "retention", title: "مدیریت اطلاعات و پاک‌سازی", keys: ["retention_view", "retention_edit", "retention_preview", "retention_archive", "retention_delete", "retention_history"] },
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
    deactivatedAt: s.deactivatedAt || null,
    deactivatedBy: s.deactivatedBy || null,
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
  if (session.owner) return true;
  if (session.role === "owner") return true;
  const perms = normalizePerms(session.permissions);
  if (!perms.length) return false;
  if (perm === "any") return true;
  const need = String(perm || "").toLowerCase();
  if (perms.indexOf(need) >= 0) return true;
  /* Walk parent chain so marketing grants marketing_giveaway_claim, etc. */
  let parent = PERM_PARENT[need];
  const seen = new Set();
  while (parent && !seen.has(parent)) {
    if (perms.indexOf(parent) >= 0) return true;
    seen.add(parent);
    parent = PERM_PARENT[parent];
  }
  return false;
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
  if (body.active != null) {
    s.active = !!body.active;
    if (!s.active) {
      s.deactivatedAt = s.deactivatedAt || Date.now();
    }
  }
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
  PERM_GROUPS,
  PERM_PARENT,
  normalizePerms,
  publicStaff,
  hasPerm,
  requirePerm,
  createStaff,
  updateStaff,
  authenticateStaff,
};
