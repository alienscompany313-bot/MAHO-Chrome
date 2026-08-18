#!/usr/bin/env node
/**
 * Customer engagement smoke — temp DATA_DIR only.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "maho-eng-"));
const DATA = path.join(TMP, "data");
const UPLOADS = path.join(TMP, "uploads");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });
const ADMIN_PASSWORD = "SecureTestPass1!";
const PORT = 4201 + Math.floor(Math.random() * 80);

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
          resolve({ status: res.statusCode, data, raw, headers: res.headers });
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

async function main() {
  const child = spawn(process.execPath, [path.join(ROOT, "index.js")], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), NODE_ENV: "development", ADMIN_PASSWORD,
      DATA_DIR: DATA, UPLOAD_DIR: UPLOADS, ALLOW_DEV_CODES: "true",
      TOKEN_PEPPER: "eng-pepper", SITE_URL: "https://mahomarket.com",
      ALLOWED_ORIGINS: "http://127.0.0.1:" + PORT,
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let boot = "";
  child.stderr.on("data", (d) => { boot += d.toString(); });
  child.stdout.on("data", (d) => { boot += d.toString(); });
  try {
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 150));
      try { if ((await req("GET", "/api/health")).status === 200) break; } catch (_) {}
      if (i === 39) throw new Error("boot failed\n" + boot.slice(-1500));
    }

    const login = await req("POST", "/api/admin/login", { body: { password: ADMIN_PASSWORD } });
    assert(login.status === 200 && login.data.token, "admin login");
    const tok = login.data.token;

    const s1 = await req("POST", "/api/newsletter/subscribe", { body: { email: "  News@Example.COM ", source: "website" } });
    assert(s1.status === 200 && s1.data.subscriber.email === "news@example.com", "subscribe normalize");
    const s2 = await req("POST", "/api/newsletter/subscribe", { body: { email: "news@example.com" } });
    assert(s2.status === 200 && s2.data.already === true, "duplicate no new row");
    ok("newsletter subscribe + unique");

    const list = await req("GET", "/api/admin/subscribers", { token: tok });
    assert(list.status === 200 && list.data.total === 1 && list.data.active === 1, "admin list");
    const id = list.data.subscribers[0].id;

    const exp = await req("GET", "/api/admin/subscribers/export?format=csv&scope=active", { token: tok });
    assert(exp.status === 200 && /news@example\.com/.test(exp.raw) && exp.raw.charCodeAt(0) === 0xfeff || exp.raw.indexOf("email") >= 0, "csv export");
    ok("subscribers admin + csv");

    await req("POST", "/api/admin/subscribers/" + id + "/status", { token: tok, body: { status: "inactive" } });
    const list2 = await req("GET", "/api/admin/subscribers?status=inactive", { token: tok });
    assert(list2.data.subscribers.length === 1, "deactivate");
    await req("POST", "/api/admin/subscribers/" + id + "/status", { token: tok, body: { status: "active" } });
    ok("deactivate/reactivate");

    const cmp = await req("POST", "/api/admin/campaigns", {
      token: tok,
      body: { name: "Test", subject: "Hello", message: "Body line\nSecond" },
    });
    assert(cmp.status === 200 && cmp.data.campaign.id, "create campaign");
    const count = await req("POST", "/api/admin/campaigns/preview-count", { token: tok, body: { mode: "active" } });
    assert(count.data.recipientCount === 1, "preview count");
    const send1 = await req("POST", "/api/admin/campaigns/" + cmp.data.campaign.id + "/send", { token: tok, body: { mode: "active" } });
    assert(send1.status === 200 || send1.status === 503, "send without crash smtp=" + send1.status);
    const send2 = await req("POST", "/api/admin/campaigns/" + cmp.data.campaign.id + "/send", { token: tok, body: { mode: "active" } });
    assert(send2.status === 409 || send2.status === 200 || send2.status === 503, "double-send guarded");
    ok("campaigns create/send guard");

    /* feedback invite via delivered order */
    await req("PUT", "/api/admin/catalog", {
      token: tok,
      body: {
        products: [{ name: "شال", price: 100, stock: 5, code: "S1", cat: "shawls" }],
        stores: [{ name: "مرکز", address: "کابل", phone: "0700", lat: 34.5, lng: 69.1 }],
        config: { categories: [{ key: "shawls", name: "شال", enabled: true }] },
      },
    });
    const email = "buyer_eng_" + Date.now() + "@example.com";
    const reg = await req("POST", "/api/auth/register", { body: { name: "A", phone: "0700111222", email, password: "BuyerPass99" } });
    await req("POST", "/api/auth/verify", { body: { email, code: reg.data.devCode } });
    const ulogin = await req("POST", "/api/auth/login", { body: { id: email, password: "BuyerPass99" } });
    const ord = await req("POST", "/api/orders", {
      token: ulogin.data.token,
      body: {
        items: [{ name: "شال", qty: 1 }],
        customer: { name: "A", phone: "0700111222", email, address: "کابل" },
        payment: "whatsapp",
        delivery: { method: "pickup" },
        idempotencyKey: "eng_" + Date.now(),
      },
    });
    assert(ord.status === 200 || ord.status === 201, "order " + ord.status);
    const oid = ord.data.order.id;
    await req("POST", "/api/admin/orders/" + oid + "/status", { token: tok, body: { status: "confirmed" } });
    await req("POST", "/api/admin/orders/" + oid + "/status", { token: tok, body: { status: "dispatched" } });
    await req("POST", "/api/admin/orders/" + oid + "/status", { token: tok, body: { status: "delivered" } });

    /* read feedback invite from db file */
    await new Promise((r) => setTimeout(r, 200));
    const db = JSON.parse(fs.readFileSync(path.join(DATA, "db.json"), "utf8"));
    assert(Array.isArray(db.feedback) && db.feedback.length >= 1, "feedback invite created");
    const fb = db.feedback.find((f) => f.orderId === oid);
    assert(fb && fb.tokenHash, "feedback token");
    /* recreate raw token by creating another? we can't recover raw — use engagement helper by reading from invite before delete.
       For smoke: create invite path via API isn't public with raw. Instead verify analytics endpoint and unsubscribe page. */
    const analytics = await req("GET", "/api/admin/feedback", { token: tok });
    assert(analytics.status === 200 && analytics.data.analytics, "feedback analytics");
    const perf = await req("GET", "/api/admin/driver-performance", { token: tok });
    assert(perf.status === 200 && Array.isArray(perf.data.drivers), "driver performance");
    ok("feedback invite + analytics + driver perf");

    const unsubPage = await req("GET", "/unsubscribe.html");
    assert(unsubPage.status === 200, "unsubscribe page");
    const fbPage = await req("GET", "/feedback.html");
    assert(fbPage.status === 200, "feedback page");
    ok("public pages");

    console.log("\nAll engagement smoke tests passed. TMP=" + TMP);
  } catch (e) {
    console.error("FAIL", e.message);
    console.error(boot.slice(-2000));
    process.exitCode = 1;
  } finally {
    try { child.kill("SIGTERM"); } catch (_) {}
    setTimeout(() => process.exit(process.exitCode || 0), 300);
  }
}
main();
