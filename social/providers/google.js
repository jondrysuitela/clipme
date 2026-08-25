// Google / YouTube provider — official OAuth 2.0 + PKCE.
// Kredensial aplikasi dari env/integrations.json: YT_OAUTH_CLIENT_ID/SECRET.
const crypto = require("crypto");
const tokenManager = require("../token-manager");
const credentials = require("../credentials");

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"];

function creds() {
  return {
    id: credentials.get("YT_OAUTH_CLIENT_ID"),
    secret: credentials.get("YT_OAUTH_CLIENT_SECRET")
  };
}

module.exports = {
  id: "youtube",
  name: "YouTube",
  capabilities: { canUploadVideo: true, canPublish: true, canSchedule: false, supportsShortVideo: true, supportsLongVideo: true, canReadAnalytics: true },

  authorizeUrl(state, redirectUri) {
    const { id } = creds();
    const verifier = crypto.randomBytes(48).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    tokenManager.store("youtube", { pkce_verifier: verifier });
    const q = new URLSearchParams({
      client_id: id, redirect_uri: redirectUri, response_type: "code",
      scope: SCOPES.join(" "), state, access_type: "offline", prompt: "consent",
      code_challenge: challenge, code_challenge_method: "S256"
    });
    return `${AUTH}?${q}`;
  },

  async exchangeCode(code, redirectUri) {
    const { id, secret } = creds();
    const verifier = (tokenManager.get("youtube") || {}).pkce_verifier || "";
    const body = new URLSearchParams({
      code, client_id: id, client_secret: secret, redirect_uri: redirectUri,
      grant_type: "authorization_code", code_verifier: verifier
    });
    const res = await fetch(TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || data.error || "Google token exchange gagal.");
    tokenManager.store("youtube", {
      access_token: data.access_token, refresh_token: data.refresh_token,
      expires_at: Date.now() + (Number(data.expires_in) - 60) * 1000
    });
    return this.getAccount(data.access_token);
  },

  async refresh() {
    const t = tokenManager.get("youtube");
    if (!t || !t.refresh_token) throw new Error("Tidak ada refresh token YouTube — reconnect dulu.");
    const { id, secret } = creds();
    const body = new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: t.refresh_token, grant_type: "refresh_token" });
    const res = await fetch(TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || "Refresh Google gagal.");
    tokenManager.store("youtube", { access_token: data.access_token, expires_at: Date.now() + (Number(data.expires_in) - 60) * 1000 });
    return true;
  },

  async getAccount(accessToken) {
    const res = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await res.json();
    const item = data.items && data.items[0];
    return {
      accountId: item ? item.id : "",
      accountName: item ? item.snippet.title : "YouTube Channel",
      username: item ? item.snippet.customUrl : ""
    };
  }
};
