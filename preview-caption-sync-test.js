// Regression test: preview caption (overlay + static box) must stay in sync
// with the caption timeline when segments are translated to the target
// language. Previously selectClip/playSelectedClip left the live overlay
// disabled and showed the original (English) clip.caption, while the timeline
// had already switched to Indonesian. Also covers getSpeakerColor crash.
const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

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

// ── Minimal DOM mock ────────────────────────────────────────────────────────
function makeStyle() {
  const s = {};
  return new Proxy(s, {
    get(t, p) {
      if (p === "removeProperty") return (k) => { delete t[k]; };
      if (p === "setProperty") return (k, v) => { t[k] = v; };
      return t[p];
    },
    set(t, p, v) { t[p] = v; return true; }
  });
}

function makeEl(tag) {
  const base = {
    tagName: String(tag || "div").toUpperCase(),
    style: makeStyle(),
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    children: [],
    _listeners: {},
    _text: "",
    _innerHTML: "",
    value: "",
    checked: false,
    disabled: false,
    src: "",
    currentTime: 0,
    paused: true,
    ended: false,
    videoWidth: 1920,
    videoHeight: 1080,
    scrollLeft: 0,
    clientWidth: 500
  };
  base.childNodes = [
    { nodeType: 3, textContent: "" },
    { nodeType: 3, _t: "", set textContent(v) { this._t = String(v); }, get textContent() { return this._t; } }
  ];
  Object.defineProperty(base.childNodes, "length", { value: 2, writable: false });

  const el = new Proxy(base, {
    get(target, prop) {
      if (prop === "textContent") return target._text != null ? target._text : "";
      if (prop === "innerHTML") return target._innerHTML != null ? target._innerHTML : "";
      if (prop in target) {
        const v = target[prop];
        return typeof v === "function" ? v.bind(target) : v;
      }
      if (prop === "parentNode") return null;
      if (typeof prop === "string" && !prop.startsWith("_")) {
        if (!(prop in target)) target[prop] = () => {};
      }
      return target[prop];
    },
    set(target, prop, value) {
      if (prop === "textContent") target._text = String(value);
      else if (prop === "innerHTML") { target._innerHTML = String(value); target.children = []; }
      else target[prop] = value;
      return true;
    }
  });
  el.appendChild = (c) => { base.children.push(c); return c; };
  el.removeChild = (c) => { const i = base.children.indexOf(c); if (i >= 0) base.children.splice(i, 1); return c; };
  el.remove = () => {};
  el.addEventListener = (type, fn) => { (base._listeners[type] = base._listeners[type] || []).push(fn); };
  el.dispatchEvent = (ev) => { const t = ev && ev.type; (base._listeners[t] || []).slice().forEach((fn) => fn(ev)); };
  el.querySelector = () => makeEl("div");
  el.querySelectorAll = () => [];
  el.focus = () => {};
  el.click = () => {};
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 150 });
  el.play = () => { base.paused = false; return Promise.resolve(); };
  el.pause = () => { base.paused = true; };
  el.setAttribute = () => {};
  el.getAttribute = () => null;
  el.removeAttribute = () => {};
  el.scrollIntoView = () => {};
  el.append = (...kids) => kids.forEach((k) => base.children.push(k));
  el.offsetWidth = 300;
  el.offsetHeight = 500;
  return el;
}

const doc = {
  _els: {},
  getElementById(id) {
    if (!this._els[id]) this._els[id] = makeEl("div");
    return this._els[id];
  },
  querySelector(sel) {
    const m = /^#(.+)$/.exec(sel);
    if (m) return this.getElementById(m[1]);
    return makeEl("div");
  },
  querySelectorAll() { return []; },
  createElement(tag) { return makeEl(tag); },
  createTextNode(t) { return { text: String(t) }; },
  addEventListener() {},
  body: makeEl("body"),
  documentElement: makeEl("html")
};

function loadScriptIntoVm() {
  const sandbox = {
    document: doc,
    navigator: { userAgent: "node-test", language: "id" },
    fetch: async () => ({ ok: true, json: async () => ({ models: [], segments: [], caption: "" }) }),
    Blob: class { constructor() {} },
    URL: { createObjectURL: () => "blob:x", revokeObjectURL: () => {} },
    FileReader: class { readAsText() {} },
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    setInterval: () => 0,
    clearInterval: () => {},
    localStorage: { getItem: () => null, setItem: () => {} },
    console,
    set: () => {}, // pre-existing stub in loadEngineCompute
    setTimeout, clearTimeout,
    Math, Date, JSON, Promise, Number, String, Boolean, Array, Object, RegExp, Error,
    isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.addEventListener = () => {};
  sandbox.performance = Date;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync("script.js", "utf8"), sandbox, { filename: "script.js" });
  return {
    run: (script) => vm.runInContext(script, sandbox, { filename: "sync-test.js" })
  };
}

const NL = String.fromCharCode(10);

test("selectClip restores translated liveSegments + static box from cache", () => {
  const ctx = loadScriptIntoVm();
  const out = ctx.run(`
(function() {
  const results = [];
  state.projectId = "p";
  clips = [{ id: 1, start: 10, end: 40, caption: "English clip caption.", hook: "h", title: "T", score: 60 }];
  state.activeClip = clips[0];
  state.sourceDuration = 120;
  state.noDownload = false;
  state.sourceUrl = "/media/p";
  state.youtubeUrl = "";
  state.liveOffset = 10;
  document.getElementById("captionStyleSelect").value = "bold";

  const idSegs = [
    { start: 0, end: 1.5, text: "Halo dunia ini bahasa Indonesia", speaker_id: "", words: [] }
  ];
  state.captionSegments = idSegs.map(s => ({ ...s }));
  state.liveSegments = idSegs.map(s => ({ ...s }));
  state.captionByClip[captionTimelineKey()] = idSegs.map(s => ({ ...s }));
  state.captionLoadedFor = captionTimelineKey();
  state.liveActive = true;
  loadCaptionTimeline(state.liveSegments);

  selectClip(clips[0]); // re-select same clip (the reported scenario)
  results.push("liveActive=" + state.liveActive);
  results.push("captionSegments=" + state.captionSegments.length);
  results.push("liveSegments=" + state.liveSegments[0].text);
  results.push("captionBox=" + captionBox.textContent);
  return results.join(",");
})()
`);
  assert.ok(out.includes("liveSegments=Halo dunia ini bahasa Indonesia"), "liveSegments must be restored: " + out);
  assert.ok(out.includes("captionBox=\"Halo dunia ini bahasa Indonesia\""), "static box must show translated text: " + out);
});

test("playSelectedClip re-enables live overlay with translated segments", () => {
  const ctx = loadScriptIntoVm();
  const out = ctx.run(`
(function() {
  const results = [];
  state.projectId = "p";
  clips = [{ id: 1, start: 0, end: 30, caption: "English.", hook: "h", title: "T", score: 60 }];
  state.activeClip = clips[0];
  state.sourceDuration = 60;
  state.sourceUrl = "/media/p";
  state.youtubeUrl = "";
  state.noDownload = false;
  state.liveOffset = 0;
  document.getElementById("captionStyleSelect").value = "bold";

  const idSegs = [
    { start: 0, end: 1.5, text: "Halo dunia ini bahasa Indonesia", speaker_id: "", words: [] }
  ];
  state.captionSegments = idSegs.map(s => ({ ...s }));
  state.liveSegments = idSegs.map(s => ({ ...s }));
  state.captionByClip[captionTimelineKey()] = idSegs.map(s => ({ ...s }));
  state.captionLoadedFor = captionTimelineKey();
  state.liveActive = false; // selectClip turned it off
  loadCaptionTimeline(state.liveSegments);

  previewVideo.currentTime = 0.5;
  playSelectedClip();
  const cap = liveCaption.children[0];
  const span = cap && cap.children && cap.children[0];
  results.push("liveActive=" + state.liveActive);
  results.push("display=" + liveCaption.style.display);
  results.push("text=" + (span ? span._text : "?"));
  return results.join(",");
})()
`);
  assert.ok(out.includes("liveActive=true"), "play must enable live caption: " + out);
  assert.ok(out.includes("text=Halo dunia ini bahasa Indonesia"), "overlay must show translated text: " + out);
});

test("getSpeakerColor defined — no crash when segments have speaker_id", () => {
  const ctx = loadScriptIntoVm();
  const out = ctx.run(`
(function() {
  const results = [];
  state.projectId = "p";
  clips = [{ id: 1, start: 0, end: 30, caption: "English.", hook: "h", title: "T", score: 60 }];
  state.activeClip = clips[0];
  state.sourceDuration = 60;
  state.sourceUrl = "/media/p";
  state.youtubeUrl = "";
  state.liveOffset = 0;
  document.getElementById("captionStyleSelect").value = "bold";

  const segs = [
    { start: 0, end: 1.5, text: "Halo dunia bahasa Indonesia", speaker_id: "SPEAKER_00", words: [] }
  ];
  state.captionSegments = segs.map(s => ({ ...s }));
  state.liveSegments = segs.map(s => ({ ...s }));
  state.captionByClip[captionTimelineKey()] = segs.map(s => ({ ...s }));
  state.liveActive = true;
  loadCaptionTimeline(state.liveSegments);

  let crashed = false;
  try {
    previewVideo.currentTime = 0.5;
    updateLiveCaption();
  } catch (e) { crashed = true; results.push("err=" + e.message); }
  const span = liveCaption.children[0] && liveCaption.children[0].children && liveCaption.children[0].children[0];
  results.push("crashed=" + crashed);
  results.push("display=" + liveCaption.style.display);
  results.push("text=" + (span ? span._text : "?"));
  return results.join(",");
})()
`);
  assert.ok(out.includes("crashed=false"), "must not crash: " + out);
  assert.ok(out.includes("text=Halo dunia bahasa Indonesia"), "overlay must render: " + out);
});

test("loadCaptionTimeline keeps liveSegments in sync (restore path)", () => {
  const ctx = loadScriptIntoVm();
  const out = ctx.run(`
(function() {
  const results = [];
  state.projectId = "p";
  clips = [{ id: 1, start: 0, end: 30, caption: "English.", hook: "h", title: "T", score: 60 }];
  state.activeClip = clips[0];
  state.sourceDuration = 60;
  state.sourceUrl = "/media/p";
  state.youtubeUrl = "";
  state.liveOffset = 0;
  state.liveSegments = [{ start: 99, end: 100, text: "STALE" }];

  loadCaptionTimeline([
    { start: 0, end: 1.5, text: "Konten terjemahan baru", words: [] }
  ]);
  results.push("live=" + state.liveSegments[0].text);
  results.push("cap=" + state.captionSegments[0].text);
  return results.join(",");
})()
`);
  assert.ok(out.includes("live=Konten terjemahan baru"), "liveSegments must follow timeline: " + out);
  assert.ok(out.includes("cap=Konten terjemahan baru"), "captionSegments must be set: " + out);
});

test("script.js references getSpeakerColor which is now defined", () => {
  const src = fs.readFileSync("script.js", "utf8");
  assert.ok(/function getSpeakerColor\(/.test(src), "getSpeakerColor must be defined");
  assert.ok(src.includes("getSpeakerColor(seg.speaker_id)"), "still used by updateLiveCaption");
});

if (!process.exitCode) console.log(`Preview-caption sync done: ${results.length}/${results.length} PASS`);
