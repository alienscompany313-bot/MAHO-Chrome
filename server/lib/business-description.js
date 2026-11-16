"use strict";

const DEFAULT_FA = "لباس و لوازم بانوان";
const DEFAULT_EN = "Women's Clothing & Accessories";

function clean(value, max) {
  return String(value == null ? "" : value)
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u001F]/g, "")
    .trim()
    .slice(0, max || 120);
}

function pair(config) {
  const content = config && config.content && typeof config.content === "object" ? config.content : {};
  return {
    fa: clean(content.brandSub) || DEFAULT_FA,
    en: clean(content.brandSub_en) || DEFAULT_EN,
  };
}

function text(config, lang) {
  const lines = pair(config);
  return String(lang || "").toLowerCase().indexOf("en") === 0 ? lines.en : lines.fa;
}

module.exports = { DEFAULT_FA, DEFAULT_EN, clean, pair, text };
