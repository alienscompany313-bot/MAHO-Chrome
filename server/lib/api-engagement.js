"use strict";
/**
 * Customer Engagement API routes (newsletter, campaigns, feedback, analytics).
 */
const {
  ensureEngagement,
  isValidEmail,
  subscribeEmail,
  unsubscribeByToken,
  setSubscriberStatus,
  filterSubscribers,
  findSubscriberByEmail,
  issueUnsubscribeToken,
  subscribersToCsv,
  subscribersToXlsHtml,
  publicCampaign,
  createCampaign,
  resolveCampaignRecipients,
  createFeedbackInvite,
  findFeedbackByToken,
  submitFeedback,
  publicFeedback,
  feedbackAnalytics,
  driverPerformance,
} = require("./engagement");
const { sanitizeText, createRateLimiter, clientIp } = require("./security");
const { pushAudit } = require("./audit");

const rlSubscribe = createRateLimiter({ windowMs: 60 * 1000, max: 8 });
const rlUnsub = createRateLimiter({ windowMs: 60 * 1000, max: 20 });
const rlFeedback = createRateLimiter({ windowMs: 60 * 1000, max: 20 });

function mountEngagement(app, ctx) {
  const db = () => ctx.db;
  const saveDb = () => ctx.saveDb();
  const mail = () => (typeof ctx.mail === "function" ? ctx.mail() : ctx.mail);
  const siteUrl = () => ctx.SITE_URL || "https://mahomarket.com";
  const pepper = () => ctx.TOKEN_PEPPER;
  const requireAdminPerm = ctx.requireAdminPerm;
  const requireAdminAnyPerm = ctx.requireAdminAnyPerm;

  function engagementCfg() {
    ensureEngagement(db());
    return db().config.engagement || {};
  }

  /* ---------- Public: newsletter subscribe ---------- */
  app.post("/api/newsletter/subscribe", (req, res) => {
    const ip = clientIp(req);
    const hit = rlSubscribe(ip);
    if (!hit.ok) {
      res.setHeader("Retry-After", String(Math.ceil((hit.retryAfterMs || 60000) / 1000)));
      return res.status(429).json({ error: "rate_limited" });
    }
    ensureEngagement(db());
    const email = (req.body || {}).email;
    const source = (req.body || {}).source || "website";
    const result = subscribeEmail(db(), { email, source, pepper: pepper() });
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    saveDb();
    res.json({
      ok: true,
      already: !!result.already,
      reactivated: !!result.reactivated,
      subscriber: result.subscriber,
    });
  });

  /* ---------- Public: unsubscribe (no login) ---------- */
  app.get("/api/newsletter/unsubscribe", (req, res) => {
    const ip = clientIp(req);
    const hit = rlUnsub(ip);
    if (!hit.ok) return res.status(429).json({ error: "rate_limited" });
    ensureEngagement(db());
    const email = req.query.email;
    const token = req.query.token;
    const result = unsubscribeByToken(db(), email, token, pepper());
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    saveDb();
    res.json({ ok: true, subscriber: result.subscriber });
  });

  app.post("/api/newsletter/unsubscribe", (req, res) => {
    const ip = clientIp(req);
    const hit = rlUnsub(ip);
    if (!hit.ok) return res.status(429).json({ error: "rate_limited" });
    ensureEngagement(db());
    const b = req.body || {};
    const result = unsubscribeByToken(db(), b.email, b.token, pepper());
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    saveDb();
    res.json({ ok: true, subscriber: result.subscriber });
  });

  /* ---------- Admin: subscribers ---------- */
  app.get("/api/admin/subscribers", requireAdminAnyPerm(["marketing", "customers", "reports"]), (req, res) => {
    ensureEngagement(db());
    const rows = filterSubscribers(db(), {
      q: req.query.q,
      status: req.query.status,
    });
    const all = db().subscribers || [];
    res.setHeader("Cache-Control", "no-store");
    res.json({
      subscribers: rows,
      total: all.length,
      active: all.filter((s) => (s.status || "active") === "active").length,
      inactive: all.filter((s) => s.status === "inactive").length,
    });
  });

  app.post("/api/admin/subscribers/:id/status", requireAdminAnyPerm(["marketing", "customers"]), (req, res) => {
    ensureEngagement(db());
    const result = setSubscriberStatus(db(), req.params.id, (req.body || {}).status);
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    saveDb();
    pushAudit(db(), {
      actor: (req.adminSession && (req.adminSession.name || req.adminSession.email)) || "admin",
      action: "subscriber_status",
      meta: { id: req.params.id, status: result.subscriber.status },
    });
    saveDb();
    res.json({ ok: true, subscriber: result.subscriber });
  });

  app.get("/api/admin/subscribers/export", requireAdminAnyPerm(["marketing", "customers", "reports"]), (req, res) => {
    ensureEngagement(db());
    const format = String(req.query.format || "csv").toLowerCase();
    const scope = String(req.query.scope || "filter").toLowerCase();
    let rows;
    if (scope === "all") rows = filterSubscribers(db(), {});
    else if (scope === "active") rows = filterSubscribers(db(), { status: "active" });
    else if (scope === "inactive") rows = filterSubscribers(db(), { status: "inactive" });
    else if (scope === "selected") {
      const ids = String(req.query.ids || "").split(",").map((x) => x.trim()).filter(Boolean);
      rows = filterSubscribers(db(), { ids });
    } else {
      rows = filterSubscribers(db(), { q: req.query.q, status: req.query.status });
    }
    if (format === "xls" || format === "xlsx") {
      const body = subscribersToXlsHtml(rows);
      res.setHeader("Content-Type", "application/vnd.ms-excel; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="maho-subscribers.xls"');
      return res.send(body);
    }
    const csv = subscribersToCsv(rows);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="maho-subscribers.csv"');
    return res.send(csv);
  });

  /* ---------- Admin: campaigns ---------- */
  app.get("/api/admin/campaigns", requireAdminAnyPerm(["marketing", "customers"]), (req, res) => {
    ensureEngagement(db());
    res.setHeader("Cache-Control", "no-store");
    res.json({ campaigns: (db().campaigns || []).map(publicCampaign) });
  });

  app.post("/api/admin/campaigns", requireAdminAnyPerm(["marketing", "customers"]), (req, res) => {
    ensureEngagement(db());
    const who = (req.adminSession && (req.adminSession.name || req.adminSession.email)) || "admin";
    const result = createCampaign(db(), req.body || {}, who);
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    saveDb();
    res.json({ ok: true, campaign: result.campaign });
  });

  app.post("/api/admin/campaigns/preview-count", requireAdminAnyPerm(["marketing", "customers"]), (req, res) => {
    ensureEngagement(db());
    const recipients = resolveCampaignRecipients(db(), req.body || {});
    res.json({ ok: true, recipientCount: recipients.length });
  });

  app.post("/api/admin/campaigns/test", requireAdminAnyPerm(["marketing", "customers"]), async (req, res) => {
    ensureEngagement(db());
    const b = req.body || {};
    const to = String(b.to || "").trim().toLowerCase();
    if (!isValidEmail(to)) return res.status(400).json({ error: "invalid_email" });
    const m = mail();
    if (!m || typeof m.campaignEmail !== "function") {
      return res.status(503).json({ error: "email_not_configured" });
    }
    const unsubUrl = siteUrl() + "/unsubscribe.html?email=" + encodeURIComponent(to) + "&token=test";
    try {
      const ok = await m.campaignEmail(to, {
        subject: sanitizeText(b.subject, 200) || "Test",
        message: sanitizeText(b.message, 8000) || "",
        ctaText: sanitizeText(b.ctaText, 80),
        ctaUrl: sanitizeText(b.ctaUrl, 500),
        unsubscribeUrl: unsubUrl,
      });
      if (!ok) return res.status(503).json({ error: "send_failed" });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "send_failed" });
    }
  });

  app.post("/api/admin/campaigns/:id/send", requireAdminAnyPerm(["marketing", "customers"]), async (req, res) => {
    ensureEngagement(db());
    const c = (db().campaigns || []).find((x) => x && x.id === req.params.id);
    if (!c) return res.status(404).json({ error: "not_found" });
    if (c.sendLock || c.status === "sending") {
      return res.status(409).json({ error: "already_sending" });
    }
    if (c.status === "sent") {
      return res.status(409).json({ error: "already_sent" });
    }
    const m = mail();
    if (!m || typeof m.campaignEmail !== "function") {
      return res.status(503).json({ error: "email_not_configured" });
    }

    const recipients = resolveCampaignRecipients(db(), req.body || {});
    if (!recipients.length) return res.status(400).json({ error: "no_recipients" });

    c.sendLock = true;
    c.status = "sending";
    c.recipientCount = recipients.length;
    c.successCount = 0;
    c.failedCount = 0;
    saveDb();

    /* Respond immediately; finish send in background to avoid double-click races */
    res.json({ ok: true, campaign: publicCampaign(c), started: true });

    setImmediate(async () => {
      try {
        for (let i = 0; i < recipients.length; i++) {
          const sub = recipients[i];
          const full = findSubscriberByEmail(db(), sub.email);
          if (!full || full.status !== "active") {
            c.failedCount++;
            continue;
          }
          let raw = issueUnsubscribeToken(full, pepper());
          const unsubUrl = siteUrl() + "/unsubscribe.html?email=" +
            encodeURIComponent(full.email) + "&token=" + encodeURIComponent(raw);
          try {
            const ok = await m.campaignEmail(full.email, {
              subject: c.subject,
              message: c.message,
              ctaText: c.ctaText,
              ctaUrl: c.ctaUrl,
              unsubscribeUrl: unsubUrl,
            });
            if (ok) c.successCount++;
            else c.failedCount++;
          } catch (_) {
            c.failedCount++;
          }
        }
        c.sentAt = Date.now();
        if (c.failedCount === 0 && c.successCount > 0) c.status = "sent";
        else if (c.successCount === 0) c.status = "failed";
        else c.status = "partial";
      } catch (_) {
        c.status = "failed";
      }
      c.sendLock = false;
      saveDb();
    });
  });

  /* ---------- Public feedback ---------- */
  app.get("/api/feedback/:orderId", (req, res) => {
    ensureEngagement(db());
    const token = req.query.token;
    const f = findFeedbackByToken(db(), req.params.orderId, token, pepper());
    if (!f) return res.status(404).json({ error: "not_found" });
    const order = (db().orders || []).find((o) => o && o.id === req.params.orderId);
    const items = ((order && order.items) || []).map((it) => ({
      name: it.name,
      code: it.code || "",
    }));
    const cfg = engagementCfg();
    res.setHeader("Cache-Control", "no-store");
    res.json({
      feedback: publicFeedback(f),
      items,
      googleReviewUrl: cfg.googleReviewUrl || "",
      minStarsForGoogleReview: cfg.minStarsForGoogleReview || 4,
    });
  });

  app.post("/api/feedback/:orderId", (req, res) => {
    const ip = clientIp(req);
    const hit = rlFeedback(ip);
    if (!hit.ok) return res.status(429).json({ error: "rate_limited" });
    ensureEngagement(db());
    const token = (req.body || {}).token || req.query.token;
    const result = submitFeedback(db(), req.params.orderId, token, pepper(), req.body || {});
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error, feedback: result.feedback });
    saveDb();
    res.json({ ok: true, feedback: result.feedback, googleReviewUrl: engagementCfg().googleReviewUrl || "" });
  });

  /* ---------- Admin feedback analytics + driver performance ---------- */
  app.get("/api/admin/feedback", requireAdminAnyPerm(["marketing", "reports", "customers", "drivers"]), (req, res) => {
    ensureEngagement(db());
    res.setHeader("Cache-Control", "no-store");
    res.json({
      analytics: feedbackAnalytics(db()),
      feedback: (db().feedback || []).slice(0, 200).map(publicFeedback),
    });
  });

  app.get("/api/admin/driver-performance", requireAdminAnyPerm(["drivers", "reports", "marketing"]), (req, res) => {
    ensureEngagement(db());
    res.setHeader("Cache-Control", "no-store");
    res.json({ drivers: driverPerformance(db()) });
  });

  app.get("/api/admin/engagement-config", requireAdminAnyPerm(["marketing", "settings"]), (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ engagement: engagementCfg() });
  });

  app.put("/api/admin/engagement-config", requireAdminAnyPerm(["marketing", "settings"]), (req, res) => {
    ensureEngagement(db());
    const b = (req.body || {}).engagement || req.body || {};
    const cur = db().config.engagement;
    if (b.googleReviewUrl != null) cur.googleReviewUrl = sanitizeText(b.googleReviewUrl, 500);
    if (b.feedbackRequestEnabled != null) cur.feedbackRequestEnabled = !!b.feedbackRequestEnabled;
    if (b.minStarsForGoogleReview != null) {
      const n = parseInt(b.minStarsForGoogleReview, 10);
      if (Number.isFinite(n)) cur.minStarsForGoogleReview = Math.max(1, Math.min(5, n));
    }
    saveDb();
    res.json({ ok: true, engagement: cur });
  });
}

/**
 * After an order is delivered, create feedback invite + email (non-blocking).
 */
function maybeSendFeedbackRequest(ctx, order) {
  try {
    if (!order || !order.id) return;
    if (!order.customer || !order.customer.email) return;
    ensureEngagement(ctx.db);
    const cfg = ctx.db.config.engagement || {};
    if (cfg.feedbackRequestEnabled === false) return;
    const invite = createFeedbackInvite(ctx.db, order, ctx.TOKEN_PEPPER);
    if (!invite) return;
    ctx.saveDb();
    const raw = invite._rawToken;
    if (!raw) return;
    delete invite._rawToken;
    ctx.saveDb();
    const m = typeof ctx.mail === "function" ? ctx.mail() : ctx.mail;
    if (!m || typeof m.feedbackRequest !== "function") return;
    const url = (ctx.SITE_URL || "https://mahomarket.com") +
      "/feedback.html?o=" + encodeURIComponent(order.id) + "&t=" + encodeURIComponent(raw);
    m.feedbackRequest(order.customer.email, order, url, order.lang || "fa").catch(() => {});
  } catch (_) { /* never break order flow */ }
}

module.exports = { mountEngagement, maybeSendFeedbackRequest };
