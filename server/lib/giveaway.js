"use strict";
/**
 * Customer giveaway / raffle — secure server-side draw + prize claim codes.
 * Additive storage: db.giveaways[]
 * Backward compatible with pre-claim giveaways (missing store/claim fields).
 */
const crypto = require("crypto");
const { sanitizeText } = require("./security");
const { resolvePickupStore } = require("./store-inventory");

function now() { return Date.now(); }

const CLAIM_STATUSES = ["unclaimed", "claimed", "expired", "voided"];

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

/** Unique non-guessable claim code: MAHO-GIVE-###### + random suffix */
function generateClaimCode(db) {
  ensureGiveaways(db);
  const used = new Set();
  (db.giveaways || []).forEach((g) => {
    (g.winners || []).forEach((w) => {
      if (w && w.claimCode) used.add(String(w.claimCode).toUpperCase());
    });
  });
  for (let i = 0; i < 40; i++) {
    const n = crypto.randomInt(100000, 1000000);
    const suf = crypto.randomBytes(2).toString("hex").toUpperCase();
    const code = "MAHO-GIVE-" + String(n).padStart(6, "0") + suf;
    if (!used.has(code)) return code;
  }
  return "MAHO-GIVE-" + crypto.randomBytes(6).toString("hex").toUpperCase();
}

function resolveClaimStatus(w, g) {
  if (!w) return null;
  if (w.claimStatus && CLAIM_STATUSES.indexOf(w.claimStatus) >= 0) {
    if (w.claimStatus === "unclaimed" && w.claimDeadline && Number(w.claimDeadline) < now()) {
      return "expired";
    }
    return w.claimStatus;
  }
  /* Legacy winners without claim fields */
  if (!w.claimCode) return null;
  if (w.claimedAt) return "claimed";
  if (w.claimDeadline && Number(w.claimDeadline) < now()) return "expired";
  return "unclaimed";
}

function publicWinner(w, g) {
  if (!w) return null;
  const status = resolveClaimStatus(w, g);
  return {
    email: w.email,
    customerId: w.customerId || null,
    name: w.name || "",
    prize: w.prize || (g && g.prize) || "",
    claimCode: w.claimCode || null,
    claimStatus: status,
    claimStoreId: w.claimStoreId || (g && g.claimStoreId) || null,
    claimStoreName: w.claimStoreName || (g && g.claimStoreName) || null,
    issuedAt: w.issuedAt || (g && g.drawnAt) || null,
    claimDeadline: w.claimDeadline != null ? w.claimDeadline : ((g && g.claimDeadline) || null),
    claimedAt: w.claimedAt || null,
    claimedBy: w.claimedBy || null,
  };
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
    claimStoreId: g.claimStoreId || null,
    claimStoreName: g.claimStoreName || null,
    claimDeadline: g.claimDeadline || null,
    winners: Array.isArray(g.winners) ? g.winners.map((w) => publicWinner(w, g)) : [],
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
  let claimStoreId = sanitizeText(body.claimStoreId || body.pickupStoreId || "", 80) || null;
  let claimStoreName = "";
  if (claimStoreId) {
    const store = resolvePickupStore(db, claimStoreId);
    if (!store) return { ok: false, error: "invalid_claim_store", status: 400 };
    claimStoreId = store.id;
    claimStoreName = store.name || "";
  }
  let claimDeadline = null;
  if (body.claimDeadline != null && body.claimDeadline !== "") {
    const d = Number(body.claimDeadline);
    if (!Number.isFinite(d) || d <= 0) return { ok: false, error: "invalid_claim_deadline", status: 400 };
    claimDeadline = d;
  }
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
    claimStoreId,
    claimStoreName,
    claimDeadline,
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
  };
  db.giveaways.unshift(g);
  return { ok: true, giveaway: publicGiveaway(g) };
}

/** Unbiased index in [0, max) via rejection sampling (no modulo bias). */
function secureIndex(max) {
  if (max <= 1) return 0;
  const limit = Math.floor(0x100000000 / max) * max;
  let x;
  do {
    x = crypto.randomBytes(4).readUInt32BE(0);
  } while (x >= limit);
  return x % max;
}

function securePick(arr, n) {
  const pool = arr.slice();
  const out = [];
  const take = Math.min(n, pool.length);
  for (let i = 0; i < take; i++) {
    const idx = secureIndex(pool.length);
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

  /* Prefer store selected at create; allow late bind via body override is not used here */
  let store = g.claimStoreId ? resolvePickupStore(db, g.claimStoreId) : null;
  if (!store && Array.isArray(db.stores) && db.stores.length) {
    store = resolvePickupStore(db, db.stores[0].id || "store_0");
  }
  if (store) {
    g.claimStoreId = store.id;
    g.claimStoreName = store.name || "";
  }

  const issuedAt = now();
  const usedCodes = new Set();
  (db.giveaways || []).forEach((gg) => {
    (gg.winners || []).forEach((ww) => {
      if (ww && ww.claimCode) usedCodes.add(String(ww.claimCode).toUpperCase());
    });
  });
  function nextCode() {
    for (let i = 0; i < 40; i++) {
      const n = crypto.randomInt(100000, 1000000);
      const suf = crypto.randomBytes(2).toString("hex").toUpperCase();
      const code = "MAHO-GIVE-" + String(n).padStart(6, "0") + suf;
      if (!usedCodes.has(code)) {
        usedCodes.add(code);
        return code;
      }
    }
    const fallback = "MAHO-GIVE-" + crypto.randomBytes(6).toString("hex").toUpperCase();
    usedCodes.add(fallback);
    return fallback;
  }
  const winners = securePick(eligible, g.winnersCount || 1).map((w) => ({
    email: w.email,
    customerId: w.customerId,
    name: w.name,
    prize: g.prize || "",
    claimCode: nextCode(),
    claimStatus: "unclaimed",
    claimStoreId: g.claimStoreId || null,
    claimStoreName: g.claimStoreName || null,
    issuedAt,
    claimDeadline: g.claimDeadline || null,
    claimedAt: null,
    claimedBy: null,
  }));

  g.participants = eligible;
  g.winners = winners;
  g.participantCount = eligible.length;
  g.eligibleCount = eligible.length;
  g.excludedCount = excluded;
  g.duplicatesRemoved = duplicatesRemoved;
  g.status = "drawn";
  g.drawnAt = issuedAt;
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
  (g.winners || []).forEach((w) => {
    if (w && w.claimStatus === "unclaimed") w.claimStatus = "voided";
  });
  return { ok: true, giveaway: publicGiveaway(g) };
}

function findWinnerByClaimCode(db, claimCode) {
  const code = String(claimCode || "").trim().toUpperCase();
  if (!code) return null;
  for (const g of db.giveaways || []) {
    if (!g || !Array.isArray(g.winners)) continue;
    for (const w of g.winners) {
      if (w && String(w.claimCode || "").toUpperCase() === code) {
        return { giveaway: g, winner: w };
      }
    }
  }
  return null;
}

function lookupClaim(db, claimCode) {
  const hit = findWinnerByClaimCode(db, claimCode);
  if (!hit) return { ok: false, error: "not_found", status: 404 };
  const st = resolveClaimStatus(hit.winner, hit.giveaway);
  if (st === "expired" && hit.winner.claimStatus === "unclaimed") {
    hit.winner.claimStatus = "expired";
  }
  return {
    ok: true,
    claim: {
      claimCode: hit.winner.claimCode,
      claimStatus: st,
      winnerName: hit.winner.name || "",
      winnerEmail: hit.winner.email,
      prize: hit.winner.prize || hit.giveaway.prize || "",
      giveawayId: hit.giveaway.id,
      giveawayTitle: hit.giveaway.title,
      claimStoreId: hit.winner.claimStoreId || hit.giveaway.claimStoreId || null,
      claimStoreName: hit.winner.claimStoreName || hit.giveaway.claimStoreName || null,
      claimDeadline: hit.winner.claimDeadline != null ? hit.winner.claimDeadline : hit.giveaway.claimDeadline,
      issuedAt: hit.winner.issuedAt || hit.giveaway.drawnAt,
      claimedAt: hit.winner.claimedAt || null,
      claimedBy: hit.winner.claimedBy || null,
      drawnAt: hit.giveaway.drawnAt || null,
    },
  };
}

function redeemClaim(db, claimCode, actor) {
  const hit = findWinnerByClaimCode(db, claimCode);
  if (!hit) return { ok: false, error: "not_found", status: 404 };
  const { giveaway: g, winner: w } = hit;
  if (g.status === "voided" || w.claimStatus === "voided") {
    return { ok: false, error: "voided", status: 409, message: "این کد باطل شده است." };
  }
  const st = resolveClaimStatus(w, g);
  if (st === "claimed" || w.claimedAt) {
    return {
      ok: false,
      error: "already_claimed",
      status: 409,
      message: "این جایزه قبلاً تحویل داده شده است.",
      claim: lookupClaim(db, claimCode).claim,
    };
  }
  if (st === "expired") {
    w.claimStatus = "expired";
    return { ok: false, error: "expired", status: 409, message: "مهلت دریافت جایزه به پایان رسیده است." };
  }
  if (!w.claimCode) {
    return { ok: false, error: "legacy_no_code", status: 400, message: "این برنده کد دریافت ندارد." };
  }
  w.claimStatus = "claimed";
  w.claimedAt = now();
  w.claimedBy = sanitizeText(actor, 80) || "admin";
  return {
    ok: true,
    claim: lookupClaim(db, w.claimCode).claim,
    giveaway: publicGiveaway(g),
  };
}

function voidClaim(db, claimCode, reason, actor) {
  const hit = findWinnerByClaimCode(db, claimCode);
  if (!hit) return { ok: false, error: "not_found", status: 404 };
  const w = hit.winner;
  if (w.claimStatus === "claimed") {
    return { ok: false, error: "already_claimed", status: 409 };
  }
  w.claimStatus = "voided";
  w.voidReason = sanitizeText(reason, 300) || "";
  w.voidedAt = now();
  w.voidedBy = sanitizeText(actor, 80) || "admin";
  return { ok: true, claim: lookupClaim(db, w.claimCode).claim };
}

function winnerEmailPayload(db, g, w) {
  const storeId = w.claimStoreId || g.claimStoreId;
  const store = storeId ? resolvePickupStore(db, storeId) : (resolvePickupStore(db, null));
  const cfg = db.config || {};
  const content = cfg.content || {};
  const officialWa = String(
    cfg.officialWhatsAppNumber || cfg.whatsapp || content.officialWhatsAppNumber || content.footerPhone || ""
  ).trim();
  const storeWa = store && (store.whatsapp || store.phone) ? String(store.whatsapp || store.phone).trim() : "";
  return {
    name: w.name || "",
    title: g.title || "",
    prize: w.prize || g.prize || "",
    claimCode: w.claimCode || "",
    claimDeadline: w.claimDeadline != null ? w.claimDeadline : g.claimDeadline,
    store: store ? {
      name: store.name || "",
      address: store.address || "",
      phone: store.phone || "",
      hours: store.hours || "",
      mapsUrl: store.mapsUrl || "",
    } : null,
    whatsapp: officialWa || storeWa || "",
    whatsappLabel: "واتسپ MAHO",
  };
}

function giveawaysToCsv(rows) {
  const header = [
    "id", "title", "prize", "status", "winnersCount", "participantCount", "drawnAt",
    "claimStore", "winnerEmail", "claimCode", "claimStatus", "claimDeadline", "claimedAt",
  ];
  const lines = [header.join(",")];
  const cell = (v) => {
    let s = String(v == null ? "" : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  (rows || []).forEach((g) => {
    const winners = (g.winners || []).length ? g.winners : [null];
    winners.forEach((w) => {
      lines.push([
        g.id, g.title, g.prize, g.status, g.winnersCount, g.participantCount,
        g.drawnAt ? new Date(g.drawnAt).toISOString() : "",
        g.claimStoreName || "",
        w ? w.email : "",
        w ? (w.claimCode || "") : "",
        w ? (w.claimStatus || "") : "",
        w && w.claimDeadline ? new Date(w.claimDeadline).toISOString() : "",
        w && w.claimedAt ? new Date(w.claimedAt).toISOString() : "",
      ].map(cell).join(","));
    });
  });
  return "\uFEFF" + lines.join("\n");
}

module.exports = {
  ensureGiveaways,
  publicGiveaway,
  publicWinner,
  createGiveaway,
  previewGiveaway,
  drawGiveaway,
  voidGiveaway,
  giveawaysToCsv,
  collectEligible,
  securePick,
  generateClaimCode,
  lookupClaim,
  redeemClaim,
  voidClaim,
  winnerEmailPayload,
  resolveClaimStatus,
  CLAIM_STATUSES,
};
