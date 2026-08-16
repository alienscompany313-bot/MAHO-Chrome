#!/usr/bin/env node
/**
 * Phase-3 smoke: POS login, serials, GPS optional, EN email, returns, payments, driver, slider config.
 * Uses temporary DATA_DIR only — never Production.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "maho-p3-"));
const DATA = path.join(TMP, "data");
const UPLOADS = path.join(TMP, "uploads");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });

const ADMIN_PASSWORD = "SecureTestPass1!";
const PORT = 4211 + Math.floor(Math.random() * 80);

function req(method, urlPath, { body, token } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body != null ? Buffer.from(JSON.stringify(body)) : null;
    const h = { Accept: "application/json" };
    if (token) h.Authorization = "Bearer " + token;
    if (payload) {
      h["Content-Type"] = "application/json";
      h["Content-Length"] = String(payload.length);
    }
    const r = http.request(
      { hostname: "127.0.0.1", port: PORT, path: urlPath, method, headers: h },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let data = null;
          try { data = raw ? JSON.parse(raw) : null; } catch (_) { data = { raw }; }
          resolve({ status: res.statusCode, data });
        });
      }
    );
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }

async function main() {
  const child = spawn(process.execPath, [path.join(ROOT, "index.js")], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), NODE_ENV: "development", ADMIN_PASSWORD,
      DATA_DIR: DATA, UPLOAD_DIR: UPLOADS, ALLOW_DEV_CODES: "true",
      TOKEN_PEPPER: "p3-pepper", SITE_URL: "http://127.0.0.1:" + PORT,
      ALLOWED_ORIGINS: "http://127.0.0.1:" + PORT,
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let boot = "";
  child.stdout.on("data", (d) => { boot += d.toString(); });
  child.stderr.on("data", (d) => { boot += d.toString(); });
  const results = [];
  const ok = (n) => { results.push("PASS " + n); console.log("PASS", n); };

  try {
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 150));
      try { if ((await req("GET", "/api/health")).status === 200) break; } catch (_) {}
      if (i === 39) throw new Error("boot failed\n" + boot.slice(-1500));
    }

    const admin = await req("POST", "/api/admin/login", { body: { password: ADMIN_PASSWORD } });
    assert(admin.status === 200, "admin");
    const adminTok = admin.data.token;
    const catalog = {
      products: [
        { name: "شال تست", name_en: "Test Shawl", price: 100, stock: 20, code: "T100", barcode: "628100", cat: "shawls", lowStock: 3 },
        { name: "کیف", name_en: "Bag", price: 200, stock: 0, code: "B1", cat: "bags" },
      ],
      stores: [{ name: "مرکز", address: "کابل", phone: "0700000000", lat: 34.5, lng: 69.1 }],
      config: {
        delivery: { enabled: true, maxKm: 50, perKm: 10, freeKm: 0, outOfRangePolicy: "warn", gpsRequired: false },
        hesab: { enabled: true, link: "https://hesab.example/pay", number: "1", holder: "MAHO" },
        paymentMethods: {
          whatsapp: { enabled: true }, hesab: { enabled: true }, bank: { enabled: true }, card: { enabled: false },
        },
        heroSlides: [
          { id: "a", url: "/uploads/a.jpg", enabled: true, order: 0, text: "یکی", text_en: "One" },
          { id: "b", url: "/uploads/b.jpg", enabled: true, order: 1, text: "دو", text_en: "Two" },
        ],
        heroSliderIntervalSec: 4,
        hesabBanner: { enabled: true, text: "ما پرداخت با حساب‌پی را می‌پذیریم", text_en: "We accept HesabPay", link: "https://hesab.example", imageUrl: "" },
      },
    };
    assert((await req("PUT", "/api/admin/catalog", { token: adminTok, body: catalog })).status === 200, "catalog");

    /* staff with and without POS */
    const stOk = await req("POST", "/api/admin/staff", {
      token: adminTok,
      body: { name: "فروشنده", email: "posclerk@example.com", password: "ClerkPass99", permissions: ["pos"] },
    });
    assert(stOk.status === 200 && stOk.data.staff, "staff pos");
    const stNo = await req("POST", "/api/admin/staff", {
      token: adminTok,
      body: { name: "بدون‌دسترسی", email: "noperm@example.com", password: "ClerkPass99", permissions: ["products"] },
    });
    assert(stNo.status === 200, "staff no pos");

    const posLogin = await req("POST", "/api/pos/login", { body: { id: "posclerk@example.com", password: "ClerkPass99" } });
    assert(posLogin.status === 200 && posLogin.data.token && posLogin.data.workspace === "pos", "pos login direct");
    ok("POS direct login without admin portal");

    const posDenied = await req("POST", "/api/pos/login", { body: { id: "noperm@example.com", password: "ClerkPass99" } });
    assert(posDenied.status === 403 && posDenied.data.error === "no_pos_permission", "no pos permission blocked");
    ok("POS login denied without permission");

    const products = await req("GET", "/api/pos/products", { token: posLogin.data.token });
    assert(products.status === 200 && products.data.products.length >= 2, "pos products");
    assert(products.data.products.some((p) => p.stockStatus === "out"), "out of stock marked");
    ok("POS product catalog + stock status");

    const over = await req("POST", "/api/pos/sale", {
      token: posLogin.data.token,
      body: { items: [{ code: "B1", qty: 1 }], payment: "cash", idempotencyKey: "p3over" },
    });
    assert(over.status >= 400, "oos blocked");
    const sale = await req("POST", "/api/pos/sale", {
      token: posLogin.data.token,
      body: { items: [{ code: "T100", qty: 1 }], payment: "cash", idempotencyKey: "p3sale1" },
    });
    assert(sale.status === 200 && /^POS-MAHO-000001$/.test(sale.data.sale.receiptNo), "serial " + (sale.data.sale && sale.data.sale.receiptNo));
    assert(sale.data.sale.staffName === "فروشنده" && sale.data.sale.staffId === stOk.data.staff.id, "staff on sale");
    const sale2 = await req("POST", "/api/pos/sale", {
      token: posLogin.data.token,
      body: { items: [{ code: "T100", qty: 1 }], payment: "cash", idempotencyKey: "p3sale2" },
    });
    assert(sale2.status === 200 && sale2.data.sale.receiptNo === "POS-MAHO-000002", "serial unique");
    ok("POS serial + staff name + oversell");

    /* customer + EN/FA emails */
    let captured = [];
    const { buildMailer } = require("../lib/email");
    const mail = buildMailer({
      sendRaw: async (opts) => { captured.push(opts); return { messageId: "x" }; },
      fromName: "MAHO", fromEmail: "info@mahomarket.com", replyTo: "support@mahomarket.com",
      siteUrl: "https://mahomarket.com", ordersNotifyEmail: "orders@mahomarket.com",
    });
    const sample = {
      id: "MAHO-100001", date: Date.now(), total: 100, payment: "whatsapp", status: "new", lang: "en",
      items: [{ name: "شال", name_en: "Shawl", qty: 1, price: 100 }],
      customer: { name: "Aida", email: "a@ex.com", phone: "0700", address: "Kabul" },
      delivery: { method: "deliver" },
    };
    await mail.orderConfirmation("a@ex.com", sample, "https://mahomarket.com/#orders", "en");
    assert(captured.length && /Order confirmation/i.test(captured[0].subject), "en subject");
    assert(/Hello/i.test(captured[0].html) && /lang="en"/i.test(captured[0].html) && /dir="ltr"/i.test(captured[0].html), "en html");
    assert(!/سلام/.test(captured[0].html), "no dari in en");
    captured = [];
    sample.lang = "fa";
    await mail.orderConfirmation("a@ex.com", sample, "https://mahomarket.com/#orders", "fa");
    assert(/تأیید سفارش/.test(captured[0].subject) && /dir="rtl"/i.test(captured[0].html), "fa email");
    ok("EN + FA order confirmation emails");

    const email = "p3_" + Date.now() + "@example.com";
    const reg = await req("POST", "/api/auth/register", { body: { name: "A", phone: "0700111222", email, password: "BuyerPass99", address: "کابل" } });
    await req("POST", "/api/auth/verify", { body: { email, code: reg.data.devCode } });
    const ulogin = await req("POST", "/api/auth/login", { body: { id: email, password: "BuyerPass99" } });
    const utok = ulogin.data.token;

    const enOrder = await req("POST", "/api/orders", {
      token: utok,
      body: {
        items: [{ name: "شال تست", qty: 1 }],
        customer: { name: "Aida", phone: "0700111222", email, address: "Kabul street" },
        payment: "whatsapp", delivery: { method: "pickup" }, lang: "en",
        idempotencyKey: "en_" + Date.now(),
      },
    });
    assert(enOrder.status === 200 && enOrder.data.order.lang === "en", "en order lang stored");

    const noGps = await req("POST", "/api/orders", {
      token: utok,
      body: {
        items: [{ name: "شال تست", qty: 1 }],
        customer: { name: "Aida", phone: "0700111222", email, address: "کابل" },
        payment: "whatsapp", delivery: { method: "deliver", time: "normal", fee: 10 },
        idempotencyKey: "nogps2_" + Date.now(),
      },
    });
    assert(noGps.status === 200, "delivery without gps");
    ok("EN order + delivery without GPS");

    /* payment disabled */
    const cardOff = await req("POST", "/api/orders", {
      token: utok,
      body: {
        items: [{ name: "شال تست", qty: 1 }],
        customer: { name: "A", phone: "0700111222", email, address: "کابل" },
        payment: "card", delivery: { method: "pickup" }, idempotencyKey: "cardoff_" + Date.now(),
      },
    });
    assert(cardOff.status === 400 && cardOff.data.error === "payment_disabled", "disabled payment rejected");
    const allOff = await req("PUT", "/api/admin/payment-methods", {
      token: adminTok,
      body: { methods: { whatsapp: { enabled: false }, hesab: { enabled: false }, bank: { enabled: false }, card: { enabled: false } } },
    });
    assert(allOff.status === 400 && allOff.data.error === "at_least_one_payment_required", "cannot disable all");
    ok("payment method toggles");

    /* return pickup_customer without GPS */
    const oid = noGps.data.order.id;
    await req("POST", "/api/admin/orders/" + oid + "/status", { token: adminTok, body: { status: "confirmed" } });
    await req("POST", "/api/admin/orders/" + oid + "/status", { token: adminTok, body: { status: "dispatched" } });
    await req("POST", "/api/admin/orders/" + oid + "/status", { token: adminTok, body: { status: "delivered" } });
    const ret = await req("POST", "/api/orders/" + oid + "/return-request", {
      token: utok,
      body: { reason: "size", method: "pickup_customer", address: "کابل", phone: "0700111222" },
    });
    assert(ret.status === 200 && ret.data.order.status === "return_requested", "return without gps " + JSON.stringify(ret.data));
    assert(ret.data.order.returnRequest.pickup && ret.data.order.returnRequest.pickup.address, "pickup address kept");
    ok("return pickup_customer without GPS");

    /* driver */
    const drv = await req("POST", "/api/admin/drivers", {
      token: adminTok, body: { name: "راننده", email: "driver1@example.com", password: "DriverPass99" },
    });
    assert(drv.status === 200 && drv.data.driver, "create driver");
    const dLogin = await req("POST", "/api/driver/login", { body: { id: "driver1@example.com", password: "DriverPass99" } });
    assert(dLogin.status === 200 && dLogin.data.token, "driver login");
    const delivOrd = await req("POST", "/api/orders", {
      token: utok,
      body: {
        items: [{ name: "شال تست", qty: 1 }],
        customer: { name: "A", phone: "0700111222", email, address: "کابل" },
        payment: "whatsapp", delivery: { method: "deliver", fee: 10 },
        idempotencyKey: "drvord_" + Date.now(),
      },
    });
    const did = delivOrd.data.order.id;
    await req("POST", "/api/admin/orders/" + did + "/status", { token: adminTok, body: { status: "confirmed" } });
    await req("POST", "/api/admin/orders/" + did + "/status", { token: adminTok, body: { status: "dispatched" } });
    const asg = await req("POST", "/api/admin/orders/" + did + "/assign-driver", {
      token: adminTok, body: { driverId: drv.data.driver.id },
    });
    assert(asg.status === 200 && asg.data.order.driverId === drv.data.driver.id, "assign");
    const mine = await req("GET", "/api/driver/orders", { token: dLogin.data.token });
    assert(mine.status === 200 && mine.data.orders.some((o) => o.id === did), "driver sees assigned");
    const other = await req("POST", "/api/driver/orders/" + oid + "/status", {
      token: dLogin.data.token, body: { status: "picked_up" },
    });
    assert(other.status >= 400, "cannot change other driver order");
    const fail = await req("POST", "/api/driver/orders/" + did + "/status", {
      token: dLogin.data.token, body: { status: "failed" },
    });
    assert(fail.status === 400 && fail.data.error === "fail_reason_required", "fail reason required");
    const failOk = await req("POST", "/api/driver/orders/" + did + "/status", {
      token: dLogin.data.token, body: { status: "failed", reason: "مشتری نبود" },
    });
    assert(failOk.status === 200 && failOk.data.order.driverStatus === "failed", "failed with reason");
    const again = await req("POST", "/api/driver/orders/" + did + "/status", {
      token: dLogin.data.token, body: { status: "picked_up" },
    });
    assert(again.status === 200, "re-pick after fail");
    await req("POST", "/api/driver/orders/" + did + "/status", { token: dLogin.data.token, body: { status: "in_transit" } });
    const delivered = await req("POST", "/api/driver/orders/" + did + "/status", {
      token: dLogin.data.token, body: { status: "delivered", note: "OK" },
    });
    assert(delivered.status === 200 && delivered.data.order.driverStatus === "delivered", "delivered");
    ok("driver login, assign, status, fail reason");

    const pub = await req("GET", "/api/catalog");
    assert(pub.status === 200 && Array.isArray(pub.data.config.heroSlides) && pub.data.config.heroSlides.length >= 2, "hero slides public");
    assert(pub.data.config.hesabBanner && pub.data.config.hesabBanner.enabled === true, "hesab banner");
    assert(pub.data.config.paymentMethods.card.enabled === false, "card off in public config");
    ok("hero slider + hesab banner config");

    console.log("\nAll phase-3 smoke tests passed (" + results.length + "). TMP=" + TMP);
  } catch (err) {
    console.error("\nFAIL", err.message);
    console.error(boot.slice(-2000));
    process.exitCode = 1;
  } finally {
    try { child.kill("SIGTERM"); } catch (_) {}
    setTimeout(() => {
      try { child.kill("SIGKILL"); } catch (_) {}
      try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
      process.exit(process.exitCode || 0);
    }, 400);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
