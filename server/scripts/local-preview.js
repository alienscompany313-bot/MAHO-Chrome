"use strict";
/**
 * Local-only MAHO MARKET preview.
 *
 * Starts the existing server/index.js on 127.0.0.1. Data, sessions, uploads,
 * and the admin password stay outside the repository. SMTP is forced off.
 * This does not deploy, tunnel, or touch production.
 *
 * From server/:
 *   node scripts/local-preview.js
 *   node scripts/local-preview.js status
 *   node scripts/local-preview.js stop
 *   node scripts/local-preview.js restart
 */
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const INDEX = path.join(ROOT, "index.js");
const PREFERRED_PORT = 4720;
const PREVIEW_ROOT = path.join(process.env.LOCALAPPDATA || path.join(os.tmpdir(), "maho-local"), "MAHO", "local-preview");
const DATA_DIR = path.join(PREVIEW_ROOT, "data");
const STATE_FILE = path.join(PREVIEW_ROOT, "state.json");
const LOG_FILE = path.join(PREVIEW_ROOT, "preview.log");

function fail(message) {
  console.error("PREVIEW_ERROR " + message);
  process.exit(1);
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch (_) { return null; }
}

function writeState(state) {
  fs.mkdirSync(PREVIEW_ROOT, { recursive: true });
  const tmp = STATE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

function commandLine(pid) {
  try {
    return execFileSync("powershell.exe", [
      "-NoProfile",
      "-Command",
      "(Get-CimInstance Win32_Process -Filter \"ProcessId=" + Number(pid) + "\").CommandLine",
    ], { encoding: "utf8", windowsHide: true }).trim();
  } catch (_) {
    return "";
  }
}

function isOurServer(pid) {
  if (!pid) return false;
  const cmd = commandLine(pid).toLowerCase();
  return cmd.includes(INDEX.toLowerCase());
}

function processAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (_) { return false; }
}

function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

function request(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: urlPath,
      method: "GET",
      timeout: 4000,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let data = null;
        try { data = JSON.parse(text); } catch (_) {}
        resolve({ status: res.statusCode, text, data });
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

async function healthyPreview(port) {
  try {
    const res = await request(port, "/api/health");
    const data = res.data || {};
    return res.status === 200 && data.ok === true && data.env !== "production" && data.email === false;
  } catch (_) {
    return false;
  }
}

function listenerPid(port) {
  try {
    const out = execFileSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8", windowsHide: true });
    const needle = ":" + port;
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes(needle) || !/LISTENING/i.test(line)) continue;
      const parts = line.trim().split(/\s+/);
      const local = parts[1] || "";
      if (!local.endsWith(needle)) continue;
      const pid = Number(parts[parts.length - 1]);
      if (pid) return pid;
    }
  } catch (_) {}
  return 0;
}

async function choosePort(state) {
  const occupant = listenerPid(PREFERRED_PORT);
  if (!occupant && await portFree(PREFERRED_PORT)) return PREFERRED_PORT;
  if (occupant && isOurServer(occupant) && await healthyPreview(PREFERRED_PORT)) {
    return PREFERRED_PORT;
  }
  if (occupant) {
    console.log("Port " + PREFERRED_PORT + " is already used by pid " + occupant + ". Leaving that process alone.");
  }
  for (let port = 4723; port <= 4739; port++) {
    if (listenerPid(port)) continue;
    if (await portFree(port)) return port;
  }
  fail("No free local preview port from 4720 or 4723-4739.");
  return 0;
}

function ensureSecrets(state) {
  const next = state || {};
  if (!next.adminPassword || String(next.adminPassword).length < 12) {
    next.adminPassword = "Pv" + crypto.randomBytes(18).toString("base64url");
  }
  if (!next.tokenPepper) next.tokenPepper = crypto.randomBytes(24).toString("base64url");
  return next;
}

function childEnv(state, port) {
  const origin = "http://127.0.0.1:" + port;
  const base = {};
  ["PATH", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "PATHEXT", "ComSpec", "COMSPEC", "windir", "WINDIR",
    "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOMEDRIVE", "HOMEPATH", "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE", "PROGRAMFILES"].forEach((key) => {
    if (process.env[key]) base[key] = process.env[key];
  });
  base.NODE_ENV = "development";
  base.PORT = String(port);
  base.MAHO_BIND_HOST = "127.0.0.1";
  base.MAHO_LOCAL_PREVIEW = "1";
  base.DATA_DIR = DATA_DIR;
  base.UPLOAD_DIR = path.join(DATA_DIR, "uploads");
  base.ADMIN_PASSWORD = state.adminPassword;
  base.TOKEN_PEPPER = state.tokenPepper;
  base.ALLOW_DEV_CODES = "true";
  base.MAHO_MOCK_MAIL = "1";
  base.SMTP_HOST = "";
  base.SMTP_USER = "";
  base.SMTP_PASS = "";
  base.SMTP_SECURE = "";
  base.SITE_URL = origin;
  base.PUBLIC_URL = origin;
  base.ALLOWED_ORIGINS = origin;
  base.BACKUP_DIR = "";
  base.BACKUP_ENCRYPTION_KEY = "";
  base.BACKUP_ON_START = "";
  return base;
}

function assertSafeDataDir() {
  const repo = path.resolve(ROOT, "..");
  const data = path.resolve(DATA_DIR);
  const rel = path.relative(repo, data);
  if (!rel.startsWith("..") && rel !== "") fail("Refusing to use a data directory inside the repository.");
  if (/render|production/i.test(data)) fail("Refusing a data directory whose path looks like production.");
}

async function waitHealth(port) {
  for (let i = 0; i < 40; i++) {
    if (await healthyPreview(port)) return request(port, "/api/health");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

function printReady(port, pid) {
  console.log("PREVIEW_READY");
  console.log("url http://127.0.0.1:" + port + "/");
  console.log("admin http://127.0.0.1:" + port + "/admin.html");
  console.log("pid " + pid);
  console.log("data " + DATA_DIR);
  console.log("log " + LOG_FILE);
  console.log("admin_password_file " + STATE_FILE);
  console.log("bind 127.0.0.1");
  console.log("email off");
}

async function start() {
  assertSafeDataDir();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, "uploads"), { recursive: true });
  const state = ensureSecrets(readState() || {});
  const recordedPort = Number(state.port) || PREFERRED_PORT;
  if (state.pid && processAlive(state.pid) && isOurServer(state.pid) && await healthyPreview(recordedPort)) {
    printReady(recordedPort, state.pid);
    console.log("already_running yes");
    return;
  }
  const occupant = listenerPid(PREFERRED_PORT);
  if (occupant && isOurServer(occupant) && await healthyPreview(PREFERRED_PORT)) {
    state.pid = occupant;
    state.port = PREFERRED_PORT;
    writeState(state);
    printReady(PREFERRED_PORT, occupant);
    console.log("already_running yes");
    return;
  }
  const port = await choosePort(state);
  state.port = port;
  writeState(state);
  const logFd = fs.openSync(LOG_FILE, "a");
  const child = spawn(process.execPath, [INDEX], {
    cwd: ROOT,
    env: childEnv(state, port),
    detached: true,
    windowsHide: true,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  state.pid = child.pid;
  state.startedAt = new Date().toISOString();
  writeState(state);
  const health = await waitHealth(port);
  if (!health) {
    const tail = fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, "utf8").slice(-1200) : "";
    if (processAlive(child.pid) && isOurServer(child.pid)) {
      try { process.kill(child.pid); } catch (_) {}
    }
    fail("The preview did not become healthy. Log tail:\n" + tail);
  }
  printReady(port, child.pid);
  console.log("health " + JSON.stringify({
    ok: health.data.ok,
    env: health.data.env,
    email: health.data.email,
    products: health.data.products,
    orders: health.data.orders,
    customers: health.data.customers,
  }));
}

async function status() {
  const state = readState();
  if (!state || !state.pid || !processAlive(state.pid) || !isOurServer(state.pid)) {
    console.log("PREVIEW_STOPPED");
    return;
  }
  const port = Number(state.port) || PREFERRED_PORT;
  const ok = await healthyPreview(port);
  console.log(ok ? "PREVIEW_RUNNING" : "PREVIEW_UNHEALTHY");
  console.log("url http://127.0.0.1:" + port + "/");
  console.log("pid " + state.pid);
  console.log("data " + DATA_DIR);
}

async function stop() {
  const state = readState();
  if (!state || !state.pid) {
    console.log("PREVIEW_STOPPED");
    return;
  }
  if (!processAlive(state.pid)) {
    state.pid = null;
    writeState(state);
    console.log("PREVIEW_STOPPED");
    return;
  }
  if (!isOurServer(state.pid)) {
    fail("Recorded pid " + state.pid + " is not this project's server. It was not stopped.");
  }
  try { process.kill(state.pid); }
  catch (err) { fail("Could not stop pid " + state.pid + ": " + err.message); }
  for (let i = 0; i < 20; i++) {
    if (!processAlive(state.pid)) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  if (processAlive(state.pid)) fail("Pid " + state.pid + " is still running.");
  state.pid = null;
  writeState(state);
  console.log("PREVIEW_STOPPED");
}

async function main() {
  const cmd = String(process.argv[2] || "start").toLowerCase();
  if (cmd === "start") await start();
  else if (cmd === "status") await status();
  else if (cmd === "stop") await stop();
  else if (cmd === "restart") { await stop(); await start(); }
  else fail("Use start, status, stop, or restart.");
}

main().catch((err) => fail(err && err.stack || err));
