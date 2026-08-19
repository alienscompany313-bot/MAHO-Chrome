"use strict";

/** Haversine distance in km between two WGS84 points. */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (Number(d) * Math.PI) / 180;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lng2 - lng1);
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseCoord(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function storeCoords(stores) {
  const list = Array.isArray(stores) ? stores : [];
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (!s) continue;
    const lat = parseCoord(s.lat);
    const lng = parseCoord(s.lng);
    if (lat != null && lng != null) return { lat, lng, store: s };
  }
  return null;
}

function mapsLink(lat, lng) {
  if (lat == null || lng == null) return null;
  return "https://www.google.com/maps?q=" + encodeURIComponent(Number(lat) + "," + Number(lng));
}

function ensureHttpsUrl(u) {
  const s = String(u || "").trim();
  if (!s) return "";
  if (/^https:\/\//i.test(s)) return s;
  if (/^http:\/\//i.test(s)) return "https://" + s.slice(7);
  if (/^\/\//.test(s)) return "https:" + s;
  return "https://" + s.replace(/^\/+/, "");
}

/** True when URL is a bare coordinate pin (not a business/place/profile link). */
function isRawCoordMapsUrl(u) {
  const s = String(u || "").trim();
  if (!s) return false;
  return /(?:google\.[^/\s]+\/maps|maps\.google\.[^/\s]+|maps\.app\.goo\.gl)[^<\s"']*\bq=[-+]?\d+(\.\d+)?(%2C|,)[-+]?\d+(\.\d+)?/i.test(s)
    || /[?&]q=[-+]?\d+(\.\d+)?(%2C|,)[-+]?\d+(\.\d+)?\s*$/i.test(s);
}

/**
 * Prefer a real Google Maps business/place/profile/share URL over raw lat/lng pins.
 * Priority: googleMapsUrl → googleMapsPlaceUrl → map → mapUrl → non-coord mapsUrl → lat/lng.
 */
function resolveStoreMapsUrl(store) {
  const s = store || {};
  const profileKeys = ["googleMapsUrl", "googleMapsPlaceUrl", "map", "mapUrl"];
  for (let i = 0; i < profileKeys.length; i++) {
    const raw = String(s[profileKeys[i]] || "").trim();
    if (/^https?:\/\//i.test(raw)) return ensureHttpsUrl(raw);
  }
  const existing = String(s.mapsUrl || "").trim();
  if (existing && !isRawCoordMapsUrl(existing)) return ensureHttpsUrl(existing);
  const lat = parseCoord(s.lat);
  const lng = parseCoord(s.lng);
  if (lat != null && lng != null) return mapsLink(lat, lng);
  return existing ? ensureHttpsUrl(existing) : "";
}

module.exports = {
  haversineKm, parseCoord, storeCoords, mapsLink, ensureHttpsUrl,
  isRawCoordMapsUrl, resolveStoreMapsUrl,
};
