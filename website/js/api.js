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
    return request("/api/orders", { method: "POST", body: body, token: getToken("user") || undefined });
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

  /* status label helpers (API uses English codes; UI may show FA) */
  var STATUS_FA = {
    pending: "در انتظار تایید",
    confirmed: "تایید شده",
    awaiting_payment: "در انتظار پرداخت",
    cancelled: "لغو شده",
    return_requested: "درخواست برگشت",
  };
  function statusLabel(code, lang) {
    var c = String(code || "");
    if (STATUS_FA[c]) return lang === "en" ? c.replace(/_/g, " ") : STATUS_FA[c];
    return c;
  }
  function statusCode(label) {
    var s = String(label || "");
    if (STATUS_FA[s]) return s;
    if (s.indexOf("تایید شده") >= 0 || s.indexOf("تأیید شده") >= 0 || s === "confirmed") return "confirmed";
    if (s.indexOf("لغو") >= 0 || s === "cancelled") return "cancelled";
    if (s.indexOf("انتظار پرداخت") >= 0 || s === "awaiting_payment") return "awaiting_payment";
    if (s.indexOf("برگشت") >= 0 || s === "return_requested") return "return_requested";
    if (s.indexOf("انتظار") >= 0 || s === "pending") return "pending";
    return s || "pending";
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
    register: register,
    verify: verify,
    login: login,
    logoutUser: logoutUser,
    me: me,
    updateMe: updateMe,
    verifyEmailChange: verifyEmailChange,
    placeOrder: placeOrder,
    myOrders: myOrders,
    cancelOrder: cancelOrder,
    returnOrder: returnOrder,
    adminLogin: adminLogin,
    adminState: adminState,
    adminSaveCatalog: adminSaveCatalog,
    adminOrders: adminOrders,
    adminCustomers: adminCustomers,
    adminSetOrderStatus: adminSetOrderStatus,
    adminUpload: adminUpload,
    ensureAdmin: ensureAdmin,
    logoutAdmin: logoutAdmin,
    statusLabel: statusLabel,
    statusCode: statusCode,
  };
})(typeof window !== "undefined" ? window : globalThis);
