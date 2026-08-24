// ============================================================================
// CLIPPER STUDIO — CORE INTELLIGENCE DIRECTOR (Step 1-3)
//
// Layer pemahaman video di atas engine existing:
//   STEP 1  buildVideoUnderstanding : transcript+words -> sentences/speakers/
//                                     pauses (scenes/emotion = null, jujur)
//   STEP 2  detectHooks             : adapter Hook Engine existing
//                                     (scoreHook) -> hook candidates dengan
//                                     start/end/evidence/confidence
//   STEP 3  directStory/directStories : STORY DIRECTOR - susun
//                                     setup->context->development->key->payoff->
//                                     natural ending per hook, dengan
//                                     maxDuration sebagai HARD CEILING.
//
// Murni fungsi: tidak menyentuh queue/FFmpeg/manifest. Engine & lexicon
// di-inject lewat initDirector() agar tidak ada implementasi ganda.
// ============================================================================

let hookEngine = null;
let lexicons = null;

function initDirector(options = {}) {
  hookEngine = options.hookEngine || options.hookEngineModule || null;
  lexicons = options.clipmeWords || null;
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// ---------------------------------------------------------------------------
// STEP 1 - VIDEO UNDERSTANDING
// Segmen Whisper dipandu sebagai kalimat logis: segmen beruntun dengan gap
// <0.6s dan speaker sama digabung. Pauses dideteksi dari gap antar kalimat.
// Scene & emotion BELUM ada detektornya - dikembalikan null secara jujur.
// ---------------------------------------------------------------------------
function buildVideoUnderstanding(transcript, duration) {
  const segs = (Array.isArray(transcript) ? transcript : [])
    .map((s, i) => ({
      index: i,
      start: Number(s.start) || 0,
      end: Number(s.end) || 0,
      text: String(s.text || "").trim(),
      speakerId: String((Array.isArray(s.words) && s.words[0] && (s.words[0].speaker || s.words[0].speaker_id)) || s.speaker_id || "").trim(),
      words: (Array.isArray(s.words) ? s.words : []).map((w) => ({
        text: String(w.text || "").trim(),
        start: Number(w.start) || 0,
        end: Number(w.end) || 0,
        speakerId: String(w.speaker || w.speaker_id || "").trim()
      })).filter((w) => w.text)
    }))
    .filter((s) => s.text && s.end >= s.start);

  const sentences = [];
  for (const s of segs) {
    const prev = sentences[sentences.length - 1];
    if (prev && s.start - prev.end < 0.6 && prev.speakerId === s.speakerId) {
      prev.text += " " + s.text;
      prev.end = s.end;
      prev.wordCount += s.words.length || 1;
      if (!prev.speakerId) prev.speakerId = s.speakerId;
      prev.segmentIndexes.push(s.index);
      continue;
    }
    sentences.push({
      index: s.index,
      start: round1(s.start),
      end: round1(s.end),
      text: s.text,
      speakerId: s.speakerId,
      wordCount: s.words.length || 1,
      segmentIndexes: [s.index]
    });
  }

  const speakers = {};
  for (const st of sentences) {
    const k = st.speakerId || "";
    speakers[k] = (speakers[k] || 0) + (st.end - st.start);
  }

  const pauses = [];
  for (let i = 1; i < sentences.length; i++) {
    const gap = round1(sentences[i].start - sentences[i - 1].end);
    if (gap >= 0.45) {
      pauses.push({ start: sentences[i - 1].end, end: sentences[i].start, dur: gap });
    }
  }

  return {
    duration: Number(duration) || 0,
    sentences,
    wordCount: sentences.reduce((n, s) => n + s.wordCount, 0),
    speakers: Object.entries(speakers).map(([id, seconds]) => ({ id, seconds: round1(seconds) })),
    pauses,
    scenes: null,
    emotion: null
  };
}

// ---------------------------------------------------------------------------
// STEP 2 - HOOK INTELLIGENCE (adapter Hook Engine existing)
// Skor per kalimat via scoreHook; hanya kalimat dengan kekuatan cukup yang
// menjadi kandidat hook. Tidak ada skor karangan - semuanya dari engine.
// ---------------------------------------------------------------------------
function detectHooks(vu, langKey) {
  if (!hookEngine || typeof hookEngine.scoreHook !== "function") {
    return { available: false, hooks: [], reason: "hook engine unavailable" };
  }
  const hooks = [];
  for (const st of vu.sentences) {
    let r = null;
    try { r = hookEngine.scoreHook(st.text, langKey, {}); } catch {}
    if (!r) continue;
    const strength = Math.max(Number(r.deepScore) || 0, Number(r.score) || 0);
    if (strength < 35) continue;
    hooks.push({
      type: r.type || "",
      strength,
      start: st.start,
      end: st.end,
      sentenceIndex: st.index,
      evidence: st.text.slice(0, 140),
      confidence: clamp01((Number(r.confidence) || 50) / 100),
      originalHook: r.originalHook || st.text
    });
  }
  hooks.sort((a, b) => b.strength - a.strength);
  return { available: true, hooks };
}

// Sinyal lexicon dari server (CLIPME_WORDS) - di-inject, tidak diduplikasi.
function matchSignals(text, langKey) {
  const out = {};
  let total = 0;
  if (!lexicons || !text) return { out, total };
  const low = String(text).toLowerCase();
  const tags = [langKey === "mix" ? "id" : langKey, langKey === "mix" ? "en" : ""].filter(Boolean);
  for (const tag of tags) {
    const set = lexicons[tag];
    if (!set) continue;
    for (const [bucket, list] of Object.entries(set)) {
      if (!Array.isArray(list)) continue;
      let hits = 0;
      for (const w of list) {
        if (low.includes(String(w).toLowerCase())) hits++;
      }
      if (hits) {
        out[bucket] = (out[bucket] || 0) + hits;
        total += hits;
      }
    }
  }
  return { out, total };
}

// ---------------------------------------------------------------------------
// STEP 3 - STORY DIRECTOR
// Dari satu hook, berjalan maju membangun struktur:
//   hook -> context -> development -> key statement -> payoff -> natural ending
// Natural ending = akhir kalimat sebelum pause signifikan, atau akhir kalimat
// payoff/key. maxDuration adalah HARD CEILING - bukan target durasi.
// ---------------------------------------------------------------------------
function directStory(vu, hook, options = {}) {
  const maxDur = Math.max(10, Number(options.maxDuration) || 90);
  const minDur = Math.max(5, Number(options.minDuration) || 12);
  const langKey = options.langKey || "id";
  const ceiling = hook.start + maxDur;

  // Batas atas: hanya kalimat yang sebelum ceiling.
  const window = vu.sentences.filter((s) => s.start >= hook.start - 0.5 && s.end <= ceiling + 0.5);
  if (!window.length || window[0].index !== hook.sentenceIndex) {
    const firstIdx = vu.sentences.findIndex((s) => s.index === hook.sentenceIndex);
    if (firstIdx === -1) return null;
    window.length = 0;
    for (let i = firstIdx; i < vu.sentences.length; i++) {
      if (vu.sentences[i].end <= ceiling + 0.5) window.push(vu.sentences[i]);
      else break;
    }
  }
  if (!window.length) return null;

  const signals = window.map((s, i) => ({ i, ...matchSignals(s.text, langKey) }));

  // Key statement: kalimat dengan densitas sinyal tertinggi setelah hook
  // (fallback: kalimat tengah window).
  let keyRel = -1;
  let keyTotal = 0;
  for (const sg of signals) {
    if (sg.i === 0) continue;
    if (sg.total > keyTotal) { keyTotal = sg.total; keyRel = sg.i; }
  }
  if (keyRel === -1) keyRel = Math.min(window.length - 1, 1 + Math.floor((window.length - 1) / 2));

  // Payoff: sinyal payoff/reveal SETELAH kalimat key. Kalau kalimat key
  // sendiri membawa penanda payoff (umum: "jadi kesimpulannya..."), key
  // SEKALIGUS menjadi payoff.
  let payoffRel = -1;
  for (const sg of signals) {
    if (sg.i <= keyRel) continue;
    if ((sg.out.payoff || 0) + (sg.out.reveal || 0) > 0) { payoffRel = sg.i; break; }
  }
  if (payoffRel === -1) {
    const keySig = signals.find((x) => x.i === keyRel);
    if (keySig && (keySig.out.payoff || 0) + (keySig.out.reveal || 0) > 0) payoffRel = keyRel;
  }

  // Natural ending: pause >=0.6s tepat setelah kalimat kandidat akhir.
  let endRel = payoffRel !== -1 ? payoffRel : keyRel;
  const hasPauseAfter = (rel) => {
    const st = window[rel];
    return vu.pauses.some((p) => p.start >= st.end - 0.05 && p.start <= st.end + 0.9 && p.dur >= 0.55);
  };
  if (!hasPauseAfter(endRel)) {
    for (let r = Math.min(endRel + 2, window.length - 1); r > endRel; r--) {
      if (hasPauseAfter(r)) { endRel = r; break; }
    }
  }

  // Ceiling & floor enforcement.
  while (window[endRel].end - hook.start > maxDur && endRel > 0) endRel--;
  while (window[endRel].end - hook.start < minDur && endRel < window.length - 1) endRel++;

  const endSentence = window[endRel];
  const duration = round1(Math.min(maxDur, Math.max(minDur, endSentence.end - hook.start)));

  // Completeness dari sinyal nyata (bukan angka karangan):
  const payoffFound = payoffRel !== -1;
  const keyFound = keyTotal > 0;
  const endingClean = hasPauseAfter(endRel) || /[.!?\u2026]$/.test(endSentence.text.trim());
  const completeness = Math.round(
    clamp01(
      (payoffFound ? 0.4 : 0) +
      (keyFound ? 0.25 : 0) +
      (endingClean ? 0.2 : 0) +
      (duration >= minDur ? 0.15 : 0)
    ) * 100
  );

  return {
    hook,
    start: hook.start,
    end: round1(hook.start + duration),
    duration,
    structure: {
      setup: window[0].text.slice(0, 120),
      contextSentences: Math.min(keyRel, window.length - 1),
      developmentSentences: Math.max(0, endRel - keyRel),
      keyStatement: window[keyRel] ? window[keyRel].text.slice(0, 140) : "",
      payoffFound,
      payoffSentence: payoffRel !== -1 ? window[payoffRel].text.slice(0, 140) : "",
      endingAtPause: hasPauseAfter(endRel),
      endingSentence: endSentence.text.slice(0, 140),
      completeness
    },
    sentenceRange: { from: window[0].index, to: window[endRel].index }
  };
}

function directStories(vu, hooksResult, options = {}) {
  // Terima dua bentuk: {available,hooks} ATAU array hooks langsung.
  const list = Array.isArray(hooksResult)
    ? hooksResult
    : (hooksResult && Array.isArray(hooksResult.hooks) ? hooksResult.hooks : []);
  const available = Array.isArray(hooksResult) ? true : Boolean(hooksResult && hooksResult.available);
  if (!available || !list.length) return { available, stories: [] };
  const limit = Math.max(1, Number(options.limit) || 8);
  const seen = [];
  const stories = [];
  for (const hook of list) {
    const story = directStory(vu, hook, options);
    if (!story) continue;
    // Dedup awal: jangan dua cerita untuk hook yang tumpang tindih >60%.
    const overlap = seen.some((s) => {
      const inter = Math.max(0, Math.min(s.end, story.end) - Math.max(s.start, story.start));
      return inter / Math.min(s.duration, story.duration) > 0.6;
    });
    if (overlap) continue;
    seen.push({ start: story.start, end: story.end, duration: story.duration });
    stories.push(story);
    if (stories.length >= limit) break;
  }
  return { available: true, stories };
}

module.exports = {
  initDirector,
  buildVideoUnderstanding,
  detectHooks,
  matchSignals,
  directStory,
  directStories
};
