const fs = require("fs");
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

const scriptSrc = fs.readFileSync("script.js", "utf8");
const serverSrc = fs.readFileSync("server.js", "utf8");
const htmlSrc = fs.readFileSync("index.html", "utf8");

function extractWaitForJob() {
  const start = scriptSrc.indexOf("async function waitForJob(jobId) {");
  if (start === -1) throw new Error("waitForJob not found");
  const bodyStart = scriptSrc.indexOf("{", start) + 1;
  let depth = 1, i = bodyStart;
  while (i < scriptSrc.length && depth > 0) {
    if (scriptSrc[i] === "{") depth++;
    else if (scriptSrc[i] === "}") depth--;
    i++;
  }
  return scriptSrc.slice(bodyStart, i - 1);
}

async function runWaitForJobScenario({ statuses }) {
  const body = extractWaitForJob();
  const sandbox = {
    fetch: async () => ({ ok: true, json: async () => statuses.length ? statuses.shift() : { status: "running" } }),
    window: { setTimeout },
    uploadStatus: { textContent: "" },
    Date,
  };
  const fn = new Function("fetch", "window", "uploadStatus", "Date", `return (async function(jobId){ ${body} })`);
  const run = fn(sandbox.fetch, sandbox.window, sandbox.uploadStatus, sandbox.Date);
  return run("test-job");
}

// ---------- RUN ----------
(async () => {
  const pending = [];
  const enqueue = (name, fn) => pending.push(t(name, fn));

  for (const f of ["server.js", "script.js", "electron/main.js"]) {
    enqueue(`syntax ${f}`, () => syntaxCheck(f));
  }

  enqueue("C-01 currentRatio returns wide/four5/portrait", () => {
    const fn = new Function("previewFrame", `
      ${scriptSrc.match(/function currentRatio\(\) \{[^}]*\}/)[0]}
      return currentRatio();
    `);
    const mk = (classes) => ({ classList: { contains: (c) => classes.includes(c) } });
    if (fn(mk(["portrait"])) !== "portrait") throw new Error("portrait mapping wrong");
    if (fn(mk(["wide"])) !== "wide") throw new Error("wide mapping wrong");
    if (fn(mk(["four5"])) !== "four5") throw new Error("four5 mapping wrong");
  });

  enqueue("C-01 setRatio canonical tokens", () => {
    const tokens = scriptSrc.match(/RATIO_PRESETS = \[[^\]]*\]/)[0];
    if (!tokens.includes("portrait") || !tokens.includes("wide") || !tokens.includes("four5")) throw new Error("missing canonical token");
    if (tokens.includes("square")) throw new Error("square should not be canonical");
  });

  enqueue("C-01 ratio picker only via segmented buttons (no layoutSelect)", () => {
    if (/id="layoutSelect"/.test(htmlSrc)) throw new Error("layoutSelect should be removed from settings");
    if (!/class="segmented"[^>]*>/.test(htmlSrc)) throw new Error("segmented ratio buttons missing");
  });

  enqueue("C-01 backend ratios resolve to same three tokens", () => {
    const presets = serverSrc.match(/const RATIO_PRESETS = \{[\s\S]*?\n\};/)[0];
    for (const k of ["portrait", "wide", "four5"]) {
      if (!presets.includes(`${k}:`)) throw new Error(`preset ${k} missing`);
    }
  });

  enqueue("C-01 backend validation rejects unknown ratio", () => {
    const fn = new Function("value", `
      ${serverSrc.match(/const RATIO_PRESETS = \{[\s\S]*?\n\};/)[0]}
      ${serverSrc.match(/function isSupportedRatio\(value\) \{[\s\S]*?\n\}/)[0]}
      ${serverSrc.match(/function resolveRatio\(value\) \{[\s\S]*?\n\}/)[0]}
      return { isSupported: isSupportedRatio(value), resolved: resolveRatio(value) };
    `);
    const ok = (v) => fn(v);
    if (!ok("portrait").isSupported) throw new Error("portrait not supported");
    if (!ok("wide").isSupported) throw new Error("wide not supported");
    if (!ok("four5").isSupported) throw new Error("four5 not supported");
    if (ok("square").isSupported) throw new Error("square wrongly accepted");
    if (ok("banana").isSupported) throw new Error("banana wrongly accepted");
    if (ok(undefined).resolved !== "portrait") throw new Error("undefined should default to portrait");
  });

  enqueue("M-01 selectClip guards undefined clip", () => {
    if (!/function selectClip\(clip\) \{[\s\S]*?if \(!clip\) \{/.test(scriptSrc)) throw new Error("selectClip missing empty guard");
  });

  enqueue("M-01 loadProject/upload guard empty clips", () => {
    const cnt = (scriptSrc.match(/setActiveClipOrEmpty\(clips\[0\]\)/g) || []).length;
    if (cnt < 2) throw new Error(`setActiveClipOrEmpty used ${cnt} times, expected >=2`);
    if (!/clips = Array\.isArray\(data\.clips\) \? data\.clips : \[\]/.test(scriptSrc)) throw new Error("clips assignment not guarded");
  });

  enqueue("M-01 renderClips guards null activeClip", () => {
    if (!/state\.activeClip && clip\.id === state\.activeClip\.id/.test(scriptSrc)) throw new Error("renderClips active guard missing");
  });

  enqueue("M-01 activeClipKey guards null activeClip", () => {
    if (!/if \(!state\.activeClip\) return "";/.test(scriptSrc)) throw new Error("activeClipKey guard missing");
  });

  // ---------- H-03 waitForJob ----------
  const src2 = fs.readFileSync("script.js", "utf8");

  enqueue("H-03 done -> STOP returns result", async () => {
    const r = await runWaitForJobScenario({ statuses: [{ status: "done", result: { ok: 1 } }] });
    if (!r || r.ok !== 1) throw new Error("done did not return result");
  });

  enqueue("H-03 failed -> STOP throws", async () => {
    let threw = false;
    try { await runWaitForJobScenario({ statuses: [{ status: "failed", error: "boom" }] }); } catch { threw = true; }
    if (!threw) throw new Error("failed did not throw");
  });

  enqueue("H-03 cancelled -> STOP throws", async () => {
    let threw = false;
    try { await runWaitForJobScenario({ statuses: [{ status: "cancelled", error: "bye" }] }); } catch { threw = true; }
    if (!threw) throw new Error("cancelled did not throw");
  });

  enqueue("H-03 timeout -> STOP (no infinite polling)", async () => {
    const body = extractWaitForJob();
    const patched = body.replace("const timeoutMs = 20 * 60 * 1000;", "const timeoutMs = 50;");
    const sandbox = {
      fetch: async () => ({ ok: true, json: async () => ({ status: "running", progress: 5 }) }),
      window: { setTimeout },
      uploadStatus: { textContent: "" },
      Date,
    };
    const fn = new Function("fetch", "window", "uploadStatus", "Date", `return (async function(jobId){ ${patched} })`);
    const run = fn(sandbox.fetch, sandbox.window, sandbox.uploadStatus, sandbox.Date);
    const started = Date.now();
    let threw = false;
    try { await run("job"); } catch { threw = true; }
    if (!threw) throw new Error("timeout did not throw");
    if (Date.now() - started > 5000) throw new Error("took too long (possible runaway)");
  });

  enqueue("H-03 backoff capped at maxInterval", () => {
    if (!/Math\.min\(intervalMs \* 2, maxIntervalMs\)/.test(src2)) throw new Error("backoff cap missing");
  });

  await Promise.all(pending);

  // ---------- OUTPUT ----------
  let fails = 0;
  for (const r of results) {
    const icon = r.status === "PASS" ? "OK  " : "FAIL";
    console.log(`[${icon}] ${r.name}`);
    if (r.status !== "PASS") { fails++; if (r.error) console.log(`       -> ${r.error}`); }
  }
  console.log(`\n${results.length - fails}/${results.length} passed`);
  process.exitCode = fails ? 1 : 0;
})();
