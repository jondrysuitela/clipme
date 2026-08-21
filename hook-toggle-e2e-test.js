// E2E: toggle "Analisis hook viral" pada drop video lokal.
// Video dibuat dengan suara bicara asli (Windows SAPI -> wav -> mux ffmpeg).
// Tanpa toggle  -> clip placeholder (score null).
// Dengan toggle -> STT jalan, transcript tersimpan, clip ter-analisis (score angka).
const fs = require("fs");
const http = require("http");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const FFMPEG = process.env.FFMPEG_PATH || path.join(__dirname, "bin", "ffmpeg.exe");

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "clipme-hooktoggle-"));
  process.env.CLIPFORGE_DATA_DIR = dataDir;
  const uploadDir = path.join(dataDir, "uploads");

  // 1) Suara bicara asli via Windows SAPI (fallback: tone biasa -> uji fallback saja)
  const wav = path.join(dataDir, "speech.wav");
  let hasSpeech = true;
  try {
    const ps = [
      "Add-Type -AssemblyName System.Speech;",
      "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;",
      `$s.SetOutputToWaveFile('${wav.replace(/'/g, "''")}');`,
      "$s.Rate = 0; $s.Volume = 100;",
      "$s.Speak('Jadi begini cara saya berjualan online tiga tahun terakhir. Semua berubah ketika saya belajar tentang arus kas. Intinya disiplin mencatat keuangan mengubah segalanya.');",
      "$s.Dispose();"
    ].join(" ");
    execFileSync("powershell.exe", ["-NoProfile", "-Command", ps], { stdio: "ignore", timeout: 60000 });
    if (!fs.existsSync(wav) || fs.statSync(wav).size < 10000) throw new Error("wav kosong");
  } catch {
    hasSpeech = false;
  }

  // 2) Video 10s: testsrc + audio (bicara atau tone)
  const makeVideo = (outPath, audioPath) => {
    const args = ["-y", "-f", "lavfi", "-i", "testsrc=duration=10:size=320x240:rate=15"];
    if (audioPath) args.push("-i", audioPath);
    else args.push("-f", "lavfi", "-i", "sine=frequency=300:duration=10");
    args.push("-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", outPath);
    execFileSync(FFMPEG, args, { stdio: "ignore" });
  };

  const { startServer } = require("./server.js");
  const srv = await startServer(0, "127.0.0.1");

  function upload(videoName) {
    return new Promise((resolve, reject) => {
      const boundary = "----hooktoggle" + crypto.randomBytes(8).toString("hex");
      const videoBuf = fs.readFileSync(path.join(dataDir, videoName));
      const parts = [];
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="durationMode"\r\n\r\nAUTO\r\n`));
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="test.mp4"\r\nContent-Type: video/mp4\r\n\r\n`));
      parts.push(videoBuf);
      parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
      const body = Buffer.concat(parts);
      const r = http.request({
        host: "127.0.0.1", port: srv.port, path: "/api/upload", method: "POST",
        headers: { "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": body.length }
      }, (res) => {
        let d = ""; res.on("data", (c) => d += c);
        res.on("end", () => { try { resolve({ status: res.statusCode, json: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, json: null }); } });
      });
      r.on("error", reject); r.write(body); r.end();
    });
  }

  let fails = 0;
  const check = (name, ok, extra = "") => {
    console.log(`${ok ? "[OK  ]" : "[FAIL]"} ${name}${extra ? " -> " + extra : ""}`);
    if (!ok) fails++;
  };

  const get = (p) => new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port: srv.port, path: p }, (res) => {
      let d = ""; res.on("data", (c) => d += c);
      res.on("end", () => resolve({ status: res.statusCode, body: d }));
    }).on("error", reject);
  });

  const post = (p, body) => new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const r = http.request({ host: "127.0.0.1", port: srv.port, path: p, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } },
      (res) => { let d = ""; res.on("data", (c) => d += c); res.on("end", () => { try { resolve({ status: res.statusCode, json: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, json: null }); } }); });
    r.on("error", reject); r.end(data);
  });

  try {
    // A) Tanpa toggle: perilaku lama (placeholder)
    makeVideo(path.join(dataDir, "plain.mp4"), null);
    const off = await upload("plain.mp4");
    check("upload tanpa toggle 200", off.status === 200 && Array.isArray(off.json.clips) && off.json.clips.length > 0,
      JSON.stringify(off.json).slice(0, 120));
    check("tanpa toggle: clip placeholder (score null)", off.json.clips.every((c) => c.score === null || c.placeholder === true));

    // B) Tombol Analyze Hook Viral: upload video BERSUARA, lalu POST /analyze-hook
    if (hasSpeech) {
      makeVideo(path.join(dataDir, "speech.mp4"), wav);
      const up = await upload("speech.mp4");
      check("upload dulu tanpa analisis 200", up.status === 200 && !!up.json.id, JSON.stringify(up.json).slice(0, 120));
      const startRes = await post(`/api/projects/${up.json.id}/analyze-hook`, { durationMode: "AUTO" });
      check("analyze-hook 200 + jobId", startRes.status === 200 && !!startRes.json.jobId,
        JSON.stringify(startRes.json).slice(0, 140));
      if (startRes.json.jobId) {
        // Polling sama seperti waitForJob klien — progres harus naik.
        let job = null;
        const seenProgress = [];
        for (let i = 0; i < 600; i++) {
          const r = await get(`/api/jobs/${startRes.json.jobId}`);
          job = JSON.parse(r.body);
          if (!seenProgress.includes(job.progress)) seenProgress.push(job.progress);
          if (job.status === "done" || job.status === "failed") break;
          await new Promise((res) => setTimeout(res, 500));
        }
        check("job analisis selesai (done)", job && job.status === "done", job && `${job.status} ${job.progress}% ${job.error || ""}`);
        check("progres terlapor bertahap (>=2 nilai unik)", seenProgress.length >= 2, seenProgress.join(","));
        const result = (job && job.result) || {};
        const analyzedClips = Array.isArray(result.clips) ? result.clips : [];
        check("clip ter-analisis (score/hook, bukan placeholder)", analyzedClips.some((c) => typeof c.score === "number" || c.analysis),
          JSON.stringify(analyzedClips[0] || {}).slice(0, 180));
        check("transcriptStatus stt-*", /^stt-/.test(String(result.transcriptStatus || "")), result.transcriptStatus);
        const projDir = path.join(uploadDir, up.json.id);
        check("transcript.json tersimpan di project", fs.existsSync(path.join(projDir, "transcript.json")));
        check("manifest berisi clips ter-analisis", (() => {
          try {
            const m = JSON.parse(fs.readFileSync(path.join(projDir, "project.json"), "utf8"));
            return Array.isArray(m.clips) && m.clips.length > 0 && !!m.transcriptPath;
          } catch { return false; }
        })());
      }
    } else {
      console.log("[SKIP] SAPI tidak tersedia — jalur analisis diuji suite lain (deep-e2e)");
    }
  } finally {
    try { srv.shutdown(); } catch {}
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("[FATAL]", e); process.exit(1); });
