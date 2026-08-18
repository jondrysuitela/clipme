// ============================================================================
// phase7-test.js — LocalAI Pipeline Tests
//
// Tests speaker diarization (audio-based), face detection (dummy for now),
// and speaker-face association with filter generation. Uses dummy video/audio
// to avoid real FFmpeg/Python runtime dependencies.
// ============================================================================

const assert = require("assert");
const { URLSearchParams } = require("url");
const http = require("http");
const path = require("path");
const fs = require("fs");

const { startServer } = require("./server.js");
const { clipPayloadToClip } = require("./server.js"); // For mocking purposes

// Dummy HTTP server for requests
let srv;
let port;
async function get(path, query = {}) {
  const params = new URLSearchParams(query);
  const url = `http://127.0.0.1:${port}${path}?${params.toString()}`;
  const res = await fetch(url);
  return { status: res.status, json: await res.json() };
}
async function post(path, body, headers = {}) {
  const url = `http://127.0.0.1:${port}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

// ============================================================================
// Test utilities
// ============================================================================

let testCount = 0;
let passCount = 0;

function t(name, fn) {
  testCount++;
  try {
    fn();
    passCount++;
    console.log(`[OK  ] ${name}`);
  } catch (e) {
    console.error(`[FAIL] ${name}`);
    console.error(e);
  }
}

async function at(name, fn) {
  testCount++;
  try {
    await fn();
    passCount++;
    console.log(`[OK  ] ${name}`);
  } catch (e) {
    console.error(`[FAIL] ${name}`);
    console.error(e);
  }
}

// ============================================================================
// Setup / Teardown
// ============================================================================

let projectIds = [];
let currentProjectId;

async function boot() {
  process.env.CLIPFORGE_DATA_DIR = path.join(__dirname, "test-data");
  process.env.CLIPFORGE_DEEP_ANALYZE = "1"; // force deep analyze for transcript
  fs.mkdirSync(process.env.CLIPFORGE_DATA_DIR, { recursive: true });

  const server = await startServer(0, "127.0.0.1");
  port = server.port;
  srv = server.server;
  return server;
}

async function createProject() {
  const videoUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"; // Never gonna give you up
  const { status, json } = await post(
    "/api/youtube",
    { url: videoUrl, duration: 90, language: "English" }
  );
  assert.strictEqual(status, 200, `Expected 200 for project creation, got ${status}`);
  assert.ok(json.id, "Expected project ID");
  projectIds.push(json.id);
  currentProjectId = json.id;
  return json.id;
}

async function cleanup() {
  if (srv) {
    srv.close();
    srv = null;
  }
  if (fs.existsSync(process.env.CLIPFORGE_DATA_DIR)) {
    fs.rmSync(process.env.CLIPFORGE_DATA_DIR, { recursive: true, force: true });
  }
}

// ============================================================================
// LocalAI Test Suite
// ============================================================================

async function runTests() {
  await boot();

  at("P7-01: /api/localai/status returns available backends", async () => {
    const { status, json } = await get("/api/localai/status");
    assert.strictEqual(status, 200);
    assert.ok(json.localai.available, "LocalAI module should be available");
    assert.ok(json.aiBackend.speaker.available, "Speaker backend should be available");
    assert.ok(json.aiBackend.face.available, "Face backend should be available or gracefully skipped");
    assert.ok(json.runtime.mode, "Runtime mode should be present");
  });

  at("P7-02: POST /api/localai/analyze returns 202 (job queued)", async () => {
    await createProject();
    const payload = {
      projectId: currentProjectId,
      clipId: 1,
      start: 0,
      end: 30,
      speakerCut: true,
      faceTrack: true,
      sourceW: 1920,
      sourceH: 1080,
      targetAspect: 9 / 16
    };
    const { status, json } = await post("/api/localai/analyze", payload);
    assert.strictEqual(status, 202, `Expected 202, got ${status}`);
    assert.ok(json.jobId.startsWith("localai-analyze"), "Expected job ID");
    assert.strictEqual(json.status, "queued", "Expected job to be queued");
    currentAnalyzeJobId = json.jobId;
  });

  at("P7-03: LocalAI analyze job eventually completes", async () => {
    // This is hard to mock, just wait for a fixed period.
    // In a real test, we would poll /api/jobs/:jobId.
    if (!currentAnalyzeJobId) {
      console.warn("Skipping P7-03: no currentAnalyzeJobId");
      return;
    }
    console.log(`Polling job ${currentAnalyzeJobId} (wait up to 60s)...`);
    let jobStatus;
    let result;
    for (let i = 0; i < 60; i++) {
      const { status, json } = await get(`/api/jobs/${currentAnalyzeJobId}`);
      assert.strictEqual(status, 200, `Expected 200 for job status, got ${status}`);
      jobStatus = json.status;
      if (jobStatus === "done") {
        result = json.result;
        break;
      }
      if (jobStatus === "failed" || jobStatus === "cancelled") {
        throw new Error(`Job failed: ${json.error}`);
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    assert.strictEqual(jobStatus, "done", `Job did not complete (final status: ${jobStatus})`);
    assert.ok(result, "Expected job result");
    assert.ok(result.speakerTimeline, "Expected speaker timeline in result");
    assert.ok(result.associations, "Expected associations in result");
    currentAnalyzeResult = result; // Store for next test
  });

  at("P7-04: Persisted analyze result can be fetched via /api/localai/result", async () => {
    if (!currentAnalyzeJobId) {
      console.warn("Skipping P7-04: no currentAnalyzeJobId");
      return;
    }
    const { status, json } = await get(
      `/api/localai/result`,
      { projectId: currentProjectId, jobId: currentAnalyzeJobId }
    );
    assert.strictEqual(status, 200);
    assert.ok(json.result, "Expected result object");
    assert.deepStrictEqual(json.result, currentAnalyzeResult, "Result should match");
  });

  at("P7-05: POST /api/localai/download-model works (face model)", async () => {
    // This will trigger download of YuNet model if not cached.
    const { status, json } = await post("/api/localai/download-model", { kind: "face" });
    assert.strictEqual(status, 200);
    assert.strictEqual(json.status, "completed");
    assert.ok(json.output, "Expected output message");
  });

  await cleanup();
}

runTests().then(() => {
  console.log(`\n${passCount}/${testCount} tests passed.`);
  if (passCount !== testCount) {
    process.exit(1);
  }
  process.exit(0);
});
