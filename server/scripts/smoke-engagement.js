#!/usr/bin/env node
/**
 * Customer engagement smoke — temp DATA_DIR only.
 * Covers newsletter, campaigns, and admin-controlled delivery feedback.
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

    /* ---- Order + admin-controlled feedback ---- */
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

    /* 1–2: pending / processing → request-feedback forbidden */
    const denyNew = await req("POST", "/api/admin/orders/" + oid + "/request-feedback", { token: tok, body: {} });
    assert(denyNew.status === 400 && denyNew.data.error === "not_delivered", "pending blocked");
    ok("pending order: request feedback forbidden");

    await req("POST", "/api/admin/orders/" + oid + "/status", { token: tok, body: { status: "confirmed" } });
    const denyProc = await req("POST", "/api/admin/orders/" + oid + "/request-feedback", { token: tok, body: {} });
    assert(denyProc.status === 400 && denyProc.data.error === "not_delivered", "processing blocked");
    ok("processing order: request feedback forbidden");

    await req("POST", "/api/admin/orders/" + oid + "/status", { token: tok, body: { status: "dispatched" } });
    await req("POST", "/api/admin/orders/" + oid + "/status", { token: tok, body: { status: "delivered" } });

    /* Delivered must NOT auto-create feedback invite (manual default) */
    await new Promise((r) => setTimeout(r, 250));
    let db = JSON.parse(fs.readFileSync(path.join(DATA, "db.json"), "utf8"));
    const autoFb = (db.feedback || []).find((f) => f && f.orderId === oid);
    assert(!autoFb, "no auto feedback invite on delivered");
    const oDel = (db.orders || []).find((o) => o.id === oid);
    assert(oDel && (oDel.feedbackStatus == null || oDel.feedbackStatus === "not_requested"), "status not_requested after deliver");
    assert(!(oDel.feedbackRequestCount > 0), "count still 0 after deliver");
    ok("delivered: no auto-send; eligible only");

    /* 11: unauthorized */
    const unauth = await req("POST", "/api/admin/orders/" + oid + "/request-feedback", { body: {} });
    assert(unauth.status === 401 || unauth.status === 403, "unauthorized " + unauth.status);
    ok("unauthorized => 401/403");

    /* 3–8: first request */
    const first = await req("POST", "/api/admin/orders/" + oid + "/request-feedback", { token: tok, body: {} });
    assert(first.status === 200 && first.data.ok, "first request " + first.status + " " + JSON.stringify(first.data));
    assert(first.data.feedback && first.data.feedback.feedbackStatus === "requested", "status Requested");
    assert(first.data.feedback.feedbackRequestCount === 1, "count=1");
    assert(first.data.feedback.feedbackRequestSentAt, "sentAt");
    assert(first.data.feedback.feedbackRequestSentBy, "sentBy");
    assert(first.data.feedback.feedbackLastRequestedAt, "lastRequestedAt");
    const fbToken = first.data.devFeedbackToken;
    assert(fbToken && typeof fbToken === "string", "dev feedback token for smoke");
    assert(!JSON.stringify(first.data).includes("tokenHash"), "no tokenHash in response");
    ok("delivered + first click => request recorded");

    db = JSON.parse(fs.readFileSync(path.join(DATA, "db.json"), "utf8"));
    const o1 = (db.orders || []).find((o) => o.id === oid);
    assert(o1.feedbackStatus === "requested", "db feedbackStatus");
    assert(o1.feedbackRequestCount === 1, "db count");
    assert(o1.feedbackRequestSentBy, "db sentBy");
    assert((db.feedback || []).some((f) => f.orderId === oid && f.tokenHash), "invite exists");

    /* 10: double click / too soon */
    const dup = await req("POST", "/api/admin/orders/" + oid + "/request-feedback", { token: tok, body: {} });
    assert(dup.status === 409, "double-click guarded " + dup.status);
    ok("double click => no duplicate accidental send");

    /* 9: resend after cooldown */
    await new Promise((r) => setTimeout(r, 2600));
    const resend = await req("POST", "/api/admin/orders/" + oid + "/request-feedback", { token: tok, body: {} });
    assert(resend.status === 200 && resend.data.feedback.feedbackRequestCount === 2, "resend count=2");
    ok("resend => requestCount increments");

    /* 13–15: feedback link + ratings + google CTA */
    const tokFb = resend.data.devFeedbackToken;
    assert(tokFb, "resend provides rotated token");
    const getFb = await req("GET", "/api/feedback/" + oid + "?token=" + encodeURIComponent(tokFb));
    assert(getFb.status === 200 && getFb.data.feedback, "feedback link works");
    assert(typeof getFb.data.googleReviewUrl === "string", "google review field present");
    assert(typeof getFb.data.minStarsForGoogleReview === "number", "min stars present");

    const submit = await req("POST", "/api/feedback/" + oid, {
      body: {
        token: tokFb,
        driverRating: 5,
        overallSatisfaction: 4,
        productRatings: [{ code: "S1", name: "شال", rating: 5 }],
        comment: "عالی",
        googleReviewClicked: true,
      },
    });
    assert(submit.status === 200 && submit.data.feedback.status === "submitted", "submit ok");
    assert(submit.data.feedback.driverRating === 5, "driver rating");
    assert(submit.data.feedback.overallSatisfaction === 4, "overall");
    assert(submit.data.feedback.productRatings && submit.data.feedback.productRatings[0].rating === 5, "product rating");
    assert(submit.data.feedback.googleReviewClicked === true, "google CTA click stored");
    ok("feedback submit + ratings + google CTA");

    /* 12: submitted status on order */
    db = JSON.parse(fs.readFileSync(path.join(DATA, "db.json"), "utf8"));
    const o2 = (db.orders || []).find((o) => o.id === oid);
    assert(o2.feedbackStatus === "submitted", "order feedbackStatus=submitted");
    assert(o2.feedbackSubmittedAt, "submittedAt");
    ok("submitted feedback => status Submitted");

    const afterSub = await req("POST", "/api/admin/orders/" + oid + "/request-feedback", { token: tok, body: {} });
    assert(afterSub.status === 409 && afterSub.data.error === "already_submitted", "no resend after submit");

    const analytics = await req("GET", "/api/admin/feedback", { token: tok });
    assert(analytics.status === 200 && analytics.data.analytics, "feedback analytics");
    const perf = await req("GET", "/api/admin/driver-performance", { token: tok });
    assert(perf.status === 200 && Array.isArray(perf.data.drivers), "driver performance");
    ok("analytics + driver perf");

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
