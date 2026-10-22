#!/usr/bin/env node
"use strict";
/**
 * Isolated checks for the local MAHO upgrade. Uses a temporary DATA_DIR.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const { spawn } = require("child_process");
const hours = require("../lib/upgrade/hours");
const backups = require("../lib/upgrade/backups");

const ROOT = path.join(__dirname, "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "maho-upgrade-"));
const DATA = path.join(TMP, "data");
const UPLOADS = path.join(TMP, "uploads");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });
const ADMIN_PASSWORD = "SecureTestPass1!";
const PORT = 4700 + Math.floor(Math.random() * 200);
const results = [];
const assert = (c, m) => { if (!c) throw new Error(m || "assert"); };
const ok = (name) => { results.push(name); console.log("PASS", name); };

function req(method, urlPath, { body, token } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body != null ? Buffer.from(JSON.stringify(body)) : null;
    const headers = { Accept: "application/json" };
    if (token) headers.Authorization = "Bearer " + token;
    if (payload) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(payload.length);
    }
    const r = http.request({ hostname: "127.0.0.1", port: PORT, path: urlPath, method, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let data = null;
        try { data = raw ? JSON.parse(raw) : null; } catch (_) { data = { raw: raw }; }
        resolve({ status: res.statusCode, data: data, raw: raw, headers: res.headers });
      });
    });
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}
function rawGet(urlPath, token) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (token) headers.Authorization = "Bearer " + token;
    const r = http.request({ hostname: "127.0.0.1", port: PORT, path: urlPath, method: "GET", headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, buf: Buffer.concat(chunks), headers: res.headers }));
    });
    r.on("error", reject);
    r.end();
  });
}

function checkHours() {
  const fri = hours.statusFor(null, new Date("2026-10-23T07:00:00Z"));
  const friClosed = hours.statusFor(null, new Date("2026-10-23T07:30:00Z"));
  const sat = hours.statusFor(null, new Date("2026-10-24T04:00:00Z"));
  const satClosed = hours.statusFor(null, new Date("2026-10-24T15:30:00Z"));
  assert(fri.open && fri.time === "11:30", "friday morning open");
  assert(!friClosed.open && friClosed.time === "12:00", "friday noon closed");
  assert(sat.open, "saturday open");
  assert(!satClosed.open, "saturday 20:00 closed");
  const special = hours.normalizeSchedule({ closures: [{ date: "2026-10-24", closed: true, note: "عید" }] });
  const closedDay = hours.statusFor(special, new Date("2026-10-24T04:00:00Z"));
  assert(!closedDay.open && closedDay.reason === "closure", "special closure");
  ok("kabul hours");
}

function checkBackup() {
  const src = path.join(TMP, "bak-src");
  const up = path.join(src, "uploads");
  fs.mkdirSync(up, { recursive: true });
  fs.writeFileSync(path.join(src, "db.json"), JSON.stringify({ products: [{ code: "T" }], orders: [{ id: "MAHO-1" }] }));
  fs.writeFileSync(path.join(up, "a.txt"), "hello-upload");
  const dir = path.join(TMP, "backups");
  const secret = "test-backup-secret-not-production";
  const made = backups.createBackup({ dataDir: src, uploadDir: up, backupDir: dir, secret: secret });
  assert(made.ok && made.files === 2, "backup created");
  const target = path.join(TMP, "restored");
  const back = backups.restoreBackup({ file: made.file, secret: secret, targetDir: target });
  assert(back.ok, "restore");
  assert(fs.readFileSync(path.join(target, "uploads", "a.txt"), "utf8") === "hello-upload", "upload restored");
  const db = JSON.parse(fs.readFileSync(path.join(target, "db.json"), "utf8"));
  assert(db.orders[0].id === "MAHO-1", "order restored");
  const prevData = process.env.DATA_DIR;
  process.env.DATA_DIR = src;
  const refused = backups.restoreBackup({ file: made.file, secret: secret, targetDir: src });
  process.env.DATA_DIR = prevData;
  assert(!refused.ok && refused.error === "refusing_live_data_dir", "refuses live data dir");
  ok("encrypted backup roundtrip");
}

async function main() {
  checkHours();
  checkBackup();
  const child = spawn(process.execPath, [path.join(ROOT, "index.js")], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      NODE_ENV: "development",
      ADMIN_PASSWORD,
      DATA_DIR: DATA,
      UPLOAD_DIR: UPLOADS,
      ALLOW_DEV_CODES: "true",
      TOKEN_PEPPER: "upgrade-pepper",
      SITE_URL: "http://127.0.0.1:" + PORT,
      ALLOWED_ORIGINS: "http://127.0.0.1:" + PORT,
      SALES_NOTIFY_EMAIL: "sales@mahomarket.com",
      ORDERS_NOTIFY_EMAIL: "orders@mahomarket.com",
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let boot = "";
  child.stdout.on("data", (d) => { boot += d; });
  child.stderr.on("data", (d) => { boot += d; });
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 150));
    try { if ((await req("GET", "/api/health")).status === 200) break; } catch (_) {}
    if (i === 39) throw new Error("boot\n" + boot.slice(-800));
  }
  try {
    const noTerms = await req("POST", "/api/auth/register", { body: { name: "A", phone: "0700111222", email: "a@example.com", password: "BuyerPass99" } });
    assert(noTerms.status === 400 && noTerms.data.error === "terms_required", "terms required");
    ok("terms required");

    const login = await req("POST", "/api/admin/login", { body: { password: ADMIN_PASSWORD } });
    assert(login.status === 200 && login.data.need2fa && !login.data.token && login.data.devCode, "no session before 2fa");
    const db1 = fs.readFileSync(path.join(DATA, "db.json"), "utf8");
    assert(!db1.includes(login.data.devCode), "code not stored plaintext");
    const bad = await req("POST", "/api/admin/login/2fa", { body: { challengeId: login.data.challengeId, code: "000000" } });
    assert(bad.status === 400, "bad code");
    const good = await req("POST", "/api/admin/login/2fa", { body: { challengeId: login.data.challengeId, code: login.data.devCode } });
    assert(good.status === 200 && good.data.token && good.data.owner === true, "2fa session");
    const adminTok = good.data.token;
    ok("admin email 2fa");

    const email = "card_" + Date.now() + "@example.com";
    const reg = await req("POST", "/api/auth/register", { body: { acceptTerms: true, name: "Sahar Ahmadi", phone: "0700111222", email: email, password: "BuyerPass99", address: "کابل" } });
    assert(reg.status === 200 && reg.data.devCode, "register");
    const ver = await req("POST", "/api/auth/verify", { body: { email: email, code: reg.data.devCode } });
    assert(ver.status === 200 && ver.data.user && ver.data.user.customerNo, "verify");
    assert(!ver.data.user.card || !ver.data.user.card.token, "public user hides card token");
    assert(!JSON.stringify(ver.data.user).includes("tokenHash"), "no token hash in profile");
    const userTok = ver.data.token;
    const db = JSON.parse(fs.readFileSync(path.join(DATA, "db.json"), "utf8"));
    const user = db.users.find((u) => u.email === email);
    assert(user.policyAcceptance && user.policyAcceptance.acceptedAt, "policy acceptance stored");
    assert(user.card && user.card.token && user.card.tokenHash && user.customerNo, "card created");
    const token = user.card.token;
    const pub = await req("GET", "/api/verify/" + token);
    assert(pub.status === 200 && pub.data.status === "active" && pub.data.brand === "MAHO", "verify active");
    assert(!pub.raw.includes(email) && !pub.raw.includes("Sahar"), "verify has no customer details");
    const page = await rawGet("/verify/" + token);
    assert(page.status === 200 && !page.buf.toString("utf8").includes(email), "verify page has no email");
    const png = await rawGet("/api/me/card.png", userTok);
    assert(png.status === 200 && png.buf.slice(0, 4).toString("hex") === "89504e47", "png");
    const pdf = await rawGet("/api/me/card.pdf", userTok);
    assert(pdf.status === 200 && pdf.buf.slice(0, 4).toString() === "%PDF", "pdf");
    const anon = await rawGet("/api/me/card.png");
    assert(anon.status === 401, "card file is private");
    const replaced = await req("POST", "/api/admin/customers/" + user.id + "/card", { token: adminTok, body: { replaceToken: true } });
    assert(replaced.status === 200 && replaced.data.card.status === "active", "replaced");
    const old = await req("GET", "/api/verify/" + token);
    assert(old.data.status === "revoked", "old qr revoked");
    const db2 = JSON.parse(fs.readFileSync(path.join(DATA, "db.json"), "utf8"));
    const user2 = db2.users.find((u) => u.id === user.id);
    assert(user2.customerNo === user.customerNo && user2.card.token !== token, "number kept");
    const neu = await req("GET", "/api/verify/" + user2.card.token);
    assert(neu.data.status === "active", "new qr active");
    const staff = await req("GET", "/api/admin/cards/lookup?token=" + user2.card.token, { token: adminTok });
    assert(staff.status === 200 && staff.data.email === email && staff.data.customerNo === user.customerNo, "staff lookup");
    const guestLookup = await req("GET", "/api/admin/cards/lookup?token=" + user2.card.token);
    assert(guestLookup.status === 401, "staff lookup locked");
    ok("customer card and qr");

    await req("PUT", "/api/admin/catalog", {
      token: adminTok,
      body: {
        products: [{ name: "شال", code: "T100", price: 100, stock: 3 }],
        stores: [{ name: "MAHO", lat: "34.51", lng: "69.12", map: "https://maps.google.com/?q=34.51,69.12" }],
      },
    });
    const order = await req("POST", "/api/orders", {
      token: userTok,
      body: {
        items: [{ name: "شال", code: "T100", qty: 1 }],
        customer: { name: "Sahar Ahmadi", phone: "0700111222", email: email, address: "کابل" },
        payment: "whatsapp",
        delivery: { method: "deliver", time: "normal" },
        customerLocation: { lat: 34.52, lng: 69.18, accuracy: 20 },
      },
    });
    assert(order.status === 200 && order.data.order && order.data.order.id, "order " + (order.data && order.data.error));
    const notes = await req("GET", "/api/admin/order-notifications", { token: adminTok });
    assert(notes.status === 200 && notes.data.unread >= 1, "admin notification");
    assert(notes.data.notifications.some((n) => n.orderId === order.data.order.id), "notification matches order");
    ok("new order notification");

    const hoursRes = await req("GET", "/api/store-hours");
    assert(hoursRes.data.timezone === "Asia/Kabul" && hoursRes.data.week.length === 7, "hours api");
    ok("hours api");

    const draft = await req("POST", "/api/admin/policies/terms", { token: adminTok, body: { version: "9.9", title: "مخفی", title_en: "Hidden", body: "SECRET DRAFT", body_en: "SECRET DRAFT EN" } });
    assert(draft.status === 200, "draft");
    const hidden = await req("GET", "/api/policies/terms");
    assert(hidden.status === 404, "draft not public");
    const pubPol = await req("POST", "/api/admin/policies/terms/" + draft.data.version.id + "/publish", { token: adminTok, body: {} });
    assert(pubPol.status === 200, "publish");
    const shown = await req("GET", "/api/policies/terms");
    assert(shown.status === 200 && shown.data.policy.body.indexOf("SECRET DRAFT") >= 0, "published visible");
    ok("policy draft and publish");

    const badMap = await req("PUT", "/api/admin/site-meta", { token: adminTok, body: { footerMapsUrl: "javascript:alert(1)" } });
    assert(badMap.status === 400, "bad map url");
    const map = await req("PUT", "/api/admin/site-meta", { token: adminTok, body: { footerMapsUrl: "https://maps.google.com/?q=kabul", documentTitle: "فروشگاه ماهو", documentTitle_en: "MAHO Shop" } });
    assert(map.status === 200 && map.data.siteMeta.footerMapsUrl.indexOf("https://") === 0, "map saved");
    const catalog = await req("GET", "/api/catalog");
    assert(catalog.data.site.footerMapsUrl.indexOf("maps.google.com") >= 0, "map public");
    assert(catalog.data.site.documentTitle === "فروشگاه ماهو", "tab title public");
    ok("footer map and tab title");

    const future = Date.now() + 7 * 86400000;
    const past = Date.now() - 86400000;
    await req("PUT", "/api/admin/ads/announcement", {
      token: adminTok,
      body: { items: [
        { enabled: false, title: "پنهان", url: "https://example.com", order: 2 },
        { enabled: true, title: "نمایان", url: "https://example.com/live", order: 0, startAt: past, endAt: future },
        { enabled: true, title: "آینده", url: "https://example.com/later", order: 1, startAt: future },
      ] },
    });
    const ads = await req("GET", "/api/catalog");
    const titles = (ads.data.site.ads.announcement || []).map((a) => a.title);
    assert(titles.indexOf("نمایان") >= 0 && titles.indexOf("پنهان") < 0 && titles.indexOf("آینده") < 0, "only live ads");
    const adminAds = await req("GET", "/api/admin/ads", { token: adminTok });
    assert((adminAds.data.announcement || []).length === 3, "admin keeps scheduled and disabled ads");
    const adminJs = fs.readFileSync(path.join(ROOT, "..", "website", "js", "admin-upgrade.js"), "utf8");
    assert(adminJs.includes("datetime-local") && adminJs.includes("data-ad-preview") && adminJs.includes("data-ad-move"), "ad date preview reorder controls");
    ok("ads enable filter");

    const links = await rawGet("/links");
    assert(links.status === 200 && links.buf.toString("utf8").includes("maho-logo.jpg"), "links page logo");
    const qr = await rawGet("/links/qr.png");
    assert(qr.status === 200 && qr.buf.slice(0, 4).toString("hex") === "89504e47", "links qr png");
    const svg = await rawGet("/links/qr.svg");
    assert(svg.status === 200 && svg.buf.toString("utf8").includes("<svg"), "links qr svg");
    const currentLinks = await req("GET", "/api/admin/links", { token: adminTok });
    assert(currentLinks.status === 200 && Array.isArray(currentLinks.data.links), "admin links list");
    const edited = currentLinks.data.links.map((row) => Object.assign({}, row));
    const ig = edited.find((row) => row.kind === "instagram") || edited[1];
    ig.url = "https://instagram.com/mahomarket";
    ig.enabled = true;
    ig.label = "اینستاگرام ماهو";
    ig.order = 0;
    const siteLink = edited.find((row) => row.kind === "website");
    if (siteLink) siteLink.order = 5;
    const savedLinks = await req("PUT", "/api/admin/links", { token: adminTok, body: { links: edited } });
    assert(savedLinks.status === 200, "save links");
    const page2 = await rawGet("/links");
    const html = page2.buf.toString("utf8");
    assert(html.includes("https://instagram.com/mahomarket") && html.includes("maho-logo.jpg"), "links page shows enabled instagram");
    const badLink = await req("PUT", "/api/admin/links", { token: adminTok, body: { links: [{ label: "بد", url: "javascript:alert(1)", enabled: true, kind: "bad", order: 0 }] } });
    assert(badLink.status === 200, "bad url accepted as empty");
    const hiddenBad = await rawGet("/links");
    assert(!hiddenBad.buf.toString("utf8").includes("javascript:"), "unsafe link not published");
    ok("links page");

    const pk = await req("POST", "/api/auth/passkey/register-options", { token: userTok, body: {} });
    assert(pk.status === 200 && pk.data.options && pk.data.options.challenge && pk.data.challengeId, "passkey options");
    assert(pk.data.options.rp && pk.data.options.user && pk.data.options.user.name, "passkey rp and user");
    const pkAnon = await req("POST", "/api/auth/passkey/register-options", { body: {} });
    assert(pkAnon.status === 401, "passkey enroll needs login");
    const pkLogin = await req("POST", "/api/auth/passkey/login-options", { body: {} });
    assert(pkLogin.status === 200 && pkLogin.data.options && pkLogin.data.options.challenge && pkLogin.data.challengeId, "passkey login options");
    const pkBad = await req("POST", "/api/auth/passkey/login", { body: { challengeId: pkLogin.data.challengeId, credential: { id: "nope", rawId: "nope", type: "public-key", response: {} } } });
    assert(pkBad.status === 400, "bad passkey login rejected");
    const pkRegBad = await req("POST", "/api/auth/passkey/register", { token: userTok, body: { challengeId: pk.data.challengeId, credential: { id: "nope" } } });
    assert(pkRegBad.status === 400, "bad passkey register rejected");
    const pkList = await req("GET", "/api/me/passkeys", { token: userTok });
    assert(pkList.status === 200 && Array.isArray(pkList.data.passkeys) && pkList.data.passkeys.length === 0, "no passkey stored");
    const pkDel = await req("DELETE", "/api/me/passkeys/missing", { token: userTok });
    assert(pkDel.status === 404, "missing passkey delete");
    console.log("BLOCKED passkey Face ID / Windows Hello ceremony — no platform authenticator in this runner");
    ok("passkey enrollment options");

    const delAudit = await req("DELETE", "/api/admin/audit", { token: adminTok });
    assert(delAudit.status === 405, "audit append only");
    ok("audit locked");

    const renamed = await req("PUT", "/api/admin/catalog", {
      token: adminTok,
      body: {
        products: [{ name: "شال ویرایش‌شده", code: "T100", price: 100, stock: 3 }],
        stores: [
          { id: "store_a", name: "شعبه الف", lat: "34.51", lng: "69.12" },
          { id: "store_b", name: "شعبه ب", lat: "34.55", lng: "69.20" },
        ],
      },
    });
    assert(renamed.status === 200, "rename product");
    const audit = await req("GET", "/api/admin/audit", { token: adminTok });
    const auditRows = (audit.data && audit.data.auditLog) || [];
    assert(audit.status === 200 && auditRows.some((row) => row.action === "product_updated" && row.entityId === "T100"), "product edit audited " + JSON.stringify(audit.data).slice(0, 180));
    ok("product edit audit");

    const friEarly = { days: { fri: { open: "08:00", close: "11:00", closed: false } }, closures: [] };
    const setA = await req("PUT", "/api/admin/store-hours", { token: adminTok, body: { storeId: "store_a", schedule: friEarly } });
    assert(setA.status === 200 && setA.data.schedule && setA.data.schedule.days.fri.close === "11:00", "store A hours");
    const statusA = await req("GET", "/api/store-hours?storeId=store_a");
    const statusB = await req("GET", "/api/store-hours?storeId=store_b");
    const friA = (statusA.data.week || []).find((d) => d.key === "fri");
    const friB = (statusB.data.week || []).find((d) => d.key === "fri");
    assert(friA && friA.close === "11:00", "store A friday");
    assert(friB && friB.close === "12:00", "store B keeps global friday");
    const cleared = await req("PUT", "/api/admin/store-hours", { token: adminTok, body: { storeId: "store_a", useGlobal: true } });
    assert(cleared.status === 200 && !cleared.data.schedule, "store A back to global");
    const adminHoursJs = fs.readFileSync(path.join(ROOT, "..", "website", "js", "admin-upgrade.js"), "utf8");
    assert(adminHoursJs.includes("hoursScope") && adminHoursJs.includes("hoursUseGlobal"), "per-store hours controls");
    ok("per-store hours");

    const pos = await req("POST", "/api/pos/login", { body: { id: "owner", password: ADMIN_PASSWORD } });
    assert(pos.status === 200 && pos.data.token && pos.data.workspace === "pos" && !pos.data.need2fa, "pos owner session is not admin 2fa");
    const posTok = pos.data.token;
    const blocked = await Promise.all([
      req("GET", "/api/admin/state", { token: posTok }),
      req("GET", "/api/admin/orders", { token: posTok }),
      req("GET", "/api/admin/customers", { token: posTok }),
      req("PUT", "/api/admin/catalog", { token: posTok, body: { products: [] } }),
      req("GET", "/api/admin/audit", { token: posTok }),
    ]);
    assert(blocked.every((r) => r.status === 401 || r.status === 403), "pos token cannot call admin APIs " + blocked.map((r) => r.status).join(","));
    const posMe = await req("GET", "/api/pos/me", { token: posTok });
    assert(posMe.status === 200 && posMe.data.type === "pos", "pos me stays pos");
    ok("pos cannot bypass admin 2fa");

    console.log("ALL UPGRADE CHECKS PASSED", results.length);
  } finally {
    try { child.kill("SIGTERM"); } catch (_) {}
  }
}

main().catch((err) => {
  console.error("FAIL", err && err.stack || err);
  process.exit(1);
});
