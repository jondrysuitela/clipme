# CHECKLIST PERBAIKAN — CLIPPER STUDIO

Daftar perbaikan dari **Deep Forensic Audit** (read-only). Setiap item = 1 PR/commit ideal, dengan lokasi & langkah verifikasi. Status diisi manual saat mengerjakan.

**Konvensi status:** `[ ]` belum dikerjakan · `[~]` sedang dikerjakan · `[x]` selesai · `[!]` blocked/menunggu keputusan

---

## PHASE 1 — MUST FIX (Critical/High, 1–7)

### 1.1 Perbaiki caption "Off" agar tidak membakar teks — `C-01`
- **Lokasi:** `server.js:2549-2554` (branch `timedFilters.length ? ... : [...drawtext statis]`)
- **Perbaikan:** Jika `captionStyle === "off"`, build filter hanya `scale,crop` (tanpa drawtext). Jangan pernah masuk branch statis.
- **Aman (opsional):** treat `!segments.length && captionStyle !== "off"` sebagai fallback statis hanya jika teks ada.
- **Verifikasi:** export dengan style Off → video tanpa teks; preview tetap konsisten (script.js:100-103 sudah benar).
- **Status:** [x]

### 1.2 Tulis manifest di handleUpload — `H-01` (+ otomatis menyelesaikan `M-03`)
- **Lokasi:** `server.js:2232-2241` (setelah `probeVideo` berhasil)
- **Perbaikan:** panggil `writeProjectManifest(projectDir, { id, type:"local", name, probe, clips, transcriptPath:"", transcriptProvider:"none" })`.
- **Frontend (M-03):** di `uploadToBackend` (script.js:363-388) tambahkan push ke `state.projects` + `renderLibrary()`, agar konsisten dengan `loadProject` (415-424).
- **Verifikasi:** PATCH `/api/projects/:id` sukses 200; project upload muncul di Library.
- **Status:** [x]

### 1.3 Tambah timeout di getJson & postMultipart — `H-02`
- **Lokasi:** `server.js:570-594` (getJson), `596-645` (postMultipart)
- **Perbaikan:** tambahkan `request.setTimeout(...)` + abort seperti di `callClipmeLLM` (server.js:107). Untuk getTranscript (1469) dan OpenAI transcribe (1527) pastikan error → fallback ke jalur berikutnya.
- **Verifikasi:** request ke host yang menggantung → reject setelah timeout, job tidak stuck.
- **Status:** [x]

### 1.4 Bersihkan uploads/outputs + aktifkan storage — `H-03`
- **Lokasi:** `server.js` (startup/scheduler), UI `script.js` + `index.html:32-33`
- **Perbaikan (pilih salah satu):**
  - (a) Simple: handler `POST /api/cleanup` + tombol Clear yang hapus file (bukan hanya array in-memory).
  - (b) Otomatis: saat startup hapus `tmp/`; + hapus uploads/projects & outputs berusia > N hari.
  - (c) Minimal: panggil `HEAD /api/storage` di load, isi `#storageUsed/#storageMeter`.
- **Verifikasi:** upload 2 video → storage bertambah → Clear → file hilang & meter nol.
- **Status:** [x]

### 1.5 Perbaiki sanitasi caption — `H-06`
- **Lokasi:** `server.js:3069` `payload.caption = sanitizeString(payload.caption,500)`
- **Perbaikan:** gunakan `ffmpegText` (server.js:1608-1621) untuk escaping saat render, JANGAN hapus karakter dari teks sumber. Simpan caption asli.
- **Verifikasi:** caption `saya & kamu` / `don't` → muncul utuh di MP4.
- **Status:** [x]

### 1.6 Putuskan nasib fitur mati — `H-04`
- **Lokasi:** `server.js:3663-3681`, `index.html:32-33,127-130,310`, `script.js`
- **Pilih A (aktifkan):** UI queue (#queueList + polling `/api/queue`, cancel → `DELETE /api/jobs/:id`), storage meter (HEAD /api/storage), progress bar (poll `/api/jobs/:id`), exports list (GET/DELETE /api/exports).
- **Pilih B (rapikan):** hapus endpoint & elemen UI mati + stub-nya.
- **Rekomendasi:** A untuk queue/progress; B untuk storage/exports bila tidak dibutuhkan.
- **Verifikasi:** setiap tombol UI punya efek nyata.
- **Status:** [x] (Pilih A: queue, progress, storage, exports diaktifkan)

### 1.7 Batasi koncurrency STT — `H-05`
- **Lokasi:** `server.js:2843-2862` (`Promise.all(seedClips.map(...))`)
- **Perbaikan:** throttle (mis. pool 2) atau loop serial.
- **Verifikasi:** job analyze-stt → puncak subprocess ≤ 2-3.
- **Status:** [x]

---

## PHASE 2 — FIX AFTER THAT (Medium, 8–15)

### 2.1 Seragamkan basis timestamp retention phases — `M-04`
- **Lokasi:** `server.js:1316-1379` vs `3096-3103`
- **Perbaikan:** di `analyzeTranscriptToClips`, geser segmen menjadi relatif ke window sebelum `clipmeAssemble`, persis pola di `handleAnalyzeClip`.
- **Verifikasi:** generate ulang vs re-analyze clip yang sama → skor retention identik.
- **Status:** [x]

### 2.2 Preview lokal lewat queue + children — `M-05`
- **Lokasi:** `server.js:2710-2721` (branch non-YouTube di handlePreview)
- **Perbaikan:** bungkus `ensureClipTranscriptLocal` dengan `enqueueAndAwait("preview", (sp, children)=>...)` seperti branch YouTube (2724-2731).
- **Verifikasi:** preview upload → ada job di queue, bisa cancel, tidak blokir request lain.
- **Status:** [x]

### 2.3 Validasi videoId di fast mode — `M-06`
- **Lokasi:** `server.js:2253-2280` & `2308-2344`
- **Perbaikan:** jika `!extractYouTubeId(videoUrl)` → 400 "URL YouTube tidak valid". Opsional: verifikasi video via `yt-dlp --skip-download --print %(id)s`.
- **Verifikasi:** `youtube.com/` → ditolak; URL valid tetap jalan.
- **Status:** [x]

### 2.4 Kirim bahasa asli ke prompt caption engine — `M-07`
- **Lokasi:** `clipme-caption-engine.js:421-471` & `server.js:3235-3250`
- **Perbaikan:** tambah param `language` ke `buildUserPrompt`/`processWithLLM`; isi `- Bahasa target: ${language}` dari `payload.language`.
- **Verifikasi:** caption LLM konsisten dengan bahasa video.
- **Status:** [x]

### 2.5 Deduplikasi transcribe*Cache — `M-08`
- **Lokasi:** `server.js:2872, 2940, 2980, 2990`
- **Perbaikan:** satu fungsi inti dengan param `sourceGetter` (youtube vs local) + 2 wrapper tipis. Kerjakan setelah verifikasi test phase3/4b.
- **Verifikasi:** jalankan phase3 & phase4b test → tetap hijau.
- **Status:** [x]

### 2.6 Library "Open" jadi fungsi nyata — `M-01`
- **Lokasi:** `script.js:302-307`
- **Perbaikan:** simpan state project lengkap di `state.projects`, "Open" = `loadProject({...})`.
- **Verifikasi:** Open → studio menampilkan clips & bisa preview/export.
- **Status:** [x]

### 2.7 Select All berfungsi — `M-02`
- **Lokasi:** `script.js:1560-1562` + `exportAllBtn` (1564+)
- **Perbaikan:** `state.selectedClips = Set`; "Select All" = semua clips; export batch hanya clip terpilih.
- **Verifikasi:** select 3 clip → export batch → 3 MP4.
- **Status:** [x]

---

## PHASE 3 — CLEANUP (Low/Info, 16–24)

### 3.1 UI pengatur posisi caption — `L-01`
- **Lokasi:** `script.js:658`, `index.html`
- Slider (0.3–0.95) → `state.captionPosition`; kirim ke `/api/export` & preview.
- **Status:** [x]

### 3.2 Electron hardening — `L-02`
- **Lokasi:** `electron/main.js`
- `setWindowOpenHandler` (block / shell.openExternal untuk http(s)), optional preload, pastikan `before-quit` menutup server & children.
- **Status:** [x]

### 3.3 Deklarasi engines — `L-03`
- **Lokasi:** `package.json`
- `"engines": { "node": ">=18" }`.
- **Status:** [x]

### 3.4 Rampingkan installer — `L-04`
- **Lokasi:** `package.json:41-58`
- Evaluasi bundling model `.venv`/`small` (download-opsional / bootstrap) atau dokumentasikan ukuran.
- **Status:** [x] **Keputusan: bundle semua (offline penuh)**. Struktur HF-cache (`models--Systran--*`, symlink) tidak portabel di Windows → dibangun folder datar `models/small` & `models/tiny` (file riil, total ~536MB). `server.js` menambah `resolveLocalWhisperModel()` — prefer path `models/<name>/model.bin`, fallback ke nama HF (auto-download). `package.json` bundle `models/`. Terverifikasi: load offline via `HF_HUB_OFFLINE=1` OK; E2E `/api/stt/transcribe` 200 dengan model tersolve ke `models/small`. Folder HF lama dihapus (~538MB). Ukuran installer akhir ~1GB (bin 719MB + venv 337MB + models 536MB).

### 3.5 Bersihkan wording lama — `L-05`
- **Lokasi:** `server.js:2183`
- Ganti "Batas demo lokal" → "Batas maksimal".
- **Status:** [x]

### 3.6 Konsisten path existsSync — `L-06`
- **Lokasi:** `server.js:3538`
- Pakai `resolvedAudioPath` untuk `fs.existsSync`.
- **Status:** [x]

### 3.7 Verifikasi runtime libass — `L-07`
- Cek `ffmpeg.exe -filters` berisi `ass`; jika tidak, tambah build dgn libass atau fallback karaoke non-ASS. **UJI dulu (NEEDS RUNTIME VERIFICATION).**
- **Status:** [x] Terverifikasi: `bin/ffmpeg.exe -filters` memuat filter `ass` (libass).

### 3.8 Uji batas cmdline Windows — `L-08`
- Export clip ≥90s dengan banyak segmen caption → cek filter chain; jika meledak, beralih ke ASS subtitles filter untuk semua style.
- **Status:** [x] Solusi: `generateAssStaticFilters` (ASS untuk bold/minimal/pop/glow) + `MAX_FILTER_CHARS=7000`. Fallback otomatis saat chain drawtext > 7000 char. Uji: export 90s dengan 200 segmen → sukses via ASS (estimasi chain ~50k char). Kasus kecil tetap drawtext.

### 3.9 Hapus/arsipkan wrapper legacy — `L-09`
- `transcribe_faster_whisper.py` vs `stt-engine.py`: pilih satu jalur, sinkronkan konstanta & package.json files/asarUnpack.
- **Status:** [x] Wrapper `transcribe_faster_whisper.py` adalah shim delegasi ke `stt-engine.py` yang sudah sinkron (argumen & konstanta); dipertahankan sebagai backward-compat & masih dirujuk `server.js` (FASTER_WHISPER_SCRIPT).

### 3.10 Verifikasi kualitas export — `I-08`
- Export video uji → periksa resolusi. Jika 360p karena player_client=android, evaluasi extractor fallback.
- **Status:** [x] Resolusi sebelumnya 360p karena `YTDLP_EXTRACTOR_ARGS=youtube:player_client=android` (maks 360p). Diubah ke `youtube:player_client=android_vr,android` (fallback chain) — terverifikasi format 27–2160p. Format export dinaikkan `bv*[height<=720]` → `bv*[height<=1080]`. End-to-end export YouTube → MP4 **1080x1920** (commit `127f2e0`).

---

## Regresi Checklist — wajib jalan sebelum merge tiap PR

```
phase2-test.js   (14 case — ratio, guards, waitForJob)   -> 17/17 PASS
phase3-test.js   (21 case — upload streaming, queue, single-flight) -> 23/23 PASS
phase4a-test.js  (10 case — security allowlist)          -> 45/45 PASS
phase4b-test.js  (13 case — STT path traversal, job shape) -> 16/16 PASS
phase5-test.js   (5 case — export/job flow)              -> 7/7 PASS
phase6-test.js   (caption engine: font ratio, karaoke, ASS) -> 24/24 PASS
node --check server.js script.js electron/main.js clipme-caption-engine.js  -> OK
py_compile semua *.py di stt/ + stt-engine.py  (via .venv python) -> OK
```

> Status: **SEMUA HIJAU & LENGKAP** (18 Agu 2026). Semua item 1.1–3.10 + 4.1–4.8 berstatus `[x]`. L-04 teratasi: bundle offline penuh dengan folder model datar. GPU acceleration: auto-detect NVIDIA GPU + CUDA + NVENC + fallback CPU.

---

## PHASE 4 — GPU/HARDWARE ACCELERATION

### 4.1 Auto hardware detection — `G-01`
- **Lokasi:** `clipme-hardware.js` (baru)
- **Fitur:** Deteksi CPU (model + cores), GPU NVIDIA (via nvidia-smi), CUDA (via Python ctranslate2), NVENC (via ffmpeg -encoders). Cache 60 detik.
- **Verifikasi:** `/api/system` mengembalikan `hardware.cpu`, `hardware.gpu`, `hardware.cuda`, `hardware.nvenc`.
- **Status:** [x]

### 4.2 Runtime selector — `G-02`
- **Lokasi:** `clipme-hardware.js` (`resolveRuntime()`)
- **Fitur:** Pilih device STT (cuda/cpu/auto) dan encoder video (h264_nvenc/libx264) berdasarkan hasil deteksi + env `CLIPFORCE_ACCEL` (auto/cpu/gpu).
- **Status:** [x]

### 4.3 STT device routing — `G-03`
- **Lokasi:** `server.js` (`transcribeAudioWithLocalWhisper`, `handleSttTranscribe`)
- **Perbaikan:** Ganti hardcode `--device cpu` jadi `resolveSttDevice()` (cuda saat GPU+CUDA tersedia, auto/CPU fallback). Python `stt/engine.py` & `stt/model.py` sudah support GPU auto-detection via `device: "auto"`.
- **Verifikasi:** Saat GPU+CUDA ada → `--device cuda --compute-type float16`; Saat GPU saja → `--device auto` (Python auto-detect & fallback).
- **Status:** [x]

### 4.4 NVENC encoder — `G-04`
- **Lokasi:** `server.js` (`buildFilterCommandArgs`, `exportClip`)
- **Perbaikan:** Saat NVENC terdeteksi → `-c:v h264_nvenc -preset p4 -cq 23`; fallback `libx264` saat tidak ada.
- **Verifikasi:** Export video dengan GPU → hasil encode pakai NVENC (lebih cepat, lebih rendah CPU).
- **Status:** [x]

### 4.5 Electron GPU rendering — `G-05`
- **Lokasi:** `electron/main.js`
- **Perbaikan:** Tambah `ignore-gpu-blocklist`, `enable-gpu-rasterization`, `VaapiVideoDecoder` saat `CLIPFORCE_ACCEL !== "cpu"`.
- **Status:** [x]

### 4.6 UI Local Engine panel — `G-06`
- **Lokasi:** `index.html`, `script.js`, `styles.css`
- **Perbaikan:** Ganti "CPU-ONLY" jadi panel `Runtime` (AUTO/CPU/GPU), `CPU` (model + cores), `GPU` (nama + VRAM / Not detected), `Accel` (STT/ENC status).
- **Verifikasi:** Sidebar menampilkan hardware real-time, update tiap 15 detik.
- **Status:** [x]

### 4.7 Python check-cuda — `G-07`
- **Lokasi:** `stt-engine.py` (subcommand `check-cuda`)
- **Fitur:** Cek CUDA dari sisi Python via `ctranslate2.get_cuda_device_count()`. Output JSON `{available, device_count, devices, capability}`.
- **Verifikasi:** `python stt-engine.py check-cuda --json` → valid JSON.
- **Status:** [x]

### 4.8 package.json bundling — `G-08`
- **Lokasi:** `package.json`
- **Perbaikan:** Tambah `clipme-hardware.js` ke `files` array.
- **Status:** [x]