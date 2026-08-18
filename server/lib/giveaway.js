"use strict";
/**
 * Customer giveaway / raffle — secure server-side draw.
 * Additive storage: db.giveaways[]
 */
const crypto = require("crypto");
const { sanitizeText } = require("./security");

function now() { return Date.now(); }

function ensureGiveaways(data) {
  if (!data || typeof data !== "object") return false;
  if (!Array.isArray(data.giveaways)) { data.giveaways = []; return true; }
  return false;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  const e = normalizeEmail(email);
  if (!e || e.length > 200) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function publicGiveaway(g) {
  if (!g) return null;
  return {
    id: g.id,
    title: g.title,
    description: g.description || "",
    prize: g.prize || "",
    winnersCount: g.winnersCount || 1,
    drawDate: g.drawDate || null,
    eligibilityRule: g.eligibilityRule || "registered",
    eligibilityMeta: g.eligibilityMeta || {},
    internalNote: g.internalNote || "",
    status: g.status || "draft",
    createdBy: g.createdBy || "",
    createdAt: g.createdAt || null,
    drawnAt: g.drawnAt || null,
    drawnBy: g.drawnBy || null,
    participantCount: g.participantCount || 0,
    eligibleCount: g.eligibleCount || 0,
    excludedCount: g.excludedCount || 0,
    duplicatesRemoved: g.duplicatesRemoved || 0,
    winners: Array.isArray(g.winners) ? g.winners.map((w) => ({
      email: w.email,
      customerId: w.customerId || null,
      name: w.name || "",
      prize: w.prize || g.prize || "",
    })) : [],
    voidedAt: g.voidedAt || null,
    voidedBy: g.voidedBy || null,
    voidReason: g.voidReason || null,
  };
}

function createGiveaway(db, body, createdBy) {
  ensureGiveaways(db);
  const title = sanitizeText(body.title, 160);
  if (!title) return { ok: false, error: "missing_title", status: 400 };
  const winnersCount = Math.max(1, Math.min(100, parseInt(body.winnersCount, 10) || 1));
  const g = {
    id: "gw_" + crypto.randomBytes(8).toString("hex"),
    title,
    description: sanitizeText(body.description, 2000) || "",
    prize: sanitizeText(body.prize, 300) || "",
    winnersCount,
    drawDate: body.drawDate ? Number(body.drawDate) : null,
    eligibilityRule: sanitizeText(body.eligibilityRule || "registered", 60) || "registered",
    eligibilityMeta: body.eligibilityMeta && typeof body.eligibilityMeta === "object" ? body.eligibilityMeta : {},
    internalNote: sanitizeText(body.internalNote, 500) || "",
    status: "draft",
    createdBy: sanitizeText(createdBy, 80) || "admin",
    createdAt: now(),
    drawnAt: null,
    drawnBy: null,
    participantCount: 0,
    eligibleCount: 0,
    excludedCount: 0,
    duplicatesRemoved: 0,
    participants: [],
    winners: [],
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
  };
  db.giveaways.unshift(g);
  return { ok: true, giveaway: publicGiveaway(g) };
}

function securePick(arr, n) {
  const pool = arr.slice();
  const out = [];
  const take = Math.min(n, pool.length);
  for (let i = 0; i < take; i++) {
    const buf = crypto.randomBytes(4);
    const idx = buf.readUInt32BE(0) % pool.length;
    out.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return out;
}

function collectEligible(db, rule, meta) {
  const seen = new Set();
  const eligible = [];
  let excluded = 0;
  let duplicatesRemoved = 0;
  const add = (email, customerId, name) => {
    const e = normalizeEmail(email);
    if (!isValidEmail(e)) { excluded++; return; }
    if (seen.has(e)) { duplicatesRemoved++; return; }
    seen.add(e);
    eligible.push({ email: e, customerId: customerId || null, name: name || "" });
  };

  const users = (db.users || []).filter((u) => u && !u.deletedAt && u.status !== "deleted" && u.verified !== false);
  const subs = (db.subscribers || []).filter((s) => s && (s.status || "active") === "active");
  const orders = db.orders || [];
  const m = meta || {};

  if (rule === "newsletter") {
    subs.forEach((s) => add(s.email, null, ""));
  } else if (rule === "both") {
    users.forEach((u) => add(u.email, u.id, u.name));
    subs.forEach((s) => add(s.email, null, ""));
  } else if (rule === "purchased_range") {
    const from = Number(m.from) || 0;
    const to = Number(m.to) || now();
    const ids = new Set();
    orders.forEach((o) => {
      if (!o || !o.userId) return;
      const d = o.date || 0;
      if (d >= from && d <= to) ids.add(o.userId);
    });
    users.filter((u) => ids.has(u.id)).forEach((u) => add(u.email, u.id, u.name));
  } else if (rule === "delivered") {
    const ids = new Set();
    orders.forEach((o) => {
      if (!o || !o.userId) return;
      if (String(o.status || "").indexOf("delivered") >= 0 || o.driverStatus === "delivered") ids.add(o.userId);
    });
    users.filter((u) => ids.has(u.id)).forEach((u) => add(u.email, u.id, u.name));
  } else if (rule === "min_purchase") {
    const min = Number(m.minAmount) || 0;
    const spent = {};
    orders.forEach((o) => {
      if (!o || !o.userId) return;
      if (String(o.status) === "cancelled") return;
      spent[o.userId] = (spent[o.userId] || 0) + (Number(o.total) || 0);
    });
    users.filter((u) => (spent[u.id] || 0) >= min).forEach((u) => add(u.email, u.id, u.name));
  } else if (rule === "selected") {
    const emails = Array.isArray(m.emails) ? m.emails : [];
    const ids = Array.isArray(m.ids) ? m.ids : [];
    emails.forEach((em) => add(em, null, ""));
    users.filter((u) => ids.indexOf(u.id) >= 0).forEach((u) => add(u.email, u.id, u.name));
  } else {
    /* registered (default) */
    users.forEach((u) => add(u.email, u.id, u.name));
  }

  return { eligible, excluded, duplicatesRemoved };
}

function previewGiveaway(db, body) {
  ensureGiveaways(db);
  const rule = sanitizeText(body.eligibilityRule || "registered", 60) || "registered";
  const meta = body.eligibilityMeta || {};
  const { eligible, excluded, duplicatesRemoved } = collectEligible(db, rule, meta);
  return {
    ok: true,
    eligible: eligible.length,
    excluded,
    duplicatesRemoved,
    finalParticipants: eligible.length,
  };
}

function drawGiveaway(db, id, drawnBy) {
  ensureGiveaways(db);
  const g = (db.giveaways || []).find((x) => x && x.id === id);
  if (!g) return { ok: false, error: "not_found", status: 404 };
  if (g.status === "drawn") return { ok: false, error: "already_drawn", status: 409 };
  if (g.status === "voided") return { ok: false, error: "voided", status: 409 };

  const { eligible, excluded, duplicatesRemoved } = collectEligible(db, g.eligibilityRule, g.eligibilityMeta);
  if (!eligible.length) return { ok: false, error: "no_participants", status: 400 };

  const winners = securePick(eligible, g.winnersCount || 1).map((w) => ({
    email: w.email,
    customerId: w.customerId,
    name: w.name,
    prize: g.prize || "",
  }));

  g.participants = eligible;
  g.winners = winners;
  g.participantCount = eligible.length;
  g.eligibleCount = eligible.length;
  g.excludedCount = excluded;
  g.duplicatesRemoved = duplicatesRemoved;
  g.status = "drawn";
  g.drawnAt = now();
  g.drawnBy = sanitizeText(drawnBy, 80) || "admin";
  return { ok: true, giveaway: publicGiveaway(g) };
}

function voidGiveaway(db, id, reason, voidedBy) {
  const g = (db.giveaways || []).find((x) => x && x.id === id);
  if (!g) return { ok: false, error: "not_found", status: 404 };
  if (g.status === "voided") return { ok: false, error: "already_voided", status: 409 };
  const why = sanitizeText(reason, 500);
  if (!why) return { ok: false, error: "reason_required", status: 400 };
  g.status = "voided";
  g.voidedAt = now();
  g.voidedBy = sanitizeText(voidedBy, 80) || "admin";
  g.voidReason = why;
  return { ok: true, giveaway: publicGiveaway(g) };
}

function giveawaysToCsv(rows) {
  const header = ["id", "title", "prize", "status", "winnersCount", "participantCount", "drawnAt", "winners"];
  const lines = [header.join(",")];
  const cell = (v) => {
    let s = String(v == null ? "" : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  (rows || []).forEach((g) => {
    lines.push([
      g.id, g.title, g.prize, g.status, g.winnersCount, g.participantCount,
      g.drawnAt ? new Date(g.drawnAt).toISOString() : "",
      (g.winners || []).map((w) => w.email).join("; "),
    ].map(cell).join(","));
  });
  return "\uFEFF" + lines.join("\n");
}

module.exports = {
  ensureGiveaways,
  publicGiveaway,
  createGiveaway,
  previewGiveaway,
  drawGiveaway,
  voidGiveaway,
  giveawaysToCsv,
  collectEligible,
  securePick,
};
