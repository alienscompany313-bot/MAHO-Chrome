"use strict";
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const BCRYPT_ROUNDS = 12;

function hashPassword(pw) {
  return bcrypt.hashSync(String(pw), BCRYPT_ROUNDS);
}

function verifyPassword(pw, stored) {
  const s = String(stored || "");
  if (s.startsWith("$2a$") || s.startsWith("$2b$") || s.startsWith("$2y$")) {
    try { return bcrypt.compareSync(String(pw), s); } catch (_) { return false; }
  }
  /* Legacy scrypt salt:hash — keep verifying existing users */
  try {
    const [salt, h] = s.split(":");
    if (!salt || !h) return false;
    const next = crypto.scryptSync(String(pw), salt, 32).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(next, "hex"), Buffer.from(h, "hex"));
  } catch (_) { return false; }
}

function needsPasswordRehash(stored) {
  const s = String(stored || "");
  return !(s.startsWith("$2a$") || s.startsWith("$2b$") || s.startsWith("$2y$"));
}

function hashOpaque(value, pepper) {
  return crypto.createHash("sha256").update(String(pepper || "") + ":" + String(value || "")).digest("hex");
}

function verifyOpaque(value, hash, pepper) {
  if (!hash) return false;
  const next = hashOpaque(value, pepper);
  try {
    return crypto.timingSafeEqual(Buffer.from(next, "hex"), Buffer.from(String(hash), "hex"));
  } catch (_) { return false; }
}

function randomCode6() {
  return String(crypto.randomInt(100000, 1000000));
}

function randomToken(bytes) {
  return crypto.randomBytes(bytes || 32).toString("hex");
}

function sessionToken() {
  return crypto.randomBytes(24).toString("hex");
}

/** Simple sliding-window rate limiter (in-memory). */
function createRateLimiter({ windowMs, max }) {
  const hits = new Map();
  function prune(now) {
    hits.forEach((arr, key) => {
      const next = arr.filter((t) => now - t < windowMs);
      if (next.length) hits.set(key, next);
      else hits.delete(key);
    });
  }
  return function check(key) {
    const now = Date.now();
    if (hits.size > 5000) prune(now);
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      hits.set(key, arr);
      return { ok: false, retryAfterMs: windowMs - (now - arr[0]) };
    }
    arr.push(now);
    hits.set(key, arr);
    return { ok: true, remaining: max - arr.length };
  };
}

function clientIp(req) {
  const xf = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return xf || req.socket.remoteAddress || "unknown";
}

function sanitizeText(s, max) {
  return String(s == null ? "" : s)
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim()
    .slice(0, max || 2000);
}

module.exports = {
  hashPassword,
  verifyPassword,
  needsPasswordRehash,
  hashOpaque,
  verifyOpaque,
  randomCode6,
  randomToken,
  sessionToken,
  createRateLimiter,
  clientIp,
  sanitizeText,
  BCRYPT_ROUNDS,
};
