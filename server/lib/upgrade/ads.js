"use strict";

const crypto = require("crypto");
const { sanitizeText } = require("../security");
const { safeHttpUrl } = require("./safe-url");

function blankAd(partial) {
  const src = partial && typeof partial === "object" ? partial : {};
  return {
    id: src.id || ("ad_" + crypto.randomBytes(5).toString("hex")),
    enabled: src.enabled === true,
    imageUrl: typeof src.imageUrl === "string" ? src.imageUrl.slice(0, 500) : "",
    title: sanitizeText(src.title, 120),
    title_en: sanitizeText(src.title_en, 120),
    description: sanitizeText(src.description, 400),
    description_en: sanitizeText(src.description_en, 400),
    url: safeHttpUrl(src.url),
    startAt: src.startAt ? Number(src.startAt) || null : null,
    endAt: src.endAt ? Number(src.endAt) || null : null,
    order: Number(src.order) || 0,
  };
}

function normalizeList(list) {
  return (Array.isArray(list) ? list : []).slice(0, 24).map(blankAd);
}

function ensureAds(db) {
  if (!db.ads || typeof db.ads !== "object") {
    db.ads = { homepage: [], listing: [], announcement: [] };
    db.adStats = db.adStats || {};
    return true;
  }
  let changed = false;
  ["homepage", "listing", "announcement"].forEach((key) => {
    if (!Array.isArray(db.ads[key])) { db.ads[key] = []; changed = true; }
  });
  if (!db.adStats || typeof db.adStats !== "object") { db.adStats = {}; changed = true; }
  return changed;
}

function isLive(ad, now) {
  if (!ad || ad.enabled !== true) return false;
  const t = typeof now === "number" ? now : Date.now();
  if (ad.startAt && t < Number(ad.startAt)) return false;
  if (ad.endAt && t > Number(ad.endAt)) return false;
  return true;
}

function publicAds(db, now) {
  ensureAds(db);
  const pack = (key) => (db.ads[key] || [])
    .filter((ad) => isLive(ad, now))
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((ad) => ({
      id: ad.id,
      imageUrl: ad.imageUrl || "",
      title: ad.title || "",
      title_en: ad.title_en || "",
      description: ad.description || "",
      description_en: ad.description_en || "",
      url: ad.url || "",
      order: ad.order || 0,
    }));
  return {
    homepage: pack("homepage"),
    listing: pack("listing"),
    announcement: pack("announcement"),
  };
}

function adminAds(db) {
  ensureAds(db);
  const withStats = (list) => list.map((ad) => {
    const st = db.adStats[ad.id] || {};
    return Object.assign({}, ad, {
      impressions: Number(st.impressions) || 0,
      clicks: Number(st.clicks) || 0,
    });
  });
  return {
    homepage: withStats(db.ads.homepage || []),
    listing: withStats(db.ads.listing || []),
    announcement: withStats(db.ads.announcement || []),
  };
}

function saveArea(db, area, list) {
  ensureAds(db);
  if (["homepage", "listing", "announcement"].indexOf(area) < 0) return { error: "bad_area" };
  db.ads[area] = normalizeList(list);
  return { ads: adminAds(db) };
}

function findAd(db, id) {
  ensureAds(db);
  const keys = ["homepage", "listing", "announcement"];
  for (let i = 0; i < keys.length; i++) {
    const hit = (db.ads[keys[i]] || []).find((ad) => ad && ad.id === id);
    if (hit) return hit;
  }
  return null;
}

function bump(db, id, field) {
  const ad = findAd(db, id);
  if (!ad || !isLive(ad)) return false;
  db.adStats[id] = db.adStats[id] || { impressions: 0, clicks: 0 };
  db.adStats[id][field] = (Number(db.adStats[id][field]) || 0) + 1;
  return true;
}

module.exports = {
  ensureAds,
  publicAds,
  adminAds,
  saveArea,
  findAd,
  isLive,
  bump,
};
