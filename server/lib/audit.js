"use strict";

function pushAudit(db, entry) {
  if (!db.auditLog) db.auditLog = [];
  const row = {
    id: "aud_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8),
    at: Date.now(),
    actor: entry.actor || "system",
    action: entry.action || "unknown",
    entityType: entry.entityType || "",
    entityId: entry.entityId || "",
    meta: entry.meta && typeof entry.meta === "object" ? scrubMeta(entry.meta) : undefined,
  };
  db.auditLog.unshift(row);
  if (db.auditLog.length > 2000) db.auditLog.length = 2000;
  return row;
}

function scrubMeta(m) {
  const out = {};
  Object.keys(m).forEach((k) => {
    const lk = k.toLowerCase();
    if (/pass|token|secret|hash|code|smtp|authorization|cookie/.test(lk)) return;
    const v = m[k];
    if (typeof v === "string") out[k] = v.slice(0, 200);
    else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (v == null) out[k] = v;
    else out[k] = String(v).slice(0, 200);
  });
  return out;
}

module.exports = { pushAudit };
