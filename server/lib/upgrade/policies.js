"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { sanitizeText } = require("../security");

const KINDS = ["terms", "privacy", "returns", "other"];

function emptyKind() {
  return { versions: [] };
}

function ensurePolicies(db) {
  if (!db.policies || typeof db.policies !== "object") {
    db.policies = { terms: emptyKind(), privacy: emptyKind() };
    return true;
  }
  let changed = false;
  KINDS.forEach((k) => {
    if (!db.policies[k] || !Array.isArray(db.policies[k].versions)) {
      db.policies[k] = emptyKind();
      changed = true;
    }
  });
  return changed;
}

function published(db, kind) {
  ensurePolicies(db);
  const versions = (db.policies[kind] && db.policies[kind].versions) || [];
  return versions.find((v) => v && v.status === "published") || null;
}

function publicPolicy(db, kind) {
  const row = published(db, kind);
  if (!row) return null;
  return {
    kind: kind,
    id: row.id,
    version: row.version,
    title: row.title || "",
    title_en: row.title_en || "",
    body: row.body || "",
    body_en: row.body_en || "",
    publishedAt: row.publishedAt || null,
    hasPdf: !!row.pdfFile,
  };
}

function acceptanceSnapshot(db) {
  const terms = published(db, "terms");
  const privacy = published(db, "privacy");
  return {
    accepted: true,
    acceptedAt: Date.now(),
    termsVersion: terms ? terms.version : null,
    privacyVersion: privacy ? privacy.version : null,
    termsId: terms ? terms.id : null,
    privacyId: privacy ? privacy.id : null,
  };
}

function acceptanceCount(db, kind, id) {
  return (db.users || []).filter((user) => {
    const snap = user && user.policyAcceptance;
    if (!snap) return false;
    if (kind === "terms") return snap.termsId === id;
    if (kind === "privacy") return snap.privacyId === id;
    return false;
  }).length;
}

function findVersion(db, kind, id) {
  ensurePolicies(db);
  if (KINDS.indexOf(kind) < 0) return null;
  return (db.policies[kind].versions || []).find((row) => row && row.id === id) || null;
}

function canDelete(db, kind, row) {
  if (!row || row.status !== "draft" || row.publishedAt) return false;
  return acceptanceCount(db, kind, row.id) === 0;
}

function removeDraft(db, kind, id) {
  const row = findVersion(db, kind, id);
  if (!row) return { error: "not_found", status: 404 };
  if (!canDelete(db, kind, row)) return { error: "retain_history", status: 409 };
  db.policies[kind].versions = db.policies[kind].versions.filter((item) => item.id !== id);
  return { ok: true, deleted: true };
}

function unpublish(db, kind, id) {
  const row = findVersion(db, kind, id);
  if (!row) return { error: "not_found", status: 404 };
  if (row.status !== "published") return { error: "not_published", status: 400 };
  row.status = "inactive";
  row.unpublishedAt = Date.now();
  return { version: row };
}

function archiveVersion(db, kind, id) {
  const row = findVersion(db, kind, id);
  if (!row) return { error: "not_found", status: 404 };
  if (row.status === "archived") return { version: row };
  row.status = "archived";
  row.archivedAt = Date.now();
  return { version: row };
}

function adminView(db) {
  ensurePolicies(db);
  const pack = (kind) => (db.policies[kind].versions || []).map((v) => ({
    id: v.id,
    version: v.version,
    title: v.title || "",
    title_en: v.title_en || "",
    body: v.body || "",
    body_en: v.body_en || "",
    status: v.status,
    createdAt: v.createdAt || null,
    publishedAt: v.publishedAt || null,
    hasPdf: !!v.pdfFile,
    acceptedCount: acceptanceCount(db, kind, v.id),
    deletable: canDelete(db, kind, v),
  }));
  const out = {};
  KINDS.forEach((kind) => { out[kind] = pack(kind); });
  return out;
}

function cleanVersion(body, existing) {
  const src = body && typeof body === "object" ? body : {};
  const base = existing || {};
  return {
    id: base.id || ("pol_" + crypto.randomBytes(6).toString("hex")),
    version: sanitizeText(src.version != null ? src.version : base.version, 40) || "1.0",
    title: sanitizeText(src.title != null ? src.title : base.title, 160),
    title_en: sanitizeText(src.title_en != null ? src.title_en : base.title_en, 160),
    body: sanitizeText(src.body != null ? src.body : base.body, 20000),
    body_en: sanitizeText(src.body_en != null ? src.body_en : base.body_en, 20000),
    status: base.status || "draft",
    createdAt: base.createdAt || Date.now(),
    publishedAt: base.publishedAt || null,
    pdfFile: base.pdfFile || "",
  };
}

function upsertDraft(db, kind, body) {
  ensurePolicies(db);
  if (KINDS.indexOf(kind) < 0) return { error: "bad_kind", status: 400 };
  const versions = db.policies[kind].versions;
  const id = body && body.id;
  if (id) {
    const row = versions.find((v) => v.id === id);
    if (!row) return { error: "not_found", status: 404 };
    if (row.status === "published") return { error: "published_locked", status: 400 };
    const next = cleanVersion(body, row);
    next.status = row.status === "archived" ? "archived" : "draft";
    Object.assign(row, next, { status: next.status, pdfFile: row.pdfFile || "" });
    return { version: row };
  }
  const row = cleanVersion(body, null);
  row.status = "draft";
  versions.unshift(row);
  return { version: row };
}

function publish(db, kind, id) {
  ensurePolicies(db);
  if (KINDS.indexOf(kind) < 0) return { error: "bad_kind", status: 400 };
  const versions = db.policies[kind].versions;
  const row = versions.find((v) => v.id === id);
  if (!row) return { error: "not_found", status: 404 };
  versions.forEach((v) => {
    if (v.status === "published") v.status = "archived";
  });
  row.status = "published";
  row.publishedAt = Date.now();
  return { version: row };
}

function queueNotice(db, kind, versionId) {
  if (!Array.isArray(db.policyNotices)) db.policyNotices = [];
  const key = String(kind) + ":" + String(versionId);
  const existing = db.policyNotices.find((row) => row && row.key === key);
  if (existing) return { duplicate: true, notice: existing };
  const notice = {
    key: key,
    kind: kind,
    versionId: versionId,
    status: "queued",
    delivery: "queued_not_sent",
    support: "support@mahomarket.com",
    recipientCount: (db.users || []).filter((user) => user && user.email && !user.deletedAt && user.accountStatus !== "deleted").length,
    at: Date.now(),
  };
  db.policyNotices.push(notice);
  return { duplicate: false, notice: notice };
}

function welcomeAttachments(db) {
  return ["terms", "privacy"].map((kind) => {
    const row = published(db, kind);
    return row && row.pdfFile ? { kind: kind, version: row.version, file: row.pdfFile } : null;
  }).filter(Boolean);
}

function attachPdf(db, kind, id, filename) {
  const versions = (db.policies[kind] && db.policies[kind].versions) || [];
  const row = versions.find((v) => v.id === id);
  if (!row) return { error: "not_found", status: 404 };
  row.pdfFile = filename;
  return { version: row };
}

function pdfPath(dataDir, filename) {
  const base = path.join(dataDir, "private", "policies");
  const safe = path.basename(String(filename || ""));
  if (!safe || safe !== filename) return null;
  const abs = path.join(base, safe);
  if (!abs.startsWith(base)) return null;
  return abs;
}

function ensurePdfDir(dataDir) {
  const dir = path.join(dataDir, "private", "policies");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const STARTERS = {
  terms: {
    version: "draft-1",
    title: "قوانین و شرایط استفاده",
    title_en: "Terms and Conditions",
    body: "این پیش‌نویس است و تا وقتی از پنل مدیریت منتشر نشود در سایت نمایش داده نمی‌شود.\n\nفروشگاه ماهو (MAHO Market) پوشاک و لوازم بانوان را به‌صورت حضوری و آنلاین عرضه می‌کند. با ساخت حساب، مشتری تأیید می‌کند که معلومات ثبت‌شده درست است و سفارش‌ها پس از بررسی فروشگاه پردازش می‌شوند. قیمت، موجودی و وضعیت سفارش در زمان ثبت، مطابق سیستم فروشگاه است. برگشت کالا تابع مهلت و قوانین برگشتیِ منتشرشده است.",
    body_en: "This is a draft and is not shown on the website until an administrator publishes it.\n\nMAHO Market sells women's clothing and accessories in store and online. By creating an account, the customer confirms that the details provided are accurate and that orders are processed after store review. Price, stock, and order status follow the store system at the time of purchase. Returns follow the published return window and rules.",
  },
  privacy: {
    version: "draft-1",
    title: "پالیسی حریم خصوصی",
    title_en: "Privacy Policy",
    body: "این پیش‌نویس است و تا وقتی منتشر نشود در سایت نمایش داده نمی‌شود.\n\nماهو معلومات حساب، سفارش، و پیام‌های لازم برای خدمات را نگه می‌دارد. رمز عبور به‌صورت رمزنگاری‌شده ذخیره می‌شود. کارت مشتری فقط از طریق حساب خود مشتری یا کارمند مجاز دیده می‌شود. معلومات پرداخت حساس مانند CVV ذخیره نمی‌شود. مشتری می‌تواند رضایت پیام‌های تبلیغاتی را جداگانه بدهد یا لغو کند.",
    body_en: "This is a draft and is not shown on the website until it is published.\n\nMAHO keeps account, order, and service messages needed to run the store. Passwords are stored as hashes. A customer card is visible to that customer and to authorized staff. Sensitive payment data such as a CVV is not stored. Marketing email is optional and can be withdrawn.",
  },
};

function createStarter(db, kind) {
  const starter = STARTERS[kind] || {
    version: "draft-1",
    title: kind === "returns" ? "سیاست برگشت" : "سند",
    title_en: kind === "returns" ? "Returns policy" : "Document",
    body: "این پیش‌نویس است و تا زمان انتشار در سایت دیده نمی‌شود.",
    body_en: "This draft stays off the website until it is published.",
  };
  return upsertDraft(db, kind, starter);
}

module.exports = {
  KINDS,
  ensurePolicies,
  published,
  findVersion,
  publicPolicy,
  acceptanceSnapshot,
  adminView,
  upsertDraft,
  publish,
  unpublish,
  archiveVersion,
  removeDraft,
  queueNotice,
  welcomeAttachments,
  attachPdf,
  pdfPath,
  ensurePdfDir,
  createStarter,
};
