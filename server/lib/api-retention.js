"use strict";
/**
 * Admin Data Retention / Cleanup APIs.
 */
const path = require("path");
const {
  ensureRetention,
  publicRetentionConfig,
  updateRetentionConfig,
  previewCleanup,
  storageCounts,
  runCleanup,
  maybeRunAutomaticCleanup,
} = require("./retention");
const { pushAudit } = require("./audit");
const { sanitizeText } = require("./security");

function mountRetention(app, ctx) {
  const db = () => ctx.db;
  const saveDb = () => ctx.saveDb();
  const requireAdminAnyPerm = ctx.requireAdminAnyPerm;
  const requireAdmin = ctx.requireAdmin;
  const staffHasPerm = ctx.staffHasPerm;
  const DATA_DIR = ctx.DATA_DIR || path.join(__dirname, "..", "data");
  const archiveDir = () => path.join(DATA_DIR, "archive");

  function actorName(req) {
    const s = req.adminSession || {};
    return s.owner ? "Owner" : (s.name || s.staffId || "admin");
  }

  function requireOwnerOrPerm(perms) {
    return (req, res, next) => {
      requireAdmin(req, res, () => {
        const s = req.adminSession || {};
        if (s.owner || s.role === "owner") return next();
        const list = Array.isArray(perms) ? perms : [perms];
        if (list.some((p) => staffHasPerm(s, p))) return next();
        return res.status(403).json({ error: "forbidden", need: list[0] });
      });
    };
  }

  ensureRetention(db());

  app.get("/api/admin/retention", requireAdminAnyPerm([
    "settings", "retention_view", "retention_edit", "retention_preview", "retention_history",
  ]), (req, res) => {
    ensureRetention(db());
    res.json({
      retention: publicRetentionConfig(db()),
      counts: storageCounts(db()),
    });
  });

  app.put("/api/admin/retention", requireAdminAnyPerm(["settings", "retention_edit"]), (req, res) => {
    const before = JSON.stringify(publicRetentionConfig(db()));
    const result = updateRetentionConfig(db(), req.body || {}, actorName(req));
    saveDb();
    pushAudit(db(), {
      actor: actorName(req),
      action: "retention_settings_updated",
      entityType: "config",
      entityId: "retention",
      meta: { changed: before !== JSON.stringify(result.retention) },
    });
    res.json(result);
  });

  app.get("/api/admin/retention/preview", requireAdminAnyPerm([
    "settings", "retention_preview", "retention_view",
  ]), (req, res) => {
    const preview = previewCleanup(db());
    pushAudit(db(), {
      actor: actorName(req),
      action: "retention_preview",
      entityType: "cleanup",
      entityId: "preview",
      meta: { totalEligible: preview.totalEligible },
    });
    res.json(preview);
  });

  app.post("/api/admin/retention/preview", requireAdminAnyPerm([
    "settings", "retention_preview", "retention_view",
  ]), (req, res) => {
    res.json(previewCleanup(db()));
  });

  app.post("/api/admin/retention/archive", requireAdminAnyPerm([
    "settings", "retention_archive",
  ]), (req, res) => {
    const body = req.body || {};
    const result = runCleanup(db(), {
      mode: "archive",
      categoryIds: body.categoryIds,
      actor: actorName(req),
      automatic: false,
      archiveDir: archiveDir(),
      batchSize: body.batchSize,
    });
    if (!result.ok) return res.status(result.status || 400).json(result);
    saveDb();
    pushAudit(db(), {
      actor: actorName(req),
      action: "retention_archive_run",
      entityType: "cleanup",
      entityId: result.historyId || "archive",
      meta: { affected: result.affected },
    });
    res.json(result);
  });

  /* Permanent delete — Owner OR retention_delete; two-step confirm phrase required */
  app.post("/api/admin/retention/delete", requireOwnerOrPerm(["retention_delete"]), (req, res) => {
    const body = req.body || {};
    if (!body.confirm) {
      return res.status(400).json({
        error: "confirm_required",
        message: "تأیید صریح لازم است (confirm: true).",
      });
    }
    const result = runCleanup(db(), {
      mode: "delete",
      categoryIds: body.categoryIds,
      actor: actorName(req),
      automatic: false,
      confirmPhrase: body.confirmPhrase || body.phrase,
      archiveDir: archiveDir(),
      batchSize: body.batchSize,
    });
    if (!result.ok) return res.status(result.status || 400).json(result);
    saveDb();
    pushAudit(db(), {
      actor: actorName(req),
      action: "retention_permanent_delete",
      entityType: "cleanup",
      entityId: result.historyId || "delete",
      meta: { affected: result.affected },
    });
    res.json(result);
  });

  app.get("/api/admin/retention/history", requireAdminAnyPerm([
    "settings", "retention_history", "retention_view",
  ]), (req, res) => {
    ensureRetention(db());
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    res.json({ history: (db().cleanupHistory || []).slice(0, limit) });
  });

  /**
   * External cron / scheduled heartbeat.
   * Auth: header X-Retention-Cron matching RETENTION_CRON_SECRET, OR admin Bearer with archive perm.
   * Automatic cleanup OFF by default; when ON, cron archives in batches (never permanent delete).
   */
  app.post("/api/cron/retention", (req, res) => {
    const secret = String(process.env.RETENTION_CRON_SECRET || "").trim();
    const hdr = String(req.headers["x-retention-cron"] || "").trim();
    let actor = "cron";
    if (secret && hdr && hdr === secret) {
      actor = "cron:secret";
    } else {
      const s = ctx.auth ? ctx.auth(req) : null;
      if (!s || s.type !== "admin") {
        return res.status(401).json({ error: "unauthorized", message: "Cron secret or admin token required." });
      }
      req.adminSession = s;
      if (!s.owner && !staffHasPerm(s, "settings") && !staffHasPerm(s, "retention_archive")) {
        return res.status(403).json({ error: "forbidden", need: "retention_archive" });
      }
      actor = actorName(req);
    }
    const force = !!(req.body && req.body.force);
    const result = maybeRunAutomaticCleanup(db(), {
      actor,
      archiveDir: archiveDir(),
      force,
    });
    if (result && result.ok && !result.skipped) saveDb();
    res.json(result);
  });
}

module.exports = { mountRetention };
