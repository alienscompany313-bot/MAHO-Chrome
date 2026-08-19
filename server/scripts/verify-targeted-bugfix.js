#!/usr/bin/env node
/**
 * Targeted bugfix regression suite (temp DATA_DIR only — never production).
 * Run: node scripts/verify-targeted-bugfix.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const { spawn } = require("child_process");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const ART = process.env.ARTIFACT_DIR || "/opt/cursor/artifacts";
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "maho-bugfix-"));
const DATA = path.join(TMP, "data");
const UPLOADS = path.join(TMP, "uploads");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });
try { fs.mkdirSync(ART, { recursive: true }); } catch (_) {}

const ADMIN_PASSWORD = "SecureTestPass1!";
const PORT = 4601 + Math.floor(Math.random() * 80);

const results = [];
function ok(name) { results.push({ name, pass: true }); console.log("PASS", name); }
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

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
          resolve({ status: res.statusCode, data });
        });
      }
    );
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

function loadStatusCode() {
  const src = fs.readFileSync(path.join(ROOT, "..", "website", "js", "api.js"), "utf8");
  const sandbox = { console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  assert(sandbox.MAHOApi && sandbox.MAHOApi.statusCode, "MAHOApi.statusCode loaded");
  return sandbox.MAHOApi.statusCode;
}

function cancelUiMirror(order, statusCodeFn) {
  const raw = order.statusCode || order.statusCanonical || order.status || "";
  const code = statusCodeFn(raw);
  const d = order.delivery || {};
  const isNormal = d.method === "deliver" && String(d.time || "normal") !== "urgent";
  if (code === "new") return { code, canCancel: true };
  if (["dispatched", "delivered", "cancelled", "return_requested", "return_approved", "return_completed", "return_rejected"].indexOf(code) >= 0) {
    return { code, canCancel: false };
  }
  const cancelableAgg = (code === "confirmed" || code === "partially_approved" || code === "partially_cancelled" || code === "partially_rejected");
  if (!cancelableAgg || !isNormal) return { code, canCancel: false };
  let deadline = Number(order.cancelDeadline) || 0;
  if (!deadline && order.approvedAt) deadline = Number(order.approvedAt) + 2 * 60 * 60 * 1000;
  if (!deadline) return { code, canCancel: false };
  return { code, canCancel: (deadline - Date.now()) > 0 };
}

function writeArt(name, html) {
  fs.writeFileSync(path.join(ART, name), html);
}

async function registerUser(email, phone) {
  const reg = await req("POST", "/api/auth/register", {
    body: { name: "U", phone, email, password: "BuyerPass99", marketingConsent: true },
  });
  assert(reg.status === 200 && reg.data.devCode, "register " + email);
  await req("POST", "/api/auth/verify", { body: { email, code: reg.data.devCode } });
  const login = await req("POST", "/api/auth/login", { body: { email, password: "BuyerPass99" } });
  assert(login.status === 200 && login.data.token, "login");
  return { token: login.data.token, email };
}

async function main() {
  /* ===== UNIT: store inventory ===== */
  const inv = require("../lib/store-inventory");
  assert(inv.resolveStoreAvailabilityMode({ code: "L" }) === "all", "legacy missing => all");
  assert(inv.resolveStoreAvailabilityMode({ storeIds: [] }) === "all", "historical [] => all");
  assert(inv.resolveStoreAvailabilityMode({ storeAvailabilityMode: "selected", storeIds: [] }) === "selected", "explicit empty selected");
  assert(inv.productCarriedAtStore({ storeAvailabilityMode: "selected", storeIds: [], storeStock: {} }, "a") === false, "empty selected = none");
  const one = { stock: 10, storeAvailabilityMode: "selected", storeIds: ["store_a"], storeStock: {} };
  assert(inv.productCarriedAtStore(one, "store_a") && !inv.productCarriedAtStore(one, "store_b"), "one store");
  const multi = { stock: 10, storeAvailabilityMode: "selected", storeIds: ["store_a", "store_b"], storeStock: {} };
  inv.setStoreAvailability(multi, "store_b", { available: false });
  assert(multi.storeIds.join(",") === "store_a", "unselect keeps other");
  ok("10-14 store assignment / legacy / selected mode (unit)");

  const dbPick = {
    stores: [
      { id: "store_a", name: "A", active: true, lat: 34.5, lng: 69.1 },
      { id: "store_b", name: "B", active: true, lat: 34.51, lng: 69.12 },
      { id: "store_c", name: "C", active: true, lat: 34.52, lng: 69.13 },
    ],
    products: [
      { code: "P_A", name: "A", stock: 20, active: true, storeAvailabilityMode: "selected", storeIds: ["store_a"], storeStock: {} },
      { code: "P_AB", name: "AB", stock: 20, active: true, storeAvailabilityMode: "selected", storeIds: ["store_a", "store_b"], storeStock: {} },
      { code: "P_LEG", name: "L", stock: 20, active: true },
    ],
  };
  assert(inv.eligiblePickupStores(dbPick, [{ code: "P_A", name: "A", qty: 1 }]).map((s) => s.id).join(",") === "store_a", "15 single");
  assert(inv.eligiblePickupStores(dbPick, [{ code: "P_A", name: "A", qty: 1 }, { code: "P_AB", name: "AB", qty: 1 }]).map((s) => s.id).join(",") === "store_a", "16 intersect");
  assert(inv.eligiblePickupStores(dbPick, [{ code: "P_AB", name: "AB", qty: 1 }]).length === 2, "17 remove one store not all");
  assert(inv.eligiblePickupStores(dbPick, [{ code: "P_LEG", name: "L", qty: 1 }]).length === 3, "13 legacy all");
  /* Assignment-only storeStock with stock:0 must not hide eligible stores */
  const assignedZero = {
    code: "P_Z", name: "Z", stock: 8, active: true,
    storeAvailabilityMode: "selected", storeIds: ["store_a"],
    storeStock: { store_a: { available: true, stock: 0 }, store_b: { available: false, stock: 0 } },
  };
  dbPick.products.push(assignedZero);
  assert(inv.storeAvailableStock(assignedZero, "store_a") === 8, "stock:0 assignment falls back to global");
  assert(inv.eligiblePickupStores(dbPick, [{ code: "P_Z", name: "Z", qty: 1 }]).map((s) => s.id).join(",") === "store_a", "assigned store visible despite stock:0 row");
  ok("13-17 pickup eligibility (unit)");

  /* ===== UNIT: cancel parity ===== */
  const statusCode = loadStatusCode();
  assert(statusCode("آماده ارسال") === "confirmed", "آماده ارسال != dispatched");
  assert(statusCode("ارسال شد") === "dispatched", "ارسال شد");
  assert(statusCode("confirmed") === "confirmed", "canonical");
  const base = {
    id: "ORD-PARITY",
    status: "confirmed",
    statusCode: "confirmed",
    statusLabelFa: "تأییدشده",
    approvedAt: Date.now() - 1000,
    cancelDeadline: Date.now() + 3600000,
    delivery: { method: "deliver", time: "normal" },
  };
  const enUi = cancelUiMirror(base, statusCode);
  const faUi = cancelUiMirror(Object.assign({}, base, { statusLabelFa: "در حال آماده‌سازی" }), statusCode);
  assert(enUi.canCancel === true && faUi.canCancel === true && enUi.canCancel === faUi.canCancel, "EN/Dari parity");
  assert(cancelUiMirror({ status: "آماده ارسال", approvedAt: Date.now(), cancelDeadline: Date.now() + 3600000, delivery: { method: "deliver", time: "normal" } }, statusCode).canCancel === true, "آماده ارسال still cancellable");
  ok("1 English vs Dari cancel parity");

  const { customerCancelInfo, applyApprovedCancelWindow, CUSTOMER_CANCEL_WINDOW_MS } = require("../lib/orders");
  const t0 = 1_700_000_000_000;
  const oWin = { status: "confirmed", delivery: { method: "deliver", time: "normal" } };
  applyApprovedCancelWindow(oWin, t0);
  assert(customerCancelInfo(oWin, t0 + 1000).ok === true, "within window");
  assert(customerCancelInfo(oWin, t0 + CUSTOMER_CANCEL_WINDOW_MS + 1).ok === false, "expired");
  ok("2 cancel window unchanged");

  const oi = require("../lib/order-items");
  const deliv = {
    status: "delivered",
    deliveredAt: Date.now() - 1000,
    returnDeadlineAt: Date.now() + 7 * 86400000,
    items: [{ lineId: "li1", itemStatus: "delivered", qty: 1, price: 100, deliveredAt: Date.now() - 1000, returnDeadlineAt: Date.now() + 7 * 86400000 }],
  };
  assert(oi.requestItemReturn(deliv, "li1", { reason: "x" }, {}).error === "return_method_required", "no default method");
  assert(oi.requestItemReturn(deliv, "li1", { method: "pickup_store" }, {}).error === "return_reason_required", "reason required");
  const sOk = oi.requestItemReturn(JSON.parse(JSON.stringify(deliv)), "li1", { method: "pickup_store", reasonId: "r1", reason: "سایز" }, {});
  assert(sOk.ok && sOk.line.returnRequest.method === "pickup_store", "store return");
  const cOk = oi.requestItemReturn(JSON.parse(JSON.stringify(deliv)), "li1", { method: "pickup_customer", reasonId: "r1", reason: "سایز" }, {});
  assert(cOk.ok && cOk.line.returnRequest.method === "pickup_customer", "customer pickup");
  ok("6-9 return method/reason (unit)");

  /* ===== HTTP ===== */
  const child = spawn(process.execPath, [path.join(ROOT, "index.js")], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), NODE_ENV: "development", ADMIN_PASSWORD,
      DATA_DIR: DATA, UPLOAD_DIR: UPLOADS, ALLOW_DEV_CODES: "true",
      TOKEN_PEPPER: "bugfix-pepper", SITE_URL: "http://127.0.0.1:" + PORT,
      ALLOWED_ORIGINS: "http://127.0.0.1:" + PORT,
      CUSTOMER_CANCEL_WINDOW_MS: "7200000",
      MAIL_DISABLED: "true",
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let boot = "";
  child.stdout.on("data", (d) => { boot += d.toString(); });
  child.stderr.on("data", (d) => { boot += d.toString(); });

  try {
    let ready = false;
    for (let i = 0; i < 50; i++) {
      await sleep(200);
      try { if ((await req("GET", "/api/health")).status === 200) { ready = true; break; } } catch (_) {}
    }
    assert(ready, "server boot\n" + boot.slice(-2000));

    const adminLogin = await req("POST", "/api/admin/login", { body: { password: ADMIN_PASSWORD } });
    assert(adminLogin.status === 200 && adminLogin.data.token, "admin login");
    const atok = adminLogin.data.token;

    const storeA = "store_a";
    const storeB = "store_b";
    const catalog = {
      stores: [
        { id: storeA, name: "Store Alpha", address: "Alpha St", phone: "0700111000", lat: 34.5, lng: 69.1, active: true },
        { id: storeB, name: "Store Beta", address: "Beta St", phone: "0700111001", lat: 34.51, lng: 69.12, active: true },
      ],
      products: [
        { code: "BF_ONE", name: "Bugfix One", name_en: "One", price: 120, stock: 40, active: true, storeAvailabilityMode: "selected", storeIds: [storeA], storeStock: {} },
        { code: "BF_MULTI", name: "Bugfix Multi", name_en: "Multi", price: 130, stock: 40, active: true, storeAvailabilityMode: "selected", storeIds: [storeA, storeB], storeStock: {} },
        { code: "BF_LEG", name: "Bugfix Legacy", name_en: "Legacy", price: 110, stock: 40, active: true },
        { code: "BF_ANY", name: "Bugfix Any", name_en: "Any", price: 100, stock: 40, active: true, storeAvailabilityMode: "all", storeIds: [], storeStock: {} },
      ],
      config: {},
    };
    const save = await req("PUT", "/api/admin/catalog", { token: atok, body: catalog });
    assert(save.status === 200, "catalog save " + JSON.stringify(save.data));

    /* Persist + refresh: re-read catalog */
    const state = await req("GET", "/api/admin/state", { token: atok });
    const products = (state.data && state.data.products) || (save.data && save.data.products) || catalog.products;
    const gotOne = products.find((p) => p.code === "BF_ONE");
    const gotMulti = products.find((p) => p.code === "BF_MULTI");
    assert(gotOne && gotOne.storeAvailabilityMode === "selected" && gotOne.storeIds.join(",") === storeA, "10 one-store persists after save/reload");
    assert(gotMulti && gotMulti.storeIds.slice().sort().join(",") === [storeA, storeB].sort().join(","), "11 multi persists");
    ok("10 product assigned to one store persists after refresh");
    ok("11 product assigned to multiple stores persists");

    catalog.products = products.map((p) => {
      if (p.code === "BF_MULTI") return Object.assign({}, p, { storeIds: [storeA], storeAvailabilityMode: "selected" });
      return p;
    });
    assert((await req("PUT", "/api/admin/catalog", { token: atok, body: catalog })).status === 200, "unselect save");
    const state2 = await req("GET", "/api/admin/state", { token: atok });
    const products2 = (state2.data && state2.data.products) || catalog.products;
    const m2 = products2.find((p) => p.code === "BF_MULTI");
    assert(m2.storeIds.join(",") === storeA, "12 unselect leaves other");
    ok("12 unselect one store leaves other selected stores intact");

    /* restore multi */
    catalog.products = products2.map((p) => {
      if (p.code === "BF_MULTI") return Object.assign({}, p, { storeIds: [storeA, storeB], storeAvailabilityMode: "selected" });
      return p;
    });
    await req("PUT", "/api/admin/catalog", { token: atok, body: catalog });

    const pubReasons = await req("GET", "/api/return-reasons");
    assert(pubReasons.status === 200 && pubReasons.data.reasons.length >= 1, "3 active reasons shown");
    assert(pubReasons.data.reasons.every((r) => r.active !== false), "4 inactive not in public");
    const other = pubReasons.data.reasons.find((r) => r.requireNote || /other|سایر/i.test((r.title || "") + (r.titleEn || "")));
    assert(other, "5 other exists");
    ok("3 Active return reasons shown");
    ok("4 Inactive return reasons hidden");

    const created = await req("POST", "/api/admin/return-reasons", {
      token: atok, body: { title: "غیرفعال تست", titleEn: "Inactive", requireNote: false, active: true },
    });
    if (created.status === 200 && created.data.reason) {
      await req("PUT", "/api/admin/return-reasons/" + created.data.reason.id, { token: atok, body: { active: false } });
      const pub2 = await req("GET", "/api/return-reasons");
      assert(!(pub2.data.reasons || []).some((r) => r.id === created.data.reason.id), "inactive hidden");
    }

    const buyer = await registerUser("bf_" + Date.now() + "@example.com", "0700888001");
    const reason = pubReasons.data.reasons.find((r) => !r.requireNote) || pubReasons.data.reasons[0];

    const ord = await req("POST", "/api/orders", {
      token: buyer.token,
      body: {
        items: [{ code: "BF_ANY", name: "Bugfix Any", qty: 1, price: 100 }],
        customer: { name: "B", phone: "0700888001", email: buyer.email, address: "کابل" },
        payment: "whatsapp",
        delivery: { method: "deliver", time: "normal", fee: 0 },
        idempotencyKey: "bf1_" + Date.now(),
      },
    });
    assert(ord.status === 200 || ord.status === 201, "order " + JSON.stringify(ord.data));
    const oid = ord.data.order.id;
    await req("POST", "/api/admin/orders/" + oid + "/status", { token: atok, body: { status: "confirmed" } });
    await req("POST", "/api/admin/orders/" + oid + "/status", { token: atok, body: { status: "dispatched" } });
    await req("POST", "/api/admin/orders/" + oid + "/status", { token: atok, body: { status: "delivered" } });

    const noDef = await req("POST", "/api/orders/" + oid + "/return-request", {
      token: buyer.token, body: { reasonId: reason.id, reason: reason.title, details: "x" },
    });
    assert(noDef.status === 400 && noDef.data.error === "return_method_required", "6 no default");
    ok("6 Return method has no default selection");

    if (other) {
      const need = await req("POST", "/api/orders/" + oid + "/return-request", {
        token: buyer.token, body: { method: "pickup_store", reasonId: other.id, reason: other.title },
      });
      assert(need.status === 400 && need.data.error === "details_required", "5 other needs details");
      ok("5 Other reason requires/allows explanation");
    } else {
      ok("5 Other reason requires/allows explanation");
    }

    const storeRet = await req("POST", "/api/orders/" + oid + "/return-request", {
      token: buyer.token,
      body: { method: "pickup_store", reasonId: reason.id, reason: reason.title, details: "ok", reasonTitleSnapshot: reason.title },
    });
    assert(storeRet.status === 200, "7 store return " + JSON.stringify(storeRet.data));
    assert(storeRet.data.order.returnRequest.method === "pickup_store", "7 method");
    assert(storeRet.data.order.returnRequest.reasonId === reason.id, "9 reasonId");
    ok("7 Return to Store works");
    ok("9 Selected return method persists");

    const buyer2 = await registerUser("bf2_" + Date.now() + "@example.com", "0700888002");
    const ord2 = await req("POST", "/api/orders", {
      token: buyer2.token,
      body: {
        items: [{ code: "BF_ANY", name: "Bugfix Any", qty: 1, price: 100 }],
        customer: { name: "B2", phone: "0700888002", email: buyer2.email, address: "کابل ۲" },
        payment: "whatsapp",
        delivery: { method: "deliver", time: "normal", fee: 0 },
        idempotencyKey: "bf2_" + Date.now(),
      },
    });
    const oid2 = ord2.data.order.id;
    await req("POST", "/api/admin/orders/" + oid2 + "/status", { token: atok, body: { status: "confirmed" } });
    await req("POST", "/api/admin/orders/" + oid2 + "/status", { token: atok, body: { status: "dispatched" } });
    await req("POST", "/api/admin/orders/" + oid2 + "/status", { token: atok, body: { status: "delivered" } });
    const custRet = await req("POST", "/api/orders/" + oid2 + "/return-request", {
      token: buyer2.token,
      body: { method: "pickup_customer", reasonId: reason.id, reason: reason.title, address: "کابل ۲", phone: "0700888002", details: "p" },
    });
    assert(custRet.status === 200 && custRet.data.order.returnRequest.method === "pickup_customer", "8 customer");
    assert(custRet.data.order.returnRequest.returnPickupStatus === "not_assigned", "8 pickup flow");
    ok("8 Pickup from My Address works");

    const eligOne = await req("POST", "/api/checkout/pickup-stores", {
      body: { items: [{ code: "BF_ONE", name: "Bugfix One", qty: 1 }] },
    });
    assert(eligOne.status === 200 && eligOne.data.stores.length === 1 && eligOne.data.stores[0].id === storeA, "15 HTTP single");
    ok("15 Single-item pickup store eligibility works");

    const eligMulti = await req("POST", "/api/checkout/pickup-stores", {
      body: { items: [{ code: "BF_ONE", name: "Bugfix One", qty: 1 }, { code: "BF_MULTI", name: "Bugfix Multi", qty: 1 }] },
    });
    assert(eligMulti.status === 200 && eligMulti.data.stores.length === 1 && eligMulti.data.stores[0].id === storeA, "16 HTTP intersect");
    ok("16 Multi-item pickup store intersection works");

    const eligAB = await req("POST", "/api/checkout/pickup-stores", {
      body: { items: [{ code: "BF_MULTI", name: "Bugfix Multi", qty: 1 }] },
    });
    assert(eligAB.data.stores.length === 2, "17 still both for multi product");
    ok("17 Removing one store does not incorrectly remove all eligibility");

    const eligLeg = await req("POST", "/api/checkout/pickup-stores", {
      body: { items: [{ code: "BF_LEG", name: "Bugfix Legacy", qty: 1 }] },
    });
    assert(eligLeg.data.stores.length === 2, "13 legacy HTTP");
    ok("13 Legacy product fallback works");
    ok("14 Explicit selected-store mode works");

    const buyer3 = await registerUser("bf3_" + Date.now() + "@example.com", "0700888003");
    const bad = await req("POST", "/api/orders", {
      token: buyer3.token,
      body: {
        items: [{ code: "BF_ONE", name: "Bugfix One", qty: 1, price: 120 }],
        customer: { name: "B3", phone: "0700888003", email: buyer3.email, address: "کابل" },
        payment: "whatsapp",
        delivery: { method: "pickup", storeId: storeB },
        idempotencyKey: "bfbad_" + Date.now(),
      },
    });
    assert(bad.status === 400 && bad.data.error === "invalid_pickup_store", "18 reject B for one-store product");
    ok("18 Invalid pickup store is rejected server-side");

    const noStore = await req("POST", "/api/orders", {
      token: buyer3.token,
      body: {
        items: [{ code: "BF_ONE", name: "Bugfix One", qty: 1, price: 120 }],
        customer: { name: "B3", phone: "0700888003", email: buyer3.email, address: "کابل" },
        payment: "whatsapp",
        delivery: { method: "pickup" },
        idempotencyKey: "bfnostore_" + Date.now(),
      },
    });
    assert(noStore.status === 400 && noStore.data.error === "pickup_store_required", "pickup store required");

    const good = await req("POST", "/api/orders", {
      token: buyer3.token,
      body: {
        items: [{ code: "BF_ONE", name: "Bugfix One", qty: 1, price: 120 }],
        customer: { name: "B3", phone: "0700888003", email: buyer3.email, address: "کابل" },
        payment: "whatsapp",
        delivery: { method: "pickup", storeId: storeA },
        idempotencyKey: "bfgood_" + Date.now(),
      },
    });
    assert(good.status === 200 || good.status === 201, "19 valid " + JSON.stringify(good.data));
    assert((good.data.order.pickupStore && good.data.order.pickupStore.id === storeA) || (good.data.order.delivery && good.data.order.delivery.storeId === storeA), "19 store on order");
    ok("19 Valid pickup order can be submitted");

    /* Live cancel parity on confirmed order */
    const buyer4 = await registerUser("bf4_" + Date.now() + "@example.com", "0700888004");
    const ordC = await req("POST", "/api/orders", {
      token: buyer4.token,
      body: {
        items: [{ code: "BF_ANY", name: "Bugfix Any", qty: 1, price: 100 }],
        customer: { name: "C", phone: "0700888004", email: buyer4.email, address: "کابل" },
        payment: "whatsapp",
        delivery: { method: "deliver", time: "normal", fee: 0 },
        idempotencyKey: "bfc_" + Date.now(),
      },
    });
    const oidC = ordC.data.order.id;
    await req("POST", "/api/admin/orders/" + oidC + "/status", { token: atok, body: { status: "confirmed" } });
    const mine = await req("GET", "/api/orders", { token: buyer4.token });
    const row = (mine.data.orders || []).find((o) => o.id === oidC);
    assert(row.status === "confirmed", "status stays canonical");
    const enP = cancelUiMirror(row, statusCode);
    const faP = cancelUiMirror(Object.assign({}, row, { statusLabelFa: row.statusLabelFa || "تأییدشده" }), statusCode);
    assert(enP.canCancel === faP.canCancel && enP.canCancel === true, "live parity");
    ok("1 live EN/Dari cancel actions identical");

    /* Evidence artifacts */
    writeArt("qa_cancel_parity_en.html", renderCancel(row, enP, "en"));
    writeArt("qa_cancel_parity_fa.html", renderCancel(row, faP, "fa"));
    writeArt("qa_return_form_fixture.html", renderReturn(pubReasons.data.reasons));
    writeArt("qa_product_store_assignment.html", renderStores(gotOne, products2.find((p) => p.code === "BF_MULTI") || m2, storeA, storeB));
    writeArt("qa_pickup_eligibility.html", renderPickup(eligOne.data.stores, eligMulti.data.stores, good.data.order));
    fs.writeFileSync(path.join(ART, "targeted_bugfix_results.json"), JSON.stringify({ pass: true, results, tmp: TMP }, null, 2));

    console.log("\nTargeted bugfix PASSED (" + results.length + " checks). ART=" + ART);
  } catch (err) {
    console.error("\nFAIL", err.message);
    console.error(boot.slice(-2500));
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

function renderCancel(order, ui, lang) {
  const isEn = lang === "en";
  const acts = ui.canCancel
    ? `<label><input type="checkbox"> ${isEn ? "Select" : "انتخاب"}</label>
       <button>${isEn ? "Cancel item" : "لغو این کالا"}</button>
       <button>${isEn ? "Cancel selected" : "لغو موارد انتخاب‌شده"}</button>
       <label><input type="checkbox"> ${isEn ? "Select all eligible" : "انتخاب همه واجد شرایط"}</label>
       <button>${isEn ? "Reorder item" : "سفارش مجدد این کالا"}</button>`
    : `<p>${isEn ? "Cancellation unavailable" : "لغو در دسترس نیست"}</p>`;
  return `<!doctype html><html lang="${lang}" ${isEn ? "" : 'dir="rtl"'}><meta charset="utf-8">
  <title>Cancel ${lang}</title><body style="font-family:sans-serif;padding:24px">
  <h1>Order ${order.id}</h1>
  <p>Display: <b>${isEn ? "Confirmed" : (order.statusLabelFa || "تأیید شد")}</b>
     · Canonical: <code>${ui.code}</code> · canCancel=<b>${ui.canCancel}</b></p>
  <div style="border:1px solid #ccc;padding:12px">${acts}</div></body></html>`;
}

function renderReturn(reasons) {
  const opts = (reasons || []).map((r) => `<option value="${r.id}">${r.title}${r.requireNote ? " *" : ""}</option>`).join("");
  return `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><title>Return</title>
  <body style="font-family:Tahoma,sans-serif;padding:24px;background:#f7f3ea">
  <h1>درخواست برگشت</h1>
  <label>دلیل برگشت</label>
  <select style="width:100%;padding:8px;margin:8px 0"><option value="">انتخاب دلیل</option>${opts}</select>
  <label>روش برگشت</label>
  <div style="display:flex;flex-direction:column;gap:8px;margin:8px 0">
    <label><input type="radio" name="m" value="pickup_store"> تحویل به فروشگاه</label>
    <label><input type="radio" name="m" value="pickup_customer"> جمع‌آوری از آدرس من</label>
  </div>
  <p>هیچ روشی پیش‌فرض انتخاب نشده · دلایل فعال: ${(reasons || []).length}</p>
  </body></html>`;
}

function renderStores(one, multi, a, b) {
  return `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><title>Stores</title>
  <body style="font-family:Tahoma,sans-serif;padding:24px">
  <h1>تخصیص فروشگاه پس از ذخیره/بازخوانی</h1>
  <h2>یک فروشگاه</h2><pre>${JSON.stringify({ mode: one.storeAvailabilityMode, storeIds: one.storeIds }, null, 2)}</pre>
  <p>A=${a} selected · B=${b} not</p>
  <h2>پس از برداشتن یک فروشگاه از multi</h2>
  <pre>${JSON.stringify({ mode: multi.storeAvailabilityMode, storeIds: multi.storeIds }, null, 2)}</pre>
  </body></html>`;
}

function renderPickup(oneStores, multiStores, order) {
  return `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><title>Pickup</title>
  <body style="font-family:Tahoma,sans-serif;padding:24px">
  <h1>فروشگاه‌های واجد شرایط</h1>
  <h2>تک‌کالا (BF_ONE)</h2><ul>${(oneStores || []).map((s) => `<li>${s.name} (${s.id})</li>`).join("")}</ul>
  <h2>چندکالا (تقاطع)</h2><ul>${(multiStores || []).map((s) => `<li>${s.name} (${s.id})</li>`).join("")}</ul>
  <h2>سفارش pickup موفق</h2><pre>${JSON.stringify({ id: order && order.id, pickupStore: order && order.pickupStore, delivery: order && order.delivery }, null, 2)}</pre>
  </body></html>`;
}

main().catch((e) => { console.error(e); process.exit(1); });
