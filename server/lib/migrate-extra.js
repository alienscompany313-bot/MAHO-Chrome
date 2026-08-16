"use strict";
/**
 * Extra additive migrate steps — never wipes products/orders/users/uploads.
 */
function extendMigrate(data) {
  if (!data || typeof data !== "object") return false;
  let changed = false;
  data.config = data.config || {};
  data.auditLog = data.auditLog || [];
  data.passwordResets = data.passwordResets || [];
  data.pendingSignups = data.pendingSignups || [];
  data.idempotencyKeys = data.idempotencyKeys || {};

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

  /* normalize legacy orders */
  if (Array.isArray(data.orders)) {
    data.orders.forEach((o) => {
      if (!o || typeof o !== "object") return;
      if (!o.statusHistory) { o.statusHistory = []; changed = true; }
      if (o.guest == null && !o.userId) { o.guest = true; changed = true; }
      if (o.status === "pending") { o.status = "new"; changed = true; }
      if (o.status === "awaiting_payment") {
        o.status = "new";
        if (!o.paymentStatus) o.paymentStatus = "awaiting_payment";
        changed = true;
      }
      if (!o.paymentStatus && (o.payment === "hesab" || o.payment === "bank" || o.payment === "card")) {
        o.paymentStatus = "awaiting_payment";
        changed = true;
      }
    });
  }

  /* users: status field */
  if (Array.isArray(data.users)) {
    data.users.forEach((u) => {
      if (!u) return;
      if (!u.status) {
        u.status = u.verified === false ? "pending" : "active";
        changed = true;
      }
    });
  }

  return changed;
}

module.exports = { extendMigrate };
