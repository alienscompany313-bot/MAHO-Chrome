#!/usr/bin/env node
"use strict";
/**
 * Hotfix regression: email double-discount, RTL copy, maps profile URL priority,
 * compact store selector markers. Isolated / no production mutations.
 */
const fs = require("fs");
const path = require("path");
const assert = (c, m) => { if (!c) throw new Error("ASSERT: " + m); };
const ok = (m) => console.log("OK  " + m);

const ROOT = path.join(__dirname, "..", "..");
const { resolveStoreMapsUrl, isRawCoordMapsUrl } = require("../lib/geo");
const { resolvePickupStore } = require("../lib/store-inventory");
const { buildMailer } = require("../lib/email");

(async () => {
  /* ---- A. Email price: 2000 → 10% → 1800 (no 1620) ---- */
  let html = "";
  const mail = buildMailer({
    sendRaw: async (o) => { html = o.html || ""; return { messageId: "x" }; },
    fromName: "MAHO", fromEmail: "info@mahomarket.com", replyTo: "support@mahomarket.com",
    siteUrl: "https://mahomarket.com", logoUrl: "https://mahomarket.com/icon-192.png",
  });

  const orderDiscounted = {
    id: "MAHO-HOTFIX-1",
    date: Date.now(),
    total: 1800,
    itemsTotal: 1800,
    discountTotal: 0,
    deliveryFee: 0,
    payment: "whatsapp",
    status: "new",
    lang: "fa",
    /* Production checkout stores charged unit in `price`, original in `listPrice`. */
    items: [{
      name: "محصول تست تخفیف",
      qty: 1,
      price: 1800,
      listPrice: 2000,
      discount: 10,
      size: "M",
      color: "مشکی",
      image: "/uploads/x.jpg",
    }],
    customer: { name: "Aida Test", email: "a@test.com", phone: "0700111222", address: "آدرس مشتری" },
    delivery: { method: "deliver" },
  };

  await mail.orderConfirmation("a@test.com", orderDiscounted, "https://mahomarket.com/#orders", "fa");
  assert(/1,800/.test(html) || /1800/.test(html), "email shows 1800");
  assert(/مبلغ نهایی[\s\S]*1,800|مبلغ نهایی[\s\S]*1800/.test(html), "grand total 1800");
  assert(/مجموع:[\s\S]*1,800|مجموع:[\s\S]*1800/.test(html), "line total 1800");
  assert(!/1,620/.test(html) && !/>1620</.test(html) && !/1620 افغانی/.test(html), "1620 absent");
  assert(/2,000|2000/.test(html), "original 2000 visible when listPrice present");
  assert(/10٪|10%/.test(html), "discount percent shown");
  ok("A email discount 2000→10%→1800 (no 1620)");

  /* lineTotal authoritative when present */
  await mail.orderConfirmation("a@test.com", Object.assign({}, orderDiscounted, {
    items: [{ name: "X", qty: 2, price: 1800, listPrice: 2000, discount: 10, lineTotal: 3600 }],
    itemsTotal: 3600,
    total: 3600,
  }), "https://mahomarket.com/#orders", "fa");
  assert(/3,600|3600/.test(html) && !/3,240|3240/.test(html), "lineTotal used directly");
  ok("A lineTotal preferred over recomputation");

  /* ---- B. Email RTL copy ---- */
  await mail.orderConfirmation("a@test.com", orderDiscounted, "https://mahomarket.com/#orders", "fa");
  assert(/از خرید شما سپاسگزاریم/.test(html), "natural thanks without brand in sentence");
  assert(!/از خرید شما از MAHO Market سپاسگزاریم/.test(html), "awkward brand phrase removed");
  assert(/dir="rtl"/.test(html), "html dir=rtl");
  assert(/text-align:right/.test(html), "right align present");
  assert(/سلام[\s\S]*Aida Test/.test(html), "greeting with name");
  assert(/سفارش شما با موفقیت ثبت شد و در حال بررسی است/.test(html), "placed copy");
  ok("B email RTL copy");

  /* ---- D. Google Maps profile priority ---- */
  const profileUrl = "https://maps.app.goo.gl/AbCdEfGhIjKlMnOp";
  const coordUrl = "https://www.google.com/maps?q=34.5116%2C69.1205";
  assert(isRawCoordMapsUrl(coordUrl), "coord URL detected");
  assert(!isRawCoordMapsUrl(profileUrl), "profile URL not coord-only");

  const withProfile = resolveStoreMapsUrl({
    lat: 34.5116, lng: 69.1205, map: profileUrl, mapsUrl: coordUrl,
  });
  assert(withProfile === profileUrl, "profile beats coords");

  const coordInMapField = resolveStoreMapsUrl({
    lat: 34.5116, lng: 69.1205, map: coordUrl,
  });
  assert(isRawCoordMapsUrl(coordUrl), "prod-like coord map detected");
  assert(/maps\?q=34\.5116/.test(coordInMapField), "coord stored in map falls through to lat/lng — not treated as profile");
  assert(coordInMapField !== profileUrl, "does not invent profile");

  const fallback = resolveStoreMapsUrl({ lat: 34.5, lng: 69.1 });
  assert(/maps\?q=34\.5/.test(fallback), "lat/lng fallback when no profile");

  const db = {
    stores: [{
      id: "store_p",
      name: "MAHO لباس",
      area: "مبارک سنتر",
      lat: 34.5116,
      lng: 69.1205,
      map: profileUrl,
      phone: "0700",
    }],
  };
  const snap = resolvePickupStore(db, "store_p");
  assert(snap.mapsUrl === profileUrl, "resolvePickupStore prefers profile");
  assert(snap.map === profileUrl, "snapshot keeps map field");

  const noProfile = resolvePickupStore({
    stores: [{ id: "store_c", name: "C", lat: 34.1, lng: 69.2 }],
  }, "store_c");
  assert(/maps\?q=34\.1/.test(noProfile.mapsUrl), "coord fallback without profile");

  await mail.orderConfirmation("a@test.com", Object.assign({}, orderDiscounted, {
    delivery: { method: "pickup", storeId: "store_p" },
    pickupStore: {
      id: "store_p", name: "MAHO لباس", address: "مبارک سنتر", phone: "0700",
      lat: 34.5116, lng: 69.1205, map: profileUrl, mapsUrl: coordUrl,
    },
  }), "https://mahomarket.com/#orders", "fa");
  assert(html.indexOf(profileUrl) >= 0, "email uses profile URL");
  assert(html.indexOf(coordUrl) < 0, "email does not use coord URL when profile exists");
  assert(/مشاهده فروشگاه در/.test(html) && /Google Maps/.test(html), "maps button label");
  assert(/rel="noopener noreferrer"/.test(html), "noopener noreferrer");
  ok("D maps profile URL priority");

  /* ---- C. Store selector compact layout markers ---- */
  const admin = fs.readFileSync(path.join(ROOT, "website", "admin.html"), "utf8");
  assert(/#f_storeIds\s*\{[^}]*display:\s*block/.test(admin), "store list block full width");
  assert(/store-pick-row/.test(admin) && /store-pick-id/.test(admin), "store row markers");
  assert(/white-space:\s*normal/.test(admin) && /overflow-wrap:\s*break-word/.test(admin), "normal wrapping");
  assert(/لینک پروفایل فروشگاه در Google Maps/.test(admin), "admin maps profile field label");
  assert(/مشاهده فروشگاه در Google Maps/.test(admin), "admin orders maps label");
  assert(/data-store-id/.test(admin) && /f_storeAll/.test(admin), "assignment controls preserved");
  ok("C store selector compact markers");

  const mainJs = fs.readFileSync(path.join(ROOT, "website", "js", "main.js"), "utf8");
  assert(/resolveOrderStoreMapsUrl/.test(mainJs), "customer maps resolver");
  assert(/مشاهده فروشگاه در Google Maps/.test(mainJs), "customer maps label");
  assert(/googleMapsUrl|mapUrl|store\.map/.test(mainJs), "customer prefers profile fields");
  ok("C/D customer My Orders maps markers");

  console.log("\nALL HOTFIX CHECKS PASSED");
})().catch((e) => {
  console.error("FAIL", e && e.stack || e);
  process.exit(1);
});
