"use strict";

const { sanitizeText } = require("./security");
const { safeHttpUrl } = require("./upgrade/safe-url");
const { VIDEO_RE } = require("./product-videos");

const KABUL_OFFSET_MS = (4 * 60 + 30) * 60 * 1000;
const MAX_CARDS = 24;

function parseKabulStrict(value) {
  if (value == null || value === "") return { ok: true, text: "", ms: null };
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value + KABUL_OFFSET_MS);
    if (Number.isNaN(date.getTime())) return { ok: false };
    const pad = (n) => String(n).padStart(2, "0");
    const text = date.getUTCFullYear() + "-" + pad(date.getUTCMonth() + 1) + "-" + pad(date.getUTCDate()) + "T" + pad(date.getUTCHours()) + ":" + pad(date.getUTCMinutes());
    return { ok: true, text: text, ms: value };
  }
  const text = String(value).trim();
  if (!text) return { ok: true, text: "", ms: null };
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return { ok: false };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59) return { ok: false };
  const utc = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(utc);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return { ok: false };
  return { ok: true, text: text, ms: utc - KABUL_OFFSET_MS };
}

function safeCardLink(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("/") && !raw.startsWith("//") && !/[\s<>\\]/.test(raw)) {
    if (/^\/(admin|api|pos|driver|delivery)\b/i.test(raw)) return "";
    return raw.slice(0, 300);
  }
  return safeHttpUrl(raw);
}

function safeImage(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || /^data:/i.test(text)) return "";
  if (/^\/uploads\/[a-f0-9]{32}\.(jpe?g|png|webp|gif)$/i.test(text)) return text;
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return text.slice(0, 500);
  } catch (_) {
    return "";
  }
}

function cleanText(value, limit) {
  return sanitizeText(value, limit).replace(/[<>]/g, "");
}

function cardsFromLegacy(rows) {
  return (Array.isArray(rows) ? rows : []).slice(0, 12).map((row, index) => ({
    id: row && row.id,
    type: "product",
    productCode: row && row.productCode,
    videoId: "",
    videoUrl: row && row.videoUrl,
    imageUrl: "",
    title: "",
    title_en: "",
    description: "",
    description_en: "",
    url: "",
    cta: "",
    cta_en: "",
    enabled: !!(row && row.enabled === true),
    startAt: "",
    endAt: "",
    order: row && row.order != null ? row.order : index,
  }));
}

function sanitizeHeroCards(rows) {
  if (!Array.isArray(rows)) return { error: "hero_cards_invalid" };
  const cards = [];
  const seenProducts = new Set();
  const seenIds = new Set();
  for (let index = 0; index < rows.slice(0, MAX_CARDS).length; index += 1) {
    const row = rows[index];
    if (!row || typeof row !== "object") continue;
    const type = row.type === "post" ? "post" : "product";
    const start = parseKabulStrict(row.startAt);
    const end = parseKabulStrict(row.endAt);
    if (!start.ok || !end.ok) return { error: "schedule_incomplete" };
    if (start.ms != null && end.ms != null && end.ms <= start.ms) return { error: "schedule_range" };
    let id = String(row.id || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || ("hc" + index);
    while (seenIds.has(id)) id = id + "x";
    seenIds.add(id);
    const productCode = cleanText(row.productCode, 80);
    if (type === "product") {
      if (!productCode || seenProducts.has(productCode)) continue;
      seenProducts.add(productCode);
    }
    const videoUrl = VIDEO_RE.test(String(row.videoUrl || "").trim()) ? String(row.videoUrl).trim() : "";
    const card = {
      id: id,
      type: type,
      productCode: type === "product" ? productCode : "",
      videoId: String(row.videoId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40),
      videoUrl: videoUrl,
      imageUrl: safeImage(row.imageUrl),
      title: cleanText(row.title, 120),
      title_en: cleanText(row.title_en, 120),
      description: cleanText(row.description, 400),
      description_en: cleanText(row.description_en, 400),
      url: safeCardLink(row.url),
      cta: cleanText(row.cta, 80),
      cta_en: cleanText(row.cta_en, 80),
      enabled: row.enabled === true,
      startAt: start.text,
      endAt: end.text,
      order: index,
    };
    if (type === "post" && !card.title && !card.title_en && !card.imageUrl && !card.videoUrl) continue;
    cards.push(card);
  }
  return { cards: cards };
}

function legacyFromCards(cards) {
  return (cards || []).filter((card) => card.type === "product" && card.videoUrl).map((card, index) => ({
    id: card.id,
    productCode: card.productCode,
    videoUrl: card.videoUrl,
    enabled: card.enabled === true,
    order: index,
  }));
}

function productVisible(product) {
  return !!(product && product.enabled !== false && product.active !== false && String(product.code || "").trim());
}

function resolveProductMedia(card, product) {
  const videos = Array.isArray(product && product.videos) ? product.videos : [];
  const chosen = card.videoId ? videos.find((row) => row && row.id === card.videoId) : null;
  const primary = videos.find((row) => row && row.primary) || videos[0] || null;
  const picked = chosen || null;
  const videoUrl = (picked && picked.videoUrl) || card.videoUrl || ((!card.videoUrl && primary && primary.videoUrl) || "");
  const safeVideo = VIDEO_RE.test(videoUrl) ? videoUrl : "";
  const images = product && Array.isArray(product.images) ? product.images : [];
  const imageUrl = card.imageUrl || (picked && picked.poster) || (primary && primary.poster) || images[0] || (product && product.image) || "";
  return { videoUrl: safeVideo, imageUrl: typeof imageUrl === "string" ? imageUrl : "" };
}

function isScheduled(card, now) {
  if (!card || card.enabled !== true) return false;
  const start = parseKabulStrict(card.startAt);
  const end = parseKabulStrict(card.endAt);
  if (!start.ok || !end.ok) return false;
  const time = typeof now === "number" ? now : Date.now();
  if (start.ms != null && time < start.ms) return false;
  if (end.ms != null && time > end.ms) return false;
  return true;
}

function publicHero(config, products, now) {
  const source = Array.isArray(config && config.heroCards) ? config.heroCards : cardsFromLegacy(config && config.heroVideos);
  const list = Array.isArray(products) ? products : [];
  const cards = [];
  source.forEach((card) => {
    if (!isScheduled(card, now)) return;
    if (card.type === "post") {
      const title = card.title || card.title_en;
      const videoUrl = VIDEO_RE.test(card.videoUrl || "") ? card.videoUrl : "";
      const imageUrl = card.imageUrl || "";
      if (!title || (!videoUrl && !imageUrl)) return;
      cards.push({
        id: card.id,
        type: "post",
        productCode: "",
        videoUrl: videoUrl,
        imageUrl: imageUrl,
        title: card.title || "",
        title_en: card.title_en || "",
        description: card.description || "",
        description_en: card.description_en || "",
        url: card.url || "",
        cta: card.cta || "",
        cta_en: card.cta_en || "",
        endAt: parseKabulStrict(card.endAt).ms,
        order: card.order || 0,
      });
      return;
    }
    const product = list.find((item) => String(item.code || "") === String(card.productCode || ""));
    if (!productVisible(product)) return;
    const media = resolveProductMedia(card, product);
    if (!media.videoUrl && !media.imageUrl) return;
    cards.push({
      id: card.id,
      type: "product",
      productCode: product.code,
      videoId: card.videoId || "",
      videoUrl: media.videoUrl,
      imageUrl: media.imageUrl,
      endAt: parseKabulStrict(card.endAt).ms,
      order: card.order || 0,
    });
  });
  cards.sort((a, b) => (a.order || 0) - (b.order || 0));
  return {
    cards: cards,
    legacy: cards.filter((card) => card.type === "product" && card.videoUrl).map((card, index) => ({
      id: card.id,
      productCode: card.productCode,
      videoUrl: card.videoUrl,
      enabled: true,
      order: index,
    })),
  };
}

module.exports = {
  parseKabulStrict,
  safeCardLink,
  cardsFromLegacy,
  sanitizeHeroCards,
  legacyFromCards,
  isScheduled,
  publicHero,
};
