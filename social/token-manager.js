// Token Manager — kredensial OAuth TIDAK PERNAH keluar dari layer ini.
// Disimpan di luar repo: ~/.clipper-studio/social-tokens.json (0600).
const fs = require("fs");
const os = require("os");
const path = require("path");

const STORE_DIR = process.env.CLIPPER_DATA_DIR || path.join(os.homedir(), ".clipper-studio");
const STORE_FILE = path.join(STORE_DIR, "social-tokens.json");

function loadAll() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveAll(all) {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  try { fs.chmodSync(STORE_DIR, 0o700); } catch {}
  fs.writeFileSync(STORE_FILE, JSON.stringify(all, null, 2), { mode: 0o600 });
  try { fs.chmodSync(STORE_FILE, 0o600); } catch {}
}

module.exports = {
  store(provider, data) {
    const all = loadAll();
    all[provider] = { ...all[provider], ...data, updatedAt: Date.now() };
    saveAll(all);
    return true;
  },
  get(provider) {
    return loadAll()[provider] || null;
  },
  remove(provider) {
    const all = loadAll();
    delete all[provider];
    saveAll(all);
    return true;
  },
  hasValidToken(provider) {
    const t = loadAll()[provider];
    return Boolean(t && t.access_token && (!t.expires_at || t.expires_at > Date.now() + 30000));
  },
  // Jangan pernah memanggil ini ke arah renderer.
  _dangerousRawRead: undefined
};
