// Regression test: after a transcript is translated (text switches language),
// stale per-word timestamps (words) must NOT leak the ORIGINAL language back
// into the caption engine / karaoke / preview. Root cause of "timeline shows
// Indonesian but preview stays English".
const assert = require("assert");

const { _test } = require("D:/PROJEK CODING/clipme/server.js");
const { wordsAlignWithSegmentText, flattenTranscriptWords } = _test;

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

test("wordsAlignWithSegmentText: teks terjemahan vs kata basi asing = tidak selaras", () => {
  const seg = {
    text: "Anak-anak juga sangat kompetitif.",
    words: [
      { text: "Kids", start: 44, end: 44.3 },
      { text: "are", start: 44.3, end: 44.6 },
      { text: "very", start: 44.6, end: 44.8 },
      { text: "competitive", start: 44.8, end: 45.2 },
      { text: "too", start: 45.2, end: 45.6 }
    ]
  };
  assert.strictEqual(wordsAlignWithSegmentText(seg), false, "kata Inggris vs teks Indonesia harus dideteksi tidak selaras");
});

test("wordsAlignWithSegmentText: kata yang selaras dengan teks = true", () => {
  const seg = {
    text: "Kids are very competitive too.",
    words: [
      { text: "Kids", start: 44, end: 44.3 },
      { text: "are", start: 44.3, end: 44.6 },
      { text: "very", start: 44.6, end: 44.8 },
      { text: "competitive", start: 44.8, end: 45.2 },
      { text: "too.", start: 45.2, end: 45.6 }
    ]
  };
  assert.strictEqual(wordsAlignWithSegmentText(seg), true, "kata harus selaras dengan teks sumber");
});

test("flattenTranscriptWords: jangan pakai kata basi; turunkan dari teks terjemahan", () => {
  const segments = [
    {
      start: 44,
      end: 45.68,
      text: "Anak-anak juga sangat kompetitif.",
      words: [
        { text: "Kids", start: 44, end: 44.3 },
        { text: "are", start: 44.3, end: 44.6 },
        { text: "very", start: 44.6, end: 44.8 },
        { text: "competitive", start: 44.8, end: 45.2 },
        { text: "too", start: 45.2, end: 45.6 }
      ]
    }
  ];
  const words = flattenTranscriptWords(segments);
  assert.ok(words.length > 0, "harus menghasilkan kata");
  const joined = words.map((w) => w.text).join(" ").toLowerCase();
  assert.ok(joined.includes("anak"), `kata harus bahasa terjemahan, dapat: "${joined}"`);
  assert.ok(!joined.includes("kids"), `kata basi Inggris tidak boleh bocor: "${joined}"`);
});

test("flattenTranscriptWords: kata selaras tetap dipakai (timing asli)", () => {
  const segments = [
    {
      start: 44,
      end: 45.68,
      text: "Kids are very competitive too.",
      words: [
        { text: "Kids", start: 44, end: 44.3 },
        { text: "are", start: 44.3, end: 44.6 }
      ]
    }
  ];
  const words = flattenTranscriptWords(segments);
  const joined = words.map((w) => w.text).join(" ").toLowerCase();
  assert.ok(joined.includes("kids"), `kata selaras harus dipertahankan, dapat: "${joined}"`);
});

test("flattenTranscriptWords: segmen tanpa words dipecah dari teks", () => {
  const segments = [{ start: 10, end: 12, text: "Halo dunia ini test" }];
  const words = flattenTranscriptWords(segments);
  assert.strictEqual(words.length, 4, "harus memecah 4 kata");
  assert.ok(words.every((w) => w.start >= 10 && w.end <= 12), "timing dalam rentang segmen");
});

const failed = results.filter((r) => !r.ok).length;
console.log(`\nTranslation stale-words test done: ${results.length - failed}/${results.length} PASS`);
if (failed) process.exit(1);