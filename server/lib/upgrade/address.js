"use strict";

const { sanitizeText } = require("../security");

function clean(v, n) {
  return sanitizeText(v, n || 80);
}

function normalizeAddr(src) {
  const a = src && typeof src === "object" ? src : {};
  const city = clean(a.city || a.area, 80);
  return {
    country: clean(a.country, 80) || "افغانستان",
    province: clean(a.province || a.state, 80),
    district: clean(a.district, 80),
    city: city,
    area: clean(a.area || city, 80),
    street: clean(a.street || a.lane, 120),
    house: clean(a.house || a.houseNumber, 40),
    zip: clean(a.zip || a.postalCode, 20),
  };
}

function composeAddress(addr) {
  const a = normalizeAddr(addr);
  const parts = [];
  const line1 = [a.house, a.street].filter(Boolean).join(" ");
  if (line1) parts.push(line1);
  if (a.city) parts.push(a.city);
  else if (a.area) parts.push(a.area);
  if (a.district) parts.push(a.district);
  if (a.province) parts.push(a.province);
  if (a.zip) parts.push(a.zip);
  if (a.country) parts.push(a.country);
  return parts.join("، ");
}

function snapshotAddress(customer) {
  const c = customer && typeof customer === "object" ? customer : {};
  const addr = normalizeAddr(c.addr || c);
  const written = clean(c.address, 400);
  return {
    addr: addr,
    address: written || composeAddress(addr),
  };
}

function formatAddressLines(customer, lang) {
  const snap = snapshotAddress(customer);
  const a = snap.addr;
  const en = lang === "en";
  const rows = [];
  if (snap.address && !a.street && !a.city && !a.province) {
    rows.push(snap.address);
    return rows;
  }
  const push = (label, value) => { if (value) rows.push(label + ": " + value); };
  push(en ? "Country" : "کشور", a.country);
  push(en ? "Province" : "ولایت", a.province);
  push(en ? "District" : "ولسوالی", a.district);
  push(en ? "City" : "شهر", a.city || a.area);
  push(en ? "Street" : "سرک", a.street);
  push(en ? "House" : "نمبر خانه", a.house);
  if (a.zip) push(en ? "ZIP" : "زیپ کود", a.zip);
  if (!rows.length && snap.address) rows.push(snap.address);
  return rows;
}

module.exports = { normalizeAddr, composeAddress, snapshotAddress, formatAddressLines };
