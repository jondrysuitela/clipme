// Unit test: Clipper Studio Core Intelligence Director (Step 1-3).
// Menggunakan Hook Engine ASLI + lexicon mini; tanpa server, tanpa mock AI.
const assert = require("assert");
const path = require("path");

const director = require("./clipme-director");
const hookEngine = require("./clipme-hook-engine");

// Lexicon mini (subset semantik dari CLIPME_WORDS server) untuk sinyal story.
const MINI_WORDS = {
  id: {
    payoff: ["jadi", "kesimpulannya", "akhirnya", "artinya"],
    reveal: ["ternyata", "faktanya", "rahasianya"],
    problem: ["masalah", "gagal", "kehilangan", "salah"],
    value: ["cara", "tips", "pelajaran"],
    story: ["dulu", "waktu itu", "ceritanya"],
    questionW: ["kenapa", "bagaimana", "apa"]
  }
};

director.initDirector({ hookEngineModule: hookEngine, clipmeWords: MINI_WORDS });

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`[OK  ] ${name}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.error(`[FAIL] ${name}\n  -> ${error.message}`);
    process.exitCode = 1;
  }
}

// Transkrip sintetis (detik): hook di 10s, payoff di ~52s, natural pause setelahnya.
const T = [
  { start: 0.0, end: 4.2, text: "Selamat datang kembali di channel kita." },
  { start: 4.3, end: 6.1, text: "Hari ini biasa saja sih." },
  { start: 10.0, end: 15.5, text: "Waktu itu saya kehilangan semua uang saya karena satu kesalahan besar." },
  { start: 16.0, end: 22.0, text: "Dulu saya pikir cara bisnis seperti ini akan berhasil." },
  { start: 22.6, end: 30.4, text: "Ternyata masalahnya ada pada cara saya menghitung margin." },
  { start: 31.0, end: 38.8, text: "Bagaimana bisa sebuah bisnis gagal padahal penjualan ramai." },
  { start: 39.2, end: 46.0, text: "Ceritanya saya terus mencoba tips yang salah selama berbulan-bulan." },
  { start: 48.9, end: 55.3, text: "Jadi kesimpulannya margin adalah nyawa dari bisnis kamu." },
  { start: 56.0, end: 60.0, text: "Itu pelajaran paling mahal yang pernah saya dapat.", words: [{ text: "Itu", start: 56.0, end: 56.4, speaker: "SPK_1" }] },
  { start: 66.0, end: 71.0, text: "Topik lain yang tidak berkaitan sama sekali dengan cerita tadi." },
  { start: 72.0, end: 78.0, text: "Penutup video dan ajakan subscribe untuk semua orang." }
];
// Tambahkan speaker_id utk segmen pertama agar deteksi speaker teruji:
T[0].words = [{ text: "Selamat", start: 0.0, end: 0.6, speaker_id: "SPK_1" }];

test("step1: VU menggabungkan segmen rapat jadi kalimat logis", () => {
  const vu = director.buildVideoUnderstanding(T, 80);
  assert.ok(vu.sentences.length < T.length, `kalimat (${vu.sentences.length}) harus < segmen (${T.length})`);
  const merged = vu.sentences.find((s) => s.text.includes("margin"));
  assert.ok(merged && merged.segmentIndexes.length >= 1);
});

test("step1: speakers & pauses dideteksi; scenes/emotion jujur null", () => {
  const vu = director.buildVideoUnderstanding(T, 80);
  assert.ok(vu.speakers.some((s) => s.id === "SPK_1"), "speaker SPK_1 terdeteksi");
  assert.ok(vu.pauses.length >= 2, `pauses=${vu.pauses.length}`);
  assert.strictEqual(vu.scenes, null);
  assert.strictEqual(vu.emotion, null);
});

test("step2: detectHooks pakai Hook Engine asli — hasil punya evidence & urutan", () => {
  const vu = director.buildVideoUnderstanding(T, 80);
  const r = director.detectHooks(vu, "id");
  assert.strictEqual(r.available, true);
  assert.ok(r.hooks.length >= 1, "minimal satu hook kandidat");
  for (const h of r.hooks) {
    assert.ok(h.strength >= 35);
    assert.ok(h.evidence.length > 0);
    assert.ok(h.confidence >= 0 && h.confidence <= 1);
    assert.ok(Number.isFinite(h.start) && Number.isFinite(h.end));
  }
  for (let i = 1; i < r.hooks.length; i++) {
    assert.ok(r.hooks[i - 1].strength >= r.hooks[i].strength, "urut menurun");
  }
});

test("step3: STORY DIRECTOR menemukan payoff & natural ending", () => {
  const vu = director.buildVideoUnderstanding(T, 80);
  const { hooks } = director.detectHooks(vu, "id");
  const hook = hooks[0];
  const story = director.directStory(vu, hook, { maxDuration: 90 });
  assert.ok(story, "story dibuat");
  assert.strictEqual(story.structure.payoffFound, true, "payoff 'jadi/kesimpulannya' harus ketemu");
  assert.ok(story.structure.completeness >= 70, `completeness=${story.structure.completeness}`);
  assert.ok(/margin|pelajaran/i.test(story.structure.endingSentence), "ending di sekitar payoff");
});

test("step3: maxDuration HARD CEILING — semua akhir <= ceiling", () => {
  const vu = director.buildVideoUnderstanding(T, 200);
  // perpanjang transkrip sintetis sampai 190s
  for (let t = 80; t <= 190; t += 10) {
    vu.sentences.push({ index: 900 + t, start: t, end: t + 8, text: `Kalimat tambahan nomor ${t}.`, speakerId: "", wordCount: 4 });
  }
  const { hooks } = director.detectHooks(vu, "id");
  const stories = director.directStories(vu, hooks.slice(0, 5), { maxDuration: 90, limit: 5 }).stories;
  assert.ok(stories.length >= 1);
  for (const s of stories) {
    assert.ok(s.duration <= 90, `durasi ${s.duration} > ceiling`);
    assert.ok(s.end - s.start === s.duration || Math.abs(s.end - s.start - s.duration) < 0.11);
    assert.ok(s.structure.completeness > 0);
  }
});

test("step3: durasi variatif — bukan semua sama dengan target", () => {
  const vu = director.buildVideoUnderstanding(T, 200);
  for (let t = 80; t <= 190; t += 10) {
    vu.sentences.push({ index: 900 + t, start: t, end: t + 8, text: `Isi tambahan ${t}.`, speakerId: "", wordCount: 3 });
  }
  const { hooks } = director.detectHooks(vu, "id");
  const stories = director.directStories(vu, hooks, { maxDuration: 90, limit: 8 }).stories;
  const durs = new Set(stories.map((s) => s.duration));
  assert.ok(durs.size >= 2 || stories.length < 2, "durasi antar story harus bervariasi");
});

test("p9-guard: tanpa engine → tersedia=false, tanpa crash", () => {
  const savedHook = require.cache[require.resolve("./clipme-hook-engine")];
  delete require.cache[require.resolve("./clipme-hook-engine")];
  delete require.cache[require.resolve("./clipme-director")];
  const d2 = require("./clipme-director");
  d2.initDirector({}); // tanpa hook engine
  const vu = d2.buildVideoUnderstanding(T, 80);
  const r = d2.detectHooks(vu, "id");
  assert.strictEqual(r.available, false);
  if (savedHook) require.cache[require.resolve("./clipme-hook-engine")] = savedHook;
});

// ---------- STEP 4-6 ----------
test("step4: candidate generation variatif — semua <= ceiling & ada >1 varian", () => {
  const vu = director.buildVideoUnderstanding(T, 200);
  for (let t = 80; t <= 190; t += 10) {
    vu.sentences.push({ index: 900 + t, start: t, end: t + 8, text: `Kalimat tambahan nomor ${t}.`, speakerId: "", wordCount: 4 });
  }
  const { hooks } = director.detectHooks(vu, "id");
  const { stories } = director.directStories(vu, hooks, { maxDuration: 90, limit: 6 });
  const cands = director.generateCandidates(vu, stories, { maxDuration: 90 });
  assert.ok(cands.length >= 2, `kandidat=${cands.length}`);
  for (const c of cands) {
    assert.ok(c.duration <= 90, `durasi ${c.duration} > 90`);
    assert.ok(["natural", "extended", "tightened"].includes(c.kind));
  }
  const kinds = new Set(cands.map((c) => c.kind));
  assert.ok(kinds.size >= 2, "harus ada lebih dari satu jenis varian");
});

test("step5: scoring deterministik, dimensi valid, overall tanpa dimensi null", () => {
  const vu = director.buildVideoUnderstanding(T, 200);
  const { hooks } = director.detectHooks(vu, "id");
  const { stories } = director.directStories(vu, hooks.slice(0, 3), {});
  const cands = director.generateCandidates(vu, stories, { maxDuration: 90 });
  assert.ok(cands.length >= 1);
  const s1 = director.scoreCandidate(vu, cands[0], { langKey: "id" });
  const s2 = director.scoreCandidate(vu, cands[0], { langKey: "id" });
  assert.deepStrictEqual(s1, s2, "deterministik");
  for (const k of ["hook", "retention", "completeness", "pacing", "overall"]) {
    assert.ok(s1[k] >= 0 && s1[k] <= 100, `${k}=${s1[k]}`);
  }
  if (s1.emotion != null) assert.ok(s1.emotion >= 0 && s1.emotion <= 100);
  // tanpa focus → topicRelevance null
  assert.strictEqual(s1.topicRelevance, null);
});

test("step6: focus mengubah selectionScore TANPA menyentuh score/overall", () => {
  const vu = director.buildVideoUnderstanding(T, 200);
  const { hooks } = director.detectHooks(vu, "id");
  const { stories } = director.directStories(vu, hooks.slice(0, 3), {});
  const cands = director.generateCandidates(vu, stories, { maxDuration: 90 })
    .sort((a, b) => a.start - b.start);
  const a = cands[0];
  const noFocus = director.scoreCandidate(vu, a, { langKey: "id" });
  const withFocus = director.scoreCandidate(vu, a, { langKey: "id", focus: "margin bisnis" });
  assert.strictEqual(noFocus.overall, withFocus.overall, "overall tidak boleh berubah oleh focus");
  assert.strictEqual(noFocus.topicRelevance, null);
  assert.ok(withFocus.topicRelevance >= 0, "focus relevance terisi saat focus diberikan");

  const selNo = director.computeSelectionScore({ ...noFocus }, {});
  const selYes = director.computeSelectionScore({ ...withFocus }, {});
  // kandidat ini memuat kata 'margin' → relevance tinggi → selection naik
  assert.ok(selYes >= selNo, `selection dengan fokus (${selYes}) >= tanpa (${selNo})`);
});

test("step6: hook strategy delta terbatas & balanced = netral", () => {
  const base = { overall: 80, topicRelevance: null, _hookType: "CURIOSITY" };
  const neutral = director.computeSelectionScore({ ...base }, { hookStrategy: "balanced" });
  const match = director.computeSelectionScore({ ...base }, { hookStrategy: "curiosity" });
  const miss = director.computeSelectionScore({ ...base }, { hookStrategy: "educational" });
  assert.strictEqual(neutral, 80);
  assert.ok(match === Math.min(100, 88), `match=${match}`);
  assert.ok(miss === Math.max(0, 72), `miss=${miss}`);
  assert.ok(director.strategyMatches("controversy", "CURIOSITY") === 0);
  assert.ok(director.strategyMatches("curiosity", "CURIOSITY") === 1);
  assert.strictEqual(director.strategyMatches("unknown", ""), null);
});

test("step6: rankCandidates dedup konten + explain hanya dari flag nyata", () => {
  const vu = director.buildVideoUnderstanding(T, 200);
  const { hooks } = director.detectHooks(vu, "id");
  const { stories } = director.directStories(vu, hooks, { maxDuration: 90, limit: 8 });
  const raw = director.generateCandidates(vu, stories, { maxDuration: 90 });
  const ranked = director.rankCandidates(vu, raw, { maxDuration: 90, limit: 8 });
  assert.ok(ranked.length >= 1);
  assert.ok(ranked.length <= raw.length, "dedup konten memangkas kemiripan");
  // urut menurun selectionScore
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(ranked[i - 1].scoring.selectionScore >= ranked[i].scoring.selectionScore);
  }
  const top = ranked[0];
  assert.ok(Array.isArray(top.explain.strengths));
  assert.ok(top.explain.reason.some((r) => /Hook|Completeness|Durasi/.test(r)));
  // strengths hanya boleh muncul bila kondisinya benar
  if (top.scoring.hook < 70) assert.ok(!top.explain.strengths.includes("Strong opening"));
});
if (process.exitCode) process.exit(1);

console.log(`Director Step1-6: ${results.filter((r) => r.ok).length}/${results.length} PASS`);
