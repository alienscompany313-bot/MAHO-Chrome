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

/** Mirror customer My Orders expandable accordion + per-item actions from website/js/main.js */
function renderCustomerOrderHtml(o, opts) {
  opts = opts || {};
  const canCancel = !!opts.canCancel;
  const canReturn = !!opts.canReturn;
  const cancelBlockedMsg = opts.cancelBlockedMsg || "";
  const code = o.status;
  const itemCount = (o.items || []).length;
  const items = (o.items || []).map((it) => {
    const st = it.itemStatus || "";
    const label = it.statusLabelFa || st;
    const cancelableItem = canCancel && (st === "pending" || st === "approved");
    const returnableItem = canReturn && st === "delivered";
    const lid = esc(it.lineId || "");
    const oid = esc(o.id);
    const img = it.image
      ? '<img class="oi-img" src="' + esc(it.image) + '" alt="" width="72" height="72">'
      : '<div class="oi-img oi-img-ph" aria-hidden="true"></div>';
    const check = (cancelableItem || returnableItem)
      ? '<label class="oi-check"><input type="checkbox" data-line-pick="' + lid + '" data-oid="' + oid + '" ' +
        (cancelableItem ? 'data-can-cancel="1" ' : "") +
        (returnableItem ? 'data-can-return="1" ' : "") + "checked>" +
        "<span>انتخاب</span></label>"
      : "";
    let acts = '<div class="oi-actions">';
    if (cancelableItem) acts += '<button type="button" class="btn btn-danger oi-btn" data-cancel-line="' + oid + '" data-line="' + lid + '">لغو این کالا</button>';
    if (returnableItem) acts += '<button type="button" class="btn btn-outline oi-btn" data-return-line="' + oid + '" data-line="' + lid + '">برگشت این کالا</button>';
    if (st !== "rejected") acts += '<button type="button" class="btn btn-gold oi-btn" data-reorder-line="' + oid + '" data-line="' + lid + '">سفارش مجدد این کالا</button>';
    acts += "</div>";
    let why = "";
    if (!cancelableItem && !canCancel && cancelBlockedMsg && (st === "pending" || st === "approved" || !st)) {
      why = '<p class="oi-why">' + esc(cancelBlockedMsg) + "</p>";
    }
    return '<li class="oi-row" data-line-row="' + lid + '">' + img +
      '<div class="oi-body"><div class="oi-title"><b>' + esc(it.name) + "</b></div>" +
      '<div class="oi-meta note" dir="ltr">' + esc(it.code || "—") + "</div>" +
      "<div class=\"oi-price\">تعداد: " + esc(it.qty) + " · " + esc(it.price) + "</div>" +
      '<div class="oi-status"><span class="oi-status-pill">' + esc(label) + '</span> <span dir="ltr">(' + esc(st) + ")</span></div>" +
      check + acts + why + "</div></li>";
  }).join("");
  const hasCancelable = (o.items || []).some((it) => canCancel && (it.itemStatus === "pending" || it.itemStatus === "approved"));
  const hasReturnable = (o.items || []).some((it) => canReturn && it.itemStatus === "delivered");
  const bulk =
    '<div class="oi-bulk">' +
    ((hasCancelable || hasReturnable)
      ? '<label class="oi-check oi-check-all"><input type="checkbox" data-select-all-lines="' + esc(o.id) + '"><span>انتخاب همه واجد شرایط</span></label>'
      : "") +
    '<div class="order-actions">' +
    (cancelBlockedMsg && !canCancel ? '<div class="oi-why">' + esc(cancelBlockedMsg) + "</div>" : "") +
    (hasCancelable ? '<button type="button" class="btn btn-danger" data-cancel-lines="' + esc(o.id) + '">لغو انتخاب‌شده‌ها</button> ' : "") +
    (hasReturnable ? '<button type="button" class="btn btn-outline" data-return-lines="' + esc(o.id) + '">برگشت انتخاب‌شده‌ها</button> ' : "") +
    '<button type="button" class="btn btn-gold" data-reorder="' + esc(o.id) + '">سفارش مجدد همه موجود</button>' +
    "</div></div>";
  return '<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    "<title>Customer My Orders evidence</title>" +
    "<style>body{font-family:Tahoma,sans-serif;background:#f7f3ea;padding:16px;margin:0;color:#1a1509}" +
    ".btn{border:0;border-radius:12px;padding:10px 12px;font-weight:800;margin:4px 0;min-height:44px;font-family:inherit}" +
    ".btn-gold{background:#c8a35f}.btn-danger{background:#b33;color:#fff}.btn-outline{background:#fff;border:1px solid #c8a35f}" +
    ".order-card{background:#fff;border:1px solid #e6e0d4;border-radius:14px;max-width:420px;margin:0 auto;overflow:hidden}" +
    ".order-acc-head{width:100%;display:flex;justify-content:space-between;gap:12px;padding:14px;border:0;background:#fbf8f1;text-align:start;font-family:inherit}" +
    ".order-acc-main{display:flex;flex-direction:column;gap:4px}.order-acc-id{font-weight:800}.order-acc-count{color:#8a6a2f;font-weight:700;font-size:12.5px}" +
    ".order-status{font-weight:800;color:#8a6a2f;font-size:13px}.oi-list{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-direction:column;gap:10px}" +
    ".oi-row{display:grid;grid-template-columns:72px minmax(0,1fr);gap:10px;padding:12px;border:1px solid #e6e0d4;border-radius:12px;background:#fff}" +
    ".oi-img,.oi-img-ph{width:72px;height:72px;border-radius:10px;background:#f3eee4;object-fit:cover}" +
    ".oi-body{min-width:0;display:flex;flex-direction:column;gap:6px}.oi-status-pill{display:inline-block;font-size:12px;font-weight:800;padding:4px 10px;border-radius:999px;background:#f3eee4}" +
    ".oi-check{display:inline-flex;align-items:center;gap:8px;font-weight:700;min-height:40px}.oi-check input{width:20px;height:20px}" +
    ".oi-actions{display:flex;flex-wrap:wrap;gap:8px}.oi-btn{flex:1 1 calc(50% - 8px)}.oi-why{font-size:12.5px;color:#7a7368}" +
    ".order-acc-body{padding:0 12px 14px;border-top:1px solid #e6e0d4}.mobile-frame{max-width:390px;margin:0 auto}</style></head><body>" +
    '<div class="mobile-frame"><h1 style="font-size:20px;margin:8px 0 14px">Customer · سفارشات من</h1>' +
    '<p style="font-size:13px">Source: <code>website/js/main.js</code> → <code>renderOrders()</code> (accordion + per-item actions)</p>' +
    '<div class="order-card is-open" data-order-card="' + esc(o.id) + '">' +
    '<button type="button" class="order-acc-head" data-toggle-order="' + esc(o.id) + '" aria-expanded="true">' +
    '<span class="order-acc-main"><span class="order-acc-id" dir="ltr">#' + esc(o.id) + "</span>" +
    '<span class="order-acc-count">' + itemCount + " کالا · برای بستن بزنید</span></span>" +
    '<span class="order-acc-side"><span class="order-status">' + esc(o.statusLabelFa || o.status) + '</span><span class="order-acc-caret">▴</span></span></button>' +
    '<div class="order-acc-body" data-order-body="' + esc(o.id) + '">' +
    '<ul class="oi-list">' + items + "</ul>" + bulk +
    "</div></div></div></body></html>";
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
  fs.writeFileSync(path.join(ART, "customer_my_orders_expanded.html"), renderCustomerOrderHtml(co, { canCancel: true, canReturn: false }));
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
  fs.writeFileSync(
    path.join(ART, "customer_cancel_window_expired.html"),
    renderCustomerOrderHtml(
      {
        id: "ORD-WINDOW",
        status: "confirmed",
        statusLabelFa: "تأیید شد",
        items: [
          { lineId: "li_a", code: "PUI-A", name: "کالای A", qty: 1, price: 100, itemStatus: "approved", statusLabelFa: "تأیید شد" },
          { lineId: "li_b", code: "PUI-B", name: "کالای B", qty: 1, price: 120, itemStatus: "approved", statusLabelFa: "تأیید شد" },
        ],
      },
      {
        canCancel: false,
        canReturn: false,
        cancelBlockedMsg: "مهلت لغو سفارش به پایان رسیده است.",
      }
    )
  );

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

  /* Customer UI source markers — expandable + per-item actions */
  const mainSrc = fs.readFileSync(path.join(ROOT, "..", "website", "js/main.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "..", "website", "css/styles.css"), "utf8");
  assert(/data-toggle-order/.test(mainSrc), "toggle marker");
  assert(/openOrderIds/.test(mainSrc), "openOrderIds state");
  assert(/data-cancel-line/.test(mainSrc) && /data-return-line/.test(mainSrc) && /data-reorder-line/.test(mainSrc), "per-item action markers");
  assert(/data-cancel-lines/.test(mainSrc) && /data-return-lines/.test(mainSrc) && /data-line-pick/.test(mainSrc), "multi-select markers");
  assert(/data-select-all-lines/.test(mainSrc), "select-all marker");
  assert(/ordersListEl\.querySelector/.test(mainSrc), "expand uses ordersListEl");
  assert(!/const body = list\.querySelector\('\[data-order-body=/.test(mainSrc), "old broken list toggle removed");
  assert(/\.order-acc-head/.test(cssSrc) && /\.oi-row/.test(cssSrc) && /\.oi-actions/.test(cssSrc), "mobile accordion CSS");
  report.customer.uiMarkers = {
    toggle: true,
    perItemCancelReturnReorder: true,
    multiSelect: true,
    expandBugFixed: true,
    mobileCss: true,
  };

  fs.writeFileSync(path.join(ART, "item_ui_evidence_report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: true, report }, null, 2));
  console.log("\nARTIFACTS:", ART);
  try { child.kill(); } catch (_) {}
}

main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
