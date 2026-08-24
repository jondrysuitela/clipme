const assert = require("assert");
const fs = require("fs");

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`[OK  ] ${name}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.error(`[FAIL] ${name}\n  -> ${error.message}`);
    process.exitCode = 1;
  }
}

const script = fs.readFileSync("script.js", "utf8");
const server = fs.readFileSync("server.js", "utf8");

// ── BUG: play clip lokal jalan sampai video habis (tanpa batas durasi) ──────
// Akar: /api/preview untuk video lokal mengembalikan video sumber PENUH
// (/media/...), dan loadPreviewClip memutar hasilnya tanpa timer stop.

test("server: preview lokal memotong section [start-end] (fallback media penuh)", () => {
  assert.match(server, /async function downloadLocalSection/, "local section cutter must exist");
  const cut = server.slice(server.indexOf("async function downloadLocalSection"), server.indexOf("async function handlePreview"));
  assert.match(cut, /"-ss", String\(start\)/, "accurate start seek");
  assert.match(cut, /"-t", String\(duration\)/, "duration must bound the cut");
  assert.match(cut, /sectionFileName\(payload, suffix, 0\)/, "cache key reuses sectionFileName");
  const preview = server.slice(server.indexOf("async function handlePreview"), server.indexOf("async function handleEditTranscript"));
  assert.match(preview, /downloadLocalSection\(projectDir, payload, \{ preview: true \}/, "local preview branch must cut a section");
  assert.match(preview, /\/sections\/\$\{projectId\}\/\$\{path\.basename\(sectionPath\)\}/, "primary URL is the bounded section");
  assert.match(preview, /: `\/media\/\$\{projectId\}`/, "/media/ only as failure fallback");
});

test("klien: loadPreviewClip memasang timer stop setelah autoplay", () => {
  const fn = script.slice(script.indexOf("async function loadPreviewClip"), script.indexOf("function togglePreviewPlayback"));
  assert.match(fn, /window\.clearInterval\(state\.loopTimer\)/, "must clear previous loop timer");
  assert.match(fn, /state\.loopTimer = window\.setInterval/, "must install stop-boundary loop timer");
  assert.match(fn, /previewVideo\.pause\(\)/, "timer must pause at boundary");
});

test("klien: offset waktu nol untuk file section (relatif), absolut untuk media penuh", () => {
  const fn = script.slice(script.indexOf("async function loadPreviewClip"), script.indexOf("function togglePreviewPlayback"));
  assert.match(fn, /const sectionBounded = String\(data\.previewUrl \|\| ""\)\.includes\("\/sections\/"\)/);
  assert.match(fn, /state\.liveOffset = sectionBounded \? 0 :/, "section files start at clip-relative zero");
  assert.ok(/sourceIsBoundedSection/.test(script), "helper must exist");
  const play = script.slice(script.indexOf("function playSelectedClip"), script.indexOf("async function loadPreviewClip"));
  assert.match(play, /const bounded = state\.noDownload \|\| sourceIsBoundedSection\(\)/, "replay must treat sections as bounded");
  assert.match(play, /previewVideo\.currentTime = bounded \? 0 : state\.activeClip\.start/);
});

test("klien: batas stop membedakan section YouTube (relatif) vs media penuh (absolut)", () => {
  const fn = script.slice(script.indexOf("async function loadPreviewClip"), script.indexOf("function togglePreviewPlayback"));
  assert.match(fn, /sectionBounded/, "must detect bounded section URLs");
  assert.match(fn, /\/sections\//, "section detection uses /sections/ prefix");
  assert.match(fn, /Number\(previewedClip\.end\) - Number\(previewedClip\.start\)/, "section stop is relative (end-start)");
  assert.match(fn, /: Number\(previewedClip\.end\)/, "full-media stop is absolute (end)");
});

test("klien: timer stop kebal clip aktif hilang/diganti (race guard)", () => {
  const fn = script.slice(script.indexOf("async function loadPreviewClip"), script.indexOf("function togglePreviewPlayback"));
  assert.match(fn, /state\.activeClip !== previewedClip/, "stale clip must clear the timer");
  const play = script.slice(script.indexOf("function playSelectedClip"), script.indexOf("async function loadPreviewClip"));
  assert.match(play, /if \(!playingClip\)/, "playSelectedClip timer must guard null activeClip");
});

test("klien: upload lokal me-reset state turunan YouTube (noDownload/youtubeUrl)", () => {
  const up = script.slice(script.indexOf("async function uploadToBackend"), script.indexOf("async function waitForJob"));
  assert.match(up, /state\.noDownload = false;/, "stale noDownload=true would route local play into unbounded preview path");
  assert.match(up, /state\.youtubeUrl = "";/, "stale youtubeUrl breaks liveOffset seek");
});

// ── Tombol "Analyze Hook Viral" khusus drop video ───────────────────────────
test("tombol: UI analyzeHookBtn ada di bawah dropzone", () => {
  const html = fs.readFileSync("index.html", "utf8");
  const dz = html.indexOf('id="dropzone"');
  const btn = html.indexOf('id="analyzeHookBtn"');
  assert.ok(btn > -1, "analyzeHookBtn must exist");
  assert.ok(dz > -1 && btn > dz && btn - dz < 600, "button must sit right after the dropzone");
});

test("server: endpoint analyze-hook menjalankan job analisis (progres via polling)", () => {
  assert.match(server, /async function handleAnalyzeHook/, "endpoint handler must exist");
  const h = server.slice(server.indexOf("async function handleAnalyzeHook"), server.indexOf("function handleDeleteProject"));
  assert.match(h, /createJob\("upload-analyze"/, "analysis must run as a trackable job");
  assert.match(h, /jobId: job\.id/, "response must carry jobId for progress polling");
  assert.match(h, /analyzeLocalUpload\(projectDir/, "worker must be wired");
  const w = server.slice(server.indexOf("async function analyzeLocalUpload"), server.indexOf("async function handleUpload"));
  assert.match(w, /transcribeAudio\(audioPath/, "must run STT");
  assert.match(w, /setProgress\(20 \+ Math\.min\(65, Math\.round\(pct \* 0\.65\)\), "Transkripsi suara \(STT\)"\)/, "STT progress must feed the job");
  assert.match(w, /buildTranscriptClips\(transcript, probe\.duration, targetLen, language/, "must use full intelligence pipeline");
  assert.match(w, /mode: durMode,\s*fixedDuration:/, "duration mode must reach the engine");
  assert.match(w, /transcriptPath: "transcript\.json"/, "manifest must persist transcript for preview/generate");
  assert.match(w, /clips = buildClips\(probe\.duration, targetLen\)/, "STT failure falls back to plain clips");
});

test("klien: tombol memanggil endpoint & mem-poll jobId (progres % di UI)", () => {
  const btn = script.slice(script.indexOf("async function startHookAnalysis"), script.indexOf("async function startHookAnalysis") + 2400);
  assert.match(btn, /\/api\/projects\/\$\{state\.projectId\}\/analyze-hook/, "must call the analyze-hook endpoint");
  assert.match(btn, /waitForJob\(data\.jobId/, "client must poll the analysis job (progress % in UI)");
  assert.match(btn, /clips = analyzed;/, "analyzed clips replace placeholders after job done");
});

// ── Banner progres job di dashboard utama ───────────────────────────────────
test("banner: komponen jobProgress ada di dashboard utama (bukan bar timeline video)", () => {
  const html = fs.readFileSync("index.html", "utf8");
  const topbar = html.indexOf('class="topbar"');
  const banner = html.indexOf('id="jobProgress"');
  assert.ok(banner > -1, "jobProgress banner must exist");
  assert.ok(topbar > -1 && banner > topbar && banner - topbar < 1400, "banner must sit right under the topbar");
  for (const id of ["jpFill", "jpPct", "jpLabel", "jpStage", "jpSpinner"]) {
    assert.ok(html.includes(`id="${id}"`), `banner part ${id} must exist`);
  }
});

test("banner: animasi gradient flow + sheen + indeterminate + state sukses/gagal", () => {
  const css = fs.readFileSync("styles.css", "utf8");
  const block = css.slice(css.indexOf(".job-progress {"));
  assert.match(block, /@keyframes jpFlow/, "gradient must flow while running");
  assert.match(block, /@keyframes jpSheen/, "sheen sweep animation required");
  assert.match(block, /\.indeterminate/, "indeterminate mode required (upload phase)");
  assert.match(block, /\.success/, "success state required");
  assert.match(block, /\.error/, "error state required");
  assert.match(block, /@keyframes jpShake/, "error shake required");
  assert.match(block, /prefers-reduced-motion/, "accessibility: respect reduced motion");
});

test("klien: waitForJob memakai banner + stage server, tidak merusak bar timeline video", () => {
  const wj = script.slice(script.indexOf("async function waitForJob"), script.indexOf("async function processYouTubeUrl"));
  assert.match(wj, /setJobProgress\(job\.progress, job\.stage \|\| ""\)/, "server stage label must reach the banner");
  assert.match(wj, /settleJobProgress\("success"/, "done must settle the banner as success");
  assert.match(wj, /settleJobProgress\("error"/, "failed/cancelled must settle the banner as error");
  assert.doesNotMatch(wj, /\$\("#progressBar"\)/, "video timeline bar must NOT be hijacked by jobs anymore");
});

test("server: job membawa label tahap (stage) dari worker", () => {
  assert.match(server, /if \(stage\) job\.stage = String\(stage\)\.slice\(0, 80\)/, "worker stage updates must be stored");
  assert.match(server, /stage: job\.stage \|\| ""/, "/api/jobs/:id must expose stage");
  const w = server.slice(server.indexOf("async function analyzeLocalUpload"), server.indexOf("async function handleUpload"));
  assert.match(w, /"Ekstraksi audio"/, "audio extraction stage labeled");
  assert.match(w, /"Transkripsi suara \(STT\)"/, "STT stage labeled");
  assert.match(w, /"Analisis hook viral"/, "hook analysis stage labeled");
});

// ── Indikator dropzone + tombol analyze menunggu upload ─────────────────────
test("dropzone: tag indikator file (uploading/loaded/error) ada di UI & CSS", () => {
  const html = fs.readFileSync("index.html", "utf8");
  for (const id of ["dzFileTag", "dzFileName", "dzFileSize"]) {
    assert.ok(html.includes(`id="${id}"`), `dropzone indicator part ${id} must exist`);
  }
  const css = fs.readFileSync("styles.css", "utf8");
  assert.match(css, /\.dropzone\[data-state="loaded"\]/, "loaded state styled (video sudah masuk)");
  assert.match(css, /\.dropzone\[data-state="uploading"\]/, "uploading state styled");
  assert.match(css, /\.dropzone\[data-state="error"\]/, "error state styled");
});

test("klien: attachFile menandai dropzone & mencatat promise upload berjalan", () => {
  const af = script.slice(script.indexOf("function markDropzone"), script.indexOf("function playSelectedClip"));
  assert.match(af, /markDropzone\("uploading", file\)/, "uploading marker before request");
  assert.match(af, /markDropzone\("loaded", file\)/, "loaded marker on success (tanda video sudah masuk)");
  assert.match(af, /markDropzone\("error", file\)/, "error marker on failure");
  assert.match(af, /state\.localUploadPromise = uploadPromise;/, "in-flight upload must be trackable");
});

test("klien: tombol analyze menunggu upload berjalan, bukan langsung menolak", () => {
  const btn = script.slice(script.indexOf("async function startHookAnalysis"), script.indexOf("async function startHookAnalysis") + 2600);
  const guardPos = btn.indexOf("if (!state.projectId)");
  const waitPos = btn.indexOf("await state.localUploadPromise;");
  assert.ok(guardPos > -1 && waitPos > guardPos, "analyze must await in-flight upload when projectId not set yet");
  assert.match(btn, /Upload masih berjalan/, "user must be told the upload is still running");
  assert.match(btn, /Upload video dulu sebelum analisis/, "plain alert only when nothing was dropped");
});

test("regresi: variabel respons upload di scope fungsi, bukan terjebak blok try", () => {
  const start = script.indexOf("async function uploadToBackend");
  const end = script.indexOf("function loadProject", start);
  const fn = script.slice(start, end);
  assert.doesNotMatch(fn, /const data = await response\.json\(\);/, "const inside try breaks code after the block (ReferenceError)");
  assert.match(fn, /let data;\s*\n\s*try \{/, "data must be declared at function scope before try");
});

// ── Semua operasi berdurasi pakai banner progres ────────────────────────────
test("banner: semua flow panjang menampilkan progres (upload/youtube/analyze/preview/caption/translate/generate/export)", () => {
  for (const label of ["Mengunggah video", "Analyze YouTube", "Menyiapkan preview", "Auto caption", "Menerjemahkan caption", "Generate clips"]) {
    assert.ok(script.includes(`"${label}"`), `flow label "${label}" must drive the banner`);
  }
  // Job-based flows (export, batch, gabung, analyze-hook, cut-to-face) otomatis
  // lewat waitForJob -> auto-show banner.
  const wj = script.slice(script.indexOf("async function waitForJob"), script.indexOf("async function processYouTubeUrl"));
  assert.match(wj, /showJobProgress\(JOB_LABELS\[job\.type\]/, "job flows auto-show the banner");
});

test("banner: setiap flow punya penutup (settle sukses/gagal) di semua jalur keluar", () => {
  const flows = [
    ["async function processYouTubeUrl", "async function attachFile"],
    ["async function loadPreviewClip", "async function exportSelectedClip"],
    ["async function exportSelectedClip", "$(\"#translateBtn\")"],
    ['$("#autoCaptionBtn").addEventListener', "$(\"#autoCaptionToggle\")"],
    ['$("#translateBtn").addEventListener', "function parseSrtVtt"],
    ['$("#generateButton").addEventListener', '$("#playClip")']
  ];
  for (const [a, b] of flows) {
    const startPos = script.indexOf(a);
    assert.ok(startPos > -1, `${a} must exist`);
    const endPos = script.indexOf(b, startPos + a.length);
    const seg = script.slice(startPos, endPos > -1 ? endPos : undefined);
    const settles = (seg.match(/settleJobProgress\(/g) || []).length;
    assert.ok(settles >= 2, `${a} must settle success AND error paths (found ${settles})`);
  }
});

// ── Translate: overlay preview harus ikut bahasa baru ──────────────────────
test("translate: timing kata karaoke dibangun ulang dari teks hasil terjemahan", () => {
  const start = script.indexOf('$("#translateBtn").addEventListener');
  const seg = script.slice(start, script.indexOf("function parseSrtVtt", start));
  // Karaoke overlay me-render seg.words (bukan text) — words basi = bahasa lama
  // tetap tampil di preview walau timeline sudah berubah.
  assert.match(seg, /rebuildSegmentKaraoke\(next\)/, "translated segments must rebuild karaoke word timings");
  assert.doesNotMatch(seg, /return \{ \.\.\.s, text: keep \};/, "must not keep stale foreign words array");
});

// ── Settings harus benar-benar berfungsi sampai export (bukan mock) ─────────
test("settings: caption position dipakai filter ASS export (karaoke & static), bukan MarginV hardcode", () => {
  const karaoke = server.slice(server.indexOf("function generateKaraokeFilters"), server.indexOf("function buildFilterChain"));
  assert.match(karaoke, /Karaoke,,0,0,\$\{marginV\},,/, "karaoke Dialogue must use computed marginV from user position");
  const stat = server.slice(server.indexOf("function generateAssStaticFilters"), server.indexOf("function buildFilterCommandArgs"));
  assert.match(stat, /Caption,,0,0,\$\{marginV\},,/, "static ASS Dialogue must use computed marginV from user position");
  // marginV wajib diturunkan dari captionPosition yang dikirim client.
  assert.match(karaoke, /captionPosition = 0\.76/);
  assert.match(karaoke, /baseY = Math\.round\(height \* Math\.max\(0\.3, Math\.min\(0\.95, Number\(captionPosition\)\)\)\)/);
});

test("settings: size/style/font/warna terkirim di SEMUA jalur export", () => {
  for (const [a, b] of [
    ["const basePayload = {", "let response;"],
    ['fetch("/api/export-batch"', "Batch export gagal"],
    ["function exportClipPayloadFor", '$("#exportCombinedBtn").addEventListener']
  ]) {
    const s = script.indexOf(a);
    const seg = script.slice(s, script.indexOf(b, s));
    for (const field of ["captionStyle:", "captionSize:", "fontFamily:", "captionColor:", "captionPosition:"]) {
      assert.ok(seg.includes(field), `${field} missing in export payload near "${a.slice(0, 30)}"`);
    }
  }
});

test("settings: speakerCut & faceTrack benar-benar masuk analisis lokal server", () => {
  const ex = server.slice(server.indexOf("async function exportClip"), server.indexOf("// Detect & remove baked-in black bars"));
  assert.match(ex, /payload\.speakerCut = !!payload\.speakerCut;/, "speakerCut sanitized");
  assert.match(ex, /enableFaceTracking: payload\.faceTrack/, "faceTrack feeds local AI analysis");
});

// ── Phase 1: Dashboard / command center ─────────────────────────────────────
test("dashboard: nav lengkap (7 view) & dashboard jadi landing default", () => {
  const html = fs.readFileSync("index.html", "utf8");
  for (const v of ["dashboard", "studio", "library", "exports", "results", "analytics", "dna"]) {
    assert.ok(html.includes(`data-view="${v}"`), `nav item ${v} must exist`);
    assert.ok(html.includes(`data-view-panel="${v}"`), `panel ${v} must exist`);
  }
  const dash = html.indexOf('data-view-panel="dashboard"');
  const studio = html.indexOf('data-view-panel="studio"');
  assert.ok(dash > -1 && studio > dash, "dashboard panel must precede studio");
  const active = html.slice(html.lastIndexOf("<div", dash), dash);
  assert.match(active, /class="app-view page-view active"/, "dashboard must be the initial active view");
  // Intelligence dikelompokkan sendiri di sidebar
  assert.ok(html.includes("Intelligence</p>"), "sidebar Intelligence group label");
});

test("dashboard: 4 KPI card & nilainya dari data nyata (anti-mock)", () => {
  const html = fs.readFileSync("index.html", "utf8");
  for (const id of ["kpiProjects", "kpiClips", "kpiScore", "kpiExports"]) {
    assert.ok(html.includes(`id="${id}"`), `KPI ${id} must exist`);
  }
  const block = script.slice(script.indexOf("// ================= DASHBOARD"));
  assert.match(block, /state\.projects\.length/, "projects KPI dari /api/projects");
  assert.match(block, /state\.exports\.length/, "exports KPI dari /api/exports");
  assert.match(block, /acc \+ \(Number\(p\.clips\) \|\| 0\)/, "clips KPI dijumlah dari project list");
  // Avg score hanya dari clip.score numerik via detail API, bukan angka hardcode
  assert.match(block, /typeof c\.score === "number"/);
  assert.match(block, /\/api\/projects\/\$\{p\.id\}/);
  assert.match(block, /hint\.textContent = "No data yet"/, "tanpa skor → 'No data yet', bukan angka palsu");
  assert.doesNotMatch(block, /(textContent|innerText)\s*=\s*["']\d{2,}["']/, "no fabricated constants");
});

test("dashboard: recent projects pakai flow Open yang sama dengan Library", () => {
  const block = script.slice(script.indexOf("// ================= DASHBOARD"));
  assert.match(block, /function renderDashboardProjects/, "renderer ada");
  assert.match(block, /data-open-project/, "pakai atribut open yang sama");
  const init = block.slice(block.indexOf("function initDashboard"));
  assert.match(init, /loadProject\(data\)/, "open memuat project via API detail");
  assert.match(init, /showView\("studio"\)/, "open mendarat di Studio, bukan viewer baru");
});

test("dashboard: engine status real dari /api/system + localai + queue", () => {
  const html = fs.readFileSync("index.html", "utf8");
  for (const id of ["dashCpu", "dashGpu", "dashFfmpeg", "dashAi", "dashQueue"]) {
    assert.ok(html.includes(`id="${id}"`), `chip ${id} must exist`);
  }
  const fn = script.slice(script.indexOf("async function updateDashboardEngineStatus"), script.indexOf("function initDashboard"));
  assert.match(fn, /\/api\/system/);
  assert.match(fn, /\/api\/localai\/status/);
  assert.match(fn, /\/api\/queue/);
  assert.match(fn, /hw\.gpu \|\| \{\}/, "GPU state dari hardware nyata");
  assert.doesNotMatch(fn, /"RTX|GTX/i, "tidak mengarang nama hardware");
});

test("dashboard: placeholder intelligence tanpa chart/statistik palsu", () => {
  const html = fs.readFileSync("index.html", "utf8");
  // Phase 3: Results kini workspace nyata — placeholder tersisa Analytics & DNA saja
  const coming = (html.match(/Coming next/g) || []).length;
  assert.strictEqual(coming, 2, "Analytics & DNA masing2 satu empty state");
  assert.ok(html.includes('data-view-panel="results"'), "results panel exists");
  assert.ok(html.includes('id="resultsClipList"'), "results workspace is real, not placeholder");
  assert.ok(!/<canvas/i.test(html), "no fake canvas charts");
  assert.doesNotMatch(script, /Chart\(/, "no chart library stubs");
});

// ── Phase 3: Results workspace + clip intelligence (REAL data only) ─────────
test("phase3: results UI lengkap — header real metadata, filter, sort, search", () => {
  const html = fs.readFileSync("index.html", "utf8");
  for (const id of ["resProjectName", "resSource", "resDuration", "resClipsCount", "resAnalyzed", "analyzeAllBtn", "resStatePill", "resultsClipList", "resSearch", "resFilter", "resSort", "riTiming", "riScore", "riHookScore", "riHookType", "riTitle", "riTranscript", "rtRegion"]) {
    assert.ok(html.includes(`id="${id}"`), `results part ${id} must exist`);
  }
  for (const opt of ["top", "analyzed", "unanalyzed"]) {
    assert.ok(html.includes(`value="${opt}"`), `filter ${opt} exists`);
  }
  for (const sortV of ["original", "scoreDesc", "scoreAsc", "duration"]) {
    assert.ok(html.includes(`value="${sortV}"`), `sort ${sortV} exists`);
  }
});

test("phase3: tanpa mock — skor dari backend, missing = '—', tanpa Math.random/setTimeout fake", () => {
  const block = script.slice(script.indexOf("// ================= RESULTS WORKSPACE"), script.indexOf("const SETTINGS_KEY"));
  assert.doesNotMatch(block, /Math\.random/, "no random scores");
  assert.doesNotMatch(block, /setTimeout\(/, "no fake timing");
  assert.match(block, /clip\.score != null \|\| !!clip\.analysis/, "analyzed flag dari data nyata");
  assert.match(block, /clip\.score != null \?/, "viral score hanya bila ada");
  assert.match(block, /No title generated yet\./, "title kosong jujur");
  assert.match(block, /\|\| "&mdash;"|\|\| "—"/, "missing values render dash");
  assert.match(block, /\/api\/analyze-clip/, "analyze via endpoint existing");
});

test("phase3: ANALYZE ALL berjalan SEQUENTIAL (tanpa flood concurrency)", () => {
  const block = script.slice(script.indexOf("// ================= RESULTS WORKSPACE"), script.indexOf("const SETTINGS_KEY"));
  assert.match(block, /for \(const clip of targets\)/, "sequential loop over unanalyzed clips");
  assert.match(block, /await analyzeResultClip\(clip\)/, "each clip awaited before next");
  assert.doesNotMatch(block, /Promise\.all\([\s\S]{0,60}analyzeResultClip/, "must not fire all at once");
  assert.match(block, /PARTIAL RESULTS/, "partial state on failures");
});

test("phase3: PREVIEW/STUDIO reuse infrastruktur existing — TANPA player kedua", () => {
  const html = fs.readFileSync("index.html", "utf8");
  const videoTags = (html.match(/<video/g) || []).length;
  assert.strictEqual(videoTags, 1, "single preview player in whole app (reuse, not duplicate)");
  const block = script.slice(script.indexOf("// ================= RESULTS WORKSPACE"), script.indexOf("const SETTINGS_KEY"));
  assert.match(block, /selectClip\(liveClip\)/, "handoff selects the exact clip in Studio");
  assert.match(block, /showView\("studio"\)/, "handoff opens existing Studio view");
  assert.match(block, /playSelectedClip\(\)/, "PREVIEW uses existing playback entry");
  assert.match(block, /loadProject\(data\)/, "project loaded via existing loader (no second storage)");
});

test("phase3: transcript bertimestamp nyata dari timedSegments analyze-clip + seek", () => {
  const block = script.slice(script.indexOf("// ================= RESULTS WORKSPACE"), script.indexOf("const SETTINGS_KEY"));
  assert.match(block, /resultsState\.transcripts\[clip\.id\] = data\.timedSegments/, "transcript lines from real response");
  assert.match(block, /function seekPreviewToSegment/, "click-to-seek exists");
  assert.match(block, /state\.noDownload \? Number\(seg\.start\) \|\| 0 : \(Number\(clip\.start\) \|\| 0\) \+ \(Number\(seg\.start\) \|\| 0\)/, "seek math distinguishes bounded section vs full source");
});

test("phase3: handoff Processing→Results & Dashboard RECENT RESULTS dari data sama", () => {
  const proc = script.slice(script.indexOf('$("#procResultsBtn").addEventListener'), script.indexOf('$("#procBackBtn").addEventListener'));
  assert.match(proc, /openResultsForProject\(processingState\.projectId\)/, "completed job hands off to Results when project known");
  const avg = script.slice(script.indexOf("async function updateDashboardAvgScore"), script.indexOf("// ================= RESULTS WORKSPACE"));
  assert.match(avg, /renderRecentResults\(details\)/, "recent results reuses avg-score detail fetches (no extra API)");
  const rr = script.slice(script.indexOf("function renderRecentResults"), script.indexOf("// ================= RESULTS WORKSPACE"));
  assert.match(rr, /NO RECENT RESULTS/, "honest empty state");
  assert.match(rr, /openResultsForProject\(latest\.id\)/, "VIEW RESULTS opens real project results");
});

test("dashboard: CTA New Project membuka workflow upload Studio existing", () => {
  const block = script.slice(script.indexOf("// ================= DASHBOARD"));
  const open = block.slice(block.indexOf("function openCreateWorkspace"), block.indexOf("let dashBusy"));
  assert.match(open, /showView\("studio"\)/);
  assert.match(open, /getElementById\("videoInput"\)/, "reuse input upload Studio");
  assert.match(script, /initDashboard\(\);/, "dashboard di-init saat boot");
});

// ── Phase 2: Engine readiness + processing workspace (REAL, no mock) ────────
test("phase2: probeVideo mengembalikan fps & hasAudio nyata untuk kartu SOURCE", () => {
  const fn = server.slice(server.indexOf("async function probeVideo"), server.indexOf("function targetClipLength"));
  assert.match(fn, /avg_frame_rate/, "fps dari ffprobe avg_frame_rate");
  assert.match(fn, /codec_type === "audio"/, "hasAudio dari stream audio nyata");
  assert.match(fn, /hasAudio/);
});

test("phase2: checkEngineReadiness pakai API nyata; tak terdeteksi = UNKNOWN bukan READY", () => {
  const fn = script.slice(script.indexOf("async function checkEngineReadiness"), script.indexOf("// ---- Processing view controller"));
  for (const api of ["/api/system", "/api/localai/status", "/api/stt/models"]) {
    assert.ok(fn.includes(api), `readiness must query ${api}`);
  }
  assert.match(fn, /"unknown"/, "undetectable components must be UNKNOWN");
  assert.match(fn, /SYSTEM READY/, "summary ready state exists");
  assert.doesNotMatch(fn, /setEr\("er\w+", "ready"[^)]*READY"(?![\s\S]{0,80}sys\b)/, "no unconditional READY");
});

test("phase2: tanpa progres/id palsu di kode processing", () => {
  const block = script.slice(script.indexOf("// ================= PROCESSING WORKSPACE"));
  assert.doesNotMatch(block, /progress \+= \d/, "no fabricated progress increments");
  assert.doesNotMatch(block, /progress\s*=\s*\d{2}\s*;/, "no hardcoded progress values");
  // polling job HANYA lewat waitForJob (satu mekanisme); blok ini tidak punya
  // loop poll sendiri — hanya clock UI elapsed + satu kali lookup status terminal.
  assert.doesNotMatch(block, /while \(true\)/, "no second polling loop");
  assert.doesNotMatch(block, /setInterval\([\s\S]{0,80}api\/jobs/, "no interval-based job fetching");
});

test("phase2: processing view lengkap & cancel pakai endpoint DELETE existing", () => {
  const html = fs.readFileSync("index.html", "utf8");
  for (const id of ["procTitle", "procStatePill", "procJobId", "procFill", "procTask", "procPipeline", "procElapsed", "procEta", "procCancelBtn", "procRetryBtn", "procResultsBtn", "procErrorReason", "procQueueList"]) {
    assert.ok(html.includes(`id="${id}"`), `processing UI part ${id} must exist`);
  }
  const cancel = script.slice(script.indexOf('$("#procCancelBtn").addEventListener'), script.indexOf('$("#procRetryBtn").addEventListener'));
  assert.match(cancel, /DELETE/, "cancel must call existing DELETE /api/jobs/:id");
  assert.match(cancel, /processingState\.jobId/);
  const failFn = script.slice(script.indexOf("async function failProcessingView"), script.indexOf("function openProcessingForJob"));
  assert.match(failFn, /terminalStatus === "cancelled"/, "cancelled state handled distinctly");
  assert.match(failFn, /console\.error/, "detail error preserved in console, not dumped raw in UI");
});

test("phase2: pipeline stage di client SAMA dengan label worker server (honest mapping)", () => {
  const stagesBlock = script.slice(script.indexOf("const PIPELINE_STAGES"), script.indexOf("const processingState"));
  for (const stage of ["Menyiapkan berkas", "Ekstraksi audio", "Transkripsi suara (STT)", "Analisis hook viral", "Skor & judul Deep AI"]) {
    assert.ok(stagesBlock.includes(stage), `client pipeline missing "${stage}"`);
  }
  const w = server.slice(server.indexOf("async function analyzeLocalUpload"), server.indexOf("async function handleUpload"));
  for (const stage of ["Menyiapkan berkas", "Ekstraksi audio", "Transkripsi suara (STT)", "Analisis hook viral", "Skor & judul Deep AI"]) {
    assert.ok(w.includes(stage), `server worker missing "${stage}"`);
  }
  // tipe job lain tanpa peta tahap → pipeline disembunyikan, bukan dikarang
  const tick = script.slice(script.indexOf("function renderProcessingTick"), script.indexOf("function completeProcessingView"));
  assert.match(tick, /PIPELINE_STAGES\[job\.type\]/);
  assert.match(tick, /display = "none"/, "unmapped job types hide the pipeline instead of faking it");
});

test("phase2: dashboard ACTIVE PROCESSING dari /api/queue + tombol VIEW JOB", () => {
  const html = fs.readFileSync("index.html", "utf8");
  assert.ok(html.includes('id="dashActiveJobs"'), "active jobs container");
  assert.match(html, /NO ACTIVE JOBS/, "empty state per spec");
  const pq = script.slice(script.indexOf("async function pollQueue"), script.indexOf("function statusPillClass"));
  assert.match(pq, /renderActiveJobs\(jobs\)/, "existing queue poll feeds active-jobs card (no duplicate poller)");
  const rj = script.slice(script.indexOf("function renderActiveJobs"), script.indexOf("// ================= PROCESSING WORKSPACE"));
  assert.match(rj, /openProcessingForJob\(job\.id/, "VIEW JOB opens processing workspace");
  assert.match(rj, /JOB_LABELS\[job\.type\] \|\| job\.type/, "label falls back to real job type");
});

test("phase2: source info + nama project + profile selector ter-wiring", () => {
  const html = fs.readFileSync("index.html", "utf8");
  for (const id of ["sourceInfoCard", "siName", "siDuration", "siRes", "siFps", "siAudio", "projectNameInput", "processingProfileSelect"]) {
    assert.ok(html.includes(`id="${id}"`), `${id} must exist`);
  }
  assert.match(html, /value="fast" disabled/, "FAST marked coming-soon, not fake-enabled");
  assert.match(html, /value="quality" disabled/, "QUALITY marked coming-soon");
  assert.match(html, /value="auto" selected/, "AUTO maps to existing default pipeline");
  assert.match(script, /applyProjectNamePatch/, "project name patch helper exists");
  assert.match(script, /fillSourceInfo\(data\.name/, "upload fills source info from probe");
});

// ── Phase 4: Studio persistence + final render config (REAL pipeline reuse) ─
test("phase4: SAVE persist clips via PATCH existing — Saved hanya setelah server OK", () => {
  const html = fs.readFileSync("index.html", "utf8");
  assert.ok(html.includes('id="saveProjectBtn"'), "SAVE button exists");
  const fn = script.slice(script.indexOf("async function saveStudioToServer"), script.indexOf('$("#saveProjectBtn").addEventListener'));
  assert.match(fn, /method: "PATCH"/, "uses existing PATCH /api/projects/:id");
  assert.match(fn, /JSON\.stringify\(\{ clips: payload \}\)/, "persists the actual clips array");
  for (const field of ["start:", "end:", "hook:", "caption:"]) {
    assert.ok(fn.includes(field), `payload must carry ${field}`);
  }
  assert.match(fn, /clearStudioDirty\(\)/, "dirty cleared only after server confirms");
  assert.match(fn, /Perubahan tersimpan/, "Saved feedback after success");
  assert.doesNotMatch(fn, /localStorage\.setItem/, "no second storage");
});

test("phase4: dirty tracking pada trim/hook/caption + pill UNSAVED CHANGES", () => {
  const html = fs.readFileSync("index.html", "utf8");
  assert.ok(html.includes('id="studioDirtyPill"'), "dirty pill exists");
  const trim = script.slice(script.indexOf("function applyTrim"), script.indexOf("const RATIO_PRESETS"));
  assert.match(trim, /markStudioDirty\(\)/, "trim marks dirty");
  const hookL = script.slice(script.indexOf("hookInput.addEventListener"), script.indexOf("captionSize.addEventListener"));
  assert.match(hookL, /markStudioDirty\(\)/, "hook edit marks dirty");
  const capL = script.slice(script.indexOf("captionInput.addEventListener"), script.indexOf("hookInput.addEventListener"));
  assert.match(capL, /markStudioDirty\(\)/, "caption edit marks dirty");
});

test("phase4: BACK TO RESULTS tampil hanya dari Studio dengan project Results", () => {
  const sv = script.slice(script.indexOf("function showView(view)"), script.indexOf("function setLocalPreview"));
  assert.match(sv, /backBtn\.hidden = !\(view === "studio" && resultsState\.projectId\)/, "visibility rule");
  const btn = script.slice(script.indexOf('$("#backToResultsBtn").addEventListener'), script.indexOf("// ================= STUDIO PERSISTENCE") > -1 ? script.indexOf('$("#backToResultsBtn").addEventListener') + 400 : undefined);
  assert.match(btn, /openResultsForProject\(resultsState\.projectId\)/, "returns to real Results workspace");
});

test("phase4: final preview strip membaca konfigurasi nyata yang dikirim ke renderer", () => {
  const html = fs.readFileSync("index.html", "utf8");
  for (const id of ["finalPreviewStrip", "fpFormat", "fpCaptions", "fpDuration"]) {
    assert.ok(html.includes(`id="${id}"`), `strip part ${id} must exist`);
  }
  const fn = script.slice(script.indexOf("function updateFinalPreviewStrip"), script.indexOf("// Preset posisi caption"));
  assert.match(fn, /RATIO_LABELS\[currentRatio\(\)\]/, "format from live ratio state");
  assert.match(fn, /autoCaptionEnabled\(\)/, "captions ON/OFF from real toggle");
  assert.match(fn, /state\.activeClip\.end \|\| 0\) - \(state\.activeClip\.start/, "duration from active clip boundaries");
});

test("phase4: preset posisi menyalurkan ke slider existing (satu jalur ke export)", () => {
  const html = fs.readFileSync("index.html", "utf8");
  for (const v of ["35", "65", "88"]) {
    assert.ok(html.includes(`data-cpos="${v}"`), `preset ${v} exists`);
  }
  const block = script.slice(script.indexOf("$$('[data-cpos]')".replace(/'/g, '"')), script.indexOf("// Sumber video gagal dimuat"));
  assert.match(block, /captionPosition\.value = btn\.dataset\.cpos/, "sets the SAME slider");
  assert.match(block, /dispatchEvent\(new Event\("input"\)\)/, "reuses existing input path (preview + export)");
});

test("phase4: video error ditangani bersih + Ctrl+S menyimpan studio saat dirty", () => {
  const errBlock = script.slice(script.indexOf('previewVideo.addEventListener("error"'), script.indexOf("const SETTINGS_KEY"));
  assert.match(errBlock, /getAttribute\("src"/, "ignores empty source");
  assert.match(errBlock, /console\.error/, "technical detail in console only");
  assert.match(errBlock, /VIDEO UNAVAILABLE/, "clean user message");
  const ks = script.slice(script.indexOf('if (event.code === "KeyS")'), script.indexOf('if (event.code === "KeyZ"'));
  assert.match(ks, /studioDirty[\s\S]{0,80}saveStudioToServer\(\)/, "Ctrl+S persists studio edits when dirty");
});

if (!process.exitCode) console.log(`Preview boundary done: ${results.length}/${results.length} PASS`);
