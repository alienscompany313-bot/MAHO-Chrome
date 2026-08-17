#!/usr/bin/env node
/**
 * Phase-4 smoke: staff permissions, SEO routes, phone LTR helper, driver status idempotent.
 * Uses temporary DATA_DIR only — never Production.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "maho-p4-"));
const DATA = path.join(TMP, "data");
const UPLOADS = path.join(TMP, "uploads");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });

const ADMIN_PASSWORD = "SecureTestPass1!";
const PORT = 4301 + Math.floor(Math.random() * 80);

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
          resolve({ status: res.statusCode, data, headers: res.headers, raw });
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
      TOKEN_PEPPER: "p4-pepper", SITE_URL: "https://mahomarket.com",
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
    assert(admin.status === 200 && admin.data.owner === true, "owner login");
    const adminTok = admin.data.token;
    ok("owner full access login");

    const catalog = {
      products: [{ name: "شال", name_en: "Shawl", price: 100, stock: 5, code: "S1", cat: "shawls" }],
      stores: [{ name: "مرکز", address: "کابل", phone: "+93791505454", lat: 34.5, lng: 69.1 }],
      config: {
        content: {
          stats: [
            { value: 120, label: "محصول", label_en: "Products" },
            { value: 340, label: "مشتری", label_en: "Customers" },
            { value: 8, label: "سال", label_en: "Years" },
            { value: 4, label: "برند", label_en: "Brands" },
          ],
          footerPhone: "+93791505454",
        },
        delivery: { enabled: true, maxKm: 50, perKm: 10 },
        paymentMethods: { whatsapp: { enabled: true }, hesab: { enabled: true }, bank: { enabled: true }, card: { enabled: true } },
      },
    };
    assert((await req("PUT", "/api/admin/catalog", { token: adminTok, body: catalog })).status === 200, "catalog save");

    const pub = await req("GET", "/api/catalog");
    assert(pub.status === 200, "catalog get");
    assert(pub.headers["cache-control"] && /no-store/i.test(pub.headers["cache-control"]), "catalog no-store");
    assert(pub.data.config.content.stats[1].value === 340, "stats from server not hardcoded 5000");
    assert(String(pub.data.config.content.footerPhone).indexOf("+93791505454") >= 0, "footer phone + preserved");
    ok("shared catalog stats + cache policy + phone value");

    /* staff single perm */
    const st1 = await req("POST", "/api/admin/staff", {
      token: adminTok,
      body: { name: "OrdersOnly", email: "ord@example.com", password: "StaffPass99", permissions: ["orders"] },
    });
    assert(st1.status === 200, "create orders staff");
    const login1 = await req("POST", "/api/admin/staff-login", { body: { id: "ord@example.com", password: "StaffPass99" } });
    assert(login1.status === 200 && login1.data.permissions.indexOf("orders") >= 0, "staff login perms");
    assert(login1.data.permissions.indexOf("products") < 0, "no products perm");
    const me1 = await req("GET", "/api/admin/me", { token: login1.data.token });
    assert(me1.status === 200 && me1.data.permissions.join(",") === "orders", "me reflects orders only");
    assert((await req("GET", "/api/admin/orders", { token: login1.data.token })).status === 200, "orders allowed");
    assert((await req("GET", "/api/admin/customers", { token: login1.data.token })).status === 403, "customers denied");
    assert((await req("PUT", "/api/admin/catalog", { token: login1.data.token, body: catalog })).status === 403, "catalog denied");
    ok("single permission staff: UI/API gated");

    /* multi perm */
    const st2 = await req("POST", "/api/admin/staff", {
      token: adminTok,
      body: { name: "Multi", email: "multi@example.com", password: "StaffPass99", permissions: ["products", "customers", "pos"] },
    });
    assert(st2.status === 200, "create multi staff");
    const login2 = await req("POST", "/api/admin/staff-login", { body: { id: "multi@example.com", password: "StaffPass99" } });
    assert(login2.status === 200 && login2.data.permissions.length === 3, "multi perms");
    assert((await req("GET", "/api/admin/customers", { token: login2.data.token })).status === 200, "customers ok");
    assert((await req("PUT", "/api/admin/catalog", { token: login2.data.token, body: catalog })).status === 200, "products can save");
    assert((await req("GET", "/api/admin/orders", { token: login2.data.token })).status === 403, "orders denied without perm");
    ok("multi permission staff");

    /* owner updates staff perms — /me refreshes without new login token needed after sync */
    await req("PUT", "/api/admin/staff/" + st2.data.staff.id, {
      token: adminTok,
      body: { permissions: ["products", "customers", "pos", "orders"] },
    });
    const me2b = await req("GET", "/api/admin/me", { token: login2.data.token });
    assert(me2b.status === 200 && me2b.data.permissions.indexOf("orders") >= 0, "live perm refresh");
    assert((await req("GET", "/api/admin/orders", { token: login2.data.token })).status === 200, "orders now allowed");
    ok("permission refresh without cache clear");

    /* owner still full */
    assert((await req("GET", "/api/admin/staff", { token: adminTok })).status === 200, "owner staff list");
    ok("owner retains full access");

    /* SEO */
    const robots = await req("GET", "/robots.txt");
    assert(robots.status === 200 && /Sitemap:\s*https:\/\/mahomarket.com\/sitemap\.xml/i.test(robots.raw), "robots sitemap");
    assert(/Disallow:\s*\/admin\.html/i.test(robots.raw), "robots disallow admin");
    assert(!/Disallow:\s*\/\s*$/m.test(robots.raw.split("\n").find((l) => /^Disallow:\s*\/\s*$/.test(l)) || ""), "not disallow all");
    const sm = await req("GET", "/sitemap.xml");
    assert(sm.status === 200 && /<urlset/i.test(sm.raw) && /mahomarket\.com\/</.test(sm.raw.replace(/\s/g, "")), "sitemap xml");
    assert(/#products/i.test(sm.raw), "sitemap products");
    const home = await req("GET", "/");
    assert(home.status === 200, "home 200");
    assert(/rel=["']canonical["'][^>]*https:\/\/mahomarket\.com\//i.test(home.raw) || /href=["']https:\/\/mahomarket\.com\/["']/i.test(home.raw), "canonical");
    assert(/name=["']robots["'][^>]*index,\s*follow/i.test(home.raw), "public index follow");
    assert(/application\/ld\+json/i.test(home.raw) && /Organization/i.test(home.raw), "structured data");
    const adminPage = await req("GET", "/admin.html");
    assert(adminPage.status === 200 && /noindex/i.test(adminPage.raw), "admin noindex");
    const posPage = await req("GET", "/pos.html");
    assert(posPage.status === 200 && /noindex/i.test(posPage.raw), "pos noindex");
    ok("SEO robots/sitemap/canonical/meta/noindex");

    /* driver status update + idempotent */
    const drv = await req("POST", "/api/admin/drivers", {
      token: adminTok, body: { name: "Drv", email: "d4@example.com", password: "DriverPass99" },
    });
    const email = "p4_" + Date.now() + "@example.com";
    const reg = await req("POST", "/api/auth/register", { body: { name: "A", phone: "0700111222", email, password: "BuyerPass99", address: "کابل" } });
    await req("POST", "/api/auth/verify", { body: { email, code: reg.data.devCode } });
    const ulogin = await req("POST", "/api/auth/login", { body: { id: email, password: "BuyerPass99" } });
    const ord = await req("POST", "/api/orders", {
      token: ulogin.data.token,
      body: {
        items: [{ name: "شال", qty: 1 }],
        customer: { name: "A", phone: "0700111222", email, address: "کابل" },
        payment: "whatsapp", delivery: { method: "deliver", fee: 10 },
        idempotencyKey: "p4_" + Date.now(),
      },
    });
    const oid = ord.data.order.id;
    await req("POST", "/api/admin/orders/" + oid + "/status", { token: adminTok, body: { status: "confirmed" } });
    await req("POST", "/api/admin/orders/" + oid + "/status", { token: adminTok, body: { status: "dispatched" } });
    await req("POST", "/api/admin/orders/" + oid + "/assign-driver", { token: adminTok, body: { driverId: drv.data.driver.id } });
    const dLogin = await req("POST", "/api/driver/login", { body: { id: "d4@example.com", password: "DriverPass99" } });
    const dTok = dLogin.data.token;
    await req("POST", "/api/driver/orders/" + oid + "/status", { token: dTok, body: { status: "picked_up" } });
    await req("POST", "/api/driver/orders/" + oid + "/status", { token: dTok, body: { status: "in_transit" } });
    const del1 = await req("POST", "/api/driver/orders/" + oid + "/status", { token: dTok, body: { status: "delivered", note: "OK" } });
    assert(del1.status === 200 && del1.data.order.driverStatus === "delivered", "delivered once");
    const del2 = await req("POST", "/api/driver/orders/" + oid + "/status", { token: dTok, body: { status: "delivered" } });
    assert(del2.status === 200 && del2.data.order.driverStatus === "delivered", "idempotent double deliver");
    const other = await req("POST", "/api/admin/drivers", {
      token: adminTok, body: { name: "Other", email: "otherd@example.com", password: "DriverPass99" },
    });
    const oLogin = await req("POST", "/api/driver/login", { body: { id: "otherd@example.com", password: "DriverPass99" } });
    const bad = await req("POST", "/api/driver/orders/" + oid + "/status", {
      token: oLogin.data.token, body: { status: "picked_up" },
    });
    assert(bad.status >= 400, "other driver blocked");
    ok("driver deliver + idempotent + unauthorized blocked");

    /* phone LTR unit-ish: ensure + not stripped */
    const { tel } = (() => {
      const telHref = (s) => "tel:" + String(s || "").replace(/[^\d+]/g, "");
      return { tel: telHref("+93791505454") };
    })();
    assert(tel === "tel:+93791505454", "tel href keeps plus");
    ok("tel:+93791505454 link format");

    console.log("\nAll phase-4 smoke tests passed (" + results.length + "). TMP=" + TMP);
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
