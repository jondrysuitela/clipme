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
  for (const v of ["dashboard", "library", "exports", "publish", "results", "analytics", "dna"]) {
    assert.ok(html.includes(`data-view="${v}"`), `nav item ${v} must exist`);
    assert.ok(html.includes(`data-view-panel="${v}"`), `panel ${v} must exist`);
  }
  assert.ok(html.includes('data-view-panel="studio"'), "editor panel (studio) still exists — reachable via OPEN IN STUDIO");
  assert.ok(html.includes('data-view-panel="newproject"'), "dedicated new-project workspace panel exists");
  const dash = html.indexOf('data-view-panel="dashboard"');
  const studio = html.indexOf('data-view-panel="studio"');
  assert.ok(dash > -1 && studio > dash, "dashboard panel must precede studio");
  const active = html.slice(html.lastIndexOf("<div", dash), dash);
  assert.match(active, /class="app-view page-view active"/, "dashboard must be the initial active view");
  // Sidebar IA final: Tools group + NEW PROJECT CTA; studio bukan nav sama sekali;
  // workspace dedikasi: newproject / captions / settings
  assert.ok(html.includes("Tools</p>"), "sidebar Tools group label");
  assert.ok(html.includes('id="sidebarNewProjectBtn"'), "primary NEW PROJECT CTA in sidebar");
  assert.ok(!html.includes('data-view="studio"'), "old create nav item fully removed");
  for (const v of ["captions", "settings"]) {
    assert.ok(html.includes(`data-view="${v}"`), `nav ${v} exists`);
    assert.ok(html.includes(`data-view-panel="${v}"`), `panel ${v} exists`);
  }
  assert.ok(!html.includes('data-view="newproject"'), "newproject is an ACTION (button), not a sidebar destination");
  assert.ok(html.includes('data-view-panel="newproject"'), "newproject workspace panel exists");
  assert.match(script, /mountWorkspaces\(\);/, "workspaces mounted at boot");
  assert.match(script, /function renderCaptionsWorkspace/, "caption workspace renderer");
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
  // Phase 3: Results nyata; Phase 6: Analytics = honest unavailable + insights.
  // Placeholder "Coming next" tersisa Content DNA saja.
  const coming = (html.match(/Coming next/g) || []).length;
  assert.strictEqual(coming, 1, "only Content DNA remains a future placeholder");
  assert.ok(html.includes('data-view-panel="results"'), "results panel exists");
  assert.ok(html.includes('id="resultsClipList"'), "results workspace is real, not placeholder");
  assert.match(html, /Belum ada data performa/, "analytics honestly reports missing ledger data");
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
  assert.doesNotMatch(block, /setTimeout\([^)]*progress/i, "no fake progress timing");
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

test("phase3: PREVIEW/STUDIO reuse infrastruktur existing — player ter-inventarisasi, tanpa duplikasi liar", () => {
  const html = fs.readFileSync("index.html", "utf8");
  const videoTags = (html.match(/<video\b[^>]*\bid="([^"]+)"/g) || []).length;
  const ids = [...html.matchAll(/<video\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
  // Dua player resmi: editor (studio) + caption-play preview. Duplikasi lain tetap terlarang.
  assert.deepStrictEqual(ids.sort(), ["capPreviewVideo", "previewVideo"], "only the two inventoried players may exist");
  assert.strictEqual(videoTags, 2, "no untracked third player");
  const capVid = html.slice(html.indexOf('id="capPreviewVideo"') - 80, html.indexOf('id="capPreviewVideo"') + 120);
  assert.match(capVid, /playsinline/, "caption preview is muted-inline scoped, not a competing editor");
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

test("dashboard: CTA New Project membuka modal pembuatan project", () => {
  const block = script.slice(script.indexOf("// ================= DASHBOARD"));
  const open = block.slice(block.indexOf("function openCreateWorkspace"), block.indexOf("let dashBusy"));
  assert.match(open, /showView\("newproject"\)/, "CTA navigates to the dedicated New Project workspace");
  assert.match(script, /initDashboard\(\);/, "dashboard di-init saat boot");
});

test("create-workspace: ClipProfit flow — mode, ceiling, template library, tanpa modal duplikat", () => {
  const html = fs.readFileSync("index.html", "utf8");
  // Modal lama HAPUS — tidak boleh ada dua alur create yang bersaing
  assert.ok(!html.includes('id="newProjectModal"'), "legacy new-project modal removed");
  for (const id of ["genModeSegmented", "maxCeilingInput", "maxClipsSelect", "templateGalleryBtn", "hookStrategySelect", "focusInput"]) {
    assert.ok(html.includes(`id="${id}"`), `create workspace part ${id} must exist`);
  }
  assert.match(html, /Generate Best Clips/i, "primary CTA present");
  assert.match(html, /id="templateGalleryModal"/, "caption template gallery exists");
  const block = script.slice(script.indexOf("function generationMode()"), script.indexOf("function formatBytes"));
  // Generation modes harus nyata: mengubah payload durationMode/maxDuration
  assert.match(block, /gm === "manual"/, "MANUAL mode branch exists");
  assert.match(block, /durationMode: "FIXED", fixedDuration: ceiling/, "MANUAL locks duration");
  assert.match(block, /maxDuration:\s*ceiling/, "HYBRID passes hard ceiling to AI");
  // Template library: pilihan template menerapkan kontrol render yang benar-benar dipakai export
  const tplBlock = script.slice(script.indexOf("function applyCaptionTemplate"), script.indexOf("// ---- Generation mode segmented"));
  for (const sel of ["#captionStyleSelect", "#captionFontSelect", "#captionColor", "#captionSize", "#captionPosition"]) {
    assert.ok(tplBlock.includes(`$("${sel}")`), `template applies real control ${sel}`);
  }
});

test("metadata: generator server-side + copy buttons pakai nilai aktual (bukan placeholder)", () => {
  const metaSlice = server.slice(server.indexOf("function composeClipMetadata"), server.indexOf("async function handleAnalyzeHook"));
  assert.match(metaSlice, /deepTitle/, "title dari deep title engine");
  assert.match(metaSlice, /hashtags/, "hashtags dari analysis");
  assert.match(server, /\.add\("POST", "\/api\/projects\/:projectId\/metadata"/, "metadata endpoint registered");
  assert.match(server, /\.add\("POST", "\/api\/projects\/:projectId\/config"/, "config endpoint registered");
  // Copy TIDAK menyalin placeholder saat kosong — harus menolak dengan pesan.
  const copyFn = script.slice(script.indexOf("async function copyToClipboard"), script.indexOf("function pubChecklistUpdate"));
  assert.match(copyFn, /masih kosong/, "empty value refused, never copies placeholder");
  assert.doesNotMatch(copyFn, /\|\| "—"/, "no silent dash fallback");
  // Metadata card wired ke endpoint + regenerate
  const metaUi = script.slice(script.indexOf("function renderClipMetadataCard"), script.indexOf("function updateWorkspaceMode"));
  assert.match(metaUi, /\/api\/projects\/\$\{resultsState\.projectId\}\/metadata/, "card fetches real metadata");
  assert.match(script, /persistCreateConfig\(\)/, "create config persisted on generate");
  // NO PREVIEW RULE: setelah generate → langsung ke Results, bukan menumpuk clip di create workspace
  const analyzeFlow = script.slice(script.indexOf("async function startHookAnalysis"), script.indexOf("async function startHookAnalysis") + 3200);
  assert.match(analyzeFlow, /openResultsForProject\(state\.projectId\)/, "generate routes to RESULTS workspace");
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

// ── Phase 5: Batch production + export manager + publishing ─────────────────
test("phase5: multi-select Results stabil terhadap filter/sort/search", () => {
  const html = fs.readFileSync("index.html", "utf8");
  for (const id of ["resSelectAllBtn", "resClearSelBtn", "resSelCount", "batchProduceBtn"]) {
    assert.ok(html.includes(`id="${id}"`), `selection UI ${id} must exist`);
  }
  const block = script.slice(script.indexOf("// ================= BATCH PRODUCTION"));
  assert.match(block, /resultsState\.selectedIds = new Set\(\)/, "selection state (Set of ids)");
  // checkbox menulis ke Set (di card builder), TIDAK ke list visible → survive filter/sort
  assert.match(script, /resultsState\.selectedIds\.add\(clip\.id\)/, "checkbox adds to id Set");
  assert.match(block, /resultsState\.visible\.forEach\(\(c\) => resultsState\.selectedIds\.add\(c\.id\)\)/, "SELECT ALL targets visible list only");
});

test("phase5: batch modal hanya opsi nyata & START lewat /api/export-batch existing", () => {
  const html = fs.readFileSync("index.html", "utf8");
  for (const id of ["batchModal", "bpCount", "bpValidation", "bpCaptions", "bpStartBtn"]) {
    assert.ok(html.includes(`id="${id}"`), `batch modal part ${id} must exist`);
  }
  for (const r of ["portrait", "wide", "four5"]) {
    assert.ok(html.includes(`data-bpratio="${r}"`), `renderer ratio ${r} exposed`);
  }
  assert.ok(!html.includes('data-bpratio="square"'), "no unsupported formats faked");
  const fn = script.slice(script.indexOf("async function startBatch"), script.indexOf("function retryFailedBatch"));
  assert.match(fn, /\/api\/export-batch/, "uses existing batch endpoint — no second pipeline");
  assert.match(fn, /captionStyle: \$\("#bpCaptions"\)\.checked \? effectiveCaptionStyle\(\) : "off"/, "caption override maps to real payload field");
  assert.match(fn, /ratio: batchRatio/);
  assert.match(fn, /enterProcessingView\(data\.jobId/, "monitored via existing processing workspace");
});

test("phase5: validasi batch eksplisit + retry HANYA clip gagal", () => {
  const val = script.slice(script.indexOf("function bpValidateSelected"), script.indexOf("function openBatchModal"));
  assert.match(val, /rentang waktu tidak valid/, "invalid ranges flagged, not skipped silently");
  assert.match(val, /di luar durasi sumber/, "bounds checked against real duration");
  const retry = script.slice(script.indexOf("function retryFailedBatch"), script.indexOf("function openBatchModalFromSelection"));
  assert.match(retry, /lastFailedClipIds/, "retry limited to actually failed clips");
  const start = script.slice(script.indexOf("async function startBatch"), script.indexOf("function retryFailedBatch"));
  assert.match(start, /failedItems/, "per-clip failures inspected from real result.results");
});

test("phase5: export manager — search/sort/count + detail expandable dari data nyata", () => {
  const html = fs.readFileSync("index.html", "utf8");
  for (const id of ["exportsSearch", "exportsSort", "exportsCount"]) {
    assert.ok(html.includes(`id="${id}"`), `manager control ${id} must exist`);
  }
  const fn = script.slice(script.indexOf("function renderExports()"), script.indexOf('$("#exportsSearch").addEventListener'));
  assert.match(fn, /\$\("#exportsSearch"\)\.value/, "search filters loaded exports");
  assert.match(fn, /item\.project/, "detail shows real project info");
  assert.match(fn, /exp-detail/, "expandable detail row exists");
  assert.match(fn, /READY/, "file listed by server = READY (existence confirmed)");
  const load = script.slice(script.indexOf("async function loadExports"), script.indexOf("function renderLibrary"));
  assert.match(load, /_ts: Number\(e\.createdAt\)/, "real timestamps kept for sorting");
});

test("phase5: publishing jujur — metadata + copy, TANPA status publish palsu", () => {
  const html = fs.readFileSync("index.html", "utf8");
  assert.ok(html.includes('data-view-panel="publish"'), "publish view exists");
  assert.match(html, /Tidak ada auto-upload/, "explicit manual-upload notice");
  assert.ok(!/Published successfully/i.test(html), "no fake publish success text");
  const block = script.slice(script.indexOf("// ---- Publishing workspace"), script.indexOf("// Dashboard RECENT EXPORTS"));
  assert.doesNotMatch(block, /status\s*=\s*["']published["']/i, "no fabricated published state");
  assert.match(block, /navigator\.clipboard\.writeText/, "clipboard API used");
  assert.match(block, /Copied/, "confirmation after success");
  assert.match(block, /catch/, "failure path handled");
  assert.match(block, /deepTitleAlternatives/, "title variants from Deep Title engine");
  assert.match(block, /analysis\.hashtags|clip\.analysis && clip\.analysis\.hashtags/, "hashtags from real intel when present");
  const check = script.slice(script.indexOf("function pubChecklistUpdate"), script.indexOf("$$\\(\".pub-platform button\")".replace(/\\\(/g, "(").replace(/\\\)/g, ")")));
  assert.match(check, /\$\("#pubTitle"\)\.value\.trim\(\)/, "checklist reads actual fields");
});

test("phase5: dashboard recent exports dari file nyata + tombol VIEW EXPORTS pasca-batch", () => {
  const html = fs.readFileSync("index.html", "utf8");
  for (const id of ["dashRecentExports", "dashExportsCount", "procExportsBtn"]) {
    assert.ok(html.includes(`id="${id}"`), `${id} must exist`);
  }
  const fn = script.slice(script.indexOf("function renderRecentExportsDashboard"), script.indexOf("const SETTINGS_KEY"));
  assert.match(fn, /state\.exports\.slice\(0, 3\)/, "top-3 real exports");
  assert.match(fn, /status-pill-done[\s\S]{0,40}READY|"READY"/, "READY because files exist server-side");
});

// ── Create Clips v2 (user point #3): instant inspect + URL validation ───────
test("create-v2: inspeksi instan dari metadata video lokal — fps/audio jujur dash", () => {
  const fn = script.slice(script.indexOf("function inspectLocalVideo"), script.indexOf("async function attachFile"));
  assert.match(fn, /URL\.createObjectURL\(file\)/, "local object URL");
  assert.match(fn, /onloadedmetadata/, "waits real metadata event");
  assert.match(fn, /probe\.duration|localVideo\.duration/);
  assert.match(fn, /videoWidth && localVideo\.videoHeight|videoWidth && probe\.videoHeight/);
  // fps & audio tidak dikarang di sisi klien
  assert.match(fn, /siFps"\)\.textContent = "—"/);
  assert.match(fn, /siAudio"\)\.textContent = "—"/);
  assert.match(fn, /revokeObjectURL/, "object URL released");
  const af = script.slice(script.indexOf("async function attachFile"), script.indexOf("function playSelectedClip"));
  assert.match(af, /inspectLocalVideo\(file\)/, "wired into drop flow before upload");
});

test("create-v2: URL YouTube divalidasi sebelum fetch — baris invalid ditolak", () => {
  const fn = script.slice(script.indexOf("async function processYouTubeUrl"), script.indexOf('fetch("/api/youtube"'));
  assert.match(fn, /\(youtube\\\.com\|youtu\\\.be\)/, "host allowlist check");
  assert.match(fn, /Baris tidak valid/, "explicit line feedback");
  assert.match(script, /classList\.add\("dragging"\)/, "drag-over class wired in JS");
  const css = fs.readFileSync("styles.css", "utf8");
  assert.match(css, /\.dropzone\.dragging/, "drag-over state styled");
});
test("dash-v2: TOP CLIPS dari skor backend via detail yang sama, OPEN ke Results", () => {
  const html = fs.readFileSync("index.html", "utf8");
  for (const id of ["dashTopClips", "dashTopClipsCount"]) {
    assert.ok(html.includes(`id="${id}"`), `top clips part ${id} must exist`);
  }
  assert.match(html, /By backend score/, "ranking source labeled honestly");
  const fn = script.slice(script.indexOf("function renderDashTopClips"), script.indexOf("// Dashboard — RECENT ACTIVITY feed"));
  assert.match(fn, /typeof c\.score === "number"/, "only real scores");
  assert.match(fn, /openResultsForProject\(entry\.projectId, entry\.clip\.id\)/, "OPEN preselects the exact clip");
  assert.doesNotMatch(fn, /Math\.random|predict/i, "no fabricated ranking");
});

test("dash-v2: RECENT ACTIVITY feed gabungan event lokal nyata (project+export)", () => {
  const html = fs.readFileSync("index.html", "utf8");
  for (const id of ["dashActivityFeed", "dashFeedCount"]) {
    assert.ok(html.includes(`id="${id}"`), `feed part ${id} must exist`);
  }
  const fn = script.slice(script.indexOf("function renderDashActivityFeed"), script.indexOf("async function updateDashboardAvgScore"));
  assert.match(fn, /state\.projects/, "projects feed source");
  assert.match(fn, /state\.exports/, "exports feed source");
  assert.match(fn, /\.sort\(\(a, b\) => b\.ts - a\.ts\)/, "chronological desc by real timestamps");
  assert.match(fn, /slice\(0, 8\)/, "bounded render");
});

test("dash-v2: openResultsForProject mendukung preselect clip", () => {
  const fn = script.slice(script.indexOf("async function openResultsForProject"), script.indexOf("function setResPill"));
  assert.match(fn, /selectClipId = null/, "optional preselect param");
  assert.match(fn, /resultsState\.selectedClipId = wanted \? wanted\.id : null/, "preselect applied after load");
});
test("phase7: endpoint intelligence — ekstraktif dari transkrip + cache invalidasi", () => {
  const fn = server.slice(server.indexOf("async function handleProjectIntelligence"), server.indexOf("function handleIntegrations"));
  assert.match(server, /\.add\("GET", "\/api\/intelligence\/:projectId"/, "route registered");
  assert.match(fn, /manifest\.transcriptPath/, "reads real transcript via manifest");
  assert.match(fn, /mtimeMs/, "cache sig includes transcript mtime (invalidation)");
  assert.match(fn, /c\.score != null/, "analyzed count from real scores");
  // Summary TIDAK memanggil LLM — callClipmeLLM terikat schema analisis clip
  assert.doesNotMatch(fn, /callClipmeLLM/, "no misuse of clip-analysis LLM for summary");
  const kw = server.slice(server.indexOf("function intelExtractKeywords"), server.indexOf("function intelExtractiveSummary"));
  assert.match(kw, /INTEL_STOPWORDS\.has/, "stopword-filtered keyword extraction");
  const sum = server.slice(server.indexOf("function intelExtractiveSummary"), server.indexOf("async function handleProjectIntelligence"));
  assert.match(sum, /sentences/, "extractive sentence selection");
});

test("phase7: UI intel jujur — field kosong tetap 'not available', why hanya dari engine", () => {
  const html = fs.readFileSync("index.html", "utf8");
  for (const id of ["intelProjectSelect", "intelLoadBtn", "intelSummary", "intelKeywords", "intelTopClips", "intelRecommendations", "intelSearchInput"]) {
    assert.ok(html.includes(`id="${id}"`), `intel part ${id} must exist`);
  }
  const fn = script.slice(script.indexOf("// ================= CONTENT INTELLIGENCE"), script.indexOf("const SETTINGS_KEY"));
  assert.match(fn, /Summary not available\./, "honest missing summary");
  assert.match(fn, /No transcript yet/, "honest missing transcript");
  assert.match(fn, /extractive · transcript/, "summary source labeled truthfully");
  assert.doesNotMatch(fn, /Math\.random/, "no fabricated intelligence");
});

test("phase7: rekomendasi deterministik dari hitungan nyata + handoff reuse existing", () => {
  const recs = script.slice(script.indexOf("function renderIntelRecommendations"), script.indexOf("async function openIntelClip"));
  assert.match(recs, /belum dianalisis/, "unanalyzed count drives recommendation");
  assert.match(recs, /openResultsForProject|showView\("calendar"\)/, "actions reuse existing navigation");
  assert.doesNotMatch(recs, /AI recommends|predicted/i, "no fake AI authority");
  const openClip = script.slice(script.indexOf("async function openIntelClip"), script.indexOf('$("#intelLoadBtn")'));
  assert.match(openClip, /openResultsForProject/, "routes through Results workspace");
  assert.match(openClip, /handoffToStudio\(/, "reuses existing Studio/preview handoff");
});

test("phase7: transcript search pakai /api/stt/search existing — bukan implementasi kedua", () => {
  const block = script.slice(script.indexOf("// ================= CONTENT INTELLIGENCE"), script.indexOf("const SETTINGS_KEY"));
  assert.match(block, /\/api\/stt\/search/, "existing search endpoint reused");
  assert.match(block, /transcriptPath: intelState\.data\.transcriptAbs/, "absolute transcript path from intelligence payload");
  assert.doesNotMatch(block, /child_process|spawn\(/, "no direct python invocation from frontend path");
});
test("phase6: /api/integrations deteksi nyata — connected hanya bila kredensial ada", () => {
  const fn = server.slice(server.indexOf("function handleIntegrations"), server.indexOf("async function handleSttModels"));
  assert.match(fn, /process\.env\[k\]/, "reads real env credentials");
  assert.match(fn, /integrations\.json/, "or explicit config file");
  assert.match(server, /\.add\("GET", "\/api\/integrations"/, "route registered");
  for (const pair of [["YT_OAUTH_CLIENT_ID", "YT_OAUTH_CLIENT_SECRET"], ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"], ["FB_APP_ID", "FB_APP_SECRET"]]) {
    for (const k of pair) assert.ok(fn.includes(`"${k}"`), `platform credential key ${k} declared`);
  }
});

test("phase0: engine boot verifies local services before revealing the workspace", () => {
  const html = fs.readFileSync("index.html", "utf8");
  for (const id of ["engineBoot", "bootMessage", "bootSummary"]) {
    assert.ok(html.includes(`id="${id}"`), `boot UI includes ${id}`);
  }
  const boot = script.slice(script.indexOf("async function bootstrapApplication"), script.indexOf("const analyzeSpeakerBtn"));
  for (const endpoint of ["/api/system", "/api/stt/models", "/api/queue"]) {
    assert.ok(boot.includes(endpoint), `boot checks ${endpoint}`);
  }
  assert.match(boot, /Promise\.all\(\[loadProjects\(\), loadExports\(\), refreshStorage\(\)\]\)/, "workspace loads real local data");
  assert.match(boot, /boot\.hidden = true/, "workspace is revealed only when checks finish");
  assert.doesNotMatch(boot, /Math\.random|setTimeout\(/, "boot has no fabricated progress or timed reveal");
  const css = fs.readFileSync("styles.css", "utf8");
  assert.match(css, /\.engine-boot\[hidden\]\s*{\s*display:\s*none/, "hidden attribute must actually hide the overlay (class display would otherwise override it)");
});

test("dashboard: operational activity and insights use only persisted local evidence", () => {
  const html = fs.readFileSync("index.html", "utf8");
  for (const id of ["dashActivityChart", "dashActivityNote", "dashInsightList"]) {
    assert.ok(html.includes(`id="${id}"`), `dashboard includes ${id}`);
  }
  const activity = script.slice(script.indexOf("function renderDashboardActivity"), script.indexOf("function renderDashboardInsights"));
  assert.match(activity, /state\.projects/, "activity uses local projects");
  assert.match(activity, /state\.exports/, "activity uses local exports");
  assert.doesNotMatch(activity, /views|likes|engagement|Math\.random/i, "activity does not invent social metrics");
  const insights = script.slice(script.indexOf("function renderDashboardInsights"), script.indexOf("function updateBootSummary"));
  assert.match(insights, /typeof clip\.score === "number"/, "only numeric engine scores are analyzed");
  assert.doesNotMatch(insights, /prediction|predict|Math\.random/i, "insights do not claim unverified performance predictions");
});

test("phase6: UI integrasi jujur — NOT CONNECTED, tanpa OAuth simulasi", () => {
  const html = fs.readFileSync("index.html", "utf8");
  for (const id of ["integList", "integRefreshBtn"]) {
    assert.ok(html.includes(`id="${id}"`), `${id} must exist`);
  }
  assert.match(html, /tidak ada simulasi koneksi/i, "explicit no-simulation notice");
  const fn = script.slice(script.indexOf("async function loadIntegrations"), script.indexOf("function updatePublishAvailability"));
  assert.match(fn, /NOT CONNECTED/, "real state rendered from endpoint");
  assert.doesNotMatch(fn, /status\s*=\s*["']CONNECTED["']/, "never fakes a connection");
});

test("phase6: kalender = local plan berlabel; tolak waktu lampau; tanpa auto-post", () => {
  const html = fs.readFileSync("index.html", "utf8");
  assert.ok(html.includes('data-view-panel="calendar"'), "calendar view exists");
  assert.match(html, /PLAN LOKAL/i, "clear local-plan label");
  const block = script.slice(script.indexOf("// ================= CALENDAR + INTEGRATIONS"), script.indexOf("const SETTINGS_KEY"));
  assert.match(block, /localStorage\.setItem\(CAL_KEY/, "local persistence (planning layer)");
  assert.match(block, /waktu yang sudah lewat/, "past-time rejected");
  assert.match(block, /clipperStudio\.calendar/, "namespaced key");
  assert.doesNotMatch(block, /publish.*platform|auto.?post/i.test("") ? /$^/ : /fetch\(.*(youtube|tiktok|instagram)/i, "no platform API calls");
});

test("phase6: calendar entries treat persisted labels as text, not HTML", () => {
  const block = script.slice(script.indexOf("function renderCalendar"), script.indexOf("function renderUpcoming"));
  assert.doesNotMatch(block, /chip\.innerHTML\s*=/, "calendar labels must not be injected as HTML");
  assert.match(block, /chip\.append\(` \$\{String\(e\.platform \|\| ""\)\}`\)/, "platform is appended as text");
});

test("phase6: dead PUBLISH NOW button removed — publish flow uses direct export", () => {
  const html = fs.readFileSync("index.html", "utf8");
  assert.ok(!html.includes('id="pubPublishNowBtn"'), "dead PUBLISH NOW button removed from DOM");
  assert.ok(html.includes('id="pubExportBtn"'), "replaced by Export + Prepare for Publish");
});

test("phase6: production insights dari data export asli — tanpa klaim AI/prediksi", () => {
  const html = fs.readFileSync("index.html", "utf8");
  assert.ok(html.includes('id="prodInsights"'), "insights container exists");
  const fn = script.slice(script.indexOf("function computeProductionInsights"), script.indexOf("$$('[data-qview]')".replace(/'/g, '"')));
  assert.match(fn, /state\.exports/, "computed from real exports");
  assert.match(fn, /ratioCount|topRatio/, "format distribution observed");
  assert.match(fn, /tanpa prediksi performa/, "no performance prediction claims");
  assert.match(fn, /Belum cukup data/, "insufficient-data honesty");
  assert.doesNotMatch(fn, /Math\.random|AI predicts|viral score predict/i, "no fabricated AI signals");
});

test("phase6: quick actions dashboard + nav lengkap (10 view)", () => {
  const html = fs.readFileSync("index.html", "utf8");
  for (const v of ["dashboard", "library", "exports", "publish", "calendar", "results", "intel", "analytics", "dna", "integrations", "captions", "settings"]) {
    assert.ok(html.includes(`data-view="${v}"`), `nav ${v}`);
    if (v !== "dashboard") assert.ok(html.includes(`data-view-panel="${v}"`), `panel ${v}`);
  }
  assert.ok(html.includes("data-qview=\"exports\"".replace(/\\"/g, '"')), "quick action exports");
  assert.ok(html.includes("data-qview=\"calendar\"".replace(/\\"/g, '"')), "quick action calendar");
});

// ── Poin #4/#5: per-engine status + analysis complete tiering ────────────────
test("p4-gap: chip engine processing diturunkan dari job.stage nyata", () => {
  const html = fs.readFileSync("index.html", "utf8");
  for (const id of ["procEngineWrap", "engSource", "engFfmpeg", "engWhisper", "engHook", "engDeep"]) {
    assert.ok(html.includes(`id="${id}"`), `engine chip ${id} must exist`);
  }
  const fn = script.slice(script.indexOf("const PROC_ENGINES"), script.indexOf("const processingState"));
  assert.match(fn, /PIPELINE_STAGES\[jobType\]/, "engine states only for mapped job types");
  assert.match(fn, /wrapEl\.style\.display = "none"/, "unmapped jobs hide engine row (no invention)");
  assert.match(fn, /idx === curIdx[\s\S]{0,40}"ACTIVE"/, "current stage marks its engine ACTIVE");
});

test("p4-gap: complete menandai semua engine DONE via sinyal job selesai", () => {
  const done = script.slice(script.indexOf("function completeProcessingView"), script.indexOf("async function failProcessingView"));
  assert.match(done, /renderProcEngines\(processingState\.lastType, "", true\)/, "done flag drives all-DONE state");
});

test("p5-tier: bucket skor asli — threshold eksplisit, tanpa skor diubah", () => {
  const html = fs.readFileSync("index.html", "utf8");
  for (const id of ["procTierStrip", "resTierStrip"]) {
    assert.ok(html.includes(`id="${id}"`), `tier strip ${id} must exist`);
  }
  const fn = script.slice(script.indexOf("const SCORE_TIERS"), script.indexOf("function setProcPill"));
  assert.match(fn, /min: 85/, "High Potential threshold");
  assert.match(fn, /min: 70/, "Strong threshold");
  assert.match(fn, /min: 50/, "Moderate threshold");
  assert.match(fn, /return null/, "unscored → no tier");
  assert.match(fn, /wrap\.hidden = true/, "no scores → strip hidden (no fake)");
  const done = script.slice(script.indexOf("function completeProcessingView"), script.indexOf("async function failProcessingView"));
  assert.match(done, /renderScoreTiers\(result && result\.clips/, "completion tiers from real result clips");
  const res = script.slice(script.indexOf("function renderResHeader"), script.indexOf("function applyResView"));
  assert.match(res, /renderScoreTiers\(resultsState\.clips/, "Results header shows tiers");
});

// ── Poin #6: clip list thumbnails (real ffmpeg) + tier badge ─────────────────
test("p6-thumb: endpoint thumbnail — ffmpeg real, cache disk, validasi ketat", () => {
  const fn = server.slice(server.indexOf("async function handleClipThumb"), server.indexOf("function handleIntegrations"));
  assert.match(server, /\.add\("GET", "\/api\/thumb\/:projectId\/:clipId"/, "route registered");
  assert.match(fn, /isValidUUID\(projectId\)/, "project id validated");
  assert.match(fn, /Number\.isInteger\(clipId\)/, "clip id validated");
  assert.match(fn, /"-frames:v", "1"/, "single frame extraction");
  assert.match(fn, /scale=320:-2/, "bounded thumbnail size");
  assert.match(fn, /thumbs/, "cached under project thumbs dir");
  assert.match(fn, /existsSync\(thumbPath\)/, "disk cache reused when present");
  assert.match(fn, /image\/jpeg/, "served as jpeg");
});

test("p6-thumb: Studio & Results pakai thumbnail lazy + tier badge dari skor asli", () => {
  const studio = script.slice(script.indexOf("function renderClips(list = clips)"), script.indexOf("const body = document.createElement"));
  assert.match(studio, /thumbUrlFor\(state\.projectId, clip\.id\)/, "studio thumb wired");
  assert.match(studio, /loading = "lazy"/, "lazy loading (performance rule)");
  const results = script.slice(script.indexOf("// ================= RESULTS WORKSPACE"), script.indexOf("// ================= BATCH PRODUCTION"));
  assert.match(results, /thumbUrlFor\(resultsState\.projectId, clip\.id\)/, "results thumb wired");
  assert.match(results, /scoreTierOf\(clip\.score\)/, "tier class from real score");
  assert.ok(!/retention prediction|engagement prediction/i.test(script), "no fabricated predictions in production flow");
});

// ── Poin #7: AI suggestions di Clip editor (satu jalur apply) ────────────────
test("p7-suggest: strip saran di tab Clip — hanya dari analysis nyata", () => {
  const html = fs.readFileSync("index.html", "utf8");
  assert.ok(html.includes('id="suggestStrip"'), "suggest strip exists in clipTab");
  const fn = script.slice(script.indexOf("function renderClipSuggestions"), script.indexOf('$("#intelApplyHook").addEventListener'));
  assert.match(fn, /= clip && clip\.analysis/, "reads real per-clip analysis");
  assert.match(fn, /belum dianalisis/, "honest empty state");
  assert.match(fn, /analyzeSelectedClip\(\)/, "quick analyze jumps into existing intel flow");
  for (const applier of ["applyHookSuggestion(a.recommendedHook", "applyCaptionVariant()", "applyTitleSuggestion(a.deepTitle)"]) {
    assert.ok(fn.includes(applier), "chip reuses shared applier: " + applier);
  }
  const appliers = script.slice(script.indexOf("function applyHookSuggestion"), script.indexOf('$("#intelUseTitle").addEventListener'));
  assert.match(appliers, /markStudioDirty\(\)/, "applied suggestions mark studio dirty");
});

test("p7-suggest: strip refresh saat pilih clip & setelah analisis selesai", () => {
  const sel = script.slice(script.indexOf("function selectClip(clip)"), script.indexOf("function showToast"));
  assert.match(sel, /renderClipSuggestions\(\)/, "selectClip refreshes suggestions");
  const ana = script.slice(script.indexOf("async function analyzeSelectedClip"), script.indexOf("function renderIntel"));
  assert.match(ana, /renderIntel\(a\);[\s\S]{0,60}renderClipSuggestions\(\)/, "analysis success refreshes suggestions");
});

// ── Poin #9: Performance Ledger (angka aktual manual, sidecar server) ────────
test("p9-perf: endpoint ledger — sanitasi int, path-safe, sidecar di OUTPUT_DIR", () => {
  const fn = server.slice(server.indexOf("// ===== Performance Ledger (#9)"), server.indexOf("function handleOpenOutput"));
  assert.match(fn, /perfPathFor/, "sidecar path helper");
  assert.match(fn, /isSafePath\(fpath, OUTPUT_DIR\)/, "path traversal blocked");
  assert.match(fn, /Math\.floor\(Number\(value\)\)/, "values coerced to non-negative ints");
  assert.match(fn, /\.perf\.json/, "sidecar extension next to export file");
  const routes = server.slice(server.indexOf('.add("POST", "/api/projects/:projectId/generate"'));
  assert.match(routes, /handleGetPerf/, "perf GET route wired");
  assert.match(routes, /handleSavePerf/, "perf POST route wired");
  const save = fn.slice(fn.indexOf("function handleSavePerf"));
  assert.match(save, /records\.push/, "appends history snapshot");
  assert.match(save, /slice\(-50\)/, "history bounded");
});

test("p9-perf: UI editor manual + engagement terhitung dari input nyata", () => {
  const fn = script.slice(script.indexOf("// Performance Ledger UI:"), script.indexOf("// ================= ANALYTICS + CONTENT DNA"));
  for (const field of ["Post ID", "Views", "Likes", "Comments", "Shares"]) {
    assert.ok(fn.includes(`"${field}"`), `ledger field ${field}`);
  }
  assert.match(fn, /likes \+ comments \+ shares\) \/ views/, "engagement computed from entered numbers");
  assert.match(fn, /POST/);
  assert.match(fn, /encodeURIComponent\(filename\)/, "nested filename encoded");
  assert.match(fn, /HISTORY/, "snapshot history rendered");
  assert.doesNotMatch(fn, /Math\.random|predict/i, "no invented metrics");
});

// ── Poin #10-12: Analytics + AI insights + Learning/DNA (dari ledger asli) ───
test("p10-12: server membawa clipId dari info.txt — kunci join prediksi-vs-aktual", () => {
  const fn = server.slice(server.indexOf("function readExportInfo"), server.indexOf("function handleDeleteExport"));
  assert.match(fn, /"Clip ID:": "clipId"/, "clipId exposed in export listing");
  const perf = server.slice(server.indexOf("// ===== Performance Ledger (#9)"), server.indexOf("function handleOpenOutput"));
  assert.match(perf, /body\.platform/, "platform stored per export sidecar");
});

test("p10-12: analytics view — totals/top/platform/growth/velocity dari ledger", () => {
  const html = fs.readFileSync("index.html", "utf8");
  for (const id of ["analyticsEmpty", "analyticsPanels", "anViews", "anLikes", "anComments", "anShares", "anTop", "anPlatforms", "anGrowth"]) {
    assert.ok(html.includes(`id="${id}"`), `analytics part ${id} must exist`);
  }
  const fn = script.slice(script.indexOf("// ================= ANALYTICS + CONTENT DNA"), script.indexOf('$("#anRefreshBtn")'));
  assert.match(fn, /\/api\/perf\//, "reads real ledger snapshots");
  assert.match(fn, /api\/projects\/\$\{pid\}/, "joins engine intel via project detail");
  assert.match(fn, /totalViews/, "empty until views exist (no fake)");
  assert.match(fn, /snapshot pertama/, "growth anchored to first snapshot");
  assert.match(fn, /views\/hari/, "velocity formula labeled");
  assert.doesNotMatch(fn, /Math\.random|estimated views/i);
});

test("p10-12: Content DNA observed + prediction-vs-actual tanpa klaim kausal", () => {
  const html = fs.readFileSync("index.html", "utf8");
  assert.ok(html.includes("CONTENT DNA"), "DNA panel exists");
  assert.match(html, /observational/, "labeled observational");
  const fn = script.slice(script.indexOf("// ================= ANALYTICS + CONTENT DNA"), script.indexOf('$("#anRefreshBtn")'));
  assert.match(fn, /hookType/, "best hook type aggregation");
  assert.match(fn, /bucket \$\{byDur\[0\]\.k\}/ || fn.includes("bucket "), "duration bucket aggregation");
  assert.match(fn, /skor engine tertinggi/, "prediction vs actual comparison present");
  assert.match(fn, /tidak disimpulkan sebagai sebab-akibat/, "no causal claim");
});

// ── Core Intelligence STEP 7-9: integrasi pipeline nyata ─────────────────────
test("intel-int: buildTranscriptClips delegasi ke Director dengan fallback aman", () => {
  const fn = server.slice(server.indexOf("// ===== CORE INTELLIGENCE: Clip Director path"), server.indexOf("async function transcribeAudioWithOpenAI"));
  assert.ok(fn.length > 500, "slice captured");
  assert.match(fn, /ensureDirectorInit\(\)/, "lazy init (CLIPME_WORDS tersedia)");
  assert.match(fn, /clipmeDirector\.buildVideoUnderstanding/, "Step1 dipakai");
  assert.match(fn, /clipmeDirector\.detectHooks/, "Step2 Hook Engine asli");
  assert.match(fn, /directStories/, "Step3 Story Director");
  assert.match(fn, /generateCandidates/, "Step4 kandidat");
  assert.match(fn, /rankCandidates/, "Step6 ranking");
  assert.match(fn, /fallback ke pipeline lama|console\.error\("\[director\]/, "fallback on failure");
  const delegate = server.slice(server.indexOf("function buildTranscriptClips"), server.indexOf("async function transcribeAudioWithOpenAI"));
  assert.ok(delegate.length > 100, "delegate slice captured");
  assert.match(delegate, /analyzeTranscriptToClips\(transcript, duration, targetLength, language, options\)/, "legacy path preserved");
});

test("intel-int: adapter mempertahankan schema legacy + field baru additive", () => {
  const fn = server.slice(server.indexOf("// ===== CORE INTELLIGENCE: Clip Director path"), server.indexOf("async function transcribeAudioWithOpenAI"));
  assert.ok(fn.length > 500, "slice captured");
  for (const legacy of ["hookType:", "recommendedHook:", "caption:", "score: analysis.score", "deepTitle:", "optimalDuration:"]) {
    assert.ok(fn.includes(legacy), `legacy field ${legacy} tetap diisi`);
  }
  for (const added of ["selectionScore:", "explain:", "storyCompleteness:", "scoring:"]) {
    assert.ok(fn.includes(added), `new field ${added} additive`);
  }
  assert.match(fn, /openingStrategy: "DIRECTOR"/, "director clips marked");
});

test("intel-int: focus & hookStrategy mengalir dari UI ke ketiga jalur analisis", () => {
  const html = fs.readFileSync("index.html", "utf8");
  for (const id of ["focusInput", "hookStrategySelect"]) {
    assert.ok(html.includes(`id="${id}"`), `UI ${id} must exist`);
  }
  const payload = script.slice(script.indexOf("function durationSettingsPayload"), script.indexOf("function formatBytes"));
  assert.match(payload, /#hookStrategySelect/);
  assert.match(payload, /#focusInput/);
  const upload = server.slice(server.indexOf("async function analyzeLocalUpload"), server.indexOf("async function handleUpload"));
  assert.match(upload, /intelOptions\.focus/, "upload path passes focus");
  const yt = server.slice(server.indexOf("const clips = buildTranscriptClips(transcript, probe.duration, payload.duration"), server.indexOf('writeProjectManifest(projectDir, {\n    id,\n    videoId'));
  assert.match(yt, /payload\.hookStrategy/, "youtube path passes strategy");
  const gen = server.slice(server.indexOf("const clips = buildTranscriptClips(transcript, manifest.probe?.duration"), server.indexOf("manifest.clips = clips.map"));
  assert.match(gen, /data\.hookStrategy/, "generate path passes strategy");
});

if (!process.exitCode) console.log('Preview boundary done: ' + results.filter(r=>r.ok).length + '/' + results.length + ' PASS');

// -- Social PHASE 6: Hub connect flow (OAuth resmi, tanpa token ke UI) --------
test("social-hub: Connect->authorize URL, polling status, Disconnect POST", () => {
  const fn = script.slice(script.indexOf("// PHASE 6 — Social Hub:"), script.indexOf("function updatePublishAvailability"));
  assert.match(fn, /\/api\/social\/connect\//, "connect fetches authorize URL");
  assert.match(fn, /window\.open\(d\.url, "_blank"\)/, "system browser flow");
  assert.match(fn, /pollSocialConnected/, "waits for real authorization");
  assert.match(fn, /\/api\/social\/account\//, "account identity fetched");
  assert.match(fn, /\/api\/social\/disconnect\//, "disconnect wired");
  assert.doesNotMatch(fn, /access_token|refresh_token/, "tokens never reach renderer");
});

if (!process.exitCode) console.log("Preview boundary done: " + results.filter(r=>r.ok).length + "/" + results.length + " PASS");
