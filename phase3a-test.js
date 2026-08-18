const fs = require("fs");
const engineFactory = require("./clipme-caption-engine.js");

const engine = engineFactory();

const results = [];
function t(name, fn) {
  try {
    fn();
    results.push({ name, status: "PASS" });
  } catch (e) {
    results.push({ name, status: "FAIL", error: String((e && e.message) || e) });
  }
}

// ---- helpers ----
const r3 = (x) => Math.round(x * 1000) / 1000;
function W(specs) {
  return specs.map(([text, start, end]) => ({ text, start, end, speaker_id: "s1" }));
}
function run(words, fillerMode) {
  const inst = engineFactory({ fillerMode: fillerMode || "none", style: "dynamic", maxLines: 2, maxLineLength: 40 });
  return inst.processHeuristic(words, {}, fillerMode || "none", "s1").segments;
}
function allText(segs) {
  return segs.map((s) => s.text).join(" ");
}
function wordsOfSeg(seg) {
  return (Array.isArray(seg.words) ? seg.words : []).map((w) => w.text).join(" ");
}

// ---- server functions for eventWords / relative-timestamp scenarios ----
const serverSrc = fs.readFileSync("server.js", "utf8");
function extractFrom(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found`);
  const openParen = start + `function ${name}`.length;
  const closeParen = src.indexOf(")", openParen);
  const params = src.slice(openParen + 1, closeParen);
  const bodyStart = src.indexOf("{", closeParen) + 1;
  let depth = 1, i = bodyStart;
  while (i < src.length && depth > 0) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") depth--;
    i++;
  }
  return { params, body: src.slice(bodyStart, i - 1) };
}
function serverFn(name) {
  return extractFrom(serverSrc, name);
}
const sandbox = new Function(
  ["flattenTranscriptWords", "normalizeSegmentWordTimestamps"].map((n) => {
    const { params, body } = serverFn(n);
    return `function ${n}(${params}) { ${body} }`;
  }).join("\n") +
    "\nreturn { flattenTranscriptWords, normalizeSegmentWordTimestamps };"
)();

// =====================================================================
// 01. NORMAL SPEECH: segments natural, not fixed-N, no word lost
// =====================================================================
t("01 normal speech: semua kata terliput, 2-7 kata, tidak dipecah fixed-N", () => {
  const segs = run(W([
    ["Kalau", 0, 0.25], ["besok", 0.25, 0.5], ["hujan", 0.5, 0.8], ["kita", 0.8, 1.1],
    ["tidak", 1.1, 1.35], ["jadi", 1.35, 1.6], ["pergi", 1.6, 1.9], ["ke", 1.9, 2.0],
    ["pantai", 2.0, 2.3], ["sekarang", 2.3, 2.55], ["ya", 2.55, 2.8]
  ]));
  const joined = allText(segs);
  if (joined !== "Kalau besok hujan kita tidak jadi pergi ke pantai sekarang ya")
    throw new Error(`teks rusak/kehilangan kata: "${joined}"`);
  for (const s of segs) {
    if (s.wordCount < 2 || s.wordCount > 7)
      throw new Error(`caption ${s.id} berisi ${s.wordCount} kata (di luar 2-7)`);
  }
  // kalimat panjang 11 kata -> beberapa caption readable, bukan 1 raksasa
  if (segs.length < 2) throw new Error(`kalimat 11 kata harus > 1 caption: ${segs.length}`);
  for (let i = 1; i < segs.length; i++) {
    if (segs[i].start < segs[i - 1].end)
      throw new Error(`segmen ${i} overlap/salah urut: ${segs[i - 1].start}-${segs[i].start}`);
  }
});

// =====================================================================
// 02. FAST SPEECH: captions lebih pendek (durasi) daripada slow
// =====================================================================
t("02 fast speech: rata-rata durasi caption < slow speech", () => {
  const fast = run(W([
    ["Kalau", 0, 0.2], ["ukurannya", 0.2, 0.4], ["nggak", 0.4, 0.6], ["bakal", 0.6, 0.8],
    ["bisa", 0.8, 1.0], ["kita", 1.0, 1.2], ["custom", 1.2, 1.4], ["ke", 1.4, 1.5],
    ["tepi", 1.5, 1.7], ["laut", 1.7, 1.9]
  ]));
  const slow = run(W([
    ["Kalau", 0, 0.55], ["ukurannya", 0.55, 1.1], ["nggak", 1.1, 1.65], ["bakal", 1.65, 2.2],
    ["bisa", 2.2, 2.75], ["kita", 2.75, 3.3], ["custom", 3.3, 3.85], ["ke", 3.85, 4.1],
    ["tepi", 4.1, 4.65], ["laut", 4.65, 5.2]
  ]));
  const avgDur = (segs) => segs.reduce((a, s) => a + (s.end - s.start), 0) / segs.length;
  const fastAvg = avgDur(fast);
  const slowAvg = avgDur(slow);
  if (!(fastAvg < slowAvg))
    throw new Error(`fast avg ${fastAvg.toFixed(2)}s harus < slow avg ${slowAvg.toFixed(2)}s`);
  if (allText(fast) !== "Kalau ukurannya nggak bakal bisa kita custom ke tepi laut")
    throw new Error(`fast teks rusak: "${allText(fast)}"`);
});

// =====================================================================
// 03. SLOW SPEECH: segmen lebih panjang & lebih sedikit
// =====================================================================
t("03 slow speech: caption lebih panjang (durasi) dari fast", () => {
  const fast = run(W([
    ["Kalau", 0, 0.2], ["ukurannya", 0.2, 0.4], ["nggak", 0.4, 0.6], ["bakal", 0.6, 0.8],
    ["bisa", 0.8, 1.0], ["kita", 1.0, 1.2], ["custom", 1.2, 1.4], ["ke", 1.4, 1.5],
    ["tepi", 1.5, 1.7], ["laut", 1.7, 1.9]
  ]));
  const slow = run(W([
    ["Kalau", 0, 0.55], ["ukurannya", 0.55, 1.1], ["nggak", 1.1, 1.65], ["bakal", 1.65, 2.2],
    ["bisa", 2.2, 2.75], ["kita", 2.75, 3.3], ["custom", 3.3, 3.85], ["ke", 3.85, 4.1],
    ["tepi", 4.1, 4.65], ["laut", 4.65, 5.2]
  ]));
  const avgDur = (segs) => segs.reduce((a, s) => a + (s.end - s.start), 0) / segs.length;
  if (!(avgDur(slow) > avgDur(fast)))
    throw new Error("slow avg duration harus lebih besar dari fast");
});

// =====================================================================
// 04. LONG SENTENCE + PAUSE: break di pause, bukan fixed-N
// =====================================================================
t("04 long sentence: break mengikuti pause 0.35s, bukan setiap 4 kata", () => {
  const segs = run(W([
    ["Kalau", 0, 0.25], ["besok", 0.25, 0.5], ["hujan", 0.5, 0.8], ["kita", 0.8, 1.1],
    ["tidak", 1.45, 1.7], ["jadi", 1.7, 1.95], ["pergi", 1.95, 2.25], ["ke", 2.25, 2.35],
    ["pantai", 2.35, 2.65]
  ]));
  if (segs[0].text !== "Kalau besok hujan kita")
    throw new Error(`boundary pause tidak dihormati: seg1="${segs[0].text}"`);
  if (segs.length >= 2 && segs[1].text.split(" ")[0] !== "tidak")
    throw new Error(`seg2 harus mulai dari "tidak": "${segs[1].text}"`);
  if (segs.length > 3) throw new Error(`terlalu banyak segmen: ${segs.length}`);
});

// =====================================================================
// 05. MICRO CAPTIONS: "Ya." / "Betul." sah berdiri sendiri
// =====================================================================
t("05 micro caption: Ya. dan Betul. jadi caption sendiri", () => {
  const segs = run(W([
    ["Ya.", 0, 0.4], ["Betul.", 0.45, 0.9]
  ]));
  if (segs.length !== 2) throw new Error(`expected 2 segmen, got ${segs.length}`);
  if (segs[0].text !== "Ya." || segs[1].text !== "Betul.")
    throw new Error(`text=${segs.map((s) => s.text).join("|")}`);
});

// =====================================================================
// 06. PUNCTUATION: terminator menutup caption
// =====================================================================
t("06 punctuation: titik mengakhiri caption, kalimat berikutnya caption baru", () => {
  const segs = run(W([
    ["Saya", 0, 0.3], ["mau", 0.3, 0.5], ["pergi.", 0.5, 0.9],
    ["Kita", 1.0, 1.3], ["besok.", 1.3, 1.7]
  ]));
  const first = segs.find((s) => s.text.includes("pergi."));
  const second = segs.find((s) => s.text.includes("Kita"));
  if (!first || !second) throw new Error(`segmen hilang: ${segs.map((s) => s.text).join("|")}`);
  if (first.text.split(" ").length !== 3) throw new Error(`seg1="${first.text}"`);
  if (first.id >= second.id) throw new Error("urutan segmen salah");
});

// =====================================================================
// 07. NO PUNCTUATION: tetap tersegmentasi oleh rhythm
// =====================================================================
t("07 tanpa tanda baca: tetap terpecah (tidak 1 caption raksasa)", () => {
  const segs = run(W([
    ["saya", 0, 0.3], ["mau", 0.3, 0.55], ["pergi", 0.55, 0.9], ["ke", 0.9, 1.0],
    ["pasar", 1.0, 1.3], ["hari", 1.3, 1.55], ["ini", 1.55, 1.8], ["saja", 1.8, 2.1]
  ]));
  if (segs.length < 2) throw new Error(`tanpa pause/tanda baca harus tetap terpecah: ${segs.length} segmen`);
  for (const s of segs) if (s.wordCount > 7) throw new Error(`caption > 7 kata: ${s.text}`);
  if (allText(segs) !== "saya mau pergi ke pasar hari ini saja")
    throw new Error(`teks rusak: "${allText(segs)}"`);
});

// =====================================================================
// 08. PAUSE 300ms: menjadi boundary
// =====================================================================
t("08 pause 300ms jadi batas caption", () => {
  const segs = run(W([
    ["A", 0, 0.3], ["B", 0.3, 0.6], ["C", 0.6, 0.9], ["D", 1.2, 1.5], ["E", 1.5, 1.8]
  ]));
  const s1 = segs[0];
  if (!s1.text.includes("C")) throw new Error(`seg1="${s1.text}" harus berakhir di C`);
  if (s1.text.includes("D")) throw new Error(`pause tidak dihormati: seg1="${s1.text}"`);
});

// =====================================================================
// 09. LONG SILENCE 1.0s: caption tidak menjembatani jeda panjang
// =====================================================================
t("09 long silence: caption berakhir sebelum jeda 1.0s, tidak menggantung", () => {
  const segs = run(W([
    ["A", 0, 0.3], ["B", 0.3, 0.6], ["C", 1.6, 1.9], ["D", 1.9, 2.2]
  ]));
  const s1 = segs[0];
  if (s1.text !== "A B") throw new Error(`seg1="${s1.text}"`);
  if (r3(s1.end) !== 0.6) throw new Error(`seg1.end=${s1.end}, harus 0.6 (tidak bridge silensi)`);
  if (segs[1].start !== 1.6) throw new Error(`seg2.start=${segs[1].start}`);
});

// =====================================================================
// 10. FILLER NONE: filler tetap di teks
// =====================================================================
t("10 fillerMode none: filler 'jadi' dipertahankan", () => {
  const segs = run(W([
    ["jadi", 0, 0.3], ["kita", 0.3, 0.55], ["pergi", 0.55, 0.9], ["sekarang", 0.9, 1.3]
  ]), "none");
  const joined = allText(segs);
  if (!joined.includes("jadi")) throw new Error(`filler hilang: "${joined}"`);
});

// =====================================================================
// 11. FILLER AGGRESSIVE: filler hilang dan tidak muncul kembali
// =====================================================================
t("11 fillerMode aggressive: 'jadi' dihapus, tidak muncul lagi di segmen", () => {
  const segs = run(W([
    ["jadi", 0, 0.3], ["kita", 0.3, 0.55], ["pergi", 0.55, 0.9], ["sekarang", 0.9, 1.3]
  ]), "aggressive");
  const joined = allText(segs);
  if (joined.includes("jadi")) throw new Error(`filler masih ada: "${joined}"`);
  if (joined !== "kita pergi sekarang") throw new Error(`teks rusak: "${joined}"`);
  for (const s of segs) for (const w of (s.words || [])) if (w.text === "jadi") throw new Error("filler di words");
});

// =====================================================================
// 12. YOUTUBE eventWords: canonical words dari eventWords dipakai engine
// =====================================================================
t("12 eventWords: flatten ke canonical words, engine memakai timing tOffset", () => {
  const seg = {
    start: 355, end: 358,
    text: "A B C D",
    eventWords: [
      { text: "A", tOffset: 130 }, { text: "B", tOffset: 270 },
      { text: "C", tOffset: 345 }, { text: "D", tOffset: 405 }
    ]
  };
  const words = sandbox.flattenTranscriptWords([seg]);
  const segs = run(words, "none");
  if (words[0].start !== 355.13) throw new Error(`word0.start=${words[0].start}`);
  const flat = words.map((w) => w.text).join(" ");
  if (allText(segs) !== flat) throw new Error(`teks beda: "${allText(segs)}" vs "${flat}"`);
});

// =====================================================================
// 13. MISSING eventWords: fallback interpolasi tetap jalan
// =====================================================================
t("13 tanpa words/eventWords: interpolasi tetap menghasilkan segmentasi", () => {
  const seg = { start: 10, end: 13, text: "foo bar baz qux" };
  const words = sandbox.flattenTranscriptWords([seg]);
  const segs = run(words, "none");
  if (allText(segs) !== "foo bar baz qux") throw new Error(`teks rusak: "${allText(segs)}"`);
  for (const s of segs) {
    if (s.start < 10 || s.end > 13) throw new Error(`timing keluar rentang: ${s.start}-${s.end}`);
  }
});

// =====================================================================
// 14/15. ABSOLUTE vs RELATIVE timestamps: hasil segmentasi identik
// =====================================================================
t("14/15 absolute & relative: segmentasi identik setelah normalisasi", () => {
  const absSpecs = [
    ["Gua", 355, 355.3], ["sebenarnya", 355.3, 355.75], ["mau", 355.75, 355.95],
    ["pergi", 355.95, 356.3], ["ke", 356.3, 356.45], ["Ambon", 356.45, 356.8],
    ["besok", 357.1, 357.4], ["ada", 357.4, 357.6], ["acara", 357.6, 357.9], ["keluarga", 357.9, 358.25]
  ];
  const relSpecs = absSpecs.map(([text, s, e]) => [text, r3(s - 355), r3(e - 355)]);
  const absSegs = run(W(absSpecs), "none");
  const seg = { start: 355, end: 358.25, words: W(relSpecs) };
  const normWords = sandbox.normalizeSegmentWordTimestamps(seg, 355);
  const relSegs = run(normWords, "none");
  const key = (segs) => JSON.stringify(segs.map((s) => [s.text, r3(s.start), r3(s.end)]));
  if (key(absSegs) !== key(relSegs))
    throw new Error(`absolute vs relative beda:\n${key(absSegs)}\n${key(relSegs)}`);
});

// =====================================================================
// 16. NUMBERS: "50 juta" tidak terpotong antar caption
// =====================================================================
t("16 number+unit: 50 juta tidak terpisah", () => {
  const segs = run(W([
    ["saya", 0, 0.3], ["beli", 0.3, 0.6], ["50", 0.6, 0.75], ["juta", 0.75, 1.0],
    ["rupiah", 1.0, 1.3], ["di", 1.3, 1.45], ["pasar", 1.45, 1.8]
  ]));
  const pair = segs.filter((s) => s.text.includes("50"));
  if (pair.length !== 1) throw new Error(`"50" muncul di ${pair.length} caption`);
  if (!pair[0].text.includes("juta"))
    throw new Error(`"50" dan "juta" terpisah: "${pair[0].text}"`);
});

// =====================================================================
// 17. PROPER NAMES: "Jondry Suitela" tidak terpisah
// =====================================================================
t("17 proper name: Jondry Suitela tidak terpisah", () => {
  const segs = run(W([
    ["Jondry", 0, 0.4], ["Suitela", 0.4, 0.8], ["datang", 0.8, 1.1],
    ["dari", 1.1, 1.25], ["Ambon", 1.25, 1.6]
  ]));
  const holder = segs.filter((s) => s.text.includes("Jondry"));
  if (holder.length !== 1) throw new Error(`"Jondry" di ${holder.length} caption`);
  if (!holder[0].text.includes("Suitela"))
    throw new Error(`"Jondry Suitela" terpisah: "${holder[0].text}"`);
});

// =====================================================================
// 18/19. LINE BREAKING: balanced 2 baris, no orphan
// =====================================================================
t("18 line breaking: layout 2 baris seimbang, tidak ada orphan", () => {
  const lines = engineFactory.layoutCaptionLines(
    ["Kalau", "ukurannya", "nggak", "bakal", "bisa", "kita", "custom", "ya,"], 2, 40
  );
  if (lines.length !== 2) throw new Error(`lines=${lines.length}, expected 2: ${lines.join(" | ")}`);
  if (lines[0].length < 1 || lines[1].length < 1) throw new Error("baris kosong");
  if (lines[1].split(" ").length < 2) throw new Error(`orphan: baris 2="${lines[1]}"`);
});

t("19 orphan prevention: break menghindari orphan kata tunggal", () => {
  const lines = engineFactory.layoutCaptionLines(
    ["ini", "yang", "paling", "penting", "sekali", "untuk", "hidupmu"], 2, 40
  );
  if (lines.length !== 2) throw new Error(`lines=${lines.length}: ${lines.join(" | ")}`);
  for (const ln of lines) {
    if (ln.split(" ").length === 1) throw new Error(`orphan tercipta: "${ln}"`);
  }
});

t("19b line breaking: 50 juta tidak dipisah antar baris", () => {
  const lines = engineFactory.layoutCaptionLines(
    ["beli", "50", "juta", "rupiah", "di", "pasar", "hari", "ini", "sekali", "lagi"], 2, 40
  );
  const flat = lines.join("|");
  if (/\|50\|/.test(flat)) throw new Error(`number+unit terpotong antar baris: ${flat}`);
  if (lines[0].endsWith("50")) throw new Error(`"50" di ujung baris 1: ${flat}`);
});

// =====================================================================
// 20. KARAOKE / WORD TIMING: kata membawa timing asli (bukan interpolasi)
// =====================================================================
t("20 word timing: segmen.words memakai timing input, urut & monotonik", () => {
  const input = W([
    ["Gua", 0, 0.3], ["sebenarnya", 0.35, 0.8], ["mau", 0.85, 1.1], ["pergi", 1.15, 1.6]
  ]);
  const segs = run(input, "none");
  if (segs.length !== 1) throw new Error(`expected 1 segmen, got ${segs.length}: ${allText(segs)}`);
  const ws = segs[0].words;
  if (!ws || ws.length !== 4) throw new Error(`words=${ws && ws.length}`);
  ws.forEach((w, i) => {
    const src = input.find((x) => x.text === w.text);
    if (!src) throw new Error(`kata "${w.text}" tidak ada di input`);
    if (r3(w.start) !== r3(src.start) || r3(w.end) !== r3(src.end))
      throw new Error(`timing "${w.text}" berubah: ${w.start}-${w.end} vs ${src.start}-${src.end}`);
  });
  for (let i = 1; i < ws.length; i++) {
    if (ws[i].start < ws[i - 1].start) throw new Error(`kata tidak monotonik`);
  }
});

// =====================================================================
// 23. DETERMINISTIC: output identik untuk input yang sama
// =====================================================================
t("23 deterministik: dua run menghasilkan JSON identik", () => {
  const input = W([
    ["Kalau", 0, 0.25], ["besok", 0.25, 0.5], ["hujan", 0.5, 0.8], ["kita", 0.8, 1.1],
    ["tidak", 1.45, 1.7], ["jadi", 1.7, 1.95], ["pergi", 1.95, 2.25]
  ]);
  const a = run(input, "none");
  const b = run(input, "none");
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error("output tidak deterministik");
});

// =====================================================================
// 24. EMPHASIS: kata awal kalimat tidak ter-flag sebagai proper name
// =====================================================================
t("24 emphasis: starter kalimat (Kalau/Saya/Ternyata/Yang) tidak jadi emphasis", () => {
  const starters = ["kalau", "saya", "ternyata", "yang", "tapi", "walaupun", "solusi"];
  const segs = engineFactory({ fillerMode: "aggressive" })
    .processHeuristic(W([
      ["Kalau", 0, 0.3], ["ukurannya", 0.3, 0.7], ["nggak", 0.7, 1.0], ["bakal", 1.0, 1.4],
      ["bisa", 1.4, 1.7], ["kita", 1.7, 2.0], ["custom", 2.0, 2.4]
    ]), {}, "aggressive", "s1").segments;
  for (const s of segs) {
    for (const em of (s.emphasis_words || [])) {
      if (starters.includes(String(em).toLowerCase()))
        throw new Error(`emphasis salah: "${em}" di "${s.text}"`);
    }
  }
});

t("24b emphasis: proper name asli tetap dikenali", () => {
  const cands = engineFactory({}).helpers.extractEmphasisCandidates("Jondry Suitela dari Jemaat GPM Suli di Ambon, Maluku");
  const flat = cands.join("|").toLowerCase();
  for (const n of ["jondry suitela", "ambon", "maluku"]) {
    if (!flat.includes(n)) throw new Error(`name "${n}" hilang: ${cands.join("|")}`);
  }
});

// =====================================================================
// 25. LAYOUT: greedy fallback tidak pernah > maxLines baris
// =====================================================================
t("25 layout: greedy fallback tidak menghasilkan > 2 baris", () => {
  const longText = "Walaupun di JNA waktu itu pasti yang tukang timbang biasanya.";
  const lines = engineFactory.layoutCaptionLines(longText.split(" "), 2, 40);
  if (lines.length > 2) throw new Error(`3+ baris: ${JSON.stringify(lines)}`);
  if (lines.join(" ") !== longText) throw new Error(`teks hilang: ${JSON.stringify(lines)}`);
});

for (const r of results) {
  console.log(`${r.status} ${r.name}${r.error ? ` :: ${r.error}` : ""}`);
}
const failed = results.filter((r) => r.status === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);