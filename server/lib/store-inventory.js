"use strict";
/**
 * Store-level product availability / stock — additive extension.
 * Global product.stock / variantStock remain the source of truth for
 * total sellable units when storeStock is absent.
 *
 * product.storeAvailabilityMode = "all" | "selected"
 * product.storeIds = string[]  // authoritative when mode === "selected"
 * product.storeStock = { [storeId]: { available, stock, variantStock? } }
 *
 * Legacy (no storeAvailabilityMode / no storeIds field): treat as "all".
 * Historical empty storeIds array (pre-mode): treat as "all".
 * Explicit mode "selected" + empty storeIds: NO pickup stores.
 */
const { haversineKm, parseCoord, resolveStoreMapsUrl } = require("./geo");
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
  /* Do NOT invent storeIds from storeStock — that overloads empty/missing semantics. */
  return changed;
}

function resolveStoreAvailabilityMode(product) {
  if (!product || typeof product !== "object") return "all";
  if (product.storeAvailabilityMode === "all" || product.storeAvailabilityMode === "selected") {
    return product.storeAvailabilityMode;
  }
  /* Legacy products: missing storeIds field => all active stores */
  if (!Object.prototype.hasOwnProperty.call(product, "storeIds")) return "all";
  if (!Array.isArray(product.storeIds)) return "all";
  /* Historical admin save wrote [] to mean "all stores" */
  if (product.storeIds.length === 0) return "all";
  return "selected";
}

function normalizeStoreAssignment(product) {
  if (!product || typeof product !== "object") return product;
  ensureStoreStock(product);
  const mode = resolveStoreAvailabilityMode(product);
  product.storeAvailabilityMode = mode;
  if (mode === "all") {
    if (!Array.isArray(product.storeIds)) product.storeIds = [];
  } else if (!Array.isArray(product.storeIds)) {
    product.storeIds = [];
  }
  return product;
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
  normalizeStoreAssignment(product);
  const row = storeRow(product, storeId);
  if (!row) return { ok: false, error: "missing_store" };
  if (body.available != null) row.available = !!body.available;
  if (body.stock != null) row.stock = Math.max(0, parseInt(body.stock, 10) || 0);
  if (body.variantStock && typeof body.variantStock === "object") {
    row.variantStock = Object.assign({}, row.variantStock || {}, body.variantStock);
  }
  /* Switching a store on/off forces selected mode */
  product.storeAvailabilityMode = "selected";
  const ids = new Set((product.storeIds || []).map(String));
  if (row.available) ids.add(String(storeId));
  else ids.delete(String(storeId));
  product.storeIds = Array.from(ids);
  return { ok: true, storeStock: row, storeIds: product.storeIds, storeAvailabilityMode: product.storeAvailabilityMode };
}

function storeAvailableStock(product, storeId, color, size) {
  ensureStoreStock(product);
  const id = String(storeId || "");
  const mode = resolveStoreAvailabilityMode(product);
  if (!id) return 0;
  if (mode === "all" && !Object.keys(product.storeStock).length) {
    return availableStock(product, color, size);
  }
  if (!productCarriedAtStore(product, id)) return 0;
  const row = product.storeStock[id];
  if (!row) return availableStock(product, color, size);
  if (row.available === false) return 0;
  if (row.variantStock && typeof row.variantStock === "object" && Object.keys(row.variantStock).length) {
    const key = variantKey(color, size);
    if (Object.prototype.hasOwnProperty.call(row.variantStock, key)) {
      const n = parseInt(row.variantStock[key], 10);
      return isNaN(n) ? 0 : Math.max(0, n);
    }
  }
  /*
   * Store assignment rows often only set `available` (or historically wrote stock:0
   * before product.stock was known). Pickup eligibility must follow storeIds —
   * use global product stock unless a positive per-store stock is explicitly set.
   */
  if (row.stock == null || row.stock === "") {
    return availableStock(product, color, size);
  }
  const n = parseInt(row.stock, 10);
  if (isNaN(n) || n <= 0) return availableStock(product, color, size);
  return n;
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
  return applyStockDelta(product, qty, sign, color, size);
}

function productCarriedAtStore(product, storeId) {
  if (!product) return false;
  ensureStoreStock(product);
  const id = String(storeId || "");
  if (!id) return false;
  const mode = resolveStoreAvailabilityMode(product);
  if (mode === "all") {
    const row = product.storeStock[id];
    if (row && row.available === false) return false;
    return true;
  }
  /* selected mode — storeIds is authoritative */
  const ids = Array.isArray(product.storeIds) ? product.storeIds.map(String) : [];
  if (!ids.length) return false; /* explicit empty selection => no pickup stores */
  if (ids.indexOf(id) < 0) return false;
  const row = product.storeStock[id];
  if (row && row.available === false) return false;
  return true;
}

/**
 * Stores that can fulfill ALL cart lines (qty) for pickup — intersection.
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
      normalizeStoreAssignment(p);
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
    const profileMap = String(store.googleMapsUrl || store.googleMapsPlaceUrl || store.map || store.mapUrl || "").trim();
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
      map: profileMap || undefined,
      mapsUrl: resolveStoreMapsUrl(store) || "",
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
  if (!store) return null;
  const idx = stores.indexOf(store);
  const id = store.id || ("store_" + idx);
  const lat = parseCoord(store.lat);
  const lng = parseCoord(store.lng);
  const profileMap = String(store.googleMapsUrl || store.googleMapsPlaceUrl || store.map || store.mapUrl || "").trim();
  return {
    id,
    name: store.name || "MAHO",
    address: store.address || store.area || "",
    phone: store.phone || "",
    hours: store.hours || "",
    hours_en: store.hours_en || "",
    lat,
    lng,
    map: profileMap || undefined,
    mapsUrl: resolveStoreMapsUrl(store) || "",
  };
}

module.exports = {
  ensureStoreStock,
  storeRow,
  setStoreAvailability,
  storeAvailableStock,
  applyStoreStockDelta,
  productCarriedAtStore,
  eligiblePickupStores,
  resolvePickupStore,
  resolveStoreAvailabilityMode,
  normalizeStoreAssignment,
};
