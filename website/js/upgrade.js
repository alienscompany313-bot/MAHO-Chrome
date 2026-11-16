/* Storefront additions: ads, hours, sharing, policies, customer card, passkeys. */
(function () {
  "use strict";
  var api = window.MAHOApi;
  if (!api) return;
  var promoTimer = null;
  var promoIndex = 0;
  var seenImpressions = {};
  var homeAdIndex = 0;
  var homeAdKey = "";
  var homeAdDrag = null;
  var homeAdWired = false;
  var homeAdVisible = true;

  function lang() {
    return document.documentElement.lang === "en" ? "en" : "fa";
  }
  function pick(row, fa, en) {
    if (!row) return "";
    return lang() === "en" ? (row[en] || row[fa] || "") : (row[fa] || row[en] || "");
  }
  function site() { return window.MAHO_SITE || {}; }

  function b64urlToBuf(s) {
    var pad = "=".repeat((4 - (s.length % 4)) % 4);
    var b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
    var bin = atob(b64);
    var buf = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf.buffer;
  }
  function bufToB64url(buf) {
    var bytes = new Uint8Array(buf);
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }
  function prepCreate(options) {
    var pk = Object.assign({}, options);
    pk.challenge = b64urlToBuf(options.challenge);
    pk.user = Object.assign({}, options.user, { id: b64urlToBuf(options.user.id) });
    pk.excludeCredentials = (options.excludeCredentials || []).map(function (c) {
      return Object.assign({}, c, { id: b64urlToBuf(c.id) });
    });
    return pk;
  }
  function prepGet(options) {
    var pk = Object.assign({}, options);
    pk.challenge = b64urlToBuf(options.challenge);
    pk.allowCredentials = (options.allowCredentials || []).map(function (c) {
      return Object.assign({}, c, { id: b64urlToBuf(c.id) });
    });
    return pk;
  }
  function credToJSON(cred) {
    var r = cred.response;
    var out = {
      id: cred.id,
      rawId: bufToB64url(cred.rawId),
      type: cred.type,
      response: {
        clientDataJSON: bufToB64url(r.clientDataJSON),
      },
    };
    if (r.attestationObject) out.response.attestationObject = bufToB64url(r.attestationObject);
    if (r.authenticatorData) out.response.authenticatorData = bufToB64url(r.authenticatorData);
    if (r.signature) out.response.signature = bufToB64url(r.signature);
    if (r.userHandle) out.response.userHandle = bufToB64url(r.userHandle);
    return out;
  }

  function track(ids) {
    var fresh = ids.filter(function (id) { return id && !seenImpressions[id]; });
    fresh.forEach(function (id) { seenImpressions[id] = 1; });
    if (!fresh.length) return;
    api.request("/api/ads/impression", { method: "POST", body: { ids: fresh } }).catch(function () {});
  }

  function paintAnnounce() {
    var bar = document.getElementById("announceBar");
    if (!bar) return;
    var rows = ((site().ads || {}).announcement || []);
    if (!rows.length) { bar.hidden = true; bar.innerHTML = ""; return; }
    var row = rows[0];
    var text = pick(row, "title", "title_en") || pick(row, "description", "description_en");
    if (!text) { bar.hidden = true; return; }
    bar.hidden = false;
    if (row.url) bar.innerHTML = '<a href="' + api.url("/api/ads/go/" + encodeURIComponent(row.id)) + '">' + text.replace(/</g, "") + "</a>";
    else bar.textContent = text;
    track([row.id]);
  }

  function esc(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function findAdProduct(code) {
    var list = window.MAHO_PRODUCTS || [];
    return list.find(function (item) {
      return item && String(item.code || "") === String(code || "") && item.enabled !== false && item.active !== false;
    }) || null;
  }
  function adMoney(amount) {
    var text = Math.round(Number(amount) || 0).toLocaleString("en-US");
    if (lang() === "fa") text = text.replace(/[0-9]/g, function (d) { return "۰۱۲۳۴۵۶۷۸۹"[d]; });
    return text + (lang() === "en" ? " AFN" : " افغانی");
  }
  function adPrice(product) {
    if (!product || product.price == null || product.price === "") return "";
    var price = Number(product.price) || 0;
    var disc = Number(product.discount) || 0;
    if (disc > 0 && disc < 100) price = Math.round(price * (1 - disc / 100));
    return adMoney(price);
  }
  function adSpecs(product) {
    if (!product) return "";
    var sizes = Array.isArray(product.sizes) ? product.sizes.filter(Boolean).slice(0, 4) : [];
    var colors = Array.isArray(product.colors) ? product.colors.map(function (c) { return String(c).split("|")[0]; }).filter(Boolean).slice(0, 3) : [];
    var parts = [];
    if (sizes.length) parts.push(sizes.join(lang() === "en" ? ", " : "، "));
    if (colors.length) parts.push(colors.join(lang() === "en" ? ", " : "، "));
    if (!parts.length) {
      var text = lang() === "en" ? (product.description_en || product.description || "") : (product.description || product.description_en || "");
      if (text) parts.push(String(text).slice(0, 80));
    }
    return parts.join(" · ");
  }
  function homeAdStep() {
    var card = document.querySelector("#homeAdsGrid .home-ad-card");
    var track = document.getElementById("homeAdsGrid");
    if (!card || !track) return 0;
    var gap = parseFloat(getComputedStyle(track).columnGap) || parseFloat(getComputedStyle(track).gap) || 0;
    return card.getBoundingClientRect().width + gap;
  }
  function homeAdMax() {
    var viewport = document.getElementById("homeAdsViewport");
    var step = homeAdStep();
    if (!viewport || !step) return 0;
    var count = document.querySelectorAll("#homeAdsGrid .home-ad-card").length;
    var visible = Math.max(1, Math.floor((viewport.clientWidth + 8) / step));
    return Math.max(0, count - visible);
  }
  function applyHomeAdTransform(extra) {
    var track = document.getElementById("homeAdsGrid");
    if (!track) return;
    var rtl = document.documentElement.dir === "rtl";
    var x = ((rtl ? 1 : -1) * homeAdIndex * homeAdStep()) + (extra || 0);
    track.style.transform = "translate3d(" + x + "px,0,0)";
  }
  function updateHomeAdControls() {
    var prev = document.getElementById("homeAdsPrev");
    var next = document.getElementById("homeAdsNext");
    var en = lang() === "en";
    var max = homeAdMax();
    if (homeAdIndex > max) homeAdIndex = max;
    if (prev) { prev.disabled = homeAdIndex <= 0; prev.hidden = max <= 0; prev.setAttribute("aria-label", en ? "Previous advertisements" : "قبلی"); }
    if (next) { next.disabled = homeAdIndex >= max; next.hidden = max <= 0; next.setAttribute("aria-label", en ? "Next advertisements" : "بعدی"); }
  }
  function moveHomeAd(delta) {
    var max = homeAdMax();
    var next = Math.max(0, Math.min(max, homeAdIndex + delta));
    if (next === homeAdIndex) return;
    homeAdIndex = next;
    applyHomeAdTransform(0);
    updateHomeAdControls();
    syncHomeAdVideo();
  }
  function syncHomeAdVideo() {
    var box = document.getElementById("homeAds");
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var modal = document.getElementById("qvOverlay") && document.getElementById("qvOverlay").classList.contains("show");
    var hidden = !box || box.hidden || !homeAdVisible || document.hidden || modal || reduce;
    var cards = Array.prototype.slice.call(document.querySelectorAll("#homeAdsGrid .home-ad-card"));
    var visibleEnd = homeAdIndex + Math.max(1, Math.round((document.getElementById("homeAdsViewport") || {}).clientWidth / (homeAdStep() || 1)));
    var played = false;
    cards.forEach(function (card, index) {
      var video = card.querySelector("video");
      if (!video) return;
      var inWindow = index >= homeAdIndex && index < visibleEnd;
      var active = !hidden && inWindow && !played && card.getAttribute("data-video");
      if (!active) {
        try { video.pause(); } catch (err) {}
        if (!inWindow && video.getAttribute("src")) { video.removeAttribute("src"); try { video.load(); } catch (err2) {} }
        return;
      }
      played = true;
      if (video.getAttribute("src") !== card.getAttribute("data-video")) video.src = card.getAttribute("data-video");
      video.muted = true;
      var play = video.play();
      if (play && play.catch) play.catch(function () {});
    });
  }
  function paintHomePromo() {
    var box = document.getElementById("homeAds");
    var grid = document.getElementById("homeAdsGrid");
    if (!box || !grid) return;
    var rows = ((site().ads || {}).homepage || []).filter(function (row) {
      return row && (row.title || row.title_en || row.description || row.description_en || row.imageUrl || row.videoUrl || row.productCode);
    });
    var sample = false;
    if (!rows.length) {
      if (site().previewAdSample !== true) { box.hidden = true; grid.innerHTML = ""; return; }
      sample = true;
      rows = [{
        sample: true,
        title: "پیش‌نمایش تبلیغ",
        title_en: "Advertisement Preview",
        description: "این کارت فقط در پیش‌نمایش محلی است و تبلیغ ذخیره‌شده نیست.",
        description_en: "This card is only for the local preview. It is not a saved advertisement.",
      }];
    }
    var key = rows.map(function (row) { return (row.id || "sample") + "|" + (row.productCode || "") + "|" + (row.videoUrl || "") + "|" + (row.imageUrl || ""); }).join(",");
    if (key !== homeAdKey) {
      homeAdKey = key;
      if (homeAdIndex >= rows.length) homeAdIndex = 0;
    }
    grid.innerHTML = rows.map(function (row) {
      var product = row.productCode ? findAdProduct(row.productCode) : null;
      var showName = row.showName !== false;
      var name = "";
      if (showName) name = product ? (lang() === "en" ? (product.name_en || product.name || "") : (product.name || product.name_en || "")) : pick(row, "title", "title_en");
      var price = row.showPrice !== false && product ? adPrice(product) : "";
      var specs = row.showSpecs !== false && product ? adSpecs(product) : "";
      var promo = pick(row, "description", "description_en");
      var poster = row.imageUrl || (product && ((product.images && product.images[0]) || product.image)) || "";
      if (window.matchMedia && window.matchMedia("(max-width: 720px)").matches && row.imageUrlMobile) poster = row.imageUrlMobile;
      var video = /^\/uploads\/[a-f0-9]{32}\.(mp4|webm)$/i.test(row.videoUrl || "") ? row.videoUrl : "";
      var media = video
        ? '<video muted playsinline loop preload="none"' + (poster ? ' poster="' + esc(poster) + '"' : "") + "></video>"
        : (poster ? '<img src="' + esc(poster) + '" alt="' + esc(name || "MAHO") + '">' : '<div class="home-ad-sample"></div>');
      var shade = '<span class="home-ad-shade">' +
        (name ? '<span class="home-ad-name">' + esc(name) + "</span>" : "") +
        (price ? '<span class="home-ad-price">' + esc(price) + "</span>" : "") +
        (specs ? '<span class="home-ad-specs">' + esc(specs) + "</span>" : "") +
        (promo ? '<span class="home-ad-promo">' + esc(promo) + "</span>" : "") +
        "</span>";
      var hit;
      if (product) hit = '<button type="button" class="home-ad-hit" data-product-code="' + esc(product.code) + '">';
      else if (!row.sample && row.url) hit = '<a class="home-ad-hit" href="' + esc(api.url("/api/ads/go/" + encodeURIComponent(row.id))) + '">';
      else hit = '<div class="home-ad-hit">';
      var close = product ? "</button>" : (!row.sample && row.url ? "</a>" : "</div>");
      return '<article class="home-ad-card' + (row.sample ? " is-sample" : "") + '" data-video="' + esc(video) + '">' + hit + '<span class="home-ad-media">' + media + shade + "</span>" + close + "</article>";
    }).join("");
    box.hidden = false;
    wireHomeAds();
    applyHomeAdTransform(0);
    updateHomeAdControls();
    syncHomeAdVideo();
    if (!sample) track(rows.map(function (row) { return row.id; }));
  }
  function wireHomeAds() {
    if (homeAdWired) return;
    var viewport = document.getElementById("homeAdsViewport");
    var prev = document.getElementById("homeAdsPrev");
    var next = document.getElementById("homeAdsNext");
    if (!viewport) return;
    homeAdWired = true;
    if (prev) prev.addEventListener("click", function () { moveHomeAd(-1); });
    if (next) next.addEventListener("click", function () { moveHomeAd(1); });
    viewport.addEventListener("keydown", function (e) {
      var rtl = document.documentElement.dir === "rtl";
      if (e.key === "ArrowLeft") { moveHomeAd(rtl ? 1 : -1); e.preventDefault(); }
      if (e.key === "ArrowRight") { moveHomeAd(rtl ? -1 : 1); e.preventDefault(); }
    });
    viewport.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      homeAdDrag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, axis: "" };
    });
    viewport.addEventListener("pointermove", function (e) {
      if (!homeAdDrag || e.pointerId !== homeAdDrag.id) return;
      var dx = e.clientX - homeAdDrag.x;
      var dy = e.clientY - homeAdDrag.y;
      var track = document.getElementById("homeAdsGrid");
      if (!homeAdDrag.axis) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (Math.abs(dy) > Math.abs(dx)) { viewport.dataset.suppress = "1"; homeAdDrag = null; return; }
        homeAdDrag.axis = "x";
        homeAdDrag.moved = true;
        if (track) track.style.transition = "none";
        try { viewport.setPointerCapture(e.pointerId); } catch (err) {}
      }
      applyHomeAdTransform(dx);
    });
    function endDrag(e) {
      if (!homeAdDrag || (e && e.pointerId !== homeAdDrag.id)) return;
      var dx = e ? e.clientX - homeAdDrag.x : 0;
      var moved = homeAdDrag.moved;
      homeAdDrag = null;
      var track = document.getElementById("homeAdsGrid");
      if (track) track.style.transition = "";
      if (moved && Math.abs(dx) > 24) {
        var rtl = document.documentElement.dir === "rtl";
        moveHomeAd((rtl ? dx > 0 : dx < 0) ? 1 : -1);
      } else applyHomeAdTransform(0);
      if (moved) viewport.dataset.suppress = "1";
    }
    viewport.addEventListener("pointerup", endDrag);
    viewport.addEventListener("pointercancel", endDrag);
    viewport.addEventListener("click", function (e) {
      if (viewport.dataset.suppress === "1") {
        viewport.dataset.suppress = "";
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      var card = e.target.closest && e.target.closest("[data-product-code]");
      if (!card) return;
      e.preventDefault();
      document.dispatchEvent(new CustomEvent("maho:open-product", { detail: { code: card.getAttribute("data-product-code") } }));
    });
    if ("IntersectionObserver" in window) {
      var box = document.getElementById("homeAds");
      if (box) {
        new IntersectionObserver(function (entries) {
          homeAdVisible = entries.some(function (entry) { return entry.isIntersecting; });
          syncHomeAdVideo();
        }, { threshold: 0.2 }).observe(box);
      }
    }
    document.addEventListener("visibilitychange", syncHomeAdVideo);
    window.addEventListener("resize", function () { applyHomeAdTransform(0); updateHomeAdControls(); syncHomeAdVideo(); });
    var qv = document.getElementById("qvOverlay");
    if (qv && window.MutationObserver) new MutationObserver(syncHomeAdVideo).observe(qv, { attributes: true, attributeFilter: ["class"] });
  }

  function paintListing() {
    var grid = document.getElementById("productGrid");
    if (!grid) return;
    Array.prototype.forEach.call(grid.querySelectorAll(".listing-promo"), function (n) { n.remove(); });
    var rows = ((site().ads || {}).listing || []);
    if (!rows.length) return;
    var cards = grid.querySelectorAll(".product-card");
    rows.forEach(function (row, i) {
      var node = document.createElement("article");
      node.className = "listing-promo";
      var title = pick(row, "title", "title_en");
      var desc = pick(row, "description", "description_en");
      var href = row.url ? api.url("/api/ads/go/" + encodeURIComponent(row.id)) : "#";
      node.innerHTML = '<a href="' + href + '">' +
        (row.imageUrl ? '<img src="' + row.imageUrl.replace(/"/g, "") + '" alt="' + (title || "MAHO").replace(/"/g, "") + '">' : "") +
        "<div><strong>" + (title || "") + "</strong><div>" + (desc || "") + "</div></div></a>";
      var at = Math.min(cards.length, (i + 1) * 4);
      if (cards[at]) grid.insertBefore(node, cards[at]);
      else grid.appendChild(node);
      track([row.id]);
    });
  }

  function paintHours() {
    var buttons = document.querySelectorAll("[data-store-status]");
    if (!buttons.length) return;
    buttons.forEach(function (btn) {
      var id = btn.getAttribute("data-store-status") || "";
      api.request("/api/store-hours" + (id ? "?storeId=" + encodeURIComponent(id) : "")).then(function (data) {
        var open = !!(data && data.open);
        btn.textContent = open ? (lang() === "en" ? "Open" : "باز است") : (lang() === "en" ? "Closed" : "بسته است");
        btn.classList.toggle("is-closed", !open);
        btn._hours = data;
        var hoursBtn = document.querySelector('[data-store-hours="' + id + '"]');
        if (hoursBtn) {
          hoursBtn._hours = data;
          var today = data.today || {};
          hoursBtn.textContent = today.closed
            ? (lang() === "en" ? "Closed today" : "امروز تعطیل")
            : ((lang() === "en" ? "Today " : "امروز ") + (today.open || "") + " – " + (today.close || ""));
        }
      }).catch(function () {});
    });
  }

  function openHours(data) {
    var ov = document.getElementById("hoursOverlay");
    if (!ov || !data) return;
    var en = lang() === "en";
    document.getElementById("hoursTitle").textContent = en ? "Business hours" : "ساعت کاری";
    document.getElementById("hoursNow").textContent = (data.open ? (en ? "Open now" : "اکنون باز است") : (en ? "Closed now" : "اکنون بسته است")) + " · " + (data.time || "") + " · " + (data.timezone || "Asia/Kabul");
    var list = document.getElementById("hoursWeek");
    list.innerHTML = (data.week || []).map(function (d) {
      var label = en ? d.label_en : d.label;
      var span = d.closed ? (en ? "Closed" : "تعطیل") : (d.open + " – " + d.close);
      return "<li class=\"" + (d.today ? "today" : "") + "\"><span>" + label + "</span><span dir=\"ltr\">" + span + "</span></li>";
    }).join("");
    var note = document.getElementById("hoursClosure");
    if (data.closure && (data.closure.note || data.closure.note_en)) {
      note.hidden = false;
      note.textContent = en ? (data.closure.note_en || data.closure.note) : (data.closure.note || data.closure.note_en);
    } else note.hidden = true;
    ov.classList.add("show");
  }

  function publicBase() {
    var configured = window.MAHO_SITE && MAHO_SITE.publicUrl ? String(MAHO_SITE.publicUrl).replace(/\/+$/, "") : "";
    if (configured && !/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/i.test(configured)) return configured;
    return location.origin;
  }
  function productUrl(p) {
    var code = (p && (p.code || p.sku || p.barcode)) || "";
    var base = publicBase();
    if (!code) return base + "/";
    return base + "/p/" + encodeURIComponent(code);
  }
  function copyText(value) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(value).catch(function () { copyTextFallback(value); });
    }
    copyTextFallback(value);
    return Promise.resolve();
  }
  function copyTextFallback(value) {
    var area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    try { document.execCommand("copy"); } catch (_) {}
    area.remove();
  }
  function shareIsOpen(menu) {
    return !!(menu && (!menu.hidden || (menu.matches && menu.matches(":popover-open"))));
  }
  function closeShareMenu() {
    var menu = document.getElementById("shareMenu");
    if (!menu) return;
    if (typeof menu.hidePopover === "function") {
      try { if (menu.matches(":popover-open")) menu.hidePopover(); } catch (_) {}
    }
    menu.hidden = true;
    menu.dataset.code = "";
  }
  window.mahoCloseShare = closeShareMenu;
  function openShareMenu(menu) {
    if (menu.parentElement !== document.body) document.body.appendChild(menu);
    menu.setAttribute("popover", "manual");
    menu.hidden = false;
    if (typeof menu.showPopover === "function") {
      try { if (!menu.matches(":popover-open")) menu.showPopover(); } catch (_) {}
    }
  }
  function placeShareMenu(menu, anchor) {
    var rect = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: 16, right: 16, top: 16, bottom: 16 };
    var width = menu.offsetWidth || 180;
    var height = menu.offsetHeight || 180;
    var left = document.documentElement.dir === "rtl" ? rect.right - width : rect.left;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    var top = rect.bottom + 8;
    if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 8);
    menu.style.left = left + "px";
    menu.style.top = top + "px";
  }
  function shareMenu(p, anchor) {
    var menu = document.getElementById("shareMenu");
    if (!menu) return;
    var url = productUrl(p);
    var code = (p && (p.code || p.sku || p.barcode)) || url;
    if (menu.dataset.code === String(code) && shareIsOpen(menu)) { closeShareMenu(); return; }
    menu.dataset.code = String(code);
    menu.dataset.url = url;
    var name = (p && (lang() === "en" ? (p.name_en || p.name) : p.name)) || "MAHO";
    var text = name + " — " + url;
    menu.innerHTML = "";
    function add(label, fn) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        fn();
        closeShareMenu();
      });
      menu.appendChild(b);
    }
    if (navigator.share) add(lang() === "en" ? "Share…" : "اشتراک", function () { navigator.share({ title: name, text: name, url: url }).catch(function () {}); });
    add("WhatsApp", function () { window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank", "noopener"); });
    add("Facebook", function () { window.open("https://www.facebook.com/sharer/sharer.php?u=" + encodeURIComponent(url), "_blank", "noopener"); });
    add("Telegram", function () { window.open("https://t.me/share/url?url=" + encodeURIComponent(url) + "&text=" + encodeURIComponent(name), "_blank", "noopener"); });
    add(lang() === "en" ? "Copy link" : "کپی لینک", function () { copyText(url); });
    openShareMenu(menu);
    placeShareMenu(menu, anchor);
  }
  window.mahoShareProduct = shareMenu;

  function openPolicy(kind) {
    var ov = document.getElementById("policyOverlay");
    var title = document.getElementById("policyTitle");
    var body = document.getElementById("policyBody");
    var pdf = document.getElementById("policyPdf");
    if (!ov) return;
    title.textContent = kind === "privacy" ? (lang() === "en" ? "Privacy Policy" : "حریم خصوصی") : (lang() === "en" ? "Terms" : "قوانین و شرایط");
    body.textContent = lang() === "en" ? "Loading…" : "در حال بارگذاری…";
    pdf.innerHTML = "";
    ov.classList.add("show");
    api.request("/api/policies/" + kind).then(function (res) {
      var p = res.policy || {};
      title.textContent = pick(p, "title", "title_en") || title.textContent;
      body.textContent = pick(p, "body", "body_en") || "";
      if (p.hasPdf) pdf.innerHTML = '<a href="/api/policies/' + kind + '/pdf">PDF</a>';
    }).catch(function () {
      body.textContent = lang() === "en"
        ? "This document has not been published yet."
        : "این سند هنوز منتشر نشده است.";
    });
  }

  function loadCard() {
    var box = document.getElementById("customerCardBox");
    if (!box || !api.getToken("user")) { if (box) box.hidden = true; return; }
    var img = document.getElementById("customerCardImg");
    fetch(api.url("/api/me/card.png"), { headers: { Authorization: "Bearer " + api.getToken("user") }, cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("card"); return r.blob(); })
      .then(function (blob) {
        if (img._url) URL.revokeObjectURL(img._url);
        img._url = URL.createObjectURL(blob);
        img.src = img._url;
        box.hidden = false;
      }).catch(function () { box.hidden = true; });
    api.request("/api/me/passkeys", { token: api.getToken("user") }).then(function (res) {
      var list = document.getElementById("passkeyList");
      if (!list) return;
      list.innerHTML = (res.passkeys || []).map(function (p) {
        return '<div><span>' + (p.deviceName || "Passkey") + '</span> <button type="button" data-del-passkey="' + p.id + '">' + (lang() === "en" ? "Remove" : "حذف") + "</button></div>";
      }).join("");
    }).catch(function () {});
  }

  function downloadCard(kind) {
    var path = kind === "pdf" ? "/api/me/card.pdf" : "/api/me/card.png";
    fetch(api.url(path), { headers: { Authorization: "Bearer " + api.getToken("user") } })
      .then(function (r) { if (!r.ok) throw new Error("download"); return r.blob(); })
      .then(function (blob) {
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = kind === "pdf" ? "maho-customer-card.pdf" : "maho-customer-card.png";
        a.click();
      }).catch(function () {});
  }

  document.addEventListener("maho:rendered", function () {
    try { paintTheme(); } catch (err) {}
    try { paintAnnounce(); } catch (err) {}
    try { paintHomePromo(); } catch (err) {}
    try { paintListing(); } catch (err) {}
    try { paintHours(); } catch (err) {}
    var terms = document.getElementById("suTermsText");
    if (terms) {
      terms.innerHTML = lang() === "en"
        ? 'I have read and agree to the MAHO Terms and Privacy Policy. <button type="button" class="link-back" id="openTerms" style="display:inline;padding:0">Terms</button> · <button type="button" class="link-back" id="openPrivacy" style="display:inline;padding:0">Privacy</button>'
        : 'من قوانین و شرایط استفاده و پالیسی حریم خصوصی فروشگاه ماهو را مطالعه کرده‌ام و با آن‌ها موافق هستم. <button type="button" class="link-back" id="openTerms" style="display:inline;padding:0">قوانین</button> · <button type="button" class="link-back" id="openPrivacy" style="display:inline;padding:0">حریم خصوصی</button>';
    }
    if (api.getToken("user")) loadCard();
  });

  document.addEventListener("click", function (e) {
    var pause = e.target.closest("[data-promo-pause]");
    if (pause) {
      e.preventDefault();
      var home = document.getElementById("homePromo");
      if (home) home.dataset.paused = home.dataset.paused ? "" : "1";
      paintHomePromo();
      return;
    }
    var promo = e.target.closest("[data-promo]");
    if (promo) {
      e.preventDefault();
      promoIndex += parseInt(promo.getAttribute("data-promo"), 10) || 1;
      paintHomePromo();
      return;
    }
    var hoursBtn = e.target.closest("[data-store-status], [data-store-hours]");
    if (hoursBtn && hoursBtn._hours) { openHours(hoursBtn._hours); return; }
    if (e.target.id === "hoursClose" || e.target.id === "hoursOverlay") document.getElementById("hoursOverlay").classList.remove("show");
    if (e.target.id === "policyClose" || e.target.id === "policyOverlay") document.getElementById("policyOverlay").classList.remove("show");
    if (e.target.id === "openTerms" || e.target.id === "footerTerms") { if (e.target.id === "openTerms") { e.preventDefault(); openPolicy("terms"); } }
    if (e.target.id === "openPrivacy" || (e.target.id === "footerPrivacy" && e.metaKey)) { if (e.target.id === "openPrivacy") { e.preventDefault(); openPolicy("privacy"); } }
    if (e.target.id === "qvShare") {
      var code = e.target.dataset.code || "";
      shareMenu({ code: code, name: e.target.dataset.name || "MAHO" }, e.target);
    }
    if (!e.target.closest("#shareMenu") && e.target.id !== "qvShare" && !e.target.closest("[data-share]")) {
      closeShareMenu();
    }
    if (e.target.id === "footerTrackLink") {
      e.preventDefault();
      if (api.getToken("user")) {
        var orders = document.getElementById("ordersBtn");
        if (orders) orders.click();
      } else {
        try { sessionStorage.setItem("maho_after_login", "orders"); } catch (_) {}
        var acct = document.getElementById("accountBtn");
        if (acct) acct.click();
      }
    }
    if (e.target.id === "cardPng" || e.target.id === "cardPdf") {
      e.preventDefault();
      downloadCard(e.target.id === "cardPdf" ? "pdf" : "png");
    }
    if (e.target.id === "cardEmailBtn") {
      var line = document.getElementById("cardStatusLine");
      api.request("/api/me/card/email", { method: "POST", token: api.getToken("user"), body: {} }).then(function () {
        if (line) line.textContent = lang() === "en" ? "Card emailed to your verified address." : "کارت به ایمیل تأییدشده شما فرستاده شد.";
      }).catch(function (err) {
        if (line) line.textContent = (err && err.message) || (lang() === "en" ? "Email failed." : "ارسال ایمیل ناموفق بود.");
      });
    }
    var del = e.target.closest("[data-del-passkey]");
    if (del) {
      api.request("/api/me/passkeys/" + encodeURIComponent(del.getAttribute("data-del-passkey")), { method: "DELETE", token: api.getToken("user") }).then(loadCard).catch(function () {});
    }
  });

  var passkeyLogin = document.getElementById("passkeyLoginBtn");
  if (passkeyLogin) {
    if (!window.PublicKeyCredential) passkeyLogin.hidden = true;
    passkeyLogin.addEventListener("click", function () {
      api.request("/api/auth/passkey/login-options", { method: "POST", body: {} }).then(function (res) {
        return navigator.credentials.get({ publicKey: prepGet(res.options) }).then(function (cred) {
          return api.request("/api/auth/passkey/login", { method: "POST", body: { challengeId: res.challengeId, credential: credToJSON(cred) } });
        });
      }).then(function (res) {
        if (!res || !res.token || !res.user) {
          var msg = document.getElementById("acctMsg");
          if (msg) msg.textContent = lang() === "en" ? "Passkey sign-in did not create a session." : "ورود با Passkey نشست نساخت.";
          return;
        }
        api.setToken("user", res.token);
        try {
          localStorage.setItem("maho_session", JSON.stringify({
            name: res.user.name, id: res.user.id || res.user.email, email: res.user.email,
            phone: res.user.phone || "", address: res.user.address || "", addr: res.user.addr || {},
            customerNo: res.user.customerNo || "", apiToken: res.token
          }));
        } catch (_) {}
        var next = "/";
        try { if (sessionStorage.getItem("maho_after_login") === "orders") next = "/#orders"; } catch (_) {}
        location.href = next;
      }).catch(function (err) {
        var msg = document.getElementById("acctMsg");
        if (msg) msg.textContent = (err && (err.message || err.error)) || (lang() === "en" ? "Passkey sign-in failed." : "ورود با Passkey ناموفق بود.");
      });
    });
  }
  var passkeyAdd = document.getElementById("passkeyAddBtn");
  if (passkeyAdd) {
    if (!window.PublicKeyCredential) passkeyAdd.hidden = true;
    passkeyAdd.addEventListener("click", function () {
      api.request("/api/auth/passkey/register-options", { method: "POST", body: {}, token: api.getToken("user") }).then(function (res) {
        return navigator.credentials.create({ publicKey: prepCreate(res.options) }).then(function (cred) {
          return api.request("/api/auth/passkey/register", {
            method: "POST",
            token: api.getToken("user"),
            body: { challengeId: res.challengeId, credential: credToJSON(cred), deviceName: lang() === "en" ? "This device" : "این دستگاه" },
          });
        });
      }).then(loadCard).catch(function () {});
    });
  }

  if (location.hash === "#orders" && !api.getToken("user")) {
    try { sessionStorage.setItem("maho_after_login", "orders"); } catch (_) {}
  }

  var themeBtn = document.getElementById("themeToggle");
  function paintTheme() {
    var mode = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    if (themeBtn) {
      themeBtn.textContent = mode === "dark" ? "☀" : "☾";
      themeBtn.setAttribute("aria-pressed", mode === "dark" ? "true" : "false");
      themeBtn.setAttribute("aria-label", mode === "dark" ? (lang() === "en" ? "Light Mode" : "نمای روشن") : (lang() === "en" ? "Dark Mode" : "نمای تیره"));
    }
  }
  paintTheme();
  if (themeBtn) themeBtn.addEventListener("click", function () {
    var next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("maho_theme", next); } catch (_) {}
    paintTheme();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    var menu = document.getElementById("shareMenu");
    if (!shareIsOpen(menu)) return;
    closeShareMenu();
    e.preventDefault();
    e.stopPropagation();
  }, true);

  var applyCoupon = document.getElementById("applyCoupon");
  var removeCoupon = document.getElementById("removeCoupon");
  function couponNote(text) { var el = document.getElementById("couponMsg"); if (el) el.textContent = text || ""; }
  if (applyCoupon) applyCoupon.addEventListener("click", function () {
    var code = (document.getElementById("co_coupon").value || "").trim();
    var cart = [];
    try { cart = JSON.parse(localStorage.getItem("maho_cart") || "[]"); } catch (_) {}
    api.request("/api/coupons/preview", { method: "POST", token: api.getToken("user"), body: { code: code, items: cart } }).then(function (res) {
      window.MAHO_COUPON = res.code;
      window.MAHO_COUPON_QUOTE = { code: res.code, amount: Number(res.amount) || 0, reason: res.name || res.message || "" };
      document.dispatchEvent(new CustomEvent("maho:coupon"));
      couponNote((lang() === "en" ? "Coupon applied: " : "کود اعمال شد: ") + res.code + " · " + res.amount);
    }).catch(function (err) {
      window.MAHO_COUPON = "";
      window.MAHO_COUPON_QUOTE = null;
      document.dispatchEvent(new CustomEvent("maho:coupon"));
      couponNote((err && err.message) || (lang() === "en" ? "Coupon was not accepted." : "کود پذیرفته نشد."));
    });
  });
  if (removeCoupon) removeCoupon.addEventListener("click", function () {
    window.MAHO_COUPON = "";
    window.MAHO_COUPON_QUOTE = null;
    document.dispatchEvent(new CustomEvent("maho:coupon"));
    var input = document.getElementById("co_coupon");
    if (input) input.value = "";
    couponNote(lang() === "en" ? "Coupon removed." : "کود حذف شد.");
  });

  function lifeMsg(text) { var el = document.getElementById("lifeMsg"); if (el) el.textContent = text || ""; }
  var deactivateBtn = document.getElementById("deactivateBtn");
  if (deactivateBtn) deactivateBtn.addEventListener("click", function () {
    api.request("/api/me/deactivate", { method: "POST", token: api.getToken("user"), body: {} }).then(function () {
      lifeMsg(lang() === "en" ? "Account deactivated. You can reactivate it here." : "حساب غیرفعال شد. از همین‌جا می‌توانید دوباره فعال کنید.");
      var b = document.getElementById("reactivateBtn"); if (b) b.hidden = false;
    }).catch(function (err) { lifeMsg(err.message || "error"); });
  });
  var reactivateBtn = document.getElementById("reactivateBtn");
  if (reactivateBtn) reactivateBtn.addEventListener("click", function () {
    api.request("/api/me/reactivate", { method: "POST", token: api.getToken("user"), body: {} }).then(function () {
      lifeMsg(lang() === "en" ? "Account is active again." : "حساب دوباره فعال شد.");
    }).catch(function (err) { lifeMsg(err.message || "error"); });
  });
  var deleteStart = document.getElementById("deleteStartBtn");
  if (deleteStart) deleteStart.addEventListener("click", function () {
    if (!confirm(lang() === "en" ? "Permanent deletion cannot be undone. Send a code to your email?" : "حذف دائمی برگشت‌پذیر نیست. کود به ایمیل شما فرستاده شود؟")) return;
    api.request("/api/me/delete/start", { method: "POST", token: api.getToken("user"), body: {} }).then(function (res) {
      document.getElementById("deleteConfirmBox").hidden = false;
      lifeMsg(lang() === "en" ? "Enter the 6-digit code from your email. It expires in 10 minutes." : "کود ۶ رقمی ایمیل را وارد کنید. اعتبار آن ۱۰ دقیقه است.");
      if (res && res.devCode) lifeMsg((lang() === "en" ? "Dev code: " : "کود آزمایشی: ") + res.devCode);
    }).catch(function (err) { lifeMsg(err.message || "error"); });
  });
  var deleteConfirm = document.getElementById("deleteConfirmBtn");
  if (deleteConfirm) deleteConfirm.addEventListener("click", function () {
    api.request("/api/me/delete/confirm", { method: "POST", token: api.getToken("user"), body: { code: document.getElementById("deleteCode").value, confirm: "DELETE" } }).then(function () {
      api.setToken("user", "");
      try { localStorage.removeItem("maho_session"); } catch (_) {}
      location.href = "/";
    }).catch(function (err) { lifeMsg(err.message || (lang() === "en" ? "Deletion was not confirmed." : "حذف تأیید نشد.")); });
  });
})();
