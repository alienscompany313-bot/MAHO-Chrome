/* ===========================================================
   MAHO Retail — storefront interactivity
   No dependencies. Progressive enhancement over static HTML.
   =========================================================== */
(function () {
  "use strict";

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  /* Convert Latin digits to Persian for display */
  const faDigits = (value) =>
    String(value).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);

  /* Format a price in Afghani with thousands separators + Persian digits */
  const money = (amount) => faDigits(amount.toLocaleString("en-US")) + " افغانی";

  /* Inline SVG icon reference (uses the sprite in index.html) */
  const icon = (id) => `<svg class="ic" aria-hidden="true"><use href="#i-${id}"/></svg>`;

  /* Map product category -> fallback icon id (per-product `icon` overrides this) */
  const CAT_ICON = { clothing: "dress", scarf: "scarf", bagshoes: "bag", beauty: "sparkles", accessory: "ring" };

  /* -------------------- Data -------------------- */
  const PRODUCTS = [
    { name: "پیراهن مجلسی بلند", cat: "clothing", catLabel: "پوشاک", icon: "dress", price: 4200, old: 5000, badge: "sale", badgeText: "۱۶٪ تخفیف" },
    { name: "مانتو کژوال روزمره", cat: "clothing", catLabel: "پوشاک", icon: "coat", price: 3200, badge: "new", badgeText: "جدید" },
    { name: "بلوز و شومیز آستین‌بلند", cat: "clothing", catLabel: "پوشاک", icon: "shirt", price: 1450 },
    { name: "شال نخی طرح‌دار", cat: "scarf", catLabel: "شال و روسری", icon: "scarf", price: 650, badge: "new", badgeText: "جدید" },
    { name: "روسری ابریشمی", cat: "scarf", catLabel: "شال و روسری", icon: "scarf", price: 1200, old: 1350, badge: "sale", badgeText: "۱۰٪ تخفیف" },
    { name: "کیف دستی چرم", cat: "bagshoes", catLabel: "کیف و کفش", icon: "bag", price: 2800 },
    { name: "کفش پاشنه‌بلند مجلسی", cat: "bagshoes", catLabel: "کیف و کفش", icon: "heel", price: 3100, old: 3900, badge: "sale", badgeText: "۲۰٪ تخفیف" },
    { name: "کفش تخت راحتی", cat: "bagshoes", catLabel: "کیف و کفش", icon: "heel", price: 1900 },
    { name: "ست لوازم آرایش", cat: "beauty", catLabel: "آرایشی و بهداشتی", icon: "sparkles", price: 2500, badge: "new", badgeText: "جدید" },
    { name: "عطر زنانه لوکس", cat: "beauty", catLabel: "آرایشی و بهداشتی", icon: "perfume", price: 3900, old: 4400, badge: "sale", badgeText: "۱۲٪ تخفیف" },
    { name: "ست گردنبند و دستبند", cat: "accessory", catLabel: "اکسسوری", icon: "ring", price: 1650 },
    { name: "ساعت مچی زنانه", cat: "accessory", catLabel: "اکسسوری", icon: "watch", price: 3600, badge: "new", badgeText: "جدید" },
  ];

  const STORES = [
    { name: "بوتیک MAHO", area: "کابل، جاده‌ی میوند", hours: "شنبه تا پنج‌شنبه، ۹ صبح تا ۸ شب", phone: "۰۷۰۰ ۱۲۳ ۴۵۶", q: "MAHO+Boutique+Maiwand+Kabul" },
  ];

  /* -------------------- Render products -------------------- */
  const productGrid = $("#productGrid");
  if (productGrid) {
    productGrid.innerHTML = PRODUCTS.map((p) => {
      const badge = p.badge
        ? `<span class="product-badge ${p.badge === "new" ? "new" : ""}">${p.badgeText}</span>`
        : "";
      const old = p.old ? `<del>${money(p.old)}</del>` : "";
      return `
        <article class="product-card" data-cat="${p.cat}">
          <div class="product-media m-${p.cat}">${badge}${icon(p.icon || CAT_ICON[p.cat] || "bag")}</div>
          <div class="product-body">
            <span class="cat">${p.catLabel}</span>
            <h3>${p.name}</h3>
            <div class="product-foot">
              <span class="price">${money(p.price)} ${old}</span>
              <button class="icon-btn" type="button" aria-label="افزودن به سبد خرید" data-add="${p.name}">${icon("bag")}</button>
            </div>
          </div>
        </article>`;
    }).join("");
  }

  /* -------------------- Render stores -------------------- */
  const storeGrid = $("#storeGrid");
  if (storeGrid) {
    storeGrid.innerHTML = STORES.map((s) => `
      <article class="store-card reveal">
        <div class="store-top">
          <h3>${s.name}</h3>
          <span class="badge-open">باز است</span>
        </div>
        <div class="store-row"><span class="ico">${icon("pin")}</span><span>${s.area}</span></div>
        <div class="store-row"><span class="ico">${icon("clock")}</span><span>${s.hours}</span></div>
        <div class="store-row"><span class="ico">${icon("call")}</span><span>${s.phone}</span></div>
        <a class="btn btn-outline" target="_blank" rel="noopener"
           href="https://www.google.com/maps/search/?api=1&query=${s.q}">مسیریابی روی نقشه ←</a>
      </article>`).join("");
  }

  /* -------------------- Product filtering -------------------- */
  const filterBar = $("#filterBar");
  if (filterBar) {
    filterBar.addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      $$(".chip", filterBar).forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      const filter = chip.dataset.filter;
      $$(".product-card", productGrid).forEach((card) => {
        const show = filter === "all" || card.dataset.cat === filter;
        card.classList.toggle("is-hidden", !show);
      });
    });
  }

  /* -------------------- Add to cart (demo) -------------------- */
  let cartCount = 0;
  document.addEventListener("click", (e) => {
    const addBtn = e.target.closest("[data-add]");
    if (!addBtn) return;
    cartCount += 1;
    showToast(`«${addBtn.dataset.add}» به سبد خرید اضافه شد (${faDigits(cartCount)})`);
  });

  /* -------------------- Toast -------------------- */
  const toast = $("#toast");
  const toastMsg = $("#toastMsg");
  let toastTimer;
  function showToast(msg) {
    if (!toast) return;
    toastMsg.textContent = msg;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
  }

  /* -------------------- Mobile nav -------------------- */
  const navToggle = $("#navToggle");
  const nav = $("#nav");
  if (navToggle && nav) {
    navToggle.addEventListener("click", () => {
      const open = document.body.classList.toggle("nav-open");
      navToggle.setAttribute("aria-expanded", String(open));
    });
    nav.addEventListener("click", (e) => {
      if (e.target.closest("a")) {
        document.body.classList.remove("nav-open");
        navToggle.setAttribute("aria-expanded", "false");
      }
    });
  }

  /* -------------------- Header shadow on scroll -------------------- */
  const header = $("#header");
  const toTop = $("#toTop");
  const onScroll = () => {
    const y = window.scrollY;
    if (header) header.classList.toggle("scrolled", y > 20);
    if (toTop) toTop.classList.toggle("show", y > 500);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  if (toTop) {
    toTop.addEventListener("click", () =>
      window.scrollTo({ top: 0, behavior: "smooth" })
    );
  }

  /* -------------------- Active nav link on scroll -------------------- */
  const navLinks = $$(".main-nav a");
  const sections = navLinks
    .map((a) => document.querySelector(a.getAttribute("href")))
    .filter(Boolean);
  if ("IntersectionObserver" in window && sections.length) {
    const spy = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const id = "#" + entry.target.id;
            navLinks.forEach((a) =>
              a.classList.toggle("active", a.getAttribute("href") === id)
            );
          }
        });
      },
      { rootMargin: "-45% 0px -50% 0px" }
    );
    sections.forEach((s) => spy.observe(s));
  }

  /* -------------------- Scroll reveal -------------------- */
  const revealables = () => $$(".reveal:not(.in)");
  if ("IntersectionObserver" in window) {
    const revObs = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    // Observe now and again shortly after (store/product cards render async above)
    revealables().forEach((el) => revObs.observe(el));
    setTimeout(() => revealables().forEach((el) => revObs.observe(el)), 50);
  } else {
    revealables().forEach((el) => el.classList.add("in"));
  }

  /* -------------------- Animated stat counters -------------------- */
  const counters = $$("[data-count]");
  if (counters.length && "IntersectionObserver" in window) {
    const countObs = new IntersectionObserver((entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const target = parseInt(el.dataset.count, 10);
        const dur = 1400;
        const start = performance.now();
        const tick = (now) => {
          const t = Math.min((now - start) / dur, 1);
          const eased = 1 - Math.pow(1 - t, 3);
          el.textContent = faDigits(Math.floor(eased * target));
          if (t < 1) requestAnimationFrame(tick);
          else el.textContent = faDigits(target);
        };
        requestAnimationFrame(tick);
        obs.unobserve(el);
      });
    }, { threshold: 0.5 });
    counters.forEach((c) => countObs.observe(c));
  }

  /* -------------------- Newsletter form -------------------- */
  const form = $("#newsletterForm");
  const emailInput = $("#emailInput");
  const note = $("#formNote");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const value = (emailInput.value || "").trim();
      const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
      if (!valid) {
        note.textContent = "لطفاً یک ایمیل معتبر وارد کنید.";
        note.className = "form-note err";
        emailInput.focus();
        return;
      }
      note.textContent = "عضویت شما ثبت شد! به‌زودی پیشنهادهای ویژه‌ی MAHO را دریافت می‌کنید.";
      note.className = "form-note ok";
      form.reset();
      showToast("عضویت در خبرنامه با موفقیت انجام شد ✓");
    });
  }

  /* -------------------- Footer year (Persian) -------------------- */
  const yearEl = $("#year");
  if (yearEl) {
    // Approximate current Solar Hijri year for display
    const gy = new Date().getFullYear();
    yearEl.textContent = faDigits(gy - 621);
  }
})();
