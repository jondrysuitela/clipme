// TikTok provider — Content Posting API (official OAuth + PKCE).
// Kredensial: TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET.
const crypto = require("crypto");
const tokenManager = require("../token-manager");
const credentials = require("../credentials");

const AUTH = "https://www.tiktok.com/v2/auth/authorize/";
const TOKEN = "https://open.tiktokapis.com/v2/oauth/token/";
const SCOPES = ["user.info.basic", "video.upload", "video.publish"];

function creds() {
  return {
    key: credentials.get("TIKTOK_CLIENT_KEY"),
    secret: credentials.get("TIKTOK_CLIENT_SECRET")
  };
}

module.exports = {
  id: "tiktok",
  name: "TikTok",
  capabilities: { canUploadVideo: true, canPublish: true, canSchedule: false, supportsShortVideo: true, supportsLongVideo: false, canReadAnalytics: true },

  authorizeUrl(state, redirectUri) {
    const { key } = creds();
    const verifier = crypto.randomBytes(48).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    tokenManager.store("tiktok", { pkce_verifier: verifier });
    const q = new URLSearchParams({
      client_key: key, response_type: "code", redirect_uri: redirectUri,
      scope: SCOPES.join(","), state, code_challenge: challenge, code_challenge_method: "S256"
    });
    return `${AUTH}?${q}`;
  },

  async exchangeCode(code, redirectUri) {
    const { key, secret } = creds();
    const verifier = (tokenManager.get("tiktok") || {}).pkce_verifier || "";
    const body = new URLSearchParams({
      code, client_key: key, client_secret: secret, redirect_uri: redirectUri,
      grant_type: "authorization_code", code_verifier: verifier
    });
    const res = await fetch(TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    const data = await res.json();
    if (!res.ok || data.error && data.error.code !== "ok") throw new Error((data.error && data.error.message) || "TikTok token exchange gagal.");
    tokenManager.store("tiktok", {
      access_token: data.access_token, refresh_token: data.refresh_token,
      expires_at: Date.now() + (Number(data.expires_in) - 60) * 1000
    });
    return this.getAccount(data.access_token);
  },

  async refresh() {
    const t = tokenManager.get("tiktok");
    if (!t || !t.refresh_token) throw new Error("Tidak ada refresh token TikTok — reconnect dulu.");
    const { key, secret } = creds();
    const body = new URLSearchParams({ client_key: key, client_secret: secret, grant_type: "refresh_token", refresh_token: t.refresh_token });
    const res = await fetch(TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    const data = await res.json();
    if (!res.ok || (data.error && data.error.code !== "ok")) throw new Error("Refresh TikTok gagal.");
    tokenManager.store("tiktok", { access_token: data.access_token, expires_at: Date.now() + (Number(data.expires_in) - 60) * 1000 });
    return true;
  },

  async getAccount(accessToken) {
    const q = new URLSearchParams({ fields: "open_id,display_name" });
    const res = await fetch(`https://open.tiktokapis.com/v2/user/info/?${q}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await res.json();
    const u = data.data && data.data.user;
    return { accountId: u ? u.open_id : "", accountName: u ? u.display_name : "TikTok User", username: u ? "@" + u.display_name : "" };
  }
};
