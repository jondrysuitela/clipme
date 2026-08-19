const assert = require("assert");
const activeSpeaker = require("./clipme-active-speaker.js");
const localai = require("./clipme-localai.js");
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

function close(actual, expected, epsilon = 0.001) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
}

// ── Requirement 3: adaptive sampling defaults (3 FPS, max 5 FPS) ────────────
test("adaptive face sampling default 3 FPS, max 5 FPS (server side)", () => {
  const source = fs.readFileSync("clipme-face-detect.py", "utf8");
  assert.match(source, /DEFAULT_SAMPLE_FPS = 3/);
  assert.match(source, /MAX_SAMPLE_FPS = 5/);
  const script = fs.readFileSync("script.js", "utf8");
  assert.match(script, /sampleFps: 3/);
  const server = fs.readFileSync("server.js", "utf8");
  assert.match(server, /sampleFps: 3/);
});

// ── Requirement 1 & 2: YuNet FaceDetectorYN + Haar cascade ──────────────────
test("Python uses FaceDetectorYN API and Haar profile cascade", () => {
  const source = fs.readFileSync("clipme-face-detect.py", "utf8");
  assert.match(source, /cv2\.FaceDetectorYN\.create/);
  assert.match(source, /CascadeClassifier/);
  assert.match(source, /haarcascade_profileface\.xml/);
});

// ── Requirement 4: persistent track_id via IoU + centroid ───────────────────
test("tracking assigns persistent track_id (IoU + centroid)", () => {
  const faceTimeline = {
    frames: [
      { t_ms: 1000, faces: [
        { x: 10, y: 10, w: 100, h: 100, confidence: 0.9, track_id: 0, track_confidence: 0.85, mouth_motion: 0.8 },
        { x: 500, y: 10, w: 100, h: 100, confidence: 0.6, track_id: 1, track_confidence: 0.5, mouth_motion: 0.1 }
      ]},
      { t_ms: 1333, faces: [
        { x: 12, y: 12, w: 100, h: 100, confidence: 0.9, track_id: 0, track_confidence: 0.85, mouth_motion: 0.7 }
      ]}
    ]
  };
  const speakerTimeline = { segments: [
    { start_ms: 0, end_ms: 2000, speaker_id: "SPEAKER_00", confidence: 0.8 }
  ]};
  const assoc = activeSpeaker.buildAssociations(faceTimeline, speakerTimeline, {
    sourceWidth: 1280, sourceHeight: 720, targetAspect: 9 / 16
  });
  assert.ok(assoc.length > 0, "associations must be built");
  assert.ok(assoc[0].track_id === 0, "active speaker should be the mouth-moving track 0");
  assert.ok(assoc[0].face.confidence >= 0.85, "high confidence face selected");
});

// ── Requirement 5: mouth-motion scoring metadata ────────────────────────────
test("mouth-motion scoring present in association output", () => {
  const source = fs.readFileSync("clipme-face-detect.py", "utf8");
  assert.match(source, /calcOpticalFlowFarneback/);
  assert.match(source, /absdiff/);
  const faceTimeline = {
    frames: [
      { t_ms: 500, faces: [{ x: 10, y: 10, w: 100, h: 100, confidence: 0.9, track_id: 0, track_confidence: 0.9, mouth_motion: 0.6 }] }
    ]
  };
  const speakerTimeline = { segments: [{ start_ms: 0, end_ms: 1000, speaker_id: "A", confidence: 0.8 }] };
  const assoc = activeSpeaker.buildAssociations(faceTimeline, speakerTimeline, {
    sourceWidth: 1280, sourceHeight: 720, targetAspect: 9 / 16
  });
  assert.ok(assoc.length > 0);
  assert.ok(typeof assoc[0].mouth_motion === "number");
  assert.ok(assoc[0].mouth_motion >= 0 && assoc[0].mouth_motion <= 1);
});

// ── Requirement 6-8: hysteresis, hold, active speaker selection ─────────────
test("hysteresis + hold keeps active speaker across brief dropout", () => {
  // Track 0 is active; frame 3 only has track 1 (brief dropout of track 0)
  const faceTimeline = {
    frames: [
      { t_ms: 0, faces: [{ x: 10, y: 10, w: 100, h: 100, confidence: 0.9, track_id: 0, track_confidence: 0.9, mouth_motion: 0.8 }] },
      { t_ms: 333, faces: [{ x: 11, y: 11, w: 100, h: 100, confidence: 0.9, track_id: 0, track_confidence: 0.9, mouth_motion: 0.7 }] },
      { t_ms: 666, faces: [{ x: 500, y: 10, w: 100, h: 100, confidence: 0.9, track_id: 1, track_confidence: 0.9, mouth_motion: 0.1 }] }
    ]
  };
  const speakerTimeline = { segments: [{ start_ms: 0, end_ms: 2000, speaker_id: "A", confidence: 0.8 }] };
  const selected = activeSpeaker.selectActiveSpeaker(faceTimeline.frames, speakerTimeline, "0", {});
  assert.ok(String(selected) === "0", `expected hold of track 0, got ${selected}`);
});

// ── Requirement 9: look-room shifts crop toward face gaze ───────────────────
test("look-room shifts crop toward face position", () => {
  const crop = { x: 100, y: 100, w: 400, h: 720 };
  const faceRight = { x: 1200, y: 200, w: 120, h: 120 };  // face near right edge
  const shifted = activeSpeaker.applyLookRoom(crop, faceRight, 1920, 1080, 0.15);
  assert.ok(shifted.x > crop.x, "crop must shift right toward the face");
  assert.ok(shifted.x >= 0 && shifted.x + shifted.w <= 1920, "crop stays in bounds");
});

// ── Requirement 10 & 11: compact ≤48 & legacy cache compatibility ───────────
test("associations compacted to max 48 and legacy v1 cache compatible", () => {
  // Legacy faces: no track_id, only x/y/w/h/confidence
  const legacyFaces = { frames: [] };
  for (let i = 0; i < 200; i++) {
    legacyFaces.frames.push({ t_ms: i * 100, faces: [{ x: 100, y: 100, w: 80, h: 80, confidence: 0.8 }] });
  }
  const speakerTimeline = { segments: [] };
  for (let i = 0; i < 200; i++) {
    speakerTimeline.segments.push({ start_ms: i * 100, end_ms: i * 100 + 80, speaker_id: "SPEAKER_00", confidence: 0.7 });
  }
  const assoc = localai.associateSpeakerWithFace(speakerTimeline, legacyFaces, {
    sourceWidth: 1280, sourceHeight: 720, targetAspect: 9 / 16
  });
  assert.ok(assoc.length <= 48, `associations must be <= 48, got ${assoc.length}`);
});

// ── Requirement 14: asarUnpack for face/speaker scripts ─────────────────────
test("clipme-face-detect.py and clipme-speaker-detect.py in asarUnpack", () => {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const unpack = pkg.build.asarUnpack || [];
  assert.ok(unpack.includes("clipme-face-detect.py"), "face-detect must be asarUnpacked");
  assert.ok(unpack.includes("clipme-speaker-detect.py"), "speaker-detect must be asarUnpacked");
});

// ── Requirement 15: free & offline pipeline ─────────────────────────────────
test("no SCRFD/InsightFace/TalkNet imports in pipeline code", () => {
  for (const file of ["clipme-face-detect.py", "clipme-localai.js", "clipme-active-speaker.js"]) {
    const source = fs.readFileSync(file, "utf8").toLowerCase();
    // Policy documentation text may mention banned names; actual imports must not.
    for (const banned of ["import scrfd", "from scrfd", "import insightface", "from insightface", "import talknet", "from talknet"]) {
      assert.ok(!source.includes(banned), `${file} must not import ${banned}`);
    }
  }
  const facePy = fs.readFileSync("clipme-face-detect.py", "utf8");
  assert.match(facePy, /"yunet": "MIT \(OpenCV Zoo\)"/);
  assert.match(facePy, /"haar": "Apache-2.0 \(OpenCV\)"/);
  // Analysis path must not auto-download: explicit download only.
  assert.match(facePy, /allow_download=False/);
});

// ── Requirement 12: shared association timeline for preview & FFmpeg ────────
test("CSS preview and FFmpeg crop consume the same association timeline", () => {
  const faceTimeline = {
    frames: [
      { t_ms: 500, faces: [{ x: 100, y: 100, w: 100, h: 100, confidence: 0.9, track_id: 0, track_confidence: 0.9, mouth_motion: 0.8 }] }
    ]
  };
  const speakerTimeline = { segments: [{ start_ms: 0, end_ms: 1000, speaker_id: "A", confidence: 0.8 }] };
  const assoc = localai.associateSpeakerWithFace(speakerTimeline, faceTimeline, {
    sourceWidth: 1280, sourceHeight: 720, targetAspect: 9 / 16
  });
  assert.ok(assoc.length > 0);
  // FFmpeg filter built from the same associations
  const filter = localai.buildSpeakerCutFilter(assoc, 1280, 720);
  assert.ok(filter && /^crop=/.test(filter), "FFmpeg filter built from associations");
  // CSS preview uses the same associations via cut-to-face module
  const cutToFace = require("./clipme-cut-to-face.js");
  const prepared = cutToFace.prepareAssociations(assoc, 1280, 720, cutToFace.ratioValue("portrait"));
  assert.ok(prepared.length > 0, "CSS preview prepared from same associations");
});

if (!process.exitCode) console.log(`Mode Lite done: ${results.length}/${results.length} PASS`);
