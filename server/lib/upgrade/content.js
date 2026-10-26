"use strict";

const crypto = require("crypto");
const { sanitizeText } = require("../security");
const { safeHttpUrl } = require("./safe-url");

const SOCIAL_SEED = [
  { platform: "instagram", label: "اینستاگرام", label_en: "Instagram", configKey: "instagram" },
  { platform: "telegram", label: "تلگرام", label_en: "Telegram", configKey: "telegram" },
  { platform: "whatsapp", label: "واتساپ", label_en: "WhatsApp", configKey: "whatsappLink" },
  { platform: "facebook", label: "فیسبوک", label_en: "Facebook", configKey: "facebook" },
  { platform: "tiktok", label: "تیک‌تاک", label_en: "TikTok", configKey: "tiktok" },
];

function defaultCards() {
  return [
    { id: "authentic", icon: "shield", enabled: true, order: 1, title: "ضمانت اصالت", title_en: "Authentic Goods", description: "تمام کالاها اصل و باکیفیت انتخاب شده‌اند.", description_en: "Every item is selected for quality and authenticity." },
    { id: "shipping", icon: "truck", enabled: true, order: 2, title: "ارسال سریع", title_en: "Fast Delivery", description: "تحویل درب منزل در کوتاه‌ترین زمان در شهر.", description_en: "Home delivery in the shortest time in the city." },
    { id: "exchange", icon: "refresh", enabled: true, order: 3, title: "تعویض آسان", title_en: "Easy Exchange", description: "مهلت تعویض یا بازگشت کالا بدون دردسر.", description_en: "A straightforward exchange or return window." },
    { id: "support", icon: "headphones", enabled: true, order: 4, title: "پشتیبانی خوب", title_en: "Real Support", description: "همراه شما پیش و پس از خرید.", description_en: "We stay with you before and after the purchase." },
  ];
}

function defaultWhy() {
  return {
    enabled: true,
    kicker: "چرا MAHO",
    kicker_en: "Why MAHO",
    heading: "تجربه‌ی خریدی که به آن اعتماد می‌کنید",
    heading_en: "A Shopping Experience You Can Trust",
    description: "تعهد ما فقط فروش نیست؛ ساختن رابطه‌ای بلندمدت بر پایه‌ی اعتماد و کیفیت است.",
    description_en: "Our commitment isn't just selling — it's building a lasting relationship based on trust and quality.",
    cards: defaultCards(),
  };
}

function cleanCard(src, i) {
  const row = src && typeof src === "object" ? src : {};
  const icon = String(row.icon || "shield").replace(/[^a-z0-9_-]/gi, "").slice(0, 32) || "shield";
  return {
    id: sanitizeText(row.id, 40) || ("card_" + crypto.randomBytes(3).toString("hex")),
    icon: icon,
    enabled: row.enabled !== false,
    order: Number.isFinite(Number(row.order)) ? Number(row.order) : i,
    title: sanitizeText(row.title, 80),
    title_en: sanitizeText(row.title_en, 80),
    description: sanitizeText(row.description, 240),
    description_en: sanitizeText(row.description_en, 240),
  };
}

function ensureContent(db) {
  let changed = false;
  if (!db.whyMaho || typeof db.whyMaho !== "object" || !Array.isArray(db.whyMaho.cards)) {
    db.whyMaho = defaultWhy();
    changed = true;
  }
  if (!Array.isArray(db.footerSocials)) {
    const content = (db.config && db.config.content) || {};
    const seen = {};
    db.footerSocials = SOCIAL_SEED.filter((seed) => {
      if (seen[seed.platform]) return false;
      seen[seed.platform] = true;
      return true;
    }).map((seed, i) => {
      const url = safeHttpUrl(content[seed.configKey] || "");
      return {
        id: "soc_" + seed.platform,
        platform: seed.platform,
        label: seed.label,
        label_en: seed.label_en,
        url: url,
        enabled: !!url,
        order: i,
      };
    });
    changed = true;
  }
  return changed;
}

function publicWhy(db) {
  ensureContent(db);
  const src = db.whyMaho;
  const cards = (src.cards || [])
    .filter((card) => card && card.enabled !== false)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  return {
    enabled: src.enabled !== false,
    kicker: src.kicker || "",
    kicker_en: src.kicker_en || "",
    heading: src.heading || "",
    heading_en: src.heading_en || "",
    description: src.description || "",
    description_en: src.description_en || "",
    cards: cards.map((card) => ({
      id: card.id,
      icon: card.icon,
      title: card.title,
      title_en: card.title_en,
      description: card.description,
      description_en: card.description_en,
      order: card.order,
    })),
  };
}

function saveWhy(db, body) {
  ensureContent(db);
  const src = body && typeof body === "object" ? body : {};
  const cards = (Array.isArray(src.cards) ? src.cards : []).slice(0, 12).map(cleanCard);
  db.whyMaho = {
    enabled: src.enabled !== false,
    kicker: sanitizeText(src.kicker, 80),
    kicker_en: sanitizeText(src.kicker_en, 80),
    heading: sanitizeText(src.heading, 160),
    heading_en: sanitizeText(src.heading_en, 160),
    description: sanitizeText(src.description, 400),
    description_en: sanitizeText(src.description_en, 400),
    cards: cards,
  };
  return db.whyMaho;
}

function cleanSocial(src, i) {
  const row = src && typeof src === "object" ? src : {};
  const platform = String(row.platform || "custom").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32) || "custom";
  return {
    id: sanitizeText(row.id, 40) || ("soc_" + crypto.randomBytes(3).toString("hex")),
    platform: platform,
    label: sanitizeText(row.label, 40),
    label_en: sanitizeText(row.label_en, 40),
    url: safeHttpUrl(row.url),
    enabled: row.enabled !== false,
    order: i,
  };
}

function saveSocials(db, list) {
  ensureContent(db);
  const seen = {};
  db.footerSocials = (Array.isArray(list) ? list : []).slice(0, 20).map(cleanSocial).filter((row) => {
    if (!row.platform || seen[row.platform]) return false;
    seen[row.platform] = true;
    return true;
  });
  return db.footerSocials;
}

function publicSocials(db) {
  ensureContent(db);
  return (db.footerSocials || [])
    .filter((row) => row && row.enabled !== false && row.url)
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((row) => ({
      id: row.id,
      platform: row.platform,
      label: row.label,
      label_en: row.label_en,
      url: row.url,
      order: row.order,
    }));
}

module.exports = {
  ensureContent,
  publicWhy,
  saveWhy,
  saveSocials,
  publicSocials,
  defaultWhy,
};
