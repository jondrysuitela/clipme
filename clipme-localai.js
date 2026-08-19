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
// Face detection (Cut-to-Face Mode Lite): OpenCV FaceDetectorYN (YuNet from
// OpenCV Zoo, MIT) + Haar profile cascade (Apache-2.0). No proprietary/gated
// models, no cloud APIs. Download only via explicit "Download Models" button.
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
  "face-yunet": {
    name: "opencv face detector (YuNet)",
    description: "OpenCV FaceDetectorYN from OpenCV Zoo. CPU-friendly, ~340KB ONNX, offline.",
    repo: "opencv/opencv_zoo",
    files: ["face_detection_yunet_2023mar.onnx"],
    sizeMB: 1,
    backend: "opencv-yunet",
    license: "MIT"
  },
  "face-haar": {
    name: "opencv Haar profile cascade",
    description: "Detects side-facing (left/right profile) faces. Ships inside OpenCV.",
    repo: "opencv/opencv",
    files: ["haarcascade_profileface.xml"],
    sizeMB: 1,
    backend: "opencv-haar",
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
// FACE DETECTION PROVIDER (Cut-to-Face Mode Lite)
//
// Backend priority:
//   1. OpenCV FaceDetectorYN (YuNet, MIT) — front-facing, high confidence
//   2. OpenCV Haar profile cascade (Apache-2.0) — left/right profile faces
//   3. Fallback — return SKIPPED status, NOT mock coordinates
//
// Output timeline shape:
//   { schema_version, source, fps,
//     frames: [{ t_ms, faces: [{ x, y, w, h, confidence,
//                                track_id, track_confidence, mouth_motion }] }] }
// ─────────────────────────────────────────────────────────────────────────────

function describeFace(opts) {
  const { pythonPath, faceScript } = opts;
  let avail = false, label = "OpenCV YuNet + Haar (when opencv-python installed)";
  if (pythonPath && faceScript && fs.existsSync(pythonPath) && fs.existsSync(faceScript)) avail = true;
  return { available: avail, label };
}

async function analyzeFace(opts) {
  const { videoPath, pythonPath, faceScript, sampleFps = 3 } = opts;
  if (!fs.existsSync(videoPath)) throw new Error(`videoPath not found: ${videoPath}`);
  if (!pythonPath || !faceScript || !fs.existsSync(pythonPath) || !fs.existsSync(faceScript)) {
    return { schema_version: 1, source: "skipped-no-backend", fps: sampleFps, frames: [], skipped: true };
  }
  try {
    const args = [
      "analyze",
      "--video", videoPath,
      "--sample-fps", String(sampleFps),
      "--models-root", opts.modelsRoot || MODEL_DIR
    ];
    if (Number(opts.startSeconds) > 0) {
      args.push("--start-seconds", String(Number(opts.startSeconds)));
    }
    if (Number(opts.durationSeconds) > 0) {
      args.push("--duration-seconds", String(Number(opts.durationSeconds)));
    }
    const out = await runPython(pythonPath, faceScript, args, 900000);
    return { ...out.json, source: "opencv-or-mediapipe" };
  } catch (e) {
    return { schema_version: 1, source: "skipped-error", fps: sampleFps, frames: [], error: String(e.message || e), skipped: true };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SPEAKER-FACE ASSOCIATION (Cut-to-Face Mode Lite)
//
// Primary: active-speaker engine (clipme-active-speaker.js) which combines
// mouth motion, detector confidence, track confidence, speaker timeline and
// track continuity (req 6), with hysteresis (req 7), ~1.1s hold (req 8),
// look-room (req 9) and compaction to max 48 (req 10). Old caches without
// track_id (v1: x,y,w,h,confidence) are still supported (req 11).
// ─────────────────────────────────────────────────────────────────────────────

let activeSpeakerModule = null;
function loadActiveSpeaker() {
  if (activeSpeakerModule) return activeSpeakerModule;
  try {
    const p = path.join(path.dirname(__filename), "clipme-active-speaker.js");
    if (fs.existsSync(p)) activeSpeakerModule = require(p);
  } catch (e) {
    console.error("Gagal memuat clipme-active-speaker.js:", e.message);
  }
  return activeSpeakerModule;
}

// Debounce rapid speaker changes (Hysteresis)
function smoothSpeakerTimeline(segments, minDurationMs = 800) {
  if (!segments || segments.length === 0) return [];
  const smoothed = [];
  let current = { ...segments[0] };

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const dur = seg.end_ms - seg.start_ms;
    const gap = seg.start_ms - current.end_ms;

    if (dur < minDurationMs || gap < 0 || seg.speaker_id === current.speaker_id) {
      // Merge if too short, overlapping, or same speaker
      current.end_ms = Math.max(current.end_ms, seg.end_ms);
      current.confidence = (current.confidence + seg.confidence) / 2;
    } else {
      smoothed.push(current);
      current = { ...seg };
    }
  }
  smoothed.push(current);
  return smoothed;
}

function associateSpeakerWithFace(speakerTimeline, faceTimeline, options = {}) {
  const sourceWidth = options.sourceWidth || 1920;
  const sourceHeight = options.sourceHeight || 1080;
  if (!faceTimeline || faceTimeline.skipped || !Array.isArray(faceTimeline.frames) || faceTimeline.frames.length === 0) {
    return []; // fallback if no face
  }

  // Primary: active-speaker engine (track_id + mouth motion aware)
  const activeSpeaker = loadActiveSpeaker();
  if (activeSpeaker && typeof activeSpeaker.buildAssociations === "function") {
    try {
      const lite = activeSpeaker.buildAssociations(faceTimeline, speakerTimeline, {
        sourceWidth,
        sourceHeight,
        targetAspect: options.targetAspect || (9 / 16),
        lookRoom: options.lookRoom !== false,
        lookFactor: options.lookFactor
      });
      if (Array.isArray(lite) && lite.length > 0) return lite;
    } catch (e) {
      console.error("Active-speaker association gagal, fallback legacy:", e.message);
    }
  }

  const rawSegments = speakerTimeline.segments || [];
  const smoothedSegments = smoothSpeakerTimeline(rawSegments, 800); // 0.8s hysteresis

  const associations = [];
  for (const seg of smoothedSegments) {
    const candidates = faceTimeline.frames.filter(f => f.t_ms >= seg.start_ms && f.t_ms <= seg.end_ms);
    if (candidates.length === 0) continue;
    
    // Cari frame dengan wajah paling dominan di segment ini
    const active = candidates.find(f => Array.isArray(f.faces) && f.faces.length === 1);
    let face;
    let confidence = 0.3;
    if (active) {
      face = active.faces[0];
      confidence = Math.max(0.4, active.faces[0].confidence || 0.6);
    } else {
      const largest = candidates
        .flatMap(f => (f.faces || []).map(fc => ({ fc, t_ms: f.t_ms })))
        .sort((a, b) => (b.fc.w * b.fc.h) - (a.fc.w * a.fc.h))[0];
      if (!largest) continue;
      face = largest.fc;
      confidence = 0.3;
    }

    // SMART FRAMING
    const targetAspect = options.targetAspect || (9 / 16);
    
    // Fixed Crop dimensions based on source height to avoid FFmpeg crop width/height evaluation issues
    let cropH = sourceHeight;
    let cropW = Math.round(cropH * targetAspect);
    if (cropW > sourceWidth) {
      cropW = sourceWidth;
      cropH = Math.round(cropW / targetAspect);
    }

    const cx = face.x + face.w / 2;
    const cy = face.y + face.h / 2;
    
    // Headroom: Wajah di sepertiga atas (33%), bukan di tengah (50%)
    const cropX_ideal = cx - (cropW / 2);
    const cropY_ideal = cy - (cropH * 0.33);

    // Clamp to boundaries
    const cropX = Math.max(0, Math.min(sourceWidth - cropW, cropX_ideal));
    const cropY = Math.max(0, Math.min(sourceHeight - cropH, cropY_ideal));

    associations.push({
      start_ms: seg.start_ms,
      end_ms: seg.end_ms,
      speaker_id: seg.speaker_id,
      face: { x: face.x, y: face.y, w: face.w, h: face.h, confidence },
      crop: { x: Math.round(cropX), y: Math.round(cropY), w: cropW, h: cropH, cx, cy },
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
// Build FFmpeg dynamic crop filter using nested if(between(t,...), X, Y)
function buildSpeakerCutFilter(associations, srcW, srcH) {
  if (!associations || associations.length === 0) return null;
  
  // Karena FFmpeg crop w dan h dievaluasi sekali di awal, kita asumsikan 
  // semua cropW dan cropH sama (diambil dari frame height penuh).
  const w = associations[0].crop.w;
  const h = associations[0].crop.h;

  let xExpr = `(in_w-${w})/2`; // default center
  let yExpr = `(in_h-${h})/2`;

  // Build nested ifs backwards
  for (let i = associations.length - 1; i >= 0; i--) {
    const a = associations[i];
    const s = (a.start_ms / 1000).toFixed(3);
    const e = (a.end_ms / 1000).toFixed(3);
    xExpr = `if(between(t,${s},${e}),${a.crop.x},${xExpr})`;
    yExpr = `if(between(t,${s},${e}),${a.crop.y},${yExpr})`;
  }

  return `crop=${w}:${h}:'${xExpr}':'${yExpr}'`;
}

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
      sampleFps = 3, minSegmentMs = 250, noiseDb = -35,
      faceStartSeconds = 0, faceDurationSeconds = 0
    } = opts;

    const speakerTimeline = await analyzeSpeaker({ audioPath, pythonPath, speakerScript, ffmpegPath, minSegmentMs, noiseDb });
    const faceTimeline = await analyzeFace({
      videoPath,
      pythonPath,
      faceScript,
      sampleFps,
      modelsRoot,
      startSeconds: faceStartSeconds,
      durationSeconds: faceDurationSeconds
    });

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
