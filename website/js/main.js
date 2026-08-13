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
  const toEnDigits = (s) => String(s == null ? "" : s).replace(/[۰-۹]/g, (d) => faMap.indexOf(d));

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
      "footer.phone": "‪+93 791 505 454‬", "footer.email": "info@maho.example",
      "footer.map": "مشاهده روی نقشه ←",
      "footer.copyPre": "©", "footer.copy": "MAHO — همه‌ی حقوق محفوظ است.",
      "footer.made": "ساخته‌شده با ❤ برای مشتریان MAHO",
      "toast.cart": "«{name}» به سبد خرید اضافه شد ({n})",
      "toast.news": "عضویت در خبرنامه با موفقیت انجام شد ✓",
      "form.err": "لطفاً یک ایمیل معتبر وارد کنید.",
      "form.ok": "عضویت شما ثبت شد! به‌زودی پیشنهادهای ویژه‌ی MAHO را دریافت می‌کنید.",
      "lang.other": "English",
      "cart.title": "سبد خرید", "cart.empty": "سبد خرید شما خالی است.",
      "cart.total": "مجموع", "cart.checkout": "ثبت سفارش از طریق واتساپ",
      "cart.clear": "خالی‌کردن سبد", "cart.remove": "حذف", "cart.emptyToast": "سبد خرید خالی است.",
      "qv.add": "افزودن به سبد",
      "qv.size": "سایز", "qv.color": "رنگ", "qv.pick": "لطفاً سایز و رنگ را انتخاب کنید.",
      "cart.continue": "تکمیل سفارش ←",
      "co.back": "→ بازگشت به سبد", "co.title": "مشخصات سفارش",
      "co.name": "نام و تخلص *", "co.phone": "شماره تماس *", "co.address": "آدرس تحویل *", "co.note": "توضیحات (اختیاری)",
      "co.err": "لطفاً نام، شماره تماس و آدرس را وارد کنید.",
      "acct.login": "ورود", "acct.signup": "ساخت حساب", "acct.create": "ساخت حساب", "acct.logout": "خروج از حساب",
      "acct.name": "نام و تخلص", "acct.phone": "شماره تماس یا ایمیل", "acct.pass": "رمز عبور",
      "acct.exists": "این حساب قبلاً ساخته شده است.", "acct.bad": "اطلاعات ورود درست نیست.",
      "acct.created": "حساب شما ساخته و تأیید شد ✓", "acct.hi": "خوش آمدید",
      "acct.need": "برای ادامه لطفاً همه‌ی خانه‌ها را پر کنید.",
      "acct.fullname": "نام مکمل", "acct.phoneNum": "شماره تماس", "acct.email": "ایمیل",
      "acct.sendCode": "ارسال کد تأیید", "acct.codeSent": "کد تأیید به ایمیل شما فرستاده شد. آن را وارد کنید.",
      "acct.code": "کد تأیید", "acct.verify": "تأیید و ساخت حساب", "acct.resend": "ارسال دوباره‌ی کد",
      "acct.badCode": "کد وارد‌شده درست نیست.", "acct.needAll": "نام، شماره تماس، ایمیل و رمز را وارد کنید.",
      "acct.badEmail": "یک ایمیل معتبر وارد کنید.", "acct.emailExists": "این ایمیل قبلاً ثبت شده است.",
      "acct.sending": "در حال ارسال کد...", "acct.sendFail": "ارسال ایمیل ناموفق بود. دوباره تلاش کنید.",
      "acct.demoNote": "حالت آزمایشی: کد تأیید شما {code} است. برای ارسال واقعی ایمیل، تنظیمات EmailJS را در پنل مدیریت کامل کنید.",
      "order.customer": "مشتری", "order.addr": "آدرس", "order.note": "توضیحات",
      "order.header": "سلام، می‌خواهم این کالاها را سفارش بدهم:",
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
      "footer.phone": "+93 791 505 454", "footer.email": "info@maho.example",
      "footer.map": "View on map →",
      "footer.copyPre": "©", "footer.copy": "MAHO — All rights reserved.",
      "footer.made": "Made with ❤ for MAHO customers",
      "toast.cart": "“{name}” added to your cart ({n})",
      "toast.news": "You're subscribed to the newsletter ✓",
      "form.err": "Please enter a valid email address.",
      "form.ok": "You're subscribed! You'll soon receive MAHO's special offers.",
      "lang.other": "دری",
      "cart.title": "Your cart", "cart.empty": "Your cart is empty.",
      "cart.total": "Total", "cart.checkout": "Order via WhatsApp",
      "cart.clear": "Clear cart", "cart.remove": "Remove", "cart.emptyToast": "Your cart is empty.",
      "qv.add": "Add to cart",
      "qv.size": "Size", "qv.color": "Color", "qv.pick": "Please select size and color.",
      "cart.continue": "Checkout →",
      "co.back": "← Back to cart", "co.title": "Order details",
      "co.name": "Full name *", "co.phone": "Phone *", "co.address": "Delivery address *", "co.note": "Notes (optional)",
      "co.err": "Please enter your name, phone and address.",
      "acct.login": "Log in", "acct.signup": "Sign up", "acct.create": "Create account", "acct.logout": "Log out",
      "acct.name": "Full name", "acct.phone": "Phone or email", "acct.pass": "Password",
      "acct.exists": "This account already exists.", "acct.bad": "Incorrect login details.",
      "acct.created": "Your account was created & verified ✓", "acct.hi": "Welcome",
      "acct.need": "Please fill in all fields to continue.",
      "acct.fullname": "Full name", "acct.phoneNum": "Phone number", "acct.email": "Email",
      "acct.sendCode": "Send verification code", "acct.codeSent": "A verification code was sent to your email. Enter it below.",
      "acct.code": "Verification code", "acct.verify": "Verify & create account", "acct.resend": "Resend code",
      "acct.badCode": "The code is incorrect.", "acct.needAll": "Enter your name, phone, email and password.",
      "acct.badEmail": "Enter a valid email address.", "acct.emailExists": "This email is already registered.",
      "acct.sending": "Sending code...", "acct.sendFail": "Sending the email failed. Please try again.",
      "acct.demoNote": "Demo mode: your verification code is {code}. To send real emails, configure EmailJS in the admin panel.",
      "order.customer": "Customer", "order.addr": "Address", "order.note": "Notes",
      "order.header": "Hello, I'd like to order these items:",
    },
  };
  const t = (key) => (I18N[LANG] && I18N[LANG][key]) || I18N.fa[key] || key;

  /* -------------------- Data -------------------- */
  const CAT_ICON = { clothing: "dress", scarf: "scarf", bagshoes: "bag", beauty: "sparkles", accessory: "ring" };

  let PRODUCTS = [
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

  let STORES = [
    {
      name: "لباس و لوازم بانوان MAHO", name_en: "MAHO Women's Clothing & Essentials",
      area: "نمایندگی مبارک سنتر، منزل چهارم، دوکان نمبر ۷۴ و ۷۵، کوته سنگی، کابل، افغانستان",
      area_en: "Mubarak Center, 4th floor, shop no. 74 & 75, Kote Sangi, Kabul, Afghanistan",
      hours: "شنبه تا پنجشنبه، ۹ صبح تا ۸ شب", hours_en: "Sat–Thu, 9:00 AM – 8:00 PM",
      phone: "‪+93 791 505 454‬", phone_en: "+93 791 505 454",
      whatsapp: "93791505454",
      map: "https://maps.app.goo.gl/U6miPMFLBSY6woFo6",
      emailjs: { serviceId: "", templateId: "", publicKey: "" },
    },
  ];

  /* -------------------- Catalog data source --------------------
     Priority: owner's local draft (admin panel) > published data.json > built-in defaults.
     This lets the owner manage the catalog with no code changes. */
  const DATA_KEY = "maho_admin_data";
  function applyData(d) {
    if (d && Array.isArray(d.products) && d.products.length) PRODUCTS = d.products;
    if (d && d.store) STORES = [d.store];
  }
  let hasLocalDraft = false;
  try {
    const raw = localStorage.getItem(DATA_KEY);
    if (raw) { applyData(JSON.parse(raw)); hasLocalDraft = true; }
  } catch (_) {}

  /* -------------------- Render products -------------------- */
  let activeFilter = "all";
  const productGrid = $("#productGrid");
  function renderProducts() {
    if (!productGrid) return;
    productGrid.innerHTML = PRODUCTS.map((p, i) => {
      const badgeText = LANG === "en" ? (p.badgeText_en || p.badgeText) : p.badgeText;
      const badge = p.badge
        ? `<span class="product-badge ${p.badge === "new" ? "new" : ""}">${badgeText}</span>`
        : "";
      const old = p.old ? `<del>${money(p.old)}</del>` : "";
      const name = LANG === "en" ? (p.name_en || p.name) : p.name;
      const imgs = productImages(p);
      const media = imgs.length
        ? `<img src="${imgs[0]}" alt="${name}" loading="lazy">`
        : icon(p.icon || CAT_ICON[p.cat] || "bag");
      return `
        <article class="product-card" data-cat="${p.cat}" data-idx="${i}" role="button" tabindex="0">
          <div class="product-media m-${p.cat}">${badge}${media}</div>
          <div class="product-body">
            <span class="cat">${CAT_LABEL[LANG][p.cat]}</span>
            <h3>${name}</h3>
            <div class="product-foot">
              <span class="price">${money(p.price)} ${old}</span>
              <button class="icon-btn" type="button" data-addcart aria-label="${LANG === "en" ? "Add to cart" : "افزودن به سبد خرید"}">${icon("bag")}</button>
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

  /* -------------------- Product helpers (images / variants) -------------------- */
  function productImages(p) { return Array.isArray(p.images) && p.images.length ? p.images : (p.image ? [p.image] : []); }
  function productSizes(p) { return Array.isArray(p.sizes) ? p.sizes.filter(Boolean) : []; }
  function productColors(p) { return Array.isArray(p.colors) ? p.colors.filter(Boolean) : []; }
  function colorName(v) { return String(v).split("|")[0].trim(); }

  /* -------------------- Cart -------------------- */
  const CART_KEY = "maho_cart";
  let CART = [];
  try { const raw = localStorage.getItem(CART_KEY); if (raw) CART = JSON.parse(raw) || []; } catch (_) {}
  const saveCart = () => { try { localStorage.setItem(CART_KEY, JSON.stringify(CART)); } catch (_) {} };
  const cartQtyTotal = () => CART.reduce((s, it) => s + it.qty, 0);
  const cartPriceTotal = () => CART.reduce((s, it) => s + it.price * it.qty, 0);

  function addToCart(p, qty, size, color) {
    qty = Math.max(1, qty || 1);
    size = size || ""; color = color || "";
    const key = p.name + "|" + size + "|" + color;
    const found = CART.find((it) => it.key === key);
    if (found) found.qty += qty;
    else CART.push({ key: key, name: p.name, name_en: p.name_en, price: p.price, cat: p.cat, image: productImages(p)[0] || "", icon: p.icon || "", size: size, color: color, qty: qty });
    saveCart(); updateCartBadge(); renderCart();
    const nm = LANG === "en" ? (p.name_en || p.name) : p.name;
    showToast(t("toast.cart").replace("{name}", nm).replace("{n}", toDigits(cartQtyTotal())));
  }
  function changeQty(key, delta) {
    const it = CART.find((x) => x.key === key); if (!it) return;
    it.qty += delta;
    if (it.qty <= 0) CART = CART.filter((x) => x.key !== key);
    saveCart(); updateCartBadge(); renderCart();
  }
  function removeItem(key) { CART = CART.filter((x) => x.key !== key); saveCart(); updateCartBadge(); renderCart(); }

  const cartCountEl = $("#cartCount");
  function updateCartBadge() {
    if (!cartCountEl) return;
    const n = cartQtyTotal();
    cartCountEl.textContent = toDigits(n);
    cartCountEl.classList.toggle("empty", n === 0);
  }
  function variantLabel(it) {
    const parts = [];
    if (it.size) parts.push(t("qv.size") + ": " + it.size);
    if (it.color) parts.push(t("qv.color") + ": " + colorName(it.color));
    return parts.join(" · ");
  }
  const cartItemsEl = $("#cartItems");
  const cartTotalEl = $("#cartTotal");
  const cartTotal2El = $("#cartTotal2");
  const cartFootEl = $("#cartFoot");
  function renderCart() {
    if (!cartItemsEl) return;
    const total = money(cartPriceTotal());
    if (cartTotalEl) cartTotalEl.textContent = total;
    if (cartTotal2El) cartTotal2El.textContent = total;
    if (!CART.length) {
      cartItemsEl.innerHTML = `<p class="cart-empty">${t("cart.empty")}</p>`;
      if (cartFootEl) cartFootEl.style.display = "none";
      return;
    }
    if (cartFootEl) cartFootEl.style.display = "flex";
    cartItemsEl.innerHTML = CART.map((it) => {
      const nm = LANG === "en" ? (it.name_en || it.name) : it.name;
      const media = it.image ? `<img src="${it.image}" alt="">` : icon(it.icon || CAT_ICON[it.cat] || "bag");
      const variant = variantLabel(it) ? `<span class="ci-variant">${variantLabel(it)}</span>` : "";
      return `
        <div class="cart-item">
          <div class="ci-media">${media}</div>
          <div class="ci-info">
            <b>${nm}</b>
            ${variant}
            <span class="ci-price">${money(it.price)} × ${toDigits(it.qty)} = <b>${money(it.price * it.qty)}</b></span>
            <button class="ci-remove" data-remove="${it.key}">${t("cart.remove")}</button>
          </div>
          <div class="qty sm">
            <button type="button" data-dec="${it.key}" aria-label="-">−</button>
            <input value="${toDigits(it.qty)}" readonly aria-label="تعداد">
            <button type="button" data-inc="${it.key}" aria-label="+">+</button>
          </div>
        </div>`;
    }).join("");
  }

  /* product grid: click card = quick view, click bag = add (open quick view if it has options) */
  if (productGrid) {
    productGrid.addEventListener("click", (e) => {
      const card = e.target.closest(".product-card");
      if (!card) return;
      const p = PRODUCTS[parseInt(card.dataset.idx, 10)];
      if (!p) return;
      if (e.target.closest("[data-addcart]")) {
        if (productSizes(p).length || productColors(p).length) openQuickView(p);
        else addToCart(p, 1, "", "");
        return;
      }
      openQuickView(p);
    });
    productGrid.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const card = e.target.closest(".product-card"); if (!card) return;
      e.preventDefault();
      const p = PRODUCTS[parseInt(card.dataset.idx, 10)]; if (p) openQuickView(p);
    });
  }

  /* cart drawer + checkout steps */
  const cartOverlay = $("#cartOverlay");
  const screenItems = $("#screenItems");
  const screenCheckout = $("#screenCheckout");
  function showScreen(which) {
    if (screenItems) screenItems.hidden = which !== "items";
    if (screenCheckout) screenCheckout.hidden = which !== "checkout";
  }
  function openCart() { renderCart(); showScreen("items"); if (cartOverlay) cartOverlay.classList.add("show"); }
  function closeCart() { if (cartOverlay) cartOverlay.classList.remove("show"); }
  const cartBtn = $("#cartBtn"); if (cartBtn) cartBtn.addEventListener("click", openCart);
  const cartClose = $("#cartClose"); if (cartClose) cartClose.addEventListener("click", closeCart);
  if (cartOverlay) cartOverlay.addEventListener("click", (e) => { if (e.target === cartOverlay) closeCart(); });
  if (cartItemsEl) cartItemsEl.addEventListener("click", (e) => {
    const inc = e.target.closest("[data-inc]"), dec = e.target.closest("[data-dec]"), rm = e.target.closest("[data-remove]");
    if (inc) changeQty(inc.getAttribute("data-inc"), 1);
    else if (dec) changeQty(dec.getAttribute("data-dec"), -1);
    else if (rm) removeItem(rm.getAttribute("data-remove"));
  });
  const cartClear = $("#cartClear"); if (cartClear) cartClear.addEventListener("click", () => { CART = []; saveCart(); updateCartBadge(); renderCart(); });

  const toCheckoutBtn = $("#toCheckout");
  if (toCheckoutBtn) toCheckoutBtn.addEventListener("click", () => {
    if (!CART.length) { showToast(t("cart.emptyToast")); return; }
    const s = getSession();
    if (s) { if ($("#co_name")) $("#co_name").value = $("#co_name").value || s.name || ""; if ($("#co_phone")) $("#co_phone").value = $("#co_phone").value || s.phone || s.id || ""; }
    if ($("#coMsg")) $("#coMsg").textContent = "";
    showScreen("checkout");
  });
  const backToCartBtn = $("#backToCart");
  if (backToCartBtn) backToCartBtn.addEventListener("click", () => showScreen("items"));

  function waNumber() {
    let s = (STORES[0] && (STORES[0].whatsapp || STORES[0].phone)) || "";
    s = toEnDigits(s).replace(/[^0-9]/g, "");
    if (!s) return "";
    if (s.charAt(0) === "0") s = "93" + s.slice(1);
    return s;
  }
  const placeOrderBtn = $("#placeOrder");
  if (placeOrderBtn) placeOrderBtn.addEventListener("click", () => {
    if (!CART.length) { showToast(t("cart.emptyToast")); return; }
    const nm = ($("#co_name") && $("#co_name").value.trim()) || "";
    const ph = ($("#co_phone") && $("#co_phone").value.trim()) || "";
    const ad = ($("#co_address") && $("#co_address").value.trim()) || "";
    const note = ($("#co_note") && $("#co_note").value.trim()) || "";
    if (!nm || !ph || !ad) { if ($("#coMsg")) $("#coMsg").textContent = t("co.err"); return; }
    const lines = CART.map((it) => {
      const inm = LANG === "en" ? (it.name_en || it.name) : it.name;
      const v = variantLabel(it) ? " (" + variantLabel(it) + ")" : "";
      return "• " + inm + v + " × " + toDigits(it.qty) + " = " + money(it.price * it.qty);
    });
    const msg = t("order.header") + "\n\n" + lines.join("\n") +
      "\n\n" + t("cart.total") + ": " + money(cartPriceTotal()) +
      "\n\n" + t("order.customer") + ": " + nm + "\n" + t("acct.phone") + ": " + ph +
      "\n" + t("order.addr") + ": " + ad + (note ? "\n" + t("order.note") + ": " + note : "");
    window.open("https://wa.me/" + waNumber() + "?text=" + encodeURIComponent(msg), "_blank");
  });

  /* -------------------- Quick view (gallery + size/color) -------------------- */
  const qvOverlay = $("#qvOverlay");
  let qvProduct = null, qvQty = 1, qvSize = "", qvColor = "";
  const qvQtyEl = $("#qvQty");
  function setQvQty(n) { qvQty = Math.max(1, n); if (qvQtyEl) qvQtyEl.value = toDigits(qvQty); }
  function qvShowImage(src, alt, cat) {
    const media = $("#qvMedia");
    media.className = "qv-media m-" + cat;
    media.innerHTML = src ? `<img src="${src}" alt="${alt}">` : icon((qvProduct && qvProduct.icon) || CAT_ICON[cat] || "bag");
  }
  function openQuickView(p) {
    qvProduct = p; qvSize = ""; qvColor = ""; setQvQty(1);
    const nm = LANG === "en" ? (p.name_en || p.name) : p.name;
    const imgs = productImages(p);
    qvShowImage(imgs[0] || "", nm, p.cat);
    const thumbs = $("#qvThumbs");
    if (imgs.length > 1) {
      thumbs.hidden = false;
      thumbs.innerHTML = imgs.map((src, i) => `<img src="${src}" alt="" data-i="${i}" class="${i === 0 ? "active" : ""}">`).join("");
    } else { thumbs.hidden = true; thumbs.innerHTML = ""; }
    $("#qvCat").textContent = CAT_LABEL[LANG][p.cat] || "";
    $("#qvName").textContent = nm;
    $("#qvPrice").innerHTML = money(p.price) + (p.old ? ` <del>${money(p.old)}</del>` : "");
    // sizes
    const sizes = productSizes(p), colors = productColors(p);
    const sizesWrap = $("#qvSizesWrap"), colorsWrap = $("#qvColorsWrap");
    if (sizes.length) { sizesWrap.hidden = false; $("#qvSizes").innerHTML = sizes.map((s) => `<button type="button" class="opt-chip" data-size="${s}">${s}</button>`).join(""); }
    else { sizesWrap.hidden = true; $("#qvSizes").innerHTML = ""; }
    if (colors.length) {
      colorsWrap.hidden = false;
      $("#qvColors").innerHTML = colors.map((c) => {
        const nmc = colorName(c), hex = (String(c).split("|")[1] || "").trim();
        const sw = hex ? `<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${hex};margin-inline-end:6px;border:1px solid #0002;vertical-align:-1px"></span>` : "";
        return `<button type="button" class="opt-chip" data-color="${nmc}">${sw}${nmc}</button>`;
      }).join("");
    } else { colorsWrap.hidden = true; $("#qvColors").innerHTML = ""; }
    if ($("#qvMsg")) { $("#qvMsg").textContent = ""; $("#qvMsg").className = "qv-msg"; }
    if (qvOverlay) qvOverlay.classList.add("show");
  }
  function closeQuickView() { if (qvOverlay) qvOverlay.classList.remove("show"); }
  const qvThumbsEl = $("#qvThumbs");
  if (qvThumbsEl) qvThumbsEl.addEventListener("click", (e) => {
    const img = e.target.closest("img[data-i]"); if (!img || !qvProduct) return;
    const imgs = productImages(qvProduct);
    qvShowImage(imgs[parseInt(img.dataset.i, 10)], "", qvProduct.cat);
    $$("img", qvThumbsEl).forEach((x) => x.classList.remove("active"));
    img.classList.add("active");
  });
  const qvSizesEl = $("#qvSizes");
  if (qvSizesEl) qvSizesEl.addEventListener("click", (e) => { const c = e.target.closest("[data-size]"); if (!c) return; $$(".opt-chip", qvSizesEl).forEach((x) => x.classList.remove("active")); c.classList.add("active"); qvSize = c.dataset.size; });
  const qvColorsEl = $("#qvColors");
  if (qvColorsEl) qvColorsEl.addEventListener("click", (e) => { const c = e.target.closest("[data-color]"); if (!c) return; $$(".opt-chip", qvColorsEl).forEach((x) => x.classList.remove("active")); c.classList.add("active"); qvColor = c.dataset.color; });
  const qvClose = $("#qvClose"); if (qvClose) qvClose.addEventListener("click", closeQuickView);
  if (qvOverlay) qvOverlay.addEventListener("click", (e) => { if (e.target === qvOverlay) closeQuickView(); });
  const qvPlus = $("#qvPlus"); if (qvPlus) qvPlus.addEventListener("click", () => setQvQty(qvQty + 1));
  const qvMinus = $("#qvMinus"); if (qvMinus) qvMinus.addEventListener("click", () => setQvQty(qvQty - 1));
  if (qvQtyEl) qvQtyEl.addEventListener("input", () => { const n = parseInt(toEnDigits(qvQtyEl.value).replace(/[^0-9]/g, ""), 10); qvQty = isNaN(n) ? 1 : Math.max(1, n); });
  const qvAdd = $("#qvAdd");
  if (qvAdd) qvAdd.addEventListener("click", () => {
    if (!qvProduct) return;
    const needSize = productSizes(qvProduct).length && !qvSize;
    const needColor = productColors(qvProduct).length && !qvColor;
    if (needSize || needColor) { if ($("#qvMsg")) { $("#qvMsg").textContent = t("qv.pick"); $("#qvMsg").className = "qv-msg"; } return; }
    addToCart(qvProduct, qvQty, qvSize, qvColor);
    closeQuickView();
  });

  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeQuickView(); closeCart(); closeAcct(); } });

  /* -------------------- Accounts (client-side) -------------------- */
  const USERS_KEY = "maho_users", SESS_KEY = "maho_session";
  const getUsers = () => { try { return JSON.parse(localStorage.getItem(USERS_KEY)) || []; } catch (_) { return []; } };
  const saveUsers = (u) => { try { localStorage.setItem(USERS_KEY, JSON.stringify(u)); } catch (_) {} };
  const getSession = () => { try { return JSON.parse(localStorage.getItem(SESS_KEY)); } catch (_) { return null; } };
  const setSession = (s) => { try { s ? localStorage.setItem(SESS_KEY, JSON.stringify(s)) : localStorage.removeItem(SESS_KEY); } catch (_) {} };
  const acctOverlay = $("#acctOverlay");
  function renderAccount() {
    const s = getSession();
    const out = $("#acctLoggedOut"), inn = $("#acctLoggedIn");
    if (!out || !inn) return;
    if (s) {
      out.hidden = true; inn.hidden = false;
      $("#acctName").textContent = s.name || "";
      $("#acctId").textContent = s.id || "";
      $("#acctAvatar").textContent = (s.name || "M").trim().charAt(0).toUpperCase();
    } else { out.hidden = false; inn.hidden = true; }
  }
  function openAcct() { renderAccount(); if (acctOverlay) acctOverlay.classList.add("show"); }
  function closeAcct() { if (acctOverlay) acctOverlay.classList.remove("show"); }
  const accountBtn = $("#accountBtn"); if (accountBtn) accountBtn.addEventListener("click", openAcct);
  const acctClose = $("#acctClose"); if (acctClose) acctClose.addEventListener("click", closeAcct);
  if (acctOverlay) acctOverlay.addEventListener("click", (e) => { if (e.target === acctOverlay) closeAcct(); });
  const tabLogin = $("#tabLogin"), tabSignup = $("#tabSignup");
  function showSignupStep(step) { // 'form' | 'verify'
    if ($("#signupPane")) $("#signupPane").hidden = step !== "form";
    if ($("#verifyPane")) $("#verifyPane").hidden = step !== "verify";
  }
  function selectTab(login) {
    if (tabLogin) tabLogin.classList.toggle("active", login);
    if (tabSignup) tabSignup.classList.toggle("active", !login);
    if ($("#loginPane")) $("#loginPane").hidden = !login;
    if ($("#signupPane")) $("#signupPane").hidden = login;
    if ($("#verifyPane")) $("#verifyPane").hidden = true;
    if ($("#acctMsg")) { $("#acctMsg").textContent = ""; $("#acctMsg").className = "qv-msg"; }
  }
  if (tabLogin) tabLogin.addEventListener("click", () => selectTab(true));
  if (tabSignup) tabSignup.addEventListener("click", () => selectTab(false));
  function acctMsg(text, ok) { const m = $("#acctMsg"); if (m) { m.textContent = text; m.className = "qv-msg" + (ok ? " ok" : ""); } }

  const emailCfg = () => (STORES[0] && STORES[0].emailjs) || {};
  const genCode = () => String(Math.floor(100000 + Math.random() * 900000));
  function sendCode(email, name, code) {
    const cfg = emailCfg();
    if (cfg.serviceId && cfg.templateId && cfg.publicKey && typeof emailjs !== "undefined") {
      return emailjs.send(cfg.serviceId, cfg.templateId,
        { to_email: email, email: email, to_name: name, passcode: code, code: code },
        { publicKey: cfg.publicKey }
      ).then(() => ({ sent: true }));
    }
    return Promise.resolve({ sent: false, code: code }); // demo (no email service configured)
  }
  let pendingSignup = null;
  const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

  const signupBtn = $("#signupBtn");
  if (signupBtn) signupBtn.addEventListener("click", () => {
    const name = ($("#su_name").value || "").trim();
    const phone = ($("#su_phone").value || "").trim();
    const email = ($("#su_email").value || "").trim();
    const pass = ($("#su_pass").value || "").trim();
    if (!name || !phone || !email || !pass) { acctMsg(t("acct.needAll")); return; }
    if (!emailOk(email)) { acctMsg(t("acct.badEmail")); return; }
    const users = getUsers();
    if (users.some((u) => (u.email || u.id || "").toLowerCase() === email.toLowerCase())) { acctMsg(t("acct.emailExists")); return; }
    const code = genCode();
    pendingSignup = { name: name, phone: phone, email: email, pass: pass, code: code };
    acctMsg(t("acct.sending"), true);
    sendCode(email, name, code).then((res) => {
      showSignupStep("verify");
      if (res.sent) acctMsg(t("acct.codeSent"), true);
      else acctMsg(t("acct.demoNote").replace("{code}", code), true);
    }).catch(() => { acctMsg(t("acct.sendFail")); });
  });

  const verifyBtn = $("#verifyBtn");
  if (verifyBtn) verifyBtn.addEventListener("click", () => {
    if (!pendingSignup) return;
    const entered = toEnDigits(($("#vf_code").value || "").trim()).replace(/[^0-9]/g, "");
    if (entered !== pendingSignup.code) { acctMsg(t("acct.badCode")); return; }
    const users = getUsers();
    users.push({ name: pendingSignup.name, phone: pendingSignup.phone, email: pendingSignup.email, id: pendingSignup.email, pass: pendingSignup.pass, verified: true });
    saveUsers(users);
    setSession({ name: pendingSignup.name, id: pendingSignup.email, email: pendingSignup.email, phone: pendingSignup.phone });
    const nm = pendingSignup.name; pendingSignup = null;
    if ($("#vf_code")) $("#vf_code").value = "";
    renderAccount(); acctMsg(t("acct.created"), true); showToast(t("acct.hi") + "، " + nm);
  });
  const resendBtn = $("#resendBtn");
  if (resendBtn) resendBtn.addEventListener("click", () => {
    if (!pendingSignup) return;
    pendingSignup.code = genCode();
    acctMsg(t("acct.sending"), true);
    sendCode(pendingSignup.email, pendingSignup.name, pendingSignup.code).then((res) => {
      if (res.sent) acctMsg(t("acct.codeSent"), true);
      else acctMsg(t("acct.demoNote").replace("{code}", pendingSignup.code), true);
    }).catch(() => { acctMsg(t("acct.sendFail")); });
  });

  const loginBtn = $("#loginBtn");
  if (loginBtn) loginBtn.addEventListener("click", () => {
    const id = ($("#lg_id").value || "").trim(), pass = ($("#lg_pass").value || "").trim();
    const u = getUsers().find((x) => pass === x.pass && [x.email, x.phone, x.id].some((v) => v && v.toLowerCase() === id.toLowerCase()));
    if (!u) { acctMsg(t("acct.bad")); return; }
    setSession({ name: u.name, id: u.email || u.id, email: u.email, phone: u.phone }); renderAccount();
    acctMsg(t("acct.hi") + "، " + u.name, true); showToast(t("acct.hi") + "، " + u.name);
  });
  const logoutBtn = $("#logoutBtn");
  if (logoutBtn) logoutBtn.addEventListener("click", () => { setSession(null); selectTab(true); renderAccount(); });

  /* category cards -> filter + scroll to products */
  const catGrid = document.querySelector(".cat-grid");
  function gotoFilter(filter) {
    const chip = document.querySelector('.chip[data-filter="' + filter + '"]');
    if (chip) { $$(".chip", filterBar).forEach((c) => c.classList.remove("active")); chip.classList.add("active"); }
    applyFilter(filter);
    const sec = document.querySelector("#products");
    if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  if (catGrid) {
    catGrid.addEventListener("click", (e) => { const c = e.target.closest(".cat-card"); if (c && c.dataset.filter) gotoFilter(c.dataset.filter); });
    catGrid.addEventListener("keydown", (e) => { if (e.key !== "Enter" && e.key !== " ") return; const c = e.target.closest(".cat-card"); if (c && c.dataset.filter) { e.preventDefault(); gotoFilter(c.dataset.filter); } });
  }

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
    renderCart();
    updateCartBadge();
    renderAccount();
    formatCounters();
    updateYear();
    const label = $("#langLabel");
    if (label) label.textContent = t("lang.other");
  }
  const langToggle = $("#langToggle");
  if (langToggle) langToggle.addEventListener("click", () => applyLang(LANG === "fa" ? "en" : "fa"));

  /* -------------------- Init -------------------- */
  applyLang(LANG);

  /* Load the published catalog (data.json) unless the owner has a local draft.
     Fails silently when opened from a single file (file://) — defaults are used. */
  if (!hasLocalDraft) {
    fetch("data.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && Array.isArray(d.products) && d.products.length) {
          applyData(d);
          renderProducts();
          renderStores();
        }
      })
      .catch(() => {});
  }
})();
