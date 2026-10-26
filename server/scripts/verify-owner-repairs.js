"use strict";
const policies = require("../lib/upgrade/policies");
const life = require("../lib/upgrade/account-life");
const catalog = require("../../website/js/catalog-page");

function assert(cond, message) {
  if (!cond) throw new Error(message || "assert");
}
function ok(name) { console.log("PASS", name); }

function products(n) {
  const rows = [];
  for (let i = 0; i < n; i++) rows.push({ code: "P" + i, name: i % 2 ? "مانتو " + i : "پیراهن " + i, cat: i % 3 ? "wear" : "scarf", enabled: true, price: 100 + i });
  return rows;
}

[12, 24, 200, 500].forEach((count) => {
  const rows = products(count);
  const home = catalog.pageProducts(rows, { mode: "home", homeCount: 12 });
  assert(home.items.length === Math.min(12, count) && home.total === count, "home window " + count);
  const seen = {};
  const pages = Math.max(1, Math.ceil(count / 24));
  for (let p = 1; p <= pages; p++) {
    catalog.pageProducts(rows, { mode: "catalog", pageSize: 24, page: p }).items.forEach((row) => {
      assert(!seen[row.product.code], "duplicate " + row.product.code);
      seen[row.product.code] = true;
    });
  }
  assert(Object.keys(seen).length === count, "all pages cover " + count);
  const found = catalog.pageProducts(rows, { q: "مانتو", mode: "home" });
  assert(found.mode === "catalog" && found.total > 0 && found.items.every((row) => row.product.name.indexOf("مانتو") >= 0), "search leaves the home window");
  const yeh = catalog.pageProducts(rows, { q: "پيراهن", mode: "home" });
  assert(yeh.total > 0, "arabic yeh search " + count);
});
ok("catalog windows 12/24/200/500");

const db = { users: [], policies: {} };
const draft = policies.upsertDraft(db, "terms", { version: "1", title: "قوانین", body: "متن" });
assert(policies.removeDraft(db, "terms", draft.version.id).ok, "draft delete");
assert(!policies.findVersion(db, "terms", draft.version.id), "draft gone");
const again = policies.upsertDraft(db, "terms", { version: "2", title: "قوانین", body: "متن" });
policies.publish(db, "terms", again.version.id);
assert(policies.removeDraft(db, "terms", again.version.id).error === "retain_history", "published history kept");
policies.unpublish(db, "terms", again.version.id);
assert(policies.published(db, "terms") == null, "unpublished is not public");
assert(policies.removeDraft(db, "terms", again.version.id).error === "retain_history", "historical version cannot be erased");
policies.archiveVersion(db, "terms", again.version.id);
assert(policies.findVersion(db, "terms", again.version.id).status === "archived", "archive keeps the row");
db.users.push({ policyAcceptance: { termsId: again.version.id } });
const fresh = policies.upsertDraft(db, "privacy", { version: "1", title: "حریم", body: "متن" });
fresh.version.publishedAt = Date.now();
assert(policies.removeDraft(db, "privacy", fresh.version.id).error === "retain_history", "accepted or published draft stays");
ok("policy delete archive unpublish");

const user = { id: "u", email: "a@example.com", accountStatus: "active" };
life.applyStatus(user, "blocked", "دلیل", "admin");
life.rememberReason(user, "دلیل", "note");
life.queueStatusMail(user, "blocked", "دلیل");
assert(life.stateOf(user) === "blocked" && user.mailQueue[0].appeal === "support@mahomarket.com", "block mail");
life.applyStatus(user, "active", "admin_unblock", "admin");
user.blocked = false;
life.queueStatusMail(user, "reinstated", "");
assert(life.stateOf(user) === "active" && user.mailQueue.some((row) => row.kind === "reinstated"), "reactivate");
const deleted = { accountStatus: "deleted", deletedAt: Date.now() };
assert(life.applyStatus(deleted, "active", "no", "admin").error === "account_deleted", "deleted stays deleted");
ok("block and reactivate state");

console.log("OWNER_REPAIRS_OK");
