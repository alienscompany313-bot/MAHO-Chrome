"use strict";

const crypto = require("crypto");
const { sanitizeText } = require("../security");
const { safeHttpUrl } = require("./safe-url");

const DEFAULTS = [
  { label: "وب‌سایت ماهو", label_en: "MAHO website", url: "https://mahomarket.com", kind: "website", enabled: true, order: 0 },
  { label: "اینستاگرام", label_en: "Instagram", url: "", kind: "instagram", enabled: false, order: 1 },
  { label: "فیسبوک", label_en: "Facebook", url: "", kind: "facebook", enabled: false, order: 2 },
  { label: "واتساپ", label_en: "WhatsApp", url: "", kind: "whatsapp", enabled: false, order: 3 },
  { label: "گوگل مپ", label_en: "Google Maps", url: "", kind: "maps", enabled: false, order: 4 },
  { label: "تیک‌تاک", label_en: "TikTok", url: "", kind: "tiktok", enabled: false, order: 5 },
  { label: "یوتیوب", label_en: "YouTube", url: "", kind: "youtube", enabled: false, order: 6 },
  { label: "تلگرام", label_en: "Telegram", url: "", kind: "telegram", enabled: false, order: 7 },
  { label: "پشتیبانی", label_en: "Support", url: "", kind: "support", enabled: false, order: 8 },
  { label: "شکایات", label_en: "Complaints", url: "", kind: "complaints", enabled: false, order: 9 },
  { label: "بازخورد", label_en: "Feedback", url: "", kind: "feedback", enabled: false, order: 10 },
];

function ensureLinks(db) {
  if (!db.linkPage || !Array.isArray(db.linkPage.links)) {
    db.linkPage = {
      links: DEFAULTS.map((row) => Object.assign({ id: "lnk_" + crypto.randomBytes(4).toString("hex") }, row)),
      subtitle: "لباس و لوازم بانوان",
      subtitle_en: "Women's clothing & accessories",
      updatedAt: Date.now(),
    };
    return true;
  }
  let changed = false;
  if (!db.linkPage.subtitle) { db.linkPage.subtitle = "لباس و لوازم بانوان"; changed = true; }
  if (!db.linkPage.subtitle_en) { db.linkPage.subtitle_en = "Women's clothing & accessories"; changed = true; }
  const have = {};
  db.linkPage.links.forEach((row) => { if (row && row.kind) have[row.kind] = true; });
  DEFAULTS.forEach((row) => {
    if (have[row.kind]) return;
    db.linkPage.links.push(Object.assign({ id: "lnk_" + crypto.randomBytes(4).toString("hex") }, row));
    changed = true;
  });
  return changed;
}

function normalize(list) {
  return (Array.isArray(list) ? list : []).slice(0, 24).map((row, i) => ({
    id: row.id || ("lnk_" + crypto.randomBytes(4).toString("hex")),
    label: sanitizeText(row.label, 80),
    label_en: sanitizeText(row.label_en, 80),
    url: safeHttpUrl(row.url),
    kind: sanitizeText(row.kind, 40) || "link",
    enabled: row.enabled !== false && !!safeHttpUrl(row.url),
    order: Number.isFinite(Number(row.order)) ? Number(row.order) : i,
  })).filter((row) => row.label || row.label_en);
}

function saveLinks(db, list, meta) {
  ensureLinks(db);
  db.linkPage.links = normalize(list);
  if (meta && typeof meta === "object") {
    if (meta.subtitle != null) db.linkPage.subtitle = sanitizeText(meta.subtitle, 160);
    if (meta.subtitle_en != null) db.linkPage.subtitle_en = sanitizeText(meta.subtitle_en, 160);
  }
  if (!db.linkPage.subtitle) db.linkPage.subtitle = "لباس و لوازم بانوان";
  if (!db.linkPage.subtitle_en) db.linkPage.subtitle_en = "Women's clothing & accessories";
  db.linkPage.updatedAt = Date.now();
  return db.linkPage;
}

function publicLinks(db) {
  ensureLinks(db);
  return (db.linkPage.links || [])
    .filter((row) => row && row.enabled && row.url)
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((row) => ({
      id: row.id,
      label: row.label,
      label_en: row.label_en,
      url: row.url,
      kind: row.kind || "link",
    }));
}

module.exports = { ensureLinks, saveLinks, publicLinks, normalize };
