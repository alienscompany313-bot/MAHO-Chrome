"use strict";
/**
 * Isolated release checks: logout, block, delete, customer card, mocked card email.
 * Temporary DATA_DIR only. No production data and no SMTP.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const sessions = require("../lib/session-store");
const cards = require("../lib/upgrade/customer-card");
const code128 = require("../lib/upgrade/code128");
const { buildMailer } = require("../lib/email");

const ROOT = path.join(__dirname, "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "maho-release-"));
const DATA = path.join(TMP, "data");
const UPLOADS = path.join(TMP, "uploads");
fs.mkdirSync(UPLOADS, { recursive: true });
const ADMIN_PASSWORD = "SecureTestPass1!";
const PORT = 5100 + Math.floor(Math.random() * 300);
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

function boot(dataDir) {
  const child = spawn(process.execPath, [path.join(ROOT, "index.js")], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      NODE_ENV: "development",
      ADMIN_PASSWORD,
      DATA_DIR: dataDir,
      UPLOAD_DIR: UPLOADS,
      ALLOW_DEV_CODES: "true",
      TOKEN_PEPPER: "release-pepper",
      SITE_URL: "http://127.0.0.1:" + PORT,
      ALLOWED_ORIGINS: "",
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  return child;
}

async function waitHealth(child) {
  let bootLog = "";
  child.stdout.on("data", (d) => { bootLog += d; });
  child.stderr.on("data", (d) => { bootLog += d; });
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 150));
    try { if ((await req("GET", "/api/health")).status === 200) return; } catch (_) {}
  }
  throw new Error("boot failed\n" + bootLog.slice(-500));
}

async function stop(child) {
  if (!child || child.killed) return;
  child.kill();
  await new Promise((r) => child.on("exit", r));
}

async function adminToken() {
  const start = await req("POST", "/api/admin/login", { body: { password: ADMIN_PASSWORD } });
  assert(start.status === 200 && start.data.devCode, "admin code");
  const two = await req("POST", "/api/admin/login/2fa", { body: { challengeId: start.data.challengeId, code: start.data.devCode } });
  assert(two.status === 200 && two.data.token, "admin token");
  return two.data.token;
}

async function register(name, email) {
  const reg = await req("POST", "/api/auth/register", {
    body: { acceptTerms: true, name, phone: "0700111222", email, password: "BuyerPass99", address: "کابل" },
  });
  assert(reg.status === 200 && reg.data.devCode, "register " + email);
  const verified = await req("POST", "/api/auth/verify", { body: { email, code: reg.data.devCode } });
  assert(verified.status === 200 && verified.data.token, "verify " + email);
  return verified.data;
}

(async () => {
  const html = fs.readFileSync(path.join(ROOT, "..", "website", "index.html"), "utf8");
  const cardTag = (html.match(/<details class="acct-acc" id="customerCardBox"[^>]*>/) || [])[0] || "";
  assert(cardTag && !/\sopen[\s>]/.test(cardTag), "card accordion starts closed");
  assert(html.indexOf("kabulClock") < 0 && html.indexOf("kabul-clock") < 0, "clock markup absent");
  ok("card accordion closed and clock absent");

  const sent = [];
  const mail = buildMailer({
    sendRaw: (msg) => { sent.push(msg); return Promise.resolve(true); },
    fromName: "MAHO Market",
    fromEmail: "info@mahomarket.com",
    siteUrl: "https://mahomarket.com",
    logoUrl: "https://mahomarket.com/assets/brand/maho-logo.jpg",
  });
  const sampleUser = { name: "Sahar Ahmadi", email: "sahar.ahmadi@example.com", customerNo: "MO100105" };
  const samplePng = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  await mail.customerCard(sampleUser.email, sampleUser, samplePng);
  assert(sent.length === 1 && sent[0].to === sampleUser.email, "card email recipient");
  assert(sent[0].attachments && sent[0].attachments[0].filename === "maho-customer-card.png", "card email attachment");
  assert(sent[0].text.indexOf("MO100105") >= 0, "card email customer number");
  ok("mocked customer-card email");

  const file = path.join(TMP, "sessions.json");
  const a = sessions.open(file, "release-pepper");
  a.set("persist-token", { type: "user", userId: "u-persist" });
  a.flush();
  const b = sessions.open(file, "release-pepper");
  assert(b.get("persist-token") && b.get("persist-token").userId === "u-persist", "session reloads");
  b.delete("persist-token");
  const c = sessions.open(file, "release-pepper");
  assert(!c.get("persist-token"), "logout delete survives a new process");
  ok("session restart and logout flush");

  const child = boot(DATA);
  let survivor = null;
  try {
    await waitHealth(child);
    const health = await req("GET", "/api/health");
    assert(health.data && health.data.email === false, "smtp disabled");
    const admin = await adminToken();
    const first = await register("Card One", "card-one-" + Date.now() + "@example.com");
    const second = await register("Card Two", "card-two-" + Date.now() + "@example.com");
    const png = await req("GET", "/api/me/card.png", { token: first.token });
    const pdf = await req("GET", "/api/me/card.pdf", { token: first.token });
    assert(png.status === 200 && png.raw.slice(0, 4).toString("hex") === "89504e47", "png download");
    assert(pdf.status === 200 && pdf.raw.slice(0, 4).toString() === "%PDF", "pdf download");
    const media = /\/MediaBox \[0 0 ([0-9.]+) ([0-9.]+)\]/.exec(pdf.raw.toString("latin1"));
    const widthMm = media ? Number(media[1]) * 25.4 / 72 : 0;
    const heightMm = media ? Number(media[2]) * 25.4 / 72 : 0;
    assert(Math.round(widthMm) === 86 && Math.round(heightMm) === 54, "pdf size " + widthMm + "x" + heightMm);
    const otherPng = await req("GET", "/api/me/card.png?userId=" + encodeURIComponent(first.user.id), { token: second.token });
    assert(otherPng.status === 200, "second customer card");
    assert(!otherPng.raw.equals(png.raw), "cards differ by customer");
    const noMail = await req("POST", "/api/me/card/email", { token: first.token, body: {} });
    assert(noMail.status === 503 && noMail.data.error === "email_unavailable", "no false email success");
    const db = JSON.parse(fs.readFileSync(path.join(DATA, "db.json"), "utf8"));
    const user = db.users.find((u) => u.id === first.user.id);
    const svg = await cards.renderCardSvg(user, "https://mahomarket.com");
    const qrTarget = cards.verifyUrl("https://mahomarket.com", user.card.token);
    const PNG = require("pngjs").PNG;
    const jsQR = require("jsqr");
    const b64 = (svg.match(/data:image\/png;base64,([^"]+)/) || [])[1];
    const qrPng = PNG.sync.read(Buffer.from(b64, "base64"));
    const decoded = jsQR(new Uint8ClampedArray(qrPng.data), qrPng.width, qrPng.height);
    assert(decoded && decoded.data === qrTarget, "qr matches this customer");
    assert(svg.indexOf(user.customerNo) >= 0, "barcode label is this customer");
    assert(code128.decodeText(user.customerNo) === user.customerNo, "code128 roundtrip");
    assert(qrTarget.indexOf(user.email) < 0, "qr url has no email");
    ok("customer-specific card files");

    const again = await req("POST", "/api/auth/login", { body: { id: user.email, password: "BuyerPass99" } });
    assert(again.status === 200 && again.data.token, "second session");
    const bye = await req("POST", "/api/auth/logout", { token: first.token });
    assert(bye.status === 200, "logout");
    const dead = await req("GET", "/api/me", { token: first.token });
    const live = await req("GET", "/api/me", { token: again.data.token });
    assert(dead.status === 401 && live.status === 200, "only the logged-out session is dead");
    ok("logout invalidates that session");

    const blocked = await req("POST", "/api/admin/customers/" + user.id + "/account-status", {
      token: admin, body: { status: "blocked", reason: "release test" },
    });
    assert(blocked.status === 200, "block");
    const afterBlock = await req("GET", "/api/me", { token: again.data.token });
    assert(afterBlock.status === 401 || afterBlock.status === 403, "blocked session rejected " + afterBlock.status + " " + JSON.stringify(afterBlock.data));
    const verifyBlocked = await req("GET", "/api/verify/" + user.card.token);
    assert(verifyBlocked.status === 200 && verifyBlocked.data.active === false && verifyBlocked.data.status === "inactive", "blocked card is not active");
    ok("block invalidates sessions and public card");

    const reinstated = await req("POST", "/api/admin/customers/" + user.id + "/account-status", {
      token: admin, body: { status: "active", reason: "release reinstate" },
    });
    assert(reinstated.status === 200, "reinstate");
    const back = await req("POST", "/api/auth/login", { body: { id: user.email, password: "BuyerPass99" } });
    assert(back.status === 200, "login after reinstate");
    const startDel = await req("POST", "/api/me/delete/start", { token: back.data.token, body: {} });
    const gone = await req("POST", "/api/me/delete/confirm", {
      token: back.data.token, body: { code: startDel.data.devCode, confirm: "DELETE" },
    });
    assert(gone.status === 200 && gone.data.deleted === true, "delete");
    const afterDelete = await req("GET", "/api/me", { token: back.data.token });
    const loginDeleted = await req("POST", "/api/auth/login", { body: { id: user.email, password: "BuyerPass99" } });
    const verifyDeleted = await req("GET", "/api/verify/" + user.card.token);
    assert(afterDelete.status === 401 || afterDelete.status === 403, "deleted session rejected");
    assert(loginDeleted.status === 401 || loginDeleted.status === 403, "deleted login rejected");
    assert(verifyDeleted.data && verifyDeleted.data.active === false && verifyDeleted.data.status === "revoked", "deleted card revoked");
    ok("delete invalidates session and public card");

    survivor = await register("Restart", "restart-" + Date.now() + "@example.com");
  } finally {
    await stop(child);
  }

  const child3 = boot(DATA);
  try {
    await waitHealth(child3);
    const me = await req("GET", "/api/me", { token: survivor.token });
    assert(me.status === 200 && me.data.user.email.indexOf("restart-") === 0, "session survives restart");
    await req("POST", "/api/auth/logout", { token: survivor.token });
  } finally {
    await stop(child3);
  }
  const child4 = boot(DATA);
  try {
    await waitHealth(child4);
    const after = await req("GET", "/api/me", { token: survivor.token });
    assert(after.status === 401, "logout remains invalid after restart");
    ok("restart keeps a live session and a logout");
  } finally {
    await stop(child4);
  }

  console.log("RELEASE", results.length, "passed");
})().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
