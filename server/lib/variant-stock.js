"use strict";
/**
 * Color × size variant inventory helpers.
 * Additive / non-destructive: products without variantStock keep legacy product.stock.
 *
 * Storage on product:
 *   sizes: string[]
 *   colors: string[]          (optional "Name|#hex")
 *   variantStock: { "color||size": number }
 *   stock: number             (sum of variants when variantStock is in use)
 */

function colorKey(c) {
  return String(c == null ? "" : c).split("|")[0].trim();
}

function sizeKey(s) {
  return String(s == null ? "" : s).trim();
}

function variantKey(color, size) {
  return colorKey(color) + "||" + sizeKey(size);
}

function parseSizes(p) {
  return (Array.isArray(p && p.sizes) ? p.sizes : []).map(sizeKey).filter(Boolean);
}

function parseColorNames(p) {
  return (Array.isArray(p && p.colors) ? p.colors : []).map(colorKey).filter(Boolean);
}

function hasVariantOptions(p) {
  return parseSizes(p).length > 0 || parseColorNames(p).length > 0;
}

function getVariantStockMap(p) {
  return p && p.variantStock && typeof p.variantStock === "object" && !Array.isArray(p.variantStock)
    ? p.variantStock
    : null;
}

function usesVariantStock(p) {
  const map = getVariantStockMap(p);
  return !!(hasVariantOptions(p) && map && Object.keys(map).length);
}

function listVariantCombos(p) {
  const sizes = parseSizes(p);
  const colors = parseColorNames(p);
  const S = sizes.length ? sizes : [""];
  const C = colors.length ? colors : [""];
  const out = [];
  for (let ci = 0; ci < C.length; ci++) {
    for (let si = 0; si < S.length; si++) {
      const color = C[ci];
      const size = S[si];
      out.push({ color: color, size: size, key: variantKey(color, size) });
    }
  }
  return out;
}

function sumVariantStock(map) {
  if (!map) return 0;
  let sum = 0;
  Object.keys(map).forEach((k) => {
    const n = parseInt(map[k], 10);
    if (!isNaN(n)) sum += Math.max(0, n);
  });
  return sum;
}

function syncProductStockFromVariants(p) {
  if (!p || !usesVariantStock(p)) return;
  p.stock = sumVariantStock(p.variantStock);
}

/** Available units for a selection. Infinity = unlimited (legacy unset stock). */
function availableStock(p, color, size) {
  if (!p) return 0;
  if (usesVariantStock(p)) {
    const key = variantKey(color, size);
    if (Object.prototype.hasOwnProperty.call(p.variantStock, key)) {
      const n = parseInt(p.variantStock[key], 10);
      return isNaN(n) ? 0 : Math.max(0, n);
    }
    return 0;
  }
  if (p.stock == null || p.stock === "") return Infinity;
  const n = parseInt(p.stock, 10);
  return isNaN(n) ? Infinity : Math.max(0, n);
}

/**
 * Rebuild matrix when sizes/colors change.
 * Preserve previous combo stocks; new combos start at 0.
 */
function rebuildVariantMatrix(p, previousMap) {
  if (!p) return;
  if (!hasVariantOptions(p)) {
    if (p.variantStock) delete p.variantStock;
    return;
  }
  const prev = previousMap && typeof previousMap === "object" ? previousMap : (getVariantStockMap(p) || {});
  const next = {};
  listVariantCombos(p).forEach((combo) => {
    if (Object.prototype.hasOwnProperty.call(prev, combo.key)) {
      const n = parseInt(prev[combo.key], 10);
      next[combo.key] = isNaN(n) ? 0 : Math.max(0, n);
    } else {
      next[combo.key] = 0;
    }
  });
  p.variantStock = next;
  syncProductStockFromVariants(p);
}

function canUseExactCombo(p, color, size) {
  const needColor = parseColorNames(p).length > 0;
  const needSize = parseSizes(p).length > 0;
  if (needColor && !colorKey(color)) return false;
  if (needSize && !sizeKey(size)) return false;
  return true;
}

/**
 * Apply delta to stock (+ restock, - sell).
 * Exact color+size when available; otherwise greedy across combos (POS).
 */
function applyStockDelta(p, qty, sign, color, size) {
  const q = Math.max(1, parseInt(qty, 10) || 1);
  const delta = sign * q;
  if (!p) return { ok: false, error: "product_not_found" };

  if (!usesVariantStock(p)) {
    if (p.stock == null || p.stock === "") return { ok: true, unlimited: true };
    const stock = Number(p.stock);
    if (!Number.isFinite(stock)) return { ok: true };
    if (sign < 0 && stock < q) return { ok: false, error: "insufficient_stock", stock: stock };
    p.stock = Math.max(0, stock + delta);
    return { ok: true, stock: p.stock };
  }

  const map = p.variantStock;

  if (canUseExactCombo(p, color, size)) {
    const key = variantKey(color, size);
    const cur = Object.prototype.hasOwnProperty.call(map, key) ? parseInt(map[key], 10) : 0;
    const stock = isNaN(cur) ? 0 : cur;
    if (sign < 0 && stock < q) return { ok: false, error: "insufficient_stock", stock: stock, key: key };
    map[key] = Math.max(0, stock + delta);
    syncProductStockFromVariants(p);
    return { ok: true, stock: map[key], key: key };
  }

  if (sign < 0) {
    let need = q;
    const keys = Object.keys(map);
    for (let i = 0; i < keys.length && need > 0; i++) {
      const k = keys[i];
      const cur = parseInt(map[k], 10) || 0;
      if (cur <= 0) continue;
      const take = Math.min(cur, need);
      map[k] = cur - take;
      need -= take;
    }
    if (need > 0) {
      syncProductStockFromVariants(p);
      return { ok: false, error: "insufficient_stock", stock: sumVariantStock(map) };
    }
    syncProductStockFromVariants(p);
    return { ok: true, stock: p.stock };
  }

  const keys = Object.keys(map);
  const k0 = keys[0] || variantKey("", "");
  if (!map[k0] && map[k0] !== 0) map[k0] = 0;
  map[k0] = (parseInt(map[k0], 10) || 0) + q;
  syncProductStockFromVariants(p);
  return { ok: true, stock: p.stock };
}

function checkStock(p, qty, color, size) {
  const q = Math.max(1, parseInt(qty, 10) || 1);
  const avail = availableStock(p, color, size);
  if (avail === Infinity) return { ok: true, stock: null };
  if (avail < q) return { ok: false, stock: avail };
  return { ok: true, stock: avail };
}

/** Public stock row for GET /api/stock */
function stockPublicRow(p) {
  const row = {
    code: (p && (p.code || p.barcode || p.sku)) || "",
    name: p && p.name,
    stock: p && (p.stock == null || p.stock === "") ? null : Number(p.stock),
    price: p && p.price,
    discount: (p && p.discount) || 0,
  };
  if (usesVariantStock(p)) {
    row.variantStock = Object.assign({}, p.variantStock);
    row.sizes = parseSizes(p);
    row.colors = Array.isArray(p.colors) ? p.colors.slice() : [];
  }
  return row;
}

module.exports = {
  colorKey,
  sizeKey,
  variantKey,
  hasVariantOptions,
  usesVariantStock,
  getVariantStockMap,
  listVariantCombos,
  sumVariantStock,
  syncProductStockFromVariants,
  availableStock,
  rebuildVariantMatrix,
  applyStockDelta,
  checkStock,
  stockPublicRow,
};
