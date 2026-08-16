#!/usr/bin/env node
/**
 * Dedicated cancel-window + return-after-delivered tests.
 * Uses temporary DATA_DIR only — never Production.
 * Run: node scripts/smoke-cancel-window.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "maho-cancel-"));
const DATA = path.join(TMP, "data");
const UPLOADS = path.join(TMP, "uploads");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });

const ADMIN_PASSWORD = "SecureTestPass1!";
const PORT = 4111 + Math.floor(Math.random() * 80);
/** Short window so HTTP can assert expire without waiting 2 real hours */
const TEST_WINDOW_MS = 250;

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

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  /* Load orders helpers with default 2h window for unit checks */
  delete require.cache[require.resolve("../lib/orders")];
  process.env.CUSTOMER_CANCEL_WINDOW_MS = String(2 * 60 * 60 * 1000);
  delete require.cache[require.resolve("../lib/orders")];
  const ordersLib = require("../lib/orders");
  const {
    CUSTOMER_CANCEL_WINDOW_MS,
    applyApprovedCancelWindow,
    customerCancelInfo,
    customerCanReturn,
  } = ordersLib;

  const results = [];
  const ok = (name) => { results.push("PASS " + name); console.log("PASS", name); };

  const base = 1_700_000_000_000;
  const delOrder = { status: "confirmed", delivery: { method: "deliver", time: "normal" } };
  applyApprovedCancelWindow(delOrder, base);
  assert(delOrder.approvedAt === base, "approvedAt stored");
  assert(delOrder.cancelDeadline === base + CUSTOMER_CANCEL_WINDOW_MS, "cancelDeadline = approvedAt + 2h");
  assert(customerCancelInfo(delOrder, base + 60 * 1000).ok === true, "within 2h ok");
  const expired = customerCancelInfo(delOrder, base + CUSTOMER_CANCEL_WINDOW_MS + 1);
  assert(expired.ok === false && expired.error === "cancel_window_expired", "after 2h rejected (unit)");
  assert(customerCancelInfo(Object.assign({}, delOrder, { status: "dispatched" }), base + 1000).ok === false, "dispatched no cancel");
  assert(customerCancelInfo(Object.assign({}, delOrder, { status: "delivered" }), base + 1000).ok === false, "delivered no cancel");
  assert(customerCanReturn("delivered") === true, "return after delivered");
  assert(customerCanReturn("confirmed") === false, "return before delivered blocked");
  assert(customerCanReturn("dispatched") === false, "return on dispatched blocked");
  const pickup = { status: "confirmed", delivery: { method: "pickup" } };
  applyApprovedCancelWindow(pickup, base);
  assert(pickup.cancelDeadline == null, "pickup no cancel window");
  assert(customerCancelInfo(pickup, base + 1000).ok === false, "pickup confirmed cannot cancel");
  ok("unit cancel window + return rules");

  const child = spawn(process.execPath, [path.join(ROOT, "index.js")], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      NODE_ENV: "development",
      ADMIN_PASSWORD,
      DATA_DIR: DATA,
      UPLOAD_DIR: UPLOADS,
      ALLOW_DEV_CODES: "true",
      TOKEN_PEPPER: "test-pepper-cancel",
      SITE_URL: "http://127.0.0.1:" + PORT,
      ALLOWED_ORIGINS: "http://127.0.0.1:" + PORT,
      CUSTOMER_CANCEL_WINDOW_MS: String(TEST_WINDOW_MS),
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let boot = "";
  child.stdout.on("data", (d) => { boot += d.toString(); });
  child.stderr.on("data", (d) => { boot += d.toString(); });

  try {
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      try {
        const h = await req("GET", "/api/health");
        if (h.status === 200) break;
      } catch (_) {}
      if (i === 39) throw new Error("server did not start\n" + boot.slice(-1500));
    }

    const login = await req("POST", "/api/admin/login", { body: { password: ADMIN_PASSWORD } });
    assert(login.status === 200 && login.data.token, "admin login");
    const adminTok = login.data.token;
    const catalog = {
      products: [{ name: "شال تست", name_en: "Test Shawl", price: 100, stock: 50, code: "T100", cat: "shawls" }],
      stores: [{ name: "مرکز", address: "کابل", phone: "0700000000", mapsUrl: "https://maps.google.com/?q=Kabul", lat: 34.5, lng: 69.1 }],
      config: {
        delivery: { enabled: true, maxKm: 50, perKm: 10, freeKm: 0, urgentFee: 0, minOrder: 0 },
        hesab: { enabled: true, link: "https://hesab.example/pay", number: "1", holder: "MAHO" },
      },
    };
    assert((await req("PUT", "/api/admin/catalog", { body: catalog, token: adminTok })).status === 200, "catalog");

    const email = "cancelwin_" + Date.now() + "@example.com";
    const reg = await req("POST", "/api/auth/register", {
      body: { name: "آیدا", phone: "0700111222", email, password: "BuyerPass99", address: "کابل" },
    });
    assert(reg.status === 200 && reg.data.devCode, "register");
    assert((await req("POST", "/api/auth/verify", { body: { email, code: reg.data.devCode } })).status === 200, "verify");
    const ulogin = await req("POST", "/api/auth/login", { body: { id: email, password: "BuyerPass99" } });
    assert(ulogin.status === 200 && ulogin.data.token, "user login");
    const utok = ulogin.data.token;

    async function placeDeliver(tag) {
      const o = await req("POST", "/api/orders", {
        token: utok,
        body: {
          items: [{ name: "شال تست", qty: 1 }],
          customer: { name: "آیدا", phone: "0700111222", email, address: "کابل" },
          payment: "whatsapp",
          delivery: { method: "deliver", time: "normal", fee: 10 },
          customerLocation: { lat: 34.52, lng: 69.18 },
          idempotencyKey: "cw_" + tag + "_" + Date.now() + "_" + Math.random(),
        },
      });
      assert(o.status === 200 || o.status === 201, "place " + tag + " " + JSON.stringify(o.data));
      return o.data.order;
    }

    /* 1) cancel within window after confirm */
    const o1 = await placeDeliver("in");
    const c1 = await req("POST", "/api/admin/orders/" + o1.id + "/status", { token: adminTok, body: { status: "confirmed" } });
    assert(c1.status === 200 && c1.data.order.status === "confirmed", "confirm in-window");
    assert(c1.data.order.approvedAt, "approvedAt set");
    assert(
      Number(c1.data.order.cancelDeadline) === Number(c1.data.order.approvedAt) + TEST_WINDOW_MS,
      "deadline stored as approvedAt + window"
    );
    const cancel1 = await req("POST", "/api/orders/" + o1.id + "/cancel", { token: utok });
    assert(cancel1.status === 200 && cancel1.data.order.status === "cancelled", "cancel within window " + JSON.stringify(cancel1.data));
    ok("HTTP cancel within 2 hours (short window)");

    /* 2) cancel after window expired */
    const oExp = await placeDeliver("exp");
    const cExp = await req("POST", "/api/admin/orders/" + oExp.id + "/status", { token: adminTok, body: { status: "confirmed" } });
    assert(cExp.status === 200, "confirm exp");
    await sleep(TEST_WINDOW_MS + 120);
    const cancelExp = await req("POST", "/api/orders/" + oExp.id + "/cancel", { token: utok });
    assert(cancelExp.status >= 400, "expired cancel HTTP status");
    assert(cancelExp.data && cancelExp.data.error === "cancel_window_expired", "expired error " + JSON.stringify(cancelExp.data));
    ok("HTTP cancel after 2 hours rejected");

    /* 3) cancel dispatched / delivered rejected */
    const o2 = await placeDeliver("ship");
    await req("POST", "/api/admin/orders/" + o2.id + "/status", { token: adminTok, body: { status: "confirmed" } });
    await req("POST", "/api/admin/orders/" + o2.id + "/status", { token: adminTok, body: { status: "dispatched" } });
    const cancelShip = await req("POST", "/api/orders/" + o2.id + "/cancel", { token: utok });
    assert(cancelShip.status >= 400, "cancel dispatched blocked");
    assert(/shipped|cannot_cancel/i.test(String((cancelShip.data && cancelShip.data.error) || "")), "dispatched error");
    await req("POST", "/api/admin/orders/" + o2.id + "/status", { token: adminTok, body: { status: "delivered" } });
    const cancelDel = await req("POST", "/api/orders/" + o2.id + "/cancel", { token: utok });
    assert(cancelDel.status >= 400, "cancel delivered blocked");
    ok("HTTP cancel dispatched/delivered rejected");

    /* 4) return only after delivered */
    const o3 = await placeDeliver("ret");
    await req("POST", "/api/admin/orders/" + o3.id + "/status", { token: adminTok, body: { status: "confirmed" } });
    const early = await req("POST", "/api/orders/" + o3.id + "/return-request", {
      token: utok, body: { reason: "test", method: "pickup_store" },
    });
    assert(early.status >= 400, "return before delivered blocked");
    await req("POST", "/api/admin/orders/" + o3.id + "/status", { token: adminTok, body: { status: "dispatched" } });
    const mid = await req("POST", "/api/orders/" + o3.id + "/return-request", {
      token: utok, body: { reason: "test", method: "pickup_store" },
    });
    assert(mid.status >= 400, "return while dispatched blocked");
    await req("POST", "/api/admin/orders/" + o3.id + "/status", { token: adminTok, body: { status: "delivered" } });
    const ret = await req("POST", "/api/orders/" + o3.id + "/return-request", {
      token: utok, body: { reason: "سایز", details: "کوچک", method: "pickup_store" },
    });
    assert(ret.status === 200 && ret.data.order.status === "return_requested", "return after delivered");
    ok("HTTP return only after delivered");

    console.log("\nAll cancel-window tests passed (" + results.length + "). TMP=" + TMP);
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
