"use strict";
/**
 * Isolated checks for ads, scheduled blocking, storefront content,
 * policies, finance detail, coupons, and gift orders.
 * Temporary DATA_DIR only. No SMTP and no production data.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const ads = require("../lib/upgrade/ads");
const life = require("../lib/upgrade/account-life");
const content = require("../lib/upgrade/content");
const policies = require("../lib/upgrade/policies");
const coupons = require("../lib/upgrade/coupons");
const ledger = require("../lib/upgrade/ledger");

const ROOT = path.join(__dirname, "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "maho-modules-"));
const DATA = path.join(TMP, "data");
const UPLOADS = path.join(TMP, "uploads");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });
const ADMIN_PASSWORD = "SecureTestPass1!";
const PORT = 5100 + Math.floor(Math.random() * 300);
const results = [];
function ok(name) { results.push(name); console.log("PASS", name); }
function assert(cond, message) { if (!cond) throw new Error(message || "assert"); }

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

function checkAds() {
  const start = ads.parseKabul("2026-06-01T00:00");
  assert(start === Date.UTC(2026, 5, 1, 0, 0) - (4 * 60 + 30) * 60000, "kabul midnight");
  const db = { ads: { homepage: [], listing: [], announcement: [] }, adStats: {} };
  ads.saveArea(db, "homepage", [{ enabled: true, title: "بنر", startAt: "2026-06-01T00:00", endAt: "2026-06-02T00:00", imageUrl: "/a.jpg", imageUrlMobile: "/m.jpg" }]);
  ads.saveArea(db, "announcement", [{ enabled: true, title: "اعلان" }]);
  ads.saveArea(db, "listing", [{ enabled: false, title: "پنهان" }]);
  const during = ads.publicAds(db, start + 1000);
  assert(during.homepage.length === 1 && during.announcement.length === 1 && during.listing.length === 0, "three ad types");
  const after = ads.publicAds(db, ads.parseKabul("2026-06-02T00:01"));
  assert(after.homepage.length === 0 && after.announcement.length === 1, "expired banner hidden");
  ok("ads kabul window and three placements");
}

function checkBlock() {
  const user = { id: "u1", email: "buyer@example.com", accountStatus: "active" };
  const future = life.scheduleBlock(user, {
    startAt: Date.now() + 3600000,
    endAt: Date.now() + 7200000,
    publicReason: "بررسی حساب",
    internalNote: "note-only",
  }, "admin");
  assert(future.ok && future.accountStatus === "active", "future block stays active");
  assert(future.schedule.publicReason === "بررسی حساب" && !future.schedule.internalNote, "public schedule hides the note");
  const started = life.applySchedule(user, Date.now() + 3600000 + 10);
  assert(started.state === "blocked" && user.blockReason === "بررسی حساب", "schedule blocks at start");
  assert(user.blockNote === "note-only", "internal note stays separate");
  assert(user.mailQueue.some((row) => row.kind === "blocked" && row.status === "queued" && row.appeal === "support@mahomarket.com"), "block mail queued");
  const again = life.applySchedule(user, Date.now() + 3600000 + 20);
  assert(again.changed === false && user.mailQueue.filter((row) => row.kind === "blocked").length === 1, "block mail is not repeated");
  const ended = life.applySchedule(user, Date.now() + 7200000 + 10);
  assert(ended.state === "active" && user.mailQueue.some((row) => row.kind === "reinstated"), "schedule reinstates and queues mail");
  const disk = JSON.parse(JSON.stringify(user));
  disk.accountStatus = "active";
  disk.blocked = false;
  disk.blockedBySchedule = false;
  disk.blockSchedule.completed = false;
  disk.blockSchedule.blockMailed = true;
  const restored = life.applySchedule(disk, disk.blockSchedule.startAt + 10);
  assert(restored.state === "blocked", "schedule still blocks after a restart load");
  const live = { id: "u2", email: "two@example.com", accountStatus: "active" };
  life.scheduleBlock(live, { startAt: Date.now() - 1000, publicReason: "موقتی", internalNote: "secret" }, "admin");
  const cancelled = life.cancelSchedule(live, "admin");
  assert(cancelled.accountStatus === "active", "cancel schedule unblocks");
  ok("scheduled block, reason, mail, and restart");
}

function checkContent() {
  const db = { config: { content: { instagram: "https://instagram.com/mahomarket", facebook: "https://facebook.com/mahomarket" } } };
  content.ensureContent(db);
  content.ensureContent(db);
  const ig = db.footerSocials.filter((row) => row.platform === "instagram");
  assert(ig.length === 1 && ig[0].url.indexOf("instagram.com/mahomarket") >= 0, "instagram migrated once");
  content.saveSocials(db, db.footerSocials.concat([
    { platform: "linkedin", label: "لینکدین", label_en: "LinkedIn", url: "https://www.linkedin.com/company/maho", enabled: true },
    { platform: "instagram", label: "دوباره", url: "https://instagram.com/other", enabled: true },
  ]));
  assert(db.footerSocials.filter((row) => row.platform === "instagram").length === 1, "no duplicate instagram");
  assert(content.publicSocials(db).some((row) => row.platform === "linkedin"), "linkedin is public");
  content.saveWhy(db, {
    enabled: true,
    kicker: "چرا MAHO",
    heading: "عنوان تازه",
    heading_en: "Fresh heading",
    description: "توضیح",
    cards: [{ id: "one", icon: "shield", enabled: true, order: 1, title: "ضمانت", title_en: "Guarantee", description: "اصل", description_en: "Real" }],
  });
  const pub = content.publicWhy(db);
  assert(pub.heading === "عنوان تازه" && pub.cards.length === 1, "why maho saved");
  ok("why maho and footer socials");
}

function checkPolicies() {
  const db = { users: [{ email: "a@example.com", accountStatus: "active" }], policies: {} };
  const draft = policies.upsertDraft(db, "terms", { version: "2.0", title: "قوانین", body: "متن" });
  assert(!db.policyNotices, "draft does not queue mail");
  policies.publish(db, "terms", draft.version.id);
  const first = policies.queueNotice(db, "terms", draft.version.id);
  const second = policies.queueNotice(db, "terms", draft.version.id);
  assert(first.duplicate === false && second.duplicate === true, "one notice per version");
  assert(first.notice.delivery === "queued_not_sent" && first.notice.recipientCount === 1, "notice is queued, not sent");
  const dir = policies.ensurePdfDir(DATA);
  fs.writeFileSync(path.join(dir, "pol-terms.pdf"), "%PDF-1.1\n%%EOF");
  fs.writeFileSync(path.join(dir, "pol-privacy.pdf"), "%PDF-1.1\n%%EOF");
  policies.upsertDraft(db, "privacy", { version: "2.0", title: "حریم", body: "متن" });
  const privacy = db.policies.privacy.versions[0];
  policies.attachPdf(db, "terms", draft.version.id, "pol-terms.pdf");
  policies.attachPdf(db, "privacy", privacy.id, "pol-privacy.pdf");
  policies.publish(db, "privacy", privacy.id);
  const files = policies.welcomeAttachments(db);
  assert(files.length === 2 && policies.pdfPath(DATA, "../secrets.txt") == null, "welcome pdfs stay inside the policy directory");
  ok("policy versions, notice, and welcome pdfs");
}

function checkCouponsAndLedger() {
  const db = { coupons: [], orders: [], ledger: [], ledgerSeq: 1 };
  coupons.saveAll(db, [{ code: "SAVE10", type: "percent", value: 50, enabled: true, cap: 100, maxUses: 1, perCustomer: 1, endAt: Date.now() - 1000 }]);
  assert(coupons.evaluate(db, "SAVE10", { id: "u" }, [{ code: "A", price: 1000, qty: 1 }]).error === "coupon_expired", "expired coupon");
  coupons.saveAll(db, [{ code: "SAVE10", type: "percent", value: 50, enabled: true, cap: 100, maxUses: 1, perCustomer: 1 }]);
  const off = coupons.evaluate(db, "SAVE10", { id: "u" }, [{ code: "A", price: 1000, qty: 1 }]);
  assert(off.amount === 100, "cap limits the percent");
  assert(coupons.commitUse(db, "SAVE10", { id: "u" }, "O1", 10000) === true, "first redemption");
  assert(coupons.commitUse(db, "SAVE10", { id: "u2" }, "O2", 10000) === false, "global limit holds");
  coupons.saveAll(db, [{ code: "ONCE", type: "fixed", value: 50, enabled: true, perCustomer: 1, maxUses: 5 }]);
  coupons.commitUse(db, "ONCE", { id: "u" }, "O3", 5000);
  assert(coupons.evaluate(db, "ONCE", { id: "u" }, [{ code: "A", price: 500, qty: 1 }]).error === "coupon_used", "per customer limit");

  const now = Date.now();
  const orders = [
    { id: "A1", date: now, status: "confirmed", itemsTotal: 1000, total: 1000, payment: "card", finance: { tracked: true, channel: "online" }, items: [{ price: 500, qty: 2 }] },
    { id: "A2", date: now, status: "confirmed", itemsTotal: 800, total: 800, payment: "cash", finance: { tracked: true, channel: "in_person" }, items: [{ price: 800, qty: 1 }] },
    { id: "A3", date: now, status: "confirmed", itemsTotal: 400, total: 400, payment: "card", finance: { tracked: true, channel: "online" }, items: [{ price: 400, qty: 1 }] },
  ];
  const book = { orders: orders, ledger: [], ledgerSeq: 1 };
  ledger.recordPayment(book, orders[0], { amount: 1000, method: "card", channel: "online", status: "settled" });
  ledger.recordPayment(book, orders[1], { amount: 800, method: "cash", channel: "in_person", status: "settled" });
  ledger.recordPayment(book, orders[2], { amount: 400, method: "card", channel: "online", status: "settled", at: now - 1000 });
  orders[2].status = "cancelled";
  ledger.recordRefund(book, orders[2], { amount: 400, method: "card", channel: "online", status: "settled" });
  const report = ledger.summarize(book, { range: "year" });
  ["gross", "collected", "online", "inPerson", "refunds", "netCash", "outstanding", "refundDue"].forEach((key) => {
    const detail = ledger.detailFor(report, key);
    assert(detail.matches, key + " detail " + detail.sumMinor + " vs " + detail.kpiMinor);
  });
  assert(report.kpi.collected === 220000 && report.kpi.netCash === 180000, "cancelled payment stays until the refund");
  ok("coupon limits and finance detail reconciliation");
}

async function adminToken() {
  const start = await req("POST", "/api/admin/login", { body: { password: ADMIN_PASSWORD } });
  assert(start.status === 200 && start.data.devCode, "admin dev code " + JSON.stringify(start.data));
  const two = await req("POST", "/api/admin/login/2fa", { body: { challengeId: start.data.challengeId, code: start.data.devCode } });
  assert(two.status === 200 && two.data.token, "admin token");
  return two.data.token;
}

async function main() {
  checkAds();
  checkBlock();
  checkContent();
  checkPolicies();
  checkCouponsAndLedger();
  const child = spawn(process.execPath, [path.join(ROOT, "index.js")], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      NODE_ENV: "development",
      ADMIN_PASSWORD,
      DATA_DIR: DATA,
      UPLOAD_DIR: UPLOADS,
      ALLOW_DEV_CODES: "true",
      TOKEN_PEPPER: "modules-pepper",
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
      if (i === 39) throw new Error("boot\n" + boot.slice(-800));
    }
    const admin = await adminToken();
    const email = "modules-" + Date.now() + "@example.com";
    const reg = await req("POST", "/api/auth/register", { body: { acceptTerms: true, name: "ماهو", phone: "0700111222", email, password: "BuyerPass99", address: "کابل", marketingConsent: false } });
    assert(reg.status === 200 && reg.data.devCode, "register");
    const ver = await req("POST", "/api/auth/verify", { body: { email, code: reg.data.devCode } });
    assert(ver.status === 200 && ver.data.token, "verify");
    const userTok = ver.data.token;
    const storedUser = JSON.parse(fs.readFileSync(path.join(DATA, "db.json"), "utf8")).users.find((u) => u.email === email);
    assert(storedUser.policyAcceptance && storedUser.policyAcceptance.accepted === true, "accepted policy recorded");
    assert(storedUser.welcomeMail && storedUser.welcomeMail.links.indexOf("/terms") >= 0, "welcome keeps policy links");
    ok("registration acceptance and welcome record");

    const cat = await req("GET", "/api/catalog");
    assert(cat.data.site && cat.data.site.whyMaho && cat.data.site.whyMaho.heading, "public why maho");
    assert(Array.isArray(cat.data.site.socials), "public social list");
    const storeId = cat.data.stores && cat.data.stores[0] && cat.data.stores[0].id;
    const product = (cat.data.products || []).find((p) => p && p.code);
    assert(storeId && product, "catalog fixture");
    const gift = await req("POST", "/api/orders", {
      token: userTok,
      body: {
        items: [{ code: product.code, name: product.name, qty: 1 }],
        customer: { name: "ماهو", phone: "0700111222", email, address: "کابل، ناحیه ۱، خیابان ۱، خانه ۲" },
        payment: "whatsapp",
        delivery: { method: "pickup", storeId },
        orderNote: "لطفاً بعد از ظهر",
        gift: { enabled: true, recipientName: "هدیه گیر", recipientPhone: "0700999888", message: "تبریک", addressMode: "mine" },
      },
    });
    assert(gift.status === 200 && gift.data.order.gift.recipientName === "هدیه گیر", "gift saved " + JSON.stringify(gift.data));
    assert(gift.data.order.orderNote === "لطفاً بعد از ظهر", "order note saved");
    assert(gift.data.order.customer.name === "ماهو", "purchaser stays the account");
    ok("gift order submission");

    const savedCoupon = await req("PUT", "/api/admin/coupons", { token: admin, body: { coupons: [{ code: "GIFT20", type: "percent", value: 20, enabled: true, perCustomer: 1 }] } });
    assert(savedCoupon.status === 200, "coupon save");
    const edited = await req("PUT", "/api/admin/coupons", { token: admin, body: { coupons: [{ id: savedCoupon.data.coupons[0].id, code: "GIFT20", type: "percent", value: 10, enabled: true, perCustomer: 1 }] } });
    assert(edited.status === 200 && edited.data.coupons[0].value === 10, "coupon edit");
    const withCoupon = await req("POST", "/api/orders", {
      token: userTok,
      body: {
        couponCode: "GIFT20",
        items: [{ code: product.code, name: product.name, qty: 1 }],
        customer: { name: "ماهو", phone: "0700111222", email, address: "کابل" },
        payment: "whatsapp",
        delivery: { method: "pickup", storeId },
      },
    });
    assert(withCoupon.status === 200 && withCoupon.data.order.discountPolicy === "coupon_replaces_product_and_order_discounts", "coupon replaces other discounts");
    const plain = await req("POST", "/api/orders", {
      token: userTok,
      body: {
        items: [{ code: product.code, name: product.name, qty: 1 }],
        customer: { name: "ماهو", phone: "0700111222", email, address: "کابل" },
        payment: "whatsapp",
        delivery: { method: "pickup", storeId },
      },
    });
    assert(plain.status === 200 && withCoupon.data.order.total < plain.data.order.total, "coupon changes the total");
    ok("coupon create edit and checkout");

    const pay1 = await req("POST", "/api/admin/orders/" + gift.data.order.id + "/payments", { token: admin, body: { amount: gift.data.order.total, method: "card", channel: "online", status: "settled" } });
    const pay2 = await req("POST", "/api/admin/orders/" + plain.data.order.id + "/payments", { token: admin, body: { amount: plain.data.order.total, method: "cash", channel: "in_person", status: "settled" } });
    assert(pay1.status === 200 && pay2.status === 200, "payments recorded");
    const fin = await req("GET", "/api/admin/finance?range=year", { token: admin });
    for (const key of ["collected", "online", "inPerson", "netCash", "gross"]) {
      const detail = await req("GET", "/api/admin/finance/detail?range=year&key=" + key, { token: admin });
      assert(detail.status === 200 && detail.data.matches === true, key + " matches " + JSON.stringify(detail.data && { sum: detail.data.sum, kpi: detail.data.kpi }));
    }
    assert(Number(fin.data.kpi.online) > 0 && Number(fin.data.kpi.inPerson) > 0, "both channels present");
    ok("finance detail matches the summary");

    const adBody = { items: [
      { enabled: true, title: "بنر", title_en: "Banner", imageUrl: "/icon-192.png", imageUrlMobile: "/icon-192.png", startAt: "2020-01-01T00:00", endAt: "2099-01-01T00:00" },
      { enabled: true, title: "تمام‌شده", startAt: "2020-01-01T00:00", endAt: "2020-01-02T00:00" },
    ] };
    assert((await req("PUT", "/api/admin/ads/homepage", { token: admin, body: adBody })).status === 200, "homepage ads");
    assert((await req("PUT", "/api/admin/ads/announcement", { token: admin, body: { items: [{ enabled: true, title: "نوار" }] } })).status === 200, "announcement");
    assert((await req("PUT", "/api/admin/ads/listing", { token: admin, body: { items: [{ enabled: true, title: "کارت", url: "https://mahomarket.com/" }] } })).status === 200, "listing");
    const afterAds = await req("GET", "/api/catalog");
    assert(afterAds.data.site.ads.homepage.length === 1 && afterAds.data.site.ads.announcement.length === 1 && afterAds.data.site.ads.listing.length === 1, "expired ad is not public");
    ok("ad publish hides expired items");

    const blocked = await req("POST", "/api/admin/customers/" + storedUser.id + "/block-schedule", {
      token: admin,
      body: { startAt: Date.now() - 1000, endAt: Date.now() + 86400000, publicReason: "نقض قوانین", internalNote: "staff-only" },
    });
    assert(blocked.status === 200 && blocked.data.accountStatus === "blocked", "schedule started " + JSON.stringify(blocked.data));
    assert(JSON.stringify(blocked.data).indexOf("staff-only") < 0, "internal note is not returned");
    const me = await req("GET", "/api/me", { token: userTok });
    assert(me.status === 401 || me.status === 403, "blocked session cannot stay signed in " + me.status);
    const login = await req("POST", "/api/auth/login", { body: { email, password: "BuyerPass99" } });
    assert(login.status === 403 && login.data.reason === "نقض قوانین" && login.data.support === "support@mahomarket.com", "login shows the reason " + JSON.stringify(login.data));
    const reloaded = JSON.parse(fs.readFileSync(path.join(DATA, "db.json"), "utf8")).users.find((u) => u.id === storedUser.id);
    assert(reloaded.blockSchedule && reloaded.mailQueue.some((row) => row.kind === "blocked" && row.appeal === "support@mahomarket.com"), "block survives in the database");
    const cleared = await req("POST", "/api/admin/customers/" + storedUser.id + "/block-schedule/cancel", { token: admin, body: {} });
    assert(cleared.status === 200 && cleared.data.accountStatus === "active", "unblocked");
    ok("customer-visible block schedule");

    const why = await req("PUT", "/api/admin/why-maho", { token: admin, body: { enabled: true, kicker: "چرا MAHO", heading: "اعتماد تازه", heading_en: "Fresh trust", description: "توضیح", cards: [{ icon: "shield", title: "ضمانت اصالت", title_en: "Authentic", description: "اصل", description_en: "Real", enabled: true, order: 1 }] } });
    assert(why.status === 200, "why save");
    const social = await req("PUT", "/api/admin/footer-socials", { token: admin, body: { socials: [
      { platform: "instagram", label: "اینستاگرام", url: "https://instagram.com/mahomarket", enabled: true },
      { platform: "linkedin", label: "لینکدین", url: "https://www.linkedin.com/company/maho", enabled: true },
      { platform: "tiktok", label: "تیک‌تاک", url: "", enabled: true },
    ] } });
    assert(social.status === 200 && social.data.publicSocials.length === 2, "blank social url is not public");
    const site = await req("GET", "/api/catalog");
    assert(site.data.site.whyMaho.heading === "اعتماد تازه" && site.data.site.socials.some((row) => row.platform === "linkedin"), "content reloads from the database");
    ok("why maho and socials persist");

    const draft = await req("POST", "/api/admin/policies/returns", { token: admin, body: { version: "1.2", title: "برگشت", title_en: "Returns", body: "متن برگشت", body_en: "Returns text" } });
    assert(draft.status === 200, "returns draft");
    const quiet = await req("GET", "/api/policies/returns");
    assert(quiet.status === 404, "draft is not public");
    const published = await req("POST", "/api/admin/policies/returns/" + draft.data.version.id + "/publish", { token: admin, body: { notify: true } });
    assert(published.status === 200, "publish");
    const again = await req("POST", "/api/admin/policies/returns/" + draft.data.version.id + "/publish", { token: admin, body: { notify: true } });
    assert(again.status === 200, "republish");
    const dbNow = JSON.parse(fs.readFileSync(path.join(DATA, "db.json"), "utf8"));
    const notices = (dbNow.policyNotices || []).filter((row) => row.versionId === draft.data.version.id);
    assert(notices.length === 1 && notices[0].delivery === "queued_not_sent", "policy notice is idempotent");
    const boundary = "----mahomodules";
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
    const raw = Buffer.concat([
      Buffer.from("--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"returns.pdf\"\r\nContent-Type: application/pdf\r\n\r\n"),
      pdf,
      Buffer.from("\r\n--" + boundary + "--\r\n"),
    ]);
    const uploaded = await req("POST", "/api/admin/policies/returns/" + draft.data.version.id + "/pdf", {
      token: admin,
      raw,
      headers: { "Content-Type": "multipart/form-data; boundary=" + boundary },
    });
    assert(uploaded.status === 200, "pdf upload " + JSON.stringify(uploaded.data));
    const pdfRes = await req("GET", "/api/policies/returns/pdf");
    assert(pdfRes.status === 200 && pdfRes.raw.slice(0, 4).toString() === "%PDF", "public pdf");
    ok("policy draft, notify, and pdf");

    const pass = await req("POST", "/api/auth/passkey/login", { body: { challengeId: "missing", credential: { id: "none" } } });
    assert(pass.status === 400 && !pass.data.token, "failed passkey does not create a session");
    ok("passkey failure creates no session");

    const links = await req("PUT", "/api/admin/links", { token: admin, body: { subtitle: "ماه", subtitle_en: "MAHO", links: [
      { kind: "instagram", label: "اینستاگرام", label_en: "Instagram", url: "https://instagram.com/mahomarket", enabled: true },
      { kind: "custom", label: "خالی", url: "", enabled: true },
    ] } });
    assert(links.status === 200 && links.data.links.every((row) => row.url), "blank link is not stored");
    const page = await req("GET", "/links");
    assert(page.status === 200 && page.raw.toString("utf8").indexOf("instagram.com/mahomarket") >= 0, "links page");
    ok("links save and reload");

    console.log("MODULE_OK", results.length);
  } finally {
    child.kill();
  }
}

main().catch((err) => {
  console.error("FAIL", err && err.stack || err);
  process.exit(1);
});
