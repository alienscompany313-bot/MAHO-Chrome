"use strict";
/**
 * Data Retention / Archive / Cleanup engine.
 * Safe-by-default: never touches products, users, stores, staff, drivers, config,
 * return reasons, or active operational records. Financial categories default to
 * archive-only (permanent delete disabled unless Owner explicitly enables).
 *
 * Architecture: soft-archive flags on records (`archived`, `archivedAt`) so the
 * single db.json remains coherent; optional permanent removal only of already-
 * archived (or explicitly eligible) records in small batches. Side export file
 * under DATA_DIR/archive/ when permanently deleting.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { sanitizeText } = require("./security");
const { normalizeOrderStatus } = require("./orders");
const { normalizeOrderItems, FINAL_NEGATIVE } = require("./order-items");

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BATCH = 50;
const MAX_BATCH = 200;

/** Category catalog — Admin configures days/enabled; defaults are examples only. */
const CATEGORY_DEFS = {
  orders_completed: {
    id: "orders_completed",
    titleFa: "سفارش‌های تکمیل‌شده (تحویل‌شده)",
    collection: "orders",
    defaultDays: 365,
    defaultEnabled: false,
    financial: true,
    permanentDeleteAllowedDefault: false,
  },
  orders_cancelled: {
    id: "orders_cancelled",
    titleFa: "سفارش‌های لغوشده",
    collection: "orders",
    defaultDays: 180,
    defaultEnabled: false,
    financial: true,
    permanentDeleteAllowedDefault: false,
  },
  orders_rejected: {
    id: "orders_rejected",
    titleFa: "سفارش‌های ردشده",
    collection: "orders",
    defaultDays: 180,
    defaultEnabled: false,
    financial: true,
    permanentDeleteAllowedDefault: false,
  },
  orders_return_completed: {
    id: "orders_return_completed",
    titleFa: "برگشت تکمیل‌شده",
    collection: "orders",
    defaultDays: 365,
    defaultEnabled: false,
    financial: true,
    permanentDeleteAllowedDefault: false,
  },
  orders_return_rejected: {
    id: "orders_return_rejected",
    titleFa: "برگشت رد/لغوشده",
    collection: "orders",
    defaultDays: 180,
    defaultEnabled: false,
    financial: true,
    permanentDeleteAllowedDefault: false,
  },
  campaigns: {
    id: "campaigns",
    titleFa: "تاریخچه کمپین ایمیل",
    collection: "campaigns",
    defaultDays: 365,
    defaultEnabled: false,
    financial: false,
    permanentDeleteAllowedDefault: true,
  },
  giveaways: {
    id: "giveaways",
    titleFa: "تاریخچه قرعه‌کشی",
    collection: "giveaways",
    defaultDays: 365,
    defaultEnabled: false,
    financial: false,
    permanentDeleteAllowedDefault: true,
  },
  feedback: {
    id: "feedback",
    titleFa: "بازخورد مشتریان",
    collection: "feedback",
    defaultDays: 365,
    defaultEnabled: false,
    financial: false,
    permanentDeleteAllowedDefault: true,
  },
  audit_logs: {
    id: "audit_logs",
    titleFa: "لاگ ممیزی (audit)",
    collection: "auditLog",
    defaultDays: 180,
    defaultEnabled: false,
    financial: false,
    permanentDeleteAllowedDefault: true,
  },
  password_resets: {
    id: "password_resets",
    titleFa: "توکن‌های بازیابی رمز",
    collection: "passwordResets",
    defaultDays: 7,
    defaultEnabled: true,
    financial: false,
    permanentDeleteAllowedDefault: true,
  },
  pending_signups: {
    id: "pending_signups",
    titleFa: "ثبت‌نام‌های تأییدنشده منقضی",
    collection: "pendingSignups",
    defaultDays: 14,
    defaultEnabled: true,
    financial: false,
    permanentDeleteAllowedDefault: true,
  },
  idempotency_keys: {
    id: "idempotency_keys",
    titleFa: "کلیدهای ایدمپوتنسی قدیمی",
    collection: "idempotencyKeys",
    defaultDays: 30,
    defaultEnabled: true,
    financial: false,
    permanentDeleteAllowedDefault: true,
  },
};

function now() { return Date.now(); }

function ensureRetention(db) {
  if (!db || typeof db !== "object") return false;
  let changed = false;
  db.config = db.config || {};
  if (!db.config.retention || typeof db.config.retention !== "object") {
    db.config.retention = {};
    changed = true;
  }
  const r = db.config.retention;
  if (r.automaticCleanupEnabled == null) { r.automaticCleanupEnabled = false; changed = true; }
  if (r.archiveBeforeDelete == null) { r.archiveBeforeDelete = true; changed = true; }
  if (r.showArchivedInAdmin == null) { r.showArchivedInAdmin = false; changed = true; }
  if (r.showArchivedToCustomers == null) { r.showArchivedToCustomers = false; changed = true; }
  if (r.batchSize == null) { r.batchSize = DEFAULT_BATCH; changed = true; }
  if (r.lastAutoRunAt === undefined) { r.lastAutoRunAt = null; changed = true; }
  if (!r.categories || typeof r.categories !== "object") { r.categories = {}; changed = true; }
  Object.keys(CATEGORY_DEFS).forEach((id) => {
    const def = CATEGORY_DEFS[id];
    const cur = r.categories[id] && typeof r.categories[id] === "object" ? r.categories[id] : {};
    const next = {
      enabled: cur.enabled != null ? !!cur.enabled : !!def.defaultEnabled,
      days: Math.max(1, Math.min(3650, parseInt(cur.days, 10) || def.defaultDays)),
      archiveBeforeDelete: cur.archiveBeforeDelete != null ? !!cur.archiveBeforeDelete : true,
      permanentDeleteAllowed: cur.permanentDeleteAllowed != null
        ? !!cur.permanentDeleteAllowed
        : !!def.permanentDeleteAllowedDefault,
    };
    const before = JSON.stringify(r.categories[id] || null);
    r.categories[id] = next;
    if (JSON.stringify(next) !== before) changed = true;
  });
  if (!Array.isArray(db.cleanupHistory)) { db.cleanupHistory = []; changed = true; }
  return changed;
}

function getRetentionConfig(db) {
  ensureRetention(db);
  return db.config.retention;
}

function publicRetentionConfig(db) {
  const r = getRetentionConfig(db);
  return {
    automaticCleanupEnabled: !!r.automaticCleanupEnabled,
    archiveBeforeDelete: !!r.archiveBeforeDelete,
    showArchivedInAdmin: !!r.showArchivedInAdmin,
    showArchivedToCustomers: !!r.showArchivedToCustomers,
    batchSize: Math.max(1, Math.min(MAX_BATCH, Number(r.batchSize) || DEFAULT_BATCH)),
    lastAutoRunAt: r.lastAutoRunAt || null,
    categories: Object.keys(CATEGORY_DEFS).map((id) => {
      const def = CATEGORY_DEFS[id];
      const c = r.categories[id] || {};
      return {
        id,
        titleFa: def.titleFa,
        collection: def.collection,
        financial: !!def.financial,
        enabled: !!c.enabled,
        days: c.days || def.defaultDays,
        archiveBeforeDelete: c.archiveBeforeDelete !== false,
        permanentDeleteAllowed: !!c.permanentDeleteAllowed,
        permanentDeleteAllowedDefault: !!def.permanentDeleteAllowedDefault,
      };
    }),
    financialSafetyNote:
      "سوابق مالی/پرداخت/بازپرداخت به‌صورت پیش‌فرض فقط آرشیف می‌شوند و حذف دائمی خودکار ندارند. حذف دائمی فقط با مجوز Owner و فعال‌سازی صریح دسته مجاز است.",
  };
}

function updateRetentionConfig(db, body, actor) {
  ensureRetention(db);
  const r = db.config.retention;
  const b = body || {};
  if (b.automaticCleanupEnabled != null) r.automaticCleanupEnabled = !!b.automaticCleanupEnabled;
  if (b.archiveBeforeDelete != null) r.archiveBeforeDelete = !!b.archiveBeforeDelete;
  if (b.showArchivedInAdmin != null) r.showArchivedInAdmin = !!b.showArchivedInAdmin;
  if (b.showArchivedToCustomers != null) r.showArchivedToCustomers = !!b.showArchivedToCustomers;
  if (b.batchSize != null) {
    r.batchSize = Math.max(1, Math.min(MAX_BATCH, parseInt(b.batchSize, 10) || DEFAULT_BATCH));
  }
  if (b.categories && typeof b.categories === "object") {
    Object.keys(b.categories).forEach((id) => {
      if (!CATEGORY_DEFS[id]) return;
      const cur = r.categories[id] || {};
      const incoming = b.categories[id] || {};
      if (incoming.enabled != null) cur.enabled = !!incoming.enabled;
      if (incoming.days != null) {
        cur.days = Math.max(1, Math.min(3650, parseInt(incoming.days, 10) || cur.days || CATEGORY_DEFS[id].defaultDays));
      }
      if (incoming.archiveBeforeDelete != null) cur.archiveBeforeDelete = !!incoming.archiveBeforeDelete;
      if (incoming.permanentDeleteAllowed != null) cur.permanentDeleteAllowed = !!incoming.permanentDeleteAllowed;
      r.categories[id] = cur;
    });
  }
  return { ok: true, retention: publicRetentionConfig(db), updatedBy: sanitizeText(actor, 80) };
}

/* ---------- eligibility ---------- */

const ACTIVE_ORDER_STATUSES = new Set([
  "new", "pending", "confirmed", "dispatched",
  "return_requested", "return_approved",
]);
const ACTIVE_ITEM_STATUSES = new Set([
  "pending", "approved", "shipped",
  "return_requested", "return_approved",
]);
const ACTIVE_RETURN_PICKUP = new Set([
  "not_assigned", "assigned", "on_the_way", "picked_up", "returned_to_store",
]);

function orderHasActiveReturn(o) {
  const rr = o && o.returnRequest;
  if (!rr) {
    /* item-level returns */
    return (o.items || []).some((it) => {
      if (!it || !it.returnRequest) return false;
      const st = it.itemStatus || "";
      return st === "return_requested" || st === "return_approved";
    });
  }
  const ost = normalizeOrderStatus(o.status);
  if (ost === "return_requested" || ost === "return_approved") return true;
  const rps = String(rr.returnPickupStatus || "");
  if (ACTIVE_RETURN_PICKUP.has(rps)) return true;
  if (rr.refundStatus === "approved" || rr.refundStatus === "not_ready") {
    if (!rr.cashRefundPaid && ost !== "return_completed" && ost !== "return_rejected") return true;
  }
  return false;
}

function orderHasUnresolvedPayment(o) {
  if (!o) return false;
  const pay = String(o.paymentStatus || "");
  if (pay === "awaiting_payment" || pay === "receipt_submitted" || pay === "under_review") return true;
  return false;
}

/** True if order must remain in active operational DB. */
function isOrderOperationallyActive(o) {
  if (!o || o.archived) return false;
  normalizeOrderItems(o);
  const st = normalizeOrderStatus(o.status);
  if (ACTIVE_ORDER_STATUSES.has(st)) return true;
  if (orderHasActiveReturn(o)) return true;
  if (orderHasUnresolvedPayment(o)) return true;
  const items = o.items || [];
  if (items.some((it) => it && ACTIVE_ITEM_STATUSES.has(it.itemStatus))) return true;
  /* partial: some delivered but others still active */
  if (items.length > 1) {
    const someActive = items.some((it) => it && ACTIVE_ITEM_STATUSES.has(it.itemStatus));
    if (someActive) return true;
  }
  /* driver mid-delivery */
  const ds = String(o.driverStatus || "");
  if (ds && ds !== "delivered" && ds !== "failed" && st !== "cancelled" && st !== "delivered") {
    if (ds === "assigned" || ds === "picked_up" || ds === "in_transit") return true;
  }
  return false;
}

function orderAgeMs(o) {
  const st = normalizeOrderStatus(o.status);
  if (st === "delivered" && o.deliveredAt) return now() - Number(o.deliveredAt);
  if (st === "return_completed") {
    const t = (o.returnRequest && (o.returnRequest.resolvedAt || o.returnRequest.returnedToStoreAt)) || o.deliveredAt || o.date;
    return now() - Number(t || 0);
  }
  if (st === "return_rejected") {
    const t = (o.returnRequest && o.returnRequest.resolvedAt) || o.date;
    return now() - Number(t || 0);
  }
  if (st === "cancelled") {
    const hist = (o.statusHistory || []).slice().reverse().find((h) => h && h.status === "cancelled");
    return now() - Number((hist && hist.at) || o.date || 0);
  }
  /* all-rejected */
  return now() - Number(o.date || 0);
}

function orderMatchesCategory(o, categoryId) {
  if (!o || o.archived) return false;
  if (isOrderOperationallyActive(o)) return false;
  normalizeOrderItems(o);
  const st = normalizeOrderStatus(o.status);
  const items = o.items || [];
  const allRejected = items.length > 0 && items.every((it) => it && it.itemStatus === "rejected");
  if (categoryId === "orders_completed") {
    return st === "delivered" && !orderHasActiveReturn(o);
  }
  if (categoryId === "orders_cancelled") {
    return st === "cancelled";
  }
  if (categoryId === "orders_rejected") {
    return allRejected || (st === "cancelled" && allRejected);
  }
  if (categoryId === "orders_return_completed") {
    return st === "return_completed";
  }
  if (categoryId === "orders_return_rejected") {
    return st === "return_rejected";
  }
  return false;
}

function isCampaignEligible(c, days) {
  if (!c || c.archived) return false;
  const st = String(c.status || "");
  if (st === "draft" || st === "sending") return false;
  if (!(st === "sent" || st === "failed" || st === "partial")) return false;
  const t = Number(c.sentAt || c.createdAt || 0);
  return t > 0 && (now() - t) >= days * DAY_MS;
}

function isGiveawayEligible(g, days) {
  if (!g || g.archived) return false;
  const st = String(g.status || "");
  if (st === "draft") return false;
  if (st === "voided") {
    const t = Number(g.voidedAt || g.createdAt || 0);
    return t > 0 && (now() - t) >= days * DAY_MS;
  }
  if (st === "drawn") {
    const winners = g.winners || [];
    const open = winners.some((w) => w && (w.claimStatus === "unclaimed" || !w.claimStatus));
    if (open) return false;
    const t = Number(g.drawnAt || g.createdAt || 0);
    return t > 0 && (now() - t) >= days * DAY_MS;
  }
  return false;
}

function isFeedbackEligible(f, days) {
  if (!f || f.archived) return false;
  const t = Number(f.submittedAt || f.createdAt || 0);
  if (!t) return false;
  if (String(f.status) === "pending" && (now() - t) < days * DAY_MS) return false;
  return (now() - t) >= days * DAY_MS;
}

function collectEligibleIds(db, categoryId, limit) {
  ensureRetention(db);
  const cfg = db.config.retention.categories[categoryId];
  if (!cfg || !cfg.enabled) return [];
  const days = cfg.days;
  const cap = limit != null ? limit : 10000;
  const out = [];

  if (categoryId.indexOf("orders_") === 0) {
    (db.orders || []).forEach((o) => {
      if (out.length >= cap) return;
      if (!orderMatchesCategory(o, categoryId)) return;
      if (orderAgeMs(o) < days * DAY_MS) return;
      out.push(o.id);
    });
    return out;
  }
  if (categoryId === "campaigns") {
    (db.campaigns || []).forEach((c) => {
      if (out.length >= cap) return;
      if (isCampaignEligible(c, days)) out.push(c.id);
    });
    return out;
  }
  if (categoryId === "giveaways") {
    (db.giveaways || []).forEach((g) => {
      if (out.length >= cap) return;
      if (isGiveawayEligible(g, days)) out.push(g.id);
    });
    return out;
  }
  if (categoryId === "feedback") {
    (db.feedback || []).forEach((f) => {
      if (out.length >= cap) return;
      if (isFeedbackEligible(f, days)) out.push(f.id);
    });
    return out;
  }
  if (categoryId === "audit_logs") {
    (db.auditLog || []).forEach((a) => {
      if (out.length >= cap) return;
      if (a && !a.archived && a.at && (now() - Number(a.at)) >= days * DAY_MS) out.push(a.id);
    });
    return out;
  }
  if (categoryId === "password_resets") {
    (db.passwordResets || []).forEach((p, i) => {
      if (out.length >= cap) return;
      if (!p) return;
      const exp = Number(p.exp || p.expiresAt || 0);
      const created = Number(p.at || p.createdAt || 0);
      const old = (exp && exp < now()) || (created && (now() - created) >= days * DAY_MS) || p.used;
      if (old) out.push(p.id || ("idx_" + i));
    });
    return out;
  }
  if (categoryId === "pending_signups") {
    (db.pendingSignups || []).forEach((p, i) => {
      if (out.length >= cap) return;
      if (!p) return;
      const exp = Number(p.exp || p.expiresAt || 0);
      const created = Number(p.at || p.createdAt || 0);
      if ((exp && exp < now()) || (created && (now() - created) >= days * DAY_MS)) {
        out.push(p.id || p.email || ("idx_" + i));
      }
    });
    return out;
  }
  if (categoryId === "idempotency_keys") {
    const keys = db.idempotencyKeys || {};
    Object.keys(keys).forEach((k) => {
      if (out.length >= cap) return;
      const row = keys[k];
      const t = typeof row === "object" ? Number(row.at || row.ts || 0) : 0;
      if (!t || (now() - t) >= days * DAY_MS) out.push(k);
    });
    return out;
  }
  return out;
}

function previewCleanup(db) {
  ensureRetention(db);
  const categories = {};
  let total = 0;
  Object.keys(CATEGORY_DEFS).forEach((id) => {
    const cfg = db.config.retention.categories[id];
    const ids = cfg && cfg.enabled ? collectEligibleIds(db, id, 100000) : [];
    categories[id] = {
      id,
      titleFa: CATEGORY_DEFS[id].titleFa,
      enabled: !!(cfg && cfg.enabled),
      days: cfg ? cfg.days : CATEGORY_DEFS[id].defaultDays,
      eligible: ids.length,
      financial: !!CATEGORY_DEFS[id].financial,
      permanentDeleteAllowed: !!(cfg && cfg.permanentDeleteAllowed),
      sampleIds: ids.slice(0, 5),
    };
    total += ids.length;
  });
  return {
    ok: true,
    at: now(),
    totalEligible: total,
    categories,
    counts: storageCounts(db),
    note: "این فقط پیش‌نمایش است — هیچ داده‌ای حذف یا آرشیف نشده است.",
  };
}

function storageCounts(db) {
  ensureRetention(db);
  const countArchived = (arr) => (arr || []).filter((x) => x && x.archived).length;
  const countActive = (arr) => (arr || []).filter((x) => x && !x.archived).length;
  return {
    ordersActive: countActive(db.orders),
    ordersArchived: countArchived(db.orders),
    campaignsActive: countActive(db.campaigns),
    campaignsArchived: countArchived(db.campaigns),
    giveawaysActive: countActive(db.giveaways),
    giveawaysArchived: countArchived(db.giveaways),
    feedbackActive: countActive(db.feedback),
    feedbackArchived: countArchived(db.feedback),
    auditLog: (db.auditLog || []).length,
    users: (db.users || []).length,
    products: (db.products || []).length,
    stores: (db.stores || []).length,
    staff: (db.staff || []).length,
    drivers: (db.drivers || []).length,
    posSales: (db.posSales || []).length,
    note: "حجم دقیق فایل دیتابیس ارائه‌دهنده در دسترس نیست؛ این شمارش‌های قابل اعتماد از db.json هستند.",
  };
}

function markArchived(row, actor, categoryId) {
  if (!row || typeof row !== "object") return false;
  if (row.archived) return false; /* idempotent */
  row.archived = true;
  row.archivedAt = now();
  row.archivedBy = sanitizeText(actor, 80) || "system";
  row.archiveCategory = categoryId;
  return true;
}

function appendArchiveExport(archiveDir, categoryId, records) {
  if (!archiveDir || !records || !records.length) return null;
  try {
    fs.mkdirSync(archiveDir, { recursive: true });
    const file = path.join(archiveDir, categoryId + ".jsonl");
    const lines = records.map((r) => JSON.stringify({ exportedAt: now(), categoryId, record: r })).join("\n") + "\n";
    fs.appendFileSync(file, lines, "utf8");
    return file;
  } catch (_) {
    return null;
  }
}

function pushCleanupHistory(db, entry) {
  ensureRetention(db);
  const row = {
    id: "cln_" + crypto.randomBytes(6).toString("hex"),
    at: now(),
    actor: sanitizeText(entry.actor, 80) || "system",
    action: entry.action || "unknown",
    mode: entry.mode || "",
    automatic: !!entry.automatic,
    categories: entry.categories || {},
    affected: Number(entry.affected) || 0,
    success: entry.success !== false,
    error: entry.error ? String(entry.error).slice(0, 300) : null,
    confirmPhrase: undefined,
  };
  db.cleanupHistory.unshift(row);
  if (db.cleanupHistory.length > 500) db.cleanupHistory.length = 500;
  return row;
}

/**
 * Run archive and/or permanent delete for enabled categories.
 * @param {object} opts
 * @param {'preview'|'archive'|'delete'} opts.mode
 * @param {string[]} [opts.categoryIds]
 * @param {boolean} opts.automatic
 * @param {string} opts.actor
 * @param {string} [opts.confirmPhrase] required for delete: "DELETE" or "حذف"
 * @param {string} [opts.archiveDir]
 * @param {number} [opts.batchSize]
 */
function runCleanup(db, opts) {
  opts = opts || {};
  ensureRetention(db);
  const mode = opts.mode || "archive";
  if (mode === "preview") return { ok: true, preview: previewCleanup(db) };

  if (mode === "delete") {
    const phrase = String(opts.confirmPhrase || "").trim();
    if (phrase !== "DELETE" && phrase !== "حذف") {
      return { ok: false, error: "confirm_required", status: 400, message: "برای حذف دائمی عبارت DELETE یا حذف را وارد کنید." };
    }
  }

  const r = db.config.retention;
  const batchSize = Math.max(1, Math.min(MAX_BATCH, Number(opts.batchSize) || r.batchSize || DEFAULT_BATCH));
  const categoryIds = Array.isArray(opts.categoryIds) && opts.categoryIds.length
    ? opts.categoryIds.filter((id) => CATEGORY_DEFS[id])
    : Object.keys(CATEGORY_DEFS).filter((id) => r.categories[id] && r.categories[id].enabled);

  const results = {};
  let affected = 0;
  const exported = [];

  try {
    categoryIds.forEach((id) => {
      const cfg = r.categories[id];
      if (!cfg || !cfg.enabled) {
        results[id] = { skipped: true, reason: "disabled" };
        return;
      }
      const ids = collectEligibleIds(db, id, batchSize);
      let archived = 0;
      let deleted = 0;
      let skippedActive = 0;

      if (mode === "archive" || (mode === "delete" && (cfg.archiveBeforeDelete !== false && r.archiveBeforeDelete !== false))) {
        /* Ephemeral collections: archive == safe purge */
        if (id === "password_resets" || id === "pending_signups" || id === "idempotency_keys") {
          if (mode === "archive") {
            /* fall through to delete-style purge below by switching locally */
          }
        } else {
          ids.forEach((eid) => {
            const row = findRow(db, id, eid);
            if (!row) return;
            if (id.indexOf("orders_") === 0 && isOrderOperationallyActive(row)) { skippedActive++; return; }
            if (markArchived(row, opts.actor, id)) archived++;
          });
        }
      }

      if (mode === "archive" && (id === "password_resets" || id === "pending_signups" || id === "idempotency_keys")) {
        /* Reuse delete path for ephemeral by temporarily allowing */
        const days = cfg.days;
        if (id === "password_resets") {
          const kept = [];
          const removed = [];
          (db.passwordResets || []).forEach((p) => {
            if (!p) return;
            const exp = Number(p.exp || p.expiresAt || 0);
            const created = Number(p.at || p.createdAt || 0);
            const old = (exp && exp < now()) || (created && (now() - created) >= days * DAY_MS) || p.used;
            if (old && removed.length < batchSize) removed.push(p);
            else kept.push(p);
          });
          db.passwordResets = kept;
          deleted = removed.length;
        } else if (id === "pending_signups") {
          const kept = [];
          const removed = [];
          (db.pendingSignups || []).forEach((p) => {
            if (!p) return;
            const exp = Number(p.exp || p.expiresAt || 0);
            const created = Number(p.at || p.createdAt || 0);
            const old = (exp && exp < now()) || (created && (now() - created) >= days * DAY_MS);
            if (old && removed.length < batchSize) removed.push(p);
            else kept.push(p);
          });
          db.pendingSignups = kept;
          deleted = removed.length;
        } else {
          const keys = db.idempotencyKeys || {};
          Object.keys(keys).forEach((k) => {
            if (deleted >= batchSize) return;
            const row = keys[k];
            const t = typeof row === "object" ? Number(row.at || row.ts || 0) : 0;
            if (!t || (now() - t) >= days * DAY_MS) { delete keys[k]; deleted++; }
          });
          db.idempotencyKeys = keys;
        }
        results[id] = { archived: 0, deleted, skippedActive: 0, eligibleConsidered: ids.length };
        affected += deleted;
        return;
      }

      if (mode === "delete") {
        if (!cfg.permanentDeleteAllowed) {
          results[id] = {
            archived,
            deleted: 0,
            skippedActive,
            blocked: "permanent_delete_disabled",
            message: "حذف دائمی برای این دسته غیرفعال است (ایمنی مالی/حسابداری).",
          };
          affected += archived;
          return;
        }

        /* Stable bulk purge for ephemeral collections (avoid index-shift bugs) */
        if (id === "password_resets" || id === "pending_signups" || id === "idempotency_keys") {
          const beforeCount =
            id === "idempotency_keys"
              ? Object.keys(db.idempotencyKeys || {}).length
              : ((id === "password_resets" ? db.passwordResets : db.pendingSignups) || []).length;
          const days = cfg.days;
          if (id === "password_resets") {
            const kept = [];
            const removed = [];
            (db.passwordResets || []).forEach((p) => {
              if (!p) return;
              const exp = Number(p.exp || p.expiresAt || 0);
              const created = Number(p.at || p.createdAt || 0);
              const old = (exp && exp < now()) || (created && (now() - created) >= days * DAY_MS) || p.used;
              if (old && removed.length < batchSize) removed.push(p);
              else kept.push(p);
            });
            db.passwordResets = kept;
            deleted = removed.length;
            if (removed.length && opts.archiveDir) {
              const f = appendArchiveExport(opts.archiveDir, id, removed);
              if (f) exported.push(f);
            }
          } else if (id === "pending_signups") {
            const kept = [];
            const removed = [];
            (db.pendingSignups || []).forEach((p) => {
              if (!p) return;
              const exp = Number(p.exp || p.expiresAt || 0);
              const created = Number(p.at || p.createdAt || 0);
              const old = (exp && exp < now()) || (created && (now() - created) >= days * DAY_MS);
              if (old && removed.length < batchSize) removed.push(p);
              else kept.push(p);
            });
            db.pendingSignups = kept;
            deleted = removed.length;
            if (removed.length && opts.archiveDir) {
              const f = appendArchiveExport(opts.archiveDir, id, removed);
              if (f) exported.push(f);
            }
          } else {
            const keys = db.idempotencyKeys || {};
            const removeKeys = [];
            Object.keys(keys).forEach((k) => {
              if (removeKeys.length >= batchSize) return;
              const row = keys[k];
              const t = typeof row === "object" ? Number(row.at || row.ts || 0) : 0;
              if (!t || (now() - t) >= days * DAY_MS) removeKeys.push(k);
            });
            removeKeys.forEach((k) => { delete keys[k]; deleted++; });
            db.idempotencyKeys = keys;
          }
          results[id] = { archived: 0, deleted, skippedActive: 0, eligibleConsidered: beforeCount };
          affected += deleted;
          return;
        }

        const toRemove = collectEligibleIds(db, id, batchSize).concat(
          listArchivedIds(db, id, batchSize)
        );
        const unique = Array.from(new Set(toRemove)).slice(0, batchSize);
        const removedRecords = [];
        unique.forEach((eid) => {
          const row = findRow(db, id, eid);
          if (!row) return;
          if (id.indexOf("orders_") === 0 && isOrderOperationallyActive(row)) { skippedActive++; return; }
          if ((cfg.archiveBeforeDelete !== false) && !row.archived) {
            if (markArchived(row, opts.actor, id)) archived++;
            return;
          }
          removedRecords.push(JSON.parse(JSON.stringify(row)));
          if (removeRow(db, id, eid)) deleted++;
        });
        if (removedRecords.length && opts.archiveDir) {
          const f = appendArchiveExport(opts.archiveDir, id, removedRecords);
          if (f) exported.push(f);
        }
      }

      results[id] = { archived, deleted, skippedActive, eligibleConsidered: ids.length };
      affected += archived + deleted;
    });

    /* Never touch protected collections — assert */
    assertProtectedIntact(db);

    const hist = pushCleanupHistory(db, {
      actor: opts.actor,
      action: mode === "delete" ? "cleanup_permanent" : "cleanup_archive",
      mode,
      automatic: !!opts.automatic,
      categories: results,
      affected,
      success: true,
    });
    if (opts.automatic) db.config.retention.lastAutoRunAt = now();

    return {
      ok: true,
      mode,
      affected,
      results,
      exportedFiles: exported,
      historyId: hist.id,
      counts: storageCounts(db),
    };
  } catch (e) {
    pushCleanupHistory(db, {
      actor: opts.actor,
      action: mode === "delete" ? "cleanup_permanent" : "cleanup_archive",
      mode,
      automatic: !!opts.automatic,
      categories: results,
      affected,
      success: false,
      error: (e && e.message) || "cleanup_failed",
    });
    return { ok: false, error: "cleanup_failed", status: 500, message: String((e && e.message) || e).slice(0, 200) };
  }
}

function findRow(db, categoryId, id) {
  if (categoryId.indexOf("orders_") === 0) return (db.orders || []).find((o) => o && o.id === id);
  if (categoryId === "campaigns") return (db.campaigns || []).find((c) => c && c.id === id);
  if (categoryId === "giveaways") return (db.giveaways || []).find((g) => g && g.id === id);
  if (categoryId === "feedback") return (db.feedback || []).find((f) => f && f.id === id);
  if (categoryId === "audit_logs") return (db.auditLog || []).find((a) => a && a.id === id);
  if (categoryId === "password_resets") {
    return (db.passwordResets || []).find((p, i) => p && ((p.id || ("idx_" + i)) === id));
  }
  if (categoryId === "pending_signups") {
    return (db.pendingSignups || []).find((p, i) => p && ((p.id || p.email || ("idx_" + i)) === id));
  }
  if (categoryId === "idempotency_keys") {
    const keys = db.idempotencyKeys || {};
    return keys[id] != null ? { id, value: keys[id] } : null;
  }
  return null;
}

function listArchivedIds(db, categoryId, limit) {
  const out = [];
  const push = (id) => { if (out.length < limit) out.push(id); };
  if (categoryId.indexOf("orders_") === 0) {
    (db.orders || []).forEach((o) => {
      if (o && o.archived && o.archiveCategory === categoryId) push(o.id);
    });
  } else if (categoryId === "campaigns") {
    (db.campaigns || []).forEach((c) => { if (c && c.archived) push(c.id); });
  } else if (categoryId === "giveaways") {
    (db.giveaways || []).forEach((g) => { if (g && g.archived) push(g.id); });
  } else if (categoryId === "feedback") {
    (db.feedback || []).forEach((f) => { if (f && f.archived) push(f.id); });
  } else if (categoryId === "audit_logs") {
    (db.auditLog || []).forEach((a) => { if (a && a.archived) push(a.id); });
  }
  return out;
}

function removeRow(db, categoryId, id) {
  const spliceBy = (arr, pred) => {
    if (!Array.isArray(arr)) return false;
    const i = arr.findIndex(pred);
    if (i < 0) return false;
    arr.splice(i, 1);
    return true;
  };
  if (categoryId.indexOf("orders_") === 0) return spliceBy(db.orders, (o) => o && o.id === id);
  if (categoryId === "campaigns") return spliceBy(db.campaigns, (c) => c && c.id === id);
  if (categoryId === "giveaways") return spliceBy(db.giveaways, (g) => g && g.id === id);
  if (categoryId === "feedback") return spliceBy(db.feedback, (f) => f && f.id === id);
  if (categoryId === "audit_logs") return spliceBy(db.auditLog, (a) => a && a.id === id);
  if (categoryId === "password_resets") {
    return spliceBy(db.passwordResets, (p, i) => p && ((p.id || ("idx_" + i)) === id));
  }
  if (categoryId === "pending_signups") {
    return spliceBy(db.pendingSignups, (p, i) => p && ((p.id || p.email || ("idx_" + i)) === id));
  }
  if (categoryId === "idempotency_keys") {
    if (db.idempotencyKeys && Object.prototype.hasOwnProperty.call(db.idempotencyKeys, id)) {
      delete db.idempotencyKeys[id];
      return true;
    }
  }
  return false;
}

function assertProtectedIntact(db) {
  /* Soft assertion helpers — throw if arrays were wiped unexpectedly */
  if (!Array.isArray(db.products)) throw new Error("products_missing");
  if (!Array.isArray(db.users)) throw new Error("users_missing");
  if (!Array.isArray(db.stores)) throw new Error("stores_missing");
  if (!db.config || typeof db.config !== "object") throw new Error("config_missing");
}

function filterOrdersForCustomer(orders, retention) {
  const show = retention && retention.showArchivedToCustomers;
  return (orders || []).filter((o) => o && (show || !o.archived));
}

function filterOrdersForAdmin(orders, retention, showArchivedFlag) {
  const show = showArchivedFlag != null ? !!showArchivedFlag : !!(retention && retention.showArchivedInAdmin);
  return (orders || []).filter((o) => o && (show || !o.archived));
}

function maybeRunAutomaticCleanup(db, opts) {
  ensureRetention(db);
  if (!db.config.retention.automaticCleanupEnabled) {
    return { ok: true, skipped: true, reason: "automatic_disabled" };
  }
  const last = Number(db.config.retention.lastAutoRunAt || 0);
  /* At most once per 12 hours when triggered by cron/heartbeat */
  if (last && (now() - last) < 12 * 60 * 60 * 1000 && !opts.force) {
    return { ok: true, skipped: true, reason: "too_soon" };
  }
  return runCleanup(db, {
    mode: "archive",
    automatic: true,
    actor: opts.actor || "system:auto",
    archiveDir: opts.archiveDir,
    batchSize: opts.batchSize,
  });
}

module.exports = {
  CATEGORY_DEFS,
  DAY_MS,
  ensureRetention,
  getRetentionConfig,
  publicRetentionConfig,
  updateRetentionConfig,
  isOrderOperationallyActive,
  orderMatchesCategory,
  collectEligibleIds,
  previewCleanup,
  storageCounts,
  runCleanup,
  maybeRunAutomaticCleanup,
  filterOrdersForCustomer,
  filterOrdersForAdmin,
  pushCleanupHistory,
  markArchived,
};
