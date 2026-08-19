// ============================================================================
// VIRAL DURATION ENGINE — test suite.
// Verifikasi: durasi minimum viable / optimal / maximum useful, payoff distance,
// kelengkapan cerita, retention potential, kualitas ending, efisiensi durasi,
// natural cut reason, snap ke batas kalimat, mode AUTO/FIXED/SHORT/STORY/MAXIMUM,
// fallback kosong, peringkat co-optimization (hook + durasi), dan integrasi
// Auto Edit Director (dynamic clip end).
// Jalankan: node duration-engine-test.js
// ============================================================================
const D = require("./clipme-duration-engine.js");
const O = require("./clipme-opening-engine.js");

const results = [];
function t(name, fn) {
  try {
    fn();
    results.push({ name, status: "PASS" });
  } catch (e) {
    results.push({ name, status: "FAIL", error: String((e && e.message) || e) });
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// Transkrip cerita bisnis: pembuka sapaan, konteks, konsekuensi, revelasi,
// kunci, payoff, resolusi, transformasi.
const SEGS = [
  { start: 0, end: 4, text: "Halo semuanya, selamat datang di channel ini." },
  { start: 4, end: 7, text: "Hari ini saya mau kasih tips keuangan." },
  { start: 7, end: 10, text: "Jadi, saya kehilangan seluruh tabungan saya dalam semalam." },
  { start: 10, end: 13, text: "Ternyata itu semua karena satu kebiasaan kecil." },
  { start: 13, end: 16, text: "Kuncinya adalah konsisten nabung 20% gaji tiap bulan." },
  { start: 16, end: 19, text: "Itu pelajaran paling berharga dalam hidup saya." },
  { start: 19, end: 22, text: "Sekarang saya mulai bangun dari nol lagi." },
  { start: 22, end: 25, text: "Dan itu mengubah cara saya melihat uang." }
];
const M = O.detectMoments(SEGS, "id", {});

// ---------------------------------------------------------------------------
// 01. CLAMP — pembatas angka durasi.
// ---------------------------------------------------------------------------
t("01 clamp membatasi nilai ke rentang", () => {
  assert(D.clamp(5, 10, 20) === 10, "under");
  assert(D.clamp(25, 10, 20) === 20, "over");
  assert(D.clamp(15, 10, 20) === 15, "dalam");
});

// ---------------------------------------------------------------------------
// 02. ANALYZE DURATION — bentuk dasar (AUTO).
// ---------------------------------------------------------------------------
t("02 analyzeDuration AUTO: min/optimal/max/recommended konsisten", () => {
  const chosen = M.find((m) => m.text.includes("Kuncinya"));
  const d = D.analyzeDuration(M, chosen, { maxAllowed: 90, mode: "AUTO" });
  assert(d.minimumViableDuration >= 3, `min ${d.minimumViableDuration}`);
  assert(d.optimalDuration >= d.minimumViableDuration, "optimal < min");
  assert(d.maximumUsefulDuration >= d.optimalDuration, "maxUseful < optimal");
  assert(d.recommendedDuration >= d.minimumViableDuration, "recommended < min");
  assert(d.recommendedDuration <= d.maximumAllowedDuration, "recommended > maxAllowed");
  assert(d.recommendedDuration <= d.maximumUsefulDuration, "recommended > maxUseful");
  assert(d.maximumAllowedDuration === 90, "maxAllowed");
});

// ---------------------------------------------------------------------------
// 03. PAYOFF — jarak hook ke payoff + timestamp.
// ---------------------------------------------------------------------------
t("03 payoffDistance & payoffTimestamp benar", () => {
  const chosen = M.find((m) => m.text.includes("Kuncinya"));
  const d = D.analyzeDuration(M, chosen, { maxAllowed: 90, mode: "AUTO" });
  assert(d.payoffDistance === 3, `payoffDistance ${d.payoffDistance}`);
  assert(d.payoffTimestamp === 16, `payoffTimestamp ${d.payoffTimestamp}`);
  assert(d.payoffQuality > 0, "payoffQuality 0");
});

// ---------------------------------------------------------------------------
// 04. KELENGKAPAN CERITA — payoff & konteks menaikkan skor.
// ---------------------------------------------------------------------------
t("04 storyCompleteness: hook+konteks+payoff > hook polos", () => {
  const kunci = M.find((m) => m.text.includes("Kuncinya"));
  const dFull = D.analyzeDuration(M, kunci, { maxAllowed: 90, mode: "AUTO" });
  const slim = D.analyzeDuration([kunci], kunci, { maxAllowed: 90, mode: "AUTO" });
  assert(dFull.storyCompleteness >= slim.storyCompleteness, `${dFull.storyCompleteness} < ${slim.storyCompleteness}`);
});

// ---------------------------------------------------------------------------
// 05. RETENTION — hook kuat (konsekuensi) > hook lemah.
// ---------------------------------------------------------------------------
t("05 retentionPotential: hook konsekuensi > hook biasa", () => {
  const strong = M.find((m) => m.text.includes("kehilangan"));
  const weak = M.find((m) => m.text.includes("Hari ini"));
  const a = D.analyzeDuration(M, strong, { maxAllowed: 90, mode: "AUTO" });
  const b = D.analyzeDuration(M, weak, { maxAllowed: 90, mode: "AUTO" });
  assert(a.retentionPotential >= b.retentionPotential, `${a.retentionPotential} < ${b.retentionPotential}`);
});

// ---------------------------------------------------------------------------
// 06. ENDING & EFISIENSI — rentang skor.
// ---------------------------------------------------------------------------
t("06 endingQuality & durationEfficiency 0..100", () => {
  const chosen = M.find((m) => m.text.includes("Kuncinya"));
  const d = D.analyzeDuration(M, chosen, { maxAllowed: 90, mode: "AUTO" });
  assert(d.endingQuality >= 0 && d.endingQuality <= 100, `ending ${d.endingQuality}`);
  assert(d.durationEfficiency >= 0 && d.durationEfficiency <= 100, `eff ${d.durationEfficiency}`);
});

// ---------------------------------------------------------------------------
// 07. NATURAL CUT — alasan memuat payoff & batas kalimat.
// ---------------------------------------------------------------------------
t("07 naturalCutReason memuat payoff + batas kalimat", () => {
  const chosen = M.find((m) => m.text.includes("Kuncinya"));
  const d = D.analyzeDuration(M, chosen, { maxAllowed: 90, mode: "AUTO" });
  assert(/Payoff/i.test(d.naturalCutReason), "tidak ada Payoff");
  assert(/batas kalimat/i.test(d.naturalCutReason), "tidak ada batas kalimat");
});

// ---------------------------------------------------------------------------
// 08. SNAP — recommended di-snap ke batas kalimat & endIndex ikut.
// ---------------------------------------------------------------------------
t("08 snap: recommended <= optimal & endIndex konsisten dengan durasi", () => {
  const chosen = M.find((m) => m.text.includes("Kuncinya"));
  const d = D.analyzeDuration(M, chosen, { maxAllowed: 90, mode: "SHORT" });
  const endM = M.find((m) => m.index === d.endIndex);
  assert(endM, "endIndex tidak valid");
  assert(endM.end - chosen.start <= d.recommendedDuration + 0.5, "endIndex melebihi recommended");
  assert(d.recommendedDuration < d.optimalDuration, `SHORT tidak memadatkan: ${d.recommendedDuration} vs ${d.optimalDuration}`);
});

// ---------------------------------------------------------------------------
// 09. MODE — FIXED membatasi, STORY/MAXIMUM memaksimalkan.
// ---------------------------------------------------------------------------
t("09 mode FIXED/SHORT/STORY/MAXIMUM menghasilkan durasi berbeda", () => {
  const chosen = M.find((m) => m.text.includes("Kuncinya"));
  const auto = D.analyzeDuration(M, chosen, { maxAllowed: 90, mode: "AUTO" });
  const fixed = D.analyzeDuration(M, chosen, { maxAllowed: 90, mode: "FIXED", fixedDuration: 30 });
  const story = D.analyzeDuration(M, chosen, { maxAllowed: 90, mode: "STORY" });
  const maximum = D.analyzeDuration(M, chosen, { maxAllowed: 90, mode: "MAXIMUM" });
  assert(fixed.recommendedDuration >= auto.minimumViableDuration, "FIXED < min");
  assert(fixed.recommendedDuration <= 90, "FIXED > maxAllowed");
  assert(story.recommendedDuration >= auto.recommendedDuration, "STORY memadatkan");
  assert(maximum.recommendedDuration >= auto.recommendedDuration, "MAXIMUM memadatkan");
});

// ---------------------------------------------------------------------------
// 10. FALLBACK — moments kosong / tanpa hook aman.
// ---------------------------------------------------------------------------
t("10 fallback: moments kosong mengembalikan emptyDuration", () => {
  const d = D.analyzeDuration([], null, { maxAllowed: 90, mode: "AUTO" });
  assert(d.minimumViableDuration >= 0, "min");
  assert(d.recommendedDuration >= 3, `recommended < 3: ${d.recommendedDuration}`);
  assert(d.optimalDuration >= d.recommendedDuration, "optimal < recommended");
});

// ---------------------------------------------------------------------------
// 11. CO-OPTIMIZATION — peringkat menggabungkan hook + durasi.
// ---------------------------------------------------------------------------
t("11 rankCandidates: terurut clipPotentialScore desc, berisi durasi", () => {
  const ranked = D.rankCandidates(M, "id", { maxAllowed: 90 });
  assert(ranked.length > 1, "hanya 1 kandidat");
  for (let i = 1; i < ranked.length; i++) {
    assert(ranked[i - 1].clipPotentialScore >= ranked[i].clipPotentialScore, `urutan salah di ${i}`);
  }
  const top = ranked[0];
  assert(top.duration && top.duration.recommendedDuration > 0, "durasi tidak ada");
  assert(top.hookScore >= 0 && top.hookScore <= 100, "hookScore di luar rentang");
});

// ---------------------------------------------------------------------------
// 12. CLIP POTENTIAL SCORE — rumus pembobotan.
// ---------------------------------------------------------------------------
t("12 clipPotentialScore: bagus > lemah & dalam 0..100", () => {
  const good = D.clipPotentialScore({ hookQuality: 80, openingQuality: 80, storyCompleteness: 80, retentionPotential: 80, payoffQuality: 80, durationEfficiency: 80, endingQuality: 80, payoffPresent: true });
  const bad = D.clipPotentialScore({ hookQuality: 20, openingQuality: 20, storyCompleteness: 20, retentionPotential: 20, payoffQuality: 20, durationEfficiency: 20, endingQuality: 20, payoffPresent: false });
  assert(good > bad, `${good} <= ${bad}`);
  assert(good <= 100 && good >= 0, "skor di luar 0..100");
});

// ---------------------------------------------------------------------------
// 13. INTEGRASI BUILD OPENING DECISION — field durasi ikut hasil.
// ---------------------------------------------------------------------------
t("13 buildOpeningDecision mengisi duration + clipPotentialScore", () => {
  const r = O.buildOpeningDecision(SEGS, "id", { maxAllowed: 90, mode: "AUTO" });
  assert(r.duration, "duration kosong");
  assert(r.duration.recommendedDuration > 0, "recommended 0");
  assert(r.duration.naturalCutReason.length > 0, "reason kosong");
  assert(typeof r.clipPotentialScore === "number" && r.clipPotentialScore >= 0, "clipPotentialScore");
});

// ---------------------------------------------------------------------------
// 14. INTEGRASI AED — dynamic end memendekkan clip di batas kalimat.
// ---------------------------------------------------------------------------
t("14 AED: dynamic end menghasilkan clip lebih pendek dari window", () => {
  const { _test } = require("./server.js");
  const clips = _test.analyzeTranscriptToClips(SEGS, 30, 60, "Indonesia");
  const dynamic = clips.find((c) => c.dynamicEnd === true);
  assert(dynamic, "tidak ada clip dynamicEnd");
  assert(dynamic.recommendedDuration > 0, "recommendedDuration 0");
  assert(dynamic.end <= dynamic.start + dynamic.recommendedDuration + 1, "end tidak sesuai recommended");
  assert(dynamic.end > dynamic.start, "end <= start");
  assert(dynamic.naturalCutReason.length > 0, "naturalCutReason kosong");
});

const failed = results.filter((r) => r.status === "FAIL");
for (const r of results) console.log(`${r.status === "PASS" ? "PASS" : "FAIL"} ${r.name}`);
console.log(`\nViral Duration Engine: ${results.length - failed.length}/${results.length} PASS`);
if (failed.length) {
  for (const f of failed) console.error(`FAIL ${f.name}: ${f.error}`);
  process.exit(1);
}