// ============================================================================
// ClipMe Deep Title & Hook Engine — "berpikir" lintas kalimat untuk
// menyintesis judul & hook yang menarik, BUKAN sekadar mengutip kata per kata.
//
// Prinsip:
//   1. Sintesis lintas kalimat: topik, angka, transformasi, kontras, dan
//      pertanyaan boleh berasal dari kalimat BERBEDA lalu digabung jadi satu
//      judul/hook yang utuh dan natural.
//   2. SOURCE FIDELITY: semua slot (topik, angka, kontras, klaim) diambil
//      VERBATIM dari transkrip. Framing ("yang jarang dibahas", "dari X ke Y",
//      "pelajaran") hanya gaya bahasa tentang video, bukan klaim faktual baru.
//   3. Deterministik & CPU-first: tanpa API key pun bekerja. Menyediakan
//      "thinking" (alasan langkah-demi-langkah) agar hasil bisa dipertanggung-
//      jawabkan, bukan kotak hitam.
//   4. Output: judul rekomendasi + deep hook + alternatif + reasoning.
// ============================================================================

const HE = (() => {
  try { return require("./clipme-hook-engine.js"); } catch { return null; }
})();

// Fallback minimal bila hook engine tidak tersedia (harus selalu jalan).
const cleanText = HE ? HE.cleanText : (v) => String(v || "").replace(/\s+/g, " ").trim();
const splitSentences = HE ? HE.splitSentences : (t) => String(t || "").split(/(?<=[.!?।…])\s+|\n+/).map(cleanText).filter((s) => s.length > 1);
const langTag = HE ? HE.langTag : (l) => (l === "English" ? "en" : "id");
const wordsOf = HE ? (HE.wordsOf || HE.helpers.wordsOf) : (s) => String(s || "").toLowerCase().split(/[^a-z0-9\u00c0-\u024f\u1e00-\u1eff]+/i).filter((w) => w.length > 1);
const extractNumbers = HE ? (HE.extractNumbers || HE.helpers.extractNumbers) : (t) => [];
const extractTopic = HE ? (HE.extractTopic || HE.helpers.extractTopic) : (t) => [];
const extractContrastParts = HE ? (HE.extractContrastParts || HE.helpers.extractContrastParts) : (t) => null;
const capFirst = (s) => String(s || "").replace(/^\w/, (c) => c.toUpperCase());
const lowerFirst = (s) => String(s || "").replace(/^\w/, (c) => c.toLowerCase());
const stripLeading = (s, markers) => { let t = String(s || "").trim(); for (const x of markers || []) { const re = new RegExp(`^${x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b[,\\s]*`, "i"); if (re.test(t)) { t = t.replace(re, "").trim(); break; } } return t; };

function capWords(s) {
  return String(s || "").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Ekstraksi angka dengan dukungan satuan Bahasa Inggris (hook engine hanya id).
function extractNumbersDeep(text) {
  const base = extractNumbers(text);
  if (base.length) return base;
  const re = /\b\d{1,3}(?:[.,]\d+)?\s*(?:years?|months?|weeks?|days?|hours?|minutes?|seconds?|percent|%|dollars?|times?|people|points|million|billion|thousand|folks)\b/gi;
  const out = [];
  let m;
  while ((m = re.exec(text))) {
    const full = m[0].trim();
    const num = (m[0].match(/\d[\d.,]*/) || [" "])[0];
    const unit = (m[0].match(/[a-z%]+$/i) || [" "])[0];
    if (!out.some((o) => o.full === full)) out.push({ full, num, unit });
  }
  return out;
}

// Kontras: bersihkan kata hubung yang bocor dari hook engine, lalu fallback
// ke pemisahan lokal yang mengabaikan kata hubung.
const CONTRAST_WORDS = /^(bukan|tapi|namun|padahal|sedangkan|sementara|justru|versus|vs|not|but|whereas|while|instead of|unlike)$/i;
const CONTRAST_RE = /\b(bukan|tapi|namun|padahal|sedangkan|sementara|justru|versus|vs|not|but|whereas|while|instead of|unlike)\b/i;
function extractContrast(text) {
  const raw = extractContrastParts(text);
  if (raw) {
    const a = cleanText(String(raw.a || "").replace(CONTRAST_WORDS, "").trim());
    const b = cleanText(String(raw.b || "").replace(CONTRAST_WORDS, "").trim());
    if (a.length > 3 && b.length > 3 && a !== b) return { a, b };
  }
  const parts = String(text).split(CONTRAST_RE)
    .map((p) => cleanText(p))
    .filter((p) => p.length > 3 && !CONTRAST_WORDS.test(p));
  if (parts.length >= 2) return { a: parts[0], b: parts[parts.length - 1] };
  return null;
}

// Framing bahasa untuk judul/hook (teks judul ikut bahasa video; alasan tetap id).
const FRAMES = {
  id: {
    dalam: "dalam", tentang: "tentang", jarang: "yang jarang dibahas",
    tertukar: "pelajaran yang sering tertukar", jawabannya: "jawabannya tentang",
    pelajaran: "pelajaran yang mengubah cara pandang",
    cerita: "dan perjalanan di baliknya nggak seperti yang dikira",
    ternyata: "Ternyata", jarang_sadari: "hal yang jarang orang sadari",
    dari: "Dari", ke: "ke", mengatasi: "mengatasi"
  },
  en: {
    dalam: "in", tentang: "about", jarang: "rarely talked about",
    tertukar: "the lesson people get backwards", jawabannya: "the answer lies in",
    pelajaran: "a lesson that changes your perspective",
    cerita: "and the story behind it isn't what you'd expect",
    ternyata: "Turns out", jarang_sadari: "something few people realize",
    dari: "From", ke: "to", mengatasi: "overcoming"
  }
};

// ---------------------------------------------------------------------------
// Lexicons (id/en) — signal yang membantu sintesis "ide inti" video.
// ---------------------------------------------------------------------------
const TRANSFORM_VERBS = {
  id: ["berhenti", "berubah", "mulai", "berhasil", "gagal", "bangkit", "sadar", "belajar", "berubah", "jadi", "menjadi", "sukses", "mengubah", "mengatasi", "melawan", "membangun", "keluar", "bangun", "berpindah", "bertransisi", "bertahan", "tumbuh", "berkembang", "memulai", "memutuskan"],
  en: ["quit", "changed", "start", "started", "became", "become", "built", "beat", "overcame", "survived", "learned", "learn", "realized", "transformed", "turned", "went from", "went", "stopped", "grew", "managed", "figured", "made the change", "grew from", "moved from"]
};
const OUTCOME_VERBS = {
  id: ["jadi", "intinya", "kesimpulannya", "artinya", "kuncinya", "poinnya", "pesannya", "sehingga", "maka", "akhirnya", "ternyata", "pelajaran", "belajar", "belajarnya", "hasilnya", "dampaknya"],
  en: ["so", "the point", "the lesson", "the takeaway", "in the end", "which means", "ultimately", "turns out", "the result", "the outcome", "what i learned", "what we learned", "the bottom line"]
};
const PROBLEM_VERBS = {
  id: ["masalah", "gagal", "sulit", "susah", "rugi", "bangkrut", "hancur", "salah", "keliru", "stres", "capek", "lelah", "krisis", "nggak jalan", "tidak jalan", "berhenti", "tidak bisa", "nggak bisa"],
  en: ["problem", "failed", "struggled", "difficult", "hard", "broke", "bankrupt", "wrong", "mistake", "stress", "tired", "crisis", "stopped", "couldn't", "can't"]
};
const NARRATIVE_MARKERS = {
  id: ["waktu itu", "saat itu", "dulu", "kemarin", "tahun lalu", "beberapa waktu", "ceritanya", "kisah", "pertama kali", "mulai dari", "awalnya"],
  en: ["back then", "at the time", "years ago", "last year", "a while ago", "the story", "one day", "first time", "at first", "it started"]
};
const THING_NOUNS = { id: ["hal", "cara", "langkah", "kebiasaan", "alasan", "fakta", "keputusan", "kesalahan", "pengalaman"], en: ["things", "ways", "steps", "habits", "reasons", "facts", "decisions", "mistakes", "lessons"] };
const FILLER_OPENERS = {
  id: ["jadi", "oke", "nah", "ya", "baiklah", "gini", "begini", "kayaknya", "guys", "teman-teman", "biasanya", "intinya", "sebenarnya", "kalau kita", "jadi gini"],
  en: ["so", "okay", "alright", "well", "right", "you know", "basically", "guys", "now", "actually", "look"]
};

function isLang(lang) { return lang === "en" ? "en" : "id"; }

function hasSignal(sentence, lang, bucket, list) {
  const low = String(sentence || "").toLowerCase();
  const words = list || (HE ? HE.HOOK_WORDS[isLang(lang)] && HE.HOOK_WORDS[isLang(lang)][bucket] : null) || [];
  return words.some((w) => low.includes(w));
}

// Topik lokal yang MEMPERTAHANKAN angka ("3 tahun" tetap utuh), karena
// extractTopic hook engine membuang token berdigit tunggal.
const TOPIC_EXTRA_STOP = ["kebanyakan", "kenapa", "mengapa", "apakah", "bagaimana", "gimana", "siapa", "kapan", "berapa", "harus", "bisa", "bakal", "akan", "para", "itu", "ini", "juga", "sudah", "telah", "sangat", "lebih", "nggak", "gak", "enggak", "tidak", "tak", "di", "ke", "dari", "yang", "dan", "atau", "dengan", "pada", "untuk", "dalam", "saat", "ketika", "tapi", "namun", "sedangkan", "sementara", "baru", "tadi", "kemarin", "semalam", "overnight", "today", "yesterday", "now", "just", "once", "lost", "make", "made", "know", "think", "found", "started", "became", "become", "keep", "kept", "does", "did", "have", "has", "had", "get", "got", "going", "want", "need", "work", "works", "bought", "sold", "went", "gone", "use", "used", "say", "said", "told", "my", "our", "their", "your", "his", "her", "its", "all", "about", "when", "where", "who", "what", "why", "how"];
function extractTopicDeep(text, lang) {
  const tag = isLang(lang);
  const stop = (HE && HE.HOOK_WORDS[tag] && HE.HOOK_WORDS[tag].stopwords) || [];
  const tokens = String(text).toLowerCase().split(/[^a-z0-9\u00c0-\u024f\u1e00-\u1eff]+/i).filter((w) => w.length > 0);
  const isStop = (w) => stop.includes(w) || TOPIC_EXTRA_STOP.includes(w);
  const runs = [];
  let cur = [];
  for (const w of tokens) {
    if (!isStop(w)) { cur.push(w); continue; }
    if (cur.length) { runs.push(cur); cur = []; }
  }
  if (cur.length) runs.push(cur);
  if (!runs.length) return "";
  runs.sort((a, b) => b.length - a.length || b.join(" ").length - a.join(" ").length);
  return runs[0].join(" ");
}

// Buang tanda baca penutup dari klausa ("segalanya." -> "segalanya").
function stripPunct(s) {
  return String(s || "").replace(/[.!?।…\s]+$/, "").trim();
}

function looksLikeQuestion(sentence, lang) {
  const t = cleanText(sentence);
  if (/[?？]$/.test(t)) return true;
  const words = (HE && HE.HOOK_WORDS[isLang(lang)] && HE.HOOK_WORDS[isLang(lang)].question) || [];
  return words.some((w) => new RegExp(`^${w}\\b`, "i").test(t) || t.toLowerCase().startsWith(w));
}

function looksLikePayoff(sentence, lang) {
  return hasSignal(sentence, lang, "payoff", (HE && HE.HOOK_WORDS[isLang(lang)] && HE.HOOK_WORDS[isLang(lang)].payoff) || OUTCOME_VERBS[isLang(lang)]);
}

// ---------------------------------------------------------------------------
// Langkah 1 — skor & klasifikasi per kalimat.
// ---------------------------------------------------------------------------
function rankSentences(sentences, lang) {
  return sentences.map((sentence, index) => {
    const text = cleanText(sentence);
    const score = (HE && HE.scoreHook && HE.scoreHook(text, lang, { index, sentences })) || { score: 0, deep: 0, type: "OBSERVATION", excluded: false, reason: "" };
    const numbers = extractNumbersDeep(text);
    return {
      index, text,
      score: Number(score.score) || 0,
      deep: Number(score.deep) || Number(score.score) || 0,
      type: String(score.type || "OBSERVATION"),
      excluded: !!(score.excluded),
      reason: String(score.reason || ""),
      numbers,
      number: numbers.length ? numbers[0] : null,
      topic: extractTopicDeep(text, lang),
      contrast: extractContrast(text),
      question: looksLikeQuestion(text, lang),
      payoff: looksLikePayoff(text, lang),
      transform: hasSignal(text, lang, "transform", TRANSFORM_VERBS[isLang(lang)]),
      problem: hasSignal(text, lang, "conflict", PROBLEM_VERBS[isLang(lang)]),
      narrative: hasSignal(text, lang, "narrative", NARRATIVE_MARKERS[isLang(lang)]),
      clause: stripPunct(lowerFirst(stripLeading(text, FILLER_OPENERS[isLang(lang)])))
    };
  });
}

// ---------------------------------------------------------------------------
// Langkah 2 — peta ide: gabungkan signal lintas kalimat.
// ---------------------------------------------------------------------------
function buildIdeaMap(ranked, lang) {
  const top = ranked.slice().sort((a, b) => b.deep - a.deep);
  const nonExcluded = top.filter((r) => !r.excluded && r.text.length > 4);
  const pool = nonExcluded.length ? nonExcluded : top.filter((r) => r.text.length > 4);
  const best = pool[0] || top[0] || null;

  // Topik: frekuensi tertimbang topic dari kalimat ber-skor tinggi.
  const topicCounts = new Map();
  for (const r of pool.slice(0, 6)) {
    if (!r.topic) continue;
    const key = r.topic;
    topicCounts.set(key, (topicCounts.get(key) || 0) + (10 + r.deep));
  }
  let topic = "";
  let topicSource = null;
  for (const [key, weight] of topicCounts) {
    if (!topic || weight > topicCounts.get(topic)) { topic = key; }
  }
  if (topic) {
    const src = pool.find((r) => r.topic === topic);
    topicSource = src ? { index: src.index, text: src.text } : null;
  }
  if (!topic && best) { topic = best.topic; topicSource = { index: best.index, text: best.text }; }

  // Angka: preferensi dari kalimat ber-skor tertinggi yang punya angka.
  const withNum = pool.find((r) => r.number) || top.find((r) => r.number) || null;
  const numbers = [];
  const seenNum = new Set();
  for (const r of ranked) {
    for (const n of r.numbers || []) {
      if (seenNum.has(n.full)) continue;
      seenNum.add(n.full);
      numbers.push({ full: n.full, num: n.num, unit: n.unit, sourceIndex: r.index });
    }
  }

  // Hasil/outcome: kalimat payoff terbaik.
  const outcome = pool.find((r) => r.payoff) || null;
  // Transformasi: kalimat transform terbaik dengan topik/angka.
  const transform = pool.find((r) => r.transform && (r.number || r.topic || r.narrative)) || pool.find((r) => r.transform) || null;
  // Pertanyaan terbuka terbaik.
  const question = pool.find((r) => r.question) || null;
  // Kontras pertama.
  const contrast = pool.find((r) => r.contrast) || null;
  // Masalah→solusi (untuk frame "dari X ke Y").
  const problem = pool.find((r) => r.problem) || null;

  return {
    best, topic, topicSource, numbers, outcome, transform, question, contrast, problem,
    lang, pool
  };
}

// ---------------------------------------------------------------------------
// Langkah 3 — sintesis judul.
// ---------------------------------------------------------------------------
function titleCandidates(map) {
  const { topic, numbers, outcome, transform, question, contrast, problem } = map;
  const num = numbers.length ? numbers[0].full : "";
  const lang = map.lang;
  const out = [];
  const push = (text, reason, score) => {
    const clean = cleanText(text);
    if (!clean || clean.length < 6) return;
    out.push({ text: clean, reason, score });
  };
  const topicClause = topic ? lowerFirst(topic) : "";
  const outcomeClause = outcome ? lowerFirst(outcome.clause) : "";
  const transformClause = transform ? lowerFirst(transform.clause) : "";

  if (topic) {
    const topicHasNum = num && topic.toLowerCase().includes(num.toLowerCase());
    if (num && outcomeClause && !topicHasNum) {
      push(`${capFirst(topic)}: ${outcomeClause} ${FRAMES[lang].dalam} ${num}`, `Gabung inti topik "${topic}", hasil "${outcomeClause}", dan angka ${num}`, 92);
    } else if (num && !topicHasNum) {
      push(`${num} ${THING_NOUNS[lang][0]} ${FRAMES[lang].tentang} ${topic} ${FRAMES[lang].jarang}`, `Angka ${num} dari transkrip + topik "${topic}"`, 88);
    } else if (outcomeClause) {
      push(`${capFirst(topic)}: ${outcomeClause}`, `Topik "${topic}" + kalimat kesimpulan`, 84);
    } else if (transformClause) {
      push(`${capFirst(topic)}: ${transformClause}`, `Topik "${topic}" + pengalaman transformasi`, 82);
    }
  }
  if (num && transformClause) {
    push(`${capFirst(transformClause)} ${FRAMES[lang].dalam} ${num}`, `Pengalaman transformasi "${transformClause}" + angka ${num}`, 90);
  }
  if (num && outcomeClause) {
    push(`${capFirst(outcomeClause)} ${FRAMES[lang].dalam} ${num}`, `Kalimat kesimpulan "${outcomeClause}" + angka ${num}`, 86);
  }
  if (problem && outcomeClause) {
    push(`${FRAMES[lang].dari} ${lowerFirst(problem.clause)} ${FRAMES[lang].ke} ${outcomeClause}`, `Frame perubahan: masalah → hasil`, 80);
  }
  if (problem && topic) {
    push(`${capFirst(topic)}: ${FRAMES[lang].mengatasi} ${lowerFirst(problem.clause)}`, `Topik "${topic}" + masalah yang diangkat`, 78);
  }
  if (contrast && contrast.contrast) {
    push(`${capFirst(contrast.contrast.a)} vs ${capFirst(contrast.contrast.b)} — ${FRAMES[lang].tertukar}`, `Kontras "${contrast.contrast.a}" vs "${contrast.contrast.b}"`, 79);
  }
  if (question && topic) {
    push(`${cleanText(question.clause)} — ${FRAMES[lang].jawabannya} ${topic}`, `Pertanyaan pembuka + topik "${topic}"`, 75);
  }
  if (topic) {
    push(`${capFirst(topic)}: ${FRAMES[lang].pelajaran}`, `Topik "${topic}" + framing pelajaran`, 70);
  }
  return out;
}

function pickTitle(candidates, sentences) {
  if (!candidates.length) return null;
  const verbatim = sentences.map((s) => cleanText(s).toLowerCase());
  let best = null;
  for (const c of candidates) {
    let score = c.score;
    const low = c.text.toLowerCase();
    // Penalti bila judul terlalu mirip kalimat verbatim (bukan sintesis).
    const sim = verbatim.some((v) => v && low.length > 8 && (low.includes(v) || v.includes(low)));
    if (sim) score -= 18;
    // Penalti bila fragmen menggantung.
    if (/[,.…]\s*$/.test(c.text)) score -= 20;
    if (low.length < 6 || low.length > 120) score -= 25;
    if (!best || score > best.score) best = { ...c, score };
  }
  return best;
}

function buildTitleReason(best, map) {
  if (!best) return "Tidak cukup konten untuk menyintesis judul.";
  const parts = [`Judul disintesis dari ${best.reason}.`];
  if (map.outcome) parts.push(`Kalimat kesimpulan diambil dari kalimat #${map.outcome.index + 1}.`);
  if (map.topicSource) parts.push(`Topik "${map.topic}" berasal dari kalimat #${map.topicSource.index + 1}.`);
  if (map.numbers.length) parts.push(`Angka "${map.numbers[0].full}" berasal dari kalimat #${map.numbers[0].sourceIndex + 1}.`);
  if (map.question) parts.push(`Ada pertanyaan terbuka di kalimat #${map.question.index + 1} yang memberi arah narasi.`);
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Langkah 4 — deep hook: baris pembuka yang disintesis, bukan kutipan kaku.
// ---------------------------------------------------------------------------
function deepHookCandidates(map) {
  const lang = map.lang;
  const out = [];
  const push = (text, reason) => {
    const clean = cleanText(text);
    if (clean && clean.length >= 6) out.push({ text: clean, reason });
  };
  const num = map.numbers.length ? map.numbers[0].full : "";
  const outcomeClause = map.outcome ? lowerFirst(map.outcome.clause) : "";
  const topicClause = map.topic ? lowerFirst(map.topic) : "";
  const transformClause = map.transform ? lowerFirst(map.transform.clause) : "";

  if (map.question) {
    push(cleanText(map.question.clause) || map.question.text, "Buka dengan pertanyaan dari pembicara — hook paling jujur & memicu rasa penasaran.");
  }
  if (num && outcomeClause) {
    push(`${capFirst(num)} — ${FRAMES[lang].cerita}`, `Gabung angka "${num}" dengan inti hasil, di-frame sebagai cerita.`);
  }
  if (num && topicClause) {
    push(`${capFirst(num)} ${FRAMES[lang].tentang} ${topicClause} ${FRAMES[lang].jarang}`, `Angka "${num}" + topik "${map.topic}".`);
  }
  if (transformClause) {
    push(`${FRAMES[lang].ternyata} ${transformClause}`, `Parafrase pengalaman transformasi "${transformClause}".`);
  }
  if (outcomeClause) {
    push(capFirst(outcomeClause), "Kalimat kesimpulan paling kuat, dipakai sebagai pembuka.");
  }
  if (topicClause) {
    push(`${capFirst(map.topic)}: ${FRAMES[lang].jarang_sadari}`, `Framing topik "${map.topic}".`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Langkah 5 — alur "thinking" (reasoning langkah-demi-langkah).
// ---------------------------------------------------------------------------
function buildThinking(map, title, deepHook) {
  const lang = map.lang;
  const steps = [];
  const best = map.best;
  if (best) {
    steps.push({ step: "Skor kalimat", detail: `Kalimat terkuat: kalimat #${best.index + 1} (deep ${best.deep}, tipe ${best.type}).` });
    if (best.excluded) steps.push({ step: "Eksklusi", detail: `Kalimat #${best.index + 1} dieksklusi (${best.reason}).` });
  }
  steps.push({ step: "Inti topik", detail: map.topic ? `Topik dominan video: "${map.topic}"` : "Tidak ada topik konten yang jelas." });
  if (map.numbers.length) {
    steps.push({ step: "Angka kunci", detail: `${map.numbers.map((n) => `"${n.full}" (kal #${n.sourceIndex + 1})`).join(", ")}.` });
  }
  if (map.outcome) steps.push({ step: "Kesimpulan", detail: `Kalimat #${map.outcome.index + 1} memuat hasil/kesimpulan: "${map.outcome.text}".` });
  if (map.transform) steps.push({ step: "Transformasi", detail: `Kalimat #${map.transform.index + 1} menceritakan perubahan: "${map.transform.text}".` });
  if (map.contrast) steps.push({ step: "Kontras", detail: `Ditemukan kontras: "${map.contrast.contrast.a}" vs "${map.contrast.contrast.b}".` });
  if (map.question) steps.push({ step: "Pertanyaan terbuka", detail: `Kalimat #${map.question.index + 1} membuka pertanyaan: "${map.question.text}".` });
  if (title) steps.push({ step: "Sintesis judul", detail: title.reason });
  if (deepHook) steps.push({ step: "Sintesis hook", detail: deepHook.reason });
  steps.push({ step: "Grounded", detail: "Semua angka/fakta/klaim diverbatim dari transkrip; framing hanya gaya bahasa." });
  return steps;
}

// ---------------------------------------------------------------------------
// API utama.
// ---------------------------------------------------------------------------
function analyzeDeepTitle(sentences, segments, langInput, options) {
  const lang = isLang(langInput);
  const opts = options || {};
  const all = Array.isArray(segments) && segments.length
    ? segments.map((s) => cleanText(s.text)).filter(Boolean)
    : splitSentences(Array.isArray(sentences) ? sentences.join(" ") : String(sentences || ""));

  if (!all.length) {
    return {
      title: "", titleScore: 0, titleReason: "Transkrip kosong.", titleAlternatives: [],
      topic: "", keyIdea: "", outcome: null, numbers: [], contrast: null, openQuestion: "",
      deepHook: "", deepHookReason: "", deepHookAlternatives: [],
      thinking: [{ step: "Input", detail: "Tidak ada kalimat untuk dianalisis." }],
      evidence: null, grounded: true
    };
  }

  const ranked = rankSentences(all, lang);
  const map = buildIdeaMap(ranked, lang);

  let candidates = titleCandidates(map);
  let best = pickTitle(candidates, all);
  // Fallback bila tidak ada kandidat layak.
  if (!best) {
    candidates = [{ text: capFirst(map.best ? map.best.clause : (all[0] || "Video")), reason: "Parafrase kalimat terkuat.", score: 60 }];
    best = candidates[0];
  }

  let hookCandidates = deepHookCandidates(map);
  const deepHook = hookCandidates.length ? hookCandidates[0] : { text: capFirst(all[0]), reason: "Kalimat pembuka dipakai apa adanya." };

  const thinking = buildThinking(map, best, deepHook);

  const evidence = {
    topicSource: map.topicSource ? { index: map.topicSource.index, text: cleanText(map.topicSource.text).slice(0, 140) } : null,
    outcomeSource: map.outcome ? { index: map.outcome.index, text: cleanText(map.outcome.text).slice(0, 140) } : null,
    numberSources: map.numbers.slice(0, 4).map((n) => ({ full: n.full, index: n.sourceIndex })),
    questionSource: map.question ? { index: map.question.index, text: cleanText(map.question.text).slice(0, 140) } : null
  };

  return {
    title: cleanText(best.text).slice(0, 140),
    titleScore: Math.max(0, Math.min(100, Math.round(best.score || 0))),
    titleReason: buildTitleReason(best, map),
    titleAlternatives: candidates.slice(1, 4).map((c) => ({ text: cleanText(c.text).slice(0, 140), reason: c.reason, score: Math.max(0, Math.min(100, Math.round(c.score || 0))) })),
    topic: map.topic,
    keyIdea: map.outcome ? map.outcome.text : (map.best ? map.best.text : all[0]),
    outcome: map.outcome ? { index: map.outcome.index, text: map.outcome.text } : null,
    numbers: map.numbers.map((n) => ({ full: n.full, num: n.num, unit: n.unit, sourceIndex: n.sourceIndex })),
    contrast: map.contrast ? map.contrast.contrast : null,
    openQuestion: map.question ? map.question.text : "",
    deepHook: cleanText(deepHook.text).slice(0, 140),
    deepHookReason: deepHook.reason,
    deepHookAlternatives: hookCandidates.slice(1, 3).map((h) => ({ text: cleanText(h.text).slice(0, 140), reason: h.reason })),
    thinking,
    evidence,
    grounded: true,
    provider: "clipme-deep"
  };
}

module.exports = {
  analyzeDeepTitle,
  titleCandidates,
  deepHookCandidates,
  buildIdeaMap,
  rankSentences,
  cleanText,
  splitSentences,
  langTag: (l) => isLang(l),
  TRANSFORM_VERBS,
  OUTCOME_VERBS,
  PROBLEM_VERBS
};