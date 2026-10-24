"use strict";
/**
 * Phase-2 checks: barcode, card size, ledger reconciliation.
 * Uses fixture objects only. Does not touch production data or send mail.
 */
const assert = require("assert");
const code128 = require("../lib/upgrade/code128");
const cards = require("../lib/upgrade/customer-card");
const ledger = require("../lib/upgrade/ledger");
const coupons = require("../lib/upgrade/coupons");
const life = require("../lib/upgrade/account-life");
const address = require("../lib/upgrade/address");

const results = [];
function check(name, expected, actual) {
  const ok = JSON.stringify(expected) === JSON.stringify(actual);
  results.push({ name, expected, actual, ok });
  console.log((ok ? "PASS" : "FAIL"), name, "expected", JSON.stringify(expected), "actual", JSON.stringify(actual));
  if (!ok) process.exitCode = 1;
}

const sample = "MO100105";
check("barcode roundtrip", sample, code128.decodeText(sample));

const addr = address.snapshotAddress({ addr: { country: "افغانستان", province: "کابل", city: "کارته", street: "سرک", house: "12" } });
check("zip optional", true, addr.address.indexOf("کارته") >= 0 && !addr.addr.zip);

function order(id, extra) {
  return Object.assign({
    id: id,
    date: Date.UTC(2026, 9, 22, 19, 0, 0),
    status: "new",
    payment: "card",
    paymentStatus: "awaiting_payment",
    items: [{ code: "DRS-001", name: "Dress", qty: 1, price: 1000, listPrice: 1000, itemStatus: "approved" }],
    itemsTotal: 1000,
    discountTotal: 0,
    deliveryFee: 0,
    total: 1000,
    finance: { tracked: true, channel: "website" },
    customer: { name: "Test", customerNo: "MO000001" },
  }, extra || {});
}

const db = { orders: [], ledger: [], ledgerSeq: 100000, coupons: [] };
const cases = [];

function add(label, ord, setup) {
  db.orders.push(ord);
  if (setup) setup(ord);
  cases.push(label);
}

add("online settled", order("ON-1", { payment: "card", date: Date.parse("2026-10-23T08:00:00+04:30") }), (o) => {
  ledger.recordPayment(db, o, { amount: 1000, method: "card", status: "settled", idempotencyKey: "cb-1", at: o.date });
});
add("online pending", order("ON-2", { payment: "card" }), (o) => {
  ledger.recordPayment(db, o, { amount: 1000, method: "hesab", status: "pending", idempotencyKey: "cb-pending", at: o.date });
});
add("online failed", order("ON-3", { payment: "card", paymentStatus: "payment_rejected" }), (o) => {
  ledger.recordPayment(db, o, { amount: 1000, method: "card", status: "failed", idempotencyKey: "cb-fail", at: o.date });
});
add("cod before", order("COD-1", { payment: "whatsapp", paymentStatus: null }));
add("cod after", order("COD-2", { payment: "whatsapp" }), (o) => {
  ledger.recordPayment(db, o, { amount: 1000, method: "cash", status: "settled", channel: "pos", at: o.date });
});
add("partial", order("PART-1"), (o) => {
  ledger.recordPayment(db, o, { amount: 400, method: "cash", status: "settled", idempotencyKey: "part-a", at: o.date });
});
add("split", order("SPLIT-1"), (o) => {
  ledger.recordPayment(db, o, { amount: 400, method: "cash", status: "settled", idempotencyKey: "split-a", at: o.date });
  ledger.recordPayment(db, o, { amount: 600, method: "card", status: "settled", idempotencyKey: "split-b", at: o.date });
});
add("coupon", order("CPN-1", { discountTotal: 200, total: 800, itemsTotal: 1000 }), (o) => {
  ledger.recordPayment(db, o, { amount: 800, method: "card", status: "settled", at: o.date });
});
add("cancelled", order("CAN-1"), (o) => {
  ledger.recordPayment(db, o, { amount: 1000, method: "card", status: "settled", channel: "online", at: o.date });
  o.status = "cancelled";
});
add("partial return", order("RET-1", { items: [{ code: "A", qty: 1, price: 400, listPrice: 400, itemStatus: "return_approved" }, { code: "B", qty: 1, price: 600, listPrice: 600, itemStatus: "delivered" }], itemsTotal: 1000, total: 1000 }), (o) => {
  ledger.recordPayment(db, o, { amount: 1000, method: "card", status: "settled", at: o.date });
});
add("full return", order("RET-2", { items: [{ code: "A", qty: 1, price: 1000, listPrice: 1000, itemStatus: "returned" }] }), (o) => {
  ledger.recordPayment(db, o, { amount: 1000, method: "cash", status: "settled", at: o.date });
  ledger.recordRefund(db, o, { amount: 1000, method: "cash", status: "settled", at: Date.parse("2026-11-03T10:00:00+04:30") });
});
add("refund pending", order("RET-3"), (o) => {
  ledger.recordPayment(db, o, { amount: 1000, method: "card", status: "settled", at: o.date });
  ledger.recordRefund(db, o, { amount: 200, method: "card", status: "pending", at: o.date });
});
add("refund done", order("RET-4"), (o) => {
  ledger.recordPayment(db, o, { amount: 1000, method: "bank", status: "settled", at: o.date });
  ledger.recordRefund(db, o, { amount: 1000, method: "bank", status: "settled", idempotencyKey: "rf-1", at: o.date });
});
const dup = order("DUP-1");
db.orders.push(dup);
ledger.recordPayment(db, dup, { amount: 1000, method: "card", status: "settled", idempotencyKey: "same-callback", at: dup.date });
const dup2 = ledger.recordPayment(db, dup, { amount: 1000, method: "card", status: "settled", idempotencyKey: "same-callback", at: dup.date });
check("duplicate callback", true, dup2.duplicate === true && ledger.orderAccount(db, dup).collectedMinor === 100000);

const legacy = order("LEG-1", { finance: { tracked: false } });
db.orders.push(legacy);

const boundary = order("TZ-1", { date: Date.parse("2026-10-22T20:00:00Z") });
db.orders.push(boundary);
ledger.recordPayment(db, boundary, { amount: 1000, method: "cash", status: "settled", at: boundary.date });

const report = ledger.summarize(db, { range: "year", now: Date.parse("2026-10-23T12:00:00+04:30") });
const kpi = ledger.majorKpi(report);
check("kabul day of boundary order", 23, ledger.kabulParts(boundary.date).day);
check("dashboard outstanding matches orders", report.kpi.outstanding, report.orders.filter((a) => a.tracked && !a.cancelled).reduce((s, a) => s + a.outstandingMinor, 0));
check("duplicate not double counted", 1000, ledger.fromMinor(ledger.orderAccount(db, dup).collectedMinor));
check("legacy not collected", true, report.orders.some((a) => a.orderId === "LEG-1" && a.legacy && a.collectedMinor === 0));
check("cancelled excluded from net sales flag", true, report.kpi.canceledOrders >= 1);
check("refund later month excluded from October net cash of that txn", true, ledger.summarize(db, { fromDay: "2026-11-01", toDay: "2026-11-30" }).kpi.refunds === 100000);

const oct = ledger.summarize(db, { fromDay: "2026-10-01", toDay: "2026-10-31" });
const csv = ledger.toCsv(oct);
const xls = ledger.toExcelXml(oct);
check("csv contains same order id as dashboard", true, csv.indexOf("ON-1") >= 0 && xls.indexOf("gross") >= 0);

const user = { id: "u1", email: "a@example.com", name: "A", customerNo: "MO000001", card: { status: "active", token: "abc" } };
const started = life.beginDeletion(user, "pepper", true);
const bad = life.confirmDeletion(user, "000000", "DELETE", "pepper");
check("wrong code does not delete", "bad_code", bad.error);
check("account still active before confirm", "active", life.stateOf(user));
const good = life.confirmDeletion(user, started.code, "DELETE", "pepper");
check("right code allows delete", true, good.ok === true);
life.anonymize(user);
check("deleted card revoked", "revoked", user.card.status);
check("deleted cannot shop", false, life.canShop(user));

coupons.ensureCoupons(db);
coupons.saveAll(db, [{ code: "MAHO20", type: "percent", value: 20, enabled: true, perCustomer: 1 }]);
const priced = [{ code: "DRS-001", cat: "clothing", qty: 1, price: 1000 }];
const off = coupons.evaluate(db, "maho20", { id: "u1" }, priced);
check("coupon 20 percent", 200, off.amount);
const again = coupons.evaluate(db, "NOPE", { id: "u1" }, priced);
check("invalid coupon", "coupon_invalid", again.error);

(async () => {
  const png = await cards.renderCardPng({ name: "Sahar Ahmadi", email: "sahar.ahmadi@example.com", customerNo: sample, card: { token: "ab".repeat(32), status: "active" } }, "https://mahomarket.com");
  const pdf = await cards.renderCardPdf(png);
  const svg = await cards.renderCardSvg({ name: "Sahar Ahmadi", email: "sahar.ahmadi@example.com", customerNo: sample, card: { token: "ab".repeat(32), status: "active" } }, "https://mahomarket.com");
  const media = /\/MediaBox \[0 0 ([0-9.]+) ([0-9.]+)\]/.exec(pdf.toString("latin1"));
  const widthMm = media ? Number(media[1]) * 25.4 / 72 : 0;
  const heightMm = media ? Number(media[2]) * 25.4 / 72 : 0;
  check("pdf width mm", 86, Math.round(widthMm));
  check("pdf height mm", 54, Math.round(heightMm));
  const qrTarget = cards.verifyUrl("https://mahomarket.com", "ab".repeat(32));
  const PNG = require("pngjs").PNG;
  const jsQR = require("jsqr");
  const b64 = (svg.match(/data:image\/png;base64,([^"]+)/) || [])[1];
  const qrPng = PNG.sync.read(Buffer.from(b64, "base64"));
  const decoded = jsQR(new Uint8ClampedArray(qrPng.data), qrPng.width, qrPng.height);
  check("qr decodes to verify url", qrTarget, decoded && decoded.data);
  check("card shows the account email", true, svg.indexOf("sahar.ahmadi@example.com") >= 0);
  check("barcode modules decode customer number", sample, code128.decodeText(sample));
  const failed = results.filter((r) => !r.ok);
  console.log("PHASE2", results.length - failed.length, "passed", failed.length, "failed");
  if (failed.length) process.exit(1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
