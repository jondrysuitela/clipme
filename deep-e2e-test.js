// E2E: /api/analyze-clip mengembalikan field deep title & hook engine.
// Jalankan: node deep-e2e-test.js
const fs = require("fs");
const http = require("http");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const results = [];
function t(name, fn) {
  try {
    fn();
    results.push({ name, status: "PASS" });
  } catch (e) {
    results.push({ name, status: "FAIL", error: String((e && e.message) || e) });
  }
}

const projectId = crypto.randomUUID();
process.env.CLIPFORGE_DATA_DIR = path.join(os.tmpdir(), "clipme-deep-e2e-" + Date.now());
const DATA_ROOT = process.env.CLIPFORGE_DATA_DIR;
const UPLOAD_DIR = path.join(DATA_ROOT, "uploads");

function post(port, p, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const r = http.request({ host: "127.0.0.1", port, path: p, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => { try { resolve({ status: res.statusCode, json: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, json: null, body: d }); } });
    });
    r.on("error", reject);
    r.end(data);
  });
}

(async () => {
  const { startServer } = require("./server.js");
  const srv = await startServer(0, "127.0.0.1");
  const port = srv.port;
  const projectDir = path.join(UPLOAD_DIR, projectId);
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, "project.json"), JSON.stringify({
    id: projectId,
    title: "Test Deep Video",
    type: "upload",
    duration: 60,
    transcriptPath: "transcript.json",
    transcriptLanguage: "id",
    clips: []
  }, null, 2));
  // Angka "3 tahun" dan pertanyaan ada, tapi di kalimat BERBEDA dari kesimpulan
  // -> membuktikan sintesis lintas kalimat lewat server.
  fs.writeFileSync(path.join(projectDir, "transcript.json"), JSON.stringify([
    { start: 0, end: 3, text: "Saya berjualan online selama 3 tahun." },
    { start: 3, end: 6, text: "Semua berubah ketika saya belajar membaca laporan keuangan." },
    { start: 6, end: 9, text: "Intinya, disiplin arus kas mengubah segalanya." }
  ]), "utf8");

  const payload = { projectId, clipId: 1, start: 0, end: 9, language: "Indonesia" };
  const res = await post(port, "/api/analyze-clip", payload);

  t("analyze-clip 200", () => { if (res.status !== 200) throw new Error("status " + res.status + " " + JSON.stringify(res.body)); });

  const a = res.json.analysis;
  t("analysis punya field deep*", () => {
    for (const k of ["deepTitle", "deepTitleScore", "deepTitleReason", "deepTitleAlternatives", "deepHook", "deepHookReason", "deepThinking", "deepTopic", "deepNumbers", "deepOpenQuestion"]) {
      if (!(k in a)) throw new Error("missing field " + k);
    }
  });
  t("deepTitle non-empty & <= 140", () => { if (!a.deepTitle || a.deepTitle.length > 140) throw new Error("deepTitle: " + JSON.stringify(a.deepTitle)); });
  t("deepTitle BUKAN kutip verbatim", () => {
    const low = String(a.deepTitle || "").toLowerCase();
    const sents = res.json.timedSegments || [];
    for (const s of sents) {
      const sl = String(s.text || "").toLowerCase();
      if (sl && low === sl) throw new Error("deepTitle sama persis kalimat: " + a.deepTitle);
    }
  });
  t("deepTitleScore 0..100", () => { if (!(a.deepTitleScore >= 0 && a.deepTitleScore <= 100)) throw new Error("score=" + a.deepTitleScore); });
  t("deepTitleReason non-empty", () => { if (!a.deepTitleReason) throw new Error("reason kosong"); });
  t("deepTitleAlternatives array non-empty", () => { if (!Array.isArray(a.deepTitleAlternatives) || !a.deepTitleAlternatives.length) throw new Error("alternatives kosong"); });
  t("deepHook non-empty", () => { if (!a.deepHook) throw new Error("deepHook kosong"); });
  t("deepThinking berisi langkah", () => { if (!Array.isArray(a.deepThinking) || a.deepThinking.length < 3) throw new Error("thinking pendek"); });
  t("deepTopic non-empty", () => { if (!a.deepTopic) throw new Error("topic kosong"); });
  t("deepNumbers memuat 3 tahun", () => { if (!a.deepNumbers.some((n) => n.full.includes("3 tahun"))) throw new Error("angka hilang: " + JSON.stringify(a.deepNumbers)); });
  t("deepOpenQuestion field string", () => { if (typeof a.deepOpenQuestion !== "string") throw new Error("openQuestion bukan string"); });

  console.log("\n=== HASIL DEEP E2E ===");
  for (const r of results) console.log(`[${r.status}] ${r.name}${r.error ? " — " + r.error : ""}`);
  console.log("\nDeep:", JSON.stringify({
    title: a.deepTitle, score: a.deepTitleScore, topic: a.deepTopic,
    numbers: a.deepNumbers, hook: a.deepHook, openQuestion: a.deepOpenQuestion,
    reason: (a.deepTitleReason || "").slice(0, 120)
  }, null, 2));
  const fail = results.filter((r) => r.status === "FAIL").length;
  console.log(`\n${results.length - fail}/${results.length} passed`);
  try { fs.rmSync(DATA_ROOT, { recursive: true, force: true }); } catch {}
  process.exit(fail ? 1 : 0);
})();