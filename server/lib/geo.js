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

module.exports = { haversineKm, parseCoord, storeCoords, mapsLink, ensureHttpsUrl };
