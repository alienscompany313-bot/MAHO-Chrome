"use strict";
/**
 * SSR product SEO page for GET /p/:code
 * Reads live product rows from db.products — no hardcoded catalog data.
 */
const { usesVariantStock, sumVariantStock } = require("./variant-stock");

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeJsonForScript(obj) {
  return JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function siteBase(siteUrl) {
  const raw = String(siteUrl || "https://mahomarket.com").trim().replace(/\/+$/, "");
  return raw || "https://mahomarket.com";
}

/** Stable public identifier: prefer product.code, then sku, then barcode. Never invent one. */
function productPublicCode(p) {
  if (!p) return "";
  const code = String(p.code || "").trim();
  if (code) return code;
  const sku = String(p.sku || "").trim();
  if (sku) return sku;
  const barcode = String(p.barcode || "").trim();
  if (barcode) return barcode;
  return "";
}

function findProductByCode(products, codeParam) {
  const needle = String(codeParam || "").trim().toLowerCase();
  if (!needle || !Array.isArray(products)) return null;
  return products.find((p) => {
    if (!p) return false;
    const code = String(p.code || "").trim().toLowerCase();
    const sku = String(p.sku || "").trim().toLowerCase();
    const barcode = String(p.barcode || "").trim().toLowerCase();
    return (code && code === needle) || (sku && sku === needle) || (barcode && barcode === needle);
  }) || null;
}

function isProductActive(p) {
  if (!p) return false;
  if (p.enabled === false || p.active === false) return false;
  return true;
}

function productImageList(p) {
  if (Array.isArray(p && p.images) && p.images.length) {
    return p.images.map((u) => String(u || "").trim()).filter(Boolean);
  }
  if (p && p.image) return [String(p.image).trim()].filter(Boolean);
  return [];
}

function absoluteAssetUrl(siteUrl, src) {
  const s = String(src || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  const base = siteBase(siteUrl);
  if (s.startsWith("/")) return base + s;
  return base + "/" + s;
}

function totalStockUnits(p) {
  if (!p) return 0;
  if (usesVariantStock(p)) return sumVariantStock(p.variantStock);
  if (p.stock == null || p.stock === "") return null; /* unlimited / unset */
  const n = parseInt(p.stock, 10);
  return isNaN(n) ? null : Math.max(0, n);
}

function effectivePrice(p) {
  const base = Number(p && p.price);
  if (!Number.isFinite(base)) return null;
  const d = parseFloat(p && p.discount);
  if (Number.isFinite(d) && d > 0) {
    return Math.round(base * (1 - Math.min(95, d) / 100));
  }
  return base;
}

function productDescription(p) {
  if (!p) return "";
  const explicit = String(p.description || p.desc || "").trim();
  if (explicit) return explicit;
  const name = String(p.name || "").trim();
  const code = productPublicCode(p);
  const parts = [];
  if (name) parts.push(name);
  if (code) parts.push("کد کالا: " + code);
  const price = effectivePrice(p);
  if (price != null) parts.push("قیمت: " + price.toLocaleString("en-US") + " افغانی");
  return parts.join(" — ");
}

function stockLabelFa(units) {
  if (units === null) return "موجود";
  if (units > 0) return "موجود (" + units + ")";
  return "ناموجود";
}

function schemaAvailability(units) {
  if (units === null || units > 0) return "https://schema.org/InStock";
  return "https://schema.org/OutOfStock";
}

function buildProductPageModel(p, siteUrl) {
  const base = siteBase(siteUrl);
  const code = productPublicCode(p);
  if (!code) return null;
  const url = base + "/p/" + encodeURIComponent(code);
  const name = String(p.name || "").trim() || code;
  const description = productDescription(p);
  const images = productImageList(p).map((src) => absoluteAssetUrl(base, src)).filter(Boolean);
  const primaryImage = images[0] || (base + "/social-preview.jpg");
  const units = totalStockUnits(p);
  const price = effectivePrice(p);
  const sku = String(p.sku || p.code || code).trim();

  return {
    code,
    sku,
    name,
    description,
    price,
    currency: "AFN",
    stockUnits: units,
    stockLabel: stockLabelFa(units),
    image: primaryImage,
    images,
    url,
    availability: schemaAvailability(units),
    title: name + " | MAHO Market",
    metaDescription: description.slice(0, 300),
  };
}

function renderProductHtml(model) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: model.name,
    description: model.description,
    image: model.images.length ? model.images : [model.image],
    sku: model.sku,
    url: model.url,
    offers: {
      "@type": "Offer",
      url: model.url,
      priceCurrency: model.currency,
      price: model.price != null ? String(model.price) : undefined,
      availability: model.availability,
    },
  };
  if (jsonLd.offers.price == null) delete jsonLd.offers.price;

  const e = escapeHtml;
  const priceText = model.price != null
    ? e(String(model.price.toLocaleString("en-US"))) + " افغانی"
    : "—";

  return "<!doctype html>\n" +
    '<html lang="fa" dir="rtl">\n' +
    "<head>\n" +
    '  <meta charset="utf-8">\n' +
    '  <meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    "  <title>" + e(model.title) + "</title>\n" +
    '  <meta name="description" content="' + e(model.metaDescription) + '">\n' +
    '  <meta name="robots" content="index, follow">\n' +
    '  <link rel="canonical" href="' + e(model.url) + '">\n' +
    '  <meta property="og:title" content="' + e(model.title) + '">\n' +
    '  <meta property="og:description" content="' + e(model.metaDescription) + '">\n' +
    '  <meta property="og:image" content="' + e(model.image) + '">\n' +
    '  <meta property="og:url" content="' + e(model.url) + '">\n' +
    '  <meta property="og:type" content="product">\n' +
    '  <meta property="og:site_name" content="MAHO Market">\n' +
    '  <meta property="og:locale" content="fa_AF">\n' +
    '  <meta name="twitter:card" content="summary">\n' +
    '  <meta name="twitter:title" content="' + e(model.title) + '">\n' +
    '  <meta name="twitter:description" content="' + e(model.metaDescription) + '">\n' +
    '  <meta name="twitter:image" content="' + e(model.image) + '">\n' +
    '  <script type="application/ld+json">' + escapeJsonForScript(jsonLd) + "</script>\n" +
    '  <link rel="stylesheet" href="/css/styles.css">\n' +
    "</head>\n" +
    "<body>\n" +
    '  <main style="max-width:720px;margin:40px auto;padding:0 16px;font-family:Tahoma,Arial,sans-serif;line-height:1.7">\n' +
    "    <p><a href=\"/\">MAHO Market</a></p>\n" +
    "    <h1>" + e(model.name) + "</h1>\n" +
    (model.image
      ? '    <p><img src="' + e(model.image) + '" alt="' + e(model.name) + '" style="max-width:100%;height:auto"></p>\n'
      : "") +
    "    <p><strong>کد کالا:</strong> <span dir=\"ltr\">" + e(model.code) + "</span></p>\n" +
    "    <p><strong>قیمت:</strong> " + priceText + "</p>\n" +
    "    <p><strong>موجودی:</strong> " + e(model.stockLabel) + "</p>\n" +
    "    <p>" + e(model.description) + "</p>\n" +
    '    <p><a href="/#products">مشاهده در فروشگاه</a></p>\n' +
    "  </main>\n" +
    "</body>\n" +
    "</html>\n";
}

function renderNotFoundHtml() {
  return "<!doctype html>\n" +
    '<html lang="fa" dir="rtl">\n' +
    "<head>\n" +
    '  <meta charset="utf-8">\n' +
    '  <meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    "  <title>محصول پیدا نشد | MAHO Market</title>\n" +
    '  <meta name="robots" content="noindex, nofollow">\n' +
    '  <link rel="stylesheet" href="/css/styles.css">\n' +
    "</head>\n" +
    "<body>\n" +
    '  <main style="max-width:720px;margin:40px auto;padding:0 16px;font-family:Tahoma,Arial,sans-serif">\n' +
    "    <h1>محصول پیدا نشد</h1>\n" +
    "    <p>این محصول وجود ندارد یا در دسترس نیست.</p>\n" +
    '    <p><a href="/">بازگشت به صفحه اصلی</a></p>\n' +
    "  </main>\n" +
    "</body>\n" +
    "</html>\n";
}

function escapeXml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Active products with a real public code → /p/{code} URLs (deduped).
 * Skips inactive rows and products without a stable code/sku/barcode.
 */
function listActiveProductSitemapUrls(products, siteUrl) {
  const base = siteBase(siteUrl);
  const seen = new Set();
  const urls = [];
  (Array.isArray(products) ? products : []).forEach((p) => {
    if (!isProductActive(p)) return;
    const code = productPublicCode(p);
    if (!code) return;
    if (/[#?/\s]/.test(code)) return;
    const key = code.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    urls.push(base + "/p/" + encodeURIComponent(code));
  });
  return urls;
}

/** Dynamic sitemap: homepage + active product SEO pages. No hashes / private paths. */
function buildSitemapXml(products, siteUrl) {
  const base = siteBase(siteUrl);
  const now = new Date().toISOString().slice(0, 10);
  const entries = [{ loc: base + "/", pri: "1.0", freq: "daily" }];
  listActiveProductSitemapUrls(products, siteUrl).forEach((loc) => {
    entries.push({ loc: loc, pri: "0.8", freq: "weekly" });
  });
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    entries.map((u) =>
      "  <url><loc>" + escapeXml(u.loc) + "</loc><lastmod>" + now +
      "</lastmod><changefreq>" + u.freq + "</changefreq><priority>" + u.pri + "</priority></url>"
    ).join("\n") +
    "\n</urlset>\n";
}

/**
 * Mount GET /p/:code — must be registered before static fallthrough is fine,
 * but should run as an explicit route.
 */
function mountProductPage(app, opts) {
  const getDb = opts && opts.getDb;
  const siteUrl = (opts && opts.siteUrl) || "https://mahomarket.com";

  app.get("/p/:code", (req, res) => {
    const db = typeof getDb === "function" ? getDb() : null;
    const products = db && Array.isArray(db.products) ? db.products : [];
    const product = findProductByCode(products, req.params.code);

    if (!product || !isProductActive(product)) {
      res.status(404);
      res.setHeader("Cache-Control", "no-store");
      res.type("html");
      return res.send(renderNotFoundHtml());
    }

    const model = buildProductPageModel(product, siteUrl);
    if (!model) {
      res.status(404);
      res.setHeader("Cache-Control", "no-store");
      res.type("html");
      return res.send(renderNotFoundHtml());
    }

    res.status(200);
    res.setHeader("Cache-Control", "public, max-age=60");
    res.type("html");
    return res.send(renderProductHtml(model));
  });
}

module.exports = {
  escapeHtml,
  escapeXml,
  findProductByCode,
  isProductActive,
  productPublicCode,
  absoluteAssetUrl,
  buildProductPageModel,
  renderProductHtml,
  renderNotFoundHtml,
  listActiveProductSitemapUrls,
  buildSitemapXml,
  mountProductPage,
};
