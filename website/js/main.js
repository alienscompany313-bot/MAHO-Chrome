/* ===========================================================
   MAHO — women's clothing & essentials storefront
   Bilingual (Dari / English), zero dependencies.
   =========================================================== */
(function () {
  "use strict";

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  /* -------------------- Language state -------------------- */
  let LANG = "fa";
  try {
    const saved = localStorage.getItem("maho_lang");
    if (saved === "fa" || saved === "en") LANG = saved;
  } catch (_) {}

  const faMap = "۰۱۲۳۴۵۶۷۸۹";
  const toDigits = (value, lang = LANG) =>
    lang === "en" ? String(value) : String(value).replace(/[0-9]/g, (d) => faMap[d]);
  const money = (amount, lang = LANG) =>
    lang === "en"
      ? amount.toLocaleString("en-US") + " AFN"
      : toDigits(amount.toLocaleString("en-US"), "fa") + " افغانی";

  const icon = (id) => `<svg class="ic" aria-hidden="true"><use href="#i-${id}"/></svg>`;

  /* -------------------- Translations -------------------- */
  const I18N = {
    fa: {
      "nav.home": "خانه", "nav.categories": "دسته‌بندی‌ها", "nav.products": "محصولات",
      "nav.stores": "فروشگاه", "nav.about": "درباره ما", "nav.contact": "تماس",
      "header.portal": "ورود به پرتال",
      "brand.sub": "لباس و لوازم بانوان",
      "hero.eyebrow": "✦ لباس و لوازم بانوان MAHO",
      "hero.title": 'زیبایی و اصالت<br>در <span class="grad">پوشاک زنانه</span>',
      "hero.lead": "از لباس مجلسی و مانتو تا شال، کیف، کفش و لوازم آرایشی — هر آنچه یک خانم شیک‌پوش نیاز دارد، با کیفیت ممتاز و قیمت مناسب در MAHO.",
      "hero.cta1": "مشاهده‌ی محصولات ←", "hero.cta2": "آدرس فروشگاه",
      "stat.products": "مدل و کالای متنوع", "stat.customers": "مشتری راضی",
      "stat.years": "سال تجربه", "stat.brands": "برند معتبر",
      "herocard.tag1": "پرفروش", "herocard.t1": "لباس مجلسی", "herocard.s1": "پیراهن و کالای شب",
      "herocard.tag2": "جدید", "herocard.t2": "شال و روسری", "herocard.s2": "کالکشن فصل جدید",
      "herocard.tag3": "۲۵٪ تخفیف", "herocard.t3": "کیف و کفش", "herocard.s3": "پیشنهاد هفته",
      "cats.kicker": "دسته‌بندی‌ها", "cats.h2": "هر آنچه یک خانم لازم دارد",
      "cats.p": "از پوشاک و شال تا کیف، کفش، اکسسوری و لوازم آرایشی — همه در یک‌جا و دسته‌بندی‌شده.",
      "cat1.t": "لباس مجلسی", "cat1.d": "پیراهن و کالای شب",
      "cat2.t": "مانتو و پالتو", "cat2.d": "روزمره و رسمی",
      "cat3.t": "بلوز و شومیز", "cat3.d": "مدل‌های متنوع",
      "cat4.t": "شال و روسری", "cat4.d": "نخی و ابریشمی",
      "cat5.t": "کیف زنانه", "cat5.d": "دستی و مجلسی",
      "cat6.t": "کفش زنانه", "cat6.d": "پاشنه‌بلند و تخت",
      "cat7.t": "اکسسوری و بدلیجات", "cat7.d": "گردنبند، دستبند و ساعت",
      "cat8.t": "آرایشی و بهداشتی", "cat8.d": "لوازم آرایش و عطر",
      "prod.kicker": "جدیدترین‌ها", "prod.h2": "پرفروش‌ترین‌های بانوان",
      "prod.p": "گلچینی از شیک‌ترین کالاهای زنانه‌ی MAHO با قیمت ویژه.",
      "filter.all": "همه", "filter.clothing": "پوشاک", "filter.scarf": "شال و روسری",
      "filter.bagshoes": "کیف و کفش", "filter.beauty": "آرایشی", "filter.accessory": "اکسسوری",
      "feat.kicker": "چرا MAHO", "feat.h2": "تجربه‌ی خریدی که به آن اعتماد می‌کنید",
      "feat.p": "تعهد ما فقط فروش نیست؛ ساختن رابطه‌ای بلندمدت بر پایه‌ی اعتماد و کیفیت است.",
      "feat1.t": "ضمانت اصالت", "feat1.d": "تمام کالاها اصل و باکیفیت انتخاب شده‌اند.",
      "feat2.t": "ارسال سریع", "feat2.d": "تحویل درب منزل در کوتاه‌ترین زمان در شهر.",
      "feat3.t": "تعویض آسان", "feat3.d": "مهلت تعویض یا بازگشت کالا بدون دردسر.",
      "feat4.t": "پشتیبانی خوب", "feat4.d": "همراه شما پیش و پس از خرید.",
      "stores.kicker": "فروشگاه ما", "stores.h2": "حضوری از فروشگاه MAHO دیدن کنید",
      "stores.p": "با تیمی آماده برای راهنمایی و انتخاب بهترین کالا در خدمت شما هستیم.",
      "store.open": "باز است", "store.directions": "مسیریابی روی نقشه ←",
      "testi.kicker": "نظر مشتریان", "testi.h2": "حرف دل مشتریان MAHO",
      "testi1.q": "«جنس لباس‌ها عالی و دوختشان تمیز بود. مانتویی که خریدم دقیقاً مثل عکس بود و پرسنل هم خیلی خوش‌برخورد بودند.»",
      "testi1.name": "نرگس احمدی", "testi1.role": "مشتری وفادار",
      "testi2.q": "«تنوع شال و روسری بی‌نظیر است و قیمت‌ها منصفانه. ضمانت تعویض کالا باعث شد با خیال راحت خرید کنم.»",
      "testi2.name": "مریم حسینی", "testi2.role": "خریدار",
      "testi3.q": "«برای مجلس یک پیراهن شیک و یک کیف ست خریدم؛ همه تعریف کردند. حتماً دوباره از MAHO خرید می‌کنم.»",
      "testi3.name": "سمیرا نوری", "testi3.role": "مشتری جدید",
      "cta.h2": "از تخفیف‌ها و محصولات جدید باخبر شوید",
      "cta.p": "ایمیل خود را وارد کنید تا پیشنهادهای ویژه‌ی MAHO را دریافت کنید.",
      "cta.ph": "ایمیل شما (example@mail.com)", "cta.btn": "عضویت",
      "footer.desc": "لباس و لوازم بانوان MAHO — پوشاک و لوازم زنانه با کیفیت ممتاز، ضمانت اصالت و خدمات پس از فروش قابل اعتماد.",
      "footer.shop": "فروشگاه", "footer.link.categories": "دسته‌بندی‌ها",
      "footer.link.products": "محصولات", "footer.link.stores": "فروشگاه", "footer.link.reviews": "نظر مشتریان",
      "footer.support": "پشتیبانی", "footer.link.contact": "تماس با ما", "footer.link.about": "درباره‌ی MAHO",
      "footer.link.terms": "قوانین و شرایط", "footer.link.track": "پیگیری سفارش",
      "footer.contact": "تماس",
      "footer.addr": "کوته سنگی، کابل — مبارک سنتر، منزل ۴، دوکان ۷۴ و ۷۵",
      "footer.phone": "۰۷۰۰ ۱۲۳ ۴۵۶", "footer.email": "info@maho.example",
      "footer.map": "مشاهده روی نقشه ←",
      "footer.copyPre": "©", "footer.copy": "MAHO — همه‌ی حقوق محفوظ است.",
      "footer.made": "ساخته‌شده با ❤ برای مشتریان MAHO",
      "toast.cart": "«{name}» به سبد خرید اضافه شد ({n})",
      "toast.news": "عضویت در خبرنامه با موفقیت انجام شد ✓",
      "form.err": "لطفاً یک ایمیل معتبر وارد کنید.",
      "form.ok": "عضویت شما ثبت شد! به‌زودی پیشنهادهای ویژه‌ی MAHO را دریافت می‌کنید.",
      "lang.other": "English",
    },
    en: {
      "nav.home": "Home", "nav.categories": "Categories", "nav.products": "Products",
      "nav.stores": "Store", "nav.about": "About", "nav.contact": "Contact",
      "header.portal": "Staff Portal",
      "brand.sub": "WOMEN'S CLOTHING & ESSENTIALS",
      "hero.eyebrow": "✦ MAHO Women's Clothing & Essentials",
      "hero.title": 'Elegance & quality<br>in <span class="grad">women\'s fashion</span>',
      "hero.lead": "From evening dresses and manteaus to scarves, bags, shoes and cosmetics — everything a stylish woman needs, with premium quality and fair prices at MAHO.",
      "hero.cta1": "Shop products →", "hero.cta2": "Our location",
      "stat.products": "Products & styles", "stat.customers": "Happy customers",
      "stat.years": "Years of experience", "stat.brands": "Trusted brands",
      "herocard.tag1": "Bestseller", "herocard.t1": "Evening wear", "herocard.s1": "Dresses & eveningwear",
      "herocard.tag2": "New", "herocard.t2": "Scarves", "herocard.s2": "New season",
      "herocard.tag3": "25% off", "herocard.t3": "Bags & shoes", "herocard.s3": "Weekly deal",
      "cats.kicker": "Categories", "cats.h2": "Everything she needs",
      "cats.p": "From clothing and scarves to bags, shoes, accessories and cosmetics — all in one place, neatly organized.",
      "cat1.t": "Evening dresses", "cat1.d": "Dresses & eveningwear",
      "cat2.t": "Manteaus & coats", "cat2.d": "Casual & formal",
      "cat3.t": "Blouses & tops", "cat3.d": "Many styles",
      "cat4.t": "Scarves & shawls", "cat4.d": "Cotton & silk",
      "cat5.t": "Handbags", "cat5.d": "Everyday & evening",
      "cat6.t": "Women's shoes", "cat6.d": "Heels & flats",
      "cat7.t": "Accessories & jewelry", "cat7.d": "Necklaces, bracelets & watches",
      "cat8.t": "Beauty & care", "cat8.d": "Makeup & perfume",
      "prod.kicker": "New arrivals", "prod.h2": "Bestsellers for women",
      "prod.p": "A selection of MAHO's most stylish women's items at special prices.",
      "filter.all": "All", "filter.clothing": "Clothing", "filter.scarf": "Scarves",
      "filter.bagshoes": "Bags & shoes", "filter.beauty": "Beauty", "filter.accessory": "Accessories",
      "feat.kicker": "Why MAHO", "feat.h2": "A shopping experience you can trust",
      "feat.p": "Our commitment isn't just selling — it's building a lasting relationship based on trust and quality.",
      "feat1.t": "Genuine quality", "feat1.d": "Every item is genuine and carefully selected.",
      "feat2.t": "Fast delivery", "feat2.d": "Home delivery across the city in no time.",
      "feat3.t": "Easy exchange", "feat3.d": "Hassle-free exchange or return window.",
      "feat4.t": "Friendly support", "feat4.d": "With you before and after your purchase.",
      "stores.kicker": "Our store", "stores.h2": "Visit the MAHO store in person",
      "stores.p": "Our team is ready to help you choose the best.",
      "store.open": "Open now", "store.directions": "Get directions →",
      "testi.kicker": "Testimonials", "testi.h2": "What MAHO customers say",
      "testi1.q": "“The clothing quality and stitching were excellent. The manteau I bought looked exactly like the photo, and the staff were very kind.”",
      "testi1.name": "Narges Ahmadi", "testi1.role": "Loyal customer",
      "testi2.q": "“The variety of scarves is amazing and prices are fair. The exchange guarantee let me shop with peace of mind.”",
      "testi2.name": "Maryam Hosseini", "testi2.role": "Shopper",
      "testi3.q": "“I bought an elegant dress and a matching bag for a party; everyone complimented me. I'll definitely shop at MAHO again.”",
      "testi3.name": "Samira Nouri", "testi3.role": "New customer",
      "cta.h2": "Get offers & new arrivals",
      "cta.p": "Enter your email to receive MAHO's special offers.",
      "cta.ph": "Your email (example@mail.com)", "cta.btn": "Subscribe",
      "footer.desc": "MAHO Women's Clothing & Essentials — premium women's apparel and supplies with genuine quality and reliable after-sales service.",
      "footer.shop": "Shop", "footer.link.categories": "Categories",
      "footer.link.products": "Products", "footer.link.stores": "Store", "footer.link.reviews": "Testimonials",
      "footer.support": "Support", "footer.link.contact": "Contact us", "footer.link.about": "About MAHO",
      "footer.link.terms": "Terms & conditions", "footer.link.track": "Track order",
      "footer.contact": "Contact",
      "footer.addr": "Kote Sangi, Kabul — Mubarak Center, 4th floor, shop 74 & 75",
      "footer.phone": "0700 123 456", "footer.email": "info@maho.example",
      "footer.map": "View on map →",
      "footer.copyPre": "©", "footer.copy": "MAHO — All rights reserved.",
      "footer.made": "Made with ❤ for MAHO customers",
      "toast.cart": "“{name}” added to your cart ({n})",
      "toast.news": "You're subscribed to the newsletter ✓",
      "form.err": "Please enter a valid email address.",
      "form.ok": "You're subscribed! You'll soon receive MAHO's special offers.",
      "lang.other": "دری",
    },
  };
  const t = (key) => (I18N[LANG] && I18N[LANG][key]) || I18N.fa[key] || key;

  /* -------------------- Data -------------------- */
  const CAT_ICON = { clothing: "dress", scarf: "scarf", bagshoes: "bag", beauty: "sparkles", accessory: "ring" };

  const PRODUCTS = [
    { name: "پیراهن مجلسی بلند", name_en: "Long Evening Dress", cat: "clothing", icon: "dress", price: 4200, old: 5000, badge: "sale", badgeText: "۱۶٪ تخفیف", badgeText_en: "16% off" },
    { name: "مانتو کژوال روزمره", name_en: "Casual Manteau", cat: "clothing", icon: "coat", price: 3200, badge: "new", badgeText: "جدید", badgeText_en: "New" },
    { name: "بلوز و شومیز آستین‌بلند", name_en: "Long-sleeve Blouse", cat: "clothing", icon: "shirt", price: 1450 },
    { name: "شال نخی طرح‌دار", name_en: "Patterned Cotton Shawl", cat: "scarf", icon: "scarf", price: 650, badge: "new", badgeText: "جدید", badgeText_en: "New" },
    { name: "روسری ابریشمی", name_en: "Silk Headscarf", cat: "scarf", icon: "scarf", price: 1200, old: 1350, badge: "sale", badgeText: "۱۰٪ تخفیف", badgeText_en: "10% off" },
    { name: "کیف دستی چرم", name_en: "Leather Handbag", cat: "bagshoes", icon: "bag", price: 2800 },
    { name: "کفش پاشنه‌بلند مجلسی", name_en: "Evening High Heels", cat: "bagshoes", icon: "heel", price: 3100, old: 3900, badge: "sale", badgeText: "۲۰٪ تخفیف", badgeText_en: "20% off" },
    { name: "کفش تخت راحتی", name_en: "Comfort Flats", cat: "bagshoes", icon: "heel", price: 1900 },
    { name: "ست لوازم آرایش", name_en: "Makeup Set", cat: "beauty", icon: "sparkles", price: 2500, badge: "new", badgeText: "جدید", badgeText_en: "New" },
    { name: "عطر زنانه لوکس", name_en: "Luxury Women's Perfume", cat: "beauty", icon: "perfume", price: 3900, old: 4400, badge: "sale", badgeText: "۱۲٪ تخفیف", badgeText_en: "12% off" },
    { name: "ست گردنبند و دستبند", name_en: "Necklace & Bracelet Set", cat: "accessory", icon: "ring", price: 1650 },
    { name: "ساعت مچی زنانه", name_en: "Women's Wristwatch", cat: "accessory", icon: "watch", price: 3600, badge: "new", badgeText: "جدید", badgeText_en: "New" },
  ];
  const CAT_LABEL = {
    fa: { clothing: "پوشاک", scarf: "شال و روسری", bagshoes: "کیف و کفش", beauty: "آرایشی و بهداشتی", accessory: "اکسسوری" },
    en: { clothing: "Clothing", scarf: "Scarves", bagshoes: "Bags & Shoes", beauty: "Beauty", accessory: "Accessories" },
  };

  const STORES = [
    {
      name: "لباس و لوازم بانوان MAHO", name_en: "MAHO Women's Clothing & Essentials",
      area: "نمایندگی مبارک سنتر، منزل چهارم، دوکان نمبر ۷۴ و ۷۵، کوته سنگی، کابل، افغانستان",
      area_en: "Mubarak Center, 4th floor, shop no. 74 & 75, Kote Sangi, Kabul, Afghanistan",
      hours: "شنبه تا پنجشنبه، ۹ صبح تا ۸ شب", hours_en: "Sat–Thu, 9:00 AM – 8:00 PM",
      phone: "۰۷۰۰ ۱۲۳ ۴۵۶", phone_en: "0700 123 456",
      map: "https://maps.app.goo.gl/U6miPMFLBSY6woFo6",
    },
  ];

  /* -------------------- Render products -------------------- */
  let activeFilter = "all";
  const productGrid = $("#productGrid");
  function renderProducts() {
    if (!productGrid) return;
    productGrid.innerHTML = PRODUCTS.map((p) => {
      const badgeText = LANG === "en" ? (p.badgeText_en || p.badgeText) : p.badgeText;
      const badge = p.badge
        ? `<span class="product-badge ${p.badge === "new" ? "new" : ""}">${badgeText}</span>`
        : "";
      const old = p.old ? `<del>${money(p.old)}</del>` : "";
      const name = LANG === "en" ? (p.name_en || p.name) : p.name;
      return `
        <article class="product-card" data-cat="${p.cat}">
          <div class="product-media m-${p.cat}">${badge}${icon(p.icon || CAT_ICON[p.cat] || "bag")}</div>
          <div class="product-body">
            <span class="cat">${CAT_LABEL[LANG][p.cat]}</span>
            <h3>${name}</h3>
            <div class="product-foot">
              <span class="price">${money(p.price)} ${old}</span>
              <button class="icon-btn" type="button" aria-label="${LANG === "en" ? "Add to cart" : "افزودن به سبد خرید"}" data-add="${name}">${icon("bag")}</button>
            </div>
          </div>
        </article>`;
    }).join("");
    applyFilter(activeFilter);
  }

  /* -------------------- Render store -------------------- */
  const storeGrid = $("#storeGrid");
  function renderStores() {
    if (!storeGrid) return;
    storeGrid.innerHTML = STORES.map((s) => {
      const name = LANG === "en" ? (s.name_en || s.name) : s.name;
      const area = LANG === "en" ? (s.area_en || s.area) : s.area;
      const hours = LANG === "en" ? (s.hours_en || s.hours) : s.hours;
      const phone = LANG === "en" ? (s.phone_en || s.phone) : s.phone;
      return `
        <article class="store-card">
          <div class="store-top">
            <h3>${name}</h3>
            <span class="badge-open">${t("store.open")}</span>
          </div>
          <div class="store-row"><span class="ico">${icon("pin")}</span><span>${area}</span></div>
          <div class="store-row"><span class="ico">${icon("clock")}</span><span>${hours}</span></div>
          <div class="store-row"><span class="ico">${icon("call")}</span><span>${phone}</span></div>
          <a class="btn btn-outline" target="_blank" rel="noopener" href="${s.map}">${t("store.directions")}</a>
        </article>`;
    }).join("");
  }

  /* -------------------- Filtering -------------------- */
  function applyFilter(filter) {
    activeFilter = filter;
    $$(".product-card", productGrid).forEach((card) => {
      const show = filter === "all" || card.dataset.cat === filter;
      card.classList.toggle("is-hidden", !show);
    });
  }
  const filterBar = $("#filterBar");
  if (filterBar) {
    filterBar.addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      $$(".chip", filterBar).forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      applyFilter(chip.dataset.filter);
    });
  }

  /* -------------------- Add to cart (demo) -------------------- */
  let cartCount = 0;
  document.addEventListener("click", (e) => {
    const addBtn = e.target.closest("[data-add]");
    if (!addBtn) return;
    cartCount += 1;
    showToast(t("toast.cart").replace("{name}", addBtn.dataset.add).replace("{n}", toDigits(cartCount)));
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

  /* -------------------- Header shadow + back to top -------------------- */
  const header = $("#header");
  const toTop = $("#toTop");
  const onScroll = () => {
    const y = window.scrollY;
    if (header) header.classList.toggle("scrolled", y > 20);
    if (toTop) toTop.classList.toggle("show", y > 500);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  if (toTop) toTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

  /* -------------------- Active nav link on scroll -------------------- */
  const navLinks = $$(".main-nav a");
  const sections = navLinks.map((a) => document.querySelector(a.getAttribute("href"))).filter(Boolean);
  if ("IntersectionObserver" in window && sections.length) {
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const id = "#" + entry.target.id;
          navLinks.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === id));
        }
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    sections.forEach((s) => spy.observe(s));
  }

  /* -------------------- Scroll reveal -------------------- */
  if ("IntersectionObserver" in window) {
    const revObs = new IntersectionObserver((entries, obs) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) { entry.target.classList.add("in"); obs.unobserve(entry.target); }
      });
    }, { threshold: 0.12 });
    $$(".reveal").forEach((el) => revObs.observe(el));
  } else {
    $$(".reveal").forEach((el) => el.classList.add("in"));
  }

  /* -------------------- Animated stat counters -------------------- */
  const counters = $$("[data-count]");
  function formatCounters() { counters.forEach((el) => { el.textContent = toDigits(parseInt(el.dataset.count, 10)); }); }
  if (counters.length && "IntersectionObserver" in window) {
    const countObs = new IntersectionObserver((entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const target = parseInt(el.dataset.count, 10);
        const dur = 1400, start = performance.now();
        const tick = (now) => {
          const p = Math.min((now - start) / dur, 1);
          const eased = 1 - Math.pow(1 - p, 3);
          el.textContent = toDigits(Math.floor(eased * target));
          if (p < 1) requestAnimationFrame(tick); else el.textContent = toDigits(target);
        };
        requestAnimationFrame(tick);
        obs.unobserve(el);
      });
    }, { threshold: 0.5 });
    counters.forEach((c) => countObs.observe(c));
  } else {
    formatCounters();
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
        note.textContent = t("form.err");
        note.className = "form-note err";
        emailInput.focus();
        return;
      }
      note.textContent = t("form.ok");
      note.className = "form-note ok";
      form.reset();
      showToast(t("toast.news"));
    });
  }

  /* -------------------- Footer year -------------------- */
  const yearEl = $("#year");
  function updateYear() {
    const gy = new Date().getFullYear();
    yearEl && (yearEl.textContent = LANG === "en" ? String(gy) : toDigits(gy - 621));
  }

  /* -------------------- Apply language -------------------- */
  function applyI18n() {
    $$("[data-i18n]").forEach((el) => { el.textContent = t(el.getAttribute("data-i18n")); });
    $$("[data-i18n-html]").forEach((el) => { el.innerHTML = t(el.getAttribute("data-i18n-html")); });
    $$("[data-i18n-ph]").forEach((el) => { el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph"))); });
  }
  function applyLang(lang) {
    LANG = lang === "en" ? "en" : "fa";
    try { localStorage.setItem("maho_lang", LANG); } catch (_) {}
    document.documentElement.lang = LANG === "en" ? "en" : "fa";
    document.documentElement.dir = LANG === "en" ? "ltr" : "rtl";
    applyI18n();
    renderProducts();
    renderStores();
    formatCounters();
    updateYear();
    const label = $("#langLabel");
    if (label) label.textContent = t("lang.other");
  }
  const langToggle = $("#langToggle");
  if (langToggle) langToggle.addEventListener("click", () => applyLang(LANG === "fa" ? "en" : "fa"));

  /* -------------------- Init -------------------- */
  applyLang(LANG);
})();
