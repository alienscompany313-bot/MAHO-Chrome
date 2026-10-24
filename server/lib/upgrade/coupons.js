"use strict";

const crypto = require("crypto");
const { sanitizeText } = require("../security");
const { toMinor, fromMinor } = require("./money");

function ensureCoupons(db) {
  if (!Array.isArray(db.coupons)) {
    db.coupons = [];
    return true;
  }
  return false;
}

function normalizeCode(code) {
  return String(code || "").trim().toUpperCase().replace(/\s+/g, "");
}

function cleanCoupon(src, prev) {
  const row = src && typeof src === "object" ? src : {};
  const type = row.type === "fixed" ? "fixed" : "percent";
  let value = Number(row.value);
  if (!Number.isFinite(value) || value < 0) value = 0;
  if (type === "percent") value = Math.min(100, value);
  const categories = Array.isArray(row.categories) ? row.categories.map((c) => sanitizeText(c, 40)).filter(Boolean).slice(0, 20) : [];
  const products = Array.isArray(row.productCodes) ? row.productCodes.map((c) => sanitizeText(c, 40)).filter(Boolean).slice(0, 80) : [];
  return {
    id: (prev && prev.id) || row.id || ("cpn_" + crypto.randomBytes(4).toString("hex")),
    code: normalizeCode(row.code).slice(0, 32),
    type: type,
    value: value,
    enabled: row.enabled !== false,
    startAt: row.startAt ? Number(row.startAt) || null : null,
    endAt: row.endAt ? Number(row.endAt) || null : null,
    minOrderMinor: Math.max(0, toMinor(row.minOrder != null ? row.minOrder : fromMinor(row.minOrderMinor || 0))),
    categories: categories,
    productCodes: products,
    maxUses: row.maxUses == null || row.maxUses === "" ? null : Math.max(0, parseInt(row.maxUses, 10) || 0),
    perCustomer: row.perCustomer == null || row.perCustomer === "" ? 1 : Math.max(1, parseInt(row.perCustomer, 10) || 1),
    capMinor: row.cap == null || row.cap === "" ? null : Math.max(0, toMinor(row.cap)),
    uses: Array.isArray(prev && prev.uses) ? prev.uses : (Array.isArray(row.uses) ? row.uses : []),
  };
}

function saveAll(db, list) {
  ensureCoupons(db);
  const prevByCode = {};
  db.coupons.forEach((c) => { if (c && c.code) prevByCode[c.code] = c; });
  const seen = {};
  db.coupons = (Array.isArray(list) ? list : []).slice(0, 100).map((row) => {
    const code = normalizeCode(row && row.code);
    const prev = prevByCode[code] || db.coupons.find((c) => c && c.id === row.id);
    const next = cleanCoupon(row, prev);
    return next;
  }).filter((row) => {
    if (!row.code || seen[row.code]) return false;
    seen[row.code] = true;
    return true;
  });
  return db.coupons;
}

function publicAdmin(db) {
  ensureCoupons(db);
  return db.coupons.map((c) => ({
    id: c.id,
    code: c.code,
    type: c.type,
    value: c.value,
    enabled: c.enabled,
    startAt: c.startAt,
    endAt: c.endAt,
    minOrder: fromMinor(c.minOrderMinor || 0),
    categories: c.categories || [],
    productCodes: c.productCodes || [],
    maxUses: c.maxUses,
    perCustomer: c.perCustomer,
    cap: c.capMinor == null ? null : fromMinor(c.capMinor),
    used: (c.uses || []).length,
  }));
}

function eligibleSubtotal(items, coupon) {
  const cats = coupon.categories || [];
  const codes = (coupon.productCodes || []).map((c) => String(c).toLowerCase());
  let minor = 0;
  (items || []).forEach((it) => {
    const catOk = !cats.length || cats.indexOf(it.cat) >= 0;
    const code = String(it.code || it.sku || "").toLowerCase();
    const codeOk = !codes.length || codes.indexOf(code) >= 0;
    if (!catOk || !codeOk) return;
    const qty = Math.max(1, parseInt(it.qty, 10) || 1);
    const unit = Number(it.price) || 0;
    minor += toMinor(unit * qty);
  });
  return minor;
}

function evaluate(db, code, user, items, now) {
  ensureCoupons(db);
  const key = normalizeCode(code);
  if (!key) return { error: "coupon_required", status: 400 };
  const coupon = db.coupons.find((c) => c && c.code === key);
  if (!coupon || coupon.enabled === false) return { error: "coupon_invalid", status: 400 };
  const t = typeof now === "number" ? now : Date.now();
  if (coupon.startAt && t < coupon.startAt) return { error: "coupon_not_started", status: 400 };
  if (coupon.endAt && t > coupon.endAt) return { error: "coupon_expired", status: 400 };
  const uses = coupon.uses || [];
  if (coupon.maxUses != null && uses.length >= coupon.maxUses) return { error: "coupon_exhausted", status: 400 };
  const uid = user && user.id;
  if (uid && uses.filter((u) => u && u.userId === uid).length >= (coupon.perCustomer || 1)) {
    return { error: "coupon_used", status: 400 };
  }
  const base = eligibleSubtotal(items, coupon);
  if (base <= 0) return { error: "coupon_not_eligible", status: 400 };
  if (coupon.minOrderMinor && base < coupon.minOrderMinor) return { error: "coupon_min_order", status: 400 };
  let off = coupon.type === "percent" ? Math.round(base * (Number(coupon.value) || 0) / 100) : toMinor(coupon.value);
  if (coupon.capMinor != null) off = Math.min(off, coupon.capMinor);
  off = Math.max(0, Math.min(off, base));
  if (off <= 0) return { error: "coupon_no_discount", status: 400 };
  return {
    ok: true,
    code: coupon.code,
    id: coupon.id,
    amountMinor: off,
    amount: fromMinor(off),
    baseMinor: base,
  };
}

function commitUse(db, code, user, orderId, amountMinor) {
  ensureCoupons(db);
  const coupon = db.coupons.find((c) => c && c.code === normalizeCode(code));
  if (!coupon) return false;
  coupon.uses = coupon.uses || [];
  if (coupon.uses.some((u) => u && u.orderId === orderId)) return true;
  if (coupon.maxUses != null && coupon.uses.length >= coupon.maxUses) return false;
  coupon.uses.push({
    userId: user && user.id,
    orderId: orderId,
    at: Date.now(),
    amountMinor: Math.round(amountMinor || 0),
  });
  return true;
}

module.exports = { ensureCoupons, saveAll, publicAdmin, evaluate, commitUse, normalizeCode };
