"use strict";
/**
 * Owner admin email 2FA.
 * A matching ADMIN_PASSWORD does not create a session.
 * The code is stored only as a hash, expires in 5 minutes, and is single-use.
 * Five wrong attempts kill the challenge. The caller must sign in again.
 */

const crypto = require("crypto");
const { hashOpaque, verifyOpaque, randomCode6, createRateLimiter, sanitizeText } = require("../security");

const rlSend = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 5 });
const rlVerify = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20 });
const rlPassword = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 12 });

function ensureSecurity(db) {
  if (!db.adminSecurity || typeof db.adminSecurity !== "object") {
    db.adminSecurity = { recoveryCodes: [], envRecoveryUsedHash: "" };
    return true;
  }
  if (!Array.isArray(db.adminSecurity.recoveryCodes)) db.adminSecurity.recoveryCodes = [];
  if (!Array.isArray(db.adminAuthChallenges)) db.adminAuthChallenges = [];
  return false;
}

function prune(db) {
  const now = Date.now();
  db.adminAuthChallenges = (db.adminAuthChallenges || []).filter((c) => c && c.exp > now && !c.used).slice(-40);
}

function destination(db) {
  const fromEnv = String(process.env.ADMIN_2FA_EMAIL || "").trim().toLowerCase();
  if (fromEnv) return fromEnv;
  const saved = db.adminSecurity && db.adminSecurity.email;
  return String(saved || "info@mahomarket.com").trim().toLowerCase();
}

function passwordAllowed(ip) {
  return rlPassword(String(ip || "unknown") + ":admin-pw");
}

function beginChallenge(db, { pepper, ip }) {
  ensureSecurity(db);
  const sendHit = rlSend(String(ip || "unknown") + ":admin-2fa-send");
  if (!sendHit.ok) return { error: "rate_limited", status: 429, retryAfterMs: sendHit.retryAfterMs };
  const code = randomCode6();
  const id = crypto.randomBytes(16).toString("hex");
  prune(db);
  db.adminAuthChallenges.push({
    id: id,
    codeHash: hashOpaque(code, pepper),
    exp: Date.now() + 5 * 60 * 1000,
    attempts: 0,
    resends: 0,
    used: false,
    ip: sanitizeText(ip, 80),
  });
  return { challengeId: id, code: code, email: destination(db) };
}

function resend(db, { pepper, ip, challengeId }) {
  ensureSecurity(db);
  const sendHit = rlSend(String(ip || "unknown") + ":admin-2fa-send");
  if (!sendHit.ok) return { error: "rate_limited", status: 429, retryAfterMs: sendHit.retryAfterMs };
  const row = (db.adminAuthChallenges || []).find((c) => c && c.id === challengeId);
  if (!row || row.used || row.exp < Date.now()) return { error: "expired", status: 400 };
  if ((row.attempts || 0) >= 5) return { error: "restart_verification", status: 429 };
  if ((row.resends || 0) >= 3) return { error: "rate_limited", status: 429 };
  const code = randomCode6();
  row.codeHash = hashOpaque(code, pepper);
  row.exp = Date.now() + 5 * 60 * 1000;
  row.attempts = 0;
  row.resends = (row.resends || 0) + 1;
  return { challengeId: row.id, code: code, email: destination(db) };
}

function burn(row) {
  row.used = true;
  row.codeHash = "";
}

function verifyCode(db, { pepper, ip, challengeId, code, recoveryCode }) {
  ensureSecurity(db);
  const hit = rlVerify(String(ip || "unknown") + ":admin-2fa-verify");
  if (!hit.ok) return { error: "rate_limited", status: 429, retryAfterMs: hit.retryAfterMs };
  const row = (db.adminAuthChallenges || []).find((c) => c && c.id === challengeId);
  if (!row || row.used || row.exp < Date.now()) return { error: "expired", status: 400 };
  if ((row.attempts || 0) >= 5) {
    burn(row);
    return { error: "restart_verification", status: 429 };
  }
  const recovery = String(recoveryCode || "");
  if (recovery) {
    const envCode = String(process.env.ADMIN_2FA_RECOVERY_CODE || "");
    if (envCode && envCode === recovery) {
      const usedHash = db.adminSecurity.envRecoveryUsedHash || "";
      const thisHash = hashOpaque(envCode, pepper);
      if (usedHash && usedHash === thisHash) return { error: "recovery_used", status: 400 };
      db.adminSecurity.envRecoveryUsedHash = thisHash;
      burn(row);
      return { ok: true, via: "env_recovery" };
    }
    const codes = db.adminSecurity.recoveryCodes || [];
    const match = codes.find((c) => c && !c.usedAt && verifyOpaque(recovery, c.hash, pepper));
    if (!match) {
      row.attempts = (row.attempts || 0) + 1;
      if (row.attempts >= 5) burn(row);
      return { error: row.attempts >= 5 ? "restart_verification" : "bad_code", status: row.attempts >= 5 ? 429 : 400 };
    }
    match.usedAt = Date.now();
    burn(row);
    return { ok: true, via: "recovery" };
  }
  const given = String(code || "").trim();
  if (!verifyOpaque(given, row.codeHash, pepper)) {
    row.attempts = (row.attempts || 0) + 1;
    if (row.attempts >= 5) {
      burn(row);
      return { error: "restart_verification", status: 429 };
    }
    return { error: "bad_code", status: 400, attemptsLeft: 5 - row.attempts };
  }
  burn(row);
  return { ok: true, via: "email" };
}

function issueRecoveryCodes(db, pepper) {
  ensureSecurity(db);
  const plain = [];
  const rows = [];
  for (let i = 0; i < 8; i++) {
    const code = crypto.randomBytes(5).toString("hex");
    plain.push(code);
    rows.push({ hash: hashOpaque(code, pepper), createdAt: Date.now(), usedAt: null });
  }
  db.adminSecurity.recoveryCodes = rows;
  return plain;
}

function publicSecurity(db) {
  ensureSecurity(db);
  const email = destination(db);
  const unused = (db.adminSecurity.recoveryCodes || []).filter((c) => c && !c.usedAt).length;
  return {
    email: email,
    emailLockedByEnv: !!String(process.env.ADMIN_2FA_EMAIL || "").trim(),
    recoveryCodesRemaining: unused,
  };
}

function setEmail(db, email) {
  ensureSecurity(db);
  if (String(process.env.ADMIN_2FA_EMAIL || "").trim()) return { error: "locked_by_env", status: 400 };
  const next = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) return { error: "bad_email", status: 400 };
  db.adminSecurity.email = next;
  return { email: next };
}

module.exports = {
  ensureSecurity,
  passwordAllowed,
  beginChallenge,
  resend,
  verifyCode,
  issueRecoveryCodes,
  publicSecurity,
  setEmail,
  destination,
};
