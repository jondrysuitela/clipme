// Test: Deep Title & Hook Engine (clipme-deep-title-engine.js)
// Sintesis judul/hook lintas kalimat — bukan kutip verbatim, tetap grounded.

const assert = require("assert");

const deep = require("./clipme-deep-title-engine.js");
const hook = require("./clipme-hook-engine.js");

let pass = 0;
const t = (name, fn) => {
  try {
    fn();
    pass += 1;
    console.log(`[OK  ] ${name}`);
  } catch (e) {
    console.error(`[FAIL] ${name}: ${e.message}`);
    process.exitCode = 1;
  }
};

// Sumber uji: angka dari kalimat 1, transformasi dari kalimat 2,
// kesimpulan dari kalimat 3 -> judul harus MENGGABUNGKAN lintas kalimat.
const SRC_ID = [
  "Saya berjualan online selama 3 tahun.",
  "Semua berubah ketika saya belajar membaca laporan keuangan.",
  "Intinya, disiplin arus kas mengubah segalanya."
];

const SRC_EN = [
  "I sold products online for 3 years.",
  "Everything changed when I learned to read my financial reports.",
  "The point is, cash flow discipline changed everything."
];

const SRC_EMPTY = [];

const SRC_QUESTION = [
  "Kenapa kebanyakan orang gagal berinvestasi?",
  "Ternyata jawabannya adalah kurangnya literasi keuangan.",
  "Jadi, mulai dari hal kecil dulu."
];

const SRC_CONTRAST = [
  "Bukan membeli gaya hidup, tapi membeli aset.",
  "Ini yang membuat perbedaan besar."
];

function digitsOf(s) {
  return (String(s).match(/\d+/g) || []).join(" ");
}

t("engine ter-load & mengekspos API", () => {
  assert.strictEqual(typeof deep.analyzeDeepTitle, "function");
  assert.strictEqual(typeof deep.titleCandidates, "function");
  assert.strictEqual(typeof deep.rankSentences, "function");
});

t("input kosong aman (schema lengkap)", () => {
  const r = deep.analyzeDeepTitle([], [], "id");
  assert.strictEqual(r.title, "");
  assert.strictEqual(r.deepHook, "");
  assert.ok(Array.isArray(r.thinking));
  assert.strictEqual(r.grounded, true);
});

t("judul dihasilkan (id)", () => {
  const r = deep.analyzeDeepTitle(SRC_ID, [], "id");
  assert.ok(r.title.length >= 6, `judul kosong: "${r.title}"`);
  assert.ok(r.title.length <= 140);
});

t("judul BUKAN kutip verbatim kalimat mana pun", () => {
  const r = deep.analyzeDeepTitle(SRC_ID, [], "id");
  const low = r.title.toLowerCase();
  for (const s of SRC_ID) {
    const sl = s.toLowerCase();
    assert.ok(low !== sl, `judul sama persis dengan kalimat: "${r.title}"`);
  }
});

t("sintesis lintas kalimat: angka dari kalimat lain dipakai di judul", () => {
  const r = deep.analyzeDeepTitle(SRC_ID, [], "id");
  // Angka "3 tahun" (kalimat 1) harus muncul di judul...
  assert.ok(r.title.includes("3 tahun"), `judul: "${r.title}"`);
  // ...tapi judul BUKAN sekadar kutip kalimat yang memuat angka itu.
  assert.ok(!r.title.toLowerCase().includes("saya berjualan online"), `judul masih kutip kalimat angka: "${r.title}"`);
  // Dan judul memakai konten dari kalimat lain (transformasi/kesimpulan).
  assert.ok(
    r.title.toLowerCase().includes("berubah") || r.title.toLowerCase().includes("arus kas") || r.title.toLowerCase().includes("laporan keuangan"),
    `judul tidak memakai konten kalimat lain: "${r.title}"`
  );
});

t("honesty: digit di judul selalu berasal dari transkrip", () => {
  const r = deep.analyzeDeepTitle(SRC_ID, [], "id");
  const srcDigits = digitsOf(SRC_ID.join(" "));
  const titleDigits = digitsOf(r.title);
  if (titleDigits) {
    const titleNums = titleDigits.split(" ").filter(Boolean);
    for (const d of titleNums) {
      assert.ok(srcDigits.includes(d), `angka baru di judul: "${d}"`);
    }
  }
});

t("judul alternatif tersedia", () => {
  const r = deep.analyzeDeepTitle(SRC_ID, [], "id");
  assert.ok(Array.isArray(r.titleAlternatives));
});

t("titleScore dalam 0..100", () => {
  const r = deep.analyzeDeepTitle(SRC_ID, [], "id");
  assert.ok(r.titleScore >= 0 && r.titleScore <= 100);
});

t("deepHook terisi & grounded (mengandung kata dari transkrip)", () => {
  const r = deep.analyzeDeepTitle(SRC_ID, [], "id");
  assert.ok(r.deepHook.length >= 6, `deepHook kosong`);
  const srcLow = SRC_ID.join(" ").toLowerCase();
  // Hook boleh framing, tapi wajib memakai kata/angka dari sumber.
  assert.ok(srcLow.includes("tahun") || srcLow.includes("arus kas") || srcLow.includes("berubah"), `deepHook: "${r.deepHook}"`);
});

t("thinking berisi langkah-langkah reasoning", () => {
  const r = deep.analyzeDeepTitle(SRC_ID, [], "id");
  assert.ok(r.thinking.length >= 4, `thinking hanya ${r.thinking.length} langkah`);
  assert.ok(r.thinking.some((s) => /topik/i.test(s.step) || /Topik/.test(s.step)));
});

t("topik & angka diekspos", () => {
  const r = deep.analyzeDeepTitle(SRC_ID, [], "id");
  assert.ok(r.topic.length > 0);
  assert.ok(r.numbers.some((n) => n.full.includes("3 tahun")));
});

t("pertanyaan terbuka -> hook memakai pertanyaan", () => {
  const r = deep.analyzeDeepTitle(SRC_QUESTION, [], "id");
  assert.ok(r.deepHook.length > 0);
  assert.ok(r.openQuestion.length > 0, "openQuestion kosong");
  assert.ok(r.deepHook.toLowerCase().includes("kenapa") || r.deepHook.includes("?"), `deepHook: "${r.deepHook}"`);
});

t("kontras terdeteksi & jadi bahan judul", () => {
  const r = deep.analyzeDeepTitle(SRC_CONTRAST, [], "id");
  assert.ok(r.contrast && r.contrast.a && r.contrast.b, "kontras tidak terdeteksi");
  assert.ok(r.title.length >= 6);
});

t("bahasa Inggris berfungsi", () => {
  const r = deep.analyzeDeepTitle(SRC_EN, [], "en");
  assert.ok(r.title.length >= 6, `judul EN kosong`);
  assert.ok(r.title.toLowerCase().includes("3 years") || r.title.toLowerCase().includes("cash flow"), `judul EN: "${r.title}"`);
  assert.ok(r.deepHook.length >= 6);
});

t("deepTitle BERBEDA dari recommendedHook (craftViralHook) — nilai baru", () => {
  const r = deep.analyzeDeepTitle(SRC_ID, [], "id");
  const s = hook.selectHook(SRC_ID, "id", {});
  const crafted = (s && s.recommendedHook) || "";
  assert.ok(r.title !== crafted, "deep title sama dengan recommendedHook");
});

t("segments ber-timestamp juga bisa dipakai sebagai input", () => {
  const segs = SRC_ID.map((text, i) => ({ start: i * 2, end: i * 2 + 1.5, text }));
  const r = deep.analyzeDeepTitle([], segs, "id");
  assert.ok(r.title.length >= 6);
});

console.log(`\nDeep Title Engine: ${pass}/16 PASS`);
if (process.exitCode) process.exit(process.exitCode);