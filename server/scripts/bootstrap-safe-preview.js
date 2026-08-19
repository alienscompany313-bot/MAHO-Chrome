"use strict";
/**
 * Safe local/staging preview bootstrap (NOT production).
 * - Isolated DATA_DIR / UPLOAD_DIR
 * - email disabled (no SMTP)
 * - fixture customer + multi-item cancelable & delivered orders
 * Does not touch production DATA_DIR.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const { spawn } = require("child_process");

const PORT = Number(process.env.PREVIEW_PORT || 4500);
const ADMIN_PASS = process.env.ADMIN_PASSWORD || "SecurePreviewPass1!";
const ROOT = path.join(__dirname, "..");
const DATA = process.env.DATA_DIR || path.join(os.tmpdir(), "maho-safe-preview-data");
const UPLOADS = process.env.UPLOAD_DIR || path.join(DATA, "uploads");
const ART = "/opt/cursor/artifacts";
const EMAIL = "preview.customer@maho.test";
const PASSWORD = "PreviewTest123!";
const PHONE = "0700123456";

fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });
fs.mkdirSync(ART, { recursive: true });

function req(method, p, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const body = opts.body != null ? JSON.stringify(opts.body) : null;
    const headers = Object.assign({ Accept: "application/json" }, opts.headers || {});
    if (body) headers["Content-Type"] = "application/json";
    if (opts.token) headers.Authorization = "Bearer " + opts.token;
    const r = http.request(
      { hostname: "127.0.0.1", port: PORT, path: p, method, headers },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          let data = {};
          try { data = d ? JSON.parse(d) : {}; } catch (_) { data = { raw: d }; }
          resolve({ status: res.statusCode, data });
        });
      }
    );
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitHealth() {
  for (let i = 0; i < 40; i++) {
    try {
      const h = await req("GET", "/api/health");
      if (h.status === 200 && h.data && h.data.ok) return h.data;
    } catch (_) {}
    await sleep(250);
  }
  throw new Error("preview server health timeout");
}

async function main() {
  const already = await req("GET", "/api/health").catch(() => null);
  let child = null;
  if (!(already && already.status === 200 && already.data && already.data.ok)) {
    child = spawn(process.execPath, [path.join(ROOT, "index.js")], {
      cwd: ROOT,
      env: Object.assign({}, process.env, {
        PORT: String(PORT),
        NODE_ENV: "development",
        ADMIN_PASSWORD: ADMIN_PASS,
        DATA_DIR: DATA,
        UPLOAD_DIR: UPLOADS,
        ALLOW_DEV_CODES: "true",
        // No SMTP → email=false. Empty ALLOWED_ORIGINS → CORS open in development.
        ALLOWED_ORIGINS: "",
        SITE_URL: "http://127.0.0.1:" + PORT,
      }),
      stdio: "ignore",
      detached: true,
    });
    child.unref();
    fs.writeFileSync(path.join(ART, "safe_preview_server.pid"), String(child.pid));
    /* stdio ignored so this bootstrap process can exit cleanly */
  }

  const health = await waitHealth();
  if (health.email) throw new Error("REFUSING: email is enabled on preview — abort");

  /* Register / verify fixture customer (devCodes returns code) */
  let userTok = null;
  const loginTry = await req("POST", "/api/auth/login", { body: { id: EMAIL, password: PASSWORD } });
  if (loginTry.status === 200 && loginTry.data.token) {
    userTok = loginTry.data.token;
  } else {
    const reg = await req("POST", "/api/auth/register", {
      body: {
        name: "مشتری پیش‌نمایش",
        phone: PHONE,
        email: EMAIL,
        address: "کابل — آدرس تست پیش‌نمایش (غیر واقعی)",
        password: PASSWORD,
      },
    });
    if (reg.status !== 200) throw new Error("register failed " + JSON.stringify(reg));
    const code = reg.data.devCode;
    if (!code) throw new Error("devCode missing — ALLOW_DEV_CODES required");
    const ver = await req("POST", "/api/auth/verify", { body: { email: EMAIL, code } });
    if (ver.status !== 200) throw new Error("verify failed " + JSON.stringify(ver));
    userTok = ver.data.token;
  }

  const admin = await req("POST", "/api/admin/login", { body: { password: ADMIN_PASS } });
  if (admin.status !== 200) throw new Error("admin login failed");
  const adminTok = admin.data.token;

  const cust = {
    name: "مشتری پیش‌نمایش",
    phone: PHONE,
    email: EMAIL,
    address: "کابل — آدرس تست پیش‌نمایش (غیر واقعی)",
  };

  async function placeMulti(codes) {
    const items = codes.map((code) => ({ code, qty: 1 }));
    const o = await req("POST", "/api/orders", {
      token: userTok,
      body: {
        items,
        customer: cust,
        payment: "whatsapp",
        delivery: { method: "deliver", time: "normal", fee: 0 },
        idempotencyKey: "preview-" + codes.join("-") + "-" + Date.now(),
      },
    });
    if (o.status !== 200) throw new Error("order failed " + JSON.stringify(o.data));
    return o.data.order;
  }

  /* Avoid duplicating fixture orders on re-run */
  const mine = await req("GET", "/api/orders", { token: userTok });
  let orders = (mine.data && mine.data.orders) || [];
  let cancelable = orders.find((o) => (o.items || []).length >= 3 && (o.items || []).some((it) => it.itemStatus === "approved"));
  let delivered = orders.find((o) => (o.items || []).length >= 2 && (o.items || []).every((it) => it.itemStatus === "delivered" || it.itemStatus === "return_requested"));

  if (!cancelable) {
    const o = await placeMulti(["DRS-001", "MNT-002", "BLZ-003"]);
    await req("POST", "/api/admin/orders/" + o.id + "/items/approve", {
      token: adminTok,
      body: { lineIds: [] },
    });
    cancelable = (await req("GET", "/api/orders", { token: userTok })).data.orders.find((x) => x.id === o.id);
  }

  if (!delivered) {
    const o = await placeMulti(["SHL-004", "RSR-005"]);
    await req("POST", "/api/admin/orders/" + o.id + "/items/approve", { token: adminTok, body: { lineIds: [] } });
    const lineIds = (o.items || []).map((it) => it.lineId);
    await req("POST", "/api/admin/orders/" + o.id + "/items/ship", { token: adminTok, body: { lineIds } });
    await req("POST", "/api/admin/orders/" + o.id + "/items/deliver", { token: adminTok, body: { lineIds } });
    delivered = (await req("GET", "/api/orders", { token: userTok })).data.orders.find((x) => x.id === o.id);
  }

  orders = (await req("GET", "/api/orders", { token: userTok })).data.orders || [];

  const info = {
    ok: true,
    safety: {
      productionTouched: false,
      emailEnabled: !!health.email,
      dataDir: DATA,
      port: PORT,
      note: "Fixture-only DB. Do not use for real refunds/returns/emails against production.",
    },
    urls: {
      local: "http://127.0.0.1:" + PORT + "/",
      myOrdersHint: "Account → سفارشات من (or orders button)",
    },
    customer: {
      email: EMAIL,
      password: PASSWORD,
      phone: PHONE,
      name: "مشتری پیش‌نمایش",
    },
    admin: {
      password: ADMIN_PASS,
      path: "/admin.html",
    },
    fixtureOrders: orders.map((o) => ({
      id: o.id,
      status: o.status,
      statusLabelFa: o.statusLabelFa,
      items: (o.items || []).map((it) => ({
        code: it.code,
        name: it.name,
        itemStatus: it.itemStatus,
        statusLabelFa: it.statusLabelFa,
        lineId: it.lineId,
      })),
    })),
    branchNote: "Serves current checkout (PR customer My Orders UI). Isolated from mahomarket.com.",
  };

  fs.writeFileSync(path.join(ART, "safe_preview_info.json"), JSON.stringify(info, null, 2));
  const md = [
    "# MAHO Safe Preview (NOT production)",
    "",
    "## URL",
    "- Local: `http://127.0.0.1:" + PORT + "/`",
    "- Public tunnel: see `safe_preview_public_url.txt` if tunnel is running",
    "",
    "## Test customer",
    "- Email: `" + EMAIL + "`",
    "- Password: `" + PASSWORD + "`",
    "",
    "## How to test My Orders",
    "1. Open the preview URL (mobile width ~390px recommended).",
    "2. Account / ورود → log in with the test customer.",
    "3. Open **سفارشات من**.",
    "4. Tap an order header to expand/collapse.",
    "5. Confirm each line shows image, name, SKU, qty, price, item status.",
    "6. On the 3-item approved order: try Cancel / Reorder on one item only.",
    "7. On the delivered order: try Return / Reorder on one item only.",
    "8. Use checkboxes + select-all for multi-item actions.",
    "",
    "## Safety",
    "- Isolated `DATA_DIR`: `" + DATA + "`",
    "- `email=false` (no SMTP) — no real emails",
    "- Not connected to production DB",
    "- Do **not** merge/deploy from this preview session",
    "",
    "## Fixture orders",
    "```json",
    JSON.stringify(info.fixtureOrders, null, 2),
    "```",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(ART, "SAFE_PREVIEW_INSTRUCTIONS.md"), md);
  console.log(JSON.stringify(info, null, 2));
}

main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
