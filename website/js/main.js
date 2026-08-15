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
      "header.portal": "پنل مدیریت",
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
      "review.write": "نوشتن نظر", "review.submit": "ثبت نظر", "review.rate": "امتیاز شما",
      "review.ph": "نظر خود را درباره‌ی خرید یا خدمات بنویسید...",
      "review.loginFirst": "برای نوشتن نظر، ابتدا وارد حساب کاربری شوید.",
      "review.thanks": "از نظر شما سپاسگزاریم ✓",
      "review.needText": "لطفاً امتیاز و متن نظر را وارد کنید.",
      "review.empty": "هنوز نظری ثبت نشده است. اولین نفری باشید که نظر می‌دهد!",
      "review.customer": "مشتری MAHO",
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
      "stock.out": "ناموجود", "stock.left": "{n} دانه باقی مانده", "stock.max": "بیشتر از موجودی نمی‌توانید سفارش دهید.",
      "qv.add": "افزودن به سبد",
      "qv.size": "سایز", "qv.color": "رنگ", "qv.pick": "لطفاً سایز و رنگ را انتخاب کنید.",
      "cart.continue": "تکمیل سفارش ←",
      "co.back": "→ بازگشت به سبد", "co.title": "مشخصات سفارش",
      "co.name": "نام و تخلص *", "co.phone": "نمبر تماس *", "co.address": "آدرس تحویل *", "co.note": "توضیحات (اختیاری)",
      "co.err": "لطفاً نام، نمبر تماس و آدرس را وارد کنید.",
      "acct.login": "ورود", "acct.signup": "ساخت حساب", "acct.create": "ساخت حساب", "acct.logout": "خروج از حساب",
      "acct.name": "نام و تخلص", "acct.phone": "نمبر تماس یا ایمیل", "acct.pass": "پسورد",
      "acct.exists": "این حساب قبلاً ساخته شده است.", "acct.bad": "اطلاعات ورود درست نیست.",
      "acct.created": "حساب شما ساخته و تایید شد ✓", "acct.hi": "خوش آمدید",
      "acct.need": "برای ادامه لطفاً همه‌ی خانه‌ها را پر کنید.",
      "acct.fullname": "نام مکمل", "acct.phoneNum": "نمبر تماس", "acct.email": "ایمیل",
      "acct.sendCode": "ارسال کود تایید", "acct.codeSent": "کود تایید به ایمیل شما فرستاده شد. آن را وارد کنید.",
      "acct.code": "کود تایید", "acct.verify": "تایید و ساخت حساب", "acct.resend": "ارسال دوباره‌ی کود",
      "acct.badCode": "کود وارد‌شده درست نیست.", "acct.needAll": "نام، نمبر تماس، ایمیل و پسورد را وارد کنید.",
      "acct.badEmail": "یک ایمیل معتبر وارد کنید.", "acct.emailExists": "این ایمیل قبلاً ثبت شده است.",
      "acct.sending": "در حال ارسال کود...", "acct.sendFail": "ارسال ایمیل ناموفق بود. دوباره تلاش کنید.",
      "acct.demoNote": "حالت آزمایشی: کود تایید شما {code} است. برای ارسال واقعی ایمیل، تنظیمات EmailJS را در پنل مدیریت کامل کنید.",
      "order.customer": "مشتری", "order.addr": "آدرس", "order.note": "توضیحات",
      "order.header": "سلام، می‌خواهم این کالاها را سفارش بدهم:",
      "co.payment": "روش پرداخت",
      "pay.whatsapp": "سفارش از طریق واتساپ (پرداخت هنگام تحویل)",
      "pay.bank": "انتقال / پرداخت بانکی", "pay.card": "پرداخت آنلاین با کارت",
      "pay.bankInfo": "مبلغ را به حساب زیر انتقال دهید و رسید را در واتساپ بفرستید:",
      "pay.holder": "به نام", "pay.bankName": "بانک", "pay.accountNo": "نمبر حساب / کارت",
      "pay.noBank": "اطلاعات حساب بانکی هنوز ثبت نشده است. لطفاً از واتساپ استفاده کنید.",
      "pay.noCard": "درگاه پرداخت آنلاین هنوز تنظیم نشده است. لطفاً از واتساپ یا انتقال بانکی استفاده کنید.",
      "pay.placeWhatsapp": "ثبت سفارش (واتساپ)", "pay.payCard": "پرداخت با کارت ←", "pay.placeBank": "ثبت سفارش و نمایش حساب",
      "pay.hesab": "پرداخت با حساب پی (HesabPay)",
      "pay.hesabInfo": "با حساب پی پرداخت کنید و رسید را در واتساپ بفرستید:",
      "pay.hesabNumber": "نمبر/آی‌دی حساب پی", "pay.hesabOpen": "پرداخت با حساب پی ←",
      "pay.noHesab": "پرداخت با حساب پی هنوز تنظیم نشده است. لطفاً از واتساپ یا انتقال بانکی استفاده کنید.",
      "order.placed": "سفارش شما ثبت شد ✓",
      "orders.title": "سفارشات من", "orders.empty": "هنوز سفارشی ثبت نکرده‌اید.",
      "orders.date": "تاریخ", "orders.pay": "پرداخت", "orders.items": "کالاها",
      "status.pending": "در انتظار تایید", "status.awaitPay": "در انتظار پرداخت",
      "status.confirmed": "تایید شده",
      "status.cancelled": "لغو شده", "status.returnReq": "درخواست برگشت",
      "orders.cancel": "لغو سفارش", "orders.return": "درخواست برگشت", "orders.code": "کود کالا",
      "orders.confirmCancel": "این سفارش لغو شود؟", "orders.confirmReturn": "درخواست برگشت این سفارش ثبت شود؟",
      "orders.cancelMsg": "سفارش لغو شد", "orders.returnMsg": "درخواست برگشت کالا",
      "acct.custNo": "نمبر مشتری", "acct.profile": "مشخصات من", "acct.savedInfo": "معلومات پرداخت",
      "acct.newPass": "پسورد جدید (برای تغییر پر کنید)", "acct.saveProfile": "ذخیره تغییرات",
      "acct.saved": "تغییرات ذخیره شد ✓",
      "acct.emailChangeCode": "برای تغییر ایمیل، کود فرستاده‌شده به ایمیل جدید را وارد کنید.",
      "acct.verifyNewEmail": "تایید ایمیل جدید", "acct.emailUpdated": "ایمیل شما به‌روزرسانی شد ✓",
      "pay.type": "نوع", "pay.tCard": "کارت بانکی", "pay.tBank": "حساب بانکی",
      "pay.add": "افزودن معلومات پرداخت", "pay.none": "هنوز معلومات پرداختی اضافه نکرده‌اید.",
      "pay.localNote": "این اطلاعات فقط روی همین دستگاه شما ذخیره می‌شود.",
      "co.email": "ایمیل (برای تایید سفارش)",
      "order.number": "نمبر سفارش", "order.emailSent": "ایمیل تایید سفارش برای شما فرستاده شد.",
      "order.emailIntro": "سفارش شما در فروشگاه MAHO ثبت شد. جزئیات:",
      "acct.address": "آدرس", "pay.cvv": "کود امنیتی (CVV)", "pay.expiry": "تاریخ انقضا (MM/YY)", "pay.cardAddr": "آدرس کارت",
      "share.copied": "لینک سایت کپی شد ✓", "share.title": "معرفی سایت", "copied": "کپی شد ✓",
      "addr.country": "کشور", "addr.province": "ولایت", "addr.district": "ولسوالی / ناحیه", "addr.area": "منطقه / ساحه", "addr.street": "کوچه / سرک", "addr.house": "نمبر خانه",
      "acct.forgot": "پسورد را فراموش کرده‌اید؟", "acct.reset": "بازیابی پسورد",
      "acct.resetSent": "کود بازیابی به ایمیل شما فرستاده شد. کود و پسورد جدید را وارد کنید.",
      "acct.newPassPh": "پسورد جدید", "acct.resetDone": "پسورد شما تغییر کرد ✓", "acct.noEmail": "این ایمیل ثبت نشده است.",
      "acct.backLogin": "→ بازگشت به ورود",
      "co.delivery": "روش دریافت", "co.pickup": "دریافت حضوری از فروشگاه", "co.deliver": "ارسال به آدرس (دلیوری)",
      "co.deliverTime": "زمان دلیوری", "co.normal": "عادی", "co.urgent": "عاجل (همان روز)",
      "co.calcDist": "محاسبه‌ی فاصله (موقعیت من)", "co.distKm": "فاصله تا نزدیک‌ترین فروشگاه", "co.km": "کیلومتر",
      "co.manualKm": "یا فاصله (کیلومتر) را دستی وارد کنید", "co.deliveryFee": "هزینه دلیوری", "co.grand": "مبلغ قابل پرداخت",
      "co.belowMin": "برای دلیوری، حداقل مبلغ سفارش {n} است. لطفاً بیشتر خرید کنید یا «دریافت حضوری» را انتخاب کنید.",
      "co.beyondMax": "دلیوری فقط تا {n} کیلومتری فروشگاه انجام می‌شود؛ آدرس شما دورتر است.",
      "co.timeslot": "زمان دریافت / تحویل",
      "co.ts0": "در اسرع وقت", "co.ts1": "امروز صبح (۹ تا ۱۲)", "co.ts2": "امروز بعد از ظهر (۱۲ تا ۴)", "co.ts3": "امروز عصر (۴ تا ۸)", "co.ts4": "فردا",
      "co.makeAccount": "ساخت حساب (اختیاری)", "co.passPh": "پسورد برای حساب جدید",
      "co.makeAccountHint": "اگر پسورد بگذارید، هنگام ثبت سفارش یک کود تایید به ایمیل شما می‌رود و پس از تایید، حساب شما ساخته می‌شود و مشخصاتش به ایمیل‌تان فرستاده می‌شود.",
      "co.enterCode": "کود تایید (به ایمیل شما فرستاده شد)", "co.verifyPlace": "تایید کود و ثبت سفارش",
      "co.acctNeedEmail": "برای ساخت حساب، یک ایمیل معتبر وارد کنید.", "co.acctExists": "این ایمیل قبلاً حساب دارد؛ لطفاً وارد شوید.",
      "co.codeSentEmail": "کود تایید به ایمیل شما فرستاده شد. آن را وارد کنید.", "co.acctCreated": "حساب شما ساخته شد ✓ نمبر مشتری: {no}",
      "acct.welcomeMsg": "حساب شما در MAHO ساخته شد. نمبر مشتری شما: {no}. با همین ایمیل و پسورد می‌توانید وارد شوید.",
      "co.free": "رایگان", "co.geoFail": "دسترسی به موقعیت ممکن نشد؛ لطفاً فاصله را دستی وارد کنید.",
      "co.noStoreCoords": "مختصات فروشگاه ثبت نشده؛ فاصله دستی وارد شود.",
      "order.deliveryTo": "ارسال به آدرس", "order.pickupAt": "دریافت حضوری",
    },
    en: {
      "nav.home": "Home", "nav.categories": "Categories", "nav.products": "Products",
      "nav.stores": "Store", "nav.about": "About", "nav.contact": "Contact",
      "header.portal": "Admin panel",
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
      "review.write": "Write a review", "review.submit": "Submit review", "review.rate": "Your rating",
      "review.ph": "Share your experience with your purchase or our service...",
      "review.loginFirst": "Please sign in to your account to write a review.",
      "review.thanks": "Thank you for your review ✓",
      "review.needText": "Please provide a rating and review text.",
      "review.empty": "No reviews yet. Be the first to share your experience!",
      "review.customer": "MAHO customer",
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
      "lang.other": "فارسی",
      "cart.title": "Your cart", "cart.empty": "Your cart is empty.",
      "cart.total": "Total", "cart.checkout": "Order via WhatsApp",
      "cart.clear": "Clear cart", "cart.remove": "Remove", "cart.emptyToast": "Your cart is empty.",
      "stock.out": "Out of stock", "stock.left": "{n} left in stock", "stock.max": "You can't order more than the available stock.",
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
      "co.payment": "Payment method",
      "pay.whatsapp": "Order via WhatsApp (pay on delivery)",
      "pay.bank": "Bank transfer / payment", "pay.card": "Pay online by card",
      "pay.bankInfo": "Please transfer the amount to the account below and send the receipt on WhatsApp:",
      "pay.holder": "Account holder", "pay.bankName": "Bank", "pay.accountNo": "Account / card number",
      "pay.noBank": "Bank account details are not set yet. Please use WhatsApp.",
      "pay.noCard": "Online payment is not set up yet. Please use WhatsApp or bank transfer.",
      "pay.placeWhatsapp": "Place order (WhatsApp)", "pay.payCard": "Pay by card →", "pay.placeBank": "Place order & show account",
      "pay.hesab": "Pay with HesabPay",
      "pay.hesabInfo": "Pay via HesabPay and send the receipt on WhatsApp:",
      "pay.hesabNumber": "HesabPay number/ID", "pay.hesabOpen": "Pay with HesabPay →",
      "pay.noHesab": "HesabPay is not set up yet. Please use WhatsApp or bank transfer.",
      "order.placed": "Your order has been placed ✓",
      "orders.title": "My orders", "orders.empty": "You have no orders yet.",
      "orders.date": "Date", "orders.pay": "Payment", "orders.items": "Items",
      "status.pending": "Pending", "status.awaitPay": "Awaiting payment",
      "status.confirmed": "Confirmed",
      "status.cancelled": "Cancelled", "status.returnReq": "Return requested",
      "orders.cancel": "Cancel order", "orders.return": "Request return", "orders.code": "Item code",
      "orders.confirmCancel": "Cancel this order?", "orders.confirmReturn": "Request a return for this order?",
      "orders.cancelMsg": "Order cancelled", "orders.returnMsg": "Return request",
      "acct.custNo": "Customer no.", "acct.profile": "My profile", "acct.savedInfo": "Payment info",
      "acct.newPass": "New password (fill to change)", "acct.saveProfile": "Save changes",
      "acct.saved": "Changes saved ✓",
      "acct.emailChangeCode": "To change your email, enter the code sent to the new address.",
      "acct.verifyNewEmail": "Verify new email", "acct.emailUpdated": "Your email was updated ✓",
      "pay.type": "Type", "pay.tCard": "Bank card", "pay.tBank": "Bank account",
      "pay.add": "Add payment info", "pay.none": "No saved payment info yet.",
      "pay.localNote": "This info is stored only on your device.",
      "co.email": "Email (for order confirmation)",
      "order.number": "Order number", "order.emailSent": "An order confirmation email was sent to you.",
      "order.emailIntro": "Your order at MAHO is confirmed. Details:",
      "acct.address": "Address", "pay.cvv": "Security code (CVV)", "pay.expiry": "Expiry (MM/YY)", "pay.cardAddr": "Card address",
      "share.copied": "Site link copied ✓", "share.title": "Check out this store", "copied": "Copied ✓",
      "addr.country": "Country", "addr.province": "Province", "addr.district": "District", "addr.area": "Area / Zone", "addr.street": "Street", "addr.house": "House no.",
      "acct.forgot": "Forgot password?", "acct.reset": "Reset password",
      "acct.resetSent": "A reset code was sent to your email. Enter the code and a new password.",
      "acct.newPassPh": "New password", "acct.resetDone": "Your password was changed ✓", "acct.noEmail": "This email is not registered.",
      "acct.backLogin": "← Back to login",
      "co.delivery": "Receiving method", "co.pickup": "Pick up at the store", "co.deliver": "Deliver to my address",
      "co.deliverTime": "Delivery time", "co.normal": "Normal", "co.urgent": "Same-day (urgent)",
      "co.calcDist": "Calculate distance (my location)", "co.distKm": "Distance to nearest store", "co.km": "km",
      "co.manualKm": "Or enter distance (km) manually", "co.deliveryFee": "Delivery fee", "co.grand": "Amount payable",
      "co.belowMin": "For delivery, the minimum order is {n}. Please add more items or choose in-store pickup.",
      "co.beyondMax": "Delivery is only available within {n} km of the store; your address is farther.",
      "co.timeslot": "Pickup / delivery time",
      "co.ts0": "As soon as possible", "co.ts1": "Today morning (9–12)", "co.ts2": "Today afternoon (12–4)", "co.ts3": "Today evening (4–8)", "co.ts4": "Tomorrow",
      "co.makeAccount": "Create an account (optional)", "co.passPh": "Password for your new account",
      "co.makeAccountHint": "If you set a password, a verification code is emailed to you when you place the order; after verifying, your account is created and its details are emailed to you.",
      "co.enterCode": "Verification code (sent to your email)", "co.verifyPlace": "Verify code & place order",
      "co.acctNeedEmail": "Enter a valid email to create an account.", "co.acctExists": "This email already has an account; please sign in.",
      "co.codeSentEmail": "A verification code was sent to your email. Enter it below.", "co.acctCreated": "Your account was created ✓ Customer no: {no}",
      "acct.welcomeMsg": "Your MAHO account has been created. Your customer number: {no}. You can sign in with this email and password.",
      "co.free": "Free", "co.geoFail": "Couldn't get your location; please enter the distance manually.",
      "co.noStoreCoords": "Store coordinates not set; enter distance manually.",
      "order.deliveryTo": "Deliver to address", "order.pickupAt": "Pickup",
    },
  };
  const t = (key) => (I18N[LANG] && I18N[LANG][key]) || I18N.fa[key] || key;

  /* -------------------- Data -------------------- */
  const CAT_ICON = { clothing: "dress", scarf: "scarf", bagshoes: "bag", beauty: "sparkles", accessory: "ring" };

  let PRODUCTS = [
    { name: "پیراهن مجلسی بلند", name_en: "Long Evening Dress", cat: "clothing", icon: "dress", code: "DRS-001", stock: 10, price: 4200, old: 5000, badge: "sale", badgeText: "۱۶٪ تخفیف", badgeText_en: "16% off" },
    { name: "مانتو کژوال روزمره", name_en: "Casual Manteau", cat: "clothing", icon: "coat", code: "MNT-002", stock: 8, price: 3200, badge: "new", badgeText: "جدید", badgeText_en: "New" },
    { name: "بلوز و شومیز آستین‌بلند", name_en: "Long-sleeve Blouse", cat: "clothing", icon: "shirt", code: "BLZ-003", stock: 20, price: 1450 },
    { name: "شال نخی طرح‌دار", name_en: "Patterned Cotton Shawl", cat: "scarf", icon: "scarf", code: "SHL-004", stock: 5, price: 650, badge: "new", badgeText: "جدید", badgeText_en: "New" },
    { name: "روسری ابریشمی", name_en: "Silk Headscarf", cat: "scarf", icon: "scarf", code: "RSR-005", stock: 12, price: 1200, old: 1350, badge: "sale", badgeText: "۱۰٪ تخفیف", badgeText_en: "10% off" },
    { name: "کیف دستی چرم", name_en: "Leather Handbag", cat: "bagshoes", icon: "bag", code: "KIF-006", stock: 6, price: 2800 },
    { name: "کفش پاشنه‌بلند مجلسی", name_en: "Evening High Heels", cat: "bagshoes", icon: "heel", code: "KFS-007", stock: 5, price: 3100, old: 3900, badge: "sale", badgeText: "۲۰٪ تخفیف", badgeText_en: "20% off" },
    { name: "کفش تخت راحتی", name_en: "Comfort Flats", cat: "bagshoes", icon: "heel", code: "KFS-008", stock: 15, price: 1900 },
    { name: "ست لوازم آرایش", name_en: "Makeup Set", cat: "beauty", icon: "sparkles", code: "ARZ-009", stock: 9, price: 2500, badge: "new", badgeText: "جدید", badgeText_en: "New" },
    { name: "عطر زنانه لوکس", name_en: "Luxury Women's Perfume", cat: "beauty", icon: "perfume", code: "ATR-010", stock: 7, price: 3900, old: 4400, badge: "sale", badgeText: "۱۲٪ تخفیف", badgeText_en: "12% off" },
    { name: "ست گردنبند و دستبند", name_en: "Necklace & Bracelet Set", cat: "accessory", icon: "ring", code: "AKS-011", stock: 11, price: 1650 },
    { name: "ساعت مچی زنانه", name_en: "Women's Wristwatch", cat: "accessory", icon: "watch", code: "AKS-012", stock: 4, price: 3600, badge: "new", badgeText: "جدید", badgeText_en: "New" },
  ];
  const CAT_LABEL = {
    fa: { clothing: "پوشاک", scarf: "شال و روسری", bagshoes: "کیف و کفش", beauty: "آرایشی و بهداشتی", accessory: "اکسسوری" },
    en: { clothing: "Clothing", scarf: "Scarves", bagshoes: "Bags & Shoes", beauty: "Beauty", accessory: "Accessories" },
  };
  const DEFAULT_CATS = [
    { key: "clothing", name: "پوشاک", name_en: "Clothing", icon: "dress" },
    { key: "scarf", name: "شال و روسری", name_en: "Scarves", icon: "scarf" },
    { key: "bagshoes", name: "کیف و کفش", name_en: "Bags & Shoes", icon: "bag" },
    { key: "beauty", name: "آرایشی و بهداشتی", name_en: "Beauty", icon: "sparkles" },
    { key: "accessory", name: "اکسسوری", name_en: "Accessories", icon: "ring" },
  ];
  const DEFAULT_SHOWCASE = [
    { title: "لباس مجلسی", title_en: "Evening dresses", sub: "پیراهن و کالای شب", sub_en: "Dresses & eveningwear", icon: "dress", filter: "clothing" },
    { title: "مانتو و پالتو", title_en: "Manteaus & coats", sub: "روزمره و رسمی", sub_en: "Casual & formal", icon: "coat", filter: "clothing" },
    { title: "بلوز و شومیز", title_en: "Blouses & tops", sub: "مدل‌های متنوع", sub_en: "Many styles", icon: "shirt", filter: "clothing" },
    { title: "شال و روسری", title_en: "Scarves & shawls", sub: "نخی و ابریشمی", sub_en: "Cotton & silk", icon: "scarf", filter: "scarf" },
    { title: "کیف زنانه", title_en: "Handbags", sub: "دستی و مجلسی", sub_en: "Everyday & evening", icon: "bag", filter: "bagshoes" },
    { title: "کفش زنانه", title_en: "Women's shoes", sub: "پاشنه‌بلند و تخت", sub_en: "Heels & flats", icon: "heel", filter: "bagshoes" },
    { title: "اکسسوری و بدلیجات", title_en: "Accessories & jewelry", sub: "گردنبند، دستبند و ساعت", sub_en: "Necklaces, bracelets & watches", icon: "ring", filter: "accessory" },
    { title: "آرایشی و بهداشتی", title_en: "Beauty & care", sub: "لوازم آرایش و عطر", sub_en: "Makeup & perfume", icon: "sparkles", filter: "beauty" },
  ];

  let STORES = [
    {
      name: "لباس و لوازم بانوان MAHO", name_en: "MAHO Women's Clothing & Essentials",
      area: "نمایندگی مبارک سنتر، منزل چهارم، دوکان نمبر ۷۴ و ۷۵، کوته سنگی، کابل، افغانستان",
      area_en: "Mubarak Center, 4th floor, shop no. 74 & 75, Kote Sangi, Kabul, Afghanistan",
      hours: "شنبه تا پنجشنبه، ۹ صبح تا ۸ شب", hours_en: "Sat–Thu, 9:00 AM – 8:00 PM",
      phone: "‪+93 791 505 454‬", phone_en: "+93 791 505 454",
      map: "https://maps.app.goo.gl/U6miPMFLBSY6woFo6",
    },
  ];
  let CONFIG = {
    categories: DEFAULT_CATS.slice(), showcase: DEFAULT_SHOWCASE.slice(),
    whatsapp: "93791505454", logo: "", heroImage: "", orderApproval: "manual",
    bank: { holder: "", name: "", number: "" }, paymentLink: "",
    hesab: { link: "", number: "" },
    delivery: { enabled: true, perKm: 10, freeKm: 0, urgentFee: 100, minOrder: 0, maxKm: 0 },
    emailjs: { serviceId: "", templateId: "", orderTemplateId: "", welcomeTemplateId: "", publicKey: "" },
  };

  /* -------------------- Catalog data source --------------------
     Priority: owner's local draft (admin panel) > published data.json > built-in defaults. */
  const DATA_KEY = "maho_admin_data";
  function normalizeData(d) {
    d = d || {};
    const products = Array.isArray(d.products) ? d.products : null;
    let stores = Array.isArray(d.stores) ? d.stores : (d.store ? [d.store] : null);
    let config = Object.assign({}, d.config || {});
    if (d.store) { // migrate legacy single-store config
      if (config.whatsapp == null) config.whatsapp = d.store.whatsapp;
      if (config.bank == null) config.bank = d.store.bank;
      if (config.paymentLink == null) config.paymentLink = d.store.paymentLink;
      if (config.emailjs == null) config.emailjs = d.store.emailjs;
    }
    return { products: products, stores: stores, config: config };
  }
  function applyData(d) {
    const n = normalizeData(d);
    if (n.products && n.products.length) PRODUCTS = n.products;
    if (n.stores && n.stores.length) STORES = n.stores;
    if (n.config) {
      CONFIG = Object.assign({}, CONFIG, n.config);
      CONFIG.bank = Object.assign({ holder: "", name: "", number: "" }, n.config.bank || CONFIG.bank);
      CONFIG.hesab = Object.assign({ link: "", number: "" }, n.config.hesab || CONFIG.hesab);
      CONFIG.delivery = Object.assign({ enabled: true, perKm: 10, freeKm: 0, urgentFee: 100, minOrder: 0, maxKm: 0 }, n.config.delivery || CONFIG.delivery);
      CONFIG.emailjs = Object.assign({ serviceId: "", templateId: "", orderTemplateId: "", welcomeTemplateId: "", publicKey: "" }, n.config.emailjs || CONFIG.emailjs);
      const cats = (n.config.categories || []).filter((c) => c && c.key && (c.name || c.name_en));
      CONFIG.categories = cats.length ? cats : (CONFIG.categories && CONFIG.categories.length ? CONFIG.categories : DEFAULT_CATS.slice());
      const sc = (n.config.showcase || []).filter((x) => x && (x.title || x.title_en));
      CONFIG.showcase = sc.length ? sc : (CONFIG.showcase && CONFIG.showcase.length ? CONFIG.showcase : DEFAULT_SHOWCASE.slice());
    }
  }
  function getCats() { return (Array.isArray(CONFIG.categories) && CONFIG.categories.length) ? CONFIG.categories : DEFAULT_CATS; }
  function catObj(key) { return getCats().find((c) => c.key === key); }
  function catLabel(key) { const c = catObj(key); if (c) return (LANG === "en" ? (c.name_en || c.name) : c.name) || key; return (CAT_LABEL[LANG] && CAT_LABEL[LANG][key]) || key; }
  function catIcon(key) { const c = catObj(key); return (c && c.icon) || CAT_ICON[key] || "bag"; }
  let hasLocalDraft = false;
  try {
    const raw = localStorage.getItem(DATA_KEY);
    if (raw) { applyData(JSON.parse(raw)); hasLocalDraft = true; }
  } catch (_) {}

  /* -------------------- Inventory helpers -------------------- */
  const LOW_STOCK = 5;
  function productStock(p) { if (p.stock == null || p.stock === "") return Infinity; const n = parseInt(p.stock, 10); return isNaN(n) ? Infinity : n; }

  /* -------------------- Render products -------------------- */
  let activeFilter = "all";
  const productGrid = $("#productGrid");
  function renderProducts() {
    if (!productGrid) return;
    productGrid.innerHTML = PRODUCTS.map((p, i) => {
      const badgeText = LANG === "en" ? (p.badgeText_en || p.badgeText) : p.badgeText;
      const disc = prodDiscount(p);
      const badge = disc
        ? `<span class="product-badge">${LANG === "en" ? (toDigits(disc) + "% off") : (toDigits(disc) + "٪ تخفیف")}</span>`
        : (p.badge ? `<span class="product-badge ${p.badge === "new" ? "new" : ""}">${badgeText}</span>` : "");
      const orig = origPrice(p);
      const old = orig ? `<del>${money(orig)}</del>` : "";
      const name = LANG === "en" ? (p.name_en || p.name) : p.name;
      const imgs = productImages(p);
      const media = imgs.length
        ? `<img src="${imgs[0]}" alt="${name}" loading="lazy">`
        : icon(p.icon || catIcon(p.cat));
      const stock = productStock(p);
      const out = stock <= 0;
      const low = stock > 0 && stock <= LOW_STOCK;
      const outOverlay = out ? `<span class="out-overlay">${t("stock.out")}</span>` : "";
      const stockNote = low ? `<span class="stock-note low">${t("stock.left").replace("{n}", toDigits(stock))}</span>`
        : (out ? `<span class="stock-note out">${t("stock.out")}</span>` : "");
      return `
        <article class="product-card${out ? " out" : ""}" data-cat="${p.cat}" data-idx="${i}" role="button" tabindex="0">
          <div class="product-media m-${p.cat}">${badge}${outOverlay}${media}</div>
          <div class="product-body">
            <span class="cat">${catLabel(p.cat)}</span>
            <h3>${name}</h3>
            ${stockNote}
            <div class="product-foot">
              <span class="price">${money(effPrice(p))} ${old}</span>
              <button class="icon-btn" type="button" data-addcart ${out ? "disabled" : ""} aria-label="${LANG === "en" ? "Add to cart" : "افزودن به سبد خرید"}">${icon("bag")}</button>
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
    storeGrid.className = "store-grid" + (STORES.length <= 1 ? " single" : "");
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
          <div class="store-row"><span class="ico">${icon("call")}</span><a class="contact-link" href="${telHref(phone)}" dir="ltr">${phone}</a></div>
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
  function renderShowcase() {
    const grid = document.querySelector(".cat-grid");
    if (!grid) return;
    const items = (Array.isArray(CONFIG.showcase) && CONFIG.showcase.length ? CONFIG.showcase : DEFAULT_SHOWCASE).filter((x) => x && (x.title || x.title_en));
    grid.innerHTML = items.map((x) => {
      const title = LANG === "en" ? (x.title_en || x.title) : x.title;
      const sub = LANG === "en" ? (x.sub_en || x.sub) : x.sub;
      const f = x.filter || "all";
      return `<div class="cat-card in" data-filter="${f}" role="button" tabindex="0"><div class="ico">${icon(x.icon || "bag")}</div><h3>${title || ""}</h3><p>${sub || ""}</p></div>`;
    }).join("");
  }
  const filterBar = $("#filterBar");
  function renderFilters() {
    if (!filterBar) return;
    const cats = getCats().filter((c) => c.name || c.name_en);
    const chip = (f, label) => `<button class="chip${activeFilter === f ? " active" : ""}" data-filter="${f}">${label}</button>`;
    filterBar.innerHTML = chip("all", t("filter.all")) + cats.map((c) => chip(c.key, LANG === "en" ? (c.name_en || c.name) : c.name)).join("");
  }
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
  function prodDiscount(p) { const d = parseFloat(p && p.discount); return (isFinite(d) && d > 0) ? Math.min(95, d) : 0; }
  function effPrice(p) { const d = prodDiscount(p); return d > 0 ? Math.round((p.price || 0) * (1 - d / 100)) : (p.price || 0); }
  function origPrice(p) { const d = prodDiscount(p); return d > 0 ? (p.price || 0) : (p.old || 0); }

  /* -------------------- Cart -------------------- */
  const CART_KEY = "maho_cart";
  let CART = [];
  try { const raw = localStorage.getItem(CART_KEY); if (raw) CART = JSON.parse(raw) || []; } catch (_) {}
  const saveCart = () => { try { localStorage.setItem(CART_KEY, JSON.stringify(CART)); } catch (_) {} };
  const cartQtyTotal = () => CART.reduce((s, it) => s + it.qty, 0);
  const cartPriceTotal = () => CART.reduce((s, it) => s + it.price * it.qty, 0);

  function cartQtyForName(name) { return CART.filter((it) => it.name === name).reduce((s, it) => s + it.qty, 0); }
  function addToCart(p, qty, size, color) {
    qty = Math.max(1, qty || 1);
    const stock = productStock(p);
    if (stock <= 0) { showToast(t("stock.out")); return; }
    if (cartQtyForName(p.name) + qty > stock) { showToast(t("stock.max")); return; }
    size = size || ""; color = color || "";
    const key = p.name + "|" + size + "|" + color;
    const found = CART.find((it) => it.key === key);
    if (found) found.qty += qty;
    else CART.push({ key: key, name: p.name, name_en: p.name_en, price: effPrice(p), code: p.code || "", cat: p.cat, image: productImages(p)[0] || "", icon: p.icon || "", size: size, color: color, qty: qty });
    saveCart(); updateCartBadge(); renderCart();
    const nm = LANG === "en" ? (p.name_en || p.name) : p.name;
    showToast(t("toast.cart").replace("{name}", nm).replace("{n}", toDigits(cartQtyTotal())));
  }
  function changeQty(key, delta) {
    const it = CART.find((x) => x.key === key); if (!it) return;
    if (delta > 0) {
      const p = PRODUCTS.find((x) => x.name === it.name);
      const stock = p ? productStock(p) : Infinity;
      if (cartQtyForName(it.name) + 1 > stock) { showToast(t("stock.max")); return; }
    }
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
      const media = it.image ? `<img src="${it.image}" alt="">` : icon(it.icon || catIcon(it.cat));
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

  /* -------------------- address helpers -------------------- */
  function composeAddress(a) {
    a = a || {}; const parts = [];
    const line1 = [a.house, a.street].filter(Boolean).join(" "); if (line1) parts.push(line1);
    if (a.area) parts.push(a.area);
    if (a.district) parts.push(a.district); if (a.province) parts.push(a.province); if (a.country) parts.push(a.country);
    return parts.join("، ");
  }
  function readAddr(prefix) { const g = (id) => { const el = $("#" + prefix + "_" + id); return el ? el.value.trim() : ""; }; return { country: g("country"), province: g("province"), district: g("district"), area: g("area"), street: g("street"), house: g("house") }; }
  function fillAddr(prefix, a) { a = a || {}; const s = (id, v) => { const el = $("#" + prefix + "_" + id); if (el) el.value = v || ""; }; s("country", a.country || "افغانستان"); s("province", a.province); s("district", a.district); s("area", a.area); s("street", a.street); s("house", a.house); }

  /* -------------------- delivery -------------------- */
  let recvMethod = "pickup", deliverTime = "normal", distanceKm = null;
  function haversine(la1, lo1, la2, lo2) { const R = 6371, r = Math.PI / 180; const dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r; const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2; return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); }
  // Extract lat/lng from a Google Maps link/address (supports @lat,lng / !3d!4d / q=/ll= / bare pair)
  function parseLatLng(url) {
    const s = String(url || "");
    let m = s.match(/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/)
      || s.match(/!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/)
      || s.match(/[?&](?:q|ll|sll|center|destination|daddr)=(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/)
      || s.match(/(-?\d{1,3}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})/);
    if (m) { const la = parseFloat(m[1]), lo = parseFloat(m[2]); if (isFinite(la) && isFinite(lo)) return [la, lo]; }
    return null;
  }
  function storeCoords(s) {
    const la = parseFloat(s.lat), lo = parseFloat(s.lng);
    if (isFinite(la) && isFinite(lo)) return [la, lo];
    return parseLatLng(s.map || s.mapLink || "");
  }
  function nearestStoreKm(lat, lng) { let best = null; STORES.forEach((s) => { const c = storeCoords(s); if (c) { const d = haversine(lat, lng, c[0], c[1]); if (best === null || d < best) best = d; } }); return best; }
  function currentKm() { let km = parseFloat(toEnDigits(($("#co_km") && $("#co_km").value) || "")); if (!isFinite(km) || km < 0) km = (distanceKm != null ? distanceKm : 0); return km; }
  function deliveryFee() { const cfg = CONFIG.delivery || {}; if (recvMethod !== "deliver" || !cfg.enabled) return 0; const km = currentKm(); let fee = (km <= (cfg.freeKm || 0)) ? 0 : Math.round(km) * (cfg.perKm || 0); if (deliverTime === "urgent") fee += (cfg.urgentFee || 0); return fee; }
  function deliveryMinOrder() { const cfg = CONFIG.delivery || {}; return (cfg.enabled && cfg.minOrder) ? cfg.minOrder : 0; }
  function deliveryMaxKm() { const cfg = CONFIG.delivery || {}; return (cfg.enabled && cfg.maxKm) ? cfg.maxKm : 0; }
  function belowDeliveryMin() { return recvMethod === "deliver" && deliveryMinOrder() > 0 && cartPriceTotal() < deliveryMinOrder(); }
  function beyondDeliveryMax() { const mx = deliveryMaxKm(); return recvMethod === "deliver" && mx > 0 && currentKm() > mx; }
  function deliveryBlockMsg() {
    if (recvMethod !== "deliver") return "";
    if (belowDeliveryMin()) return t("co.belowMin").replace("{n}", money(deliveryMinOrder()));
    if (beyondDeliveryMax()) return t("co.beyondMax").replace("{n}", toDigits(deliveryMaxKm()));
    return "";
  }
  function updateCheckoutTotals() {
    const items = cartPriceTotal(), fee = deliveryFee(), grand = items + fee;
    if ($("#coItemsTotal")) $("#coItemsTotal").textContent = money(items);
    const row = $("#coDeliveryRow"); if (row) row.hidden = (recvMethod !== "deliver");
    if ($("#coDeliveryFee")) $("#coDeliveryFee").textContent = fee ? money(fee) : t("co.free");
    if ($("#cartTotal2")) $("#cartTotal2").textContent = money(grand);
    const warn = $("#coMinWarn");
    if (warn) { const msg = deliveryBlockMsg(); if (msg) { warn.hidden = false; warn.textContent = msg; } else { warn.hidden = true; warn.textContent = ""; } }
  }
  const recvMethodsEl = $("#recvMethods");
  if (recvMethodsEl) recvMethodsEl.addEventListener("click", (e) => { const b = e.target.closest(".pay-method"); if (!b) return; recvMethod = b.dataset.recv; $$(".pay-method", recvMethodsEl).forEach((x) => x.classList.remove("active")); b.classList.add("active"); const box = $("#deliverBox"); if (box) box.hidden = (recvMethod !== "deliver"); updateCheckoutTotals(); });
  const deliverTimeEl = $("#deliverTime");
  if (deliverTimeEl) deliverTimeEl.addEventListener("click", (e) => { const b = e.target.closest(".pay-method"); if (!b) return; deliverTime = b.dataset.time; $$(".pay-method", deliverTimeEl).forEach((x) => x.classList.remove("active")); b.classList.add("active"); updateCheckoutTotals(); });
  const coKmEl = $("#co_km");
  if (coKmEl) coKmEl.addEventListener("input", () => { const n = parseFloat(toEnDigits(coKmEl.value)); distanceKm = isFinite(n) ? n : null; updateCheckoutTotals(); });
  const calcBtn = $("#calcDistBtn");
  if (calcBtn) calcBtn.addEventListener("click", () => {
    const di = $("#distInfo");
    if (!navigator.geolocation) { if (di) { di.hidden = false; di.textContent = t("co.geoFail"); } return; }
    calcBtn.disabled = true;
    navigator.geolocation.getCurrentPosition((pos) => {
      calcBtn.disabled = false;
      const km = nearestStoreKm(pos.coords.latitude, pos.coords.longitude);
      if (km == null) { if (di) { di.hidden = false; di.textContent = t("co.noStoreCoords"); } return; }
      distanceKm = km; if (coKmEl) coKmEl.value = toDigits(Math.round(km * 10) / 10);
      if (di) { di.hidden = false; di.textContent = t("co.distKm") + ": " + toDigits(Math.round(km * 10) / 10) + " " + t("co.km"); }
      updateCheckoutTotals();
    }, () => { calcBtn.disabled = false; if (di) { di.hidden = false; di.textContent = t("co.geoFail"); } }, { timeout: 8000 });
  });

  const toCheckoutBtn = $("#toCheckout");
  if (toCheckoutBtn) toCheckoutBtn.addEventListener("click", () => {
    if (!CART.length) { showToast(t("cart.emptyToast")); return; }
    const s = getSession();
    if (s) {
      if ($("#co_name")) $("#co_name").value = $("#co_name").value || s.name || "";
      if ($("#co_phone")) $("#co_phone").value = $("#co_phone").value || s.phone || "";
      if ($("#co_email")) $("#co_email").value = $("#co_email").value || s.email || "";
    }
    fillAddr("co", (s && s.addr) || null);
    // Guest account block only for not-logged-in customers
    const gaw = $("#guestAcctWrap"); if (gaw) gaw.hidden = !!s;
    const cvb = $("#coVerifyBox"); if (cvb) cvb.hidden = true;
    pendingCheckoutAccount = null;
    if ($("#co_pass")) $("#co_pass").value = "";
    if ($("#coMsg")) $("#coMsg").textContent = "";
    payMethod = "whatsapp";
    if (payMethodsEl) $$(".pay-method", payMethodsEl).forEach((x) => x.classList.toggle("active", x.dataset.method === "whatsapp"));
    updatePayInfo();
    // reset delivery
    recvMethod = "pickup"; deliverTime = "normal"; distanceKm = null;
    if (recvMethodsEl) $$(".pay-method", recvMethodsEl).forEach((x) => x.classList.toggle("active", x.dataset.recv === "pickup"));
    if (deliverTimeEl) $$(".pay-method", deliverTimeEl).forEach((x) => x.classList.toggle("active", x.dataset.time === "normal"));
    if ($("#deliverBox")) $("#deliverBox").hidden = true;
    if (coKmEl) coKmEl.value = ""; if ($("#distInfo")) $("#distInfo").hidden = true;
    updateCheckoutTotals();
    showScreen("checkout");
  });
  const backToCartBtn = $("#backToCart");
  if (backToCartBtn) backToCartBtn.addEventListener("click", () => showScreen("items"));

  function waNumber() {
    let s = CONFIG.whatsapp || (STORES[0] && STORES[0].phone) || "";
    s = toEnDigits(s).replace(/[^0-9]/g, "");
    if (!s) return "";
    if (s.charAt(0) === "0") s = "93" + s.slice(1);
    return s;
  }
  /* payment method selection */
  let payMethod = "whatsapp";
  const payMethodsEl = $("#payMethods");
  const payInfoEl = $("#payInfo");
  function bankInfo() { return CONFIG.bank || {}; }
  function paymentLink() { return CONFIG.paymentLink || ""; }
  function hesabInfo() { return CONFIG.hesab || {}; }
  function updatePayInfo() {
    if (!payInfoEl) return;
    const placeBtn = $("#placeOrder");
    if (payMethod === "hesab") {
      const h = hesabInfo();
      if (h.link || h.number) {
        payInfoEl.hidden = false;
        payInfoEl.innerHTML = `${t("pay.hesabInfo")}<br>` +
          (h.number ? `<b>${t("pay.hesabNumber")}:</b> <a href="#" class="copy-num" data-copy="${String(h.number).replace(/"/g, "&quot;")}" dir="ltr">${h.number}</a>` : "");
      } else { payInfoEl.hidden = false; payInfoEl.textContent = t("pay.noHesab"); }
      if (placeBtn) placeBtn.textContent = h.link ? t("pay.hesabOpen") : t("pay.placeBank");
    } else if (payMethod === "bank") {
      const b = bankInfo();
      if (b.holder || b.number || b.name) {
        payInfoEl.hidden = false;
        payInfoEl.innerHTML = `${t("pay.bankInfo")}<br>` +
          (b.holder ? `<b>${t("pay.holder")}:</b> ${b.holder}<br>` : "") +
          (b.name ? `<b>${t("pay.bankName")}:</b> ${b.name}<br>` : "") +
          (b.number ? `<b>${t("pay.accountNo")}:</b> <a href="#" class="copy-num" data-copy="${String(b.number).replace(/"/g, "&quot;")}" dir="ltr">${b.number}</a>` : "");
      } else { payInfoEl.hidden = false; payInfoEl.textContent = t("pay.noBank"); }
      if (placeBtn) placeBtn.textContent = t("pay.placeBank");
    } else if (payMethod === "card") {
      payInfoEl.hidden = false;
      payInfoEl.textContent = paymentLink() ? t("pay.card") : t("pay.noCard");
      if (placeBtn) placeBtn.textContent = t("pay.payCard");
    } else {
      payInfoEl.hidden = true; payInfoEl.textContent = "";
      if (placeBtn) placeBtn.textContent = t("pay.placeWhatsapp");
    }
  }
  if (payMethodsEl) payMethodsEl.addEventListener("click", (e) => {
    const b = e.target.closest(".pay-method"); if (!b) return;
    payMethod = b.dataset.method;
    $$(".pay-method", payMethodsEl).forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    updatePayInfo();
  });
  if (payInfoEl) payInfoEl.addEventListener("click", (e) => {
    const a = e.target.closest(".copy-num"); if (!a) return;
    e.preventDefault();
    const val = a.getAttribute("data-copy") || a.textContent || "";
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(val).then(() => showToast(t("copied"))).catch(() => {}); }
    else { try { prompt("", val); } catch (_) {} }
  });

  /* orders storage */
  const ORDERS_KEY = "maho_orders";
  const getOrders = () => { try { return JSON.parse(localStorage.getItem(ORDERS_KEY)) || []; } catch (_) { return []; } };
  const saveOrders = (o) => { try { localStorage.setItem(ORDERS_KEY, JSON.stringify(o)); } catch (_) {} };
  function recordOrder(customer, method, status, delivery) {
    const orders = getOrders();
    const itemsTotal = cartPriceTotal();
    const fee = (delivery && delivery.fee) || 0;
    const order = {
      id: "MAHO-" + Date.now().toString().slice(-6),
      date: Date.now(),
      items: CART.map((it) => ({ name: it.name, name_en: it.name_en, code: it.code || "", price: it.price, qty: it.qty, size: it.size, color: it.color })),
      itemsTotal: itemsTotal, deliveryFee: fee, total: itemsTotal + fee,
      delivery: delivery || null, customerNo: (customer && customer.customerNo) || "",
      customer: customer, payment: method, status: status,
    };
    orders.unshift(order);
    saveOrders(orders);
    return order;
  }
  function persistCatalog() { try { localStorage.setItem(DATA_KEY, JSON.stringify({ products: PRODUCTS, stores: STORES, config: CONFIG })); } catch (_) {} }
  function adjustStock(items, sign) {
    let changed = false;
    (items || []).forEach((it) => {
      const p = PRODUCTS.find((x) => x.name === it.name);
      if (!p) return;
      const cur = productStock(p);
      if (isFinite(cur)) { p.stock = Math.max(0, cur + sign * it.qty); changed = true; }
    });
    if (changed) { persistCatalog(); renderProducts(); }
  }
  function orderSummaryText(order) {
    const lines = order.items.map((it) => {
      const inm = LANG === "en" ? (it.name_en || it.name) : it.name;
      const v = [];
      if (it.size) v.push(t("qv.size") + " " + it.size);
      if (it.color) v.push(t("qv.color") + " " + colorName(it.color));
      const vs = v.length ? " (" + v.join("، ") + ")" : "";
      return "• " + inm + vs + " × " + toDigits(it.qty) + " = " + money(it.price * it.qty);
    });
    return lines.join("\n") + "\n" + t("cart.total") + ": " + money(order.total);
  }
  function sendOrderEmail(order, email, name) {
    const cfg = CONFIG.emailjs || {};
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && cfg.serviceId && cfg.orderTemplateId && cfg.publicKey && typeof emailjs !== "undefined") {
      emailjs.send(cfg.serviceId, cfg.orderTemplateId,
        { to_email: email, email: email, to_name: name || "", order_no: order.id, order_summary: orderSummaryText(order), order_total: money(order.total) },
        { publicKey: cfg.publicKey }
      ).catch(() => {});
      return true;
    }
    return false;
  }
  function orderMessage(order) {
    const lines = order.items.map((it) => {
      const inm = LANG === "en" ? (it.name_en || it.name) : it.name;
      const v = [];
      if (it.size) v.push(t("qv.size") + " " + it.size);
      if (it.color) v.push(t("qv.color") + " " + colorName(it.color));
      const vs = v.length ? " (" + v.join("، ") + ")" : "";
      const code = it.code ? " [" + it.code + "]" : "";
      return "• " + inm + vs + code + " × " + toDigits(it.qty) + " = " + money(it.price * it.qty);
    });
    const c = order.customer || {};
    const payLabel = order.payment === "bank" ? t("pay.bank") : order.payment === "card" ? t("pay.card") : order.payment === "hesab" ? t("pay.hesab") : t("pay.whatsapp");
    const d = order.delivery || {};
    const recvLine = d.method === "deliver"
      ? "\n" + t("co.delivery") + ": " + t("order.deliveryTo") + (d.time === "urgent" ? " (" + t("co.urgent") + ")" : "") + " — " + t("co.deliveryFee") + ": " + (order.deliveryFee ? money(order.deliveryFee) : t("co.free"))
      : "\n" + t("co.delivery") + ": " + t("order.pickupAt");
    const timeLine = d.timeslot ? "\n" + t("co.timeslot") + ": " + d.timeslot : "";
    return t("order.header") + "\n" + t("order.number") + ": " + order.id + "\n\n" + lines.join("\n") +
      "\n\n" + t("cart.total") + ": " + money(order.total) +
      "\n\n" + t("order.customer") + ": " + (c.name || "") + (c.customerNo ? " (" + c.customerNo + ")" : "") +
      "\n" + t("acct.phone") + ": " + (c.phone || "") +
      "\n" + t("order.addr") + ": " + (c.address || "") + recvLine + timeLine + (c.note ? "\n" + t("order.note") + ": " + c.note : "") +
      "\n" + t("co.payment") + ": " + payLabel;
  }
  function selectedTimeslot() {
    const sel = $("#co_timeslot"); if (!sel) return { key: "", label: "" };
    const opt = sel.options[sel.selectedIndex];
    return { key: sel.value, label: opt ? opt.textContent : "" };
  }
  function sendAccountInfo(email, name, customerNo) {
    const cfg = CONFIG.emailjs || {};
    if (email && cfg.serviceId && cfg.welcomeTemplateId && cfg.publicKey && typeof emailjs !== "undefined") {
      emailjs.send(cfg.serviceId, cfg.welcomeTemplateId,
        { to_email: email, email: email, to_name: name || "", customer_no: customerNo, message: t("acct.welcomeMsg").replace("{no}", customerNo) },
        { publicKey: cfg.publicKey }
      ).catch(() => {});
      return true;
    }
    return false;
  }
  function createGuestAccount(p) {
    const users = getUsers();
    const customerNo = nextCustomerNo();
    users.push({ name: p.name, phone: p.phone, email: p.email, address: p.address || "", addr: p.addr || {}, id: p.email, pass: p.pass, verified: true, customerNo: customerNo, payments: [] });
    saveUsers(users);
    setSession({ name: p.name, id: p.email, email: p.email, phone: p.phone, address: p.address || "", addr: p.addr || {}, customerNo: customerNo });
    sendAccountInfo(p.email, p.name, customerNo);
    return customerNo;
  }
  // Actually place the order using the currently selected payment method.
  function finalizeOrder(customer, delivery) {
    let order;
    if (payMethod === "hesab") {
      const h = hesabInfo();
      if (!h.link && !h.number) { if ($("#coMsg")) $("#coMsg").textContent = t("pay.noHesab"); return null; }
      order = recordOrder(customer, "hesab", t("status.awaitPay"), delivery);
      if (h.link) window.open(h.link, "_blank");
      window.open("https://wa.me/" + waNumber() + "?text=" + encodeURIComponent(orderMessage(order)), "_blank");
    } else if (payMethod === "card") {
      const link = paymentLink();
      if (!link) { if ($("#coMsg")) $("#coMsg").textContent = t("pay.noCard"); return null; }
      order = recordOrder(customer, "card", t("status.awaitPay"), delivery);
      window.open(link, "_blank");
      window.open("https://wa.me/" + waNumber() + "?text=" + encodeURIComponent(orderMessage(order)), "_blank");
    } else if (payMethod === "bank") {
      order = recordOrder(customer, "bank", t("status.awaitPay"), delivery);
      window.open("https://wa.me/" + waNumber() + "?text=" + encodeURIComponent(orderMessage(order)), "_blank");
    } else {
      const st = CONFIG.orderApproval === "auto" ? t("status.confirmed") : t("status.pending");
      order = recordOrder(customer, "whatsapp", st, delivery);
      window.open("https://wa.me/" + waNumber() + "?text=" + encodeURIComponent(orderMessage(order)), "_blank");
    }
    adjustStock(order.items, -1);
    const emailed = sendOrderEmail(order, customer.email, customer.name);
    CART = []; saveCart(); updateCartBadge(); renderCart();
    showToast(t("order.placed") + " · " + t("order.number") + " " + order.id + (emailed ? " · " + t("order.emailSent") : ""));
    closeCart(); openOrders();
    return order;
  }
  let pendingCheckoutAccount = null;
  function readCheckout() {
    const nm = ($("#co_name") && $("#co_name").value.trim()) || "";
    const ph = ($("#co_phone") && $("#co_phone").value.trim()) || "";
    const addrParts = readAddr("co");
    const ad = composeAddress(addrParts);
    const note = ($("#co_note") && $("#co_note").value.trim()) || "";
    const email = ($("#co_email") && $("#co_email").value.trim()) || "";
    const ts = selectedTimeslot();
    return { nm, ph, addrParts, ad, note, email, ts };
  }
  const placeOrderBtn = $("#placeOrder");
  if (placeOrderBtn) placeOrderBtn.addEventListener("click", () => {
    if (!CART.length) { showToast(t("cart.emptyToast")); return; }
    const f = readCheckout();
    if (!f.nm || !f.ph || (recvMethod === "deliver" && !f.ad)) { if ($("#coMsg")) $("#coMsg").textContent = t("co.err"); return; }
    const delBlock = deliveryBlockMsg(); if (delBlock) { if ($("#coMsg")) $("#coMsg").textContent = delBlock; return; }
    if ($("#coMsg")) $("#coMsg").textContent = "";
    const s = getSession();
    const customer = { name: f.nm, phone: f.ph, address: f.ad, addr: f.addrParts, note: f.note, email: f.email, customerNo: (s && s.customerNo) || "" };
    const delivery = { method: recvMethod, time: deliverTime, km: currentKm(), fee: deliveryFee(), timeslot: f.ts.label, timeslotKey: f.ts.key };

    // Guest wants to create an account (password provided, not logged in) -> verify by email code first.
    const pass = ($("#co_pass") && $("#co_pass").value.trim()) || "";
    if (!s && pass) {
      if (!emailOk(f.email)) { if ($("#coMsg")) $("#coMsg").textContent = t("co.acctNeedEmail"); return; }
      if (getUsers().some((u) => (u.email || u.id || "").toLowerCase() === f.email.toLowerCase())) { if ($("#coMsg")) $("#coMsg").textContent = t("co.acctExists"); return; }
      const code = genCode();
      pendingCheckoutAccount = { code: code, name: f.nm, phone: f.ph, email: f.email, pass: pass, addr: f.addrParts, address: f.ad, customer: customer, delivery: delivery };
      const box = $("#coVerifyBox"); if (box) box.hidden = false;
      const vm = $("#coVerifyMsg");
      sendCode(f.email, f.nm, code).then((res) => {
        if (vm) { vm.className = "qv-msg ok"; vm.textContent = res.sent ? t("co.codeSentEmail") : t("acct.demoNote").replace("{code}", code); }
        const ce = $("#co_acct_code"); if (ce) ce.focus();
      }).catch(() => { if (vm) { vm.className = "qv-msg"; vm.textContent = t("acct.sendFail"); } });
      return;
    }
    finalizeOrder(customer, delivery);
  });
  const coVerifyBtn = $("#coVerifyBtn");
  if (coVerifyBtn) coVerifyBtn.addEventListener("click", () => {
    if (!pendingCheckoutAccount) return;
    const entered = toEnDigits(($("#co_acct_code") && $("#co_acct_code").value || "").trim()).replace(/[^0-9]/g, "");
    const vm = $("#coVerifyMsg");
    if (entered !== pendingCheckoutAccount.code) { if (vm) { vm.className = "qv-msg"; vm.textContent = t("acct.badCode"); } return; }
    const p = pendingCheckoutAccount;
    const customerNo = createGuestAccount(p);
    const customer = Object.assign({}, p.customer, { customerNo: customerNo });
    pendingCheckoutAccount = null;
    if ($("#co_acct_code")) $("#co_acct_code").value = "";
    if ($("#co_pass")) $("#co_pass").value = "";
    const box = $("#coVerifyBox"); if (box) box.hidden = true;
    renderAccount();
    showToast(t("co.acctCreated").replace("{no}", customerNo));
    finalizeOrder(customer, p.delivery);
  });

  /* My Orders */
  const ordersOverlay = $("#ordersOverlay");
  let barcodeSeq = 0;
  function renderOrders() {
    const list = $("#ordersList"); if (!list) return;
    const orders = getOrders();
    if (!orders.length) { list.innerHTML = `<p class="orders-empty">${t("orders.empty")}</p>`; return; }
    const pending = [];
    list.innerHTML = orders.map((o) => {
      const items = o.items.map((it) => {
        const inm = LANG === "en" ? (it.name_en || it.name) : it.name;
        const variant = [];
        if (it.size) variant.push(t("qv.size") + " " + it.size);
        if (it.color) variant.push(t("qv.color") + " " + colorName(it.color));
        const vs = variant.length ? " — " + variant.join("، ") : "";
        let bc = "";
        if (it.code) {
          const bid = "bc" + (++barcodeSeq);
          pending.push({ id: bid, code: it.code });
          bc = `<div class="bc-wrap"><span class="bc-code">${t("orders.code")}: ${it.code}</span><svg class="barcode" id="${bid}"></svg></div>`;
        }
        return `<li>${inm}${vs} × ${toDigits(it.qty)} = ${money(it.price * it.qty)}${bc}</li>`;
      }).join("");
      const d = new Date(o.date);
      const dateStr = d.toLocaleDateString(LANG === "en" ? "en-US" : "fa-AF") + " " + d.toLocaleTimeString(LANG === "en" ? "en-US" : "fa-AF", { hour: "2-digit", minute: "2-digit" });
      const payLabel = o.payment === "bank" ? t("pay.bank") : o.payment === "card" ? t("pay.card") : o.payment === "hesab" ? t("pay.hesab") : t("pay.whatsapp");
      const closed = o.status === t("status.cancelled") || o.status === t("status.returnReq");
      const actions = closed ? "" : `<div class="order-actions"><button class="btn btn-outline btn-sm" data-return="${o.id}">${t("orders.return")}</button><button class="btn btn-danger-sm" data-cancel="${o.id}">${t("orders.cancel")}</button></div>`;
      return `
        <div class="order-card">
          <div class="order-top">
            <span>#${o.id} · ${t("orders.date")}: ${dateStr}</span>
            <span class="order-status">${o.status || ""}</span>
          </div>
          <ul>${items}</ul>
          <div class="order-top">
            <span>${t("orders.pay")}: ${payLabel}</span>
            <span class="order-total">${t("cart.total")}: ${money(o.total)}</span>
          </div>
          ${actions}
        </div>`;
    }).join("");
    if (typeof JsBarcode !== "undefined") {
      pending.forEach((b) => { try { JsBarcode("#" + b.id, b.code, { format: "CODE128", width: 1.6, height: 38, fontSize: 12, margin: 4 }); } catch (_) {} });
    }
  }
  function openOrders() { renderOrders(); if (ordersOverlay) ordersOverlay.classList.add("show"); }
  function closeOrders() { if (ordersOverlay) ordersOverlay.classList.remove("show"); }
  const ordersBtn = $("#ordersBtn"); if (ordersBtn) ordersBtn.addEventListener("click", () => { closeAcct(); openOrders(); });
  const ordersBtnAll = $("#ordersBtnAll"); if (ordersBtnAll) ordersBtnAll.addEventListener("click", () => { closeAcct(); openOrders(); });
  const ordersClose = $("#ordersClose"); if (ordersClose) ordersClose.addEventListener("click", closeOrders);
  if (ordersOverlay) ordersOverlay.addEventListener("click", (e) => { if (e.target === ordersOverlay) closeOrders(); });
  const ordersListEl = $("#ordersList");
  if (ordersListEl) ordersListEl.addEventListener("click", (e) => {
    const cancelBtn = e.target.closest("[data-cancel]"), returnBtn = e.target.closest("[data-return]");
    if (cancelBtn) {
      const id = cancelBtn.getAttribute("data-cancel");
      if (!confirm(t("orders.confirmCancel"))) return;
      const orders = getOrders(); const o = orders.find((x) => x.id === id); if (!o) return;
      o.status = t("status.cancelled"); saveOrders(orders);
      adjustStock(o.items, 1);
      window.open("https://wa.me/" + waNumber() + "?text=" + encodeURIComponent(t("orders.cancelMsg") + " — " + t("order.number") + ": " + o.id), "_blank");
      renderOrders();
    } else if (returnBtn) {
      const id = returnBtn.getAttribute("data-return");
      if (!confirm(t("orders.confirmReturn"))) return;
      const orders = getOrders(); const o = orders.find((x) => x.id === id); if (!o) return;
      o.status = t("status.returnReq"); saveOrders(orders);
      window.open("https://wa.me/" + waNumber() + "?text=" + encodeURIComponent(t("orders.returnMsg") + " — " + t("order.number") + ": " + o.id), "_blank");
      renderOrders();
    }
  });

  /* -------------------- Quick view (gallery + size/color) -------------------- */
  const qvOverlay = $("#qvOverlay");
  let qvProduct = null, qvQty = 1, qvSize = "", qvColor = "", qvStock = Infinity;
  const qvQtyEl = $("#qvQty");
  function setQvQty(n) { n = Math.max(1, n); if (n > qvStock) n = Math.max(1, qvStock); qvQty = n; if (qvQtyEl) qvQtyEl.value = toDigits(qvQty); }
  function qvShowImage(src, alt, cat) {
    const media = $("#qvMedia");
    media.className = "qv-media m-" + cat + (src ? " has-img" : "");
    media.innerHTML = src ? `<img src="${src}" alt="${alt}">` : icon((qvProduct && qvProduct.icon) || catIcon(cat));
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
    $("#qvCat").textContent = catLabel(p.cat) || "";
    $("#qvName").textContent = nm;
    $("#qvPrice").innerHTML = money(effPrice(p)) + (origPrice(p) ? ` <del>${money(origPrice(p))}</del>` : "");
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
    qvStock = productStock(p); setQvQty(1);
    const out = qvStock <= 0;
    const addBtn = $("#qvAdd"); if (addBtn) addBtn.disabled = out;
    if ($("#qvMsg")) {
      if (out) { $("#qvMsg").textContent = t("stock.out"); $("#qvMsg").className = "qv-msg"; }
      else if (qvStock <= LOW_STOCK) { $("#qvMsg").textContent = t("stock.left").replace("{n}", toDigits(qvStock)); $("#qvMsg").className = "qv-msg ok"; }
      else { $("#qvMsg").textContent = ""; $("#qvMsg").className = "qv-msg"; }
    }
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

  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeQuickView(); closeCart(); closeAcct(); closeOrders(); } });

  /* -------------------- Accounts (client-side) -------------------- */
  const USERS_KEY = "maho_users", SESS_KEY = "maho_session";
  const getUsers = () => { try { return JSON.parse(localStorage.getItem(USERS_KEY)) || []; } catch (_) { return []; } };
  const saveUsers = (u) => { try { localStorage.setItem(USERS_KEY, JSON.stringify(u)); } catch (_) {} };
  const getSession = () => { try { return JSON.parse(localStorage.getItem(SESS_KEY)); } catch (_) { return null; } };
  const setSession = (s) => { try { s ? localStorage.setItem(SESS_KEY, JSON.stringify(s)) : localStorage.removeItem(SESS_KEY); } catch (_) {} };
  const CUST_SEQ_KEY = "maho_cust_seq";
  function nextCustomerNo() {
    let n = 0; try { n = parseInt(localStorage.getItem(CUST_SEQ_KEY) || "0", 10) || 0; } catch (_) {}
    n += 1; try { localStorage.setItem(CUST_SEQ_KEY, String(n)); } catch (_) {}
    return "MO" + String(n).padStart(6, "0");
  }
  function findUserIndex(users, s) {
    return users.findIndex((u) => (u.email && s.email && u.email.toLowerCase() === s.email.toLowerCase()) || (u.id && s.id && u.id === s.id));
  }
  function updateUser(mutator) {
    const s = getSession(); if (!s) return null;
    const users = getUsers(); const idx = findUserIndex(users, s); if (idx < 0) return null;
    mutator(users[idx], users, idx); saveUsers(users); return users[idx];
  }
  function currentUser() {
    const s = getSession(); if (!s) return null;
    const users = getUsers(); const idx = findUserIndex(users, s); if (idx < 0) return null;
    if (!users[idx].customerNo) { users[idx].customerNo = nextCustomerNo(); saveUsers(users); }
    return users[idx];
  }
  const maskNum = (n) => { const d = toEnDigits(n).replace(/[^0-9]/g, ""); return d.length > 4 ? "•••• " + d.slice(-4) : d; };
  const acctOverlay = $("#acctOverlay");
  function renderPayList(u) {
    const list = $("#payList"); if (!list) return;
    const pays = (u && u.payments) || [];
    if (!pays.length) { list.innerHTML = `<p class="pay-none">${t("pay.none")}</p>`; return; }
    list.innerHTML = pays.map((p) => {
      const typeLabel = p.type === "bank" ? t("pay.tBank") : t("pay.tCard");
      return `<div class="pay-item"><span><b>${typeLabel}</b>${p.holder ? " — " + p.holder : ""} <span class="pi-num" dir="ltr">${maskNum(p.number)}</span></span><button type="button" data-delpay="${p.id}">${t("cart.remove")}</button></div>`;
    }).join("");
  }
  function renderAccount() {
    const s = getSession();
    const out = $("#acctLoggedOut"), inn = $("#acctLoggedIn");
    if (!out || !inn) return;
    if (s) {
      const u = currentUser() || {};
      out.hidden = true; inn.hidden = false;
      $("#acctName").textContent = u.name || s.name || "";
      $("#acctCustNo").textContent = (u.customerNo || s.customerNo) ? (t("acct.custNo") + ": " + (u.customerNo || s.customerNo)) : "";
      $("#acctId").textContent = u.email || s.email || s.id || "";
      $("#acctAvatar").textContent = (u.name || s.name || "M").trim().charAt(0).toUpperCase();
      if ($("#pf_name")) $("#pf_name").value = u.name || "";
      if ($("#pf_phone")) $("#pf_phone").value = u.phone || "";
      if ($("#pf_email")) $("#pf_email").value = u.email || "";
      fillAddr("pf", u.addr);
      if ($("#pf_pass")) $("#pf_pass").value = "";
      if ($("#pfVerify")) $("#pfVerify").hidden = true;
      if ($("#pfMsg")) { $("#pfMsg").textContent = ""; $("#pfMsg").className = "qv-msg"; }
      renderPayList(u);
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
    if ($("#resetPane")) $("#resetPane").hidden = true;
    if ($("#acctMsg")) { $("#acctMsg").textContent = ""; $("#acctMsg").className = "qv-msg"; }
  }
  if (tabLogin) tabLogin.addEventListener("click", () => selectTab(true));
  if (tabSignup) tabSignup.addEventListener("click", () => selectTab(false));
  function acctMsg(text, ok) { const m = $("#acctMsg"); if (m) { m.textContent = text; m.className = "qv-msg" + (ok ? " ok" : ""); } }

  const emailCfg = () => CONFIG.emailjs || {};
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
    const addr = readAddr("su");
    const address = composeAddress(addr);
    const pass = ($("#su_pass").value || "").trim();
    if (!name || !phone || !email || !pass) { acctMsg(t("acct.needAll")); return; }
    if (!emailOk(email)) { acctMsg(t("acct.badEmail")); return; }
    const users = getUsers();
    if (users.some((u) => (u.email || u.id || "").toLowerCase() === email.toLowerCase())) { acctMsg(t("acct.emailExists")); return; }
    const code = genCode();
    pendingSignup = { name: name, phone: phone, email: email, addr: addr, address: address, pass: pass, code: code };
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
    const customerNo = nextCustomerNo();
    users.push({ name: pendingSignup.name, phone: pendingSignup.phone, email: pendingSignup.email, address: pendingSignup.address || "", addr: pendingSignup.addr || {}, id: pendingSignup.email, pass: pendingSignup.pass, verified: true, customerNo: customerNo, payments: [] });
    saveUsers(users);
    setSession({ name: pendingSignup.name, id: pendingSignup.email, email: pendingSignup.email, phone: pendingSignup.phone, address: pendingSignup.address || "", addr: pendingSignup.addr || {}, customerNo: customerNo });
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
    setSession({ name: u.name, id: u.email || u.id, email: u.email, phone: u.phone, customerNo: u.customerNo }); renderAccount();
    acctMsg(t("acct.hi") + "، " + u.name, true); showToast(t("acct.hi") + "، " + u.name);
  });
  const logoutBtn = $("#logoutBtn");
  if (logoutBtn) logoutBtn.addEventListener("click", () => { setSession(null); selectTab(true); renderAccount(); });

  /* forgot password */
  let pendingReset = null;
  const forgotLink = $("#forgotLink");
  if (forgotLink) forgotLink.addEventListener("click", () => { if ($("#loginPane")) $("#loginPane").hidden = true; if ($("#resetPane")) $("#resetPane").hidden = false; if ($("#resetStep2")) $("#resetStep2").hidden = true; acctMsg(""); });
  const resetBack = $("#resetBack");
  if (resetBack) resetBack.addEventListener("click", () => selectTab(true));
  const resetSendBtn = $("#resetSendBtn");
  if (resetSendBtn) resetSendBtn.addEventListener("click", () => {
    const email = ($("#rs_email").value || "").trim();
    if (!emailOk(email)) { acctMsg(t("acct.badEmail")); return; }
    const u = getUsers().find((x) => (x.email || "").toLowerCase() === email.toLowerCase());
    if (!u) { acctMsg(t("acct.noEmail")); return; }
    const code = genCode(); pendingReset = { email: email, code: code };
    acctMsg(t("acct.sending"), true);
    sendCode(email, u.name, code).then((res) => {
      if ($("#resetStep2")) $("#resetStep2").hidden = false;
      if (res.sent) acctMsg(t("acct.resetSent"), true);
      else acctMsg(t("acct.resetSent") + " — " + t("acct.demoNote").replace("{code}", code), true);
    }).catch(() => acctMsg(t("acct.sendFail")));
  });
  const resetDoneBtn = $("#resetDoneBtn");
  if (resetDoneBtn) resetDoneBtn.addEventListener("click", () => {
    if (!pendingReset) return;
    const code = toEnDigits(($("#rs_code").value || "").trim()).replace(/[^0-9]/g, "");
    const np = ($("#rs_pass").value || "").trim();
    if (code !== pendingReset.code) { acctMsg(t("acct.badCode")); return; }
    if (np.length < 4) { acctMsg(t("acct.needAll")); return; }
    const users = getUsers(); const u = users.find((x) => (x.email || "").toLowerCase() === pendingReset.email.toLowerCase());
    if (!u) { acctMsg(t("acct.noEmail")); return; }
    u.pass = np; saveUsers(users); pendingReset = null;
    if ($("#rs_code")) $("#rs_code").value = ""; if ($("#rs_pass")) $("#rs_pass").value = "";
    selectTab(true); acctMsg(t("acct.resetDone"), true); showToast(t("acct.resetDone"));
  });

  /* profile edit + payment info */
  let pendingEmailChange = null;
  function pfMsg(text, ok) { const m = $("#pfMsg"); if (m) { m.textContent = text; m.className = "qv-msg" + (ok ? " ok" : ""); } }
  const saveProfileBtn = $("#saveProfileBtn");
  if (saveProfileBtn) saveProfileBtn.addEventListener("click", () => {
    const u = currentUser(); if (!u) return;
    const name = ($("#pf_name").value || "").trim();
    const phone = ($("#pf_phone").value || "").trim();
    const email = ($("#pf_email").value || "").trim();
    const newpass = ($("#pf_pass").value || "").trim();
    if (!name || !phone || !email) { pfMsg(t("acct.needAll")); return; }
    if (!emailOk(email)) { pfMsg(t("acct.badEmail")); return; }
    const emailChanged = email.toLowerCase() !== (u.email || "").toLowerCase();
    if (emailChanged && getUsers().some((x) => (x.email || "").toLowerCase() === email.toLowerCase())) { pfMsg(t("acct.emailExists")); return; }
    const addrParts = readAddr("pf");
    const address = composeAddress(addrParts);
    updateUser((usr) => { usr.name = name; usr.phone = phone; usr.address = address; usr.addr = addrParts; if (newpass) usr.pass = newpass; });
    setSession(Object.assign({}, getSession(), { name: name, phone: phone, address: address, addr: addrParts }));
    if (emailChanged) {
      const code = genCode(); pendingEmailChange = { email: email, code: code };
      if ($("#pfVerify")) $("#pfVerify").hidden = false;
      pfMsg(t("acct.sending"), true);
      sendCode(email, name, code).then((res) => {
        if (res.sent) pfMsg(t("acct.emailChangeCode"), true);
        else pfMsg(t("acct.emailChangeCode") + " — " + t("acct.demoNote").replace("{code}", code), true);
      }).catch(() => pfMsg(t("acct.sendFail")));
    } else { renderAccount(); pfMsg(t("acct.saved"), true); showToast(t("acct.saved")); }
  });
  const pfVerifyBtn = $("#pfVerifyBtn");
  if (pfVerifyBtn) pfVerifyBtn.addEventListener("click", () => {
    if (!pendingEmailChange) return;
    const entered = toEnDigits(($("#pf_code").value || "").trim()).replace(/[^0-9]/g, "");
    if (entered !== pendingEmailChange.code) { pfMsg(t("acct.badCode")); return; }
    const newEmail = pendingEmailChange.email;
    updateUser((usr) => { usr.email = newEmail; usr.id = newEmail; });
    setSession(Object.assign({}, getSession(), { email: newEmail, id: newEmail }));
    pendingEmailChange = null; if ($("#pf_code")) $("#pf_code").value = "";
    renderAccount(); pfMsg(t("acct.emailUpdated"), true); showToast(t("acct.emailUpdated"));
  });
  const payTypeEl = $("#pay_type");
  function togglePayCardExtra() { const ex = $("#payCardExtra"); if (ex) ex.hidden = (payTypeEl && payTypeEl.value !== "card"); }
  if (payTypeEl) payTypeEl.addEventListener("change", togglePayCardExtra);
  togglePayCardExtra();
  const addPayBtn = $("#addPayBtn");
  if (addPayBtn) addPayBtn.addEventListener("click", () => {
    const u = currentUser(); if (!u) return;
    const type = $("#pay_type").value;
    const holder = ($("#pay_holder").value || "").trim();
    const number = ($("#pay_number").value || "").trim();
    if (!number) { pfMsg(t("acct.needAll")); return; }
    const entry = { id: Date.now(), type: type, holder: holder, number: number };
    if (type === "card") {
      entry.cvv = ($("#pay_cvv").value || "").trim();
      entry.expiry = ($("#pay_expiry").value || "").trim();
      entry.cardAddr = ($("#pay_cardaddr").value || "").trim();
    }
    updateUser((usr) => { usr.payments = usr.payments || []; usr.payments.push(entry); });
    ["#pay_holder", "#pay_number", "#pay_cvv", "#pay_expiry", "#pay_cardaddr"].forEach((s) => { if ($(s)) $(s).value = ""; });
    renderPayList(currentUser()); showToast(t("acct.saved"));
  });
  const payListEl = $("#payList");
  if (payListEl) payListEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-delpay]"); if (!b) return;
    const id = b.getAttribute("data-delpay");
    updateUser((usr) => { usr.payments = (usr.payments || []).filter((p) => String(p.id) !== String(id)); });
    renderPayList(currentUser());
  });

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

  /* logo (from admin) */
  function applyLogo() {
    const url = CONFIG.logo;
    $$(".brand .logo").forEach((el) => {
      if (url) el.innerHTML = `<img src="${url}" alt="MAHO" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
      else el.textContent = "M";
    });
  }

  /* editable hero (header) background image/logo from admin */
  function applyHero() {
    const hero = document.querySelector(".hero#home") || document.querySelector(".hero");
    if (!hero) return;
    const img = CONFIG.heroImage;
    if (img) {
      // Semi-transparent overlay keeps hero text readable while the uploaded
      // image stays clearly visible. NOTE: no opaque base layer here, otherwise
      // it would fully cover the image.
      hero.style.backgroundImage =
        "linear-gradient(rgba(12,12,12,.55), rgba(20,17,10,.72))," +
        "radial-gradient(1100px 620px at 82% -8%, rgba(200,163,95,.32), transparent 60%)," +
        "radial-gradient(900px 520px at 5% 110%, rgba(200,163,95,.18), transparent 60%)," +
        "url('" + img + "')";
      hero.style.backgroundSize = "cover, cover, cover, cover";
      hero.style.backgroundPosition = "center, center, center, center";
      hero.style.backgroundRepeat = "no-repeat";
      hero.style.backgroundColor = "#0e0e0e";
    } else {
      hero.style.backgroundImage = "";
      hero.style.backgroundSize = "";
      hero.style.backgroundPosition = "";
      hero.style.backgroundRepeat = "";
      hero.style.backgroundColor = "";
    }
  }

  /* editable site texts (from admin) — override the i18n defaults when set */
  function applyContent() {
    const c = CONFIG.content || {};
    const pick = (k) => (LANG === "en" ? (c[k + "_en"] || c[k] || "") : (c[k] || ""));
    const setSel = (sel, val) => { if (val) { const el = $(sel); if (el) el.textContent = val; } };
    const bs = pick("brandSub"); if (bs) $$(".brand-sub").forEach((el) => (el.textContent = bs));
    setSel(".hero-eyebrow", pick("heroEyebrow"));
    setSel("#home h1", pick("heroTitle"));
    setSel("#home .lead", pick("heroLead"));
    setSel('[data-i18n="footer.desc"]', pick("footerDesc"));
    setSel('[data-i18n="footer.addr"]', pick("footerAddr"));
    setSel('[data-i18n="footer.phone"]', c.footerPhone || "");
    setSel('[data-i18n="footer.email"]', c.footerEmail || "");
    // Social links (instagram, telegram, whatsapp, facebook, tiktok) — show only those that have a URL
    const socialUrls = [c.instagram, c.telegram, c.whatsappLink, c.facebook, c.tiktok];
    const socials = $$(".socials a");
    socials.forEach((a, i) => {
      const url = socialUrls[i] || "";
      if (url) { a.href = url; a.target = "_blank"; a.rel = "noopener"; a.style.display = ""; }
      else { a.removeAttribute("href"); a.style.display = "none"; }
    });
    const statsArr = c.stats || [];
    const statEls = $$(".hero-stats .stat");
    statsArr.forEach((st, i) => {
      if (!st || !statEls[i]) return;
      const b = statEls[i].querySelector("b"), span = statEls[i].querySelector("span");
      if (b && st.value != null && st.value !== "") { b.setAttribute("data-count", String(st.value)); b.textContent = toDigits(parseInt(st.value, 10) || 0); }
      const lab = LANG === "en" ? (st.label_en || st.label) : st.label;
      if (span && lab) span.textContent = lab;
    });
    // Floating hero cards (editable text + size)
    for (let n = 1; n <= 3; n++) {
      const card = document.querySelector(".hero-card.c" + n);
      if (!card) continue;
      const tg = pick("hc" + n + "_tag"), ti = pick("hc" + n + "_title"), sb = pick("hc" + n + "_sub");
      const tagEl = card.querySelector(".tag"), h4El = card.querySelector("h4"), subEl = card.querySelector("span:not(.tag)");
      if (tg && tagEl) tagEl.textContent = tg;
      if (ti && h4El) h4El.textContent = ti;
      if (sb && subEl) subEl.textContent = sb;
    }
    const visual = document.querySelector(".hero-visual");
    if (visual) {
      const scale = parseFloat(c.heroScale);
      if (scale && scale > 0) { visual.style.transform = "scale(" + scale + ")"; visual.style.transformOrigin = "center"; }
      else { visual.style.transform = ""; }
    }
    linkifyContacts();
  }
  function telHref(s) { return "tel:" + String(s || "").replace(/[^\d+]/g, ""); }
  function linkifyContacts() {
    const ph = document.querySelector('.site-footer [data-i18n="footer.phone"]');
    if (ph && ph.tagName === "A") { const v = (ph.textContent || "").trim(); ph.href = v ? telHref(v) : "#"; }
    const em = document.querySelector('.site-footer [data-i18n="footer.email"]');
    if (em && em.tagName === "A") { const v = (em.textContent || "").trim(); em.href = v ? ("mailto:" + v) : "#"; }
  }

  /* share */
  const shareBtn = $("#shareBtn");
  if (shareBtn) shareBtn.addEventListener("click", () => {
    const url = location.href;
    const data = { title: t("share.title"), text: t("share.title"), url: url };
    if (navigator.share) { navigator.share(data).catch(() => {}); }
    else if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(url).then(() => showToast(t("share.copied"))).catch(() => prompt(url)); }
    else { prompt("", url); }
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
  /* -------------------- Customer reviews -------------------- */
  const REVIEWS_KEY = "maho_reviews";
  const getReviews = () => { try { return JSON.parse(localStorage.getItem(REVIEWS_KEY)) || []; } catch (_) { return []; } };
  const saveReviews = (r) => { try { localStorage.setItem(REVIEWS_KEY, JSON.stringify(r)); } catch (_) {} };
  function escHtml(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])); }
  function starStr(n) { n = Math.max(0, Math.min(5, parseInt(n, 10) || 0)); return "★★★★★".slice(0, n) + "☆☆☆☆☆".slice(0, 5 - n); }
  function renderReviews() {
    const grid = $("#reviewsGrid"); if (!grid) return;
    const all = getReviews().filter((r) => r.status === "approved");
    all.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || (b.date || 0) - (a.date || 0));
    const list = all.slice(0, 6);
    const empty = $("#reviewsEmpty");
    if (!list.length) { grid.innerHTML = ""; if (empty) empty.hidden = false; return; }
    if (empty) empty.hidden = true;
    grid.innerHTML = list.map((r) => {
      const nm = r.name || t("review.customer");
      const initial = (String(nm).trim()[0]) || "م";
      const who = r.customerNo ? escHtml(r.customerNo) : t("review.customer");
      return `<div class="testi reveal in">
        <div class="stars">${starStr(r.rating)}</div>
        <p>${escHtml(r.text)}</p>
        <div class="who"><div class="avatar">${escHtml(initial)}</div><div><b>${escHtml(nm)}</b><span>${who}</span></div></div>
      </div>`;
    }).join("");
  }
  let reviewRating = 0;
  const ratingInput = $("#ratingInput");
  function paintStars() { if (!ratingInput) return; $$(".star", ratingInput).forEach((s) => s.classList.toggle("on", (parseInt(s.dataset.val, 10) <= reviewRating))); }
  if (ratingInput) ratingInput.addEventListener("click", (e) => { const b = e.target.closest(".star"); if (!b) return; reviewRating = parseInt(b.dataset.val, 10) || 0; paintStars(); });
  const writeReviewBtn = $("#writeReviewBtn");
  if (writeReviewBtn) writeReviewBtn.addEventListener("click", () => {
    const note = $("#reviewLoginNote"), form = $("#reviewForm");
    if (!getSession()) { if (note) note.hidden = false; openAcct(); return; }
    if (note) note.hidden = true;
    if (form) form.hidden = !form.hidden;
  });
  const reviewForm = $("#reviewForm");
  if (reviewForm) reviewForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const s = getSession(); if (!s) { openAcct(); return; }
    const txt = ($("#reviewText") && $("#reviewText").value.trim()) || "";
    const msg = $("#reviewMsg");
    if (!reviewRating || !txt) { if (msg) msg.textContent = t("review.needText"); return; }
    const reviews = getReviews();
    reviews.push({ id: "R" + Date.now().toString(36), name: s.name || t("review.customer"), customerNo: s.customerNo || "", rating: reviewRating, text: txt, date: Date.now(), status: "pending", featured: false });
    saveReviews(reviews);
    if ($("#reviewText")) $("#reviewText").value = "";
    reviewRating = 0; paintStars();
    reviewForm.hidden = true; if (msg) msg.textContent = "";
    showToast(t("review.thanks"));
  });

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
    renderFilters();
    renderShowcase();
    renderProducts();
    renderStores();
    renderReviews();
    renderCart();
    updateCartBadge();
    renderAccount();
    updatePayInfo();
    applyLogo();
    applyHero();
    applyContent();
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
