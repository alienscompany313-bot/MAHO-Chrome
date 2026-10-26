"use strict";

const crypto = require("crypto");
const { hashOpaque } = require("../security");

const DELETE_TTL = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_MS = 60 * 1000;

function stateOf(user) {
  if (!user) return "missing";
  if (user.deletedAt || user.accountStatus === "deleted" || user.status === "deleted") return "deleted";
  if (user.accountStatus === "blocked" || user.blocked === true) return "blocked";
  if (user.accountStatus === "hold" || user.onHold === true) return "hold";
  if (user.accountStatus === "deactivated" || user.deactivatedAt) return "deactivated";
  return "active";
}

function canShop(user) {
  return stateOf(user) === "active";
}

function recordEvent(user, status, reason, actor) {
  user.statusEvents = Array.isArray(user.statusEvents) ? user.statusEvents : [];
  user.statusEvents.push({
    status: status,
    reason: String(reason || "").slice(0, 240),
    actor: String(actor || "system").slice(0, 80),
    at: Date.now(),
  });
  if (user.statusEvents.length > 40) user.statusEvents = user.statusEvents.slice(-40);
}

function applyStatus(user, status, reason, actor) {
  const allowed = ["active", "deactivated", "hold", "blocked"];
  if (allowed.indexOf(status) < 0) return { error: "bad_status", status: 400 };
  if (stateOf(user) === "deleted") return { error: "account_deleted", status: 409 };
  user.accountStatus = status;
  user.blocked = status === "blocked";
  user.onHold = status === "hold";
  if (status === "deactivated") user.deactivatedAt = user.deactivatedAt || Date.now();
  if (status === "active") {
    user.deactivatedAt = null;
    user.blocked = false;
    user.onHold = false;
  }
  if (user.card && (status === "blocked" || status === "deactivated")) {
    if (user.card.status === "active") user.card.status = "inactive";
    user.card.updatedAt = Date.now();
  }
  if (user.card && status === "active" && user.card.status === "inactive") {
    user.card.status = "active";
    user.card.updatedAt = Date.now();
  }
  recordEvent(user, status, reason, actor);
  return { ok: true, accountStatus: stateOf(user) };
}

function deactivate(user) {
  return applyStatus(user, "deactivated", "customer_request", "customer");
}

function reactivate(user) {
  if (stateOf(user) === "blocked" || stateOf(user) === "hold") {
    return { error: "admin_restriction", status: 403 };
  }
  return applyStatus(user, "active", "customer_reactivate", "customer");
}

function beginDeletion(user, pepper, allowDev) {
  if (stateOf(user) === "deleted") return { error: "account_deleted", status: 409 };
  if (!user.email) return { error: "no_email", status: 400 };
  const prev = user.deletion || {};
  if (prev.sentAt && Date.now() - prev.sentAt < RESEND_MS && prev.exp > Date.now()) {
    return { error: "resend_cooldown", status: 429, retryAt: prev.sentAt + RESEND_MS };
  }
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  user.deletion = {
    hash: hashOpaque(code + ":" + user.id + ":" + String(user.email).toLowerCase(), pepper),
    exp: Date.now() + DELETE_TTL,
    attempts: 0,
    sentAt: Date.now(),
    email: String(user.email).toLowerCase(),
  };
  const out = { ok: true, expiresInSec: 600, code: code };
  if (allowDev) out.devCode = code;
  return out;
}

function confirmDeletion(user, code, confirm, pepper) {
  if (stateOf(user) === "deleted") return { error: "account_deleted", status: 409 };
  if (confirm !== "DELETE") return { error: "confirm_required", status: 400 };
  const row = user.deletion;
  if (!row || !row.hash) return { error: "code_not_sent", status: 400 };
  if (row.exp < Date.now()) return { error: "code_expired", status: 400 };
  if ((row.attempts || 0) >= MAX_ATTEMPTS) return { error: "too_many_attempts", status: 429 };
  const hash = hashOpaque(String(code || "") + ":" + user.id + ":" + String(row.email || ""), pepper);
  if (hash !== row.hash) {
    row.attempts = (row.attempts || 0) + 1;
    return { error: "bad_code", status: 400, attemptsLeft: Math.max(0, MAX_ATTEMPTS - row.attempts) };
  }
  return { ok: true };
}

function anonymize(user) {
  const id = user.id;
  user.accountStatus = "deleted";
  user.status = "deleted";
  user.deletedAt = Date.now();
  user.blocked = true;
  user.name = "Deleted customer";
  user.phone = "";
  user.address = "";
  user.addr = {};
  user.email = "deleted+" + id + "@deleted.maho.invalid";
  user.pass = "deleted:" + crypto.randomBytes(16).toString("hex");
  user.passkeys = [];
  user.payments = [];
  if (user.card) {
    user.card.status = "revoked";
    user.card.updatedAt = Date.now();
  }
  user.deletion = null;
  recordEvent(user, "deleted", "verified_email_code", "customer");
}

function queueStatusMail(user, kind, reason) {
  user.mailQueue = Array.isArray(user.mailQueue) ? user.mailQueue : [];
  const row = {
    id: "mq_" + Date.now().toString(36) + "_" + user.mailQueue.length,
    kind: kind,
    status: "queued",
    to: user.email || "",
    appeal: "support@mahomarket.com",
    reason: String(reason || user.blockReason || "").slice(0, 240),
    at: Date.now(),
  };
  user.mailQueue.push(row);
  if (user.mailQueue.length > 20) user.mailQueue = user.mailQueue.slice(-20);
  return row;
}

function rememberReason(user, publicReason, internalNote) {
  user.blockReason = String(publicReason || "").trim().slice(0, 240);
  user.blockNote = String(internalNote || "").trim().slice(0, 240);
  return { reason: user.blockReason, note: user.blockNote };
}

function publicSchedule(user) {
  const sch = user && user.blockSchedule;
  if (!sch) return null;
  return {
    startAt: sch.startAt || null,
    endAt: sch.endAt || null,
    publicReason: sch.publicReason || "",
    timezone: "Asia/Kabul",
    cancelled: !!sch.cancelled,
    completed: !!sch.completed,
  };
}

function applySchedule(user, now) {
  if (!user) return { state: "missing", changed: false };
  const sch = user.blockSchedule;
  if (!sch || sch.cancelled || sch.completed) return { state: stateOf(user), changed: false };
  const t = typeof now === "number" ? now : Date.now();
  if (sch.endAt && t >= Number(sch.endAt)) {
    let changed = false;
    if (user.blockedBySchedule && stateOf(user) === "blocked") {
      applyStatus(user, "active", "schedule_ended", "system");
      user.blockedBySchedule = false;
      user.blockReason = "";
      if (!sch.reinstatedMailed) {
        queueStatusMail(user, "reinstated", sch.publicReason);
        sch.reinstatedMailed = true;
      }
      changed = true;
    }
    sch.completed = true;
    return { state: stateOf(user), changed: true };
  }
  if (t >= Number(sch.startAt || 0) && stateOf(user) !== "deleted" && stateOf(user) !== "blocked") {
    applyStatus(user, "blocked", sch.publicReason || "blocked", sch.actor || "schedule");
    user.blockedBySchedule = true;
    user.blockReason = String(sch.publicReason || "").slice(0, 240);
    user.blockNote = String(sch.internalNote || "").slice(0, 240);
    if (!sch.blockMailed) {
      queueStatusMail(user, "blocked", sch.publicReason);
      sch.blockMailed = true;
    }
    return { state: "blocked", changed: true };
  }
  return { state: stateOf(user), changed: false };
}

function scheduleBlock(user, input, actor) {
  if (stateOf(user) === "deleted") return { error: "account_deleted", status: 409 };
  const startAt = Number(input && input.startAt);
  const endAt = input && input.endAt ? Number(input.endAt) : null;
  if (!Number.isFinite(startAt) || startAt <= 0) return { error: "bad_start", status: 400 };
  if (endAt && (!Number.isFinite(endAt) || endAt <= startAt)) return { error: "bad_end", status: 400 };
  const publicReason = String((input && input.publicReason) || "").trim().slice(0, 240);
  if (!publicReason) return { error: "reason_required", status: 400 };
  user.blockSchedule = {
    startAt: startAt,
    endAt: endAt,
    publicReason: publicReason,
    internalNote: String((input && input.internalNote) || "").slice(0, 240),
    actor: String(actor || "admin").slice(0, 80),
    at: Date.now(),
    cancelled: false,
    completed: false,
    blockMailed: false,
    reinstatedMailed: false,
  };
  rememberReason(user, publicReason, user.blockSchedule.internalNote);
  const applied = applySchedule(user, Date.now());
  return {
    ok: true,
    accountStatus: applied.state,
    schedule: publicSchedule(user),
    mail: (user.mailQueue || []).slice(-1)[0] || null,
  };
}

function cancelSchedule(user, actor) {
  const sch = user && user.blockSchedule;
  if (!sch || sch.completed) return { error: "no_schedule", status: 404 };
  sch.cancelled = true;
  let mail = null;
  if (user.blockedBySchedule && stateOf(user) === "blocked") {
    applyStatus(user, "active", "schedule_cancelled", actor || "admin");
    user.blockedBySchedule = false;
    user.blockReason = "";
    if (!sch.reinstatedMailed) {
      mail = queueStatusMail(user, "reinstated", sch.publicReason);
      sch.reinstatedMailed = true;
    }
  }
  return { ok: true, accountStatus: stateOf(user), schedule: publicSchedule(user), mail: mail };
}

function revokeSessions(sessions, userId) {
  if (!sessions || typeof sessions.forEach !== "function") return 0;
  const drop = [];
  sessions.forEach((row, key) => {
    if (row && row.type === "user" && row.userId === userId) drop.push(key);
  });
  drop.forEach((key) => sessions.delete(key));
  return drop.length;
}

module.exports = {
  stateOf,
  canShop,
  applyStatus,
  deactivate,
  reactivate,
  beginDeletion,
  confirmDeletion,
  anonymize,
  revokeSessions,
  queueStatusMail,
  rememberReason,
  publicSchedule,
  applySchedule,
  scheduleBlock,
  cancelSchedule,
};
