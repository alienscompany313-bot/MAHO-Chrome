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
            var err = new Error((data && (data.message || data.error)) || r.statusText || "request failed");
            err.status = r.status;
            err.data = data;
            err.error = data && data.error;
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

  function cancelOrderItem(orderId, lineId, body) {
    return request("/api/orders/" + encodeURIComponent(orderId) + "/items/" + encodeURIComponent(lineId) + "/cancel", {
      method: "POST",
      body: body || {},
      token: getToken("user") || undefined,
    });
  }
  function returnOrderItem(orderId, lineId, body) {
    return request("/api/orders/" + encodeURIComponent(orderId) + "/items/" + encodeURIComponent(lineId) + "/return-request", {
      method: "POST",
      body: body || {},
      token: getToken("user") || undefined,
    });
  }
  function reorder(orderId, body) {
    return request("/api/orders/" + encodeURIComponent(orderId) + "/reorder", {
      method: "POST",
      body: body || {},
      token: getToken("user") || undefined,
    });
  }
  function previewOrderValueDiscount(body) {
    return request("/api/checkout/order-value-discount", {
      method: "POST",
      body: body || {},
    });
  }
  function pickupStores(body) {
    return request("/api/checkout/pickup-stores", {
      method: "POST",
      body: body || {},
    });
  }
  function adminApproveItems(orderId, lineIds) {
    return request("/api/admin/orders/" + encodeURIComponent(orderId) + "/items/approve", {
      method: "POST",
      body: { lineIds: lineIds || [] },
      token: getToken("admin"),
    });
  }
  function adminRejectItems(orderId, lineIds, reason) {
    return request("/api/admin/orders/" + encodeURIComponent(orderId) + "/items/reject", {
      method: "POST",
      body: { lineIds: lineIds || [], reason: reason || "" },
      token: getToken("admin"),
    });
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
  function adminRequestFeedback(id) {
    return request("/api/admin/orders/" + encodeURIComponent(id) + "/request-feedback", {
      method: "POST",
      body: {},
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
    new: "در انتظار تأیید",
    pending: "در انتظار تأیید",
    confirmed: "تأیید شد",
    dispatched: "ارسال شد",
    delivered: "تحویل داده شد",
    awaiting_payment: "در انتظار پرداخت",
    cancelled: "لغو شد",
    return_requested: "درخواست برگشت ثبت شد",
    return_approved: "برگشت تأیید شد",
    return_rejected: "برگشت رد شد",
    return_completed: "برگشت تکمیل شد",
    receipt_submitted: "رسید فرستاده شد",
    under_review: "در حال بررسی",
    payment_confirmed: "پرداخت تأیید شد",
    payment_rejected: "پرداخت رد شد",
    partially_approved: "بخشی تأیید شد",
    partially_rejected: "بخشی رد شد",
    partially_shipped: "بخشی ارسال شد",
    partially_delivered: "بخشی تحویل داده شد",
    partially_cancelled: "بخشی لغو شد",
    partially_returned: "بخشی برگشت داده شد",
  };
  var STATUS_FA_PICKUP = {
    confirmed: "در حال آماده‌سازی",
    dispatched: "آماده تحویل از فروشگاه",
    delivered: "تحویل شد (فروشگاه)",
  };
  function isPickupOrder(order) {
    var m = order && order.delivery && order.delivery.method;
    return m === "pickup" || m === "store_pickup" || m === "store" || order.fulfillmentType === "store_pickup";
  }
  function statusLabel(code, lang, order) {
    var c = String(code || "");
    if (lang !== "en" && order && isPickupOrder(order) && STATUS_FA_PICKUP[c]) return STATUS_FA_PICKUP[c];
    if (STATUS_FA[c]) return lang === "en" ? c.replace(/_/g, " ") : STATUS_FA[c];
    return c;
  }
  var CANONICAL_STATUS = {
    new: 1, pending: 1, confirmed: 1, dispatched: 1, delivered: 1, cancelled: 1,
    awaiting_payment: 1, return_requested: 1, return_approved: 1, return_rejected: 1,
    return_completed: 1, receipt_submitted: 1, under_review: 1, payment_confirmed: 1,
    payment_rejected: 1, partially_approved: 1, partially_rejected: 1, partially_shipped: 1,
    partially_delivered: 1, partially_cancelled: 1, partially_returned: 1
  };
  function statusCode(label) {
    var s = String(label || "").trim();
    if (!s) return "new";
    /* Prefer canonical codes — never infer eligibility from translated UI labels. */
    if (CANONICAL_STATUS[s]) return s === "pending" ? "new" : s;
    if (STATUS_FA[s]) return s;
    /* Exact English display forms */
    var en = s.toLowerCase().replace(/\s+/g, "_");
    if (CANONICAL_STATUS[en]) return en === "pending" ? "new" : en;
    /* Legacy Persian label reverse-map (exact / careful). Avoid substring traps like «آماده ارسال» → dispatched. */
    if (s === "آماده ارسال" || s === "در حال آماده‌سازی" || s === "آماده تحویل از فروشگاه") return "confirmed";
    if (s === "بخشی لغو شد") return "partially_cancelled";
    if (s === "بخشی برگشت داده شد") return "partially_returned";
    if (s === "بخشی تأیید شد" || s === "بخشی تایید شد") return "partially_approved";
    if (s === "بخشی رد شد") return "partially_rejected";
    if (s === "بخشی ارسال شد") return "partially_shipped";
    if (s === "بخشی تحویل داده شد") return "partially_delivered";
    if (s === "در انتظار تأیید" || s === "در انتظار تایید" || s.indexOf("جدید") >= 0) return "new";
    if (s === "تأیید شد" || s === "تایید شد" || s === "تایید شده") return "confirmed";
    if (s === "ارسال شد") return "dispatched";
    if (s === "تحویل داده شد" || s === "تحویل شد (فروشگاه)") return "delivered";
    if (s === "لغو شد") return "cancelled";
    if (s.indexOf("انتظار پرداخت") >= 0) return "awaiting_payment";
    if (s.indexOf("برگشت") >= 0 && s.indexOf("تکمیل") >= 0) return "return_completed";
    if (s.indexOf("برگشت") >= 0 && s.indexOf("رد") >= 0) return "return_rejected";
    if (s.indexOf("برگشت") >= 0 && (s.indexOf("تأیید") >= 0 || s.indexOf("تایید") >= 0)) return "return_approved";
    if (s.indexOf("برگشت") >= 0) return "return_requested";
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
  function posLogin(body) {
    return request("/api/pos/login", { method: "POST", body: body || {} }).then(function (d) {
      if (d.token) {
        setToken("pos", d.token);
        /* POS workspace uses admin-slot APIs historically — mirror token for guard compatibility */
        setToken("admin", d.token);
      }
      return d;
    });
  }
  function posLogout() {
    var t = getToken("pos") || getToken("admin");
    return request("/api/pos/logout", { method: "POST", token: t }).then(function (d) {
      setToken("pos", null);
      setToken("admin", null);
      return d;
    }).catch(function () {
      setToken("pos", null);
      setToken("admin", null);
    });
  }
  function posMe() {
    return request("/api/pos/me", { token: getToken("pos") || getToken("admin") });
  }
  function posProducts(query) {
    var q = query || {};
    var qs = Object.keys(q).filter(function (k) { return q[k] != null && q[k] !== ""; })
      .map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(q[k]); }).join("&");
    return request("/api/pos/products" + (qs ? "?" + qs : ""), { token: getToken("pos") || getToken("admin") });
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
    return request("/api/pos/products/search?q=" + encodeURIComponent(q || ""), { token: getToken("pos") || getToken("admin") });
  }
  function posSale(body) {
    return request("/api/pos/sale", { method: "POST", body: body || {}, token: getToken("pos") || getToken("admin") });
  }
  function posReturn(body) {
    return request("/api/pos/return", { method: "POST", body: body || {}, token: getToken("pos") || getToken("admin") });
  }
  function posShiftOpen(body) {
    return request("/api/pos/shift/open", { method: "POST", body: body || {}, token: getToken("pos") || getToken("admin") });
  }
  function posShiftClose(body) {
    return request("/api/pos/shift/close", { method: "POST", body: body || {}, token: getToken("pos") || getToken("admin") });
  }
  function posShiftCash(body) {
    return request("/api/pos/shift/cash", { method: "POST", body: body || {}, token: getToken("pos") || getToken("admin") });
  }
  function posReports(params) {
    var qs = [];
    params = params || {};
    if (params.from) qs.push("from=" + encodeURIComponent(params.from));
    if (params.to) qs.push("to=" + encodeURIComponent(params.to));
    return request("/api/pos/reports" + (qs.length ? "?" + qs.join("&") : ""), { token: getToken("pos") || getToken("admin") });
  }
  function posSales() {
    return request("/api/pos/sales", { token: getToken("pos") || getToken("admin") });
  }
  function driverLogin(body) {
    return request("/api/driver/login", { method: "POST", body: body || {} }).then(function (d) {
      if (d.token) setToken("driver", d.token);
      return d;
    });
  }
  function driverLogout() {
    var t = getToken("driver");
    return request("/api/driver/logout", { method: "POST", token: t }).then(function (d) {
      setToken("driver", null); return d;
    }).catch(function () { setToken("driver", null); });
  }
  function driverOrders() {
    return request("/api/driver/orders", { token: getToken("driver") });
  }
  function driverSetStatus(id, body) {
    return request("/api/driver/orders/" + encodeURIComponent(id) + "/status", {
      method: "POST", body: body || {}, token: getToken("driver"),
    });
  }
  function driverUploadProof(id, file) {
    var fd = new FormData();
    fd.append("file", file);
    return fetch(url("/api/driver/orders/" + encodeURIComponent(id) + "/proof"), {
      method: "POST",
      headers: { Authorization: "Bearer " + (getToken("driver") || "") },
      body: fd,
    }).then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error((d && d.error) || r.statusText); return d; }); });
  }
  function listDrivers() {
    return request("/api/admin/drivers", { token: getToken("admin") });
  }
  function saveDriver(body, id) {
    if (id) return request("/api/admin/drivers/" + encodeURIComponent(id), { method: "PUT", body: body || {}, token: getToken("admin") });
    return request("/api/admin/drivers", { method: "POST", body: body || {}, token: getToken("admin") });
  }
  function assignDriver(orderId, driverId) {
    return request("/api/admin/orders/" + encodeURIComponent(orderId) + "/assign-driver", {
      method: "POST", body: { driverId: driverId }, token: getToken("admin"),
    });
  }
  function savePaymentMethods(methods) {
    return request("/api/admin/payment-methods", { method: "PUT", body: { methods: methods }, token: getToken("admin") });
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
    posLogin: posLogin,
    posLogout: posLogout,
    posMe: posMe,
    posProducts: posProducts,
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
    driverLogin: driverLogin,
    driverLogout: driverLogout,
    driverOrders: driverOrders,
    driverSetStatus: driverSetStatus,
    driverUploadProof: driverUploadProof,
    listDrivers: listDrivers,
    saveDriver: saveDriver,
    assignDriver: assignDriver,
    savePaymentMethods: savePaymentMethods,
    cancelOrderItem: cancelOrderItem,
    returnOrderItem: returnOrderItem,
    reorder: reorder,
    previewOrderValueDiscount: previewOrderValueDiscount,
    pickupStores: pickupStores,
    adminApproveItems: adminApproveItems,
    adminRejectItems: adminRejectItems,
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
    adminRequestFeedback: adminRequestFeedback,
    adminUpload: adminUpload,
    ensureAdmin: ensureAdmin,
    logoutAdmin: logoutAdmin,
    ensureHttps: ensureHttps,
    statusLabel: statusLabel,
    statusCode: statusCode,
  };
})(typeof window !== "undefined" ? window : globalThis);
