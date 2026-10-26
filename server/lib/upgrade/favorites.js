"use strict";

function codes(user) {
  const list = Array.isArray(user && user.favorites) ? user.favorites : [];
  const seen = {};
  return list.map((code) => String(code || "").trim()).filter((code) => {
    if (!code || seen[code]) return false;
    seen[code] = true;
    return true;
  }).slice(0, 200);
}

function activeProduct(db, code) {
  return (db.products || []).find((product) => product && String(product.code || "") === code && product.enabled !== false && product.active !== false) || null;
}

function summary(db, code) {
  const product = activeProduct(db, code);
  if (!product) return { code: code, available: false };
  return {
    code: product.code,
    name: product.name || "",
    name_en: product.name_en || "",
    price: Number(product.price) || 0,
    old: Number(product.old) || 0,
    discount: Number(product.discount) || 0,
    image: (Array.isArray(product.images) && product.images[0]) || product.image || "",
    images: Array.isArray(product.images) ? product.images.filter(Boolean).slice(0, 8) : [],
    icon: product.icon || "",
    cat: product.cat || "",
    stock: product.stock == null || product.stock === "" ? null : product.stock,
    available: true,
  };
}

function list(db, user) {
  const favorites = codes(user);
  user.favorites = favorites;
  return { favorites: favorites, items: favorites.map((code) => summary(db, code)) };
}

function toggle(db, user, code) {
  const key = String(code || "").trim().slice(0, 40);
  if (!key) return { error: "bad_code", status: 400 };
  if (!activeProduct(db, key) && codes(user).indexOf(key) < 0) return { error: "not_found", status: 404 };
  const next = codes(user);
  const at = next.indexOf(key);
  if (at >= 0) next.splice(at, 1);
  else next.push(key);
  user.favorites = next;
  return list(db, user);
}

function remove(db, user, code) {
  const key = String(code || "").trim();
  user.favorites = codes(user).filter((item) => item !== key);
  return list(db, user);
}

module.exports = { list, toggle, remove, codes };
