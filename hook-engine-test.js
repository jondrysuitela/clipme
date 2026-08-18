// ============================================================================
// Hook Engine Regression Suite (PHASE 11)
// 15 kasus dari audit forensik — memverifikasi perilaku hook engine baru.
// Jalankan: node hook-engine-test.js
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

function score(s, lang) {
  const r = HE.scoreHook(s, lang, {});
  return r;
}
function type(s, lang) {
  return HE.classifyHookType(s, lang);
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// ============================================================================
// 01. RESULT_FIRST punchy (D2) — dulu 41 (REJECT, kontradiksi prompt LLM)
//     sekarang harus lulus (>= 45).
// ============================================================================
t("01 D2 punchy result-first: skor >= 45, type REVELATION", () => {
  const s = "Satu keputusan bikin bisnis kolaps dalam semalam";
  const r = score(s, "id");
  assert(!r.excluded, "jangan excluded");
  assert(r.score >= 45, `score=${r.score}, harus >= 45`);
  assert(type(s, "id") === "REVELATION", `type=${type(s, "id")}`);
});

// ============================================================================
// 02. OBSERVATION understated (A5) — dulu 41 (REJECT); observasi tajam harus
//     dihargai sebagai hook relatability yang kuat.
// ============================================================================
t("02 A5 understated observation: skor >= 45, type CONTRAST", () => {
  const s = "Orang kaya membeli aset, orang miskin membeli gaya hidup";
  const r = score(s, "id");
  assert(!r.excluded, "jangan excluded");
  assert(r.score >= 45, `score=${r.score}, harus >= 45`);
  assert(type(s, "id") === "CONTRAST", `type=${type(s, "id")}`);
});

// ============================================================================
// 03. Specificity + density tinggi (A1) — skor tinggi, bukan sekadar keyword.
// ============================================================================
t("03 A1 specific: skor >= 45, specificity evidence > 0", () => {
  const s = "5 kebiasaan kecil bikin saya menabung 2 juta dalam sebulan";
  const r = score(s, "id");
  assert(r.score >= 45, `score=${r.score}`);
  assert(r.evidence.specificity >= 6, `specificity=${r.evidence.specificity}`);
});

// ============================================================================
// 04. Keyword-stuffing "ternyata" x3 (B1) — dulu 53 PASS; sekarang ditolak
//     (repetition penalty + cap 45).
// ============================================================================
t("04 B1 keyword-stuffing: skor < 45 (anti gaming)", () => {
  const s = "Ternyata ternyata ternyata masalah ternyata solusi ternyata uang ternyata kaya";
  const r = score(s, "id");
  assert(!r.excluded, "jangan excluded (harus dinilai, bukan dicegat)");
  assert(r.score < 45, `score=${r.score}, harus < 45`);
  assert(r.penalties.repetition > 0, "harus ada repetition penalty");
});

// ============================================================================
// 05. Fake curiosity tanpa specificity (A2) — dulu 50 PASS; sekarang lemah.
// ============================================================================
t("05 A2 fake curiosity: skor < 45 (vague tanpa evidence)", () => {
  const s = "Banyak hal yang jarang dibahas orang tentang cara jadi kaya yang sukses";
  const r = score(s, "id");
  assert(r.score < 45, `score=${r.score}, harus < 45`);
});

// ============================================================================
// 06. Greeting opener (C1) — dulu 47 PASS; sekarang EXCLUDED.
// ============================================================================
t("06 C1 greeting: excluded (reason=greeting)", () => {
  const r = score("Halo guys, di video kali ini saya bakal bahas 5 cara jadi kaya", "id");
  assert(r.excluded && r.reason === "greeting", `excluded=${r.excluded}, reason=${r.reason}`);
});

// ============================================================================
// 07. Self-intro opener — excluded.
// ============================================================================
t("07 self-intro: excluded", () => {
  const r = score("Nama saya Budi, kali ini saya akan menjelaskan cara investasi", "id");
  assert(r.excluded && r.reason === "selfIntro", `reason=${r.reason}`);
});

// ============================================================================
// 08. CTA opener — excluded.
// ============================================================================
t("08 CTA: excluded", () => {
  const r = score("Jangan lupa subscribe channel ini ya teman-teman", "id");
  assert(r.excluded && r.reason === "cta", `reason=${r.reason}`);
});

// ============================================================================
// 08b. FALSE POSITIVE guard — hook sah TIDAK boleh ter-exclude hanya karena
//      mengandung kata CTA/self-intro ("like", "share", "komentar", "di video
//      ini") di tengah kalimat. Ini bug yang ditemukan saat audit upgrade.
// ============================================================================
t("08b hook sah dgn 'like/share' di tengah TIDAK excluded", () => {
  const r = score("Kenapa video bisa bikin orang like dan share dalam semalam", "id");
  assert(!r.excluded, `excluded=${r.excluded} reason=${r.reason}`);
});
t("08c hook sah dgn 'komentar' diawal TIDAK excluded", () => {
  const r = score("Komentar pedas justru bikin video makin viral", "id");
  assert(!r.excluded, `excluded=${r.excluded} reason=${r.reason}`);
});
t("08d CTA single-word pendek tetap excluded", () => {
  const r = score("Subscribe dulu ya sebelum lanjut", "id");
  assert(r.excluded && r.reason === "cta", `reason=${r.reason}`);
});

// ============================================================================
// 09. Filler opener ("Jadi gini ya ...") — skor rendah.
// ============================================================================
t("09 filler opener: skor < 40", () => {
  const r = score("Jadi gini ya, pertama kita harus paham dasar dulu", "id");
  assert(r.score < 40, `score=${r.score}`);
});

// ============================================================================
// 10. QUESTION hook — curiosity gap besar (bukan self-answered), type QUESTION.
// ============================================================================
t("10 QUESTION hook: curiosity evidence >= 10, type QUESTION", () => {
  const s = "Kenapa kebanyakan orang gagal jadi kaya?";
  const r = score(s, "id");
  assert(type(s, "id") === "QUESTION", `type=${type(s, "id")}`);
  assert(r.evidence.curiosity >= 10, `curiosity=${r.evidence.curiosity}`);
});

// ============================================================================
// 11. PAYOFF VALIDATION — hook yang dijawab clip harus fulfilled, yang tidak
//     harus rendah.
// ============================================================================
t("11 payoff fulfilled bila clip menjawab hook", () => {
  const sentences = [
    "Kenapa kebanyakan orang gagal jadi kaya?",
    "Ternyata jawabannya cuma satu kebiasaan kecil.",
    "Kebiasaan itu mengubah cara pandang saya soal uang."
  ];
  const p = HE.validatePayoff(sentences[0], sentences, "id");
  assert(p.fulfilled, `confidence=${p.confidence}, harus fulfilled`);
  assert(p.payoffSentence && p.payoffSentence !== "", "payoffSentence tidak boleh kosong");
});

t("11b payoff rendah bila hook tidak dijawab", () => {
  // Kalimat kedua TIDAK memuat marker payoff apa pun -> tidak fulfilled.
  const sentences = [
    "Kenapa kebanyakan orang gagal jadi kaya?",
    "Saya baru saja makan nasi goreng di warung dekat rumah."
  ];
  const p = HE.validatePayoff(sentences[0], sentences, "id");
  assert(!p.fulfilled, `confidence=${p.confidence}, seharusnya tidak fulfilled`);
});

t("11c payoff TERFULFILL bila marker jawaban hadir", () => {
  const sentences = [
    "Kenapa kebanyakan orang gagal jadi kaya?",
    "Ternyata jawabannya cuma satu kebiasaan kecil yang jarang disadari.",
    "Kebiasaan itu mengubah cara pandang saya soal uang."
  ];
  const p = HE.validatePayoff(sentences[0], sentences, "id");
  assert(p.fulfilled, `confidence=${p.confidence}, harus fulfilled`);
});

// ============================================================================
// 12. SELECTION — kalimat terkuat dipilih, hookReordered=true, confidence.
// ============================================================================
t("12 selection memilih kalimat terkuat (reorder)", () => {
  const sents = [
    "Jadi gini teman-teman, di video ini saya mau kasih tips.",
    "Kenapa kebanyakan orang gagal jadi kaya?",
    "Ternyata jawabannya cuma satu kebiasaan kecil yang jarang disadari."
  ];
  const r = HE.selectHook(sents, "id", {});
  assert(r.reordered, "harus reordered (kalimat pertama lemah)");
  assert(r.hook.includes("Kenapa") || r.hook.includes("kebiasaan"), `hook=${r.hook}`);
  assert(r.confidence > 0, "confidence harus > 0");
  assert(r.type && HE.HOOK_TYPES.includes(r.type), `type=${r.type}`);
  assert(r.payoff && typeof r.payoff.confidence === "number", "payoff object missing");
});

// ============================================================================
// 13. SOURCE FIDELITY — recommendedHook = minimal-edit, TIDAK mengarang.
//     Template mati ("Kisah ...", "Cara halo ...", "? palsu") harus hilang.
// ============================================================================
t("13 normalizeHook tidak mengarang template", () => {
  const cases = [
    ["Jadi gini ya, pertama kita harus paham dasar dulu", "id"],
    ["Kenapa kebanyakan orang gagal jadi kaya", "id"],
    ["Ternyata kunci sukses itu cuma satu kebiasaan kecil", "id"]
  ];
  for (const [s, lang] of cases) {
    const n = HE.normalizeHook(s, lang, {});
    const t = n.text;
    assert(t.length > 0, "normalize menghasilkan string kosong");
    assert(!/^(Kisah|Cara halo|Kisah padahal)/i.test(t), `template tersisa: ${t}`);
    assert(!/\?$/.test(t) && !/[?]/.test(t), `tanda tanya palsu: ${t}`);
  }
});

// ============================================================================
// 14. CONTEXT INDEPENDENCE — deictic/pronoun tanpa antecedent diberi penalty.
// ============================================================================
t("14 deictic reference diberi penalty", () => {
  const r = score("Seperti yang tadi saya bilang, ini cara yang benar", "id");
  assert(r.penalties.deictic > 0, "deictic penalty hilang");
});

t("14b pronoun tanpa antecedent diberi penalty", () => {
  const r = score("Ini mengubah hidup saya banget", "id", {});
  assert(r.penalties.pronounNoAntecedent > 0, "pronoun penalty hilang");
});

// ============================================================================
// 15. DIVERSITY / DEDUP — dua clip dengan hook mirip di-dedup.
// ============================================================================
t("15 diversifyHooks mendedup hook yang mirip", () => {
  // Dua hook HAMPIR IDENTIK secara kata -> Jaccard >= 0.6 -> clip kedua
  // harus beralih ke kandidat alternatif.
  const clips = [
    { hook: "Kenapa kebanyakan orang gagal jadi kaya?", candidates: [
      { sentence: "Kenapa kebanyakan orang gagal jadi kaya?", score: 51, excluded: false },
      { sentence: "Ternyata kebiasaan kecil mengubah segalanya", score: 44, excluded: false }
    ]},
    { hook: "Kenapa kebanyakan orang gagal menjadi kaya?", candidates: [
      { sentence: "Kenapa kebanyakan orang gagal menjadi kaya?", score: 50, excluded: false },
      { sentence: "Hutang kartu kredit adalah jebakan finansial", score: 42, excluded: false }
    ]}
  ];
  const out = HE.diversifyHooks(clips, "id");
  const h1 = String(out[0].hook || "").toLowerCase();
  const h2 = String(out[1].hook || "").toLowerCase();
  assert(h1 !== h2, `hook kedua masih sama: ${h1} | ${h2}`);
  assert(!h2.includes("kenapa kebanyakan orang gagal"), `masih mirip: ${h2}`);
});

// ============================================================================
// 16. CAPTION PIPELINE SYNC — deriveHook (caption engine) memakai engine sama.
// ============================================================================
t("16 deriveHook caption engine sinkron dengan hook engine", () => {
  const AutoCaptionEngine = require("./clipme-caption-engine.js");
  const e = AutoCaptionEngine({ style: "dynamic", fillerMode: "none", maxLines: 2, maxLineLength: 40 });
  const segs = [
    { text: "Jadi gini teman-teman, di video ini saya mau kasih tips keuangan." },
    { text: "Kenapa kebanyakan orang gagal jadi kaya?" },
    { text: "Ternyata jawabannya cuma satu kebiasaan kecil." }
  ];
  const derived = e.deriveHook(segs);
  const expected = HE.selectHook(segs.map((s) => s.text), "id", {}).recommendedHook;
  assert(derived === expected, `deriveHook="${derived}" != engine="${expected}"`);
});

// ============================================================================
// 17. clipmeAssemble di server memakai engine (integrasi).
// ============================================================================
t("17 clipmeAssemble memakai hook engine (integrasi server)", () => {
  const fs = require("fs");
  const serverSrc = fs.readFileSync("server.js", "utf8");
  assert(/hookEngineModule/.test(serverSrc), "server.js tidak memuat hookEngineModule");
  assert(/selectHook/.test(serverSrc), "clipmeAssemble tidak memakai selectHook");
  assert(!/clipmeCraftHookTitle/.test(serverSrc), "clipmeCraftHookTitle (template mati) masih ada");
  assert(!/clipmeHookCore/.test(serverSrc), "clipmeHookCore (template mati) masih ada");
  assert(!/pickOptimizedHook/.test(serverSrc), "pickOptimizedHook masih ada");
});

for (const r of results) {
  console.log(`${r.status} ${r.name}${r.error ? ` :: ${r.error}` : ""}`);
}
const failed = results.filter((r) => r.status === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);