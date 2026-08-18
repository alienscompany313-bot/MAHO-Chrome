"use strict";
/**
 * POS sales, returns, shifts, reports — shares product stock with the online store.
 */
const crypto = require("crypto");
const { sanitizeText } = require("./security");
const { applyStockDelta } = require("./variant-stock");

function ensurePos(db) {
  let changed = false;
  if (!Array.isArray(db.posSales)) { db.posSales = []; changed = true; }
  if (!Array.isArray(db.posShifts)) { db.posShifts = []; changed = true; }
  if (!Array.isArray(db.posCashMoves)) { db.posCashMoves = []; changed = true; }
  if (db.posSeq == null || !Number.isFinite(Number(db.posSeq))) {
    /* derive next seq from existing POS-MAHO-* receipts without resetting them */
    let max = 0;
    (db.posSales || []).forEach((s) => {
      const m = String(s.receiptNo || s.id || "").match(/^POS-MAHO-(\d+)$/i);
      if (m) max = Math.max(max, parseInt(m[1], 10) || 0);
    });
    db.posSeq = max;
    changed = true;
  }
  return changed;
}

/** Transaction-safe sequential receipt: POS-MAHO-000001 */
function nextPosReceiptNo(db) {
  ensurePos(db);
  db.posSeq = (Number(db.posSeq) || 0) + 1;
  const n = db.posSeq;
  return "POS-MAHO-" + String(n).padStart(6, "0");
}

function findProduct(db, q) {
  const needle = String(q || "").trim().toLowerCase();
  if (!needle) return null;
  const products = db.products || [];
  return products.find((p) => {
    if (!p) return false;
    const code = String(p.code || p.barcode || p.sku || "").toLowerCase();
    const name = String(p.name || "").toLowerCase();
    const nameEn = String(p.name_en || "").toLowerCase();
    return code === needle || name === needle || nameEn === needle
      || (code && code.indexOf(needle) >= 0)
      || name.indexOf(needle) >= 0;
  }) || null;
}

function linePrice(p, qty, discountPct) {
  const base = Number(p.price) || 0;
  const disc = Math.max(0, Math.min(95, Number(discountPct != null ? discountPct : p.discount) || 0));
  const unit = disc > 0 ? Math.round(base * (1 - disc / 100)) : base;
  return { unit, line: unit * qty, disc };
}

function applyStock(db, items, sign) {
  /* sign -1 sell, +1 restock — atomic check before mutate */
  const updates = [];
  for (const it of items) {
    const p = findProduct(db, it.code || it.name) || (db.products || []).find((x) => x.name === it.name);
    if (!p) return { ok: false, error: "product_not_found", name: it.name };
    const qty = Math.max(1, parseInt(it.qty, 10) || 1);
    /* dry-run via clone of numbers only for check — applyStockDelta mutates; so check first */
    const probe = applyStockDelta(
      {
        stock: p.stock,
        sizes: p.sizes,
        colors: p.colors,
        variantStock: p.variantStock ? Object.assign({}, p.variantStock) : undefined,
      },
      qty,
      sign,
      it.color,
      it.size
    );
    if (!probe.ok) return { ok: false, error: probe.error || "insufficient_stock", name: p.name, stock: probe.stock };
    updates.push({ p: p, qty: qty, sign: sign, color: it.color, size: it.size });
  }
  updates.forEach(({ p, qty, sign, color, size }) => {
    applyStockDelta(p, qty, sign, color, size);
  });
  return { ok: true };
}

function createSale(db, body, staff) {
  ensurePos(db);
  if (!staff || (!staff.staffId && !staff.owner)) {
    return { error: "staff_session_required", status: 401 };
  }
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (!rawItems.length) return { error: "empty", status: 400 };
  const idem = String(body.idempotencyKey || "").trim();
  if (idem) {
    db.idempotencyKeys = db.idempotencyKeys || {};
    if (db.idempotencyKeys["pos:" + idem]) {
      const prev = db.posSales.find((x) => x.id === db.idempotencyKeys["pos:" + idem]);
      if (prev) return { sale: prev, replay: true };
    }
  }
  const items = [];
  for (const it of rawItems) {
    const p = findProduct(db, it.code || it.barcode || it.sku || it.name);
    if (!p) return { error: "product_not_found", status: 404, name: it.name || it.code };
    const qty = Math.max(1, parseInt(it.qty, 10) || 1);
    const priced = linePrice(p, qty, it.discount);
    items.push({
      name: p.name,
      name_en: p.name_en || "",
      code: p.code || p.barcode || p.sku || "",
      qty,
      price: priced.unit,
      discount: priced.disc,
      cost: p.cost != null ? Number(p.cost) : null,
    });
  }
  const stock = applyStock(db, items, -1);
  if (!stock.ok) return { error: stock.error, status: 409, stock: stock.stock, name: stock.name };

  const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
  const discount = Math.max(0, Number(body.discount) || 0);
  const tax = Math.max(0, Number(body.tax) || 0);
  const total = Math.max(0, subtotal - discount + tax);
  const openShift = (db.posShifts || []).find((s) => s.status === "open" && (
    (staff.staffId && s.staffId === staff.staffId) || (!staff.staffId && staff.owner)
  ));
  const receiptNo = nextPosReceiptNo(db);
  const sale = {
    id: receiptNo,
    receiptNo,
    type: "sale",
    date: Date.now(),
    items,
    subtotal,
    discount,
    tax,
    total,
    payment: sanitizeText(body.payment || "cash", 40),
    customer: body.customer && typeof body.customer === "object" ? {
      name: sanitizeText(body.customer.name, 80),
      phone: sanitizeText(body.customer.phone, 40),
      email: String(body.customer.email || "").trim().toLowerCase().slice(0, 120),
    } : null,
    staffId: staff.staffId || (staff.owner ? "owner" : null),
    staffName: staff.name || (staff.owner ? "Owner" : "staff"),
    shiftId: (body.shiftId || (openShift && openShift.id) || null),
    note: sanitizeText(body.note, 500),
  };
  db.posSales.unshift(sale);
  if (idem) db.idempotencyKeys["pos:" + idem] = sale.id;
  return { sale };
}

function createPosReturn(db, body, staff) {
  ensurePos(db);
  const saleId = String(body.saleId || "").trim();
  const sale = (db.posSales || []).find((x) => x.id === saleId && x.type === "sale");
  if (!sale) return { error: "sale_not_found", status: 404 };
  const rawItems = Array.isArray(body.items) ? body.items : sale.items;
  const items = [];
  for (const it of rawItems) {
    const qty = Math.max(1, parseInt(it.qty, 10) || 1);
    const orig = (sale.items || []).find((x) => x.code === it.code || x.name === it.name);
    if (!orig) return { error: "item_not_in_sale", status: 400 };
    const already = (db.posSales || [])
      .filter((x) => x.type === "return" && x.saleId === saleId)
      .reduce((n, r) => {
        const m = (r.items || []).find((y) => y.code === orig.code || y.name === orig.name);
        return n + (m ? m.qty : 0);
      }, 0);
    if (already + qty > orig.qty) return { error: "return_qty_exceeds", status: 400 };
    items.push({
      name: orig.name, name_en: orig.name_en, code: orig.code,
      qty, price: orig.price, discount: orig.discount, cost: orig.cost,
    });
  }
  const stock = applyStock(db, items, +1);
  if (!stock.ok) return { error: stock.error, status: 409 };
  const total = items.reduce((s, it) => s + it.price * it.qty, 0);
  const row = {
    id: "POSR-" + Date.now().toString(36).toUpperCase(),
    type: "return",
    saleId,
    date: Date.now(),
    items,
    total,
    reason: sanitizeText(body.reason, 500),
    mode: body.mode === "exchange" ? "exchange" : "refund",
    payment: sanitizeText(body.payment || sale.payment || "cash", 40),
    staffId: staff && staff.staffId || null,
    staffName: staff && staff.name || "admin",
    shiftId: body.shiftId || null,
  };
  db.posSales.unshift(row);
  return { return: row, sale };
}

function openShift(db, body, staff) {
  ensurePos(db);
  const open = (db.posShifts || []).find((s) => s.status === "open" && (!staff.staffId || s.staffId === staff.staffId));
  if (open) return { error: "shift_already_open", status: 409, shift: open };
  const shift = {
    id: "SH-" + crypto.randomBytes(4).toString("hex"),
    status: "open",
    openedAt: Date.now(),
    closedAt: null,
    openingCash: Number(body.openingCash) || 0,
    closingCash: null,
    expectedCash: null,
    difference: null,
    staffId: staff.staffId || null,
    staffName: staff.name || "admin",
    note: sanitizeText(body.note, 300),
  };
  db.posShifts.unshift(shift);
  return { shift };
}

function cashMove(db, body, staff) {
  ensurePos(db);
  const shiftId = String(body.shiftId || "").trim();
  const shift = (db.posShifts || []).find((s) => s.id === shiftId && s.status === "open");
  if (!shift) return { error: "no_open_shift", status: 400 };
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount === 0) return { error: "bad_amount", status: 400 };
  const move = {
    id: "CM-" + crypto.randomBytes(3).toString("hex"),
    shiftId,
    type: amount > 0 ? "cash_in" : "cash_out",
    amount,
    note: sanitizeText(body.note, 300),
    at: Date.now(),
    staffId: staff.staffId || null,
    staffName: staff.name || "admin",
  };
  db.posCashMoves.unshift(move);
  return { move };
}

function closeShift(db, body, staff) {
  ensurePos(db);
  const shift = (db.posShifts || []).find((s) => s.id === String(body.shiftId || "") && s.status === "open");
  if (!shift) return { error: "no_open_shift", status: 400 };
  const sales = (db.posSales || []).filter((x) => x.shiftId === shift.id);
  const cashSales = sales.filter((x) => x.type === "sale" && x.payment === "cash").reduce((s, x) => s + (x.total || 0), 0);
  const cashReturns = sales.filter((x) => x.type === "return" && x.payment === "cash").reduce((s, x) => s + (x.total || 0), 0);
  const moves = (db.posCashMoves || []).filter((m) => m.shiftId === shift.id);
  const moveSum = moves.reduce((s, m) => s + (Number(m.amount) || 0), 0);
  const expected = shift.openingCash + cashSales - cashReturns + moveSum;
  const actual = Number(body.closingCash);
  if (!Number.isFinite(actual)) return { error: "closing_cash_required", status: 400 };
  shift.status = "closed";
  shift.closedAt = Date.now();
  shift.closingCash = actual;
  shift.expectedCash = expected;
  shift.difference = actual - expected;
  shift.closeNote = sanitizeText(body.note, 300);
  shift.closedBy = staff.name || "admin";
  return { shift };
}

function buildReports(db, { from, to } = {}) {
  ensurePos(db);
  const fromTs = from ? Date.parse(from) || Number(from) : 0;
  const toTs = to ? Date.parse(to) || Number(to) : Date.now();
  const inRange = (t) => t >= fromTs && t <= toTs;
  const posSales = (db.posSales || []).filter((x) => x.type === "sale" && inRange(x.date));
  const posReturns = (db.posSales || []).filter((x) => x.type === "return" && inRange(x.date));
  const online = (db.orders || []).filter((o) => inRange(o.date || 0) && o.status !== "cancelled");
  const byPay = {};
  posSales.forEach((s) => { byPay[s.payment] = (byPay[s.payment] || 0) + (s.total || 0); });
  online.forEach((o) => { const k = "online:" + (o.payment || "other"); byPay[k] = (byPay[k] || 0) + (o.total || 0); });
  const byStaff = {};
  posSales.forEach((s) => {
    const k = s.staffName || "—";
    byStaff[k] = byStaff[k] || { sales: 0, count: 0 };
    byStaff[k].sales += s.total || 0;
    byStaff[k].count += 1;
  });
  let inventoryValue = 0, lowStock = [];
  (db.products || []).forEach((p) => {
    const stock = p.stock == null || p.stock === "" ? null : Number(p.stock);
    const price = Number(p.price) || 0;
    const cost = p.cost != null ? Number(p.cost) : null;
    if (stock != null && Number.isFinite(stock)) {
      inventoryValue += stock * (cost != null && Number.isFinite(cost) ? cost : price);
      if (stock <= 3) lowStock.push({ name: p.name, code: p.code || "", stock });
    }
  });
  let cogs = 0, revenue = 0;
  posSales.forEach((s) => {
    revenue += s.total || 0;
    (s.items || []).forEach((it) => {
      if (it.cost != null) cogs += Number(it.cost) * it.qty;
    });
  });
  const shifts = (db.posShifts || []).filter((s) => inRange(s.openedAt || 0));
  return {
    from: fromTs, to: toTs,
    posSalesTotal: posSales.reduce((s, x) => s + (x.total || 0), 0),
    posSalesCount: posSales.length,
    posReturnsTotal: posReturns.reduce((s, x) => s + (x.total || 0), 0),
    posReturnsCount: posReturns.length,
    onlineSalesTotal: online.reduce((s, x) => s + (x.total || 0), 0),
    onlineSalesCount: online.length,
    discounts: posSales.reduce((s, x) => s + (x.discount || 0), 0),
    byPayment: byPay,
    byStaff,
    inventoryValue,
    lowStock,
    grossProfit: cogs > 0 ? revenue - cogs : null,
    cogs: cogs > 0 ? cogs : null,
    shifts: shifts.map((s) => ({
      id: s.id, staffName: s.staffName, status: s.status,
      openingCash: s.openingCash, closingCash: s.closingCash,
      expectedCash: s.expectedCash, difference: s.difference,
      openedAt: s.openedAt, closedAt: s.closedAt,
    })),
  };
}

function listPosProducts(db, { q, cat, stock } = {}) {
  const needle = String(q || "").trim().toLowerCase();
  const catF = String(cat || "").trim().toLowerCase();
  const stockF = String(stock || "").trim().toLowerCase(); /* all|in|low|out */
  const lowDefault = 3;
  return (db.products || []).filter((p) => {
    if (!p || p.enabled === false || p.active === false) return false;
    if (catF && String(p.cat || p.category || "").toLowerCase() !== catF) return false;
    const st = p.stock == null || p.stock === "" ? null : Number(p.stock);
    const lowAt = p.lowStock != null ? Number(p.lowStock) : lowDefault;
    if (stockF === "out" && !(st != null && st <= 0)) return false;
    if (stockF === "low" && !(st != null && st > 0 && st <= lowAt)) return false;
    if (stockF === "in" && !(st == null || st > 0)) return false;
    if (!needle) return true;
    const hay = [p.name, p.name_en, p.code, p.barcode, p.sku].map((x) => String(x || "").toLowerCase()).join(" ");
    return hay.indexOf(needle) >= 0;
  }).map((p) => {
    const st = p.stock == null || p.stock === "" ? null : Number(p.stock);
    const lowAt = p.lowStock != null ? Number(p.lowStock) : lowDefault;
    let stockStatus = "unknown";
    if (st != null && Number.isFinite(st)) {
      if (st <= 0) stockStatus = "out";
      else if (st <= lowAt) stockStatus = "low";
      else stockStatus = "in";
    }
    const imgs = Array.isArray(p.images) && p.images.length ? p.images : (p.image ? [p.image] : []);
    return {
      id: p.id || p.code || p.name,
      name: p.name,
      name_en: p.name_en || "",
      code: p.code || p.sku || "",
      barcode: p.barcode || p.code || p.sku || "",
      sku: p.sku || p.code || "",
      price: Number(p.price) || 0,
      stock: st,
      lowStockAt: lowAt,
      stockStatus,
      cat: p.cat || p.category || "",
      image: imgs[0] || "",
      discount: p.discount || 0,
    };
  });
}

module.exports = {
  ensurePos, findProduct, createSale, createPosReturn,
  openShift, cashMove, closeShift, buildReports, applyStock,
  nextPosReceiptNo, listPosProducts,
};
