"use strict";

const crypto = require("crypto");
const { toMinor, fromMinor, addMinor } = require("./money");

const KABUL_OFFSET_MS = (4 * 60 + 30) * 60 * 1000;

function ensureLedger(db) {
  let changed = false;
  if (!Array.isArray(db.ledger)) { db.ledger = []; changed = true; }
  if (!db.ledgerSeq) { db.ledgerSeq = 100000; changed = true; }
  return changed;
}

function kabulParts(ts) {
  const d = new Date(Number(ts) + KABUL_OFFSET_MS);
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth(),
    day: d.getUTCDate(),
    dow: d.getUTCDay(),
  };
}

function kabulDayStart(ts) {
  const p = kabulParts(ts);
  return Date.UTC(p.y, p.m, p.day) - KABUL_OFFSET_MS;
}

function rangeFor(name, now) {
  const t = typeof now === "number" ? now : Date.now();
  const startToday = kabulDayStart(t);
  const p = kabulParts(t);
  if (name === "today") return { from: startToday, to: startToday + 86400000 };
  if (name === "week") {
    const sinceSat = (p.dow + 1) % 7;
    const from = startToday - sinceSat * 86400000;
    return { from: from, to: from + 7 * 86400000 };
  }
  if (name === "month") {
    const from = Date.UTC(p.y, p.m, 1) - KABUL_OFFSET_MS;
    const to = Date.UTC(p.y, p.m + 1, 1) - KABUL_OFFSET_MS;
    return { from: from, to: to };
  }
  if (name === "year") {
    const from = Date.UTC(p.y, 0, 1) - KABUL_OFFSET_MS;
    const to = Date.UTC(p.y + 1, 0, 1) - KABUL_OFFSET_MS;
    return { from: from, to: to };
  }
  return null;
}

function parseDay(value, end) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!m) return null;
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - KABUL_OFFSET_MS;
  return end ? utc + 86400000 : utc;
}

function nextId(db) {
  ensureLedger(db);
  db.ledgerSeq += 1;
  return "TXN-" + db.ledgerSeq;
}

function findIdempotent(db, key) {
  if (!key) return null;
  return (db.ledger || []).find((row) => row && row.idempotencyKey === key) || null;
}

const TXN_STATUS = { pending: 1, authorized: 1, settled: 1, failed: 1, refunded: 1 };

/**
 * Channel is recorded, never inferred from the payment method.
 * "website" is the historical storefront value and reports as online.
 * "pos" is the historical in-person value.
 * Empty, admin, or manual means the channel was not recorded.
 */
function classifyChannel(raw) {
  const s = String(raw == null ? "" : raw).trim().toLowerCase();
  if (!s || s === "admin" || s === "manual" || s === "unknown" || s === "unclassified") {
    return { channel: "unclassified", reliable: false, raw: s };
  }
  if (s === "online" || s === "website") return { channel: "online", reliable: true, raw: s };
  if (s === "in_person" || s === "in-person" || s === "pos" || s === "instore") {
    return { channel: "in_person", reliable: true, raw: s };
  }
  return { channel: s.slice(0, 40), reliable: true, raw: s };
}

function collectionBucket(row) {
  const info = classifyChannel(row && row.channel);
  if (!info.reliable) return "unclassified";
  if (info.channel === "online") return "online";
  if (info.channel === "in_person") return "inPerson";
  return "otherChannel";
}

function append(db, row) {
  ensureLedger(db);
  const existing = findIdempotent(db, row.idempotencyKey);
  if (existing) return { txn: existing, duplicate: true };
  const requested = String(row.status || "settled");
  const txn = {
    id: row.id || nextId(db),
    orderId: String(row.orderId || ""),
    type: row.type === "refund" ? "refund" : "payment",
    amountMinor: Math.max(0, Math.round(Number(row.amountMinor) || 0)),
    currency: "AFN",
    method: String(row.method || "manual").slice(0, 40),
    status: TXN_STATUS[requested] ? requested : "settled",
    channel: String(row.channel || "unclassified").slice(0, 40),
    at: Number(row.at) || Date.now(),
    actor: row.actor || null,
    externalRef: String(row.externalRef || "").slice(0, 120),
    idempotencyKey: String(row.idempotencyKey || "").slice(0, 120),
    paymentId: String(row.paymentId || "").slice(0, 40),
    legacy: false,
    note: String(row.note || "").slice(0, 240),
  };
  if (!txn.amountMinor || !txn.orderId) return { error: "bad_txn" };
  db.ledger.push(txn);
  return { txn: txn, duplicate: false };
}

function orderMoney(order) {
  const items = order.items || [];
  let listMinor = 0;
  let chargedMinor = 0;
  items.forEach((it) => {
    const qty = Math.max(1, parseInt(it.qty, 10) || 1);
    const unit = Number(it.price) || 0;
    const list = it.listPrice != null ? Number(it.listPrice) : unit;
    chargedMinor += toMinor(unit * qty);
    listMinor += toMinor(list * qty);
  });
  const itemDiscount = Math.max(0, listMinor - chargedMinor);
  const orderDiscount = toMinor(order.discountTotal || 0);
  const shipping = toMinor(order.deliveryFee || 0);
  const tax = toMinor(order.tax || 0);
  const total = order.total != null ? toMinor(order.total) : Math.max(0, chargedMinor - orderDiscount + shipping + tax);
  return { listMinor, chargedMinor, itemDiscount, orderDiscount, shipping, tax, total };
}

function txnsFor(db, orderId) {
  return (db.ledger || []).filter((row) => row && row.orderId === orderId);
}

function isCancelled(order) {
  return order && (order.status === "cancelled" || order.status === "canceled");
}

const APPROVED_RETURN = { return_approved: 1, returned: 1, return_completed: 1 };

function returnedMinor(order) {
  let minor = 0;
  (order.items || []).forEach((it) => {
    const st = String(it.itemStatus || "");
    if (!APPROVED_RETURN[st]) return;
    const qty = it.returnQty != null && it.returnQty !== ""
      ? Math.max(0, parseInt(it.returnQty, 10) || 0)
      : Math.max(0, parseInt(it.qty, 10) || 0);
    minor += toMinor((Number(it.price) || 0) * qty);
  });
  return minor;
}

function settledSum(rows, type) {
  return rows.filter((r) => r.type === type && r.status === "settled").reduce((s, r) => s + r.amountMinor, 0);
}

function pendingRefund(rows) {
  return rows.filter((r) => r.type === "refund" && r.status === "pending").reduce((s, r) => s + r.amountMinor, 0);
}

/**
 * Accounting model, integer minor units. A figure is used on one side only.
 *
 * charged = original order total
 * credit = approved return value, capped at charged. Requests do not count.
 * amountDue = 0 when the order is cancelled, otherwise charged - credit
 * collected = settled payments. Cancellation does not remove them.
 * refunded = settled refunds only
 * netCollected = collected - refunded
 * receivable = max(0, amountDue - netCollected)
 * refundDue = max(0, netCollected - amountDue)
 *
 * A return lowers amountDue. A completed refund lowers netCollected.
 * The same amount is not subtracted from both sides.
 */
function orderAccount(db, order) {
  const money = orderMoney(order);
  const rows = txnsFor(db, order.id);
  const collected = settledSum(rows, "payment");
  const refunded = settledSum(rows, "refund");
  const pending = pendingRefund(rows);
  const tracked = !!(order.finance && order.finance.tracked);
  const cancelled = isCancelled(order);
  const returned = returnedMinor(order);
  const credit = Math.min(money.total, returned);
  const amountDue = cancelled || !tracked ? 0 : Math.max(0, money.total - credit);
  const netCollected = Math.max(0, collected - refunded);
  const receivable = Math.max(0, amountDue - netCollected);
  const refundDue = Math.max(0, netCollected - amountDue);
  return {
    orderId: order.id,
    tracked: tracked,
    legacy: !tracked,
    cancelled: cancelled,
    status: order.status || "",
    payment: order.payment || "",
    paymentStatus: order.paymentStatus || "",
    channel: (order.finance && order.finance.channel) || "",
    at: order.date || 0,
    customer: (order.customer && (order.customer.customerNo || order.customer.email || order.customer.name)) || "",
    grossMinor: money.listMinor,
    itemDiscountMinor: money.itemDiscount,
    couponMinor: money.orderDiscount,
    shippingMinor: money.shipping,
    taxMinor: money.tax,
    totalMinor: money.total,
    creditMinor: credit,
    amountDueMinor: amountDue,
    collectedMinor: collected,
    refundedMinor: refunded,
    pendingRefundMinor: pending,
    netCollectedMinor: netCollected,
    outstandingMinor: receivable,
    refundDueMinor: refundDue,
    returnedMinor: returned,
    transactions: rows,
  };
}

function inRange(ts, from, to) {
  if (from != null && ts < from) return false;
  if (to != null && ts >= to) return false;
  return true;
}

function summarize(db, opts) {
  ensureLedger(db);
  const o = opts || {};
  const now = o.now || Date.now();
  let from = o.from;
  let to = o.to;
  if (o.range) {
    const preset = rangeFor(o.range, now);
    if (preset) { from = preset.from; to = preset.to; }
  }
  if (o.fromDay) from = parseDay(o.fromDay, false);
  if (o.toDay) to = parseDay(o.toDay, true);
  const method = o.method ? String(o.method) : "";
  const payStatus = o.paymentStatus ? String(o.paymentStatus) : "";
  const orderStatus = o.orderStatus ? String(o.orderStatus) : "";
  const channel = o.channel ? String(o.channel) : "";
  const q = String(o.q || "").trim().toLowerCase();

  const kpi = {
    gross: 0, discounts: 0, net: 0, adjustments: 0, netAfterReturns: 0,
    collected: 0, online: 0, inPerson: 0, unclassified: 0, otherChannel: 0,
    outstanding: 0, refundDue: 0, returns: 0, refunds: 0, pendingRefunds: 0, netCash: 0,
    paidOrders: 0, unpaidOrders: 0, partialOrders: 0, canceledOrders: 0,
    legacyUnverified: 0, legacyValue: 0,
  };
  const orders = [];
  const exceptions = [];
  (db.orders || []).forEach((order) => {
    if (!order) return;
    if (!inRange(order.date || 0, from, to)) return;
    if (orderStatus && order.status !== orderStatus) return;
    if (payStatus && String(order.paymentStatus || "") !== payStatus) return;
    if (method && String(order.payment || "") !== method) return;
    const ch = (order.finance && order.finance.channel) || "";
    if (channel && !channelMatches(ch, channel)) return;
    const who = ((order.customer && (order.customer.customerNo || order.customer.email || order.customer.name)) || "") + " " + order.id;
    if (q && who.toLowerCase().indexOf(q) < 0) return;
    const acc = orderAccount(db, order);
    orders.push(acc);
    if (acc.cancelled) {
      kpi.canceledOrders += 1;
      if (acc.tracked) kpi.refundDue += acc.refundDueMinor;
      return;
    }
    if (!acc.tracked) {
      kpi.legacyUnverified += 1;
      kpi.legacyValue += acc.totalMinor;
      exceptions.push({ orderId: order.id, kind: "legacy_unverified", amountMinor: acc.totalMinor });
      return;
    }
    kpi.gross += acc.grossMinor;
    kpi.discounts += acc.itemDiscountMinor + acc.couponMinor;
    kpi.net += Math.max(0, acc.totalMinor);
    kpi.adjustments += acc.creditMinor;
    kpi.returns += acc.returnedMinor;
    kpi.outstanding += acc.outstandingMinor;
    kpi.refundDue += acc.refundDueMinor;
    if (acc.amountDueMinor <= 0 && acc.netCollectedMinor <= 0) kpi.paidOrders += 1;
    else if (acc.netCollectedMinor <= 0) kpi.unpaidOrders += 1;
    else if (acc.netCollectedMinor + 1 < acc.amountDueMinor) kpi.partialOrders += 1;
    else kpi.paidOrders += 1;
    if (acc.refundedMinor > acc.collectedMinor) {
      exceptions.push({ orderId: order.id, kind: "refund_exceeds_payment", amountMinor: acc.refundedMinor - acc.collectedMinor });
    }
  });

  const methods = {};
  (db.ledger || []).forEach((row) => {
    if (!row || row.status !== "settled") return;
    if (!inRange(row.at, from, to)) return;
    if (method && row.method !== method) return;
    if (channel && !channelMatches(row.channel, channel)) return;
    if (row.type === "refund") {
      kpi.refunds += row.amountMinor;
      return;
    }
    if (row.type !== "payment") return;
    kpi.collected += row.amountMinor;
    kpi[collectionBucket(row)] += row.amountMinor;
    const methodName = String(row.method || "manual");
    methods[methodName] = (methods[methodName] || 0) + row.amountMinor;
  });
  (db.ledger || []).forEach((row) => {
    if (!row || row.type !== "refund" || row.status !== "pending") return;
    if (!inRange(row.at, from, to)) return;
    kpi.pendingRefunds += row.amountMinor;
  });
  kpi.netAfterReturns = Math.max(0, kpi.net - kpi.adjustments);
  kpi.netCash = kpi.collected - kpi.refunds;
  const channelSum = kpi.online + kpi.inPerson + kpi.unclassified + kpi.otherChannel;
  if (channelSum !== kpi.collected) {
    exceptions.push({ orderId: "", kind: "channel_mismatch", amountMinor: channelSum - kpi.collected });
  }

  const ledgerOutstanding = orders.filter((a) => a.tracked && !a.cancelled).reduce((s, a) => s + a.outstandingMinor, 0);
  if (ledgerOutstanding !== kpi.outstanding) {
    exceptions.push({ orderId: "", kind: "outstanding_mismatch", amountMinor: ledgerOutstanding - kpi.outstanding });
  }

  return {
    range: { from: from || null, to: to || null, timezone: "Asia/Kabul" },
    kpi: kpi,
    orders: orders,
    exceptions: exceptions,
    methods: methods,
    reconciled: exceptions.filter((e) => e.kind !== "legacy_unverified").length === 0,
  };
}

function channelMatches(stored, query) {
  if (!query) return true;
  const wanted = classifyChannel(query).channel;
  const have = classifyChannel(stored).channel;
  return have === wanted || String(stored || "") === String(query);
}

function majorKpi(report) {
  const out = {};
  Object.keys(report.kpi).forEach((k) => {
    const v = report.kpi[k];
    out[k] = (k.indexOf("Orders") >= 0 || k === "legacyUnverified") ? v : fromMinor(v);
  });
  return out;
}

function recordPayment(db, order, input) {
  if (!order) return { error: "not_found", status: 404 };
  if (isCancelled(order)) return { error: "order_cancelled", status: 400 };
  const amountMinor = toMinor(input.amount != null ? input.amount : fromMinor(input.amountMinor || 0));
  const result = append(db, {
    orderId: order.id,
    type: "payment",
    amountMinor: amountMinor,
    method: input.method || order.payment || "manual",
    status: input.status || "settled",
    channel: input.channel != null && String(input.channel).trim() !== "" ? input.channel : "unclassified",
    at: input.at || Date.now(),
    actor: input.actor || null,
    externalRef: input.externalRef || "",
    idempotencyKey: input.idempotencyKey || "",
    note: input.note || "",
  });
  if (result.error) return { error: result.error, status: 400 };
  if (!order.finance) order.finance = {};
  order.finance.tracked = true;
  return result;
}

function recordRefund(db, order, input) {
  if (!order) return { error: "not_found", status: 404 };
  const amountMinor = toMinor(input.amount != null ? input.amount : 0);
  const rows = txnsFor(db, order.id);
  const collected = settledSum(rows, "payment");
  const already = settledSum(rows, "refund") + pendingRefund(rows);
  if (amountMinor > collected - already) return { error: "refund_exceeds_collected", status: 400 };
  const paymentId = String(input.paymentId || "");
  if (paymentId && !rows.some((r) => r.id === paymentId && r.type === "payment")) {
    return { error: "unknown_payment", status: 400 };
  }
  return append(db, {
    orderId: order.id,
    type: "refund",
    amountMinor: amountMinor,
    method: input.method || "manual",
    status: input.status || "pending",
    channel: input.channel != null && String(input.channel).trim() !== "" ? input.channel : "unclassified",
    at: input.at || Date.now(),
    actor: input.actor || null,
    externalRef: input.externalRef || "",
    idempotencyKey: input.idempotencyKey || "",
    paymentId: paymentId,
    note: input.note || "",
  });
}

function settleRefund(db, order, txnId, input) {
  if (!order) return { error: "not_found", status: 404 };
  const row = txnsFor(db, order.id).find((r) => r && r.id === txnId && r.type === "refund");
  if (!row) return { error: "not_found", status: 404 };
  if (row.status === "settled") return { txn: row, duplicate: true };
  if (row.status !== "pending" && row.status !== "authorized") return { error: "not_open", status: 400 };
  const extra = input || {};
  row.status = "settled";
  row.settledAt = Number(extra.at) || Date.now();
  if (extra.actor) row.settledBy = extra.actor;
  return { txn: row, duplicate: false };
}

function markTracked(order, extra) {
  order.finance = Object.assign({
    tracked: true,
    channel: "website",
    currency: "AFN",
  }, order.finance || {}, extra || {});
}

function csvEscape(v) {
  const s = String(v == null ? "" : v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

const KPI_FA = {
  gross: "فروش ناخالص / Gross sales",
  discounts: "تخفیف‌ها / Discounts",
  net: "فروش خالص قبل از برگشت / Net before returns",
  adjustments: "اعتبار برگشت تأییدشده / Approved return credit",
  netAfterReturns: "خالص پس از برگشت / Net after returns",
  collected: "مجموع دریافتی / Collections",
  online: "دریافت آنلاین / Online collections",
  inPerson: "دریافت حضوری POS / In-person POS",
  unclassified: "بدون کانال ثبت‌شده / Unclassified channel",
  otherChannel: "سایر کانال‌ها / Other channels",
  outstanding: "طلب از مشتری / Receivable",
  refundDue: "تعهد بازپرداخت / Refund due",
  returns: "ارزش کالای برگشتی / Returned goods",
  refunds: "بازپرداخت انجام‌شده / Completed refunds",
  pendingRefunds: "بازپرداخت در انتظار / Pending refunds",
  netCash: "خالص پول دریافت‌شده / Net cash",
  paidOrders: "سفارش‌های تسویه‌شده / Settled orders",
  unpaidOrders: "سفارش‌های پرداخت‌نشده / Unpaid orders",
  partialOrders: "سفارش‌های نیمه‌پرداخت / Partial orders",
  canceledOrders: "سفارش‌های لغوشده / Canceled orders",
  legacyUnverified: "سفارش‌های قدیمی تأییدنشده / Legacy unverified",
  legacyValue: "مبلغ سفارش‌های قدیمی / Legacy value",
};

const KPI_EN = {
  gross: "Gross sales",
  discounts: "Discounts",
  net: "Net before returns",
  adjustments: "Approved return credit",
  netAfterReturns: "Net after returns",
  collected: "Collections",
  online: "Online collections",
  inPerson: "In-person POS",
  unclassified: "Unclassified channel",
  otherChannel: "Other channels",
  outstanding: "Receivable",
  refundDue: "Refund due",
  returns: "Returned goods",
  refunds: "Completed refunds",
  pendingRefunds: "Pending refunds",
  netCash: "Net cash",
  paidOrders: "Settled orders",
  unpaidOrders: "Unpaid orders",
  partialOrders: "Partial orders",
  canceledOrders: "Canceled orders",
  legacyUnverified: "Legacy unverified",
  legacyValue: "Legacy value",
};

function toCsv(report) {
  const kpi = majorKpi(report);
  const lines = ["شرح,مقدار"];
  Object.keys(KPI_FA).forEach((key) => {
    if (kpi[key] == null) return;
    lines.push([KPI_FA[key], kpi[key]].map(csvEscape).join(","));
  });
  lines.push("");
  const header = ["orderId", "status", "payment", "gross", "discounts", "net", "adjustments", "amountDue", "collected", "netCollected", "outstanding", "refundDue", "refunded", "pendingRefund", "returned", "legacy"];
  lines.push(header.join(","));
  report.orders.forEach((a) => {
    lines.push([
      a.orderId, a.status, a.payment,
      fromMinor(a.grossMinor), fromMinor(a.itemDiscountMinor + a.couponMinor), fromMinor(a.totalMinor),
      fromMinor(a.creditMinor), fromMinor(a.amountDueMinor),
      fromMinor(a.collectedMinor), fromMinor(a.netCollectedMinor), fromMinor(a.outstandingMinor),
      fromMinor(a.refundDueMinor), fromMinor(a.refundedMinor), fromMinor(a.pendingRefundMinor),
      fromMinor(a.returnedMinor), a.legacy ? "yes" : "no",
    ].map(csvEscape).join(","));
  });
  lines.push("");
  lines.push("method,collected");
  Object.keys(report.methods || {}).forEach((name) => {
    lines.push([name, fromMinor(report.methods[name])].map(csvEscape).join(","));
  });
  return lines.join("\n") + "\n";
}

function toExcelXml(report) {
  const cells = (vals) => vals.map((v) => "<Cell><Data ss:Type=\"String\">" + String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</Data></Cell>").join("");
  const kpi = majorKpi(report);
  const rows = [cells(["key", "شرح", "مقدار"])];
  Object.keys(kpi).forEach((k) => rows.push(cells([k, KPI_FA[k] || k, kpi[k]])));
  return '<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="MAHO"><Table>' +
    rows.map((r) => "<Row>" + r + "</Row>").join("") + "</Table></Worksheet></Workbook>";
}

module.exports = {
  ensureLedger,
  kabulDayStart,
  kabulParts,
  summarize,
  majorKpi,
  orderAccount,
  recordPayment,
  recordRefund,
  markTracked,
  settleRefund,
  classifyChannel,
  collectionBucket,
  toCsv,
  toExcelXml,
  KPI_FA,
  KPI_EN,
  append,
  toMinor,
  fromMinor,
  addMinor,
};
