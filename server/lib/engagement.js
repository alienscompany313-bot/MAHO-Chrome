"use strict";
/**
 * Customer Engagement — newsletter, campaigns, feedback, ratings.
 * Additive only: never wipes existing catalog/orders/users.
 */
const crypto = require("crypto");
const { hashOpaque, verifyOpaque, randomToken, sanitizeText } = require("./security");

function now() { return Date.now(); }

function ensureEngagement(data) {
  if (!data || typeof data !== "object") return false;
  let changed = false;
  if (!Array.isArray(data.subscribers)) { data.subscribers = []; changed = true; }
  if (!Array.isArray(data.campaigns)) { data.campaigns = []; changed = true; }
  if (!Array.isArray(data.feedback)) { data.feedback = []; changed = true; }
  if (!data.config || typeof data.config !== "object") { data.config = {}; changed = true; }
  if (!data.config.engagement || typeof data.config.engagement !== "object") {
    data.config.engagement = {
      googleReviewUrl: "",
      feedbackRequestEnabled: true,
      minStarsForGoogleReview: 4,
    };
    changed = true;
  } else {
    const e = data.config.engagement;
    if (e.googleReviewUrl == null) { e.googleReviewUrl = ""; changed = true; }
    if (e.feedbackRequestEnabled == null) { e.feedbackRequestEnabled = true; changed = true; }
    if (e.minStarsForGoogleReview == null) { e.minStarsForGoogleReview = 4; changed = true; }
  }
  return changed;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  const e = normalizeEmail(email);
  if (!e || e.length > 200) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function publicSubscriber(s) {
  if (!s) return null;
  return {
    id: s.id,
    email: s.email,
    status: s.status === "inactive" ? "inactive" : "active",
    source: s.source || "website",
    createdAt: s.createdAt || null,
    updatedAt: s.updatedAt || null,
    unsubscribedAt: s.unsubscribedAt || null,
  };
}

function findSubscriberByEmail(db, email) {
  const e = normalizeEmail(email);
  if (!e) return null;
  return (db.subscribers || []).find((s) => s && normalizeEmail(s.email) === e) || null;
}

function findSubscriberById(db, id) {
  const sid = String(id || "");
  return (db.subscribers || []).find((s) => s && s.id === sid) || null;
}

function issueUnsubscribeToken(subscriber, pepper) {
  const raw = randomToken(24);
  subscriber.unsubscribeTokenHash = hashOpaque(raw, pepper);
  subscriber.unsubscribeTokenIssuedAt = now();
  return raw;
}

function subscribeEmail(db, { email, source, pepper }) {
  ensureEngagement(db);
  const e = normalizeEmail(email);
  if (!isValidEmail(e)) return { ok: false, error: "invalid_email", status: 400 };
  let s = findSubscriberByEmail(db, e);
  if (s) {
    if (s.status === "active") {
      return { ok: true, already: true, subscriber: publicSubscriber(s) };
    }
    s.status = "active";
    s.updatedAt = now();
    s.unsubscribedAt = null;
    s.source = s.source || source || "website";
    if (!s.unsubscribeTokenHash && pepper) issueUnsubscribeToken(s, pepper);
    return { ok: true, reactivated: true, subscriber: publicSubscriber(s), rawToken: null };
  }
  s = {
    id: "sub_" + crypto.randomBytes(8).toString("hex"),
    email: e,
    status: "active",
    source: sanitizeText(source || "website", 40) || "website",
    createdAt: now(),
    updatedAt: now(),
    unsubscribedAt: null,
  };
  let rawToken = null;
  if (pepper) rawToken = issueUnsubscribeToken(s, pepper);
  db.subscribers.push(s);
  return { ok: true, created: true, subscriber: publicSubscriber(s), rawToken: rawToken };
}

function unsubscribeByToken(db, email, rawToken, pepper) {
  ensureEngagement(db);
  const s = findSubscriberByEmail(db, email);
  if (!s || !s.unsubscribeTokenHash) return { ok: false, error: "not_found", status: 404 };
  if (!verifyOpaque(rawToken, s.unsubscribeTokenHash, pepper)) {
    return { ok: false, error: "invalid_token", status: 400 };
  }
  s.status = "inactive";
  s.updatedAt = now();
  s.unsubscribedAt = now();
  return { ok: true, subscriber: publicSubscriber(s) };
}

function setSubscriberStatus(db, id, status) {
  const s = findSubscriberById(db, id);
  if (!s) return { ok: false, error: "not_found", status: 404 };
  const next = status === "inactive" ? "inactive" : "active";
  s.status = next;
  s.updatedAt = now();
  if (next === "inactive") s.unsubscribedAt = now();
  else s.unsubscribedAt = null;
  return { ok: true, subscriber: publicSubscriber(s) };
}

function filterSubscribers(db, { q, status, ids } = {}) {
  ensureEngagement(db);
  let list = (db.subscribers || []).slice();
  if (status === "active" || status === "inactive") {
    list = list.filter((s) => (s.status || "active") === status);
  }
  if (Array.isArray(ids) && ids.length) {
    const set = new Set(ids.map(String));
    list = list.filter((s) => set.has(s.id));
  }
  const needle = String(q || "").trim().toLowerCase();
  if (needle) {
    list = list.filter((s) => String(s.email || "").toLowerCase().indexOf(needle) >= 0);
  }
  list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return list.map(publicSubscriber);
}

/** CSV injection protection: neutralize formula-leading cells */
function csvSafeCell(v) {
  let s = String(v == null ? "" : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

function subscribersToCsv(rows) {
  const header = ["email", "status", "source", "createdAt", "updatedAt"];
  const lines = [header.join(",")];
  (rows || []).forEach((r) => {
    lines.push([
      r.email || "",
      r.status || "active",
      r.source || "",
      r.createdAt ? new Date(r.createdAt).toISOString() : "",
      r.updatedAt ? new Date(r.updatedAt).toISOString() : "",
    ].map(csvSafeCell).join(","));
  });
  return "\uFEFF" + lines.join("\n");
}

function subscribersToXlsHtml(rows) {
  const head = ["Email", "Status", "Source", "Created At", "Updated At"];
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const body = (rows || []).map((r) => {
    const cells = [
      r.email || "",
      r.status || "active",
      r.source || "",
      r.createdAt ? new Date(r.createdAt).toISOString() : "",
      r.updatedAt ? new Date(r.updatedAt).toISOString() : "",
    ].map((x) => "<td>" + esc(x) + "</td>").join("");
    return "<tr>" + cells + "</tr>";
  }).join("");
  return "\uFEFF<html><head><meta charset=\"utf-8\"></head><body><table border=\"1\"><thead><tr><th>" +
    head.map(esc).join("</th><th>") + "</th></tr></thead><tbody>" + body + "</tbody></table></body></html>";
}

function publicCampaign(c) {
  if (!c) return null;
  return {
    id: c.id,
    name: c.name,
    subject: c.subject,
    message: c.message,
    ctaText: c.ctaText || "",
    ctaUrl: c.ctaUrl || "",
    createdBy: c.createdBy || "",
    createdAt: c.createdAt || null,
    sentAt: c.sentAt || null,
    recipientCount: c.recipientCount || 0,
    successCount: c.successCount || 0,
    failedCount: c.failedCount || 0,
    status: c.status || "draft",
  };
}

function createCampaign(db, body, createdBy) {
  ensureEngagement(db);
  const name = sanitizeText(body.name, 120);
  const subject = sanitizeText(body.subject, 200);
  const message = sanitizeText(body.message, 8000);
  if (!name || !subject || !message) return { ok: false, error: "missing_fields", status: 400 };
  const c = {
    id: "cmp_" + crypto.randomBytes(8).toString("hex"),
    name, subject, message,
    ctaText: sanitizeText(body.ctaText, 80) || "",
    ctaUrl: sanitizeText(body.ctaUrl, 500) || "",
    createdBy: sanitizeText(createdBy, 80) || "admin",
    createdAt: now(),
    sentAt: null,
    recipientCount: 0,
    successCount: 0,
    failedCount: 0,
    status: "draft",
    sendLock: false,
  };
  db.campaigns.unshift(c);
  return { ok: true, campaign: publicCampaign(c) };
}

function resolveCampaignRecipients(db, body) {
  const mode = String(body.mode || "active").toLowerCase();
  if (mode === "selected") {
    return filterSubscribers(db, { ids: body.ids || [], status: "active" });
  }
  if (mode === "filter") {
    return filterSubscribers(db, { q: body.q, status: body.status || "active" })
      .filter((s) => s.status === "active");
  }
  return filterSubscribers(db, { status: "active" });
}

function clampStars(n) {
  const v = parseInt(n, 10);
  if (!Number.isFinite(v)) return 0;
  return Math.max(1, Math.min(5, v));
}

function publicFeedback(f) {
  if (!f) return null;
  return {
    id: f.id,
    orderId: f.orderId,
    customerEmail: f.customerEmail || "",
    customerName: f.customerName || "",
    driverId: f.driverId || "",
    driverName: f.driverName || "",
    driverRating: f.driverRating || null,
    productRatings: Array.isArray(f.productRatings) ? f.productRatings : [],
    overallSatisfaction: f.overallSatisfaction || null,
    comment: f.comment || "",
    googleReviewClicked: !!f.googleReviewClicked,
    createdAt: f.createdAt || null,
    submittedAt: f.submittedAt || null,
    status: f.status || "pending",
  };
}

function createFeedbackInvite(db, order, pepper) {
  ensureEngagement(db);
  if (!order || !order.id) return null;
  const existing = (db.feedback || []).find((f) => f && f.orderId === order.id);
  if (existing) return existing;
  const raw = randomToken(24);
  const f = {
    id: "fb_" + crypto.randomBytes(8).toString("hex"),
    orderId: order.id,
    customerEmail: (order.customer && order.customer.email) || "",
    customerName: (order.customer && order.customer.name) || "",
    driverId: order.deliveredByDriverId || order.driverId || "",
    driverName: order.deliveredByDriverName || order.driverName || "",
    tokenHash: hashOpaque(raw, pepper),
    rawTokenHint: null,
    driverRating: null,
    productRatings: [],
    overallSatisfaction: null,
    comment: "",
    googleReviewClicked: false,
    createdAt: now(),
    submittedAt: null,
    status: "pending",
    _rawToken: raw,
  };
  db.feedback.unshift(f);
  return f;
}

function findFeedbackByToken(db, orderId, rawToken, pepper) {
  const f = (db.feedback || []).find((x) => x && x.orderId === orderId);
  if (!f || !f.tokenHash) return null;
  if (!verifyOpaque(rawToken, f.tokenHash, pepper)) return null;
  return f;
}

function submitFeedback(db, orderId, rawToken, pepper, body) {
  const f = findFeedbackByToken(db, orderId, rawToken, pepper);
  if (!f) return { ok: false, error: "invalid_token", status: 400 };
  if (f.status === "submitted") {
    if (body && body.googleReviewClicked) {
      f.googleReviewClicked = true;
      return { ok: true, feedback: publicFeedback(f), updated: true };
    }
    return { ok: false, error: "already_submitted", status: 409, feedback: publicFeedback(f) };
  }

  f.driverRating = clampStars(body.driverRating);
  f.overallSatisfaction = clampStars(body.overallSatisfaction);
  f.comment = sanitizeText(body.comment, 2000) || "";
  const ratings = Array.isArray(body.productRatings) ? body.productRatings : [];
  f.productRatings = ratings.slice(0, 40).map((r) => ({
    code: sanitizeText(r.code || r.name, 80),
    name: sanitizeText(r.name, 160),
    rating: clampStars(r.rating),
  })).filter((r) => r.code || r.name);
  f.googleReviewClicked = !!body.googleReviewClicked;
  f.submittedAt = now();
  f.status = "submitted";
  delete f._rawToken;
  return { ok: true, feedback: publicFeedback(f) };
}

function feedbackAnalytics(db) {
  ensureEngagement(db);
  const list = (db.feedback || []).filter((f) => f && f.status === "submitted");
  const avg = (arr) => {
    if (!arr.length) return null;
    const s = arr.reduce((a, b) => a + b, 0);
    return Math.round((s / arr.length) * 10) / 10;
  };
  const driverMap = {};
  const productMap = {};
  list.forEach((f) => {
    if (f.driverId || f.driverName) {
      const key = f.driverId || f.driverName;
      if (!driverMap[key]) driverMap[key] = { driverId: f.driverId || "", driverName: f.driverName || "", ratings: [], count: 0 };
      if (f.driverRating) { driverMap[key].ratings.push(f.driverRating); driverMap[key].count++; }
    }
    (f.productRatings || []).forEach((pr) => {
      const key = pr.code || pr.name;
      if (!key) return;
      if (!productMap[key]) productMap[key] = { code: pr.code || "", name: pr.name || "", ratings: [], count: 0 };
      if (pr.rating) { productMap[key].ratings.push(pr.rating); productMap[key].count++; }
    });
  });
  const drivers = Object.keys(driverMap).map((k) => {
    const d = driverMap[k];
    return { driverId: d.driverId, driverName: d.driverName, count: d.count, avgRating: avg(d.ratings) };
  }).sort((a, b) => (b.avgRating || 0) - (a.avgRating || 0));
  const products = Object.keys(productMap).map((k) => {
    const p = productMap[k];
    return { code: p.code, name: p.name, count: p.count, avgRating: avg(p.ratings) };
  }).sort((a, b) => (b.avgRating || 0) - (a.avgRating || 0));
  return {
    totalSubmitted: list.length,
    avgOverall: avg(list.map((f) => f.overallSatisfaction).filter(Boolean)),
    avgDriver: avg(list.map((f) => f.driverRating).filter(Boolean)),
    googleReviewClicks: list.filter((f) => f.googleReviewClicked).length,
    drivers,
    products,
    recent: list.slice(0, 50).map(publicFeedback),
  };
}

function driverPerformance(db) {
  ensureEngagement(db);
  const orders = db.orders || [];
  const drivers = db.drivers || [];
  const analytics = feedbackAnalytics(db);
  const byId = {};
  drivers.forEach((d) => {
    byId[d.id] = {
      id: d.id,
      name: d.name,
      email: d.email || "",
      active: d.active !== false,
      assigned: 0,
      delivered: 0,
      failed: 0,
      avgRating: null,
      ratingCount: 0,
    };
  });
  orders.forEach((o) => {
    const id = o.deliveredByDriverId || o.driverId;
    if (!id) return;
    if (!byId[id]) {
      byId[id] = {
        id,
        name: o.deliveredByDriverName || o.driverName || id,
        email: "",
        active: true,
        assigned: 0,
        delivered: 0,
        failed: 0,
        avgRating: null,
        ratingCount: 0,
      };
    }
    byId[id].assigned++;
    if (o.driverStatus === "delivered" || o.status === "delivered") byId[id].delivered++;
    if (o.driverStatus === "failed") byId[id].failed++;
  });
  analytics.drivers.forEach((d) => {
    const id = d.driverId;
    if (id && byId[id]) {
      byId[id].avgRating = d.avgRating;
      byId[id].ratingCount = d.count;
    } else if (d.driverName) {
      const hit = Object.keys(byId).map((k) => byId[k]).find((x) => x.name === d.driverName);
      if (hit) { hit.avgRating = d.avgRating; hit.ratingCount = d.count; }
    }
  });
  return Object.keys(byId).map((k) => byId[k]).sort((a, b) => (b.delivered || 0) - (a.delivered || 0));
}

module.exports = {
  ensureEngagement,
  normalizeEmail,
  isValidEmail,
  publicSubscriber,
  findSubscriberByEmail,
  subscribeEmail,
  unsubscribeByToken,
  setSubscriberStatus,
  filterSubscribers,
  issueUnsubscribeToken,
  csvSafeCell,
  subscribersToCsv,
  subscribersToXlsHtml,
  publicCampaign,
  createCampaign,
  resolveCampaignRecipients,
  createFeedbackInvite,
  findFeedbackByToken,
  submitFeedback,
  publicFeedback,
  feedbackAnalytics,
  driverPerformance,
};
