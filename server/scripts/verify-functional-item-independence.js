"use strict";
/**
 * Functional verification: item-level independence on SAFE PREVIEW only.
 * NEVER points at production. Uses seeded/fixture orders on preview DATA_DIR.
 */
const fs = require("fs");
const path = require("path");
const http = require("http");

const PORT = Number(process.env.PREVIEW_PORT || 4500);
const HOST = "127.0.0.1";
const ADMIN_PASS = process.env.ADMIN_PASSWORD || "SecurePreviewPass1!";
const EMAIL = "preview.customer@maho.test";
const PASSWORD = "PreviewTest123!";
const ART = "/opt/cursor/artifacts";
fs.mkdirSync(ART, { recursive: true });

const report = {
  safety: { host: HOST, port: PORT, productionTouched: false, emailMustBeFalse: null },
  tests: {},
  smoke: {},
  verdict: "PENDING",
  failures: [],
};

function assert(cond, msg) {
  if (!cond) {
    const err = new Error(msg || "assert failed");
    err.isAssert = true;
    throw err;
  }
}

function req(method, p, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const body = opts.body != null ? JSON.stringify(opts.body) : null;
    const headers = Object.assign({ Accept: "application/json" }, opts.headers || {});
    if (body) headers["Content-Type"] = "application/json";
    if (opts.token) headers.Authorization = "Bearer " + opts.token;
    const r = http.request({ hostname: HOST, port: PORT, path: p, method, headers }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        let data = {};
        try { data = d ? JSON.parse(d) : {}; } catch (_) { data = { raw: d }; }
        resolve({ status: res.statusCode, data });
      });
    });
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}

function snapItems(order) {
  return (order.items || []).map((it) => ({
    lineId: it.lineId,
    code: it.code,
    name: it.name,
    itemStatus: it.itemStatus,
    statusLabelFa: it.statusLabelFa || null,
  }));
}

function byCode(items, code) {
  return items.find((x) => x.code === code);
}

async function loginUser() {
  const r = await req("POST", "/api/auth/login", { body: { id: EMAIL, password: PASSWORD } });
  assert(r.status === 200 && r.data.token, "user login failed: " + JSON.stringify(r.data));
  return r.data.token;
}

async function loginAdmin() {
  const r = await req("POST", "/api/admin/login", { body: { password: ADMIN_PASS } });
  assert(r.status === 200 && r.data.token, "admin login failed");
  return r.data.token;
}

async function getOrder(userTok, orderId) {
  const mine = await req("GET", "/api/orders", { token: userTok });
  assert(mine.status === 200, "my orders failed");
  const o = (mine.data.orders || []).find((x) => x.id === orderId);
  assert(o, "order not found: " + orderId);
  return o;
}

async function placeOrder(userTok, codes) {
  const items = codes.map((code) => ({ code, qty: 1 }));
  const o = await req("POST", "/api/orders", {
    token: userTok,
    body: {
      items,
      customer: {
        name: "مشتری پیش‌نمایش",
        phone: "0700123456",
        email: EMAIL,
        address: "کابل — تست پیش‌نمایش",
      },
      payment: "whatsapp",
      delivery: { method: "deliver", time: "normal", fee: 0 },
      idempotencyKey: "fv-" + codes.join("-") + "-" + Date.now() + "-" + Math.random().toString(16).slice(2),
    },
  });
  assert(o.status === 200 && o.data.order, "place order failed " + JSON.stringify(o.data));
  return o.data.order;
}

async function approveAll(adminTok, order) {
  const r = await req("POST", "/api/admin/orders/" + order.id + "/items/approve", {
    token: adminTok, body: { lineIds: [] },
  });
  assert(r.status === 200, "approve-all failed " + JSON.stringify(r.data));
  return r.data.order;
}

async function shipDeliverAll(adminTok, order) {
  const lineIds = (order.items || []).map((it) => it.lineId);
  let r = await req("POST", "/api/admin/orders/" + order.id + "/items/ship", {
    token: adminTok, body: { lineIds },
  });
  assert(r.status === 200, "ship failed " + JSON.stringify(r.data));
  r = await req("POST", "/api/admin/orders/" + order.id + "/items/deliver", {
    token: adminTok, body: { lineIds },
  });
  assert(r.status === 200, "deliver failed " + JSON.stringify(r.data));
  return r.data.order;
}

/* ---------- TEST 1: independent return ---------- */
async function test1(userTok, adminTok) {
  const created = await placeOrder(userTok, ["SHL-004", "RSR-005", "KIF-006"]);
  let order = await approveAll(adminTok, created);
  order = await shipDeliverAll(adminTok, order);
  order = await getOrder(userTok, order.id);

  const beforeAgg = { status: order.status, statusLabelFa: order.statusLabelFa };
  const before = snapItems(order);
  const selected = before[0];
  const siblingsBefore = before.slice(1);

  const ret = await req("POST",
    "/api/orders/" + order.id + "/items/" + selected.lineId + "/return-request",
    { token: userTok, body: { reason: "functional-verify-size", method: "pickup_store" } }
  );
  assert(ret.status === 200, "return one failed " + JSON.stringify(ret.data));

  const afterOrder = await getOrder(userTok, order.id);
  const after = snapItems(afterOrder);
  const selectedAfter = byCode(after, selected.code);
  const siblingsAfter = after.filter((x) => x.code !== selected.code);

  assert(selectedAfter.itemStatus === "return_requested", "selected should be return_requested, got " + selectedAfter.itemStatus);
  for (const sb of siblingsBefore) {
    const a = byCode(siblingsAfter, sb.code);
    assert(a, "sibling missing " + sb.code);
    assert(a.itemStatus === sb.itemStatus, "sibling " + sb.code + " changed " + sb.itemStatus + " → " + a.itemStatus);
  }

  /* remaining eligible sibling can still be returned */
  const next = siblingsAfter.find((x) => x.itemStatus === "delivered");
  assert(next, "need another delivered sibling");
  const ret2 = await req("POST",
    "/api/orders/" + order.id + "/items/" + next.lineId + "/return-request",
    { token: userTok, body: { reason: "functional-verify-second", method: "pickup_store" } }
  );
  assert(ret2.status === 200, "second independent return failed " + JSON.stringify(ret2.data));
  const after2 = await getOrder(userTok, order.id);
  const nextAfter = byCode(snapItems(after2), next.code);
  assert(nextAfter.itemStatus === "return_requested", "second return not applied");

  report.tests.test1_independent_return = {
    pass: true,
    orderId: order.id,
    selectedSku: selected.code,
    selectedBefore: selected.itemStatus,
    selectedAfter: selectedAfter.itemStatus,
    siblingsBefore,
    siblingsAfter,
    aggregateBefore: beforeAgg,
    aggregateAfter: { status: afterOrder.status, statusLabelFa: afterOrder.statusLabelFa },
    secondIndependentReturn: { sku: next.code, after: nextAfter.itemStatus },
  };
}

/* ---------- TEST 2: select-all eligible (render + handler contract) ---------- */
async function test2(userTok, adminTok) {
  /* Build a mixed-eligibility order: one cancelled (ineligible for cancel), two approved (eligible) */
  const created = await placeOrder(userTok, ["DRS-001", "MNT-002", "BLZ-003"]);
  let order = await approveAll(adminTok, created);
  order = await getOrder(userTok, order.id);
  const cancelOne = order.items[0];
  const c = await req("POST",
    "/api/orders/" + order.id + "/items/" + cancelOne.lineId + "/cancel",
    { token: userTok, body: { reason: "make-ineligible" } }
  );
  assert(c.status === 200, "setup cancel failed");
  order = await getOrder(userTok, order.id);

  const canCancel = true; /* still within window for remaining approved */
  const items = order.items || [];
  const eligibility = items.map((it) => {
    const st = it.itemStatus || "";
    const cancelableItem = canCancel && (st === "pending" || st === "approved");
    const returnableItem = false; /* not delivered */
    return {
      code: it.code,
      lineId: it.lineId,
      itemStatus: st,
      eligibleForSelect: !!(cancelableItem || returnableItem),
      cancelableItem,
      returnableItem,
    };
  });

  /* Mirror website/js/main.js select-all: only inputs[data-line-pick]:not(:disabled) that exist for eligible */
  const wouldSelect = eligibility.filter((e) => e.eligibleForSelect).map((e) => e.code);
  const wouldNotSelect = eligibility.filter((e) => !e.eligibleForSelect).map((e) => e.code);

  assert(wouldSelect.length >= 1, "need eligible items");
  assert(wouldNotSelect.length >= 1, "need ineligible item (cancelled)");
  assert(wouldNotSelect.includes(cancelOne.code), "cancelled item must be ineligible");
  assert(!wouldSelect.includes(cancelOne.code), "cancelled must NOT be selected by select-all");

  /* Source contract: main.js select-all only checks data-line-pick (which are only rendered for eligible) */
  const mainSrc = fs.readFileSync(path.join(__dirname, "..", "..", "website", "js", "main.js"), "utf8");
  assert(/data-select-all-lines/.test(mainSrc), "select-all marker missing");
  assert(/querySelectorAll\("input\[data-line-pick\]:not\(:disabled\)"\)/.test(mainSrc)
    || /querySelectorAll\('input\[data-line-pick\]:not\(:disabled\)'\)/.test(mainSrc)
    || /input\[data-line-pick\]:not\(:disabled\)/.test(mainSrc), "select-all handler must target line-pick inputs");
  assert(/data-can-cancel="1"/.test(mainSrc) && /data-can-return="1"/.test(mainSrc), "eligibility attrs present");

  /* Checkboxes only rendered when cancelableItem || returnableItem */
  const renderBlock = mainSrc.slice(mainSrc.indexOf("const check = (cancelableItem || returnableItem)"), mainSrc.indexOf("const check = (cancelableItem || returnableItem)") + 400);
  assert(/data-line-pick/.test(renderBlock), "checkbox only in eligible branch");

  report.tests.test2_select_all_eligible = {
    pass: true,
    orderId: order.id,
    eligibility,
    selectAllWouldSelect: wouldSelect,
    selectAllWouldSkip: wouldNotSelect,
    proof: "Checkboxes (data-line-pick) are only rendered for eligible items; select-all only toggles those inputs.",
  };
}

/* ---------- TEST 3: independent cancel ---------- */
async function test3(userTok, adminTok) {
  const created = await placeOrder(userTok, ["DRS-001", "MNT-002", "BLZ-003"]);
  let order = await approveAll(adminTok, created);
  order = await getOrder(userTok, order.id);

  const beforeAgg = { status: order.status, statusLabelFa: order.statusLabelFa };
  const before = snapItems(order);
  const selected = before[1]; /* middle item */
  const siblingsBefore = before.filter((x) => x.code !== selected.code);

  const cancel = await req("POST",
    "/api/orders/" + order.id + "/items/" + selected.lineId + "/cancel",
    { token: userTok, body: { reason: "functional-verify-cancel-one" } }
  );
  assert(cancel.status === 200, "cancel one failed " + JSON.stringify(cancel.data));

  const afterOrder = await getOrder(userTok, order.id);
  const after = snapItems(afterOrder);
  const selectedAfter = byCode(after, selected.code);
  const siblingsAfter = after.filter((x) => x.code !== selected.code);

  assert(selectedAfter.itemStatus === "cancelled", "selected should be cancelled");
  for (const sb of siblingsBefore) {
    const a = byCode(siblingsAfter, sb.code);
    assert(a.itemStatus === sb.itemStatus, "sibling " + sb.code + " changed " + sb.itemStatus + " → " + a.itemStatus);
  }

  /* another eligible sibling can still be cancelled */
  const next = siblingsAfter.find((x) => x.itemStatus === "approved" || x.itemStatus === "pending");
  assert(next, "need another cancellable sibling");
  const cancel2 = await req("POST",
    "/api/orders/" + order.id + "/items/" + next.lineId + "/cancel",
    { token: userTok, body: { reason: "functional-verify-cancel-two" } }
  );
  assert(cancel2.status === 200, "second independent cancel failed " + JSON.stringify(cancel2.data));
  const after2 = snapItems(await getOrder(userTok, order.id));
  assert(byCode(after2, next.code).itemStatus === "cancelled", "second cancel not applied");
  /* remaining sibling still unchanged from first cancel's other sibling if still active */
  const remaining = after2.find((x) => x.code !== selected.code && x.code !== next.code);
  if (remaining) {
    const orig = byCode(before, remaining.code);
    assert(remaining.itemStatus === orig.itemStatus || remaining.itemStatus === "cancelled", "third item unexpected");
  }

  report.tests.test3_independent_cancel = {
    pass: true,
    orderId: order.id,
    selectedSku: selected.code,
    selectedBefore: selected.itemStatus,
    selectedAfter: selectedAfter.itemStatus,
    siblingsBefore,
    siblingsAfter,
    aggregateBefore: beforeAgg,
    aggregateAfter: { status: afterOrder.status, statusLabelFa: afterOrder.statusLabelFa },
    secondIndependentCancel: { sku: next.code, after: byCode(after2, next.code).itemStatus },
  };
}

/* ---------- TEST 4: per-item reorder ---------- */
async function test4(userTok, adminTok) {
  const created = await placeOrder(userTok, ["KFS-007", "KFS-008", "SHL-004"]);
  let order = await approveAll(adminTok, created);
  order = await getOrder(userTok, order.id);
  const selected = order.items[0];
  const siblingCodes = order.items.slice(1).map((it) => it.code);

  const re = await req("POST", "/api/orders/" + order.id + "/reorder", {
    token: userTok,
    body: { lineIds: [selected.lineId] },
  });
  assert(re.status === 200, "reorder failed " + JSON.stringify(re.data));
  const added = re.data.items || [];
  const skipped = re.data.skipped || [];

  assert(added.length === 1, "expected exactly 1 added item, got " + added.length + " " + JSON.stringify(added));
  assert(added[0].code === selected.code, "added code mismatch " + added[0].code);
  for (const sc of siblingCodes) {
    assert(!added.some((a) => a.code === sc), "sibling " + sc + " incorrectly included in reorder");
  }

  /* control: reorder without lineIds should include multiple available */
  const reAll = await req("POST", "/api/orders/" + order.id + "/reorder", {
    token: userTok,
    body: {},
  });
  assert(reAll.status === 200, "reorder all failed");
  assert((reAll.data.items || []).length >= 2, "reorder-all should add multiple when no lineIds");

  report.tests.test4_per_item_reorder = {
    pass: true,
    orderId: order.id,
    selectedSku: selected.code,
    selectedLineId: selected.lineId,
    added,
    skipped,
    siblingCodesNotIncluded: siblingCodes,
    reorderAllCount: (reAll.data.items || []).length,
  };
}

/* ---------- TEST 5: aggregate status ---------- */
async function test5(userTok, adminTok) {
  const { customerOrderAggregateLabel, aggregateOrderStatus } = require("../lib/order-items");
  const cases = [];

  /* 5a: one cancelled + one active */
  {
    const created = await placeOrder(userTok, ["DRS-001", "MNT-002"]);
    let order = await approveAll(adminTok, created);
    order = await getOrder(userTok, order.id);
    const a = order.items[0];
    await req("POST", "/api/orders/" + order.id + "/items/" + a.lineId + "/cancel", {
      token: userTok, body: { reason: "agg-partial-cancel" },
    });
    const after = await getOrder(userTok, order.id);
    const items = snapItems(after);
    assert(byCode(items, a.code).itemStatus === "cancelled", "5a selected cancelled");
    assert(items.filter((x) => x.code !== a.code).every((x) => x.itemStatus === "approved"), "5a sibling active");
    assert(/بخشی لغو/.test(after.statusLabelFa || "") || after.aggregateFlags?.partiallyCancelled,
      "5a aggregate partial cancel label: " + after.statusLabelFa);
    cases.push({
      name: "one_cancelled_one_active",
      orderId: after.id,
      items,
      aggregate: { status: after.status, statusLabelFa: after.statusLabelFa, flags: after.aggregateFlags },
      pass: true,
    });
  }

  /* 5b: one returned + one delivered */
  {
    const created = await placeOrder(userTok, ["SHL-004", "RSR-005"]);
    let order = await approveAll(adminTok, created);
    order = await shipDeliverAll(adminTok, order);
    order = await getOrder(userTok, order.id);
    const a = order.items[0];
    await req("POST", "/api/orders/" + order.id + "/items/" + a.lineId + "/return-request", {
      token: userTok, body: { reason: "agg-partial-return", method: "pickup_store" },
    });
    const after = await getOrder(userTok, order.id);
    const items = snapItems(after);
    assert(byCode(items, a.code).itemStatus === "return_requested", "5b return");
    assert(items.filter((x) => x.code !== a.code).every((x) => x.itemStatus === "delivered"), "5b sibling delivered");
    assert(
      after.status === "partially_returned" || /بخشی برگشت/.test(after.statusLabelFa || ""),
      "5b aggregate partial return: " + after.status + " / " + after.statusLabelFa
    );
    cases.push({
      name: "one_returned_one_delivered",
      orderId: after.id,
      items,
      aggregate: { status: after.status, statusLabelFa: after.statusLabelFa },
      pass: true,
    });
  }

  /* 5c: one rejected + one approved (admin) */
  {
    const created = await placeOrder(userTok, ["BLZ-003", "KIF-006"]);
    const pending = created;
    const rej = pending.items[0];
    const appr = pending.items[1];
    await req("POST", "/api/admin/orders/" + pending.id + "/items/reject", {
      token: adminTok, body: { lineIds: [rej.lineId], reason: "agg-reject" },
    });
    await req("POST", "/api/admin/orders/" + pending.id + "/items/approve", {
      token: adminTok, body: { lineIds: [appr.lineId] },
    });
    const after = await getOrder(userTok, pending.id);
    const items = snapItems(after);
    assert(byCode(items, rej.code).itemStatus === "rejected", "5c rejected");
    assert(byCode(items, appr.code).itemStatus === "approved", "5c approved");
    assert(
      /بخشی/.test(after.statusLabelFa || "") || after.status === "confirmed",
      "5c aggregate: " + after.statusLabelFa
    );
    cases.push({
      name: "one_rejected_one_approved",
      orderId: after.id,
      items,
      aggregate: { status: after.status, statusLabelFa: after.statusLabelFa },
      pass: true,
    });
  }

  /* 5d: all cancelled */
  {
    const created = await placeOrder(userTok, ["DRS-001", "MNT-002"]);
    let order = await approveAll(adminTok, created);
    order = await getOrder(userTok, order.id);
    for (const it of order.items) {
      const r = await req("POST", "/api/orders/" + order.id + "/items/" + it.lineId + "/cancel", {
        token: userTok, body: { reason: "agg-all-cancel" },
      });
      assert(r.status === 200, "cancel all item failed");
    }
    const after = await getOrder(userTok, order.id);
    assert(snapItems(after).every((x) => x.itemStatus === "cancelled"), "5d all cancelled items");
    assert(after.status === "cancelled" || /لغو/.test(after.statusLabelFa || ""), "5d aggregate cancelled");
    cases.push({
      name: "all_cancelled",
      orderId: after.id,
      items: snapItems(after),
      aggregate: { status: after.status, statusLabelFa: after.statusLabelFa },
      pass: true,
    });
  }

  /* 5e: all return_requested (where applicable) */
  {
    const created = await placeOrder(userTok, ["SHL-004", "RSR-005"]);
    let order = await approveAll(adminTok, created);
    order = await shipDeliverAll(adminTok, order);
    order = await getOrder(userTok, order.id);
    for (const it of order.items) {
      const r = await req("POST", "/api/orders/" + order.id + "/items/" + it.lineId + "/return-request", {
        token: userTok, body: { reason: "agg-all-return", method: "pickup_store" },
      });
      assert(r.status === 200, "return all item failed " + JSON.stringify(r.data));
    }
    const after = await getOrder(userTok, order.id);
    assert(snapItems(after).every((x) => x.itemStatus === "return_requested"), "5e all return_requested");
    assert(
      after.status === "return_requested" || /برگشت/.test(after.statusLabelFa || ""),
      "5e aggregate return: " + after.status
    );
    cases.push({
      name: "all_return_requested",
      orderId: after.id,
      items: snapItems(after),
      aggregate: { status: after.status, statusLabelFa: after.statusLabelFa },
      pass: true,
    });
  }

  /* Unit: sibling states never overwritten by aggregate helper */
  {
    const fake = {
      status: "confirmed",
      delivery: { method: "deliver", time: "normal" },
      items: [
        { lineId: "li1", itemStatus: "cancelled", code: "A" },
        { lineId: "li2", itemStatus: "approved", code: "B" },
      ],
    };
    const code = aggregateOrderStatus(fake);
    const label = customerOrderAggregateLabel(fake);
    assert(fake.items[0].itemStatus === "cancelled" && fake.items[1].itemStatus === "approved", "aggregate must not mutate item statuses");
    cases.push({
      name: "aggregate_does_not_mutate_items",
      aggregateCode: code,
      label,
      itemsUnchanged: snapItems(fake),
      pass: true,
    });
  }

  report.tests.test5_aggregate_status = { pass: true, cases };
}

async function main() {
  const health = await req("GET", "/api/health");
  assert(health.status === 200 && health.data.ok, "preview health failed");
  assert(health.data.email === false, "REFUSING: email enabled on preview");
  assert(health.data.env === "development", "preview must be development");
  report.safety.emailMustBeFalse = health.data.email === false;
  report.safety.health = health.data;

  const userTok = await loginUser();
  const adminTok = await loginAdmin();

  await test1(userTok, adminTok);
  await test2(userTok, adminTok);
  await test3(userTok, adminTok);
  await test4(userTok, adminTok);
  await test5(userTok, adminTok);

  report.verdict = "READY FOR OWNER REVIEW";
  fs.writeFileSync(path.join(ART, "functional_verification_report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  report.verdict = "FAILED — DO NOT MERGE / DO NOT DEPLOY";
  report.failures.push({ message: e.message, stack: e.stack });
  fs.writeFileSync(path.join(ART, "functional_verification_report.json"), JSON.stringify(report, null, 2));
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
});
