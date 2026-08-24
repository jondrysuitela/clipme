// Meta provider (Facebook Pages — video Reels/upload via Graph API).
// Kredensial: FB_APP_ID/FB_APP_SECRET (atau FACEBOOK_*).
const path = require("path");
const tokenManager = require("../token-manager");

const V = "v19.0";
const AUTH = `https://www.facebook.com/${V}/dialog/oauth`;
const SCOPES = ["pages_show_list", "pages_manage_posts", "pages_read_engagement"];

function creds() {
  let file = {};
  try { file = JSON.parse(require("fs").readFileSync(path.join(process.cwd(), "integrations.json"), "utf8")); } catch {}
  return {
    id: process.env.FB_APP_ID || file.FB_APP_ID || process.env.FACEBOOK_APP_ID || "",
    secret: process.env.FB_APP_SECRET || file.FB_APP_SECRET || process.env.FACEBOOK_APP_SECRET || ""
  };
}

module.exports = {
  id: "facebook",
  name: "Facebook",
  capabilities: { canUploadVideo: true, canPublish: true, canSchedule: true, supportsShortVideo: true, supportsLongVideo: true, canReadAnalytics: true, pageSelect: true },

  authorizeUrl(state, redirectUri) {
    const { id } = creds();
    const q = new URLSearchParams({
      client_id: id, redirect_uri: redirectUri, response_type: "code",
      scope: SCOPES.join(","), state
    });
    return `${AUTH}?${q}`;
  },

  async exchangeCode(code, redirectUri) {
    const { id, secret } = creds();
    const q = new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: redirectUri });
    const res = await fetch(`https://graph.facebook.com/${V}/oauth/access_token?${q}`);
    const data = await res.json();
    if (!res.ok || !data.access_token) throw new Error(data.error ? data.error.message : "Meta token exchange gagal.");
    // Tukar ke long-lived user token, lalu ambil daftar Pages.
    const ex = new URLSearchParams({ grant_type: "fb_exchange_token", client_id: id, client_secret: secret, fb_exchange_token: data.access_token });
    const exRes = await fetch(`https://graph.facebook.com/${V}/oauth/access_token?${ex}`);
    const exData = await exRes.json();
    const userToken = exData.access_token || data.access_token;
    tokenManager.store("facebook", { access_token: userToken, expires_at: Date.now() + (Number(exData.expires_in) - 3600) * 1000 });
    const pages = await this.listPages(userToken);
    return { accountId: "", accountName: pages.length ? "Pages terhubung siap dipilih" : "Facebook (tanpa Page)", username: "", pages };
  },

  async listPages(userToken) {
    const res = await fetch(`https://graph.facebook.com/${V}/me/accounts?fields=id,name&access_token=${userToken}`);
    const data = await res.json();
    return Array.isArray(data.data) ? data.data : [];
  },

  async selectPage(pageId) {
    // Simpan page token terpisah; publish memakai page token ini.
    const t = tokenManager.get("facebook");
    if (!t) throw new Error("Facebook belum terhubung.");
    const res = await fetch(`https://graph.facebook.com/${V}/${pageId}?fields=access_token,name&access_token=${t.access_token}`);
    const d = await res.json();
    if (!res.ok || !d.access_token) throw new Error(d.error ? d.error.message : "Gagal mengambil Page token.");
    tokenManager.store("facebook", { pageId, pageName: d.name, page_access_token: d.access_token });
    return { accountId: pageId, accountName: d.name };
  },

  async refresh() {
    // Long-lived user token ~60 hari; perpanjang dengan fb_exchange_token dirinya.
    const t = tokenManager.get("facebook");
    if (!t || !t.access_token) throw new Error("Tidak ada token Facebook — reconnect dulu.");
    const { id, secret } = creds();
    const q = new URLSearchParams({ grant_type: "fb_exchange_token", client_id: id, client_secret: secret, fb_exchange_token: t.access_token });
    const res = await fetch(`https://graph.facebook.com/${V}/oauth/access_token?${q}`);
    const data = await res.json();
    if (!res.ok || !data.access_token) throw new Error("Refresh Meta gagal.");
    tokenManager.store("facebook", { access_token: data.access_token, expires_at: Date.now() + (Number(data.expires_in) - 3600) * 1000 });
    return true;
  },

  async getAccount(accessToken) {
    const pages = await this.listPages(accessToken);
    return { accountId: pages[0] ? pages[0].id : "", accountName: pages[0] ? pages[0].name : "Facebook", username: "" };
  }
};
