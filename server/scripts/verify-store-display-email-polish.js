#!/usr/bin/env node
"use strict";
/**
 * Focused presentation checks: pickup store display helpers, email polish,
 * product store label format. Safe / no production mutations.
 */
const fs = require("fs");
const path = require("path");
const assert = (c, m) => { if (!c) throw new Error("ASSERT: " + m); };
const ok = (m) => console.log("OK  " + m);

const ROOT = path.join(__dirname, "..", "..");

/* ---- Email polish ---- */
const { buildMailer } = require("../lib/email");
(async () => {
  let html = "";
  const mail = buildMailer({
    sendRaw: async (o) => { html = o.html || ""; return { messageId: "x" }; },
    fromName: "MAHO", fromEmail: "info@mahomarket.com", replyTo: "support@mahomarket.com",
    siteUrl: "https://mahomarket.com", logoUrl: "https://mahomarket.com/icon-192.png",
  });
  const storeA = {
    id: "store_a", name: "MAHO لباس", address: "کارته نو، کابل", phone: "0700111000",
    hours: "۹ تا ۸", mapsUrl: "https://www.google.com/maps?q=34.5,69.1",
  };
  const storeB = {
    id: "store_b", name: "MAHO لباس", address: "شهر نو، هرات", phone: "0700222000",
    hours: "۱۰ تا ۶", mapsUrl: "https://www.google.com/maps?q=34.3,62.2",
  };
  const base = {
    id: "MAHO-200001", date: Date.now(), total: 900, itemsTotal: 1000, discountTotal: 100, deliveryFee: 0,
    payment: "whatsapp", status: "new", lang: "fa",
    items: [{ name: "مانتو بلند مخملی", qty: 1, price: 1000, discount: 10, size: "M", color: "قرمز", image: "/uploads/x.jpg" }],
    customer: { name: "Aida", email: "a@test.com", phone: "0700", address: "آدرس دلیوری مشتری" },
  };
  await mail.orderConfirmation("a@test.com", Object.assign({}, base, {
    delivery: { method: "pickup", storeId: storeA.id }, pickupStore: storeA,
  }), "https://mahomarket.com/#orders", "fa");
  assert(/از خرید شما از MAHO Market سپاسگزاریم/.test(html), "dari thanks");
  assert(/روش دریافت:/.test(html) && /دریافت حضوری/.test(html), "fulfillment in order info");
  assert(/روش پرداخت:/.test(html), "payment in order info");
  assert(html.indexOf("روش دریافت") < html.indexOf("نام محصول"), "order info before products");
  assert(/فروشگاه دریافت:/.test(html) && /کارته نو، کابل/.test(html), "pickup store A");
  assert(/مشاهده در Google Maps/.test(html), "maps link");
  assert(!/آدرس دلیوری مشتری/.test(html), "customer address not as store");
  assert(/نام محصول:/.test(html) && /سایز:/.test(html) && /مجموع:/.test(html), "stacked product fields");
  assert(/جمع اقلام/.test(html) && /مبلغ نهایی/.test(html), "summary labels");
  assert(/https:\/\/mahomarket\.com\/uploads\/x\.jpg/.test(html), "absolute image");
  /* stacked card: image row then details row (mobile-first) */
  assert(/text-align:center/.test(html), "image centered in card");
  ok("order confirmation polish + store A");

  await mail.orderConfirmation("a@test.com", Object.assign({}, base, {
    delivery: { method: "pickup", storeId: storeB.id }, pickupStore: storeB,
  }), "https://mahomarket.com/#orders", "fa");
  assert(/شهر نو، هرات/.test(html) && !/کارته نو، کابل/.test(html), "exact store B only");
  ok("pickup email uses exact selected store");

  await mail.orderConfirmation("a@test.com", Object.assign({}, base, {
    delivery: { method: "deliver" }, pickupStore: null,
  }), "https://mahomarket.com/#orders", "fa");
  assert(!/فروشگاه دریافت:/.test(html), "delivery has no pickup store block");
  assert(/آدرس دلیوری/.test(html), "delivery shows customer address");
  ok("delivery orders unaffected");

  await mail.pickupReady("a@test.com", Object.assign({}, base, {
    delivery: { method: "pickup" }, pickupStore: storeA, status: "dispatched",
  }), storeA, "fa");
  assert(/آماده دریافت/.test(html) && /فروشگاه دریافت:/.test(html), "pickup ready store block");
  assert(/Google Maps/.test(html), "pickup ready maps");
  ok("pickupReady polish");

  /* Static UI markers */
  const mainJs = fs.readFileSync(path.join(ROOT, "website", "js", "main.js"), "utf8");
  assert(/pickupStoreBlockHtml/.test(mainJs) && /orders\.pickupStore/.test(mainJs), "customer My Orders pickup block");
  assert(/order\.pickupStore/.test(mainJs) || /o\.pickupStore/.test(mainJs), "uses order.pickupStore");
  const admin = fs.readFileSync(path.join(ROOT, "website", "admin.html"), "utf8");
  assert(/فروشگاه دریافت:/.test(admin) && /o\.pickupStore/.test(admin), "admin Orders pickup block");
  assert(/shortAddr/.test(admin) && /s\.address\|\|s\.area/.test(admin), "product store label uses address");
  assert(/data-store-id/.test(admin), "store assignment checkboxes preserved");
  ok("static UI markers");

  console.log("\nALL PRESENTATION CHECKS PASSED");
})().catch((e) => {
  console.error("FAIL", e && e.stack || e);
  process.exit(1);
});
