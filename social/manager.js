// Provider registry — kontrak seragam semua platform.
// Setiap provider: {id,name,authorizeUrl(state,redirectUri,codeChallenge?),
// exchangeCode(code,redirectUri),refresh(refreshToken),getAccount(accessToken),
// capabilities}
const google = require("./providers/google");
const tiktok = require("./providers/tiktok");
const meta = require("./providers/meta");

const providers = {};
for (const p of [google, tiktok, meta]) providers[p.id] = p;

module.exports = {
  get(id) { return providers[id] || null; },
  list() { return Object.values(providers); },
  ids() { return Object.keys(providers); }
};
