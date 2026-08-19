#!/usr/bin/env node
/**
 * Driver UI split regression — temp DATA_DIR only (never production).
 * Verifies presentation markers + mission classification by API source.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const PORT = 4617 + Math.floor(Math.random() * 200);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "maho-drv-ui-"));
const UPLOADS = path.join(DATA, "uploads");
const ADMIN_PASSWORD = "DrvUiPass99!";
fs.mkdirSync(UPLOADS, { recursive: true });

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assert failed");
}
function ok(msg) {
  console.log("PASS", msg);
}

function req(method, p, { body, token } = {}) {
  const payload = body != null ? JSON.stringify(body) : null;
  const headers = { Accept: "application/json" };
  if (payload) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = Buffer.byteLength(payload);
  }
  if (token) headers.Authorization = "Bearer " + token;
  return new Promise((resolve, reject) => {
    const r = http.request(
      { hostname: "127.0.0.1", port: PORT, path: p, method, headers },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let data = raw;
          try {
            data = JSON.parse(raw);
          } catch (_) {}
          resolve({ status: res.statusCode, data });
        });
      }
    );
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

async function waitHealth(timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const h = await req("GET", "/api/health");
      if (h.status === 200 && h.data && h.data.ok) return h.data;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("health timeout");
}

async function main() {
  /* UI markers (presentation) */
  const html = fs.readFileSync(path.join(ROOT, "../website/driver.html"), "utf8");
  assert(html.includes('id="deliveryCol"'), "deliveryCol");
  assert(html.includes('id="returnsCol"'), "returnsCol");
  assert(html.includes("تحویل سفارش‌ها"), "delivery title");
  assert(html.includes("برگشتی‌ها / جمع‌آوری برگشت"), "returns title");
  assert(html.includes("سفارشی برای تحویل موجود نیست"), "delivery empty");
  assert(html.includes("برگشتی برای جمع‌آوری موجود نیست"), "returns empty");
  assert(html.includes("grid-template-columns:1fr 1fr"), "desktop 2-col");
  assert(/@media\s*\(max-width:\s*820px\)[\s\S]*grid-template-columns:\s*1fr/.test(html), "mobile stack");
  assert(html.includes('data-mission-type="delivery"'), "delivery classification attr");
  assert(html.includes('data-mission-type="return_pickup"'), "return classification attr");
  assert(html.includes("MAHOApi.driverOrders") || html.includes("/api/driver/orders"), "keeps delivery API");
  assert(html.includes("/api/driver/return-pickups"), "keeps return API");
  assert(html.includes('data-st="delivered"') || html.includes("data-st=\\\"delivered\\\""), "delivery actions preserved");
  assert(html.includes("data-ret-confirm"), "return confirm preserved");
  assert(html.includes("already_collected"), "duplicate collection UX preserved");
  ok("UI markers + preserved action hooks");

  const child = spawn(process.execPath, [path.join(ROOT, "index.js")], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      NODE_ENV: "development",
      ADMIN_PASSWORD,
      DATA_DIR: DATA,
      UPLOAD_DIR: UPLOADS,
      ALLOW_DEV_CODES: "true",
      TOKEN_PEPPER: "drv-ui-pepper",
      SITE_URL: "http://127.0.0.1:" + PORT,
      ALLOWED_ORIGINS: "http://127.0.0.1:" + PORT,
      MAIL_DISABLED: "true",
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let boot = "";
  child.stdout.on("data", (d) => (boot += d.toString()));
  child.stderr.on("data", (d) => (boot += d.toString()));

  try {
    await waitHealth(20000);
    assert(!(await req("GET", "/api/health")).data.email, "email disabled");

    const admin = await req("POST", "/api/admin/login", { body: { password: ADMIN_PASSWORD } });
    assert(admin.status === 200 && admin.data.token, "admin login");
    const adminTok = admin.data.token;

    await req("PUT", "/api/admin/catalog", {
      token: adminTok,
      body: {
        products: [{ name: "شال تست", price: 100, stock: 50, code: "PDRV1", cat: "shawls", active: true }],
        stores: [{ id: "store_0", name: "مرکز", address: "کابل", phone: "0700", lat: 34.5, lng: 69.1 }],
        config: { returns: { returnWindowDays: 7, returnPickupPhotoRequired: false } },
      },
    });

    let reasonId = null;
    const reasons = await req("GET", "/api/return-reasons");
    const reasonList = (reasons.data && (reasons.data.reasons || reasons.data)) || [];
    if (Array.isArray(reasonList) && reasonList[0]) reasonId = reasonList[0].id;
    if (!reasonId) {
      const rr = await req("POST", "/api/admin/return-reasons", {
        token: adminTok,
        body: { title: "سایز مناسب نبود", title_en: "Wrong size", active: true },
      });
      reasonId = (rr.data && (rr.data.id || (rr.data.reason && rr.data.reason.id))) || null;
    }

    const email = "ui.customer_" + Date.now() + "@example.com";
    const reg = await req("POST", "/api/auth/register", {
      body: { name: "UI Customer", phone: "0700111222", email, password: "BuyerPass99", marketingConsent: true },
    });
    assert(reg.status === 200 && reg.data && reg.data.devCode, "register " + JSON.stringify(reg.data).slice(0, 200));
    await req("POST", "/api/auth/verify", { body: { email, code: reg.data.devCode } });
    const login = await req("POST", "/api/auth/login", { body: { email, password: "BuyerPass99" } });
    assert(login.status === 200 && login.data.token, "customer login");
    const utok = login.data.token;

    const drv = await req("POST", "/api/admin/drivers", {
      token: adminTok,
      body: {
        name: "UI Driver",
        email: "ui.driver@example.com",
        phone: "0700111222",
        password: "DriverPass99",
      },
    });
    assert(drv.status === 200 || drv.status === 201, "create driver " + drv.status);
    const driverId = (drv.data.driver && drv.data.driver.id) || drv.data.id;
    const dLogin = await req("POST", "/api/driver/login", {
      body: { id: "ui.driver@example.com", password: "DriverPass99" },
    });
    assert(dLogin.status === 200 && dLogin.data.token, "driver login");
    const dTok = dLogin.data.token;

    /* Empty both columns */
    let orders = await req("GET", "/api/driver/orders", { token: dTok });
    let pickups = await req("GET", "/api/driver/return-pickups", { token: dTok });
    assert((orders.data.orders || []).length === 0, "no deliveries initially");
    assert((pickups.data.pickups || []).length === 0, "no returns initially");
    ok("empty APIs for both mission types");

    /* Delivery mission */
    const delivOrd = await req("POST", "/api/orders", {
      token: utok,
      body: {
        items: [{ name: "شال تست", qty: 1 }],
        customer: { name: "مشتری تحویل", phone: "0700111222", email, address: "کابل — آدرس تحویل" },
        payment: "whatsapp",
        delivery: { method: "deliver", fee: 10 },
        customerLocation: { lat: 34.5, lng: 69.1, mapsUrl: "https://maps.google.com/?q=34.5,69.1" },
        idempotencyKey: "drvui_del_" + Date.now(),
      },
    });
    assert(delivOrd.status === 200, "create delivery order " + JSON.stringify(delivOrd.data).slice(0, 200));
    const did = delivOrd.data.order.id;
    await req("POST", "/api/admin/orders/" + did + "/status", { token: adminTok, body: { status: "confirmed" } });
    await req("POST", "/api/admin/orders/" + did + "/status", { token: adminTok, body: { status: "dispatched" } });
    const asgDel = await req("POST", "/api/admin/orders/" + did + "/assign-driver", {
      token: adminTok,
      body: { driverId },
    });
    assert(asgDel.status === 200, "assign delivery driver");

    /* Return pickup mission (separate order) */
    const retBase = await req("POST", "/api/orders", {
      token: utok,
      body: {
        items: [{ name: "شال تست", qty: 1 }],
        customer: { name: "مشتری برگشت", phone: "0700111222", email, address: "کابل" },
        payment: "whatsapp",
        delivery: { method: "deliver", fee: 10 },
        idempotencyKey: "drvui_ret_" + Date.now(),
      },
    });
    assert(retBase.status === 200, "create return base order " + JSON.stringify(retBase.data).slice(0, 300));
    const rid = retBase.data.order.id;
    await req("POST", "/api/admin/orders/" + rid + "/status", { token: adminTok, body: { status: "confirmed" } });
    await req("POST", "/api/admin/orders/" + rid + "/status", { token: adminTok, body: { status: "dispatched" } });
    await req("POST", "/api/admin/orders/" + rid + "/status", { token: adminTok, body: { status: "delivered" } });
    const retReq = await req("POST", "/api/orders/" + rid + "/return-request", {
      token: utok,
      body: {
        method: "pickup_customer",
        reasonId: reasonId || undefined,
        reason: "سایز مناسب نبود",
        address: "کابل — آدرس جمع‌آوری مشتری",
        phone: "0700111222",
        details: "یادداشت تست",
      },
    });
    assert(retReq.status === 200, "return request " + JSON.stringify(retReq.data).slice(0, 240));
    await req("POST", "/api/admin/orders/" + rid + "/return-resolve", {
      token: adminTok,
      body: { status: "return_approved" },
    });
    const asgRet = await req("POST", "/api/admin/orders/" + rid + "/assign-return-driver", {
      token: adminTok,
      body: { driverId, photoRequired: false },
    });
    assert(asgRet.status === 200, "assign return driver " + JSON.stringify(asgRet.data).slice(0, 200));

    orders = await req("GET", "/api/driver/orders", { token: dTok });
    pickups = await req("GET", "/api/driver/return-pickups", { token: dTok });
    const dels = orders.data.orders || [];
    const rets = pickups.data.pickups || [];
    assert(dels.some((o) => o.id === did), "delivery in driver/orders");
    assert(!dels.some((o) => o.id === rid), "return not in delivery list");
    assert(rets.some((p) => p.orderId === rid), "return in return-pickups");
    assert(!rets.some((p) => p.orderId === did), "delivery not in return list");
    const ret = rets.find((p) => p.orderId === rid);
    assert(ret.method === "pickup_customer", "canonical method on pickup DTO");
    assert(ret.missionType === "return_pickup", "missionType return_pickup");
    assert(ret.pickupAddress, "customer pickup address");
    ok("classification by API source (delivery vs return_pickup)");

    /* Delivery status still works */
    const st0 = await req("POST", "/api/driver/orders/" + did + "/status", {
      token: dTok,
      body: { status: "picked_up" },
    });
    assert(st0.status === 200, "delivery picked_up " + JSON.stringify(st0.data).slice(0, 200));
    const st = await req("POST", "/api/driver/orders/" + did + "/status", {
      token: dTok,
      body: { status: "in_transit" },
    });
    assert(st.status === 200, "delivery status update");
    ok("delivery status buttons API still works");

    /* Duplicate collection protection still works */
    const conf1 = await req("POST", "/api/driver/return-pickups/" + rid + "/confirm", {
      token: dTok,
      body: {},
    });
    assert(conf1.status === 200 || conf1.status === 201, "first confirm ok " + JSON.stringify(conf1.data).slice(0, 200));
    const conf2 = await req("POST", "/api/driver/return-pickups/" + rid + "/confirm", {
      token: dTok,
      body: {},
    });
    assert(conf2.status === 409 && conf2.data && conf2.data.error === "already_collected", "duplicate blocked");
    ok("duplicate-collection protection intact");

    /* Page serves split markup */
    const page = await new Promise((resolve, reject) => {
      http.get("http://127.0.0.1:" + PORT + "/driver.html", (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => resolve({ status: res.statusCode, raw }));
      }).on("error", reject);
    });
    assert(page.status === 200 && page.raw.includes("driverCols"), "driver.html served");
    ok("driver.html served with split layout");

    console.log("\nDriver UI split tests PASSED");
  } finally {
    try {
      child.kill("SIGTERM");
    } catch (_) {}
    try {
      fs.rmSync(DATA, { recursive: true, force: true });
    } catch (_) {}
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
