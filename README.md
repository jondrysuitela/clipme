# ClipForge

Aplikasi lokal untuk mengubah URL YouTube menjadi short clips.

## Cara menjalankan

```powershell
node server.js
```

Lalu buka:

```text
http://localhost:4173
```

## Fitur yang sudah berfungsi

- Paste URL YouTube.
- Baca metadata YouTube dengan `yt-dlp` tanpa download full video.
- Ambil transcript/subtitle YouTube bila tersedia.
- Jika YouTube tidak menyediakan transcript, aplikasi bisa mencoba speech-to-text dari audio clip.
- OpenAI STT aktif otomatis jika `OPENAI_API_KEY` tersedia.
- Local Whisper aktif otomatis jika `.venv` berisi `faster-whisper`.
- Buat kandidat clip dari transcript, durasi, dan heatmap retention.
- Auto caption dari teks transcript di rentang clip.
- Viral score sederhana berbasis kata kunci, pertanyaan, kepadatan ucapan, dan heatmap.
- **ClipMe Intelligence Engine**: analisis clip multi-kriteria (hook strength, retention, value, story completeness, context independence, emotional impact, shareability, comment, quotability, rewatch) dengan score 0-100 + hard caps, 16 hook types, original vs recommended source hook (reorder aman), 3 caption variants, CTA, discussion question, hashtags, source evidence, dan quality gate. Tampil di tab **Intel** pada inspector.
- **Mode LLM**: jika `OPENAI_API_KEY` tersedia, analisis Intel diproses model AI dengan system prompt `clipme-prompt.js`. Tanpa API key, otomatis fallback ke engine heuristic lokal.
- Preview clip langsung di aplikasi dengan cached YouTube section resolusi ringan.
- Thumbnail clip menampilkan status `Needs preview`, `Loading`, atau `Ready`.
- Edit caption clip.
- Pilih rasio export: 9:16, 16:9, atau 1:1.
- Saat export, hanya section clip terpilih yang diambil lalu diproses dengan `ffmpeg`.
- Caption overlay ikut masuk ke file MP4.
- Export berjalan sebagai job queue dengan status progress.
- Library dan Exports punya view tersendiri.
- Export bisa memakai section preview yang sudah dicache agar lebih cepat.
- STT tidak lagi dijalankan untuk seluruh video di awal.
- Analyze URL default memakai metadata ringan agar jauh lebih cepat.
- Default terbaru memakai fast mode: paste URL langsung generate clip tanpa menunggu `yt-dlp`.
- Jika caption belum tersedia, STT berjalan on-demand hanya untuk clip yang dipreview/export.
- Queue membatasi pekerjaan berat agar tidak saling menabrak.
- **Timeline caption editor**: blok caption bisa digeser (drag) dan di-resize dari kiri/kanan, zoom dengan Ctrl+scroll, geser timeline dengan scroll, klik area kosong untuk seek, Space untuk play/pause.
- **Export SRT**: tombol `Export SRT` pada panel Caption Timeline menghasilkan file `.srt` untuk clip aktif.

## Catatan

Gunakan hanya video yang memang boleh kamu download/proses. Jika video tidak punya subtitle/manual caption/auto caption dan tidak ada STT provider aktif, aplikasi tetap membuat clip dari durasi video sebagai fallback.

## Speech-to-text

OpenAI:

```powershell
$env:OPENAI_API_KEY="sk-..."
node server.js
```

Model default: `gpt-4o-mini-transcribe`. Bisa diganti:

```powershell
$env:OPENAI_TRANSCRIBE_MODEL="gpt-4o-transcribe"
node server.js
```

Model analisis ClipMe Intel default: `gpt-4o-mini`. Bisa diganti:

```powershell
$env:CLIPME_ANALYZE_MODEL="gpt-4o"
node server.js
```

Local faster-whisper (buat venv di folder proyek ini):

```powershell
cd "D:\PROJEK CODING\clipme"
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install faster-whisper
node server.js
```

Atau jika venv di lokasi lain, set env var:

```powershell
$env:CLIPFORGE_VENV_PYTHON="C:\path\ke\.venv\Scripts\python.exe"
node server.js
```

Model default local STT adalah `small` di CPU dengan `int8`. Bisa diganti:

```powershell
$env:LOCAL_WHISPER_MODEL="base"
$env:LOCAL_WHISPER_DEVICE="cpu"
$env:LOCAL_WHISPER_COMPUTE_TYPE="int8"
node server.js
```

Mode cepat tanpa STT on-demand:

```powershell
$env:CLIPFORGE_ON_DEMAND_STT="0"
node server.js
```

Jika ingin analyze sekaligus mencoba subtitle YouTube penuh:

```powershell
$env:CLIPFORGE_DEEP_ANALYZE="1"
$env:CLIPFORGE_ANALYZE_TRANSCRIPT="1"
node server.js
```

Jumlah job berat paralel default adalah 2. Bisa diubah:

```powershell
$env:CLIPFORGE_MAX_JOBS="1"
node server.js
```
