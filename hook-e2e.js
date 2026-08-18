// E2E integration: analyze-clip memakai hook engine baru.
// Jalankan: node hook-e2e.js
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

const uuid = () => crypto.randomUUID();
const projectId = uuid();

// Project dir override via env agar tidak menyentuh data pengguna.
process.env.CLIPFORGE_DATA_DIR = path.join(os.tmpdir(), "clipme-e2e-" + Date.now());
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
    title: "Test Video",
    type: "upload",
    duration: 60,
    transcriptPath: "transcript.json",
    transcriptLanguage: "id",
    clips: []
  }, null, 2));
  fs.writeFileSync(path.join(projectDir, "transcript.json"), JSON.stringify([
    { start: 0, end: 3, text: "Jadi gini teman-teman, di video ini saya mau kasih tips keuangan." },
    { start: 3, end: 6, text: "Kenapa kebanyakan orang gagal jadi kaya?" },
    { start: 6, end: 9, text: "Ternyata jawabannya cuma satu kebiasaan kecil yang jarang disadari." },
    { start: 9, end: 12, text: "Saya buktikan sendiri selama 3 tahun terakhir." }
  ]), "utf8");

  const payload = { projectId, clipId: 1, start: 0, end: 12, language: "Indonesia" };
  const res = await post(port, "/api/analyze-clip", payload);

  t("analyze-clip 200", () => { if (res.status !== 200) throw new Error("status " + res.status + " " + JSON.stringify(res.body)); });

  const a = res.json.analysis;
  t("analysis punya hook fields baru", () => {
    for (const k of ["hookIntent", "hookConfidence", "payoffConfidence", "hookType", "originalHook", "recommendedHook", "hookReordered", "hookScore"]) {
      if (!(k in a)) throw new Error("missing field " + k);
    }
  });
  t("hookIntent non-empty", () => { if (!a.hookIntent) throw new Error("hookIntent kosong"); });
  t("hookConfidence 0-100", () => { if (!(a.hookConfidence >= 0 && a.hookConfidence <= 100)) throw new Error("hookConfidence=" + a.hookConfidence); });
  t("payoffConfidence 0-100", () => { if (!(a.payoffConfidence >= 0 && a.payoffConfidence <= 100)) throw new Error("payoffConfidence=" + a.payoffConfidence); });
  t("recommendedHook != template rusak", () => {
    const r = a.recommendedHook || "";
    if (/Kisah |Cara halo|padahal jarang disadari$|hal yang jarang dibahas$|\?$/.test(r) && !/[?]/.test(r)) {
      throw new Error("recommendedHook masih template: " + r);
    }
  });
  t("timedSegments ikut", () => { if (!Array.isArray(res.json.timedSegments)) throw new Error("timedSegments missing"); });
  t("recommendedHook TER-NORMALISASI (bukan filler mentah)", () => {
    // Kalimat pertama clip adalah filler "Jadi gini teman-teman, di video ini
    // saya mau kasih tips keuangan." -> recommendedHook tidak boleh menyisakan
    // pembuka filler/greeting itu.
    const r = String(a.recommendedHook || "");
    const lower = r.toLowerCase();
    if (lower.startsWith("jadi gini") || /^halo|^guys|di video ini/.test(lower)) {
      throw new Error("recommendedHook masih filler/greeting: " + r);
    }
  });

  console.log("\n=== HASIL E2E ===");
  for (const r of results) console.log(`[${r.status}] ${r.name}${r.error ? " — " + r.error : ""}`);
  console.log("\nAnalysis hook:", JSON.stringify({
    hookType: a.hookType, hookIntent: a.hookIntent, hookScore: a.hookScore,
    hookConfidence: a.hookConfidence, payoffConfidence: a.payoffConfidence,
    hookReordered: a.hookReordered, originalHook: a.originalHook, recommendedHook: a.recommendedHook
  }, null, 2));
  const fail = results.filter((r) => r.status === "FAIL").length;
  console.log(`\n${results.length - fail}/${results.length} passed`);
  try { fs.rmSync(DATA_ROOT, { recursive: true, force: true }); } catch {}
  process.exit(fail ? 1 : 0);
})();