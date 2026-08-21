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
  ["cleanCaptionText", "parseJson3Transcript", "flattenTranscriptWords", "wordsAlignWithSegmentText"].map((n) => {
    const { params, body } = serverFn(n);
    return `function ${n}(${params}) { ${body} }`;
  }).join("\n") +
    "\nreturn { cleanCaptionText, parseJson3Transcript, flattenTranscriptWords };"
)();

const round3 = (x) => Math.round(x * 1000) / 1000;

// ---- parseJson3Transcript: word boundaries preserved ----
t("parseJson3Transcript boundary: text dipisah spasi antar token", () => {
  const out = sandbox.parseJson3Transcript({
    events: [
      {
        tStartMs: 12000,
        dDurationMs: 2000,
        segs: [
          { utf8: "Jadi" },
          { utf8: " gua" },
          { utf8: " mau" },
          { utf8: " pergi" },
          { utf8: " ke" },
          { utf8: "Ambon." }
        ]
      }
    ]
  });
  const seg = out[0];
  if (seg.text !== "Jadi gua mau pergi ke Ambon.")
    throw new Error(`text boundary rusak: "${seg.text}"`);
  if (seg.eventWords.length !== 6) throw new Error(`eventWords=${seg.eventWords.length}, expected 6`);
  if (seg.eventWords.map((w) => w.text).join(" ") !== "Jadi gua mau pergi ke Ambon.")
    throw new Error(`eventWords boundary rusak: ${seg.eventWords.map((w) => w.text).join("|")}`);
});

t("parseJson3Transcript tOffset & waktu start/end benar", () => {
  const out = sandbox.parseJson3Transcript({
    events: [
      {
        tStartMs: 12000,
        dDurationMs: 2000,
        segs: [{ utf8: "A", tOffsetMs: 130 }, { utf8: "B", tOffsetMs: 270 }]
      }
    ]
  });
  if (out[0].start !== 12) throw new Error(`start=${out[0].start}`);
  if (out[0].end !== 14) throw new Error(`end=${out[0].end}`);
  if (out[0].eventWords[0].tOffset !== 130) throw new Error(`tOffset1=${out[0].eventWords[0].tOffset}`);
  if (out[0].eventWords[1].tOffset !== 270) throw new Error(`tOffset2=${out[0].eventWords[1].tOffset}`);
});

// ---- flattenTranscriptWords: eventWords canonical source ----
t("flatten eventWords: start = seg.start + tOffset/1000 (bukan interpolasi)", () => {
  const seg = {
    start: 355,
    end: 358,
    text: "A B C D",
    eventWords: [
      { text: "A", tOffset: 130 },
      { text: "B", tOffset: 270 },
      { text: "C", tOffset: 345 },
      { text: "D", tOffset: 405 }
    ]
  };
  const words = sandbox.flattenTranscriptWords([seg]);
  if (words.length !== 4) throw new Error(`words.length=${words.length}, expected 4`);
  const expectedStarts = [355.13, 355.27, 355.345, 355.405];
  words.forEach((w, i) => {
    if (w.start !== expectedStarts[i])
      throw new Error(`word${i} "${w.text}" start=${w.start}, expected ${expectedStarts[i]}`);
  });
  // end kata = start kata berikutnya (tidak overlap, tidak nempel)
  if (words[0].end !== words[1].start)
    throw new Error(`word0.end=${words[0].end}, word1.start=${words[1].start}`);
  if (words[1].end !== words[2].start)
    throw new Error(`word1.end=${words[1].end}, word2.start=${words[2].start}`);
});

t("flatten eventWords: word terakhir end dari seg.end (bukan interpolation)", () => {
  const seg = {
    start: 355,
    end: 358,
    text: "A B",
    eventWords: [{ text: "A", tOffset: 100 }, { text: "B", tOffset: 200 }]
  };
  const words = sandbox.flattenTranscriptWords([seg]);
  const last = words[1];
  if (round3(last.start) !== 355.2) throw new Error(`last.start=${last.start}`);
  if (last.end !== 358) throw new Error(`last.end=${last.end}, expected seg.end=358`);
});

t("flatten eventWords: tOffset hilang -> akumulasi prevAbs, boundary tetap", () => {
  const seg = {
    start: 355,
    end: 357,
    text: "A B C",
    eventWords: [{ text: "A", tOffset: 100 }, { text: "B" }, { text: "C", tOffset: 150 }]
  };
  const words = sandbox.flattenTranscriptWords([seg]);
  if (words.length !== 3) throw new Error(`words.length=${words.length}`);
  // A start 355.1, B tanpa tOffset start = prevAbs (>= 355.2), C start 355.15 -> bounded
  if (words[0].start !== 355.1) throw new Error(`A.start=${words[0].start}`);
  if (words[0].end !== words[1].start) throw new Error("A.end harus = B.start");
  if (words[1].start < 355.1) throw new Error(`B.start=${words[1].start} terlalu kecil`);
  if (words[2].start !== 355.15) throw new Error(`C.start=${words[2].start}`);
  if (words[2].end !== 357) throw new Error(`C.end=${words[2].end}`);
});

t("flatten prioritas: seg.words masih menang di atas eventWords", () => {
  const seg = {
    start: 355,
    end: 358,
    text: "X Y",
    words: [{ text: "X", start: 355, end: 355.5 }, { text: "Y", start: 355.6, end: 356 }],
    eventWords: [{ text: "A", tOffset: 100 }, { text: "B", tOffset: 200 }]
  };
  const words = sandbox.flattenTranscriptWords([seg]);
  if (words.length !== 2) throw new Error(`words.length=${words.length}`);
  if (words[0].text !== "X") throw new Error(`word0=${words[0].text}`);
});

t("flatten fallback: tanpa words/eventWords -> interpolasi tetap jalan", () => {
  const seg = { start: 10, end: 13, text: "foo bar baz" };
  const words = sandbox.flattenTranscriptWords([seg]);
  if (words.length !== 3) throw new Error(`words.length=${words.length}`);
  if (words[0].start !== 10) throw new Error(`word0.start=${words[0].start}`);
  if (words[2].end !== 13) throw new Error(`word2.end=${words[2].end}`);
});

for (const r of results) {
  console.log(`${r.status} ${r.name}${r.error ? ` :: ${r.error}` : ""}`);
}
const failed = results.filter((r) => r.status === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);