"use strict";

const crypto = require("crypto");
const { sanitizeText } = require("../security");
const { safeHttpUrl } = require("./safe-url");

const TYPES = ["whatsapp", "tel", "email", "telegram", "instagram", "facebook", "url"];

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

function hrefFor(type, destination) {
  const raw = String(destination || "").trim();
  if (type === "tel") {
    const d = digits(raw);
    return d.length >= 8 ? "tel:+" + d : "";
  }
  if (type === "email") {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? "mailto:" + raw : "";
  }
  if (type === "whatsapp") {
    if (/^https:\/\/(wa\.me|api\.whatsapp\.com)\//i.test(raw)) return safeHttpUrl(raw);
    const d = digits(raw);
    return d.length >= 8 ? "https://wa.me/" + d : "";
  }
  const href = safeHttpUrl(raw);
  return /^https:\/\//i.test(href) ? href : "";
}

function clean(row, index) {
  const src = row && typeof row === "object" ? row : {};
  const type = TYPES.indexOf(src.type) >= 0 ? src.type : "url";
  const destination = String(src.destination || "").trim().slice(0, 300);
  return {
    id: sanitizeText(src.id, 40) || ("ct_" + crypto.randomBytes(4).toString("hex")),
    type: type,
    label: sanitizeText(src.label, 60),
    label_en: sanitizeText(src.label_en, 60),
    destination: destination,
    enabled: src.enabled !== false,
    order: index,
  };
}

function seedFromConfig(db) {
  const content = (db.config && db.config.content) || {};
  const rows = [];
  const wa = content.whatsappLink || content.officialWhatsAppNumber || "";
  const phone = content.footerPhone || "";
  const email = content.footerEmail || "";
  if (wa) rows.push({ type: "whatsapp", label: "واتساپ", label_en: "WhatsApp", destination: wa, enabled: true });
  if (phone) rows.push({ type: "tel", label: "تماس تلفنی", label_en: "Call", destination: phone, enabled: true });
  if (email) rows.push({ type: "email", label: "ارسال ایمیل", label_en: "Email", destination: email, enabled: true });
  return rows;
}

function ensureContactMethods(db) {
  let changed = false;
  if (!Array.isArray(db.contactMethods)) {
    db.contactMethods = seedFromConfig(db).map(clean);
    changed = true;
  }
  /* One-time: the public footer already shows this store's phone and email.
     Keep them in the managed list so the popup does not drop them. */
  if (!db.contactMethodsReady) {
    const hasWa = db.contactMethods.some((row) => row.type === "whatsapp" && /93791505454/.test(String(row.destination || "") + String(row.href || "")));
    const has = (type) => db.contactMethods.some((row) => row.type === type);
    if (hasWa) {
      const extras = [];
      if (!has("tel")) extras.push({ type: "tel", label: "تماس تلفنی", label_en: "Call", destination: "+93791505454", enabled: true });
      if (!has("email")) extras.push({ type: "email", label: "ارسال ایمیل", label_en: "Email", destination: "info@mahomarket.com", enabled: true });
      if (extras.length) db.contactMethods = db.contactMethods.concat(extras.map((row, index) => clean(row, db.contactMethods.length + index)));
    }
    db.contactMethodsReady = true;
    changed = true;
  }
  return changed;
}

function saveContactMethods(db, list) {
  ensureContactMethods(db);
  const seen = {};
  db.contactMethods = (Array.isArray(list) ? list : []).slice(0, 20).map(clean).filter((row) => {
    if (!row.label || !hrefFor(row.type, row.destination) || seen[row.id]) return false;
    seen[row.id] = true;
    return true;
  });
  return db.contactMethods;
}

function publicContactMethods(db) {
  ensureContactMethods(db);
  return db.contactMethods.filter((row) => row.enabled).map((row) => {
    const href = hrefFor(row.type, row.destination);
    return href ? { id: row.id, type: row.type, label: row.label, label_en: row.label_en, href: href, order: row.order } : null;
  }).filter(Boolean);
}

module.exports = {
  TYPES,
  hrefFor,
  ensureContactMethods,
  saveContactMethods,
  publicContactMethods,
};
