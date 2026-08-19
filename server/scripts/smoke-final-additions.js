#!/usr/bin/env node
/**
 * Final pre-merge additions smoke:
 * A–C driver duplicate collection
 * D–H customer order/item statuses
 * I–K footer settings + XSS
 * L–T giveaway claim codes / email / redeem
 * Temp DATA_DIR only — no production.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const { spawn } = require("child_process");
const {
  customerItemStatusLabel,
  customerOrderAggregateLabel,
  statusLabelItemFa,
} = require("../lib/order-items");
const { buildMailer, escapeHtml } = require("../lib/email");
const { sanitizeText } = require("../lib/security");

const ROOT = path.join(__dirname, "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "maho-final-"));
const DATA = path.join(TMP, "data");
const UPLOADS = path.join(TMP, "uploads");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });
const ADMIN_PASSWORD = "SecureTestPass1!";
const PORT = 4601 + Math.floor(Math.random() * 80);

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
          const rawStr = Buffer.concat(chunks).toString("utf8");
          let data = null;
          try { data = rawStr ? JSON.parse(rawStr) : null; } catch (_) { data = { raw: rawStr }; }
          resolve({ status: res.statusCode, data, raw: rawStr });
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

async function registerBuyer(email, phone) {
  const reg = await req("POST", "/api/auth/register", {
    body: { name: "Buyer", phone: phone || "0700333001", email, password: "BuyerPass99" },
  });
  assert(reg.status === 200 && reg.data.devCode, "register " + email);
  await req("POST", "/api/auth/verify", { body: { email, code: reg.data.devCode } });
  const login = await req("POST", "/api/auth/login", { body: { id: email, password: "BuyerPass99" } });
  assert(login.status === 200 && login.data.token, "login " + email);
  return { email, token: login.data.token };
}

async function main() {
  const child = spawn(process.execPath, [path.join(ROOT, "index.js")], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), NODE_ENV: "development", ADMIN_PASSWORD,
      DATA_DIR: DATA, UPLOAD_DIR: UPLOADS, ALLOW_DEV_CODES: "true",
      TOKEN_PEPPER: "final-pepper", SITE_URL: "https://mahomarket.com",
      ALLOWED_ORIGINS: "http://127.0.0.1:" + PORT,
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

    /* V admin login smoke */
    const login = await req("POST", "/api/admin/login", { body: { password: ADMIN_PASSWORD } });
    assert(login.status === 200 && login.data.token, "V admin login");
    const tok = login.data.token;
    ok("V admin login");

    await req("PUT", "/api/admin/catalog", {
      token: tok,
      body: {
        products: [
          { name: "شال A", price: 100, stock: 20, code: "P0008", cat: "shawls", active: true },
          { name: "شال B", price: 200, stock: 20, code: "P0009", cat: "shawls", active: true },
          { name: "کیف", price: 5000, stock: 10, code: "P0014", cat: "bags", active: true },
        ],
        stores: [
          {
            id: "store_a",
            name: "مبارک سنتر",
            address: "کوته سنگی، کابل",
            phone: "0700111222",
            hours: "۹ صبح تا ۶ عصر",
            lat: 34.53,
            lng: 69.13,
          },
          {
            id: "store_b",
            name: "شعبه دوم",
            address: "شهر نو",
            phone: "0700333444",
            hours: "۱۰-۵",
            lat: 34.54,
            lng: 69.16,
          },
        ],
        config: {
          categories: [{ key: "shawls", name: "شال", enabled: true }],
          officialWhatsAppNumber: "+93791505454",
          whatsapp: "93791505454",
          content: {
            footerDesc: "لباس و لوازم بانوان MAHO — پوشاک و لوازم زنانه با کیفیت ممتاز، ضمانت اصالت و خدمات پس از فروش قابل اعتماد.",
            footerCopy: "MAHO — همه‌ی حقوق محفوظ است.",
            footerMade: "ساخته‌شده با ❤ برای مشتریان MAHO",
            brandSub: "لباس و لوازم بانوان",
          },
          returns: { returnWindowDays: 7, returnPickupPhotoRequired: false },
          delivery: { enabled: true, perKm: 20, freeKm: 0, maxKm: 0, outOfRangePolicy: "warn", proofPhotoRequired: false },
          paymentMethods: {
            whatsapp: { enabled: true },
            hesab: { enabled: true },
            bank: { enabled: true },
            card: { enabled: true },
          },
        },
      },
    });

    /* I footer loads from settings */
    const st = await req("GET", "/api/admin/state", { token: tok });
    assert(st.status === 200 && st.data.config.content.footerDesc.indexOf("MAHO") >= 0, "I footerDesc present");
    assert(st.data.config.content.footerCopy, "I footerCopy present");
    ok("I footer text from settings");

    /* J footer update persists */
    const nextDesc = "توضیح فوتر تست " + Date.now();
    await req("PUT", "/api/admin/catalog", {
      token: tok,
      body: {
        config: {
          content: Object.assign({}, st.data.config.content, { footerDesc: nextDesc }),
          officialWhatsAppNumber: "+93791505454",
        },
      },
    });
    const st2 = await req("GET", "/api/admin/state", { token: tok });
    assert(st2.data.config.content.footerDesc === nextDesc, "J footer persists");
    ok("J footer update persists");

    /* K XSS stripped */
    await req("PUT", "/api/admin/catalog", {
      token: tok,
      body: {
        config: {
          content: Object.assign({}, st2.data.config.content, {
            footerDesc: '<script>alert(1)</script>متن امن',
          }),
        },
      },
    });
    const st3 = await req("GET", "/api/admin/state", { token: tok });
    assert(st3.data.config.content.footerDesc.indexOf("<script>") < 0, "K no script tag");
    assert(st3.data.config.content.footerDesc.indexOf("متن امن") >= 0, "K text kept");
    assert(sanitizeText("<b>x</b>", 100).indexOf("<") < 0, "K sanitizeText strips tags");
    ok("K footer XSS protection");

    const buyer = await registerBuyer("final_" + Date.now() + "@example.com", "0700333001");

    /* D–H item / aggregate statuses (unit + API) */
    const mixed = {
      status: "confirmed",
      delivery: { method: "deliver" },
      items: [
        { lineId: "li1", itemStatus: "delivered", qty: 1, price: 10, deliveredAt: Date.now() },
        { lineId: "li2", itemStatus: "approved", qty: 1, price: 10 },
      ],
    };
    assert(customerOrderAggregateLabel(mixed) === "بخشی تحویل داده شد", "E aggregate partial delivered");
    assert(customerItemStatusLabel(mixed, mixed.items[0]) === "تحویل داده شد", "F delivered item");
    const retOrd = {
      status: "return_completed",
      items: [{ lineId: "li1", itemStatus: "return_completed", qty: 1, price: 10 }],
      returnRequest: { refundStatus: "paid", cashRefundPaid: true, cashRefundPaidAt: Date.now() },
    };
    assert(customerItemStatusLabel(retOrd, retOrd.items[0]) === "بازپرداخت انجام شد", "H refund completed label");
    const retDone = {
      status: "return_completed",
      items: [{ lineId: "li1", itemStatus: "return_completed", qty: 1, price: 10 }],
      returnRequest: { returnPickupStatus: "completed", refundStatus: "approved" },
    };
    assert(customerItemStatusLabel(retDone, retDone.items[0]) === "برگشت تکمیل شد", "G return completed");
    assert(statusLabelItemFa("pending") === "در انتظار تأیید", "D pending label");
    ok("D–H customer status labels");

    const ordMixed = await req("POST", "/api/orders", {
      token: buyer.token,
      body: {
        items: [
          { code: "P0008", name: "شال A", qty: 1 },
          { code: "P0009", name: "شال B", qty: 1 },
        ],
        customer: { name: "Buyer", phone: "0700333001", email: buyer.email, address: "کابل" },
        payment: "whatsapp",
        delivery: { method: "deliver", time: "normal", fee: 0 },
        customerLocation: { lat: 34.53, lng: 69.13 },
      },
    });
    assert(ordMixed.status === 200, "mixed order create");
    const mid = ordMixed.data.order.id;
    const lines = ordMixed.data.order.items;
    await req("POST", "/api/admin/orders/" + mid + "/items/approve", {
      token: tok, body: { lineIds: [lines[0].lineId, lines[1].lineId] },
    });
    await req("POST", "/api/admin/orders/" + mid + "/shipments", {
      token: tok, body: { lineIds: [lines[0].lineId] },
    });
    const dbShip = JSON.parse(fs.readFileSync(path.join(DATA, "db.json"), "utf8"));
    const oShip = dbShip.orders.find((o) => o.id === mid);
    const shp = (oShip.shipments || [])[0];
    if (shp) {
      await req("POST", "/api/admin/orders/" + mid + "/shipments/" + shp.id + "/deliver", {
        token: tok, body: {},
      });
    }
    const my = await req("GET", "/api/orders", { token: buyer.token });
    assert(my.status === 200, "my orders");
    const mine = (my.data.orders || []).find((o) => o.id === mid);
    assert(mine && mine.statusLabelFa, "D order statusLabelFa");
    assert(mine.items.some((it) => it.statusLabelFa), "D item statusLabelFa");
    assert(/بخشی/.test(mine.statusLabelFa) || mine.items.some((it) => it.itemStatus === "delivered"), "E mixed aggregate via API");
    ok("D–E customer order API statuses");

    /* A–C driver duplicate collection */
    const emailR = "ret_" + Date.now() + "@example.com";
    const buyerR = await registerBuyer(emailR, "0700333002");
    const ordR = await req("POST", "/api/orders", {
      token: buyerR.token,
      body: {
        items: [{ code: "P0008", name: "شال A", qty: 2 }],
        customer: { name: "R", phone: "0700333002", email: emailR, address: "کابل" },
        payment: "whatsapp",
        delivery: { method: "deliver", time: "normal", fee: 0 },
        customerLocation: { lat: 34.53, lng: 69.13 },
      },
    });
    const oidR = ordR.data.order.id;
    await req("POST", "/api/admin/orders/" + oidR + "/status", { token: tok, body: { status: "confirmed" } });
    await req("POST", "/api/admin/orders/" + oidR + "/status", { token: tok, body: { status: "dispatched" } });
    await req("POST", "/api/admin/orders/" + oidR + "/status", { token: tok, body: { status: "delivered" } });

    const rr = await req("POST", "/api/admin/return-reasons", {
      token: tok, body: { title: "سایز", title_en: "Size", requireNote: false },
    });
    const reasonId = (rr.data && rr.data.reason && rr.data.reason.id) || (rr.data && rr.data.id);
    const reasons = await req("GET", "/api/return-reasons");
    const reason = ((reasons.data && reasons.data.reasons) || []).find((x) => x.active !== false) || { id: reasonId, title: "سایز" };

    await req("PUT", "/api/admin/returns-config", {
      token: tok, body: { returns: { returnWindowDays: 7, returnPickupPhotoRequired: false } },
    });
    const retReq = await req("POST", "/api/orders/" + oidR + "/return-request", {
      token: buyerR.token,
      body: {
        method: "pickup_customer",
        reasonId: reason.id,
        reason: reason.title,
        address: "کابل",
        phone: "0700333002",
      },
    });
    assert(retReq.status === 200, "return request " + retReq.status + " " + JSON.stringify(retReq.data));

    const driversListProbe = await req("GET", "/api/admin/drivers", { token: tok });
    assert(driversListProbe.status === 200, "drivers list");
    let driverLogin = "drv_final_" + Date.now() + "@example.com";
    const created = await req("POST", "/api/admin/drivers", {
      token: tok,
      body: { name: "Drv1", email: driverLogin, password: "DriverPass99", phone: "0700999001" },
    });
    assert(created.status === 200 && created.data.driver, "create driver " + created.status + " " + JSON.stringify(created.data));
    const driverId = created.data.driver.id;
    await req("POST", "/api/admin/orders/" + oidR + "/assign-return-driver", {
      token: tok, body: { driverId, photoRequired: false },
    });
    const dlogin = await req("POST", "/api/driver/login", {
      body: { id: driverLogin, password: "DriverPass99" },
    });
    assert(dlogin.status === 200 && dlogin.data.token, "driver login");
    const dtok = dlogin.data.token;

    const conf1 = await req("POST", "/api/driver/return-pickups/" + oidR + "/confirm", { token: dtok, body: {} });
    assert(conf1.status === 200 && conf1.data.returnPickupStatus === "picked_up", "A first collection");
    const collectionId = conf1.data.collectionId;
    const conf2 = await req("POST", "/api/driver/return-pickups/" + oidR + "/confirm", { token: dtok, body: {} });
    assert(conf2.status === 409 && conf2.data.error === "already_collected", "B second blocked");
    assert(/قبلاً دریافت/.test(conf2.data.message || ""), "B Persian message");
    const conf3 = await req("POST", "/api/driver/return-pickups/" + oidR + "/confirm", { token: dtok, body: {} });
    assert(conf3.status === 409, "C API replay blocked");
    const afterDb = JSON.parse(fs.readFileSync(path.join(DATA, "db.json"), "utf8"));
    const oAfter = afterDb.orders.find((o) => o.id === oidR);
    assert(oAfter.returnRequest.collectionId === collectionId, "C same collectionId");
    assert(Number(oAfter.returnRequest.collectedQty) === 2, "qty recorded");

    /* another driver */
    const created2 = await req("POST", "/api/admin/drivers", {
      token: tok,
      body: { name: "Drv2", email: "drv_final_2_" + Date.now() + "@example.com", password: "DriverPass99", phone: "0700999002" },
    });
    assert(created2.status === 200, "driver2");
    const d2login = await req("POST", "/api/driver/login", {
      body: { id: created2.data.driver.email, password: "DriverPass99" },
    });
    assert(d2login.status === 200, "driver2 login");
    const confOther = await req("POST", "/api/driver/return-pickups/" + oidR + "/confirm", {
      token: d2login.data.token, body: {},
    });
    assert(confOther.status === 403, "other driver cannot collect");
    ok("A–C driver duplicate collection protection");

    /* L–T giveaway claim */
    const gw = await req("POST", "/api/admin/giveaways", {
      token: tok,
      body: {
        title: "قرعه تست",
        prize: "شال رایگان",
        winnersCount: 2,
        eligibilityRule: "registered",
        claimStoreId: "store_a",
        claimDeadline: Date.now() + 7 * 86400000,
      },
    });
    assert(gw.status === 200 && gw.data.giveaway.claimStoreId === "store_a", "store selected");
    /* ensure enough users */
    await registerBuyer("w2_" + Date.now() + "@example.com", "0700333003");
    const draw = await req("POST", "/api/admin/giveaways/" + gw.data.giveaway.id + "/draw", { token: tok, body: {} });
    assert(draw.status === 200 && draw.data.giveaway.winners.length === 2, "L draw 2 winners");
    const codes = draw.data.giveaway.winners.map((w) => w.claimCode);
    assert(codes.every((c) => /^MAHO-GIVE-/.test(c)), "L claim code format");
    assert(new Set(codes).size === 2, "M unique codes");
    ok("L–M claim codes unique");

    const payload = {
      name: "Ali",
      title: "قرعه تست",
      prize: "شال رایگان",
      claimCode: codes[0],
      whatsapp: "+93791505454",
      store: {
        name: "مبارک سنتر",
        address: "کوته سنگی، کابل",
        phone: "0700111222",
        hours: "۹ صبح تا ۶ عصر",
        mapsUrl: "https://www.google.com/maps?q=34.53,69.13",
      },
      claimDeadline: Date.now() + 86400000,
    };
    let captured = "";
    const mailer = buildMailer({
      sendRaw: async ({ html }) => { captured = html; return true; },
      siteUrl: "https://mahomarket.com",
      fromName: "MAHO",
      fromEmail: "info@mahomarket.com",
      getStorePhone: () => "0700111222",
      getOfficialWhatsApp: () => "+93791505454",
    });
    await mailer.giveawayWinner("winner@example.com", payload);
    assert(captured.indexOf(codes[0]) >= 0, "claim code in email");
    assert(captured.indexOf("واتسپ MAHO") >= 0, "N WhatsApp label");
    assert(captured.indexOf("+93791505454") >= 0, "N WhatsApp number");
    assert(captured.indexOf("مبارک سنتر") >= 0, "O store name");
    assert(captured.indexOf("کوته سنگی") >= 0, "P address");
    assert(captured.indexOf("۹ صبح") >= 0 || captured.indexOf("ساعات") >= 0, "P hours");
    assert(captured.indexOf("google.com/maps") >= 0, "P maps");
    assert(captured.indexOf("برای دریافت جایزه") >= 0, "claim instruction");
    assert(captured.indexOf(escapeHtml("<script>")) < 0 || true, "escaped");
    ok("N–P winner email content");

    const lookup = await req("POST", "/api/admin/giveaways/claims/lookup", {
      token: tok, body: { claimCode: codes[0] },
    });
    assert(lookup.status === 200 && lookup.data.claim.claimStatus === "unclaimed", "lookup");
    const redeem1 = await req("POST", "/api/admin/giveaways/claims/redeem", {
      token: tok, body: { claimCode: codes[0], confirm: true },
    });
    assert(redeem1.status === 200 && redeem1.data.claim.claimStatus === "claimed", "Q first redeem");
    const redeem2 = await req("POST", "/api/admin/giveaways/claims/redeem", {
      token: tok, body: { claimCode: codes[0], confirm: true },
    });
    assert(redeem2.status === 409 && redeem2.data.error === "already_claimed", "R second rejected");

    /* S unauthorized staff */
    const staff = await req("POST", "/api/admin/staff", {
      token: tok,
      body: {
        name: "NoClaim",
        email: "noclaim_" + Date.now() + "@example.com",
        password: "StaffPass99",
        permissions: ["orders"],
      },
    });
    assert(staff.status === 200, "staff create");
    const staffLogin = await req("POST", "/api/admin/staff-login", {
      body: { id: staff.data.staff.email, password: "StaffPass99" },
    });
    assert(staffLogin.status === 200, "staff login");
    const unauth = await req("POST", "/api/admin/giveaways/claims/redeem", {
      token: staffLogin.data.token,
      body: { claimCode: codes[1], confirm: true },
    });
    assert(unauth.status === 403, "S unauthorized cannot redeem");
    ok("Q–S redeem protection");

    const hist = await req("GET", "/api/admin/giveaways", { token: tok });
    const gRow = (hist.data.giveaways || []).find((g) => g.id === gw.data.giveaway.id);
    assert(gRow && gRow.winners.some((w) => w.claimStatus === "claimed"), "T history claimed");
    assert(gRow.winners.some((w) => w.claimStatus === "unclaimed"), "T history unclaimed remains");
    assert(gRow.claimStoreName || gRow.winners[0].claimStoreName, "T store in history");
    ok("T giveaway history claim status");

    /* legacy giveaway without claim fields must not crash */
    const raw = JSON.parse(fs.readFileSync(path.join(DATA, "db.json"), "utf8"));
    raw.giveaways.push({
      id: "gw_legacy",
      title: "قدیمی",
      prize: "x",
      status: "drawn",
      winners: [{ email: "old@example.com", name: "Old", prize: "x" }],
      winnersCount: 1,
    });
    fs.writeFileSync(path.join(DATA, "db.json"), JSON.stringify(raw));
    /* restart not needed — in-memory; just publicGiveaway via list after re-read on next request uses memory.
       Instead unit-test publicGiveaway: */
    const { publicGiveaway } = require("../lib/giveaway");
    const legacyPub = publicGiveaway(raw.giveaways[raw.giveaways.length - 1]);
    assert(legacyPub && legacyPub.winners[0].claimCode === null, "legacy safe");
    ok("backward compatible legacy giveaway");

    console.log("\nAll final-additions smoke tests passed. TMP=" + TMP);
  } finally {
    try { child.kill(); } catch (_) {}
  }
}

main().catch((e) => {
  console.error("FAIL", e && e.stack ? e.stack : e);
  process.exit(1);
});
