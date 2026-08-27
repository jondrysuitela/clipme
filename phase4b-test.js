const fs = require("fs");
const http = require("http");
const path = require("path");
const cp = require("child_process");
const { startServer } = require("./server.js");

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
const scriptSrc = fs.readFileSync("script.js", "utf8");

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

const B = "phase4b-boundary";
function mp(fields, files) {
  const c = [];
  for (const [n, v] of Object.entries(fields)) c.push(Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`));
  for (const f of files) c.push(Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="${f.name}"; filename="${f.filename}"\r\nContent-Type: ${f.type}\r\n\r\n`), f.data, Buffer.from("\r\n"));
  c.push(Buffer.from(`--${B}--\r\n`));
  return Buffer.concat(c);
}

let srv = null;
let projectId = null;
(async () => {
  for (const f of ["server.js", "script.js", "electron/main.js"]) {
    await t(`syntax ${f}`, () => syntaxCheck(f));
  }

  // ---------- M-05: dead validateNumber removed ----------
  await t("M-05: validateNumber dead code removed", () => {
    if (/function validateNumber/.test(serverSrc)) throw new Error("validateNumber still present");
  });

  // ---------- M-06: export no preview fallback ----------
  await t("M-06: exportClip has no preview-section fallback", () => {
    const exp = serverSrc.slice(serverSrc.indexOf("async function exportClip"), serverSrc.indexOf("function sectionFileName"));
    if (/findCachedSection\(projectDir, payload, "preview"\)/.test(exp)) throw new Error("preview fallback present");
    if (!/findCachedSection\(projectDir, payload, "export"\)/.test(exp)) throw new Error("export cache reuse missing");
  });

  // ---------- M-07: STT format whitelist ----------
  await t("M-07: STT format whitelist rejects traversal", async () => {
    if (!srv) srv = await startServer(0, "127.0.0.1");
    const r = await post(srv.port, "/api/stt/transcribe", JSON.stringify({ audioPath: "c:\\tmp\\x.mp3", format: "../../evil" }), "application/json");
    if (r.status !== 400) throw new Error("expected 400 for bad format, got " + r.status);
    if (r.json && r.json.error !== "Format tidak didukung.") throw new Error("wrong error: " + JSON.stringify(r.json));
  });

  await t("M-07: STT format whitelist accepts valid formats", () => {
    if (!/STT_FORMATS = \["json", "txt", "srt", "vtt", "csv", "word-json", "segment-json", "metadata"\]/.test(serverSrc)) {
      throw new Error("STT_FORMATS whitelist missing");
    }
  });

  // ---------- M-08: loopTimer cleared on selectClip ----------
  await t("M-08: selectClip clears loopTimer", () => {
    if (!/function selectClip\(clip\) \{[\s\S]*?window\.clearInterval\(state\.loopTimer\)/.test(scriptSrc)) {
      throw new Error("loopTimer not cleared in selectClip");
    }
  });
  await t("M-08: renderEmptyClips also clears loopTimer", () => {
    if (!/if \(!clip\) \{[\s\S]*?window\.clearInterval\(state\.loopTimer\)/.test(scriptSrc)) {
      throw new Error("empty-clip guard does not clear loopTimer");
    }
  });

  // ---------- M-09: batch reports failed count ----------
  await t("M-09: batch-export result includes failed count", () => {
    const b = serverSrc.slice(serverSrc.indexOf("function handleExportBatch"), serverSrc.indexOf("class RouteRegistry"));
    if (!/let failed = 0/.test(b)) throw new Error("failed counter missing");
    const catchStart = b.indexOf(".catch((err) => {");
    const catchEnd = b.indexOf("batchJob.workerCleanup");
    const catchBlock = b.slice(catchStart, catchEnd === -1 ? b.length : catchEnd);
    if (!catchBlock.includes("failed += 1")) throw new Error("failed increment missing on catch");
    if (catchBlock.includes("completed += 1")) throw new Error("completed increments on failure too");
    if (!/resolve\(\{ batchId, results: exportResults, total, completed, failed \}\)/.test(b)) throw new Error("failed not in resolved result");
  });

  // ---------- M-10: export-all wired to /api/export-batch ----------
  await t("M-10: exportAllBtn calls /api/export-batch", () => {
    if (!/exportAllBtn"\)\.addEventListener\("click", async \(\) => \{[\s\S]*?\/api\/export-batch/.test(scriptSrc)) {
      throw new Error("export all not wired to batch endpoint");
    }
  });
  await t("M-10: batch handler counts ok/error results for UI", () => {
    if (!/filter\(\(item\) => item && item\.filename\)/.test(scriptSrc)) throw new Error("ok result filtering missing");
    if (!/filter\(\(item\) => item && item\.error\)/.test(scriptSrc)) throw new Error("error result filtering missing");
  });

  // ---------- live batch endpoints smoke ----------
  await t("M-10/M-07: prepare real project via upload", async () => {
    if (!srv) srv = await startServer(0, "127.0.0.1");
    const vid = path.join("tmp", "phase4b.mp4");
    cp.execFileSync(path.join("bin", "ffmpeg.exe"), ["-y", "-f", "lavfi", "-i", "testsrc=duration=1:size=96x54:rate=5", "-c:v", "libx264", "-pix_fmt", "yuv420p", vid], { stdio: "pipe" });
    const video = fs.readFileSync(vid);
    const r = await post(srv.port, "/api/upload", mp({ duration: "30" }, [{ name: "video", filename: "phase4b.mp4", type: "video/mp4", data: video }]), "multipart/form-data; boundary=" + B);
    if (r.status !== 200) throw new Error("upload failed: " + r.status + " " + JSON.stringify(r.json));
    projectId = r.json.id;
    fs.unlinkSync(vid);
  });

  await t("M-10/M-07: POST /api/export-batch with bad ratio -> 400", async () => {
    if (!srv) srv = await startServer(0, "127.0.0.1");
    const body = JSON.stringify({ projectId, clips: [{ clipId: 1, start: 0, end: 10, ratio: "banana" }] });
    const r = await post(srv.port, "/api/export-batch", body, "application/json");
    if (r.status !== 400) throw new Error("expected 400, got " + r.status + " " + JSON.stringify(r.json));
  });

  await t("M-10/M-09: POST /api/export-batch valid -> 202 with job", async () => {
    if (!srv) srv = await startServer(0, "127.0.0.1");
    const body = JSON.stringify({ projectId, clips: [
      { clipId: 1, start: 0, end: 10, ratio: "portrait" },
      { clipId: 2, start: 20, end: 30, ratio: "four5" }
    ] });
    const r = await post(srv.port, "/api/export-batch", body, "application/json");
    if (r.status !== 202) throw new Error("expected 202, got " + r.status + " " + JSON.stringify(r.json));
    if (!r.json.jobId) throw new Error("no jobId in batch response");
    // poll briefly; even if jobs fail (video too short for 20-30), the status must be a valid terminal state or running
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const jr = await new Promise((resolve) => {
      http.get({ host: "127.0.0.1", port: srv.port, path: "/api/jobs/" + r.json.jobId }, (res) => {
        let d = ""; res.on("data", (c) => { d += c; }); res.on("end", () => resolve(JSON.parse(d)));
      });
    });
    if (jr.status !== "done" && jr.status !== "failed" && jr.status !== "running" && jr.status !== "queued") {
      throw new Error("invalid job status: " + jr.status);
    }
  });

  // ---------- M-09: silence the promise from createJob-based export (unhandled rejection guard) ----------
  await t("M-09: createJob promises guarded from unhandled rejection", () => {
    if (!/job\.promise\.catch\(\(\) => \{\}\)/.test(serverSrc)) throw new Error("createJob promise catch guard missing");
  });

  if (srv) {
    try { srv.server.closeAllConnections && srv.server.closeAllConnections(); } catch {}
    await new Promise((r) => { srv.server.close(() => r()); setTimeout(r, 2500); });
  }

  let fails = 0;
  for (const r of results) {
    const icon = r.status === "PASS" ? "OK  " : "FAIL";
    console.log(`[${icon}] ${r.name}`);
    if (r.status !== "PASS") { fails++; if (r.error) console.log(`       ${String(r.error).split("\n")[0]}`); }
  }
  console.log(`\n${results.length - fails}/${results.length} passed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("HARNESS ERROR", e); process.exit(1); });