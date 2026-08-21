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
  assert.match(w, /setProgress\(20 \+ Math\.min\(65, Math\.round\(pct \* 0\.65\)\)\)/, "STT progress must feed the job");
  assert.match(w, /buildTranscriptClips\(transcript, probe\.duration, targetLen, language/, "must use full intelligence pipeline");
  assert.match(w, /mode: durMode,\s*fixedDuration:/, "duration mode must reach the engine");
  assert.match(w, /transcriptPath: "transcript\.json"/, "manifest must persist transcript for preview/generate");
  assert.match(w, /clips = buildClips\(probe\.duration, targetLen\)/, "STT failure falls back to plain clips");
});

test("klien: tombol memanggil endpoint & mem-poll jobId (progres % di UI)", () => {
  const btn = script.slice(script.indexOf('$("#analyzeHookBtn").addEventListener'), script.indexOf('$("#analyzeHookBtn").addEventListener') + 2200);
  assert.match(btn, /\/api\/projects\/\$\{state\.projectId\}\/analyze-hook/, "must call the analyze-hook endpoint");
  assert.match(btn, /waitForJob\(data\.jobId\)/, "client must poll the analysis job (progress % in UI)");
  assert.match(btn, /clips = analyzed;/, "analyzed clips replace placeholders after job done");
});

if (!process.exitCode) console.log(`Preview boundary done: ${results.length}/${results.length} PASS`);
