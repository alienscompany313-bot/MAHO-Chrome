"use strict";
/**
 * Isolated ledger checks for cancellation, channels, and approved returns.
 * Fixture objects only. No production data, SMTP, or payment gateway.
 */
const ledger = require("../lib/upgrade/ledger");

const results = [];
function check(name, expected, actual) {
  const ok = JSON.stringify(expected) === JSON.stringify(actual);
  results.push({ name, ok });
  console.log((ok ? "PASS" : "FAIL"), name);
  if (!ok) {
    console.log("  expected", JSON.stringify(expected));
    console.log("  actual  ", JSON.stringify(actual));
    process.exitCode = 1;
  }
}

function blank() {
  return { orders: [], ledger: [], ledgerSeq: 100000 };
}

function order(id, extra) {
  return Object.assign({
    id: id,
    date: Date.parse("2026-10-15T10:00:00+04:30"),
    status: "confirmed",
    payment: "cash",
    items: [{ code: "A", qty: 1, price: 1000, listPrice: 1200, itemStatus: "delivered" }],
    discountTotal: 0,
    deliveryFee: 0,
    total: 1000,
    finance: { tracked: true, channel: "website" },
    customer: { customerNo: "MO000099" },
  }, extra || {});
}

function oct(db) {
  return ledger.summarize(db, { fromDay: "2026-10-01", toDay: "2026-10-31" });
}

const db = blank();
const cancel = order("CASH-CANCEL");
db.orders.push(cancel);
const paid = ledger.recordPayment(db, cancel, {
  amount: 1000, method: "cash", status: "settled", channel: "in_person", at: cancel.date,
});
cancel.status = "cancelled";
const openLiability = ledger.orderAccount(db, cancel);
check("cancel keeps the payment row", 1, db.ledger.length);
check("cancel collected afn", 1000, ledger.fromMinor(openLiability.collectedMinor));
check("cancel completed refunds", 0, ledger.fromMinor(openLiability.refundedMinor));
check("cancel net collected", 1000, ledger.fromMinor(openLiability.netCollectedMinor));
check("cancel refund due", 1000, ledger.fromMinor(openLiability.refundDueMinor));
check("cancel receivable", 0, ledger.fromMinor(openLiability.outstandingMinor));
const openReport = oct(db);
check("dashboard still shows the 1000 collection", 1000, ledger.fromMinor(openReport.kpi.collected));
check("dashboard completed refunds stay 0", 0, ledger.fromMinor(openReport.kpi.refunds));
check("dashboard net cash stays 1000", 1000, ledger.fromMinor(openReport.kpi.netCash));
check("dashboard refund due is 1000", 1000, ledger.fromMinor(openReport.kpi.refundDue));
check("cancelled sale is not net sales", 0, ledger.fromMinor(openReport.kpi.net));
check("cash is in-person because the channel says so", 1000, ledger.fromMinor(openReport.kpi.inPerson));

const refund = ledger.recordRefund(db, cancel, {
  amount: 1000,
  method: "cash",
  status: "settled",
  channel: "in_person",
  paymentId: paid.txn.id,
  at: cancel.date + 60000,
});
const closed = ledger.orderAccount(db, cancel);
check("refund kept the original payment id", paid.txn.id, refund.txn.paymentId);
check("original collection remains after refund", 1000, ledger.fromMinor(closed.collectedMinor));
check("completed refund is 1000", 1000, ledger.fromMinor(closed.refundedMinor));
check("net collected after refund", 0, ledger.fromMinor(closed.netCollectedMinor));
check("refund due cleared", 0, ledger.fromMinor(closed.refundDueMinor));
check("payment timestamp unchanged", cancel.date, db.ledger[0].at);
const second = ledger.recordRefund(db, cancel, { amount: 1000, method: "cash", status: "settled", paymentId: paid.txn.id });
check("second refund rejected", "refund_exceeds_collected", second.error);
check("no third ledger row", 2, db.ledger.length);
const closedReport = oct(db);
check("collections remain 1000 after the refund", 1000, ledger.fromMinor(closedReport.kpi.collected));
check("completed refunds are 1000", 1000, ledger.fromMinor(closedReport.kpi.refunds));
check("net cash is 0", 0, ledger.fromMinor(closedReport.kpi.netCash));
check("channels still equal collections", closedReport.kpi.collected, closedReport.kpi.online + closedReport.kpi.inPerson + closedReport.kpi.unclassified + closedReport.kpi.otherChannel);

const channels = blank();
function pay(id, method, channel, amount) {
  const row = order(id, { total: amount, items: [{ code: "A", qty: 1, price: amount, listPrice: amount, itemStatus: "delivered" }] });
  channels.orders.push(row);
  ledger.recordPayment(channels, row, { amount: amount, method: method, status: "settled", channel: channel, at: row.date });
}
pay("CARD-ONLINE", "card", "online", 1000);
pay("CARD-POS", "card", "pos", 800);
pay("BANK-ONLINE", "bank", "online", 500);
pay("BANK-STORE", "bank", "in_person", 300);
pay("CARD-UNKNOWN", "card", "", 200);
const old = order("CARD-WEBSITE");
channels.orders.push(old);
ledger.append(channels, { orderId: old.id, type: "payment", amountMinor: 100000, method: "card", status: "settled", channel: "website", at: old.date });
const ch = oct(channels);
check("online card and online bank", 2500, ledger.fromMinor(ch.kpi.online));
check("pos card and in-person bank", 1100, ledger.fromMinor(ch.kpi.inPerson));
check("card without a channel is not called online", 200, ledger.fromMinor(ch.kpi.unclassified));
check("historical website channel counts as online", true, ch.kpi.online === 250000);
check("channel buckets equal collections", ch.kpi.collected, ch.kpi.online + ch.kpi.inPerson + ch.kpi.unclassified + ch.kpi.otherChannel);
const methodSum = Object.keys(ch.methods).reduce((s, name) => s + ch.methods[name], 0);
check("methods equal collections", ch.kpi.collected, methodSum);

const returns = blank();
function addReturn(id, extra, setup) {
  const row = order(id, extra);
  returns.orders.push(row);
  if (setup) setup(row);
  return row;
}
addReturn("PART-PAY", {
  total: 1000,
  items: [
    { code: "A", qty: 1, price: 700, listPrice: 700, itemStatus: "return_approved" },
    { code: "B", qty: 1, price: 300, listPrice: 300, itemStatus: "delivered" },
  ],
}, (row) => {
  ledger.recordPayment(returns, row, { amount: 400, method: "cash", status: "settled", channel: "in_person", at: row.date });
});
addReturn("PENDING", {
  items: [{ code: "A", qty: 1, price: 1000, listPrice: 1000, itemStatus: "return_approved" }],
}, (row) => {
  const payment = ledger.recordPayment(returns, row, { amount: 1000, method: "card", status: "settled", channel: "online", at: row.date });
  ledger.recordRefund(returns, row, { amount: 1000, method: "card", status: "pending", channel: "online", paymentId: payment.txn.id, at: row.date });
});
addReturn("DONE", {
  items: [{ code: "A", qty: 2, price: 500, listPrice: 500, itemStatus: "returned", returnQty: 1 }, { code: "B", qty: 1, price: 500, listPrice: 500, itemStatus: "delivered" }],
  total: 1500,
}, (row) => {
  const payment = ledger.recordPayment(returns, row, { amount: 1500, method: "bank", status: "settled", channel: "online", at: row.date });
  ledger.recordRefund(returns, row, { amount: 500, method: "bank", status: "settled", channel: "online", paymentId: payment.txn.id, at: row.date });
});
addReturn("NO-PAY-CANCEL", { status: "cancelled" });
addReturn("REQUEST-ONLY", {
  items: [{ code: "A", qty: 1, price: 1000, listPrice: 1000, itemStatus: "return_requested" }],
}, (row) => {
  ledger.recordPayment(returns, row, { amount: 1000, method: "card", status: "settled", channel: "online", at: row.date });
});

const part = ledger.orderAccount(returns, returns.orders[0]);
check("partial payment after approved return receivable", 0, ledger.fromMinor(part.outstandingMinor));
check("partial payment refund due", 100, ledger.fromMinor(part.refundDueMinor));
const pending = ledger.orderAccount(returns, returns.orders[1]);
check("pending refund is not completed", 0, ledger.fromMinor(pending.refundedMinor));
check("pending refund still leaves the cash collected", 1000, ledger.fromMinor(pending.netCollectedMinor));
check("full approved return creates refund due", 1000, ledger.fromMinor(pending.refundDueMinor));
const done = ledger.orderAccount(returns, returns.orders[2]);
check("partial item return credit", 500, ledger.fromMinor(done.creditMinor));
check("completed refund does not also reduce the credit", 1000, ledger.fromMinor(done.amountDueMinor));
check("completed refund net collected", 1000, ledger.fromMinor(done.netCollectedMinor));
check("no double deduction receivable", 0, ledger.fromMinor(done.outstandingMinor));
check("no double deduction refund due", 0, ledger.fromMinor(done.refundDueMinor));
const unpaidCancel = ledger.orderAccount(returns, returns.orders[3]);
check("cancelled without payment has no liability", 0, unpaidCancel.collectedMinor + unpaidCancel.refundDueMinor);
const requested = ledger.orderAccount(returns, returns.orders[4]);
check("return request is not a credit", 0, requested.creditMinor);
check("return request leaves no refund due", 0, requested.refundDueMinor);

const report = oct(returns);
const csv = ledger.toCsv(report);
check("csv refund due matches dashboard", true, csv.indexOf("تعهد بازپرداخت") >= 0 && csv.indexOf(String(ledger.fromMinor(report.kpi.refundDue))) >= 0);
check("export collections match dashboard", report.kpi.collected, report.orders.reduce((s, row) => s + row.collectedMinor, 0));
check("return report reconciled", true, report.reconciled);

const settleDb = blank();
const settleOrder = order("SETTLE");
settleDb.orders.push(settleOrder);
const basePay = ledger.recordPayment(settleDb, settleOrder, { amount: 1000, method: "card", status: "settled", channel: "online", at: settleOrder.date });
const pendingRefund = ledger.recordRefund(settleDb, settleOrder, { amount: 250, method: "card", status: "pending", paymentId: basePay.txn.id, at: settleOrder.date });
const originalAt = pendingRefund.txn.at;
const settled = ledger.settleRefund(settleDb, settleOrder, pendingRefund.txn.id, { at: settleOrder.date + 5000 });
const replay = ledger.settleRefund(settleDb, settleOrder, pendingRefund.txn.id, { at: settleOrder.date + 9000 });
check("settled refund keeps its id", pendingRefund.txn.id, settled.txn.id);
check("original refund timestamp kept", originalAt, settled.txn.at);
check("settled timestamp recorded", settleOrder.date + 5000, settled.txn.settledAt);
check("settle replay does not add a refund", true, replay.duplicate === true && settleDb.ledger.filter((row) => row.type === "refund").length === 1);
check("settled refund reduces net cash once", 750, ledger.fromMinor(oct(settleDb).kpi.netCash));

const failed = results.filter((row) => !row.ok).length;
console.log("FINANCE", results.length - failed, "passed", failed, "failed");
if (failed) process.exit(1);
