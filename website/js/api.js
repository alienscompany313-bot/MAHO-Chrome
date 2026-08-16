/* ===========================================================
   MAHO API client — shared by storefront + admin.
   When the backend is reachable, catalog / accounts / orders
   sync centrally. Otherwise the site keeps working offline via
   localStorage (existing behaviour).
   =========================================================== */
(function (global) {
  "use strict";

  var URL_KEY = "maho_api_url";
  var USER_TOKEN_KEY = "maho_api_user_token";
  var ADMIN_TOKEN_KEY = "maho_api_admin_token";
  var STATUS_KEY = "maho_api_online";

  function trimSlash(u) {
    return String(u || "").replace(/\/+$/, "");
  }

  function configuredUrl() {
    if (global.MAHO_API_URL) return trimSlash(global.MAHO_API_URL);
    try {
      var fromLs = localStorage.getItem(URL_KEY);
      if (fromLs) return trimSlash(fromLs);
    } catch (_) {}
    /* Same-origin when the Node server serves website/ */
    if (typeof location !== "undefined" && /^https?:$/i.test(location.protocol) && location.hostname) {
      return "";
    }
    return "http://localhost:4000";
  }

  function setConfiguredUrl(url) {
    try {
      if (url) localStorage.setItem(URL_KEY, trimSlash(url));
      else localStorage.removeItem(URL_KEY);
    } catch (_) {}
  }

  function apiBase() {
    return configuredUrl();
  }

  function url(path) {
    var b = apiBase();
    var p = path.charAt(0) === "/" ? path : "/" + path;
    return b + p;
  }

  function getToken(kind) {
    try {
      return localStorage.getItem(kind === "admin" ? ADMIN_TOKEN_KEY : USER_TOKEN_KEY) || "";
    } catch (_) {
      return "";
    }
  }

  function setToken(kind, token) {
    try {
      var k = kind === "admin" ? ADMIN_TOKEN_KEY : USER_TOKEN_KEY;
      if (token) localStorage.setItem(k, token);
      else localStorage.removeItem(k);
    } catch (_) {}
  }

  function markOnline(v) {
    try {
      sessionStorage.setItem(STATUS_KEY, v ? "1" : "0");
    } catch (_) {}
  }

  function isOnlineCached() {
    try {
      return sessionStorage.getItem(STATUS_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function request(path, opts) {
    opts = opts || {};
    var headers = Object.assign({ Accept: "application/json" }, opts.headers || {});
    if (opts.body != null && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    if (opts.token) headers.Authorization = "Bearer " + opts.token;
    var init = {
      method: opts.method || "GET",
      headers: headers,
      cache: "no-store",
    };
    if (opts.body != null) init.body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
    return fetch(url(path), init).then(function (r) {
      return r
        .json()
        .catch(function () {
          return {};
        })
        .then(function (data) {
          if (!r.ok) {
            var err = new Error((data && data.error) || r.statusText || "request failed");
            err.status = r.status;
            err.data = data;
            throw err;
          }
          return data;
        });
    });
  }

  function health() {
    return request("/api/health")
      .then(function (d) {
        markOnline(true);
        return d;
      })
      .catch(function (e) {
        markOnline(false);
        throw e;
      });
  }

  function probe() {
    return health()
      .then(function (d) {
        return { ok: true, data: d };
      })
      .catch(function () {
        return { ok: false };
      });
  }

  /* ---- catalog ---- */
  function getCatalog() {
    return request("/api/catalog");
  }

  /* ---- user auth ---- */
  function register(body) {
    return request("/api/auth/register", { method: "POST", body: body });
  }
  function verify(body) {
    return request("/api/auth/verify", { method: "POST", body: body }).then(function (d) {
      if (d.token) setToken("user", d.token);
      return d;
    });
  }
  function login(body) {
    return request("/api/auth/login", { method: "POST", body: body }).then(function (d) {
      if (d.token) setToken("user", d.token);
      return d;
    });
  }
  function logoutUser() {
    setToken("user", null);
  }
  function me() {
    return request("/api/me", { token: getToken("user") });
  }
  function updateMe(body) {
    return request("/api/me", { method: "PUT", body: body, token: getToken("user") });
  }
  function verifyEmailChange(body) {
    return request("/api/me/verify-email", { method: "POST", body: body, token: getToken("user") });
  }

  /* ---- orders ---- */
  function placeOrder(body) {
    var headers = {};
    if (body && body.idempotencyKey) headers["Idempotency-Key"] = body.idempotencyKey;
    return request("/api/orders", { method: "POST", body: body, token: getToken("user") || undefined, headers: headers });
  }
  function getStock() {
    return request("/api/stock");
  }
  function forgotPassword(body) {
    return request("/api/auth/forgot-password", { method: "POST", body: body });
  }
  function resetPassword(body) {
    return request("/api/auth/reset-password", { method: "POST", body: body });
  }
  function resendCode(body) {
    return request("/api/auth/resend-code", { method: "POST", body: body });
  }
  function trackOrder(body) {
    return request("/api/orders/track", { method: "POST", body: body });
  }
  function submitHesabReceipt(id, body) {
    return request("/api/orders/" + encodeURIComponent(id) + "/hesab-receipt", {
      method: "POST", body: body, token: getToken("user") || undefined,
    });
  }
  function uploadHesabReceipt(id, file, meta) {
    var fd = new FormData();
    if (file) fd.append("file", file);
    meta = meta || {};
    if (meta.email) fd.append("email", meta.email);
    if (meta.txnId) fd.append("txnId", meta.txnId);
    if (meta.amount != null) fd.append("amount", String(meta.amount));
    if (meta.note) fd.append("note", meta.note);
    var headers = { Accept: "application/json" };
    var t = getToken("user");
    if (t) headers.Authorization = "Bearer " + t;
    return fetch(url("/api/orders/" + encodeURIComponent(id) + "/hesab-receipt-upload"), {
      method: "POST",
      headers: headers,
      body: fd,
      cache: "no-store",
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) {
          var err = new Error((data && data.error) || r.statusText || "upload failed");
          err.status = r.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }
  function adminCustomersTable() {
    return request("/api/admin/customers/table", { token: getToken("admin") });
  }
  function adminOrderDetail(id) {
    return request("/api/admin/orders/" + encodeURIComponent(id), { token: getToken("admin") });
  }
  function adminDeliveryQr(id) {
    return request("/api/admin/orders/" + encodeURIComponent(id) + "/delivery-qr", {
      method: "POST", body: {}, token: getToken("admin"),
    });
  }
  function adminRevokeDeliveryQr(id) {
    return request("/api/admin/orders/" + encodeURIComponent(id) + "/delivery-qr/revoke", {
      method: "POST", body: {}, token: getToken("admin"),
    });
  }
  function adminSetPaymentStatus(id, paymentStatus, note) {
    return request("/api/admin/orders/" + encodeURIComponent(id) + "/payment-status", {
      method: "POST", body: { paymentStatus: paymentStatus, note: note || "" }, token: getToken("admin"),
    });
  }
  function myOrders() {
    return request("/api/orders", { token: getToken("user") });
  }
  function cancelOrder(id) {
    return request("/api/orders/" + encodeURIComponent(id) + "/cancel", {
      method: "POST",
      body: {},
      token: getToken("user") || getToken("admin") || undefined,
    });
  }
  function returnOrder(id) {
    return request("/api/orders/" + encodeURIComponent(id) + "/return", {
      method: "POST",
      body: {},
      token: getToken("user") || undefined,
    });
  }
  function returnRequest(id, body) {
    return request("/api/orders/" + encodeURIComponent(id) + "/return-request", {
      method: "POST",
      body: body || {},
      token: getToken("user") || undefined,
    });
  }
  function checkDelivery(body) {
    return request("/api/delivery/check", { method: "POST", body: body || {} });
  }

  /* ---- admin ---- */
  function adminLogin(password) {
    return request("/api/admin/login", { method: "POST", body: { password: password } }).then(function (d) {
      if (d.token) setToken("admin", d.token);
      return d;
    });
  }
  function adminState() {
    return request("/api/admin/state", { token: getToken("admin") });
  }
  function adminSaveCatalog(payload) {
    return request("/api/admin/catalog", { method: "PUT", body: payload, token: getToken("admin") });
  }
  function adminOrders() {
    return request("/api/admin/orders", { token: getToken("admin") });
  }
  function adminCustomers() {
    return request("/api/admin/customers", { token: getToken("admin") });
  }
  function adminSetOrderStatus(id, status) {
    return request("/api/admin/orders/" + encodeURIComponent(id) + "/status", {
      method: "POST",
      body: { status: status },
      token: getToken("admin"),
    });
  }
  function adminUpload(files) {
    var fd = new FormData();
    var list = Array.isArray(files) ? files : [files];
    list.forEach(function (f) {
      if (f) fd.append("files", f);
    });
    var headers = { Accept: "application/json" };
    var t = getToken("admin");
    if (t) headers.Authorization = "Bearer " + t;
    return fetch(url("/api/admin/upload"), {
      method: "POST",
      headers: headers,
      body: fd,
      cache: "no-store",
    }).then(function (r) {
      return r
        .json()
        .catch(function () {
          return {};
        })
        .then(function (data) {
          if (!r.ok) {
            var err = new Error((data && data.error) || r.statusText || "upload failed");
            err.status = r.status;
            err.data = data;
            throw err;
          }
          return data;
        });
    });
  }
  function ensureAdmin(password) {
    if (getToken("admin")) {
      return adminState()
        .then(function () {
          return true;
        })
        .catch(function () {
          setToken("admin", null);
          if (!password) return Promise.reject(new Error("admin auth required"));
          return adminLogin(password).then(function () {
            return true;
          });
        });
    }
    if (!password) return Promise.reject(new Error("admin auth required"));
    return adminLogin(password).then(function () {
      return true;
    });
  }
  function logoutAdmin() {
    setToken("admin", null);
  }

  var STATUS_FA = {
    new: "جدید",
    pending: "جدید",
    confirmed: "تأیید شد",
    dispatched: "ارسال شد",
    delivered: "تحویل شد",
    awaiting_payment: "در انتظار پرداخت",
    cancelled: "لغو شد",
    return_requested: "درخواست برگشت",
    return_approved: "برگشت تأیید شد",
    return_rejected: "برگشت رد شد",
    return_completed: "برگشت تکمیل شد",
    receipt_submitted: "رسید فرستاده شد",
    under_review: "در حال بررسی",
    payment_confirmed: "پرداخت تأیید شد",
    payment_rejected: "پرداخت رد شد",
  };
  function statusLabel(code, lang) {
    var c = String(code || "");
    if (STATUS_FA[c]) return lang === "en" ? c.replace(/_/g, " ") : STATUS_FA[c];
    return c;
  }
  function statusCode(label) {
    var s = String(label || "");
    if (STATUS_FA[s]) return s;
    if (s === "new" || s.indexOf("جدید") >= 0) return "new";
    if (s.indexOf("ارسال") >= 0 || s === "dispatched") return "dispatched";
    if (s.indexOf("تحویل") >= 0 || s === "delivered") return "delivered";
    if (s.indexOf("تایید شده") >= 0 || s.indexOf("تأیید") >= 0 || s === "confirmed") return "confirmed";
    if (s.indexOf("لغو") >= 0 || s === "cancelled") return "cancelled";
    if (s.indexOf("انتظار پرداخت") >= 0 || s === "awaiting_payment") return "awaiting_payment";
    if (s.indexOf("برگشت") >= 0 && (s.indexOf("تکمیل") >= 0 || s === "return_completed")) return "return_completed";
    if (s.indexOf("برگشت") >= 0 && (s.indexOf("رد") >= 0 || s === "return_rejected")) return "return_rejected";
    if (s.indexOf("برگشت") >= 0 && (s.indexOf("تأیید") >= 0 || s.indexOf("تایید") >= 0 || s === "return_approved")) return "return_approved";
    if (s.indexOf("برگشت") >= 0 || s === "return_requested") return "return_requested";
    if (s.indexOf("انتظار") >= 0 || s === "pending") return "new";
    return s || "new";
  }

  function ensureHttps(u) {
    var s = String(u || "").trim();
    if (!s) return "";
    if (/^https:\/\//i.test(s)) return s;
    if (/^http:\/\//i.test(s)) return "https://" + s.slice(7);
    if (/^\/\//.test(s)) return "https:" + s;
    return "https://" + s.replace(/^\/+/, "");
  }

  /* ---- admin extras / staff / POS stubs ---- */
  function adminOrderBadges() {
    return request("/api/admin/badges/orders", { token: getToken("admin") });
  }
  function adminReturns() {
    return request("/api/admin/returns", { token: getToken("admin") });
  }
  function adminSoftDeleteCustomer(id) {
    return request("/api/admin/customers/" + encodeURIComponent(id) + "/soft-delete", {
      method: "POST", body: { confirm: "DELETE" }, token: getToken("admin"),
    });
  }
  function softDeleteCustomer(id) {
    return adminSoftDeleteCustomer(id);
  }
  function adminMe() {
    return request("/api/admin/me", { token: getToken("admin") });
  }
  function adminReturnResolve(id, body) {
    return request("/api/admin/orders/" + encodeURIComponent(id) + "/return-resolve", {
      method: "POST", body: body || {}, token: getToken("admin"),
    });
  }
  function staffLogin(body) {
    return request("/api/admin/staff-login", { method: "POST", body: body || {} }).then(function (d) {
      if (d.token) setToken("admin", d.token);
      return d;
    });
  }
  function listStaff() {
    return request("/api/admin/staff", { token: getToken("admin") });
  }
  function saveStaff(body, id) {
    if (id) {
      return request("/api/admin/staff/" + encodeURIComponent(id), {
        method: "PUT", body: body || {}, token: getToken("admin"),
      });
    }
    return request("/api/admin/staff", { method: "POST", body: body || {}, token: getToken("admin") });
  }
  function posSearch(q) {
    return request("/api/pos/products/search?q=" + encodeURIComponent(q || ""), { token: getToken("admin") });
  }
  function posSale(body) {
    return request("/api/pos/sale", { method: "POST", body: body || {}, token: getToken("admin") });
  }
  function posReturn(body) {
    return request("/api/pos/return", { method: "POST", body: body || {}, token: getToken("admin") });
  }
  function posShiftOpen(body) {
    return request("/api/pos/shift/open", { method: "POST", body: body || {}, token: getToken("admin") });
  }
  function posShiftClose(body) {
    return request("/api/pos/shift/close", { method: "POST", body: body || {}, token: getToken("admin") });
  }
  function posShiftCash(body) {
    return request("/api/pos/shift/cash", { method: "POST", body: body || {}, token: getToken("admin") });
  }
  function posReports(params) {
    var qs = [];
    params = params || {};
    if (params.from) qs.push("from=" + encodeURIComponent(params.from));
    if (params.to) qs.push("to=" + encodeURIComponent(params.to));
    return request("/api/pos/reports" + (qs.length ? "?" + qs.join("&") : ""), { token: getToken("admin") });
  }
  function posSales() {
    return request("/api/pos/sales", { token: getToken("admin") });
  }

  global.MAHOApi = {
    URL_KEY: URL_KEY,
    configuredUrl: configuredUrl,
    setConfiguredUrl: setConfiguredUrl,
    apiBase: apiBase,
    url: url,
    getToken: getToken,
    setToken: setToken,
    isOnlineCached: isOnlineCached,
    markOnline: markOnline,
    request: request,
    health: health,
    probe: probe,
    getCatalog: getCatalog,
    getStock: getStock,
    register: register,
    verify: verify,
    login: login,
    logoutUser: logoutUser,
    forgotPassword: forgotPassword,
    resetPassword: resetPassword,
    resendCode: resendCode,
    me: me,
    updateMe: updateMe,
    verifyEmailChange: verifyEmailChange,
    placeOrder: placeOrder,
    myOrders: myOrders,
    trackOrder: trackOrder,
    submitHesabReceipt: submitHesabReceipt,
    uploadHesabReceipt: uploadHesabReceipt,
    cancelOrder: cancelOrder,
    returnOrder: returnOrder,
    returnRequest: returnRequest,
    checkDelivery: checkDelivery,
    softDeleteCustomer: softDeleteCustomer,
    adminSoftDeleteCustomer: adminSoftDeleteCustomer,
    adminOrderBadges: adminOrderBadges,
    adminReturns: adminReturns,
    adminMe: adminMe,
    adminReturnResolve: adminReturnResolve,
    staffLogin: staffLogin,
    listStaff: listStaff,
    saveStaff: saveStaff,
    posSearch: posSearch,
    posSale: posSale,
    posReturn: posReturn,
    posShiftOpen: posShiftOpen,
    posShiftClose: posShiftClose,
    posShiftCash: posShiftCash,
    posReports: posReports,
    posSales: posSales,
    adminLogin: adminLogin,
    adminState: adminState,
    adminSaveCatalog: adminSaveCatalog,
    adminOrders: adminOrders,
    adminCustomers: adminCustomers,
    adminCustomersTable: adminCustomersTable,
    adminOrderDetail: adminOrderDetail,
    adminDeliveryQr: adminDeliveryQr,
    adminRevokeDeliveryQr: adminRevokeDeliveryQr,
    adminSetPaymentStatus: adminSetPaymentStatus,
    adminSetOrderStatus: adminSetOrderStatus,
    adminUpload: adminUpload,
    ensureAdmin: ensureAdmin,
    logoutAdmin: logoutAdmin,
    ensureHttps: ensureHttps,
    statusLabel: statusLabel,
    statusCode: statusCode,
  };
})(typeof window !== "undefined" ? window : globalThis);
