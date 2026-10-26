/* Same language preference as the storefront (localStorage maho_lang).
   Pages that cannot load main.js use data-i18n / data-i18n-ph and MAHOPageLang.t. */
(function (global) {
  "use strict";
  function current() {
    try { return localStorage.getItem("maho_lang") === "en" ? "en" : "fa"; }
    catch (_) { return "fa"; }
  }
  function t(dict, key) {
    var lang = current();
    var pack = (dict && dict[lang]) || {};
    if (pack[key] != null && pack[key] !== "") return pack[key];
    var fa = (dict && dict.fa) || {};
    return fa[key] != null ? fa[key] : key;
  }
  function apply(dict) {
    var lang = current();
    document.documentElement.lang = lang === "en" ? "en" : "fa";
    document.documentElement.dir = lang === "en" ? "ltr" : "rtl";
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = t(dict, el.getAttribute("data-i18n"));
    });
    document.querySelectorAll("[data-i18n-ph]").forEach(function (el) {
      el.setAttribute("placeholder", t(dict, el.getAttribute("data-i18n-ph")));
    });
    document.querySelectorAll("[data-lang-toggle]").forEach(function (el) {
      el.textContent = lang === "en" ? "Persian" : "English";
    });
  }
  function setLang(lang, dict) {
    var next = lang === "en" ? "en" : "fa";
    try { localStorage.setItem("maho_lang", next); } catch (_) {}
    apply(dict);
    document.dispatchEvent(new CustomEvent("maho:lang"));
  }
  global.MAHOPageLang = { current: current, t: t, apply: apply, setLang: setLang };
})(window);
