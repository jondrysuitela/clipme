// ============================================================================
// ClipMe Hook Engine — SINGLE SOURCE OF TRUTH untuk inteligensi hook.
//
// Dipakai oleh:
//   - server.js (clipmeAssemble + clipHook fallback)
//   - clipme-caption-engine.js (deriveHook — adapter, bukan engine baru)
//
// Prinsip (sesuai spec upgrade):
//   1. SOURCE FIDELITY > NATURALNESS > CLARITY > RETENTION VALUE > REWRITE.
//   2. Evidence-based scoring: kata kunci dihitung SEKALI per kategori
//      (uniqueness / diminishing returns), bukan diakumulasi tiap kemunculan.
//   3. Hook gagal jika tidak didukung evidence nyata (specificity, gap, payoff).
//   4. Klasifikasi berbasis struktur kalimat (REVELATION, PROBLEM, ...),
//      bukan default CURIOSITY; intent dipisah dari type.
//   5. Payoff divalidasi dari isi clip, bukan panjang teks.
//   6. recommendedHook = minimal-edit (LEVEL 0-4), TIDAK pernah mengarang kata.
//   7. Tanpa toggle baru, tanpa UI baru, backward compatible.
// ============================================================================

// F9: TAKSONOMI TUNGGAL — 16 hook types. Sama persis dengan daftar di
// clipme-prompt.js (# 7. HOOK TYPES) dan schema LLM (server.js). Semua
// emitter (heuristic classifyHookType, LLM, legacy fallback) harus memakai
// set ini. Tidak ada lagi UNKNOWN / RESULT_FIRST / STORY_TEASE / OBSERVATION
// / DIRECT_VALUE / WARNING / CONFLICT / FACT sebagai tipe.
const HOOK_TYPES = [
  "CURIOSITY", "SURPRISE", "SHOCK", "STORY", "CONFESSION", "TRANSFORMATION",
  "CONTROVERSY", "EMOTIONAL", "EDUCATIONAL", "DIRECT VALUE", "PROBLEM",
  "QUESTION", "MYSTERY", "HUMOR", "CONTRAST", "REVELATION"
];

function isHookType(t) {
  return HOOK_TYPES.includes(String(t || "").toUpperCase());
}

const HOOK_WORDS = {
  id: {
    question: ["kenapa", "mengapa", "bagaimana", "apa", "berapa", "kapan", "siapa", "apakah", "gimana", "kok", "nggak sih", "bisa nggak"],
    curiosityTease: ["rahasia", "ternyata", "nggak nyangka", "tidak menyangka", "siapa sangka", "baru tahu", "tiba-tiba", "mengejutkan", "absurd", "aneh", "di balik", "faktanya", "kebanyakan orang", "jarang disadari", "jarang dibahas", "nggak banyak yang", "belum banyak yang", "yang jarang"],
    surprise: ["ternyata", "kaget", "nggak nyangka", "tidak menyangka", "siapa sangka", "mengejutkan", "tiba-tiba", "padahal justru", "absurd", "aneh"],
    contrast: ["tapi", "namun", "padahal", "sementara", "justru", "sedangkan", "nggak seperti", "tidak seperti", "padahal sebaliknya", "justru kebalikannya"],
    conflict: ["masalah", "gagal", "kolaps", "bangkrut", "rugi", "bahaya", "kehilangan", "salah", "keliru", "error", "hancur", "sulit", "susah", "nggak jalan", "tidak bekerja", "malapetaka", "bencana", "bermasalah", "krisis"],
    value: ["cara", "tips", "langkah", "trik", "rumus", "strategi", "framework", "kunci", "solusi", "panduan", "begini", "inilah"],
    imperative: ["jangan", "harus", "coba", "pastikan", "sebaiknya", "hindari", "berhenti", "mulai"],
    payoff: ["jadi", "intinya", "kesimpulannya", "artinya", "akhirnya", "sehingga", "maka", "poinnya", "pokoknya", "pesannya", "kuncinya", "ujung-ujungnya", "ternyata pada akhirnya", "alasannya", "karena itu"],
    surpriseResolve: ["ternyata", "akhirnya", "jadi", "intinya", "kesimpulannya"],
    confession: ["jujur", "sejujurnya", "aku mengaku", "saya akui", "aku akui", "saya menyesal", "aku menyesal", "saya sadar", "aku sadar", "saya salah", "aku salah", "ternyata saya"],
    narrative: ["waktu itu", "saat itu", "dulu", "kemarin", "saya ingat", "aku ingat", "ceritanya", "kisah", "pertama kali", "tahun lalu", "beberapa waktu lalu"],
    warning: ["jangan", "hati-hati", "waspada", "awas", "stop", "berhenti", "hindari", "bahaya"],
    pronoun: ["saya", "aku", "gue", "gw", "kami", "kita", "mereka", "dia", "ini", "itu", "hal ini"],
    deictic: ["tadi", "sebelumnya", "kemarin", "barusan", "di atas", "yang tadi", "tadi itu", "waktu itu", "tadi saya", "sebelumnya saya"],
    fillerOpeners: ["jadi", "oke", "nah", "sebentar", "ya", "baiklah", "gini", "begini", "um", "eh", "hmm", "kayaknya", "guys", "teman-teman", "hai", "halo", "so", "okay", "alright", "well", "right", "you know", "biasanya", "intinya"],
    greeting: ["hai", "halo", "hello", "hi", "selamat datang", "welcome", "guys", "teman-teman", "sahabat", "assalamualaikum", "hey"],
    selfIntro: ["nama saya", "saya akan", "aku akan", "perkenalkan", "saya mau cerita", "kali ini saya", "di video ini", "di video kali ini", "kali ini kita", "di kesempatan ini", "gua bakal", "saya bakal", "aku bakal", "di video kali", "di vidio"],
    cta: ["subscribe", "langganan", "like", "share", "follow", "komentar", "jangan lupa", "tonton sampai habis", "tonton video", "cek link", "link di deskripsi", "donasi", "dukung", "sponsor", "iklan", "kerja sama", "colok suka", "like dulu"],
    hedge: ["mungkin", "kayaknya", "semacam", "agak", "entah", "katanya", "konon", "kayak"],
    numbers: ["juta", "miliar", "ribu", "persen", "tahun", "bulan", "hari", "jam", "rupiah", "dolar", "juta rupiah", "miliar rupiah"],
    stopwords: ["yang", "dan", "di", "ke", "dari", "dengan", "untuk", "pada", "adalah", "itu", "ini", "juga", "sudah", "telah", "akan", "bisa", "agar", "supaya", "oleh", "karena", "sehingga", "para", "sangat", "lebih", "saat", "kala", "atau", "tapi", "namun", "justru", "nggak", "tidak", "aku", "saya", "kita", "kami", "kamu", "mereka", "dia", "beliau", "harus", "boleh", "waktu", "hal", "tersebut", "kalau", "jika", "maka", "saat ini"]
  },
  en: {
    question: ["why", "how", "what", "when", "who", "which", "can you", "do you", "did you", "is it"],
    curiosityTease: ["secret", "turns out", "never knew", "you won't", "surprisingly", "did you know", "nobody", "rarely", "not many people", "hidden", "behind", "the truth", "the real reason", "actually"],
    surprise: ["turns out", "surprisingly", "shocking", "unexpectedly", "never", "who knew", "wait"],
    contrast: ["but", "however", "whereas", "while", "yet", "although", "unlike", "instead of"],
    conflict: ["problem", "failed", "crashed", "bankrupt", "loss", "danger", "mistake", "wrong", "error", "broken", "hard", "difficult", "disaster", "crisis", "destroyed"],
    value: ["how", "tips", "steps", "trick", "method", "formula", "strategy", "framework", "key", "solution", "guide", "here's how"],
    imperative: ["never", "always", "don't", "stop", "avoid", "start", "make sure", "you must", "you need"],
    payoff: ["so", "in the end", "the point is", "which means", "to sum up", "basically", "ultimately", "that's why", "therefore", "the bottom line", "the reason", "because of that"],
    surpriseResolve: ["turns out", "finally", "in the end", "so", "the point is", "the reason"],
    confession: ["honestly", "to be honest", "i admit", "i was wrong", "i regret", "i realized", "i made a mistake", "confession"],
    narrative: ["back then", "at the time", "years ago", "i remember", "one day", "the story", "first time", "a while ago"],
    warning: ["never", "don't", "be careful", "watch out", "stop", "avoid", "danger"],
    pronoun: ["i", "we", "they", "he", "she", "it", "this", "that", "these", "those", "my", "our"],
    deictic: ["earlier", "before", "above", "as i said", "that thing", "this one", "back then"],
    fillerOpeners: ["so", "okay", "alright", "well", "right", "you know", "um", "uh", "basically", "hey", "guys", "now", "actually"],
    greeting: ["hi", "hello", "hey", "welcome", "guys", "everyone", "dear friends"],
    selfIntro: ["my name", "i'm going to", "i will", "let me introduce", "in this video", "today i'm going", "i want to tell", "this video"],
    cta: ["subscribe", "like", "share", "follow", "comment", "don't forget", "watch till the end", "check the link", "link in description", "sponsor", "support", "partner"],
    hedge: ["maybe", "perhaps", "kind of", "sort of", "like", "i guess", "supposedly"],
    numbers: ["million", "billion", "thousand", "percent", "years", "months", "days", "hours", "dollar", "usd"],
    stopwords: ["the", "and", "a", "an", "to", "of", "with", "for", "on", "in", "at", "is", "are", "was", "were", "be", "this", "that", "it", "they", "he", "she", "we", "i", "you", "my", "your", "but", "so", "or", "because", "very", "more", "have", "has", "can", "could", "will", "would", "should", "about", "than", "as", "just", "actually"]
  }
};

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\[[\s\S]*?\]/g, "")
    .trim();
}

function splitSentences(text) {
  return String(text || "")
    .split(/(?<=[.!?।…])\s+|\n+/)
    .map((s) => cleanText(s))
    .filter((s) => s.length > 1);
}

function langTag(language) {
  if (language === "English") return "en";
  if (language === "Mixed") return "mix";
  return "id";
}

function wordsOf(sentence) {
  return String(sentence || "")
    .toLowerCase()
    .split(/[^a-z0-9\u00c0-\u024f\u1e00-\u1eff]+/i)
    .filter((w) => w.length > 1);
}

function hasAny(sentence, tag, bucket) {
  const list = HOOK_WORDS[tag] && HOOK_WORDS[tag][bucket];
  if (!list) return 0;
  const low = String(sentence || "").toLowerCase();
  let count = 0;
  for (const w of list) {
    if (low.includes(w)) count += 1;
  }
  return count;
}

// Opener category — kalimat yang TIDAK layak jadi hook (langsung dieksklusi).
function openerCategory(sentence, lang) {
  const low = String(sentence || "").toLowerCase().trim();
  for (const tag of [lang, lang === "mix" ? "id" : "", lang === "mix" ? "en" : ""].filter(Boolean)) {
    if (HOOK_WORDS[tag] && HOOK_WORDS[tag].greeting && HOOK_WORDS[tag].greeting.some((g) => new RegExp(`^${escapeRe(g)}\\b`).test(low))) return "greeting";
    // Self-intro hanya dieksklusi bila di awal kalimat (opener), bukan di tengah:
    // "Nama saya Budi, kali ini saya akan..." -> ya; "Saya buktikan di video ini"
    // (hook sah) -> tidak boleh ter-exclude hanya karena mengandung "di video ini".
    if (HOOK_WORDS[tag] && HOOK_WORDS[tag].selfIntro && HOOK_WORDS[tag].selfIntro.some((s) => new RegExp(`^${escapeRe(s)}\\b`).test(low))) return "selfIntro";
    // CTA: frasa multi-kata ("jangan lupa", "link di deskripsi") = sinyal kuat,
    // dieksklusi di mana pun. Kata tunggal ("subscribe", "like") baru dieksklusi
    // bila merupakan AJAKAN LANGSUNG — memulai kalimat, pendek, DAN ada partikel
    // direktif ("dulu", "ya", "yuk", "sekarang"). Jadi "Komentar pedas justru
    // bikin viral" (hook sah) tidak terbuang, tapi "Subscribe dulu ya" (CTA) ya.
    if (HOOK_WORDS[tag] && HOOK_WORDS[tag].cta) {
      const phrases = HOOK_WORDS[tag].cta.filter((c) => /\s/.test(c));
      const singles = HOOK_WORDS[tag].cta.filter((c) => !/\s/.test(c));
      const phraseHit = phrases.some((c) => low.includes(c));
      const singleHit = singles.some((c) => new RegExp(`^${escapeRe(c)}\\b`, "i").test(low)) &&
        low.split(/\s+/).length <= 10 &&
        /\b(dulu|ya|yuk|mari|dong|sekarang|aja|aje|guys|teman-teman|kalian)\b/i.test(low);
      if (phraseHit || singleHit) return "cta";
    }
  }
  return "none";
}

function escapeRe(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function startsWithFiller(sentence, lang) {
  const low = String(sentence || "").toLowerCase().trim();
  for (const tag of [lang, lang === "mix" ? "id" : "", lang === "mix" ? "en" : ""].filter(Boolean)) {
    const fillers = HOOK_WORDS[tag] && HOOK_WORDS[tag].fillerOpeners || [];
    if (fillers.some((f) => new RegExp(`^${escapeRe(f)}\\b`).test(low))) return true;
  }
  return false;
}

function detectParallelStructure(sentence) {
  const t = cleanText(sentence || "");
  // "bukan X tapi Y" / "not X but Y" / "lebih X daripada Y" / "more X than Y"
  if (/\bbukan\b.+\btapi\b|\bnot\b.+\bbut\b|\blebih\b.+\bdaripada\b|\bmore\b.+\bthan\b|\bvs\b|\bversus\b/i.test(t)) return true;
  // Dua klausa paralel yang berbagi kata kerja/subjek inti:
  // "Orang kaya membeli aset, orang miskin membeli gaya hidup".
  const parts = t.split(/\s*,\s+/).map((p) => cleanText(p)).filter((p) => p.length > 3);
  if (parts.length >= 2) {
    const first = wordsOf(parts[0]);
    const rest = parts.slice(1).map((p) => wordsOf(p));
    if (first.length) {
      const common = [...new Set(first)].filter((w) => rest.some((set) => set.includes(w)));
      if (common.length >= 1 && rest.every((set) => set.length >= 4)) return true;
    }
  }
  return false;
}

function detectResultFirst(sentence) {
  const t = String(sentence || "").trim();
  const low = t.toLowerCase();
  // Awali dengan angka / hasil / outcome, lalu cause-verb.
  if (/^\d+/.test(t)) return true;
  if (/(\bmembuat\b|\bmembuat\b|\bbikin\b|\bmengakibatkan\b|\bmenyebabkan\b|\bmembawa\b|\bleads to\b|\bcauses\b|\bturns into\b)/i.test(low)) return true;
  if (/(\bsatu\b|\bsebuah\b|\bsatu-satunya\b) \w+ (membuat|bikin|mengubah|menghancurkan|menyelamatkan)/i.test(low)) return true;
  return false;
}

function detectQuestion(sentence) {
  const t = String(sentence || "").trim();
  if (/[?]$/.test(t)) return true;
  return /\b(kenapa|mengapa|bagaimana|apakah|gimana|why|how|what|when|who|which)\b/i.test(t);
}

function detectWarning(sentence, lang) {
  return hasAny(sentence, lang, "warning") >= 1 && !detectQuestion(sentence);
}

function detectConfession(sentence, lang) {
  return hasAny(sentence, lang, "confession") >= 1;
}

function detectRevelation(sentence, lang) {
  return hasAny(sentence, lang, "surprise") >= 1 || hasAny(sentence, lang, "curiosityTease") >= 1;
}

function detectConflict(sentence, lang) {
  const contrast = hasAny(sentence, lang, "contrast");
  const conflict = hasAny(sentence, lang, "conflict");
  return contrast >= 1 && conflict >= 1;
}

function detectStoryTease(sentence, lang) {
  return hasAny(sentence, lang, "narrative") >= 1;
}

function detectDirectValue(sentence, lang) {
  const value = hasAny(sentence, lang, "value");
  const imperative = hasAny(sentence, lang, "imperative");
  return value >= 1 && imperative >= 1;
}

function detectFact(sentence, lang) {
  return /\d/.test(String(sentence || "")) && !detectQuestion(sentence);
}

// ---------------------------------------------------------------------------
// CLASSIFICATION — type (struktur retorika) + intent (mengapa bekerja).
// DETEKSI bertingkat, bukan default CURIOSITY. Output SELALU dari HOOK_TYPES
// (16 taksonomi tunggal, sinkron dengan LLM prompt).
// ---------------------------------------------------------------------------
function classifyHookType(sentence, lang) {
  if (!sentence) return "CURIOSITY";
  if (detectQuestion(sentence)) return "QUESTION";
  if (detectWarning(sentence, lang)) return "PROBLEM";
  if (detectConflict(sentence, lang)) return "PROBLEM";
  if (detectConfession(sentence, lang)) return "CONFESSION";
  if (detectResultFirst(sentence)) return "REVELATION";
  if (detectParallelStructure(sentence)) return "CONTRAST";
  if (detectRevelation(sentence, lang)) return "REVELATION";
  if (detectStoryTease(sentence, lang)) return "STORY";
  if (detectDirectValue(sentence, lang)) return "DIRECT VALUE";
  if (detectFact(sentence, lang)) return "EDUCATIONAL";
  if (hasAny(sentence, lang, "contrast") >= 1) return "CONTRAST";
  if (hasAny(sentence, lang, "surprise") >= 1) return "SURPRISE";
  if (hasAny(sentence, lang, "curiosityTease") >= 1) return "MYSTERY";
  if (hasAny(sentence, lang, "narrative") >= 1) return "STORY";
  if (hasAny(sentence, lang, "value") >= 1) return "DIRECT VALUE";
  if (hasAny(sentence, lang, "confession") >= 1) return "CONFESSION";
  if (hasAny(sentence, lang, "warning") >= 1) return "PROBLEM";
  if (hasAny(sentence, lang, "conflict") >= 1) return "PROBLEM";
  return "CURIOSITY";
}

function hookIntent(type, sentence, lang) {
  const t = String(type || "").toUpperCase();
  if (t === "QUESTION" || t === "CURIOSITY" || t === "MYSTERY" || t === "HUMOR") return "curiosity";
  if (t === "PROBLEM") return "urgency";
  if (t === "CONTRAST" || t === "CONTROVERSY") return "debate";
  if (t === "REVELATION" || t === "SURPRISE" || t === "SHOCK") return "shock";
  if (t === "CONFESSION" || t === "EMOTIONAL") return "emotion";
  if (t === "STORY") return "narrative";
  if (t === "DIRECT VALUE" || t === "EDUCATIONAL" || t === "TRANSFORMATION") return "value";
  if (hasAny(sentence, lang, "confession") >= 1) return "emotion";
  if (hasAny(sentence, lang, "surprise") >= 1) return "shock";
  return "curiosity";
}

// ---------------------------------------------------------------------------
// EVIDENCE-BASED SCORING — 0..100. Kata kunci dihitung SEKALI per kategori.
// ---------------------------------------------------------------------------
function scoreHook(sentence, lang, context) {
  const text = cleanText(sentence || "");
  if (!text) return { score: 0, evidence: {}, penalties: {}, excluded: true, reason: "empty" };

  const cat = openerCategory(text, lang);
  if (cat !== "none") {
    return { score: 0, evidence: {}, penalties: {}, excluded: true, reason: cat };
  }

  const words = wordsOf(text);
  const wc = words.length;
  const low = text.toLowerCase();

  let score = 0;

  // ---- specificity (0-20) ----
  let specificity = 0;
  if (/\d/.test(text)) specificity += 8;
  const numUnit = hasAny(text, lang, "numbers");
  if (numUnit >= 1) specificity += 6;
  // Named entity / proper noun: kata dengan huruf kapital TIDAK di awal kalimat.
  const wordsArr = text.split(/\s+/).filter(Boolean);
  const capWords = wordsArr.slice(1).filter((w) => /^\b[A-Z][a-z]{2,}\b/.test(w)).length;
  specificity += Math.min(6, capWords * 2);
  // Angka kata (satu, dua, lima, sepuluh, ratusan, ...) — specificity nyata.
  if (/\b(satu|sebuah|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|ratusan|ribuan|jutaan|puluhan|belasan)\b/i.test(text)) specificity += 4;
  // Skala waktu: "dalam semalam", "selama 5 tahun", "seminggu".
  if (/\b(dalam|selama|sejak)\s+\w+\s+(menit|jam|hari|bulan|tahun|minggu|malam|detik)\b|\b(semalam|sehari|setahun|sebulan|seminggu)\b/i.test(text)) specificity += 4;
  specificity = Math.min(20, specificity);
  score += specificity;

  // ---- information density (0-10) ----
  const stop = (HOOK_WORDS[lang] && HOOK_WORDS[lang].stopwords) || [];
  const contentWords = words.filter((w) => !stop.includes(w));
  const density = Math.min(10, Math.round((contentWords.length / Math.max(1, wc)) * 12));
  score += density;

  // ---- curiosity gap (0-18) ----
  const isQuestion = detectQuestion(text);
  const teaser = Math.min(1, hasAny(text, lang, "curiosityTease"));
  let curiosity = 0;
  if (isQuestion) curiosity += 10;
  if (teaser) curiosity += 8;
  // Pertanyaan yang langsung dijawab dalam kalimat yang sama → gap hilang.
  // Hanya marker jawaban yang TIDAK ambigu (hindari "jadi" di "jadi kaya").
  const selfAnswered = /(karena itu|it's because|the reason is|jawabannya|alasannya|the answer)/i.test(low);
  if (isQuestion && selfAnswered) curiosity = Math.min(curiosity, 4);
  score += Math.min(18, curiosity);

  // ---- tension / conflict (0-14) ----
  const tension = Math.min(14, hasAny(text, lang, "contrast") * 7 + hasAny(text, lang, "conflict") * 7);
  score += tension;

  // ---- novelty / surprise (0-10) ----
  const isParallel = detectParallelStructure(text);
  const novelty = Math.min(10, hasAny(text, lang, "surprise") * 5 + (isParallel ? 5 : 0));
  score += novelty;

  // ---- insight / observation (0-14) ----
  // Hook understated (observasi tajam, kontras paralel) justru kuat untuk
  // relatability — beri bonus, bukan penalti (audit A5).
  if (isParallel) {
    score += 14;
    // Struktur mandiri: "X <verb> A, Y <verb> B" tidak butuh konteks video.
    score += 4;
  }

  // ---- result-first (0-8) ----
  if (detectResultFirst(text)) score += 8;

  // ---- clarity / concision (0-8) ----
  if (wc >= 4 && wc <= 16) score += 6;
  else if (wc <= 22) score += 3;
  if (/[.!?…]$/.test(text)) score += 2;

  // ---- context independence (0-10) ----
  let contextInd = 0;
  const pronounStart = HOOK_WORDS[lang] && HOOK_WORDS[lang].pronoun
    ? HOOK_WORDS[lang].pronoun.some((p) => new RegExp(`^${escapeRe(p)}\\b`).test(low))
    : false;
  if (!pronounStart) contextInd += 8;
  const namedSubject = capWords > 0 || /\d/.test(text);
  if (namedSubject) contextInd += 2;
  // Antecedent ada di kalimat sebelumnya → pronoun boleh dipakai.
  const prior = (context && context.sentences || []).slice(0, context.index || 0).join(" ");
  const hasAntecedent = prior && /\b[A-Z][a-z]{2,}\b|\b(nama|orang|mereka|bisnis|uang|video|channel|dia|saudara)\b/i.test(prior);
  if (pronounStart && hasAntecedent) contextInd = Math.max(contextInd, 6);
  score += Math.min(10, contextInd);

  // ---- time-to-value / direct value (0-8) ----
  const value = Math.min(8, hasAny(text, lang, "value") * 4 + hasAny(text, lang, "imperative") * 4);
  score += value;

  // ---- authenticity (0-6) ----
  const confession = hasAny(text, lang, "confession");
  const narrative = hasAny(text, lang, "narrative");
  const authenticity = Math.min(6, confession * 3 + narrative * 3);
  score += authenticity;

  // ---- penalties ----
  const penalties = { filler: 0, repetition: 0, hedge: 0, long: 0, deictic: 0, pronounNoAntecedent: 0 };

  if (startsWithFiller(text, lang)) {
    penalties.filler = 15;
    score -= 15;
  }

  // Repetition / diminishing returns: kata konten terulang >= 3x.
  const freq = {};
  for (const w of contentWords) freq[w] = (freq[w] || 0) + 1;
  const maxFreq = Object.keys(freq).reduce((m, k) => Math.max(m, freq[k]), 0);
  if (maxFreq >= 3) {
    penalties.repetition = 15;
    score -= 15;
  } else if (maxFreq === 2 && contentWords.length <= 4) {
    penalties.repetition = 6;
    score -= 6;
  }

  if (hasAny(text, lang, "hedge") >= 1) {
    penalties.hedge = 6;
    score -= 6;
  }

  if (wc > 28) {
    penalties.long = 8;
    score -= 8;
  }

  if (hasAny(text, lang, "deictic") >= 1) {
    penalties.deictic = 8;
    score -= 8;
  }

  let pronounPenalty = 0;
  if (pronounStart && !hasAntecedent) {
    pronounPenalty = 10;
    penalties.pronounNoAntecedent = 10;
    score -= 10;
  }

  // ---- gates (anti keyword-gaming) ----
  // 1. Banyak sinyal curiosity/tension tapi tanpa specificity/density → cap.
  const strongSignal = Math.min(18, curiosity) + tension + novelty;
  if (strongSignal >= 15 && specificity < 6 && density < 5) {
    score = Math.min(score, 58);
  }
  // 2. Deictic + pronoun tanpa antecedent → cap 60.
  if (penalties.deictic + pronounPenalty >= 10) {
    score = Math.min(score, 60);
  }
  // 3. Repetition berat → cap 45 (anti "ternyata ternyata ternyata" keyword-stuffing).
  if (maxFreq >= 3) {
    score = Math.min(score, 45);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    score,
    evidence: { specificity, density, curiosity, tension, novelty, clarity: Math.min(8, wc >= 4 && wc <= 16 ? 6 : wc <= 22 ? 3 : 0) + (/[.!?…]$/.test(text) ? 2 : 0), context: contextInd, value, authenticity },
    penalties,
    excluded: false,
    reason: "ok"
  };
}

// ---------------------------------------------------------------------------
// PAYOFF VALIDATION — clip harus benar-benar menjawab / menunaikan hook.
// ---------------------------------------------------------------------------
function validatePayoff(hook, sentences, lang) {
  const rest = (sentences || []).slice(1);
  const restText = rest.join(" ");
  const wc = restText.split(/\s+/).filter(Boolean).length;
  const type = classifyHookType(hook, lang);

  let confidence = 0;
  let matched = "";

  // Hook jenis pernyataan mandiri (EDUCATIONAL / CURIOSITY / CONTRAST /
  // REVELATION) menunaikan dirinya sendiri: payoff-nya adalah isi clip yang
  // koheren, bukan janji yang harus dijawab kemudian.
  const selfContained = ["EDUCATIONAL", "CURIOSITY", "CONTRAST", "REVELATION"].includes(type);

  const markers = {
    QUESTION: ["karena", "alasannya", "ternyata", "jadi", "caranya", "itu karena", "the reason", "because", "turns out", "so", "that's why", "the answer", "jawabannya"],
    PROBLEM: ["jangan", "harus", "cara", "solusi", "tips", "hindari", "gantinya", "alternatif", "ternyata", "padahal", "jadi", "akhirnya", "tapi", "namun", "in the end", "turns out", "you should", "instead", "the way", "how to avoid"],
    CONFESSION: ["ternyata", "akhirnya", "jadi", "sekarang", "now", "then", "setelah", "after"],
    REVELATION: ["alasannya", "kenapa", "karena", "ternyata", "jadi", "intinya", "akhirnya", "artinya", "the reason", "because", "how", "cara", "kenapa", "in the end", "the point is", "so"],
    CONTRAST: ["ternyata", "justru", "padahal", "contoh", "misalnya", "tapi", "namun", "the thing is", "turns out", "in fact", "but", "however", "yet"],
    STORY: ["kemudian", "lalu", "akhirnya", "ternyata", "then", "after", "in the end", "but"],
    "DIRECT VALUE": ["pertama", "kedua", "langkah", "harus", "jangan", "caranya", "tips", "the first", "step", "here's how", "you need"],
    EDUCATIONAL: ["contoh", "misalnya", "ternyata", "artinya", "the reason", "for example", "turns out", "which means"],
    SURPRISE: ["ternyata", "jadi", "nggak nyangka", "turns out", "surprisingly", "who knew"],
    MYSTERY: ["ternyata", "jawabannya", "rahasia", "the answer", "the secret", "behind"],
    CONTROVERSY: ["padahal", "justru", "orang bilang", "debat", "some people say", "kontroversi"],
    CURIOSITY: ["ternyata", "jadi", "akhirnya", "intinya", "so", "in the end", "the point"]
  }[type] || [];

  for (const m of markers) {
    if (new RegExp(escapeRe(m), "i").test(restText)) {
      matched = m;
      confidence += 12;
    }
  }

  // Struktur: cukup kalimat + kata untuk menunaikan hook.
  if ((sentences || []).length >= 3) confidence += 20;
  else if ((sentences || []).length === 2) confidence += 10;
  if (wc >= 20) confidence += 18;
  else if (wc >= 10) confidence += 10;

  // Hook pernyataan mandiri: pemenuhan struktur sudah hampir cukup.
  if (selfContained && (sentences || []).length >= 2 && wc >= 12) confidence += 12;

  // Hook yang payoff-nya nyata di kalimat terakhir (bukan hook itu sendiri).
  const last = (sentences || []).slice(-1)[0] || "";
  if (last && last !== hook && /[.!?]$/.test(last)) confidence += 8;

  confidence = Math.max(0, Math.min(100, Math.round(confidence)));
  return {
    confidence,
    matched,
    payoffSentence: rest.find((s) => markers.some((m) => new RegExp(escapeRe(m), "i").test(s))) || (sentences || []).slice(-1)[0] || "",
    fulfilled: confidence >= 40
  };
}

// ---------------------------------------------------------------------------
// MINIMAL-EDIT NORMALIZATION — LEVEL 0..4. Tidak pernah mengarang kata.
//   LEVEL 0: pertahankan asli bila sudah kuat.
//   LEVEL 1: buang opener filler/greeting.
//   LEVEL 2: bersihkan trailing filler / tanda baca menggantung.
//   LEVEL 3: ambil klausa terkuat bila kalimat majemuk (split koma/konjungsi).
//   LEVEL 4: (opsional, aman) buang pronoun pemula bila konteks tak jelas.
// ---------------------------------------------------------------------------
function normalizeHook(sentence, lang, opts) {
  const src = cleanText(sentence || "");
  if (!src) return { text: "", level: -1, edits: [] };

  let text = src;
  const edits = [];
  let level = 0;

  // LEVEL 1: strip greeting/filler opener.
  const stripPatterns = HOOK_WORDS[lang] && HOOK_WORDS[lang].fillerOpeners || [];
  const lower1 = text.toLowerCase().trim();
  for (const f of stripPatterns) {
    if (new RegExp(`^${escapeRe(f)}\\s*[,:]?\\s+`, "i").test(lower1) || new RegExp(`^${escapeRe(f)}\\s*[,:]?\\s*$`, "i").test(lower1)) {
      const next = text.replace(new RegExp(`^${escapeRe(f)}\\s*[,:]?\\s+`, "i"), "").trim();
      if (next.length > 3) {
        text = next;
        edits.push(`strip-opener:${f}`);
        level = Math.max(level, 1);
      }
      break;
    }
  }
  // Greeting/self-intro opener ("Halo guys", "Nama saya ...") — buang juga.
  const openers = (HOOK_WORDS[lang] && HOOK_WORDS[lang].greeting || []).concat(
    HOOK_WORDS[lang] && HOOK_WORDS[lang].selfIntro || []
  );
  for (const f of openers) {
    if (new RegExp(`^${escapeRe(f)}\\s*[,:]?\\s+`, "i").test(text) || new RegExp(`^${escapeRe(f)}\\s*[,:]?\\s*$`, "i").test(text)) {
      const next = text.replace(new RegExp(`^${escapeRe(f)}\\s*[,:]?\\s+`, "i"), "").trim();
      if (next.length > 3) {
        text = next;
        edits.push(`strip-opener:${f}`);
        level = Math.max(level, 1);
      }
      break;
    }
  }

  // LEVEL 2: buang trailing konjungsi / filler menggantung.
  const trailing = /\s+(yang|dan|dengan|untuk|dari|sehingga|tapi|namun|padahal|and|but|with|from|that|to|of|the|a|an)$/i;
  while (trailing.test(text) && text.length > 4) {
    text = text.replace(trailing, "");
    edits.push("trim-trailing");
    level = Math.max(level, 2);
  }
  text = text.replace(/([^?!])[.!…]+$/g, "$1").trim();
  if (text !== src) edits.push("clean-punct");

  // LEVEL 3: klausa terkuat bila kalimat majemuk (split pada koma/konjungsi utama).
  if (opts && opts.preferClause !== false) {
    const clauses = text.split(/\s*,\s+|\s+?tapi\s+|\s+?namun\s+|\s+?padahal\s+|\s+?and\s+|\s+?but\s+/i).map((c) => cleanText(c)).filter((c) => c.length > 3);
    if (clauses.length >= 2) {
      let best = clauses[0];
      let bestScore = -1;
      for (const c of clauses) {
        const sc = scoreHook(c, lang, {}).score;
        if (sc > bestScore) { bestScore = sc; best = c; }
      }
      if (bestScore > 45) {
        text = best;
        edits.push("pick-strongest-clause");
        level = Math.max(level, 3);
      }
    }
  }

  // LEVEL 4: buang pronoun pemula bila tidak ada antecedent (optional).
  if (opts && opts.stripContextPronoun) {
    const pronouns = HOOK_WORDS[lang] && HOOK_WORDS[lang].pronoun || [];
    for (const p of pronouns) {
      if (new RegExp(`^${escapeRe(p)}\\s+`, "i").test(text)) {
        const next = text.replace(new RegExp(`^${escapeRe(p)}\\s+`, "i"), "").trim();
        if (next.length > 3) {
          text = next;
          edits.push(`strip-pronoun:${p}`);
          level = Math.max(level, 4);
        }
        break;
      }
    }
  }

  // Jangan pernah kembalikan string kosong.
  if (!text.trim()) return { text: src, level: 0, edits: ["keep-original"] };

  return { text: text.trim(), level, edits };
}

// ---------------------------------------------------------------------------
// SELECTION — evaluasi semua kalimat, pilih hook terbaik (boleh reorder).
// ---------------------------------------------------------------------------
function selectHook(sentences, lang, options) {
  const sents = (sentences || []).map((s) => cleanText(s)).filter(Boolean);
  if (!sents.length) {
    return { hook: "", score: 0, type: "CURIOSITY", intent: "curiosity", confidence: 0, originalHook: "", recommendedHook: "", reordered: false, candidates: [], payoff: { confidence: 0, fulfilled: false, payoffSentence: "" }, contextIndependent: false };
  }

  const candidates = [];
  for (let i = 0; i < sents.length; i++) {
    const s = sents[i];
    const r = scoreHook(s, lang, { index: i, sentences: sents });
    if (r.excluded) {
      candidates.push({ sentence: s, index: i, score: 0, excluded: true, reason: r.reason });
      continue;
    }
    const type = classifyHookType(s, lang);
    candidates.push({
      sentence: s,
      index: i,
      score: r.score,
      excluded: false,
      reason: "ok",
      type,
      intent: hookIntent(type, s, lang),
      evidence: r.evidence,
      penalties: r.penalties
    });
  }

  const viable = candidates.filter((c) => !c.excluded);
  const best = viable.sort((a, b) => b.score - a.score || a.index - b.index)[0] || null;

  // Selection: pilih kandidat terbaik dengan skor layak; bila tidak ada yang
  // layak, jatuh ke kalimat pertama (source fidelity > reorder).
  let chosen = best && best.score >= 40 ? best : candidates.find((c) => c.index === 0) || best || candidates[0];

  // Reorder hanya aman bila: kandidat terbaik BUKAN kalimat pertama, dan tidak
  // bergantung pada konteks sebelumnya (pronoun tanpa antecedent).
  const pronounNoAnte = chosen && chosen.penalties && chosen.penalties.pronounNoAntecedent > 0;
  const reordered = !!best && best.index > 0 && best.score >= 40 && !pronounNoAnte && best.score > (candidates.find((c) => c.index === 0)?.score || 0) + 5;

  if (reordered) chosen = best;

  const sentence = chosen.sentence;
  const type = classifyHookType(sentence, lang);
  const intent = hookIntent(type, sentence, lang);
  const norm = normalizeHook(sentence, lang, { stripContextPronoun: reordered });

  // Confidence: gap terhadap kandidat kedua + skor absolut.
  const secondBest = viable.filter((c) => c !== best).sort((a, b) => b.score - a.score)[0] || null;
  const gap = best && secondBest ? Math.max(0, best.score - secondBest.score) : (best ? 10 : 0);
  const confidence = Math.max(0, Math.min(100, Math.round((best ? best.score : 0) * 0.5 + gap * 3 + 10)));

  const payoff = validatePayoff(sentence, sents, lang);

  const contextIndependent = !(chosen.penalties && (chosen.penalties.deictic > 0 || chosen.penalties.pronounNoAntecedent > 0));

  return {
    hook: sentence,
    score: chosen.score,
    type,
    intent,
    confidence,
    originalHook: sentence,
    recommendedHook: norm.text,
    normalizeLevel: norm.level,
    reordered,
    candidates,
    payoff,
    contextIndependent
  };
}

// ---------------------------------------------------------------------------
// DIVERSITY / DEDUP — antar clip dalam satu batch.
// ---------------------------------------------------------------------------
function diversifyHooks(clips, lang) {
  const out = [];
  const usedCores = [];
  for (const clip of clips) {
    if (!clip || !clip.hook) { out.push(clip); continue; }
    const core = new Set(wordsOf(clip.hook));
    const tooSimilar = usedCores.some((used) => {
      const inter = [...core].filter((w) => used.has(w)).length;
      const union = new Set([...core, ...used]);
      return union.size > 0 && inter / union.size >= 0.6;
    });
    if (tooSimilar && clip.candidates && clip.candidates.length) {
      // Pilih kandidat alternatif yang berbeda.
      const alt = clip.candidates.filter((c) => !c.excluded).sort((a, b) => b.score - a.score).find((c) => {
        const altCore = new Set(wordsOf(c.sentence));
        const inter = [...core].filter((w) => altCore.has(w)).length;
        const union = new Set([...core, ...altCore]);
        return union.size > 0 && inter / union.size < 0.5;
      });
      if (alt) {
        const norm = normalizeHook(alt.sentence, lang, {});
        clip.hook = norm.text;
        clip.originalHook = alt.sentence;
        clip.hookType = classifyHookType(alt.sentence, lang);
        clip.reordered = true;
      }
    }
    usedCores.push(new Set(wordsOf(clip.hook)));
    out.push(clip);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
module.exports = {
  HOOK_WORDS,
  HOOK_TYPES,
  isHookType,
  cleanText,
  splitSentences,
  langTag,
  scoreHook,
  classifyHookType,
  hookIntent,
  validatePayoff,
  normalizeHook,
  selectHook,
  diversifyHooks,
  helpers: {
    detectQuestion,
    detectParallelStructure,
    detectResultFirst,
    openerCategory,
    startsWithFiller,
    wordsOf
  }
};
