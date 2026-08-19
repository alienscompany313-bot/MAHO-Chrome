"use strict";
/**
 * Local-only evidence: multi-item Admin + Customer item-level UI.
 * Temp DATA_DIR only — never touches production.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const { spawn } = require("child_process");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "maho-ui-ev-"));
const DATA = path.join(TMP, "data");
const UPLOADS = path.join(TMP, "uploads");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });
const ROOT = path.join(__dirname, "..");
const ART = "/opt/cursor/artifacts";
fs.mkdirSync(ART, { recursive: true });
const PORT = 18991 + Math.floor(Math.random() * 200);
const ADMIN_PASS = "SecureTestPass1!";
const SITE = "http://127.0.0.1:" + PORT;

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assert failed");
}
function req(method, p, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const body = opts.body != null ? JSON.stringify(opts.body) : null;
    const headers = Object.assign({ Accept: "application/json" }, opts.headers || {});
    if (body) headers["Content-Type"] = "application/json";
    if (opts.token) headers.Authorization = "Bearer " + opts.token;
    const r = http.request(
      { hostname: "127.0.0.1", port: PORT, path: p, method, headers },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          let data = {};
          try { data = d ? JSON.parse(d) : {}; } catch (_) { data = { raw: d }; }
          resolve({ status: res.statusCode, data });
        });
      }
    );
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Mirror Admin renderOrdersAdmin item row markup from website/admin.html */
function renderAdminOrderHtml(o) {
  const items = (o.items || []).map((it) => {
    const st = it.itemStatus || "";
    const stFa = ({
      pending: "در انتظار", approved: "تأییدشده", rejected: "ردشده",
      cancelled: "لغوشده", shipped: "ارسال/آماده", delivered: "تحویل‌شده",
      return_requested: "درخواست برگشت",
    })[st] || st || "—";
    const lid = esc(it.lineId || "");
    let btns = "";
    if (st === "pending") {
      btns += '<button type="button" class="btn btn-gold btn-sm" data-item-approve="' + esc(o.id) + '" data-line="' + lid + '">تأیید آیتم</button> ';
      btns += '<button type="button" class="btn btn-danger btn-sm" data-item-reject="' + esc(o.id) + '" data-line="' + lid + '">رد آیتم</button>';
    } else if (st === "approved") {
      btns += '<button type="button" class="btn btn-outline btn-sm" data-item-ship="' + esc(o.id) + '" data-line="' + lid + '">ارسال/آماده‌سازی این آیتم</button> ';
      btns += '<button type="button" class="btn btn-danger btn-sm" data-item-reject="' + esc(o.id) + '" data-line="' + lid + '">رد آیتم</button>';
    } else if (st === "shipped") {
      btns += '<button type="button" class="btn btn-gold btn-sm" data-item-deliver-line="' + esc(o.id) + '" data-line="' + lid + '">تحویل این آیتم</button>';
    }
    return '<li class="adm-item-row" style="display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap;margin:10px 0;padding:12px;border:1px solid #e6e0d4;border-radius:12px;background:#fff">' +
      '<div style="flex:1"><b>' + esc(it.name) + '</b> · <span dir="ltr">' + esc(it.code) + '</span> · lineId=<code dir="ltr">' + lid + '</code>' +
      '<div style="font-weight:800;margin-top:6px">وضعیت آیتم: ' + esc(stFa) + ' <span dir="ltr">(' + esc(st) + ')</span></div>' +
      (btns ? '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">' + btns + '</div>' : '') +
      '</div></li>';
  }).join("");
  const hasPending = (o.items || []).some((it) => it && it.itemStatus === "pending");
  const bulk = hasPending
    ? '<div style="display:flex;flex-wrap:wrap;gap:6px;margin:12px 0">' +
      '<button class="btn btn-gold btn-sm" data-item-approve-all="' + esc(o.id) + '">تأیید همه آیتم‌های واجد شرایط</button>' +
      '<button class="btn btn-danger btn-sm" data-item-reject-all="' + esc(o.id) + '">رد همه آیتم‌های واجد شرایط</button></div>'
    : "";
  return '<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>Admin item controls evidence</title>' +
    '<style>body{font-family:Tahoma,sans-serif;background:#f7f3ea;padding:24px;color:#1a1509}' +
    '.btn{border:0;border-radius:10px;padding:8px 12px;font-weight:800;cursor:default}' +
    '.btn-gold{background:#c8a35f;color:#1a1509}.btn-danger{background:#b33;color:#fff}.btn-outline{background:#fff;border:1px solid #c8a35f}' +
    '.card{background:#fbf8f1;border:1px solid #e6e0d4;border-radius:16px;padding:18px;max-width:820px;margin:0 auto}</style></head><body>' +
    '<div class="card"><h1>Admin · سفارش‌ها · کنترل آیتم‌به‌آیتم</h1>' +
    '<p>File: <code>website/admin.html</code> → <code>renderOrdersAdmin()</code></p>' +
    '<p>Order <b dir="ltr">' + esc(o.id) + '</b> · aggregate status: <b dir="ltr">' + esc(o.status) + '</b></p>' +
    bulk + '<ul style="list-style:none;padding:0">' + items + '</ul></div></body></html>';
}

/** Mirror customer My Orders item detail markup from website/js/main.js */
function renderCustomerOrderHtml(o, opts) {
  opts = opts || {};
  const canCancel = !!opts.canCancel;
  const canReturn = !!opts.canReturn;
  const code = o.status;
  const items = (o.items || []).map((it) => {
    const st = it.itemStatus || "";
    const label = it.statusLabelFa || st;
    const cancelableItem = canCancel && (st === "pending" || st === "approved");
    const returnableItem = canReturn && st === "delivered";
    const checks = (cancelableItem || returnableItem)
      ? '<label style="display:flex;align-items:center;gap:6px;margin-top:6px;font-weight:700">' +
        '<input type="checkbox" data-line-pick="' + esc(it.lineId) + '" ' +
        (cancelableItem ? 'data-can-cancel="1" ' : "") +
        (returnableItem ? 'data-can-return="1" ' : "") + "checked> " +
        "انتخاب برای " + (cancelableItem ? "لغو" : "برگشت") + "</label>"
      : '<div class="note" style="margin-top:6px;color:#7a7368">اقدام آیتم در این وضعیت در دسترس نیست</div>';
    return '<li style="display:flex;gap:10px;margin:10px 0;padding:12px;border:1px solid #e6e0d4;border-radius:12px;background:#fff">' +
      '<div style="flex:1"><b>' + esc(it.name) + '</b><div class="note" dir="ltr">' + esc(it.code) + " · " + esc(it.lineId) + "</div>" +
      '<div>وضعیت: <b>' + esc(label) + '</b> <span dir="ltr">(' + esc(st) + ")</span></div>" + checks + "</div></li>";
  }).join("");
  const actions =
    (canCancel ? '<button class="btn btn-danger" data-cancel-lines="' + esc(o.id) + '">لغو آیتم‌های انتخاب‌شده</button> ' : "") +
    (canReturn ? '<button class="btn btn-outline" data-return-lines="' + esc(o.id) + '">برگشت آیتم‌های انتخاب‌شده</button> ' : "") +
    '<button class="btn btn-gold" data-reorder="' + esc(o.id) + '">سفارش مجدد</button>';
  return '<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>Customer item actions evidence</title>' +
    '<style>body{font-family:Tahoma,sans-serif;background:#f7f3ea;padding:24px}' +
    '.btn{border:0;border-radius:10px;padding:8px 12px;font-weight:800;margin:4px}' +
    '.btn-gold{background:#c8a35f}.btn-danger{background:#b33;color:#fff}.btn-outline{background:#fff;border:1px solid #c8a35f}' +
    '.card{background:#fbf8f1;border:1px solid #e6e0d4;border-radius:16px;padding:18px;max-width:820px;margin:0 auto}</style></head><body>' +
    '<div class="card"><h1>Customer · سفارشات من · جزئیات آیتم</h1>' +
    '<p>File: <code>website/js/main.js</code> → <code>renderOrders()</code></p>' +
    '<p>Order <b dir="ltr">' + esc(o.id) + '</b> · aggregate: <b>' + esc(o.statusLabelFa || o.status) + '</b> <span dir="ltr">(' + esc(code) + ")</span></p>" +
    '<ul style="list-style:none;padding:0">' + items + "</ul>" +
    '<div style="margin-top:12px">' + actions + "</div></div></body></html>";
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const child = spawn(process.execPath, [path.join(ROOT, "index.js")], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      NODE_ENV: "development",
      ADMIN_PASSWORD: ADMIN_PASS,
      DATA_DIR: DATA,
      UPLOAD_DIR: UPLOADS,
      ALLOW_DEV_CODES: "true",
      TOKEN_PEPPER: "ui-ev-pepper",
      SITE_URL: SITE,
      ALLOWED_ORIGINS: SITE,
      CUSTOMER_CANCEL_WINDOW_MS: "7200000",
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let boot = "";
  child.stdout.on("data", (c) => { boot += c; });
  child.stderr.on("data", (c) => { boot += c; });
  for (let i = 0; i < 40; i++) {
    try {
      const h = await req("GET", "/api/health");
      if (h.status === 200) break;
    } catch (_) {}
    await sleep(200);
  }

  const report = {
    tmp: TMP,
    port: PORT,
    admin: {},
    customer: {},
    uiLocations: {
      admin: "website/admin.html → renderOrdersAdmin() (per-item buttons beside each .adm-item-row)",
      customer: "website/js/main.js → renderOrders() (checkboxes data-line-pick + data-cancel-lines / data-return-lines)",
    },
  };

  /* Admin login */
  const login = await req("POST", "/api/admin/login", { body: { password: ADMIN_PASS } });
  assert(login.status === 200 && login.data.token, "admin login");
  const tok = login.data.token;

  /* Seed 3 products via admin catalog */
  const cat = await req("GET", "/api/admin/state", { token: tok });
  assert(cat.status === 200, "admin state");
  const products = [
    { name: "کالای A", name_en: "Item A", code: "PUI-A", price: 1000, stock: 20, cat: "dress", active: true, images: [] },
    { name: "کالای B", name_en: "Item B", code: "PUI-B", price: 2000, stock: 20, cat: "dress", active: true, images: [] },
    { name: "کالای C", name_en: "Item C", code: "PUI-C", price: 3000, stock: 20, cat: "dress", active: true, images: [] },
  ];
  const save = await req("PUT", "/api/admin/catalog", {
    token: tok,
    body: {
      products: (cat.data.products || []).concat(products),
      stores: cat.data.stores || [{ id: "store_0", name: "MAHO Store", address: "Kabul", phone: "+93790000000", hours: "9-6", lat: 34.5, lng: 69.1 }],
      config: cat.data.config || {},
    },
  });
  assert(save.status === 200, "catalog save");

  /* Customer register + verify */
  const email = "ui-evidence-" + Date.now() + "@example.com";
  const reg = await req("POST", "/api/auth/register", {
    body: { name: "UI Evidence", email, phone: "0700111222", password: "BuyerPass99", marketingConsent: true, address: "Kabul" },
  });
  assert(reg.status === 200 && reg.data.devCode, "register got " + reg.status + " " + JSON.stringify(reg.data));
  await req("POST", "/api/auth/verify", { body: { email, code: reg.data.devCode } });
  const lg = await req("POST", "/api/auth/login", { body: { email, password: "BuyerPass99" } });
  assert(lg.status === 200 && lg.data.token, "customer login " + JSON.stringify(lg.data));
  const userTok = lg.data.token;

  /* Place 3-item order */
  const orderRes = await req("POST", "/api/orders", {
    token: userTok,
    body: {
      items: [
        { code: "PUI-A", name: "کالای A", qty: 1 },
        { code: "PUI-B", name: "کالای B", qty: 1 },
        { code: "PUI-C", name: "کالای C", qty: 1 },
      ],
      customer: { name: "UI Evidence", phone: "0700111222", email, address: "Kabul" },
      payment: "whatsapp",
      delivery: { method: "deliver", time: "normal", fee: 0 },
    },
  });
  assert(orderRes.status === 200 && orderRes.data.order, "create multi-item order " + JSON.stringify(orderRes.data));
  let order = orderRes.data.order;
  assert(order.items.length === 3, "3 items");
  assert(order.items.every((it) => it.lineId && it.itemStatus === "pending"), "all pending with lineId");
  const [A, B, C] = order.items;
  report.fixture = { orderId: order.id, lines: order.items.map((it) => ({ lineId: it.lineId, code: it.code, status: it.itemStatus })) };

  /* Snapshot BEFORE admin actions */
  fs.writeFileSync(path.join(ART, "admin_items_before.html"), renderAdminOrderHtml(order));

  /* Approve A only */
  const appr = await req("POST", "/api/admin/orders/" + order.id + "/items/approve", {
    token: tok, body: { lineIds: [A.lineId] },
  });
  assert(appr.status === 200, "approve A");
  order = appr.data.order;
  let items = order.items;
  assert(items.find((x) => x.lineId === A.lineId).itemStatus === "approved", "A approved");
  assert(items.find((x) => x.lineId === B.lineId).itemStatus === "pending", "B still pending");
  assert(items.find((x) => x.lineId === C.lineId).itemStatus === "pending", "C still pending");

  /* Reject B only */
  const rej = await req("POST", "/api/admin/orders/" + order.id + "/items/reject", {
    token: tok, body: { lineIds: [B.lineId], reason: "ناموجود" },
  });
  assert(rej.status === 200, "reject B");
  order = rej.data.order;
  items = order.items;
  assert(items.find((x) => x.lineId === A.lineId).itemStatus === "approved", "A unchanged approved");
  assert(items.find((x) => x.lineId === B.lineId).itemStatus === "rejected", "B rejected");
  assert(items.find((x) => x.lineId === C.lineId).itemStatus === "pending", "C still pending");
  assert(order.status === "new" || order.status === "confirmed", "aggregate after A approve + B reject + C pending: " + order.status);

  /* Ship A (individual) */
  const ship = await req("POST", "/api/admin/orders/" + order.id + "/items/ship", {
    token: tok, body: { lineIds: [A.lineId] },
  });
  assert(ship.status === 200, "ship A " + JSON.stringify(ship.data));
  order = ship.data.order;
  assert(order.items.find((x) => x.lineId === A.lineId).itemStatus === "shipped", "A shipped");
  assert(order.items.find((x) => x.lineId === C.lineId).itemStatus === "pending", "C still pending after ship A");

  fs.writeFileSync(path.join(ART, "admin_items_after_independent.html"), renderAdminOrderHtml(order));
  report.admin.afterIndependent = {
    A: order.items.find((x) => x.lineId === A.lineId).itemStatus,
    B: order.items.find((x) => x.lineId === B.lineId).itemStatus,
    C: order.items.find((x) => x.lineId === C.lineId).itemStatus,
    aggregate: order.status,
  };

  /* Fresh order for approve-all */
  const order2 = await req("POST", "/api/orders", {
    token: userTok,
    body: {
      items: [
        { code: "PUI-A", name: "کالای A", qty: 1 },
        { code: "PUI-B", name: "کالای B", qty: 1 },
      ],
      customer: { name: "UI Evidence", phone: "0700111222", email, address: "Kabul" },
      payment: "whatsapp",
      delivery: { method: "deliver", time: "normal", fee: 0 },
    },
  });
  assert(order2.status === 200, "order2");
  const o2 = order2.data.order;
  const all = await req("POST", "/api/admin/orders/" + o2.id + "/items/approve", {
    token: tok, body: { lineIds: [] }, /* empty = approve all eligible — same as Approve All UI */
  });
  assert(all.status === 200, "approve all");
  assert(all.data.order.items.every((it) => it.itemStatus === "approved"), "approve-all both approved");
  report.admin.approveAll = { orderId: o2.id, statuses: all.data.order.items.map((it) => it.itemStatus), aggregate: all.data.order.status };

  /* Reject-all on another order */
  const order3 = await req("POST", "/api/orders", {
    token: userTok,
    body: {
      items: [
        { code: "PUI-A", name: "کالای A", qty: 1 },
        { code: "PUI-C", name: "کالای C", qty: 1 },
      ],
      customer: { name: "UI Evidence", phone: "0700111222", email, address: "Kabul" },
      payment: "whatsapp",
      delivery: { method: "deliver", time: "normal", fee: 0 },
    },
  });
  const o3 = order3.data.order;
  const rejAll = await req("POST", "/api/admin/orders/" + o3.id + "/items/reject", {
    token: tok, body: { lineIds: [], reason: "bulk" },
  });
  assert(rejAll.status === 200, "reject all");
  assert(rejAll.data.order.items.every((it) => it.itemStatus === "rejected"), "reject-all");
  report.admin.rejectAll = { orderId: o3.id, statuses: rejAll.data.order.items.map((it) => it.itemStatus), aggregate: rejAll.data.order.status };

  /* Verify admin.html source contains per-item controls */
  const adminSrc = fs.readFileSync(path.join(ROOT, "..", "website", "admin.html"), "utf8");
  assert(/data-item-approve/.test(adminSrc) && /data-item-approve-all/.test(adminSrc), "admin UI markers in source");
  assert(/data-item-reject/.test(adminSrc) && /data-item-ship/.test(adminSrc), "admin reject/ship markers");

  /* ========== CUSTOMER item cancel ========== */
  const cancelOrder = await req("POST", "/api/orders", {
    token: userTok,
    body: {
      items: [
        { code: "PUI-A", name: "کالای A", qty: 1 },
        { code: "PUI-B", name: "کالای B", qty: 1 },
      ],
      customer: { name: "UI Evidence", phone: "0700111222", email, address: "Kabul" },
      payment: "whatsapp",
      delivery: { method: "deliver", time: "normal", fee: 0 },
    },
  });
  let co = cancelOrder.data.order;
  await req("POST", "/api/admin/orders/" + co.id + "/items/approve", { token: tok, body: { lineIds: [] } });
  const mine1 = await req("GET", "/api/orders", { token: userTok });
  co = (mine1.data.orders || []).find((x) => x.id === co.id);
  assert(co, "customer sees cancel order");
  fs.writeFileSync(path.join(ART, "customer_cancel_before.html"), renderCustomerOrderHtml(co, { canCancel: true, canReturn: false }));

  const cA = co.items[0];
  const cB = co.items[1];
  const cancelOne = await req("POST", "/api/orders/" + co.id + "/items/" + cA.lineId + "/cancel", {
    token: userTok, body: { reason: "changed mind" },
  });
  assert(cancelOne.status === 200, "cancel one item");
  const mine2 = await req("GET", "/api/orders", { token: userTok });
  co = (mine2.data.orders || []).find((x) => x.id === cancelOrder.data.order.id);
  assert(co.items.find((x) => x.lineId === cA.lineId).itemStatus === "cancelled", "A cancelled");
  assert(co.items.find((x) => x.lineId === cB.lineId).itemStatus === "approved", "B sibling unchanged");
  fs.writeFileSync(path.join(ART, "customer_cancel_after.html"), renderCustomerOrderHtml(co, { canCancel: true, canReturn: false }));
  report.customer.cancel = {
    orderId: co.id,
    after: co.items.map((it) => ({ code: it.code, status: it.itemStatus })),
    aggregate: co.status,
    statusLabelFa: co.statusLabelFa,
  };

  /* Cancel window: ineligible after ship — server rejects; time-window unit probe (in-memory DB) */
  const shipBlock = await req("POST", "/api/orders", {
    token: userTok,
    body: {
      items: [{ code: "PUI-A", name: "کالای A", qty: 1 }],
      customer: { name: "UI Evidence", phone: "0700111222", email, address: "Kabul" },
      payment: "whatsapp",
      delivery: { method: "deliver", time: "normal", fee: 0 },
    },
  });
  const sb = shipBlock.data.order;
  await req("POST", "/api/admin/orders/" + sb.id + "/items/approve", { token: tok, body: { lineIds: [] } });
  await req("POST", "/api/admin/orders/" + sb.id + "/items/ship", { token: tok, body: { lineIds: [sb.items[0].lineId] } });
  const cancelShipped = await req("POST", "/api/orders/" + sb.id + "/items/" + sb.items[0].lineId + "/cancel", {
    token: userTok, body: {},
  });
  assert(cancelShipped.status >= 400, "cancel rejected after ship " + cancelShipped.status);
  const { customerCanCancelItem, itemReturnEligible } = require("../lib/order-items");
  const expiredCancelProbe = {
    status: "confirmed",
    delivery: { method: "deliver", time: "normal" },
    approvedAt: Date.now() - 3 * 60 * 60 * 1000,
    cancelDeadline: Date.now() - 1000,
    items: [{ lineId: "li_exp", itemStatus: "approved" }],
  };
  const eligCancel = customerCanCancelItem(expiredCancelProbe, expiredCancelProbe.items[0]);
  assert(!eligCancel.ok, "cancel window unit reject: " + JSON.stringify(eligCancel));
  report.customer.cancelWindow = {
    httpAfterShip: { status: cancelShipped.status, error: cancelShipped.data.error },
    unitExpired: eligCancel,
  };

  /* ========== CUSTOMER item return ========== */
  const retOrder = await req("POST", "/api/orders", {
    token: userTok,
    body: {
      items: [
        { code: "PUI-A", name: "کالای A", qty: 1 },
        { code: "PUI-B", name: "کالای B", qty: 1 },
      ],
      customer: { name: "UI Evidence", phone: "0700111222", email, address: "Kabul" },
      payment: "whatsapp",
      delivery: { method: "deliver", time: "normal", fee: 0 },
    },
  });
  let ro = retOrder.data.order;
  await req("POST", "/api/admin/orders/" + ro.id + "/items/approve", { token: tok, body: { lineIds: [] } });
  await req("POST", "/api/admin/orders/" + ro.id + "/items/ship", {
    token: tok, body: { lineIds: ro.items.map((it) => it.lineId) },
  });
  await req("POST", "/api/admin/orders/" + ro.id + "/items/deliver", {
    token: tok, body: { lineIds: ro.items.map((it) => it.lineId) },
  });
  const mineR = await req("GET", "/api/orders", { token: userTok });
  ro = (mineR.data.orders || []).find((x) => x.id === retOrder.data.order.id);
  fs.writeFileSync(path.join(ART, "customer_return_before.html"), renderCustomerOrderHtml(ro, { canCancel: false, canReturn: true }));

  const rA = ro.items[0];
  const rB = ro.items[1];
  const retOne = await req("POST", "/api/orders/" + ro.id + "/items/" + rA.lineId + "/return-request", {
    token: userTok, body: { reason: "size", method: "pickup_store" },
  });
  assert(retOne.status === 200, "return one " + JSON.stringify(retOne.data));
  const mineR2 = await req("GET", "/api/orders", { token: userTok });
  ro = (mineR2.data.orders || []).find((x) => x.id === retOrder.data.order.id);
  assert(ro.items.find((x) => x.lineId === rA.lineId).itemStatus === "return_requested", "A return requested");
  assert(ro.items.find((x) => x.lineId === rB.lineId).itemStatus === "delivered", "B sibling still delivered");
  fs.writeFileSync(path.join(ART, "customer_return_after.html"), renderCustomerOrderHtml(ro, { canCancel: false, canReturn: true }));
  report.customer.return = {
    orderId: ro.id,
    after: ro.items.map((it) => ({ code: it.code, status: it.itemStatus, label: it.statusLabelFa })),
    aggregate: ro.status,
    statusLabelFa: ro.statusLabelFa,
  };

  /* Return window expired — unit probe (server DB is in-memory; same pattern as smoke-production-ops) */
  const eligRet = itemReturnEligible(
    {
      status: "delivered",
      items: [{
        lineId: "li_x", itemStatus: "delivered",
        deliveredAt: Date.now() - 10 * 86400000,
        returnDeadlineAt: Date.now() - 1000,
      }],
    },
    {
      lineId: "li_x", itemStatus: "delivered",
      deliveredAt: Date.now() - 10 * 86400000,
      returnDeadlineAt: Date.now() - 1000,
    }
  );
  assert(!eligRet.ok, "return window unit reject");
  report.customer.returnWindow = eligRet;

  /* Customer UI source markers */
  const mainSrc = fs.readFileSync(path.join(ROOT, "..", "website", "js/main.js"), "utf8");
  assert(/data-cancel-lines/.test(mainSrc) && /data-return-lines/.test(mainSrc) && /data-line-pick/.test(mainSrc), "customer UI markers");

  fs.writeFileSync(path.join(ART, "item_ui_evidence_report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: true, report }, null, 2));
  console.log("\nARTIFACTS:", ART);
  try { child.kill(); } catch (_) {}
}

main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
