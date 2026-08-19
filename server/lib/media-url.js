"use strict";
/**
 * Resolve product/media URLs to absolute public HTTPS URLs for emails & SSR.
 * Never returns localhost, filesystem paths, or auth-gated URLs.
 */

function siteBase(siteUrl) {
  const raw = String(siteUrl || process.env.SITE_URL || "https://mahomarket.com").trim();
  let base = raw.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(base)) base = "https://" + base.replace(/^\/+/, "");
  try {
    const u = new URL(base);
    if (/^localhost$|^127\.|^0\.0\.0\.0$|^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[0-1])\./i.test(u.hostname)) {
      return "https://mahomarket.com";
    }
    if (u.protocol === "http:" && /mahomarket\.com$/i.test(u.hostname)) {
      u.protocol = "https:";
      return u.origin;
    }
    return u.origin;
  } catch (_) {
    return "https://mahomarket.com";
  }
}

function isUnsafeSrc(src) {
  const s = String(src || "").trim();
  if (!s) return true;
  if (/^(file:|data:|blob:)/i.test(s)) return true;
  if (/^\/(var|home|tmp|private|Users)\b/i.test(s)) return true;
  if (/^[A-Za-z]:\\/.test(s)) return true;
  return false;
}

/**
 * Absolutize a storefront image path/URL.
 * Relative paths like /uploads/x.jpg → https://site/uploads/x.jpg
 */
function absolutizeMediaUrl(src, siteUrl) {
  if (isUnsafeSrc(src)) return "";
  const s = String(src).trim();
  const base = siteBase(siteUrl);
  if (/^https:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      if (/^localhost$|^127\./i.test(u.hostname)) return "";
      return u.href;
    } catch (_) {
      return "";
    }
  }
  if (/^http:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      if (/mahomarket\.com$/i.test(u.hostname)) {
        u.protocol = "https:";
        return u.href;
      }
      if (/^localhost$|^127\./i.test(u.hostname)) return "";
      return u.href;
    } catch (_) {
      return "";
    }
  }
  if (s.startsWith("//")) return "https:" + s;
  if (s.startsWith("/")) return base + s;
  /* bare relative like uploads/foo.jpg */
  return base + "/" + s.replace(/^\/+/, "");
}

function productImageCandidates(product) {
  if (!product || typeof product !== "object") return [];
  const out = [];
  if (Array.isArray(product.images)) {
    product.images.forEach((x) => { if (x) out.push(String(x)); });
  }
  if (product.image) out.push(String(product.image));
  return out;
}

function placeholderImageUrl(siteUrl, logoUrl) {
  const base = siteBase(siteUrl);
  const logo = absolutizeMediaUrl(logoUrl, base);
  if (logo) return logo;
  /* Stable public brand asset shipped with the site */
  return base + "/social-preview.jpg";
}

/**
 * Best product image for email: absolute HTTPS, or MAHO placeholder.
 */
function resolveProductImageUrl(productOrSrc, opts) {
  opts = opts || {};
  const base = siteBase(opts.siteUrl);
  const placeholder = placeholderImageUrl(base, opts.logoUrl);
  const candidates = typeof productOrSrc === "string" || !productOrSrc
    ? [productOrSrc]
    : productImageCandidates(productOrSrc).concat(productOrSrc.image ? [productOrSrc.image] : []);
  for (let i = 0; i < candidates.length; i++) {
    const abs = absolutizeMediaUrl(candidates[i], base);
    if (abs) return abs;
  }
  return placeholder;
}

module.exports = {
  siteBase,
  absolutizeMediaUrl,
  placeholderImageUrl,
  resolveProductImageUrl,
  productImageCandidates,
};
