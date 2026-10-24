/* Storefront additions: ads, hours, sharing, policies, customer card, passkeys. */
(function () {
  "use strict";
  var api = window.MAHOApi;
  if (!api) return;
  var promoTimer = null;
  var promoIndex = 0;
  var seenImpressions = {};

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

  function paintHomePromo() {
    var box = document.getElementById("homePromo");
    if (!box) return;
    var rows = ((site().ads || {}).homepage || []);
    if (!rows.length) { box.hidden = true; box.innerHTML = ""; if (promoTimer) clearInterval(promoTimer); return; }
    box.hidden = false;
    function draw() {
      var row = rows[promoIndex % rows.length];
      var title = pick(row, "title", "title_en");
      var desc = pick(row, "description", "description_en");
      var cta = pick(row, "cta", "cta_en");
      var imgSrc = row.imageUrl || "";
      if (window.matchMedia && window.matchMedia("(max-width: 720px)").matches && row.imageUrlMobile) imgSrc = row.imageUrlMobile;
      var img = imgSrc ? '<img src="' + imgSrc.replace(/"/g, "") + '" alt="' + (title || "MAHO").replace(/"/g, "") + '">' : "";
      var href = row.url ? api.url("/api/ads/go/" + encodeURIComponent(row.id)) : "";
      var inner = img + '<div class="home-promo-copy"><strong>' + (title || "") + "</strong><div>" + (desc || "") + "</div>" + (cta ? "<span>" + cta + "</span>" : "") + "</div>";
      var controls = '<div class="promo-nav"><button type="button" data-promo-pause="1" aria-label="' + (lang() === "en" ? "Pause" : "توقف") + '">❚❚</button>';
      if (rows.length > 1) controls += '<button type="button" data-promo="-1" aria-label="prev">‹</button><button type="button" data-promo="1" aria-label="next">›</button>';
      controls += "</div>";
      box.innerHTML = '<div class="container"><div class="home-promo-frame" role="region" aria-roledescription="carousel" aria-label="MAHO">' + (href ? '<a href="' + href + '">' + inner + "</a>" : inner) + controls + "</div></div>";
      track([row.id]);
    }
    draw();
    if (promoTimer) clearInterval(promoTimer);
    if (rows.length > 1 && !box.dataset.paused) promoTimer = setInterval(function () { promoIndex += 1; draw(); }, 7000);
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

  function productUrl(p) {
    var code = (p && (p.code || p.sku || p.barcode)) || "";
    if (!code) return location.origin + "/";
    return location.origin + "/p/" + encodeURIComponent(code);
  }
  function shareMenu(p, anchor) {
    var menu = document.getElementById("shareMenu");
    if (!menu) return;
    var url = productUrl(p);
    var code = (p && (p.code || p.sku || p.barcode)) || url;
    if (menu.dataset.code === String(code) && !menu.hidden) { menu.hidden = true; menu.dataset.code = ""; return; }
    menu.dataset.code = String(code);
    var name = (p && (lang() === "en" ? (p.name_en || p.name) : p.name)) || "MAHO";
    var text = name + " — " + url;
    menu.innerHTML = "";
    function add(label, fn) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.addEventListener("click", function () { fn(); menu.hidden = true; });
      menu.appendChild(b);
    }
    if (navigator.share) add(lang() === "en" ? "Share…" : "اشتراک", function () { navigator.share({ title: name, text: name, url: url }).catch(function () {}); });
    add("WhatsApp", function () { window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank", "noopener"); });
    add("Facebook", function () { window.open("https://www.facebook.com/sharer/sharer.php?u=" + encodeURIComponent(url), "_blank", "noopener"); });
    add("Telegram", function () { window.open("https://t.me/share/url?url=" + encodeURIComponent(url) + "&text=" + encodeURIComponent(name), "_blank", "noopener"); });
    add(lang() === "en" ? "Copy link" : "کپی لینک", function () {
      if (navigator.clipboard) navigator.clipboard.writeText(url).catch(function () {});
    });
    var rect = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: 20, bottom: 20 };
    menu.style.top = (rect.bottom + 8) + "px";
    menu.style.left = Math.max(8, rect.left) + "px";
    menu.hidden = false;
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
    paintAnnounce();
    paintHomePromo();
    paintListing();
    paintHours();
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
      var menu = document.getElementById("shareMenu");
      if (menu) menu.hidden = true;
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
      themeBtn.setAttribute("aria-label", mode === "dark" ? (lang() === "en" ? "Light mode" : "نمای روشن") : (lang() === "en" ? "Dark mode" : "نمای تیره"));
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
    if (menu) { menu.hidden = true; menu.dataset.code = ""; }
  });

  var applyCoupon = document.getElementById("applyCoupon");
  var removeCoupon = document.getElementById("removeCoupon");
  function couponNote(text) { var el = document.getElementById("couponMsg"); if (el) el.textContent = text || ""; }
  if (applyCoupon) applyCoupon.addEventListener("click", function () {
    var code = (document.getElementById("co_coupon").value || "").trim();
    var cart = [];
    try { cart = JSON.parse(localStorage.getItem("maho_cart") || "[]"); } catch (_) {}
    api.request("/api/coupons/preview", { method: "POST", token: api.getToken("user"), body: { code: code, items: cart } }).then(function (res) {
      window.MAHO_COUPON = res.code;
      couponNote((lang() === "en" ? "Coupon applied: " : "کود اعمال شد: ") + res.code + " · " + res.amount);
    }).catch(function (err) {
      window.MAHO_COUPON = "";
      couponNote((err && err.message) || (lang() === "en" ? "Coupon was not accepted." : "کود پذیرفته نشد."));
    });
  });
  if (removeCoupon) removeCoupon.addEventListener("click", function () {
    window.MAHO_COUPON = "";
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
