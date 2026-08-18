const fs = require("fs");

const results = [];
function t(name, fn) {
  try {
    fn();
    results.push({ name, status: "PASS" });
  } catch (e) {
    results.push({ name, status: "FAIL", error: String((e && e.message) || e) });
  }
}

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
  ["cleanCaptionText", "normalizeSegmentWordTimestamps", "normalizeClientSegments"].map((n) => {
    const { params, body } = serverFn(n);
    return `function ${n}(${params}) { ${body} }`;
  }).join("\n") +
    "\nreturn { cleanCaptionText, normalizeSegmentWordTimestamps, normalizeClientSegments };"
)();

// ---- canonical helper: relative -> absolute ----
t("ADD1 rel words 0..0.34 dengan seg 355 -> absolute 355..355.34", () => {
  const out = sandbox.normalizeSegmentWordTimestamps({
    start: 355, end: 358,
    words: [{ text: "Ica", start: 0, end: 0.34 }, { text: "mau", start: 0.35, end: 0.7 }]
  });
  if (out[0].start !== 355) throw new Error(`w0.start=${out[0].start}, expected 355`);
  if (out[0].end !== 355.34) throw new Error(`w0.end=${out[0].end}, expected 355.34`);
  if (out[1].start !== 355.35) throw new Error(`w1.start=${out[1].start}, expected 355.35`);
  if (out[1].end !== 355.7) throw new Error(`w1.end=${out[1].end}, expected 355.7`);
});

t("ADD1 abs words 355..355.34 -> tetap (idempotent, bukan 710)", () => {
  const out = sandbox.normalizeSegmentWordTimestamps({
    start: 355, end: 358,
    words: [{ text: "Ica", start: 355, end: 355.34 }]
  });
  if (out[0].start !== 355) throw new Error(`w0.start=${out[0].start}, expected 355`);
  if (out[0].end !== 355.34) throw new Error(`w0.end=${out[0].end}, expected 355.34`);
});

t("ADD1 word mulai sedikit sebelum seg.start (354.9) TIDAK terflip ke relative", () => {
  const out = sandbox.normalizeSegmentWordTimestamps({
    start: 355, end: 358,
    words: [{ text: "x", start: 354.9, end: 355.2 }]
  });
  if (out[0].start !== 354.9) throw new Error(`w0.start=${out[0].start}, expected 354.9`);
});

t("ADD1 seg.start=30 dengan rel words 0..2.5 -> 30..32.5", () => {
  const out = sandbox.normalizeSegmentWordTimestamps({
    start: 30, end: 33,
    words: [{ text: "a", start: 0, end: 1 }, { text: "b", start: 2.5, end: 2.5 }]
  });
  if (out[0].start !== 30) throw new Error(`w0.start=${out[0].start}`);
  if (out[0].end !== 31) throw new Error(`w0.end=${out[0].end}`);
  if (out[1].start !== 32.5) throw new Error(`w1.start=${out[1].start}, expected 32.5`);
});

t("ADD1 seg.start kecil (0.5) rel words -> tidak rusak (koinsiden aman)", () => {
  const out = sandbox.normalizeSegmentWordTimestamps({
    start: 0.5, end: 3,
    words: [{ text: "a", start: 0, end: 0.4 }]
  });
  if (out[0].start !== 0) throw new Error(`w0.start=${out[0].start}`);
  if (out[0].end !== 0.4) throw new Error(`w0.end=${out[0].end}`);
});

t("ADD1 word tanpa timestamp -> fallback ke start+0.3 (konvensi existing)", () => {
  const out = sandbox.normalizeSegmentWordTimestamps({
    start: 355, end: 358,
    words: [{ text: "full" }]
  });
  if (out[0].start !== 355) throw new Error(`w0.start=${out[0].start}`);
  if (out[0].end !== 355.3) throw new Error(`w0.end=${out[0].end}, expected 355.3`);
});

t("ADD1 hanya end relatif (start hilang) -> end dikonversi ke absolute", () => {
  const out = sandbox.normalizeSegmentWordTimestamps({
    start: 355, end: 358,
    words: [{ text: "x", end: 0.34 }]
  });
  if (out[0].start !== 355) throw new Error(`w0.start=${out[0].start}`);
  if (out[0].end !== 355.34) throw new Error(`w0.end=${out[0].end}, expected 355.34`);
});

t("ADD1 empty words -> []", () => {
  const out = sandbox.normalizeSegmentWordTimestamps({ start: 355, end: 358, words: [] });
  if (out.length !== 0) throw new Error("expected empty");
});

// ---- normalizeClientSegments ----
t("ADD1 normalizeClientSegments: words relatif + offset -> absolute", () => {
  const out = sandbox.normalizeClientSegments(
    [{ start: 0, end: 2, text: "Ica mau", words: [{ text: "Ica", start: 0, end: 0.34 }] }],
    355
  );
  if (out[0].start !== 355) throw new Error(`seg.start=${out[0].start}`);
  if (out[0].words[0].start !== 355) throw new Error(`w.start=${out[0].words[0].start}`);
  if (out[0].words[0].end !== 355.34) throw new Error(`w.end=${out[0].words[0].end}`);
});

t("ADD1 normalizeClientSegments: words absolute -> idempotent (tidak double offset)", () => {
  const out = sandbox.normalizeClientSegments(
    [{ start: 0, end: 2, text: "Ica", words: [{ text: "Ica", start: 355, end: 355.34 }] }],
    355
  );
  if (out[0].words[0].start !== 355) throw new Error(`w.start=${out[0].words[0].start}, expected 355`);
  if (out[0].words[0].end !== 355.34) throw new Error(`w.end=${out[0].words[0].end}, expected 355.34`);
});

// ---- preview mapping (getPreviewTimedSegments math): abs words - absStart ----
const r3 = (x) => Math.round(x * 1000) / 1000;
t("ADD1 preview mapping: abs words 355..355.34 - absStart 355 -> 0..0.34 (karaoke tidak collapse)", () => {
  const seg = { start: 355, end: 358, text: "Ica", words: [{ text: "Ica", start: 355, end: 355.34 }] };
  const absStart = 355;
  const words = seg.words.map((w) => ({
    text: w.text,
    start: Math.max(0, (w.start != null ? w.start : seg.start) - absStart),
    end: Math.max(0, (w.end != null ? w.end : (w.start != null ? w.start : seg.start) + 0.3) - absStart)
  }));
  if (r3(words[0].start) !== 0) throw new Error(`w.start=${words[0].start}, expected 0`);
  if (r3(words[0].end) !== 0.34) throw new Error(`w.end=${words[0].end}, expected 0.34`);
});

for (const r of results) {
  console.log(`${r.status} ${r.name}${r.error ? ` :: ${r.error}` : ""}`);
}
const failed = results.filter((r) => r.status === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);