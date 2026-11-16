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
  function kabulInput(ms) {
    if (!ms) return "";
    var d = new Date(Number(ms) + (4 * 60 + 30) * 60000);
    if (isNaN(d.getTime())) return "";
    var pad = function (n) { return String(n).padStart(2, "0"); };
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()) + "T" + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes());
  }
  function kabulMs(value) {
    var m = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - (4 * 60 + 30) * 60000;
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
      videoUrl: val("videoUrl") || "", productCode: val("productCode") || "",
      showName: val("showName") !== false, showPrice: val("showPrice") !== false, showSpecs: val("showSpecs") !== false,
      cta: val("cta") || "", cta_en: val("cta_en") || "",
      startAt: start || null,
      endAt: end || null,
      order: i, impressions: ad.impressions, clicks: ad.clicks,
    };
  }
  function syncAdsFromDom() {
    if (!window._ads) return;
    ["announcement", "homepage", "listing"].forEach(function (name) {
      window._ads[name] = (window._ads[name] || []).map(function (ad, i) { return readAd(name, i, ad); });
    });
  }
  function adProductLabel(code) {
    var list = window._adProducts || [];
    var hit = list.find(function (p) { return p && String(p.code || "") === String(code || ""); });
    if (!hit) return code || "";
    return (hit.name || hit.name_en || "محصول") + (hit.code ? " — " + hit.code : "");
  }
  function homepageExtras(name, ad, i) {
    var code = ad.productCode || "";
    return '<input data-area="' + name + '" data-i="' + i + '" data-k="videoUrl" value="' + esc(ad.videoUrl || "") + '" placeholder="ویدیو MP4/WebM" dir="ltr">' +
      '<input type="file" accept="video/mp4,video/webm,.mp4,.webm" data-ad-file="videoUrl" data-area="' + name + '" data-i="' + i + '">' +
      (ad.videoUrl ? '<video muted playsinline controls preload="metadata" src="' + esc(ad.videoUrl) + '" style="width:140px;height:180px;background:#111;border-radius:12px;object-fit:cover"></video>' : "") +
      '<input data-ad-find="' + name + '" data-i="' + i + '" placeholder="جستجوی محصول" value="">' +
      '<div class="ad-product-picks" data-picks="' + name + '" data-i="' + i + '"></div>' +
      '<input type="hidden" data-area="' + name + '" data-i="' + i + '" data-k="productCode" value="' + esc(code) + '">' +
      '<div class="note">محصول انتخاب‌شده: ' + esc(adProductLabel(code) || "هیچ") + "</div>" +
      '<label><input type="checkbox" data-area="' + name + '" data-i="' + i + '" data-k="showName"' + (ad.showName !== false ? " checked" : "") + "> نام محصول</label> " +
      '<label><input type="checkbox" data-area="' + name + '" data-i="' + i + '" data-k="showPrice"' + (ad.showPrice !== false ? " checked" : "") + "> قیمت</label> " +
      '<label><input type="checkbox" data-area="' + name + '" data-i="' + i + '" data-k="showSpecs"' + (ad.showSpecs !== false ? " checked" : "") + "> مشخصات</label>";
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
          '<button type="button" class="btn btn-outline btn-sm" data-ad-preview="' + name + '" data-i="' + i + '">پیش‌نمایش</button> ' +
          '<button type="button" class="btn btn-outline btn-sm" data-ad-delete="' + name + '" data-i="' + i + '">حذف</button></div>' +
          '<input data-area="' + name + '" data-i="' + i + '" data-k="title" value="' + esc(ad.title || "") + '" placeholder="عنوان">' +
          '<input data-area="' + name + '" data-i="' + i + '" data-k="title_en" value="' + esc(ad.title_en || "") + '" placeholder="Title" dir="ltr">' +
          '<input data-area="' + name + '" data-i="' + i + '" data-k="description" value="' + esc(ad.description || "") + '" placeholder="توضیح">' +
          '<input data-area="' + name + '" data-i="' + i + '" data-k="description_en" value="' + esc(ad.description_en || "") + '" placeholder="Description" dir="ltr">' +
          '<input data-area="' + name + '" data-i="' + i + '" data-k="url" value="' + esc(ad.url || "") + '" placeholder="https://" dir="ltr">' +
          '<input data-area="' + name + '" data-i="' + i + '" data-k="imageUrl" value="' + esc(ad.imageUrl || "") + '" placeholder="تصویر دسکتاپ" dir="ltr">' +
          '<input type="file" accept="image/jpeg,image/png,image/webp" data-ad-file="imageUrl" data-area="' + name + '" data-i="' + i + '">' +
          '<input data-area="' + name + '" data-i="' + i + '" data-k="imageUrlMobile" value="' + esc(ad.imageUrlMobile || "") + '" placeholder="تصویر موبایل" dir="ltr">' +
          '<input type="file" accept="image/jpeg,image/png,image/webp" data-ad-file="imageUrlMobile" data-area="' + name + '" data-i="' + i + '">' +
          (name === "homepage" ? homepageExtras(name, ad, i) : "") +
          '<input data-area="' + name + '" data-i="' + i + '" data-k="cta" value="' + esc(ad.cta || "") + '" placeholder="متن دکمه">' +
          '<input data-area="' + name + '" data-i="' + i + '" data-k="cta_en" value="' + esc(ad.cta_en || "") + '" placeholder="Button" dir="ltr">' +
          '<div class="grid2"><div class="field"><label>شروع (کابل)</label><input type="datetime-local" data-area="' + name + '" data-i="' + i + '" data-k="startAt" value="' + esc(kabulInput(ad.startAt)) + '" dir="ltr"></div>' +
          '<div class="field"><label>پایان (کابل)</label><input type="datetime-local" data-area="' + name + '" data-i="' + i + '" data-k="endAt" value="' + esc(kabulInput(ad.endAt)) + '" dir="ltr"></div></div>' +
          '<div class="note">بازدید ' + (ad.impressions || 0) + " · کلیک " + (ad.clicks || 0) + "</div></div>";
      }).join("") + '<button type="button" class="btn btn-outline btn-sm" data-add-ad="' + name + '">+ مورد</button> <button type="button" class="btn btn-gold btn-sm" data-save-ad="' + name + '">ذخیره</button>';
    }
    box.innerHTML = "<p class=\"sub\">کارت‌های «بنر صفحه اصلی» عمودی‌اند و چند کارت با هم در یک ردیف افقی دیده می‌شوند. نام، قیمت و مشخصات روی خود عکس یا ویدیو می‌آیند. نوار اعلان و کارت بین محصولات جدا هستند. تاریخ‌ها به وقت کابل است.</p><div id=\"adPreview\" class=\"note\" hidden></div>" +
      area("announcement", "نوار اعلان") + area("homepage", "بنر صفحه اصلی") + area("listing", "کارت بین محصولات");
  }
  function adsForm() {
    var box = document.getElementById("adsAdmin");
    if (!box) return;
    var products = window._adProducts ? Promise.resolve(window._adProducts) : fetch("/api/catalog", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (d) {
      window._adProducts = (d.products || []).filter(function (p) { return p && p.code && p.enabled !== false && p.active !== false; });
      return window._adProducts;
    }).catch(function () { window._adProducts = []; return []; });
    Promise.all([call("/api/admin/ads"), products]).then(function (all) { window._ads = all[0]; renderAds(); }).catch(function (e) { box.textContent = e.message || "خطا"; });
  }
  document.addEventListener("input", function (e) {
    var input = e.target;
    if (!input || !input.getAttribute || input.getAttribute("data-ad-find") == null) return;
    var q = String(input.value || "").trim().toLowerCase();
    var picks = input.parentNode.querySelector('.ad-product-picks[data-i="' + input.getAttribute("data-i") + '"]');
    if (!picks) return;
    if (!q) { picks.innerHTML = ""; return; }
    var matches = (window._adProducts || []).filter(function (p) {
      return ((p.name || "") + " " + (p.name_en || "") + " " + (p.code || "")).toLowerCase().indexOf(q) >= 0;
    }).slice(0, 6);
    picks.innerHTML = matches.map(function (p) {
      return '<button type="button" class="btn btn-outline btn-sm" data-ad-pick="' + esc(p.code) + '" data-area="' + esc(input.getAttribute("data-ad-find")) + '" data-i="' + esc(input.getAttribute("data-i")) + '">' + esc((p.name || p.name_en || "محصول") + " — " + p.code) + "</button>";
    }).join("") || '<span class="note">محصولی پیدا نشد.</span>';
  });
  document.addEventListener("click", function (e) {
    var pick = e.target.getAttribute && e.target.getAttribute("data-ad-pick");
    if (pick && window._ads) {
      syncAdsFromDom();
      var areaName = e.target.getAttribute("data-area");
      var at = parseInt(e.target.getAttribute("data-i"), 10);
      if (window._ads[areaName] && window._ads[areaName][at]) window._ads[areaName][at].productCode = pick;
      renderAds();
      return;
    }
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
        var startAt = typeof ad.startAt === "number" ? ad.startAt : kabulMs(ad.startAt);
        var endAt = typeof ad.endAt === "number" ? ad.endAt : kabulMs(ad.endAt);
        var live = ad.enabled && (!startAt || now >= startAt) && (!endAt || now <= endAt);
        slot.hidden = false;
        var media = ad.videoUrl
          ? '<video muted playsinline preload="metadata" src="' + esc(ad.videoUrl) + '"' + (ad.imageUrl ? ' poster="' + esc(ad.imageUrl) + '"' : "") + ' style="width:100%;height:100%;object-fit:cover"></video>'
          : (ad.imageUrl ? '<img alt="" src="' + esc(ad.imageUrl) + '" style="width:100%;height:100%;object-fit:cover">' : '<div style="width:100%;height:100%;background:#1a1509"></div>');
        slot.innerHTML = "<strong>پیش‌نمایش کارت عمودی</strong> — " + (live ? "اگر ذخیره شود روی سایت دیده می‌شود" : "روی سایت دیده نمی‌شود") +
          '<div style="position:relative;width:180px;aspect-ratio:3/4;border-radius:16px;overflow:hidden;margin-top:8px;background:#1a1509">' + media +
          '<div style="position:absolute;inset:0 0 auto 0;padding:10px 10px 28px;background:linear-gradient(to bottom,rgba(17,17,17,.78),transparent);color:#fffdf8">' +
          '<div style="font-weight:800">' + esc(ad.title || ad.title_en || ad.productCode || "") + "</div>" +
          '<div style="font-size:12px">' + esc(ad.description || "") + "</div></div></div>";
      }
    }
    var removeAd = e.target.getAttribute && e.target.getAttribute("data-ad-delete");
    if (removeAd && window._ads) {
      if (!window.confirm("این تبلیغ حذف شود؟")) return;
      syncAdsFromDom();
      var drop = window._ads[removeAd] || [];
      drop.splice(parseInt(e.target.getAttribute("data-i"), 10), 1);
      call("/api/admin/ads/" + removeAd, { method: "PUT", body: { items: drop } }).then(function () { adsForm(); }).catch(function (err) { alert(err.message || "حذف نشد"); });
      return;
    }
    var save = e.target.getAttribute && e.target.getAttribute("data-save-ad");
    if (save && window._ads) {
      syncAdsFromDom();
      var items = window._ads[save] || [];
      var badDate = items.some(function (ad) {
        var startAt = typeof ad.startAt === "number" ? ad.startAt : kabulMs(ad.startAt);
        var endAt = typeof ad.endAt === "number" ? ad.endAt : kabulMs(ad.endAt);
        return startAt && endAt && endAt < startAt;
      });
      if (badDate) { alert("تاریخ پایان نمی‌تواند قبل از تاریخ شروع باشد."); return; }
      call("/api/admin/ads/" + save, { method: "PUT", body: { items: items } }).then(function () { alert("ذخیره شد"); adsForm(); }).catch(function (err) { alert(err.message || "خطا"); });
    }
  });

  function policiesForm() {
    var box = document.getElementById("policiesAdmin");
    if (!box) return;
    call("/api/admin/policies").then(function (data) {
      window._policyDocs = data;
      function kind(name, title) {
        var rows = data[name] || [];
        return "<h3>" + title + "</h3>" + rows.map(function (v) {
          return "<div class=\"note\">" + esc(v.version) + " · " + esc(v.status) + " · " + esc(v.title || "") +
            (v.status !== "published" ? ' <button type="button" class="btn btn-gold btn-sm" data-pub="' + name + '" data-id="' + esc(v.id) + '">انتشار</button>' : "") +
            "</div>";
        }).join("") +
          '<button type="button" class="btn btn-outline btn-sm" data-starter="' + name + '">پیش‌نویس شروع</button>';
      }
      box.innerHTML = "<table class=\"fin-table\"><thead><tr><th>نوع</th><th>نسخه</th><th>وضعیت</th><th></th></tr></thead><tbody>" +
        ["terms", "privacy", "returns", "other"].map(function (name) {
          return (data[name] || []).map(function (v) {
            var id = esc(v.id);
            var actions = '<button type="button" class="btn btn-outline btn-sm" data-pol-view="' + name + '" data-id="' + id + '">مشاهده</button> ';
            if (v.status !== "published") actions += '<button type="button" class="btn btn-outline btn-sm" data-pol-edit="' + name + '" data-id="' + id + '">ویرایش</button> ';
            actions += '<form data-pdf="' + name + '" data-id="' + id + '" style="display:inline"><input type="file" name="file" accept="application/pdf"> <button class="btn btn-outline btn-sm" type="submit">آپدیت PDF</button></form> ';
            if (v.status !== "published") actions += '<button type="button" class="btn btn-gold btn-sm" data-pub="' + name + '" data-id="' + id + '">فعال‌سازی</button> ';
            if (v.status === "published") actions += '<button type="button" class="btn btn-outline btn-sm" data-pol-off="' + name + '" data-id="' + id + '">غیرفعال‌سازی</button> ';
            if (v.status !== "archived") actions += '<button type="button" class="btn btn-outline btn-sm" data-pol-archive="' + name + '" data-id="' + id + '">آرشیف</button> ';
            if (v.deletable) actions += '<button type="button" class="btn btn-danger btn-sm" data-pol-delete="' + name + '" data-id="' + id + '">حذف</button>';
            return "<tr><td>" + esc(name) + "</td><td dir=\"ltr\">" + esc(v.version) + "</td><td>" + esc(v.status) + "</td><td>" + actions + "</td></tr>";
          }).join("");
        }).join("") + "</tbody></table>" +
        '<p class="note"><button type="button" class="btn btn-outline btn-sm" id="addPolicyDoc">افزودن سند جدید</button></p>' +
        kind("terms", "قوانین") + kind("privacy", "حریم خصوصی") + kind("returns", "برگشت") + kind("other", "سایر") +
        '<div class="field"><label>نوع</label><select id="polKind"><option value="terms">قوانین</option><option value="privacy">حریم</option><option value="returns">برگشت</option><option value="other">سایر</option></select></div>' +
        '<div class="field"><label>نسخه</label><input id="polVer" value="1.0" dir="ltr"></div>' +
        '<div class="field"><label>عنوان فارسی</label><input id="polTitle"></div><div class="field"><label>Title</label><input id="polTitleEn" dir="ltr"></div>' +
        '<div class="field"><label>متن فارسی</label><textarea id="polBody" rows="6"></textarea></div>' +
        '<div class="field"><label>English</label><textarea id="polBodyEn" rows="6" dir="ltr"></textarea></div>' +
        '<input type="hidden" id="polEditId" value="">' +
        '<div id="polView" class="note" hidden></div>' +
        '<button type="button" class="btn btn-gold" id="polSave">ذخیره پیش‌نویس</button>';
      document.getElementById("polSave").onclick = function () {
        var kindName = document.getElementById("polKind").value;
        call("/api/admin/policies/" + kindName, { method: "POST", body: {
          id: document.getElementById("polEditId").value || undefined,
          version: document.getElementById("polVer").value,
          title: document.getElementById("polTitle").value,
          title_en: document.getElementById("polTitleEn").value,
          body: document.getElementById("polBody").value,
          body_en: document.getElementById("polBodyEn").value,
        } }).then(function () { alert("پیش‌نویس ذخیره شد. تا انتشار در سایت نیست و ایمیلی فرستاده نمی‌شود."); policiesForm(); });
      };
      var addDoc = document.getElementById("addPolicyDoc");
      if (addDoc) addDoc.onclick = function () {
        var kindName = document.getElementById("polKind").value || "other";
        call("/api/admin/policies/" + kindName + "/starter", { method: "POST", body: {} }).then(policiesForm);
      };
      box.querySelectorAll("form[data-pdf]").forEach(function (form) {
        form.onsubmit = function (ev) {
          ev.preventDefault();
          var body = new FormData(form);
          fetch(api.url("/api/admin/policies/" + form.getAttribute("data-pdf") + "/" + form.getAttribute("data-id") + "/pdf"), {
            method: "POST",
            headers: { Authorization: "Bearer " + token() },
            body: body
          }).then(function (r) { if (!r.ok) throw new Error("pdf"); return r.json(); }).then(function () {
            alert("PDF ذخیره شد. انتشار جداگانه است و خودش ایمیل نمی‌فرستد.");
            policiesForm();
          }).catch(function () { alert("فایل PDF پذیرفته نشد."); });
        };
      });
    }).catch(function (e) { box.textContent = e.message || "خطا"; });
  }
  document.addEventListener("click", function (e) {
    var starter = e.target.getAttribute && e.target.getAttribute("data-starter");
    if (starter) call("/api/admin/policies/" + starter + "/starter", { method: "POST", body: {} }).then(policiesForm);
    var pub = e.target.getAttribute && e.target.getAttribute("data-pub");
    if (pub) {
      var notify = confirm("نسخه " + e.target.getAttribute("data-id") + " فعال و منتشر شود؟ فقط با تأیید، یک اطلاع‌رسانی در صف مشتریان قرار می‌گیرد. ویرایش پیش‌نویس ایمیل نمی‌فرستد.");
      call("/api/admin/policies/" + pub + "/" + e.target.getAttribute("data-id") + "/publish", { method: "POST", body: { notify: notify } }).then(function () {
        alert(notify ? "منتشر شد و اطلاع‌رسانی در صف قرار گرفت." : "منتشر شد، بدون ایمیل.");
        policiesForm();
      });
    }
    var view = e.target.getAttribute && e.target.getAttribute("data-pol-view");
    if (view) {
      var seen = ((window._policyDocs || {})[view] || []).filter(function (row) { return row.id === e.target.getAttribute("data-id"); })[0];
      var slot = document.getElementById("polView");
      if (slot && seen) { slot.hidden = false; slot.textContent = (seen.title || "") + "\n\n" + (seen.body || ""); }
    }
    var edit = e.target.getAttribute && e.target.getAttribute("data-pol-edit");
    if (edit) {
      var row = ((window._policyDocs || {})[edit] || []).filter(function (item) { return item.id === e.target.getAttribute("data-id"); })[0];
      if (!row) return;
      document.getElementById("polKind").value = edit;
      document.getElementById("polEditId").value = row.id;
      document.getElementById("polVer").value = row.version || "";
      document.getElementById("polTitle").value = row.title || "";
      document.getElementById("polTitleEn").value = row.title_en || "";
      document.getElementById("polBody").value = row.body || "";
      document.getElementById("polBodyEn").value = row.body_en || "";
    }
    var off = e.target.getAttribute && e.target.getAttribute("data-pol-off");
    if (off && confirm("این سند از نمایش عمومی برداشته می‌شود. نسخه و سوابق پذیرش حفظ می‌مانند. ایمیل گروهی فرستاده نمی‌شود.")) {
      call("/api/admin/policies/" + off + "/" + e.target.getAttribute("data-id") + "/unpublish", { method: "POST", body: {} }).then(policiesForm);
    }
    var arch = e.target.getAttribute && e.target.getAttribute("data-pol-archive");
    if (arch && confirm("این نسخه آرشیف شود؟ آرشیف حذف دائمی نیست و سابقه را نگه می‌دارد.")) {
      call("/api/admin/policies/" + arch + "/" + e.target.getAttribute("data-id") + "/archive", { method: "POST", body: {} }).then(policiesForm);
    }
    var del = e.target.getAttribute && e.target.getAttribute("data-pol-delete");
    if (del && confirm("این پیش‌نویس هرگز منتشر یا پذیرفته نشده است و برای همیشه حذف می‌شود. ادامه می‌دهید؟")) {
      call("/api/admin/policies/" + del + "/" + e.target.getAttribute("data-id"), { method: "DELETE" }).then(policiesForm).catch(function (err) { alert(err.message || "حذف مجاز نیست"); });
    }
  });

  function readLinkRows() {
    return (window._links || []).map(function (row, i) {
      function val(k) {
        var el = document.querySelector('[data-lnk="' + i + '"][data-k="' + k + '"]');
        if (!el) return row[k];
        return el.type === "checkbox" ? el.checked : el.value;
      }
      return { id: row.id, kind: row.kind || "custom", label: val("label"), label_en: val("label_en"), url: val("url"), enabled: !!val("enabled"), order: i };
    });
  }
  function paintLinks() {
    var box = document.getElementById("linksAdmin");
    if (!box) return;
    var savedCount = (window._links || []).filter(function (row) { return String(row.url || "").trim(); }).length;
    box.innerHTML = '<div class="field"><label>زیرعنوان فارسی</label><input id="linkSubtitle" value="' + esc(window._linkSubtitle || "") + '"></div>' +
      '<div class="field"><label>English subtitle</label><input id="linkSubtitleEn" dir="ltr" value="' + esc(window._linkSubtitleEn || "") + '"></div>' +
      '<p class="note">لینک‌های دارای نشانی: ' + savedCount + "</p>" +
      (window._links || []).map(function (row, i) {
      return '<div class="field"><label><input type="checkbox" data-lnk="' + i + '" data-k="enabled"' + (row.enabled ? " checked" : "") + "> " + esc(row.kind || "custom") + "</label>" +
        '<input data-lnk="' + i + '" data-k="label" value="' + esc(row.label || "") + '" placeholder="برچسب فارسی">' +
        '<input data-lnk="' + i + '" data-k="label_en" value="' + esc(row.label_en || "") + '" dir="ltr" placeholder="English label">' +
        '<input data-lnk="' + i + '" data-k="url" value="' + esc(row.url || "") + '" dir="ltr" placeholder="https://"></div>';
    }).join("") + '<button type="button" class="btn btn-outline" id="addLink">+ لینک</button> <button type="button" class="btn btn-gold" id="saveLinks">ذخیره لینک‌ها</button>' +
      '<p><a href="/links" target="_blank">بازکردن /links</a> · <a href="/links/qr.png" target="_blank">QR PNG</a> · <a href="/links/qr.svg" target="_blank">QR SVG</a></p>';
    document.getElementById("addLink").onclick = function () {
      window._linkSubtitle = document.getElementById("linkSubtitle").value;
      window._linkSubtitleEn = document.getElementById("linkSubtitleEn").value;
      window._links = readLinkRows();
      window._links.push({ kind: "custom", label: "", label_en: "", url: "", enabled: false, order: window._links.length });
      paintLinks();
    };
    document.getElementById("saveLinks").onclick = function () {
      var links = readLinkRows().filter(function (row) { return String(row.url || "").trim(); });
      var blank = readLinkRows().length - links.length;
      call("/api/admin/links", { method: "PUT", body: { links: links, subtitle: document.getElementById("linkSubtitle").value, subtitle_en: document.getElementById("linkSubtitleEn").value } }).then(function () {
        alert(blank ? "لینک بدون نشانی ذخیره نشد. بقیه ذخیره شد." : "ذخیره شد");
        linksForm();
      }).catch(function (e) { alert(e.message || "ذخیره نشد"); });
    };
  }
  function linksForm() {
    var box = document.getElementById("linksAdmin");
    if (!box) return;
    call("/api/admin/links").then(function (data) {
      window._links = data.links || [];
      window._linkSubtitle = data.subtitle || "";
      window._linkSubtitleEn = data.subtitle_en || "";
      paintLinks();
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

  document.querySelectorAll(".side-group-label").forEach(function (label) {
    label.setAttribute("role", "button");
    label.tabIndex = 0;
    label.setAttribute("aria-expanded", "true");
    label.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      label.click();
    });
    label.addEventListener("click", function () {
      var hide = !label.classList.contains("is-collapsed");
      label.classList.toggle("is-collapsed", hide);
      label.setAttribute("aria-expanded", hide ? "false" : "true");
      var node = label.nextElementSibling;
      while (node && !node.classList.contains("side-group-label")) {
        if (node.classList && node.classList.contains("side-link")) node.hidden = hide;
        node = node.nextElementSibling;
      }
    });
  });
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
      if (id === "contacts") contactForm();
      if (id === "texts") socialForm();
    });
  });

  var metaBox = document.querySelector('.admin-panel[data-panel="texts"]') || document.querySelector('.admin-panel[data-panel="settings"]');
  if (metaBox) {
    var block = document.createElement("div");
    block.innerHTML = '<h3 style="margin-top:18px">عنوان تب مرورگر و نقشه فوتر</h3>' +
      '<div class="field"><label>عنوان تب (فارسی)</label><input id="docTitleFa"></div>' +
      '<div class="field"><label>Browser tab title (English)</label><input id="docTitleEn" dir="ltr"></div>' +
      '<div class="field"><label>توضیح متا (فارسی)</label><input id="metaFa"></div>' +
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

  function couponsFormLocal() {
    var box = document.getElementById("couponsAdmin");
    if (!box) return;
    var rows = window._coupons || [];
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
      function harvestCoupons() {
        return (window._coupons || []).map(function (c, i) {
          function val(k) { var el = document.querySelector('[data-c="' + i + '"][data-k="' + k + '"]'); if (!el) return c[k]; return el.type === "checkbox" ? el.checked : el.value; }
          return { id: c.id, code: val("code"), type: val("type"), value: Number(val("value")) || 0, enabled: !!val("enabled"), minOrder: Number(val("minOrder")) || 0, maxUses: val("maxUses") === "" ? null : Number(val("maxUses")), perCustomer: Number(val("perCustomer")) || 1, used: c.used || 0, categories: c.categories || [], productCodes: c.productCodes || [] };
        });
      }
      document.getElementById("addCoupon").onclick = function () {
        window._coupons = harvestCoupons();
        window._coupons.push({ code: "", type: "percent", value: 10, enabled: false, perCustomer: 1, minOrder: 0, maxUses: null });
        couponsFormLocal();
      };
      document.getElementById("saveCoupons").onclick = function () {
        var coupons = window._coupons.map(function (c, i) {
          function val(k) { var el = document.querySelector('[data-c="' + i + '"][data-k="' + k + '"]'); if (!el) return c[k]; return el.type === "checkbox" ? el.checked : el.value; }
          return { id: c.id, code: val("code"), type: val("type"), value: Number(val("value")) || 0, enabled: !!val("enabled"), minOrder: Number(val("minOrder")) || 0, maxUses: val("maxUses") === "" ? null : Number(val("maxUses")), perCustomer: Number(val("perCustomer")) || 1, categories: c.categories || [], productCodes: c.productCodes || [] };
        });
        call("/api/admin/coupons", { method: "PUT", body: { coupons: coupons } }).then(function () { alert("ذخیره شد"); couponsForm(); }).catch(function (e) { alert(e.message); });
      };
  }
  function couponsForm() {
    var box = document.getElementById("couponsAdmin");
    if (!box) return;
    call("/api/admin/coupons").then(function (data) {
      window._coupons = data.coupons || [];
      couponsFormLocal();
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
        return "<tr data-fin-key=\"" + key + "\" tabindex=\"0\" style=\"cursor:pointer\"><th scope=\"row\">" + FIN_LABELS[key] + "</th><td class=\"num\" dir=\"ltr\">" + esc(finAmount(key, kpi[key])) + "</td></tr>";
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
        (orders || "<tr><td colspan=\"5\">سفارشی در این بازه نیست.</td></tr>") + "</tbody></table><div id=\"finDetail\" class=\"note\"></div></div>";
      document.getElementById("finRange").value = range;
      document.getElementById("finRange").onchange = financeForm;
      var detail = document.getElementById("finDetail");
      var allOrders = data.orders || [];
      function showFin(key) {
        if (!detail) return;
        var rangeNow = document.getElementById("finRange").value;
        call("/api/admin/finance/detail?range=" + encodeURIComponent(rangeNow) + "&key=" + encodeURIComponent(key)).then(function (res) {
          var same = !!res.matches;
          detail.innerHTML = "<strong>" + esc(FIN_LABELS[key] || key) + "</strong><p>" +
            (same ? "جمع جزئیات با جمع کل برابر است." : "جمع جزئیات با جمع کل برابر نیست.") +
            " جمع جزئیات: " + esc(finAmount(key, res.sum)) + " · جمع کل: " + esc(finAmount(key, res.kpi)) + "</p>" +
            "<table class=\"fin-table\"><tbody>" + ((res.lines || []).slice(0, 80).map(function (line) {
              return "<tr><td dir=\"ltr\">" + esc(line.orderId || line.txnId || "") + "</td><td>" + esc(line.source || "") + "</td><td class=\"num\" dir=\"ltr\">" + esc(finAmount(key, line.amount)) + "</td></tr>";
            }).join("") || "<tr><td>موردی نیست.</td></tr>") + "</tbody></table>";
        }).catch(function (err) { detail.textContent = err.message || "جزئیات خوانده نشد"; });
      }
      box.querySelectorAll("[data-fin-key]").forEach(function (row) {
        row.addEventListener("click", function () { showFin(row.getAttribute("data-fin-key")); });
      });
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
      '<div class="field"><label>دلیل قابل‌نمایش برای مشتری</label><input id="custStatusReason"></div>' +
      '<div class="field"><label>یادداشت داخلی</label><input id="custStatusNote"></div>' +
      '<button type="button" class="btn btn-gold btn-sm" id="saveCustStatus">ثبت وضعیت</button>' +
      '<h3>مسدودسازی زمان‌بندی‌شده (کابل)</h3>' +
      '<div class="field"><label>شروع</label><input id="blockStart" type="datetime-local" dir="ltr"></div>' +
      '<div class="field"><label>پایان (خالی یعنی تا لغو)</label><input id="blockEnd" type="datetime-local" dir="ltr"></div>' +
      '<button type="button" class="btn btn-outline btn-sm" id="saveBlockSchedule">ثبت زمان‌بندی</button> ' +
      '<button type="button" class="btn btn-outline btn-sm" id="cancelBlockSchedule">لغو زمان‌بندی</button><p id="custStatusMsg"></p>';
    document.getElementById("saveCustStatus").onclick = function () {
      call("/api/admin/customers/" + encodeURIComponent(document.getElementById("custStatusId").value.trim()) + "/account-status", {
        method: "POST",
        body: { status: document.getElementById("custStatusVal").value, publicReason: document.getElementById("custStatusReason").value, reason: document.getElementById("custStatusReason").value, internalNote: document.getElementById("custStatusNote").value }
      }).then(function (res) { document.getElementById("custStatusMsg").textContent = res.accountStatus || "ok"; }).catch(function (e) { document.getElementById("custStatusMsg").textContent = e.message || "خطا"; });
    };
    document.getElementById("saveBlockSchedule").onclick = function () {
      call("/api/admin/customers/" + encodeURIComponent(document.getElementById("custStatusId").value.trim()) + "/block-schedule", {
        method: "POST",
        body: {
          startAt: kabulMs(document.getElementById("blockStart").value),
          endAt: kabulMs(document.getElementById("blockEnd").value),
          publicReason: document.getElementById("custStatusReason").value,
          internalNote: document.getElementById("custStatusNote").value
        }
      }).then(function (res) { document.getElementById("custStatusMsg").textContent = (res.accountStatus || "scheduled") + (res.mail ? " · ایمیل در صف" : ""); }).catch(function (e) { document.getElementById("custStatusMsg").textContent = e.message || "خطا"; });
    };
    document.getElementById("cancelBlockSchedule").onclick = function () {
      call("/api/admin/customers/" + encodeURIComponent(document.getElementById("custStatusId").value.trim()) + "/block-schedule/cancel", { method: "POST", body: {} })
        .then(function (res) { document.getElementById("custStatusMsg").textContent = res.accountStatus || "cancelled"; })
        .catch(function (e) { document.getElementById("custStatusMsg").textContent = e.message || "خطا"; });
    };
  }

  function contactForm() {
    var box = document.getElementById("contactMethodsAdmin");
    if (!box) return;
    call("/api/admin/contact-methods").then(function (data) {
      var rows = data.methods || [];
      function paint(list) {
        rows = list;
        box.innerHTML = "<p class=\"sub\">روش‌های نمایان برای مشتری: " + ((data.publicMethods || []).length) + "</p>" + list.map(function (row, i) {
          return '<div class="field" data-ct="' + i + '"><label><input type="checkbox" data-k="enabled"' + (row.enabled ? " checked" : "") + "> نمایان</label>" +
            '<select data-k="type"><option value="whatsapp">واتساپ</option><option value="tel">تلفن</option><option value="email">ایمیل</option><option value="telegram">تلگرام</option><option value="instagram">اینستاگرام</option><option value="facebook">فیسبوک</option><option value="url">نشانی دیگر</option></select>' +
            '<input data-k="label" value="' + esc(row.label || "") + '" placeholder="برچسب فارسی">' +
            '<input data-k="label_en" value="' + esc(row.label_en || "") + '" dir="ltr" placeholder="English label">' +
            '<input data-k="destination" value="' + esc(row.destination || "") + '" dir="ltr" placeholder="شماره، ایمیل یا https://">' +
            '<button type="button" data-ct-up="' + i + '">بالا</button> <button type="button" data-ct-down="' + i + '">پایین</button> <button type="button" data-ct-del="' + i + '">حذف</button></div>';
        }).join("") + '<button type="button" class="btn btn-outline btn-sm" id="addContactMethod">+ روش تماس</button> <button type="button" class="btn btn-gold btn-sm" id="saveContactMethods">ذخیره</button>';
        list.forEach(function (row, i) {
          var sel = box.querySelector('[data-ct="' + i + '"] [data-k="type"]');
          if (sel) sel.value = row.type || "url";
        });
        function read() {
          return [].slice.call(box.querySelectorAll("[data-ct]")).map(function (row, i) {
            function val(k) { var el = row.querySelector('[data-k="' + k + '"]'); return el.type === "checkbox" ? el.checked : el.value; }
            return { id: (rows[i] && rows[i].id) || "", type: val("type"), label: val("label"), label_en: val("label_en"), destination: val("destination"), enabled: !!val("enabled"), order: i };
          });
        }
        document.getElementById("addContactMethod").onclick = function () {
          var next = read();
          next.push({ type: "telegram", label: "تلگرام", label_en: "Telegram", destination: "", enabled: false });
          paint(next);
        };
        document.getElementById("saveContactMethods").onclick = function () {
          call("/api/admin/contact-methods", { method: "PUT", body: { methods: read() } }).then(function () { alert("ذخیره شد"); contactForm(); }).catch(function (err) { alert(err.message || "ذخیره نشد"); });
        };
        box.querySelectorAll("[data-ct-del]").forEach(function (btn) {
          btn.onclick = function () { var next = read(); next.splice(parseInt(btn.getAttribute("data-ct-del"), 10), 1); paint(next); };
        });
        box.querySelectorAll("[data-ct-up]").forEach(function (btn) {
          btn.onclick = function () {
            var next = read(); var i = parseInt(btn.getAttribute("data-ct-up"), 10);
            if (i > 0) { var tmp = next[i - 1]; next[i - 1] = next[i]; next[i] = tmp; paint(next); }
          };
        });
        box.querySelectorAll("[data-ct-down]").forEach(function (btn) {
          btn.onclick = function () {
            var next = read(); var i = parseInt(btn.getAttribute("data-ct-down"), 10);
            if (i < next.length - 1) { var tmp = next[i + 1]; next[i + 1] = next[i]; next[i] = tmp; paint(next); }
          };
        });
      }
      paint(rows);
    }).catch(function (err) { box.textContent = err.message || "خطا"; });
  }
  var NAV_EN = { products: "Products", categories: "Categories", icons: "Icons", showcase: "Category Cards", reviews: "Reviews", orders: "Orders", returns: "Returns", returnreasons: "Return Reasons", customers: "Customers", subscribers: "Email Subscribers", discounts: "Discounts", ovdiscounts: "Order Discounts", coupons: "Coupons", ads: "Advertising", campaigns: "Email Campaigns", feedback: "Feedback", giveaways: "Giveaways", finance: "Accounting", staff: "Staff", drivers: "Drivers", driverperf: "Driver Performance", pos: "POS (Separate Sign-In)", driverpage: "Driver Page", poslink: "POS Sales", texts: "Site Text", contacts: "Contact Methods", why: "Why MAHO", links: "Links Page", stores: "Stores", policies: "Policies", hours: "Store Hours", settings: "Settings", publish: "Publish and Backup", security: "Admin Security" };
  var GROUP_EN = ["Catalog", "Orders and Returns", "Customers", "Discounts", "Advertising", "Finance", "Staff and POS", "Content and Links", "Policies", "Store Hours", "Settings", "Security"];
  function setAdminNavLang(en) {
    document.querySelectorAll("#sideNav .side-link").forEach(function (btn) {
      var label = btn.querySelector("span:not(.si)");
      if (!label) return;
      if (!label.dataset.fa) label.dataset.fa = label.childNodes[0] ? label.childNodes[0].textContent : label.textContent;
      var key = btn.getAttribute("data-panel") || btn.getAttribute("data-nav") || "";
      var text = en ? (NAV_EN[key] || label.dataset.fa) : label.dataset.fa;
      if (label.childNodes[0] && label.childNodes[0].nodeType === 3) label.childNodes[0].textContent = text;
      else label.textContent = text;
    });
    document.querySelectorAll(".side-group-label").forEach(function (label, i) {
      if (!label.dataset.fa) label.dataset.fa = label.textContent.trim();
      label.textContent = en ? (GROUP_EN[i] || label.dataset.fa) : label.dataset.fa;
    });
    var title = document.querySelector(".side-title");
    if (title) {
      if (!title.dataset.fa) title.dataset.fa = title.textContent.trim();
      title.textContent = en ? "Sections" : title.dataset.fa;
    }
    document.querySelectorAll("[data-en]").forEach(function (el) {
      if (!el.dataset.fa) el.dataset.fa = (el.childNodes[0] && el.childNodes[0].nodeType === 3) ? el.childNodes[0].textContent : el.textContent;
      var text = en ? el.getAttribute("data-en") : el.dataset.fa;
      if (el.childNodes[0] && el.childNodes[0].nodeType === 3 && el.childNodes.length > 1) el.childNodes[0].textContent = text;
      else el.textContent = text;
    });
    document.documentElement.setAttribute("dir", en ? "ltr" : "rtl");
    document.documentElement.lang = en ? "en" : "fa";
    if (window.MAHOApplyAdminLang) window.MAHOApplyAdminLang(en);
    if (typeof fillCatSelect === "function") fillCatSelect();
    try { localStorage.setItem("maho_lang", en ? "en" : "fa"); } catch (_) {}
  }
  var navLang = document.createElement("button");
  navLang.type = "button";
  navLang.className = "side-link";
  navLang.textContent = "English labels";
  navLang.addEventListener("click", function () {
    var en = document.documentElement.getAttribute("dir") !== "ltr";
    setAdminNavLang(en);
    navLang.textContent = en ? "Persian labels" : "English labels";
  });
  var sideNav = document.getElementById("sideNav");
  if (sideNav) sideNav.appendChild(navLang);
  try {
    if (localStorage.getItem("maho_lang") === "en") {
      setAdminNavLang(true);
      navLang.textContent = "Persian labels";
    }
  } catch (_) {}
  if (window.MutationObserver) {
    var adminLangTimer = 0;
    new MutationObserver(function () {
      if (document.documentElement.lang !== "en") return;
      clearTimeout(adminLangTimer);
      adminLangTimer = setTimeout(function () { if (window.MAHOApplyAdminLang) window.MAHOApplyAdminLang(true); }, 40);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  document.addEventListener("change", function (e) {
    var input = e.target;
    if (!input || !input.getAttribute || !input.getAttribute("data-ad-file")) return;
    var file = input.files && input.files[0];
    if (!file) return;
    var area = input.getAttribute("data-area");
    var index = input.getAttribute("data-i");
    var key = input.getAttribute("data-ad-file");
    var video = key === "videoUrl";
    if (video && file.type !== "video/mp4" && file.type !== "video/webm" && !/\.(mp4|webm)$/i.test(file.name || "")) {
      alert("فقط MP4 یا WebM پذیرفته می‌شود.");
      input.value = "";
      return;
    }
    if (video && file.size > 8 * 1024 * 1024) { alert("حجم ویدیو باید کمتر از ۸ مگابایت باشد."); input.value = ""; return; }
    var body = new FormData();
    body.append(video ? "file" : "files", file);
    fetch(video ? "/api/admin/upload-video" : "/api/admin/upload", { method: "POST", headers: { Authorization: "Bearer " + token() }, body: body })
      .then(function (res) { return res.json().then(function (data) { if (!res.ok) throw new Error((data && data.error) || "upload"); return data; }); })
      .then(function (data) {
        var url = (data && (data.url || (data.urls && data.urls[0]))) || "";
        var field = document.querySelector('[data-area="' + area + '"][data-i="' + index + '"][data-k="' + key + '"]');
        if (field) field.value = url;
        syncAdsFromDom();
        renderAds();
      })
      .catch(function (err) { alert(err.message || "تصویر ذخیره نشد"); });
  });
  function socialForm() {
    var host = document.querySelector('.admin-panel[data-panel="texts"]');
    if (!host) return;
    var box = document.getElementById("footerSocialAdmin");
    if (!box) {
      box = document.createElement("div");
      box.id = "footerSocialAdmin";
      host.appendChild(box);
    }
    call("/api/admin/footer-socials").then(function (data) {
      var rows = data.socials || [];
      box.innerHTML = "<h3>شبکه‌های اجتماعی فوتر</h3><p class=\"sub\">هر پلتفرم یک ردیف است. لینک خالی یا غیرفعال در فوتر نشان داده نمی‌شود. این فهرست جدا از صفحهٔ /links است.</p>" +
        rows.map(function (row, i) {
          return '<div class="field"><label><input type="checkbox" data-soc="' + i + '" data-k="enabled"' + (row.enabled ? " checked" : "") + "> " + esc(row.platform) + "</label>" +
            '<input data-soc="' + i + '" data-k="platform" value="' + esc(row.platform || "") + '" dir="ltr">' +
            '<input data-soc="' + i + '" data-k="label" value="' + esc(row.label || "") + '">' +
            '<input data-soc="' + i + '" data-k="label_en" value="' + esc(row.label_en || "") + '" dir="ltr">' +
            '<input data-soc="' + i + '" data-k="url" value="' + esc(row.url || "") + '" dir="ltr" placeholder="https://"></div>';
        }).join("") + '<button type="button" class="btn btn-outline btn-sm" id="addSocial">+ پلتفرم</button> <button type="button" class="btn btn-gold btn-sm" id="saveSocials">ذخیره فوتر</button>';
      function readSocials() {
        return rows.map(function (row, i) {
          function val(k) {
            var el = box.querySelector('[data-soc="' + i + '"][data-k="' + k + '"]');
            if (!el) return row[k];
            return el.type === "checkbox" ? el.checked : el.value;
          }
          return { id: row.id, platform: val("platform"), label: val("label"), label_en: val("label_en"), url: val("url"), enabled: !!val("enabled"), order: i };
        });
      }
      function paintSocialRows(list) {
        rows = list;
        var legacy = { instagram: "c_instagram", telegram: "c_telegram", whatsapp: "c_whatsappLink", facebook: "c_facebook", tiktok: "c_tiktok" };
        Object.keys(legacy).forEach(function (key) {
          var el = document.getElementById(legacy[key]);
          var row = list.filter(function (item) { return item.platform === key; })[0];
          if (el) el.value = row && row.url ? row.url : "";
        });
        box.innerHTML = "<h3>شبکه‌های اجتماعی فوتر</h3><p class=\"sub\">هر پلتفرم یک ردیف است. لینک خالی یا غیرفعال در فوتر نشان داده نمی‌شود. این فهرست جدا از صفحهٔ /links است.</p>" + list.map(function (row, i) {
          return '<div class="field"><label><input type="checkbox" data-soc="' + i + '" data-k="enabled"' + (row.enabled ? " checked" : "") + "> " + esc(row.platform) + "</label>" +
            '<input data-soc="' + i + '" data-k="platform" value="' + esc(row.platform || "") + '" dir="ltr">' +
            '<input data-soc="' + i + '" data-k="label" value="' + esc(row.label || "") + '">' +
            '<input data-soc="' + i + '" data-k="label_en" value="' + esc(row.label_en || "") + '" dir="ltr">' +
            '<input data-soc="' + i + '" data-k="url" value="' + esc(row.url || "") + '" dir="ltr" placeholder="https://"></div>';
        }).join("") + '<button type="button" class="btn btn-outline btn-sm" id="addSocial">+ پلتفرم</button> <button type="button" class="btn btn-gold btn-sm" id="saveSocials">ذخیره فوتر</button>';
        document.getElementById("addSocial").onclick = function () {
          var next = readSocials();
          next.push({ platform: "linkedin", label: "لینکدین", label_en: "LinkedIn", url: "", enabled: false, order: next.length });
          paintSocialRows(next);
        };
        document.getElementById("saveSocials").onclick = function () {
          call("/api/admin/footer-socials", { method: "PUT", body: { socials: readSocials() } }).then(function () { alert("ذخیره شد"); socialForm(); }).catch(function (e) { alert(e.message || "خطا"); });
        };
      }
      paintSocialRows(rows);
    }).catch(function (e) { box.textContent = e.message || "خطا"; });
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
