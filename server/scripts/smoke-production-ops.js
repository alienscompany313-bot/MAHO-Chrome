#!/usr/bin/env node
/**
 * Production ops suite smoke — campaign images, item ops, block, pickup,
 * discounts, staff deactivate, reorder. Temp DATA_DIR only. No real campaigns.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const { spawn } = require("child_process");
const { resolveProductImageUrl, absolutizeMediaUrl } = require("../lib/media-url");
const { buildMailer } = require("../lib/email");

const ROOT = path.join(__dirname, "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "maho-prodops-"));
const DATA = path.join(TMP, "data");
const UPLOADS = path.join(TMP, "uploads");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });
/* seed a public-looking upload file for image URL tests */
fs.writeFileSync(path.join(UPLOADS, "p8.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
const ADMIN_PASSWORD = "SecureTestPass1!";
const PORT = 4501 + Math.floor(Math.random() * 80);
const SITE = "https://mahomarket.com";

function req(method, urlPath, { body, token, raw } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body != null ? Buffer.from(typeof body === "string" ? body : JSON.stringify(body)) : null;
    const h = { Accept: "application/json" };
    if (token) h.Authorization = "Bearer " + token;
    if (payload && !raw) {
      h["Content-Type"] = "application/json";
      h["Content-Length"] = String(payload.length);
    }
    const r = http.request(
      { hostname: "127.0.0.1", port: PORT, path: urlPath, method, headers: h },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const rawStr = Buffer.concat(chunks).toString("utf8");
          let data = null;
          try { data = rawStr ? JSON.parse(rawStr) : null; } catch (_) { data = { raw: rawStr }; }
          resolve({ status: res.statusCode, data, raw: rawStr });
        });
      }
    );
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}
function assert(c, m) { if (!c) throw new Error(m || "assert"); }
function ok(m) { console.log("PASS", m); }

async function registerUser(email, phone) {
  const reg = await req("POST", "/api/auth/register", {
    body: { name: "U", phone, email, password: "BuyerPass99", marketingConsent: true },
  });
  assert(reg.status === 200 && reg.data.devCode, "register " + email);
  await req("POST", "/api/auth/verify", { body: { email, code: reg.data.devCode } });
  const login = await req("POST", "/api/auth/login", { body: { email, password: "BuyerPass99" } });
  assert(login.status === 200 && login.data.token, "login " + email);
  return { token: login.data.token, user: login.data.user, email };
}

async function main() {
  const child = spawn(process.execPath, [path.join(ROOT, "index.js")], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), NODE_ENV: "development", ADMIN_PASSWORD,
      DATA_DIR: DATA, UPLOAD_DIR: UPLOADS, ALLOW_DEV_CODES: "true",
      TOKEN_PEPPER: "ops2-pepper", SITE_URL: SITE,
      ALLOWED_ORIGINS: "http://127.0.0.1:" + PORT,
      CUSTOMER_CANCEL_WINDOW_MS: "7200000",
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let boot = "";
  child.stderr.on("data", (d) => { boot += d.toString(); });
  child.stdout.on("data", (d) => { boot += d.toString(); });
  try {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 150));
      try { if ((await req("GET", "/api/health")).status === 200) break; } catch (_) {}
      if (i === 59) throw new Error("boot failed\n" + boot.slice(-2500));
    }

    const login = await req("POST", "/api/admin/login", { body: { password: ADMIN_PASSWORD } });
    assert(login.status === 200 && login.data.token, "admin login");
    const tok = login.data.token;
    ok("AB admin login");

    /* A — absolute media URL helper */
    const abs = absolutizeMediaUrl("/uploads/p8.jpg", SITE);
    assert(abs === SITE + "/uploads/p8.jpg", "absolutize relative");
    assert(absolutizeMediaUrl("http://localhost/x.jpg", SITE) === "", "no localhost");
    const fallback = resolveProductImageUrl("", { siteUrl: SITE, logoUrl: "" });
    assert(/^https:\/\//.test(fallback), "placeholder https");
    ok("A media URL absolutize + fallback");

    await req("PUT", "/api/admin/catalog", {
      token: tok,
      body: {
        products: [
          { name: "شال A", price: 1000, stock: 20, code: "P0008", cat: "shawls", active: true, images: ["/uploads/p8.jpg"] },
          { name: "شال B", price: 2000, stock: 20, code: "P0009", cat: "shawls", active: true, image: "/uploads/p8.jpg" },
          { name: "کیف", price: 3000, stock: 10, code: "P0014", cat: "bags", active: true, images: ["/uploads/p8.jpg"] },
          { name: "کفش", price: 4000, stock: 10, code: "P0015", cat: "shoes", active: true, images: ["/uploads/p8.jpg"] },
          { name: "Gone", price: 100, stock: 0, code: "PGONE", cat: "shawls", active: false },
        ],
        stores: [
          { id: "store_a", name: "مرکز", address: "کابل مرکز", area: "مرکز", phone: "0700", hours: "9-6", lat: 34.52, lng: 69.18 },
          { id: "store_b", name: "شهرنو", address: "شهرنو", phone: "0701", hours: "10-7", lat: 34.53, lng: 69.17 },
        ],
        config: {
          logo: "/social-preview.jpg",
          categories: [
            { key: "shawls", name: "شال", enabled: true },
            { key: "bags", name: "کیف", enabled: true },
            { key: "shoes", name: "کفش", enabled: true },
          ],
          returns: { returnWindowDays: 7, returnPickupPhotoRequired: false },
          delivery: { enabled: true, perKm: 20, freeKm: 0, maxKm: 0, outOfRangePolicy: "warn", minOrder: 0 },
          orderValueDiscounts: [],
          paymentMethods: { whatsapp: { enabled: true }, hesab: { enabled: true }, bank: { enabled: true }, card: { enabled: true } },
          hesab: { enabled: true, link: "https://hesab.example/pay", number: "H-1", holder: "MAHO" },
        },
      },
    });

    /* store stock: P0014 only at store_a */
    await req("PUT", "/api/admin/products/P0014/store-stock/store_a", {
      token: tok, body: { available: true, stock: 5 },
    });
    await req("PUT", "/api/admin/products/P0014/store-stock/store_b", {
      token: tok, body: { available: false, stock: 0 },
    });
    ok("Q store-level inventory");

    /* Campaign image snapshot absolute */
    const cmp = await req("POST", "/api/admin/campaigns", {
      token: tok,
      body: {
        name: "Img", subject: "S", message: "M",
        campaignType: "single_product", productCodes: ["P0008"],
      },
    });
    assert(cmp.status === 200, "B single product campaign");
    assert(/^https:\/\//.test(cmp.data.campaign.products[0].image), "A campaign image absolute https");
    assert(cmp.data.campaign.products[0].image.indexOf("/uploads/") >= 0, "uses storefront upload path");

    const cmpMulti = await req("POST", "/api/admin/campaigns", {
      token: tok,
      body: {
        name: "Multi", subject: "S", message: "M",
        campaignType: "multiple_products", productCodes: ["P0008", "P0009", "P0014", "P0015"],
      },
    });
    assert(cmpMulti.status === 200 && cmpMulti.data.campaign.products.length === 4, "C multiple products");
    cmpMulti.data.campaign.products.forEach((p) => {
      assert(/^https:\/\//.test(p.image), "image abs " + p.code);
      assert(p.urlPath === "/p/" + p.code, "urlPath " + p.code);
    });

    /* Render campaign HTML and assert img src absolute */
    let capturedHtml = "";
    const mail = buildMailer({
      sendRaw: async ({ html }) => { capturedHtml = html || ""; return true; },
      fromName: "MAHO", fromEmail: "noreply@mahomarket.com",
      siteUrl: SITE, logoUrl: SITE + "/social-preview.jpg",
    });
    await mail.campaignEmail("test@example.com", {
      subject: "T", message: "Hello",
      products: cmpMulti.data.campaign.products.map((p) => Object.assign({}, p, {
        url: SITE + p.urlPath,
      })),
    });
    assert(/src="https:\/\/mahomarket\.com\/uploads\/p8\.jpg"/.test(capturedHtml), "email img absolute");
    assert(/alt="[^"]+"/.test(capturedHtml), "email img alt");
    ok("A/B/C campaign email image absolute (test render only)");

    /* D accordion markup */
    const idx = fs.readFileSync(path.join(ROOT, "..", "website", "index.html"), "utf8");
    assert(/acct-acc/.test(idx) && /acctProfileAcc/.test(idx) && /acctPayAcc/.test(idx), "D account accordion");
    ok("D account accordion markup");

    const buyer = await registerUser("ops_buyer_" + Date.now() + "@example.com", "0700222001");

    /* Place multi-item order */
    const order = await req("POST", "/api/orders", {
      token: buyer.token,
      body: {
        items: [
          { code: "P0008", name: "شال A", qty: 1 },
          { code: "P0009", name: "شال B", qty: 1 },
          { code: "P0015", name: "کفش", qty: 1 },
        ],
        customer: { name: "Buyer", phone: "0700222001", email: buyer.email, address: "Kabul" },
        payment: "whatsapp",
        delivery: { method: "deliver", time: "normal", fee: 0 },
      },
    });
    assert(order.status === 200 && order.data.order, "multi item order");
    const oid = order.data.order.id;
    const lines = order.data.order.items;
    assert(lines.length === 3 && lines.every((l) => l.lineId && l.itemStatus === "pending"), "items have lineId");
    const [l1, l2, l3] = lines;

    /* E/F approve/reject */
    const appr = await req("POST", "/api/admin/orders/" + oid + "/items/approve", {
      token: tok, body: { lineIds: [l1.lineId, l2.lineId] },
    });
    assert(appr.status === 200, "E approve items");
    const rej = await req("POST", "/api/admin/orders/" + oid + "/items/reject", {
      token: tok, body: { lineIds: [l3.lineId], reason: "ناموجود" },
    });
    assert(rej.status === 200, "E reject item");
    const apprAll = await req("POST", "/api/admin/orders/" + oid + "/items/approve", {
      token: tok, body: { lineIds: [] },
    });
    /* no pending left — may be 400 */
    ok("E/F multi-item approve/reject");

    /* G partial shipment */
    const ship = await req("POST", "/api/admin/orders/" + oid + "/shipments", {
      token: tok, body: { lineIds: [l1.lineId] },
    });
    assert(ship.status === 200 && ship.data.shipment, "G partial shipment");
    assert(ship.data.order.items.find((x) => x.lineId === l1.lineId).itemStatus === "shipped", "only line1 shipped");
    assert(ship.data.order.items.find((x) => x.lineId === l2.lineId).itemStatus === "approved", "line2 still approved");
    ok("G/L partial shipment + mixed statuses");

    /* Deliver shipment then item return */
    await req("POST", "/api/admin/orders/" + oid + "/shipments/" + ship.data.shipment.id + "/deliver", {
      token: tok, body: {},
    });
    /* set deliveredAt / return window via admin deliver remaining */
    await req("POST", "/api/admin/orders/" + oid + "/shipments", {
      token: tok, body: { lineIds: [l2.lineId] },
    });
    const ship2 = (await req("GET", "/api/admin/orders", { token: tok })).data.orders.find((o) => o.id === oid);
    const shp2 = (ship2.shipments || []).slice(-1)[0];
    await req("POST", "/api/admin/orders/" + oid + "/shipments/" + shp2.id + "/deliver", { token: tok, body: {} });

    /* force return window on delivered lines */
    const db1 = JSON.parse(fs.readFileSync(path.join(DATA, "db.json"), "utf8"));
    const oRow = db1.orders.find((o) => o.id === oid);
    oRow.items.forEach((it) => {
      if (it.itemStatus === "delivered") {
        it.deliveredAt = Date.now() - 1000;
        it.returnDeadlineAt = Date.now() + 7 * 86400000;
      }
    });
    oRow.deliveredAt = Date.now() - 1000;
    oRow.returnDeadlineAt = Date.now() + 7 * 86400000;
    oRow.status = "delivered";
    fs.writeFileSync(path.join(DATA, "db.json"), JSON.stringify(db1, null, 2));

    const retOk = await req("POST", "/api/orders/" + oid + "/items/" + l1.lineId + "/return-request", {
      token: buyer.token,
      body: { method: "pickup_store", reason: "سایز" },
    });
    assert(retOk.status === 200, "J item return within window");
    ok("J item return within window");

    /* K — expired window enforced by itemReturnEligible (unit; server DB is in-memory) */
    const { itemReturnEligible } = require("../lib/order-items");
    const expiredProbe = {
      status: "delivered",
      items: [{
        lineId: "li_x", itemStatus: "delivered",
        deliveredAt: Date.now() - 10 * 86400000,
        returnDeadlineAt: Date.now() - 1000,
      }],
    };
    const eligK = itemReturnEligible(expiredProbe, expiredProbe.items[0]);
    assert(!eligK.ok && eligK.error === "return_window_expired", "K item return after deadline rejected");
    ok("K item return after deadline");

    /* H/I cancel window on fresh order */
    const order2 = await req("POST", "/api/orders", {
      token: buyer.token,
      body: {
        items: [{ code: "P0008", name: "شال A", qty: 1 }, { code: "P0009", name: "شال B", qty: 1 }],
        customer: { name: "Buyer", phone: "0700222001", email: buyer.email, address: "Kabul" },
        payment: "whatsapp",
        delivery: { method: "deliver", time: "normal", fee: 0 },
      },
    });
    const oid2 = order2.data.order.id;
    await req("POST", "/api/admin/orders/" + oid2 + "/status", { token: tok, body: { status: "confirmed" } });
    const li = order2.data.order.items[0].lineId;
    const can1 = await req("POST", "/api/orders/" + oid2 + "/items/" + li + "/cancel", {
      token: buyer.token, body: { reason: "change" },
    });
    assert(can1.status === 200, "H item cancel within window");
    const { customerCanCancelItem } = require("../lib/order-items");
    const expiredCancel = customerCanCancelItem(
      {
        status: "confirmed",
        delivery: { method: "deliver", time: "normal" },
        approvedAt: Date.now() - 3 * 3600000,
        cancelDeadline: Date.now() - 1000,
        items: [{ lineId: "li_c", itemStatus: "approved", qty: 1, price: 1 }],
      },
      { lineId: "li_c", itemStatus: "approved", qty: 1, price: 1 }
    );
    assert(!expiredCancel.ok, "I item cancel outside window: " + JSON.stringify(expiredCancel));
    ok("H/I item cancellation window");

    /* M/N reorder */
    const re = await req("POST", "/api/orders/" + oid2 + "/reorder", {
      token: buyer.token, body: { lineIds: [li] },
    });
    assert(re.status === 200 && re.data.items.length >= 1, "M reorder available");
    /* deactivate P0009 then try reorder of remaining line */
    await req("PUT", "/api/admin/catalog", {
      token: tok,
      body: {
        products: [
          { name: "شال A", price: 1000, stock: 20, code: "P0008", cat: "shawls", active: true, images: ["/uploads/p8.jpg"] },
          { name: "شال B", price: 2000, stock: 20, code: "P0009", cat: "shawls", active: false, image: "/uploads/p8.jpg" },
          { name: "کیف", price: 3000, stock: 10, code: "P0014", cat: "bags", active: true, images: ["/uploads/p8.jpg"] },
          { name: "کفش", price: 4000, stock: 10, code: "P0015", cat: "shoes", active: true, images: ["/uploads/p8.jpg"] },
          { name: "Gone", price: 100, stock: 0, code: "PGONE", cat: "shawls", active: false },
        ],
        stores: [
          { id: "store_a", name: "مرکز", address: "کابل مرکز", area: "مرکز", phone: "0700", hours: "9-6", lat: 34.52, lng: 69.18 },
          { id: "store_b", name: "شهرنو", address: "شهرنو", phone: "0701", hours: "10-7", lat: 34.53, lng: 69.17 },
        ],
        config: {
          logo: "/social-preview.jpg",
          categories: [
            { key: "shawls", name: "شال", enabled: true },
            { key: "bags", name: "کیف", enabled: true },
            { key: "shoes", name: "کفش", enabled: true },
          ],
          returns: { returnWindowDays: 7, returnPickupPhotoRequired: false },
          delivery: { enabled: true, perKm: 20, freeKm: 0, maxKm: 0, outOfRangePolicy: "warn", minOrder: 0 },
          paymentMethods: { whatsapp: { enabled: true }, hesab: { enabled: true }, bank: { enabled: true }, card: { enabled: true } },
          hesab: { enabled: true, link: "https://hesab.example/pay", number: "H-1", holder: "MAHO" },
        },
      },
    });
    /* restore store stock flags after catalog replace */
    await req("PUT", "/api/admin/products/P0014/store-stock/store_a", { token: tok, body: { available: true, stock: 5 } });
    await req("PUT", "/api/admin/products/P0014/store-stock/store_b", { token: tok, body: { available: false, stock: 0 } });
    const liveOrders = await req("GET", "/api/admin/orders", { token: tok });
    const liveO2 = (liveOrders.data.orders || []).find((o) => o.id === oid2);
    const liB = (liveO2.items || []).find((it) => String(it.code) === "P0009");
    assert(liB && liB.lineId, "P0009 line present");
    const reGone = await req("POST", "/api/orders/" + oid2 + "/reorder", {
      token: buyer.token, body: { lineIds: [liB.lineId] },
    });
    assert(reGone.status === 200, "N reorder status");
    assert((reGone.data.skipped || []).length >= 1,
      "N reorder unavailable skipped got " + JSON.stringify(reGone.data));
    ok("M/N reorder");

    /* O/P block */
    const block = await req("POST", "/api/admin/customers/" + buyer.user.id + "/block", {
      token: tok, body: { reason: "abuse" },
    });
    assert(block.status === 200 && block.data.user.blocked === true, "block");
    const blockedOrder = await req("POST", "/api/orders", {
      token: buyer.token,
      body: {
        items: [{ code: "P0008", name: "شال A", qty: 1 }],
        customer: { name: "Buyer", phone: "0700222001", email: buyer.email, address: "Kabul" },
        payment: "whatsapp",
        delivery: { method: "pickup", storeId: "store_a" },
      },
    });
    assert(blockedOrder.status === 403 && blockedOrder.data.error === "account_blocked", "O blocked cannot order");
    await req("POST", "/api/admin/customers/" + buyer.user.id + "/unblock", { token: tok, body: {} });
    const unblockedOrder = await req("POST", "/api/orders", {
      token: buyer.token,
      body: {
        items: [{ code: "P0008", name: "شال A", qty: 1 }],
        customer: { name: "Buyer", phone: "0700222001", email: buyer.email, address: "Kabul" },
        payment: "whatsapp",
        delivery: { method: "pickup", storeId: "store_a" },
      },
    });
    assert(unblockedOrder.status === 200, "P unblocked can order");
    assert(unblockedOrder.data.order.pickupStore && unblockedOrder.data.order.pickupStore.id === "store_a", "S pickup store persisted");
    ok("O/P/S block + pickup store");

    /* R eligible stores — P0014 only store_a */
    const elig = await req("POST", "/api/checkout/pickup-stores", {
      body: { items: [{ code: "P0014", name: "کیف", qty: 1 }], lat: 34.52, lng: 69.18 },
    });
    assert(elig.status === 200, "pickup stores");
    assert(elig.data.stores.some((s) => s.id === "store_a"), "store_a eligible");
    assert(!elig.data.stores.some((s) => s.id === "store_b"), "store_b not eligible for P0014");
    ok("R pickup eligible filtering");

    /* T pickup email content */
    let pickupHtml = "";
    const mail2 = buildMailer({
      sendRaw: async ({ html }) => { pickupHtml = html || ""; return true; },
      fromName: "MAHO", fromEmail: "noreply@mahomarket.com",
      siteUrl: SITE, logoUrl: SITE + "/social-preview.jpg",
    });
    await mail2.pickupReady("a@b.com", unblockedOrder.data.order, unblockedOrder.data.order.pickupStore, "fa");
    assert(/آماده دریافت|قابل دریافت/.test(pickupHtml), "pickup terminology");
    assert(/Google Maps/.test(pickupHtml), "maps link");
    assert(/مرکز/.test(pickupHtml), "selected store name");
    assert(!/راننده|دلیوری ارسال/.test(pickupHtml), "no driver shipping wording");
    ok("T pickup email selected store + maps");

    /* U staff deactivate */
    const st = await req("POST", "/api/admin/staff", {
      token: tok,
      body: { name: "Staff One", email: "staff1_" + Date.now() + "@ex.com", password: "StaffPass99", permissions: ["orders"] },
    });
    assert(st.status === 200 && st.data.staff.id, "staff create");
    const de = await req("POST", "/api/admin/staff/" + st.data.staff.id + "/deactivate", { token: tok, body: {} });
    assert(de.status === 200 && de.data.staff.active === false, "U deactivate");
    const stLogin = await req("POST", "/api/admin/staff-login", {
      body: { id: st.data.staff.email, password: "StaffPass99" },
    });
    assert(stLogin.status === 401 || stLogin.status === 403 || !(stLogin.data && stLogin.data.token), "deactivated cannot login");
    ok("U employee deactivate");

    /* V permission denial */
    const st2 = await req("POST", "/api/admin/staff", {
      token: tok,
      body: { name: "Staff Two", email: "staff2_" + Date.now() + "@ex.com", password: "StaffPass99", permissions: ["products"] },
    });
    assert(st2.status === 200 && st2.data && st2.data.staff, "staff2 create " + JSON.stringify(st2.data));
    const st2Login = await req("POST", "/api/admin/staff-login", {
      body: { id: st2.data.staff.email, password: "StaffPass99" },
    });
    assert(st2Login.status === 200 && st2Login.data.token, "staff2 login " + st2Login.status + " " + JSON.stringify(st2Login.data));
    const deny = await req("POST", "/api/admin/orders/" + oid2 + "/items/approve", {
      token: st2Login.data.token, body: { lineIds: [] },
    });
    assert(deny.status === 403, "V permission denial server-side");
    ok("V permission denial");

    /* W/X discount rules */
    const rule = await req("POST", "/api/admin/order-value-discounts", {
      token: tok,
      body: { name: "5k", minAmount: 5000, type: "percent", value: 10, appliesTo: "both", active: true },
    });
    assert(rule.status === 200, "discount rule");
    await req("POST", "/api/admin/order-value-discounts", {
      token: tok,
      body: { name: "2k", minAmount: 2000, type: "percent", value: 5, appliesTo: "both", active: true },
    });
    const ev = await req("POST", "/api/checkout/order-value-discount", {
      body: { subtotal: 5500, fulfillment: "delivery" },
    });
    assert(ev.status === 200 && ev.data.amount > 0, "W discount applies");
    assert(ev.data.rule && Number(ev.data.rule.minAmount) === 5000, "best tier wins");
    ok("W/X order-value discount tiers");

    const discOrder = await req("POST", "/api/orders", {
      token: buyer.token,
      body: {
        items: [
          { code: "P0014", name: "کیف", qty: 1 },
          { code: "P0015", name: "کفش", qty: 1 },
        ],
        customer: { name: "Buyer", phone: "0700222001", email: buyer.email, address: "Kabul" },
        payment: "whatsapp",
        delivery: { method: "deliver", time: "normal", fee: 0 },
      },
    });
    assert(discOrder.status === 200 && discOrder.data.order.discountTotal > 0, "discount snapshot on order");
    assert(discOrder.data.order.discountSnapshot, "snapshot persisted");
    ok("W discount on order");

    /* Z inventory not double-restored — reject then check stock */
    const before = JSON.parse(fs.readFileSync(path.join(DATA, "db.json"), "utf8"));
    const p8before = before.products.find((p) => p.code === "P0008").stock;
    const oZ = await req("POST", "/api/orders", {
      token: buyer.token,
      body: {
        items: [{ code: "P0008", name: "شال A", qty: 1 }],
        customer: { name: "Buyer", phone: "0700222001", email: buyer.email, address: "Kabul" },
        payment: "whatsapp",
        delivery: { method: "pickup", storeId: "store_a" },
      },
    });
    const zid = oZ.data.order.id;
    const zline = oZ.data.order.items[0].lineId;
    await req("POST", "/api/admin/orders/" + zid + "/items/reject", {
      token: tok, body: { lineIds: [zline], reason: "x" },
    });
    await req("POST", "/api/admin/orders/" + zid + "/items/reject", {
      token: tok, body: { lineIds: [zline], reason: "x" },
    });
    const after = JSON.parse(fs.readFileSync(path.join(DATA, "db.json"), "utf8"));
    const p8after = after.products.find((p) => p.code === "P0008").stock;
    assert(p8after === p8before, "Z no double restore (back to original)");
    ok("Z inventory idempotent restore");

    /* Y partial refundable amount sanity via cancel */
    const oY = await req("POST", "/api/orders", {
      token: buyer.token,
      body: {
        items: [{ code: "P0009", name: "شال B", qty: 1 }, { code: "P0015", name: "کفش", qty: 1 }],
        customer: { name: "Buyer", phone: "0700222001", email: buyer.email, address: "Kabul" },
        payment: "whatsapp",
        delivery: { method: "deliver", time: "normal", fee: 0 },
      },
    });
    await req("POST", "/api/admin/orders/" + oY.data.order.id + "/status", { token: tok, body: { status: "confirmed" } });
    const yCancel = await req("POST", "/api/orders/" + oY.data.order.id + "/items/" + oY.data.order.items[0].lineId + "/cancel", {
      token: buyer.token, body: { reason: "partial" },
    });
    assert(yCancel.status === 200 && yCancel.data.refundable >= 0, "Y partial refundable");
    ok("Y partial refundable");

    /* Order-value discount nav + item-level admin controls present (flat sidebar; no menu redesign) */
    const adminHtml = fs.readFileSync(path.join(ROOT, "..", "website", "admin.html"), "utf8");
    assert(/data-panel="ovdiscounts"/.test(adminHtml) && /تخفیف مبلغ سفارش/.test(adminHtml), "ovdiscounts nav");
    assert(/data-item-approve/.test(adminHtml) && /data-item-approve-all/.test(adminHtml), "item-level admin controls");
    assert(/f_storeIds/.test(adminHtml), "product store assignment UI");
    ok("admin UI markup for new features");

    console.log("\nAll production-ops smoke tests passed. TMP=" + TMP);
  } finally {
    try { child.kill(); } catch (_) {}
  }
}

main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
