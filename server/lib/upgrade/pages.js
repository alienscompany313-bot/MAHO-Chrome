"use strict";

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shell(title, body, opts) {
  const robots = opts && opts.robots ? opts.robots : "index, follow";
  const desc = opts && opts.description ? opts.description : "MAHO Market";
  return "<!doctype html>\n<html lang=\"fa\" dir=\"rtl\">\n<head>\n" +
    "<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n" +
    "<title>" + esc(title) + "</title>\n" +
    "<meta name=\"description\" content=\"" + esc(desc) + "\">\n" +
    "<meta name=\"robots\" content=\"" + esc(robots) + "\">\n" +
    "<link rel=\"icon\" href=\"/icon-192.png\">\n" +
    "<link rel=\"stylesheet\" href=\"/css/styles.css\">\n" +
    "<style>body{background:#f7f3ea;color:#1a1509} .page{max-width:720px;margin:32px auto;padding:0 16px 48px} .card{background:#fffdf8;border:1px solid #e6dcc6;border-radius:18px;padding:22px} a.btn{display:inline-block;margin-top:8px}</style>\n" +
    "</head>\n<body>\n<main class=\"page\">\n" + body + "\n</main>\n</body>\n</html>\n";
}

function linksPage(rows, qrDataUri) {
  const items = rows.map((row) => {
    const label = row.label || row.label_en || "MAHO";
    return "<a class=\"btn btn-outline\" style=\"display:block;margin:10px 0;text-align:center\" href=\"" + esc(row.url) + "\" target=\"_blank\" rel=\"noopener\">" + esc(label) + (row.label_en ? " · " + esc(row.label_en) : "") + "</a>";
  }).join("");
  const qr = qrDataUri
    ? "<div style=\"text-align:center;margin-top:18px\"><img alt=\"QR code for MAHO links\" width=\"220\" height=\"220\" src=\"" + qrDataUri + "\"><p><a href=\"/links/qr.png\">PNG</a> · <a href=\"/links/qr.svg\">SVG</a></p></div>"
    : "";
  return shell("لینک‌های ماهو | MAHO", 
    "<div class=\"card\" style=\"text-align:center\"><img src=\"/assets/brand/maho-logo.jpg\" alt=\"MAHO\" width=\"180\" height=\"180\" style=\"width:180px;height:auto\">" +
    "<h1>ماهو</h1><p>لباس و لوازم بانوان · Women's clothing &amp; accessories</p>" +
    items + qr + "<p><a href=\"/\">بازگشت به فروشگاه</a></p></div>",
    { description: "Official MAHO Market links" });
}

function policyPage(kind, policy) {
  const title = policy
    ? ((policy.title || "") + " | MAHO Market")
    : (kind === "privacy" ? "حریم خصوصی | MAHO Market" : "قوانین و شرایط | MAHO Market");
  if (!policy) {
    return shell(title,
      "<div class=\"card\"><h1>" + (kind === "privacy" ? "پالیسی حریم خصوصی" : "قوانین و شرایط") + "</h1>" +
      "<p>این سند هنوز از طرف فروشگاه منتشر نشده است. نسخه پیش‌نویس در سایت نشان داده نمی‌شود.</p>" +
      "<p>This document has not been published yet.</p><p><a href=\"/\">فروشگاه</a></p></div>",
      { robots: "noindex, follow", description: "MAHO policy" });
  }
  const pdf = policy.hasPdf ? "<p><a href=\"/api/policies/" + kind + "/pdf\">دانلود PDF</a></p>" : "";
  return shell(title,
    "<div class=\"card\"><p><a href=\"/\">MAHO Market</a></p><h1>" + esc(policy.title || title) + "</h1>" +
    "<p dir=\"ltr\">" + esc(policy.title_en || "") + "</p>" +
    "<p>نسخه " + esc(policy.version || "") + (policy.publishedAt ? " · " + new Date(policy.publishedAt).toISOString().slice(0, 10) : "") + "</p>" +
    "<div style=\"white-space:pre-wrap\">" + esc(policy.body || "") + "</div>" +
    "<hr><div style=\"white-space:pre-wrap\" dir=\"ltr\">" + esc(policy.body_en || "") + "</div>" +
    pdf + "</div>",
    { description: (policy.body_en || policy.body || "MAHO policy").slice(0, 180) });
}

function verifyPage(status) {
  const label = status === "active" ? "فعال / Active" : (status === "inactive" ? "غیرفعال / Inactive" : (status === "revoked" ? "باطل شده / Revoked" : "نامعتبر / Not found"));
  const known = status === "active" || status === "inactive" || status === "revoked";
  return shell("تأیید کارت مشتری | MAHO",
    "<div class=\"card\" style=\"text-align:center\"><img src=\"/assets/brand/maho-logo.jpg\" alt=\"MAHO\" width=\"120\" height=\"120\" style=\"width:120px;height:auto\">" +
    "<h1>کارت مشتری ماهو</h1><p id=\"status\" style=\"font-size:22px;font-weight:800\">" + esc(label) + "</p>" +
    "<p>این صفحه فقط وضعیت کارت را نشان می‌دهد.</p>" +
    "<div id=\"staff\" hidden style=\"text-align:right;margin-top:16px\"></div></div>" +
    "<script>(function(){var token=location.pathname.split('/').pop();var t=localStorage.getItem('maho_api_admin_token')||'';" +
    "if(!t||!" + (known ? "true" : "false") + ")return;fetch('/api/admin/cards/lookup?token='+encodeURIComponent(token),{headers:{Authorization:'Bearer '+t},cache:'no-store'}).then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d};});}).then(function(x){if(!x.ok||!x.d||!x.d.name)return;var box=document.getElementById('staff');box.hidden=false;box.innerHTML='<h2>جزئیات برای کارمند</h2><p>'+String(x.d.name||'')+'</p><p dir=\\'ltr\\'>'+String(x.d.customerNo||'')+'</p><p dir=\\'ltr\\'>'+String(x.d.email||'')+'</p>';}).catch(function(){});})();</script>",
    { robots: "noindex, nofollow", description: "MAHO customer card status" });
}

module.exports = { linksPage, policyPage, verifyPage };
