"use strict";

const VIDEO_RE = /^\/uploads\/[a-f0-9]{32}\.(mp4|webm)$/i;

function isAllowedImageUrl(value) {
  if (typeof value !== "string" || !value || /^data:/i.test(value)) return false;
  if (value.startsWith("/uploads/")) return /\.(jpe?g|png|webp|gif)$/i.test(value.split("?")[0]);
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_) {
    return false;
  }
}

function sanitizeProductVideos(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  list.slice(0, 8).forEach((row, index) => {
    if (!row || typeof row !== "object") return;
    const videoUrl = String(row.videoUrl || "").trim();
    if (!VIDEO_RE.test(videoUrl)) return;
    const duration = Number(row.duration);
    const id = String(row.id || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || ("pv" + index);
    out.push({
      id: id,
      videoUrl: videoUrl,
      poster: isAllowedImageUrl(row.poster) ? String(row.poster).slice(0, 500) : "",
      primary: row.primary === true,
      duration: Number.isFinite(duration) && duration > 0 && duration <= 31 ? Math.round(duration * 100) / 100 : null,
      order: index,
    });
  });
  if (out.length && !out.some((row) => row.primary)) out[0].primary = true;
  let primarySeen = false;
  out.forEach((row) => {
    if (row.primary && primarySeen) row.primary = false;
    else if (row.primary) primarySeen = true;
  });
  return out;
}

function publicProducts(list) {
  return (Array.isArray(list) ? list : []).map((product) => {
    if (!product || typeof product !== "object") return product;
    const copy = Object.assign({}, product);
    copy.videos = sanitizeProductVideos(product.videos);
    return copy;
  });
}

module.exports = {
  VIDEO_RE,
  sanitizeProductVideos,
  publicProducts,
};
