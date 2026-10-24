(function () {
  "use strict";
  var api = window.MAHOApi;
  if (!api) return;
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  }
  function token() { return api.getToken("admin"); }
  function call(path, opts) {
    opts = opts || {};
    opts.token = token();
    return api.request(path, opts);
  }

  function paintBell() {
    var bell = document.getElementById("orderBell");
    if (!bell || !token()) return;
    call("/api/admin/order-notifications").then(function (data) {
      var n = data.unread || 0;
      bell.hidden = false;
      document.getElementById("orderBellCount").textContent = String(n);
      bell._items = data.notifications || [];
    }).catch(function () { bell.hidden = true; });
  }
  if (document.getElementById("orderBell")) {
    document.getElementById("orderBell").addEventListener("click", function () {
      var items = this._items || [];
      var unread = items.filter(function (x) { return !x.readAt; }).slice(0, 8);
      if (!unread.length) { alert("سفارش خوانده‌نشده‌ای نیست."); return; }
      var lines = unread.map(function (x) {
        var s = x.summary || {};
        return (s.orderId || "") + " · " + (s.name || "") + " · " + (s.total || 0) + " AFN";
      }).join("\n");
      if (confirm(lines + "\n\nهمه خوانده شود؟")) {
        call("/api/admin/order-notifications/all/read", { method: "POST", body: {} }).then(paintBell);
      }
    });
    setInterval(paintBell, 25000);
    setTimeout(paintBell, 1200);
  }

  var qOrder = new URLSearchParams(location.search).get("order");
  if (qOrder) {
    setTimeout(function () {
      var btn = document.querySelector('#sideNav [data-panel="orders"]');
      if (btn) btn.click();
    }, 600);
  }

  function hoursForm() {
    var box = document.getElementById("hoursAdmin");
    if (!box) return;
    call("/api/admin/store-hours").then(function (data) {
      window._hoursAdmin = data;
      renderHours(data, "");
    }).catch(function (e) { box.textContent = e.message || "نیاز به دسترسی تنظیمات"; });
  }
  function scheduleForScope(data, storeId) {
    if (!storeId) return data.schedule || {};
    var store = (data.stores || []).find(function (s) { return s.id === storeId; });
    return (store && store.hoursSchedule) || data.schedule || {};
  }
  function renderHours(data, storeId) {
    var box = document.getElementById("hoursAdmin");
    var days = ["sat", "sun", "mon", "tue", "wed", "thu", "fri"];
    var labels = { sat: "شنبه", sun: "یکشنبه", mon: "دوشنبه", tue: "سه‌شنبه", wed: "چهارشنبه", thu: "پنجشنبه", fri: "جمعه" };
    var sch = scheduleForScope(data, storeId);
    var usingOwn = !!(storeId && (data.stores || []).some(function (s) { return s.id === storeId && s.hoursSchedule; }));
    var options = '<option value="">ساعت عمومی فروشگاه</option>' + (data.stores || []).map(function (s) {
      return '<option value="' + esc(s.id) + '"' + (s.id === storeId ? " selected" : "") + ">" + esc(s.name || s.id) + (s.hoursSchedule ? " — ساعت جدا" : " — ساعت عمومی") + "</option>";
    }).join("");
    box.innerHTML = '<div class="field"><label>کدام فروشگاه؟</label><select id="hoursScope">' + options + "</select></div>" +
      '<p class="note">' + (storeId ? (usingOwn ? "این فروشگاه ساعت مستقل دارد." : "این فروشگاه از ساعت عمومی استفاده می‌کند. با ذخیره، ساعت مستقل می‌شود.") : "این ساعت پیش‌فرض همه فروشگاه‌هایی است که ساعت جدا ندارند.") + "</p>" +
      days.map(function (d) {
        var row = (sch.days && sch.days[d]) || {};
        return '<div class="grid2"><div class="field"><label>' + labels[d] + ' باز</label><input data-day="' + d + '" data-k="open" value="' + esc(row.open || "") + '" dir="ltr"></div>' +
          '<div class="field"><label>بسته</label><input data-day="' + d + '" data-k="close" value="' + esc(row.close || "") + '" dir="ltr"></div></div>';
      }).join("") +
      '<div class="field"><label>تعطیلی خاص (YYYY-MM-DD، یکی در هر خط، اختیاری یادداشت بعد از |)</label><textarea id="closuresBox" rows="4" dir="ltr">' +
      esc((sch.closures || []).map(function (c) { return c.date + (c.note ? " | " + c.note : ""); }).join("\n")) +
      '</textarea></div><button class="btn btn-gold" id="saveHours" type="button">ذخیره ساعت</button> ' +
      (storeId ? '<button class="btn btn-outline" id="hoursUseGlobal" type="button">برگشت به ساعت عمومی</button>' : "");
    document.getElementById("hoursScope").onchange = function () { renderHours(window._hoursAdmin, this.value); };
    document.getElementById("saveHours").onclick = function () { saveHours(storeId, false); };
    var back = document.getElementById("hoursUseGlobal");
    if (back) back.onclick = function () { saveHours(storeId, true); };
  }
  function saveHours(storeId, useGlobal) {
    var box = document.getElementById("hoursAdmin");
    var days = ["sat", "sun", "mon", "tue", "wed", "thu", "fri"];
    var daysOut = {};
    days.forEach(function (d) {
      daysOut[d] = { open: box.querySelector('[data-day="' + d + '"][data-k="open"]').value, close: box.querySelector('[data-day="' + d + '"][data-k="close"]').value, closed: false };
    });
    var closures = document.getElementById("closuresBox").value.split(/\n/).map(function (line) {
      var parts = line.split("|");
      var date = (parts[0] || "").trim();
      if (!date) return null;
      return { date: date, closed: true, note: (parts[1] || "").trim() };
    }).filter(Boolean);
    var body = useGlobal ? { storeId: storeId, useGlobal: true } : { storeId: storeId || undefined, schedule: { days: daysOut, closures: closures } };
    call("/api/admin/store-hours", { method: "PUT", body: body }).then(function () { alert("ذخیره شد"); hoursForm(); }).catch(function (e) { alert(e.message || "خطا"); });
  }

  function dtLocal(ms) {
    if (!ms) return "";
    var d = new Date(Number(ms));
    if (isNaN(d.getTime())) return "";
    var pad = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function readAd(area, i, ad) {
    function val(k) {
      var el = document.querySelector('[data-area="' + area + '"][data-i="' + i + '"][data-k="' + k + '"]');
      if (!el) return ad[k];
      if (el.type === "checkbox") return el.checked;
      return el.value;
    }
    var start = val("startAt");
    var end = val("endAt");
    return {
      id: ad.id, enabled: !!val("enabled"), title: val("title") || "", title_en: val("title_en") || "",
      description: val("description") || "", description_en: val("description_en") || "",
      url: val("url") || "", imageUrl: val("imageUrl") || "", imageUrlMobile: val("imageUrlMobile") || "",
      cta: val("cta") || "", cta_en: val("cta_en") || "",
      startAt: start ? new Date(start).getTime() : null,
      endAt: end ? new Date(end).getTime() : null,
      order: i, impressions: ad.impressions, clicks: ad.clicks,
    };
  }
  function syncAdsFromDom() {
    if (!window._ads) return;
    ["announcement", "homepage", "listing"].forEach(function (name) {
      window._ads[name] = (window._ads[name] || []).map(function (ad, i) { return readAd(name, i, ad); });
    });
  }
  function renderAds() {
    var box = document.getElementById("adsAdmin");
    var data = window._ads || {};
    function area(name, title) {
      var rows = data[name] || [];
      return "<h3>" + title + "</h3>" + rows.map(function (ad, i) {
        return '<div class="field" style="border:1px solid #eee;padding:8px;border-radius:10px;margin-bottom:8px">' +
          '<label><input type="checkbox" data-area="' + name + '" data-i="' + i + '" data-k="enabled"' + (ad.enabled ? " checked" : "") + "> فعال — ترتیب " + (i + 1) + "</label>" +
          '<div><button type="button" class="btn btn-outline btn-sm" data-ad-move="' + name + '" data-i="' + i + '" data-dir="-1">بالا</button> ' +
          '<button type="button" class="btn btn-outline btn-sm" data-ad-move="' + name + '" data-i="' + i + '" data-dir="1">پایین</button> ' +
          '<button type="button" class="btn btn-outline btn-sm" data-ad-preview="' + name + '" data-i="' + i + '">پیش‌نمایش</button></div>' +
          '<input data-area="' + name + '" data-i="' + i + '" data-k="title" value="' + esc(ad.title || "") + '" placeholder="عنوان">' +
          '<input data-area="' + name + '" data-i="' + i + '" data-k="title_en" value="' + esc(ad.title_en || "") + '" placeholder="Title" dir="ltr">' +
          '<input data-area="' + name + '" data-i="' + i + '" data-k="description" value="' + esc(ad.description || "") + '" placeholder="توضیح">' +
          '<input data-area="' + name + '" data-i="' + i + '" data-k="url" value="' + esc(ad.url || "") + '" placeholder="https://" dir="ltr">' +
          '<input data-area="' + name + '" data-i="' + i + '" data-k="imageUrl" value="' + esc(ad.imageUrl || "") + '" placeholder="تصویر دسکتاپ" dir="ltr">' +
          '<input data-area="' + name + '" data-i="' + i + '" data-k="imageUrlMobile" value="' + esc(ad.imageUrlMobile || "") + '" placeholder="تصویر موبایل" dir="ltr">' +
          '<input data-area="' + name + '" data-i="' + i + '" data-k="cta" value="' + esc(ad.cta || "") + '" placeholder="متن دکمه">' +
          '<input data-area="' + name + '" data-i="' + i + '" data-k="cta_en" value="' + esc(ad.cta_en || "") + '" placeholder="Button" dir="ltr">' +
          '<div class="grid2"><div class="field"><label>شروع</label><input type="datetime-local" data-area="' + name + '" data-i="' + i + '" data-k="startAt" value="' + esc(dtLocal(ad.startAt)) + '" dir="ltr"></div>' +
          '<div class="field"><label>پایان</label><input type="datetime-local" data-area="' + name + '" data-i="' + i + '" data-k="endAt" value="' + esc(dtLocal(ad.endAt)) + '" dir="ltr"></div></div>' +
          '<div class="note">بازدید ' + (ad.impressions || 0) + " · کلیک " + (ad.clicks || 0) + "</div></div>";
      }).join("") + '<button type="button" class="btn btn-outline btn-sm" data-add-ad="' + name + '">+ مورد</button> <button type="button" class="btn btn-gold btn-sm" data-save-ad="' + name + '">ذخیره</button>';
    }
    box.innerHTML = "<p class=\"sub\">سه جای جدا. پیش‌نمایش فقط در پنل است و آگهی غیرفعال را روی سایت منتشر نمی‌کند. تاریخ شروع و پایان به وقت همین دستگاه ذخیره می‌شود.</p><div id=\"adPreview\" class=\"note\" hidden></div>" +
      area("announcement", "نوار اعلان") + area("homepage", "بنر صفحه اصلی") + area("listing", "کارت بین محصولات");
  }
  function adsForm() {
    var box = document.getElementById("adsAdmin");
    if (!box) return;
    call("/api/admin/ads").then(function (data) { window._ads = data; renderAds(); }).catch(function (e) { box.textContent = e.message || "خطا"; });
  }
  document.addEventListener("click", function (e) {
    var add = e.target.getAttribute && e.target.getAttribute("data-add-ad");
    if (add && window._ads) {
      syncAdsFromDom();
      window._ads[add] = window._ads[add] || [];
      window._ads[add].push({ enabled: false, title: "", title_en: "", description: "", url: "", imageUrl: "", startAt: null, endAt: null });
      renderAds();
    }
    var move = e.target.getAttribute && e.target.getAttribute("data-ad-move");
    if (move && window._ads) {
      syncAdsFromDom();
      var list = window._ads[move] || [];
      var from = parseInt(e.target.getAttribute("data-i"), 10);
      var to = from + parseInt(e.target.getAttribute("data-dir"), 10);
      if (to >= 0 && to < list.length) {
        var tmp = list[from]; list[from] = list[to]; list[to] = tmp;
        renderAds();
      }
    }
    var preview = e.target.getAttribute && e.target.getAttribute("data-ad-preview");
    if (preview) {
      syncAdsFromDom();
      var ad = (window._ads[preview] || [])[parseInt(e.target.getAttribute("data-i"), 10)];
      var slot = document.getElementById("adPreview");
      if (slot && ad) {
        var now = Date.now();
        var live = ad.enabled && (!ad.startAt || now >= ad.startAt) && (!ad.endAt || now <= ad.endAt);
        slot.hidden = false;
        slot.innerHTML = "<strong>پیش‌نمایش " + esc(preview) + "</strong> — " + (live ? "اگر ذخیره شود روی سایت دیده می‌شود" : "روی سایت دیده نمی‌شود") +
          "<div>" + esc(ad.title || ad.title_en || "") + "</div><div>" + esc(ad.description || "") + "</div>" +
          (ad.imageUrl ? '<img alt="" src="' + esc(ad.imageUrl) + '" style="max-width:220px;border-radius:8px">' : "");
      }
    }
    var save = e.target.getAttribute && e.target.getAttribute("data-save-ad");
    if (save && window._ads) {
      syncAdsFromDom();
      var items = window._ads[save] || [];
      call("/api/admin/ads/" + save, { method: "PUT", body: { items: items } }).then(function () { alert("ذخیره شد"); adsForm(); }).catch(function (err) { alert(err.message || "خطا"); });
    }
  });

  function policiesForm() {
    var box = document.getElementById("policiesAdmin");
    if (!box) return;
    call("/api/admin/policies").then(function (data) {
      function kind(name, title) {
        var rows = data[name] || [];
        return "<h3>" + title + "</h3>" + rows.map(function (v) {
          return "<div class=\"note\">" + esc(v.version) + " · " + esc(v.status) + " · " + esc(v.title || "") +
            (v.status !== "published" ? ' <button type="button" class="btn btn-gold btn-sm" data-pub="' + name + '" data-id="' + esc(v.id) + '">انتشار</button>' : "") +
            "</div>";
        }).join("") +
          '<button type="button" class="btn btn-outline btn-sm" data-starter="' + name + '">پیش‌نویس شروع</button>';
      }
      box.innerHTML = kind("terms", "قوانین") + kind("privacy", "حریم خصوصی") +
        '<div class="field"><label>نوع</label><select id="polKind"><option value="terms">قوانین</option><option value="privacy">حریم</option></select></div>' +
        '<div class="field"><label>نسخه</label><input id="polVer" value="1.0" dir="ltr"></div>' +
        '<div class="field"><label>عنوان دری</label><input id="polTitle"></div><div class="field"><label>Title</label><input id="polTitleEn" dir="ltr"></div>' +
        '<div class="field"><label>متن دری</label><textarea id="polBody" rows="6"></textarea></div>' +
        '<div class="field"><label>English</label><textarea id="polBodyEn" rows="6" dir="ltr"></textarea></div>' +
        '<button type="button" class="btn btn-gold" id="polSave">ذخیره پیش‌نویس</button>';
      document.getElementById("polSave").onclick = function () {
        var kindName = document.getElementById("polKind").value;
        call("/api/admin/policies/" + kindName, { method: "POST", body: {
          version: document.getElementById("polVer").value,
          title: document.getElementById("polTitle").value,
          title_en: document.getElementById("polTitleEn").value,
          body: document.getElementById("polBody").value,
          body_en: document.getElementById("polBodyEn").value,
        } }).then(function () { alert("پیش‌نویس ذخیره شد. تا انتشار در سایت نیست."); policiesForm(); });
      };
    }).catch(function (e) { box.textContent = e.message || "خطا"; });
  }
  document.addEventListener("click", function (e) {
    var starter = e.target.getAttribute && e.target.getAttribute("data-starter");
    if (starter) call("/api/admin/policies/" + starter + "/starter", { method: "POST", body: {} }).then(policiesForm);
    var pub = e.target.getAttribute && e.target.getAttribute("data-pub");
    if (pub) call("/api/admin/policies/" + pub + "/" + e.target.getAttribute("data-id") + "/publish", { method: "POST", body: {} }).then(function () { alert("منتشر شد"); policiesForm(); });
  });

  function linksForm() {
    var box = document.getElementById("linksAdmin");
    if (!box) return;
    call("/api/admin/links").then(function (data) {
      window._links = data.links || [];
      box.innerHTML = '<div class="field"><label>زیرعنوان دری</label><input id="linkSubtitle" value="' + esc(data.subtitle || "") + '"></div>' +
        '<div class="field"><label>English subtitle</label><input id="linkSubtitleEn" dir="ltr" value="' + esc(data.subtitle_en || "") + '"></div>' +
        window._links.map(function (row, i) {
        return '<div class="field"><label><input type="checkbox" data-lnk="' + i + '" data-k="enabled"' + (row.enabled ? " checked" : "") + "> " + esc(row.kind || "") + "</label>" +
          '<input data-lnk="' + i + '" data-k="label" value="' + esc(row.label || "") + '">' +
          '<input data-lnk="' + i + '" data-k="label_en" value="' + esc(row.label_en || "") + '" dir="ltr">' +
          '<input data-lnk="' + i + '" data-k="url" value="' + esc(row.url || "") + '" dir="ltr" placeholder="https://"></div>';
      }).join("") + '<button type="button" class="btn btn-gold" id="saveLinks">ذخیره لینک‌ها</button>' +
        '<p><a href="/links" target="_blank">بازکردن /links</a> · <a href="/links/qr.png" target="_blank">QR PNG</a> · <a href="/links/qr.svg" target="_blank">QR SVG</a></p>';
      document.getElementById("saveLinks").onclick = function () {
        var links = window._links.map(function (row, i) {
          function val(k) {
            var el = document.querySelector('[data-lnk="' + i + '"][data-k="' + k + '"]');
            if (!el) return row[k];
            return el.type === "checkbox" ? el.checked : el.value;
          }
          return { id: row.id, kind: row.kind, label: val("label"), label_en: val("label_en"), url: val("url"), enabled: !!val("enabled"), order: i };
        });
        call("/api/admin/links", { method: "PUT", body: { links: links, subtitle: document.getElementById("linkSubtitle").value, subtitle_en: document.getElementById("linkSubtitleEn").value } }).then(function () { alert("ذخیره شد"); linksForm(); });
      };
    }).catch(function (e) { box.textContent = e.message || "خطا"; });
  }

  function securityForm() {
    var box = document.getElementById("securityAdmin");
    if (!box) return;
    call("/api/admin/security").then(function (data) {
      box.innerHTML = '<p>ایمیل کد ورود: <b dir="ltr">' + esc(data.email || "") + "</b></p>" +
        "<p>کدهای بازیابی باقی‌مانده: " + (data.recoveryCodesRemaining || 0) + "</p>" +
        (data.emailLockedByEnv ? "<p class=\"note\">ایمیل از متغیر ADMIN_2FA_EMAIL قفل شده است.</p>" : '<div class="field"><label>ایمیل جدید تأیید</label><input id="secEmail" dir="ltr" value="' + esc(data.email || "") + '"></div><button type="button" class="btn btn-outline" id="saveSecEmail">ذخیره ایمیل</button>') +
        '<div style="margin-top:12px"><button type="button" class="btn btn-gold" id="newRecovery">ساخت کدهای بازیابی جدید</button><pre id="recoveryOnce" style="white-space:pre-wrap"></pre></div>' +
        '<div id="backupBox" class="note"></div>';
      var saveEmail = document.getElementById("saveSecEmail");
      if (saveEmail) saveEmail.onclick = function () {
        call("/api/admin/security/email", { method: "PUT", body: { email: document.getElementById("secEmail").value } }).then(function () { alert("ذخیره شد"); securityForm(); }).catch(function (e) { alert(e.message); });
      };
      document.getElementById("newRecovery").onclick = function () {
        if (!confirm("کدهای قبلی باطل می‌شوند. ادامه؟")) return;
        call("/api/admin/security/recovery-codes", { method: "POST", body: {} }).then(function (res) {
          document.getElementById("recoveryOnce").textContent = "این کدها فقط یک بار نشان داده می‌شوند:\n" + (res.codes || []).join("\n");
        });
      };
    }).catch(function () { box.textContent = "فقط مدیر اصلی."; });
    call("/api/admin/backup-status").then(function (data) {
      var el = document.getElementById("backupBox");
      if (!el) return;
      el.textContent = data.configured
        ? "پشتیبان رمزنگاری‌شده فعال است. نگهداری: " + data.retentionDays + " روز."
        : "پشتیبان خودکار خاموش است تا BACKUP_DIR و BACKUP_ENCRYPTION_KEY روی سرور تنظیم شود. فایل پشتیبان باید بیرون از دیسک اصلی هم کپی شود.";
    }).catch(function () {});
  }

  document.querySelectorAll("#sideNav [data-panel]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var id = btn.getAttribute("data-panel");
      if (id === "hours") hoursForm();
      if (id === "ads") adsForm();
      if (id === "policies") policiesForm();
      if (id === "links") linksForm();
      if (id === "security") securityForm();
      if (id === "coupons") couponsForm();
      if (id === "finance") financeForm();
      if (id === "customers") customerStatusForm();
    });
  });

  var metaBox = document.querySelector('[data-panel="texts"]') || document.querySelector('[data-panel="settings"]');
  if (metaBox) {
    var block = document.createElement("div");
    block.innerHTML = '<h3 style="margin-top:18px">عنوان تب مرورگر و نقشه فوتر</h3>' +
      '<div class="field"><label>عنوان تب (دری)</label><input id="docTitleFa"></div>' +
      '<div class="field"><label>Browser tab title (English)</label><input id="docTitleEn" dir="ltr"></div>' +
      '<div class="field"><label>توضیح متا (دری)</label><input id="metaFa"></div>' +
      '<div class="field"><label>Meta description (English)</label><input id="metaEn" dir="ltr"></div>' +
      '<div class="field"><label>لینک گوگل‌مپ فوتر (جدا از فروشگاه‌ها)</label><input id="footerMapUrl" dir="ltr" placeholder="https://"></div>' +
      '<button type="button" class="btn btn-gold btn-sm" id="saveSiteMeta">ذخیره عنوان و نقشه فوتر</button>';
    metaBox.appendChild(block);
    function loadMeta() { if (!token()) return;
    call("/api/admin/site-meta").then(function (data) {
      var m = data.siteMeta || {};
      document.getElementById("docTitleFa").value = m.documentTitle || "";
      document.getElementById("docTitleEn").value = m.documentTitle_en || "";
      document.getElementById("metaFa").value = m.metaDescription || "";
      document.getElementById("metaEn").value = m.metaDescription_en || "";
      document.getElementById("footerMapUrl").value = m.footerMapsUrl || "";
    }).catch(function () {}); }
    setInterval(function () { if (token() && document.getElementById("docTitleFa") && !document.getElementById("docTitleFa").value) loadMeta(); }, 2000);
    document.getElementById("saveSiteMeta").onclick = function () {
      call("/api/admin/site-meta", { method: "PUT", body: {
        documentTitle: document.getElementById("docTitleFa").value,
        documentTitle_en: document.getElementById("docTitleEn").value,
        metaDescription: document.getElementById("metaFa").value,
        metaDescription_en: document.getElementById("metaEn").value,
        footerMapsUrl: document.getElementById("footerMapUrl").value,
      } }).then(function () { alert("ذخیره شد"); }).catch(function (e) { alert(e.message || "خطا"); });
    };
  }

  function couponsForm() {
    var box = document.getElementById("couponsAdmin");
    if (!box) return;
    call("/api/admin/coupons").then(function (data) {
      var rows = data.coupons || [];
      box.innerHTML = rows.map(function (c, i) {
        return '<div class="field" style="border:1px solid #eee;padding:8px;border-radius:10px;margin-bottom:8px">' +
          '<input data-c="' + i + '" data-k="code" value="' + esc(c.code || "") + '" dir="ltr" placeholder="MAHO20">' +
          '<select data-c="' + i + '" data-k="type"><option value="percent"' + (c.type !== "fixed" ? " selected" : "") + '>درصد</option><option value="fixed"' + (c.type === "fixed" ? " selected" : "") + '>مبلغ افغانی</option></select>' +
          '<input data-c="' + i + '" data-k="value" value="' + esc(c.value || 0) + '" dir="ltr" placeholder="20">' +
          '<label><input type="checkbox" data-c="' + i + '" data-k="enabled"' + (c.enabled ? " checked" : "") + "> فعال</label>" +
          '<input data-c="' + i + '" data-k="minOrder" value="' + esc(c.minOrder || 0) + '" dir="ltr" placeholder="حداقل سفارش">' +
          '<input data-c="' + i + '" data-k="maxUses" value="' + esc(c.maxUses == null ? "" : c.maxUses) + '" dir="ltr" placeholder="سقف کل">' +
          '<input data-c="' + i + '" data-k="perCustomer" value="' + esc(c.perCustomer || 1) + '" dir="ltr" placeholder="سقف هر مشتری">' +
          '<div class="note">استفاده شده: ' + (c.used || 0) + "</div></div>";
      }).join("") + '<button type="button" class="btn btn-outline" id="addCoupon">+ کد</button> <button type="button" class="btn btn-gold" id="saveCoupons">ذخیره</button>';
      window._coupons = rows;
      document.getElementById("addCoupon").onclick = function () { window._coupons.push({ code: "", type: "percent", value: 10, enabled: false, perCustomer: 1 }); couponsForm(); };
      document.getElementById("saveCoupons").onclick = function () {
        var coupons = window._coupons.map(function (c, i) {
          function val(k) { var el = document.querySelector('[data-c="' + i + '"][data-k="' + k + '"]'); if (!el) return c[k]; return el.type === "checkbox" ? el.checked : el.value; }
          return { id: c.id, code: val("code"), type: val("type"), value: Number(val("value")) || 0, enabled: !!val("enabled"), minOrder: Number(val("minOrder")) || 0, maxUses: val("maxUses") === "" ? null : Number(val("maxUses")), perCustomer: Number(val("perCustomer")) || 1, categories: c.categories || [], productCodes: c.productCodes || [] };
        });
        call("/api/admin/coupons", { method: "PUT", body: { coupons: coupons } }).then(function () { alert("ذخیره شد"); couponsForm(); }).catch(function (e) { alert(e.message); });
      };
    }).catch(function (e) { box.textContent = e.message || "خطا"; });
  }

  var FIN_LABELS = {
    gross: "فروش ناخالص / Gross",
    discounts: "تخفیف‌ها / Discounts",
    net: "خالص قبل از برگشت / Net before returns",
    adjustments: "اعتبار برگشت تأییدشده / Approved return credit",
    netAfterReturns: "خالص پس از برگشت / Net after returns",
    collected: "مجموع دریافتی / Collections",
    online: "دریافت آنلاین / Online",
    inPerson: "دریافت حضوری POS / In-person POS",
    unclassified: "بدون کانال ثبت‌شده / Unclassified",
    otherChannel: "سایر کانال‌ها / Other channels",
    outstanding: "طلب از مشتری / Receivable",
    refundDue: "تعهد بازپرداخت / Refund due",
    returns: "ارزش کالای برگشتی / Returned goods",
    refunds: "بازپرداخت انجام‌شده / Completed refunds",
    pendingRefunds: "بازپرداخت در انتظار / Pending refunds",
    netCash: "خالص پول دریافت‌شده / Net cash",
    paidOrders: "سفارش‌های تسویه‌شده / Settled orders",
    unpaidOrders: "سفارش‌های پرداخت‌نشده / Unpaid orders",
    partialOrders: "سفارش‌های نیمه‌پرداخت / Partial orders",
    canceledOrders: "سفارش‌های لغوشده / Canceled orders",
    legacyUnverified: "سفارش‌های قدیمی تأییدنشده / Legacy unverified",
    legacyValue: "مبلغ سفارش‌های قدیمی / Legacy value"
  };
  var FIN_MONEY = { gross: 1, discounts: 1, net: 1, adjustments: 1, netAfterReturns: 1, collected: 1, online: 1, inPerson: 1, unclassified: 1, otherChannel: 1, outstanding: 1, refundDue: 1, returns: 1, refunds: 1, pendingRefunds: 1, netCash: 1, legacyValue: 1 };
  function finAmount(key, value) {
    var n = Number(value);
    if (!Number.isFinite(n)) n = 0;
    if (!FIN_MONEY[key]) return String(n);
    return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " AFN";
  }
  function financeForm() {
    var box = document.getElementById("financeAdmin");
    if (!box) return;
    var range = (document.getElementById("finRange") && document.getElementById("finRange").value) || "month";
    call("/api/admin/finance?range=" + encodeURIComponent(range)).then(function (data) {
      var kpi = data.kpi || {};
      var rows = Object.keys(FIN_LABELS).map(function (key) {
        return "<tr><th scope=\"row\">" + FIN_LABELS[key] + "</th><td class=\"num\" dir=\"ltr\">" + esc(finAmount(key, kpi[key])) + "</td></tr>";
      }).join("");
      var orders = (data.orders || []).slice(0, 40).map(function (o) {
        return "<tr><td dir=\"ltr\">" + esc(o.orderId) + "</td><td class=\"num\" dir=\"ltr\">" + esc(finAmount("collected", o.collected)) + "</td><td class=\"num\" dir=\"ltr\">" + esc(finAmount("outstanding", o.outstanding)) + "</td><td class=\"num\" dir=\"ltr\">" + esc(finAmount("refundDue", o.refundDue)) + "</td><td>" + (o.legacy ? "قدیمی / Legacy" : "ثبت‌شده / Posted") + "</td></tr>";
      }).join("");
      box.innerHTML = '<div class="fin-board" dir="rtl">' +
        '<div class="fin-toolbar"><label for="finRange">بازه گزارش</label><select id="finRange">' +
        '<option value="today">امروز</option><option value="week">این هفته</option><option value="month">این ماه</option><option value="year">امسال</option></select>' +
        '<div class="fin-actions"><button type="button" class="btn btn-outline btn-sm" data-fin-export="csv">CSV</button>' +
        '<button type="button" class="btn btn-outline btn-sm" data-fin-export="xls">Excel</button>' +
        '<button type="button" class="btn btn-outline btn-sm" data-fin-export="pdf">PDF</button></div></div>' +
        '<p class="fin-status">' + (data.reconciled ? "تطبیق دفتر و جمع داشبورد: بدون اختلاف" : "تطبیق: اختلاف وجود دارد و باید بررسی شود") + "</p>" +
        '<table class="fin-table"><thead><tr><th>شرح</th><th>مقدار</th></tr></thead><tbody>' + rows + "</tbody></table>" +
        '<h3 class="fin-sub">سفارش‌های این بازه</h3>' +
        '<table class="fin-table"><thead><tr><th>شماره سفارش / Order</th><th>دریافتی / Collected</th><th>طلب / Receivable</th><th>تعهد بازپرداخت / Refund due</th><th>وضعیت دفتر / Ledger</th></tr></thead><tbody>' +
        (orders || "<tr><td colspan=\"5\">سفارشی در این بازه نیست.</td></tr>") + "</tbody></table></div>";
      document.getElementById("finRange").value = range;
      document.getElementById("finRange").onchange = financeForm;
      box.querySelectorAll("[data-fin-export]").forEach(function (btn) {
        btn.onclick = function () {
          var kind = btn.getAttribute("data-fin-export");
          fetch(api.url("/api/admin/finance/export." + kind + "?range=" + encodeURIComponent(document.getElementById("finRange").value)), {
            headers: { Authorization: "Bearer " + token() }
          }).then(function (r) { if (!r.ok) throw new Error("export"); return r.blob(); }).then(function (blob) {
            var a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "maho-finance." + kind;
            a.click();
          }).catch(function () { alert("خروجی ناموفق بود"); });
        };
      });
    }).catch(function (e) { box.textContent = e.message || "خطا"; });
  }

  function customerStatusForm() {
    var box = document.getElementById("customerStatusBox");
    if (!box || box.dataset.ready) return;
    box.dataset.ready = "1";
    box.innerHTML = '<strong>وضعیت حساب مشتری</strong><div class="field"><label>شناسه مشتری</label><input id="custStatusId" dir="ltr" placeholder="user id"></div>' +
      '<div class="field"><label>وضعیت</label><select id="custStatusVal"><option value="active">فعال</option><option value="hold">نگه‌داشتن</option><option value="blocked">مسدود</option><option value="deactivated">غیرفعال</option></select></div>' +
      '<div class="field"><label>دلیل</label><input id="custStatusReason"></div><button type="button" class="btn btn-gold btn-sm" id="saveCustStatus">ثبت وضعیت</button><p id="custStatusMsg"></p>';
    document.getElementById("saveCustStatus").onclick = function () {
      call("/api/admin/customers/" + encodeURIComponent(document.getElementById("custStatusId").value.trim()) + "/account-status", {
        method: "POST",
        body: { status: document.getElementById("custStatusVal").value, reason: document.getElementById("custStatusReason").value }
      }).then(function (res) { document.getElementById("custStatusMsg").textContent = res.accountStatus || "ok"; }).catch(function (e) { document.getElementById("custStatusMsg").textContent = e.message || "خطا"; });
    };
  }

  document.addEventListener("click", function (e) {
    var help = e.target.getAttribute && e.target.getAttribute("data-help");
    if (!help) return;
    var btn = document.querySelector('#sideNav [data-panel="' + help + '"]');
    if (btn) btn.click();
  });
  var adminTheme = document.getElementById("adminThemeToggle");
  function paintAdminTheme() {
    var mode = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    if (adminTheme) adminTheme.textContent = mode === "dark" ? "☀" : "☾";
  }
  try {
    var savedTheme = localStorage.getItem("maho_theme");
    if (savedTheme === "dark" || savedTheme === "light") document.documentElement.setAttribute("data-theme", savedTheme);
  } catch (_) {}
  paintAdminTheme();
  if (adminTheme) adminTheme.addEventListener("click", function () {
    var next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("maho_theme", next); } catch (_) {}
    paintAdminTheme();
  });
})();
