const fs = require("fs");
const engineFactory = require("./clipme-caption-engine.js");

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
    f("getPreviewTimedSegments")
  ].join("\n") +
    "\nreturn (payload, fallback) => { getClipTranscriptSegments = fallback; return { export: resolveExportSegments(payload, null, null), preview: getPreviewTimedSegments(null, null, payload) }; };"
)();

const r3 = (x) => Math.round(x * 1000) / 1000;

// =====================================================================
// 21. PREVIEW/EXPORT PARITY: sumber data canonical tunggal, offset konsisten
// =====================================================================
t("21 parity: preview (clip-relative) + absStart == export (absolute), teks & words sama", () => {
  const absStart = 355;
  const payload = {
    start: absStart,
    end: 358,
    segments: [
      {
        start: 0, end: 1.1, text: "Gua sebenarnya mau pergi",
        words: [
          { text: "Gua", start: 0, end: 0.3 },
          { text: "sebenarnya", start: 0.3, end: 0.75 },
          { text: "mau", start: 0.75, end: 0.95 },
          { text: "pergi", start: 0.95, end: 1.1 }
        ]
      },
      {
        start: 1.3, end: 1.8, text: "ke Ambon",
        words: [
          { text: "ke", start: 1.3, end: 1.45 },
          { text: "Ambon", start: 1.45, end: 1.8 }
        ]
      }
    ]
  };
  const fallback = () => [{ start: 355, end: 358, text: "ServerText" }];
  const { export: exp, preview: prev } = sandbox(payload, fallback);
  if (exp.length !== 2 || prev.length !== 2)
    throw new Error(`export=${exp.length} preview=${prev.length}`);
  if (exp[0].text !== "Gua sebenarnya mau pergi")
    throw new Error(`export teks="${exp[0].text}"`);
  if (prev[0].text !== exp[0].text)
    throw new Error(`preview teks="${prev[0].text}" != export "${exp[0].text}"`);
  // preview clip-relative + absStart == export absolute
  if (r3(prev[0].start + absStart) !== r3(exp[0].start))
    throw new Error(`preview.start+offset=${r3(prev[0].start + absStart)} != export ${exp[0].start}`);
  if (r3(prev[0].end + absStart) !== r3(exp[0].end))
    throw new Error(`preview.end+offset != export`);
  // word-level (karaoke) juga sinkron
  if (exp[0].words.length !== 4 || prev[0].words.length !== 4)
    throw new Error(`words export=${exp[0].words.length} preview=${prev[0].words.length}`);
  for (let i = 0; i < 4; i++) {
    if (prev[0].words[i].text !== exp[0].words[i].text)
      throw new Error(`word teks beda: "${prev[0].words[i].text}" vs "${exp[0].words[i].text}"`);
    if (r3(prev[0].words[i].start + absStart) !== r3(exp[0].words[i].start))
      throw new Error(`word${i} start beda`);
    if (r3(prev[0].words[i].end + absStart) !== r3(exp[0].words[i].end))
      throw new Error(`word${i} end beda`);
  }
  // seg ke-2 (middle): word clip-relative 1.3.. -> absolute 356.3..
  if (r3(exp[1].words[1].start) !== r3(1.45 + absStart))
    throw new Error(`word Ambon start=${exp[1].words[1].start}`);
});

// =====================================================================
// 22. USER EDIT: edit klien dipertahankan, tidak ditimpa engine/server
// =====================================================================
t("22 user edit: teks & timing edit klien dipertahankan (bukan fallback server)", () => {
  const absStart = 355;
  const payload = {
    start: absStart,
    end: 358,
    segments: [
      {
        start: 0, end: 2, text: "INI HASIL EDIT USER",
        words: [{ text: "INI", start: 0, end: 0.8 }, { text: "HASIL", start: 0.9, end: 1.4 }, { text: "EDIT", start: 1.5, end: 2 }]
      }
    ]
  };
  const fallback = () => [{ start: 355, end: 358, text: "ServerText" }];
  const { export: exp, preview: prev } = sandbox(payload, fallback);
  if (exp[0].text !== "INI HASIL EDIT USER")
    throw new Error(`edit user hilang: "${exp[0].text}"`);
  if (exp[0].text === "ServerText") throw new Error("fallback server menimpa edit user");
  if (r3(exp[0].start) !== absStart) throw new Error(`edit timing start=${exp[0].start}`);
  if (r3(exp[0].end) !== absStart + 2) throw new Error(`edit timing end=${exp[0].end}`);
  if (exp[0].words[1].start !== absStart + 0.9) throw new Error(`edit word timing=${exp[0].words[1].start}`);
  // preview tetap menampilkan edit user yang sama
  if (prev[0].text !== "INI HASIL EDIT USER") throw new Error(`preview tidak ikut edit: "${prev[0].text}"`);
});

// =====================================================================
// 23. DETERMINISTIC RERUN: resolver dua kali => identik
// =====================================================================
t("23 deterministik (pipeline): resolver rerun menghasilkan output identik", () => {
  const payload = {
    start: 355, end: 358,
    segments: [
      {
        start: 0, end: 1.5, text: "Halo dunia",
        words: [{ text: "Halo", start: 0, end: 0.6 }, { text: "dunia", start: 0.7, end: 1.5 }]
      }
    ]
  };
  const fallback = () => [{ start: 355, end: 358, text: "ServerText" }];
  const a = sandbox(payload, fallback);
  const b = sandbox(payload, fallback);
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error("rerun tidak deterministik");
});

// =====================================================================
// §37: contoh transkrip + pause 1.80->2.10 lewat engine -> resolver penuh
// =====================================================================
t("§37 pause 1.80->2.10: break setelah Ambon, 'besok' caption baru (engine -> resolver)", () => {
  const words = [
    { text: "Gua", start: 355, end: 355.3 },
    { text: "sebenarnya", start: 355.3, end: 355.75 },
    { text: "mau", start: 355.75, end: 355.95 },
    { text: "pergi", start: 355.95, end: 356.3 },
    { text: "ke", start: 356.3, end: 356.45 },
    { text: "Ambon", start: 356.45, end: 356.8 },
    { text: "besok", start: 357.1, end: 357.4 },
    { text: "ada", start: 357.4, end: 357.6 },
    { text: "acara", start: 357.6, end: 357.9 },
    { text: "keluarga", start: 357.9, end: 358.25 }
  ];
  const engine = engineFactory({ style: "dynamic", fillerMode: "none", maxLines: 2, maxLineLength: 40 });
  const segs = engine.processHeuristic(words, {}, "none", "speaker_1").segments;
  const payload = {
    start: 355, end: 358.25,
    segments: segs.map((s) => ({
      start: r3(s.start - 355), end: r3(s.end - 355), text: s.text,
      words: (s.words || []).map((w) => ({ text: w.text, start: r3(w.start - 355), end: r3(w.end - 355) }))
    }))
  };
  const fallback = () => [{ start: 355, end: 358.25, text: "ServerText" }];
  const { export: exp } = sandbox(payload, fallback);
  const joined = exp.map((s) => s.text).join(" | ");
  if (!joined.includes("Ambon") || !joined.includes("besok"))
    throw new Error(`kata hilang: "${joined}"`);
  const ambonSeg = exp.find((s) => s.text.includes("Ambon"));
  if (ambonSeg.text.includes("besok"))
    throw new Error(`pause 1.80->2.10 tidak memisahkan: "${ambonSeg.text}"`);
  const besokSeg = exp.find((s) => s.text.includes("besok"));
  if (!besokSeg) throw new Error(`"besok" tidak ada sebagai caption`);
  // Ambon (1.80) harus terpisah dari besok (2.10). Resolver mengembalikan
  // absolute (356.45..356.8), jadi bandingkan pada koordinat absolute.
  if (r3(ambonSeg.end) > 356.85) throw new Error(`Ambon end=${ambonSeg.end}, harus <= 356.85`);
  if (r3(besokSeg.start) < 357.05) throw new Error(`besok start=${besokSeg.start}, harus >= 357.05`);
  if (r3(besokSeg.start - ambonSeg.end) < 0.25)
    throw new Error(`gap ${besokSeg.start}-${ambonSeg.end} terlalu kecil`);
});

for (const r of results) {
  console.log(`${r.status} ${r.name}${r.error ? ` :: ${r.error}` : ""}`);
}
const failed = results.filter((r) => r.status === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);