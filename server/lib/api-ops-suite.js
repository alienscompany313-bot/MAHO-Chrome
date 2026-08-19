"use strict";
/**
 * Ops suite APIs: giveaways, return reasons/analytics/window,
 * return driver pickup, cash refund, Google Review invite, marketing consent.
 */
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const {
  ensureReturnsOps,
  getReturnWindowDays,
  isStorePickupOrder,
  applyDeliveryReturnPolicy,
  customerMayRequestReturn,
  listReturnReasons,
  createReturnReason,
  updateReturnReason,
  deleteReturnReason,
  resolveReasonSnapshot,
  isCashPayment,
  approvedRefundAmount,
  returnReasonAnalytics,
  fulfillmentType,
} = require("./returns-ops");
const {
  ensureGiveaways,
  publicGiveaway,
  createGiveaway,
  previewGiveaway,
  drawGiveaway,
  voidGiveaway,
  giveawaysToCsv,
  lookupClaim,
  redeemClaim,
  voidClaim,
  winnerEmailPayload,
} = require("./giveaway");
const { sanitizeText, createRateLimiter, clientIp } = require("./security");
const { pushAudit } = require("./audit");
const { normalizeOrderStatus, appendHistory } = require("./orders");
const { normalizeEmail, isValidEmail } = require("./engagement");
const { resolvePickupStore } = require("./store-inventory");

function mountOpsSuite(app, ctx) {
  const db = () => ctx.db;
  const saveDb = () => ctx.saveDb();
  const mail = () => (typeof ctx.mail === "function" ? ctx.mail() : ctx.mail);
  const siteUrl = () => ctx.SITE_URL || "https://mahomarket.com";
  const requireAdminAnyPerm = ctx.requireAdminAnyPerm;
  const requireDriver = ctx.requireDriver;
  const UPLOAD_DIR = ctx.UPLOAD_DIR;

  ensureReturnsOps(db());
  ensureGiveaways(db());

  const proofDir = path.join(UPLOAD_DIR || path.join(__dirname, "..", "uploads"), "return-proofs");
  try { fs.mkdirSync(proofDir, { recursive: true }); } catch (_) {}

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, proofDir),
      filename: (_req, file, cb) => {
        const ext = ({ "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" })[file.mimetype] || ".bin";
        cb(null, crypto.randomBytes(16).toString("hex") + ext);
      },
    }),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (!/^image\/(jpeg|png|webp)$/.test(file.mimetype)) return cb(new Error("only jpeg/png/webp"));
      cb(null, true);
    },
  });

  function actorName(req) {
    const s = req.adminSession || {};
    return s.owner ? "Owner" : (s.name || s.staffId || "admin");
  }

  /* ---------- Returns config ---------- */
  app.get("/api/admin/returns-config", requireAdminAnyPerm(["returns", "settings"]), (req, res) => {
    ensureReturnsOps(db());
    res.json({ returns: db().config.returns });
  });

  app.put("/api/admin/returns-config", requireAdminAnyPerm(["returns", "settings"]), (req, res) => {
    ensureReturnsOps(db());
    const b = (req.body || {}).returns || req.body || {};
    const cur = db().config.returns;
    if (b.returnWindowDays != null) {
      const n = parseInt(b.returnWindowDays, 10);
      if (Number.isFinite(n)) cur.returnWindowDays = Math.max(0, Math.min(365, n));
    }
    if (b.returnPickupPhotoRequired != null) cur.returnPickupPhotoRequired = !!b.returnPickupPhotoRequired;
    saveDb();
    pushAudit(db(), { actor: actorName(req), action: "returns_config", entityType: "config", entityId: "returns", meta: cur });
    res.json({ ok: true, returns: cur });
  });

  /* ---------- Return reasons ---------- */
  app.get("/api/admin/return-reasons", requireAdminAnyPerm(["returns", "settings", "marketing"]), (req, res) => {
    res.json({ reasons: listReturnReasons(db(), { activeOnly: false }) });
  });

  app.get("/api/return-reasons", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ reasons: listReturnReasons(db(), { activeOnly: true }) });
  });

  app.post("/api/admin/return-reasons", requireAdminAnyPerm(["returns", "settings"]), (req, res) => {
    const result = createReturnReason(db(), req.body || {});
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    saveDb();
    pushAudit(db(), { actor: actorName(req), action: "return_reason_create", entityType: "return_reason", entityId: result.reason.id });
    res.json(result);
  });

  app.put("/api/admin/return-reasons/:id", requireAdminAnyPerm(["returns", "settings"]), (req, res) => {
    const result = updateReturnReason(db(), req.params.id, req.body || {});
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    saveDb();
    pushAudit(db(), { actor: actorName(req), action: "return_reason_update", entityType: "return_reason", entityId: req.params.id });
    res.json(result);
  });

  app.delete("/api/admin/return-reasons/:id", requireAdminAnyPerm(["returns", "settings"]), (req, res) => {
    const result = deleteReturnReason(db(), req.params.id);
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    saveDb();
    pushAudit(db(), { actor: actorName(req), action: "return_reason_delete", entityType: "return_reason", entityId: req.params.id });
    res.json(result);
  });

  app.get("/api/admin/return-analytics", requireAdminAnyPerm(["returns", "reports", "marketing"]), (req, res) => {
    const data = returnReasonAnalytics(db(), {
      from: req.query.from,
      to: req.query.to,
      productCode: req.query.product,
      fulfillment: req.query.fulfillment,
    });
    res.json(data);
  });

  app.get("/api/admin/returns/export", requireAdminAnyPerm(["returns", "reports"]), (req, res) => {
    const { csvSafeCell } = require("./engagement");
    const header = [
      "orderId", "status", "method", "reason", "customerName", "customerEmail", "total",
      "returnPickupStatus", "refundStatus", "approvedRefundAmount", "cashRefundPaid",
      "requestedAt", "returnedToStoreAt", "stockRestored",
    ];
    const lines = [header.join(",")];
    (db().orders || []).forEach((o) => {
      if (!o || !o.returnRequest) return;
      const rr = o.returnRequest;
      const c = o.customer || {};
      lines.push([
        csvSafeCell(o.id), csvSafeCell(o.status), csvSafeCell(rr.method),
        csvSafeCell(rr.reasonTitleSnapshot || rr.reason),
        csvSafeCell(c.name), csvSafeCell(c.email),
        Number(o.total) || 0,
        csvSafeCell(rr.returnPickupStatus), csvSafeCell(rr.refundStatus),
        rr.approvedRefundAmount != null ? rr.approvedRefundAmount : "",
        rr.cashRefundPaid ? "yes" : "no",
        rr.requestedAt ? new Date(rr.requestedAt).toISOString() : "",
        rr.returnedToStoreAt ? new Date(rr.returnedToStoreAt).toISOString() : "",
        rr.stockRestored ? "yes" : "no",
      ].join(","));
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="maho-returns.csv"');
    res.send("\uFEFF" + lines.join("\n"));
  });

  /* ---------- Late return override ---------- */
  app.post("/api/admin/orders/:id/late-return-override", requireAdminAnyPerm(["returns", "orders"]), (req, res) => {
    const o = (db().orders || []).find((x) => x && x.id === req.params.id);
    if (!o) return res.status(404).json({ error: "not_found" });
    const reason = sanitizeText((req.body || {}).reason, 500);
    if (!reason) return res.status(400).json({ error: "reason_required" });
    o.lateReturnApproved = true;
    o.lateReturnApprovedAt = Date.now();
    o.lateReturnApprovedBy = actorName(req);
    o.lateReturnReason = reason;
    saveDb();
    pushAudit(db(), {
      actor: actorName(req),
      action: "late_return_approved",
      entityType: "order",
      entityId: o.id,
      meta: { reason },
    });
    res.json({ ok: true, order: { id: o.id, lateReturnApproved: true, lateReturnReason: reason } });
  });

  /* ---------- Assign return driver ---------- */
  app.post("/api/admin/orders/:id/assign-return-driver", requireAdminAnyPerm(["returns", "orders", "drivers"]), (req, res) => {
    const o = (db().orders || []).find((x) => x && x.id === req.params.id);
    if (!o || !o.returnRequest) return res.status(404).json({ error: "not_found" });
    if (o.returnRequest.method !== "pickup_customer") {
      return res.status(400).json({ error: "not_customer_pickup" });
    }
    const driverId = String((req.body || {}).driverId || "");
    const driver = (db().drivers || []).find((d) => d && d.id === driverId && d.active !== false);
    if (!driver) return res.status(400).json({ error: "invalid_driver" });
    if (o.returnRequest.returnDriverId && o.returnRequest.returnDriverId !== driverId) {
      if (!(req.body || {}).confirmReassign) {
        return res.status(409).json({ error: "confirm_reassign_required" });
      }
    }
    const photoRequired = (req.body || {}).photoRequired != null
      ? !!(req.body || {}).photoRequired
      : !!(db().config.returns && db().config.returns.returnPickupPhotoRequired);

    o.returnRequest.returnDriverId = driver.id;
    o.returnRequest.returnDriverName = driver.name;
    o.returnRequest.returnDriverAssignedAt = Date.now();
    o.returnRequest.returnDriverAssignedBy = actorName(req);
    o.returnRequest.returnPickupStatus = "assigned";
    o.returnRequest.photoRequired = photoRequired;
    if (o.returnRequest.refundStatus == null) o.returnRequest.refundStatus = "approved";
    if (o.returnRequest.approvedRefundAmount == null) {
      o.returnRequest.approvedRefundAmount = Number(o.total) || 0;
    }
    saveDb();
    pushAudit(db(), {
      actor: actorName(req),
      action: "return_driver_assigned",
      entityType: "order",
      entityId: o.id,
      meta: { driverId: driver.id, photoRequired },
    });
    if (mail() && o.customer && o.customer.email) {
      mail().orderStatus(o.customer.email, o, "راننده برای جمع‌آوری برگشتی تعیین شد", o.lang || "fa").catch(() => {});
    }
    res.json({ ok: true, returnRequest: o.returnRequest });
  });

  /* ---------- Google Review invite (admin) ---------- */
  app.post("/api/admin/orders/:id/send-google-review", requireAdminAnyPerm(["orders", "marketing", "customers"]), async (req, res) => {
    const o = (db().orders || []).find((x) => x && x.id === req.params.id);
    if (!o) return res.status(404).json({ error: "not_found" });
    if (normalizeOrderStatus(o.status) !== "delivered") {
      return res.status(400).json({ error: "not_delivered" });
    }
    const url = (db().config.engagement && db().config.engagement.googleReviewUrl)
      || process.env.GOOGLE_REVIEW_URL
      || "";
    if (!url) return res.status(400).json({ error: "google_review_url_missing" });
    if (!o.customer || !isValidEmail(o.customer.email)) {
      return res.status(400).json({ error: "no_customer_email" });
    }
    const m = mail();
    if (!m || typeof m.googleReviewInvite !== "function") {
      return res.status(503).json({ error: "email_not_configured" });
    }
    const ok = await m.googleReviewInvite(o.customer.email, o, url, o.lang || "fa");
    o.googleReviewInviteSentAt = Date.now();
    o.googleReviewInviteSentBy = actorName(req);
    saveDb();
    res.json({ ok: true, emailed: !!ok });
  });

  /* ---------- Giveaways ---------- */
  app.get("/api/admin/giveaways", requireAdminAnyPerm(["marketing", "marketing_giveaway", "customers"]), (req, res) => {
    ensureGiveaways(db());
    res.json({ giveaways: (db().giveaways || []).map(publicGiveaway) });
  });

  app.post("/api/admin/giveaways", requireAdminAnyPerm(["marketing", "marketing_giveaway", "customers"]), (req, res) => {
    const result = createGiveaway(db(), req.body || {}, actorName(req));
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    saveDb();
    pushAudit(db(), { actor: actorName(req), action: "giveaway_created", entityType: "giveaway", entityId: result.giveaway.id });
    res.json(result);
  });

  app.post("/api/admin/giveaways/preview", requireAdminAnyPerm(["marketing", "marketing_giveaway", "customers"]), (req, res) => {
    res.json(previewGiveaway(db(), req.body || {}));
  });

  app.post("/api/admin/giveaways/:id/draw", requireAdminAnyPerm(["marketing", "marketing_giveaway", "marketing_giveaway_draw"]), (req, res) => {
    const result = drawGiveaway(db(), req.params.id, actorName(req));
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    saveDb();
    pushAudit(db(), {
      actor: actorName(req),
      action: "giveaway_drawn",
      entityType: "giveaway",
      entityId: req.params.id,
      meta: {
        winners: (result.giveaway.winners || []).map((w) => w.email),
        claimCodes: (result.giveaway.winners || []).map((w) => w.claimCode).filter(Boolean),
        claimStoreId: result.giveaway.claimStoreId || null,
      },
    });
    res.json(result);
  });

  app.post("/api/admin/giveaways/:id/void", requireAdminAnyPerm(["marketing", "marketing_giveaway"]), (req, res) => {
    const result = voidGiveaway(db(), req.params.id, (req.body || {}).reason, actorName(req));
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    saveDb();
    pushAudit(db(), { actor: actorName(req), action: "giveaway_voided", entityType: "giveaway", entityId: req.params.id });
    res.json(result);
  });

  app.post("/api/admin/giveaways/:id/notify-winners", requireAdminAnyPerm(["marketing", "marketing_giveaway", "marketing_giveaway_notify"]), async (req, res) => {
    const g = (db().giveaways || []).find((x) => x && x.id === req.params.id);
    if (!g) return res.status(404).json({ error: "not_found" });
    if (g.status !== "drawn") return res.status(400).json({ error: "not_drawn" });
    const m = mail();
    if (!m || typeof m.giveawayWinner !== "function") return res.status(503).json({ error: "email_not_configured" });
    let ok = 0;
    for (const w of g.winners || []) {
      try {
        const payload = winnerEmailPayload(db(), g, w);
        if (await m.giveawayWinner(w.email, payload)) {
          ok++;
          w.notifiedAt = Date.now();
          pushAudit(db(), {
            actor: actorName(req),
            action: "giveaway_winner_email_sent",
            entityType: "giveaway",
            entityId: g.id,
            meta: { email: w.email, claimCode: w.claimCode || null },
          });
        }
      } catch (_) {}
    }
    saveDb();
    res.json({ ok: true, emailed: ok });
  });

  app.get("/api/admin/giveaways/claims/lookup", requireAdminAnyPerm(["marketing", "marketing_giveaway", "marketing_giveaway_claim"]), (req, res) => {
    const code = (req.query && req.query.code) || (req.body && req.body.claimCode) || "";
    const result = lookupClaim(db(), code);
    if (!result.ok) return res.status(result.status || 404).json({ error: result.error });
    res.json(result);
  });

  app.post("/api/admin/giveaways/claims/lookup", requireAdminAnyPerm(["marketing", "marketing_giveaway", "marketing_giveaway_claim"]), (req, res) => {
    const code = (req.body || {}).claimCode || (req.body || {}).code || "";
    const result = lookupClaim(db(), code);
    if (!result.ok) return res.status(result.status || 404).json({ error: result.error });
    res.json(result);
  });

  app.post("/api/admin/giveaways/claims/redeem", requireAdminAnyPerm(["marketing", "marketing_giveaway", "marketing_giveaway_claim"]), (req, res) => {
    const code = (req.body || {}).claimCode || (req.body || {}).code || "";
    const confirm = !!(req.body || {}).confirm;
    if (!confirm) return res.status(400).json({ error: "confirm_required", message: "تأیید تحویل جایزه لازم است." });
    const preview = lookupClaim(db(), code);
    if (!preview.ok) return res.status(preview.status || 404).json({ error: preview.error });
    const result = redeemClaim(db(), code, actorName(req));
    if (!result.ok) {
      pushAudit(db(), {
        actor: actorName(req),
        action: "giveaway_claim_rejected",
        entityType: "giveaway",
        entityId: (preview.claim && preview.claim.giveawayId) || null,
        meta: { claimCode: code, error: result.error },
      });
      return res.status(result.status || 409).json({ error: result.error, message: result.message, claim: result.claim || preview.claim });
    }
    saveDb();
    pushAudit(db(), {
      actor: actorName(req),
      action: "giveaway_prize_claimed",
      entityType: "giveaway",
      entityId: result.claim.giveawayId,
      meta: { claimCode: result.claim.claimCode, winnerEmail: result.claim.winnerEmail },
    });
    res.json(result);
  });

  app.post("/api/admin/giveaways/claims/void", requireAdminAnyPerm(["marketing", "marketing_giveaway", "marketing_giveaway_claim"]), (req, res) => {
    const code = (req.body || {}).claimCode || "";
    const result = voidClaim(db(), code, (req.body || {}).reason, actorName(req));
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    saveDb();
    pushAudit(db(), {
      actor: actorName(req),
      action: "giveaway_claim_voided",
      entityType: "giveaway",
      entityId: result.claim.giveawayId,
      meta: { claimCode: code },
    });
    res.json(result);
  });

  app.get("/api/admin/giveaways/export", requireAdminAnyPerm(["marketing", "marketing_giveaway", "customers", "reports"]), (req, res) => {
    ensureGiveaways(db());
    const csv = giveawaysToCsv((db().giveaways || []).map(publicGiveaway));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="maho-giveaways.csv"');
    res.send(csv);
  });

  app.get("/api/admin/stores/pickup-options", requireAdminAnyPerm(["marketing", "marketing_giveaway", "stores", "settings", "orders"]), (req, res) => {
    const stores = (db().stores || []).map((s, i) => {
      const resolved = resolvePickupStore(db(), s.id || ("store_" + i));
      return resolved;
    }).filter(Boolean);
    res.json({ stores });
  });

  /* ---------- Marketing consent (registered) ---------- */
  app.post("/api/newsletter/unsubscribe-registered", (req, res) => {
    const email = normalizeEmail((req.body || {}).email || req.query.email);
    if (!isValidEmail(email)) return res.status(400).json({ error: "invalid_email" });
    const u = (db().users || []).find((x) => x && normalizeEmail(x.email) === email && !x.deletedAt);
    if (!u) return res.status(404).json({ error: "not_found" });
    u.marketingConsent = false;
    u.marketingUnsubscribedAt = Date.now();
    saveDb();
    res.json({ ok: true, marketingConsent: false });
  });

  if (typeof ctx.requireUser === "function") {
    app.put("/api/me/marketing-consent", ctx.requireUser, (req, res) => {
      const u = req.user;
      u.marketingConsent = !!(req.body || {}).marketingConsent;
      if (!u.marketingConsent) u.marketingUnsubscribedAt = Date.now();
      else u.marketingUnsubscribedAt = null;
      saveDb();
      res.json({ ok: true, marketingConsent: !!u.marketingConsent });
    });
  }

  /* ---------- Driver return pickup ---------- */
  function requireDriverLocal(req, res, next) {
    if (typeof requireDriver === "function") return requireDriver(req, res, next);
    const s = typeof ctx.auth === "function" ? ctx.auth(req) : null;
    if (!s || s.type !== "driver") return res.status(401).json({ error: "driver_auth_required" });
    req.driverSession = s;
    next();
  }

  app.get("/api/driver/return-pickups", requireDriverLocal, (req, res) => {
    const driverId = req.driverSession.driverId;
    const activeStatuses = { not_assigned: 1, assigned: 1, on_the_way: 1, picked_up: 1, returned_to_store: 1 };
    const list = (db().orders || []).filter((o) =>
      o && o.returnRequest && o.returnRequest.returnDriverId === driverId
      && o.returnRequest.method === "pickup_customer"
      && activeStatuses[o.returnRequest.returnPickupStatus || "assigned"]
    ).map((o) => ({
      orderId: o.id,
      returnNumber: o.returnRequest.id || o.id + "-R",
      status: o.status,
      returnPickupStatus: o.returnRequest.returnPickupStatus || "assigned",
      customerName: (o.customer && o.customer.name) || "",
      phone: (o.returnRequest.pickup && o.returnRequest.pickup.phone) || (o.customer && o.customer.phone) || "",
      pickupAddress: (o.returnRequest.pickup && o.returnRequest.pickup.address) || "",
      mapsUrl: (o.returnRequest.pickup && o.returnRequest.pickup.mapsUrl) || null,
      items: o.items || [],
      reason: o.returnRequest.reasonTitleSnapshot || o.returnRequest.reason || "",
      notes: o.returnRequest.details || "",
      payment: o.payment,
      approvedRefundAmount: approvedRefundAmount(o),
      photoRequired: !!o.returnRequest.photoRequired,
      cashEligible: isCashPayment(o),
      refundStatus: o.returnRequest.refundStatus || "approved",
      photos: o.returnRequest.pickupPhotos || [],
      pickupConfirmed: !!o.returnRequest.pickupConfirmed,
      pickedUpAt: o.returnRequest.pickedUpAt || null,
      collectionId: o.returnRequest.collectionId || null,
      collectedQty: o.returnRequest.collectedQty || null,
      cashRefundPaid: !!o.returnRequest.cashRefundPaid,
      alreadyCollectedMessage: "این کالا قبلاً دریافت شده است.",
    }));
    res.json({ pickups: list });
  });

  app.post("/api/driver/return-pickups/:id/confirm", requireDriverLocal, (req, res) => {
    const o = (db().orders || []).find((x) => x && x.id === req.params.id);
    if (!o || !o.returnRequest) return res.status(404).json({ error: "not_found" });
    if (o.returnRequest.returnDriverId !== req.driverSession.driverId) {
      return res.status(403).json({ error: "not_your_job" });
    }
    /* Idempotent: already collected — do not re-audit, re-notify, or re-touch inventory/refund */
    const already =
      o.returnRequest.pickupConfirmed === true ||
      o.returnRequest.returnPickupStatus === "picked_up" ||
      o.returnRequest.returnPickupStatus === "returned_to_store" ||
      o.returnRequest.returnPickupStatus === "completed";
    if (already) {
      pushAudit(db(), {
        actor: req.driverSession.driverId,
        action: "return_pickup_duplicate_attempt",
        entityType: "order",
        entityId: o.id,
        meta: {
          collectionId: o.returnRequest.collectionId || null,
          returnPickupStatus: o.returnRequest.returnPickupStatus,
        },
      });
      saveDb();
      return res.status(409).json({
        ok: false,
        error: "already_collected",
        message: "این کالا قبلاً دریافت شده است.",
        returnPickupStatus: o.returnRequest.returnPickupStatus,
        pickedUpAt: o.returnRequest.pickedUpAt || null,
        collectionId: o.returnRequest.collectionId || null,
      });
    }
    const photos = o.returnRequest.pickupPhotos || [];
    if (o.returnRequest.photoRequired && !photos.length) {
      return res.status(400).json({ error: "photo_required" });
    }
    const collectionId = "rpc_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
    const qty = (o.items || []).reduce((s, it) => s + (Number(it.qty) || 0), 0) || 1;
    o.returnRequest.returnPickupStatus = "picked_up";
    o.returnRequest.pickedUpAt = Date.now();
    o.returnRequest.pickedUpByDriverId = req.driverSession.driverId;
    o.returnRequest.pickupConfirmed = true;
    o.returnRequest.collectionId = collectionId;
    o.returnRequest.collectedQty = qty;
    /* Inventory must NOT restore here */
    saveDb();
    pushAudit(db(), {
      actor: req.driverSession.driverId,
      action: "return_pickup_confirmed",
      entityType: "order",
      entityId: o.id,
      meta: { collectionId, qty },
    });
    if (mail() && o.customer && o.customer.email) {
      mail().orderStatus(o.customer.email, o, "کالای برگشتی دریافت شد", o.lang || "fa").catch(() => {});
    }
    res.json({
      ok: true,
      returnPickupStatus: "picked_up",
      pickedUpAt: o.returnRequest.pickedUpAt,
      collectionId,
      collectedQty: qty,
    });
  });

  app.post("/api/driver/return-pickups/:id/photo", requireDriverLocal, (req, res) => {
    upload.single("file")(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message || "upload_failed" });
      const o = (db().orders || []).find((x) => x && x.id === req.params.id);
      if (!o || !o.returnRequest) return res.status(404).json({ error: "not_found" });
      if (o.returnRequest.returnDriverId !== req.driverSession.driverId) {
        return res.status(403).json({ error: "not_your_job" });
      }
      if (!req.file) return res.status(400).json({ error: "no_file" });
      const rel = "/uploads/return-proofs/" + req.file.filename;
      if (!Array.isArray(o.returnRequest.pickupPhotos)) o.returnRequest.pickupPhotos = [];
      o.returnRequest.pickupPhotos.push({ url: rel, at: Date.now(), by: req.driverSession.driverId });
      saveDb();
      pushAudit(db(), {
        actor: req.driverSession.driverId,
        action: "return_pickup_photo",
        entityType: "order",
        entityId: o.id,
      });
      res.json({ ok: true, photos: o.returnRequest.pickupPhotos });
    });
  });

  app.post("/api/driver/return-pickups/:id/cash-refund", requireDriverLocal, (req, res) => {
    const o = (db().orders || []).find((x) => x && x.id === req.params.id);
    if (!o || !o.returnRequest) return res.status(404).json({ error: "not_found" });
    if (o.returnRequest.returnDriverId !== req.driverSession.driverId) {
      return res.status(403).json({ error: "not_your_job" });
    }
    if (!isCashPayment(o)) return res.status(403).json({ error: "cash_refund_not_allowed" });
    if (o.returnRequest.cashRefundPaid) return res.status(409).json({ error: "already_paid" });
    const st = String(o.returnRequest.returnPickupStatus || "");
    if (st !== "picked_up" && st !== "returned_to_store" && st !== "completed" && !o.returnRequest.pickupConfirmed) {
      return res.status(400).json({ error: "pickup_not_confirmed", message: "ابتدا تحویل گرفتن جنس برگشتی را تأیید کنید." });
    }
    const amount = approvedRefundAmount(o);
    o.returnRequest.cashRefundPaid = true;
    o.returnRequest.cashRefundAmount = amount;
    o.returnRequest.cashRefundPaidAt = Date.now();
    o.returnRequest.cashRefundPaidByDriverId = req.driverSession.driverId;
    o.returnRequest.refundStatus = "paid";
    o.returnRequest.refundMethod = "cash";
    saveDb();
    pushAudit(db(), {
      actor: req.driverSession.driverId,
      action: "cash_refund_paid",
      entityType: "order",
      entityId: o.id,
      meta: { amount },
    });
    res.json({
      ok: true,
      cashRefundPaid: true,
      cashRefundAmount: amount,
      refundStatus: "paid",
    });
  });

  /* Admin: mark returned to store (triggers restock path separately via return_completed) */
  app.post("/api/admin/orders/:id/return-to-store", requireAdminAnyPerm(["returns", "orders"]), (req, res) => {
    const o = (db().orders || []).find((x) => x && x.id === req.params.id);
    if (!o || !o.returnRequest) return res.status(404).json({ error: "not_found" });
    o.returnRequest.returnPickupStatus = "returned_to_store";
    o.returnRequest.returnedToStoreAt = Date.now();
    saveDb();
    pushAudit(db(), { actor: actorName(req), action: "return_to_store", entityType: "order", entityId: o.id });
    res.json({ ok: true, returnRequest: o.returnRequest });
  });

  /* Expose helpers for other mounts */
  ctx.applyDeliveryReturnPolicy = (order) => applyDeliveryReturnPolicy(db(), order);
  ctx.customerMayRequestReturn = customerMayRequestReturn;
  ctx.resolveReasonSnapshot = (reasonId, title) => resolveReasonSnapshot(db(), reasonId, title);
  ctx.isStorePickupOrder = isStorePickupOrder;
  ctx.getReturnWindowDays = () => getReturnWindowDays(db());
  ctx.fulfillmentType = fulfillmentType;
}

module.exports = { mountOpsSuite };
