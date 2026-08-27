const fs = require("fs");
const http = require("http");
const path = require("path");
const cp = require("child_process");

const results = [];
async function t(name, fn) {
  try {
    await fn();
    results.push({ name, status: "PASS" });
  } catch (e) {
    results.push({ name, status: "FAIL", error: String(e && e.message || e) });
  }
}
function syntaxCheck(file) {
  cp.execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
}

const serverSrc = fs.readFileSync("server.js", "utf8");
const mainSrc = fs.readFileSync("electron/main.js", "utf8");

function post(port, p, body, ct) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port, path: p, method: "POST", headers: { "Content-Type": ct, "Content-Length": body.length } }, (res) => {
      let d = "";
      res.on("data", (c) => { d += c; });
      res.on("end", () => { try { resolve({ status: res.statusCode, json: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, json: null, body: d }); } });
    });
    r.on("error", reject);
    r.end(body);
  });
}
function get(port, p) {
  return new Promise((resolve, reject) => {
    const r = http.get({ host: "127.0.0.1", port, path: p }, (res) => {
      let d = "";
      res.on("data", (c) => { d += c; });
      res.on("end", () => { try { resolve({ status: res.statusCode, json: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, json: null, body: d }); } });
    });
    r.on("error", reject);
  });
}

let srv = null;
(async () => {
  for (const f of ["server.js", "electron/main.js"]) {
    await t(`syntax ${f}`, () => syntaxCheck(f));
  }

  // ---------- L-02: unused path import removed ----------
  await t("L-02: electron/main.js has no unused path import", () => {
    if (/require\(["']path["']\)/.test(mainSrc)) throw new Error("path import still present");
    if (!/require\(["']..\/server.js["']\)/.test(mainSrc)) throw new Error("server require missing");
  });

  // ---------- L-03: queue enqueue counts only active tasks ----------
  await t("L-03: stt/queue.py counts only active tasks", () => {
    const q = fs.readFileSync("stt/queue.py", "utf8");
    const seg = q.slice(q.indexOf("async def enqueue"), q.indexOf("async def _start_worker"));
    if (/len\(self\._tasks\)/.test(seg)) throw new Error("still uses len(self._tasks)");
    if (!/QUEUED, TaskStatus\.RUNNING, TaskStatus\.PAUSED/.test(seg)) throw new Error("active-status filter missing");
  });

  // ---------- L-04: config load_env tolerates invalid numeric env ----------
  await t("L-04: stt/config.py guards int/float conversion", () => {
    const c = fs.readFileSync("stt/config.py", "utf8");
    const seg = c.slice(c.indexOf("def load_env"), c.indexOf("def override"));
    if (!/except \(TypeError, ValueError\)/.test(seg)) throw new Error("no try/except guard");
  });

  // ---------- L-08: job TTL cleanup includes cancelled ----------
  await t("L-08: job TTL cleanup includes cancelled", () => {
    const seg = serverSrc.slice(serverSrc.indexOf("const JOB_TTL"), serverSrc.indexOf("function sendJson"));
    if (!/"cancelled"/.test(seg)) throw new Error("cancelled missing from cleanup condition");
    if (!/job\.status === "done" \|\| job\.status === "failed" \|\| job\.status === "cancelled"/.test(seg)) throw new Error("condition wrong");
  });

  // ---------- L-07: handleJob whitelist (HTTP) ----------
  await t("L-07: handleJob returns whitelisted fields only", async () => {
    if (!srv) {
      const { startServer } = require("./server.js");
      srv = await startServer(0, "127.0.0.1");
    }
    const port = srv.port;
    const body = JSON.stringify({ type: "phase5-probe" });
    // Create a real job through the public API: analyze YouTube then export is too heavy;
    // use /api/queue flow. Instead verify against a job created via analyze of a small URL is overkill.
    // We exercise handleJob via a job produced by enqueueAndAwait through the batch endpoint is complex.
    // Simplest: POST /api/youtube is heavy (network). Use the running server + /api/jobs with an
    // intentionally-invalid id to confirm 404 path, then create a job via /api/export-batch failure path.
    // Instead: spin an in-process job through the internal jobs map via a fetch-less route is not
    // exposed. So drive a real queued job: upload a project first is unnecessary; we can trigger
    // an export job with an invalid project and read the job shape from /api/jobs.
    const exp = await post(port, "/api/export", JSON.stringify({ projectId: "00000000-0000-4000-8000-000000000000", clipId: 1, start: 0, end: 1, ratio: "portrait" }), "application/json");
    if (!exp.json || !exp.json.jobId) throw new Error("export did not create a job: " + JSON.stringify(exp));
    const jobId = exp.json.jobId;
    const j = await get(port, `/api/jobs/${jobId}`);
    if (j.status !== 200) throw new Error("job fetch failed: " + j.status);
    // "stage" adalah label tahap proses (string pendek dari worker) untuk
    // banner progres dashboard — field publik yang disengaja.
    const allowed = ["id", "type", "status", "progress", "stage", "createdAt", "result", "error"];
    const keys = Object.keys(j.json);
    for (const k of keys) {
      if (!allowed.includes(k)) throw new Error(`leaked field: ${k}`);
    }
    for (const k of allowed) {
      if (!(k in j.json)) throw new Error(`missing whitelisted field: ${k}`);
    }
    // job must eventually settle
    for (let i = 0; i < 30; i++) {
      const j2 = await get(port, `/api/jobs/${jobId}`);
      if (j2.json.status === "done" || j2.json.status === "failed") break;
      await new Promise((r) => setTimeout(r, 200));
    }
  });

  console.log("\n=== HASIL ===");
  let fail = 0;
  for (const r of results) {
    console.log(`[${r.status}] ${r.name}${r.error ? " — " + r.error : ""}`);
    if (r.status === "FAIL") fail++;
  }
  console.log(`\n${results.length - fail}/${results.length} PASS`);
  if (srv) {
    // Export pakai projectId palsu menciptakan dir cache sections — bersihkan.
    try { await fetch(`http://127.0.0.1:${srv.port}/api/projects/00000000-0000-4000-8000-000000000000`, { method: "DELETE" }); } catch {}
    try { srv.server.close(); } catch {}
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
