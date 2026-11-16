"use strict";
const assert = require("assert");
const { allocateCustomerNo } = require("../lib/customer-numbers");
const { ownsOrder, buildReceiptPdf } = require("../lib/order-receipt");

const db = { users: [{ id: "old", customerNo: "MO000001" }] };
const first = allocateCustomerNo(db);
const second = allocateCustomerNo(db);
assert.strictEqual(first, "20260001");
assert.strictEqual(second, "20260002");
assert.strictEqual(db.users[0].customerNo, "MO000001");
assert.notStrictEqual(first, second);

const again = { users: [{ customerNo: "20260009" }, { customerNo: "MO000004" }], seqPublicCustomer: 20260002 };
assert.strictEqual(allocateCustomerNo(again), "20260010");

const order = {
  id: "MAHO-TEST",
  userId: "u1",
  date: Date.UTC(2026, 0, 2),
  lang: "fa",
  items: [{ name: "پیراهن", qty: 1, price: 1000, lineTotal: 1000 }],
  itemsTotal: 1000,
  discountTotal: 100,
  discountSnapshot: { replacedByCoupon: "SAVE10", name: "SAVE10" },
  discountMessage: "کود تخفیف",
  total: 900,
  customer: { name: "Aida", phone: "0700123456", addr: { city: "کابل" } },
  delivery: { method: "pickup" },
};
assert.strictEqual(ownsOrder(order, { type: "user", userId: "u1" }), true);
assert.strictEqual(ownsOrder(order, { type: "user", userId: "u2" }), false);
assert.strictEqual(ownsOrder(order, { type: "admin", userId: "u1" }), false);
buildReceiptPdf(order).then((pdf) => {
  assert.ok(Buffer.isBuffer(pdf) && pdf.slice(0, 4).toString() === "%PDF");
  console.log("LOCAL_IMPROVEMENTS_OK");
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
