const fs = require("fs");

const results = [];
async function t(name, fn) {
  try {
    await fn();
    results.push({ name, status: "PASS" });
  } catch (e) {
    results.push({ name, status: "FAIL", error: String((e && e.message) || e) });
  }
}

const scriptSrc = fs.readFileSync("script.js", "utf8");
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

function extract(name) {
  return extractFrom(scriptSrc, name);
}

function extractConst(name) {
  const m = scriptSrc.match(new RegExp(`const\\s+${name}\\s*=\\s*([^;]+);`));
  if (!m) throw new Error(`${name} not found`);
  return Number(m[1]);
}

const PURE_FNS = [
  "clampZoom",
  "captionPxPerSec",
  "captionTimelineWidth",
  "captionTickStep",
  "captionTickTimes",
  "clampPlayheadTime",
  "captionBlockPx",
  "captionPxToTime",
  "CAPTION_MIN_DUR",
  "moveCaptionSegment",
  "resizeCaptionSegment",
  "captionDragMode",
  "srtTimestamp",
  "buildSrt"
];

const CAPTION_MIN_DUR_TEST = extractConst("CAPTION_MIN_DUR");

const sandbox = new Function(
  "state",
  "CAPTION_PX_PER_SEC",
  "CAPTION_ZOOM_MIN",
  "CAPTION_ZOOM_MAX",
  "CAPTION_MIN_DUR",
  PURE_FNS.filter((n) => n !== "CAPTION_MIN_DUR").map((n) => {
    const { params, body } = extract(n);
    return `function ${n}(${params}) { ${body} }`;
  }).join("\n") + "\nreturn { " + PURE_FNS.join(", ") + " };"
)({ timelineZoom: 1 }, 24, 0.4, 4, CAPTION_MIN_DUR_TEST);

function run(name, args) {
  return sandbox[name](...args);
}

const SERVER_FNS = ["normalizeClientSegments"];
const srvSandbox = new Function(
  "cleanCaptionText",
  SERVER_FNS.map((n) => {
    const { params, body } = extractFrom(serverSrc, n);
    return `function ${n}(${params}) { ${body} }`;
  }).join("\n") + "\nreturn { " + SERVER_FNS.join(", ") + " };"
)((v) => String(v == null ? "" : v).trim());

function srvRun(name, args) {
  return srvSandbox[name].apply(null, args);
}

const srvResolveExport = new Function(
  "cleanCaptionText",
  [
    (() => { const f = extractFrom(serverSrc, "normalizeClientSegments"); return `function normalizeClientSegments(${f.params}) { ${f.body} }`; })(),
    "let getClipTranscriptSegments = null;",
    (() => { const f = extractFrom(serverSrc, "resolveExportSegments"); return `function resolveExportSegments(${f.params}) { ${f.body} }`; })()
  ].join("\n") + "\nreturn (payload, fallback) => { getClipTranscriptSegments = fallback; return resolveExportSegments(payload, null, null); };"
)((v) => String(v == null ? "" : v).trim());

(async () => {
  const cases = [
    ["P6 clampZoom bounds", () => {
      if (run("clampZoom", [0.1]) !== 0.4) throw new Error("low clamp");
      if (run("clampZoom", [10]) !== 4) throw new Error("high clamp");
      if (run("clampZoom", [1]) !== 1) throw new Error("identity");
      if (run("clampZoom", [undefined]) !== 1) throw new Error("undefined -> 1");
      if (run("clampZoom", ["abc"]) !== 1) throw new Error("NaN -> 1");
    }],
    ["P6 captionPxPerSec honors zoom", () => {
      if (run("captionPxPerSec", [1]) !== 24) throw new Error("zoom1 -> 24");
      if (run("captionPxPerSec", [2]) !== 48) throw new Error("zoom2 -> 48");
      if (run("captionPxPerSec", [0.5]) !== 12) throw new Error("zoom0.5 -> 12");
      if (run("captionPxPerSec", [100]) !== 96) throw new Error("clamped to 4 -> 96");
    }],
    ["P6 captionTimelineWidth", () => {
      if (run("captionTimelineWidth", [10, 1]) !== 240) throw new Error("10s@1x");
      if (run("captionTimelineWidth", [0, 2]) !== 48) throw new Error("min dur 1 @2x");
      if (run("captionTimelineWidth", [5, 0.5]) !== 60) throw new Error("5s@0.5x");
    }],
    ["P6 captionTickStep tiers", () => {
      if (run("captionTickStep", [96]) !== 0.5) throw new Error(">=60 -> 0.5");
      if (run("captionTickStep", [60]) !== 0.5) throw new Error("60 -> 0.5");
      if (run("captionTickStep", [48]) !== 1) throw new Error("48 -> 1");
      if (run("captionTickStep", [24]) !== 1) throw new Error("24 -> 1");
      if (run("captionTickStep", [12]) !== 5) throw new Error("12 -> 5");
      if (run("captionTickStep", [8]) !== 5) throw new Error("8 -> 5");
      if (run("captionTickStep", [4]) !== 10) throw new Error("4 -> 10");
    }],
    ["P6 captionTickTimes covers duration", () => {
      const ticks = run("captionTickTimes", [5, 24]);
      if (ticks[0].t !== 0 || ticks[0].left !== 0) throw new Error("first tick");
      const last = ticks[ticks.length - 1];
      if (last.t < 5) throw new Error("must cover dur");
      for (const tk of ticks) {
        if (Math.abs(tk.left - tk.t * 24) > 1e-6) throw new Error("left = t*pxPerSec");
      }
    }],
    ["P6 clampPlayheadTime", () => {
      if (run("clampPlayheadTime", [-3, 10]) !== 0) throw new Error("negative");
      if (run("clampPlayheadTime", [15, 10]) !== 10) throw new Error("over end");
      if (run("clampPlayheadTime", [4.2, 10]) !== 4.2) throw new Error("in range");
    }],
    ["P6 captionBlockPx", () => {
      const p = run("captionBlockPx", [{ start: 2, end: 3.5 }, 24]);
      if (p.left !== 48) throw new Error("left");
      if (p.width !== 36) throw new Error("width");
      const p2 = run("captionBlockPx", [{ start: 1, end: 1.1 }, 24]);
      if (p2.width !== 10) throw new Error("min width 10");
      const p3 = run("captionBlockPx", [{}, 24]);
      if (p3.left !== 0 || p3.width !== 10) throw new Error("missing fields");
    }],
    ["P6 captionPxToTime", () => {
      if (run("captionPxToTime", [48, 24]) !== 2) throw new Error("48px -> 2s");
      if (run("captionPxToTime", [0, 24]) !== 0) throw new Error("0 -> 0");
      if (run("captionPxToTime", [-10, 24]) !== 0) throw new Error("negative -> 0");
      if (run("captionPxToTime", [100, 0]) !== 0) throw new Error("zero pxPerSec guarded");
    }],
    ["P6 moveCaptionSegment", () => {
      const m = run("moveCaptionSegment", [{ start: 2, end: 4 }, 1.5, 10]);
      if (Math.abs(m.start - 3.5) > 1e-9 || Math.abs(m.end - 5.5) > 1e-9) throw new Error("move ok");
      const edge = run("moveCaptionSegment", [{ start: 8, end: 9.5 }, 5, 10]);
      if (Math.abs(edge.end - 10) > 1e-9) throw new Error("clamped at right edge");
      const neg = run("moveCaptionSegment", [{ start: 1, end: 3 }, -5, 10]);
      if (Math.abs(neg.start) > 1e-9 || Math.abs(neg.end - 2) > 1e-9) throw new Error("clamped at left edge");
      const zero = run("moveCaptionSegment", [{ start: 0, end: 0 }, 0, 10]);
      if (zero.end - zero.start < CAPTION_MIN_DUR_TEST) throw new Error("min duration");
    }],
    ["P6 resizeCaptionSegment edges", () => {
      const l = run("resizeCaptionSegment", [{ start: 2, end: 5 }, "left", 1, 10]);
      if (Math.abs(l.start - 1) > 1e-9 || Math.abs(l.end - 5) > 1e-9) throw new Error("resize left");
      const lbad = run("resizeCaptionSegment", [{ start: 2, end: 5 }, "left", 4.95, 10]);
      if (lbad.start !== 2 || lbad.end !== 5) throw new Error("resize left below min dur rejected");
      const r = run("resizeCaptionSegment", [{ start: 2, end: 5 }, "right", 6, 10]);
      if (Math.abs(r.start - 2) > 1e-9 || Math.abs(r.end - 6) > 1e-9) throw new Error("resize right");
      const rbad = run("resizeCaptionSegment", [{ start: 2, end: 5 }, "right", 2.05, 10]);
      if (rbad.start !== 2 || rbad.end !== 5) throw new Error("resize right below min dur rejected");
    }],
    ["P6 captionDragMode", () => {
      const mk = (cls) => ({ closest: (sel) => {
        if (sel.charAt(0) !== ".") return null;
        const searched = sel.slice(1);
        const owned = cls.split(" ").filter(Boolean);
        return owned.includes(searched) ? { className: cls } : null;
      } });
      if (run("captionDragMode", [mk("cb-resize-left")]) !== "resize-left") throw new Error("left handle");
      if (run("captionDragMode", [mk("cb-resize-right")]) !== "resize-right") throw new Error("right handle");
      if (run("captionDragMode", [mk("caption-block")]) !== "move") throw new Error("body");
      if (run("captionDragMode", [mk("other")]) !== null) throw new Error("outside");
    }],
    ["P6 srtTimestamp", () => {
      if (run("srtTimestamp", [0]) !== "00:00:00,000") throw new Error("zero");
      if (run("srtTimestamp", [1.5]) !== "00:00:01,500") throw new Error("1.5s");
      if (run("srtTimestamp", [61.25]) !== "00:01:01,250") throw new Error("minute rollover");
      if (run("srtTimestamp", [3661.999]) !== "01:01:01,999") throw new Error("hour rollover");
      if (run("srtTimestamp", [-5]) !== "00:00:00,000") throw new Error("negative");
    }],
    ["P6 buildSrt structure", () => {
      const srt = run("buildSrt", [[{ start: 0, end: 2, text: "Halo" }, { start: 3, end: 5.5, text: "Dunia" }]]);
      const lines = srt.split("\n");
      if (lines[0] !== "1") throw new Error("index 1");
      if (lines[1] !== "00:00:00,000 --> 00:00:02,000") throw new Error("first time");
      if (lines[2] !== "Halo") throw new Error("first text");
      const idx2 = lines.indexOf("2");
      if (idx2 === -1) throw new Error("index 2");
      if (lines[idx2 + 1] !== "00:00:03,000 --> 00:00:05,500") throw new Error("second time");
      if (lines[idx2 + 2] !== "Dunia") throw new Error("second text");
      if (!srt.includes("\n\n2\n")) throw new Error("blank line between blocks");
    }],
    ["P6 buildSrt filters & offset", () => {
      const withOffset = run("buildSrt", [[{ start: 1, end: 2, text: "A" }, { start: 4, end: 6, text: "B" }], 10]);
      if (!withOffset.includes("00:00:11,000 --> 00:00:12,000")) throw new Error("offset applied");
      if (!withOffset.includes("00:00:14,000 --> 00:00:16,000")) throw new Error("offset applied 2");
      const empty = run("buildSrt", [[{ start: 0, end: 1, text: "   " }]]);
      if (empty !== "") throw new Error("empty text filtered");
      const reversed = run("buildSrt", [[{ start: 5, end: 1, text: "X" }]]);
      if (reversed !== "") throw new Error("reversed times filtered");
      const singleLine = run("buildSrt", [[{ start: 0, end: 1, text: "A\nB" }]]);
      if (!singleLine.includes("A B")) throw new Error("newline flattened");
    }],
    ["P6 normalizeClientSegments applies offset", () => {
      const segs = srvRun("normalizeClientSegments", [[
        { start: 0, end: 2.5, text: "Halo", words: [{ text: "Halo", start: 0, end: 1.2 }] },
        { start: 3, end: 5, text: "Dunia" }
      ], 10]);
      if (segs.length !== 2) throw new Error("count");
      if (Math.abs(segs[0].start - 10) > 1e-9 || Math.abs(segs[0].end - 12.5) > 1e-9) throw new Error("start/end offset");
      if (Math.abs(segs[0].words[0].start - 10) > 1e-9 || Math.abs(segs[0].words[0].end - 11.2) > 1e-9) throw new Error("words offset");
      if (segs[0].text !== "Halo") throw new Error("text preserved");
    }],
    ["P6 normalizeClientSegments filters invalid", () => {
      const segs = srvRun("normalizeClientSegments", [[
        { start: 5, end: 1, text: "reversed" },
        { start: 0, end: 2, text: "   " },
        { start: 0, end: 2, text: "valid" }
      ], 0]);
      if (segs.length !== 1 || segs[0].text !== "valid") throw new Error("only valid kept");
      const noText = srvRun("normalizeClientSegments", [[{ start: 0, end: 2, text: "" }], 0]);
      if (noText.length !== 0) throw new Error("empty text dropped");
    }],
    ["P6 normalizeClientSegments word fallback end", () => {
      const segs = srvRun("normalizeClientSegments", [[
        { start: 1, end: 4, text: "X", words: [{ text: "X", start: 1 }] }
      ], 5]);
      if (segs[0].words[0].end < segs[0].words[0].start) throw new Error("end fallback >= start");
    }],
    ["P6 resolveExportSegments prefers client segments", () => {
      const payload = { start: 20, segments: [{ start: 1, end: 3, text: "client" }] };
      const called = { value: false };
      const fallback = () => { called.value = true; return [{ start: 30, end: 40, text: "server" }]; };
      const resolved = srvResolveExport(payload, fallback);
      if (called.value) throw new Error("must not call fallback");
      if (!resolved.length || resolved[0].text !== "client") throw new Error("client segments used");
      if (Math.abs(resolved[0].start - 21) > 1e-9) throw new Error("offset applied");
    }],
    ["P6 resolveExportSegments falls back on empty client", () => {
      const payload = { start: 20, segments: [] };
      const fallback = () => [{ start: 30, end: 40, text: "server" }];
      const resolved = srvResolveExport(payload, fallback);
      if (!resolved.length || resolved[0].text !== "server") throw new Error("server fallback used");
    }],
    ["P6 resolveExportSegments falls back when client invalid", () => {
      const payload = { start: 20, segments: [{ start: 5, end: 1, text: "bad" }] };
      const fallback = () => [{ start: 30, end: 40, text: "server" }];
      const resolved = srvResolveExport(payload, fallback);
      if (!resolved.length || resolved[0].text !== "server") throw new Error("server fallback used for invalid");
    }],
    ["P6 shared caption font ratio is 0.07", () => {
      const c = scriptSrc.match(/CAPTION_FONT_RATIO\s*=\s*([0-9.]+)/);
      const s = serverSrc.match(/CAPTION_FONT_RATIO\s*=\s*([0-9.]+)/);
      if (!c || !s) throw new Error("ratios missing");
      if (Number(c[1]) !== 0.07 || Number(s[1]) !== 0.07) throw new Error("client/server ratio must be 0.07");
      if (Number(c[1]) !== Number(s[1])) throw new Error("client/server ratio mismatch");
    }],
    ["P6 shared caption font base is 23", () => {
      const c = scriptSrc.match(/CAPTION_FONT_BASE\s*=\s*(\d+)/);
      const s = serverSrc.match(/CAPTION_FONT_BASE\s*=\s*(\d+)/);
      if (!c || !s) throw new Error("bases missing");
      if (Number(c[1]) !== 23 || Number(s[1]) !== 23) throw new Error("base must be 23");
    }],
    ["P6 karaoke ASS uses cyan primary colour", () => {
      const styleLine = serverSrc.split("\n").find((l) => l.includes("Style: Karaoke"));
      if (!styleLine) throw new Error("ASS style line not found");
      if (!styleLine.includes("&H00FFFF00")) throw new Error("primary colour must be cyan &H00FFFF00 (found " + (styleLine.match(/&H[0-9A-F]{8}/) || [])[0] + ")");
    }],
    ["P6 caption font ratio no stale 0.054", () => {
      if (serverSrc.includes("width * 0.054")) throw new Error("stale 0.054 font ratio in server");
    }]
  ];
  await Promise.all(cases.map(([name, fn]) => t(name, fn)));

  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL");
  for (const r of results) console.log(`[${r.status === "PASS" ? "OK  " : "FAIL"}] ${r.name}${r.error ? " - " + r.error : ""}`);
  console.log(`${passed}/${results.length} passed`);
  if (failed.length) {
    console.error(`\n${failed.length} FAILED:`);
    for (const f of failed) console.error(`  ${f.name}: ${f.error}`);
    process.exit(1);
  }
})();
