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

function moneyAf(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("en-US") + " افغانی";
}

function brandWrap({ title, preheader, bodyHtml, siteUrl, logoUrl }) {
  const brand = "#c8a35f";
  const dark = "#141414";
  const logo = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="MAHO Market" width="72" height="72" style="border-radius:50%;border:2px solid ${brand};display:block;margin:0 auto 12px">`
    : `<div style="width:72px;height:72px;border-radius:50%;border:2px solid ${brand};color:${brand};font:700 28px Georgia,serif;display:flex;align-items:center;justify-content:center;margin:0 auto 12px">M</div>`;
  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<!--[if mso]><style>table{border-collapse:collapse}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:#f3efe7;font-family:Tahoma,Arial,sans-serif;color:#23201a;line-height:1.7">
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
<div>MAHO Market — لباس و لوازم بانوان</div>
<div>پشتیبانی: <a href="mailto:support@mahomarket.com" style="color:${brand}">support@mahomarket.com</a></div>
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

function orderItemsTable(order) {
  const items = order.items || [];
  let rows = items.map((it) => {
    const line = (it.price || 0) * (it.qty || 1);
    const img = it.image
      ? `<img src="${escapeHtml(it.image)}" alt="" width="48" height="48" style="object-fit:cover;border-radius:8px;display:block">`
      : "";
    const disc = it.discount ? escapeHtml(String(it.discount)) + "٪" : "—";
    return `<tr>
<td style="padding:8px;border-bottom:1px solid #eee;vertical-align:top">${img}</td>
<td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(it.name || "")}${it.size ? "<br><small>سایز: " + escapeHtml(it.size) + "</small>" : ""}${it.color ? "<br><small>رنگ: " + escapeHtml(it.color) + "</small>" : ""}</td>
<td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${escapeHtml(String(it.qty || 1))}</td>
<td style="padding:8px;border-bottom:1px solid #eee;text-align:left;direction:ltr">${moneyAf(it.price)}</td>
<td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${disc}</td>
<td style="padding:8px;border-bottom:1px solid #eee;text-align:left;direction:ltr">${moneyAf(line)}</td>
</tr>`;
  }).join("");
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:13px;margin:16px 0">
<thead><tr style="background:#fbf8f1">
<th style="padding:8px;text-align:right">عکس</th>
<th style="padding:8px;text-align:right">محصول</th>
<th style="padding:8px;text-align:center">تعداد</th>
<th style="padding:8px;text-align:left">قیمت</th>
<th style="padding:8px;text-align:center">تخفیف</th>
<th style="padding:8px;text-align:left">مجموع</th>
</tr></thead>
<tbody>${rows}</tbody>
</table>`;
}

function orderTotalsBlock(order) {
  const itemsTotal = order.itemsTotal != null ? order.itemsTotal : (order.items || []).reduce((s, it) => s + (it.price || 0) * (it.qty || 1), 0);
  const fee = order.deliveryFee || 0;
  const discount = order.discountTotal || 0;
  const total = order.total != null ? order.total : itemsTotal + fee - discount;
  return `<table role="presentation" width="100%" style="font-size:14px;margin:12px 0">
<tr><td>جمع محصولات (Subtotal)</td><td style="text-align:left;direction:ltr">${moneyAf(itemsTotal)}</td></tr>
<tr><td>هزینهٔ دلیوری</td><td style="text-align:left;direction:ltr">${fee ? moneyAf(fee) : "رایگان"}</td></tr>
${discount ? `<tr><td>تخفیف نهایی</td><td style="text-align:left;direction:ltr">− ${moneyAf(discount)}</td></tr>` : ""}
<tr><td style="font-weight:800;padding-top:8px">مبلغ نهایی</td><td style="text-align:left;direction:ltr;font-weight:800;padding-top:8px">${moneyAf(total)}</td></tr>
</table>`;
}

function payLabel(p) {
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

function buildMailer(opts) {
  const {
    sendRaw, fromName, fromEmail, replyTo, siteUrl, logoUrl, ordersNotifyEmail,
  } = opts;

  function send(to, subject, html, text) {
    return sendRaw({
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      replyTo: replyTo || "support@mahomarket.com",
      from: `"${fromName || "MAHO Market"}" <${fromEmail || "info@mahomarket.com"}>`,
    });
  }

  function verificationCode(to, code, name) {
    const html = brandWrap({
      title: "کود تأیید حساب",
      preheader: "کود تأیید MAHO Market",
      siteUrl, logoUrl,
      bodyHtml: `<p>سلام${name ? " " + escapeHtml(name) : ""}،</p>
<p>برای تأیید حساب خود در MAHO Market از کود زیر استفاده کنید:</p>
<p style="font-size:32px;font-weight:800;letter-spacing:6px;text-align:center;direction:ltr;color:#141414">${escapeHtml(code)}</p>
<p>این کود فقط <strong>۱۰ دقیقه</strong> اعتبار دارد. اگر شما این درخواست را نکرده‌اید، این پیام را نادیده بگیرید.</p>
<p style="font-size:12px;color:#7a7368">هرگز رمز عبور خود را با کسی شریک نسازید. MAHO هرگز رمز شما را در ایمیل نمی‌فرستد.</p>`,
    });
    return send(to, "MAHO Market — کود تأیید حساب", html, `کود تأیید: ${code}\nاعتبار: ۱۰ دقیقه`);
  }

  function welcome(to, { name, email }) {
    const html = brandWrap({
      title: "به MAHO خوش آمدید",
      preheader: "حساب شما تأیید شد",
      siteUrl, logoUrl,
      bodyHtml: `<p>سلام ${escapeHtml(name || "")}،</p>
<p>حساب شما با موفقیت ساخته و تأیید شد.</p>
<p>ایمیل ورود شما: <strong dir="ltr">${escapeHtml(email || to)}</strong></p>
<p>رمز عبور شما با موفقیت تنظیم شد. برای امنیت، رمز را نزد خود نگه دارید — ما هرگز رمز را در ایمیل نمی‌فرستیم.</p>
${ctaBtn((siteUrl || "https://mahomarket.com") + "/#account", "ورود به حساب")}
${ctaBtn((siteUrl || "https://mahomarket.com") + "/#products", "ادامهٔ خرید")}`,
    });
    return send(to, "MAHO Market — خوش آمدید", html);
  }

  function passwordReset(to, { resetUrl, name }) {
    const html = brandWrap({
      title: "بازیابی رمز عبور",
      preheader: "لینک بازیابی رمز MAHO",
      siteUrl, logoUrl,
      bodyHtml: `<p>سلام${name ? " " + escapeHtml(name) : ""}،</p>
<p>درخواست بازیابی رمز برای حساب MAHO دریافت شد. روی دکمهٔ زیر کلیک کنید (لینک کوتاه‌مدت و یک‌بارمصرف است):</p>
${ctaBtn(resetUrl, "تنظیم رمز جدید")}
<p style="font-size:12px;color:#7a7368">اگر شما این درخواست را نکرده‌اید، این ایمیل را نادیده بگیرید. رمز قبلی شما تغییر نمی‌کند.</p>
<p style="font-size:12px;color:#7a7368">MAHO هرگز رمز عبور را در ایمیل نمی‌فرستد.</p>`,
    });
    return send(to, "MAHO Market — بازیابی رمز عبور", html);
  }

  function orderConfirmation(to, order, trackUrl) {
    const c = order.customer || {};
    const html = brandWrap({
      title: "تأیید سفارش",
      preheader: "سفارش " + (order.id || ""),
      siteUrl, logoUrl,
      bodyHtml: `<p>سلام ${escapeHtml(c.name || "")}،</p>
<p>از خرید شما در MAHO Market سپاس‌گزاریم. سفارش شما ثبت شد.</p>
<p><strong>نمبر سفارش:</strong> <span dir="ltr">${escapeHtml(order.id || "")}</span><br>
<strong>تاریخ:</strong> ${escapeHtml(new Date(order.date || Date.now()).toLocaleString("fa-AF"))}</p>
${orderItemsTable(order)}
${orderTotalsBlock(order)}
<p><strong>روش پرداخت:</strong> ${escapeHtml(payLabel(order.payment))}<br>
<strong>وضعیت پرداخت:</strong> ${escapeHtml(statusLabelFa(order.paymentStatus || (order.payment === "hesab" || order.payment === "bank" || order.payment === "card" ? "awaiting_payment" : "—")))}<br>
<strong>وضعیت سفارش:</strong> ${escapeHtml(statusLabelFa(order.status))}</p>
<p><strong>آدرس دلیوری:</strong> ${escapeHtml(c.address || "—")}<br>
<strong>نمبر تماس:</strong> <span dir="ltr">${escapeHtml(c.phone || "")}</span></p>
${trackUrl ? ctaBtn(trackUrl, "مشاهده / پیگیری سفارش") : ""}
<p>سوال دارید؟ با <a href="mailto:support@mahomarket.com">support@mahomarket.com</a> به تماس شوید.</p>`,
    });
    return send(to, "MAHO Market — تأیید سفارش " + (order.id || ""), html);
  }

  function orderAdminNotify(order) {
    const to = ordersNotifyEmail || "orders@mahomarket.com";
    const c = order.customer || {};
    const html = brandWrap({
      title: "سفارش جدید",
      preheader: order.id || "",
      siteUrl, logoUrl,
      bodyHtml: `<p>یک سفارش جدید ثبت شد.</p>
<p><strong>نمبر:</strong> ${escapeHtml(order.id || "")}<br>
<strong>مشتری:</strong> ${escapeHtml(c.name || "")} ${order.guest ? "(مهمان)" : ""}<br>
<strong>ایمیل:</strong> <span dir="ltr">${escapeHtml(c.email || "")}</span><br>
<strong>تماس:</strong> <span dir="ltr">${escapeHtml(c.phone || "")}</span><br>
<strong>پرداخت:</strong> ${escapeHtml(payLabel(order.payment))}<br>
<strong>مبلغ:</strong> ${moneyAf(order.total)}</p>
${orderItemsTable(order)}
${orderTotalsBlock(order)}
${ctaBtn((siteUrl || "https://mahomarket.com") + "/admin.html", "بازکردن پنل مدیر")}`,
    });
    return send(to, "MAHO — سفارش جدید " + (order.id || ""), html);
  }

  function orderStatus(to, order, note) {
    const c = order.customer || {};
    const titles = {
      confirmed: "سفارش تأیید شد",
      dispatched: "سفارش ارسال شد",
      delivered: "سفارش تحویل شد",
      cancelled: "سفارش لغو شد",
      payment_confirmed: "پرداخت تأیید شد",
      payment_rejected: "پرداخت رد شد",
      awaiting_payment: "در انتظار پرداخت",
      receipt_submitted: "رسید دریافت شد",
      under_review: "پرداخت در حال بررسی",
    };
    const title = titles[order.status] || titles[order.paymentStatus] || "به‌روزرسانی سفارش";
    const html = brandWrap({
      title,
      preheader: order.id || "",
      siteUrl, logoUrl,
      bodyHtml: `<p>سلام ${escapeHtml(c.name || "")}،</p>
<p>وضعیت سفارش <strong dir="ltr">${escapeHtml(order.id || "")}</strong> به‌روزرسانی شد:</p>
<p style="font-size:18px;font-weight:800">${escapeHtml(statusLabelFa(order.status))}${order.paymentStatus ? " / پرداخت: " + escapeHtml(statusLabelFa(order.paymentStatus)) : ""}</p>
${note ? `<p>${escapeHtml(note)}</p>` : ""}
${orderTotalsBlock(order)}
<p>پشتیبانی: <a href="mailto:support@mahomarket.com">support@mahomarket.com</a></p>`,
    });
    return send(to, "MAHO Market — " + title + " (" + (order.id || "") + ")", html);
  }

  function hesabPayStatus(to, order) {
    return orderStatus(to, order);
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
    statusLabelFa,
    payLabel,
  };
}

module.exports = { buildMailer, escapeHtml, moneyAf, statusLabelFa: function (s) {
  const m = {
    new: "جدید", pending: "در انتظار تایید", confirmed: "تأیید شد",
    dispatched: "ارسال شد", delivered: "تحویل شد", cancelled: "لغو شد",
    awaiting_payment: "در انتظار پرداخت", receipt_submitted: "رسید فرستاده شد",
    under_review: "در حال بررسی", payment_confirmed: "پرداخت تأیید شد",
    payment_rejected: "پرداخت رد شد", return_requested: "درخواست برگشت",
  };
  return m[s] || s || "—";
} };
