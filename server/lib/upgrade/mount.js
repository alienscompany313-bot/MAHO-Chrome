"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");
const multer = require("multer");
const { pushAudit } = require("../audit");
const { createRateLimiter, clientIp, sanitizeText } = require("../security");
const hours = require("./hours");
const ads = require("./ads");
const policies = require("./policies");
const cards = require("./customer-card");
const passkeys = require("./passkeys");
const notes = require("./notifications");
const links = require("./links");
const backups = require("./backups");
const life = require("./account-life");
const coupons = require("./coupons");
const ledger = require("./ledger");
const content = require("./content");
const contacts = require("./contact-methods");
const favorites = require("./favorites");
const { snapshotAddress } = require("./address");
const pages = require("./pages");
const { safeHttpUrl } = require("./safe-url");

const rlPasskey = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 30 });
const rlAds = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 80 });
const rlCard = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 40 });

function ensure(db) {
  let changed = false;
  if (hours.ensureStoreHours(db)) changed = true;
  if (ads.ensureAds(db)) changed = true;
  if (policies.ensurePolicies(db)) changed = true;
  if (links.ensureLinks(db)) changed = true;
  if (coupons.ensureCoupons(db)) changed = true;
  if (ledger.ensureLedger(db)) changed = true;
  if (notes.ensureNotes(db)) changed = true;
  if (content.ensureContent(db)) changed = true;
  if (contacts.ensureContactMethods(db)) changed = true;
  passkeys.ensurePasskeys(db);
  if (!db.siteMeta || typeof db.siteMeta !== "object") {
    db.siteMeta = {
      documentTitle: "",
      documentTitle_en: "",
      metaDescription: "",
      metaDescription_en: "",
      footerMapsUrl: "",
    };
    changed = true;
  }
  if (!Array.isArray(db.backupLog)) { db.backupLog = []; changed = true; }
  if (!db.adminSecurity) { db.adminSecurity = { recoveryCodes: [], envRecoveryUsedHash: "" }; changed = true; }
  if (!Array.isArray(db.adminAuthChallenges)) { db.adminAuthChallenges = []; changed = true; }
  return changed;
}

function publicSite(db) {
  ensure(db);
  const terms = policies.publicPolicy(db, "terms");
  const privacy = policies.publicPolicy(db, "privacy");
  const meta = db.siteMeta || {};
  return {
    documentTitle: meta.documentTitle || "",
    documentTitle_en: meta.documentTitle_en || "",
    metaDescription: meta.metaDescription || "",
    metaDescription_en: meta.metaDescription_en || "",
    footerMapsUrl: meta.footerMapsUrl || "",
    storeHours: db.storeHours,
    ads: ads.publicAds(db),
    whyMaho: content.publicWhy(db),
    socials: content.publicSocials(db),
    contactMethods: contacts.publicContactMethods(db),
    publicUrl: String(process.env.SITE_URL || process.env.PUBLIC_URL || "").replace(/\/+$/, ""),
    policies: {
      terms: !!terms,
      privacy: !!privacy,
      returns: !!policies.published(db, "returns"),
      termsVersion: terms ? terms.version : null,
      privacyVersion: privacy ? privacy.version : null,
    },
  };
}

function audit(db, req, action, entityType, entityId, meta) {
  const s = req && req.adminSession;
  pushAudit(db, {
    actor: (s && (s.name || s.staffId)) || (req && req.auditActor) || "system",
    action: action,
    entityType: entityType || "",
    entityId: entityId || "",
    meta: Object.assign({ outcome: "ok" }, meta || {}),
  });
}

function auditCatalog(db, before, after, actor) {
  const prev = new Map();
  (before || []).forEach((p) => { if (p && p.code) prev.set(String(p.code), p); });
  (after || []).forEach((p) => {
    if (!p || !p.code) return;
    const old = prev.get(String(p.code));
    if (!old) {
      pushAudit(db, { actor: actor || "admin", action: "product_created", entityType: "product", entityId: String(p.code), meta: { outcome: "ok", name: String(p.name || "").slice(0, 80) } });
      return;
    }
    if (Number(old.price) !== Number(p.price)) {
      pushAudit(db, { actor: actor || "admin", action: "price_changed", entityType: "product", entityId: String(p.code), meta: { outcome: "ok", from: Number(old.price) || 0, to: Number(p.price) || 0 } });
    }
    if (String(old.stock) !== String(p.stock)) {
      pushAudit(db, { actor: actor || "admin", action: "inventory_adjusted", entityType: "product", entityId: String(p.code), meta: { outcome: "ok", from: old.stock, to: p.stock } });
    }
    const fields = ["name", "name_en", "cat", "discount", "enabled", "active", "description", "barcode", "sku", "storeAvailabilityMode"];
    const changed = fields.filter((k) => JSON.stringify(old[k] == null ? null : old[k]) !== JSON.stringify(p[k] == null ? null : p[k]));
    ["sizes", "colors", "storeIds", "images"].forEach((k) => {
      if (JSON.stringify(old[k] || null) !== JSON.stringify(p[k] || null)) changed.push(k);
    });
    if (changed.length) {
      pushAudit(db, {
        actor: actor || "admin",
        action: "product_updated",
        entityType: "product",
        entityId: String(p.code),
        meta: { outcome: "ok", fields: changed.slice(0, 12).join(",") },
      });
    }
  });
  const afterCodes = new Set((after || []).map((p) => p && p.code).filter(Boolean).map(String));
  (before || []).forEach((p) => {
    if (!p || !p.code || afterCodes.has(String(p.code))) return;
    pushAudit(db, { actor: actor || "admin", action: "product_removed", entityType: "product", entityId: String(p.code), meta: { outcome: "ok", name: String(p.name || "").slice(0, 80) } });
  });
}

function scheduleBackup(ctx) {
  const dir = process.env.BACKUP_DIR || "";
  const secret = process.env.BACKUP_ENCRYPTION_KEY || "";
  if (!dir || !secret) return;
  const run = () => {
    try {
      const result = backups.createBackup({
        dataDir: ctx.DATA_DIR,
        uploadDir: ctx.UPLOAD_DIR,
        backupDir: dir,
        secret: secret,
      });
      const removed = backups.pruneOld(dir, process.env.BACKUP_RETENTION_DAYS || "14");
      backups.record(ctx.db, { action: result.ok ? "backup_ok" : "backup_failed", error: result.error || "", files: result.files || 0, removed: removed });
      ctx.saveDb();
    } catch (err) {
      try {
        backups.record(ctx.db, { action: "backup_failed", error: String(err && err.message || err).slice(0, 160) });
        ctx.saveDb();
      } catch (_) {}
    }
  };
  const hoursMs = Math.max(6, parseInt(process.env.BACKUP_INTERVAL_HOURS || "24", 10) || 24) * 60 * 60 * 1000;
  setInterval(run, hoursMs).unref();
  if (process.env.BACKUP_ON_START === "true") setTimeout(run, 15000).unref();
}

function mount(app, ctx) {
  const db = () => ctx.db;
  const save = () => ctx.saveDb();
  const pepper = () => ctx.TOKEN_PEPPER;
  const siteUrl = () => ctx.SITE_URL || "https://mahomarket.com";
  const mail = () => ctx.mail;
  const allowDev = () => !!ctx.ALLOW_DEV_CODES;

  function guard(perm) {
    return ctx.requireAdminAnyPerm ? ctx.requireAdminAnyPerm([perm, "settings"]) : ctx.requireAdmin;
  }

  app.get("/api/site", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ site: publicSite(db()) });
  });

  app.get("/api/store-hours", (req, res) => {
    const storeId = String(req.query.storeId || "");
    let schedule = db().storeHours;
    if (storeId) {
      const store = (db().stores || []).find((s) => s && (s.id === storeId));
      if (store && store.hoursSchedule) schedule = store.hoursSchedule;
    }
    res.setHeader("Cache-Control", "no-store");
    res.json(hours.statusFor(schedule, new Date()));
  });

  app.get("/api/admin/store-hours", ctx.requireAdminAnyPerm(["settings", "stores"]), (req, res) => {
    res.json({ schedule: db().storeHours, stores: (db().stores || []).map((s) => ({ id: s.id, name: s.name, hoursSchedule: s.hoursSchedule || null })) });
  });
  app.put("/api/admin/store-hours", ctx.requireAdminAnyPerm(["settings", "stores"]), (req, res) => {
    const body = req.body || {};
    if (body.storeId) {
      const store = (db().stores || []).find((s) => s && s.id === body.storeId);
      if (!store) return res.status(404).json({ error: "not_found" });
      if (body.useGlobal) delete store.hoursSchedule;
      else store.hoursSchedule = hours.normalizeSchedule(body.schedule || body);
    } else {
      db().storeHours = hours.normalizeSchedule(body.schedule || body);
    }
    audit(db(), req, "store_hours_updated", "store", body.storeId || "global", { outcome: body.useGlobal ? "use_global" : "ok" });
    save();
    const saved = body.storeId
      ? ((db().stores || []).find((s) => s && s.id === body.storeId) || {}).hoursSchedule || null
      : db().storeHours;
    res.json({ ok: true, storeId: body.storeId || null, schedule: saved, global: db().storeHours });
  });

  app.get("/api/admin/site-meta", ctx.requireAdminAnyPerm(["settings"]), (req, res) => {
    res.json({ siteMeta: db().siteMeta || {} });
  });
  app.put("/api/admin/site-meta", ctx.requireAdminAnyPerm(["settings"]), (req, res) => {
    const b = req.body || {};
    const meta = db().siteMeta || {};
    if (b.documentTitle != null) meta.documentTitle = sanitizeText(b.documentTitle, 120);
    if (b.documentTitle_en != null) meta.documentTitle_en = sanitizeText(b.documentTitle_en, 120);
    if (b.metaDescription != null) meta.metaDescription = sanitizeText(b.metaDescription, 300);
    if (b.metaDescription_en != null) meta.metaDescription_en = sanitizeText(b.metaDescription_en, 300);
    if (b.footerMapsUrl != null) {
      const url = safeHttpUrl(b.footerMapsUrl);
      if (b.footerMapsUrl && !url) return res.status(400).json({ error: "bad_url" });
      meta.footerMapsUrl = url;
    }
    db().siteMeta = meta;
    audit(db(), req, "site_meta_updated", "config", "site", { keys: Object.keys(b) });
    save();
    res.json({ siteMeta: meta });
  });

  app.get("/api/admin/ads", ctx.requireAdminAnyPerm(["marketing", "settings"]), (req, res) => {
    res.json(ads.adminAds(db()));
  });
  app.put("/api/admin/ads/:area", ctx.requireAdminAnyPerm(["marketing", "settings"]), (req, res) => {
    const out = ads.saveArea(db(), req.params.area, (req.body && req.body.items) || []);
    if (out.error) return res.status(400).json({ error: out.error });
    audit(db(), req, "ads_updated", "ads", req.params.area, { count: ((req.body && req.body.items) || []).length });
    save();
    res.json(out.ads);
  });
  app.post("/api/ads/impression", (req, res) => {
    if (!rlAds(clientIp(req) + ":imp").ok) return res.status(429).json({ error: "rate_limited" });
    const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.slice(0, 20) : [];
    ids.forEach((id) => ads.bump(db(), String(id), "impressions"));
    save();
    res.json({ ok: true });
  });
  app.get("/api/ads/go/:id", (req, res) => {
    const ad = ads.findAd(db(), req.params.id);
    if (!ad || !ads.isLive(ad) || !ad.url) return res.status(404).json({ error: "not_found" });
    ads.bump(db(), ad.id, "clicks");
    save();
    res.redirect(302, ad.url);
  });

  app.get("/api/policies/:kind", (req, res) => {
    const row = policies.publicPolicy(db(), req.params.kind);
    if (!row) return res.status(404).json({ error: "not_published" });
    res.setHeader("Cache-Control", "no-store");
    res.json({ policy: row });
  });
  app.get("/api/policies/:kind/pdf", (req, res) => {
    const row = policies.published(db(), req.params.kind);
    if (!row || !row.pdfFile) return res.status(404).json({ error: "not_found" });
    const abs = policies.pdfPath(ctx.DATA_DIR, row.pdfFile);
    if (!abs || !fs.existsSync(abs)) return res.status(404).json({ error: "missing_file" });
    res.setHeader("Cache-Control", "private, no-store");
    res.type("application/pdf");
    res.sendFile(abs);
  });
  app.get("/terms", (req, res) => {
    res.type("html").send(pages.policyPage("terms", policies.publicPolicy(db(), "terms")));
  });
  app.get("/privacy", (req, res) => {
    res.type("html").send(pages.policyPage("privacy", policies.publicPolicy(db(), "privacy")));
  });
  app.get("/api/admin/policies", ctx.requireAdminAnyPerm(["settings"]), (req, res) => {
    res.json(policies.adminView(db()));
  });
  app.post("/api/admin/policies/:kind", ctx.requireAdminAnyPerm(["settings"]), (req, res) => {
    const out = policies.upsertDraft(db(), req.params.kind, req.body || {});
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    audit(db(), req, "policy_draft_saved", "policy", req.params.kind, { version: out.version.version });
    save();
    res.json(out);
  });
  app.post("/api/admin/policies/:kind/starter", ctx.requireAdminAnyPerm(["settings"]), (req, res) => {
    const out = policies.createStarter(db(), req.params.kind);
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    save();
    res.json(out);
  });
  app.post("/api/admin/policies/:kind/:id/publish", ctx.requireAdminAnyPerm(["settings"]), (req, res) => {
    const out = policies.publish(db(), req.params.kind, req.params.id);
    if (!out.error && req.body && req.body.notify === true && out.version) {
      policies.queueNotice(db(), req.params.kind, out.version.id);
    }
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    audit(db(), req, "policy_published", "policy", req.params.kind, { version: out.version.version, notify: !!(req.body && req.body.notify === true) });
    save();
    res.json(out);
  });
  app.post("/api/admin/policies/:kind/:id/unpublish", ctx.requireAdminAnyPerm(["settings"]), (req, res) => {
    const out = policies.unpublish(db(), req.params.kind, req.params.id);
    if (out.error) return res.status(out.status || 400).json(out);
    audit(db(), req, "policy_unpublished", "policy", req.params.id, {});
    save();
    res.json(out);
  });
  app.post("/api/admin/policies/:kind/:id/archive", ctx.requireAdminAnyPerm(["settings"]), (req, res) => {
    const out = policies.archiveVersion(db(), req.params.kind, req.params.id);
    if (out.error) return res.status(out.status || 400).json(out);
    audit(db(), req, "policy_archived", "policy", req.params.id, {});
    save();
    res.json(out);
  });
  app.delete("/api/admin/policies/:kind/:id", ctx.requireAdminAnyPerm(["settings"]), (req, res) => {
    const out = policies.removeDraft(db(), req.params.kind, req.params.id);
    if (out.error) return res.status(out.status || 400).json(out);
    audit(db(), req, "policy_draft_deleted", "policy", req.params.id, {});
    save();
    res.json(out);
  });

  const pdfUpload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, policies.ensurePdfDir(ctx.DATA_DIR)),
      filename: (req, file, cb) => cb(null, "pol-" + crypto.randomBytes(8).toString("hex") + ".pdf"),
    }),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
      if (file.mimetype !== "application/pdf") return cb(new Error("pdf_only"));
      cb(null, true);
    },
  });
  app.post("/api/admin/policies/:kind/:id/pdf", ctx.requireAdminAnyPerm(["settings"]), (req, res) => {
    pdfUpload.single("file")(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message || "upload_failed" });
      if (!req.file) return res.status(400).json({ error: "file_required" });
      const buf = fs.readFileSync(req.file.path);
      if (!(buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46)) {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
        return res.status(400).json({ error: "invalid_pdf" });
      }
      const out = policies.attachPdf(db(), req.params.kind, req.params.id, req.file.filename);
      if (out.error) return res.status(out.status || 400).json({ error: out.error });
      audit(db(), req, "policy_pdf_uploaded", "policy", req.params.id, {});
      save();
      res.json({ ok: true });
    });
  });

  app.get("/api/admin/links", ctx.requireAdminAnyPerm(["settings", "marketing"]), (req, res) => {
    links.ensureLinks(db());
    res.json({
      links: db().linkPage.links,
      subtitle: db().linkPage.subtitle || "",
      subtitle_en: db().linkPage.subtitle_en || "",
    });
  });
  app.put("/api/admin/links", ctx.requireAdminAnyPerm(["settings", "marketing"]), (req, res) => {
    const body = req.body || {};
    const page = links.saveLinks(db(), body.links || [], { subtitle: body.subtitle, subtitle_en: body.subtitle_en });
    audit(db(), req, "links_updated", "links", "page", { count: page.links.length });
    save();
    res.json({ links: page.links, subtitle: page.subtitle || "", subtitle_en: page.subtitle_en || "" });
  });
  async function linksQr(type) {
    const url = siteUrl().replace(/\/+$/, "") + "/links";
    if (type === "svg") return QRCode.toString(url, { type: "svg", margin: 1, width: 320 });
    return QRCode.toBuffer(url, { type: "png", margin: 1, width: 512, errorCorrectionLevel: "M" });
  }
  app.get("/links", async (req, res) => {
    const rows = links.publicLinks(db());
    let qr = "";
    try { qr = await QRCode.toDataURL(siteUrl().replace(/\/+$/, "") + "/links", { margin: 1, width: 280 }); } catch (_) {}
    res.type("html").send(pages.linksPage(rows, qr, db().linkPage || {}));
  });
  app.get("/links/qr.png", async (req, res) => {
    const buf = await linksQr("png");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.type("png").send(buf);
  });
  app.get("/links/qr.svg", async (req, res) => {
    const svg = await linksQr("svg");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.type("image/svg+xml").send(svg);
  });

  app.get("/verify/:token", (req, res) => {
    const found = cards.findByToken(db(), req.params.token, pepper());
    const pub = cards.publicCardStatus(found);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.type("html").send(pages.verifyPage(pub || { status: "missing" }));
  });
  app.get("/api/verify/:token", (req, res) => {
    const found = cards.findByToken(db(), req.params.token, pepper());
    const pub = cards.publicCardStatus(found);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    if (!pub) return res.status(404).json({ ok: false, status: "missing", brand: "MAHO" });
    res.json(pub);
  });
  app.get("/api/admin/cards/lookup", ctx.requireAdminAnyPerm(["customers", "orders"]), (req, res) => {
    const found = cards.findByToken(db(), String(req.query.token || ""), pepper());
    if (!found) return res.status(404).json({ error: "not_found" });
    res.setHeader("Cache-Control", "no-store");
    res.json(cards.staffCardView(found));
  });

  app.get("/api/me/card", ctx.requireUser, (req, res) => {
    const card = cards.ensureCard(req.user, pepper());
    if (!card) return res.status(400).json({ error: "no_customer_number" });
    save();
    res.json({ card: cards.summary(req.user) });
  });
  app.get("/api/me/card.png", ctx.requireUser, async (req, res) => {
    if (!rlCard(clientIp(req) + ":card").ok) return res.status(429).json({ error: "rate_limited" });
    const card = cards.ensureCard(req.user, pepper());
    if (!card) return res.status(400).json({ error: "no_customer_number" });
    if (card.status === "revoked") return res.status(403).json({ error: "card_revoked" });
    save();
    const png = await cards.renderCardPng(req.user, siteUrl());
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", "attachment; filename=\"maho-customer-card.png\"");
    res.type("png").send(png);
  });
  app.get("/api/me/card.pdf", ctx.requireUser, async (req, res) => {
    if (!rlCard(clientIp(req) + ":cardpdf").ok) return res.status(429).json({ error: "rate_limited" });
    const card = cards.ensureCard(req.user, pepper());
    if (!card) return res.status(400).json({ error: "no_customer_number" });
    if (card.status === "revoked") return res.status(403).json({ error: "card_revoked" });
    const png = await cards.renderCardPng(req.user, siteUrl());
    const pdf = await cards.renderCardPdf(png);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", "attachment; filename=\"maho-customer-card.pdf\"");
    res.type("pdf").send(pdf);
  });
  app.post("/api/me/card/email", ctx.requireUser, async (req, res) => {
    const card = cards.ensureCard(req.user, pepper());
    if (!card || card.status === "revoked") return res.status(403).json({ error: "card_unavailable" });
    const user = req.user;
    if (!user.email) return res.status(400).json({ error: "no_email" });
    if (user.cardEmailNextAt && Date.now() < user.cardEmailNextAt) {
      return res.status(429).json({ error: "resend_cooldown", retryAt: user.cardEmailNextAt });
    }
    const requestedTo = req.body && req.body.to;
    if (requestedTo && String(requestedTo).toLowerCase() !== String(user.email).toLowerCase()) {
      return res.status(400).json({ error: "recipient_locked" });
    }
    try {
      const m = mail();
      if (!m || typeof m.customerCard !== "function") {
        return res.status(503).json({ error: "email_unavailable" });
      }
      const png = await cards.renderCardPng(user, siteUrl());
      const sent = await m.customerCard(user.email, user, png);
      if (!sent) return res.status(503).json({ error: "email_unavailable" });
      user.cardEmailNextAt = Date.now() + 60 * 1000;
      if (user.card) user.card.emailedAt = Date.now();
      save();
      res.json({ ok: true, sentTo: user.email });
    } catch (err) {
      pushAudit(db(), { actor: "system", action: "email_failed", entityType: "customer_card", entityId: user.id, meta: { outcome: "failed" } });
      save();
      res.status(503).json({ error: "email_failed" });
    }
  });

  app.post("/api/me/deactivate", ctx.requireUser, (req, res) => {
    const out = life.deactivate(req.user);
    if (out.error) return res.status(out.status || 400).json(out);
    audit(db(), req, "account_deactivated", "user", req.user.id, {});
    save();
    res.json({ ok: true, accountStatus: life.stateOf(req.user) });
  });
  app.post("/api/me/reactivate", ctx.requireUser, (req, res) => {
    const out = life.reactivate(req.user);
    if (out.error) return res.status(out.status || 400).json(out);
    audit(db(), req, "account_reactivated", "user", req.user.id, {});
    save();
    res.json({ ok: true, accountStatus: life.stateOf(req.user) });
  });
  app.post("/api/me/delete/start", ctx.requireUser, async (req, res) => {
    const out = life.beginDeletion(req.user, pepper(), !!ctx.ALLOW_DEV_CODES);
    if (out.error) return res.status(out.status || 400).json(out);
    save();
    const m = mail();
    if (m && typeof m.deletionCode === "function") {
      try { await m.deletionCode(req.user.email, out.code, req.user.name); } catch (_) {}
    }
    const body = { ok: true, expiresInSec: out.expiresInSec };
    if (out.devCode && ctx.ALLOW_DEV_CODES) body.devCode = out.devCode;
    res.json(body);
  });
  app.post("/api/me/delete/confirm", ctx.requireUser, (req, res) => {
    const body = req.body || {};
    const out = life.confirmDeletion(req.user, body.code, body.confirm, pepper());
    if (out.error) {
      save();
      return res.status(out.status || 400).json(out);
    }
    const id = req.user.id;
    life.anonymize(req.user);
    if (ctx.sessions) life.revokeSessions(ctx.sessions, id);
    audit(db(), req, "account_deleted", "user", id, {});
    save();
    res.json({ ok: true, deleted: true });
  });
  app.post("/api/admin/customers/:id/account-status", ctx.requireAdminAnyPerm(["customers"]), (req, res) => {
    const user = (db().users || []).find((u) => u && u.id === req.params.id);
    if (!user) return res.status(404).json({ error: "not_found" });
    const body = req.body || {};
    const actor = (req.adminSession && (req.adminSession.email || req.adminSession.id)) || "admin";
    const out = life.applyStatus(user, body.status, body.reason, actor);
    if (out.error) return res.status(out.status || 400).json(out);
    if (body.status === "blocked" || body.status === "hold") {
      if (ctx.sessions) life.revokeSessions(ctx.sessions, user.id);
    }
    if (body.status === "blocked") {
      life.rememberReason(user, body.publicReason || body.reason, body.internalNote);
      life.queueStatusMail(user, "blocked", user.blockReason);
    }
    if (body.status === "active") {
      user.blockedBySchedule = false;
      if (user.blockSchedule && !user.blockSchedule.completed) user.blockSchedule.cancelled = true;
      life.queueStatusMail(user, "reinstated", body.reason || "");
    }
    audit(db(), req, "customer_status", "user", user.id, { status: body.status });
    save();
    res.json({ ok: true, accountStatus: life.stateOf(user), reason: user.blockReason || "", schedule: life.publicSchedule(user) });
  });
  app.post("/api/admin/customers/:id/block-schedule", ctx.requireAdminAnyPerm(["customers"]), (req, res) => {
    const user = (db().users || []).find((u) => u && u.id === req.params.id);
    if (!user) return res.status(404).json({ error: "not_found" });
    const actor = (req.adminSession && (req.adminSession.email || req.adminSession.id)) || "admin";
    const out = life.scheduleBlock(user, req.body || {}, actor);
    if (out.error) return res.status(out.status || 400).json(out);
    if (life.stateOf(user) === "blocked" && ctx.sessions) life.revokeSessions(ctx.sessions, user.id);
    audit(db(), req, "customer_block_scheduled", "user", user.id, { startAt: user.blockSchedule && user.blockSchedule.startAt });
    save();
    res.json(out);
  });
  app.post("/api/admin/customers/:id/block-schedule/cancel", ctx.requireAdminAnyPerm(["customers"]), (req, res) => {
    const user = (db().users || []).find((u) => u && u.id === req.params.id);
    if (!user) return res.status(404).json({ error: "not_found" });
    const actor = (req.adminSession && (req.adminSession.email || req.adminSession.id)) || "admin";
    const out = life.cancelSchedule(user, actor);
    if (out.error) return res.status(out.status || 400).json(out);
    audit(db(), req, "customer_block_schedule_cancelled", "user", user.id, {});
    save();
    res.json(out);
  });
  app.get("/api/admin/why-maho", ctx.requireAdminAnyPerm(["settings"]), (req, res) => {
    content.ensureContent(db());
    res.json({ whyMaho: db().whyMaho });
  });
  app.put("/api/admin/why-maho", ctx.requireAdminAnyPerm(["settings"]), (req, res) => {
    const saved = content.saveWhy(db(), req.body || {});
    audit(db(), req, "why_maho_updated", "content", "why", { enabled: saved.enabled });
    save();
    res.json({ whyMaho: saved });
  });
  app.get("/api/admin/footer-socials", ctx.requireAdminAnyPerm(["settings"]), (req, res) => {
    content.ensureContent(db());
    res.json({ socials: db().footerSocials });
  });
  app.get("/api/admin/contact-methods", ctx.requireAdminAnyPerm(["settings"]), (req, res) => {
    contacts.ensureContactMethods(db());
    res.json({ methods: db().contactMethods, publicMethods: contacts.publicContactMethods(db()) });
  });
  app.put("/api/admin/contact-methods", ctx.requireAdminAnyPerm(["settings"]), (req, res) => {
    const saved = contacts.saveContactMethods(db(), (req.body && req.body.methods) || []);
    audit(db(), req, "contact_methods_updated", "content", "contacts", { count: saved.length });
    save();
    res.json({ methods: saved, publicMethods: contacts.publicContactMethods(db()) });
  });
  app.get("/api/me/favorites", ctx.requireUser, (req, res) => {
    res.json(favorites.list(db(), req.user));
  });
  app.post("/api/me/favorites", ctx.requireUser, (req, res) => {
    const out = favorites.toggle(db(), req.user, (req.body || {}).code);
    if (out.error) return res.status(out.status || 400).json(out);
    save();
    res.json(out);
  });
  app.delete("/api/me/favorites/:code", ctx.requireUser, (req, res) => {
    const out = favorites.remove(db(), req.user, req.params.code);
    save();
    res.json(out);
  });
  app.put("/api/admin/footer-socials", ctx.requireAdminAnyPerm(["settings"]), (req, res) => {
    const saved = content.saveSocials(db(), (req.body && req.body.socials) || []);
    audit(db(), req, "footer_socials_updated", "content", "socials", { count: saved.length });
    save();
    res.json({ socials: saved, publicSocials: content.publicSocials(db()) });
  });

  app.get("/api/admin/coupons", ctx.requireAdminAnyPerm(["settings", "orders"]), (req, res) => {
    res.json({ coupons: coupons.publicAdmin(db()) });
  });
  app.put("/api/admin/coupons", ctx.requireAdminAnyPerm(["settings"]), (req, res) => {
    const list = coupons.saveAll(db(), (req.body && req.body.coupons) || []);
    audit(db(), req, "coupons_updated", "coupon", "list", { count: list.length });
    save();
    res.json({ coupons: coupons.publicAdmin(db()) });
  });
  app.post("/api/coupons/preview", ctx.requireUser, (req, res) => {
    const body = req.body || {};
    const raw = Array.isArray(body.items) ? body.items : [];
    const items = raw.map((it) => {
      const code = String((it && (it.code || it.sku)) || "").trim().toLowerCase();
      const product = (db().products || []).find((p) => p && [p.code, p.sku].some((v) => String(v || "").trim().toLowerCase() === code));
      const price = product ? Number(product.price) || 0 : 0;
      return { code: product ? (product.code || code) : code, cat: product ? product.cat : "", qty: it.qty || 1, price: price };
    }).filter((it) => it.price > 0);
    const out = coupons.evaluate(db(), body.code, req.user, items);
    if (out.error) return res.status(out.status || 400).json(out);
    res.json(out);
  });

  function financeQuery(req) {
    return {
      range: req.query.range,
      fromDay: req.query.from,
      toDay: req.query.to,
      method: req.query.method,
      paymentStatus: req.query.paymentStatus,
      orderStatus: req.query.orderStatus,
      channel: req.query.channel,
      q: req.query.q,
    };
  }
  app.get("/api/admin/finance", ctx.requireAdminAnyPerm(["orders", "settings"]), (req, res) => {
    const report = ledger.summarize(db(), financeQuery(req));
    res.json({
      range: report.range,
      kpi: ledger.majorKpi(report),
      reconciled: report.reconciled,
      exceptions: report.exceptions,
      orders: report.orders.map((a) => ({
        orderId: a.orderId,
        status: a.status,
        payment: a.payment,
        customer: a.customer,
        gross: ledger.fromMinor(a.grossMinor),
        net: ledger.fromMinor(a.totalMinor),
        collected: ledger.fromMinor(a.collectedMinor),
        netCollected: ledger.fromMinor(a.netCollectedMinor),
        outstanding: ledger.fromMinor(a.outstandingMinor),
        refundDue: ledger.fromMinor(a.refundDueMinor),
        amountDue: ledger.fromMinor(a.amountDueMinor),
        adjustments: ledger.fromMinor(a.creditMinor),
        refunded: ledger.fromMinor(a.refundedMinor),
        pendingRefund: ledger.fromMinor(a.pendingRefundMinor),
        returned: ledger.fromMinor(a.returnedMinor),
        legacy: a.legacy,
      })),
      methods: Object.keys(report.methods || {}).reduce((out, name) => {
        out[name] = ledger.fromMinor(report.methods[name]);
        return out;
      }, {}),
    });
  });
  app.get("/api/admin/finance/detail", ctx.requireAdminAnyPerm(["orders", "settings"]), (req, res) => {
    const report = ledger.summarize(db(), financeQuery(req));
    const key = String(req.query.key || "collected");
    const detail = ledger.detailFor(report, key);
    const counts = { paidOrders: 1, unpaidOrders: 1, partialOrders: 1, canceledOrders: 1, legacyUnverified: 1 };
    const present = (amount) => counts[key] ? amount : ledger.fromMinor(amount);
    res.json({
      key: key,
      matches: detail.matches,
      sum: present(detail.sumMinor),
      kpi: present(detail.kpiMinor),
      lines: detail.lines.map((row) => ({
        orderId: row.orderId || "",
        txnId: row.txnId || "",
        source: row.source || "",
        amount: present(row.amountMinor),
      })),
    });
  });
  app.get("/api/admin/finance/export.csv", ctx.requireAdminAnyPerm(["orders", "settings"]), (req, res) => {
    const report = ledger.summarize(db(), financeQuery(req));
    audit(db(), req, "finance_export", "finance", "csv", {});
    save();
    res.setHeader("Content-Disposition", "attachment; filename=\"maho-finance.csv\"");
    res.type("text/csv").send(ledger.toCsv(report));
  });
  app.get("/api/admin/finance/export.xls", ctx.requireAdminAnyPerm(["orders", "settings"]), (req, res) => {
    const report = ledger.summarize(db(), financeQuery(req));
    audit(db(), req, "finance_export", "finance", "xls", {});
    save();
    res.setHeader("Content-Disposition", "attachment; filename=\"maho-finance.xls\"");
    res.type("application/vnd.ms-excel").send(ledger.toExcelXml(report));
  });
  app.get("/api/admin/finance/export.pdf", ctx.requireAdminAnyPerm(["orders", "settings"]), async (req, res) => {
    const report = ledger.summarize(db(), financeQuery(req));
    const PDFDocument = require("pdfkit");
    const { Resvg } = require("@resvg/resvg-js");
    const kpi = ledger.majorKpi(report);
    const keys = Object.keys(ledger.KPI_FA || {});
    const height = 120 + keys.length * 32;
    const lines = keys.map((key, i) => {
      const label = ledger.KPI_FA[key] || key;
      const y = 90 + i * 32;
      return `<text x="860" y="${y}" text-anchor="end" font-family="Tahoma, sans-serif" font-size="16" fill="#1a1509">${label}</text>
        <text x="40" y="${y}" font-family="Tahoma, sans-serif" font-size="16" fill="#1a1509">${kpi[key] == null ? "" : kpi[key]}</text>`;
    }).join("");
    const svg = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="980" height="${height}" viewBox="0 0 980 ${height}"><rect width="980" height="${height}" fill="#fffdf8"/><text x="940" y="48" text-anchor="end" font-family="Tahoma, sans-serif" font-size="26" font-weight="700" fill="#1a1509">گزارش مالی ماهو</text>${lines}</svg>`;
    const png = new Resvg(svg, { fitTo: { mode: "width", value: 900 }, font: { defaultFontFamily: "Tahoma", sansSerifFamily: "Tahoma" } }).render().asPng();
    const buf = await new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: "A4", margin: 24 });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      doc.image(png, 24, 24, { width: 547 });
      doc.end();
    });
    audit(db(), req, "finance_export", "finance", "pdf", {});
    save();
    res.setHeader("Content-Disposition", "attachment; filename=\"maho-finance.pdf\"");
    res.type("pdf").send(buf);
  });
  app.post("/api/admin/orders/:id/payments", ctx.requireAdminAnyPerm(["orders"]), (req, res) => {
    const order = (db().orders || []).find((o) => o && o.id === req.params.id);
    const body = req.body || {};
    const out = ledger.recordPayment(db(), order, {
      amount: body.amount,
      method: body.method,
      status: body.status || "settled",
      channel: body.channel,
      idempotencyKey: body.idempotencyKey,
      externalRef: body.externalRef,
      actor: { id: (req.adminSession && req.adminSession.id) || "admin" },
      at: body.at,
    });
    if (out.error) return res.status(out.status || 400).json(out);
    if (out.txn && out.txn.status === "settled" && order) order.paymentStatus = "payment_confirmed";
    audit(db(), req, "payment_recorded", "order", req.params.id, { txn: out.txn && out.txn.id, duplicate: !!out.duplicate });
    save();
    res.json({ ok: true, duplicate: !!out.duplicate, transaction: out.txn, account: ledger.orderAccount(db(), order) });
  });
  app.post("/api/admin/orders/:id/refunds", ctx.requireAdminAnyPerm(["orders", "returns"]), (req, res) => {
    const order = (db().orders || []).find((o) => o && o.id === req.params.id);
    const body = req.body || {};
    const out = ledger.recordRefund(db(), order, {
      amount: body.amount,
      method: body.method,
      status: body.status || "pending",
      channel: body.channel,
      paymentId: body.paymentId,
      idempotencyKey: body.idempotencyKey,
      actor: { id: (req.adminSession && req.adminSession.id) || "admin" },
      at: body.at,
    });
    if (out.error) return res.status(out.status || 400).json(out);
    audit(db(), req, "refund_recorded", "order", req.params.id, { txn: out.txn && out.txn.id });
    save();
    res.json({ ok: true, duplicate: !!out.duplicate, transaction: out.txn, account: order ? ledger.orderAccount(db(), order) : null });
  });
  app.post("/api/admin/orders/:id/refunds/:txnId/settle", ctx.requireAdminAnyPerm(["orders", "returns"]), (req, res) => {
    const order = (db().orders || []).find((o) => o && o.id === req.params.id);
    const out = ledger.settleRefund(db(), order, req.params.txnId, {
      actor: { id: (req.adminSession && req.adminSession.id) || "admin" },
      at: Date.now(),
    });
    if (out.error) return res.status(out.status || 400).json(out);
    audit(db(), req, "refund_settled", "order", req.params.id, { txn: req.params.txnId, duplicate: !!out.duplicate });
    save();
    res.json({ ok: true, duplicate: !!out.duplicate, transaction: out.txn, account: ledger.orderAccount(db(), order) });
  });
  app.post("/api/pos/customer-card", (req, res) => {
    const s = ctx.auth(req);
    if (!s || (s.type !== "pos" && s.type !== "admin")) return res.status(401).json({ error: "pos_auth_required" });
    const body = req.body || {};
    let user = null;
    if (body.token) {
      const found = cards.findByToken(db(), body.token, pepper());
      if (found && found.current) user = found.user;
    } else if (body.customerNo) {
      const no = String(body.customerNo).trim();
      user = (db().users || []).find((u) => u && u.customerNo === no) || null;
    }
    if (!user) return res.status(404).json({ error: "not_found" });
    const account = life.stateOf(user);
    const active = account === "active" && user.card && user.card.status === "active";
    res.json({
      ok: true,
      active: active,
      accountStatus: account,
      name: user.name || "",
      customerNo: user.customerNo || "",
      userId: active ? user.id : "",
    });
  });
  app.post("/api/admin/customers/:id/card", ctx.requireAdminAnyPerm(["customers"]), (req, res) => {
    const user = (db().users || []).find((u) => u && u.id === req.params.id);
    if (!user) return res.status(404).json({ error: "not_found" });
    const body = req.body || {};
    if (!user.card) cards.ensureCard(user, pepper());
    if (body.replaceToken) cards.replaceToken(user, pepper());
    if (body.status) {
      if (!cards.setStatus(user, body.status)) return res.status(400).json({ error: "bad_status" });
    }
    audit(db(), req, body.replaceToken ? "card_token_replaced" : "card_status", "customer", user.id, { status: user.card && user.card.status });
    save();
    res.json({ card: cards.summary(user) });
  });

  app.get("/api/admin/order-notifications", ctx.requireAdminAnyPerm(["orders"]), (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(notes.listForAdmin(db()));
  });
  app.post("/api/admin/order-notifications/:id/read", ctx.requireAdminAnyPerm(["orders"]), (req, res) => {
    const out = notes.markRead(db(), req.params.id);
    if (!out) return res.status(404).json({ error: "not_found" });
    save();
    res.json(out);
  });

  app.post("/api/auth/passkey/register-options", ctx.requireUser, async (req, res) => {
    if (!rlPasskey(clientIp(req) + ":pk").ok) return res.status(429).json({ error: "rate_limited" });
    const out = await passkeys.registrationOptions(db(), req.user, req, siteUrl());
    save();
    res.json(out);
  });
  app.post("/api/auth/passkey/register", ctx.requireUser, async (req, res) => {
    if (!rlPasskey(clientIp(req) + ":pk").ok) return res.status(429).json({ error: "rate_limited" });
    const out = await passkeys.registrationVerify(db(), req.user, req.body || {}, req, siteUrl());
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    save();
    res.json(out);
  });
  app.get("/api/me/passkeys", ctx.requireUser, (req, res) => {
    res.json({ passkeys: (req.user.passkeys || []).map(passkeys.publicPasskey) });
  });
  app.delete("/api/me/passkeys/:id", ctx.requireUser, (req, res) => {
    const ok = passkeys.removePasskey(req.user, req.params.id);
    if (!ok) return res.status(404).json({ error: "not_found" });
    save();
    res.json({ passkeys: (req.user.passkeys || []).map(passkeys.publicPasskey) });
  });
  app.post("/api/auth/passkey/login-options", async (req, res) => {
    if (!rlPasskey(clientIp(req) + ":pkl").ok) return res.status(429).json({ error: "rate_limited" });
    const out = await passkeys.loginOptions(db(), req, siteUrl());
    save();
    res.json(out);
  });
  app.post("/api/auth/passkey/login", async (req, res) => {
    if (!rlPasskey(clientIp(req) + ":pkl").ok) return res.status(429).json({ error: "rate_limited" });
    const out = await passkeys.loginVerify(db(), req.body || {}, req, siteUrl());
    if (out.error) {
      if (out.changed) save();
      return res.status(out.status || 400).json({ error: out.error, reason: out.reason || "" });
    }
    const t = ctx.issueUserToken(out.user);
    save();
    res.json({ token: t, user: ctx.publicUser(out.user) });
  });

  app.get("/api/admin/security", ctx.requireAdmin, (req, res) => {
    if (!(req.adminSession && (req.adminSession.owner || req.adminSession.role === "owner"))) {
      return res.status(403).json({ error: "owner_only" });
    }
    const admin2fa = require("./admin-2fa");
    res.json(admin2fa.publicSecurity(db()));
  });
  app.put("/api/admin/security/email", ctx.requireAdmin, (req, res) => {
    if (!(req.adminSession && (req.adminSession.owner || req.adminSession.role === "owner"))) {
      return res.status(403).json({ error: "owner_only" });
    }
    const admin2fa = require("./admin-2fa");
    const out = admin2fa.setEmail(db(), (req.body || {}).email);
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    audit(db(), req, "admin_2fa_email_updated", "security", "2fa", {});
    save();
    res.json(out);
  });
  app.post("/api/admin/security/recovery-codes", ctx.requireAdmin, (req, res) => {
    if (!(req.adminSession && (req.adminSession.owner || req.adminSession.role === "owner"))) {
      return res.status(403).json({ error: "owner_only" });
    }
    const admin2fa = require("./admin-2fa");
    const codes = admin2fa.issueRecoveryCodes(db(), pepper());
    audit(db(), req, "admin_recovery_codes_rotated", "security", "2fa", { count: codes.length });
    save();
    res.json({ codes: codes, once: true });
  });

  app.post("/api/admin/logout", ctx.requireAdmin, (req, res) => {
    const raw = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    if (raw && ctx.sessions) ctx.sessions.delete(raw);
    audit(db(), req, "admin_logout", "admin", req.adminSession && req.adminSession.staffId || "owner", {});
    save();
    res.json({ ok: true });
  });

  ["delete", "put", "post"].forEach((method) => {
    app[method]("/api/admin/audit", ctx.requireAdmin, (req, res) => {
      res.status(405).json({ error: "audit_is_append_only" });
    });
  });

  app.get("/api/admin/backup-status", ctx.requireAdmin, (req, res) => {
    if (!(req.adminSession && (req.adminSession.owner || req.adminSession.role === "owner"))) {
      return res.status(403).json({ error: "owner_only" });
    }
    res.json({
      configured: !!(process.env.BACKUP_DIR && process.env.BACKUP_ENCRYPTION_KEY),
      retentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS || "14", 10) || 14,
      log: (db().backupLog || []).slice(0, 20).map((row) => ({
        at: row.at, action: row.action, error: row.error || "", files: row.files || 0,
      })),
    });
  });

  scheduleBackup(ctx);
}

async function onUserVerified(ctx, user) {
  const card = cards.ensureCard(user, ctx.TOKEN_PEPPER);
  if (!card || card.emailedAt) return;
  try {
    const png = await cards.renderCardPng(user, ctx.SITE_URL || "https://mahomarket.com");
    if (ctx.mail && typeof ctx.mail.customerCard === "function" && user.email) {
      await ctx.mail.customerCard(user.email, user, png);
      user.card.emailedAt = Date.now();
    }
  } catch (err) {
    pushAudit(ctx.db, { actor: "system", action: "email_failed", entityType: "customer_card", entityId: user.id, meta: { outcome: "failed" } });
  }
}

function onOrderCreated(ctx, order) {
  notes.createForOrder(ctx.db, order);
  if (!order.notify) order.notify = {};
  if (order.notify.salesEmailAt) return;
  const sales = String(process.env.SALES_NOTIFY_EMAIL || "").trim();
  const ordersTo = String(process.env.ORDERS_NOTIFY_EMAIL || "orders@mahomarket.com").trim();
  if (!sales) return;
  if (!ctx.mail || typeof ctx.mail.orderSalesNotify !== "function") return;
  if (sales.toLowerCase() === ordersTo.toLowerCase()) return;
  order.notify.salesEmailAt = Date.now();
  try { ctx.saveDb(); } catch (_) {}
  ctx.mail.orderSalesNotify(order, sales).then(() => {
    order.notify.salesEmailOk = true;
    try { ctx.saveDb(); } catch (_) {}
  }).catch((err) => {
    order.notify.salesEmailOk = false;
    pushAudit(ctx.db, { actor: "system", action: "email_failed", entityType: "order", entityId: order.id, meta: { outcome: "failed", kind: "sales" } });
    try { ctx.saveDb(); } catch (_) {}
  });
}

module.exports = {
  ensure,
  publicSite,
  mount,
  auditCatalog,
  onUserVerified,
  onOrderCreated,
  policies,
  cards,
  hours,
};
