"use strict";
/**
 * Digital customer cards.
 *
 * One permanent customer number (the existing user.customerNo) and one card.
 * The QR contains only https://host/verify/<random-token>.
 * The raw token is stored on the user record for re-issuing the same card to
 * that customer. It is never copied into public profile, catalog, or logs.
 *
 * Future Apple Wallet (NOT active):
 * - Stable id: user.customerNo (also stored as card.wallet.serialNumber)
 * - Same QR verification URL can be the pass barcode
 * - Future env (server only, never in the client):
 *   APPLE_PASS_TYPE_ID, APPLE_TEAM_ID,
 *   APPLE_PASS_CERT_PATH, APPLE_PASS_CERT_PASSWORD, APPLE_WWDR_CERT_PATH
 * - Generate .pkpass later with passkit-generator or equivalent, sign on the server,
 *   and only then show Add to Apple Wallet.
 * - Do not ship a pass, a certificate, or a working Wallet button now.
 * PNG and PDF do not depend on Apple.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");
const { hashOpaque } = require("../security");
const code128 = require("./code128");
const life = require("./account-life");

const LOGO_PATH = path.join(__dirname, "..", "..", "..", "website", "assets", "brand", "maho-logo.jpg");

function b64(buf) {
  return Buffer.from(buf).toString("base64");
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/[\u0000-\u001F]/g, "");
}

function clip(s, n) {
  const t = String(s || "").trim();
  if (t.length <= n) return t;
  return t.slice(0, n - 1) + "…";
}

function logoDataUri() {
  try {
    const buf = fs.readFileSync(LOGO_PATH);
    return "data:image/jpeg;base64," + b64(buf);
  } catch (_) {
    return "";
  }
}

function newToken() {
  return crypto.randomBytes(32).toString("hex");
}

function verifyUrl(siteUrl, token) {
  const base = String(siteUrl || "https://mahomarket.com").replace(/\/+$/, "");
  return base + "/verify/" + token;
}

function ensureCard(user, pepper) {
  if (!user || typeof user !== "object") return null;
  if (!user.customerNo) return null;
  if (user.card && user.card.token && user.card.tokenHash && user.card.status) {
    if (!user.card.wallet) {
      user.card.wallet = { serialNumber: user.customerNo, passTypeId: null };
    }
    user.card.wallet.serialNumber = user.customerNo;
    return user.card;
  }
  const token = newToken();
  user.card = {
    id: "card_" + crypto.randomBytes(6).toString("hex"),
    status: "active",
    token: token,
    tokenHash: hashOpaque(token, pepper),
    previousHashes: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    emailedAt: null,
    wallet: {
      serialNumber: user.customerNo,
      passTypeId: null,
      updatedAt: null,
    },
  };
  return user.card;
}

function replaceToken(user, pepper) {
  const card = ensureCard(user, pepper);
  if (!card) return null;
  if (card.tokenHash) card.previousHashes = (card.previousHashes || []).concat(card.tokenHash).slice(-8);
  const token = newToken();
  card.token = token;
  card.tokenHash = hashOpaque(token, pepper);
  card.status = "active";
  card.updatedAt = Date.now();
  card.replacedAt = Date.now();
  return card;
}

function setStatus(user, status) {
  if (!user || !user.card) return null;
  if (["active", "inactive", "revoked"].indexOf(status) < 0) return null;
  user.card.status = status;
  user.card.updatedAt = Date.now();
  return user.card;
}

function findByToken(db, token, pepper) {
  const hash = hashOpaque(String(token || ""), pepper);
  const users = db.users || [];
  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    if (!u || !u.card) continue;
    if (u.card.tokenHash && u.card.tokenHash === hash) return { user: u, current: true };
    const prev = u.card.previousHashes || [];
    if (prev.indexOf(hash) >= 0) return { user: u, current: false, replaced: true };
  }
  return null;
}

function publicCardStatus(found) {
  if (!found) return null;
  if (!found.current || found.replaced) {
    return { ok: true, status: "revoked", brand: "MAHO", active: false };
  }
  const u = found.user;
  const account = life.stateOf(u);
  let status = (u.card && u.card.status) || "active";
  if (account === "deleted") status = "revoked";
  else if (account !== "active") status = "inactive";
  const showIdentity = status === "active" || status === "inactive";
  return {
    ok: true,
    status: status,
    active: status === "active" && account === "active",
    brand: "MAHO",
    name: showIdentity ? (u.name || "") : "",
    customerNo: showIdentity ? (u.customerNo || "") : "",
  };
}

function staffCardView(found) {
  if (!found || !found.current) {
    return { ok: false, status: "revoked", brand: "MAHO" };
  }
  const u = found.user;
  return {
    ok: true,
    status: u.card.status || "active",
    brand: "MAHO",
    name: u.name || "",
    email: u.email || "",
    phone: u.phone || "",
    customerNo: u.customerNo || "",
    cardId: u.card.id || "",
    createdAt: u.card.createdAt || null,
  };
}

const CARD_W = 1016;
const CARD_H = 638;
const PDF_MM = 72 / 25.4;
const PDF_W = 86 * PDF_MM;
const PDF_H = 54 * PDF_MM;

function barcodeRects(text, x, y, w, h) {
  let modules;
  try { modules = code128.modulesFor(text); } catch (_) { return ""; }
  const quiet = 10;
  const inner = modules.length + quiet * 2;
  const mw = w / inner;
  let cursor = x;
  let run = 0;
  let out = "";
  const paint = () => {
    if (!run) return;
    out += `<rect x="${cursor.toFixed(2)}" y="${y}" width="${(run * mw).toFixed(2)}" height="${h}" fill="#111"/>`;
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

function leaf(cx, cy, rot, scale) {
  const s = scale || 1;
  return `<g transform="translate(${cx} ${cy}) rotate(${rot}) scale(${s})">
    <path d="M0 0 C18 -28 42 -18 36 8 C22 16 8 10 0 0 Z" fill="#f4e7cf" stroke="#c6a56a" stroke-width="1.15"/>
    <path d="M8 -2 C16 -14 28 -10 30 2" fill="none" stroke="#c6a56a" stroke-width="0.8"/>
  </g>`;
}

function botanicals() {
  return `<g fill="none" stroke="#c6a56a" stroke-linecap="round" stroke-linejoin="round">
    <path d="M78 250 C40 210 28 150 70 108" stroke-width="1.2"/>
    <path d="M92 430 C36 400 18 470 54 520 C90 566 40 590 22 560" stroke-width="1.25"/>
    <path d="M120 500 C70 540 90 600 40 620" stroke-width="1.15"/>
    <path d="M860 24 C910 70 980 40 990 96" stroke-width="1.2"/>
    <path d="M900 70 C940 40 990 78 960 110" stroke-width="1.1"/>
    <path d="M930 150 C980 130 1000 190 960 210" stroke-width="1.1"/>
    <path d="M900 560 C960 530 1000 580 970 620" stroke-width="1.2"/>
    <path d="M820 600 C880 640 940 590 980 620" stroke-width="1.15"/>
    ${leaf(64, 150, -20, 0.85)}
    ${leaf(48, 196, 30, 0.7)}
    ${leaf(36, 470, -40, 1.05)}
    ${leaf(70, 530, 15, 0.9)}
    ${leaf(28, 575, -10, 0.75)}
    ${leaf(118, 590, 50, 0.65)}
    ${leaf(930, 48, 25, 0.8)}
    ${leaf(980, 78, -30, 0.7)}
    ${leaf(950, 118, 10, 0.85)}
    ${leaf(990, 168, -15, 0.6)}
    ${leaf(940, 548, 40, 0.9)}
    ${leaf(990, 590, -25, 0.75)}
    <circle cx="972" cy="92" r="3.2" fill="#c6a56a" stroke="none"/>
    <circle cx="948" cy="132" r="2.6" fill="#c6a56a" stroke="none"/>
    <circle cx="986" cy="156" r="2.4" fill="#c6a56a" stroke="none"/>
    <circle cx="46" cy="168" r="2.4" fill="#c6a56a" stroke="none"/>
  </g>`;
}

function goldIcon(cx, cy, kind) {
  const person = `<circle cx="${cx}" cy="${cy - 4}" r="4.2" fill="#fffdf8"/>
    <path d="M${cx - 7} ${cy + 8}c1.2-6 12.8-6 14 0" fill="none" stroke="#fffdf8" stroke-width="1.7" stroke-linecap="round"/>`;
  const card = `<rect x="${cx - 7}" y="${cy - 5}" width="14" height="10" rx="1.4" fill="none" stroke="#fffdf8" stroke-width="1.4"/>
    <path d="M${cx - 7} ${cy - 1.5}h14" stroke="#fffdf8" stroke-width="1.2"/>`;
  const mail = `<rect x="${cx - 7}" y="${cy - 5}" width="14" height="10" rx="1.3" fill="none" stroke="#fffdf8" stroke-width="1.35"/>
    <path d="M${cx - 6.2} ${cy - 3.6} L${cx} ${cy + 0.4} L${cx + 6.2} ${cy - 3.6}" fill="none" stroke="#fffdf8" stroke-width="1.2"/>`;
  const body = kind === "card" ? card : (kind === "mail" ? mail : person);
  return `<circle cx="${cx}" cy="${cy}" r="16" fill="#c8a35f"/>${body}`;
}

async function renderCardSvg(user, siteUrl) {
  const card = user.card;
  const url = verifyUrl(siteUrl, card.token);
  const qr = await QRCode.toBuffer(url, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 0,
    width: 280,
    color: { dark: "#1a1509", light: "#ffffff" },
  });
  const qrUri = "data:image/png;base64," + b64(qr);
  const logo = logoDataUri();
  const name = esc(clip(user.name || "", 42));
  const no = esc(user.customerNo || "");
  const email = esc(clip(user.email || "", 42));
  const logoTag = logo
    ? `<clipPath id="mahoLogoClip"><circle cx="118" cy="112" r="74"/></clipPath>
       <image href="${logo}" x="44" y="38" width="148" height="148" preserveAspectRatio="xMidYMid slice" clip-path="url(#mahoLogoClip)"/>`
    : `<text x="118" y="120" text-anchor="middle" font-size="28" font-family="Tahoma, sans-serif" fill="#c8a35f">MAHO</text>`;
  const bars = barcodeRects(user.customerNo || "", 150, 478, 700, 62);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}">
  <rect width="${CARD_W}" height="${CARD_H}" rx="36" fill="#fffdf8"/>
  <rect x="14" y="14" width="${CARD_W - 28}" height="${CARD_H - 28}" rx="28" fill="none" stroke="#c8a35f" stroke-width="2.4"/>
  ${botanicals()}
  ${logoTag}
  <rect x="214" y="32" width="560" height="168" rx="26" fill="#f4eee4"/>
  <text x="494" y="86" text-anchor="middle" font-family="Tahoma, sans-serif" font-size="40" font-weight="700" fill="#1a1509">کارت مشتری</text>
  <text x="494" y="118" text-anchor="middle" font-family="Tahoma, sans-serif" font-size="18" letter-spacing="3.2" fill="#1a1509">CUSTOMER CARD</text>
  <line x1="330" y1="132" x2="470" y2="132" stroke="#c8a35f" stroke-width="1.4"/>
  <polygon points="494,126 500,132 494,138 488,132" fill="#c8a35f"/>
  <line x1="518" y1="132" x2="658" y2="132" stroke="#c8a35f" stroke-width="1.4"/>
  <text x="494" y="164" text-anchor="middle" font-family="Tahoma, sans-serif" font-size="18" fill="#2c261c">لباس و لوازم بانوان</text>
  <text x="494" y="186" text-anchor="middle" font-family="Tahoma, sans-serif" font-size="11" letter-spacing="1.1" fill="#6d6456">WOMEN'S CLOTHING &amp; ACCESSORIES</text>
  <g font-family="Tahoma, sans-serif">
    ${goldIcon(236, 250, "person")}
    <text x="262" y="232" font-size="12" fill="#6d6456">نام / Name</text>
    <rect x="262" y="238" width="430" height="34" rx="12" fill="#f3eee6"/>
    <text x="276" y="261" font-size="18" font-weight="700" fill="#1a1509">${name}</text>
    ${goldIcon(236, 312, "card")}
    <text x="262" y="294" font-size="12" fill="#6d6456">شماره مشتری / Customer No.</text>
    <rect x="262" y="300" width="430" height="34" rx="12" fill="#f3eee6"/>
    <text x="276" y="323" font-size="18" font-weight="700" fill="#1a1509">${no}</text>
    ${goldIcon(236, 374, "mail")}
    <text x="262" y="356" font-size="12" fill="#6d6456">ایمیل / Email</text>
    <rect x="262" y="362" width="430" height="34" rx="12" fill="#f3eee6"/>
    <text x="276" y="385" font-size="16" fill="#1a1509">${email}</text>
  </g>
  <rect x="748" y="228" width="196" height="196" rx="16" fill="#ffffff" stroke="#c8a35f" stroke-width="2"/>
  <image href="${qrUri}" x="762" y="240" width="168" height="168"/>
  <text x="846" y="444" text-anchor="middle" font-family="Tahoma, sans-serif" font-size="11" fill="#3a3428">Scan to verify customer</text>
  <text x="846" y="460" text-anchor="middle" font-family="Tahoma, sans-serif" font-size="11" fill="#3a3428">برای تأیید مشتری اسکن کنید</text>
  ${bars}
  <text x="500" y="558" text-anchor="middle" font-family="Tahoma, sans-serif" font-size="15" font-weight="700" fill="#1a1509">${no}</text>
  <line x1="70" y1="578" x2="946" y2="578" stroke="#e4d3a8" stroke-width="1"/>
  <circle cx="300" cy="608" r="9" fill="none" stroke="#c8a35f" stroke-width="1.3"/>
  <path d="M300 601.5v4.2M297.2 605.2h5.6" stroke="#c8a35f" stroke-width="1"/>
  <text x="360" y="613" text-anchor="middle" font-family="Tahoma, sans-serif" font-size="14" fill="#3a3428">mahomarket.com</text>
  <line x1="508" y1="596" x2="508" y2="620" stroke="#e4d3a8" stroke-width="1"/>
  <circle cx="620" cy="608" r="9" fill="none" stroke="#c8a35f" stroke-width="1.3"/>
  <path d="M614 608h12M614.5 605.5l5.5 3.2 5.5-3.2" fill="none" stroke="#c8a35f" stroke-width="1"/>
  <text x="730" y="613" text-anchor="middle" font-family="Tahoma, sans-serif" font-size="14" fill="#3a3428">support@mahomarket.com</text>
</svg>`;
}

async function renderCardPng(user, siteUrl) {
  const { Resvg } = require("@resvg/resvg-js");
  const svg = await renderCardSvg(user, siteUrl);
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: CARD_W },
    font: { defaultFontFamily: "Tahoma", sansSerifFamily: "Tahoma" },
  });
  return resvg.render().asPng();
}

async function renderCardPdf(png) {
  const PDFDocument = require("pdfkit");
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [PDF_W, PDF_H], margin: 0 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.image(png, 0, 0, { width: PDF_W, height: PDF_H });
    doc.end();
  });
}

function summary(user) {
  if (!user || !user.card) return null;
  return {
    status: user.card.status || "active",
    createdAt: user.card.createdAt || null,
    updatedAt: user.card.updatedAt || null,
    customerNo: user.customerNo || "",
  };
}

module.exports = {
  ensureCard,
  replaceToken,
  setStatus,
  findByToken,
  publicCardStatus,
  staffCardView,
  renderCardSvg,
  renderCardPng,
  renderCardPdf,
  verifyUrl,
  CARD_W,
  CARD_H,
  PDF_W,
  PDF_H,
  summary,
  LOGO_PATH,
};
