"use strict";
/**
 * Optional WebAuthn passkeys. The server stores only the public key and a counter.
 * Face ID / Windows Hello templates stay on the device.
 */

const crypto = require("crypto");
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");
const { isoBase64URL } = require("@simplewebauthn/server/helpers");

function ensurePasskeys(db) {
  if (!Array.isArray(db.webauthnChallenges)) db.webauthnChallenges = [];
}

function prune(db) {
  const now = Date.now();
  db.webauthnChallenges = (db.webauthnChallenges || []).filter((c) => c && c.exp > now).slice(-100);
}

function saveChallenge(db, row) {
  ensurePasskeys(db);
  prune(db);
  db.webauthnChallenges.push(row);
}

function takeChallenge(db, id) {
  ensurePasskeys(db);
  const idx = (db.webauthnChallenges || []).findIndex((c) => c && c.id === id);
  if (idx < 0) return null;
  const row = db.webauthnChallenges[idx];
  db.webauthnChallenges.splice(idx, 1);
  if (row.exp < Date.now()) return null;
  return row;
}

function rpIDFrom(req, siteUrl) {
  const env = String(process.env.WEBAUTHN_RP_ID || "").trim();
  if (env) return env;
  try {
    if (siteUrl) {
      const host = new URL(siteUrl).hostname;
      if (host && host !== "localhost") return host;
    }
  } catch (_) {}
  const host = String((req.headers && req.headers.host) || "localhost").split(":")[0];
  return host || "localhost";
}

function originsFor(req, siteUrl) {
  const list = [];
  const extra = String(process.env.WEBAUTHN_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  extra.forEach((o) => list.push(o));
  if (siteUrl) list.push(String(siteUrl).replace(/\/+$/, ""));
  const host = String((req.headers && req.headers.host) || "");
  if (host) {
    const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() || "http";
    list.push(proto + "://" + host);
  }
  const origin = String((req.headers && req.headers.origin) || "").trim();
  if (origin) list.push(origin.replace(/\/+$/, ""));
  list.push("http://localhost:4000");
  return Array.from(new Set(list));
}

function publicPasskey(row) {
  if (!row) return null;
  return {
    id: row.id,
    deviceName: row.deviceName || "Passkey",
    createdAt: row.createdAt || null,
    transports: row.transports || [],
  };
}

async function registrationOptions(db, user, req, siteUrl) {
  const rpID = rpIDFrom(req, siteUrl);
  const options = await generateRegistrationOptions({
    rpName: "MAHO Market",
    rpID: rpID,
    userID: Buffer.from(String(user.id), "utf8"),
    userName: user.email || user.customerNo || user.id,
    userDisplayName: user.name || "MAHO customer",
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
    excludeCredentials: (user.passkeys || []).map((p) => ({
      id: p.id,
      transports: p.transports,
    })),
  });
  const challengeId = crypto.randomBytes(16).toString("hex");
  saveChallenge(db, {
    id: challengeId,
    userId: user.id,
    challenge: options.challenge,
    exp: Date.now() + 5 * 60 * 1000,
    type: "register",
  });
  return { options: options, challengeId: challengeId };
}

async function registrationVerify(db, user, body, req, siteUrl) {
  const pending = takeChallenge(db, body && body.challengeId);
  if (!pending || pending.type !== "register" || pending.userId !== user.id) {
    return { error: "expired", status: 400 };
  }
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.credential,
      expectedChallenge: pending.challenge,
      expectedOrigin: originsFor(req, siteUrl),
      expectedRPID: rpIDFrom(req, siteUrl),
      requireUserVerification: true,
    });
  } catch (err) {
    return { error: "verification_failed", status: 400, message: String(err && err.message || err).slice(0, 160) };
  }
  if (!verification.verified || !verification.registrationInfo) return { error: "verification_failed", status: 400 };
  const cred = verification.registrationInfo.credential;
  user.passkeys = user.passkeys || [];
  if (user.passkeys.some((p) => p.id === cred.id)) return { error: "exists", status: 409 };
  user.passkeys.push({
    id: cred.id,
    publicKey: isoBase64URL.fromBuffer(cred.publicKey),
    counter: cred.counter || 0,
    transports: cred.transports || (body.credential && body.credential.response && body.credential.response.transports) || [],
    deviceName: String((body && body.deviceName) || "Passkey").replace(/[<>]/g, "").slice(0, 60),
    createdAt: Date.now(),
  });
  return { passkeys: user.passkeys.map(publicPasskey) };
}

async function loginOptions(db, req, siteUrl) {
  const options = await generateAuthenticationOptions({
    rpID: rpIDFrom(req, siteUrl),
    userVerification: "preferred",
  });
  const challengeId = crypto.randomBytes(16).toString("hex");
  saveChallenge(db, {
    id: challengeId,
    userId: null,
    challenge: options.challenge,
    exp: Date.now() + 5 * 60 * 1000,
    type: "login",
  });
  return { options: options, challengeId: challengeId };
}

function findCredential(db, id) {
  const users = db.users || [];
  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    const hit = (u && u.passkeys || []).find((p) => p && p.id === id);
    if (hit) return { user: u, cred: hit };
  }
  return null;
}

async function loginVerify(db, body, req, siteUrl) {
  const pending = takeChallenge(db, body && body.challengeId);
  if (!pending || pending.type !== "login") return { error: "expired", status: 400 };
  const credId = body && body.credential && (body.credential.id || body.credential.rawId);
  const found = findCredential(db, credId);
  if (!found) return { error: "unknown_credential", status: 400 };
  const u = found.user;
  const life = require("./account-life");
  const applied = life.applySchedule(u, Date.now());
  const account = applied.state;
  if (account === "deleted") return { error: "account_deleted", status: 403, changed: applied.changed };
  if (account === "blocked" || account === "hold" || account === "deactivated") {
    return { error: "account_" + account, status: 403, reason: u.blockReason || "", changed: applied.changed };
  }
  if (u.verified === false || u.status === "pending") return { error: "unverified", status: 403 };
  const handle = body && body.credential && body.credential.response && body.credential.response.userHandle;
  if (handle) {
    try {
      const raw = isoBase64URL.toBuffer(handle).toString("utf8");
      if (raw && raw !== String(u.id)) return { error: "user_mismatch", status: 400 };
    } catch (_) {}
  }
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body.credential,
      expectedChallenge: pending.challenge,
      expectedOrigin: originsFor(req, siteUrl),
      expectedRPID: rpIDFrom(req, siteUrl),
      requireUserVerification: true,
      credential: {
        id: found.cred.id,
        publicKey: isoBase64URL.toBuffer(found.cred.publicKey),
        counter: found.cred.counter || 0,
        transports: found.cred.transports,
      },
    });
  } catch (err) {
    return { error: "verification_failed", status: 400 };
  }
  if (!verification.verified) return { error: "verification_failed", status: 400 };
  found.cred.counter = verification.authenticationInfo.newCounter;
  return { user: u };
}

function removePasskey(user, id) {
  const before = (user.passkeys || []).length;
  user.passkeys = (user.passkeys || []).filter((p) => p && p.id !== id);
  return user.passkeys.length !== before;
}

module.exports = {
  ensurePasskeys,
  publicPasskey,
  registrationOptions,
  registrationVerify,
  loginOptions,
  loginVerify,
  removePasskey,
};
