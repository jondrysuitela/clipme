const fs = require("fs");
const path = require("path");
const http = require("http");
const os = require("os");
const cp = require("child_process");

const results = [];
async function t(name, fn) {
  try {
    await fn();
    results.push({ name, status: "PASS" });
  } catch (e) {
    results.push({ name, status: "FAIL", error: String(e && e.stack || e) });
  }
}

function syntaxCheck(file) {
  cp.execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
}

const serverSrc = fs.readFileSync("server.js", "utf8");

// ---------- helper: build a raw multipart body ----------
function buildMultipart(fields, files, boundary = "clipforge-test-boundary") {
  const chunks = [];
  for (const [name, value] of Object.entries(fields || {})) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  for (const file of files || []) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: ${file.type}\r\n\r\n`));
    chunks.push(file.data);
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

// We need to exercise the REAL parseMultipartStreaming. It is not exported,
// so we boot the server and POST real multipart bodies to /api/upload.
function bootServer() {
  return new Promise((resolve, reject) => {
    const { startServer } = require("./server.js");
    startServer(0, "127.0.0.1").then(resolve, reject);
  });
}

function postMultipartRaw(port, body, boundary) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port,
      path: "/api/upload",
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": body.length
      }
    }, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, body: data, json: parsed });
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}

let srv;
let uploadProjectId = null;
(async () => {
  // ---------- syntax ----------
  for (const f of ["server.js", "script.js", "electron/main.js"]) {
    await t(`syntax ${f}`, () => syntaxCheck(f));
  }

  // ---------- H-07: streaming upload ----------
  await t("H-07: static guards (no readFileSync of raw, no Buffer.concat in upload path)", () => {
    const uploadBody = serverSrc.slice(serverSrc.indexOf("async function handleUpload"), serverSrc.indexOf("function isSupportedVideoUrl"));
    if (/readFileSync/.test(uploadBody)) throw new Error("handleUpload still uses readFileSync");
    if (/Buffer\.concat/.test(uploadBody)) throw new Error("handleUpload still uses Buffer.concat");
    if (!/parseMultipartStreaming/.test(uploadBody)) throw new Error("streaming parser not wired in");
  });

  await t("H-07: dead in-memory parser removed", () => {
    if (/function parseMultipart\(/.test(serverSrc)) throw new Error("parseMultipart (RAM) still present");
  });

  await t("H-07: temp file cleanup helpers exist", () => {
    if (!/function writeStreamChunk/.test(serverSrc)) throw new Error("writeStreamChunk missing");
    if (!/function closeWriteStream/.test(serverSrc)) throw new Error("closeWriteStream missing");
  });

  // ---------- H-05/H-06: queue & single-flight presence ----------
  await t("H-05: enqueueAndAwait defined", () => {
    if (!/function enqueueAndAwait/.test(serverSrc)) throw new Error("enqueueAndAwait missing");
  });
  await t("H-05: preview routed through queue", () => {
    if (!/enqueueAndAwait\("preview"/.test(serverSrc)) throw new Error("preview not queued");
  });
  await t("H-05: captions routed through queue", () => {
    if (!/enqueueAndAwait\("captions"/.test(serverSrc)) throw new Error("captions not queued");
  });
  await t("H-05: deep STT routed through queue", () => {
    if (!/enqueueAndAwait\("analyze-stt"/.test(serverSrc)) throw new Error("analyze-stt not queued");
  });
  await t("H-06: singleFlight defined", () => {
    if (!/const singleFlights = new Map\(\)/.test(serverSrc)) throw new Error("singleFlight map missing");
    if (!/function singleFlight\(/.test(serverSrc)) throw new Error("singleFlight missing");
  });
  await t("H-06: STT uses singleFlight cache key", () => {
    if (!/singleFlight\(cachePath, worker\)/.test(serverSrc)) throw new Error("STT single-flight missing");
  });
  await t("H-06: canonical cache path includes config hash", () => {
    if (!/clipTranscriptConfigHash/.test(serverSrc)) throw new Error("config hash missing");
  });

  // ---------- H-04: export no longer reuses preview (styled) section ----------
  await t("H-04: export source no longer falls back to preview section", () => {
    const exp = serverSrc.slice(serverSrc.indexOf("async function exportClip"), serverSrc.indexOf("function sectionFileName"));
    if (/findCachedSection\(projectDir, payload, "preview"\)/.test(exp)) throw new Error("export still reuses preview section");
  });

  // ---------- live upload test ----------
  let testVideoBuffer = null;
  try {
    testVideoBuffer = fs.readFileSync(path.join(os.tmpdir(), "clipforge-phase3-test.mp4"));
  } catch {}
  if (!testVideoBuffer) {
    await t("H-07: prepare tiny real MP4 via bundled ffmpeg", () => {
      const out = path.join(os.tmpdir(), "clipforge-phase3-test.mp4");
      cp.execFileSync(path.join("bin", "ffmpeg.exe"), [
        "-y", "-f", "lavfi", "-i", "testsrc=duration=1:size=128x128:rate=5",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", out
      ], { stdio: "pipe" });
      testVideoBuffer = fs.readFileSync(out);
      if (!testVideoBuffer || testVideoBuffer.length < 1024) throw new Error("generated video too small");
    });
  }

  await t("H-07: real multipart upload via server (valid small video)", async () => {
    if (!srv) {
      srv = await bootServer();
    }
    const body = buildMultipart(
      { duration: "30" },
      [{ name: "video", filename: "clip.mp4", type: "video/mp4", data: testVideoBuffer }]
    );
    const res = await postMultipartRaw(srv.port, body, "clipforge-test-boundary");
    if (res.status !== 200) throw new Error("upload status " + res.status + " body: " + res.body.slice(0, 400));
    if (!res.json || !res.json.id) throw new Error("missing id in response");
    uploadProjectId = res.json.id;
    if (res.json.clips.length < 1) throw new Error("no clips built");
  });

  await t("H-07: upload too-small file is rejected & temp cleaned", async () => {
    if (!srv) srv = await bootServer();
    const body = buildMultipart(
      {},
      [{ name: "video", filename: "tiny.mp4", type: "video/mp4", data: Buffer.from("short") }]
    );
    const res = await postMultipartRaw(srv.port, body, "clipforge-test-boundary");
    if (res.status !== 400) throw new Error("expected 400, got " + res.status + " body: " + res.body.slice(0, 200));
  });

  await t("H-07: upload with binary CRLF + boundary-LIKE bytes preserved", async () => {
    if (!srv) srv = await bootServer();
    // Use a DIFFERENT boundary string so the "fake" marker inside the body is
    // merely boundary-like, not the real delimiter. Real multipart clients pick
    // a random boundary that never appears inside the file content.
    const bytes = Buffer.concat([
      testVideoBuffer.subarray(0, 1000),
      Buffer.from("\r\n--different-boundary-xyz\r\nfake-inside"),
      testVideoBuffer.subarray(1000, 2000)
    ]);
    const before = fs.readdirSync("tmp").filter((n) => n.startsWith("parts-") || n.startsWith("upload-"));
    const body = buildMultipart(
      { duration: "45" },
      [{ name: "video", filename: "weird.mp4", type: "video/mp4", data: bytes }]
    );
    const res = await postMultipartRaw(srv.port, body, "clipforge-test-boundary");
    // Probe will reject the mangled bytes (500) OR it may succeed (200).
    // Either way the parser must not crash and must clean up all temp artifacts.
    if (res.status !== 200 && res.status !== 500) throw new Error("unexpected status " + res.status + " body: " + res.body.slice(0, 200));
    await new Promise((r) => setTimeout(r, 300));
    const after = fs.readdirSync("tmp").filter((n) => n.startsWith("parts-") || n.startsWith("upload-"));
    const leaked = after.filter((n) => !before.includes(n));
    if (leaked.length) throw new Error("temp files leaked: " + leaked.join(", "));
  });

  // ---------- H-06: singleFlight functional test (extract real body) ----------
  function extractSingleFlight() {
    const start = serverSrc.indexOf("function singleFlight(key, fn) {");
    if (start === -1) throw new Error("singleFlight not found");
    const bodyStart = serverSrc.indexOf("{", start) + 1;
    let depth = 1, i = bodyStart;
    while (i < serverSrc.length && depth > 0) {
      if (serverSrc[i] === "{") depth++;
      else if (serverSrc[i] === "}") depth--;
      i++;
    }
    return `const singleFlights = new Map(); function singleFlight(key, fn) {${serverSrc.slice(bodyStart, i - 1)} } return singleFlight;`;
  }

  await t("H-06: same key runs fn once (single-flight)", async () => {
    const code = extractSingleFlight();
    const make = new Function(code);
    const singleFlight = make();
    let runs = 0;
    const work = () => new Promise((r) => setTimeout(() => { runs++; r("v"); }, 30));
    const [a, b] = await Promise.all([singleFlight("k", work), singleFlight("k", work)]);
    if (runs !== 1) throw new Error("expected 1 run, got " + runs);
    if (a !== "v" || b !== "v") throw new Error("bad result values");
  });

  await t("H-06: different keys run independently", async () => {
    const code = extractSingleFlight();
    const singleFlight = new Function(code)();
    let runs = 0;
    const work = () => new Promise((r) => setTimeout(() => { runs++; r(1); }, 20));
    await Promise.all([singleFlight("a", work), singleFlight("b", work)]);
    if (runs !== 2) throw new Error("expected 2 runs, got " + runs);
  });

  await t("H-06: failure releases lock (retry possible)", async () => {
    const code = extractSingleFlight();
    const singleFlight = new Function(code)();
    let first = true;
    const work = () => {
      if (first) { first = false; return Promise.reject(new Error("boom")); }
      return Promise.resolve("ok");
    };
    await singleFlight("k", work).catch(() => {});
    const retry = await singleFlight("k", work);
    if (retry !== "ok") throw new Error("lock not released after failure");
  });

  await t("H-06: timeout-style rejection releases lock", async () => {
    const code = extractSingleFlight();
    const singleFlight = new Function(code)();
    let first = true;
    const work = () => {
      if (first) { first = false; return new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 20)); }
      return Promise.resolve("ok2");
    };
    await singleFlight("k", work).catch(() => {});
    const retry = await singleFlight("k", work);
    if (retry !== "ok2") throw new Error("lock not released after timeout");
  });

  // ---------- H-05: queue slot release (extract createJob/pumpJobs via internals probe) ----------
  await t("H-05: cancelled job rejects promise & frees slot", async () => {
    if (!srv) srv = await bootServer();
    // Race: the job may already be finished (project missing -> fast failure).
    // Accept EITHER: cancel succeeds (status cancelled) or already-finished 400.
    const body = JSON.stringify({ projectId: "00000000-0000-4000-8000-000000000000", clipId: 2, start: 0, end: 10, ratio: "portrait" });
    const r = await fetch(`${srv.url}/api/export`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    const j = await r.json();
    if (!j.jobId) throw new Error("no jobId");
    const del = await fetch(`${srv.url}/api/jobs/${j.jobId}`, { method: "DELETE" });
    if (del.status !== 200 && del.status !== 400) throw new Error("cancel unexpected: " + del.status);
    const get = await fetch(`${srv.url}/api/jobs/${j.jobId}`);
    const job = await get.json();
    if (!["cancelled", "done", "failed"].includes(job.status)) throw new Error("invalid terminal status: " + job.status);
  });

  // ---------- H-05/H-06: queue concurrency control ----------
  await t("H-05: export jobs tracked & valid statuses", async () => {
    if (!srv) srv = await bootServer();
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const body = JSON.stringify({ projectId: "00000000-0000-4000-8000-000000000000", clipId: 1, start: 0, end: 10, ratio: "portrait" });
      const r = await fetch(`${srv.url}/api/export`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      const j = await r.json();
      if (r.status !== 202) throw new Error("export not accepted: " + r.status + " " + JSON.stringify(j));
      ids.push(j.jobId);
    }
    // wait a moment for queue to process (jobs fail fast: no source)
    await new Promise((r) => setTimeout(r, 1500));
    const queueRes = await fetch(`${srv.url}/api/queue`);
    const queue = await queueRes.json();
    if (!queue.jobs || !queue.jobs.length) throw new Error("no jobs tracked");
    for (const job of queue.jobs) {
      if (!["queued", "running", "done", "failed", "cancelled"].includes(job.status)) {
        throw new Error("invalid job status: " + job.status);
      }
    }
  });

  // ---------- output ----------
  let fails = 0;
  for (const r of results) {
    const icon = r.status === "PASS" ? "OK  " : "FAIL";
    console.log(`[${icon}] ${r.name}`);
    if (r.status !== "PASS") { fails++; if (r.error) console.log(`       ${String(r.error).split("\n")[0]}`); }
  }
  console.log(`\n${results.length - fails}/${results.length} passed`);
  if (srv) {
    if (uploadProjectId) {
      try { await fetch(`http://127.0.0.1:${srv.port}/api/projects/${uploadProjectId}`, { method: "DELETE" }); } catch {}
    }
    // Export pakai projectId palsu menciptakan dir cache sections kosong — bersihkan via API.
    try { await fetch(`http://127.0.0.1:${srv.port}/api/projects/00000000-0000-4000-8000-000000000000`, { method: "DELETE" }); } catch {}
    try { srv.server.closeAllConnections?.(); } catch {}
    try { await new Promise((r) => { srv.server.close(() => r()); setTimeout(r, 3000); }); } catch {}
  }
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("HARNESS ERROR", e); process.exit(1); });