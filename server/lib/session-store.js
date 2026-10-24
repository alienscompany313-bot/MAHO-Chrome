"use strict";
/**
 * Persistent session index. The raw bearer token stays only in process memory
 * and on the client. The file stores a hash, so a copied sessions file cannot
 * be replayed as Authorization headers.
 *
 * One Render instance with a persistent DATA_DIR keeps sessions across restarts.
 * Extra instances do not share this file unless they share that disk.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const USER_TTL = 14 * 24 * 60 * 60 * 1000;
const STAFF_TTL = 12 * 60 * 60 * 1000;

function hashToken(token, pepper) {
  return crypto.createHash("sha256").update(String(pepper || "") + ":" + String(token || "")).digest("hex");
}

function ttlFor(session) {
  const type = session && session.type;
  if (type === "user") return USER_TTL;
  return STAFF_TTL;
}

function open(file, pepper) {
  const byHash = new Map();
  let timer = null;

  function fresh(row) {
    if (!row) return null;
    if (row.exp && row.exp < Date.now()) return null;
    return row;
  }

  function load() {
    try {
      const raw = fs.readFileSync(file, "utf8");
      const parsed = JSON.parse(raw);
      const rows = Array.isArray(parsed && parsed.sessions) ? parsed.sessions : [];
      rows.forEach((row) => {
        if (!row || !row.hash || !fresh(row)) return;
        const copy = Object.assign({}, row);
        delete copy.hash;
        byHash.set(row.hash, copy);
      });
    } catch (_) {}
  }

  function saveNow() {
    const sessions = [];
    byHash.forEach((row, hash) => {
      if (!fresh(row)) return;
      sessions.push(Object.assign({ hash: hash }, row));
    });
    const dir = path.dirname(file);
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    const tmp = file + ".tmp";
    const body = JSON.stringify({ version: 1, savedAt: Date.now(), sessions: sessions });
    fs.writeFileSync(tmp, body);
    try { fs.renameSync(tmp, file); } catch (_) { fs.copyFileSync(tmp, file); try { fs.unlinkSync(tmp); } catch (__) {} }
  }

  function save() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      try { saveNow(); } catch (_) {}
    }, 30);
    if (timer.unref) timer.unref();
  }

  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    try { saveNow(); } catch (_) {}
  }

  load();

  return {
    set(token, session) {
      const row = Object.assign({}, session || {});
      const now = Date.now();
      if (!row.exp) row.exp = now + ttlFor(row);
      row.seenAt = now;
      byHash.set(hashToken(token, pepper), row);
      flush();
      return this;
    },
    get(token) {
      if (!token) return null;
      const direct = fresh(byHash.get(token));
      if (direct) return direct;
      const row = fresh(byHash.get(hashToken(token, pepper)));
      if (!row && byHash.has(hashToken(token, pepper))) byHash.delete(hashToken(token, pepper));
      return row || null;
    },
    delete(token) {
      const hashed = hashToken(token, pepper);
      const removed = byHash.delete(token) || byHash.delete(hashed);
      if (removed) flush();
      return removed;
    },
    has(token) {
      return !!this.get(token);
    },
    forEach(fn) {
      byHash.forEach((row, hash) => {
        if (fresh(row)) fn(row, hash);
      });
    },
    entries() {
      const list = [];
      this.forEach((row, hash) => list.push([hash, row]));
      return list[Symbol.iterator]();
    },
    flush: flush,
    file: file,
  };
}

module.exports = { open, hashToken, USER_TTL, STAFF_TTL };
