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
  let rows = items.map((it) => {
    const line = (it.price || 0) * (it.qty || 1);
    const img = it.image
      ? `<img src="${escapeHtml(it.image)}" alt="" width="48" height="48" style="object-fit:cover;border-radius:8px;display:block">`
      : "";
    const disc = it.discount ? escapeHtml(String(it.discount)) + (isEn ? "%" : "٪") : "—";
    const nm = isEn ? (it.name_en || it.name || "") : (it.name || "");
    const sizeLbl = isEn ? "Size" : "سایز";
    const colorLbl = isEn ? "Color" : "رنگ";
    return `<tr>
<td style="padding:8px;border-bottom:1px solid #eee;vertical-align:top">${img}</td>
<td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(nm)}${it.size ? "<br><small>" + sizeLbl + ": " + escapeHtml(it.size) + "</small>" : ""}${it.color ? "<br><small>" + colorLbl + ": " + escapeHtml(it.color) + "</small>" : ""}</td>
<td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${escapeHtml(String(it.qty || 1))}</td>
<td style="padding:8px;border-bottom:1px solid #eee;text-align:left;direction:ltr">${moneyAf(it.price, lang)}</td>
<td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${disc}</td>
<td style="padding:8px;border-bottom:1px solid #eee;text-align:left;direction:ltr">${moneyAf(line, lang)}</td>
</tr>`;
  }).join("");
  const th = isEn
    ? ["Photo", "Product", "Qty", "Price", "Discount", "Total"]
    : ["عکس", "محصول", "تعداد", "قیمت", "تخفیف", "مجموع"];
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:13px;margin:16px 0">
<thead><tr style="background:#fbf8f1">
<th style="padding:8px;text-align:${isEn ? "left" : "right"}">${th[0]}</th>
<th style="padding:8px;text-align:${isEn ? "left" : "right"}">${th[1]}</th>
<th style="padding:8px;text-align:center">${th[2]}</th>
<th style="padding:8px;text-align:left">${th[3]}</th>
<th style="padding:8px;text-align:center">${th[4]}</th>
<th style="padding:8px;text-align:left">${th[5]}</th>
</tr></thead>
<tbody>${rows}</tbody>
</table>`;
}

function orderTotalsBlock(order, lang) {
  const isEn = lang === "en";
  const itemsTotal = order.itemsTotal != null ? order.itemsTotal : (order.items || []).reduce((s, it) => s + (it.price || 0) * (it.qty || 1), 0);
  const fee = order.deliveryFee || 0;
  const discount = order.discountTotal || 0;
  const total = order.total != null ? order.total : itemsTotal + fee - discount;
  return `<table role="presentation" width="100%" style="font-size:14px;margin:12px 0">
<tr><td>${isEn ? "Subtotal" : "جمع محصولات (Subtotal)"}</td><td style="text-align:left;direction:ltr">${moneyAf(itemsTotal, lang)}</td></tr>
<tr><td>${isEn ? "Delivery fee" : "هزینهٔ دلیوری"}</td><td style="text-align:left;direction:ltr">${fee ? moneyAf(fee, lang) : (isEn ? "Free" : "رایگان")}</td></tr>
${discount ? `<tr><td>${isEn ? "Discount" : "تخفیف نهایی"}</td><td style="text-align:left;direction:ltr">− ${moneyAf(discount, lang)}</td></tr>` : ""}
<tr><td style="font-weight:800;padding-top:8px">${isEn ? "Grand total" : "مبلغ نهایی"}</td><td style="text-align:left;direction:ltr;font-weight:800;padding-top:8px">${moneyAf(total, lang)}</td></tr>
</table>`;
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
    const recv = (order.delivery && (order.delivery.method === "deliver" || order.delivery.method === "delivery"))
      ? (isEn ? "Delivery" : "دلیوری")
      : (isEn ? "Store pickup" : "حضوری");
    const html = wrap({
      title: isEn ? "Order confirmation" : "تأیید سفارش",
      preheader: (isEn ? "Order " : "سفارش ") + (order.id || ""),
      siteUrl, logoUrl, lang,
      bodyHtml: isEn
        ? `<p>Hello ${escapeHtml(c.name || "")},</p>
<p>Thank you for shopping at MAHO Market. Your order has been placed.</p>
<p><strong>Order no:</strong> <span dir="ltr">${escapeHtml(order.id || "")}</span><br>
<strong>Date:</strong> ${escapeHtml(new Date(order.date || Date.now()).toLocaleString("en-US"))}</p>
${orderItemsTable(order, lang)}
${orderTotalsBlock(order, lang)}
<p><strong>Payment:</strong> ${escapeHtml(payLabel(order.payment, lang))}<br>
<strong>Payment status:</strong> ${escapeHtml(stFn(order.paymentStatus || (order.payment === "hesab" || order.payment === "bank" || order.payment === "card" ? "awaiting_payment" : "—")))}<br>
<strong>Order status:</strong> ${escapeHtml(stFn(order.status))}<br>
<strong>Fulfillment:</strong> ${escapeHtml(recv)}</p>
<p><strong>Delivery address:</strong> ${escapeHtml(c.address || "—")}<br>
<strong>Phone:</strong> <span dir="ltr">${escapeHtml(c.phone || "")}</span></p>
${trackUrl ? ctaBtn(trackUrl, "View / track order") : ""}
${supportContactHtml(getStorePhone(), lang)}`
        : `<p>سلام ${escapeHtml(c.name || "")}،</p>
<p>از خرید شما در MAHO Market سپاس‌گزاریم. سفارش شما ثبت شد.</p>
<p><strong>نمبر سفارش:</strong> <span dir="ltr">${escapeHtml(order.id || "")}</span><br>
<strong>تاریخ:</strong> ${escapeHtml(new Date(order.date || Date.now()).toLocaleString("fa-AF"))}</p>
${orderItemsTable(order, lang)}
${orderTotalsBlock(order, lang)}
<p><strong>روش پرداخت:</strong> ${escapeHtml(payLabel(order.payment, lang))}<br>
<strong>وضعیت پرداخت:</strong> ${escapeHtml(stFn(order.paymentStatus || (order.payment === "hesab" || order.payment === "bank" || order.payment === "card" ? "awaiting_payment" : "—")))}<br>
<strong>وضعیت سفارش:</strong> ${escapeHtml(stFn(order.status))}<br>
<strong>روش دریافت:</strong> ${escapeHtml(recv)}</p>
<p><strong>آدرس دلیوری:</strong> ${escapeHtml(c.address || "—")}<br>
<strong>نمبر تماس:</strong> <span dir="ltr">${escapeHtml(c.phone || "")}</span></p>
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
${orderItemsTable(order, "fa")}
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
    const html = wrap({
      title,
      preheader: order.id || "",
      siteUrl, logoUrl, lang,
      bodyHtml: isEn
        ? `<p>Hello ${escapeHtml(c.name || "")},</p>
<p>Your order <strong dir="ltr">${escapeHtml(order.id || "")}</strong> was updated:</p>
<p style="font-size:18px;font-weight:800">${escapeHtml(stFn(order.status))}${order.paymentStatus ? " / payment: " + escapeHtml(stFn(order.paymentStatus)) : ""}</p>
${note ? `<p>${escapeHtml(note)}</p>` : ""}
${orderTotalsBlock(order, lang)}
${supportContactHtml(getStorePhone(), lang)}`
        : `<p>سلام ${escapeHtml(c.name || "")}،</p>
<p>وضعیت سفارش <strong dir="ltr">${escapeHtml(order.id || "")}</strong> به‌روزرسانی شد:</p>
<p style="font-size:18px;font-weight:800">${escapeHtml(stFn(order.status))}${order.paymentStatus ? " / پرداخت: " + escapeHtml(stFn(order.paymentStatus)) : ""}</p>
${note ? `<p>${escapeHtml(note)}</p>` : ""}
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
    const cta = (opts.ctaUrl && opts.ctaText)
      ? ctaBtn(opts.ctaUrl, opts.ctaText)
      : "";
    const unsub = opts.unsubscribeUrl
      ? `<p style="font-size:12px;color:#7a7368;margin-top:28px;text-align:center">
<a href="${escapeHtml(opts.unsubscribeUrl)}" style="color:#7a7368">لغو عضویت / Unsubscribe</a></p>`
      : "";
    const html = wrap({
      title: subject,
      preheader: message.slice(0, 120),
      bodyHtml: paragraphs + cta + unsub,
      siteUrl, logoUrl,
      lang: "fa",
    });
    const text = message + (opts.unsubscribeUrl ? "\n\nUnsubscribe: " + opts.unsubscribeUrl : "");
    return send(to, subject, html, text);
  }

  function feedbackRequest(to, order, feedbackUrl, lang) {
    const isEn = lang === "en";
    const title = isEn ? "How was your delivery?" : "نظر شما درباره تحویل سفارش";
    const html = wrap({
      title,
      preheader: title,
      lang: isEn ? "en" : "fa",
      siteUrl, logoUrl,
      bodyHtml: isEn
        ? `<p>Hi ${escapeHtml((order.customer && order.customer.name) || "")},</p>
<p>Your order <strong dir="ltr">${escapeHtml(order.id || "")}</strong> was delivered. Please rate your experience:</p>
${ctaBtn(feedbackUrl, "Leave feedback")}
${supportContactHtml(getStorePhone(), "en")}`
        : `<p>سلام ${escapeHtml((order.customer && order.customer.name) || "")}،</p>
<p>سفارش <strong dir="ltr">${escapeHtml(order.id || "")}</strong> تحویل شد. لطفاً تجربه خود را امتیاز دهید:</p>
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
