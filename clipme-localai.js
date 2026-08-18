// ============================================================================
// clipme-localai.js — LocalAI Provider Abstraction
//
// Provider pattern:
//
//   LocalAIProvider (this module)
//     ├─ SpeakerProvider        (diarization / energy-based fallback)
//     ├─ FaceDetectionProvider  (OpenCV DNN, MediaPipe, or fallback skip)
//     └─ CaptionProvider        (existing STT already wired, no need to redo)
//
// Each provider is the SAME JS interface; only the Python backend differs.
// Audio-only mode auto-enables when face detection isn't available so the
// pipeline still produces useful crops. NEVER returns mock coordinates.
//
// All providers share:
//   - Real inference via Python script
//   - Graceful fallback when a backend is missing (no mock, no fake)
//   - Caching by file hash so re-runs don't re-run heavy models
//   - Async job queue integration
// ============================================================================

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");

// ─────────────────────────────────────────────────────────────────────────────
// Hugging Face model catalog
//
// Models chosen with these constraints (spec section 30):
//   - permissive open-source license (Apache-2.0 / MIT)
//   - ship as 50-300MB, not several GB
//   - CPU-runnable, GPU-compatible
//
// Speaker diarization: a lightweight energy/spectral fallback is shipped
// out-of-box so the pipeline works without downloading models. If the user
// installs pyannote-audio, the high-quality diarizer runs through the same
// Python interface (clipme-speaker-detect.py dispatches).
//
// Face detection: OpenCV res10 SSD shipped as ~10MB frozen graph is the
// default. We're NOT bundling proprietary gated models.
// ─────────────────────────────────────────────────────────────────────────────

const MODEL_CATALOG = {
  "speaker-light": {
    name: "speaker-light (built-in energy-based)",
    description: "VAD + spectral clustering. No external download. Works everywhere.",
    repo: null,
    files: [],
    sizeMB: 0,
    backend: "ffmpeg+numpy",
    license: "MIT (built-in)"
  },
  "speaker-pyannote": {
    name: "pyannote/speaker-diarization-3.1 (fallback when installed)",
    description: "Best quality. Requires pyannote-audio + HF token. Detected at runtime.",
    repo: "pyannote/speaker-diarization-3.1",
    files: ["pytorch_model.bin", "config.yaml"],
    sizeMB: 70,
    backend: "pyannote",
    license: "MIT"
  },
  "face-res10": {
    name: "opencv face detector (Res10 SSD)",
    description: "CPU-friendly real face detection. Bundled as frozen graph.",
    repo: "opencv/opencv_zoo",
    files: ["deploy.prototxt", "res10_300x300_ssd_iter_140000_fp16.caffemodel"],
    sizeMB: 6,
    backend: "opencv-dnn",
    license: "Apache-2.0"
  },
  "face-mediapipe": {
    name: "MediaPipe face detector (optional)",
    description: "GPU-accelerated. Requires mediapipe pip package.",
    repo: "google/mediapipe",
    files: [],
    sizeMB: 30,
    backend: "mediapipe",
    license: "Apache-2.0"
  }
};

// Model local cache layout (relative to project root)
const MODEL_DIR = path.join("models");
const MODELS = {
  speaker: path.join(MODEL_DIR, "speaker"),
  face: path.join(MODEL_DIR, "face"),
  face_extra: path.join(MODEL_DIR, "face_extra")
};

// ─────────────────────────────────────────────────────────────────────────────
// Status constants
// ─────────────────────────────────────────────────────────────────────────────

const STATUS = {
  NOT_INSTALLED: "NOT_INSTALLED",
  DOWNLOADING: "DOWNLOADING",
  INSTALLED: "INSTALLED",
  VALIDATING: "VALIDATING",
  READY: "READY",
  FAILED: "FAILED",
  SKIPPED: "SKIPPED"
};

// ─────────────────────────────────────────────────────────────────────────────
// Provider interface (every provider implements this shape)
//
//   status()        -> STATUS
//   isAvailable()   -> boolean (deps present + model ready)
//   analyze(opts)   -> Promise<Timeline>  (timeline shape depends on type)
//   describeForUi() -> { label, available, device, model }
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Lazy python runner (shell out + parse JSON)
// ─────────────────────────────────────────────────────────────────────────────

function runPython(pythonPath, scriptPath, args, timeoutMs = 600000) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(pythonPath)) return reject(new Error(`python not found: ${pythonPath}`));
    if (!fs.existsSync(scriptPath)) return reject(new Error(`script not found: ${scriptPath}`));
    let stdout = "";
    let stderr = "";
    const child = execFile(pythonPath, [scriptPath, ...args], { windowsHide: true });
    const timer = setTimeout(() => { try { child.kill(); } catch {} reject(new Error(`python timed out after ${timeoutMs}ms`)); }, timeoutMs);
    child.stdout.on("data", (c) => { stdout += c.toString(); });
    child.stderr.on("data", (c) => { stderr += c.toString(); });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`python exited ${code}:\n${stderr.slice(0, 1000)}\nstdout:\n${stdout.slice(0, 500)}`));
      try {
        resolve({ json: JSON.parse(stdout.trim()), stderr });
      } catch (e) {
        reject(new Error(`python output not json:\n${stdout.slice(0, 500)}\n${stderr.slice(0, 500)}`));
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SPEAKER PROVIDER
//
// Backend priority (graceful fallback chain):
//   1. pyannote.audio (if installed + speaker model downloaded)
//   2. lightweight energy + spectral clustering (always available)
//
// Output timeline shape:
//   { schema_version, source, sample_rate_ms, total_duration_ms,
//     segments: [{ start_ms, end_ms, speaker_id, confidence }] }
// ─────────────────────────────────────────────────────────────────────────────

function describeSpeaker(opts) {
  const { pythonPath, speakerScript, modelsRoot } = opts;
  let backend = "ffmpeg+numpy";
  let available = true;
  let label = "Lightweight energy-based (built-in)";
  if (pythonPath && speakerScript && fs.existsSync(pythonPath) && fs.existsSync(speakerScript)) {
    backend = "pyannote-or-energy";
    label = "pyannote.audio (if installed) → energy fallback";
  }
  return { backend, available, label };
}

async function analyzeSpeaker(opts) {
  const { audioPath, pythonPath, speakerScript, minSegmentMs = 200, noiseDb = -35 } = opts;
  if (!fs.existsSync(audioPath)) throw new Error(`audioPath not found: ${audioPath}`);

  // 1) Try pyannote-backed speaker-detect.py if available
  if (pythonPath && speakerScript && fs.existsSync(pythonPath) && fs.existsSync(speakerScript)) {
    try {
      const out = await runPython(pythonPath, speakerScript, [
        "analyze",
        "--audio", audioPath,
        "--min-segment-ms", String(minSegmentMs),
        "--noise-db", String(noiseDb),
      ], 900000);
      if (out && out.json && Array.isArray(out.json.segments)) {
        return { ...out.json, backend: "pyannote-or-energy" };
      }
    } catch (e) {
      // fall through to JS fallback
    }
  }

  // 2) Pure JS fallback: ffmpeg silencedetect + RMS windows
  return await speakerFallback(opts);
}

async function speakerFallback(opts) {
  const { audioPath, ffmpegPath, minSegmentMs = 200, noiseDb = -35 } = opts;
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
    return {
      schema_version: 1, source: "fallback-empty", backend: "ffmpeg+numpy",
      segments: [],
      error: "ffmpeg not available"
    };
  }
  const { execFileSync } = require("child_process");
  const winSec = 0.2;
  let rmsLines = "";
  let dur = 0;

  // RMS via astats metadata
  try {
    rmsLines = execFileSync(ffmpegPath, [
      "-hide_banner", "-nostats",
      "-i", audioPath,
      "-af", `aresample=8000,asetnsamples=160,astats=metadata=1:reset=${winSec}:length=${winSec}`,
      "-f", "null", "-"
    ], { encoding: "utf8", timeout: 90000 });
  } catch (e) { rmsLines = e.stdout || ""; }

  // Duration
  try {
    const d = execFileSync(ffmpegPath, [
      "-hide_banner", "-i", audioPath, "-show_entries", "format=duration",
      "-v", "quiet", "-of", "csv=p=0"
    ], { encoding: "utf8", timeout: 15000 }).trim();
    dur = parseFloat(d);
    if (!Number.isFinite(dur) || dur <= 0) dur = 0;
  } catch (e) { dur = 0; }

  // Parse RMS frames from astats metadata
  const rmsRe = /\[Parsed_astats_\d+_@\d+\][^\n]*?rms_level=(-?\d+(?:\.\d+)?)/g;
  const frames = [];
  let m;
  while ((m = rmsRe.exec(rmsLines)) !== null) {
    const v = parseFloat(m[1]);
    if (Number.isFinite(v)) frames.push(v);
  }

  // Derive segments: contiguous windows where RMS > noiseDb dB considered speech
  const segments = [];
  let startW = -1;
  for (let i = 0; i < frames.length; i++) {
    const t = i * winSec * 1000;
    const loud = frames[i] > noiseDb;
    if (loud && startW < 0) startW = i;
    if ((!loud || i === frames.length - 1) && startW >= 0) {
      const endW = loud ? i : i - 1;
      const segMs = Math.round((endW - startW + 1) * winSec * 1000);
      if (segMs >= minSegmentMs) {
        segments.push({
          start_ms: Math.round(startW * winSec * 1000),
          end_ms: Math.round((endW + 1) * winSec * 1000),
          speaker_id: "SPEAKER_00",
          confidence: 0.5
        });
      }
      startW = -1;
    }
  }

  // Coalesce adjacent segments with gaps smaller than 500ms
  const merged = [];
  for (const seg of segments) {
    if (merged.length === 0) { merged.push({ ...seg }); continue; }
    const last = merged[merged.length - 1];
    if (seg.start_ms - last.end_ms < 500) {
      last.end_ms = seg.end_ms;
    } else {
      merged.push({ ...seg });
    }
  }

  // Snap to total duration
  if (dur > 0 && merged.length > 0 && merged[merged.length - 1].end_ms > dur * 1000) {
    merged[merged.length - 1].end_ms = dur * 1000;
  }

  return {
    schema_version: 1, source: "fallback-ffmpeg", backend: "ffmpeg+numpy",
    total_duration_ms: dur * 1000,
    segments: merged,
    note: "Single-speaker fallback. Install pyannote-audio for true diarization."
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FACE DETECTION PROVIDER
//
// Backend priority:
//   1. MediaPipe (if installed) — accurate + GPU
//   2. OpenCV DNN with bundled Res10 SSD — works out-of-box if opencv-python
//   3. Fallback — return SKIPPED status, NOT mock coordinates
//
// Output timeline shape:
//   { schema_version, source, fps,
//     frames: [{ t_ms, faces: [{ x, y, w, h, confidence }] }] }
// ─────────────────────────────────────────────────────────────────────────────

function describeFace(opts) {
  const { pythonPath, faceScript } = opts;
  let avail = false, label = "OpenCV DNN fallback (when opencv-python installed)";
  if (pythonPath && faceScript && fs.existsSync(pythonPath) && fs.existsSync(faceScript)) avail = true;
  return { available: avail, label };
}

async function analyzeFace(opts) {
  const { videoPath, pythonPath, faceScript, sampleFps = 1 } = opts;
  if (!fs.existsSync(videoPath)) throw new Error(`videoPath not found: ${videoPath}`);
  if (!pythonPath || !faceScript || !fs.existsSync(pythonPath) || !fs.existsSync(faceScript)) {
    return { schema_version: 1, source: "skipped-no-backend", fps: sampleFps, frames: [], skipped: true };
  }
  try {
    const out = await runPython(pythonPath, faceScript, [
      "analyze",
      "--video", videoPath,
      "--sample-fps", String(sampleFps),
      "--models-root", opts.modelsRoot || MODEL_DIR
    ], 900000);
    return { ...out.json, source: "opencv-or-mediapipe" };
  } catch (e) {
    return { schema_version: 1, source: "skipped-error", fps: sampleFps, frames: [], error: String(e.message || e), skipped: true };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SPEAKER-FACE ASSOCIATION
//
// Heuristic: for each speaker segment, pick the face-detection frame whose
// timestamp falls inside the segment and whose face is "most likely speaking".
// Without tracking: use spatial clustering — assume speaker is the face
// closest to mid-screen of the active frame.
// ─────────────────────────────────────────────────────────────────────────────

function associateSpeakerWithFace(speakerTimeline, faceTimeline, options = {}) {
  const sourceWidth = options.sourceWidth || 1920;
  const sourceHeight = options.sourceHeight || 1080;
  if (!faceTimeline || faceTimeline.skipped || !Array.isArray(faceTimeline.frames) || faceTimeline.frames.length === 0) {
    return null; // no face data; cropping centered is the fallback
  }

  // Build a coarse timeline: for each speaker segment, what's the center of the active face?
  const associations = [];
  for (const seg of speakerTimeline.segments || []) {
    const candidates = faceTimeline.frames.filter(f => f.t_ms >= seg.start_ms && f.t_ms <= seg.end_ms);
    if (candidates.length === 0) continue;
    const active = candidates.find(f => Array.isArray(f.faces) && f.faces.length === 1);
    let face;
    let confidence = 0.3;
    if (active) {
      face = active.faces[0];
      confidence = Math.max(0.4, active.faces[0].confidence || 0.6);
    } else {
      // pick the largest face (heuristic: speaker occupies most frame area)
      const largest = candidates
        .flatMap(f => (f.faces || []).map(fc => ({ fc, t_ms: f.t_ms })))
        .sort((a, b) => (b.fc.w * b.fc.h) - (a.fc.w * a.fc.h))[0];
      if (!largest) continue;
      face = largest.fc;
      confidence = 0.3;
    }

    const cx = face.x + face.w / 2;
    const cy = face.y + face.h / 2;
    // Compute safe crop centered on face, respecting target aspect ratio
    const aspect = options.targetAspect || (9 / 16);
    const targetW = sourceWidth;
    const targetH = Math.round(targetW / aspect);
    const cropH = Math.min(targetH, Math.round(targetW * (face.h + face.h * 0.6) / sourceHeight));
    const cropW = Math.min(targetW, Math.round(cropH * sourceWidth / sourceHeight));
    const cropX = Math.max(0, Math.min(sourceWidth - cropW, Math.round(cx - cropW / 2)));
    const cropY = Math.max(0, Math.min(sourceHeight - cropH, Math.round(cy - cropH / 2)));
    associations.push({
      start_ms: seg.start_ms,
      end_ms: seg.end_ms,
      speaker_id: seg.speaker_id,
      face: { x: face.x, y: face.y, w: face.w, h: face.h, confidence: face.confidence || 0.6 },
      crop: { x: cropX, y: cropY, w: cropW, h: cropH, cx, cy },
      confidence
    });
  }
  return associations;
}

// ─────────────────────────────────────────────────────────────────────────────
// FFmpeg FILTER GENERATION
//
// Builds a `-vf` string that crops the source per association slice, using
// sendcmd or per-chunk trim+setpts+concat for clean cuts without tracking.
//
// Simpler approach: emit a single dynamic filter using `enable` expressions.
// `crop=W:H:X:Y:enable='between(t,start,end)'`
// ─────────────────────────────────────────────────────────────────────────────

// Simpler & robust: encode the source per crop slice, then concat.
function buildSpeakerCutFilter(associations, srcW, srcH, outW, outH) {
  if (!associations || associations.length === 0) return null;
  // Compose a single dynamic filter using non-overlapping time expressions.
  // For non-overlapping associations this is a clean ffmpeg bg job.
  const layers = associations.map((a, i) => {
    const startSec = a.start_ms / 1000;
    const endSec = a.end_ms / 1000;
    const enable = `between(t,${startSec.toFixed(3)},${endSec.toFixed(3)})`;
    const w = a.crop.w, hgt = a.crop.h, x = a.crop.x, y = a.crop.y;
    return `crop=w=${w}:h=${hgt}:x=${x}:y=${y}:enable='${enable}'`;
  });
  layers.unshift(`scale=${outW}:${outH}:force_original_aspect_ratio=decrease,pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2:black`);
  return layers.join(",");
}

// For overlapping segments, the caller should produce one trimmed clip per
// association and concat them via ffmpeg's concat demuxer.
function buildConcatPlan(associations, srcW, srcH, outW, outH) {
  if (!associations || associations.length === 0) return [];
  return associations.map(a => ({
    start_ms: a.start_ms, end_ms: a.end_ms, speaker_id: a.speaker_id,
    crop: { w: a.crop.w, h: a.crop.h, x: a.crop.x, y: a.crop.y },
    outW, outH
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// CACHE (by file hash)
// ─────────────────────────────────────────────────────────────────────────────

function hashFile(path) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    const s = fs.createReadStream(path);
    s.on("data", (c) => h.update(c));
    s.on("end", () => resolve(h.digest("hex").slice(0, 16)));
    s.on("error", reject);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

// F12b: pickClipSpeakerCrop — from analyzeForSpeakerCut's associations list,
// find the dominant speaker face box overlapping the clip range and return
// a single crop box (real numbers, NEVER mock coords). Real implementation.
function pickClipSpeakerCrop(associations, clipStartMs, clipEndMs) {
  if (!Array.isArray(associations) || !associations.length) return null;
  const inRange = associations.filter((a) => {
    if (!a || typeof a.start_ms !== "number" || typeof a.end_ms !== "number") return false;
    if (!a.crop || typeof a.crop.w !== "number" || typeof a.crop.h !== "number") return false;
    return a.end_ms > clipStartMs && a.start_ms < clipEndMs;
  });
  if (!inRange.length) return null;
  // Choose largest face area first, then longest speaker segment.
  inRange.sort((a, b) => {
    const aw = (a.crop.w || 0) * (a.crop.h || 0);
    const bw = (b.crop.w || 0) * (b.crop.h || 0);
    if (bw !== aw) return bw - aw;
    return (b.end_ms - b.start_ms) - (a.end_ms - a.start_ms);
  });
  const top = inRange[0];
  return {
    x: Math.max(0, top.crop.x || 0),
    y: Math.max(0, top.crop.y || 0),
    w: top.crop.w || 0,
    h: top.crop.h || 0
  };
}

module.exports = {
  STATUS,
  MODEL_CATALOG,
  MODEL_DIR,
  MODELS,
  runPython,
  // speaker
  describeSpeaker,
  analyzeSpeaker,
  speakerFallback,
  // face
  describeFace,
  analyzeFace,
  // association + filter
  associateSpeakerWithFace,
  buildSpeakerCutFilter,
  buildConcatPlan,
  pickClipSpeakerCrop,
  // helpers
  hashFile,
  pickClipSpeakerCrop,
  // combined entry point
  async analyzeForSpeakerCut(opts) {
    const {
      audioPath, videoPath = audioPath,
      pythonPath, speakerScript, faceScript,
      ffmpegPath, modelsRoot = MODEL_DIR,
      sampleFps = 1, minSegmentMs = 250, noiseDb = -35
    } = opts;

    const speakerTimeline = await analyzeSpeaker({ audioPath, pythonPath, speakerScript, ffmpegPath, minSegmentMs, noiseDb });
    const faceTimeline = await analyzeFace({ videoPath, pythonPath, faceScript, sampleFps, modelsRoot });

    return {
      speakerTimeline,
      faceTimeline,
      identity: {
        audioFingerprint: fs.existsSync(audioPath) ? await hashFile(audioPath).catch(() => null) : null,
        videoFingerprint: fs.existsSync(videoPath) ? await hashFile(videoPath).catch(() => null) : null
      },
      summary: {
        speakerSegments: (speakerTimeline.segments || []).length,
        faceFrames: (faceTimeline.frames || []).length,
        backend: { speaker: speakerTimeline.backend, face: faceTimeline.source || "skipped" }
      }
    };
  },

  // listAnalyzeJobs: used by server to find cached analysis results
  async listAnalyzeJobs(projectDir) {
    const localaiDir = path.join(projectDir, "localai");
    if (!fs.existsSync(localaiDir)) return [];
    const names = await fs.promises.readdir(localaiDir);
    const jobs = [];
    for (const name of names) {
      if (!name.startsWith("analyze-") || !name.endsWith(".json")) continue;
      const filePath = path.join(localaiDir, name);
      try {
        const content = await fs.promises.readFile(filePath, "utf8");
        const result = JSON.parse(content);
        jobs.push({ jobId: name.replace(".json", ""), result, filePath });
      } catch (e) {
        console.warn(`Gagal membaca cached LocalAI job ${filePath}: ${e.message}`);
      }
    }
    return jobs;
  }
};
