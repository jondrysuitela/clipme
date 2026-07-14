# ClipMe Desktop

ClipMe is a local-first Electron + React + TypeScript desktop app foundation for clipping long videos into short-form content.

This MVP phase intentionally focuses on the stable base:

- Electron main process owns file access, SQLite, FFmpeg, and the job queue.
- React renderer only creates commands through typed IPC and listens for job progress.
- FFmpeg and ffprobe are executed with `spawn(binary, args)` using an args array, not raw command strings.
- SQLite stores `projects`, `videos`, `jobs`, `clips`, and `settings`.

## Install

```bash
npm install
```

## Run Dev Mode

```bash
npm run dev
```

## Build

```bash
npm run build
```

## Check Without Building

```bash
npm run check
```

## FFmpeg

ClipMe resolves FFmpeg in this order:

1. `ffmpegPath` / `ffprobePath` from settings
2. Packaged `resources/ffmpeg/ffmpeg.exe` and `resources/ffmpeg/ffprobe.exe`
3. `ffmpeg` / `ffprobe` from system `PATH`

Put Windows binaries here during development:

```text
apps/desktop/resources/ffmpeg/ffmpeg.exe
apps/desktop/resources/ffmpeg/ffprobe.exe
```

## URL Import

URL import resolves `yt-dlp` in this order:

1. `YTDLP_BIN`
2. Packaged `resources/yt-dlp/yt-dlp.exe`
3. `yt-dlp` from system `PATH`

During `npm run dist`, `scripts/copy-runtime-binaries.cjs` copies `yt-dlp` from `YTDLP_BIN` or `PATH` into `resources/yt-dlp` when available.

The job downloads in two stages:

1. A fast metadata proxy using `bestvideo[height<=480]+bestaudio/best[height<=480]/best`
2. The export source using `bestvideo[height<=1080]+bestaudio/best[height<=1080]/best`

The project is updated after the metadata proxy so the renderer can show duration and resolution quickly. Pipeline actions are disabled while import is still running so generated clips do not get reset when the 1080p source replaces the proxy.

## Current Pipeline

The app currently supports:

1. Create project
2. Import a local video or URL
3. Scan metadata with ffprobe
4. Extract audio
5. Transcribe full audio or selected clips with the configured provider
6. Analyze hook candidates
7. Generate previews
8. Export vertical clips at the configured resolution, defaulting to `1080x1920`
