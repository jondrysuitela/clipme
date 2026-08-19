// ============================================================================
// EDITORIAL OPENING ENGINE — test suite.
// Verifikasi: content understanding, moment detection, strategi
// KEEP/REFRAME/REWRITE/COLD_OPEN/HYBRID, context dependency, open loop,
// payoff, source fidelity, clip structure, bahasa id/en/mixed, edge case,
// dan integrasi Auto Edit Director (cold open menggeser start clip).
// Jalankan: node editorial-opening-test.js
// ============================================================================
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
const digitsOf = (s) => String(s).replace(/[^\d]/g, "");

// ---------------------------------------------------------------------------
// 01. CONTENT UNDERSTANDING — peran semantik per kalimat.
// ---------------------------------------------------------------------------
t("01 contentRoles: claim, question, reveal, conflict, confession, lesson", () => {
  assert(O.contentRoles("Saya kehilangan segalanya dalam semalam.", "id").includes("CONSEQUENCE"), "consequence");
  assert(O.contentRoles("Kenapa kebanyakan orang gagal?", "id").includes("QUESTION"), "question");
  assert(O.contentRoles("Ternyata itu semua karena kebiasaan kecil.", "id").includes("REVELATION"), "reveal");
  assert(O.contentRoles("Tapi banyak orang justru melakukannya.", "id").includes("CONFLICT"), "conflict");
  assert(O.contentRoles("Jujur aja, saya salah besar.", "id").includes("CONFESSION"), "confession");
  assert(O.contentRoles("Pelajaran terpenting adalah sabar.", "id").includes("LESSON"), "lesson");
});

// ---------------------------------------------------------------------------
// 02. MOMENT DETECTION — bentuk + urutan skor.
// ---------------------------------------------------------------------------
t("02 detectMoments: shape lengkap, momen kuat > greeting", () => {
  const segs = [
    { start: 0, end: 4, text: "Halo semuanya, selamat datang di channel ini." },
    { start: 4, end: 8, text: "Satu keputusan bikin bisnis kolaps dalam semalam." },
    { start: 8, end: 12, text: "Ternyata itu karena terlalu percaya pada partner." }
  ];
  const moments = O.detectMoments(segs, "id", {});
  assert(moments.length === 3, `moments=${moments.length}`);
  const m = moments[0];
  for (const k of ["start", "end", "text", "roles", "momentScore", "infoDensity", "contextDependency", "delivery"]) {
    assert(m[k] != null, `field ${k} hilang`);
  }
  assert(moments.every((x) => x.momentScore >= 0 && x.momentScore <= 100), "momentScore di luar 0..100");
  const strong = moments.find((x) => x.text.includes("kolaps"));
  const greet = moments.find((x) => x.text.includes("selamat datang"));
  assert(strong.momentScore > greet.momentScore, `kuat(${strong.momentScore}) tidak > greeting(${greet.momentScore})`);
});

// ---------------------------------------------------------------------------
// 03. STRATEGI — KEEP untuk pembuka yang sudah kuat.
// ---------------------------------------------------------------------------
t("03 KEEP: momen terkuat sudah di posisi pembuka", () => {
  const d = O.buildOpeningDecision([
    { start: 0, end: 4, text: "Satu keputusan bikin bisnis kolaps dalam semalam." },
    { start: 4, end: 8, text: "Ternyata itu karena terlalu percaya pada partner." },
    { start: 8, end: 12, text: "Akhirnya saya belajar verifikasi mitra bisnis." }
  ], "id", {});
  assert(d.strategy === "KEEP", `strategy=${d.strategy}`);
  assert(d.bestOpening.includes("Satu keputusan"), `bestOpening=${d.bestOpening}`);
});

// ---------------------------------------------------------------------------
// 04. STRATEGI — COLD OPEN untuk momen kuat yang muncul belakangan.
// ---------------------------------------------------------------------------
t("04 COLD_OPEN: sapaan lalu momen kuat mandiri", () => {
  const d = O.buildOpeningDecision([
    { start: 0, end: 4, text: "Halo semuanya, selamat datang di channel ini." },
    { start: 4, end: 7, text: "Hari ini saya mau kasih tips keuangan." },
    { start: 7, end: 10, text: "Jadi, saya kehilangan seluruh tabungan saya dalam semalam." },
    { start: 10, end: 13, text: "Ternyata itu semua karena satu kebiasaan kecil." },
    { start: 13, end: 16, text: "Kuncinya adalah konsisten nabung 20% gaji tiap bulan." }
  ], "id", {});
  assert(d.strategy === "COLD_OPEN", `strategy=${d.strategy}`);
  assert(d.sourceSegment.index > 0, `sourceIndex=${d.sourceSegment.index}`);
  assert(!/selamat datang|halo semuanya/i.test(d.bestOpening), `bestOpening masih sapaan: ${d.bestOpening}`);
});

// ---------------------------------------------------------------------------
// 05. STRATEGI — REFRAME saat momen kuat butuh konteks.
// ---------------------------------------------------------------------------
t("05 REFRAME: momen kuat namun context-dependent", () => {
  const s = O.decideStrategy([
    { filler: false, momentScore: 50, index: 0, contextDependency: 0.1, text: "a" },
    { filler: false, momentScore: 70, index: 1, contextDependency: 0.6, text: "b" }
  ], "id", {});
  assert(s.strategy === "REFRAME", `strategy=${s.strategy}`);
});

// ---------------------------------------------------------------------------
// 06. STRATEGI — REWRITE hanya untuk pembuka lemah; bisa dimatikan.
// ---------------------------------------------------------------------------
t("06 REWRITE: pembuka lemah tanpa momen kuat; disableRewrite mencegah", () => {
  const s = O.decideStrategy([
    { filler: false, momentScore: 40, index: 0, contextDependency: 0.1, text: "a" },
    { filler: false, momentScore: 45, index: 1, contextDependency: 0.2, text: "b" }
  ], "id", {});
  assert(s.strategy === "REWRITE", `strategy=${s.strategy}`);
  const off = O.decideStrategy([
    { filler: false, momentScore: 40, index: 0, contextDependency: 0.1, text: "a" },
    { filler: false, momentScore: 45, index: 1, contextDependency: 0.2, text: "b" }
  ], "id", { disableRewrite: true });
  assert(off.strategy !== "REWRITE", `disableRewrite masih ${off.strategy}`);
});

// ---------------------------------------------------------------------------
// 07. STRATEGI — HYBRID saat pembuka pendek + momen menyusul.
// ---------------------------------------------------------------------------
t("07 HYBRID: pembuka pendek + momen kuat menyusul", () => {
  const s = O.decideStrategy([
    { filler: false, momentScore: 57, index: 0, contextDependency: 0.2, text: "Halo guys" },
    { filler: false, momentScore: 60, index: 1, contextDependency: 0.4, text: "x" }
  ], "id", { disableRewrite: true });
  assert(s.strategy === "HYBRID", `strategy=${s.strategy}`);
});

// ---------------------------------------------------------------------------
// 08. USER CONTROLS — keepOriginal memaksa KEEP.
// ---------------------------------------------------------------------------
t("08 keepOriginal memaksa KEEP + bestOpening = ucapan asli", () => {
  const d = O.buildOpeningDecision([
    { start: 0, end: 4, text: "Satu keputusan bikin bisnis kolaps dalam semalam." },
    { start: 4, end: 8, text: "Ternyata itu karena terlalu percaya pada partner." }
  ], "id", { keepOriginal: true });
  assert(d.strategy === "KEEP", `strategy=${d.strategy}`);
  assert(d.keepOriginal === true, "keepOriginal tidak diset");
});

// ---------------------------------------------------------------------------
// 09. CONTEXT DEPENDENCY — kalimat acuan deictic ditandai.
// ---------------------------------------------------------------------------
t("09 contextDependency: kalimat acuan konteks > kalimat mandiri", () => {
  const moments = O.detectMoments([
    { start: 0, end: 3, text: "Saya kehilangan tabungan." },
    { start: 3, end: 6, text: "Itu sebabnya saya tidak percaya siapa pun lagi." }
  ], "id", {});
  assert(moments[1].contextDependency > moments[0].contextDependency, `dep ${moments[0].contextDependency} vs ${moments[1].contextDependency}`);
});

// ---------------------------------------------------------------------------
// 10. SOURCE FIDELITY — hookText tidak menambah angka baru.
// ---------------------------------------------------------------------------
t("10 hookText tidak mengarang angka baru", () => {
  const src = [
    { start: 0, end: 4, text: "Halo, selamat datang." },
    { start: 4, end: 8, text: "Saya kehilangan 500 juta rupiah dalam semalam." },
    { start: 8, end: 12, text: "Ternyata itu karena satu kebiasaan." }
  ];
  const d = O.buildOpeningDecision(src, "id", {});
  const srcDigits = digitsOf(src.map((s) => s.text).join(" "));
  const hookDigits = digitsOf(d.hookText || "");
  const added = [...hookDigits].filter((ch) => !srcDigits.includes(ch));
  assert(added.length === 0, `hookText menambah angka: ${d.hookText}`);
});

// ---------------------------------------------------------------------------
// 11. CLIP STRUCTURE — urutan editorial, indeks unik, HOOK pertama.
// ---------------------------------------------------------------------------
t("11 clipStructure: HOOK pertama, indeks unik", () => {
  const d = O.buildOpeningDecision([
    { start: 0, end: 4, text: "Halo semuanya, selamat datang di channel ini." },
    { start: 4, end: 7, text: "Hari ini saya mau kasih tips keuangan." },
    { start: 7, end: 10, text: "Jadi, saya kehilangan seluruh tabungan saya dalam semalam." },
    { start: 10, end: 13, text: "Ternyata itu semua karena satu kebiasaan kecil." },
    { start: 13, end: 16, text: "Kuncinya adalah konsisten nabung 20% gaji tiap bulan." }
  ], "id", {});
  assert(d.clipStructure.length > 0, "clipStructure kosong");
  assert(d.clipStructure[0].role === "HOOK", `role pertama=${d.clipStructure[0].role}`);
  const idxs = d.clipStructure.map((s) => s.index);
  assert(new Set(idxs).size === idxs.length, "ada indeks duplikat di struktur");
});

// ---------------------------------------------------------------------------
// 12. OPEN LOOP & PAYOFF.
// ---------------------------------------------------------------------------
t("12 openLoop true untuk pertanyaan tak terjawab; payoff saat dijawab", () => {
  const q = O.buildOpeningDecision([{ start: 0, end: 3, text: "Kenapa kebanyakan orang gagal jadi kaya?" }], "id", {});
  assert(q.openLoop === true, "openLoop seharusnya true");
  assert(q.openLoopQuestion.includes("Kenapa"), `question=${q.openLoopQuestion}`);
  const a = O.buildOpeningDecision([
    { start: 0, end: 3, text: "Kenapa kebanyakan orang gagal jadi kaya?" },
    { start: 3, end: 6, text: "Karena malas nabung." }
  ], "id", {});
  assert(a.payoff != null && a.payoff.text.includes("nabung"), `payoff=${a.payoff && a.payoff.text}`);
  assert(a.openLoop === false, "openLoop seharusnya false setelah payoff");
});

// ---------------------------------------------------------------------------
// 13. BAHASA — id, en, mixed.
// ---------------------------------------------------------------------------
t("13 bahasa id, en, mixed tidak crash dan menghasilkan keputusan", () => {
  for (const [lang, segs] of [
    ["id", [{ start: 0, end: 3, text: "Kenapa kebanyakan orang gagal?" }]],
    ["en", [{ start: 0, end: 3, text: "Why do most people fail?" }]],
    ["Mixed", [{ start: 0, end: 3, text: "Kenapa kebanyakan orang gagal? Because they never start." }]]
  ]) {
    const d = O.buildOpeningDecision(segs, lang, {});
    assert(d.strategy && d.bestOpening, `${lang}: keputusan kosong`);
  }
});

// ---------------------------------------------------------------------------
// 14. FAILURE / EDGE — transkrip kosong, satu kalimat, timestamp rusak.
// ---------------------------------------------------------------------------
t("14 edge: kosong / satu kalimat / tanpa timestamp aman", () => {
  const empty = O.buildOpeningDecision([], "id", {});
  assert(empty.strategy === "KEEP" && empty.bestOpening === "", "empty tidak aman");
  const one = O.buildOpeningDecision([{ text: "Satu keputusan bikin bisnis kolaps dalam semalam." }], "id", {});
  assert(one.bestOpening.length > 0, "satu kalimat kosong");
  const noTs = O.buildOpeningDecision([{ text: "a" }, { text: "b" }, { text: "c" }], "id", {});
  assert(typeof noTs.strategy === "string", "tanpa timestamp crash");
  assert(noTs.editorialScore >= 0 && noTs.editorialScore <= 100, `editorialScore=${noTs.editorialScore}`);
});

// ---------------------------------------------------------------------------
// 15. INTEGRASI AUTO EDIT DIRECTOR — cold open menggeser start clip.
// ---------------------------------------------------------------------------
t("15 AED: strategi COLD_OPEN mengubah start clip (openingApplied)", () => {
  const { _test } = require("./server.js");
  const transcript = [
    { start: 0, end: 3, text: "Halo semuanya, selamat datang di channel ini." },
    { start: 3, end: 6, text: "Hari ini saya mau cerita pengalaman bisnis saya." },
    { start: 6, end: 9, text: "Jadi, saya kehilangan seluruh tabungan saya dalam semalam." },
    { start: 9, end: 12, text: "Ternyata itu semua karena satu kebiasaan kecil." },
    { start: 12, end: 15, text: "Kuncinya adalah konsisten nabung 20% gaji tiap bulan." },
    { start: 15, end: 18, text: "Itu pelajaran paling berharga dalam hidup saya." },
    { start: 18, end: 21, text: "Sekarang saya mulai bangun dari nol lagi." },
    { start: 21, end: 24, text: "Dan itu mengubah cara saya melihat uang." }
  ];
  const clips = _test.analyzeTranscriptToClips(transcript, 30, 60, "Indonesia");
  const cold = clips.find((c) => c.openingStrategy === "COLD_OPEN");
  assert(cold, "tidak ada clip COLD_OPEN");
  assert(cold.openingApplied === true, `openingApplied=${cold.openingApplied}`);
  assert(cold.start > 0, `start tidak digeser: ${cold.start}`);
  assert(cold.editorialScore > 0, "editorialScore 0");
  assert(cold.bestOpening && cold.bestOpening.length > 0, "bestOpening kosong");
});

// ---------------------------------------------------------------------------
// 16. KONSISTENSI — editorial score & confidence 0..100.
// ---------------------------------------------------------------------------
t("16 editorialScore & confidence 0..100", () => {
  const d = O.buildOpeningDecision([
    { start: 0, end: 4, text: "Satu keputusan bikin bisnis kolaps dalam semalam." },
    { start: 4, end: 8, text: "Ternyata itu karena terlalu percaya pada partner." }
  ], "id", {});
  assert(d.editorialScore >= 0 && d.editorialScore <= 100, `editorialScore=${d.editorialScore}`);
  assert(d.confidence >= 0 && d.confidence <= 100, `confidence=${d.confidence}`);
});

const failed = results.filter((r) => r.status === "FAIL");
for (const r of results) console.log(`${r.status === "PASS" ? "PASS" : "FAIL"} ${r.name}`);
console.log(`\nEditorial Opening Engine: ${results.length - failed.length}/${results.length} PASS`);
if (failed.length) {
  for (const f of failed) console.error(`FAIL ${f.name}: ${f.error}`);
  process.exit(1);
}
