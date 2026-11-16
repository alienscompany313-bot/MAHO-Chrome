"use strict";

const { Resvg } = require("@resvg/resvg-js");

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(n) {
  const value = Math.round(Number(n) || 0);
  return value.toLocaleString("en-US") + " AFN";
}

function maskPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 4) return "";
  return "…" + digits.slice(-4);
}

function lineTotal(item) {
  if (item && item.lineTotal != null && isFinite(Number(item.lineTotal))) return Number(item.lineTotal);
  return (Number(item && item.price) || 0) * (Number(item && item.qty) || 1);
}

function ownsOrder(order, session) {
  if (!order || !session || session.type !== "user") return false;
  return String(order.userId || "") === String(session.userId || "");
}

function buildReceiptSvg(order) {
  const lang = String(order.lang || "fa").toLowerCase().indexOf("en") === 0 ? "en" : "fa";
  const en = lang === "en";
  const customer = order.customer || {};
  const snap = order.discountSnapshot || {};
  const code = snap.replacedByCoupon || snap.name || "";
  const reason = order.discountMessage || snap.name || "";
  const discount = Number(order.discountTotal) || 0;
  const items = (order.items || []).slice(0, 24);
  const rows = items.map((item, index) => {
    const y = 280 + index * 36;
    const name = en ? (item.name_en || item.name || "") : (item.name || item.name_en || "");
    return `<text x="740" y="${y}" text-anchor="end" font-family="Tahoma, sans-serif" font-size="16" fill="#1a1509">${esc(name).slice(0, 42)}</text>
      <text x="430" y="${y}" text-anchor="end" font-family="Tahoma, sans-serif" font-size="16" fill="#1a1509">${esc(item.qty || 1)}</text>
      <text x="80" y="${y}" font-family="Tahoma, sans-serif" font-size="16" fill="#1a1509">${esc(money(lineTotal(item)))}</text>`;
  }).join("");
  const height = 340 + items.length * 36 + (discount > 0 ? 90 : 50);
  const when = order.date ? new Date(order.date).toISOString().slice(0, 10) : "";
  const city = (customer.addr && (customer.addr.city || customer.addr.area)) || "";
  const method = (order.delivery && order.delivery.method) || "";
  const discountLine = discount > 0
    ? `<text x="740" y="${height - 78}" text-anchor="end" font-family="Tahoma, sans-serif" font-size="16" fill="#8a6420">${esc((en ? "Discount" : "تخفیف") + (code ? " " + code : "") + (reason && reason !== code ? " — " + reason : ""))}</text>
       <text x="80" y="${height - 78}" font-family="Tahoma, sans-serif" font-size="16" fill="#8a6420">${esc("− " + money(discount))}</text>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="820" height="${height}" viewBox="0 0 820 ${height}">
  <rect width="820" height="${height}" fill="#fffdf8"/>
  <rect x="0" y="0" width="820" height="92" fill="#14110c"/>
  <circle cx="70" cy="46" r="24" fill="none" stroke="#c8a35f" stroke-width="3"/>
  <text x="70" y="54" text-anchor="middle" font-family="Georgia, serif" font-size="22" fill="#c8a35f">M</text>
  <text x="760" y="42" text-anchor="end" font-family="Tahoma, sans-serif" font-size="26" font-weight="700" fill="#f4efe6">MAHO MARKET</text>
  <text x="760" y="70" text-anchor="end" font-family="Tahoma, sans-serif" font-size="16" fill="#e8d3a3">${en ? "Customer receipt" : "رسید مشتری"}</text>
  <text x="760" y="140" text-anchor="end" font-family="Tahoma, sans-serif" font-size="18" fill="#1a1509">${esc((en ? "Order" : "سفارش") + " " + (order.id || ""))}</text>
  <text x="760" y="168" text-anchor="end" font-family="Tahoma, sans-serif" font-size="15" fill="#5c5346">${esc(when)}</text>
  <text x="760" y="196" text-anchor="end" font-family="Tahoma, sans-serif" font-size="15" fill="#1a1509">${esc(customer.name || "")}</text>
  <text x="760" y="220" text-anchor="end" font-family="Tahoma, sans-serif" font-size="15" fill="#5c5346">${esc([maskPhone(customer.phone), city, method].filter(Boolean).join(" · "))}</text>
  ${rows}
  ${discountLine}
  <text x="740" y="${height - 40}" text-anchor="end" font-family="Tahoma, sans-serif" font-size="22" font-weight="700" fill="#1a1509">${en ? "Total" : "مبلغ نهایی"}</text>
  <text x="80" y="${height - 40}" font-family="Tahoma, sans-serif" font-size="22" font-weight="700" fill="#1a1509">${esc(money(order.total))}</text>
</svg>`;
}

async function buildReceiptPdf(order) {
  const PNG = new Resvg(buildReceiptSvg(order), {
    fitTo: { mode: "width", value: 900 },
    font: { defaultFontFamily: "Tahoma", sansSerifFamily: "Tahoma" },
  }).render().asPng();
  const PDFDocument = require("pdfkit");
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 24 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.image(PNG, 24, 24, { width: 547 });
    doc.end();
  });
}

module.exports = { ownsOrder, buildReceiptPdf, buildReceiptSvg };
