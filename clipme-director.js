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

// ---------------------------------------------------------------------------
// STEP 4 - CLIP DIRECTOR: candidate generation VARIATIF
// Dari tiap story dibuat varian akhir yang alami:
//   A = akhir natural (payoff/pause)   B = diperpanjang 1-2 kalimat
//   C = dipadatkan tepat setelah key (hanya bila aman)
// ---------------------------------------------------------------------------
function generateCandidates(vu, stories, options = {}) {
  const maxDur = Math.max(10, Number(options.maxDuration) || 90);
  const out = [];
  for (const story of stories || []) {
    const idxFrom = vu.sentences.findIndex((s) => s.index === story.sentenceRange.from);
    const idxTo = vu.sentences.findIndex((s) => s.index === story.sentenceRange.to);
    if (idxFrom === -1 || idxTo === -1) continue;

    const makeVariant = (endIdx, kind) => {
      const endSentence = vu.sentences[endIdx];
      const startSentence = vu.sentences[idxFrom];
      let duration = round1(endSentence.end - startSentence.start);
      if (duration > maxDur) {
        // geser mundur ke kalimat yang masih muat
        let e = endIdx;
        while (e > idxFrom && vu.sentences[e].end - startSentence.start > maxDur) e--;
        duration = round1(Math.min(maxDur, vu.sentences[e].end - startSentence.start));
        return { endIdx: e, duration, kind };
      }
      return { endIdx, duration, kind };
    };

    const variants = [];
    const vA = makeVariant(idxTo, "natural");
    if (vA.duration >= 5) variants.push(vA);

    const vB = makeVariant(Math.min(vu.sentences.length - 1, idxTo + 2), "extended");
    if (vB.endIdx > vA.endIdx && vB.duration >= 8) variants.push(vB);

    // Varian padat hanya bila payoff ada dan berada SETELAH key (tidak memotong resolusi).
    if (!story.structure.payoffFound || story.structure.payoffSentence) {
      const keyIdxGuess = vu.sentences.findIndex(
        (s) => story.structure.keyStatement && s.text.slice(0, 140) === story.structure.keyStatement
      );
      if (keyIdxGuess > idxFrom && keyIdxGuess < vA.endIdx) {
        const vC = makeVariant(keyIdxGuess, "tightened");
        if (vC.duration >= 10 && vC.duration < vA.duration) variants.push(vC);
      }
    }

    for (const v of variants) {
      const endSentence = vu.sentences[v.endIdx];
      out.push({
        start: story.start,
        end: round1(startEndSafe(vu.sentences[idxFrom], endSentence)),
        duration: round1(endSentence.end - vu.sentences[idxFrom].start),
        kind: v.kind,
        story,
        endSentenceIndex: v.endIdx,
        text: sliceClipText(vu.sentences, idxFrom, v.endIdx)
      });
    }
  }
  return out;
}

function startEndSafe(startSentence, endSentence) {
  return Math.max(startSentence.start, endSentence.end);
}

function sliceClipText(sentences, from, to) {
  return sentences.slice(from, to + 1).map((s) => s.text).join(" ");
}

// ---------------------------------------------------------------------------
// STEP 5 - VIRAL SCORING (evidence-based)
// Setiap dimensi dihitung dari sinyal nyata kandidat. Tanpa Math.random.
// Dimensi tanpa data (mis. emotion saat lexicon kosong) bernilai null dan
// tidak diikutkan rata-rata overall.
// ---------------------------------------------------------------------------
function tokenize(text) {
  return String(text || "").toLowerCase().match(/[a-zà-ÿ0-9']{3,}/g) || [];
}

function jaccard(aTokens, bTokens) {
  const A = new Set(aTokens);
  const B = new Set(bTokens);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / new Set([...A, ...B]).size;
}

function scoreCandidate(vu, cand, options = {}) {
  const langKey = options.langKey || "id";
  const sents = vu.sentences.filter((s) => s.start >= cand.start - 0.05 && s.end <= cand.end + 0.05);
  const text = cand.text;
  const { out: sig } = matchSignals(text, langKey);
  const wordsInClip = sents.reduce((n, s) => n + s.wordCount, 0) || 1;
  const durSec = Math.max(1, cand.duration);
  const wps = wordsInClip / durSec;

  const signalHits = (names) => names.reduce((n, k) => n + (sig[k] || 0), 0);
  const per10w = (hits) => clamp01(hits / (wordsInClip / 10) / 1.2) * 100;

  // HOOK: dari Hook Engine (sudah evidence-based).
  const hookScore = Number(cand.story.hook.strength) || 0;

  // RETENTION: hukum hening panjang di tengah + hadiah kecepatan bicara normal.
  const innerPauses = vu.pauses.filter((p) => p.start > cand.start + 1 && p.end < cand.end - 1);
  const deadAir = innerPauses.reduce((n, p) => n + Math.max(0, p.dur - 1.2), 0);
  const retention = Math.round(
    clamp01(1 - deadAir / (durSec * 0.25)) * 60 +
    clamp01(1 - Math.abs(wps - 2.8) / 2.8) * 40
  );

  // EMOTION: sinyal emosi/surprise/konflik per 10 kata (null bila lexicon kosong).
  const emoHits = signalHits(["emotion", "surprise", "problem", "controversy", "confession"]);
  const emotion = Object.keys(sig).length ? Math.round(per10w(emoHits)) : null;

  // COMPLETENESS: dari Story Director (payoff/key/ending/minDur).
  const completeness = Number(cand.story.structure.completeness) || 0;

  // PACING: varians panjang kalimat moderat + kepadatan kata stabil.
  const lens = sents.map((s) => s.text.split(/\s+/).length);
  const meanLen = lens.reduce((a, b) => a + b, 0) / Math.max(1, lens.length);
  const varLen = lens.reduce((a, b) => a + (b - meanLen) ** 2, 0) / Math.max(1, lens.length);
  const pacing = Math.round(
    clamp01(1 - Math.min(1, varLen / 60)) * 55 +
    clamp01(1 - Math.abs(wps - 2.8) / 2.8) * 45
  );

  // SHAREABILITY: payoff/reveal/value + pertanyaan retoris.
  const shareHits = signalHits(["payoff", "reveal", "value"]) + (text.match(/\?/g) || []).length;
  const shareability = Object.keys(sig).length ? Math.round(clamp01(shareHits / 6) * 100) : null;

  // FOCUS RELEVANCE (#18): overlap token fokus terhadap teks clip.
  const focus = String(options.focus || "").trim();
  let focusRelevance = null;
  if (focus) {
    const fTok = tokenize(focus);
    const cTok = new Set(tokenize(text));
    let hit = 0;
    for (const t of new Set(fTok)) if (cTok.has(t)) hit++;
    focusRelevance = Math.round(clamp01(hit / Math.max(1, new Set(fTok).size)) * 100);
  }

  // OVERALL: rata-rata tertimbang dimensi yang TERSEDIA saja (null dilewati).
  const dims = { hook: hookScore, retention, emotion, completeness, pacing, shareability };
  const weights = { hook: 0.3, retention: 0.2, emotion: 0.12, completeness: 0.2, pacing: 0.08, shareability: 0.1 };
  let sum = 0;
  let wsum = 0;
  for (const [k, w] of Object.entries(weights)) {
    const v = dims[k];
    if (v == null) continue;
    sum += v * w;
    wsum += w;
  }
  const overall = wsum ? Math.round(sum / wsum) : 0;

  return {
    hook: hookScore,
    retention,
    emotion,
    completeness,
    pacing,
    shareability,
    topicRelevance: focusRelevance,
    overall,
    _debug: { wps: round1(wps), deadAir: round1(deadAir), words: wordsInClip }
  };
}

// ---------------------------------------------------------------------------
// STEP 6 - SELECTION SCORE + STRATEGI HOOK + DEDUP KONTEN + RANKING
// score TIDAK pernah diubah oleh focus/strategi; hanya selectionScore.
// ---------------------------------------------------------------------------
const HOOK_STRATEGY_MAP = {
  curiosity: ["CURIOSITY", "QUESTION", "MYSTERY"],
  story: ["STORY", "CONFESSION", "PERSONAL"],
  educational: ["EDUCATIONAL", "VALUE", "TUTORIAL", "HOWTO"],
  direct: ["DIRECT VALUE", "VALUE", "LIST"],
  controversy: ["CONTROVERSY", "DEBATE", "HOT TAKE"]
};

function strategyMatches(strategy, hookType) {
  const pref = HOOK_STRATEGY_MAP[String(strategy || "").toLowerCase()];
  if (!pref || !hookType) return null;
  const ht = String(hookType).toUpperCase();
  if (pref.some((p) => ht.includes(p))) return 1;
  return 0;
}

function computeSelectionScore(scoring, options = {}) {
  const strategy = String(options.hookStrategy || "").toLowerCase();
  let base = scoring.overall;
  // Strategi: delta terbatas +-8 poin pada basis seleksi (bukan pada score).
  if (strategy && strategy !== "balanced" && scoring._hookType != null) {
    const m = strategyMatches(strategy, scoring._hookType);
    if (m === 1) base += 8;
    else if (m === 0) base -= 8;
  }
  if (scoring.topicRelevance != null) {
    base = base * 0.65 + scoring.topicRelevance * 0.35;
  }
  return Math.max(0, Math.min(100, Math.round(base)));
}

// WHY THIS CLIP: hanya dari flag/sinyal nyata kandidat (#13).
function explainCandidate(cand) {
  const s = cand.scoring;
  const st = [];
  const wk = [];
  if (s.hook >= 70) st.push("Strong opening");
  if (s.completeness >= 70) st.push("Complete thought");
  if (cand.story.structure.payoffFound) st.push("Clear payoff");
  if (cand.story.structure.endingAtPause) st.push("Natural pause ending");
  if (s._debug && s._debug.deadAir <= 0.5) st.push("No dead air");
  if (s.hook < 50) wk.push("Hook lemah");
  if (!cand.story.structure.payoffFound) wk.push("Payoff tidak terdeteksi");
  if (s._debug && s._debug.deadAir > 0.5) wk.push("Ada hening panjang di tengah");
  if (!/[.!?\u2026]$/.test(String(cand.text).trim())) wk.push("Ending tidak pada batas kalimat");
  const reason = [`Hook ${s.hook}/100`, `Completeness ${s.completeness}%`, `Durasi ${cand.duration}s`];
  return { strengths: st, weaknesses: wk, reason };
}

function rankCandidates(vu, candidates, options = {}) {
  const limit = Math.max(1, Number(options.limit) || 8);
  const ranked = candidates.map((cand) => {
    const scoring = scoreCandidate(vu, cand, options);
    scoring._hookType = cand.story.hook.type || "";
    scoring.selectionScore = computeSelectionScore(scoring, options);
    return { ...cand, scoring };
  });

  // Dedup KONTEN: Jaccard teks >0.55 dianggap moment yang sama.
  ranked.sort((a, b) => b.scoring.selectionScore - a.scoring.selectionScore);
  const kept = [];
  const keptTokens = [];
  for (const c of ranked) {
    const tok = tokenize(c.text);
    if (keptTokens.some((t) => jaccard(t, tok) > 0.55)) continue;
    c.explain = explainCandidate(c);
    kept.push(c);
    keptTokens.push(tok);
    if (kept.length >= limit) break;
  }
  return kept;
}

module.exports = {
  initDirector,
  buildVideoUnderstanding,
  detectHooks,
  matchSignals,
  directStory,
  directStories,
  generateCandidates,
  scoreCandidate,
  jaccard,
  computeSelectionScore,
  strategyMatches,
  rankCandidates
};
