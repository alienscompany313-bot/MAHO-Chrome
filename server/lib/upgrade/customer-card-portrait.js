"use strict";

/**
 * Proposed portrait customer card. This does not replace the approved
 * landscape card (1016×638 PNG, 86×54 mm PDF).
 * No earlier luxury portrait file exists in the project. This proposal follows
 * the landscape card's cream-and-gold palette and the official logo artwork.
 */

const fs = require("fs");
const QRCode = require("qrcode");
const code128 = require("./code128");
const cards = require("./customer-card");

const PORTRAIT_W = 760;
const PORTRAIT_H = 1200;

function b64(buf) {
  return Buffer.from(buf).toString("base64");
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function barcodeRects(text, x, y, w, h) {
  let modules;
  try { modules = code128.modulesFor(text); } catch (_) { return ""; }
  const quiet = 12;
  const inner = modules.length + quiet * 2;
  const mw = w / inner;
  let cursor = x;
  let run = 0;
  let out = "";
  const paint = () => {
    if (!run) return;
    out += `<rect x="${cursor.toFixed(2)}" y="${y}" width="${(run * mw).toFixed(2)}" height="${h}" fill="#1a1509"/>`;
    cursor += run * mw;
    run = 0;
  };
  for (let i = 0; i < quiet; i++) cursor += mw;
  for (let i = 0; i <= modules.length; i++) {
    if (i < modules.length && modules[i] === 1) run += 1;
    else if (run) paint();
    else if (i < modules.length) cursor += mw;
  }
  return out;
}

function leaf(rot, scale) {
  return `<g transform="rotate(${rot}) scale(${scale})">
    <path d="M0 0 C14 -26 36 -20 34 4 C20 14 8 8 0 0 Z" fill="#f8edd4" stroke="#b8893a" stroke-width="1.1"/>
    <path d="M6 -1 C14 -12 24 -10 28 1" fill="none" stroke="#c6a15a" stroke-width="0.7"/>
  </g>`;
}

function flower(r) {
  let petals = "";
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    petals += `<ellipse cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" rx="${(r * 0.42).toFixed(1)}" ry="${(r * 0.72).toFixed(1)}" transform="rotate(${i * 60} ${px.toFixed(1)} ${py.toFixed(1)})" fill="#fbf3df" stroke="#c6a15a" stroke-width="0.7"/>`;
  }
  return petals + `<circle r="${(r * 0.28).toFixed(1)}" fill="#c8a35f"/>`;
}

function bouquet() {
  return `<g fill="none" stroke="#c6a15a" stroke-linecap="round">
    <path d="M10 108 C36 70 24 28 62 8" stroke-width="1.45"/>
    <path d="M28 98 C8 64 30 36 16 8" stroke-width="1.15"/>
    <path d="M42 86 C68 58 52 30 82 18" stroke-width="1.15"/>
    <path d="M24 78 C40 58 36 40 52 34" stroke-width="0.9"/>
    <g transform="translate(62 8)">${flower(9)}</g>
    <g transform="translate(82 22)">${flower(5.5)}</g>
    <g transform="translate(16 12)">${leaf(-28, 0.95)}</g>
    <g transform="translate(8 34)">${leaf(18, 0.78)}</g>
    <g transform="translate(30 28)">${leaf(-8, 1)}</g>
    <g transform="translate(48 36)">${leaf(32, 0.72)}</g>
    <g transform="translate(20 56)">${leaf(-48, 0.9)}</g>
    <g transform="translate(44 60)">${leaf(12, 0.84)}</g>
    <g transform="translate(12 78)">${leaf(42, 0.7)}</g>
    <g transform="translate(36 82)">${leaf(-18, 0.76)}</g>
    <g transform="translate(58 70)">${leaf(24, 0.62)}</g>
    <circle cx="74" cy="24" r="1.8" fill="#c8a35f" stroke="none"/>
    <circle cx="8" cy="52" r="1.5" fill="#c8a35f" stroke="none"/>
    <circle cx="70" cy="78" r="1.4" fill="#c8a35f" stroke="none"/>
  </g>`;
}

function ornaments() {
  return `<g>
    <g transform="translate(12 12)">${bouquet()}</g>
    <g transform="translate(748 12) scale(-1 1)">${bouquet()}</g>
    <g transform="translate(12 1188) scale(1 -1)">${bouquet()}</g>
    <g transform="translate(748 1188) scale(-1 -1)">${bouquet()}</g>
    <g transform="translate(4 520) scale(0.78)">${bouquet()}</g>
    <g transform="translate(756 520) scale(-0.78 0.78)">${bouquet()}</g>
  </g>`;
}

function divider(y) {
  return `<line x1="250" y1="${y}" x2="340" y2="${y}" stroke="#c8a35f" stroke-width="1.2"/>
    <polygon points="380,${y - 6} 386,${y} 380,${y + 6} 374,${y}" fill="#c8a35f"/>
    <line x1="420" y1="${y}" x2="510" y2="${y}" stroke="#c8a35f" stroke-width="1.2"/>`;
}

async function renderPortraitSvg(sample) {
  const data = sample || {};
  const name = esc(String(data.name || "لیلا احمدی").slice(0, 42));
  const tagFa = esc(String(data.taglineFa || "لباس و لوازم بانوان").slice(0, 120));
  const tagEn = esc(String(data.taglineEn || "Women's Clothing & Accessories").slice(0, 120)).replace(/&/g, "&amp;");
  const no = esc(String(data.customerNo || "20260001"));
  const url = String(data.verifyUrl || "https://mahomarket.com/verify/portrait-preview");
  const qr = await QRCode.toBuffer(url, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 420,
    color: { dark: "#1a1509", light: "#ffffff" },
  });
  const qrUri = "data:image/png;base64," + b64(qr);
  let logo = "";
  try {
    logo = "data:image/jpeg;base64," + b64(fs.readFileSync(cards.LOGO_PATH));
  } catch (_) { logo = ""; }
  const logoTag = logo
    ? `<circle cx="380" cy="176" r="142" fill="none" stroke="#c8a35f" stroke-width="3"/>
       <circle cx="380" cy="176" r="132" fill="#fffdf8" stroke="#e4d3a8" stroke-width="1.3"/>
       <clipPath id="portraitLogo"><circle cx="380" cy="176" r="126"/></clipPath>
       <image href="${logo}" x="254" y="50" width="252" height="252" preserveAspectRatio="xMidYMid meet" clip-path="url(#portraitLogo)"/>`
    : `<circle cx="380" cy="176" r="126" fill="#1a1509"/><text x="380" y="190" text-anchor="middle" font-family="Tahoma, sans-serif" font-size="42" fill="#c8a35f">MAHO</text>`;
  const bars = barcodeRects(String(data.customerNo || "20260001"), 130, 1028, 500, 72);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${PORTRAIT_W}" height="${PORTRAIT_H}" viewBox="0 0 ${PORTRAIT_W} ${PORTRAIT_H}">
  <defs>
    <linearGradient id="ivory" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fffdf8"/>
      <stop offset="0.45" stop-color="#fbf4e6"/>
      <stop offset="1" stop-color="#f3e4c4"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="22%" r="48%">
      <stop offset="0" stop-color="#fff8e8"/>
      <stop offset="1" stop-color="#f3e4c4" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${PORTRAIT_W}" height="${PORTRAIT_H}" rx="36" fill="url(#ivory)"/>
  <rect width="${PORTRAIT_W}" height="${PORTRAIT_H}" rx="36" fill="url(#glow)"/>
  <rect x="14" y="14" width="${PORTRAIT_W - 28}" height="${PORTRAIT_H - 28}" rx="28" fill="none" stroke="#c8a35f" stroke-width="3"/>
  <rect x="26" y="26" width="${PORTRAIT_W - 52}" height="${PORTRAIT_H - 52}" rx="22" fill="none" stroke="#e4d3a8" stroke-width="1.2"/>
  <rect x="34" y="34" width="${PORTRAIT_W - 68}" height="${PORTRAIT_H - 68}" rx="18" fill="none" stroke="#c8a35f" stroke-width="0.6"/>
  ${ornaments()}
  ${logoTag}
  <text x="380" y="348" text-anchor="middle" font-family="Tahoma, sans-serif" font-size="40" font-weight="700" fill="#1a1509">کارت مشتری</text>
  <text x="380" y="380" text-anchor="middle" font-family="Tahoma, sans-serif" font-size="16" letter-spacing="3.4" fill="#1a1509">CUSTOMER CARD</text>
  ${divider(404)}
  <text x="380" y="428" text-anchor="middle" font-family="Tahoma, sans-serif" font-size="16" fill="#3a3428">${tagFa}</text>
  <text x="380" y="450" text-anchor="middle" font-family="Tahoma, sans-serif" font-size="13" fill="#6d6456">${tagEn}</text>
  <text x="380" y="470" text-anchor="middle" font-family="Tahoma, sans-serif" font-size="13" fill="#6d6456">نام / Name</text>
  <rect x="150" y="482" width="460" height="56" rx="16" fill="#fffaf1" stroke="#c8a35f" stroke-width="1.4"/>
  <text x="380" y="518" text-anchor="middle" font-family="Tahoma, sans-serif" font-size="30" font-weight="700" fill="#1a1509">${name}</text>
  <text x="380" y="570" text-anchor="middle" font-family="Tahoma, sans-serif" font-size="13" fill="#6d6456">شماره مشتری / Customer No.</text>
  <rect x="170" y="582" width="420" height="56" rx="16" fill="#f8edd4" stroke="#c8a35f" stroke-width="1.4"/>
  <text x="380" y="620" text-anchor="middle" font-family="Tahoma, sans-serif" font-size="30" font-weight="700" letter-spacing="4" fill="#1a1509">${no}</text>
  <rect x="230" y="660" width="300" height="300" rx="22" fill="#ffffff" stroke="#c8a35f" stroke-width="2.2"/>
  <rect x="242" y="672" width="276" height="276" rx="16" fill="#ffffff" stroke="#e4d3a8" stroke-width="1"/>
  <image href="${qrUri}" x="258" y="688" width="244" height="244"/>
  <text x="380" y="984" text-anchor="middle" font-family="Tahoma, sans-serif" font-size="13" fill="#3a3428">Scan to verify · برای تأیید اسکن کنید</text>
  <rect x="90" y="1004" width="580" height="118" rx="16" fill="#ffffff" stroke="#e4d3a8" stroke-width="1"/>
  ${bars}
  <text x="380" y="1122" text-anchor="middle" font-family="Tahoma, sans-serif" font-size="16" font-weight="700" letter-spacing="2" fill="#1a1509">${no}</text>
  ${divider(1152)}
  <text x="380" y="1176" text-anchor="middle" font-family="Tahoma, sans-serif" font-size="14" fill="#3a3428">mahomarket.com</text>
</svg>`;
}

async function renderPortraitPng(sample) {
  const { Resvg } = require("@resvg/resvg-js");
  const svg = await renderPortraitSvg(sample);
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: PORTRAIT_W },
    font: { defaultFontFamily: "Tahoma", sansSerifFamily: "Tahoma" },
  });
  return resvg.render().asPng();
}

function sampleFor(siteUrl) {
  const base = String(siteUrl || "http://127.0.0.1:4720").replace(/\/+$/, "");
  return {
    name: "لیلا احمدی",
    customerNo: "20260001",
    verifyUrl: base + "/card-portrait-preview.html#20260001",
  };
}

module.exports = {
  PORTRAIT_W,
  PORTRAIT_H,
  renderPortraitSvg,
  renderPortraitPng,
  sampleFor,
};
