"use strict";
/**
 * MAHO Market transactional email templates (HTML + text).
 * Never include passwords, tokens in plain form beyond one-time codes,
 * or SMTP credentials in logs.
 */

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function moneyAf(n, lang) {
  const v = Number(n) || 0;
  const num = v.toLocaleString("en-US");
  return lang === "en" ? num + " AFN" : num + " افغانی";
}

function supportContactHtml(storePhone, lang) {
  const phone = String(storePhone || "").trim();
  if (lang === "en") {
    const phonePart = phone
      ? ` or the store phone (<span dir="ltr">${escapeHtml(phone)}</span>)`
      : " or the store phone";
    return `<p>Questions? Contact us at <a href="mailto:support@mahomarket.com">support@mahomarket.com</a>${phonePart}.</p>`;
  }
  const phonePart = phone
    ? ` یا شماره تماس فروشگاه (<span dir="ltr">${escapeHtml(phone)}</span>)`
    : " یا شماره تماس فروشگاه";
  return `<p>سؤالی دارید؟ با ما از طریق <a href="mailto:support@mahomarket.com">support@mahomarket.com</a>${phonePart} ارتباط بگیرید.</p>`;
}

function supportContactText(storePhone, lang) {
  const phone = String(storePhone || "").trim();
  if (lang === "en") {
    return "Questions? Contact us at support@mahomarket.com" + (phone ? " or the store phone (" + phone + ")" : " or the store phone") + ".";
  }
  return "سؤالی دارید؟ با ما از طریق support@mahomarket.com" + (phone ? " یا شماره تماس فروشگاه (" + phone + ")" : " یا شماره تماس فروشگاه") + " ارتباط بگیرید.";
}

function brandWrap({ title, preheader, bodyHtml, siteUrl, logoUrl, storePhone, lang }) {
  const brand = "#c8a35f";
  const dark = "#141414";
  const isEn = lang === "en";
  const logo = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="MAHO Market" width="72" height="72" style="border-radius:50%;border:2px solid ${brand};display:block;margin:0 auto 12px">`
    : `<div style="width:72px;height:72px;border-radius:50%;border:2px solid ${brand};color:${brand};font:700 28px Georgia,serif;display:flex;align-items:center;justify-content:center;margin:0 auto 12px">M</div>`;
  const phoneLine = storePhone
    ? `<div>${isEn ? "Store phone" : "تماس فروشگاه"}: <span dir="ltr">${escapeHtml(storePhone)}</span></div>`
    : "";
  const tagline = isEn ? "MAHO Market — Women's fashion & essentials" : "MAHO Market — لباس و لوازم بانوان";
  const supportLbl = isEn ? "Support" : "پشتیبانی";
  return `<!DOCTYPE html>
<html lang="${isEn ? "en" : "fa"}" dir="${isEn ? "ltr" : "rtl"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<!--[if mso]><style>table{border-collapse:collapse}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:#f3efe7;font-family:${isEn ? "Arial,Helvetica,sans-serif" : "Tahoma,Arial,sans-serif"};color:#23201a;line-height:1.7">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader || "")}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3efe7;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e6e0d4">
<tr><td style="background:${dark};padding:28px 24px;text-align:center">
${logo}
<div style="color:${brand};font-weight:800;letter-spacing:2px;font-size:13px">MAHO MARKET</div>
<div style="color:#fff;font-size:20px;font-weight:800;margin-top:8px">${escapeHtml(title)}</div>
</td></tr>
<tr><td style="padding:28px 24px;font-size:15px">${bodyHtml}</td></tr>
<tr><td style="padding:18px 24px;background:#fbf8f1;border-top:1px solid #e6e0d4;font-size:12px;color:#7a7368;text-align:center">
<div>${tagline}</div>
<div>${supportLbl}: <a href="mailto:support@mahomarket.com" style="color:${brand}">support@mahomarket.com</a></div>
${phoneLine}
${siteUrl ? `<div style="margin-top:6px"><a href="${escapeHtml(siteUrl)}" style="color:${brand}">${escapeHtml(siteUrl)}</a></div>` : ""}
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function ctaBtn(href, label) {
  return `<p style="text-align:center;margin:24px 0">
<a href="${escapeHtml(href)}" style="display:inline-block;background:#c8a35f;color:#1a1509;text-decoration:none;font-weight:800;padding:12px 22px;border-radius:999px">${escapeHtml(label)}</a>
</p>`;
}

function orderItemsTable(order, lang) {
  const items = order.items || [];
  const isEn = lang === "en";
  const { resolveProductImageUrl } = require("./media-url");
  const siteUrl = (order && order._siteUrl) || process.env.SITE_URL || "https://mahomarket.com";
  const logoUrl = (order && order._logoUrl) || "";
  const placeholder = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="" width="72" height="72" style="object-fit:contain;border-radius:8px;display:block;background:#fbf8f1">`
    : `<div style="width:72px;height:72px;border-radius:8px;background:#fbf8f1;border:1px solid #e6e0d4;color:#c8a35f;font:700 22px Georgia,serif;text-align:center;line-height:72px">M</div>`;

  const cards = items.map((it) => {
    const qty = it.qty || 1;
    const unit = Number(it.price) || 0;
    const discPct = Number(it.discount) || 0;
    const line = it.lineTotal != null
      ? Number(it.lineTotal)
      : (discPct > 0 ? unit * qty * (1 - discPct / 100) : unit * qty);
    const absImg = resolveProductImageUrl(it.image || it, { siteUrl: siteUrl, logoUrl: logoUrl });
    const img = absImg
      ? `<img src="${escapeHtml(absImg)}" alt="" width="72" height="72" style="object-fit:cover;border-radius:8px;display:block;border:0">`
      : placeholder;
    const nm = isEn ? (it.name_en || it.name || "") : (it.name || it.name_en || "");
    const sizeLbl = isEn ? "Size" : "سایز";
    const colorLbl = isEn ? "Color" : "رنگ";
    const qtyLbl = isEn ? "Qty" : "تعداد";
    const priceLbl = isEn ? "Unit price" : "قیمت";
    const discLbl = isEn ? "Discount" : "تخفیف";
    const totalLbl = isEn ? "Line total" : "مجموع";
    const nameLbl = isEn ? "Product" : "نام محصول";
    const discVal = discPct
      ? (isEn ? (discPct + "%") : (discPct + "٪"))
      : (it.discountAmount ? moneyAf(it.discountAmount, lang) : "—");
    return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e6e0d4;border-radius:12px;margin:0 0 12px;background:#fff">
<tr>
<td style="padding:12px;width:84px;vertical-align:top">${img}</td>
<td style="padding:12px 12px 12px 0;vertical-align:top;font-size:14px;line-height:1.7">
<div style="font-weight:800;margin-bottom:6px">${escapeHtml(nameLbl)}: ${escapeHtml(nm)}</div>
${it.size ? `<div>${escapeHtml(sizeLbl)}: ${escapeHtml(String(it.size))}</div>` : ""}
${it.color ? `<div>${escapeHtml(colorLbl)}: ${escapeHtml(String(it.color))}</div>` : ""}
<div>${escapeHtml(qtyLbl)}: <span dir="ltr">${escapeHtml(String(qty))}</span></div>
<div>${escapeHtml(priceLbl)}: <span dir="ltr">${moneyAf(unit, lang)}</span></div>
<div>${escapeHtml(discLbl)}: <span dir="ltr">${escapeHtml(String(discVal))}</span></div>
<div style="font-weight:800;margin-top:4px">${escapeHtml(totalLbl)}: <span dir="ltr">${moneyAf(line, lang)}</span></div>
</td>
</tr>
</table>`;
  }).join("");

  return `<div style="margin:16px 0">${cards || ""}</div>`;
}

function orderTotalsBlock(order, lang) {
  const isEn = lang === "en";
  const itemsTotal = order.itemsTotal != null ? order.itemsTotal : (order.items || []).reduce((s, it) => s + (it.price || 0) * (it.qty || 1), 0);
  const fee = order.deliveryFee || 0;
  const discount = order.discountTotal || 0;
  const total = order.total != null ? order.total : itemsTotal + fee - discount;
  const itemsLbl = isEn ? "Items subtotal" : "جمع اقلام";
  const discLbl = isEn ? "Discount" : "تخفیف";
  const shipLbl = isEn ? "Delivery fee" : "هزینه ارسال";
  const grandLbl = isEn ? "Grand total" : "مبلغ نهایی";
  return `<table role="presentation" width="100%" style="font-size:14px;margin:16px 0;border-top:1px solid #e6e0d4;padding-top:8px">
<tr><td style="padding:4px 0">${itemsLbl}</td><td style="text-align:left;direction:ltr;padding:4px 0">${moneyAf(itemsTotal, lang)}</td></tr>
<tr><td style="padding:4px 0">${discLbl}</td><td style="text-align:left;direction:ltr;padding:4px 0">${discount ? ("− " + moneyAf(discount, lang)) : (isEn ? "—" : "—")}</td></tr>
<tr><td style="padding:4px 0">${shipLbl}</td><td style="text-align:left;direction:ltr;padding:4px 0">${fee ? moneyAf(fee, lang) : (isEn ? "Free" : "رایگان")}</td></tr>
<tr><td style="font-weight:800;font-size:16px;padding-top:10px;color:#141414">${grandLbl}</td><td style="text-align:left;direction:ltr;font-weight:800;font-size:16px;padding-top:10px;color:#141414">${moneyAf(total, lang)}</td></tr>
</table>`;
}

function isStorePickupOrder(order) {
  const m = (order && order.delivery && order.delivery.method) || "";
  return m === "pickup" || m === "store_pickup" || m === "store" || m === "حضوری";
}

function storePickupBlock(order, lang) {
  if (!isStorePickupOrder(order)) return "";
  const isEn = lang === "en";
  const s = (order && order.pickupStore) || {};
  if (!s || (!s.name && !s.address && !s.id)) return "";
  let mapsUrl = s.mapsUrl || "";
  if (!mapsUrl && s.lat != null && s.lng != null) {
    mapsUrl = "https://www.google.com/maps?q=" + encodeURIComponent(String(s.lat) + "," + String(s.lng));
  }
  const intro = isEn
    ? "Your order can be collected from the store below:"
    : "سفارش شما از فروشگاه زیر قابل دریافت است:";
  const nameLbl = isEn ? "Store name" : "نام فروشگاه";
  const addrLbl = isEn ? "Address" : "آدرس";
  const phoneLbl = isEn ? "Phone" : "شماره تماس";
  const hoursLbl = isEn ? "Hours" : "ساعات کاری";
  const mapsLbl = isEn ? "View location on Google Maps" : "مشاهده موقعیت در Google Maps";
  const mapsBtn = mapsUrl
    ? ctaBtn(mapsUrl, mapsLbl)
    : "";
  return `<div style="margin:18px 0;padding:14px;border:1px solid #e6e0d4;border-radius:12px;background:#fbf8f1">
<p style="margin:0 0 10px;font-weight:800">${intro}</p>
<p style="margin:0;line-height:1.8">
<strong>${nameLbl}:</strong> ${escapeHtml(s.name || "—")}<br>
<strong>${addrLbl}:</strong> ${escapeHtml(s.address || s.area || "—")}<br>
<strong>${phoneLbl}:</strong> <span dir="ltr">${escapeHtml(s.phone || "—")}</span>
${s.hours ? "<br><strong>" + hoursLbl + ":</strong> " + escapeHtml(s.hours) : ""}
</p>
${mapsBtn}
</div>`;
}

function customerStatusCopy(status, lang) {
  const isEn = lang === "en";
  const fa = {
    confirmed: "سفارش شما با موفقیت تأیید شد و در حال آماده‌سازی است.",
    ready_for_pickup: "سفارش شما آماده دریافت است.",
    dispatched: "سفارش شما برای تحویل ارسال شده است.",
    out_for_delivery: "سفارش شما برای تحویل ارسال شده است.",
    delivered: "سفارش شما با موفقیت تحویل داده شد.",
    cancelled: "سفارش شما لغو شد.",
    partially_cancelled: "بخشی از سفارش شما لغو شد.",
    return_requested: "درخواست برگشت شما ثبت شد.",
    return_completed: "فرآیند برگشت شما با موفقیت تکمیل شد.",
    return_approved: "درخواست برگشت شما تأیید شد.",
    return_rejected: "درخواست برگشت شما رد شد.",
  };
  const en = {
    confirmed: "Your order was confirmed and is being prepared.",
    ready_for_pickup: "Your order is ready for pickup.",
    dispatched: "Your order is out for delivery.",
    out_for_delivery: "Your order is out for delivery.",
    delivered: "Your order was delivered successfully.",
    cancelled: "Your order was cancelled.",
    partially_cancelled: "Part of your order was cancelled.",
    return_requested: "Your return request was submitted.",
    return_completed: "Your return was completed successfully.",
    return_approved: "Your return request was approved.",
    return_rejected: "Your return request was rejected.",
  };
  const map = isEn ? en : fa;
  return map[status] || "";
}

function payLabel(p, lang) {
  if (lang === "en") {
    const m = { whatsapp: "WhatsApp / cash on delivery", bank: "Bank transfer", card: "Online card", hesab: "HesabPay", cash: "Cash on delivery" };
    return m[p] || p || "—";
  }
  const m = { whatsapp: "واتساپ", bank: "انتقال بانکی", card: "کارت آنلاین", hesab: "حساب‌پی", cash: "نقدی هنگام دلیوری" };
  return m[p] || p || "—";
}

function statusLabelFa(s) {
  const m = {
    new: "جدید", pending: "در انتظار تایید", confirmed: "تأیید شد",
    dispatched: "ارسال شد", delivered: "تحویل شد", cancelled: "لغو شد",
    awaiting_payment: "در انتظار پرداخت", receipt_submitted: "رسید فرستاده شد",
    under_review: "در حال بررسی", payment_confirmed: "پرداخت تأیید شد",
    payment_rejected: "پرداخت رد شد", return_requested: "درخواست برگشت",
  };
  return m[s] || s || "—";
}

function statusLabelEn(s) {
  const m = {
    new: "Awaiting confirmation", pending: "Awaiting confirmation", confirmed: "Confirmed",
    dispatched: "Dispatched", delivered: "Delivered", cancelled: "Cancelled",
    awaiting_payment: "Awaiting payment", receipt_submitted: "Receipt submitted",
    under_review: "Under review", payment_confirmed: "Payment confirmed",
    payment_rejected: "Payment rejected", return_requested: "Return requested",
  };
  return m[s] || String(s || "—").replace(/_/g, " ");
}

function normalizeLang(lang, order) {
  const raw = lang || (order && order.lang) || "fa";
  return String(raw).toLowerCase().indexOf("en") === 0 ? "en" : "fa";
}

function buildMailer(opts) {
  const {
    sendRaw, fromName, fromEmail, replyTo, siteUrl, logoUrl, ordersNotifyEmail,
  } = opts;
  const getStorePhone = typeof opts.getStorePhone === "function"
    ? opts.getStorePhone
    : () => opts.storePhone || "";
  const getOfficialWhatsApp = typeof opts.getOfficialWhatsApp === "function"
    ? opts.getOfficialWhatsApp
    : () => opts.officialWhatsApp || opts.whatsapp || "";

  function wrap(args) {
    return brandWrap(Object.assign({ storePhone: getStorePhone(), lang: args.lang || "fa" }, args));
  }

  function send(to, subject, html, text) {
    return sendRaw({
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      replyTo: replyTo || "support@mahomarket.com",
      from: `"${fromName || "MAHO Market"}" <${fromEmail || "info@mahomarket.com"}>`,
    }).catch((err) => {
      /* never roll back order — log and rethrow for caller catch */
      console.error("[mail]", String((err && err.message) || err).slice(0, 200));
      throw err;
    });
  }

  function verificationCode(to, code, name) {
    const html = wrap({
      title: "کود تأیید حساب",
      preheader: "کود تأیید MAHO Market",
      siteUrl, logoUrl, lang: "fa",
      bodyHtml: `<p>سلام${name ? " " + escapeHtml(name) : ""}،</p>
<p>برای تأیید حساب خود در MAHO Market از کود زیر استفاده کنید:</p>
<p style="font-size:32px;font-weight:800;letter-spacing:6px;text-align:center;direction:ltr;color:#141414">${escapeHtml(code)}</p>
<p>این کود فقط <strong>۱۰ دقیقه</strong> اعتبار دارد. اگر شما این درخواست را نکرده‌اید، این پیام را نادیده بگیرید.</p>
<p style="font-size:12px;color:#7a7368">هرگز رمز عبور خود را با کسی شریک نسازید. MAHO هرگز رمز شما را در ایمیل نمی‌فرستد.</p>
${supportContactHtml(getStorePhone(), "fa")}`,
    });
    return send(to, "MAHO Market — کود تأیید حساب", html, `کود تأیید: ${code}\nاعتبار: ۱۰ دقیقه\n${supportContactText(getStorePhone(), "fa")}`);
  }

  function welcome(to, { name, email }) {
    const html = wrap({
      title: "به MAHO خوش آمدید",
      preheader: "حساب شما تأیید شد",
      siteUrl, logoUrl, lang: "fa",
      bodyHtml: `<p>سلام ${escapeHtml(name || "")}،</p>
<p>حساب شما با موفقیت ساخته و تأیید شد.</p>
<p>ایمیل ورود شما: <strong dir="ltr">${escapeHtml(email || to)}</strong></p>
<p>رمز عبور شما با موفقیت تنظیم شد. برای امنیت، رمز را نزد خود نگه دارید — ما هرگز رمز را در ایمیل نمی‌فرستیم.</p>
${ctaBtn((siteUrl || "https://mahomarket.com") + "/#account", "ورود به حساب")}
${ctaBtn((siteUrl || "https://mahomarket.com") + "/#products", "ادامهٔ خرید")}
${supportContactHtml(getStorePhone(), "fa")}`,
    });
    return send(to, "MAHO Market — خوش آمدید", html);
  }

  function passwordReset(to, { resetUrl, name }) {
    const html = wrap({
      title: "بازیابی رمز عبور",
      preheader: "لینک بازیابی رمز MAHO",
      siteUrl, logoUrl, lang: "fa",
      bodyHtml: `<p>سلام${name ? " " + escapeHtml(name) : ""}،</p>
<p>درخواست بازیابی رمز برای حساب MAHO دریافت شد. روی دکمهٔ زیر کلیک کنید (لینک کوتاه‌مدت و یک‌بارمصرف است):</p>
${ctaBtn(resetUrl, "تنظیم رمز جدید")}
<p style="font-size:12px;color:#7a7368">اگر شما این درخواست را نکرده‌اید، این ایمیل را نادیده بگیرید. رمز قبلی شما تغییر نمی‌کند.</p>
<p style="font-size:12px;color:#7a7368">MAHO هرگز رمز عبور را در ایمیل نمی‌فرستد.</p>
${supportContactHtml(getStorePhone(), "fa")}`,
    });
    return send(to, "MAHO Market — بازیابی رمز عبور", html);
  }

  function orderConfirmation(to, order, trackUrl, langArg) {
    const lang = normalizeLang(langArg, order);
    const isEn = lang === "en";
    const c = order.customer || {};
    const stFn = isEn ? statusLabelEn : statusLabelFa;
    const orderView = Object.assign({}, order, { _siteUrl: siteUrl, _logoUrl: logoUrl });
    const recv = isStorePickupOrder(order)
      ? (isEn ? "Store pickup" : "دریافت حضوری از فروشگاه")
      : (isEn ? "Delivery" : "دلیوری");
    const dateStr = isEn
      ? new Date(order.date || Date.now()).toLocaleString("en-US")
      : new Date(order.date || Date.now()).toLocaleString("fa-AF");
    const nameHtml = `<span dir="auto">${escapeHtml(c.name || "")}</span>`;
    const pickupOrAddr = isStorePickupOrder(order)
      ? storePickupBlock(orderView, lang)
      : (isEn
        ? `<p><strong>Delivery address:</strong> ${escapeHtml(c.address || "—")}<br>
<strong>Phone:</strong> <span dir="ltr">${escapeHtml(c.phone || "")}</span></p>`
        : `<p><strong>آدرس دلیوری:</strong> ${escapeHtml(c.address || "—")}<br>
<strong>شماره تماس:</strong> <span dir="ltr">${escapeHtml(c.phone || "")}</span></p>`);
    const html = wrap({
      title: isEn ? "Order confirmation" : "تأیید سفارش",
      preheader: (isEn ? "Order " : "سفارش ") + (order.id || ""),
      siteUrl, logoUrl, lang,
      bodyHtml: isEn
        ? `<p>Hello ${nameHtml},</p>
<p>Thank you for shopping at MAHO Market.</p>
<p>Your order was placed successfully and is under review.</p>
<p><strong>Order number:</strong> <span dir="ltr">${escapeHtml(order.id || "")}</span><br>
<strong>Date:</strong> ${escapeHtml(dateStr)}</p>
${orderItemsTable(orderView, lang)}
${orderTotalsBlock(order, lang)}
<p><strong>Payment:</strong> ${escapeHtml(payLabel(order.payment, lang))}<br>
<strong>Payment status:</strong> ${escapeHtml(stFn(order.paymentStatus || (order.payment === "hesab" || order.payment === "bank" || order.payment === "card" ? "awaiting_payment" : "—")))}<br>
<strong>Order status:</strong> ${escapeHtml(stFn(order.status))}<br>
<strong>Fulfillment:</strong> ${escapeHtml(recv)}</p>
${pickupOrAddr}
${trackUrl ? ctaBtn(trackUrl, "View / track order") : ""}
${supportContactHtml(getStorePhone(), lang)}`
        : `<p>سلام ${nameHtml}،</p>
<p>از خرید شما از MAHO Market سپاسگزاریم.</p>
<p>سفارش شما با موفقیت ثبت شد و در حال بررسی است.</p>
<p><strong>شماره سفارش:</strong> <span dir="ltr">${escapeHtml(order.id || "")}</span><br>
<strong>تاریخ:</strong> ${escapeHtml(dateStr)}</p>
${orderItemsTable(orderView, lang)}
${orderTotalsBlock(order, lang)}
<p><strong>روش پرداخت:</strong> ${escapeHtml(payLabel(order.payment, lang))}<br>
<strong>وضعیت پرداخت:</strong> ${escapeHtml(stFn(order.paymentStatus || (order.payment === "hesab" || order.payment === "bank" || order.payment === "card" ? "awaiting_payment" : "—")))}<br>
<strong>وضعیت سفارش:</strong> ${escapeHtml(stFn(order.status))}<br>
<strong>روش دریافت:</strong> ${escapeHtml(recv)}</p>
${pickupOrAddr}
${trackUrl ? ctaBtn(trackUrl, "مشاهده / پیگیری سفارش") : ""}
${supportContactHtml(getStorePhone(), lang)}`,
    });
    const subject = isEn
      ? "MAHO Market — Order confirmation " + (order.id || "")
      : "MAHO Market — تأیید سفارش " + (order.id || "");
    const text = [
      isEn ? "Order " + (order.id || "") : "سفارش " + (order.id || ""),
      payLabel(order.payment, lang),
      moneyAf(order.total, lang),
      supportContactText(getStorePhone(), lang),
    ].join("\n");
    return send(to, subject, html, text);
  }

  function orderAdminNotify(order) {
    const to = ordersNotifyEmail || "orders@mahomarket.com";
    const c = order.customer || {};
    const loc = order.customerLocation || {};
    const maps = loc.mapsUrl || (loc.lat != null ? `https://www.google.com/maps?q=${encodeURIComponent(loc.lat + "," + loc.lng)}` : "");
    const d = order.delivery || {};
    const html = wrap({
      title: "سفارش جدید",
      preheader: order.id || "",
      siteUrl, logoUrl, lang: "fa",
      bodyHtml: `<p>یک سفارش جدید ثبت شد${order.lang === "en" ? " (از نسخه انگلیسی سایت)" : ""}.</p>
<p><strong>نمبر:</strong> <span dir="ltr">${escapeHtml(order.id || "")}</span><br>
<strong>زبان سایت:</strong> ${escapeHtml(order.lang === "en" ? "English" : "دری")}<br>
<strong>تاریخ:</strong> ${escapeHtml(new Date(order.date || Date.now()).toLocaleString("fa-AF"))}<br>
<strong>مشتری:</strong> ${escapeHtml(c.name || "")}<br>
<strong>ایمیل:</strong> <span dir="ltr">${escapeHtml(c.email || "")}</span><br>
<strong>تماس:</strong> <span dir="ltr">${escapeHtml(c.phone || "")}</span><br>
<strong>پرداخت:</strong> ${escapeHtml(payLabel(order.payment, "fa"))} / ${escapeHtml(statusLabelFa(order.paymentStatus || "—"))}<br>
<strong>دریافت:</strong> ${escapeHtml(d.method === "deliver" ? "دلیوری" : "حضوری")}${d.time ? " — " + escapeHtml(d.time) : ""}<br>
<strong>آدرس:</strong> ${escapeHtml(c.address || "—")}<br>
${loc.lat != null ? `<strong>مختصات:</strong> <span dir="ltr">${escapeHtml(String(loc.lat))}, ${escapeHtml(String(loc.lng))}</span><br>` : ""}
${maps ? `<strong>نقشه:</strong> <a href="${escapeHtml(maps)}">${escapeHtml(maps)}</a><br>` : ""}
<strong>یادداشت:</strong> ${escapeHtml(c.note || order.deliveryNote || "—")}<br>
<strong>مبلغ:</strong> ${moneyAf(order.total, "fa")}</p>
${orderItemsTable(Object.assign({}, order, { _siteUrl: siteUrl, _logoUrl: logoUrl }), "fa")}
${orderTotalsBlock(order, "fa")}
${ctaBtn((siteUrl || "https://mahomarket.com") + "/admin.html", "بازکردن پنل مدیر")}`,
    });
    return send(to, "MAHO — سفارش جدید " + (order.id || ""), html);
  }

  function orderStatus(to, order, note, langArg) {
    const lang = normalizeLang(langArg, order);
    const isEn = lang === "en";
    const c = order.customer || {};
    const stFn = isEn ? statusLabelEn : statusLabelFa;
    const titlesFa = {
      confirmed: "سفارش تأیید شد",
      dispatched: "سفارش ارسال شد",
      delivered: "سفارش تحویل شد",
      cancelled: "سفارش لغو شد",
      return_requested: "درخواست برگشت ثبت شد",
      return_approved: "برگشت تأیید شد",
      return_rejected: "برگشت رد شد",
      return_completed: "برگشت تکمیل شد",
      payment_confirmed: "پرداخت تأیید شد",
      payment_rejected: "پرداخت رد شد",
      awaiting_payment: "در انتظار پرداخت",
      receipt_submitted: "رسید دریافت شد",
      under_review: "پرداخت در حال بررسی",
    };
    const titlesEn = {
      confirmed: "Order confirmed",
      dispatched: "Order dispatched",
      delivered: "Order delivered",
      cancelled: "Order cancelled",
      return_requested: "Return requested",
      return_approved: "Return approved",
      return_rejected: "Return rejected",
      return_completed: "Return completed",
      payment_confirmed: "Payment confirmed",
      payment_rejected: "Payment rejected",
      awaiting_payment: "Awaiting payment",
      receipt_submitted: "Receipt received",
      under_review: "Payment under review",
    };
    const titles = isEn ? titlesEn : titlesFa;
    const title = titles[order.status] || titles[order.paymentStatus] || (isEn ? "Order update" : "به‌روزرسانی سفارش");
    const statusMsg = customerStatusCopy(order.status, lang);
    const nameHtml = `<span dir="auto">${escapeHtml(c.name || "")}</span>`;
    const orderView = Object.assign({}, order, { _siteUrl: siteUrl, _logoUrl: logoUrl });
    const pickupExtra = (order.status === "confirmed" || order.status === "ready_for_pickup")
      ? storePickupBlock(orderView, lang)
      : "";
    const html = wrap({
      title,
      preheader: order.id || "",
      siteUrl, logoUrl, lang,
      bodyHtml: isEn
        ? `<p>Hello ${nameHtml},</p>
<p>Your order <strong dir="ltr">${escapeHtml(order.id || "")}</strong> was updated.</p>
${statusMsg ? `<p style="font-size:16px;font-weight:700">${escapeHtml(statusMsg)}</p>` : `<p style="font-size:18px;font-weight:800">${escapeHtml(stFn(order.status))}${order.paymentStatus ? " / payment: " + escapeHtml(stFn(order.paymentStatus)) : ""}</p>`}
${note ? `<p>${escapeHtml(note)}</p>` : ""}
${pickupExtra}
${orderTotalsBlock(order, lang)}
${supportContactHtml(getStorePhone(), lang)}`
        : `<p>سلام ${nameHtml}،</p>
<p>وضعیت سفارش <strong dir="ltr">${escapeHtml(order.id || "")}</strong> به‌روزرسانی شد.</p>
${statusMsg ? `<p style="font-size:16px;font-weight:700">${escapeHtml(statusMsg)}</p>` : `<p style="font-size:18px;font-weight:800">${escapeHtml(stFn(order.status))}${order.paymentStatus ? " / پرداخت: " + escapeHtml(stFn(order.paymentStatus)) : ""}</p>`}
${note ? `<p>${escapeHtml(note)}</p>` : ""}
${pickupExtra}
${orderTotalsBlock(order, lang)}
${supportContactHtml(getStorePhone(), lang)}`,
    });
    return send(to, "MAHO Market — " + title + " (" + (order.id || "") + ")", html, supportContactText(getStorePhone(), lang));
  }

  function hesabPayStatus(to, order) {
    return orderStatus(to, order, "", order.lang);
  }

  function campaignEmail(to, opts) {
    opts = opts || {};
    const subject = opts.subject || "MAHO Market";
    const message = String(opts.message || "");
    const paragraphs = message.split(/\n+/).map((p) => p.trim()).filter(Boolean)
      .map((p) => `<p>${escapeHtml(p)}</p>`).join("");
    const products = Array.isArray(opts.products) ? opts.products : [];
    const base = (siteUrl || "https://mahomarket.com").replace(/\/+$/, "");
    const { resolveProductImageUrl } = require("./media-url");
    const productHtml = products.map((p) => {
      const url = p.url || (base + "/p/" + encodeURIComponent(p.code || ""));
      const absImg = resolveProductImageUrl(p.image || p, { siteUrl: base, logoUrl });
      const alt = (p.name || p.code || "MAHO product") + (p.code ? (" (" + p.code + ")") : "");
      const img = absImg
        ? `<img src="${escapeHtml(absImg)}" alt="${escapeHtml(alt)}" width="220" style="width:100%;max-width:220px;height:auto;border:0;border-radius:10px;display:block;margin:0 auto 10px;object-fit:contain">`
        : "";
      const priceLine = p.oldPrice
        ? `<span style="text-decoration:line-through;color:#7a7368;margin-inline-end:8px">${escapeHtml(moneyAf(p.oldPrice, "fa"))}</span><strong>${escapeHtml(moneyAf(p.price, "fa"))}</strong>`
        : `<strong>${escapeHtml(moneyAf(p.price, "fa"))}</strong>`;
      return `<div style="border:1px solid #e6e0d4;border-radius:12px;padding:14px;margin:14px 0;text-align:center">
${img}
<div style="font-weight:800;font-size:16px;margin-bottom:4px">${escapeHtml(p.name || "")}</div>
<div style="font-size:12px;color:#7a7368;direction:ltr">${escapeHtml(p.code || "")}</div>
<div style="margin:8px 0">${priceLine}</div>
${ctaBtn(url, opts.ctaText || "مشاهده محصول")}
</div>`;
    }).join("");
    const cta = (!products.length && opts.ctaUrl && opts.ctaText)
      ? ctaBtn(opts.ctaUrl, opts.ctaText)
      : "";
    const unsub = opts.unsubscribeUrl
      ? `<p style="font-size:12px;color:#7a7368;margin-top:28px;text-align:center">
<a href="${escapeHtml(opts.unsubscribeUrl)}" style="color:#7a7368">لغو عضویت / Unsubscribe</a></p>`
      : "";
    const html = wrap({
      title: subject,
      preheader: message.slice(0, 120),
      bodyHtml: paragraphs + productHtml + cta + unsub,
      siteUrl, logoUrl,
      lang: "fa",
    });
    const text = message + (opts.unsubscribeUrl ? "\n\nUnsubscribe: " + opts.unsubscribeUrl : "");
    return send(to, subject, html, text);
  }

  function pickupReady(to, order, store, langArg) {
    const lang = normalizeLang(langArg, order);
    const isEn = lang === "en";
    const c = order.customer || {};
    const picked = (order && order.pickupStore) || store || {};
    const s = Object.assign({}, picked, {
      address: picked.address || picked.area || "",
      hours: picked.hours || "",
      phone: picked.phone || getStorePhone() || "",
      mapsUrl: picked.mapsUrl || "",
      instructions: picked.instructions || "",
    });
    if (!s.mapsUrl && s.lat != null && s.lng != null) {
      s.mapsUrl = "https://www.google.com/maps?q=" + encodeURIComponent(s.lat + "," + s.lng);
    }
    const title = isEn ? "Your order is ready for pickup | MAHO" : "سفارش شما آماده دریافت است | MAHO";
    const orderForBlock = Object.assign({}, order, {
      pickupStore: s,
      delivery: Object.assign({}, order.delivery || {}, { method: "pickup" }),
      _siteUrl: siteUrl,
      _logoUrl: logoUrl,
    });
    const nameHtml = `<span dir="auto">${escapeHtml(c.name || "")}</span>`;
    const html = wrap({
      title,
      preheader: title,
      siteUrl, logoUrl, lang,
      bodyHtml: isEn
        ? `<p>Hello ${nameHtml},</p>
<p>${escapeHtml(customerStatusCopy("ready_for_pickup", lang))}</p>
<p><strong>Order number:</strong> <span dir="ltr">${escapeHtml(order.id || "")}</span></p>
${storePickupBlock(orderForBlock, lang)}
${supportContactHtml(getStorePhone(), lang)}`
        : `<p>سلام ${nameHtml}،</p>
<p>${escapeHtml(customerStatusCopy("ready_for_pickup", lang))}</p>
<p><strong>شماره سفارش:</strong> <span dir="ltr">${escapeHtml(order.id || "")}</span></p>
${storePickupBlock(orderForBlock, lang)}
${supportContactHtml(getStorePhone(), lang)}`,
    });
    return send(to, title, html);
  }

  function pickupCompleted(to, order, langArg) {
    const lang = normalizeLang(langArg, order);
    const isEn = lang === "en";
    const c = order.customer || {};
    const title = isEn ? "Your order was picked up | MAHO" : "سفارش شما تحویل شد | MAHO";
    const html = wrap({
      title,
      preheader: title,
      siteUrl, logoUrl, lang,
      bodyHtml: isEn
        ? `<p>Hello ${escapeHtml(c.name || "")},</p>
<p>Thank you for shopping with us. Your order <strong dir="ltr">${escapeHtml(order.id || "")}</strong> was handed over at the MAHO store.</p>
${supportContactHtml(getStorePhone(), lang)}`
        : `<p>سلام ${escapeHtml(c.name || "")}،</p>
<p>از خرید شما سپاسگزاریم. سفارش شما از فروشگاه MAHO تحویل داده شد.</p>
<p><strong>نمبر سفارش:</strong> <span dir="ltr">${escapeHtml(order.id || "")}</span></p>
${supportContactHtml(getStorePhone(), lang)}`,
    });
    return send(to, title, html);
  }

  function giveawayWinner(to, opts) {
    opts = opts || {};
    const title = "تبریک! برنده قرعه‌کشی MAHO";
    const store = opts.store || {};
    const claimCode = String(opts.claimCode || "").trim();
    const wa = String(opts.whatsapp || getOfficialWhatsApp() || "").trim();
    const deadline = opts.claimDeadline ? Number(opts.claimDeadline) : null;
    const deadlineStr = deadline && Number.isFinite(deadline)
      ? new Date(deadline).toLocaleString("fa-AF", { dateStyle: "medium", timeStyle: "short" })
      : "";
    const hours = store.hours ? `<p><strong>ساعات کار:</strong> ${escapeHtml(store.hours)}</p>` : "";
    const maps = store.mapsUrl
      ? `<p><a href="${escapeHtml(store.mapsUrl)}" style="color:#c8a35f;font-weight:700" target="_blank" rel="noopener">موقعیت روی Google Maps</a></p>`
      : "";
    const codeBlock = claimCode
      ? `<div style="margin:20px 0;padding:16px;border:2px dashed #c8a35f;border-radius:12px;text-align:center;background:#fbf8f1">
<div style="font-size:13px;color:#7a7368;margin-bottom:6px">کد دریافت جایزه</div>
<div style="font-size:22px;font-weight:800;letter-spacing:1px;direction:ltr">${escapeHtml(claimCode)}</div>
</div>
<p style="font-weight:700">برای دریافت جایزه، لطفاً کد زیر را هنگام مراجعه یا تماس ارائه کنید.</p>`
      : "";
    const waBlock = wa
      ? `<p><strong>واتسپ MAHO:</strong> <span dir="ltr">${escapeHtml(wa)}</span></p>`
      : "";
    const phoneBlock = store.phone
      ? `<p><strong>تلفن فروشگاه:</strong> <span dir="ltr">${escapeHtml(store.phone)}</span></p>`
      : "";
    const storeBlock = store.name
      ? `<div style="margin:16px 0;padding:14px;border:1px solid #e6e0d4;border-radius:12px">
<p style="margin:0 0 6px"><strong>فروشگاه دریافت جایزه:</strong> ${escapeHtml(store.name)}</p>
${store.address ? `<p style="margin:0 0 6px"><strong>آدرس:</strong> ${escapeHtml(store.address)}</p>` : ""}
${phoneBlock}${hours}${maps}
</div>`
      : "";
    const deadlineBlock = deadlineStr
      ? `<p><strong>مهلت دریافت:</strong> ${escapeHtml(deadlineStr)}</p>`
      : "";
    const html = wrap({
      title,
      preheader: title + (claimCode ? (" — " + claimCode) : ""),
      siteUrl, logoUrl, lang: "fa",
      bodyHtml: `<p>سلام ${escapeHtml(opts.name || "")}،</p>
<p>تبریک! شما در قرعه‌کشی <strong>${escapeHtml(opts.title || "")}</strong> برنده شدید.</p>
<p>جایزه: <strong>${escapeHtml(opts.prize || "")}</strong></p>
${codeBlock}
${storeBlock}
${deadlineBlock}
${waBlock}
${supportContactHtml(getOfficialWhatsApp() || getStorePhone(), "fa")}`,
    });
    return send(to, "MAHO Market — " + title, html);
  }

  function googleReviewInvite(to, order, reviewUrl, langArg) {
    const lang = normalizeLang(langArg, order);
    const isEn = lang === "en";
    const title = isEn ? "Share your experience on Google" : "نظر خود را در Google ثبت کنید";
    const html = wrap({
      title,
      preheader: title,
      siteUrl, logoUrl, lang,
      bodyHtml: isEn
        ? `<p>Hello ${escapeHtml((order.customer && order.customer.name) || "")},</p>
<p>Thank you for your order <strong dir="ltr">${escapeHtml(order.id || "")}</strong>. If you wish, you can leave a Google review:</p>
${ctaBtn(reviewUrl, "Leave a Google review")}
${supportContactHtml(getStorePhone(), lang)}`
        : `<p>سلام ${escapeHtml((order.customer && order.customer.name) || "")}،</p>
<p>از سفارش <strong dir="ltr">${escapeHtml(order.id || "")}</strong> سپاسگزاریم. در صورت تمایل می‌توانید نظر خود را در Google ثبت کنید:</p>
${ctaBtn(reviewUrl, "ثبت نظر در Google")}
${supportContactHtml(getStorePhone(), lang)}`,
    });
    return send(to, "MAHO Market — " + title, html, reviewUrl);
  }

  function feedbackRequest(to, order, feedbackUrl, lang) {
    const isEn = lang === "en";
    const title = isEn ? "How was your experience?" : "نظر شما درباره سفارش";
    const html = wrap({
      title,
      preheader: title,
      lang: isEn ? "en" : "fa",
      siteUrl, logoUrl,
      bodyHtml: isEn
        ? `<p>Hi ${escapeHtml((order.customer && order.customer.name) || "")},</p>
<p>Thank you for your purchase. Your order <strong dir="ltr">${escapeHtml(order.id || "")}</strong> is complete. Please rate your experience:</p>
${ctaBtn(feedbackUrl, "Leave feedback")}
${supportContactHtml(getStorePhone(), "en")}`
        : `<p>سلام ${escapeHtml((order.customer && order.customer.name) || "")}،</p>
<p>از خرید شما سپاسگزاریم. سفارش <strong dir="ltr">${escapeHtml(order.id || "")}</strong> تکمیل شد. لطفاً تجربه خود را امتیاز دهید:</p>
${ctaBtn(feedbackUrl, "ثبت نظر و امتیاز")}
${supportContactHtml(getStorePhone(), "fa")}`,
    });
    return send(to, "MAHO Market — " + title, html, feedbackUrl);
  }

  return {
    send,
    verificationCode,
    welcome,
    passwordReset,
    orderConfirmation,
    orderAdminNotify,
    orderStatus,
    hesabPayStatus,
    campaignEmail,
    feedbackRequest,
    pickupReady,
    pickupCompleted,
    giveawayWinner,
    googleReviewInvite,
    statusLabelFa,
    payLabel,
    supportContactHtml,
    supportContactText,
  };
}

module.exports = { buildMailer, escapeHtml, moneyAf, supportContactHtml, supportContactText, statusLabelFa: function (s) {
  const m = {
    new: "منتظر تأیید", pending: "منتظر تأیید", confirmed: "تأییدشده",
    dispatched: "ارسال‌شده", delivered: "تحویل‌شده", cancelled: "لغوشده",
    awaiting_payment: "منتظر تأیید پرداخت حساب‌پی", receipt_submitted: "رسید فرستاده شد",
    under_review: "در حال بررسی", payment_confirmed: "پرداخت تأیید شد",
    payment_rejected: "پرداخت رد شد", return_requested: "درخواست برگشت",
    return_approved: "برگشت تأییدشده", return_rejected: "برگشت ردشده",
    return_completed: "برگشت تکمیل‌شده",
  };
  return m[s] || s || "—";
} };
