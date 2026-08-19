// ============================================================================
// CLIPME EDITORIAL OPENING ENGINE
// ----------------------------------------------------------------------------
// Mengubah Hook Engine menjadi Editorial Opening Engine. Alur:
//   CONTENT UNDERSTANDING → MOMENT DETECTION → OPEN LOOP → PAYOFF →
//   STRATEGY (KEEP/REFRAME/REWRITE/COLD_OPEN/HYBRID) → VALIDATION →
//   EDITORIAL SCORE → CLIP STRUCTURE.
//
// Prinsip:
//   - Jangan bertanya "hook apa yang bisa dibuat?" tapi "momen mana yang
//     paling kuat, dan bisakah dia jadi pembuka?"
//   - Kalimat asli yang kuat TIDAK ditulis ulang (ORIGINAL IS BEST valid).
//   - Context dependency adalah sinyal penalti, bukan emosi saja.
//   - Source fidelity adalah hard gate: tidak menambah fakta/angka/klaim baru.
//   - CPU-first, deterministik, tanpa LLM.
//
// Semua momen berisi { start, end, text } (detik). Fungsi utama:
//   detectMoments(segments, lang, opts)
//   buildOpeningDecision(segments, lang, opts)
// ============================================================================
const HE = require("./clipme-hook-engine.js");

const cleanText = HE.cleanText;
const wordsOf = HE.helpers.wordsOf;
const langTag = HE.langTag;
const detectQuestion = HE.helpers.detectQuestion;
const detectParallelStructure = HE.helpers.detectParallelStructure;
const detectResultFirst = HE.helpers.detectResultFirst;

// ---------------------------------------------------------------------------
// ROLE / CONTENT UNDERSTANDING — sinyal deterministik id+en, tanpa LLM.
// ---------------------------------------------------------------------------
const ROLE_SIGNALS = {
  ANSWER: [
    /(karena itu|karena itulah|jawabannya|alasannya|ternyata|kuncinya|intinya|the reason|because|that's why|the answer|turns out|it's simple|sebenarnya)|^jadi\b|^so\b|^karena\b|^because\b/i
  ],
  PAYOFF: [
    /(akhirnya|pada akhirnya|setelah itu|dan sekarang|hasilnya|ternyata|the end|in the end|eventually|and that's when|sejak saat itu|sejak itu)/i
  ],
  LESSON: [
    /(pelajaran|pelajarannya|yang saya pelajari|belajar|learned|the lesson|lesson learned|kuncinya adalah|yang paling penting|the key is)/i
  ],
  CONFLICT: [
    /(tapi|namun|padahal|justru|sedangkan|sementara|versus|vs|malah|sebaliknya|but|however|whereas|while|instead of|yet|still)/i,
    /(bertengkar|berselisih|debat|menolak|menentang|dilarang|gagal|menggagalkan|failed|rejected|fired|disagree)/i
  ],
  REVELATION: [
    /(ternyata|rupanya|turns out|it turns out|revealed|ternyata begitu|ketahuan|ketahuan)/i,
    /(rahasia|secret|fakta yang|the fact|mengejutkan|shocking|surprising|nggak nyangka|tidak menyangka|never expected|didn't expect)/i
  ],
  CONSEQUENCE: [
    /(kehilangan|lost|kehilangan segalanya|bangkrut|kolaps|collapsed|hancur|ruined|destroyed|cost (me|us)|rugi|gagal|failed|habis|habisan|dampaknya|the impact|konsekuensi|consequence)/i,
    /(ribu|juta|miliar|triliun|thousand|million|billion|\$\d|[0-9]+(k|rb|jt|M|B)?\s*(rupiah|dolar|tahun|bulan|hari|persen|%))/i
  ],
  CONFESSION: [
    /(jujur|sejujurnya|honestly|to be honest|i admit|i was wrong|gue gak nyangka|saya tidak nyangka|aku kira|i thought|ternyata saya|saya salah|i was wrong|saya akui|aku akui)/i
  ],
  TRANSFORMATION: [
    /(berubah|berhasil|sukses|menjadi|bertumbuh|grew|changed|transformed|became|turned into|akhirnya bisa|from .* to )/i
  ],
  STORY: [
    /(awalnya|mulai|kemudian|setelah itu|lalu|one day|then|after that|back then|at the time|years ago|the story|dulu)/i,
    /(cerita|kisah|story|pengalaman|experience)/i
  ],
  OPINION: [
    /(menurut (saya|gue|aku)|saya rasa|aku rasa|gue rasa|menurutku|i think|in my opinion|i believe|from my experience)/i
  ],
  OPEN_LOOP: [
    /(langkah selanjutnya|akan saya|akan gue|nanti|selanjutnya|next (time|step)|i will show|masih ada|tapi tunggu|belum selesai|ingin tahu|mau tahu|wait till)/i
  ],
  FACT: [
    /\d|%|persen|statistik|data|riset|survey|penelitian|research|study|angka/i
  ]
};

function contentRoles(text, lang) {
  const roles = [];
  const low = String(text || "").toLowerCase();
  if (detectQuestion(text)) roles.push("QUESTION");
  for (const key of Object.keys(ROLE_SIGNALS)) {
    if (ROLE_SIGNALS[key].some((re) => re.test(low))) roles.push(key);
  }
  // CLAIM default untuk kalimat deklaratif yang bukan hanya sapaan.
  const hasSubstance = wordsOf(text).length >= 3;
  if (hasSubstance && !roles.includes("QUESTION") && !roles.includes("STORY")) roles.push("CLAIM");
  if (!roles.length) roles.push("CONTEXT");
  return roles;
}

function isFillerSegment(text, lang) {
  const opener = HE.helpers.openerCategory(text, lang);
  return opener !== "none" || wordsOf(text).length < 2 || /^(jadi gini|so basically|okay|oke|nah|hmm|um|uh)\b/i.test(String(text || "").trim());
}

// ---------------------------------------------------------------------------
// MOMENT DETECTION ENGINE
// ---------------------------------------------------------------------------
function detectMoments(segments, lang, options) {
  const opts = options || {};
  const langKey = langTag(lang);
  const segs = (segments || [])
    .map((s, index) => ({
      index,
      text: cleanText(s && s.text),
      start: Number((s && s.start) != null ? s.start : index),
      end: Number((s && s.end) != null ? s.end : index + 1)
    }))
    .filter((s) => s.text);
  if (!segs.length) return [];

  const moments = [];
  const prevEnds = [];
  let prevEnd = null;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const duration = Math.max(0.3, seg.end - seg.start);
    const isFiller = isFillerSegment(seg.text, langKey);
    const score = HE.scoreHook(seg.text, langKey, { index: i, sentences: segs.map((s) => s.text) });
    const penalties = score.penalties || {};
    const roles = contentRoles(seg.text, langKey);

    // Information density — konten per detik; filler menurunkan.
    const contentWords = wordsOf(seg.text).filter((w) => !/^(jadi|gini|oke|nah|ya|um|uh|eh|terus|kan|si)$/.test(w)).length;
    const fillerWords = wordsOf(seg.text).filter((w) => /^(jadi|gini|oke|nah|ya|um|uh|eh|kan|si)$/.test(w)).length;
    const wps = contentWords / duration;
    const infoDensity = Math.max(0, Math.min(1, wps / 3.2 - fillerWords * 0.06));

    // Context dependency — makin tinggi, makin butuh konteks sebelumnya.
    const startsContinuation = /^(itu|ini|tersebut|mereka|dia|ia|the reason|karena itu|that's why|dan|and|tapi|but|malah|sehingga|jadi dia|so then)\b/i.test(seg.text.trim());
    const startsPronoun = penalties.deictic > 0 || penalties.pronounNoAntecedent > 0;
    const midDeictic = /\b(itu|ini|tersebut|itu tadi|hal ini|hal itu|dia|mereka|the reason|that's why)\b/i.test(seg.text) && !startsPronoun;
    const isOpenener = isFiller || HE.helpers.openerCategory(seg.text, langKey) !== "none";
    let contextDependency = (startsPronoun ? 0.35 : 0) + (midDeictic ? 0.15 : 0) + (startsContinuation ? 0.25 : 0) + (isOpenener ? 0.3 : 0);
    if (i === 0) contextDependency = Math.max(0, contextDependency - 0.3);
    if (wordsOf(seg.text).length <= 2) contextDependency += 0.15;
    contextDependency = Math.max(0, Math.min(1, contextDependency));

    // Delivery — dari timing bila tersedia.
    let delivery = 0.5;
    if (prevEnd != null) {
      const gap = seg.start - prevEnd;
      if (gap > 1.2) delivery -= 0.25;
      if (gap < 0.25) delivery += 0.1;
    }
    if (wps >= 2) delivery += 0.2;
    else if (wps < 0.8) delivery -= 0.15;
    if (seg.emphasis_words && seg.emphasis_words.length) delivery += 0.15;
    delivery = Math.max(0, Math.min(1, delivery));
    prevEnds.push(seg.end);
    prevEnd = seg.end;

    moments.push({
      index: i,
      start: seg.start,
      end: seg.end,
      text: seg.text,
      roles,
      filler: isFiller,
      deep: score.deep,
      dimensions: score.dimensions || {},
      evidence: score.evidence || {},
      penalties,
      infoDensity: Math.round(infoDensity * 100) / 100,
      contextDependency: Math.round(contextDependency * 100) / 100,
      delivery: Math.round(delivery * 100) / 100
    });
  }

  // Story arc — SETUP → CONFLICT → TURNING_POINT → PAYOFF bila naratif.
  assignStoryArc(moments);

  // Open loop & payoff.
  for (let i = 0; i < moments.length; i++) {
    const m = moments[i];
    const later = moments.slice(i + 1);
    const hasPayoffLater = later.some((x) => x.roles.includes("PAYOFF") || x.roles.includes("ANSWER") || x.roles.includes("LESSON"));
    m.openLoop = (m.roles.includes("QUESTION") || m.roles.includes("OPEN_LOOP")) && !hasPayoffLater;
    m.payoff = findPayoff(moments, i);
  }

  // Editorial moment score.
  for (const m of moments) {
    m.momentScore = momentScore(m, langKey);
  }
  return moments;
}

function assignStoryArc(moments) {
  const narrativeCount = moments.filter((m) => m.roles.includes("STORY") || m.roles.includes("PAYOFF") || m.roles.includes("REVELATION")).length;
  const isNarrative = narrativeCount >= 2 && moments.length >= 4;
  for (let i = 0; i < moments.length; i++) {
    const pos = moments.length > 1 ? i / (moments.length - 1) : 0;
    let role = "DEVELOPMENT";
    let importance = 0.6;
    if (isNarrative) {
      if (pos < 0.3) { role = "SETUP"; importance = 0.45; }
      else if (pos < 0.55) { role = "CONFLICT"; importance = 0.75; }
      else if (pos < 0.8) { role = "TURNING_POINT"; importance = 0.9; }
      else { role = "PAYOFF"; importance = 0.85; }
    }
    moments[i].storyRole = role;
    // Reveal/payoff hanya menaikkan kepentingan sedikit, tidak memaksa tinggi.
    moments[i].narrativeImportance = moments[i].roles.includes("REVELATION") || moments[i].roles.includes("PAYOFF")
      ? Math.min(importance + 0.15, 0.9)
      : importance;
  }
}

function findPayoff(moments, index) {
  const later = moments.slice(index + 1);
  const pick = later.find((x) => x.roles.includes("PAYOFF") || x.roles.includes("ANSWER") || x.roles.includes("LESSON"));
  if (!pick) return null;
  return { index: pick.index, start: pick.start, end: pick.end, text: pick.text, role: pick.roles.find((r) => ["PAYOFF", "ANSWER", "LESSON"].includes(r)) || "PAYOFF" };
}

function momentScore(moment, langKey) {
  const independence = 1 - moment.contextDependency;
  const roleBonus =
    (moment.roles.includes("REVELATION") ? 0.06 : 0) +
    (moment.roles.includes("CONFLICT") ? 0.05 : 0) +
    (moment.roles.includes("CONSEQUENCE") ? 0.06 : 0) +
    (moment.roles.includes("OPEN_LOOP") || moment.openLoop ? 0.05 : 0) +
    (moment.roles.includes("PAYOFF") ? 0.02 : 0);
  const raw =
    0.4 * (moment.deep / 100) +
    0.2 * moment.infoDensity +
    0.2 * independence +
    0.08 * moment.delivery +
    0.12 * (moment.narrativeImportance != null ? moment.narrativeImportance : 0.6) +
    roleBonus;
  const score = Math.max(0, Math.min(100, Math.round(raw * 100)));
  moment.editorialFactors = {
    content: Math.round((moment.deep / 100) * 100),
    infoDensity: Math.round(moment.infoDensity * 100),
    independence: Math.round(independence * 100),
    delivery: Math.round(moment.delivery * 100),
    narrative: moment.narrativeImportance != null ? Math.round(moment.narrativeImportance * 100) : 60,
    roleBonus: Math.round(roleBonus * 100)
  };
  return score;
}

// ---------------------------------------------------------------------------
// STRATEGY DECISION TREE — KEEP / REFRAME / REWRITE / COLD_OPEN / HYBRID
// ---------------------------------------------------------------------------
function decideStrategy(moments, langKey, options) {
  const opts = options || {};
  const real = moments.filter((m) => !m.filler);
  if (!real.length) return { strategy: "KEEP", index: moments[0] ? moments[0].index : 0, reason: "Tidak ada momen kuat; pertahankan pembuka asli." };

  const first = real[0];
  const best = real.slice().sort((a, b) => b.momentScore - a.momentScore || a.index - b.index)[0];
  const isFirst = best.index === first.index || best.index - first.index <= 0;

  // Opsi user: pertahankan ucapan asli.
  if (opts.keepOriginal || opts.keepOriginalSpeech) {
    return { strategy: "KEEP", index: first.index, reason: "Opsi 'pertahankan ucapan asli' aktif — pembuka menggunakan kalimat pertama yang kuat." };
  }

  // STEP 1 — KEEP: momen terkuat memang pembuka.
  if (isFirst) {
    return { strategy: "KEEP", index: best.index, reason: "Momen terkuat sudah berada di posisi pembuka; tidak perlu direstrukturisasi." };
  }

  // STEP 2 — COLD_OPEN: momen terkuat muncul belakangan, mandiri, jelas lebih kuat.
  const gap = best.momentScore - first.momentScore;
  if (best.contextDependency <= 0.45 && gap >= 6) {
    return {
      strategy: "COLD_OPEN",
      index: best.index,
      reason: `Momen terkuat (${best.momentScore}/100) muncul di #${best.index + 1} dan mandiri dari konteks; buka clip dari sana, lalu beri konteks singkat.`
    };
  }

  // STEP 3 — REFRAME: kuat namun butuh konteks; pindah ke posisi depan + konteks.
  if (gap >= 8) {
    return {
      strategy: "REFRAME",
      index: best.index,
      reason: `Momen terkuat (#${best.index + 1}) butuh konteks; pindahkan ke posisi depan dengan konteks penjelas setelahnya.`
    };
  }

  // STEP 4 — REWRITE: buka asli lemah, rewrite source-faithful bisa membantu.
  if (!opts.disableRewrite && first.momentScore < 55 && best.momentScore > 0) {
    return {
      strategy: "REWRITE",
      index: best.index,
      reason: "Pembuka asli lemah; hook editorial ringkas (tetap source-faithful) dapat memperkuat pembuka tanpa mengubah fakta."
    };
  }

  // HYBRID: pembuka asli pendek + momen kuat menyusul — kombinasikan.
  if (wordsOf(first.text).length <= 8 && best.index > first.index) {
    return { strategy: "HYBRID", index: best.index, reason: "Pembuka asli pendek dan momen kuat menyusul; gunakan pembuka singkat + momen sebagai hook kedua." };
  }

  return { strategy: "KEEP", index: first.index, reason: "Tidak ada peningkatan editorial yang aman; pertahankan pembuka asli." };
}

// ---------------------------------------------------------------------------
// CLIP STRUCTURE — HOOK → CONTEXT → DEVELOPMENT → PAYOFF
// ---------------------------------------------------------------------------
function buildClipStructure(moments, decision) {
  const chosen = decision.sourceMoment;
  if (!chosen) return [];
  const all = moments;
  const structure = [];
  const used = new Set();
  const push = (role, m) => {
    if (!m || used.has(m.index)) return;
    used.add(m.index);
    structure.push({ role, index: m.index, start: m.start, end: m.end, text: m.text });
  };

  push("HOOK", chosen);
  if (decision.strategy === "COLD_OPEN" || decision.strategy === "REFRAME" || decision.strategy === "HYBRID") {
    // Konteks sebelum momen (yang dilewati) diringkas di depan.
    for (const m of all) {
      if (m.index < chosen.index && !m.filler) push("CONTEXT", m);
      if (structure.filter((s) => s.role === "CONTEXT").length >= 3) break;
    }
  }
  for (const m of all) {
    if (m.index > chosen.index && !m.filler) {
      const role = decision.payoff && m.index === decision.payoff.index ? "PAYOFF" : "DEVELOPMENT";
      push(role, m);
    }
    if (structure.length >= 9) break;
  }
  // Payoff yang terlewat (mis. sebelum chosen dalam cold open) tetap dipakai.
  if (decision.payoff && !used.has(decision.payoff.index)) push("PAYOFF", all[decision.payoff.index]);
  return structure.slice(0, 10);
}

// ---------------------------------------------------------------------------
// EDITORIAL OPENING SCORE — bukan sekadar skor teks hook.
// ---------------------------------------------------------------------------
function editorialScore(decision, langKey) {
  const m = decision.sourceMoment;
  if (!m) return 0;
  const independence = 1 - m.contextDependency;
  const openLoop = decision.openLoop ? 0.06 : 0;
  const payoff = decision.payoff ? 0.05 : 0;
  const fidelity = m.deep >= 0 ? 1 - ((m.penalties && (m.penalties.hedge || 0)) * 0.2) : 1;
  const raw =
    0.35 * (m.momentScore / 100) +
    0.25 * (decision.hookScore / 100) +
    0.15 * independence +
    0.1 * m.delivery +
    0.05 * m.infoDensity +
    0.1 * (openLoop + payoff + fidelity);
  return Math.max(0, Math.min(100, Math.round(raw * 100)));
}

// ---------------------------------------------------------------------------
// MAIN — buildOpeningDecision
// ---------------------------------------------------------------------------
function buildOpeningDecision(segments, lang, options) {
  const opts = options || {};
  const langKey = langTag(lang);
  const segs = (segments || []).map((s, index) => ({
    index,
    text: cleanText(s && s.text),
    start: Number((s && s.start) != null ? s.start : index),
    end: Number((s && s.end) != null ? s.end : index + 1)
  }));
  if (!segs.some((s) => s.text)) {
    return {
      bestOpening: "",
      strategy: "KEEP",
      hookType: "CURIOSITY",
      editorialScore: 0,
      confidence: 0,
      reason: "Tidak ada transkrip.",
      sourceSegment: null,
      openLoop: false,
      openLoopQuestion: "",
      payoff: null,
      clipStructure: [],
      alternatives: [],
      keepOriginal: false,
      moments: []
    };
  }

  const moments = detectMoments(segments, langKey, opts);
  const decision = decideStrategy(moments, langKey, opts);
  const chosen = moments.find((m) => m.index === decision.index) || moments.filter((m) => !m.filler)[0] || moments[0];

  // Teks pembuka: KEEP/COLD_OPEN/REFRAME/HYBRID = ucapan asli; REWRITE = hook ringkas.
  const crafted = HE.craftViralHook(chosen.text, moments.map((m) => m.text), langKey);
  const hookScoreRes = HE.scoreHook(chosen.text, langKey, {});
  const hookType = HE.classifyHookType(chosen.text, langKey);
  const keepOriginal = decision.strategy === "KEEP" || decision.strategy === "COLD_OPEN" || decision.strategy === "REFRAME" || decision.strategy === "HYBRID";
  const bestOpening = decision.strategy === "REWRITE" ? crafted.text : chosen.text;

  const openLoop = chosen.openLoop;
  const openLoopQuestion = openLoop && (chosen.roles.includes("QUESTION") ? chosen.text : "") || "";
  const payoff = chosen.payoff;

  const sourceMoment = chosen;
  const decisionObj = {
    strategy: decision.strategy,
    sourceMoment,
    openLoop,
    payoff,
    hookScore: Math.max(hookScoreRes.deep || 0, hookScoreRes.score || 0)
  };
  const score = editorialScore(decisionObj, langKey);
  const clipStructure = buildClipStructure(moments, decisionObj);

  // Confidence: gap terhadap momen kedua + kualitas absolut.
  const sorted = moments.filter((m) => !m.filler).sort((a, b) => b.momentScore - a.momentScore);
  const second = sorted[1] || null;
  const gap = second ? Math.max(0, chosen.momentScore - second.momentScore) : 12;
  const confidence = Math.max(0, Math.min(100, Math.round(chosen.momentScore * 0.5 + gap * 3 + 10)));

  // Alternatives — variasi strategi pada momen yang sama (source-faithful).
  const variants = HE.buildVariants(chosen.text, moments.map((m) => m.text), langKey);
  const strategyLabel = {
    Direct: "Keep Original",
    Curiosity: "Curiosity",
    Contrarian: "Contrarian",
    Question: "Question",
    Emotional: "Emotional",
    Story: "Story"
  };
  const alternatives = variants
    .map((v) => {
      const sc = HE.scoreHook(v.text, langKey, {});
      return { strategy: strategyLabel[v.strategy] || v.strategy, text: v.text, score: sc.deep || sc.score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  return {
    bestOpening,
    strategy: decision.strategy,
    hookType,
    hookText: crafted.text,
    editorialScore: score,
    confidence,
    reason: decision.reason,
    sourceSegment: { index: chosen.index, start: chosen.start, end: chosen.end, text: chosen.text },
    momentRoles: chosen.roles,
    openLoop,
    openLoopQuestion,
    payoff,
    clipStructure,
    alternatives,
    keepOriginal,
    moments
  };
}

module.exports = {
  langTag,
  cleanText,
  contentRoles,
  isFillerSegment,
  detectMoments,
  assignStoryArc,
  findPayoff,
  momentScore,
  decideStrategy,
  buildClipStructure,
  editorialScore,
  buildOpeningDecision,
  ROLE_SIGNALS
};
