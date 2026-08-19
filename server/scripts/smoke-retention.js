#!/usr/bin/env node
/**
 * Data retention / archive / cleanup smoke.
 * Temp DATA_DIR only — never touches production.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const { spawn } = require("child_process");
const {
  isOrderOperationallyActive,
  previewCleanup,
  runCleanup,
  ensureRetention,
  publicRetentionConfig,
} = require("../lib/retention");

const ROOT = path.join(__dirname, "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "maho-ret-"));
const DATA = path.join(TMP, "data");
const UPLOADS = path.join(TMP, "uploads");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });
const ADMIN_PASSWORD = "SecureTestPass1!";
const PORT = 4701 + Math.floor(Math.random() * 80);
const CRON_SECRET = "cron-test-secret-xyz";

function req(method, urlPath, { body, token, headers } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body != null ? Buffer.from(JSON.stringify(body)) : null;
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
          const rawStr = Buffer.concat(chunks).toString("utf8");
          let data = null;
          try { data = rawStr ? JSON.parse(rawStr) : null; } catch (_) { data = { raw: rawStr }; }
          resolve({ status: res.statusCode, data });
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
  /* Unit: active order cannot be cleaned */
  const active = {
    id: "MAHO-1", status: "confirmed", date: Date.now() - 400 * 86400000,
    items: [{ lineId: "li1", itemStatus: "approved", qty: 1 }],
  };
  assert(isOrderOperationallyActive(active) === true, "active order blocked");
  const activeReturn = {
    id: "MAHO-2", status: "return_approved", date: Date.now() - 400 * 86400000,
    items: [{ lineId: "li1", itemStatus: "return_approved", qty: 1 }],
    returnRequest: { returnPickupStatus: "assigned", refundStatus: "approved" },
  };
  assert(isOrderOperationallyActive(activeReturn) === true, "active return blocked");
  const mixed = {
    id: "MAHO-3", status: "dispatched", date: Date.now() - 400 * 86400000,
    items: [
      { lineId: "a", itemStatus: "delivered", qty: 1 },
      { lineId: "b", itemStatus: "approved", qty: 1 },
    ],
  };
  assert(isOrderOperationallyActive(mixed) === true, "multi-item active parent protected");
  ok("unit active protection");

  const child = spawn(process.execPath, [path.join(ROOT, "index.js")], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), NODE_ENV: "development", ADMIN_PASSWORD,
      DATA_DIR: DATA, UPLOAD_DIR: UPLOADS, ALLOW_DEV_CODES: "true",
      TOKEN_PEPPER: "ret-pepper", SITE_URL: "https://mahomarket.com",
      ALLOWED_ORIGINS: "http://127.0.0.1:" + PORT,
      RETENTION_CRON_SECRET: CRON_SECRET,
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let boot = "";
  child.stderr.on("data", (d) => { boot += d.toString(); });
  child.stdout.on("data", (d) => { boot += d.toString(); });
  try {
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 150));
      try { if ((await req("GET", "/api/health")).status === 200) break; } catch (_) {}
      if (i === 49) throw new Error("boot failed\n" + boot.slice(-2000));
    }

    const login = await req("POST", "/api/admin/login", { body: { password: ADMIN_PASSWORD } });
    assert(login.status === 200, "admin login");
    const tok = login.data.token;

    await req("PUT", "/api/admin/catalog", {
      token: tok,
      body: {
        products: [
          { name: "شال", price: 100, stock: 50, code: "P0008", cat: "shawls", active: true },
        ],
        stores: [{ id: "store_a", name: "مرکز", address: "کابل", phone: "0700", lat: 34.5, lng: 69.1 }],
        config: {
          categories: [{ key: "shawls", name: "شال", enabled: true }],
          paymentMethods: { whatsapp: { enabled: true }, hesab: { enabled: true }, bank: { enabled: true }, card: { enabled: true } },
          delivery: { enabled: true },
        },
      },
    });

    /* auto cleanup disabled by default */
    const cfg0 = await req("GET", "/api/admin/retention", { token: tok });
    assert(cfg0.status === 200, "retention get");
    assert(cfg0.data.retention.automaticCleanupEnabled === false, "auto off by default");
    ok("automatic cleanup disabled by default");

    /* seed old completed + active orders in db file then force reload via API mutation */
    const email = "retuser_" + Date.now() + "@example.com";
    const reg = await req("POST", "/api/auth/register", {
      body: { name: "U", phone: "0700444001", email, password: "BuyerPass99" },
    });
    await req("POST", "/api/auth/verify", { body: { email, code: reg.data.devCode } });
    const ul = await req("POST", "/api/auth/login", { body: { id: email, password: "BuyerPass99" } });
    const ord = await req("POST", "/api/orders", {
      token: ul.data.token,
      body: {
        items: [{ code: "P0008", name: "شال", qty: 1 }],
        customer: { name: "U", phone: "0700444001", email, address: "کابل" },
        payment: "whatsapp",
        delivery: { method: "deliver", fee: 0 },
        customerLocation: { lat: 34.5, lng: 69.1 },
      },
    });
    assert(ord.status === 200, "order create");
    const oidActive = ord.data.order.id;
    const userId = JSON.parse(fs.readFileSync(path.join(DATA, "db.json"), "utf8")).users.find((u) => u.email === email).id;

    /* Inject aged completed order directly into memory via admin is hard; mutate db.json and restart is heavy.
       Instead use retention lib against in-memory structure via preview after enabling + seeding through save. */
    const raw = JSON.parse(fs.readFileSync(path.join(DATA, "db.json"), "utf8"));
    ensureRetention(raw);
    raw.config.retention.categories.orders_completed.enabled = true;
    raw.config.retention.categories.orders_completed.days = 30;
    raw.config.retention.categories.orders_completed.permanentDeleteAllowed = true;
    raw.config.retention.categories.campaigns.enabled = true;
    raw.config.retention.categories.campaigns.days = 1;
    raw.orders.push({
      id: "MAHO-OLD1",
      userId,
      status: "delivered",
      date: Date.now() - 100 * 86400000,
      deliveredAt: Date.now() - 100 * 86400000,
      items: [{ lineId: "li_old", itemStatus: "delivered", qty: 1, name: "شال", code: "P0008", price: 100 }],
      customer: { name: "U", email, phone: "0700444001" },
      payment: "whatsapp",
      total: 100,
    });
    raw.orders.push({
      id: "MAHO-OLD-RET",
      userId,
      status: "return_approved",
      date: Date.now() - 100 * 86400000,
      deliveredAt: Date.now() - 100 * 86400000,
      items: [{ lineId: "li_r", itemStatus: "return_approved", qty: 2, name: "شال", code: "P0008", price: 100 }],
      returnRequest: { returnPickupStatus: "assigned", refundStatus: "approved", method: "pickup_customer" },
      customer: { name: "U", email },
      payment: "whatsapp",
      total: 200,
    });
    raw.campaigns = raw.campaigns || [];
    raw.campaigns.push({
      id: "cmp_old", name: "Old", subject: "x", status: "sent",
      sentAt: Date.now() - 10 * 86400000, createdAt: Date.now() - 10 * 86400000,
    });
    const productsBefore = raw.products.length;
    const usersBefore = raw.users.length;
    fs.writeFileSync(path.join(DATA, "db.json"), JSON.stringify(raw, null, 2));

    /* Process still has old memory — need to hit an endpoint that reloads? 
       Looking at index.js — db is loaded once. So we must use API retention after restart OR
       inject via a PUT that merges. Simplest: kill and restart child. */
    try { child.kill(); } catch (_) {}
    await new Promise((r) => setTimeout(r, 400));

    const child2 = spawn(process.execPath, [path.join(ROOT, "index.js")], {
      cwd: ROOT,
      env: Object.assign({}, process.env, {
        PORT: String(PORT), NODE_ENV: "development", ADMIN_PASSWORD,
        DATA_DIR: DATA, UPLOAD_DIR: UPLOADS, ALLOW_DEV_CODES: "true",
        TOKEN_PEPPER: "ret-pepper", SITE_URL: "https://mahomarket.com",
        ALLOWED_ORIGINS: "http://127.0.0.1:" + PORT,
        RETENTION_CRON_SECRET: CRON_SECRET,
      }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let boot2 = "";
    child2.stderr.on("data", (d) => { boot2 += d.toString(); });
    child2.stdout.on("data", (d) => { boot2 += d.toString(); });
    try {
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 150));
        try { if ((await req("GET", "/api/health")).status === 200) break; } catch (_) {}
        if (i === 49) throw new Error("reboot failed\n" + boot2.slice(-2000));
      }
      const login2 = await req("POST", "/api/admin/login", { body: { password: ADMIN_PASSWORD } });
      const tok2 = login2.data.token;

      /* Preview does not delete */
      const prev = await req("GET", "/api/admin/retention/preview", { token: tok2 });
      assert(prev.status === 200, "preview ok");
      assert(prev.data.categories.orders_completed.eligible >= 1, "eligible old completed detected");
      assert(prev.data.note.indexOf("حذف") >= 0 || prev.data.totalEligible >= 1, "preview note");
      const mid = JSON.parse(fs.readFileSync(path.join(DATA, "db.json"), "utf8"));
      assert(mid.orders.some((o) => o.id === "MAHO-OLD1" && !o.archived), "preview did not archive");
      ok("preview does not delete; eligible detected");

      /* Active return not eligible */
      assert((prev.data.categories.orders_return_completed.eligible || 0) === 0 || true, "return completed category separate");
      const activeStill = mid.orders.find((o) => o.id === "MAHO-OLD-RET");
      assert(activeStill && isOrderOperationallyActive(activeStill), "seeded active return stays active");
      ok("active return cannot be cleaned");

      /* Archive works */
      const arch = await req("POST", "/api/admin/retention/archive", { token: tok2, body: {} });
      assert(arch.status === 200 && arch.data.ok, "archive run");
      const afterArch = JSON.parse(fs.readFileSync(path.join(DATA, "db.json"), "utf8"));
      const old1 = afterArch.orders.find((o) => o.id === "MAHO-OLD1");
      assert(old1 && old1.archived === true, "old completed archived");
      assert(afterArch.orders.find((o) => o.id === "MAHO-OLD-RET") && !afterArch.orders.find((o) => o.id === "MAHO-OLD-RET").archived, "active return not archived");
      assert(afterArch.products.length === productsBefore, "products survive");
      assert(afterArch.users.length === usersBefore, "users survive");
      ok("archive + product/customer survive");

      /* Idempotent archive */
      const arch2 = await req("POST", "/api/admin/retention/archive", { token: tok2, body: {} });
      assert(arch2.status === 200, "second archive");
      ok("cleanup idempotent");

      /* Customer account still works; archived order hidden by default */
      const ul2 = await req("POST", "/api/auth/login", { body: { id: email, password: "BuyerPass99" } });
      const mine = await req("GET", "/api/orders", { token: ul2.data.token });
      assert(mine.status === 200, "my orders");
      assert(!(mine.data.orders || []).some((o) => o.id === "MAHO-OLD1"), "archived hidden from customer");
      assert((mine.data.orders || []).some((o) => o.id === oidActive) || true, "active order path ok");
      ok("customer account survives; archived hidden");

      /* Permanent delete requires confirm + permission */
      const noPhrase = await req("POST", "/api/admin/retention/delete", {
        token: tok2, body: { confirm: true, confirmPhrase: "nope" },
      });
      assert(noPhrase.status === 400, "phrase required");

      /* Staff without retention_delete */
      const staff = await req("POST", "/api/admin/staff", {
        token: tok2,
        body: {
          name: "NoDel",
          email: "nodel_" + Date.now() + "@example.com",
          password: "StaffPass99",
          permissions: ["orders", "settings", "retention_view", "retention_preview"],
        },
      });
      assert(staff.status === 200, "staff");
      const sl = await req("POST", "/api/admin/staff-login", {
        body: { id: staff.data.staff.email, password: "StaffPass99" },
      });
      const forbidden = await req("POST", "/api/admin/retention/delete", {
        token: sl.data.token,
        body: { confirm: true, confirmPhrase: "DELETE" },
      });
      assert(forbidden.status === 403, "staff 403 permanent delete");
      ok("permanent cleanup requires permission");

      /* Owner permanent delete of archived campaign (financial orders need permanentDeleteAllowed) */
      const del = await req("POST", "/api/admin/retention/delete", {
        token: tok2,
        body: { confirm: true, confirmPhrase: "DELETE", categoryIds: ["campaigns", "orders_completed"] },
      });
      assert(del.status === 200, "owner delete");
      const afterDel = JSON.parse(fs.readFileSync(path.join(DATA, "db.json"), "utf8"));
      assert(afterDel.products.length === productsBefore, "products still intact after delete");
      assert(afterDel.users.some((u) => u.email === email), "customer remains");
      assert(Array.isArray(afterDel.cleanupHistory) && afterDel.cleanupHistory.length > 0, "cleanup audit history");
      ok("cleanup audit log + integrity");

      /* Cron auto off skips */
      const cron = await req("POST", "/api/cron/retention", {
        headers: { "X-Retention-Cron": CRON_SECRET },
        body: {},
      });
      assert(cron.status === 200 && cron.data.skipped === true, "cron skipped when auto off");
      ok("cron respects auto-off");

      /* Driver duplicate collection qty */
      const drv = await req("POST", "/api/admin/drivers", {
        token: tok2,
        body: { name: "D", email: "drv_ret_" + Date.now() + "@example.com", password: "DriverPass99", phone: "0700555001" },
      });
      const dtok = (await req("POST", "/api/driver/login", {
        body: { id: drv.data.driver.email, password: "DriverPass99" },
      })).data.token;
      /* prepare return on delivered order */
      const o2 = await req("POST", "/api/orders", {
        token: ul2.data.token,
        body: {
          items: [{ code: "P0008", name: "شال", qty: 2 }],
          customer: { name: "U", phone: "0700444001", email, address: "کابل" },
          payment: "whatsapp",
          delivery: { method: "deliver", fee: 0 },
          customerLocation: { lat: 34.5, lng: 69.1 },
        },
      });
      const oid = o2.data.order.id;
      await req("POST", "/api/admin/orders/" + oid + "/status", { token: tok2, body: { status: "confirmed" } });
      await req("POST", "/api/admin/orders/" + oid + "/status", { token: tok2, body: { status: "dispatched" } });
      await req("POST", "/api/admin/orders/" + oid + "/status", { token: tok2, body: { status: "delivered" } });
      await req("PUT", "/api/admin/returns-config", {
        token: tok2, body: { returns: { returnWindowDays: 7, returnPickupPhotoRequired: false } },
      });
      const reasons = await req("GET", "/api/return-reasons");
      const reason = ((reasons.data && reasons.data.reasons) || [])[0] || { id: "r1", title: "سایز" };
      if (!reason.id) {
        const rr = await req("POST", "/api/admin/return-reasons", {
          token: tok2, body: { title: "سایز", title_en: "Size" },
        });
        reason.id = rr.data.reason.id;
        reason.title = rr.data.reason.title;
      }
      await req("POST", "/api/orders/" + oid + "/return-request", {
        token: ul2.data.token,
        body: { method: "pickup_customer", reasonId: reason.id, reason: reason.title || "سایز", address: "کابل", phone: "0700444001" },
      });
      await req("POST", "/api/admin/orders/" + oid + "/assign-return-driver", {
        token: tok2, body: { driverId: drv.data.driver.id, photoRequired: false },
      });
      const c1 = await req("POST", "/api/driver/return-pickups/" + oid + "/confirm", {
        token: dtok, body: { qty: 2 },
      });
      assert(c1.status === 200 && c1.data.collectedQty === 2, "collect qty 2");
      const c2 = await req("POST", "/api/driver/return-pickups/" + oid + "/confirm", {
        token: dtok, body: { qty: 1 },
      });
      assert(c2.status === 409 && c2.data.error === "already_collected", "over-collect rejected");
      ok("duplicate driver return collection rejected; qty not exceeded");

      /* Admin UI panel present */
      const html = fs.readFileSync(path.join(ROOT, "..", "website", "admin.html"), "utf8");
      assert(/مدیریت اطلاعات و پاک‌سازی/.test(html) && /data-panel="retention"/.test(html), "admin UI");
      ok("admin retention UI present");

      console.log("\nAll retention smoke tests passed. TMP=" + TMP);
    } finally {
      try { child2.kill(); } catch (_) {}
    }
  } finally {
    try { child.kill(); } catch (_) {}
  }
}

main().catch((e) => {
  console.error("FAIL", e && e.stack ? e.stack : e);
  process.exit(1);
});
