# ClipMe 0.1.9

## Highlights

- Improved URL import reliability by bundling the latest official `yt-dlp.exe` during release builds.
- Added `URL cookies` setting for Chrome, Edge, and Firefox to help with platform anti-bot/login restrictions.
- Added `yt-dlp` path and version to Diagnostics for easier remote troubleshooting.
- Improved `yt-dlp` error messages for anti-bot, HTTP 403, unsupported URL, unavailable format, cookies, and network failures.
- Strengthened hook analysis with better viral scoring signals, timeline diversification, cleaner captions, and contextual hashtags.
- Added social export format `4:5 1080x1350`.
- Added clip curation workflow: Review, Keep, Skip, filters, and `Export Keep`.
- Added copy caption/path actions, export pack summary, diagnostics panel, app icon, and SaaS-style dashboard polish.

## Validation

- TypeScript check passes.
- Smoke test suite passes.
- Windows installer build passes.
