"use strict";

function safeHttpUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withProto = /^https?:\/\//i.test(raw) ? raw : ("https://" + raw);
  try {
    const url = new URL(withProto);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    if (url.username || url.password) return "";
    return url.toString();
  } catch (_) {
    return "";
  }
}

module.exports = { safeHttpUrl };
