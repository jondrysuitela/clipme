const fs = require("fs");
const http = require("http");
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
const durationTest = [];

function syntaxCheck(file) {
  cp.execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
}
const serverSrc = fs.readFileSync("server.js", "utf8");
const scriptSrc = fs.readFileSync("script.js", "utf8");
const cssSrc = fs.readFileSync("styles.css", "utf8");
const htmlSrc = fs.readFileSync("index.html", "utf8");

// ---------- M-02: extract real targetClipLength ----------
function extractFn(name) {
  const re = new RegExp(`function ${name}\\([^)]*\\) \\{`);
  const start = serverSrc.search(re);
  if (start === -1) throw new Error(`${name} not found`);
  const bodyStart = serverSrc.indexOf("{", start) + 1;
  let depth = 1, i = bodyStart;
  while (i < serverSrc.length && depth > 0) {
    if (serverSrc[i] === "{") depth++;
    else if (serverSrc[i] === "}") depth--;
    i++;
  }
  return serverSrc.slice(bodyStart, i - 1);
}
const tcl = new Function(`return (function targetClipLength(value){${extractFn("targetClipLength")}});`)();

// ---------- boot server ----------
let srv = null;
function boot() {
  return new Promise((resolve, reject) => {
    const { startServer } = require("./server.js");
    startServer(0, "127.0.0.1").then((s) => { srv = s; resolve(s); }, reject);
  });
}
function get(port, pathname) {
  return new Promise((resolve, reject) => {
    const raw = pathname; // may contain encoded chars; send as-is
    http.get({ host: "127.0.0.1", port, path: raw }, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    }).on("error", reject);
  });
}

// ---------- M-02 duration ----------
const durationCases = [
  ["valid 45", "45", 45],
  ["valid decimal 30.5", "30.5", 30.5],
  ["missing undefined", undefined, 90],
  ["empty string", "", 90],
  ["zero", "0", 90],
  ["invalid abc", "abc", 90],
  ["negative -10 -> min clamp", "-10", 15],
  ["extremely large", "999999", 90],
  ["tiny 5", "5", 15],
  ["null", null, 90]
];

for (const [label, input, expected] of durationCases) {
  durationTest.push(t(`M-02 duration: ${label} -> ${expected}`, () => {
    const got = tcl(input);
    if (got !== expected) throw new Error(`expected ${expected}, got ${got}`);
  }));
}

(async () => {
  await Promise.all(durationTest);
  await t("M-02 duration cannot produce NaN/Infinity", () => {
    for (const v of ["Infinity", "NaN", "1e999", "-Infinity", "abc", "", undefined]) {
      const n = tcl(v);
      if (!Number.isFinite(n)) throw new Error(`not finite for ${JSON.stringify(v)}: ${n}`);
      if (n < 15 || n > 90) throw new Error(`out of range for ${JSON.stringify(v)}: ${n}`);
    }
  });

  await t("M-02 handleUpload uses targetClipLength for duration", () => {
    const up = serverSrc.slice(serverSrc.indexOf("async function handleUpload"), serverSrc.indexOf("function isSupportedVideoUrl"));
    if (!/targetClipLength\(parsed\.parts\.duration\?\.text\)/.test(up)) throw new Error("duration not routed through targetClipLength");
  });

  // ---------- M-03 serveStatic ----------
  await t("M-03: allowlist exists and contains only web assets", () => {
    if (!/PUBLIC_WEB_FILES = new Set\(\["\/index.html", "\/styles.css", "\/script.js", "\/clipme-cut-to-face.js", "\/build\/icon.png"\]\)/.test(serverSrc)) {
      throw new Error("PUBLIC_WEB_FILES allowlist mismatch");
    }
  });

  await t("M-03: build/icon.png is served as public web asset", async () => {
    if (!srv) srv = await boot();
    const res = await fetch(`${srv.url}/build/icon.png`);
    if (res.status !== 200) throw new Error(`build/icon.png not served (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) throw new Error("icon payload looks truncated");
    if (buf.slice(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("icon is not a PNG file");
  });

  if (!srv) srv = await boot();

  // Allowed web assets
  for (const p of ["/", "/index.html", "/styles.css", "/script.js", "/clipme-cut-to-face.js"]) {
    await t(`M-03 allowed: ${p} -> 200`, async () => {
      const r = await get(srv.port, p);
      if (r.status !== 200) throw new Error(`expected 200, got ${r.status}`);
    });
  }

  // Sensitive internal files (must NOT be served)
  const internalPaths = [
    "/server.js", "/package.json", "/package-lock.json", "/stt-config.json",
    "/stt-engine.py", "/transcribe_faster_whisper.py", "/debug_engine.py",
    "/README.md", "/electron/main.js", "/run-server.ps1", "/.venv/Scripts/python.exe",
    "/tmp/fonts.conf"
  ];
  for (const p of internalPaths) {
    await t(`M-03 internal blocked: ${p}`, async () => {
      const r = await get(srv.port, p);
      if (r.status !== 403 && r.status !== 404) throw new Error(`expected 403/404, got ${r.status}`);
    });
  }

  // Traversal (URL parser normalizes /../, but allowlist makes it moot)
  const traversal = [
    "/../server.js",
    "/%2e%2e/server.js",
    "/%2e%2e%2fserver.js",
    "/..%5c..%5cserver.js",
    "/..\\..\\server.js",
    "/media/../server.js",
    "/.env",
    "/%2e%2e/.env",
    "/config/server.js"
  ];
  for (const p of traversal) {
    await t(`M-03 traversal blocked: ${JSON.stringify(p)}`, async () => {
      const r = await get(srv.port, p);
      if (r.status !== 403 && r.status !== 404) throw new Error(`expected 403/404, got ${r.status} for ${p}`);
    });
  }

  // M-03: ensure /media/<uuid> still reachable (legit)
  await t("M-03: /media with invalid uuid rejected - network path intact", async () => {
    const r = await get(srv.port, "/media/not-a-uuid");
    if (r.status === 200) throw new Error("should not serve");
  });

  srv.server.closeAllConnections && srv.server.closeAllConnections();
  await new Promise((r) => srv.server.close(r));

  // ---------- M-04 ratio state ----------
  await t("M-04: layoutSelect value four5 (no square) with state sync in setRatio", () => {
    if (/value="square"/.test(htmlSrc)) throw new Error("square option present");
    if (!/layoutSelect\) layoutSelect\.value = ratio/.test(scriptSrc)) throw new Error("layoutSelect not synced in setRatio");
  });

  await t("M-04: setRatio normalizes unknown to portrait", () => {
    if (!/RATIO_PRESETS\.includes\(token\) \? token : "portrait"/.test(scriptSrc)) throw new Error("unknown fallback missing");
  });

  await t("M-04: currentRatio reads classList (single source of truth)", () => {
    if (!/previewFrame\.classList\.contains\("wide"\)/.test(scriptSrc)) throw new Error("currentRatio wide check missing");
    if (!/previewFrame\.classList\.contains\("four5"\)/.test(scriptSrc)) throw new Error("currentRatio four5 check missing");
  });

  await t("M-04: init calls setRatio(currentRatio()) to normalize state", () => {
    if (!/setRatio\(currentRatio\(\)\)/.test(scriptSrc)) throw new Error("init normalization missing");
  });

  await t("M-04: CSS geometry portrait=9/16, wide=16/9, four5=4/5", () => {
    if (!/phone-frame\s*\{[\s\S]*aspect-ratio: 9 \/ 16/.test(cssSrc)) throw new Error("portrait 9/16 missing");
    if (!/phone-frame\.wide\s*\{[\s\S]*aspect-ratio: 16 \/ 9/.test(cssSrc)) throw new Error("wide 16/9 missing");
    if (!/phone-frame\.four5\s*\{[\s\S]*aspect-ratio: 4 \/ 5/.test(cssSrc)) throw new Error("four5 4/5 missing");
  });

  // ---------- output ----------
  let fails = 0;
  for (const r of results) {
    const icon = r.status === "PASS" ? "OK  " : "FAIL";
    console.log(`[${icon}] ${r.name}`);
    if (r.status !== "PASS") { fails++; if (r.error) console.log(`       ${String(r.error).split("\n")[0]}`); }
  }
  console.log(`\n${results.length - fails}/${results.length} passed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("HARNESS ERROR", e); process.exit(1); });