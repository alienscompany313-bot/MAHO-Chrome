(function (root) {
  "use strict";
  function fold(value) {
    return String(value || "").toLowerCase().replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/\s+/g, " ").trim();
  }
  function active(product) {
    return product && product.enabled !== false && product.active !== false;
  }
  function textOf(product) {
    return [product.name, product.name_en, product.code, product.cat, product.badgeText, product.badgeText_en].join(" ");
  }
  function pageProducts(products, opts) {
    const options = opts || {};
    const query = fold(options.q || "");
    const cat = options.cat || "all";
    const pageSize = Math.max(1, parseInt(options.pageSize, 10) || 24);
    const homeCount = Math.max(1, parseInt(options.homeCount, 10) || 12);
    let page = Math.max(1, parseInt(options.page, 10) || 1);
    const rows = (Array.isArray(products) ? products : []).map(function (product, index) {
      return { product: product, index: index };
    }).filter(function (row) {
      if (!active(row.product)) return false;
      if (cat !== "all" && row.product.cat !== cat) return false;
      if (query && fold(textOf(row.product)).indexOf(query) < 0) return false;
      return true;
    });
    const home = options.mode !== "catalog" && !query && cat === "all";
    if (home) {
      return { items: rows.slice(0, homeCount), total: rows.length, page: 1, pages: 1, mode: "home", homeCount: homeCount };
    }
    const pages = Math.max(1, Math.ceil(rows.length / pageSize));
    if (page > pages) page = pages;
    const start = (page - 1) * pageSize;
    return { items: rows.slice(start, start + pageSize), total: rows.length, page: page, pages: pages, mode: "catalog", pageSize: pageSize };
  }
  const api = { fold: fold, pageProducts: pageProducts };
  root.MAHOCatalog = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : global);
