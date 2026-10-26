"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const catalog = require("../../website/js/catalog-page");

const ROOT = path.join(__dirname, "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "maho-uat-final-"));
const DATA = path.join(TMP, "data");
const UPLOADS = path.join(TMP, "uploads");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });
const ADMIN_PASSWORD = "SecureTestPass1!";
const PORT = 5300 + Math.floor(Math.random() * 200);

function assert(cond, message) { if (!cond) throw new Error(message || "assert"); }
function ok(name) { console.log("PASS", name); }
function req(method, urlPath, { body, token } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body != null ? Buffer.from(JSON.stringify(body)) : null;
    const headers = { Accept: "application/json" };
    if (token) headers.Authorization = "Bearer " + token;
    if (payload) { headers["Content-Type"] = "application/json"; headers["Content-Length"] = String(payload.length); }
    const r = http.request({ hostname: "127.0.0.1", port: PORT, path: urlPath, method, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks);
        let data = null;
        try { data = JSON.parse(raw.toString("utf8")); } catch (_) {}
        resolve({ status: res.statusCode, data, raw });
      });
    });
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

function pageMath() {
  const rows = [];
  for (let i = 0; i < 500; i++) rows.push({ code: "P" + i, name: "کالا " + i, cat: "wear", enabled: true });
  let seen = 0;
  const pages = Math.ceil(500 / 24);
  for (let p = 1; p <= pages; p++) seen += catalog.pageProducts(rows, { mode: "catalog", pageSize: 24, page: p }).items.length;
  assert(seen === 500, "500 catalog pages");
  const twoHundred = catalog.pageProducts(rows.slice(0, 200), { mode: "catalog", page: 9, pageSize: 24 });
  assert(twoHundred.pages === 9 && twoHundred.items.length === 8, "200 last page");
  const found = catalog.pageProducts(rows, { q: "کالا 450", mode: "home" });
  assert(found.total === 1 && found.items[0].product.code === "P450", "search is not limited to the homepage");
  const home = catalog.pageProducts(rows, { mode: "home", homeCount: 12 });
  assert(home.items.length === 12 && home.total === 500, "home stays at 12");
  ok("paging 500 products");
}

async function adminToken() {
  const start = await req("POST", "/api/admin/login", { body: { password: ADMIN_PASSWORD } });
  const two = await req("POST", "/api/admin/login/2fa", { body: { challengeId: start.data.challengeId, code: start.data.devCode } });
  assert(two.status === 200 && two.data.token, "admin");
  return two.data.token;
}
async function user(email) {
  const reg = await req("POST", "/api/auth/register", { body: { acceptTerms: true, name: email, phone: "0700111222", email, password: "BuyerPass99", address: "کابل" } });
  assert(reg.status === 200 && reg.data.devCode, "register " + email);
  const ver = await req("POST", "/api/auth/verify", { body: { email, code: reg.data.devCode } });
  assert(ver.status === 200 && ver.data.token, "verify");
  return { token: ver.data.token, id: ver.data.user.id };
}

async function main() {
  pageMath();
  const mainJs = fs.readFileSync(path.join(ROOT, "..", "website", "js", "main.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "..", "website", "index.html"), "utf8");
  assert(mainJs.indexOf('"search.label": "جستجو"') >= 0, "dari search label");
  assert(html.indexOf('href="/catalog"') >= 0, "catalog link");
  assert(html.indexOf(">جستجوی کالا<") < 0, "old hero label removed");
  ok("label and catalog link");

  const child = spawn(process.execPath, [path.join(ROOT, "index.js")], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), NODE_ENV: "development", ADMIN_PASSWORD, DATA_DIR: DATA, UPLOAD_DIR: UPLOADS,
      ALLOW_DEV_CODES: "true", TOKEN_PEPPER: "uat-final", SITE_URL: "http://127.0.0.1:" + PORT,
      ALLOWED_ORIGINS: "http://127.0.0.1:" + PORT, SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "",
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let boot = "";
  child.stdout.on("data", (d) => { boot += d; });
  child.stderr.on("data", (d) => { boot += d; });
  try {
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 150));
      try { if ((await req("GET", "/api/health")).status === 200) break; } catch (_) {}
      if (i === 39) throw new Error(boot.slice(-500));
    }
    const page = await req("GET", "/catalog");
    assert(page.status === 200 && page.raw.toString("utf8").indexOf('id="viewAllProducts"') >= 0, "catalog route");
    const admin = await adminToken();
    const cat = await req("GET", "/api/catalog");
    const code = (cat.data.products || []).find((p) => p && p.code).code;
    const a = await user("fav-a-" + Date.now() + "@example.com");
    const b = await user("fav-b-" + Date.now() + "@example.com");
    const added = await req("POST", "/api/me/favorites", { token: a.token, body: { code: code } });
    assert(added.status === 200 && added.data.favorites.indexOf(code) >= 0, "favorite saved");
    const again = await req("GET", "/api/me/favorites", { token: a.token });
    assert(again.data.favorites.indexOf(code) >= 0, "favorite persists");
    const other = await req("GET", "/api/me/favorites", { token: b.token });
    assert(other.data.favorites.indexOf(code) < 0, "other customer cannot see it");
    const anon = await req("POST", "/api/me/favorites", { body: { code: code } });
    assert(anon.status === 401, "anonymous favorite rejected");
    const removed = await req("POST", "/api/me/favorites", { token: a.token, body: { code: code } });
    assert(removed.data.favorites.indexOf(code) < 0, "favorite removed");
    await req("POST", "/api/me/favorites", { token: a.token, body: { code: code } });
    ok("favorites isolation");

    const blocked = await req("POST", "/api/admin/customers/" + a.id + "/block", { token: admin, body: { reason: "test" } });
    assert(blocked.status === 200, "block");
    const fav = await req("POST", "/api/me/favorites", { token: a.token, body: { code: code } });
    assert(fav.status === 403 && fav.data.error === "account_blocked", "blocked favorite is 403 " + JSON.stringify(fav.data));
    const me = await req("GET", "/api/me", { token: a.token });
    assert(me.status === 401 || me.status === 403, "blocked session cannot continue");
    ok("blocked session cannot use account routes");

    const saved = await req("PUT", "/api/admin/contact-methods", { token: admin, body: { methods: [
      { type: "whatsapp", label: "واتساپ", label_en: "WhatsApp", destination: "93790000000", enabled: true },
      { type: "tel", label: "تماس تلفنی", label_en: "Call", destination: "+93790000000", enabled: true },
      { type: "email", label: "ارسال ایمیل", label_en: "Email", destination: "uat@example.com", enabled: true },
      { type: "telegram", label: "تلگرام", label_en: "Telegram", destination: "https://t.me/mahotest", enabled: true },
    ] } });
    assert(saved.status === 200 && saved.data.publicMethods.some((row) => row.type === "telegram"), "telegram public");
    const off = saved.data.methods.map((row) => row.type === "telegram" ? Object.assign({}, row, { enabled: false }) : row);
    const hidden = await req("PUT", "/api/admin/contact-methods", { token: admin, body: { methods: off } });
    assert(!hidden.data.publicMethods.some((row) => row.type === "telegram"), "telegram hidden");
    const edited = hidden.data.methods.map((row) => row.type === "telegram" ? Object.assign({}, row, { enabled: true, destination: "https://t.me/mahotest2" }) : row);
    const back = await req("PUT", "/api/admin/contact-methods", { token: admin, body: { methods: edited } });
    const tg = back.data.publicMethods.find((row) => row.type === "telegram");
    assert(tg && tg.href === "https://t.me/mahotest2", "telegram edited");
    const site = await req("GET", "/api/catalog");
    assert(site.data.site.contactMethods.some((row) => row.href === "https://t.me/mahotest2"), "catalog exposes contact methods");
    assert(site.data.site.contactMethods.some((row) => row.type === "whatsapp") && site.data.site.contactMethods.some((row) => row.type === "email"), "original methods remain");
    ok("contact methods");
    console.log("UAT_FINAL_OK");
  } finally {
    child.kill();
  }
}
main().catch((err) => { console.error("FAIL", err && err.stack || err); process.exit(1); });
