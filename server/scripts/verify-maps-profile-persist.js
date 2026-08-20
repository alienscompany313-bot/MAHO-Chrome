#!/usr/bin/env node
"use strict";
/**
 * Google Maps store profile persistence + resolution (isolated fixture DB).
 * Does NOT touch production data.
 */
const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const assert = (c, m) => { if (!c) throw new Error("ASSERT: " + m); };
const ok = (m) => console.log("OK  " + m);

const ROOT = path.join(__dirname, "..", "..");
const {
  resolveStoreMapsUrl, isRawCoordMapsUrl, pickStoreProfileMapsUrl,
} = require("../lib/geo");
const { resolvePickupStore } = require("../lib/store-inventory");
const { buildMailer } = require("../lib/email");

const PROFILE = "https://maps.app.goo.gl/TestProfileFixtureABC123";
const PLACE = "https://www.google.com/maps/place/MAHO+Test/@34.5116,69.1206,17z";
const COORD = "https://www.google.com/maps?q=34.51162312730907,69.12056249589499";
const MAHO_CANONICAL = "https://maps.app.goo.gl/8SJq7HECgYeGkCJD9";

function req(port, method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const data = body != null ? JSON.stringify(body) : null;
    const headers = { Accept: "application/json", "Content-Type": "application/json" };
    if (token) headers.Authorization = "Bearer " + token;
    if (data) headers["Content-Length"] = Buffer.byteLength(data);
    const r = http.request({
      hostname: "127.0.0.1", port, path: urlPath, method, headers,
    }, (res) => {
      let buf = "";
      res.on("data", (c) => { buf += c; });
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(buf); } catch (_) {}
        resolve({ status: res.statusCode, data: json, raw: buf });
      });
    });
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

function waitHealth(port, tries) {
  return new Promise(async (resolve, reject) => {
    for (let i = 0; i < (tries || 40); i++) {
      try {
        const h = await req(port, "GET", "/api/health");
        if (h.status === 200 && h.data && h.data.ok) return resolve(h);
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 150));
    }
    reject(new Error("server health timeout"));
  });
}

(async () => {
  /* ---- Unit: coord-in-map is NOT a profile ---- */
  assert(isRawCoordMapsUrl(COORD), "coord detected");
  assert(!isRawCoordMapsUrl(PROFILE), "goo.gl profile not coord");
  assert(!isRawCoordMapsUrl(PLACE), "place URL not coord");
  assert(pickStoreProfileMapsUrl({ map: COORD, lat: 34.5, lng: 69.1 }) === "", "coord map ignored as profile");
  assert(pickStoreProfileMapsUrl({ map: PROFILE, lat: 34.5, lng: 69.1 }) === PROFILE, "profile picked from map");
  assert(resolveStoreMapsUrl({ map: COORD, lat: 34.5116, lng: 69.1205 }).indexOf("34.5116") >= 0, "coord map → lat/lng fallback");
  assert(resolveStoreMapsUrl({ map: PROFILE, lat: 34.5, lng: 69.1, mapsUrl: COORD }) === PROFILE, "profile beats coord mapsUrl");
  assert(resolveStoreMapsUrl({ googleMapsUrl: PROFILE, map: COORD }) === PROFILE, "googleMapsUrl beats coord map");
  ok("unit: coord pins ignored; profile preferred");

  /* ---- resolvePickupStore snapshot ---- */
  const withProf = resolvePickupStore({
    stores: [{
      id: "store_fix",
      name: "Fixture Store",
      area: "Kabul Test Area",
      lat: "34.5116",
      lng: "69.1205",
      map: PROFILE,
    }],
  }, "store_fix");
  assert(withProf.map === PROFILE, "snapshot.map is profile");
  assert(withProf.mapsUrl === PROFILE, "snapshot.mapsUrl is profile");

  const coordOnly = resolvePickupStore({
    stores: [{
      id: "store_c",
      name: "Coords Only",
      lat: "34.1",
      lng: "69.2",
      map: COORD,
    }],
  }, "store_c");
  assert(!coordOnly.map, "coord-only map not copied as profile field");
  assert(/maps\?q=34\.1/.test(coordOnly.mapsUrl), "coord fallback mapsUrl");
  ok("resolvePickupStore snapshot fields");

  /* ---- Email href ---- */
  let html = "";
  const mail = buildMailer({
    sendRaw: async (o) => { html = o.html || ""; return { messageId: "x" }; },
    fromName: "MAHO", fromEmail: "info@mahomarket.com", replyTo: "support@mahomarket.com",
    siteUrl: "https://mahomarket.com", logoUrl: "https://mahomarket.com/icon-192.png",
  });
  const baseOrder = {
    id: "MAHO-MAPS-1",
    date: Date.now(),
    total: 1000,
    itemsTotal: 1000,
    payment: "whatsapp",
    status: "new",
    lang: "fa",
    items: [{ name: "Test", qty: 1, price: 1000 }],
    customer: { name: "Maps QA", email: "maps-qa@test.local", phone: "0700111222", address: "addr" },
  };
  await mail.orderConfirmation("maps-qa@test.local", Object.assign({}, baseOrder, {
    delivery: { method: "pickup", storeId: "store_fix" },
    pickupStore: {
      id: "store_fix", name: "Fixture Store", address: "Kabul Test Area", phone: "0700",
      lat: 34.5116, lng: 69.1205, map: PROFILE, mapsUrl: COORD,
    },
  }), "https://mahomarket.com/#orders", "fa");
  assert(html.indexOf('href="' + PROFILE + '"') >= 0, "email href exact profile");
  assert(html.indexOf(COORD) < 0, "email omits coord URL when profile present");
  ok("email confirmation uses exact profile href");

  await mail.orderConfirmation("maps-qa@test.local", Object.assign({}, baseOrder, {
    id: "MAHO-MAPS-2",
    delivery: { method: "pickup", storeId: "store_c" },
    pickupStore: {
      id: "store_c", name: "Coords Only", address: "X",
      lat: 34.1, lng: 69.2, map: COORD, mapsUrl: COORD,
    },
  }), "https://mahomarket.com/#orders", "fa");
  assert(/maps\?q=34\.1/.test(html), "email coord fallback when no profile");
  assert(html.indexOf(PROFILE) < 0, "no fabricated profile");
  ok("email coordinate fallback");

  /* ---- Customer / admin source markers ---- */
  const mainJs = fs.readFileSync(path.join(ROOT, "website", "js", "main.js"), "utf8");
  assert(/isCoordPin/.test(mainJs) && /resolveOrderStoreMapsUrl/.test(mainJs), "customer skips coord pins");
  const admin = fs.readFileSync(path.join(ROOT, "website", "admin.html"), "utf8");
  assert(/isRawCoordMapsUrl/.test(admin), "admin rejects coord-as-profile");
  assert(/Object\.assign\(\s*\{\}\s*,\s*prev/.test(admin), "admin preserves store id/fields on edit");
  assert(/لینک واردشده فقط مختصات است/.test(admin), "admin validation message");
  ok("UI markers");

  /* ---- Live local API: save → reload → order snapshot ---- */
  const DATA_DIR = fs.mkdtempSync(path.join(require("os").tmpdir(), "maho-maps-"));
  const PORT = 4527;
  const ADMIN_PASSWORD = "SecureMapsFixturePass1!";
  const child = spawn(process.execPath, [path.join(ROOT, "server", "index.js")], {
    cwd: path.join(ROOT, "server"),
    env: Object.assign({}, process.env, {
      DATA_DIR,
      PORT: String(PORT),
      ADMIN_PASSWORD,
      ALLOW_DEV_CODES: "true",
      NODE_ENV: "development",
      SITE_URL: "https://mahomarket.com",
      TOKEN_PEPPER: "maps-fixture-pepper-not-prod",
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  child.stdout.on("data", (d) => { serverLog += d.toString(); });
  child.stderr.on("data", (d) => { serverLog += d.toString(); });

  const cleanup = () => {
    try { child.kill("SIGTERM"); } catch (_) {}
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (_) {}
  };

  try {
    await waitHealth(PORT);
    const login = await req(PORT, "POST", "/api/admin/login", { password: ADMIN_PASSWORD });
    assert(login.status === 200 && login.data && login.data.token, "admin login");
    const token = login.data.token;

    const fixtureStore = {
      id: "store_fixture",
      name: "Maps Fixture Boutique",
      name_en: "Maps Fixture Boutique",
      area: "Test Address Line",
      area_en: "Test Address Line",
      hours: "9-6",
      phone: "0700999888",
      lat: "34.5116",
      lng: "69.1205",
      map: PROFILE,
    };
    const put1 = await req(PORT, "PUT", "/api/admin/catalog", {
      products: [{
        code: "MAPSFIX1",
        name: "Maps Fixture Product",
        price: 500,
        stock: 10,
        active: true,
        storeIds: ["store_fixture"],
        storeAvailabilityMode: "selected",
      }],
      stores: [fixtureStore],
      config: {},
    }, token);
    assert(put1.status === 200, "catalog save with profile map");

    const cat1 = await req(PORT, "GET", "/api/catalog");
    const st1 = (cat1.data.stores || []).find((s) => s.id === "store_fixture") || cat1.data.stores[0];
    assert(st1 && st1.map === PROFILE, "API reload keeps exact profile URL got=" + (st1 && st1.map));
    ok("save → reload: profile URL persists on store.map");

    /* Maho store with coord pin in map must migrate to canonical profile */
    const state = await req(PORT, "GET", "/api/admin/state", null, token);
    assert(state.status === 200, "admin state");
    const stores = (state.data.stores || []).slice();
    const mahoIdx = stores.findIndex((s) => s.id === "store_maho");
    if (mahoIdx < 0) {
      stores.push({
        id: "store_maho",
        name: "لباس MAHO",
        name_en: "MAHO Clothing",
        area: "Kabul",
        lat: "34.51162312730907",
        lng: "69.12056249589499",
        map: COORD,
      });
    } else {
      stores[mahoIdx].map = COORD;
    }
    const put2 = await req(PORT, "PUT", "/api/admin/catalog", {
      products: state.data.products,
      stores,
      config: state.data.config || {},
    }, token);
    assert(put2.status === 200, "save maho with coord map");
    const cat2 = await req(PORT, "GET", "/api/catalog");
    const maho = (cat2.data.stores || []).find((s) => s.id === "store_maho");
    assert(maho, "maho store present");
    assert(maho.map === MAHO_CANONICAL, "migrate upgrades coord map → MAHO profile got=" + maho.map);
    ok("Maho migration: coord-in-map upgraded to canonical profile");

    /* Fixture store profile still exact after maho save */
    const fix = (cat2.data.stores || []).find((s) => s.id === "store_fixture");
    assert(fix && fix.map === PROFILE, "fixture profile unchanged");

    /* Place order with fixture store — pickupStore must carry profile */
    const reg = await req(PORT, "POST", "/api/auth/register", {
      email: "maps-buyer@test.local", name: "Maps Buyer", phone: "0700111222",
      password: "BuyerPass123!", address: "Test address",
    });
    assert(reg.status === 200 && reg.data && reg.data.devCode, "register + devCode got=" + reg.raw.slice(0, 200));
    const ver = await req(PORT, "POST", "/api/auth/verify", {
      email: "maps-buyer@test.local", code: reg.data.devCode,
    });
    assert(ver.status === 200 && ver.data && ver.data.token, "verify signup");
    const userToken = ver.data.token;

    const orderRes = await req(PORT, "POST", "/api/orders", {
      items: [{ code: "MAPSFIX1", name: "Maps Fixture Product", qty: 1, price: 500 }],
      customer: { name: "Maps Buyer", email: "maps-buyer@test.local", phone: "0700111222", address: "addr" },
      payment: "whatsapp",
      delivery: { method: "pickup", storeId: "store_fixture" },
      lang: "fa",
    }, userToken);
    assert(orderRes.status === 200 || orderRes.status === 201, "create pickup order status=" + orderRes.status + " " + orderRes.raw.slice(0, 200));
    const order = orderRes.data.order;
    assert(order.pickupStore, "pickupStore on order");
    assert(order.pickupStore.map === PROFILE || order.pickupStore.mapsUrl === PROFILE, "order snapshot has profile");
    assert(order.pickupStore.mapsUrl === PROFILE, "order.mapsUrl exact profile");
    assert(String(order.pickupStore.mapsUrl).indexOf("maps?q=") < 0, "order mapsUrl not coord");
    ok("order pickupStore resolves saved profile URL");

    /* My Orders list */
    const mine = await req(PORT, "GET", "/api/orders", null, userToken);
    const listed = (mine.data.orders || []).find((o) => o.id === order.id);
    assert(listed && listed.pickupStore && listed.pickupStore.mapsUrl === PROFILE, "GET /api/orders keeps profile");
    ok("customer orders API returns profile mapsUrl");

    /* Simulate My Orders href resolution (same rules as main.js) */
    function resolveOrderStoreMapsUrl(store) {
      const isCoordPin = (u) => {
        const x = String(u || "").trim();
        if (!x) return false;
        return /(?:google\.[^/\s]+\/maps|maps\.google\.[^/\s]+|maps\.app\.goo\.gl)[^<\s"']*\bq=[-+]?\d+(\.\d+)?(%2C|,)[-+]?\d+(\.\d+)?/i.test(x)
          || /[?&]q=[-+]?\d+(\.\d+)?(%2C|,)[-+]?\d+(\.\d+)?\s*$/i.test(x);
      };
      const profile = [store.googleMapsUrl, store.googleMapsPlaceUrl, store.map, store.mapUrl]
        .map((x) => String(x || "").trim())
        .find((u) => /^https?:\/\//i.test(u) && !isCoordPin(u));
      if (profile) return profile;
      const existing = String(store.mapsUrl || "").trim();
      if (existing && !isCoordPin(existing)) return existing;
      if (store.lat != null && store.lng != null) {
        return "https://www.google.com/maps?q=" + encodeURIComponent(String(store.lat) + "," + String(store.lng));
      }
      return existing || "";
    }
    const href = resolveOrderStoreMapsUrl(listed.pickupStore);
    assert(href === PROFILE, "My Orders href exact profile got=" + href);
    ok("My Orders href === saved profile URL");

    console.log("\nALL MAPS PROFILE PERSISTENCE CHECKS PASSED");
    console.log("EVIDENCE profile_url=" + PROFILE);
    console.log("EVIDENCE store.map_after_reload=" + fix.map);
    console.log("EVIDENCE order.pickupStore.mapsUrl=" + order.pickupStore.mapsUrl);
    console.log("EVIDENCE my_orders_href=" + href);
    console.log("EVIDENCE maho_migrated_map=" + maho.map);
  } finally {
    cleanup();
  }
})().catch((e) => {
  console.error("FAIL", e && e.stack || e);
  process.exit(1);
});
