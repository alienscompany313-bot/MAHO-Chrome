"use strict";
/**
 * Store-level product availability / stock — additive extension.
 * Global product.stock / variantStock remain the source of truth for
 * total sellable units when storeStock is absent.
 *
 * product.storeStock = {
 *   [storeId]: { available: boolean, stock: number|null, variantStock?: object }
 * }
 * product.storeIds = string[]  // stores that carry the product (optional shorthand)
 */
const { haversineKm, parseCoord } = require("./geo");
const {
  availableStock, applyStockDelta, colorKey, sizeKey, usesVariantStock, variantKey,
} = require("./variant-stock");

function ensureStoreStock(product) {
  if (!product || typeof product !== "object") return false;
  let changed = false;
  if (!product.storeStock || typeof product.storeStock !== "object") {
    product.storeStock = {};
    changed = true;
  }
  if (!Array.isArray(product.storeIds)) {
    product.storeIds = Object.keys(product.storeStock).filter((id) => {
      const row = product.storeStock[id];
      return row && row.available !== false;
    });
    changed = true;
  }
  return changed;
}

function storeRow(product, storeId) {
  ensureStoreStock(product);
  const id = String(storeId || "");
  if (!id) return null;
  if (!product.storeStock[id]) {
    product.storeStock[id] = { available: false, stock: 0 };
  }
  return product.storeStock[id];
}

function setStoreAvailability(product, storeId, body) {
  const row = storeRow(product, storeId);
  if (!row) return { ok: false, error: "missing_store" };
  if (body.available != null) row.available = !!body.available;
  if (body.stock != null) row.stock = Math.max(0, parseInt(body.stock, 10) || 0);
  if (body.variantStock && typeof body.variantStock === "object") {
    row.variantStock = Object.assign({}, row.variantStock || {}, body.variantStock);
  }
  const ids = new Set(product.storeIds || []);
  if (row.available) ids.add(String(storeId));
  else ids.delete(String(storeId));
  product.storeIds = Array.from(ids);
  return { ok: true, storeStock: row, storeIds: product.storeIds };
}

function storeAvailableStock(product, storeId, color, size) {
  ensureStoreStock(product);
  const id = String(storeId || "");
  /* No store scoping configured → fall back to global stock */
  if (!id || !Object.keys(product.storeStock).length) {
    return availableStock(product, color, size);
  }
  const row = product.storeStock[id];
  if (!row || row.available === false) return 0;
  if (row.variantStock && typeof row.variantStock === "object") {
    const key = variantKey(color, size);
    if (Object.prototype.hasOwnProperty.call(row.variantStock, key)) {
      const n = parseInt(row.variantStock[key], 10);
      return isNaN(n) ? 0 : Math.max(0, n);
    }
  }
  if (row.stock == null) return availableStock(product, color, size);
  const n = parseInt(row.stock, 10);
  return isNaN(n) ? 0 : Math.max(0, n);
}

function applyStoreStockDelta(product, storeId, qty, sign, color, size) {
  ensureStoreStock(product);
  const id = String(storeId || "");
  if (!id || !product.storeStock[id]) {
    return applyStockDelta(product, qty, sign, color, size);
  }
  const row = product.storeStock[id];
  const q = Math.max(0, parseInt(qty, 10) || 0);
  const delta = (sign < 0 ? -1 : 1) * q;
  if (row.variantStock && typeof row.variantStock === "object") {
    const key = variantKey(color, size);
    const cur = parseInt(row.variantStock[key], 10) || 0;
    const next = cur + delta;
    if (next < 0) return { ok: false, stock: cur };
    row.variantStock[key] = next;
  } else {
    const cur = parseInt(row.stock, 10) || 0;
    const next = cur + delta;
    if (next < 0) return { ok: false, stock: cur };
    row.stock = next;
  }
  /* Also mirror on global stock so public catalog stays consistent */
  return applyStockDelta(product, qty, sign, color, size);
}

function productCarriedAtStore(product, storeId) {
  ensureStoreStock(product);
  const id = String(storeId || "");
  if (!Object.keys(product.storeStock).length) return true; /* unset = all stores */
  if (Array.isArray(product.storeIds) && product.storeIds.length) {
    if (product.storeIds.indexOf(id) < 0) return false;
  }
  const row = product.storeStock[id];
  return !!(row && row.available !== false);
}

/**
 * Stores that can fulfill ALL cart lines (qty) for pickup.
 */
function eligiblePickupStores(db, cartItems, customerLat, customerLng) {
  const stores = Array.isArray(db.stores) ? db.stores : [];
  const products = Array.isArray(db.products) ? db.products : [];
  const findP = (code, name) =>
    products.find((p) => p && !p.deleted && (
      (code && String(p.code) === String(code)) ||
      (name && String(p.name) === String(name))
    ));

  const out = [];
  stores.forEach((store, idx) => {
    if (!store || store.active === false) return;
    const storeId = store.id || ("store_" + idx);
    if (!store.id) store.id = storeId;
    let ok = true;
    const shortages = [];
    (cartItems || []).forEach((it) => {
      const p = findP(it.code, it.name);
      if (!p || p.active === false) {
        ok = false;
        shortages.push({ code: it.code, reason: "missing_product" });
        return;
      }
      if (!productCarriedAtStore(p, storeId)) {
        ok = false;
        shortages.push({ code: p.code, reason: "not_at_store" });
        return;
      }
      const need = Math.max(1, parseInt(it.qty, 10) || 1);
      const have = storeAvailableStock(p, storeId, it.color, it.size);
      if (have < need) {
        ok = false;
        shortages.push({ code: p.code, reason: "insufficient_stock", have, need });
      }
    });
    if (!ok) return;
    const lat = parseCoord(store.lat);
    const lng = parseCoord(store.lng);
    let distanceKm = null;
    if (lat != null && lng != null && customerLat != null && customerLng != null) {
      distanceKm = Math.round(haversineKm(customerLat, customerLng, lat, lng) * 100) / 100;
    }
    const address = store.address || store.area || "";
    out.push({
      id: storeId,
      name: store.name || "",
      name_en: store.name_en || "",
      address,
      area: store.area || "",
      phone: store.phone || "",
      hours: store.hours || "",
      hours_en: store.hours_en || "",
      lat,
      lng,
      distanceKm,
      mapsUrl: (lat != null && lng != null)
        ? ("https://www.google.com/maps?q=" + encodeURIComponent(lat + "," + lng))
        : (store.map || ""),
    });
  });
  out.sort((a, b) => {
    if (a.distanceKm == null && b.distanceKm == null) return String(a.name).localeCompare(String(b.name), "fa");
    if (a.distanceKm == null) return 1;
    if (b.distanceKm == null) return -1;
    return a.distanceKm - b.distanceKm;
  });
  return out;
}

function resolvePickupStore(db, storeId) {
  const stores = Array.isArray(db.stores) ? db.stores : [];
  let store = stores.find((s, i) => String(s.id || ("store_" + i)) === String(storeId));
  if (!store && stores.length) store = stores[0];
  if (!store) return null;
  const idx = stores.indexOf(store);
  const id = store.id || ("store_" + idx);
  const lat = parseCoord(store.lat);
  const lng = parseCoord(store.lng);
  return {
    id,
    name: store.name || "MAHO",
    address: store.address || store.area || "",
    phone: store.phone || "",
    hours: store.hours || "",
    hours_en: store.hours_en || "",
    lat,
    lng,
    mapsUrl: (lat != null && lng != null)
      ? ("https://www.google.com/maps?q=" + encodeURIComponent(lat + "," + lng))
      : (store.map || ""),
    instructions: store.pickupInstructions || store.instructions || "",
  };
}

module.exports = {
  ensureStoreStock,
  setStoreAvailability,
  storeAvailableStock,
  applyStoreStockDelta,
  productCarriedAtStore,
  eligiblePickupStores,
  resolvePickupStore,
};
