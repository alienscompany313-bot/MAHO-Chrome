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
};
