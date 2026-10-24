"use strict";
/**
 * Isolated round-3 checks. Temporary DATA_DIR only. No production data and no SMTP.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const sessions = require("../lib/session-store");
const cards = require("../lib/upgrade/customer-card");
const { buildMailer } = require("../lib/email");

const ROOT = path.join(__dirname, "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "maho-round3-"));
const DATA = path.join(TMP, "data");
const UPLOADS = path.join(TMP, "uploads");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });
const ADMIN_PASSWORD = "SecureTestPass1!";
const PORT = 4900 + Math.floor(Math.random() * 200);
const results = [];
function ok(name) { results.push(name); console.log("PASS", name); }
function assert(c, m) { if (!c) throw new Error(m || "assert"); }

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

function checkSessions() {
  const file = path.join(TMP, "sessions.json");
  const pepper = "round3-pepper";
  const a = sessions.open(file, pepper);
  a.set("raw-token-value-not-for-disk", { type: "user", userId: "u1" });
  a.flush();
  const disk = fs.readFileSync(file, "utf8");
  assert(disk.indexOf("raw-token-value-not-for-disk") < 0, "raw token not stored");
  const b = sessions.open(file, pepper);
  const row = b.get("raw-token-value-not-for-disk");
  assert(row && row.userId === "u1", "session survives a new process load");
  ok("persistent session hash");
}

function checkMailRouting() {
  const sent = [];
  const mail = buildMailer({
    sendRaw: (msg) => { sent.push(msg); return Promise.resolve(true); },
    fromName: "MAHO Market",
    fromEmail: "info@mahomarket.com",
    replyTo: "support@mahomarket.com",
    siteUrl: "https://mahomarket.com",
    logoUrl: "https://mahomarket.com/assets/brand/maho-logo.jpg",
    ordersNotifyEmail: process.env.ORDERS_NOTIFY_EMAIL || "orders@mahomarket.com",
  });
  return mail.orderAdminNotify({
    id: "MAHO-1",
    date: Date.now(),
    total: 100,
    items: [],
    customer: { name: "N", email: "n@example.com", phone: "0700", address: "کابل" },
    payment: "whatsapp",
  }).then(() => {
    assert(sent.length === 1 && sent[0].to === "orders@mahomarket.com", "orders recipient");
    assert(String(sent[0].from).indexOf("info@mahomarket.com") >= 0, "sender unchanged");
    ok("order notification routes to orders@");
  });
}

async function adminToken() {
  const start = await req("POST", "/api/admin/login", { body: { password: ADMIN_PASSWORD } });
  assert(start.status === 200 && start.data.devCode, "admin dev code");
  const two = await req("POST", "/api/admin/login/2fa", { body: { challengeId: start.data.challengeId, code: start.data.devCode } });
  assert(two.status === 200 && two.data.token, "admin token");
  return two.data.token;
}

async function main() {
  checkSessions();
  await checkMailRouting();
  const child = spawn(process.execPath, [path.join(ROOT, "index.js")], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      NODE_ENV: "development",
      ADMIN_PASSWORD,
      DATA_DIR: DATA,
      UPLOAD_DIR: UPLOADS,
      ALLOW_DEV_CODES: "true",
      TOKEN_PEPPER: "round3-pepper",
      SITE_URL: "http://127.0.0.1:" + PORT,
      ALLOWED_ORIGINS: "http://127.0.0.1:" + PORT,
      ORDERS_NOTIFY_EMAIL: "orders@mahomarket.com",
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
      if (i === 39) throw new Error("boot\n" + boot.slice(-600));
    }
    const admin = await adminToken();
    const email = "round3-" + Date.now() + "@example.com";
    const reg = await req("POST", "/api/auth/register", { body: { acceptTerms: true, name: "Round Three", phone: "0700111222", email, password: "BuyerPass99", address: "کابل" } });
    assert(reg.status === 200 && reg.data.devCode, "register");
    const ver = await req("POST", "/api/auth/verify", { body: { email, code: reg.data.devCode } });
    assert(ver.status === 200 && ver.data.token, "verify");
    const userTok = ver.data.token;
    const cat = await req("GET", "/api/catalog");
    const storeId = cat.data.stores && cat.data.stores[0] && cat.data.stores[0].id;
    assert(storeId, "store");
    const saved = await req("PUT", "/api/admin/coupons", { token: admin, body: { coupons: [{ code: "MAHO20", type: "percent", value: 20, enabled: true, perCustomer: 1 }] } });
    assert(saved.status === 200, "coupon saved");
    const preview = await req("POST", "/api/coupons/preview", { token: userTok, body: { code: "MAHO20", items: [{ code: "DRS-001", qty: 1 }] } });
    assert(preview.status === 200 && preview.data.amount > 0, "coupon preview " + JSON.stringify(preview.data));
    const body = {
      items: [{ code: "DRS-001", name: "پیراهن مجلسی بلند", qty: 1 }],
      customer: { name: "Round Three", phone: "0700111222", email, address: "کابل" },
      payment: "whatsapp",
      delivery: { method: "pickup", storeId },
    };
    const withCoupon = await req("POST", "/api/orders", { token: userTok, body: Object.assign({ couponCode: "MAHO20" }, body) });
    const without = await req("POST", "/api/orders", { token: userTok, body: body });
    assert(withCoupon.status === 200 && without.status === 200, "orders " + JSON.stringify({ a: withCoupon.data, b: without.data }));
    assert(withCoupon.data.order.total < without.data.order.total, "coupon lowers total " + withCoupon.data.order.total + " vs " + without.data.order.total);
    assert(!without.data.order.couponSnapshot, "removed coupon is not stored");
    ok("checkout coupon apply and remove");

    const ad = await req("PUT", "/api/admin/ads/homepage", { token: admin, body: { items: [{ enabled: true, title: "تخفیف بهاری", title_en: "Spring", description: "بنر", url: "https://mahomarket.com/", imageUrl: "/icon-192.png" }] } });
    assert(ad.status === 200, "ad save");
    const pub = await req("GET", "/api/catalog");
    const banners = pub.data.site && pub.data.site.ads && pub.data.site.ads.homepage;
    assert(Array.isArray(banners) && banners.length === 1 && banners[0].title === "تخفیف بهاری", "public ad");
    ok("admin advertisement publish");

    const fin = await req("GET", "/api/admin/finance?range=year", { token: admin });
    assert(fin.status === 200 && fin.data.reconciled === true, "finance reconcile");
    const csv = await req("GET", "/api/admin/finance/export.csv?range=year", { token: admin });
    const xls = await req("GET", "/api/admin/finance/export.xls?range=year", { token: admin });
    const pdf = await req("GET", "/api/admin/finance/export.pdf?range=year", { token: admin });
    assert(csv.status === 200 && csv.raw.toString("utf8").indexOf("فروش ناخالص") >= 0, "csv dari");
    assert(xls.status === 200 && xls.raw.toString("utf8").indexOf("gross") >= 0 && xls.raw.toString("utf8").indexOf("فروش ناخالص") >= 0, "xls dari");
    assert(pdf.status === 200 && pdf.raw.slice(0, 4).toString() === "%PDF", "pdf");
    const ledgerCollected = fin.data.kpi.collected;
    const orderSum = (fin.data.orders || []).reduce((s, o) => s + Number(o.collected || 0), 0);
    assert(Math.abs(ledgerCollected - orderSum) < 0.001, "dashboard collected matches orders");
    ok("report downloads reconcile");

    const png = await req("GET", "/api/me/card.png", { token: userTok });
    const cardPdf = await req("GET", "/api/me/card.pdf", { token: userTok });
    assert(png.status === 200 && png.raw.slice(0, 4).toString("hex") === "89504e47", "card png");
    assert(cardPdf.status === 200 && cardPdf.raw.slice(0, 4).toString() === "%PDF", "card pdf");
    const user = JSON.parse(fs.readFileSync(path.join(DATA, "db.json"), "utf8")).users.find((u) => u.email === email);
    const svg = await cards.renderCardSvg(user, "http://127.0.0.1:" + PORT);
    assert(svg.indexOf(user.customerNo) >= 0 && svg.indexOf("/verify/") === -1 || svg.indexOf("data:image/png") >= 0, "card art");
    ok("customer card files");

    const bad = await req("POST", "/api/me/delete/confirm", { token: userTok, body: { code: "000000", confirm: "DELETE" } });
    assert(bad.status === 400, "unsent code does not delete");
    const startDel = await req("POST", "/api/me/delete/start", { token: userTok, body: {} });
    assert(startDel.status === 200 && startDel.data.devCode, "mocked deletion code");
    const wrong = await req("POST", "/api/me/delete/confirm", { token: userTok, body: { code: "111111", confirm: "DELETE" } });
    assert(wrong.status === 400 && wrong.data.error === "bad_code", "wrong code");
    const still = await req("GET", "/api/me", { token: userTok });
    assert(still.status === 200 && still.data.user.email === email, "account remains");
    const gone = await req("POST", "/api/me/delete/confirm", { token: userTok, body: { code: startDel.data.devCode, confirm: "DELETE" } });
    assert(gone.status === 200 && gone.data.deleted === true, "deleted");
    const login = await req("POST", "/api/auth/login", { body: { email, password: "BuyerPass99" } });
    assert(login.status === 401 || login.status === 403, "deleted cannot login " + login.status);
    ok("account deletion with local code");

    console.log("ROUND3", results.length, "passed");
  } finally {
    child.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
