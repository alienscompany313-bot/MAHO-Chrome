#!/usr/bin/env node
"use strict";
/**
 * Focused regression for account session expiry, payment persistence,
 * and order email copy/layout (safe / no real SMTP / no production DB).
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");

const ROOT = path.join(__dirname, "..", "..");
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "maho-acct-pay-email-"));
process.env.DATA_DIR = DATA_DIR;
process.env.PORT = "0";
process.env.ADMIN_PASSWORD = "SecurePreviewPass1!";
process.env.ALLOW_DEV_CODES = "true";
process.env.EMAIL_ENABLED = "0";
process.env.SITE_URL = "https://mahomarket.com";
process.env.NODE_ENV = "development";

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT: " + msg);
}
function ok(msg) { console.log("OK  " + msg); }

function req(method, urlPath, opts) {
  opts = opts || {};
  const port = global.__MAHO_PORT;
  return new Promise((resolve, reject) => {
    const body = opts.body != null ? JSON.stringify(opts.body) : null;
    const headers = Object.assign({ Accept: "application/json" }, opts.headers || {});
    if (body) headers["Content-Type"] = "application/json";
    if (opts.token) headers.Authorization = "Bearer " + opts.token;
    const r = http.request({
      hostname: "127.0.0.1", port, path: urlPath, method, headers,
    }, (res) => {
      let raw = "";
      res.on("data", (c) => { raw += c; });
      res.on("end", () => {
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch (_) { data = { raw }; }
        resolve({ status: res.statusCode, data, raw });
      });
    });
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}

async function main() {
  /* Start server against isolated DATA_DIR */
  const { spawn } = require("child_process");
  const serverPath = path.join(ROOT, "server", "index.js");
  const child = spawn(process.execPath, [serverPath], {
    env: Object.assign({}, process.env, { DATA_DIR, PORT: "4511", ADMIN_PASSWORD: "SecurePreviewPass1!", ALLOW_DEV_CODES: "true", NODE_ENV: "development", SITE_URL: "https://mahomarket.com" }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  global.__MAHO_PORT = 4511;
  let boot = "";
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("server boot timeout\n" + boot)), 20000);
    child.stdout.on("data", (d) => {
      boot += d.toString();
      if (/listening|MAHO|started|port/i.test(boot) || boot.length > 20) {
        /* probe */
      }
    });
    child.stderr.on("data", (d) => { boot += d.toString(); });
    const tryHealth = async () => {
      for (let i = 0; i < 40; i++) {
        try {
          const h = await req("GET", "/api/health");
          if (h.status === 200) { clearTimeout(t); return resolve(); }
        } catch (_) {}
        await new Promise((r) => setTimeout(r, 250));
      }
      clearTimeout(t);
      reject(new Error("health failed\n" + boot));
    };
    tryHealth();
  });

  try {
    /* ---- AUTH: register + login + me + 401 after revoke ---- */
    const email = "acctfix_" + Date.now() + "@maho.test";
    const pass = "PreviewTest123!";
    const reg = await req("POST", "/api/auth/register", {
      body: { name: "آیدا تست", phone: "0700111222", email, password: pass, address: "کابل" },
    });
    assert(reg.status === 200 && reg.data.devCode, "register " + JSON.stringify(reg.data));
    const ver = await req("POST", "/api/auth/verify", { body: { email, code: reg.data.devCode } });
    assert(ver.status === 200 && ver.data.token, "verify");
    const login = await req("POST", "/api/auth/login", { body: { id: email, password: pass } });
    assert(login.status === 200 && login.data.token, "login");
    const tok = login.data.token;
    const me = await req("GET", "/api/me", { token: tok });
    assert(me.status === 200 && me.data.user && me.data.user.email === email, "me");
    ok("customer auth login/me");

    /* Force expire by using bogus token */
    const bad = await req("GET", "/api/me", { token: "expired_or_invalid_token" });
    assert(bad.status === 401, "expired token → 401");
    ok("session expiry returns 401");

    /* ---- PAYMENT: bank fields persist; no CVV ---- */
    const savePay = await req("PUT", "/api/me", {
      token: tok,
      body: {
        payments: [{
          type: "bank",
          bankAccountNumber: "1234567890",
          bankRoutingNumber: "998877",
          bankAccountHolderName: "آیدا تست",
          cvv: "999",
          pin: "0000",
        }],
      },
    });
    assert(savePay.status === 200, "save payments " + JSON.stringify(savePay.data));
    const pays = savePay.data.user.payments || [];
    assert(pays.length === 1 && pays[0].type === "bank", "one bank method");
    assert(pays[0].bankAccountNumber === "1234567890", "account number");
    assert(pays[0].bankRoutingNumber === "998877", "routing");
    assert(pays[0].bankAccountHolderName === "آیدا تست", "holder");
    const blob = JSON.stringify(savePay.data);
    assert(!/"cvv"\s*:/.test(blob) && !/"pin"\s*:/.test(blob), "no cvv/pin stored");
    ok("bank payment fields persist (sanitized)");

    const saveCard = await req("PUT", "/api/me", {
      token: tok,
      body: {
        payments: [
          pays[0],
          { type: "card", holder: "Aida", number: "4111111111111234", cvv: "123", expiry: "12/29" },
        ],
      },
    });
    assert(saveCard.status === 200, "save card");
    const card = (saveCard.data.user.payments || []).find((p) => p.type === "card");
    assert(card && /1234/.test(card.number || card.maskedNumber || ""), "masked last4");
    assert(!/4111111111111234/.test(JSON.stringify(saveCard.data)), "full PAN not returned");
    assert(!/"cvv"/.test(JSON.stringify(saveCard.data)), "card cvv stripped");
    ok("card masked; CVV never stored");

    /* AuthZ: other user cannot read */
    const email2 = "acct2_" + Date.now() + "@maho.test";
    const reg2 = await req("POST", "/api/auth/register", {
      body: { name: "B", phone: "0700333444", email: email2, password: pass, address: "هرات" },
    });
    await req("POST", "/api/auth/verify", { body: { email: email2, code: reg2.data.devCode } });
    const login2 = await req("POST", "/api/auth/login", { body: { id: email2, password: pass } });
    const me2 = await req("GET", "/api/me", { token: login2.data.token });
    const pays2 = (me2.data.user && me2.data.user.payments) || [];
    assert(!pays2.some((p) => p.bankAccountNumber === "1234567890"), "customer B cannot see A bank");
    ok("payment authorization isolation");

    /* Edit bank */
    const edit = await req("PUT", "/api/me", {
      token: tok,
      body: {
        payments: [{
          id: pays[0].id,
          type: "bank",
          bankAccountNumber: "5555666677",
          bankRoutingNumber: "112233",
          bankAccountHolderName: "Aida Updated",
        }],
      },
    });
    const bank = (edit.data.user.payments || []).find((p) => p.type === "bank");
    assert(bank && bank.bankAccountNumber === "5555666677" && bank.bankRoutingNumber === "112233", "bank edit");
    ok("bank edit persists");

    /* ---- EMAIL templates ---- */
    const { buildMailer } = require("../lib/email");
    const captured = [];
    const mail = buildMailer({
      sendRaw: async (opts) => { captured.push(opts); return { messageId: "test" }; },
      fromName: "MAHO Market",
      fromEmail: "info@mahomarket.com",
      replyTo: "support@mahomarket.com",
      siteUrl: "https://mahomarket.com",
      logoUrl: "https://mahomarket.com/icon-192.png",
      ordersNotifyEmail: "orders@mahomarket.com",
      getStorePhone: () => "0700000000",
    });

    const storeA = {
      id: "store_a", name: "فروشگاه A", address: "کابل، کارته ۳", phone: "0700111000",
      hours: "۹ صبح تا ۸ شب", mapsUrl: "https://www.google.com/maps?q=34.5,69.1",
    };
    const storeB = {
      id: "store_b", name: "فروشگاه B", address: "هرات، مرکز", phone: "0700222000",
      hours: "۱۰ تا ۶", mapsUrl: "https://www.google.com/maps?q=34.3,62.2",
    };
    const sample = {
      id: "MAHO-100999", date: Date.now(), total: 1800, itemsTotal: 2000, discountTotal: 200, deliveryFee: 0,
      payment: "whatsapp", status: "new", lang: "fa",
      items: [{
        name: "مانتو بلند مخملی ویژه زمستان", name_en: "Velvet coat",
        qty: 2, price: 1000, discount: 10, size: "L", color: "مشکی",
        image: "/uploads/demo-product.jpg",
      }],
      customer: { name: "Aida", email, phone: "0700111222", address: "آدرس مشتری نباید به عنوان فروشگاه بیاید" },
      delivery: { method: "pickup", storeId: storeA.id },
      pickupStore: storeA,
    };

    captured.length = 0;
    await mail.orderConfirmation(email, sample, "https://mahomarket.com/#orders", "fa");
    const conf = captured[0];
    assert(conf && /از خرید شما از MAHO Market سپاسگزاریم/.test(conf.html), "natural dari thanks");
    assert(/سفارش شما با موفقیت ثبت شد و در حال بررسی است/.test(conf.html), "placed copy");
    assert(/شماره سفارش/.test(conf.html), "order number label");
    assert(/نام محصول:/.test(conf.html) && /سایز:/.test(conf.html) && /رنگ:/.test(conf.html), "product card fields");
    assert(/جمع اقلام/.test(conf.html) && /مبلغ نهایی/.test(conf.html), "totals labels");
    assert(/https:\/\/mahomarket\.com\/uploads\/demo-product\.jpg/.test(conf.html), "absolute https image");
    assert(!/localhost/.test(conf.html), "no localhost image");
    assert(/فروشگاه A/.test(conf.html) && /کابل، کارته ۳/.test(conf.html), "pickup store A");
    assert(/مشاهده در Google Maps/.test(conf.html), "maps CTA");
    assert(!/آدرس مشتری نباید/.test(conf.html), "customer address not shown as store");
    ok("order confirmation Dari + product cards + images + store A");

    /* Store B only */
    captured.length = 0;
    const sampleB = Object.assign({}, sample, {
      delivery: { method: "pickup", storeId: storeB.id },
      pickupStore: storeB,
    });
    await mail.orderConfirmation(email, sampleB, "https://mahomarket.com/#orders", "fa");
    assert(/فروشگاه B/.test(captured[0].html) && !/فروشگاه A/.test(captured[0].html), "store B only");
    ok("pickup email uses selected store only");

    captured.length = 0;
    sample.status = "confirmed";
    await mail.orderStatus(email, sample, "", "fa");
    assert(/سفارش شما با موفقیت تأیید شد و در حال آماده‌سازی است/.test(captured[0].html), "confirmed copy");
    assert(/فروشگاه A/.test(captured[0].html), "confirmed includes pickup store");
    ok("confirmed status copy + pickup block");

    captured.length = 0;
    await mail.pickupReady(email, sample, storeA, "fa");
    assert(/سفارش شما آماده دریافت است/.test(captured[0].html), "ready copy");
    assert(/فروشگاه A/.test(captured[0].html) && /0700111000/.test(captured[0].html), "ready store details");
    ok("pickup ready email");

    captured.length = 0;
    sample.lang = "en";
    sample.delivery = { method: "deliver" };
    delete sample.pickupStore;
    await mail.orderConfirmation(email, sample, "https://mahomarket.com/#orders", "en");
    assert(/Hello/.test(captured[0].html) && !/سلام/.test(captured[0].html), "en email");
    assert(/dir="ltr"/.test(captured[0].html), "en ltr");
    ok("EN confirmation");

    /* Frontend static checks */
    const mainJs = fs.readFileSync(path.join(ROOT, "website", "js", "main.js"), "utf8");
    assert(/onUserSessionExpired/.test(mainJs) && /acct\.sessionExpired/.test(mainJs), "session expiry handler wired");
    assert(/wirePasswordToggle/.test(mainJs) && /pass\.show/.test(mainJs), "password toggle");
    assert(/pay_bank_account/.test(mainJs) && /updateMe\(\{ payments/.test(mainJs), "payment save via API");
    const apiJs = fs.readFileSync(path.join(ROOT, "website", "js", "api.js"), "utf8");
    assert(/emitUserSessionExpired/.test(apiJs), "api 401 emit");
    const indexHtml = fs.readFileSync(path.join(ROOT, "website", "index.html"), "utf8");
    assert(/pay_bank_account/.test(indexHtml) && /pay_bank_routing/.test(indexHtml) && /pay_bank_holder/.test(indexHtml), "bank fields in UI");
    assert(!/id="pay_cvv"/.test(indexHtml), "CVV field removed from account UI");
    ok("frontend static checks");

    console.log("\nALL CHECKS PASSED");
    console.log("DATA_DIR=" + DATA_DIR);
  } finally {
    try { child.kill("SIGTERM"); } catch (_) {}
  }
}

main().catch((err) => {
  console.error("FAIL", err && err.stack || err);
  process.exit(1);
});
