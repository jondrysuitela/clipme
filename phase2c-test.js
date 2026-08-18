const AutoCaptionEngine = require("./clipme-caption-engine.js");

const results = [];
function t(name, fn) {
  try {
    fn();
    results.push({ name, status: "PASS" });
  } catch (e) {
    results.push({ name, status: "FAIL", error: String((e && e.message) || e) });
  }
}

function word(text, start, end) {
  return { text, start, end, speaker_id: "speaker_1" };
}

function engine(fillerMode) {
  return AutoCaptionEngine({ style: "dynamic", fillerMode, maxLines: 2, maxLineLength: 40 });
}

const ALL_WORDS = [
  word("Ica", 355.0, 355.34),
  word("Jadi", 355.35, 355.6),
  word("saya", 355.61, 355.9),
  word("mau", 355.91, 356.2),
  word("pergi", 356.21, 356.6),
  word("um", 356.61, 356.8),
  word("ke", 356.81, 357.1),
  word("Ambon", 357.11, 357.5)
];

// ---- engine buildSegmentFromWords exposes canonical words ----
t("BUG1 buildSegmentFromWords returns canonical words array", () => {
  const e = engine("aggressive");
  const seg = e.helpers.buildSegmentFromWords(
    [word("Ica", 355.0, 355.34), word("mau", 355.91, 356.2)],
    1,
    ALL_WORDS
  );
  if (!Array.isArray(seg.words)) throw new Error("seg.words missing");
  if (seg.words.length !== 2) throw new Error(`words.length=${seg.words.length}`);
  if (seg.words[0].text !== "Ica" || seg.words[0].start !== 355.0) throw new Error("word0 wrong");
  if (seg.text !== "Ica mau") throw new Error(`text=${seg.text}`);
});

// ---- processHeuristic: filler EXCLUDED from canonical words ----
t("BUG1 heuristic aggressive: 'Jadi' & 'um' tidak masuk canonical words", () => {
  const e = engine("aggressive");
  const result = e.processHeuristic(ALL_WORDS, "dynamic", "aggressive", "speaker_1");
  const segTexts = [];
  const wordTexts = [];
  for (const s of result.segments) {
    segTexts.push(s.text);
    for (const w of s.words || []) wordTexts.push(w.text.toLowerCase());
  }
  if (segTexts.join(" ").toLowerCase().includes("jadi"))
    throw new Error(`'jadi' muncul di teks: ${segTexts.join("|")}`);
  if (wordTexts.includes("jadi")) throw new Error(`'jadi' masuk words: ${wordTexts.join(",")}`);
  if (wordTexts.includes("um")) throw new Error(`'um' masuk words: ${wordTexts.join(",")}`);
});

t("BUG1 heuristic none: 'Jadi' tetap ada (bukan filler mode none)", () => {
  const e = engine("none");
  const result = e.processHeuristic(ALL_WORDS, "dynamic", "none", "speaker_1");
  const segTexts = result.segments.map((s) => s.text).join(" ");
  if (!segTexts.toLowerCase().includes("jadi"))
    throw new Error(`'jadi' hilang padahal mode none: ${segTexts}`);
});

// ---- rebuild simulation (logika handleAutoCaptions) ----
function rebuildWords(result, wantOverride) {
  const out = [];
  for (const s of result.segments || []) {
    const fromAbs = Number(s.start) || 0;
    const toAbs = Math.max(fromAbs + 0.1, Number(s.end) || fromAbs + 1);
    const want = wantOverride != null ? wantOverride : Math.max(1, String(s.text || "").trim().split(/\s+/).filter(Boolean).length);
    let words;
    if (Array.isArray(s.words) && s.words.length) {
      words = s.words.filter((w) => w.start < toAbs && w.end > fromAbs);
      if (!words.length) words = s.words;
      words = words.slice(0, want);
    }
    if (words && words.length) out.push(...words.map((w) => w.text));
  }
  return out;
}

t("BUG1 rebuild pakai canonical words: 'Jadi' tidak kembali, count==want", () => {
  const e = engine("aggressive");
  const result = e.processHeuristic(ALL_WORDS, "dynamic", "aggressive", "speaker_1");
  const rebuilt = rebuildWords(result);
  if (rebuilt.some((txt) => txt.toLowerCase() === "jadi"))
    throw new Error(`'jadi' kembali di rebuild: ${rebuilt.join("|")}`);
  if (rebuilt.some((txt) => txt.toLowerCase() === "um"))
    throw new Error(`'um' kembali di rebuild: ${rebuilt.join("|")}`);
  // want = word count per segmen; total harus sama dgn wordCount segmen
  const totalWant = result.segments.reduce((n, s) => n + Math.max(1, String(s.text).trim().split(/\s+/).length), 0);
  if (rebuilt.length !== totalWant)
    throw new Error(`rebuilt.length=${rebuilt.length}, expected ${totalWant}`);
  if (rebuilt.join(" ").toLowerCase().includes("jadi"))
    throw new Error("output akhir masih mengandung jadi");
});

t("BUG1 rebuild enforce want: slice ke want, tidak over-pick", () => {
  const e = engine("aggressive");
  const result = e.processHeuristic(ALL_WORDS, "dynamic", "aggressive", "speaker_1");
  const rebuilt = rebuildWords(result, 1);
  if (rebuilt.length !== result.segments.length)
    throw new Error(`want=1: rebuilt.length=${rebuilt.length}, expected ${result.segments.length}`);
});

t("BUG1 rebuild timestamps asli dipertahankan (dari canonical words, bukan interpolasi)", () => {
  const e = engine("aggressive");
  const result = e.processHeuristic(ALL_WORDS, "dynamic", "aggressive", "speaker_1");
  for (const s of result.segments) {
    if (!Array.isArray(s.words) || !s.words.length) continue;
    if (s.words[0].start !== s.start) throw new Error(`word0.start=${s.words[0].start}, seg.start=${s.start}`);
    if (s.words[s.words.length - 1].end !== s.end)
      throw new Error(`last.end=${s.words[s.words.length - 1].end}, seg.end=${s.end}`);
  }
});

for (const r of results) {
  console.log(`${r.status} ${r.name}${r.error ? ` :: ${r.error}` : ""}`);
}
const failed = results.filter((r) => r.status === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);