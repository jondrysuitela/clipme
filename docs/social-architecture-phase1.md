# Social Account & Publishing Architecture — PHASE 1 AUDIT (blueprint)

## STATE SAAT INI (terverifikasi)
- Nol OAuth/token di kodebase. `/api/integrations` = deteksi env/`integrations.json` (8 kunci).
- Integrations Hub UI ada: kartu platform, status deteksi nyata, REFRESH.
- PUBLISH NOW terkunci permanen (cc4405a) — deteksi ≠ kapabilitas.
- yt-dlp = download-only. Electron: contextIsolation on, CSP ketat.

## FILE PLAN (PHASE 2+)
BARU:
  social/token-manager.js    safeStorage / encrypted-file 0600 di userData
  social/providers/google.js | tiktok.js | meta.js   (connect/refresh/account/
                             capabilities/publish — kontrak seragam + PKCE + state)
  social/manager.js          SocialAccountManager + registry
  social/publish-manager.js  validasi platform → job per platform (queue existing)
MODIFIKASI:
  server.js        route accounts/connect/callback/:provider/disconnect + PublishManager hook
  electron/main.js openExternal(authorize URL), loopback callback
  index.html/styles.css/script.js → Hub Connect flow, identity tanpa token,
                     per-platform publish status & retry
HAPUS: tidak ada

## DESAIN KUNCI
- Renderer hanya terima {platform, accountName, username, status, capabilities}
- Scope minimum: youtube.upload(+readonly), video.upload(TikTok),
  pages_manage_posts(Meta) + page picker
- Loopback http://127.0.0.1:<port>/api/oauth/callback/:provider + state CSRF
- Disconnect = hapus token saja; offline-first tetap

## TEST MATRIX TARGET
Connect/Authorize/GetAccount/Refresh/Disconnect/Publish per platform +
regression penuh (suite existing harus tetap GREEN).

## URUTAN EKSEKUSI SESI BERIKUTNYA
P2 Core Abstraction (token-manager + manager + kontrak) →
P3 Google/YT live (butuh kredensial user) → P4 TikTok → P5 Meta/FB →
P6 Hub UI connect flow → P7 PublishManager + retry per-platform → P8 regression.
