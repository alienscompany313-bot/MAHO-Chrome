"use strict";
/**
 * Seed the already-running local UAT server.
 * Isolated DATA_DIR only. Mock mail only. No SMTP and no production data.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const PORT = Number(process.env.PORT || 4720);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "LocalUatPass1!";
const EMAIL = "uat.customer@maho.test";
const PASSWORD = "LocalUatCustomer1!";
const DATA = process.env.DATA_DIR || path.join(os.tmpdir(), "maho-uat-preview");

function req(method, urlPath, { body, token, raw, headers } = {}) {
  return new Promise((resolve, reject) => {
    const payload = raw || (body != null ? Buffer.from(JSON.stringify(body)) : null);
    const hdrs = Object.assign({ Accept: "application/json" }, headers || {});
    if (token) hdrs.Authorization = "Bearer " + token;
    if (payload && !hdrs["Content-Type"]) hdrs["Content-Type"] = "application/json";
    if (payload) hdrs["Content-Length"] = String(payload.length);
    const r = http.request({ hostname: "127.0.0.1", port: PORT, path: urlPath, method, headers: hdrs }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        let data = null;
        try { data = JSON.parse(buf.toString("utf8")); } catch (_) {}
        resolve({ status: res.statusCode, data, raw: buf });
      });
    });
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

function assert(cond, message) {
  if (!cond) throw new Error(message || "assert");
}

function pdfBody(title) {
  return Buffer.from("%PDF-1.4\n1 0 obj<< /Title (" + title + ") >>endobj\ntrailer<<>>\n%%EOF\n");
}

async function adminToken() {
  const start = await req("POST", "/api/admin/login", { body: { password: ADMIN_PASSWORD } });
  assert(start.status === 200 && start.data.devCode, "admin login " + JSON.stringify(start.data));
  const two = await req("POST", "/api/admin/login/2fa", { body: { challengeId: start.data.challengeId, code: start.data.devCode } });
  assert(two.status === 200 && two.data.token, "admin 2fa");
  return two.data.token;
}

async function publishPdf(token, kind, title) {
  const draft = await req("POST", "/api/admin/policies/" + kind, {
    token,
    body: { version: "uat-1", title: title, title_en: title, body: title + " local acceptance text", body_en: title + " local acceptance text" },
  });
  assert(draft.status === 200 && draft.data.version, kind + " draft " + JSON.stringify(draft.data));
  const id = draft.data.version.id;
  const boundary = "----uat" + kind;
  const pdf = pdfBody(title);
  const raw = Buffer.concat([
    Buffer.from("--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"" + kind + ".pdf\"\r\nContent-Type: application/pdf\r\n\r\n"),
    pdf,
    Buffer.from("\r\n--" + boundary + "--\r\n"),
  ]);
  const uploaded = await req("POST", "/api/admin/policies/" + kind + "/" + id + "/pdf", {
    token,
    raw,
    headers: { "Content-Type": "multipart/form-data; boundary=" + boundary },
  });
  assert(uploaded.status === 200, kind + " pdf " + JSON.stringify(uploaded.data));
  const published = await req("POST", "/api/admin/policies/" + kind + "/" + id + "/publish", { token, body: { notify: false } });
  assert(published.status === 200, kind + " publish");
}

async function main() {
  const health = await req("GET", "/api/health");
  assert(health.status === 200 && health.data.email === false && health.data.env !== "production", "health is local and email is off");
  const admin = await adminToken();
  const termsNow = await req("GET", "/api/policies/terms");
  const privacyNow = await req("GET", "/api/policies/privacy");
  if (termsNow.status !== 200 || !termsNow.data.policy || !termsNow.data.policy.hasPdf) await publishPdf(admin, "terms", "Terms");
  if (privacyNow.status !== 200 || !privacyNow.data.policy || !privacyNow.data.policy.hasPdf) await publishPdf(admin, "privacy", "Privacy");
  const catalog = await req("GET", "/api/catalog");
  const published = (catalog.data.site && catalog.data.site.policies) || {};
  const reg = await req("POST", "/api/auth/register", {
    body: {
      acceptTerms: true,
      termsVersion: published.termsVersion,
      privacyVersion: published.privacyVersion,
      name: "مشتری آزمایش",
      phone: "0700111222",
      email: EMAIL,
      password: PASSWORD,
      address: "کابل، ناحیه ۱، سرک ۱، خانه ۲",
      marketingConsent: false,
    },
  });
  assert(reg.status === 200 && reg.data.devCode, "register " + JSON.stringify(reg.data));
  const ver = await req("POST", "/api/auth/verify", { body: { email: EMAIL, code: reg.data.devCode } });
  assert(ver.status === 200 && ver.data.token, "verify");
  await new Promise((r) => setTimeout(r, 400));
  const db = JSON.parse(fs.readFileSync(path.join(DATA, "db.json"), "utf8"));
  const user = (db.users || []).find((row) => row.email === EMAIL);
  assert(user && user.welcomeMail && user.welcomeMail.transport === "mock", "welcome used the mock transport");
  assert(user.welcomeMail.attachments.indexOf("terms-uat-1.pdf") >= 0 && user.welcomeMail.attachments.indexOf("privacy-uat-1.pdf") >= 0, "welcome lists both policy pdfs");
  const dir = path.join(DATA, "mock-mail");
  const files = fs.readdirSync(dir).filter((name) => name.endsWith(".json"));
  const messages = files.map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")));
  const welcome = messages.filter((row) => row.to === EMAIL && String(row.subject).indexOf("خوش آمدید") >= 0);
  assert(welcome.length === 1, "one mock welcome message");
  const names = welcome[0].attachments.map((file) => file.filename).sort();
  assert(names.join(",") === "privacy-uat-1.pdf,terms-uat-1.pdf", "mock welcome attachments " + names.join(","));
  assert(welcome[0].attachments.every((file) => file.pdf && file.bytes > 20), "both attachments are PDF bytes");
  assert(welcome[0].policyLinks === true && welcome[0].transport === "mock", "welcome keeps the policy links");
  const png = await req("GET", "/api/me/card.png", { token: ver.data.token });
  const pdf = await req("GET", "/api/me/card.pdf", { token: ver.data.token });
  assert(png.status === 200 && png.raw.readUInt32BE(16) === 1016 && png.raw.readUInt32BE(20) === 638, "card png is 1016x638");
  const box = pdf.raw.toString("latin1").match(/\/MediaBox \[0 0 ([0-9.]+) ([0-9.]+)\]/);
  assert(pdf.status === 200 && box, "card pdf has a page box");
  const widthMm = Number(box[1]) * 25.4 / 72;
  const heightMm = Number(box[2]) * 25.4 / 72;
  assert(Math.abs(widthMm - 86) < 0.2 && Math.abs(heightMm - 54) < 0.2, "card pdf is " + widthMm.toFixed(2) + "x" + heightMm.toFixed(2) + " mm");
  console.log("UAT_READY");
  console.log("storefront http://127.0.0.1:" + PORT + "/");
  console.log("admin http://127.0.0.1:" + PORT + "/admin.html");
  console.log("customer " + EMAIL);
  console.log("card_png 1016x638");
  console.log("card_pdf " + widthMm.toFixed(2) + "x" + heightMm.toFixed(2) + "mm");
  console.log("welcome_attachments " + names.join(","));
  console.log("welcome_status " + user.welcomeMail.status);
}

main().catch((err) => {
  console.error("FAIL", err && err.stack || err);
  process.exit(1);
});
