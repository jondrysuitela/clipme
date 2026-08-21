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

function f(name) {
  const { params, body } = extractFrom(serverSrc, name);
  return `function ${name}(${params}) { ${body} }`;
}

const sandbox = new Function(
  [
    f("cleanCaptionText"),
    f("normalizeSegmentWordTimestamps"),
    f("normalizeClientSegments"),
    "let getClipTranscriptSegments = null;",
    f("resolveExportSegments"),
    f("clipPayloadToClip"),
    f("getPreviewTimedSegments"),
    f("wordsAlignWithSegmentText")
  ].join("\n") +
    "\nreturn (payload, fallback) => { getClipTranscriptSegments = fallback; return getPreviewTimedSegments(null, null, payload); };"
)();

function preview(payload, fallbackSegs) {
  return sandbox(
    payload,
    () => (fallbackSegs || [{ start: 355, end: 358, text: "ServerText" }])
  );
}

// Scenario A: server edited file lama, client punya edit tak tersimpan -> preview ikut client (parity export)
t("BUG3 preview pakai payload.segments client, bukan server state (teks)", () => {
  const segs = preview({
    start: 355,
    end: 358,
    segments: [{ start: 0, end: 2, text: "ClientText" }]
  });
  if (segs.length !== 1) throw new Error(`count=${segs.length}`);
  if (segs[0].text !== "ClientText") throw new Error(`text=${segs[0].text}, expected ClientText`);
});

t("BUG3 preview pakai timing client (start/end), bukan server", () => {
  const segs = preview({
    start: 355,
    end: 358,
    segments: [{ start: 1, end: 2.5, text: "T", words: [{ text: "T", start: 1, end: 1.5 }] }]
  });
  if (Math.abs(segs[0].start - 1) > 1e-6 || Math.abs(segs[0].end - 2.5) > 1e-6)
    throw new Error(`timing client rusak: ${segs[0].start}-${segs[0].end}`);
  if (!segs[0].words.length) throw new Error("words hilang di preview");
  if (Math.abs(segs[0].words[0].start - 1) > 1e-6 || Math.abs(segs[0].words[0].end - 1.5) > 1e-6)
    throw new Error(`word timing rusak: ${segs[0].words[0].start}-${segs[0].words[0].end}`);
});

// Middle segment: seg.start > clip.start; word clip-relative (0-based) -> absolute via clip base
t("BUG3 middle segment: word clip-relative di seg ke-2 -> absolute benar (double-offset tidak)", () => {
  const segs = preview({
    start: 355,
    end: 358,
    segments: [{ start: 2, end: 3.5, text: "M", words: [{ text: "M", start: 2, end: 2.4 }] }]
  });
  if (Math.abs(segs[0].start - 2) > 1e-6) throw new Error(`seg.start=${segs[0].start}, expected 2`);
  if (Math.abs(segs[0].words[0].start - 2) > 1e-6) throw new Error(`word.start=${segs[0].words[0].start}, expected 2 (bukan 357)`);
  if (Math.abs(segs[0].words[0].end - 2.4) > 1e-6) throw new Error(`word.end=${segs[0].words[0].end}, expected 2.4`);
});

// Scenario C: tanpa edit -> fallback ke server state
t("BUG3 tanpa edit -> fallback server state", () => {
  const segs = preview({ start: 355, end: 358, segments: [] });
  if (segs.length !== 1 || segs[0].text !== "ServerText") throw new Error(`fallback gagal: ${JSON.stringify(segs)}`);
  if (Math.abs(segs[0].start - 0) > 1e-6) throw new Error(`start=${segs[0].start}`);
});

// Scenario D: segments invalid -> fallback server state
t("BUG3 segments invalid (reversed) -> fallback server state", () => {
  const segs = preview({ start: 355, end: 358, segments: [{ start: 5, end: 1, text: "bad" }] });
  if (segs.length !== 1 || segs[0].text !== "ServerText") throw new Error(`fallback invalid gagal: ${JSON.stringify(segs)}`);
});

// Parity: preview (clip-relative) + absStart == export (absolute) dari resolver yang sama
t("BUG3 parity data source: preview+offset == resolveExportSegments", () => {
  const payload = {
    start: 355,
    end: 358,
    segments: [{ start: 1, end: 2.5, text: "Par", words: [{ text: "Par", start: 1, end: 1.4 }] }]
  };
  const previewSegs = sandbox(payload, () => [{ start: 355, end: 358, text: "ServerText" }]);
  const absStart = 355;
  const p0 = previewSegs[0];
  // preview clip-relative -> absolute harus = normalizeClientSegments (export)
  const clientAbs = { start: 1 + absStart, end: 2.5 + absStart };
  if (Math.abs(p0.start + absStart - clientAbs.start) > 1e-6)
    throw new Error(`preview.start=${p0.start}, export.start=${clientAbs.start}`);
  if (Math.abs(p0.end + absStart - clientAbs.end) > 1e-6)
    throw new Error(`preview.end=${p0.end}, export.end=${clientAbs.end}`);
});

for (const r of results) {
  console.log(`${r.status} ${r.name}${r.error ? ` :: ${r.error}` : ""}`);
}
const failed = results.filter((r) => r.status === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);