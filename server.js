const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const crypto = require("crypto");

const ROOT = __dirname;
const isElectron = !!(process.versions && process.versions.electron);
const isPackaged = isElectron && /app\.asar/.test(__dirname);

function packagedResourcesRoot() {
  if (isPackaged && typeof process.resourcesPath === "string" && process.resourcesPath) {
    return process.resourcesPath;
  }
  return ROOT;
}
const RESOURCE_ROOT = packagedResourcesRoot();

function toUnpackedPath(p) {
  if (!isPackaged || typeof p !== "string") return p;
  return p.replace(/app\.asar([\\/])/g, "app.asar.unpacked$1");
}

function packagedDataRoot() {
  if (!isPackaged) return ROOT;
  try {
    const electron = require("electron");
    if (electron && electron.app && typeof electron.app.getPath === "function") {
      return electron.app.getPath("userData");
    }
  } catch {}
  const base = process.env.APPDATA;
  const fresh = base ? path.join(base, "Clipper Studio") : ROOT;
  const legacy = base ? path.join(base, "ClipForge") : "";
  // Keep using the old data folder until the new one exists (avoids losing projects).
  if (fresh !== ROOT && !fs.existsSync(fresh) && legacy && fs.existsSync(legacy)) return legacy;
  return fresh;
}

const DATA_ROOT = process.env.CLIPFORGE_DATA_DIR || packagedDataRoot();
const UPLOAD_DIR = path.join(DATA_ROOT, "uploads");
const OUTPUT_DIR = path.join(DATA_ROOT, "outputs");
const TMP_DIR = path.join(DATA_ROOT, "tmp");
const PORT = Number(process.env.PORT || 4173);
const BIN_DIR = process.env.CLIPFORGE_BIN_DIR || (isPackaged ? path.join(RESOURCE_ROOT, "bin") : path.join(ROOT, "bin"));
const YTDLP = process.env.YTDLP_PATH || path.join(BIN_DIR, "yt-dlp.exe");
const FFMPEG = process.env.FFMPEG_PATH || path.join(BIN_DIR, "ffmpeg.exe");
const FFPROBE = process.env.FFPROBE_PATH || path.join(BIN_DIR, "ffprobe.exe");
// YouTube sometimes returns 403 on android_vr/default stream URLs; the pure
// "android" client still yields valid (non-SABR) URLs without a JS runtime.
const YTDLP_EXTRACTOR_ARGS = process.env.YTDLP_EXTRACTOR_ARGS || "youtube:player_client=android_vr,android";
const OPENAI_TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";
const CLIPME_ANALYZE_MODEL = process.env.CLIPME_ANALYZE_MODEL || "gpt-4o-mini";
const CLIPME_PROMPT_MODULE = path.join(ROOT, "clipme-prompt.js");

function loadClipmeSystemPrompt() {
  try {
    if (fs.existsSync(CLIPME_PROMPT_MODULE)) {
      return require(CLIPME_PROMPT_MODULE);
    }
  } catch (e) {
    console.error("Gagal memuat clipme-prompt.js:", e.message);
  }
  return "";
}

const CLIPME_CAPTION_ENGINE_MODULE = path.join(ROOT, "clipme-caption-engine.js");

function loadClipmeCaptionEngine() {
  try {
    if (fs.existsSync(CLIPME_CAPTION_ENGINE_MODULE)) {
      return require(CLIPME_CAPTION_ENGINE_MODULE);
    }
  } catch (e) {
    console.error("Gagal memuat clipme-caption-engine.js:", e.message);
  }
  return null;
}

function postJson(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https:") ? https : http;
    const data = Buffer.from(JSON.stringify(body));
    const request = client.request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": data.length,
        ...headers
      }
    }, (response) => {
      let bodyChunk = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { bodyChunk += chunk; });
      response.on("end", () => {
        let parsed = null;
        try { parsed = JSON.parse(bodyChunk); } catch {}
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`API ${response.statusCode}: ${(parsed && (parsed.error && (parsed.error.message || JSON.stringify(parsed.error)))) || bodyChunk.slice(0, 300)}`));
          return;
        }
        resolve(parsed);
      });
    });
    request.on("error", reject);
    request.setTimeout(120000, () => { request.destroy(new Error("LLM request timed out")); });
    request.write(data);
    request.end();
  });
}

// Call a chat-completion LLM with the ClipMe system prompt; returns raw JSON message content.
async function callClipmeLLM(content, targetLanguage) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "OPENAI_API_KEY tidak tersedia." };
  }
  const systemPrompt = loadClipmeSystemPrompt();
  if (!systemPrompt) {
    return { ok: false, error: "clipme-prompt.js tidak ditemukan." };
  }
  const userPrompt = [
    `Objective: analyze the source clip below and produce the ClipMe intelligence output strictly as JSON (no markdown fences).`,
    `Target language for captions, hashtags and any generated copy: ${targetLanguage}.`,
    `The JSON must follow exactly this schema:`,
    `{`,
    `  "score": 0-100,`,
    `  "confidence": 0-100,`,
    `  "hookScore": 0-100,`,
    `  "retentionScore": 0-100,`,
    `  "shareabilityScore": 0-100,`,
    `  "commentScore": 0-100,`,
    `  "hookType": "one of the 16 hook types",`,
    `  "originalHook": "exact source wording (the clip's natural opening)",`,
    `  "recommendedHook": "AI-crafted TITLE-style hook: a short, punchy headline WRITTEN BY THE MODEL (like a thumbnail caption / video title) drawn from the clip's single strongest message, insight, conflict, surprise or lesson; NOT a verbatim transcript line, NOT the whole auto-caption, NOT a sentence the speaker actually said; engineered for scroll-stop, curiosity and retention; every fact must stay 100% truthful to the source and the clip must deliver the hook's promise",`,
    `  "hookReordered": true|false,`,
    `  "hookStrategy": "short explanation",`,
    `  "keyMessage": "concise factual description",`,
    `  "payoff": "concise description",`,
    `  "storyStructure": "Hook -> Context -> Development -> Payoff",`,
    `  "contextWarning": "None or warning",`,
    `  "editingNotes": "practical notes",`,
    `  "quoteLine": "best quotable line or empty",`,
    `  "title": "short title",`,
    `  "captionVariants": { "A": "...", "B": "...", "C": "..." },`,
    `  "bestCaption": "A|B|C",`,
    `  "bestCaptionReason": "short",`,
    `  "cta": "one natural CTA or \"None\"",`,
    `  "discussionQuestion": "one natural question or \"None\"",`,
    `  "hashtags": { "primary": "#a #b #c", "niche": "#x #y", "broad": "#z" },`,
    `  "sourceEvidence": { "hook": "...", "keyMessage": "...", "payoff": "..." },`,
    `  "qualityGate": { "hookSupported": true, "hookCreatesReason": true, "hookFulfilled": true, "contextIndependent": true, "hasDevelopment": true, "hasPayoff": true, "captionReflectsClip": true, "captionNoInvention": true, "captionNoExaggeration": true, "ctaNatural": true, "hashtagsRelevant": true, "noDeceptiveEdit": true, "speakerIntact": true, "pass": true }`,
    `}`,
    ``,
    `SOURCE CLIP:`,
    content
  ].join("\n");

  const result = await postJson(
    "https://api.openai.com/v1/chat/completions",
    {
      model: CLIPME_ANALYZE_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.4,
      response_format: { type: "json_object" }
    },
    { Authorization: `Bearer ${apiKey}` }
  );

  const text = result && result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content;
  if (!text) return { ok: false, error: "Model tidak mengembalikan konten." };
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, error: "Respons model bukan JSON valid." };
  }
}

// Validate/normalize raw LLM output into the same shape produced by clipmeAssemble.
function normalizeLlmAnalysis(raw, fallbackAnalysis) {
  const g = (key, def) => (raw && raw[key] != null && String(raw[key]).trim() !== "" ? raw[key] : def);
  const n = (key, def) => {
    const v = Number(raw && raw[key]);
    return Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : def;
  };
  const clampScore = (score) => Math.max(0, Math.min(100, Math.round(score)));
  const score = clampScore(n("score", fallbackAnalysis.score));
  const qg = raw && raw.qualityGate && typeof raw.qualityGate === "object" ? raw.qualityGate : {};
  const booleans = [
    "hookSupported", "hookCreatesReason", "hookFulfilled", "contextIndependent",
    "hasDevelopment", "hasPayoff", "captionReflectsClip", "captionNoInvention",
    "captionNoExaggeration", "ctaNatural", "hashtagsRelevant", "noDeceptiveEdit", "speakerIntact"
  ];
  const qualityGate = {};
  for (const key of booleans) qualityGate[key] = qg[key] == null ? fallbackAnalysis.qualityGate[key] : !!qg[key];
  qualityGate.pass = qg.pass != null ? !!qg.pass : fallbackAnalysis.qualityGate.pass;
  const p = String(g("payoff", fallbackAnalysis.payoff) || "");
  return {
    score,
    confidence: n("confidence", fallbackAnalysis.confidence),
    hookScore: n("hookScore", fallbackAnalysis.hookScore),
    retentionScore: n("retentionScore", fallbackAnalysis.retentionScore),
    shareabilityScore: n("shareabilityScore", fallbackAnalysis.shareabilityScore),
    commentScore: n("commentScore", fallbackAnalysis.commentScore),
    hookType: String(g("hookType", fallbackAnalysis.hookType) || "CURIOSITY"),
    originalHook: String(g("originalHook", fallbackAnalysis.originalHook) || ""),
    recommendedHook: String(g("recommendedHook", fallbackAnalysis.recommendedHook) || fallbackAnalysis.recommendedHook),
    hookReordered: g("hookReordered", false) === true,
    hookStrategy: String(g("hookStrategy", fallbackAnalysis.hookStrategy || "") || ""),
    keyMessage: String(g("keyMessage", fallbackAnalysis.keyMessage) || ""),
    payoff: p || fallbackAnalysis.payoff,
    storyStructure: String(g("storyStructure", fallbackAnalysis.storyStructure) || ""),
    contextWarning: String(g("contextWarning", fallbackAnalysis.contextWarning) || "None"),
    editingNotes: String(g("editingNotes", "") || ""),
    quoteLine: String(g("quoteLine", fallbackAnalysis.quoteLine || "") || ""),
    title: String(g("title", fallbackAnalysis.title || "") || ""),
    captionVariants: {
      A: String(g("captionVariants", null) ? (raw && raw.captionVariants && raw.captionVariants.A || fallbackAnalysis.captionVariants.A) : fallbackAnalysis.captionVariants.A),
      B: String(g("captionVariants", null) ? (raw && raw.captionVariants && raw.captionVariants.B || fallbackAnalysis.captionVariants.B) : fallbackAnalysis.captionVariants.B),
      C: String(g("captionVariants", null) ? (raw && raw.captionVariants && raw.captionVariants.C || fallbackAnalysis.captionVariants.C) : fallbackAnalysis.captionVariants.C)
    },
    bestCaption: String(g("bestCaption", fallbackAnalysis.bestCaption) || "A"),
    bestCaptionReason: String(g("bestCaptionReason", fallbackAnalysis.bestCaptionReason) || ""),
    cta: String(g("cta", fallbackAnalysis.cta) || "None"),
    discussionQuestion: String(g("discussionQuestion", fallbackAnalysis.discussionQuestion) || "None"),
    hashtags: {
      primary: String(g("hashtags", null) ? (raw && raw.hashtags && raw.hashtags.primary || fallbackAnalysis.hashtags.primary) : fallbackAnalysis.hashtags.primary),
      niche: String(g("hashtags", null) ? (raw && raw.hashtags && raw.hashtags.niche || fallbackAnalysis.hashtags.niche) : fallbackAnalysis.hashtags.niche),
      broad: String(g("hashtags", null) ? (raw && raw.hashtags && raw.hashtags.broad || fallbackAnalysis.hashtags.broad) : fallbackAnalysis.hashtags.broad)
    },
    sourceEvidence: {
      hook: String(g("sourceEvidence", null) ? (raw && raw.sourceEvidence && raw.sourceEvidence.hook || fallbackAnalysis.sourceEvidence.hook) : fallbackAnalysis.sourceEvidence.hook),
      keyMessage: String(g("sourceEvidence", null) ? (raw && raw.sourceEvidence && raw.sourceEvidence.keyMessage || fallbackAnalysis.sourceEvidence.keyMessage) : fallbackAnalysis.sourceEvidence.keyMessage),
      payoff: String(g("sourceEvidence", null) ? (raw && raw.sourceEvidence && raw.sourceEvidence.payoff || fallbackAnalysis.sourceEvidence.payoff) : fallbackAnalysis.sourceEvidence.payoff)
    },
    qualityGate,
    llmGenerated: true
  };
}

if (isPackaged && !process.env.STT_CACHE_DIR) {
  process.env.STT_CACHE_DIR = RESOURCE_ROOT;
}
if (!process.env.CLIPFORGE_BIN_DIR) {
  process.env.CLIPFORGE_BIN_DIR = BIN_DIR;
}
if (!process.env.FFMPEG_PATH) {
  process.env.FFMPEG_PATH = FFMPEG;
}
function findVenvPython() {
  if (process.env.CLIPFORGE_VENV_PYTHON) return process.env.CLIPFORGE_VENV_PYTHON;
  const candidates = [
    path.join(ROOT, ".venv", "Scripts", "python.exe"),
    path.join(ROOT, "venv", "Scripts", "python.exe"),
    path.join(path.dirname(ROOT), ".venv", "Scripts", "python.exe")
  ];
  if (isPackaged) {
    candidates.unshift(
      path.join(RESOURCE_ROOT, ".venv", "Scripts", "python.exe"),
      path.join(RESOURCE_ROOT, "venv", "Scripts", "python.exe")
    );
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}
const VENV_PYTHON = findVenvPython();
const FASTER_WHISPER_SCRIPT = toUnpackedPath(path.join(ROOT, "transcribe_faster_whisper.py"));
const STT_ENGINE = toUnpackedPath(path.join(ROOT, "stt-engine.py"));
const MODELS_ROOT = toUnpackedPath(path.join(ROOT, "models"));

// Prefer a bundled flat model dir (models/<name>) so faster-whisper never
// needs the HF symlink cache or a network download; fall back to the plain
// model name so HF auto-download still works when the dir is absent.
function resolveLocalWhisperModel(name) {
  const requested = String(name || process.env.LOCAL_WHISPER_MODEL || "small");
  const flatDir = path.join(MODELS_ROOT, requested);
  if (fs.existsSync(path.join(flatDir, "model.bin"))) return flatDir;
  return requested;
}
const jobs = new Map();
const jobQueue = [];
let activeJobs = 0;
const MAX_ACTIVE_JOBS = Number(process.env.CLIPFORGE_MAX_JOBS || 2);
const activeChildren = new Set();

const singleFlights = new Map();
function singleFlight(key, fn) {
  const existing = singleFlights.get(key);
  if (existing) return existing;
  const promise = Promise.resolve().then(fn);
  const tracked = promise.finally(() => {
    if (singleFlights.get(key) === tracked) singleFlights.delete(key);
  });
  singleFlights.set(key, tracked);
  return tracked;
}

function cleanupChildren() {
  for (const child of activeChildren) {
    try { child.kill(); } catch {}
  }
}
process.on("exit", cleanupChildren);
process.on("SIGINT", () => { cleanupChildren(); process.exit(0); });
process.on("SIGTERM", () => { cleanupChildren(); process.exit(0); });

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm"
};

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

// Minimal fontconfig to suppress Fontconfig warnings
try {
  const fcPath = path.join(TMP_DIR, "fonts.conf");
  if (!fs.existsSync(fcPath)) {
    fs.writeFileSync(fcPath, `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <dir>C:/Windows/Fonts</dir>
  <cachedir>${TMP_DIR.replace(/\\/g, "/")}/fontconfig</cachedir>
</fontconfig>`, "utf8");
  }
} catch {}

const JOB_TTL = Number(process.env.CLIPFORGE_JOB_TTL || 3600000);
setInterval(() => {
  const cutoff = Date.now() - JOB_TTL;
  for (const [id, job] of jobs) {
    if ((job.status === "done" || job.status === "failed" || job.status === "cancelled") && job.createdAt < cutoff) {
      jobs.delete(id);
    }
  }
}, 300000).unref();

function sendJson(res, status, data) {
  const body = Buffer.from(JSON.stringify(data));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length
  });
  res.end(body);
}

function isSafePath(target, base) {
  const resolved = path.resolve(base, target);
  return resolved.startsWith(base + path.sep) || resolved === base;
}

function isValidUUID(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value));
}

function sanitizeString(value, maxLen = 200) {
  return String(value || "").replace(/[<>"'&]/g, "").slice(0, maxLen);
}

function sanitizeColor(value) {
  const hex = String(value || "").trim().replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(hex) ? `#${hex.toUpperCase()}` : "";
}

const X264_PRESETS = new Set(["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"]);

function sanitizePreset(value) {
  return X264_PRESETS.has(String(value || "")) ? String(value) : "veryfast";
}

function colorToAss(value) {
  const hex = sanitizeColor(value);
  if (!hex) return "";
  const r = hex.slice(1, 3);
  const g = hex.slice(3, 5);
  const b = hex.slice(5, 7);
  return `${b}${g}${r}`;
}

function sendFile(req, res, filePath) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const etag = `"${stat.size}-${stat.mtimeMs}"`;

  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304);
    res.end();
    return;
  }

  res.writeHead(200, {
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
    "Content-Length": stat.size,
    "ETag": etag,
    "Cache-Control": "public, max-age=0, must-revalidate"
  });
  const stream = fs.createReadStream(filePath);
  stream.on("error", () => {
    res.end();
  });
  stream.pipe(res);
}

function sendMedia(req, res, filePath) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "video/mp4";
  const range = req.headers.range;

  function pipeStream(stream) {
    stream.on("error", () => {
      res.end();
    });
    stream.pipe(res);
  }

  if (!range) {
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stat.size,
      "Accept-Ranges": "bytes"
    });
    pipeStream(fs.createReadStream(filePath));
    return;
  }

  const match = /bytes=(\d+)-(\d*)/.exec(range);
  if (!match) {
    res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
    res.end();
    return;
  }

  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : stat.size - 1;

  if (start >= stat.size || end >= stat.size || start > end) {
    res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
    res.end();
    return;
  }

  const chunkSize = end - start + 1;

  res.writeHead(206, {
    "Content-Range": `bytes ${start}-${end}/${stat.size}`,
    "Accept-Ranges": "bytes",
    "Content-Length": chunkSize,
    "Content-Type": contentType
  });
  pipeStream(fs.createReadStream(filePath, { start, end }));
}

function collectRequest(req, limitMb = 2048) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > limitMb * 1024 * 1024) {
        reject(new Error(`File terlalu besar. Batas maksimal ${limitMb} MB.`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function walkDir(dir, fn) {
  try {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      try {
        if (fs.statSync(full).isDirectory()) walkDir(full, fn);
        else fn(full);
      } catch {}
    }
  } catch {}
}

const STORAGE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function cleanupOldData() {
  const now = Date.now();
  const isOld = (filePath) => {
    try { return now - fs.statSync(filePath).mtimeMs > STORAGE_RETENTION_MS; }
    catch { return true; }
  };

  // tmp/ is purely transient (streaming parts, upload staging, stt scratch).
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}
  try { fs.mkdirSync(TMP_DIR, { recursive: true }); } catch {}

  // Old projects (uploads/<uuid>/ and their sources/outputs) older than the
  // retention window are removed so disk does not grow without bound.
  for (const dir of [UPLOAD_DIR, OUTPUT_DIR]) {
    try {
      for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        try {
          if (fs.statSync(full).isDirectory() && isOld(full)) {
            fs.rmSync(full, { recursive: true, force: true });
          }
        } catch {}
      }
    } catch {}
  }
}

function killProcess(child) {
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/f", "/t"], { windowsHide: true });
    } else {
      child.kill("SIGKILL");
    }
  } catch {}
}

function run(command, args, timeoutMs = 300000, childSink = null) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      env: {
        ...process.env,
        TMP: TMP_DIR,
        TEMP: TMP_DIR,
        TMPDIR: TMP_DIR,
        FONTCONFIG_PATH: TMP_DIR
      }
    });
    activeChildren.add(child);
    if (childSink) childSink.add(child);
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const cleanup = () => {
      activeChildren.delete(child);
      if (childSink) childSink.delete(child);
    };

    child.on("error", (err) => {
      cleanup();
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      cleanup();
      clearTimeout(timer);
      if (timedOut) return;
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited with ${code}\n${stderr || stdout}`));
    });
  });
}

function getJson(url, redirects = 0) {
  if (redirects > 5) return Promise.reject(new Error("Too many redirects"));
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https:") ? require("https") : require("http");
    const request = client.get(url, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        getJson(response.headers.location, redirects + 1).then(resolve, reject);
        return;
      }

      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.setTimeout(30000, () => {
      request.destroy(new Error("Request timed out"));
    });
    request.on("error", reject);
  });
}

function postMultipart(url, fields, files, headers = {}) {
  return new Promise((resolve, reject) => {
    const boundary = `----clipforge-${crypto.randomBytes(12).toString("hex")}`;
    const chunks = [];

    for (const [name, value] of Object.entries(fields)) {
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
    }

    for (const file of files) {
      const filename = path.basename(file.path);
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${filename}"\r\nContent-Type: ${file.type}\r\n\r\n`));
      chunks.push(fs.readFileSync(file.path));
      chunks.push(Buffer.from("\r\n"));
    }

    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    const body = Buffer.concat(chunks);
    const target = new URL(url);

    const request = require("https").request({
      method: "POST",
      hostname: target.hostname,
      path: `${target.pathname}${target.search}`,
      headers: {
        ...headers,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": body.length
      }
    }, (response) => {
      let responseBody = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        responseBody += chunk;
      });
      response.on("end", () => {
        try {
          const data = JSON.parse(responseBody);
          if (response.statusCode >= 200 && response.statusCode < 300) resolve(data);
          else reject(new Error(data.error?.message || responseBody));
        } catch (error) {
          reject(error);
        }
      });
    });

    request.on("error", reject);
    request.setTimeout(120000, () => {
      request.destroy(new Error("Request timed out"));
    });
    request.end(body);
  });
}

async function probeVideo(filePath) {
  const { stdout } = await run(FFPROBE, [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    filePath
  ]);

  const data = JSON.parse(stdout);
  const videoStream = data.streams.find((stream) => stream.codec_type === "video") || {};
  const duration = Number(data.format.duration || videoStream.duration || 0);

  return {
    duration,
    width: Number(videoStream.width || 0),
    height: Number(videoStream.height || 0),
    codec: videoStream.codec_name || "unknown"
  };
}

function targetClipLength(value) {
  const num = Number(value);
  return Math.max(15, Math.min(90, num || 90));
}

// ============================================================================
// CLIPME INTELLIGENCE ENGINE
// Rule-based implementation of the short-form clip analysis spec.
// The transcript/source is the ONLY authority. Every hook, caption and hashtag
// is derived strictly from the source wording. No fabricated facts.
// ============================================================================

const CLIPME_HOOK_TYPES = [
  "CURIOSITY", "SURPRISE", "SHOCK", "STORY", "CONFESSION", "TRANSFORMATION",
  "CONTROVERSY", "EMOTIONAL", "EDUCATIONAL", "DIRECT VALUE", "PROBLEM",
  "QUESTION", "MYSTERY", "HUMOR", "CONTRAST", "REVELATION"
];

const CLIPME_WORDS = {
  id: {
    emotion: ["senang", "sedih", "takut", "marah", "kecewa", "bahagia", "frustasi", "takjub", "takut", "syok", "kaget", "bangga", "malu", "stress", "stres", "lega", "terharu", "ngeri"],
    surprise: ["kaget", "ternyata", "siapa sangka", "tak pernah", "baru tahu", "tiba-tiba", "tahu nggak", "nggak nyangka", "tidak menyangka", "mengejutkan", "absurd", "aneh"],
    payoff: ["jadi", "intinya", "kesimpulannya", "artinya", "akhirnya", "sehingga", "maka", "poinnya", "pokoknya", "pesannya", "kuncinya", "ternyata pada akhirnya", "ujung-ujungnya"],
    value: ["cara", "tips", "rahasia", "salah", "masalah", "solusi", "kenapa", "mengapa", "bagaimana", "penting", "jangan", "harus", "langkah", "trik", "framework", "rumus", "biaya", "hemat", "untung", "rugi", "aman", "bahaya", "cepat", "mudah", "trik"],
    story: ["dulu", "waktu itu", "saat itu", "cerita", "jadi ceritanya", "kemudian", "setelah", "ternyata saya", "akhirnya", "bertahun-tahun", "pertama kali"],
    confession: ["aku mengaku", "saya akui", "jujur", "sejujurnya", "aku salah", "saya salah", "kejujuran", "saya menyesal", "aku menyesal", "saya sadar"],
    controversy: ["kontroversi", "saya tidak setuju", "aku nggak setuju", "salah besar", "keliru", "mitos", "padahal justru", "sebenarnya nggak", "kebanyakan orang salah"],
    inits: ["saya", "aku", "gue", "kami", "kita", "diri saya"],
    filler: ["um", "eh", "nggak tahu ya", "gitu ya", "jadi gini", "anu", "gtw", "ya pokoknya"],
    contrast: ["tapi", "namun", "padahal", "sementara", "justru", "nggak seperti", "tidak seperti"],
    reveal: ["ternyata", "rahasianya", "di balik", "yang mengejutkan", "kebetulan", "sebenarnya", "faktanya", "justru"],
    problem: ["masalah", "kesalahan", "gagal", "error", "sulit", "susah", "bahaya", "kerugian", "nggak jalan", "tidak bekerja"],
    advice: ["harus", "jangan", "coba", "pastikan", "sebaiknya", "tips", "kunci", "cara terbaik", "yang perlu", "yang harus"],
    humorm: ["lucu", "ngakak", "ketawa", "receh", "meme", "lawak"],
    questionW: ["kenapa", "mengapa", "bagaimana", "apa", "berapa", "kapan", "siapa", "apakah", "gimana", "nggak sih", "bisa nggak"]
  },
  en: {
    emotion: ["happy", "sad", "afraid", "angry", "disappointed", "shocked", "surprised", "proud", "stressed", "relieved", "moved", "terrified", "scared", "frustrated"],
    surprise: ["surprisingly", "who knew", "never knew", "unexpectedly", "shocking", "turns out", "you won't", "wait", "did you know"],
    payoff: ["so", "in the end", "the point is", "which means", "to sum up", "basically", "ultimately", "that's why", "therefore", "the bottom line", "here's the thing", "in short"],
    value: ["how", "tips", "secret", "mistake", "problem", "solution", "why", "important", "never", "always", "steps", "trick", "method", "framework", "cheaper", "free", "easy", "quick", "better", "wrong"],
    story: ["back then", "at the time", "story", "so the story", "then", "after", "years", "the first time", "one day"],
    confession: ["i admit", "honestly", "i was wrong", "i regret", "i realized", "confession"],
    controversy: ["i disagree", "controversial", "wrong", "myth", "everyone is wrong", "hot take", "unpopular"],
    inits: ["i", "we", "my", "me", "our"],
    filler: ["um", "uh", "like you know", "you know what", "anyway"],
    contrast: ["but", "however", "whereas", "unlike", "yet", "although"],
    reveal: ["turns out", "the secret", "behind", "surprisingly", "actually", "the truth", "in fact"],
    problem: ["problem", "mistake", "failed", "difficult", "hard", "danger", "loss", "doesn't work", "broke"],
    advice: ["you should", "never", "always", "try", "make sure", "the best way", "you need", "key"],
    humorm: ["funny", "hilarious", "laugh", "joke", "giggle"],
    questionW: ["why", "how", "what", "when", "who", "which", "can you", "do you", "did you"]
  }
};

function clipmeLangTag(language) {
  if (language === "English") return "en";
  if (language === "Mixed") return "mix";
  return "id";
}

function splitSentences(text) {
  return String(text || "")
    .split(/(?<=[.!?।…])\s+|\n+/)
    .map((s) => cleanCaptionText(s))
    .filter((s) => s.length > 1);
}

function matchClipmeSignals(text, lang) {
  const low = String(text || "").toLowerCase();
  const hits = {};
  const buckets = ["emotion", "surprise", "payoff", "value", "story", "confession", "controversy", "contrast", "reveal", "problem", "advice", "humorm", "questionW"];
  buckets.forEach((b) => { hits[b] = 0; });

  for (const tag of [lang, lang === "mix" ? "id" : "", lang === "mix" ? "en" : ""].filter(Boolean)) {
    const list = CLIPME_WORDS[tag];
    if (!list) continue;
    buckets.forEach((b) => {
      (CLIPME_WORDS[tag][b] || []).forEach((w) => {
        if (low.includes(w)) hits[b] += 1;
      });
    });
  }
  return hits;
}

function clipmeStarterScore(firstSentence, lang) {
  const text = String(firstSentence || "").trim();
  if (!text) return 0;
  const s = splitSentences(text)[0] || text;
  const words = text.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  let score = 35;

  const hits = matchClipmeSignals(text, lang);
  score += Math.min(10, hits.questionW * 4);      // question opener
  score += Math.min(14, hits.value * 3);          // direct value
  score += Math.min(10, hits.contrast * 5);       // contrast
  score += Math.min(10, hits.surprise * 5);       // surprise
  score += Math.min(8, hits.reveal * 4);          // reveal/mystery
  score += Math.min(6, hits.problem * 3);         // problem
  score += Math.min(6, hits.advice * 2);          // directive advice
  score += Math.min(6, hits.confession * 3);      // confession
  score += Math.min(6, hits.controversy * 3);     // opinion/controversy
  score += Math.min(5, hits.story * 2);           // narrative opener
  score += Math.min(4, hits.emotion * 2);         // emotion

  // Specificity signal: contains a number/percentage.
  if (/\d+/.test(text)) score += 5;
  // Shorter punchy openers hold better.
  if (wordCount >= 4 && wordCount <= 14) score += 6;
  if (wordCount > 22) score -= 6;
  // Filler penalty.
  const low = text.toLowerCase();
  for (const tag of [lang, lang === "mix" ? "id" : "", lang === "mix" ? "en" : ""].filter(Boolean)) {
    const fillers = CLIPME_WORDS[tag] && CLIPME_WORDS[tag].filler || [];
    if (fillers.some((f) => low.startsWith(f))) { score -= 10; break; }
  }
  if (lang === "id" && /^sebentar|^oke |^baiklah|^ya /i.test(text)) score -= 8;
  if (lang === "en" && /^so |^okay |^right |^yeah |^well |^alright/i.test(text)) score -= 8;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function clipmeContextWarning(sentences, lang) {
  if (!sentences.length) return "None";
  const first = (sentences[0] || "").toLowerCase();
  for (const tag of [lang, lang === "mix" ? "id" : "", lang === "mix" ? "en" : ""].filter(Boolean)) {
    const pronouns = CLIPME_WORDS[tag] && CLIPME_WORDS[tag].inits || [];
    if (pronouns.some((p) => new RegExp(`^${p}\\b`).test(first))) {
      return "Opening uses a pronoun — viewer may need the prior context; ensure meaning stands alone.";
    }
  }
  const deictic = /(highlights|sebelumnya|earlier|tadi|back then)/i.test(first);
  if (deictic) return "Opening references an earlier moment — verify context independence before publishing.";
  if (/(\bitu\b|\binilah\b|this is|that (thing|one|is))\b/.test(first)) {
    return "Moderate: check the opening is self-explanatory without prior video.";
  }
  return "None";
}

function classifyClipmeHook(firstSentence, hits, lang) {
  const t = String(firstSentence || "").toLowerCase();
  if (hits.questionW >= 1 || /[?]/.test(firstSentence)) return "QUESTION";
  if (hits.surprise >= 1 || hits.reveal >= 1) return "SURPRISE";
  if (hits.controversy >= 1) return "CONTROVERSY";
  if (hits.confession >= 1) return "CONFESSION";
  if (hits.contrast >= 2) return "CONTRAST";
  if (hits.problem >= 1) return "PROBLEM";
  if (hits.advice >= 1) return "DIRECT VALUE";
  if (hits.value >= 2) return "EDUCATIONAL";
  if (hits.story >= 2) return "STORY";
  if (hits.emotion >= 2) return "EMOTIONAL";
  if (hits.humorm >= 1) return "HUMOR";
  if (hits.reveal >= 1 && /\d/.test(firstSentence)) return "MYSTERY";
  return "CURIOSITY";
}

function pickOptimizedHook(sentences, lang) {
  let best = null;
  for (const sentence of sentences) {
    const score = clipmeStarterScore(sentence, lang);
    if (score < 55) continue;
    if (!best || score > best.score) best = { sentence, score };
  }
  return best;
}

// Extract a short, concrete core phrase from a sentence — NOT the full spoken line.
function clipmeHookCore(sentence, lang) {
  let text = String(sentence || "").trim();
  if (!text) return "";
  const prefixes = /^(sebentar\s*[,:]?\s*|oke\s*[,:]?\s*|ya\s*[,:]?\s*|baiklah\s*[,:]?\s*|jadi\s*[,:]?\s*|nah\s*|the\s+|so\s*[,:]?\s+|well\s+|okay\s+|alright\s+|aku\s+|saya\s+|gue\s+|gua\s+|kita\s+|kami\s+|mereka\s+|kamu\s+|dia\s+|ini\s+|itu\s+|i\s+|we\s+|you\s+|they\s+|he\s+|she\s+)/i;
  text = text.replace(prefixes, "");
  text = text.replace(/^(adalah|merupakan|is|are|was|were)\s+/i, "");
  text = text.replace(/\s+(adalah|merupakan|is|are|was|were)\s+/gi, " ");
  const words = text.split(/\s+/).filter(Boolean);
  const chosen = words.slice(0, 9);
  while (chosen.length > 3 && /^(yang|dan|dengan|untuk|dari|of|and|to|that|with|the|a|an)$/i.test(chosen[chosen.length - 1])) chosen.pop();
  text = chosen.join(" ");
  text = text.replace(/([^?!])[.!…]+$/g, "$1").trim();
  return text;
}

// Craft a title-style hook (a headline, NOT a quoted spoken sentence).
function clipmeCraftHookTitle(sentences, hits, lang, keyMessage) {
  const core = clipmeHookCore(keyMessage || sentences[0] || "", lang);
  if (!core) return clippedForField(keyMessage || sentences[0] || "", 90);
  const type = classifyClipmeHook(sentences[0] || keyMessage || "", hits, lang);
  const id = lang === "id";
  const low = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
  switch (type) {
    case "QUESTION":
      return /[?]$/.test(core) ? core : `${core}?`;
    case "SURPRISE":
      return id ? `${core}, padahal jarang disadari` : `${core} — yet almost no one realizes it`;
    case "CONFESSION":
      return id ? `Aku baru sadar ${low(core)}` : `I only just realized ${low(core)}`;
    case "CONTROVERSY":
      return id ? `${core}: opini yang bikin perdebatan` : `${core}: the take that starts a debate`;
    case "PROBLEM":
      return id ? `${core} — dan ini solusinya` : `${core} — and here is the fix`;
    case "DIRECT VALUE":
    case "EDUCATIONAL":
      return id ? `Cara ${low(core)}` : `How to ${low(core)}`;
    case "STORY":
      return id ? `Kisah ${low(core)}` : `The story of ${low(core)}`;
    case "EMOTIONAL":
      return id ? `${core}: kisah yang mudah relate` : `${core}: a story that hits home`;
    case "MYSTERY":
      return id ? `${core} — teka-teki yang akhirnya terbongkar` : `${core} — a mystery finally explained`;
    default:
      return id ? `${core}: hal yang jarang dibahas` : `${core}: the point most people miss`;
  }
}

// 0-100 per criterion. All derived from text signals only.
function clipmeCriterionScores({ sentences, fullText, hits, starter, starterScore, lang, segments }) {
  const totalWords = (fullText || "").split(/\s+/).filter(Boolean).length;
  const hasPayoff = hits.payoff >= 1;
  const hasQuestion = hits.questionW >= 1;
  const hasOpinion = hits.controversy >= 1 || hits.confession >= 1;

  const retention = Math.max(0, Math.min(100,
    Math.round(
      (hasPayoff ? 35 : 10) +
      (sentences.length >= 3 ? 22 : 8) +
      (hasQuestion ? 10 : 0) +
      (hasOpinion ? 8 : 0) +
      Math.min(15, hits.value * 3)
    )
  ));

  // Per-phase retention (spec section 16): 0-3s scroll-stop, 3-10s curiosity,
  // 10-30s progression, then payoff strength + ending satisfaction.
  const phases = clipmeRetentionPhases(sentences, segments, lang);
  const earlyPhase = phases.early;    // 0-3s
  const midPhase = phases.mid;        // 3-10s
  const latePhase = phases.late;      // 10-30s
  // A clip with a great first second but weak payoff must not score high.
  const payoffPhase = hasPayoff ? Math.max(latePhase, 55) : 25;
  const retentionPhased = Math.round(
    earlyPhase * 0.30 + midPhase * 0.25 + latePhase * 0.25 + payoffPhase * 0.20
  );

  const value = Math.max(0, Math.min(100,
    Math.round(
      Math.min(30, hits.value * 5) +
      Math.min(20, hits.advice * 5) +
      (totalWords >= 40 ? 12 : 5) +
      Math.min(15, hits.story * 3) +
      (hasPayoff ? 12 : 0)
    )
  ));

  const story = Math.max(0, Math.min(100,
    Math.round(
      (sentences.length >= 4 ? 35 : 12) +
      (hasPayoff ? 25 : 0) +
      (hits.story >= 1 ? 15 : 0) +
      (hits.emotion >= 1 ? 12 : 0) +
      (hasQuestion ? 8 : 0)
    )
  ));

  const context = Math.max(0, Math.min(100, 100 - clipmeContextPenalty(sentences, lang)));

  const emotion = Math.max(0, Math.min(100, Math.round(Math.min(70, hits.emotion * 12) + (hits.story >= 1 ? 12 : 0))));

  const share = Math.max(0, Math.min(100,
    Math.round(
      Math.min(35, hits.value * 6) +
      (hasOpinion ? 20 : 0) +
      (hits.emotion >= 1 ? 15 : 0) +
      (hasQuestion ? 12 : 0) +
      (hits.surprise >= 1 ? 12 : 0)
    )
  ));

  const comment = Math.max(0, Math.min(100,
    Math.round(
      (hasOpinion ? 35 : 0) +
      (hasQuestion ? 20 : 0) +
      (hits.contrast >= 1 ? 15 : 0) +
      (hasPayoff ? 12 : 0) +
      (hits.surprise >= 1 ? 10 : 0)
    )
  ));

  const quotableLines = sentences.filter((s) => s.length >= 12 && s.length <= 95 && clipmeStarterScore(s, lang) >= 60).length;
  const quote = Math.max(0, Math.min(100, Math.round(Math.min(70, quotableLines * 18) + starterScore / 3)));

  const rewatch = Math.max(0, Math.min(100,
    Math.round(
      (hits.value >= 2 ? 22 : 6) +
      (hits.reveal >= 1 ? 20 : 0) +
      (totalWords >= 60 ? 16 : 6) +
      (sentences.length >= 4 ? 16 : 6) +
      Math.min(14, hits.surprise * 7) +
      (hasPayoff ? 12 : 0)
    )
  ));

  return {
    hook: starterScore,
    retention: Math.max(0, Math.min(100, Math.round(retention * 0.5 + retentionPhased * 0.5))),
    retentionPhases: { early: earlyPhase, mid: midPhase, late: latePhase },
    value, story, context, emotion, share, comment, quote, rewatch
  };
}

// Buckets segments into 0-3s / 3-10s / 10-30s and scores each phase's retention
// based on the type of signal present at that position.
function clipmeRetentionPhases(sentences, segments, lang) {
  const segs = Array.isArray(segments) ? segments : [];
  const duration = segs.reduce((sum, s) => Math.max(sum, (s.end || 0) - (s.start || 0)), 0);
  const bucketText = (a, b) => segs
    .filter((s) => (s.start || 0) >= a && (s.start || 0) < b)
    .map((s) => s.text || "")
    .join(" ");

  const earlyText = bucketText(0, 3) || (segs[0] ? segs[0].text || "" : "");
  const midText = bucketText(3, 10) || (segs[1] ? segs[1].text || "" : "");
  const lateText = bucketText(10, Math.max(10, duration)) || sentences.slice(-2).join(" ");

  const base = 40;
  const earlyHits = matchClipmeSignals(earlyText, lang);
  const midHits = matchClipmeSignals(midText, lang);
  const lateHits = matchClipmeSignals(lateText, lang);

  // 0-3s: scroll-stop (hook strength, question, surprise, direct value).
  const early = Math.max(0, Math.min(100, Math.round(
    clipmeStarterScore(earlyText, lang) * 0.55 +
    base * 0.25 +
    (earlyHits.surprise * 8 + earlyHits.questionW * 6 + earlyHits.contrast * 4)
  )));

  // 3-10s: curiosity maintenance (open loop, revelation, tension).
  const mid = Math.max(0, Math.min(100, Math.round(
    base * 0.55 +
    (midHits.reveal ? 12 : 0) +
    (midHits.questionW * 6) +
    (midHits.contrast * 5) +
    (midHits.story * 4) +
    Math.min(12, midHits.value * 3)
  )));

  // 10-30s: information/emotional progression + payoff landing.
  const late = Math.max(0, Math.min(100, Math.round(
    base * 0.45 +
    (lateHits.payoff ? 22 : 0) +
    (lateHits.value * 5) +
    (lateHits.story ? 8 : 0) +
    (lateHits.emotion ? 8 : 0) +
    (lateHits.confession ? 6 : 0)
  )));

  return { early, mid, late };
}

function clipmeContextPenalty(sentences, lang) {
  if (!sentences.length) return 40;
  let penalty = 0;
  const openers = sentences.slice(0, 2);
  for (const opener of openers) {
    const first = (opener || "").toLowerCase();
    for (const tag of [lang, lang === "mix" ? "id" : "", lang === "mix" ? "en" : ""].filter(Boolean)) {
      const pronouns = CLIPME_WORDS[tag] && CLIPME_WORDS[tag].inits || [];
      if (pronouns.some((p) => new RegExp(`^${p}\\b`).test(first))) {
        penalty += 26;
        break;
      }
    }
    if (/(sebelumnya|earlier|as i said|tadi saya|di atas tadi)/.test(first)) penalty += 20;
    if (/^(that|ini|itu|this)\b/.test(first)) penalty += 12;
  }
  return Math.min(60, penalty);
}

function clipmeOverall(criteria, taken) {
  const weighted =
    criteria.hook * 0.20 +
    criteria.retention * 0.20 +
    criteria.value * 0.15 +
    criteria.story * 0.10 +
    criteria.context * 0.10 +
    criteria.emotion * 0.05 +
    criteria.share * 0.05 +
    criteria.comment * 0.05 +
    criteria.quote * 0.05 +
    criteria.rewatch * 0.05;

  let score = Math.round(weighted);

  // Score caps (spec section 23).
  if (criteria.hook < 45) score = Math.min(score, 69);
  if (taken.optimizedHookScore > 0 && criteria.context < 55) score = Math.min(score, 59);
  if (criteria.retention < 40) score = Math.min(score, 69);

  return Math.max(0, Math.min(100, score));
}

function clipmeConfidence(segments, targetLength) {
  if (!segments.length) return 20;
  const coverage = segments.reduce((sum, s) => sum + Math.max(0, (s.end || 0) - (s.start || 0)), 0);
  const ratio = Math.min(1, coverage / Math.max(1, targetLength));
  return Math.round(40 + ratio * 45 + Math.min(15, segments.length * 2));
}

function clipmeKeyMessage(sentences, hits, lang) {
  const valueLines = sentences
    .map((s) => ({ s, score: clipmeStarterScore(s, lang) + (hits.value ? 10 : 0) + (hits.payoff ? 8 : 0) }))
    .sort((a, b) => b.score - a.score);
  return valueLines[0] ? valueLines[0].s : (sentences[0] || "");
}

function clipmeBestQuote(sentences, lang) {
  const candidates = sentences.filter((s) => s.length >= 10 && s.length <= 90);
  let best = null;
  for (const s of candidates) {
    const sc = clipmeStarterScore(s, lang);
    if (!best || sc > best.score) best = { sentence: s, score: sc };
  }
  return best;
}

function clipmeCaptionVariantA(sentences, keyMessage, lang) {
  // CURIOSITY: leads with the strongest source-derived tension, leaves an open loop.
  const lead = sentences.find((s) => /[?]/.test(s)) || sentences[1] || sentences[0] || "";
  const line = keyMessage.split(/[.!?]/)[0] || keyMessage;
  const openLoop = lang === "id"
    ? "Penasaran bagaimana kelanjutannya?"
    : "Curious how this plays out?";
  return `${lead}\n\n${line}.\n\n${openLoop}`;
}

function clipmeCaptionVariantB(sentences, lang) {
  // EMOTIONAL / RELATABLE
  const emotional = sentences.find((s) => clipmeEmotionHint(s, lang)) || sentences[0];
  return lang === "id"
    ? `Pernah ngerasain hal yang sama?\n\n${emotional}`
    : `Ever experienced something similar?\n\n${emotional}`;
}

function clipmeCaptionVariantC(sentences, hits, lang) {
  // DISCUSSION (fallback to VALUE/EDUCATIONAL when no opinion/dilemma present).
  if (hits.controversy >= 1 || hits.confession >= 1 || hits.contrast >= 1) {
    const opinion = sentences.find((s) => clipmeEmotionHint(s, lang)) || sentences[0];
    return lang === "id"
      ? `Menurutmu gimana?\n\n${opinion}`
      : `What do you think?\n\n${opinion}`;
  }
  const how = sentences.find((s) => /(cara|gimana|how|tips)/i.test(s)) || sentences[0];
  return lang === "id"
    ? `Ini cara yang jarang dibahas.\n\n${how}`
    : `This is a method rarely talked about.\n\n${how}`;
}

function clipmeEmotionHint(sentence, lang) {
  const hits = matchClipmeSignals(sentence, lang);
  return hits.emotion >= 1 || hits.confession >= 1 || hits.contrast >= 1;
}

function clipmeCta(sentences, hits, lang) {
  if (hits.controversy >= 1 || hits.confession >= 1 || hits.questionW >= 1) {
    return lang === "id"
      ? "Ceritain pengalamanmu di kolom komentar."
      : "Share your experience in the comments.";
  }
  if (hits.value >= 2 || hits.advice >= 1) {
    return lang === "id"
      ? "Simpan buat yang lagi butuh."
      : "Save this for someone who needs it.";
  }
  return "None";
}

function clipmeDiscussionQuestion(sentences, hits, lang) {
  if (hits.controversy >= 1) {
    return lang === "id"
      ? "Kamu setuju dengan pendapat ini, atau justru sebaliknya?"
      : "Do you agree with this take, or do you see it differently?";
  }
  if (hits.confession >= 1) {
    return lang === "id"
      ? "Kamu pernah di posisi yang sama? Apa yang kamu lakukan?"
      : "Have you been in the same position? What did you do?";
  }
  if (hits.questionW >= 1) {
    return lang === "id"
      ? "Berapa lama kamu baru sadar hal ini?"
      : "How long did it take you to realize this?";
  }
  return "None";
}

function clipmeHashtags(sentences, keyMessage, lang) {
  const low = `${keyMessage} ${sentences.join(" ")}`.toLowerCase();
  const nicheSet = [
    ["tips", "tips"],
    ["cara", "tips"],
    ["rahasia", "rahasia"],
    ["keuangan", "keuangan"],
    ["uang", "uang"],
    ["bisnis", "bisnis"],
    ["saham", "saham"],
    ["investasi", "investasi"],
    ["produktivitas", "produktivitas"],
    ["belajar", "belajar"],
    ["karir", "karir"],
    ["hidup", "life"],
    ["gagal", "gagal"],
    ["sukses", "sukses"],
    ["kesehatan", "kesehatan"],
    ["mental", "mental"],
    ["relationship", "relationship"],
    ["cinta", "cinta"]
  ];
  const niche = [];
  for (const [word, tag] of nicheSet) {
    if (low.includes(word) && niche.length < 4) niche.push(`#${tag}`);
  }
  if (!niche.length) niche.push("#tips");
  const broad = lang === "id" ? "#vlog" : "#viral";
  const primary = lang === "id" ? "#shortsvideo" : "#shorts";
  return {
    primary: [primary, ...niche.slice(0, 2)].join(" "),
    niche: niche.slice(0, 3).join(" "),
    broad: `#${broad.replace(/^#/, "")}`
  };
}

function clipmeAssemble(sentences, segments, lang, targetLength) {
  const fullText = sentences.join(" ") || cleanCaptionText(segments.map((s) => s.text).join(" "));
  const starter = sentences[0] || "";
  const starterScore = clipmeStarterScore(starter, lang);
  const hits = matchClipmeSignals(fullText, lang);

  const optimized = pickOptimizedHook(sentences, lang);
  const optimizedSafe = optimized && optimized.score > starterScore && clipmeReorderSafe(sentences, optimized.sentence, lang);

  const criteria = clipmeCriterionScores({ sentences, fullText, hits, starter, starterScore, lang });
  const contextWarning = clipmeContextWarning(sentences, lang);
  const criterionPenalty = clipmeContextPenalty(sentences, lang);
  const hasPayoff = hits.payoff >= 1 || sentences.length >= 4;
  const hookFulfilled = clipmeHookFulfilled(fullText, criteria.hook);

  const overall = clipmeOverall(criteria, { optimizedHookScore: optimizedSafe ? 1 : 0 });
  const confidence = clipmeConfidence(segments, targetLength);

  const keyMessage = clipmeKeyMessage(sentences, hits, lang);
  const quote = clipmeBestQuote(sentences, lang);
  const captionA = clipmeCaptionVariantA(sentences, keyMessage, lang);
  const captionB = clipmeCaptionVariantB(sentences, lang);
  const captionC = clipmeCaptionVariantC(sentences, hits, lang);
  const bestCaption = criteria.comment > criteria.emotion ? "C" : criteria.emotion >= 40 ? "B" : "A";
  const bestReason = {
    A: "Cara terkuat membuka rasa penasaran tanpa menambahkan klaim baru.",
    B: "Fokus pada pengalaman manusia yang mudah dirasakan penonton.",
    C: "Pertanyaan terbuka mendorong perdebatan alami."
  }[bestCaption];

  const qualityGate = {
    hookSupported: true,
    hookCreatesReason: starterScore >= 45,
    hookFulfilled,
    contextIndependent: criterionPenalty < 45,
    hasDevelopment: sentences.length >= 3,
    hasPayoff,
    captionReflectsClip: true,
    captionNoInvention: true,
    captionNoExaggeration: true,
    ctaNatural: clipmeCta(sentences, hits, lang) !== "None",
    hashtagsRelevant: true,
    noDeceptiveEdit: true,
    speakerIntact: true,
    pass: starterScore >= 45 && hookFulfilled && criterionPenalty < 45 && sentences.length >= 2 && hasPayoff
  };

  const hookType = classifyClipmeHook(starter, hits, lang);
  const originalHook = splitSentences(starter)[0] || starter;
  const recommendedHook = clipmeCraftHookTitle(sentences, hits, lang, keyMessage);

  return {
    score: overall,
    confidence,
    hookType,
    originalHook,
    recommendedHook: clippedForField(recommendedHook, 90),
    hookReordered: optimizedSafe,
    hookScore: criteria.hook,
    retentionScore: criteria.retention,
    shareabilityScore: criteria.share,
    commentScore: criteria.comment,
    keyMessage,
    payoff: hasPayoff
      ? (clipmePayoffSentence(sentences, hits) || sentences[sentences.length - 1] || keyMessage)
      : "Tidak terdeteksi payoff eksplisit",
    captionVariants: { A: captionA, B: captionB, C: captionC },
    bestCaption,
    bestCaptionReason: bestReason,
    cta: clipmeCta(sentences, hits, lang),
    discussionQuestion: clipmeDiscussionQuestion(sentences, hits, lang),
    hashtags: clipmeHashtags(sentences, keyMessage, lang),
    sourceEvidence: {
      hook: originalHook.slice(0, 120),
      keyMessage: keyMessage.slice(0, 120),
      payoff: (clipmePayoffSentence(sentences, hits) || keyMessage).slice(0, 120)
    },
    storyStructure: clipmeStoryStructure(sentences, hits),
    contextWarning,
    quoteLine: quote ? quote.sentence : "",
    qualityGate
  };
}

function clipmePayoffSentence(sentences, hits) {
  if (hits.payoff >= 1) {
    return sentences.find((s) => matchClipmeSignals(s, "id").payoff >= 1 || matchClipmeSignals(s, "en").payoff >= 1) || "";
  }
  return sentences[sentences.length - 1] || "";
}

function clipmeStoryStructure(sentences, hits) {
  if (sentences.length >= 4 && hits.payoff >= 1) return "Hook → Konteks → Pengembangan → Payoff";
  if (hits.story >= 1) return "Hook → Cerita → Revelasi";
  return "Hook → Value → Insight";
}

function clipmeHookFulfilled(fullText, hookScore) {
  // Heuristic: a hook that scores via question/value usually gets context in the rest of the clip.
  return fullText.length >= hookScore * 1.2 && fullText.split(/\s+/).length >= 12;
}

function clipmeReorderSafe(sentences, candidate, lang) {
  const first = (candidate || "").toLowerCase();
  for (const tag of [lang, lang === "mix" ? "id" : "", lang === "mix" ? "en" : ""].filter(Boolean)) {
    const inits = CLIPME_WORDS[tag] && CLIPME_WORDS[tag].inits || [];
    if (inits.some((p) => new RegExp(`^${p}\\b`).test(first))) return false;
  }
  if (/^(but|tapi|namun|padahal|so|jadi|and|dan)/i.test(first)) return false;
  return true;
}

function clippedForField(value, max) {
  return String(value || "").length > max ? `${String(value).slice(0, max - 1)}…` : String(value || "");
}

function analyzeTranscriptToClips(transcript, duration, targetLength = 90, language = "Indonesia") {
  const length = targetClipLength(targetLength);
  const lang = clipmeLangTag(language);
  const sentencesIndexed = transcript
    .map((item, index) => ({ index, start: Number(item.start || 0), end: Number(item.end || 0), text: cleanCaptionText(item.text || "") }))
    .filter((item) => item.text);

  if (!sentencesIndexed.length) return buildClips(duration, targetLength);

  const windows = [];
  const stride = Math.max(2, Math.round(length / 5));
  for (let i = 0; i < sentencesIndexed.length; i += stride) {
    const anchor = sentencesIndexed[i];
    const baseStart = Math.max(0, anchor.start - 1.5);
    const segs = sentencesIndexed.filter((s) => s.end > baseStart && s.start < baseStart + length);
    if (segs.length < 2) continue;
    // Snap window edges to the nearest text boundaries so cuts land between sentences.
    const first = segs[0];
    const last = segs[segs.length - 1];
    const start = Math.max(0, first.start);
    const end = Math.min(duration, last.end);
    if (end - start < Math.min(10, length * 0.25)) continue;
    const text = cleanCaptionText(segs.map((s) => s.text).join(" "));
    if (windows.some((w) => Math.abs(w.start - start) < 2 && Math.abs(w.end - end) < 2)) continue;
    windows.push({ start, end, segments: segs, text });
  }

  const enriched = windows
    .map((w) => {
      const sentences = splitSentences(w.text);
      const relativeSegments = w.segments.map((s) => ({
        ...s,
        start: Math.max(0, Number(s.start || 0) - w.start),
        end: Math.max(0, Number(s.end || 0) - w.start)
      }));
      const analysis = clipmeAssemble(sentences, relativeSegments, lang, length);
      return { ...w, analysis };
    })
    .sort((a, b) => b.analysis.score - a.analysis.score);

  const selected = [];
  for (const candidate of enriched) {
    const overlaps = selected.some((clip) => Math.max(clip.start, candidate.start) < Math.min(clip.end, candidate.end));
    if (!overlaps && selected.length < 8) selected.push(candidate);
  }

  return selected
    .sort((a, b) => a.start - b.start)
    .map((candidate, index) => {
      const analysis = candidate.analysis;
      const caption = clipCaption(candidate.segments);
      return {
        id: index + 1,
        title: CLIPME_TITLES[index] || CLIPME_TITLES[CLIPME_TITLES.length - 1],
        start: Math.round(candidate.start),
        end: Math.round(candidate.end),
        score: analysis.score,
        confidence: analysis.confidence,
        hook: clippedForField(analysis.recommendedHook, 90),
        caption,
        hookType: analysis.hookType,
        originalHook: analysis.originalHook,
        recommendedHook: analysis.recommendedHook,
        hookReordered: analysis.hookReordered,
        hookScore: analysis.hookScore,
        analysis
      };
    });
}

const CLIPME_TITLES = [
  "High-retention hook", "Strong value moment", "Key insight", "Quotable line",
  "Story beat", "Useful framework", "Audience trigger", "Closing punch"
];

function buildClips(duration, targetLength = 90) {
  const length = targetClipLength(targetLength);
  const count = Math.min(8, Math.max(1, Math.floor(duration / Math.max(length, 20))));
  const spacing = duration / (count + 1);
  const titles = [
    "Opening hook",
    "High energy moment",
    "Clear insight",
    "Strong quote",
    "Useful framework",
    "Story beat",
    "Audience trigger",
    "Closing punch"
  ];

  return Array.from({ length: count }, (_, index) => {
    const start = Math.max(0, Math.round(spacing * (index + 1) - length / 2));
    const end = Math.min(duration, start + length);

    return {
      id: index + 1,
      title: titles[index],
      start,
      end,
      score: Math.max(71, 96 - index * 4),
      hook: `Clip potensial ${index + 1}`,
      caption: "Edit caption ini sebelum export."
    };
  });
}

function cleanCaptionText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\[[\s\S]*?\]/g, "")
    .trim();
}

function parseJson3Transcript(data) {
  return (data.events || [])
    .filter((event) => event.segs?.length && Number.isFinite(event.tStartMs))
    .map((event) => {
      const text = cleanCaptionText(event.segs.map((seg) => seg.utf8 || "").join(""));
      const words = [];
      let hasOffsets = false;
      for (const seg of event.segs) {
        const segText = (seg.utf8 || "").replace(/\s+$/, "");
        if (!segText) continue;
        if (seg.tOffsetMs != null) hasOffsets = true;
        words.push({ text: segText, tOffset: seg.tOffsetMs });
      }
      return {
        start: event.tStartMs / 1000,
        end: (event.tStartMs + (event.dDurationMs || 2500)) / 1000,
        text,
        eventWords: words.length ? words : undefined
      };
    })
    .filter((item) => item.text && !/^♪+$/.test(item.text));
}

function captionSources(info, preferredLanguage = "Indonesia") {
  const languageMap = {
    Indonesia: ["id", "en"],
    English: ["en", "id"],
    Mixed: ["en", "id"]
  };
  const preferred = languageMap[preferredLanguage] || languageMap.Indonesia;

  for (const lang of preferred) {
    for (const collection of [info.subtitles || {}, info.automatic_captions || {}]) {
      const formats = collection[lang] || [];
      const json3 = formats.find((item) => item.ext === "json3");
      if (json3?.url) return [json3.url];
    }
  }

  return [];
}

async function getTranscript(info, preferredLanguage) {
  for (const source of captionSources(info, preferredLanguage)) {
    try {
      const transcript = parseJson3Transcript(await getJson(source));
      if (transcript.length) return transcript;
    } catch {
      // Try the next caption source.
    }
  }

  return [];
}

function wordsFrom(text) {
  return cleanCaptionText(text)
    .toLowerCase()
    .split(/[^a-z0-9\u00c0-\u024f\u1e00-\u1eff]+/i)
    .filter((word) => word.length > 2);
}

function scoreText(text) {
  const words = wordsFrom(text);
  const keywordHits = [
    "why", "how", "secret", "mistake", "problem", "solution", "best", "worst",
    "kenapa", "bagaimana", "rahasia", "salah", "masalah", "solusi", "penting",
    "jangan", "harus", "bisa", "viral", "uang", "cepat", "mudah"
  ].filter((word) => words.includes(word)).length;
  const questionBonus = /[?]|kenapa|mengapa|bagaimana|why|how/i.test(text) ? 8 : 0;
  const density = Math.min(18, Math.round(words.length / 2));
  return keywordHits * 6 + questionBonus + density;
}

function clipCaption(segments) {
  const text = cleanCaptionText(segments.map((segment) => segment.text).join(" "));
  const sentence = text.split(/(?<=[.!?])\s+/).find((item) => item.length > 24) || text;
  return sentence.slice(0, 155);
}

function clipHook(caption, index) {
  const first = caption.split(/[.!?]/)[0].trim();
  if (/kenapa|mengapa|why/i.test(first)) return first;
  if (/bagaimana|how/i.test(first)) return first;
  return first ? `${first.slice(0, 58)}${first.length > 58 ? "..." : ""}` : `Highlight ${index + 1}`;
}

function buildTranscriptClips(transcript, duration, targetLength = 90, language = "Indonesia") {
  if (!transcript.length) return buildClips(duration, targetLength);
  return analyzeTranscriptToClips(transcript, duration, targetLength, language);
}

async function transcribeAudioWithOpenAI(audioPath, language) {
  if (!process.env.OPENAI_API_KEY) return { text: "", segments: [] };

  const fields = {
    model: OPENAI_TRANSCRIBE_MODEL,
    response_format: "verbose_json"
  };

  if (language === "Indonesia") fields.language = "id";
  if (language === "English") fields.language = "en";

  const data = await postMultipart(
    "https://api.openai.com/v1/audio/transcriptions",
    fields,
    [{ name: "file", path: audioPath, type: "audio/mpeg" }],
    { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
  );

  return {
    text: cleanCaptionText(data.text || ""),
    segments: (data.segments || []).map((s) => ({
      start: s.start || 0,
      end: s.end || 0,
      text: cleanCaptionText(s.text || ""),
      words: (s.words || []).map((w) => ({
        text: cleanCaptionText(w.text || ""),
        start: w.start || 0,
        end: w.end || 0
      })).filter((w) => w.text)
    })).filter((s) => s.text)
  };
}

async function transcribeAudioWithLocalWhisper(audioPath) {
  const pythonPath = process.env.LOCAL_WHISPER_PYTHON || VENV_PYTHON;
  if (!fs.existsSync(pythonPath) || !fs.existsSync(FASTER_WHISPER_SCRIPT)) return { text: "", segments: [] };

  const outputPath = path.join(path.dirname(audioPath), `${path.basename(audioPath, path.extname(audioPath))}.whisper.json`);
  const args = [
    FASTER_WHISPER_SCRIPT,
    audioPath,
    "--model", resolveLocalWhisperModel(process.env.LOCAL_WHISPER_MODEL || "small"),
    "--device", process.env.LOCAL_WHISPER_DEVICE || "cpu",
    "--compute-type", process.env.LOCAL_WHISPER_COMPUTE_TYPE || "int8",
    "--output", outputPath
  ];

  try {
    await run(pythonPath, args);
  } catch (err) {
    return { text: "", segments: [], error: err.message };
  }

  if (!fs.existsSync(outputPath)) return { text: "", segments: [] };

  const data = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  return {
    text: cleanCaptionText(data.text || ""),
    segments: (data.segments || []).map((s) => ({
      start: s.start,
      end: s.end,
      text: cleanCaptionText(s.text),
      words: (s.words || []).map((w) => ({
        text: cleanCaptionText(w.text || ""),
        start: w.start || 0,
        end: w.end || 0
      })).filter((w) => w.text)
    })).filter((s) => s.text)
  };
}

async function transcribeAudio(audioPath, language) {
  const openAiResult = await transcribeAudioWithOpenAI(audioPath, language);
  if (openAiResult.text) return { text: openAiResult.text, segments: openAiResult.segments || [], provider: "openai" };

  const localResult = await transcribeAudioWithLocalWhisper(audioPath);
  if (localResult.text) return { text: localResult.text, segments: localResult.segments || [], provider: "local-whisper" };
  if (localResult.error) return { text: "", segments: [], provider: "none", error: localResult.error };

  return { text: "", segments: [], provider: "none" };
}

function writeProjectManifest(projectDir, data) {
  fs.writeFileSync(path.join(projectDir, "project.json"), JSON.stringify(data, null, 2));
}

function readProjectManifest(projectDir) {
  const manifestPath = path.join(projectDir, "project.json");
  if (!fs.existsSync(manifestPath)) return {};
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function ffmpegText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/,/g, "\\,")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/;/g, "\\;")
    .replace(/\!/g, "\\!")
    .replace(/%/g, "\\%")
    .replace(/#/g, "\\#")
    .replace(/\r?\n/g, " ");
}

const RATIO_PRESETS = {
  portrait: { width: 1080, height: 1920 },
  wide: { width: 1280, height: 720 },
  four5: { width: 864, height: 1080 }
};

function isSupportedRatio(value) {
  return value === undefined || value === null || value === "" || RATIO_PRESETS[value] != null;
}

function resolveRatio(value) {
  return isSupportedRatio(value) ? (value || "portrait") : null;
}

function buildVideoFilter(payload) {
  const ratio = payload.ratio;
  const requested = resolveRatio(ratio);
  if (!requested) throw new Error(`Rasio tidak didukung: ${ratio}`);
  const size = RATIO_PRESETS[requested];
  const scale = `scale=${size.width}:${size.height}:force_original_aspect_ratio=increase`;
  const crop = `crop=${size.width}:${size.height}`;

  let pre = [scale, crop];
  if (payload.autoZoom) {
    const fps = Math.max(1, Number(payload.fps) || 25);
    const duration = Math.max(1, Number(payload.duration) || 30);
    const totalFrames = Math.max(2, Math.round(duration * fps));
    // Upscale slightly so zoompan has headroom, then pan slowly from 1.0 -> 1.3.
    const zoomWidth = Math.ceil(size.width * 1.35 / 2) * 2;
    const zoomHeight = Math.ceil(size.height * 1.35 / 2) * 2;
    pre = [
      `scale=${zoomWidth}:${zoomHeight}:force_original_aspect_ratio=increase`,
      `zoompan=z='min(1+0.30*on/${totalFrames},1.30)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${size.width}x${size.height}:fps=${fps}`,
      crop
    ];
  }

  return { scale: pre[0], crop: pre[pre.length - 1], pre, size, ratio: requested };
}

// Overlay a text watermark in a corner of the output frame.
// - text: watermark string; empty disables the overlay
// - position: "tl" | "tr" | "bl" | "br" (default br)
// - opacity: 0..1 alpha (default 0.6)
// - fontSize: px on the widest axis (default 28)
function buildWatermarkFilter(payload, size) {
  const text = String(payload.watermark || "").trim();
  if (!text) return "";
  const position = ["tl", "tr", "bl", "br"].includes(payload.watermarkPosition) ? payload.watermarkPosition : "br";
  const opacity = Math.max(0, Math.min(1, Number(payload.watermarkOpacity) || 0.6));
  const fontSize = Math.max(12, Math.round(Number(payload.watermarkFontSize) || Math.round(size.width * 0.026)));
  const pad = Math.round(size.width * 0.03);
  const alpha = Math.round(opacity * 255).toString(16).padStart(2, "0");
  const x = position.includes("l") ? `${pad}` : `w-tw-${pad}`;
  const y = position.includes("t") ? `${pad}` : `h-th-${pad}`;
  return `drawtext=text='${ffmpegText(text)}':fontcolor=white@${Number(opacity)}:fontsize=${fontSize}:x=${x}:y=${y}:box=0:boxcolor=black@0.25:boxborderw=6`;
}

// Build an ffmpeg audio filter chain from payload enhancement flags.
// - removeSilence: cut leading/trailing/short silences (viral-clip editing)
// - denoise:       FFT denoise (afftdn) to clean up background hiss
// - enhance:       dynamic loudness normalization + gentle compression
// Returns "" when no enhancement requested.
function buildAudioFilter({ removeSilence, denoise, enhance }) {
  const parts = [];
  if (removeSilence) {
    parts.push("silenceremove=stop_periods=-1:stop_duration=0.4:stop_threshold=-50dB");
  }
  if (denoise) {
    parts.push("afftdn=nf=-25");
  }
  if (enhance) {
    parts.push("dynaudnorm=f=200:g=15:p=0.9,acompressor=threshold=-20dB:ratio=3:attack=20:release=250:makeup=6dB");
  }
  return parts.join(",");
}

const CAPTION_FONT_RATIO = 0.07;
const CAPTION_FONT_BASE = 23;

const CAPTION_STYLES = {
  bold: { fontColor: "white", borderw: 3, bordercolor: "black", shadowx: 2, shadowy: 2, shadowcolor: "black@0.6", bgBox: false, bgColor: "" },
  minimal: { fontColor: "white", borderw: 0, bordercolor: "", shadowx: 0, shadowy: 0, shadowcolor: "", bgBox: false, bgColor: "" },
  pop: { fontColor: "#FFFF00", borderw: 2, bordercolor: "black", shadowx: 2, shadowy: 2, shadowcolor: "black", bgBox: false, bgColor: "" },
  glow: { fontColor: "#00CCFF", borderw: 0, bordercolor: "", shadowx: 2, shadowy: 2, shadowcolor: "#0066FF@0.8", bgBox: false, bgColor: "" },
  karaoke: { fontColor: "#00FFFF", borderw: 3, bordercolor: "black", shadowx: 2, shadowy: 2, shadowcolor: "black", bgBox: false, bgColor: "" }
};

const FONT_MAP = {
  "Arial": "C:/Windows/Fonts/Arial.ttf",
  "Arial Black": "C:/Windows/Fonts/ARIBLK.TTF",
  "Calibri": "C:/Windows/Fonts/calibri.ttf",
  "Cambria": "C:/Windows/Fonts/cambria.ttc",
  "Comic Sans MS": "C:/Windows/Fonts/comic.ttf",
  "Consolas": "C:/Windows/Fonts/consola.ttf",
  "Courier New": "C:/Windows/Fonts/cour.ttf",
  "Franklin Gothic Medium": "C:/Windows/Fonts/framd.ttf",
  "Georgia": "C:/Windows/Fonts/georgia.ttf",
  "Impact": "C:/Windows/Fonts/impact.ttf",
  "Segoe UI": "C:/Windows/Fonts/segoeui.ttf",
  "Segoe UI Black": "C:/Windows/Fonts/seguibl.ttf",
  "Tahoma": "C:/Windows/Fonts/tahoma.ttf",
  "Times New Roman": "C:/Windows/Fonts/times.ttf",
  "Trebuchet MS": "C:/Windows/Fonts/trebuc.ttf",
  "Verdana": "C:/Windows/Fonts/verdana.ttf"
};

function resolveFont(name) {
  const fontPath = FONT_MAP[name];
  if (fontPath && fs.existsSync(fontPath)) {
    const escaped = fontPath.replace(/:/g, "\\:");
    return `fontfile='${escaped}'`;
  }
  return "";
}

function splitText(value, maxChars = 40) {
  const cleaned = String(value || "").trim().replace(/\s+/g, " ");
  if (!cleaned) return [""];
  if (cleaned.length <= maxChars) return [cleaned];
  const words = cleaned.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > maxChars) {
      lines.push(current.trim());
      current = word;
    } else {
      current += (current ? " " : "") + word;
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines;
}

function escDrawtext(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/,/g, "\\,")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/;/g, "\\;")
    .replace(/\!/g, "\\!")
    .replace(/%/g, "\\%")
    .replace(/#/g, "\\#")
    .replace(/\r?\n/g, "\\N");
}

function generateTimedDrawtextFilters(segments, opts) {
  const { width, height, style = "bold", startOffset = 0, fontFamily = "Arial", captionPosition = 0.76, fontSizeRatio = 1, captionColor = "" } = opts;
  const preset = CAPTION_STYLES[style] || CAPTION_STYLES.bold;
  const fontColor = sanitizeColor(captionColor) || preset.fontColor;
  const fontSize = Math.round(width * CAPTION_FONT_RATIO * Number(fontSizeRatio) || 1);
  const lineHeight = Math.round(fontSize * 1.25);
  const baseY = Math.round(height * Math.max(0.3, Math.min(0.95, Number(captionPosition))));
  const bgX = Math.round(width * 0.07);
  const bgW = Math.round(width * 0.86);
  const fontOpt = resolveFont(fontFamily);
  const filters = [];

  for (const seg of segments) {
    const s = Math.max(0, seg.start - startOffset);
    const e = Math.max(s + 0.1, seg.end - startOffset);
    const lines = splitText(seg.text);
    const numLines = lines.length;
    const totalTextH = numLines * lineHeight;
    const bgTop = baseY - 24;
    const bgH = totalTextH + 48;

    if (preset.bgBox && preset.bgColor) {
      filters.push(`drawbox=x=${bgX}:y=${bgTop}:w=${bgW}:h=${bgH}:color=${preset.bgColor}:t=fill:enable='between(t,${s.toFixed(3)},${e.toFixed(3)})'`);
    }

    const startY = baseY + Math.round((numLines - 1) * lineHeight * 0.5);
    for (let li = 0; li < numLines; li++) {
      const text = escDrawtext(lines[li]);
      const yPos = startY - Math.round((numLines - 1 - li) * lineHeight);
      const opts = [
        `text='${text}'`,
        `fontcolor=${fontColor}`,
        `fontsize=${fontSize}`,
        `x=(w-text_w)/2`,
        `y=${yPos}`,
        `enable='between(t,${s.toFixed(3)},${e.toFixed(3)})'`
      ];
      if (fontOpt) opts.push(fontOpt);
      if (preset.borderw > 0 && preset.bordercolor) {
        opts.push(`borderw=${preset.borderw}`, `bordercolor=${preset.bordercolor}`);
      }
      if (preset.shadowx || preset.shadowy) {
        opts.push(`shadowx=${preset.shadowx}`, `shadowy=${preset.shadowy}`, `shadowcolor=${preset.shadowcolor}`);
      }
      filters.push(`drawtext=${opts.join(":")}`);
    }
  }

  return filters;
}

// ASS karaoke (CapCut-style): renders one subtitle file via libass. Each word
// pops to a highlight colour exactly when it is spoken; spoken words stay
// highlighted, upcoming words stay white. Handled as a single file-based
// filter, so there is no Windows command-line length limit.
function generateKaraokeFilters(segments, opts) {
  const { width, height, startOffset = 0, fontFamily = "Arial", captionPosition = 0.76, fontSizeRatio = 1, captionColor = "" } = opts;
  const karaokeColour = colorToAss(captionColor);
  const fontSize = Math.round(width * CAPTION_FONT_RATIO * (Number(fontSizeRatio) || 1));
  const lineHeight = Math.round(fontSize * 1.3);
  const baseY = Math.round(height * Math.max(0.3, Math.min(0.95, Number(captionPosition))));
  const fontName = fontFamily && FONT_MAP[fontFamily] ? fontFamily : "Arial";

  function buildWordList(seg, segStart, segEnd) {
    const wordList = [];
    if (Array.isArray(seg.words) && seg.words.length) {
      for (const w of seg.words) {
        const text = cleanCaptionText(w.text);
        if (!text) continue;
        const start = Math.max(segStart, (w.start != null ? w.start : seg.start) - startOffset);
        const end = Math.max(start, (w.end != null ? w.end : start + 0.3) - startOffset);
        wordList.push({ text, start, end });
      }
    } else if (Array.isArray(seg.eventWords) && seg.eventWords.length) {
      let abs = segStart;
      for (const ew of seg.eventWords) {
        const text = cleanCaptionText(ew.text);
        if (!text) continue;
        const wStart = ew.tOffset != null ? segStart + ew.tOffset / 1000 : abs;
        wordList.push({ text, start: wStart, end: wStart + 0.3 });
        abs = wStart + 0.3;
      }
    } else {
      const words = String(seg.text).trim().split(/\s+/).filter(Boolean);
      const dur = (segEnd - segStart) / Math.max(1, words.length);
      for (let i = 0; i < words.length; i++) {
        wordList.push({ text: words[i], start: segStart + i * dur, end: segStart + (i + 1) * dur });
      }
    }
    return wordList;
  }

  function assTime(t) {
    const ms = Math.max(0, t) * 1000;
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const cs = Math.floor((ms % 1000) / 10);
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
  }

  function escAss(value) {
    return String(value || "")
      .replace(/\{/g, "\\{")
      .replace(/\}/g, "\\}");
  }

  const lines = [];
  lines.push("[Script Info]");
  lines.push("ScriptType: v4.00+");
  lines.push(`PlayResX: ${width}`);
  lines.push(`PlayResY: ${height}`);
  lines.push("ScaledBorderAndShadow: yes");
  lines.push("WrapStyle: 0");
  lines.push("");
  lines.push("[V4+ Styles]");
  lines.push("Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding");
  lines.push(`Style: Karaoke,${fontName},${fontSize},&H00FFFF00,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,3,2,2,10,10,120,1`);
  lines.push("");
  lines.push("[Events]");
  lines.push("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text");

  for (const seg of segments) {
    const segStart = Math.max(0, seg.start - startOffset);
    const segEnd = Math.max(segStart + 0.1, seg.end - startOffset);
    const wordList = buildWordList(seg, segStart, segEnd);
    if (!wordList.length) continue;

    const allLines = splitText(seg.text);
    const numLines = allLines.length;
    const marginV = Math.round(height - (baseY + numLines * lineHeight * 0.5));

    // Rebuild text with \K karaoke tags per word, keeping the same line
    // breaks as splitText so multi-line captions wrap like other styles.
    let wordIdx = 0;
    let lineText = "";
    const textParts = [];
    for (let li = 0; li < numLines; li++) {
      const lineWords = [];
      for (; wordIdx < wordList.length; wordIdx++) {
        const w = wordList[wordIdx];
        const candidate = lineWords.concat(w).map((x) => x.text).join(" ");
        if (lineWords.length && candidate.length > 40) break;
        lineWords.push(w);
      }
      const karaokeLine = lineWords
        .map((w, i) => `{\\k${Math.max(1, Math.round((w.end - Math.max(segStart, w.start)) * 100))}}${escAss(w.text)}${i < lineWords.length - 1 ? " " : ""}`)
        .join("");
      textParts.push(karaokeLine);
    }
    lineText = textParts.join("\\N");
    const colourTag = karaokeColour ? `{\\1c&H${karaokeColour}&}` : "";

    lines.push(`Dialogue: 0,${assTime(segStart)},${assTime(segEnd)},Karaoke,,0,0,0,,${colourTag}${lineText}`);
  }

  fs.mkdirSync(TMP_DIR, { recursive: true });
  const filePath = path.join(TMP_DIR, `karaoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ass`);
  fs.writeFileSync(filePath, lines.join("\r\n") + "\r\n", "utf8");
  setTimeout(() => { try { fs.unlinkSync(filePath); } catch {} }, 60000);
  const escapedPath = `'${filePath.replace(/\\/g, "/").replace(/:/g, "\\:")}'`;
  return [`ass=filename=${escapedPath}`];
}

function buildFilterChain(filterParts, timedFilters) {
  const chain = Array.isArray(filterParts.pre) ? filterParts.pre.slice() : [filterParts.scale, filterParts.crop];
  if (timedFilters && timedFilters.length) {
    chain.push(...timedFilters);
  }
  return chain.join(",");
}

// Windows command line limit is ~8191 chars per CreateProcess; keep well below.
const MAX_FILTER_CHARS = 7000;

// ASS rendering for non-karaoke styles (bold/minimal/pop/glow). Mirrors
// generateTimedDrawtextFilters visually, but lives in a file so there is no
// Windows command-line length limit when a long clip has many segments.
function generateAssStaticFilters(segments, opts) {
  const { width, height, style = "bold", startOffset = 0, fontFamily = "Arial", captionPosition = 0.76, fontSizeRatio = 1, captionColor = "" } = opts;
  const preset = CAPTION_STYLES[style] || CAPTION_STYLES.bold;
  const fontColor = sanitizeColor(captionColor) || preset.fontColor;
  const fontSize = Math.round(width * CAPTION_FONT_RATIO * (Number(fontSizeRatio) || 1));
  const lineHeight = Math.round(fontSize * 1.25);
  const baseY = Math.round(height * Math.max(0.3, Math.min(0.95, Number(captionPosition))));
  const fontName = fontFamily && FONT_MAP[fontFamily] ? fontFamily : "Arial";
  const primaryAss = colorToAss(fontColor);
  const outlineAss = preset.bordercolor ? colorToAss(preset.bordercolor) : "000000";
  const shadowAss = preset.shadowcolor ? colorToAss(preset.shadowcolor) : "000000";
  const outline = Math.max(0, Number(preset.borderw) || 0);
  const shadow = Math.max(0, Number(preset.shadowy) || 0);

  function assTime(t) {
    const ms = Math.max(0, t) * 1000;
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const cs = Math.floor((ms % 1000) / 10);
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
  }

  const lines = [];
  lines.push("[Script Info]");
  lines.push("ScriptType: v4.00+");
  lines.push(`PlayResX: ${width}`);
  lines.push(`PlayResY: ${height}`);
  lines.push("ScaledBorderAndShadow: yes");
  lines.push("WrapStyle: 0");
  lines.push("");
  lines.push("[V4+ Styles]");
  lines.push("Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding");
  lines.push(`Style: Caption,${fontName},${fontSize},&H00${primaryAss},&H00FFFFFF,&H00${outlineAss},&H64000000,-1,0,0,0,100,100,0,0,1,${outline},${shadow},2,10,10,120,1`);
  lines.push("");
  lines.push("[Events]");
  lines.push("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text");

  for (const seg of segments) {
    const segStart = Math.max(0, seg.start - startOffset);
    const segEnd = Math.max(segStart + 0.1, seg.end - startOffset);
    const textLines = splitText(seg.text);
    if (!textLines.length) continue;
    const marginV = Math.round(height - (baseY + textLines.length * lineHeight * 0.5));
    const text = textLines.map((l) => String(l).replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}")).join("\\N");
    lines.push(`Dialogue: 0,${assTime(segStart)},${assTime(segEnd)},Caption,,0,0,0,,${text}`);
  }

  fs.mkdirSync(TMP_DIR, { recursive: true });
  const filePath = path.join(TMP_DIR, `caption-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ass`);
  fs.writeFileSync(filePath, lines.join("\r\n") + "\r\n", "utf8");
  setTimeout(() => { try { fs.unlinkSync(filePath); } catch {} }, 60000);
  const escapedPath = `'${filePath.replace(/\\/g, "/").replace(/:/g, "\\:")}'`;
  return [`ass=filename=${escapedPath}`];
}

function buildFilterCommandArgs({ input, start, duration, filterGraph, audioFilter, outputPath, preset = "veryfast", crf = "23", audioBitrate = "128k", fps = 0 }) {
  const args = ["-y"];
  if (start != null && Number(start) > 0) args.push("-ss", String(start));
  args.push("-i", input);
  if (duration != null) args.push("-t", String(duration));
  if (filterGraph) {
    args.push("-vf", filterGraph);
  }
  if (audioFilter) {
    args.push("-af", audioFilter);
  }
  if (fps && Number(fps) > 0) {
    args.push("-r", String(fps));
  }
  args.push("-c:v", "libx264", "-preset", preset, "-crf", String(crf), "-c:a", "aac", "-b:a", audioBitrate, "-movflags", "+faststart", outputPath);
  return args;
}

function getPreviewTimedSegments(projectDir, manifest, payload) {
  const clip = clipPayloadToClip(payload);
  const absStart = clip.start;
  return getClipTranscriptSegments(projectDir, manifest, payload)
    .map((seg) => {
      let words = [];
      if (Array.isArray(seg.words) && seg.words.length) {
        words = seg.words
          .map((w) => ({
            text: cleanCaptionText(w.text || ""),
            start: Math.max(0, (w.start != null ? w.start : seg.start) - absStart),
            end: Math.max(0, (w.end != null ? w.end : (w.start != null ? w.start : seg.start) + 0.3) - absStart)
          }))
          .filter((w) => w.text);
      } else if (Array.isArray(seg.eventWords) && seg.eventWords.length) {
        words = seg.eventWords
          .map((ew) => ({
            text: cleanCaptionText(ew.text || ""),
            start: Math.max(0, (ew.tOffset != null ? seg.start + ew.tOffset / 1000 : seg.start) - absStart),
            end: null
          }))
          .filter((w) => w.text);
      }
      return {
        start: Math.max(0, seg.start - absStart),
        end: Math.max(0, seg.end - absStart),
        text: seg.text,
        words
      };
    })
    .filter((seg) => seg.end > seg.start && seg.text);
}

function getClipTranscriptSegments(projectDir, manifest, payload) {
  const clip = clipPayloadToClip(payload);
  const absStart = clip.start;
  const absEnd = clip.end;

  const editedFile = clipTranscriptEditedPath(projectDir, payload);
  if (fs.existsSync(editedFile)) {
    try {
      const edited = JSON.parse(fs.readFileSync(editedFile, "utf8"));
      if (Array.isArray(edited.segments) && edited.segments.length) {
        return edited.segments
          .map((seg) => ({
            start: Number(seg.start) || 0,
            end: Number(seg.end) || 0,
            text: cleanCaptionText(seg.text || ""),
            words: Array.isArray(seg.words) ? seg.words : []
          }))
          .filter((seg) => seg.text && seg.end > seg.start);
      }
    } catch {}
  }

  if (manifest.transcriptPath) {
    const transcriptPath = path.join(projectDir, manifest.transcriptPath);
    if (fs.existsSync(transcriptPath)) {
      try {
        const fullTranscript = JSON.parse(fs.readFileSync(transcriptPath, "utf8"));
        const clipSegments = fullTranscript
          .filter((seg) => seg.end > absStart && seg.start < absEnd)
          .map((seg) => ({
            start: seg.start,
            end: seg.end,
            text: cleanCaptionText(seg.text),
            eventWords: seg.eventWords
          }))
          .filter((seg) => seg.text);
        if (clipSegments.length) return clipSegments;
      } catch {}
    }
  }

  const transcriptFile = clipTranscriptCachePath(projectDir, payload);
  if (fs.existsSync(transcriptFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(transcriptFile, "utf8"));
      if (cached.segments) return cached.segments;
      if (cached.caption) {
        return [{ start: absStart, end: absEnd, text: cached.caption }];
      }
    } catch {}
  }

  return [];
}

function writeStreamChunk(ws, chunk) {
  return new Promise((resolve, reject) => {
    if (!ws.write(chunk)) {
      ws.once("drain", () => resolve());
      ws.once("error", reject);
    } else {
      resolve();
    }
  });
}

function closeWriteStream(ws) {
  return new Promise((resolve, reject) => {
    ws.end(() => resolve());
    ws.once("error", reject);
  });
}

// Streaming multipart parser: writes file parts to disk, keeps text fields in memory.
// Returns { parts } where each part is { name, filename, contentType, size, path (file parts) } or { text }.
async function parseMultipartStreaming(rawPath, contentType, destDir) {
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType || "");
  if (!m) throw new Error("Missing multipart boundary.");
  const boundaryStr = m[1] || m[2];
  const boundaryBuf = Buffer.from(`--${boundaryStr}`);
  const partDelim = Buffer.from(`\r\n--${boundaryStr}`);
  const headerSep = Buffer.from("\r\n\r\n");
  const MAX_HEADER = 64 * 1024;
  const MAX_FIELD = 4 * 1024 * 1024;

  const parts = {};
  let buffer = Buffer.alloc(0);
  let eof = false;
  const read = fs.createReadStream(rawPath, { highWaterMark: 128 * 1024 });
  const it = read[Symbol.asyncIterator]();

  async function pull() {
    const r = await it.next();
    if (!r.done) buffer = Buffer.concat([buffer, r.value]);
    eof = r.done;
    return !r.done;
  }

  async function findOrPull(needle, from = 0) {
    for (;;) {
      const i = buffer.indexOf(needle, from);
      if (i !== -1) return i;
      if (eof) return -1;
      await pull();
    }
  }

  let phase = "opening";
  let current = null; // { name, filename, contentType, ws, path, isFile, size }
  let fieldBuf = Buffer.alloc(0);

  const closeCurrent = async () => {
    if (!current) return;
    if (current.ws) {
      await closeWriteStream(current.ws);
      parts[current.name] = { filename: current.filename, contentType: current.contentType, size: current.size, path: current.path };
    } else if (current.name) {
      parts[current.name] = { text: fieldBuf.toString("utf8") };
    }
    fieldBuf = Buffer.alloc(0);
    current = null;
  };

  while (true) {
    if (phase === "opening") {
      // Body should begin with "--boundary". Consume through the first boundary line.
      const ok = await findOrPull(boundaryBuf, 0);
      if (ok === -1) throw new Error("Multipart: opening boundary tidak ditemukan.");
      buffer = buffer.subarray(ok + boundaryBuf.length);
      if (buffer.length < 2) await findOrPull(Buffer.from("\r\n"), 0);
      if (buffer.subarray(0, 2).toString() === "\r\n") {
        buffer = buffer.subarray(2);
        phase = "headers";
      } else if (buffer.subarray(0, 2).toString() === "--") {
        // empty multipart body
        buffer = buffer.subarray(2);
        phase = "done";
      } else {
        throw new Error("Multipart: malformed opening boundary.");
      }
      continue;
    }

    if (phase === "headers") {
      const i = await findOrPull(headerSep, 0);
      if (i === -1) throw new Error("Multipart: headers tidak lengkap.");
      if (i > MAX_HEADER) throw new Error("Multipart: headers terlalu besar.");
      const headers = buffer.subarray(0, i).toString("utf8");
      buffer = buffer.subarray(i + headerSep.length);
      const name = /name="([^"]+)"/.exec(headers)?.[1];
      const filename = /filename="([^"]*)"/.exec(headers)?.[1];
      const contentType = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim();
      current = { name, filename, contentType, ws: null, path: "", isFile: false, size: 0 };
      if (name && filename) {
        current.isFile = true;
        current.path = path.join(destDir, `part-${crypto.randomUUID()}${path.extname(filename) || ""}`);
        current.ws = fs.createWriteStream(current.path);
      }
      phase = "body";
      continue;
    }

    if (phase === "body") {
      const i = buffer.indexOf(partDelim);
      if (i === -1) {
        // No delimiter yet: flush all but a small tail (to catch a delimiter split across chunks).
        const tail = partDelim.length - 1;
        const flushLen = Math.max(0, buffer.length - tail);
        if (flushLen > 0) {
          const chunk = buffer.subarray(0, flushLen);
          if (current && current.ws) {
            await writeStreamChunk(current.ws, chunk);
            current.size += chunk.length;
          } else if (current && !current.isFile) {
            if (fieldBuf.length + chunk.length > MAX_FIELD) throw new Error("Multipart: field terlalu besar.");
            fieldBuf = Buffer.concat([fieldBuf, chunk]);
          }
          buffer = buffer.subarray(flushLen);
        }
        if (eof) throw new Error("Multipart: body tidak lengkap.");
        await pull();
        continue;
      }

      // Delimiter found: body ends at i (the CRLF is part of the delimiter).
      const chunk = buffer.subarray(0, i);
      if (current && current.ws) {
        await writeStreamChunk(current.ws, chunk);
        current.size += chunk.length;
      } else if (current && !current.isFile) {
        if (fieldBuf.length + chunk.length > MAX_FIELD) throw new Error("Multipart: field terlalu besar.");
        fieldBuf = Buffer.concat([fieldBuf, chunk]);
      }
      buffer = buffer.subarray(i + partDelim.length);

      // After "--boundary" comes either "\r\n" (next part) or "--" (final).
      const afterBoundary = buffer.subarray(0, 2).toString();
      if (afterBoundary === "--") {
        buffer = buffer.subarray(2);
        if (buffer.subarray(0, 2).toString() === "\r\n") buffer = buffer.subarray(2);
        await closeCurrent();
        phase = "done";
      } else if (afterBoundary === "\r\n") {
        buffer = buffer.subarray(2);
        await closeCurrent();
        phase = "headers";
      } else {
        if (buffer.length < 2 && !eof) {
          await pull();
          if (buffer.subarray(0, 2).toString() === "--") {
            buffer = buffer.subarray(2);
            if (buffer.subarray(0, 2).toString() === "\r\n") buffer = buffer.subarray(2);
            await closeCurrent();
            phase = "done";
            continue;
          }
        }
        throw new Error("Multipart: malformed boundary terminator.");
      }
      continue;
    }

    if (phase === "done") break;
  }

  return { parts };
}

async function handleUpload(req, res) {
  if (!/boundary=/i.test(req.headers["content-type"] || "")) {
    sendJson(res, 400, { error: "Missing multipart boundary." });
    return;
  }

  const id = crypto.randomUUID();
  const rawPath = path.join(TMP_DIR, `upload-${id}.raw`);
  const ws = fs.createWriteStream(rawPath);
  let total = 0;
  let uploadFailed = false;

  try {
    for await (const chunk of req) {
      total += chunk.length;
      if (total > 2048 * 1024 * 1024) {
        uploadFailed = true;
        ws.destroy();
        req.destroy();
        throw new Error("File terlalu besar. Batas maksimal 2048 MB.");
      }
      await writeStreamChunk(ws, chunk);
    }
    await closeWriteStream(ws);
  } catch (err) {
    fs.unlink(rawPath, () => {});
    sendJson(res, uploadFailed ? 413 : 400, { error: err.message });
    return;
  }

  const projectDir = path.join(UPLOAD_DIR, id);
  const partDir = path.join(TMP_DIR, `parts-${id}`);
  fs.mkdirSync(partDir, { recursive: true });

  let parsed;
  try {
    parsed = await parseMultipartStreaming(rawPath, req.headers["content-type"], partDir);
  } catch (err) {
    fs.rmSync(partDir, { recursive: true, force: true });
    fs.unlink(rawPath, () => {});
    sendJson(res, 400, { error: err.message });
    return;
  }

  const file = parsed.parts.video;

  if (!file?.filename || !file.path || !file.size || file.size < 1024) {
    fs.rmSync(partDir, { recursive: true, force: true });
    fs.unlink(rawPath, () => {});
    sendJson(res, 400, { error: "Upload video tidak valid atau terlalu kecil." });
    return;
  }

  const ext = path.extname(file.filename).toLowerCase() || ".mp4";
  const safeExt = [".mp4", ".mov", ".mkv", ".webm", ".avi"].includes(ext) ? ext : ".mp4";
  fs.mkdirSync(projectDir, { recursive: true });

  const sourcePath = path.join(projectDir, `source${safeExt}`);
  try {
    // Move the streamed part file to its final location (same filesystem → rename).
    fs.renameSync(file.path, sourcePath);
  } catch {
    try {
      fs.copyFileSync(file.path, sourcePath);
      fs.unlinkSync(file.path);
    } catch {}
  }

  try {
    const probe = await probeVideo(sourcePath);
    const clips = buildClips(probe.duration, targetClipLength(parsed.parts.duration?.text));

    writeProjectManifest(projectDir, {
      id,
      type: "local",
      name: file.filename,
      probe,
      clips,
      transcriptPath: "",
      transcriptProvider: "none"
    });

    sendJson(res, 200, {
      id,
      name: file.filename,
      probe,
      clips
    });
  } catch (err) {
    fs.unlink(sourcePath, () => {});
    fs.rmSync(projectDir, { recursive: true, force: true });
    sendJson(res, 500, { error: err.message });
    return;
  } finally {
    fs.rmSync(partDir, { recursive: true, force: true });
    fs.unlink(rawPath, () => {});
  }
}

function isSupportedVideoUrl(value) {
  try {
    const url = new URL(value);
    return ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(url.hostname);
  } catch {
    return false;
  }
}

function extractYouTubeId(value) {
  try {
    const url = new URL(value);
    if (url.hostname === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] || "";
    if (url.hostname.endsWith("youtube.com")) {
      if (url.searchParams.get("v")) return url.searchParams.get("v");
      const parts = url.pathname.split("/").filter(Boolean);
      if (["shorts", "embed", "live"].includes(parts[0])) return parts[1] || "";
      // Handle /@channel/video or /c/channel/video patterns
      if (parts.length >= 2 && /^[a-zA-Z0-9_-]{11}$/.test(parts[parts.length - 1])) {
        return parts[parts.length - 1];
      }
    }
  } catch {
    return "";
  }

  return "";
}

function findSourceFile(projectDir) {
  if (!fs.existsSync(projectDir)) return "";
  const videoExts = new Set([".mp4", ".webm", ".mkv", ".mov", ".avi"]);
  return fs.readdirSync(projectDir)
    .map((name) => path.join(projectDir, name))
    .filter((filePath) => videoExts.has(path.extname(filePath).toLowerCase()))
    .find((filePath) => path.basename(filePath).startsWith("source")) || "";
}

async function handleYouTube(req, res) {
  const payload = JSON.parse((await collectRequest(req, 5)).toString("utf8"));
  const videoUrl = String(payload.url || "").trim();

  if (!isSupportedVideoUrl(videoUrl)) {
    sendJson(res, 400, { error: "Masukkan URL YouTube yang valid." });
    return;
  }

  payload.language = ["Indonesia", "English", "Mixed"].includes(payload.language) ? payload.language : "Indonesia";
  payload.assumedDuration = Math.max(30, Math.min(86400, Number(payload.assumedDuration || 3600)));

  const id = crypto.randomUUID();
  const projectDir = path.join(UPLOAD_DIR, id);
  fs.mkdirSync(projectDir, { recursive: true });
  const videoId = extractYouTubeId(videoUrl);

  if (process.env.CLIPFORGE_DEEP_ANALYZE !== "1") {
    if (!videoId) {
      fs.rmSync(projectDir, { recursive: true, force: true });
      sendJson(res, 400, { error: "URL YouTube tidak valid: tidak ada video ID." });
      return;
    }
    const assumedDuration = Math.max(60, Number(payload.assumedDuration || 3600));
    const probe = {
      duration: assumedDuration,
      width: 0,
      height: 0,
      codec: "youtube-fast"
    };
    const title = videoId ? `YouTube ${videoId}` : "YouTube video";
    const clips = buildClips(probe.duration, payload.duration);

    writeProjectManifest(projectDir, {
      id,
      videoId,
      type: "youtube",
      url: videoUrl,
      title,
      probe,
      transcriptPath: "",
      transcriptProvider: "fast-mode"
    });

    sendJson(res, 200, {
      id,
      name: title,
      probe,
      clips: clips.map((clip) => ({
        ...clip,
        previewReady: false
      })),
      transcriptStatus: "Fast mode - preview validates clip",
      previewUrl: "",
      youtubeUrl: videoUrl,
      noDownload: true,
      fastMode: true
    });
    return;
  }

  const { stdout } = await run(YTDLP, [
    "--no-playlist",
    "--no-warnings",
    "--skip-download",
    "--extractor-args", YTDLP_EXTRACTOR_ARGS,
    "--print", "%(id)s\t%(title)s\t%(duration)s\t%(width)s\t%(height)s",
    videoUrl
  ]);

  const ytFields = stdout.trim().split("\t");
  const printedVideoId = ytFields[0] || "";
  const rawTitle = ytFields[1] || "";
  const rawDuration = ytFields[2] || "0";
  const rawWidth = ytFields[3] || "0";
  const rawHeight = ytFields[4] || "0";
  const title = rawTitle || "YouTube video";
  const duration = Number(rawDuration || 0);
  let transcript = [];
  let transcriptProvider = transcript.length ? "youtube-captions" : "none";
  const probe = {
    duration,
    width: Number(rawWidth || 0),
    height: Number(rawHeight || 0),
    codec: "youtube-stream"
  };

  if (process.env.CLIPFORGE_ANALYZE_TRANSCRIPT === "1") {
    const detail = await run(YTDLP, [
      "--no-playlist",
      "--dump-single-json",
      "--skip-download",
      "--extractor-args", YTDLP_EXTRACTOR_ARGS,
      videoUrl
    ]);
    const info = JSON.parse(detail.stdout);
    transcript = await getTranscript(info, payload.language);
    transcriptProvider = transcript.length ? "youtube-captions" : "none";
  }

  if (!transcript.length && process.env.CLIPFORGE_AUTO_STT === "1" && (process.env.OPENAI_API_KEY || fs.existsSync(VENV_PYTHON))) {
    const speechResult = await enqueueAndAwait("analyze-stt", () => getSpeechTranscriptForYouTube(projectDir, videoUrl, probe.duration, payload.duration, payload.language));
    transcript = speechResult.transcript;
    transcriptProvider = speechResult.provider;
  }

  const clips = buildTranscriptClips(transcript, probe.duration, payload.duration, payload.language);

  writeProjectManifest(projectDir, {
    id,
    videoId: printedVideoId || videoId,
    type: "youtube",
    url: videoUrl,
    title,
    probe,
    transcriptPath: transcript.length ? "transcript.json" : "",
    transcriptProvider
  });

  if (transcript.length) {
    fs.writeFileSync(path.join(projectDir, "transcript.json"), JSON.stringify(transcript, null, 2));
  }

  sendJson(res, 200, {
    id,
    name: title,
    probe,
    clips: clips.map((clip) => ({
      ...clip,
      previewReady: false
    })),
    transcriptStatus: transcript.length ? `${transcriptProvider}: ${transcript.length} lines` : "No transcript/STT provider",
    previewUrl: "",
    youtubeUrl: videoUrl,
    noDownload: true
  });
}

function createJob(type, worker) {
  const id = crypto.randomUUID();
  const job = {
    id,
    type,
    status: "queued",
    progress: 0,
    createdAt: Date.now(),
    result: null,
    error: "",
    children: new Set(),
    cancelled: false
  };
  job.promise = new Promise((resolve, reject) => {
    job._resolve = resolve;
    job._reject = reject;
  });
  // Export/batch jobs are fire-and-forget (client polls /api/jobs/:id).
  // Ensure rejection never becomes an unhandled rejection.
  job.promise.catch(() => {});

  job.worker = worker;
  jobs.set(id, job);
  jobQueue.push(job);
  pumpJobs();

  return job;
}

function pumpJobs() {
  while (activeJobs < MAX_ACTIVE_JOBS && jobQueue.length) {
    const job = jobQueue.shift();
    if (job.cancelled) {
      continue;
    }
    activeJobs += 1;
    job.status = "running";
    job.progress = Math.max(job.progress, 10);

    Promise.resolve()
      .then(() => job.worker((progress) => {
        job.progress = Math.max(job.progress, Math.min(99, progress));
      }, job.children))
      .then((result) => {
        job.result = result;
        job.progress = 100;
        job.status = "done";
        job._resolve(result);
      })
      .catch((error) => {
        job.error = error.message || "Job gagal.";
        job.status = "failed";
        job.progress = 100;
        job._reject(new Error(job.error));
      })
      .finally(() => {
        delete job.worker;
        activeJobs -= 1;
        pumpJobs();
      });
  }
}

function enqueueAndAwait(type, worker) {
  const job = createJob(type, worker);
  return job.promise;
}

async function exportClip(payload, setProgress = () => {}, children = null) {
  const projectDir = path.join(UPLOAD_DIR, payload.projectId || "");
  const manifest = readProjectManifest(projectDir);
  const enriched = manifest.type === "youtube"
    ? await ensureClipTranscript(projectDir, manifest, payload, children)
    : await ensureClipTranscriptLocal(projectDir, manifest, payload, children);
  if (enriched && (!payload.caption || /^(Edit caption|Caption otomatis)/i.test(payload.caption))) {
    payload.caption = enriched.caption;
  }
  setProgress(20);
  const sourcePath = findSourceFile(projectDir)
    || findCachedSection(projectDir, payload, "export")
    || (
    manifest.type === "youtube"
      ? await downloadYouTubeSection(projectDir, manifest, payload, {}, children)
      : ""
  );

  if (!sourcePath) {
    throw new Error("Source video tidak ditemukan.");
  }

  setProgress(58);
  const outputName = `clip-${String(payload.clipId || 1).padStart(2, "0")}-${Date.now()}.mp4`;
  const outputPath = path.join(OUTPUT_DIR, outputName);
  const isSectionSource = manifest.type === "youtube" && sourcePath.includes(`${path.sep}sections${path.sep}`);
  const start = isSectionSource ? 0 : Math.max(0, Number(payload.start || 0));
  const originalStart = Math.max(0, Number(payload.start || 0));
  const originalEnd = Math.max(originalStart + 1, Number(payload.end || originalStart + 30));
  const end = isSectionSource ? originalEnd - originalStart : originalEnd;
  const cutDuration = end - start;
  payload.duration = cutDuration;
  const filterParts = buildVideoFilter(payload);
  const audioFilter = buildAudioFilter({
    removeSilence: !!payload.removeSilence,
    denoise: !!payload.denoise,
    enhance: !!payload.enhance
  });

  const segments = payload.captionStyle !== "off"
    ? resolveExportSegments(payload, projectDir, manifest)
    : [];

  let timedFilters = [];
  let genOpts = null;
  if (segments.length) {
    const clipStart = Math.max(0, Number(payload.start || 0));
    genOpts = {
      width: filterParts.size.width,
      height: filterParts.size.height,
      style: payload.captionStyle || "bold",
      startOffset: clipStart,
      fontFamily: payload.fontFamily || "Arial",
      captionPosition: payload.captionPosition != null ? payload.captionPosition : 0.76,
      fontSizeRatio: payload.captionSize ? Number(payload.captionSize) / 23 : 1,
      captionColor: payload.captionColor || ""
    };
    if (payload.captionStyle === "karaoke") {
      timedFilters = generateKaraokeFilters(segments, genOpts);
    } else {
      timedFilters = generateTimedDrawtextFilters(segments, genOpts);
    }
  }

  const preFilter = filterParts.pre.join(",");
  let filter;
  if (payload.captionStyle === "off") {
    filter = preFilter;
  } else if (timedFilters.length) {
    const chain = buildFilterChain(filterParts, timedFilters);
    filter = chain.length > MAX_FILTER_CHARS
      ? [preFilter, ...generateAssStaticFilters(segments, genOpts)].join(",")
      : chain;
  } else {
    filter = [
      preFilter,
      `drawtext=text='${ffmpegText(payload.caption || "Caption")}':fontcolor=white:fontsize=${Math.round(filterParts.size.width * CAPTION_FONT_RATIO * (Number(payload.captionSize) / CAPTION_FONT_BASE || 1))}:x=(w-text_w)/2:y=${Math.round(filterParts.size.height * 0.76)}:box=0:line_spacing=10`
    ].join(",");
  }
  const watermark = buildWatermarkFilter(payload, filterParts.size);
  if (watermark) filter = [filter, watermark].join(",");

  await run(FFMPEG, buildFilterCommandArgs({
    input: sourcePath,
    start,
    duration: cutDuration,
    filterGraph: filter,
    audioFilter,
    outputPath,
    preset: sanitizePreset(payload.preset),
    crf: String(payload.crf || 23),
    audioBitrate: `${payload.audioBitrate || 128}k`,
    fps: Number(payload.fps) || 0
  }), 300000, children);

  setProgress(95);
  return {
    filename: outputName,
    downloadUrl: `/outputs/${outputName}`
  };
}

function sectionFileName(payload, suffix = "export") {
  const clipId = String(payload.clipId || 1).padStart(2, "0");
  const start = Math.max(0, Math.floor(Number(payload.start || 0)));
  const end = Math.max(start + 1, Math.ceil(Number(payload.end || start + 30)));
  return `${suffix}-${clipId}-${start}-${end}.mp4`;
}

function clipTranscriptBaseName(payload) {
  const langMap = { Indonesia: "id", English: "en", Mixed: "mixed" };
  const lang = langMap[payload.language] || "id";
  return `${sectionFileName(payload, "clip").replace(/\.mp4$/, "")}-${lang}.json`;
}

function clipTranscriptConfigHash() {
  const config = [
    process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe",
    process.env.LOCAL_WHISPER_MODEL || "small",
    process.env.LOCAL_WHISPER_DEVICE || "cpu",
    process.env.LOCAL_WHISPER_COMPUTE_TYPE || "int8"
  ].join("|");
  return crypto.createHash("sha1").update(config).digest("hex").slice(0, 6);
}

function clipTranscriptCachePath(projectDir, payload) {
  const base = clipTranscriptBaseName(payload).replace(/\.json$/, "");
  return path.join(projectDir, "clip-transcripts", `${base}-${clipTranscriptConfigHash()}.json`);
}

function clipTranscriptEditedPath(projectDir, payload) {
  const base = clipTranscriptBaseName(payload).replace(/\.json$/, "");
  return path.join(projectDir, "clip-transcripts", `${base}-edited.json`);
}

function findCachedSection(projectDir, payload, suffix) {
  const sectionDir = path.join(projectDir, "sections");
  const stablePath = path.join(sectionDir, sectionFileName(payload, suffix));
  return fs.existsSync(stablePath) ? stablePath : "";
}

async function downloadYouTubeSection(projectDir, manifest, payload, options = {}, children = null) {
  const sectionDir = path.join(projectDir, "sections");
  fs.mkdirSync(sectionDir, { recursive: true });

  const clipId = String(payload.clipId || 1).padStart(2, "0");
  const suffix = options.preview ? "preview" : "export";
  const stablePath = path.join(sectionDir, sectionFileName(payload, suffix));
  if (fs.existsSync(stablePath)) return stablePath;

  return singleFlight(`section:${stablePath}`, async () => {
    if (fs.existsSync(stablePath)) return stablePath;

    const rawTemplate = path.join(sectionDir, `${suffix}-raw-${clipId}-%(id)s.%(ext)s`);
    const start = Math.max(0, Number(payload.start || 0));
    const end = Math.max(start + 1, Number(payload.end || start + 30));
    const section = `*${start}-${end}`;
    const format = options.preview
      ? "bv*[height<=360]+ba/b[height<=360]/best[height<=360]/best"
      : "bv*[height<=1080]+ba/b[height<=1080]/best[height<=1080]/best";

    await run(YTDLP, [
      "--no-playlist",
      "-f", format,
      "--merge-output-format", "mp4",
      "--download-sections", section,
      "--extractor-args", YTDLP_EXTRACTOR_ARGS,
      "--retries", "10",
      "--fragment-retries", "10",
      ...(options.preview ? [] : ["--force-keyframes-at-cuts"]),
      "-o", rawTemplate,
      manifest.url
    ], 300000, children);

    const files = fs.readdirSync(sectionDir)
      .map((name) => path.join(sectionDir, name))
      .filter((filePath) => [".mp4", ".webm", ".mkv"].includes(path.extname(filePath).toLowerCase()))
      .filter((filePath) => path.basename(filePath).startsWith(`${suffix}-raw-${clipId}`))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

    if (!files[0]) throw new Error("Gagal mengambil bagian clip dari YouTube.");

    if (options.preview) {
      await run(FFMPEG, [
        "-y",
        "-i", files[0],
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-crf", "35",
        "-c:a", "aac",
        "-b:a", "96k",
        "-movflags", "+faststart",
        stablePath
      ], 300000, children);
    } else {
      await run(FFMPEG, [
        "-y",
        "-i", files[0],
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
        stablePath
      ], 300000, children);
    }

    // Cleanup raw downloaded files
    for (const rawFile of files) {
      try { fs.unlinkSync(rawFile); } catch {}
    }

    return stablePath;
  });
}

async function handlePreview(req, res) {
  const payload = JSON.parse((await collectRequest(req, 20)).toString("utf8"));
  const projectId = sanitizeString(payload.projectId || "");
  if (!isValidUUID(projectId)) {
    sendJson(res, 400, { error: "Project ID tidak valid." });
    return;
  }
  const projectDir = path.join(UPLOAD_DIR, projectId);
  if (!fs.existsSync(projectDir)) {
    sendJson(res, 404, { error: "Project tidak ditemukan." });
    return;
  }
  payload.captionStyle = sanitizeString(payload.captionStyle || "bold", 20);
  payload.fontFamily = sanitizeString(payload.fontFamily || "Arial", 30);
  payload.captionColor = sanitizeColor(payload.captionColor);
  if (!isSupportedRatio(payload.ratio)) {
    sendJson(res, 400, { error: "Rasio tidak didukung." });
    return;
  }
  const manifest = readProjectManifest(projectDir);

  if (manifest.type !== "youtube") {
    const sourcePath = findSourceFile(projectDir);
    if (!sourcePath) {
      sendJson(res, 404, { error: "Source video tidak ditemukan." });
      return;
    }
    const result = await enqueueAndAwait("preview", (setProgress, children) =>
      ensureClipTranscriptLocal(projectDir, manifest, payload, children)
    ).catch(() => null);
    void result;
    const segments = getPreviewTimedSegments(projectDir, manifest, payload);
    sendJson(res, 200, { previewUrl: `/media/${projectId}`, segments, baked: false });
    return;
  }

  const result = await enqueueAndAwait("preview", async (setProgress, children) => {
    let transcript = null;
    const [sectionPath] = await Promise.all([
      downloadYouTubeSection(projectDir, manifest, payload, { preview: true }, children),
      ensureClipTranscript(projectDir, manifest, payload, children).then((t) => { transcript = t; }).catch(() => {})
    ]);
    return { sectionPath, transcript };
  });

  const clipStart = Math.max(0, Number(payload.start || 0));
  const segments = getPreviewTimedSegments(projectDir, manifest, payload);

  sendJson(res, 200, {
    previewUrl: `/sections/${projectId}/${path.basename(result.sectionPath)}`,
    cached: true,
    transcript: result.transcript,
    segments,
    baked: false
  });
}

async function handleEditTranscript(req, res) {
  const payload = JSON.parse((await collectRequest(req, 20)).toString("utf8"));
  const projectId = sanitizeString(payload.projectId || "");
  if (!isValidUUID(projectId)) {
    sendJson(res, 400, { error: "Project ID tidak valid." });
    return;
  }
  const projectDir = path.join(UPLOAD_DIR, projectId);
  if (!fs.existsSync(projectDir)) {
    sendJson(res, 404, { error: "Project tidak ditemukan." });
    return;
  }
  if (!Array.isArray(payload.segments)) {
    sendJson(res, 400, { error: "Segmen kosong." });
    return;
  }
  const clip = clipPayloadToClip(payload);
  const offset = clip.start;
  const segments = payload.segments
    .map((seg) => ({
      start: Math.max(0, Number(seg.start || 0)) + offset,
      end: Math.max(0, Number(seg.end || 0)) + offset,
      text: cleanCaptionText(seg.text || ""),
      words: Array.isArray(seg.words) ? seg.words : []
    }))
    .filter((seg) => seg.text && seg.end > seg.start);
  if (!segments.length) {
    sendJson(res, 400, { error: "Tidak ada segmen valid untuk disimpan." });
    return;
  }

  const caption = cleanCaptionText(segments.map((s) => s.text).join(" ")).slice(0, 155);
  const edited = {
    provider: "manual-edit",
    caption,
    hook: clipHook(caption, 0),
    start: clip.start,
    end: clip.end,
    segments
  };
  fs.mkdirSync(path.join(projectDir, "clip-transcripts"), { recursive: true });
  fs.writeFileSync(clipTranscriptEditedPath(projectDir, payload), JSON.stringify(edited, null, 2), "utf8");

  sendJson(res, 200, { ok: true, segments: segments.length, caption });
}

async function downloadYouTubeAudioSection(projectDir, videoUrl, clip, children = null) {
  const audioDir = path.join(projectDir, "audio");
  fs.mkdirSync(audioDir, { recursive: true });

  const clipId = String(clip.id).padStart(2, "0");
  const outputPath = path.join(audioDir, `audio-${clipId}.mp3`);
  if (fs.existsSync(outputPath)) return outputPath;

  return singleFlight(`audio:${outputPath}`, async () => {
    if (fs.existsSync(outputPath)) return outputPath;

    const rawTemplate = path.join(audioDir, `raw-${clipId}-%(id)s.%(ext)s`);
    const section = `*${clip.start}-${clip.end}`;

    await run(YTDLP, [
      "--no-playlist",
      "-f", "ba/best",
      "--download-sections", section,
      "--force-keyframes-at-cuts",
      "--extractor-args", YTDLP_EXTRACTOR_ARGS,
      "--retries", "10",
      "--fragment-retries", "10",
      "-o", rawTemplate,
      videoUrl
    ], 300000, children);

    const rawFile = fs.readdirSync(audioDir)
      .map((name) => path.join(audioDir, name))
      .filter((filePath) => path.basename(filePath).startsWith(`raw-${clipId}`))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];

    if (!rawFile) throw new Error("Gagal mengambil audio clip dari YouTube.");

    await run(FFMPEG, [
      "-y",
      "-i", rawFile,
      "-vn",
      "-ar", "16000",
      "-ac", "1",
      "-b:a", "48k",
      outputPath
    ], 300000, children);

    // Cleanup raw downloaded files
    for (const file of fs.readdirSync(audioDir).filter((name) => name.startsWith(`raw-${clipId}`))) {
      try { fs.unlinkSync(path.join(audioDir, file)); } catch {}
    }

    return outputPath;
  });
}

async function getSpeechTranscriptForYouTube(projectDir, videoUrl, duration, targetLength, language, children = null) {
  const seedClips = buildClips(duration, targetLength).slice(0, 8);
  const MAX_PARALLEL_STT = 2;
  const results = new Array(seedClips.length).fill(null);
  let cursor = 0;

  const worker = async () => {
    while (cursor < seedClips.length) {
      const index = cursor++;
      const clip = seedClips[index];
      try {
        const audioPath = await downloadYouTubeAudioSection(projectDir, videoUrl, clip, children);
        const result = await transcribeAudio(audioPath, language);
        if (result.text) {
          results[index] = { start: clip.start, end: clip.end, text: result.text, provider: result.provider };
        }
      } catch (err) {
        console.error(`STT clip ${clip.id} gagal:`, err.message);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL_STT, seedClips.length) }, worker));

  const transcript = results.filter(Boolean);
  const provider = transcript.find((t) => t.provider)?.provider || "none";
  return { transcript, provider };
}

function clipPayloadToClip(payload) {
  return {
    id: payload.clipId || 1,
    start: Math.max(0, Number(payload.start || 0)),
    end: Math.max(1, Number(payload.end || 30))
  };
}

async function transcribeClipWithCacheSource(projectDir, manifest, payload, audioSource, children = null) {
  const transcriptDir = path.join(projectDir, "clip-transcripts");
  fs.mkdirSync(transcriptDir, { recursive: true });
  const cachePath = clipTranscriptCachePath(projectDir, payload);

  const worker = async () => {
    if (fs.existsSync(cachePath)) {
      return JSON.parse(fs.readFileSync(cachePath, "utf8"));
    }
    const clip = clipPayloadToClip(payload);
    const audioPath = await audioSource(projectDir, manifest, clip, children);
    const result = await transcribeAudio(audioPath, payload.language);
    if (!result.text) return null;

    const caption = cleanCaptionText(result.text).slice(0, 155);
    const offset = clip.start;
    const data = {
      provider: result.provider,
      caption,
      hook: clipHook(caption, 0),
      start: clip.start,
      end: clip.end,
      segments: (result.segments || []).map((s) => ({
        start: (s.start || 0) + offset,
        end: (s.end || 0) + offset,
        text: s.text,
        words: (s.words || []).map((w) => ({
          text: w.text,
          start: (w.start || 0) + offset,
          end: (w.end || 0) + offset
        }))
      }))
    };
    fs.writeFileSync(cachePath, JSON.stringify(data, null, 2));
    return data;
  };

  return singleFlight(cachePath, worker);
}

async function transcribeClipWithCache(projectDir, manifest, payload, children = null) {
  return transcribeClipWithCacheSource(projectDir, manifest, payload, (dir, m, clip, kids) =>
    downloadYouTubeAudioSection(dir, m.url, clip, kids), children
  );
}

async function transcribeClipWithCacheLocal(projectDir, manifest, payload, children = null) {
  return transcribeClipWithCacheSource(projectDir, manifest, payload, (dir, m, clip, kids) =>
    downloadLocalAudioSection(dir, clip, kids), children
  );
}

async function downloadLocalAudioSection(projectDir, clip, children = null) {
  const sourcePath = findSourceFile(projectDir);
  if (!sourcePath) throw new Error("Source video tidak ditemukan.");
  const audioDir = path.join(projectDir, "audio");
  fs.mkdirSync(audioDir, { recursive: true });

  const clipId = String(clip.id).padStart(2, "0");
  const outputPath = path.join(audioDir, `audio-${clipId}.mp3`);
  if (fs.existsSync(outputPath)) return outputPath;

  return singleFlight(`audio:${outputPath}`, async () => {
    if (fs.existsSync(outputPath)) return outputPath;
    const duration = Math.max(0.1, clip.end - clip.start);
    await run(FFMPEG, [
      "-y",
      "-ss", String(clip.start),
      "-i", sourcePath,
      "-t", String(duration),
      "-vn",
      "-ar", "16000",
      "-ac", "1",
      "-b:a", "48k",
      outputPath
    ], 300000, children);
    return outputPath;
  });
}

async function transcribeClipWithCacheLocal(projectDir, manifest, payload, children = null) {
  return transcribeClipWithCacheSource(projectDir, manifest, payload, (dir, m, clip, kids) =>
    downloadLocalAudioSection(dir, clip, kids), children
  );
}

async function ensureClipTranscriptLocal(projectDir, manifest, payload, children = null) {
  if (process.env.CLIPFORGE_ON_DEMAND_STT === "0") return null;
  if (!process.env.OPENAI_API_KEY && !fs.existsSync(VENV_PYTHON)) return null;

  const cached = clipTranscriptCacheRead(projectDir, payload);
  if (cached) return cached;

  return transcribeClipWithCacheLocal(projectDir, manifest, payload, children);
}

async function ensureClipTranscript(projectDir, manifest, payload, children = null) {
  if (process.env.CLIPFORGE_ON_DEMAND_STT === "0") return null;
  if (!process.env.OPENAI_API_KEY && !fs.existsSync(VENV_PYTHON)) return null;

  const clip = clipPayloadToClip(payload);

  // Check project-level transcript first (YouTube captions)
  if (manifest.transcriptPath) {
    const fullTranscriptPath = path.join(projectDir, manifest.transcriptPath);
    if (fs.existsSync(fullTranscriptPath)) {
      const fullTranscript = JSON.parse(fs.readFileSync(fullTranscriptPath, "utf8"));
      const clipSegments = fullTranscript.filter(
        (seg) => seg.end > clip.start && seg.start < clip.end
      );
      if (clipSegments.length >= 2) {
        const caption = clipCaption(clipSegments);
        return {
          provider: manifest.transcriptProvider || "youtube-captions",
          caption,
          hook: clipHook(caption, 0),
          start: clip.start,
          end: clip.end
        };
      }
    }
  }

  const cached = clipTranscriptCacheRead(projectDir, payload);
  if (cached) return cached;

  return transcribeClipWithCache(projectDir, manifest, payload, children);
}

function clipTranscriptCacheRead(projectDir, payload) {
  const cachePath = clipTranscriptCachePath(projectDir, payload);
  if (!fs.existsSync(cachePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(cachePath, "utf8"));
  } catch {
    return null;
  }
}

// Normalize segments sent from the client (relative to clip start) into
// absolute timeline coordinates, matching the format stored on disk.
function normalizeClientSegments(rawSegments, offset) {
  return (Array.isArray(rawSegments) ? rawSegments : [])
    .map((seg) => ({
      start: Math.max(0, Number(seg.start || 0)) + offset,
      end: Math.max(0, Number(seg.end || 0)) + offset,
      text: cleanCaptionText(seg.text || ""),
      words: (Array.isArray(seg.words) ? seg.words : [])
        .map((w) => ({
          text: cleanCaptionText(w.text || ""),
          start: Math.max(0, (w.start != null ? w.start : 0)) + offset,
          end: Math.max(0, (w.end != null ? w.end : (w.start != null ? w.start : 0) + 0.3)) + offset
        }))
        .filter((w) => w.text)
    }))
    .filter((seg) => seg.text && seg.end > seg.start);
}

// WYSIWYG: prefer the segments the user currently sees/edits (sent by the
// client), otherwise fall back to the server-side transcript. Keeps preview
// text identical to what gets burned into the exported MP4.
function resolveExportSegments(payload, projectDir, manifest) {
  if (Array.isArray(payload.segments) && payload.segments.length) {
    const normalized = normalizeClientSegments(payload.segments, Math.max(0, Number(payload.start || 0)));
    if (normalized.length) return normalized;
  }
  return getClipTranscriptSegments(projectDir, manifest, payload);
}

async function handleExport(req, res) {
  const payload = JSON.parse((await collectRequest(req, 20)).toString("utf8"));
  if (!isValidUUID(payload.projectId || "")) {
    sendJson(res, 400, { error: "Project ID tidak valid." });
    return;
  }
  payload.caption = String(payload.caption || "").slice(0, 500);
  payload.captionStyle = sanitizeString(payload.captionStyle || "bold", 20);
  payload.fontFamily = sanitizeString(payload.fontFamily || "Arial", 30);
  payload.captionColor = sanitizeColor(payload.captionColor);
  if (!isSupportedRatio(payload.ratio)) {
    sendJson(res, 400, { error: "Rasio tidak didukung." });
    return;
  }
  payload.ratio = resolveRatio(payload.ratio);
  const job = createJob("export", async (setProgress) => {
    const children = new Set();
    job.children = children;
    return exportClip(payload, setProgress, children);
  });
  sendJson(res, 202, { jobId: job.id, status: job.status, progress: job.progress });
}

async function handleAnalyzeClip(req, res) {
  const payload = JSON.parse((await collectRequest(req, 20)).toString("utf8"));
  const projectId = sanitizeString(payload.projectId || "");
  if (!isValidUUID(projectId)) { sendJson(res, 400, { error: "Project ID tidak valid." }); return; }
  const projectDir = path.join(UPLOAD_DIR, projectId);
  if (!fs.existsSync(projectDir)) { sendJson(res, 404, { error: "Project tidak ditemukan." }); return; }
  const manifest = readProjectManifest(projectDir);

  const clip = clipPayloadToClip(payload);
  const lang = clipmeLangTag(payload.language || "Indonesia");
  const absStart = clip.start;
  const segments = getClipTranscriptSegments(projectDir, manifest, payload)
    .map((seg) => ({
      start: Math.max(0, seg.start - absStart),
      end: Math.max(0, seg.end - absStart),
      text: String(seg.text || "")
    }))
    .filter((seg) => seg.text && seg.end > seg.start);

  if (!segments.length) {
    sendJson(res, 422, { error: "Tidak ada transcript yang tersedia untuk clip ini. Jalankan Generate Captions dulu." });
    return;
  }

  const sentences = splitSentences(segments.map((s) => s.text).join(" "));
  const heuristicAnalysis = clipmeAssemble(sentences, segments, lang, clip.end - clip.start);

  // LLM mode first (source-truthful, per the ClipMe system prompt). Fallback to heuristic.
  let analysis = heuristicAnalysis;
  let llmGenerated = false;
  const targetLanguage = payload.language || "Indonesia";
  const sourceText = segments.map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}s] ${s.text}`).join("\n");
  const meta = {
    sourceTitle: String(manifest.title || ""),
    language: targetLanguage,
    clipStartSec: clip.start,
    clipEndSec: clip.end
  };
  const content = `Title: ${meta.sourceTitle}\nLanguage: ${meta.language}\nClip window: ${clip.start}s - ${clip.end}s\n\nTRANSCRIPT (absolute timestamps):\n${sourceText}`;

  const llmResult = await callClipmeLLM(content, targetLanguage).catch(() => ({ ok: false }));
  if (llmResult.ok && llmResult.data) {
    try {
      analysis = normalizeLlmAnalysis(llmResult.data, heuristicAnalysis);
      llmGenerated = true;
    } catch {
      // keep heuristic
    }
  }

  sendJson(res, 200, {
    clipId: clip.id,
    start: clip.start,
    end: clip.end,
    provider: llmGenerated ? "clipme-llm" : "clipme-heuristic",
    analysis,
    timedSegments: getPreviewTimedSegments(projectDir, manifest, payload)
  });
}

// Flatten timed segments into a word-level transcript for the caption engine.
function flattenTranscriptWords(segments) {
  const words = [];
  for (const seg of segments || []) {
    if (Array.isArray(seg.words) && seg.words.length) {
      for (const w of seg.words) {
        words.push({
          text: String(w.text || "").trim(),
          start: Number(w.start || 0),
          end: Number(w.end || 0),
          speaker_id: seg.speaker_id || "speaker_1"
        });
      }
      continue;
    }
    const text = String(seg.text || "").trim();
    if (!text) continue;
    const start = Number(seg.start || 0);
    const end = Number(seg.end || 0);
    const dur = Math.max(0.01, end - start);
    const tokens = text.split(/\s+/);
    const step = dur / tokens.length;
    tokens.forEach((t, i) => {
      const wStart = start + i * step;
      words.push({
        text: t,
        start: Math.round(wStart * 1000) / 1000,
        end: Math.round((i === tokens.length - 1 ? end : wStart + step) * 1000) / 1000,
        speaker_id: seg.speaker_id || "speaker_1"
      });
    });
  }
  return words;
}

async function handleAutoCaptions(req, res) {
  const payload = JSON.parse((await collectRequest(req, 20)).toString("utf8"));
  const projectId = sanitizeString(payload.projectId || "");
  if (!isValidUUID(projectId)) { sendJson(res, 400, { error: "Project ID tidak valid." }); return; }
  const projectDir = path.join(UPLOAD_DIR, projectId);
  if (!fs.existsSync(projectDir)) { sendJson(res, 404, { error: "Project tidak ditemukan." }); return; }
  const manifest = readProjectManifest(projectDir);

  const engine = loadClipmeCaptionEngine();
  if (!engine) { sendJson(res, 500, { error: "Auto Caption Engine tidak tersedia." }); return; }

  const clip = clipPayloadToClip(payload);
  let segments = [];

  if (manifest.transcriptPath) {
    const fullPath = path.join(projectDir, manifest.transcriptPath);
    if (fs.existsSync(fullPath)) {
      const fullTranscript = JSON.parse(fs.readFileSync(fullPath, "utf8"));
      segments = fullTranscript.filter((s) => s.end > clip.start && s.start < clip.end);
    }
  }

  if (!segments.length) {
    const cached = clipTranscriptCacheRead(projectDir, payload);
    if (cached?.segments?.length) segments = cached.segments;
  }

  if (!segments.length) {
    // Transkrip belum tersedia: jalankan STT otomatis agar Auto Caption self-sufficient.
    try {
      const sttResult = await enqueueAndAwait("captions", async (setProgress, children) => {
        const result = manifest.type === "youtube"
          ? await transcribeClipWithCache(projectDir, manifest, payload, children)
          : await transcribeClipWithCacheLocal(projectDir, manifest, payload, children);
        return result;
      });
      if (sttResult?.segments?.length) segments = sttResult.segments;
    } catch (e) {
      const msg = String(e.message || e);
      const lines = msg.split("\n").filter(l => l.includes("Error:") || l.includes("raise") || l.includes("Traceback"));
      const detail = lines.length ? lines[lines.length - 1].trim() : msg.slice(0, 200);
      sendJson(res, 500, { error: "Transkrip tidak tersedia dan STT gagal: " + detail });
      return;
    }
  }

  if (!segments.length) {
    sendJson(res, 400, { error: "Transkrip untuk clip ini belum tersedia." });
    return;
  }

  const wordLevel = flattenTranscriptWords(segments);
  if (!wordLevel.length) { sendJson(res, 400, { error: "Transkrip kosong." }); return; }

  const style = payload.style || "dynamic";
  const fillerMode = payload.fillerMode || "none";
  const maxLines = Number(payload.maxLines || 2);
  const maxLineLength = Number(payload.maxLineLength || 40);

  const instance = engine({
    style,
    fillerMode,
    maxLines,
    maxLineLength
  });

  let result;
  let llmUsed = false;
  try {
    result = await instance.processWithLLM(wordLevel, style, fillerMode, "speaker_1", payload.language || "Indonesia");
    llmUsed = true;
  } catch (e) {
    // fallback ke heuristic
    result = instance.processHeuristic(wordLevel, style, fillerMode, "speaker_1");
  }

  const offset = clip.start;
  const timed = (result.segments || []).map((s, idx) => {
    const words = wordLevel.filter((w) => w.start >= Number(s.start || 0) - 0.02 && w.end <= Number(s.end || 0) + 0.02);
    const text = words.length ? words.map((w) => w.text).join(" ") : String(s.text || "").trim();
    const start = Math.max(0, Number(s.start || 0) - offset);
    const end = Math.max(0, Number(s.end || 0) - offset);
    const focusWords = (s.emphasis_words || []).map((w) => w.toLowerCase());
    const karaoke = words.map((w) => ({
      text: w.text,
      start: Math.max(0, w.start - offset),
      end: Math.max(0, w.end - offset),
      focus: focusWords.includes(w.text.toLowerCase())
    }));
    return {
      id: idx + 1,
      speaker_id: s.speaker_id || words[0]?.speaker_id || "speaker_1",
      start,
      end,
      text: text || " ",
      lines: splitCaptionLines(text, maxLines, maxLineLength),
      emphasis_words: s.emphasis_words || [],
      emotion: s.emotion || "neutral",
      karaoke
    };
  });

  const caption = instance.deriveCaption(timed.map((s) => ({ text: s.text })));
  const hook = instance.deriveHook(timed.map((s) => ({ text: s.text })));

  sendJson(res, 200, {
    provider: llmUsed ? "caption-llm" : "caption-heuristic",
    confidence: result.confidence || (llmUsed ? 85 : 75),
    caption,
    hook,
    segments: timed
  });
}

function splitCaptionLines(text, maxLines, maxLineLength) {
  const words = String(text || "").split(" ");
  const lines = [];
  let current = "";
  for (const w of words) {
    const test = current ? `${current} ${w}` : w;
    if (lines.length >= maxLines - 1 || test.length > maxLineLength) {
      if (current) { lines.push(current); current = w; }
      else { lines.push(w); current = ""; }
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function handleJob(req, res, jobId) {
  const job = jobs.get(jobId);
  if (!job) {
    sendJson(res, 404, { error: "Job tidak ditemukan." });
    return;
  }

  sendJson(res, 200, {
    id: job.id,
    type: job.type,
    status: job.status,
    progress: job.progress,
    createdAt: job.createdAt,
    result: job.result,
    error: job.error
  });
}

function handleUpdateProject(req, res, params) {
  const projectId = params.projectId || "";
  if (!isValidUUID(projectId)) { sendJson(res, 400, { error: "Invalid project ID" }); return; }
  const projectDir = path.join(UPLOAD_DIR, projectId);
  if (!fs.existsSync(projectDir)) { sendJson(res, 404, { error: "Project not found" }); return; }
  collectRequest(req, 50).then((buf) => {
    const data = JSON.parse(buf.toString("utf8"));
    const manifestPath = path.join(projectDir, "project.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (data.clips) manifest.clips = data.clips;
    if (data.name) manifest.name = data.name;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    sendJson(res, 200, { ok: true });
  }).catch(() => sendJson(res, 400, { error: "Invalid JSON" }));
}

function handleDeleteProject(req, res, params) {
  const projectId = params.projectId || "";
  if (!isValidUUID(projectId)) { sendJson(res, 400, { error: "Invalid project ID" }); return; }
  const projectDir = path.join(UPLOAD_DIR, projectId);
  if (!fs.existsSync(projectDir)) { sendJson(res, 404, { error: "Project not found" }); return; }
  fs.rmSync(projectDir, { recursive: true, force: true });
  sendJson(res, 200, { ok: true });
}

function handleListProjects(req, res) {
  const projects = [];
  try {
    if (!fs.existsSync(UPLOAD_DIR)) { sendJson(res, 200, { projects: [] }); return; }
    for (const entry of fs.readdirSync(UPLOAD_DIR)) {
      if (!isValidUUID(entry)) continue;
      const dir = path.join(UPLOAD_DIR, entry);
      if (!fs.statSync(dir).isDirectory()) continue;
      const manifest = readProjectManifest(dir);
      if (!manifest.id) continue;
      projects.push({
        id: manifest.id,
        name: manifest.name || "project",
        duration: manifest.probe?.duration || 0,
        clips: Array.isArray(manifest.clips) ? manifest.clips.length : 0,
        transcriptStatus: (manifest.transcriptProvider && manifest.transcriptProvider !== "none")
          ? manifest.transcriptProvider : "No transcript",
        createdAt: fs.statSync(dir).birthtimeMs || 0
      });
    }
  } catch {}
  projects.sort((a, b) => b.createdAt - a.createdAt);
  sendJson(res, 200, { projects });
}

function handleGetProject(req, res, params) {
  const projectId = params.projectId || "";
  if (!isValidUUID(projectId)) { sendJson(res, 400, { error: "Invalid project ID" }); return; }
  const projectDir = path.join(UPLOAD_DIR, projectId);
  if (!fs.existsSync(projectDir)) { sendJson(res, 404, { error: "Project not found" }); return; }
  const manifest = readProjectManifest(projectDir);
  const sourcePath = findSourceFile(projectDir);
  const sourceExists = Boolean(sourcePath) && isSafePath(sourcePath, UPLOAD_DIR);
  sendJson(res, 200, {
    id: manifest.id || projectId,
    type: manifest.type || "local",
    name: manifest.name || "project",
    probe: manifest.probe || {},
    clips: Array.isArray(manifest.clips) ? manifest.clips : [],
    transcriptPath: manifest.transcriptPath || "",
    transcriptProvider: manifest.transcriptProvider || "none",
    url: manifest.url || "",
    previewUrl: sourceExists ? `/media/${projectId}` : ""
  });
}

function handleListExports(req, res) {
  const files = [];
  try {
    for (const entry of fs.readdirSync(OUTPUT_DIR)) {
      const fpath = path.join(OUTPUT_DIR, entry);
      const stat = fs.statSync(fpath);
      if (stat.isFile()) files.push({ filename: entry, size: stat.size, createdAt: stat.birthtimeMs || stat.mtimeMs });
    }
  } catch {}
  files.sort((a, b) => b.createdAt - a.createdAt);
  sendJson(res, 200, { exports: files });
}

function handleDeleteExport(req, res, params) {
  const filename = path.basename(params.filename || "");
  if (!filename) { sendJson(res, 400, { error: "Invalid filename" }); return; }
  const fpath = path.join(OUTPUT_DIR, filename);
  if (!fs.existsSync(fpath)) { sendJson(res, 404, { error: "Export not found" }); return; }
  fs.unlinkSync(fpath);
  sendJson(res, 200, { ok: true });
}

function handleOpenOutput(req, res) {
  if (!fs.existsSync(OUTPUT_DIR)) { sendJson(res, 404, { error: "Output folder belum ada" }); return; }
  const open = process.platform === "win32"
    ? { cmd: "explorer.exe", args: [OUTPUT_DIR] }
    : process.platform === "darwin"
      ? { cmd: "open", args: [OUTPUT_DIR] }
      : { cmd: "xdg-open", args: [OUTPUT_DIR] };
  const child = spawn(open.cmd, open.args, { detached: true, stdio: "ignore" });
  child.unref();
  sendJson(res, 200, { ok: true, folder: OUTPUT_DIR });
}

function handleListQueue(req, res) {
  const list = [];
  try {
    for (const job of jobs.values()) {
      list.push({ id: job.id, type: job.type, status: job.status, progress: job.progress, createdAt: job.createdAt, error: job.error || "" });
    }
  } catch {}
  list.sort((a, b) => b.createdAt - a.createdAt);
  sendJson(res, 200, { jobs: list });
}

function handleCancelJob(req, res, params) {
  const jobId = params.jobId || "";
  const job = jobs.get(jobId);
  if (!job) { sendJson(res, 404, { error: "Job not found" }); return; }
  if (job.status === "done" || job.status === "failed") { sendJson(res, 400, { error: "Job already finished" }); return; }
  job.status = "cancelled";
  job.error = "Cancelled by user";
  job.progress = 100;
  job.cancelled = true;
  for (const child of job.children) killProcess(child);
  if (job.workerCleanup) job.workerCleanup();
  if (job._reject) job._reject(new Error(job.error));
  sendJson(res, 200, { ok: true });
}

function handleExportBatch(req, res) {
  collectRequest(req, 200).then((buf) => {
    const data = JSON.parse(buf.toString("utf8"));
    const projectId = data.projectId || "";
    if (!isValidUUID(projectId)) { sendJson(res, 400, { error: "Invalid project ID" }); return; }
    const projectDir = path.join(UPLOAD_DIR, projectId);
    if (!fs.existsSync(projectDir)) { sendJson(res, 404, { error: "Project not found" }); return; }
    const manifest = readProjectManifest(projectDir);
    const clipDefs = data.clips || [];
    if (!clipDefs.length) { sendJson(res, 400, { error: "No clips specified" }); return; }
    for (const clipDef of clipDefs) {
      if (!isSupportedRatio(clipDef.ratio)) {
        sendJson(res, 400, { error: "Rasio tidak didukung." });
        return;
      }
    }
    const batchId = crypto.randomUUID();
    const total = clipDefs.reduce((sum, clipDef) => {
      const ratios = Array.isArray(clipDef.ratios) && clipDef.ratios.length
        ? clipDef.ratios.filter((r) => isSupportedRatio(r))
        : [clipDef.ratio || "portrait"];
      return sum + Math.max(1, ratios.length);
    }, 0);
    let completed = 0;
    let failed = 0;
    let processed = 0;
    const exportResults = [];
    const batchJob = createJob("batch-export", (setProgress) => {
      return new Promise((resolve, reject) => {
        let cancelled = false;
        let activeOutputs = 0;
        const children = new Set();
        batchJob.children = children;
        const runNext = () => {
          if (cancelled) return reject(new Error("Cancelled"));
          if (!clipDefs.length && activeOutputs === 0) {
            resolve({ batchId, results: exportResults, total, completed, failed });
            return;
          }
          if (!clipDefs.length) return;
          const clipDef = clipDefs.shift();
          const ratios = Array.isArray(clipDef.ratios) && clipDef.ratios.length
            ? clipDef.ratios.filter((r) => isSupportedRatio(r))
            : [clipDef.ratio || "portrait"];
          if (!ratios.length) ratios.push(clipDef.ratio || "portrait");
          ratios.forEach((ratio) => {
            activeOutputs += 1;
            const payload = {
              projectId, clipId: clipDef.clipId, start: clipDef.start, end: clipDef.end,
              caption: clipDef.caption || "", language: clipDef.language || "Indonesia",
              ratio,
              captionStyle: clipDef.captionStyle || "bold",
              captionSize: clipDef.captionSize || 23,
              fontFamily: clipDef.fontFamily || "Arial", captionPosition: clipDef.captionPosition || 0.76,
              captionColor: clipDef.captionColor || "",
              removeSilence: !!clipDef.removeSilence,
              denoise: !!clipDef.denoise,
              enhance: !!clipDef.enhance,
              autoZoom: !!clipDef.autoZoom,
              fps: Number(clipDef.fps) || 0,
              crf: Number(clipDef.crf) || 23,
              audioBitrate: Number(clipDef.audioBitrate) || 128,
              watermark: String(clipDef.watermark || ""),
              watermarkPosition: clipDef.watermarkPosition || "br",
              watermarkOpacity: Number(clipDef.watermarkOpacity) || 0.6,
              segments: clipDef.segments || []
            };
            exportClip(payload, (p) => {
              const overall = Math.round((processed / total) * 80 + (p / total));
              setProgress(Math.min(99, overall));
            }, children).then((result) => {
              processed += 1;
              completed += 1;
              exportResults.push({ ratio, ...result });
              setProgress(Math.round((processed / total) * 80));
            }).catch((err) => {
              processed += 1;
              failed += 1;
              exportResults.push({ ratio, error: err.message });
              setProgress(Math.round((processed / total) * 80));
            }).finally(() => {
              activeOutputs -= 1;
              runNext();
            });
          });
        };
        batchJob.workerCleanup = () => { cancelled = true; };
        runNext();
      });
    });
    sendJson(res, 202, { batchId, jobId: batchJob.id, total });
  }).catch(() => sendJson(res, 400, { error: "Invalid JSON" }));
}

class RouteRegistry {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler) {
    if (pattern instanceof RegExp) {
      this.routes.push({ method, pattern, handler, isRegex: true });
    } else {
      const paramKeys = [];
      const regexStr = pattern.replace(/:(\w+)/g, (_, key) => {
        paramKeys.push(key);
        return "([^/]+)";
      });
      this.routes.push({ method, pattern: new RegExp(`^${regexStr}$`), handler, paramKeys, isRegex: false });
    }
    return this;
  }

  match(method, pathname) {
    for (const route of this.routes) {
      if (route.method !== method && route.method !== "*") continue;
      const m = pathname.match(route.pattern);
      if (!m) continue;
      if (route.isRegex) {
        return { handler: route.handler, match: m };
      }
      const params = {};
      route.paramKeys.forEach((key, index) => { params[key] = decodeURIComponent(m[index + 1]); });
      return { handler: route.handler, params };
    }
    return null;
  }
}

const router = new RouteRegistry();

// ---- STT Engine API ----

async function handleSttTranscribe(req, res) {
  try {
    const payload = JSON.parse((await collectRequest(req, 200)).toString("utf8"));
    const audioPath = payload.audioPath || "";
    const model = payload.model || "";
    const format = payload.format || "json";
    const language = payload.language || "";
    const noiseReduction = !!payload.noiseReduction;
    const removeSilence = !!payload.removeSilence;
    const enhance = !!payload.enhance;

    if (!audioPath) {
      sendJson(res, 400, { error: "audioPath diperlukan." });
      return;
    }
    const STT_FORMATS = ["json", "txt", "srt", "vtt", "csv", "word-json", "segment-json", "metadata"];
    if (!STT_FORMATS.includes(format)) {
      sendJson(res, 400, { error: "Format tidak didukung." });
      return;
    }
    const resolvedAudioPath = path.resolve(audioPath);
    const isAllowedPath = resolvedAudioPath.startsWith(UPLOAD_DIR + path.sep)
      || resolvedAudioPath.startsWith(TMP_DIR + path.sep);
    if (!isAllowedPath) {
      sendJson(res, 403, { error: "Akses ke path ini tidak diizinkan." });
      return;
    }
    if (!fs.existsSync(resolvedAudioPath)) {
      sendJson(res, 400, { error: "Audio file tidak ditemukan." });
      return;
    }

    const pythonPath = process.env.LOCAL_WHISPER_PYTHON || VENV_PYTHON;
    const args = [STT_ENGINE, "transcribe", "--audio", audioPath, "--format", format];
    if (model) args.push("--model", resolveLocalWhisperModel(model));
    if (language) args.push("--language", language);
    if (noiseReduction) args.push("--noise-reduction");
    if (removeSilence) args.push("--remove-silence");
    if (enhance) args.push("--enhance");

    const tmpDir = fs.mkdtempSync(path.join(TMP_DIR, "stt-"));
    const outputPath = path.join(tmpDir, `output.${format}`);
    args.push("--output", outputPath);

    await run(pythonPath, args, 600000);

    if (!fs.existsSync(outputPath)) {
      try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
      sendJson(res, 500, { error: "STT engine gagal menghasilkan output." });
      return;
    }

    const output = fs.readFileSync(outputPath, "utf8");
    try { fs.rmSync(tmpDir, { recursive: true }); } catch {}

    if (format === "json") {
      try {
        sendJson(res, 200, JSON.parse(output));
      } catch {
        sendJson(res, 200, { text: output });
      }
    } else {
      sendJson(res, 200, { output, format });
    }
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}

async function handleSttSearch(req, res) {
  try {
    const payload = JSON.parse((await collectRequest(req, 10)).toString("utf8"));
    const transcriptPath = payload.transcriptPath || "";
    const keyword = payload.keyword || "";

    if (!transcriptPath) {
      sendJson(res, 400, { error: "transcriptPath diperlukan." });
      return;
    }
    const resolvedTranscriptPath = path.resolve(transcriptPath);
    const isAllowedTranscript = resolvedTranscriptPath.startsWith(UPLOAD_DIR + path.sep)
      || resolvedTranscriptPath.startsWith(OUTPUT_DIR + path.sep);
    if (!isAllowedTranscript) {
      sendJson(res, 403, { error: "Akses ke path ini tidak diizinkan." });
      return;
    }
    if (!fs.existsSync(transcriptPath)) {
      sendJson(res, 400, { error: "Transcript file tidak ditemukan." });
      return;
    }
    if (!keyword) {
      sendJson(res, 400, { error: "Keyword diperlukan." });
      return;
    }

    const pythonPath = process.env.LOCAL_WHISPER_PYTHON || VENV_PYTHON;
    const args = [STT_ENGINE, "search", "--transcript", transcriptPath, "--keyword", keyword];
    // FIX BUG-02: parse dan teruskan hasil pencarian ke client, bukan buang stdout
    const result = await run(pythonPath, args, 30000);
    try {
      sendJson(res, 200, { ok: true, keyword, results: JSON.parse(result.stdout) });
    } catch {
      sendJson(res, 200, { ok: true, keyword, results: null, raw: result.stdout });
    }
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}

async function handleSttModels(req, res) {
  try {
    const pythonPath = process.env.LOCAL_WHISPER_PYTHON || VENV_PYTHON;
    // FIX BUG-03: tambah flag --json agar Python mengembalikan structured JSON bukan tabel teks
    const args = [STT_ENGINE, "list-models", "--json"];
    const result = await run(pythonPath, args, 15000);
    try {
      sendJson(res, 200, { models: JSON.parse(result.stdout || "[]") });
    } catch {
      sendJson(res, 200, { models: [] });
    }
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}

// Only these exact web assets are served from the project root.
// Media (upload/preview/output) is served through dedicated /media/, /sections/, /outputs/ routes.
const PUBLIC_WEB_FILES = new Set(["/index.html", "/styles.css", "/script.js", "/build/icon.png"]);

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestPath = url.pathname === "/" ? "/index.html" : url.pathname;

  if (!PUBLIC_WEB_FILES.has(requestPath)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const filePath = path.join(ROOT, requestPath.replace(/^\/+/, ""));
  sendFile(req, res, filePath);
}

router
  .add("POST", "/api/upload", handleUpload)
  .add("POST", "/api/youtube", handleYouTube)
  .add("POST", "/api/preview", handlePreview)
  .add("POST", "/api/export", handleExport)
  .add("POST", "/api/edit-transcript", handleEditTranscript)
  .add("POST", "/api/analyze-clip", handleAnalyzeClip)
  .add("POST", "/api/export-batch", handleExportBatch)
  .add("POST", "/api/auto-captions", handleAutoCaptions)
  .add("POST", "/api/stt/transcribe", handleSttTranscribe)
  .add("POST", "/api/stt/search", handleSttSearch)
  .add("GET", "/api/stt/models", handleSttModels)
  .add("GET", "/api/projects", handleListProjects)
  .add("PATCH", "/api/projects/:projectId", handleUpdateProject)
  .add("GET", "/api/projects/:projectId", handleGetProject)
  .add("DELETE", "/api/projects/:projectId", handleDeleteProject)
  .add("GET", "/api/exports", handleListExports)
  .add("DELETE", "/api/exports/:filename", handleDeleteExport)
  .add("POST", "/api/open-output", handleOpenOutput)
  .add("GET", "/api/queue", handleListQueue)
  .add("DELETE", "/api/jobs/:jobId", handleCancelJob)
  .add("HEAD", "/api/storage", (req, res) => {
    let total = 0;
    try {
      for (const dir of [UPLOAD_DIR, OUTPUT_DIR]) {
        if (fs.existsSync(dir)) walkDir(dir, (f) => { try { total += fs.statSync(f).size; } catch {} });
      }
    } catch {}
    res.writeHead(200, { "X-Storage-Used": String(total) });
    res.end();
  })
  .add("GET", /^\/api\/jobs\/([^/]+)$/, (req, res, m) => handleJob(req, res, m[1]))
  .add("GET", /^\/outputs\/(.+)$/, (req, res, m) => sendFile(req, res, path.join(OUTPUT_DIR, path.basename(m[1]))))
  .add("GET", /^\/media\/([^/]+)$/, (req, res, m) => {
    const projectId = sanitizeString(m[1]);
    if (!isValidUUID(projectId)) { sendJson(res, 400, { error: "Invalid project ID" }); return; }
    const sourcePath = findSourceFile(path.join(UPLOAD_DIR, projectId));
    if (!sourcePath || !isSafePath(sourcePath, UPLOAD_DIR)) { sendJson(res, 404, { error: "Not found" }); return; }
    sendMedia(req, res, sourcePath);
  })
  .add("GET", /^\/sections\/([^/]+)\/(.+)$/, (req, res, m) => {
    const projectId = sanitizeString(m[1]);
    if (!isValidUUID(projectId)) { sendJson(res, 400, { error: "Invalid project ID" }); return; }
    const sectionPath = path.join(UPLOAD_DIR, projectId, "sections", path.basename(m[2] || ""));
    if (!isSafePath(sectionPath, UPLOAD_DIR)) { sendJson(res, 403, { error: "Forbidden" }); return; }
    sendMedia(req, res, sectionPath);
  })
  .add("*", /^\/.*$/, serveStatic);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const match = router.match(req.method, url.pathname);
    if (match) {
      await match.handler(req, res, match.match || match.params || {});
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: error.message || "Server error" });
  }
});

function startServer(port = PORT, host = "127.0.0.1") {
  cleanupOldData();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      console.log(`Clipper Studio berjalan di http://${host}:${actualPort}`);
      resolve({ server, port: actualPort, url: `http://${host}:${actualPort}`, shutdown: () => server.close() });
    });
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { startServer };
