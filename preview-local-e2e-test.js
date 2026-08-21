// SMOKE (sementara): /api/preview untuk video lokal harus mengembalikan
// section terpotong yang durasinya ~= end-start.
const fs = require("fs");
const http = require("http");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const FFMPEG = process.env.FFMPEG_PATH || path.join(__dirname, "bin", "ffmpeg.exe");
const FFPROBE = process.env.FFPROBE_PATH || path.join(__dirname, "bin", "ffprobe.exe");

(async () => {
  const projectId = crypto.randomUUID();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "clipme-smoke-"));
  process.env.CLIPFORGE_DATA_DIR = dataDir;
  const uploadDir = path.join(dataDir, "uploads");
  const projectDir = path.join(uploadDir, projectId);
  fs.mkdirSync(projectDir, { recursive: true });

  // 1) Video sintetis 20s (video+audio)
  const src = path.join(projectDir, "source.mp4");
  execFileSync(FFMPEG, ["-y", "-f", "lavfi", "-i", "testsrc=duration=20:size=640x360:rate=24",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=20",
    "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", src], { stdio: "ignore" });

  // 2) Manifest proyek lokal + transcript kecil
  fs.writeFileSync(path.join(projectDir, "project.json"), JSON.stringify({
    id: projectId, title: "Smoke Local", type: "upload", duration: 20,
    transcriptPath: "transcript.json", transcriptLanguage: "id", clips: []
  }));
  fs.writeFileSync(path.join(projectDir, "transcript.json"), JSON.stringify([
    { start: 0, end: 10, text: "Halo ini uji smoke section lokal." }
  ]));

  const { startServer } = require("./server.js");
  const srv = await startServer(0, "127.0.0.1");

  const post = (p, body) => new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const r = http.request({ host: "127.0.0.1", port: srv.port, path: p, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } },
      (res) => { let d = ""; res.on("data", (c) => d += c); res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(d) })); });
    r.on("error", reject); r.end(data);
  });
  const get = (p) => new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port: srv.port, path: p }, (res) => {
      let n = 0; res.on("data", (c) => n += c.length);
      res.on("end", () => resolve({ status: res.statusCode, bytes: n }));
    }).on("error", reject);
  });

  let fails = 0;
  const check = (name, ok, extra = "") => {
    console.log(`${ok ? "[OK  ]" : "[FAIL]"} ${name}${extra ? " -> " + extra : ""}`);
    if (!ok) fails++;
  };

  // 3) Preview clip [5..12] → section ~7 detik
  const t0 = Date.now();
  const res = await post("/api/preview", { projectId, clipId: 1, start: 5, end: 12, captionStyle: "off", ratio: "portrait" });
  check("preview 200", res.status === 200, JSON.stringify(res.json).slice(0, 200));
  const url = res.json && res.json.previewUrl;
  check("previewUrl adalah section", !!url && url.includes("/sections/"), url);

  if (url && url.includes("/sections/")) {
    const dl = await get(url);
    check("section bisa diunduh", dl.status === 200 && dl.bytes > 10000, `${dl.status}, ${dl.bytes} bytes`);
    const secFile = path.join(projectDir, "sections", decodeURIComponent(url.split("/").pop()));
    const probe = JSON.parse(execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration",
      "-of", "json", secFile]).toString());
    const dur = Number(probe.format.duration);
    check("durasi section ~= 7s (5..12)", Math.abs(dur - 7) <= 1.2, `${dur.toFixed(2)}s`);
    console.log(`[INFO] cut selesai dalam ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    // 4) Cache hit kedua kali (cepat)
    const t1 = Date.now();
    await post("/api/preview", { projectId, clipId: 1, start: 5, end: 12, captionStyle: "off", ratio: "portrait" });
    console.log(`[INFO] cache hit: ${Date.now() - t1}ms`);
  }

  try { srv.shutdown(); } catch {}
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("[FATAL]", e); process.exit(1); });
