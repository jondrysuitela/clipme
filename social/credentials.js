// Sumber kredensial aplikasi OAuth milik user (BYO credentials).
// Urutan resolusi: env > file user (~/.clipper-studio/integrations.json, 0600)
//                  > file bawaan repo (dev mode saja).
const fs = require("fs");
const os = require("os");
const path = require("path");

const DATA_DIR = process.env.CLIPPER_DATA_DIR || path.join(os.homedir(), ".clipper-studio");
const USER_FILE = path.join(DATA_DIR, "integrations.json");
const APP_FILE = path.join(__dirname, "..", "integrations.json");

const KEYS = [
  { key: "YT_OAUTH_CLIENT_ID", platform: "youtube", label: "YouTube OAuth Client ID", secret: false },
  { key: "YT_OAUTH_CLIENT_SECRET", platform: "youtube", label: "YouTube OAuth Client Secret", secret: true },
  { key: "TIKTOK_CLIENT_KEY", platform: "tiktok", label: "TikTok Client Key", secret: false },
  { key: "TIKTOK_CLIENT_SECRET", platform: "tiktok", label: "TikTok Client Secret", secret: true },
  { key: "FB_APP_ID", platform: "facebook", label: "Facebook App ID", secret: false },
  { key: "FB_APP_SECRET", platform: "facebook", label: "Facebook App Secret", secret: true }
];
const KEY_SET = new Set(KEYS.map((k) => k.key));
// Alias yang diterima tapi tidak muncul di form UI.
const EXTRA_KEYS = new Set(["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"]);

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) || {}; } catch { return {}; }
}

function get(key) {
  if (process.env[key]) return process.env[key];
  const cfg = readJson(USER_FILE);
  if (cfg[key]) return cfg[key];
  const fallback = readJson(APP_FILE);
  return fallback[key] || "";
}

function configured() {
  const out = {};
  for (const k of KEYS) out[k.key] = Boolean(get(k.key));
  return out;
}

function setMany(partial) {
  const cfg = readJson(USER_FILE);
  for (const [k, v] of Object.entries(partial || {})) {
    if ((!KEY_SET.has(k) && !EXTRA_KEYS.has(k)) || typeof v !== "string") continue;
    if (v.trim() === "") delete cfg[k];
    else cfg[k] = v.trim();
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try { fs.chmodSync(DATA_DIR, 0o700); } catch {}
  fs.writeFileSync(USER_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  try { fs.chmodSync(USER_FILE, 0o600); } catch {}
  return true;
}

module.exports = { KEYS, get, configured, setMany, USER_FILE };
