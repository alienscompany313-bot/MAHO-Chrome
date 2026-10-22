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
    return { ok: true, status: "revoked", brand: "MAHO" };
  }
  const status = found.user.card.status || "active";
  return { ok: true, status: status, brand: "MAHO" };
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

async function renderCardSvg(user, siteUrl) {
  const card = user.card;
  const url = verifyUrl(siteUrl, card.token);
  const qr = await QRCode.toBuffer(url, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 280,
    color: { dark: "#1a1509", light: "#ffffff" },
  });
  const qrUri = "data:image/png;base64," + b64(qr);
  const logo = logoDataUri();
  const name = esc(clip(user.name || "", 42));
  const no = esc(user.customerNo || "");
  const email = esc(clip(user.email || "", 42));
  const logoTag = logo
    ? `<image href="${logo}" x="28" y="78" width="360" height="360" preserveAspectRatio="xMidYMid meet"/>`
    : `<text x="208" y="270" text-anchor="middle" font-size="42" font-family="Tahoma, sans-serif" fill="#c8a35f">MAHO</text>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="640" viewBox="0 0 1100 640">
  <rect width="1100" height="640" fill="#f7f3ea"/>
  <rect x="18" y="18" width="1064" height="604" rx="28" fill="#fffdf8" stroke="#c8a35f" stroke-width="3"/>
  <path d="M70 90c20 30 18 58-8 78" fill="none" stroke="#e4d3a8" stroke-width="1.4" opacity="0.9"/>
  <path d="M1020 520c-24-20-30-48-10-74" fill="none" stroke="#e4d3a8" stroke-width="1.4" opacity="0.9"/>
  ${logoTag}
  <rect x="400" y="46" width="460" height="168" rx="22" fill="#f6f1e6"/>
  <text x="630" y="108" text-anchor="middle" font-family="Tahoma, sans-serif" font-size="40" font-weight="700" fill="#1a1509">کارت مشتری</text>
  <text x="630" y="146" text-anchor="middle" font-family="Tahoma, sans-serif" font-size="18" letter-spacing="3" fill="#1a1509">CUSTOMER CARD</text>
  <text x="630" y="176" text-anchor="middle" font-family="Tahoma, sans-serif" font-size="16" fill="#3a3428">لباس و لوازم بانوان</text>
  <text x="630" y="198" text-anchor="middle" font-family="Tahoma, sans-serif" font-size="12" letter-spacing="1.2" fill="#6d6456">WOMEN'S CLOTHING &amp; ACCESSORIES</text>
  <g font-family="Tahoma, sans-serif" fill="#1a1509">
    <circle cx="418" cy="278" r="14" fill="#c8a35f"/>
    <text x="444" y="258" font-size="12" fill="#6d6456">نام / Name</text>
    <rect x="444" y="266" width="390" height="34" rx="10" fill="#f4efe4"/>
    <text x="458" y="289" font-size="18" font-weight="700">${name}</text>
    <circle cx="418" cy="352" r="14" fill="#c8a35f"/>
    <text x="444" y="332" font-size="12" fill="#6d6456">شماره مشتری / Customer No.</text>
    <rect x="444" y="340" width="390" height="34" rx="10" fill="#f4efe4"/>
    <text x="458" y="363" font-size="18" font-weight="700">${no}</text>
    <circle cx="418" cy="426" r="14" fill="#c8a35f"/>
    <text x="444" y="406" font-size="12" fill="#6d6456">ایمیل / Email</text>
    <rect x="444" y="414" width="390" height="34" rx="10" fill="#f4efe4"/>
    <text x="458" y="437" font-size="16">${email}</text>
  </g>
  <rect x="860" y="250" width="188" height="188" rx="16" fill="#ffffff" stroke="#c8a35f" stroke-width="3"/>
  <image href="${qrUri}" x="872" y="262" width="164" height="164"/>
  <text x="954" y="462" text-anchor="middle" font-family="Tahoma, sans-serif" font-size="12" fill="#3a3428">Scan to verify customer</text>
  <text x="954" y="482" text-anchor="middle" font-family="Tahoma, sans-serif" font-size="12" fill="#3a3428">برای تأیید مشتری اسکن کنید</text>
</svg>`;
}

async function renderCardPng(user, siteUrl) {
  const { Resvg } = require("@resvg/resvg-js");
  const svg = await renderCardSvg(user, siteUrl);
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: 1100 },
    font: { defaultFontFamily: "Tahoma", sansSerifFamily: "Tahoma" },
  });
  return resvg.render().asPng();
}

async function renderCardPdf(png) {
  const PDFDocument = require("pdfkit");
  const width = 540;
  const height = Math.round(width * (640 / 1100));
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [width, height], margin: 0 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.image(png, 0, 0, { width: width, height: height });
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
  renderCardPng,
  renderCardPdf,
  verifyUrl,
  summary,
  LOGO_PATH,
};
