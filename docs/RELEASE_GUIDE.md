# Release Guide

This document describes how to build and publish ClipMe desktop releases.

Prerequisites
- Node 18+ and npm
- A GitHub repository with Releases enabled
- Set `SENTRY_DSN` (optional) for crash reporting in CI secrets
- Configure code signing if required for Windows (.p12 certificate)

Local build (desktop)

```powershell
cd apps/desktop
npm ci
npm run build
npm run package
```

Create a GitHub release
- Use the `electron-builder` `publish` option or upload artifacts manually.
- If using `electron-updater`, configure `build.publish` in `package.json` with your GitHub repo information.

Publishing from CI
- Add GitHub token with `repo` and `workflow` permissions to CI secrets.
- Add a release job that runs `npm run build` and `electron-builder --publish always`.

Notes
- Keep `SENTRY_DSN` as a secret; the app respects the user's `telemetryEnabled` setting.
- For code signing on Windows, configure `CSC_LINK` and `CSC_KEY_PASSWORD` secrets.
