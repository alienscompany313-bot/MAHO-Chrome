"use strict";
/**
 * Extra additive migrate steps — never wipes products/orders/users/uploads.
 */
const { ensurePos } = require("./pos");
const { ensurePaymentMethods } = require("./payments");
const { ensureDrivers } = require("./driver");
const { ensureEngagement } = require("./engagement");
const { ensureReturnsOps } = require("./returns-ops");
const { ensureGiveaways } = require("./giveaway");

function extendMigrate(data) {
  if (!data || typeof data !== "object") return false;
  let changed = false;
  data.config = data.config || {};
  data.auditLog = data.auditLog || [];
  data.passwordResets = data.passwordResets || [];
  data.pendingSignups = data.pendingSignups || [];
  data.idempotencyKeys = data.idempotencyKeys || {};
  if (!Array.isArray(data.staff)) { data.staff = []; changed = true; }
  if (ensurePos(data)) changed = true;
  if (ensureDrivers(data)) changed = true;
  if (ensureEngagement(data)) changed = true;
  if (ensureReturnsOps(data)) changed = true;
  if (ensureGiveaways(data)) changed = true;

  /* category section texts (homepage) */
  if (!data.config.sectionCats || typeof data.config.sectionCats !== "object") {
    data.config.sectionCats = {
      kicker: "دسته‌بندی‌ها",
      kicker_en: "Categories",
      title: "هر آنچه یک خانم لازم دارد",
      title_en: "Everything a lady needs",
      lead: "از پوشاک و شال تا کیف، کفش، اکسسوری و لوازم آرایشی — همه در یک‌جا و دسته‌بندی‌شده.",
      lead_en: "From clothing and scarves to bags, shoes, accessories and beauty — all in one place.",
    };
    changed = true;
  }

  /* HesabPay full config */
  const h = data.config.hesab && typeof data.config.hesab === "object" ? data.config.hesab : {};
  const hesabDefaults = {
    enabled: h.enabled != null ? !!h.enabled : !!(h.link || h.number || h.qrUrl),
    link: h.link || "",
    number: h.number || "",
    holder: h.holder || "",
    title: h.title || "پرداخت با حساب‌پی",
    title_en: h.title_en || "Pay with HesabPay",
    description: h.description || "ما پرداخت با حساب‌پی را می‌پذیریم.",
    description_en: h.description_en || "We accept HesabPay.",
    guide: h.guide || "پس از پرداخت، رسید را در صفحهٔ سفارش آپلود کنید تا بررسی شود.",
    guide_en: h.guide_en || "After paying, upload your receipt on the order page for review.",
    buttonText: h.buttonText || "بازکردن لینک پرداخت",
    buttonText_en: h.buttonText_en || "Open payment link",
    note: h.note || "",
    note_en: h.note_en || "",
    qrUrl: h.qrUrl || "",
    order: typeof h.order === "number" ? h.order : 10,
    showOnSite: h.showOnSite !== false,
  };
  const before = JSON.stringify(data.config.hesab || null);
  data.config.hesab = Object.assign({}, hesabDefaults, h);
  if (JSON.stringify(data.config.hesab) !== before) changed = true;

  /* public HesabPay promotional banner (separate from checkout QR) */
  if (!data.config.hesabBanner || typeof data.config.hesabBanner !== "object") {
    data.config.hesabBanner = {
      enabled: false,
      imageUrl: "",
      text: "ما پرداخت با حساب‌پی را می‌پذیریم",
      text_en: "We accept HesabPay",
      link: "",
      order: 20,
      placement: "after_categories",
    };
    changed = true;
  }

  /* hero slider — migrate legacy single heroImage into slides once */
  if (!Array.isArray(data.config.heroSlides)) {
    data.config.heroSlides = [];
    if (data.config.heroImage) {
      data.config.heroSlides.push({
        id: "legacy-hero",
        url: data.config.heroImage,
        enabled: true,
        order: 0,
        alt: "MAHO",
        text: "",
        text_en: "",
        link: "",
      });
    }
    changed = true;
  }
  if (data.config.heroSliderIntervalSec == null) {
    data.config.heroSliderIntervalSec = 5;
    changed = true;
  }

  /* payment method toggles */
  if (ensurePaymentMethods(data.config)) changed = true;

  /* Official MAHO WhatsApp (giveaway / support contact) — additive only */
  if (data.config.officialWhatsAppNumber == null) {
    data.config.officialWhatsAppNumber = data.config.whatsapp
      || (data.config.content && data.config.content.footerPhone)
      || "";
    changed = true;
  }

  /* delivery defaults */
  if (!data.config.delivery || typeof data.config.delivery !== "object") {
    data.config.delivery = { enabled: true, perKm: 20, freeKm: 0, urgentFee: 50, minOrder: 0, maxKm: 0, timeslots: [] };
    changed = true;
  }
  if (data.config.delivery.gpsRequired === undefined) {
    data.config.delivery.gpsRequired = false;
    changed = true;
  }
  if (!data.config.delivery.outOfRangePolicy) {
    data.config.delivery.outOfRangePolicy = "warn";
    changed = true;
  }
  if (data.config.delivery.proofPhotoRequired === undefined) {
    data.config.delivery.proofPhotoRequired = false;
    changed = true;
  }

  /* normalize legacy orders */
  if (Array.isArray(data.orders)) {
    data.orders.forEach((o) => {
      if (!o || typeof o !== "object") return;
      if (!o.statusHistory) { o.statusHistory = []; changed = true; }
      if (!Array.isArray(o.hesabReceipts)) {
        o.hesabReceipts = [];
        if (o.hesabReceipt) { o.hesabReceipts.push(Object.assign({}, o.hesabReceipt, { latest: true })); }
        changed = true;
      }
      if (o.guest == null && !o.userId) { o.guest = true; changed = true; }
      if (o.status === "pending") { o.status = "new"; changed = true; }
      if (o.status === "awaiting_payment") {
        o.status = "new";
        if (!o.paymentStatus) o.paymentStatus = "awaiting_payment";
        changed = true;
      }
      if (o.status === "returned") { o.status = "return_completed"; changed = true; }
      if (!o.paymentStatus && (o.payment === "hesab" || o.payment === "bank" || o.payment === "card")) {
        o.paymentStatus = "awaiting_payment";
        changed = true;
      }
      if (o.returnRequest && !o.returnRequest.method) {
        o.returnRequest.method = "pickup_store";
        changed = true;
      }
      if (o.lang == null) { o.lang = "fa"; changed = true; }
    });
  }

  /* users: status + soft delete fields + marketingConsent */
  if (Array.isArray(data.users)) {
    data.users.forEach((u) => {
      if (!u) return;
      if (!u.status) {
        u.status = u.verified === false ? "pending" : "active";
        changed = true;
      }
      if (u.deletedAt === undefined) { u.deletedAt = null; changed = true; }
      if (u.marketingConsent == null) { u.marketingConsent = false; changed = true; }
      if (u.blocked == null) { u.blocked = false; changed = true; }
      if (u.blockedAt === undefined) { u.blockedAt = null; changed = true; }
      if (u.blockReason === undefined) { u.blockReason = ""; changed = true; }
    });
  }

  /* order-value discount rules + order item normalization */
  try {
    const { ensureDiscountRules } = require("./order-discounts");
    if (ensureDiscountRules(data)) changed = true;
  } catch (_) {}
  try {
    const { normalizeOrderItems } = require("./order-items");
    if (Array.isArray(data.orders)) {
      data.orders.forEach((o) => {
        if (normalizeOrderItems(o)) changed = true;
      });
    }
  } catch (_) {}
  try {
    const { ensureStoreStock } = require("./store-inventory");
    if (Array.isArray(data.products)) {
      data.products.forEach((p) => {
        if (ensureStoreStock(p)) changed = true;
      });
    }
    if (Array.isArray(data.stores)) {
      data.stores.forEach((s, i) => {
        if (s && !s.id) { s.id = "store_" + i; changed = true; }
        if (s && s.address == null && s.area) { /* keep area; address optional */ }
      });
    }
  } catch (_) {}

  return changed;
}

module.exports = { extendMigrate };
