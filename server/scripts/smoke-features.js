#!/usr/bin/env node
/**
 * Isolated smoke tests — uses a temporary DATA_DIR, never Production.
 * Run: node scripts/smoke-features.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "maho-smoke-"));
const DATA = path.join(TMP, "data");
const UPLOADS = path.join(TMP, "uploads");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });

const ADMIN_PASSWORD = "SecureTestPass1!";
const PORT = 4011 + Math.floor(Math.random() * 80);

function req(method, urlPath, { body, token, headers, form } = {}) {
  return new Promise((resolve, reject) => {
    const payload = form ? null : (body != null ? Buffer.from(JSON.stringify(body)) : null);
    const h = Object.assign({ Accept: "application/json" }, headers || {});
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
          resolve({ status: res.statusCode, data, headers: res.headers });
        });
      }
    );
    r.on("error", reject);
    if (form) form.pipe(r);
    else {
      if (payload) r.write(payload);
      r.end();
    }
  });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

function assertNoSecret(obj, label) {
  const s = JSON.stringify(obj || {});
  assert(!/SMTP_PASS|SecureTestPass|bcrypt|\$2[aby]\$/i.test(s) || !/password":\s*"[^"]{4,}/i.test(s), label + " leaked secret-like field");
  assert(!/"pass"\s*:\s*"[^"$]/.test(s), label + " has plaintext pass");
  assert(!/"code"\s*:\s*"\d{6}"/.test(s) || label.includes("dev"), label + " may expose code unexpectedly");
}

async function main() {
  const child = spawn(process.execPath, [path.join(ROOT, "index.js")], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      NODE_ENV: "development",
      ADMIN_PASSWORD,
      DATA_DIR: DATA,
      UPLOAD_DIR: UPLOADS,
      ALLOW_DEV_CODES: "true",
      TOKEN_PEPPER: "test-pepper-not-prod",
      SITE_URL: "http://127.0.0.1:" + PORT,
      ALLOWED_ORIGINS: "http://127.0.0.1:" + PORT,
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let boot = "";
  child.stdout.on("data", (d) => { boot += d.toString(); });
  child.stderr.on("data", (d) => { boot += d.toString(); });

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 150));
    try {
      const h = await req("GET", "/api/health");
      if (h.status === 200) break;
    } catch (_) {}
    if (i === 39) {
      console.error(boot);
      throw new Error("server did not start");
    }
  }

  const results = [];
  const ok = (name) => { results.push("PASS " + name); console.log("PASS", name); };
  try {
    /* seed one product via admin */
    const login = await req("POST", "/api/admin/login", { body: { password: ADMIN_PASSWORD } });
    assert(login.status === 200 && login.data.token, "admin login");
    const adminTok = login.data.token;
    const catalog = {
      products: [{ name: "شال تست", name_en: "Test Scarf", code: "T100", cat: "scarf", icon: "scarf", price: 500, stock: 2 }],
      stores: [{ name: "مرکز", address: "کابل", phone: "0700000000", mapsUrl: "https://maps.google.com/?q=Kabul", lat: 34.5, lng: 69.1 }],
      config: {
        sectionCats: { kicker: "دسته‌بندی‌ها", title: "عنوان تست", lead: "توضیح تست" },
        hesab: { enabled: true, link: "https://example.com/pay", number: "123", holder: "MAHO", title: "حساب‌پی" },
        categories: [{ key: "scarf", name: "شال", name_en: "Scarves", icon: "scarf", order: 0, enabled: true }],
      },
    };
    const save = await req("PUT", "/api/admin/catalog", { body: catalog, token: adminTok });
    assert(save.status === 200, "save catalog");
    ok("admin login + catalog");

    const pub = await req("GET", "/api/catalog");
    assert(pub.data.config.sectionCats && pub.data.config.sectionCats.title === "عنوان تست", "sectionCats public");
    assert(pub.data.config.hesab && pub.data.config.hesab.enabled === true, "hesab public");
    const st0 = (pub.data.stores && pub.data.stores[0]) || {};
    assert(Number(st0.lat) === 34.5 && !!(st0.mapsUrl || st0.map), "store maps preserved got=" + JSON.stringify(st0));
    ok("public config sectionCats + hesab + maps");

    /* register / verify / login */
    const email = "buyer_" + Date.now() + "@example.com";
    const reg = await req("POST", "/api/auth/register", {
      body: { name: "آیدا", phone: "0700111222", email, password: "BuyerPass99" },
    });
    assert(reg.status === 200 || reg.status === 201, "register status " + reg.status);
    assert(reg.data.devCode && /^\d{6}$/.test(reg.data.devCode), "dev code");
    assertNoSecret(reg.data, "register");
    const bad = await req("POST", "/api/auth/verify", { body: { email, code: "000000" } });
    assert(bad.status >= 400, "bad code rejected");
    const ver = await req("POST", "/api/auth/verify", { body: { email, code: reg.data.devCode } });
    assert(ver.status === 200 && ver.data.token && ver.data.user, "verify ok");
    assert(ver.data.welcomeUrl, "welcome url");
    assertNoSecret(ver.data, "verify");
    const loginBlocked = await req("POST", "/api/auth/login", {
      body: { id: "other_" + Date.now() + "@example.com", password: "BuyerPass99" },
    });
    assert(loginBlocked.status === 401, "unknown login fails");
    const ulogin = await req("POST", "/api/auth/login", { body: { id: email, password: "BuyerPass99" } });
    assert(ulogin.status === 200 && ulogin.data.token, "verified login got=" + ulogin.status + " " + JSON.stringify(ulogin.data));
    ok("signup verify login");

    /* forgot password generic */
    const fg = await req("POST", "/api/auth/forgot-password", { body: { email } });
    const fg2 = await req("POST", "/api/auth/forgot-password", { body: { email: "nosuch@example.com" } });
    assert(fg.status === 200 && fg2.status === 200, "forgot always 200");
    assert(JSON.stringify(fg.data) === JSON.stringify(fg2.data) || (fg.data.ok && fg2.data.ok), "forgot generic");
    ok("forgot password generic");

    /* guest checkout must be rejected */
    const guestTry = await req("POST", "/api/orders", {
      body: {
        items: [{ name: "شال تست", qty: 1 }],
        customer: { name: "مهمان", phone: "0700333444", email: "guest_" + Date.now() + "@example.com", address: "کابل" },
        payment: "whatsapp",
        delivery: { method: "pickup" },
        guest: true,
        idempotencyKey: "guest_" + Date.now(),
      },
    });
    assert(guestTry.status === 401, "guest order rejected");
    ok("no guest checkout");

    /* member order + location + idempotency */
    const idem = "smoke_" + Date.now();
    const orderBody = {
      items: [{ name: "شال تست", qty: 1 }],
      customer: { name: "آیدا", phone: "0700111222", email, address: "کابل ناحیه ۱" },
      payment: "hesab",
      delivery: { method: "deliver", time: "normal" },
      customerLocation: { lat: 34.52, lng: 69.18, accuracy: 25 },
      idempotencyKey: idem,
    };
    const o1 = await req("POST", "/api/orders", { body: orderBody, token: ulogin.data.token });
    assert(o1.status === 200 || o1.status === 201, "member order " + o1.status + " " + JSON.stringify(o1.data));
    assert(o1.data.order && o1.data.order.guest === false, "not guest");
    assert(o1.data.order.customerLocation && o1.data.order.customerLocation.lat === 34.52, "customer location");
    assert(o1.data.order.status === "new", "status new");
    assert(o1.data.order.paymentStatus === "awaiting_payment", "awaiting payment");
    const o2 = await req("POST", "/api/orders", { body: orderBody, token: ulogin.data.token });
    assert(o2.data.order.id === o1.data.order.id, "idempotency");
    ok("member order location idempotency");

    /* delivery disabled */
    await req("PUT", "/api/admin/catalog", {
      token: adminTok,
      body: { products: catalog.products, stores: catalog.stores, config: Object.assign({}, catalog.config, { delivery: { enabled: false, maxKm: 5, perKm: 20, freeKm: 0 } }) },
    });
    const delOff = await req("POST", "/api/orders", {
      token: ulogin.data.token,
      body: {
        items: [{ name: "شال تست", qty: 1 }],
        customer: { name: "آیدا", phone: "0700111222", email, address: "کابل" },
        payment: "whatsapp",
        delivery: { method: "deliver" },
        customerLocation: { lat: 34.52, lng: 69.18 },
        idempotencyKey: "deloff_" + Date.now(),
      },
    });
    assert(delOff.status === 400 && delOff.data.error === "delivery_disabled", "delivery disabled rejected");
    /* re-enable with maxKm */
    await req("PUT", "/api/admin/catalog", {
      token: adminTok,
      body: { products: catalog.products, stores: catalog.stores, config: Object.assign({}, catalog.config, { delivery: { enabled: true, maxKm: 1, perKm: 20, freeKm: 0, outOfRangePolicy: "block" }, hesab: catalog.config.hesab }) },
    });
    const far = await req("POST", "/api/orders", {
      token: ulogin.data.token,
      body: {
        items: [{ name: "شال تست", qty: 1 }],
        customer: { name: "آیدا", phone: "0700111222", email, address: "دور" },
        payment: "whatsapp",
        delivery: { method: "deliver" },
        customerLocation: { lat: 35.5, lng: 70.5 },
        idempotencyKey: "far_" + Date.now(),
      },
    });
    assert(far.status === 400 && far.data.error === "out_of_delivery_range", "out of range rejected");
    ok("delivery disabled + out of range");

    /* restock product for further tests */
    catalog.products[0].stock = 5;
    await req("PUT", "/api/admin/catalog", { token: adminTok, body: { products: catalog.products, stores: catalog.stores, config: Object.assign({}, catalog.config, { delivery: { enabled: true, maxKm: 50, perKm: 10, freeKm: 0, outOfRangePolicy: "warn", gpsRequired: false } }) } });

    /* delivery without GPS must be allowed */
    const noGps = await req("POST", "/api/orders", {
      token: ulogin.data.token,
      body: {
        items: [{ name: "شال تست", qty: 1 }],
        customer: { name: "آیدا", phone: "0700111222", email, address: "کابل شهر نو" },
        payment: "whatsapp",
        delivery: { method: "deliver", time: "normal", fee: 20 },
        idempotencyKey: "nogps_" + Date.now(),
      },
    });
    assert(noGps.status === 200 || noGps.status === 201, "delivery without GPS " + JSON.stringify(noGps.data));
    assert(!noGps.data.order.customerLocation, "no gps stored");
    ok("optional GPS delivery");

    /* member order + oversell */
    const eligFeat = await req("POST", "/api/checkout/pickup-stores", {
      body: { items: [{ name: "شال تست", qty: 1 }] },
    });
    assert(eligFeat.status === 200 && (eligFeat.data.stores || []).length >= 1, "pickup stores for features");
    const featStoreId = eligFeat.data.stores[0].id;
    const memOrder = await req("POST", "/api/orders", {
      token: ulogin.data.token,
      body: {
        items: [{ name: "شال تست", qty: 1 }],
        customer: { name: "آیدا", phone: "0700111222", email, address: "کابل" },
        payment: "whatsapp",
        delivery: { method: "pickup", storeId: featStoreId },
        idempotencyKey: "mem_" + Date.now(),
      },
    });
    assert(memOrder.status === 200 || memOrder.status === 201, "member order pickup");
    const over = await req("POST", "/api/orders", {
      token: ulogin.data.token,
      body: {
        items: [{ name: "شال تست", qty: 99 }],
        customer: { name: "آیدا", phone: "0700111222", email, address: "کابل" },
        payment: "whatsapp",
        delivery: { method: "pickup", storeId: featStoreId },
        idempotencyKey: "over_" + Date.now(),
      },
    });
    assert(over.status === 409 || over.status === 400, "oversell blocked " + over.status);
    ok("member order + oversell");

    /* stock endpoint */
    const stock = await req("GET", "/api/stock");
    assert(stock.status === 200 && Array.isArray(stock.data.products), "stock");
    assert(/no-store/i.test(String(stock.headers["cache-control"] || "")), "stock no-store");
    ok("stock live endpoint");

    /* status transitions + emails don't throw */
    const oid = o1.data.order.id;
    const st1 = await req("POST", "/api/admin/orders/" + oid + "/status", { token: adminTok, body: { status: "confirmed" } });
    assert(st1.status === 200 && st1.data.order.status === "confirmed", "confirm");
    const stBad = await req("POST", "/api/admin/orders/" + oid + "/status", { token: adminTok, body: { status: "delivered" } });
    assert(stBad.status >= 400, "skip dispatch blocked");
    const st2 = await req("POST", "/api/admin/orders/" + oid + "/status", { token: adminTok, body: { status: "dispatched" } });
    assert(st2.status === 200, "dispatch");
    ok("order status machine");

    /* delivery QR */
    const qr = await req("POST", "/api/admin/orders/" + oid + "/delivery-qr", { token: adminTok, body: {} });
    assert(qr.status === 200 && qr.data.url && qr.data.qrDataUrl, "delivery qr");
    const u = new URL(qr.data.url, "http://127.0.0.1");
    const tokenPart = u.searchParams.get("t") || "";
    assert(tokenPart, "qr token in url");
    const view = await req("GET", "/api/delivery/" + encodeURIComponent(oid) + "?t=" + encodeURIComponent(tokenPart));
    assert(view.status === 200 && view.data && view.data.id === oid && !JSON.stringify(view.data).includes("BuyerPass"), "delivery view got=" + view.status + " url=" + qr.data.url + " tok=" + tokenPart.slice(0,8) + " " + JSON.stringify(view.data));
    const rev = await req("POST", "/api/admin/orders/" + oid + "/delivery-qr/revoke", { token: adminTok, body: {} });
    assert(rev.status === 200, "revoke qr");
    const view2 = await req("GET", "/api/delivery/" + oid + "?t=" + encodeURIComponent(tokenPart));
    assert(view2.status >= 400, "revoked qr rejected");
    ok("delivery QR issue revoke");

    /* payment status */
    const pay = await req("POST", "/api/admin/orders/" + oid + "/payment-status", {
      token: adminTok, body: { paymentStatus: "payment_confirmed", note: "OK" },
    });
    assert(pay.status === 200 && pay.data.order.paymentStatus === "payment_confirmed", "payment confirm");
    ok("hesab payment confirm");

    /* customers table — no secrets */
    const cust = await req("GET", "/api/admin/customers/table", { token: adminTok });
    assert(cust.status === 200 && Array.isArray(cust.data.customers), "customers");
    assertNoSecret(cust.data, "customers");
    const blob = JSON.stringify(cust.data);
    assert(!/passHash|resetToken|codeHash|session/i.test(blob), "customers no hashes");
    ok("customers table export-safe");

    /* email templates build without password */
    const { buildMailer } = require("../lib/email");
    let captured = null;
    const mail = buildMailer({
      sendRaw: async (opts) => { captured = opts; return { messageId: "x" }; },
      fromName: "MAHO Market",
      fromEmail: "info@mahomarket.com",
      replyTo: "support@mahomarket.com",
      siteUrl: "https://mahomarket.com",
      logoUrl: "",
      ordersNotifyEmail: "orders@mahomarket.com",
    });
    await mail.verificationCode(email, "123456", "آیدا");
    assert(captured && /123456/.test(captured.html) && !/BuyerPass/.test(captured.html), "verify email html");
    await mail.orderConfirmation(email, st2.data.order);
    assert(/افغانی/.test(captured.html) && /MAHO/.test(captured.html), "order email");
    await mail.welcome(email, { name: "آیدا", email });
    assert(!/رمز عبور شما:/.test(captured.html || "") && !/password is/i.test(captured.html || ""), "welcome no password");
    assert(/سؤالی دارید؟/.test(captured.html || "") || /support@mahomarket.com/.test(captured.html || ""), "support contact");
    ok("email templates");

    /* badges + POS + soft delete + return flow */
    const badges = await req("GET", "/api/admin/badges/orders", { token: adminTok });
    assert(badges.status === 200 && typeof badges.data.awaitingConfirm === "number", "badges got=" + badges.status + " " + JSON.stringify(badges.data));
    ok("order badges");

    const posSale = await req("POST", "/api/pos/sale", {
      token: adminTok,
      body: {
        items: [{ name: "شال تست", code: "T100", qty: 1 }],
        payment: "cash",
        idempotencyKey: "possale_" + Date.now(),
      },
    });
    assert(posSale.status === 200 && posSale.data.sale, "pos sale " + JSON.stringify(posSale.data));
    assert(/^POS-MAHO-\d{6}$/.test(posSale.data.sale.receiptNo || posSale.data.sale.id), "pos serial " + (posSale.data.sale.receiptNo || posSale.data.sale.id));
    assert(posSale.data.sale.staffName, "staff name on sale");
    const posSale2 = await req("POST", "/api/pos/sale", {
      token: adminTok,
      body: {
        items: [{ name: "شال تست", code: "T100", qty: 1 }],
        payment: "cash",
        idempotencyKey: posSale.data.sale ? ("replay_" + Date.now()) : "x",
      },
    });
    /* oversell eventually */
    const posOver = await req("POST", "/api/pos/sale", {
      token: adminTok,
      body: { items: [{ name: "شال تست", code: "T100", qty: 999 }], payment: "cash", idempotencyKey: "posover_" + Date.now() },
    });
    assert(posOver.status === 409 || posOver.status === 400, "pos oversell blocked");
    ok("POS sale + oversell");

    /* deliver mem order and request return */
    const mid = memOrder.data.order.id;
    await req("POST", "/api/admin/orders/" + mid + "/status", { token: adminTok, body: { status: "confirmed" } });
    await req("POST", "/api/admin/orders/" + mid + "/status", { token: adminTok, body: { status: "dispatched" } });
    await req("POST", "/api/admin/orders/" + mid + "/status", { token: adminTok, body: { status: "delivered" } });
    const earlyRet = await req("POST", "/api/orders/" + o1.data.order.id + "/return-request", {
      token: ulogin.data.token,
      body: { reason: "test", method: "pickup_store" },
    });
    assert(earlyRet.status >= 400, "return before delivered blocked");
    const ret = await req("POST", "/api/orders/" + mid + "/return-request", {
      token: ulogin.data.token,
      body: { reason: "سایز نادرست", details: "کوچک بود", method: "pickup_store" },
    });
    assert(ret.status === 200 && ret.data.order.status === "return_requested", "return request");
    ok("return only after delivered");

    /* soft delete */
    const me = await req("GET", "/api/me", { token: ulogin.data.token });
    const uid = me.data.user.id;
    const soft = await req("POST", "/api/admin/customers/" + uid + "/soft-delete", {
      token: adminTok, body: { confirm: "DELETE" },
    });
    assert(soft.status === 200, "soft delete");
    const loginDel = await req("POST", "/api/auth/login", { body: { id: email, password: "BuyerPass99" } });
    assert(loginDel.status === 403 || loginDel.status === 401, "deleted cannot login");
    ok("soft delete customer");

    console.log("\nAll smoke tests passed (" + results.length + "). TMP=" + TMP);
  } catch (err) {
    console.error("\nFAIL", err.message);
    console.error(boot.slice(-2000));
    process.exitCode = 1;
  } finally {
    child.kill("SIGTERM");
    setTimeout(() => {
      try { child.kill("SIGKILL"); } catch (_) {}
      try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
    }, 500);
  }
}

main();
