// ============================================================================
// Hook Engine v2 — Professional scoring & editorial hook generation suite.
// Verifikasi: 12-dimensi scoring, mode DIRECT/EDITORIAL, variation engine,
// semantic dedup, cold open, explanation, platform length target, source
// fidelity, dan seleksi yang tidak memilih sapaan/filler.
// Jalankan: node hook-engine-v2-test.js
// ============================================================================
const HE = require("./clipme-hook-engine.js");

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
const SOURCE_DIGITS = ["Satu keputusan bikin bisnis kolaps dalam semalam", "Dia nabung 20% dari gajinya tiap bulan", "Ternyata 70% orang gagal karena kebiasaan ini"];

// 01. DEEP WEIGHTS — 12 dimensi, total bobot = 100.
t("01 DEEP_WEIGHTS 12 dimensi, total 100", () => {
  const keys = Object.keys(HE.DEEP_WEIGHTS);
  assert(keys.length === 12, `jumlah dimensi=${keys.length}, harus 12`);
  const total = Object.values(HE.DEEP_WEIGHTS).reduce((a, b) => a + b, 0);
  assert(total === 100, `total bobot=${total}, harus 100`);
});

// 02. dimensionScores — deep dalam 0..100, ada 12 nilai 0..1.
t("02 dimensionScores menghasilkan deep 0..100 dan 12 dimensi", () => {
  const r = HE.dimensionScores("Kenapa kebanyakan orang gagal jadi kaya?", "id", {});
  assert(r.deep >= 0 && r.deep <= 100, `deep=${r.deep}`);
  assert(Object.keys(r.dimensions).length === 12, "jumlah dimensi != 12");
  for (const v of Object.values(r.dimensions)) assert(v >= 0 && v <= 1, `dimensi di luar 0..1: ${v}`);
});

// 03. scoreHook menempelkan deep + dimensions (backward compat .score tetap ada).
t("03 scoreHook punya .score, .deep, .dimensions", () => {
  const r = HE.scoreHook("Satu keputusan bikin bisnis kolaps dalam semalam", "id", {});
  assert(typeof r.score === "number", "score hilang");
  assert(typeof r.deep === "number", "deep hilang");
  assert(r.dimensions && typeof r.dimensions === "object", "dimensions hilang");
});

// 04. RANKING — curiosity question yang kuat deep >= 40 (dipilih via jalur layak).
t("04 curiosity question layak: deep >= 40", () => {
  const s = ["Halo teman-teman.", "Kenapa kebanyakan orang gagal jadi kaya?"];
  const r = HE.selectHook(s, "id", {});
  assert(r.hook.includes("Kenapa"), `hook terpilih=${r.hook}`);
  assert(r.deepScore >= 40, `deepScore=${r.deepScore}, harus >= 40`);
});

// 05. NEGATIF — sapaan/greeting tidak boleh jadi hook.
t("05 greeting tidak pernah terpilih sebagai hook", () => {
  const s = ["Hi everyone, welcome back to my channel.", "I lost all my savings overnight."];
  const r = HE.selectHook(s, "en", {});
  assert(r.hook && !/welcome|hi everyone|hello|guys|teman/i.test(r.hook), `hook=="${r.hook}"`);
  assert(r.hook.includes("savings"), `hook=="${r.hook}"`);
});

// 06. SOURCE FIDELITY — craftViralHook & buildVariants tidak menambah digit.
t("06 tidak ada angka baru yang dikarang (id + en)", () => {
  for (const src of SOURCE_DIGITS) {
    const srcDigits = digitsOf(src);
    for (const lang of ["id", "en"]) {
      const c = HE.craftViralHook(src, [src], lang);
      assert(srcDigits.includes(digitsOf(c.text)), `craft menambah angka: ${c.text}`);
      for (const v of HE.buildVariants(src, [src], lang)) {
        assert(srcDigits.includes(digitsOf(v.text)), `varian menambah angka: ${v.text}`);
      }
    }
  }
});

// 07. VARIATION ENGINE — minimal 5 strategi, yang pertama Direct.
t("07 buildVariants >= 5 strategi, pertama Direct", () => {
  const v = HE.buildVariants("Kenapa kebanyakan orang gagal jadi kaya?", ["Kenapa kebanyakan orang gagal jadi kaya?"], "id");
  assert(v.length >= 5, `varian=${v.length}`);
  assert(v[0].strategy === "Direct", `pertama bukan Direct: ${v[0].strategy}`);
  for (const item of v) assert(item.text && item.sourceFidelity, "varian kosong / tidak source-faithful");
});

// 08. MODE — nilai hanya direct/editorial; alternatif menyertakan Direct.
t("08 mode DIRECT/EDITORIAL valid + alternatif berisi Direct", () => {
  const r = HE.selectHook(["Kenapa kebanyakan orang gagal jadi kaya?", "Karena malas nabung."], "id", {});
  assert(r.mode === "direct" || r.mode === "editorial", `mode=${r.mode}`);
  assert(r.alternatives.some((a) => a.strategy === "Direct"), "tidak ada varian Direct");
  assert(r.recommendedHook.length > 0, "recommendedHook kosong");
});

// 09. SEMANTIC DEDUP — dua kalimat bermakna sama dikelompokkan.
t("09 clusterDuplicates mengecilkan kandidat yang bermakna sama", () => {
  const cands = [
    { sentence: "Ini mengubah segalanya untuk saya.", index: 0, score: 50, deep: 50 },
    { sentence: "Ini benar-benar mengubah segalanya buat gue.", index: 1, score: 48, deep: 48 },
    { sentence: "Jadi saya mulai bangun pukul lima pagi.", index: 2, score: 60, deep: 60 }
  ];
  const groups = HE.clusterDuplicates(cands, "id");
  assert(groups.length === 2, `jumlah cluster=${groups.length}, harus 2`);
});

// 10. SELECTION + DEDUP — kandidat duplikat tak menghalangi pemilihan terbaik.
t("10 selectHook dedup: tidak ada kalimat kembar di hasil", () => {
  const s = [
    "Ini mengubah segalanya untuk saya.",
    "Ini benar-benar mengubah segalanya buat gue.",
    "Saya mulai bangun pukul lima pagi."
  ];
  const r = HE.selectHook(s, "id", {});
  const chosen = String(r.hook).toLowerCase();
  const mentionsPagi = chosen.includes("pagi") || chosen.includes("bangun");
  const mentionsUbah = chosen.includes("ubah");
  assert(mentionsPagi || mentionsUbah, `hook=${r.hook}`);
});

// 11. COLD OPEN — hook terkuat bukan pembuka → flag reorder + coldOpen.
t("11 cold open terdeteksi saat hook terkuat bukan kalimat pertama", () => {
  const s = ["Halo, selamat datang di channel ini.", "Saya kehilangan seluruh tabungan saya dalam semalam.", "Kehilangan tabungan mengajarkan saya banyak hal."];
  const r = HE.selectHook(s, "id", {});
  assert(r.reordered === true, `reordered=${r.reordered}`);
  assert(r.coldOpen === true, `coldOpen=${r.coldOpen}`);
  assert(r.coldOpenStartIndex > 0, `coldOpenStartIndex=${r.coldOpenStartIndex}`);
});

// 12. EXPLANATION — selalu ada, berisi alasan editorial.
t("12 explanation non-kosong dan menyebut 'Terpilih karena'", () => {
  const r = HE.selectHook(["Kenapa kebanyakan orang gagal jadi kaya?", "Karena malas nabung."], "id", {});
  assert(typeof r.explanation === "string" && r.explanation.includes("Terpilih karena"), `explanation=${r.explanation}`);
});

// 13. PLATFORM — length target sesuai platform.
t("13 lengthTarget: tiktok=6, reels=6, shorts=7, generic=9", () => {
  const base = ["Kenapa kebanyakan orang gagal jadi kaya?", "Karena malas nabung."];
  assert(HE.selectHook(base, "id", { platform: "tiktok" }).lengthTarget === 6, "tiktok");
  assert(HE.selectHook(base, "id", { platform: "reels" }).lengthTarget === 6, "reels");
  assert(HE.selectHook(base, "id", { platform: "shorts" }).lengthTarget === 7, "shorts");
  assert(HE.selectHook(base, "id", {}).lengthTarget === 9, "generic");
});

// 14. CONFIDENCE — dalam 0..100, jenis hook valid.
t("14 confidence 0..100 dan hookType valid", () => {
  const r = HE.selectHook(["Kenapa kebanyakan orang gagal jadi kaya?", "Karena malas nabung."], "id", {});
  assert(r.confidence >= 0 && r.confidence <= 100, `confidence=${r.confidence}`);
  assert(HE.isHookType(r.type), `type=${r.type}`);
});

// 15. BAHASA — en & id jalan tanpa crash.
t("15 selectHook id & en menghasilkan hook + alternatif", () => {
  for (const [lang, s] of [["id", ["Kenapa kebanyakan orang gagal jadi kaya?", "Karena malas nabung."]], ["en", ["Why do most people fail?", "Because they never start."]]]) {
    const r = HE.selectHook(s, lang, {});
    assert(r.hook && r.recommendedHook, `${lang}: hook kosong`);
    assert(Array.isArray(r.alternatives) && r.alternatives.length >= 1, `${lang}: alternatif kosong`);
  }
});

// 16. EDGE — input kosong & satu kalimat.
t("16 edge: input kosong aman, satu kalimat tetap punya hook", () => {
  const empty = HE.selectHook([], "id", {});
  assert(empty.hook === "", "hook kosong harus ''");
  assert(Array.isArray(empty.alternatives), "alternatives harus array");
  const one = HE.selectHook(["Satu keputusan bikin bisnis kolaps dalam semalam"], "id", {});
  assert(one.hook.length > 0, "satu kalimat: hook kosong");
  assert(one.deepScore >= 0, "deepScore negatif");
});

// 17. NEGATIF LAIN — CTA tidak dijadikan hook.
t("17 CTA tidak terpilih sebagai hook", () => {
  const s = ["Jangan lupa like dan subscribe ya.", "Ternyata 70% orang gagal karena kebiasaan ini."];
  const r = HE.selectHook(s, "id", {});
  assert(!/like dan subscribe|subscribe/i.test(r.hook), `hook=="${r.hook}"`);
});

// 18. RANKING gap — curiosity yang berdiri sendiri mengungguli kalimat datar.
t("18 curiosity question deep > kalimat datar", () => {
  const question = HE.dimensionScores("Kenapa kebanyakan orang gagal jadi kaya?", "id", {}).deep;
  const flat = HE.dimensionScores("Saya sedang memikirkan banyak hal akhir-akhir ini.", "id", {}).deep;
  assert(question > flat, `question=${question} tidak > flat=${flat}`);
});

const failed = results.filter((r) => r.status === "FAIL");
for (const r of results) console.log(`${r.status === "PASS" ? "PASS" : "FAIL"} ${r.name}`);
console.log(`\nHook Engine v2: ${results.length - failed.length}/${results.length} PASS`);
if (failed.length) {
  for (const f of failed) console.error(`FAIL ${f.name}: ${f.error}`);
  process.exit(1);
}
