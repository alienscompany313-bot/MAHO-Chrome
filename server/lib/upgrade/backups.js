"use strict";
/**
 * Encrypted local backups of db.json and uploads.
 *
 * This does not call a paid storage service. Set BACKUP_DIR to a folder that
 * survives instance loss (a second disk, or a directory the owner copies
 * off the server). Set BACKUP_ENCRYPTION_KEY to a long secret that is NOT
 * stored in git. Without those two variables, automatic backup stays off.
 *
 * Restore only into an explicit empty directory. The script refuses to write
 * over the live DATA_DIR unless RESTORE_I_UNDERSTAND=yes is set, and even
 * then the operator must pass the target path.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function keyFromEnv(secret) {
  const raw = String(secret || "");
  if (!raw) return null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

function walk(dir, base, out) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir, { withFileTypes: true }).forEach((ent) => {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(abs, base, out);
    else if (ent.isFile()) out.push({ abs: abs, rel: path.relative(base, abs).split(path.sep).join("/") });
  });
}

function pack(files) {
  const parts = [];
  files.forEach((f) => {
    const body = fs.readFileSync(f.abs);
    const name = Buffer.from(f.rel, "utf8");
    const head = Buffer.alloc(4 + name.length + 8);
    head.writeUInt32BE(name.length, 0);
    name.copy(head, 4);
    head.writeBigUInt64BE(BigInt(body.length), 4 + name.length);
    parts.push(head, body);
  });
  return Buffer.concat(parts);
}

function unpack(buf) {
  const files = [];
  let o = 0;
  while (o + 4 < buf.length) {
    const nameLen = buf.readUInt32BE(o);
    o += 4;
    if (nameLen < 1 || nameLen > 500 || o + nameLen + 8 > buf.length) break;
    const rel = buf.slice(o, o + nameLen).toString("utf8");
    o += nameLen;
    const size = Number(buf.readBigUInt64BE(o));
    o += 8;
    if (size < 0 || o + size > buf.length) break;
    files.push({ rel: rel, body: buf.slice(o, o + size) });
    o += size;
  }
  return files;
}

function encrypt(plain, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from("MAHOBAK1"), iv, tag, enc]);
}

function decrypt(blob, key) {
  if (!blob || blob.slice(0, 8).toString() !== "MAHOBAK1") throw new Error("bad_backup_header");
  const iv = blob.slice(8, 20);
  const tag = blob.slice(20, 36);
  const enc = blob.slice(36);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}

function createBackup({ dataDir, uploadDir, backupDir, secret }) {
  const key = keyFromEnv(secret);
  if (!key) return { ok: false, error: "missing_key" };
  if (!backupDir) return { ok: false, error: "missing_dir" };
  fs.mkdirSync(backupDir, { recursive: true });
  const files = [];
  const dbFile = path.join(dataDir, "db.json");
  if (fs.existsSync(dbFile)) files.push({ abs: dbFile, rel: "db.json" });
  const uploads = [];
  walk(uploadDir, uploadDir, uploads);
  uploads.forEach((f) => files.push({ abs: f.abs, rel: "uploads/" + f.rel }));
  const plain = pack(files);
  const blob = encrypt(plain, key);
  const name = "maho-" + new Date().toISOString().replace(/[:.]/g, "-") + ".maho-backup";
  const dest = path.join(backupDir, name);
  fs.writeFileSync(dest, blob);
  return { ok: true, file: dest, bytes: blob.length, files: files.length };
}

function safeRel(rel) {
  const norm = path.normalize(String(rel || "")).replace(/^(\.\.(\/|\\|$))+/, "");
  if (!norm || norm.indexOf("..") >= 0 || path.isAbsolute(norm)) return null;
  return norm.split(path.sep).join("/");
}

function restoreBackup({ file, secret, targetDir }) {
  const key = keyFromEnv(secret);
  if (!key) return { ok: false, error: "missing_key" };
  if (!targetDir) return { ok: false, error: "missing_target" };
  const live = process.env.DATA_DIR || "";
  const resolved = path.resolve(targetDir);
  if (live && path.resolve(live) === resolved && process.env.RESTORE_I_UNDERSTAND !== "yes") {
    return { ok: false, error: "refusing_live_data_dir" };
  }
  fs.mkdirSync(resolved, { recursive: true });
  const blob = fs.readFileSync(file);
  const files = unpack(decrypt(blob, key));
  let written = 0;
  files.forEach((f) => {
    const rel = safeRel(f.rel);
    if (!rel) return;
    const dest = path.join(resolved, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.body);
    written += 1;
  });
  return { ok: true, files: written, targetDir: resolved };
}

function pruneOld(backupDir, retentionDays) {
  if (!backupDir || !fs.existsSync(backupDir)) return 0;
  const days = Math.max(1, parseInt(retentionDays || "14", 10) || 14);
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  let removed = 0;
  fs.readdirSync(backupDir).forEach((name) => {
    if (!name.endsWith(".maho-backup")) return;
    const abs = path.join(backupDir, name);
    try {
      const st = fs.statSync(abs);
      if (st.mtimeMs < cutoff) {
        fs.unlinkSync(abs);
        removed += 1;
      }
    } catch (_) {}
  });
  return removed;
}

function record(db, entry) {
  if (!db) return;
  db.backupLog = db.backupLog || [];
  db.backupLog.unshift(Object.assign({ at: Date.now() }, entry));
  if (db.backupLog.length > 100) db.backupLog.length = 100;
}

module.exports = {
  keyFromEnv,
  createBackup,
  restoreBackup,
  pruneOld,
  record,
  encrypt,
  decrypt,
  pack,
  unpack,
};
