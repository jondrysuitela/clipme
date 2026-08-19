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
//   6. recommendedHook = hasil CRAFT VIRAL (menyusun ulang kata/fakta sumber
//      menjadi hook scroll-stop), BUKAN minimal-edit caption asli. Tidak pernah
//      menambah fakta/angka baru — hanya framing viral + susunan ulang.
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
    return { score: 0, evidence: {}, penalties: {}, excluded: true, reason: cat, deep: 0, dimensions: {} };
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

  const evidence = { specificity, density, curiosity, tension, novelty, clarity: Math.min(8, wc >= 4 && wc <= 16 ? 6 : wc <= 22 ? 3 : 0) + (/[.!?…]$/.test(text) ? 2 : 0), context: contextInd, value, authenticity };
  const deepResult = dimensionScores(text, lang, context, evidence, penalties);

  return {
    score,
    evidence,
    penalties,
    deep: deepResult.deep,
    dimensions: deepResult.dimensions,
    deepWeights: deepResult.weights,
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
// VIRAL CRAFT — rekomendasi hook yang DIKARANG ulang untuk scroll-stop & viral.
// Bukan salinan/parafrase ringan caption asli. Prinsip:
//   - Hanya menyusun ulang kata/fakta yang BENAR-BENAR muncul di kalimat/
//     transkrip. Tidak ada fakta, angka, atau klaim baru.
//   - Framing viral ("jarang dibahas", "bikin nggak nyangka", "jangan ulangi
//     kesalahan") adalah gaya bahasa tentang video itu sendiri, bukan klaim
//     faktual baru tentang dunia.
//   - Memakai slot yang diekstrak (angka, topik, kontras) agar hasil selalu
//     konkret dan berbeda dari baris caption.
// ---------------------------------------------------------------------------
function capFirst(s) {
  return String(s || "").replace(/^\w/, (c) => c.toUpperCase());
}

function lowerFirst(s) {
  return String(s || "").replace(/^\w/, (c) => c.toLowerCase());
}

function stripLeading(sentence, markers) {
  let t = String(sentence || "").trim();
  for (const m of markers || []) {
    const re = new RegExp(`^${escapeRe(m)}\\b[,\\s]*`, "i");
    if (re.test(t)) {
      t = t.replace(re, "").trim();
      break;
    }
  }
  return t;
}

function extractNumbers(text) {
  const out = [];
  const re = /\b\d{1,3}(?:[.,]\d+)?\s*(?:juta|miliar|ribu|tahun|bulan|minggu|hari|jam|menit|detik|persen|%|rupiah|dolar|kali|orang|poin|gol|kali lipat)\b/gi;
  let m;
  while ((m = re.exec(text))) {
    const full = m[0].trim();
    if (!out.some((o) => o.full === full)) {
      const num = (m[0].match(/\d[\d.,]*/) || [" "])[0];
      const unit = (m[0].match(/[a-z%]+$/i) || [" "])[0];
      out.push({ full, num, unit });
    }
  }
  if (!out.length) {
    const w = String(text).match(/\b(satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|belasan|puluhan|ratusan|ribuan|jutaan)\s+(kebiasaan|langkah|cara|tahun|bulan|hari|keputusan|hal|kali|orang|alasan|fakta|jam|menit)\b/i);
    if (w) out.push({ full: w[0], num: w[1], unit: w[2] });
  }
  return out;
}

function extractTopic(text, lang) {
  const stop = (HOOK_WORDS[lang] && HOOK_WORDS[lang].stopwords) || [];
  const extra = ["kebanyakan", "kenapa", "mengapa", "apakah", "bagaimana", "gimana", "siapa", "kapan", "berapa", "harus", "bisa", "bakal", "akan", "para", "itu", "ini", "itu", "juga", "sudah", "telah", "sangat", "lebih", "nggak", "gak", "enggak", "tidak", "tak", "di", "ke", "dari", "yang", "dan", "atau", "dengan", "pada", "untuk", "dalam", "saat", "ketika", "tapi", "namun", "sedangkan", "sementara", "baru", "tadi", "kemarin", "semalam", "overnight", "today", "yesterday", "now", "just", "once", "lost", "make", "made", "know", "think", "found", "started", "became", "become", "keep", "kept", "does", "did", "have", "has", "had", "get", "got", "going", "want", "need", "work", "works", "bought", "sold", "went", "gone", "use", "used", "say", "said", "told", "my", "our", "their", "your", "his", "her", "its", "all", "about", "when", "where", "who", "what", "why", "how"];
  const tokens = String(text).toLowerCase().split(/[^a-z0-9\u00c0-\u024f\u1e00-\u1eff]+/i).filter((w) => w.length > 1);
  const isStop = (w) => stop.includes(w) || extra.includes(w);
  const runs = [];
  let cur = [];
  for (const w of tokens) {
    if (!isStop(w)) { cur.push(w); continue; }
    if (cur.length) { runs.push(cur); cur = []; }
  }
  if (cur.length) runs.push(cur);
  if (!runs.length) return [];
  runs.sort((a, b) => b.length - a.length || b.join(" ").length - a.join(" ").length);
  return [runs[0].join(" ")];
}

function extractContrastParts(text) {
  const parts = String(text).split(/\b(bukan|tapi|namun|padahal|sedangkan|sementara|justru|versus|vs|not|but|whereas|while|instead of|unlike)\b/i);
  const list = parts.map((p) => cleanText(p)).filter((p) => p.length > 3);
  if (list.length >= 2) return { a: list[0], b: list[list.length - 1] };
  // Kontras paralel tanpa konjungsi eksplisit: "Orang kaya membeli aset,
  // orang miskin membeli gaya hidup" — dua sisi dipisah koma.
  if (detectParallelStructure(text)) {
    const comma = String(text).split(/\s*,\s+/).map((p) => cleanText(p)).filter((p) => p.length > 3);
    if (comma.length >= 2) return { a: comma[0], b: comma[comma.length - 1] };
  }
  return null;
}

const ID_CRAFT = {
  QUESTION: [
    { id: "num-gap", need: (f) => !!f.num, make: (f) => `${capFirst(f.num)} — dan gak banyak yang sadar kenapa` },
    { id: "topic-answer", need: (f) => !!f.topic, make: (f) => `${capFirst(f.topic)}: jawabannya nggak seperti yang kamu kira` },
    { id: "wrong-most", need: () => true, make: (f) => `Kebanyakan orang salah paham soal ${f.clause}` }
  ],
  SURPRISE: [
    { id: "num-shock", need: (f) => !!f.num, make: (f) => `${capFirst(f.num)} — fakta yang bikin nggak nyangka` },
    { id: "topic-shock", need: (f) => !!f.topic, make: (f) => `${capFirst(f.topic)}: faktanya bikin nggak nyangka` },
    { id: "turns-out", need: () => true, make: (f) => `Ternyata ${f.clause}` }
  ],
  REVELATION: [
    { id: "num-shock", need: (f) => !!f.num, make: (f) => `${capFirst(f.num)} — fakta yang bikin nggak nyangka` },
    { id: "topic-shock", need: (f) => !!f.topic, make: (f) => `${capFirst(f.topic)}: faktanya bikin nggak nyangka` },
    { id: "turns-out", need: () => true, make: (f) => `Ternyata ${f.clause}` }
  ],
  SHOCK: [
    { id: "num-shock", need: (f) => !!f.num, make: (f) => `${capFirst(f.num)} — fakta yang bikin nggak nyangka` },
    { id: "topic-shock", need: (f) => !!f.topic, make: (f) => `${capFirst(f.topic)}: faktanya bikin nggak nyangka` },
    { id: "turns-out", need: () => true, make: (f) => `Ternyata ${f.clause}` }
  ],
  PROBLEM: [
    { id: "topic-dont", need: (f) => !!f.topic, make: (f) => `Jangan ulangi kesalahan yang sama soal ${f.topic}` },
    { id: "num-problem", need: (f) => !!f.num, make: (f) => `${capFirst(f.num)} — kesalahan yang jarang disadari` },
    { id: "problem-few", need: () => true, make: (f) => `Ini penyebab masalah yang jarang dibahas: ${f.clause}` }
  ],
  CONTRAST: [
    { id: "contrast-vs", need: (f) => !!f.contrast, make: (f) => `${capFirst(f.contrast.a)} vs ${capFirst(f.contrast.b)} — mana yang kamu lakuin?` },
    { id: "topic-contrast", need: (f) => !!f.topic, make: (f) => `${capFirst(f.topic)}: dua hal yang sering tertukar` },
    { id: "contrast-generic", need: () => true, make: (f) => `Dua hal yang sering tertukar: ${f.clause}` }
  ],
  "DIRECT VALUE": [
    { id: "num-value", need: (f) => !!f.num, make: (f) => `${capFirst(f.num)} — langkah yang gak banyak orang sadari` },
    { id: "topic-value", need: (f) => !!f.topic, make: (f) => `${capFirst(f.topic)}: cara yang jarang diketahui` },
    { id: "value-generic", need: () => true, make: (f) => `Ini yang jarang dibahas: ${f.clause}` }
  ],
  EDUCATIONAL: [
    { id: "num-value", need: (f) => !!f.num, make: (f) => `${capFirst(f.num)} — langkah yang gak banyak orang sadari` },
    { id: "topic-value", need: (f) => !!f.topic, make: (f) => `${capFirst(f.topic)}: cara yang jarang diketahui` },
    { id: "value-generic", need: () => true, make: (f) => `Ini yang jarang dibahas: ${f.clause}` }
  ],
  TRANSFORMATION: [
    { id: "num-value", need: (f) => !!f.num, make: (f) => `${capFirst(f.num)} — langkah yang gak banyak orang sadari` },
    { id: "topic-value", need: (f) => !!f.topic, make: (f) => `${capFirst(f.topic)}: cara yang jarang diketahui` },
    { id: "value-generic", need: () => true, make: (f) => `Ini yang jarang dibahas: ${f.clause}` }
  ],
  STORY: [
    { id: "topic-story", need: (f) => !!f.topic, make: (f) => `Cerita ${f.topic} yang nggak disangka-sangka` },
    { id: "story-generic", need: () => true, make: (f) => `Awal mula yang jarang diceritakan: ${f.clause}` }
  ],
  CONFESSION: [
    { id: "topic-confess", need: (f) => !!f.topic, make: (f) => `Gue gak nyangka ${f.topic} bakal jadi pelajaran berharga` },
    { id: "confess-generic", need: () => true, make: (f) => `Jujur aja, ini bukan hal yang gampang: ${f.clause}` }
  ],
  EMOTIONAL: [
    { id: "topic-confess", need: (f) => !!f.topic, make: (f) => `Gue gak nyangka ${f.topic} bakal jadi pelajaran berharga` },
    { id: "confess-generic", need: () => true, make: (f) => `Jujur aja, ini bukan hal yang gampang: ${f.clause}` }
  ],
  CURIOSITY: [
    { id: "topic-secret", need: (f) => !!f.topic, make: (f) => `Rahasia di balik ${f.topic} yang jarang dibahas` },
    { id: "num-mystery", need: (f) => !!f.num, make: (f) => `${capFirst(f.num)} — dan ini baru sebagian kecilnya` },
    { id: "curiosity-generic", need: () => true, make: (f) => `${capFirst(f.clause)}: hal yang jarang orang sadari` }
  ],
  MYSTERY: [
    { id: "topic-secret", need: (f) => !!f.topic, make: (f) => `Rahasia di balik ${f.topic} yang jarang dibahas` },
    { id: "num-mystery", need: (f) => !!f.num, make: (f) => `${capFirst(f.num)} — dan ini baru sebagian kecilnya` },
    { id: "curiosity-generic", need: () => true, make: (f) => `${capFirst(f.clause)}: hal yang jarang orang sadari` }
  ],
  CONTROVERSY: [
    { id: "topic-controversy", need: (f) => !!f.topic, make: (f) => `${capFirst(f.topic)}: ini yang bikin perdebatan` },
    { id: "controversy-generic", need: () => true, make: (f) => `Kontroversial tapi faktual — ${f.clause}` }
  ],
  HUMOR: [
    { id: "topic-secret", need: (f) => !!f.topic, make: (f) => `Rahasia di balik ${f.topic} yang jarang dibahas` },
    { id: "curiosity-generic", need: () => true, make: (f) => `${capFirst(f.clause)}: hal yang jarang orang sadari` }
  ]
};

const EN_CRAFT = {
  QUESTION: [
    { id: "num-gap", need: (f) => !!f.num, make: (f) => `${capFirst(f.num)} — and not many know why` },
    { id: "topic-answer", need: (f) => !!f.topic, make: (f) => `${capFirst(f.topic)}: the answer isn't what you think` },
    { id: "wrong-most", need: () => true, make: (f) => `Most people get this wrong: ${f.clause}` }
  ],
  SURPRISE: [
    { id: "num-shock", need: (f) => !!f.num, make: (f) => `${capFirst(f.num)} — the fact nobody saw coming` },
    { id: "topic-shock", need: (f) => !!f.topic, make: (f) => `${capFirst(f.topic)}: the truth is surprising` },
    { id: "turns-out", need: () => true, make: (f) => `Turns out ${f.clause}` }
  ],
  REVELATION: [
    { id: "num-shock", need: (f) => !!f.num, make: (f) => `${capFirst(f.num)} — the fact nobody saw coming` },
    { id: "topic-shock", need: (f) => !!f.topic, make: (f) => `${capFirst(f.topic)}: the truth is surprising` },
    { id: "turns-out", need: () => true, make: (f) => `Turns out ${f.clause}` }
  ],
  SHOCK: [
    { id: "num-shock", need: (f) => !!f.num, make: (f) => `${capFirst(f.num)} — the fact nobody saw coming` },
    { id: "topic-shock", need: (f) => !!f.topic, make: (f) => `${capFirst(f.topic)}: the truth is surprising` },
    { id: "turns-out", need: () => true, make: (f) => `Turns out ${f.clause}` }
  ],
  PROBLEM: [
    { id: "topic-dont", need: (f) => !!f.topic, make: (f) => `Don't repeat the same mistake about ${f.topic}` },
    { id: "num-problem", need: (f) => !!f.num, make: (f) => `${capFirst(f.num)} — the mistake few notice` },
    { id: "problem-few", need: () => true, make: (f) => `The problem few talk about: ${f.clause}` }
  ],
  CONTRAST: [
    { id: "contrast-vs", need: (f) => !!f.contrast, make: (f) => `${capFirst(f.contrast.a)} vs ${capFirst(f.contrast.b)} — which one are you doing?` },
    { id: "topic-contrast", need: (f) => !!f.topic, make: (f) => `${capFirst(f.topic)}: two things people mix up` },
    { id: "contrast-generic", need: () => true, make: (f) => `Two things people mix up: ${f.clause}` }
  ],
  "DIRECT VALUE": [
    { id: "num-value", need: (f) => !!f.num, make: (f) => `${capFirst(f.num)} — the steps most people miss` },
    { id: "topic-value", need: (f) => !!f.topic, make: (f) => `${capFirst(f.topic)}: the way few people know` },
    { id: "value-generic", need: () => true, make: (f) => `What few people know: ${f.clause}` }
  ],
  EDUCATIONAL: [
    { id: "num-value", need: (f) => !!f.num, make: (f) => `${capFirst(f.num)} — the steps most people miss` },
    { id: "topic-value", need: (f) => !!f.topic, make: (f) => `${capFirst(f.topic)}: the way few people know` },
    { id: "value-generic", need: () => true, make: (f) => `What few people know: ${f.clause}` }
  ],
  TRANSFORMATION: [
    { id: "num-value", need: (f) => !!f.num, make: (f) => `${capFirst(f.num)} — the steps most people miss` },
    { id: "topic-value", need: (f) => !!f.topic, make: (f) => `${capFirst(f.topic)}: the way few people know` },
    { id: "value-generic", need: () => true, make: (f) => `What few people know: ${f.clause}` }
  ],
  STORY: [
    { id: "topic-story", need: (f) => !!f.topic, make: (f) => `The story of ${f.topic} nobody expected` },
    { id: "story-generic", need: () => true, make: (f) => `The beginning few people know: ${f.clause}` }
  ],
  CONFESSION: [
    { id: "topic-confess", need: (f) => !!f.topic, make: (f) => `I never thought ${f.topic} would teach me this much` },
    { id: "confess-generic", need: () => true, make: (f) => `Honestly, this wasn't easy: ${f.clause}` }
  ],
  EMOTIONAL: [
    { id: "topic-confess", need: (f) => !!f.topic, make: (f) => `I never thought ${f.topic} would teach me this much` },
    { id: "confess-generic", need: () => true, make: (f) => `Honestly, this wasn't easy: ${f.clause}` }
  ],
  CURIOSITY: [
    { id: "topic-secret", need: (f) => !!f.topic, make: (f) => `The secret behind ${f.topic} few discuss` },
    { id: "num-mystery", need: (f) => !!f.num, make: (f) => `${capFirst(f.num)} — and that's just part of it` },
    { id: "curiosity-generic", need: () => true, make: (f) => `${capFirst(f.clause)}: something people rarely realize` }
  ],
  MYSTERY: [
    { id: "topic-secret", need: (f) => !!f.topic, make: (f) => `The secret behind ${f.topic} few discuss` },
    { id: "num-mystery", need: (f) => !!f.num, make: (f) => `${capFirst(f.num)} — and that's just part of it` },
    { id: "curiosity-generic", need: () => true, make: (f) => `${capFirst(f.clause)}: something people rarely realize` }
  ],
  CONTROVERSY: [
    { id: "topic-controversy", need: (f) => !!f.topic, make: (f) => `${capFirst(f.topic)}: this is what sparks debate` },
    { id: "controversy-generic", need: () => true, make: (f) => `Controversial but factual — ${f.clause}` }
  ],
  HUMOR: [
    { id: "topic-secret", need: (f) => !!f.topic, make: (f) => `The secret behind ${f.topic} few discuss` },
    { id: "curiosity-generic", need: () => true, make: (f) => `${capFirst(f.clause)}: something people rarely realize` }
  ]
};

function craftViralHook(sentence, sentences, lang) {
  const langKey = lang === "en" ? "en" : "id";
  const text = cleanText(sentence || "");
  const openerMarkers = langKey === "en"
    ? ["so", "okay", "alright", "well", "right", "you know", "basically", "hey", "guys", "now", "actually", "look"]
    : ["jadi", "oke", "nah", "ya", "baiklah", "gini", "begini", "kayaknya", "guys", "teman-teman", "biasanya", "intinya", "sebenarnya"];
  const clause = stripLeading(text, openerMarkers);
  const nums = extractNumbers(text);
  const topics = extractTopic(text, langKey);
  const contrast = extractContrastParts(text);
  const type = classifyHookType(text, lang).toUpperCase();
  const sets = langKey === "en" ? EN_CRAFT : ID_CRAFT;
  const list = sets[type] || sets.CURIOSITY;
  const slots = {
    num: nums.length ? nums[0].full : "",
    topic: topics[0] || "",
    clause: lowerFirst(clause),
    contrast
  };
  let chosen = null;
  for (const tmpl of list) {
    if (tmpl.need(slots)) { chosen = tmpl; break; }
  }
  if (!chosen) chosen = { id: "generic", need: () => true, make: (f) => `Ini yang jarang dibahas: ${f.clause}` };
  let out = cleanText(chosen.make(slots));
  out = out.replace(/\s+([.,?!])/g, "$1").replace(/[,.…]+$/g, "").trim();
  // Safeguard: bila template menghasilkan fragmen menggantung (terlalu pendek
  // atau berakhir preposisi/konjungsi), pakai template generik type tsb.
  const danglingEnd = /\b(soal|tentang|dengan|karena|untuk|di|ke|dari|yang|behind|about|with|from|because|for|of|at|in|on|into|the)$/i.test(out);
  if (out.length < 4 || danglingEnd) {
    const generic = list.slice().reverse().find((tmpl) => tmpl.need(slots) && tmpl.make(slots));
    if (generic && generic !== chosen) {
      out = cleanText(generic.make(slots)).replace(/\s+([.,?!])/g, "$1").replace(/[,.…]+$/g, "").trim();
      chosen = generic;
    }
  }
  if (!out) out = cleanText(normalizeHook(sentence, lang, {}).text) || text;
  // Panjang dinamis: jangan pernah memotong kalimat demi batas karakter.
  // Cap 140 kata/c. Hanya dipotong di batas kata bila melampaui.
  if (out.length > 140) out = out.slice(0, 140).replace(/\s\w+$/, "").trim();
  return { text: out, type, pattern: chosen.id, slots };
}

// ---------------------------------------------------------------------------
// PROFESSIONAL SCORING — 12 dimensi berbobot (total 100). Setiap dimensi
// dinormalisasi 0..1, dikali bobot, dijumlah. Bisa di-tuning lewat `weights`.
// `scoreHook` tetap mengembalikan `score` (skor legacy, backward compatible)
// DAN `deep` (skor profesional) + `dimensions` untuk ranking/metadata.
// ---------------------------------------------------------------------------
const DEEP_WEIGHTS = {
  contentStrength: 15,
  curiosity: 15,
  emotional: 10,
  novelty: 10,
  conflict: 10,
  specificity: 10,
  consequence: 10,
  clarity: 5,
  standalone: 5,
  retention: 5,
  sourceFidelity: 5,
  delivery: 0
};

function dimensionScores(text, lang, context, ev, pen) {
  const evi = ev || {};
  const pens = pen || {};
  const wc = wordsOf(text || "").length;
  const low = String(text || "").toLowerCase();
  const hasNum = /\d/.test(text);
  const hasNumUnit = hasAny(text, lang, "numbers") >= 1;
  const hasQuestion = detectQuestion(text);
  const hasConflict = hasAny(text, lang, "conflict") >= 1;
  const hasContrast = hasAny(text, lang, "contrast") >= 1;
  const hasSurprise = hasAny(text, lang, "surprise") >= 1;
  const hasTease = hasAny(text, lang, "curiosityTease") >= 1;
  const hasConfession = hasAny(text, lang, "confession") >= 1;
  const hasNarrative = hasAny(text, lang, "narrative") >= 1;
  const hasValue = hasAny(text, lang, "value") >= 1;
  const hasImperative = hasAny(text, lang, "imperative") >= 1;
  const resultFirst = detectResultFirst(text);
  const parallel = detectParallelStructure(text);
  const selfAnswered = /(karena itu|it's because|the reason is|jawabannya|alasannya|the answer)/i.test(low);
  const endsPunct = /[.!?…]$/.test(String(text || "").trim());

  const specificity = Math.min(1, (hasNum ? 0.35 : 0) + (hasNumUnit ? 0.3 : 0) + ((evi.specificity || 0) >= 6 ? 0.2 : 0) + (resultFirst ? 0.15 : 0));
  const contentStrength = Math.min(1, ((evi.density || 0) / 10) * 0.6 + (hasValue || hasImperative ? 0.2 : 0) + (resultFirst ? 0.2 : 0) + (hasConflict ? 0.1 : 0));
  const curiosity = Math.max(0, Math.min(1, (hasQuestion ? 0.45 : 0) + (hasTease ? 0.4 : 0) + (hasSurprise ? 0.15 : 0) - (selfAnswered ? 0.35 : 0)));
  const hasLossEvent = /\b(i lost|i've lost|i had lost|lost everything|lost all|kehilangan|bangkrut|went bankrupt|went broke|collapsed|hancur|gagal total|got fired|fired from|diagnosed with|almost died|habis tabungan|patah hati)\b/i.test(low);
  const emotional = Math.min(1, (hasConfession ? 0.35 : 0) + (hasLossEvent ? 0.35 : 0) + (hasNarrative ? 0.15 : 0) + (hasConflict ? 0.15 : 0));
  const novelty = Math.min(1, (hasSurprise ? 0.35 : 0) + (parallel ? 0.3 : 0) + (hasTease ? 0.2 : 0) + (hasNum ? 0.15 : 0));
  const conflict = Math.min(1, (hasConflict ? 0.45 : 0) + (hasContrast ? 0.4 : 0) + (hasImperative ? 0.15 : 0));
  const consequence = Math.min(1, (resultFirst ? 0.4 : 0) + (/\b(akhirnya|sehingga|kolaps|bangkrut|kehilangan|hancur|lost|collapsed|destroyed|ruined|cost me)\b/i.test(low) ? 0.3 : 0) + (hasConflict ? 0.2 : 0) + (/\b(semalam|sebulan|setahun|overnight|within|months|tahun)\b/i.test(low) ? 0.1 : 0));
  const clarity = Math.max(0, Math.min(1, (wc >= 4 && wc <= 16 ? 0.7 : wc <= 24 ? 0.5 : 0.25) + (endsPunct ? 0.3 : 0) - (pens.filler ? 0.25 : 0) - (pens.hedge ? 0.15 : 0)));
  const standalone = Math.max(0, Math.min(1, ((evi.context || 0) / 10) + (parallel ? 0.2 : 0)));
  const retention = Math.min(1, (hasQuestion ? 0.3 : 0) + curiosity * 0.3 + consequence * 0.25 + (wc >= 3 && wc <= 20 ? 0.15 : 0) + (endsPunct ? 0.1 : 0));
  const sourceFidelity = Math.max(0, 1 - (pens.hedge ? 0.25 : 0) - (pens.deictic ? 0.2 : 0) - (pens.pronounNoAntecedent ? 0.15 : 0));
  // Delivery Strength — hanya terpakai bila data timing/prosody tersedia
  // (bobot 0 → netral, tidak menggeser total). Ditunjang server bila ada.
  const delivery = evi.delivery != null ? Math.max(0, Math.min(1, Number(evi.delivery))) : 0.5;

  const dimensions = { contentStrength, curiosity, emotional, novelty, conflict, specificity, consequence, clarity, standalone, retention, sourceFidelity, delivery };
  const weights = DEEP_WEIGHTS;
  let deep = 0;
  for (const k of Object.keys(weights)) deep += (dimensions[k] || 0) * weights[k];
  deep -= (pens.filler || 0) + (pens.repetition || 0) * 0.7 + (pens.deictic || 0) * 0.5 + (pens.pronounNoAntecedent || 0) * 0.5;
  if (pens.repetition >= 3) deep = Math.min(deep, 45);
  if (pens.deictic + (pens.pronounNoAntecedent || 0) >= 10) deep = Math.min(deep, 60);
  deep = Math.max(0, Math.round(deep));
  return { dimensions, weights, deep };
}

// Editorial explanation — deterministik dari dimensi + type + payoff.
function explainHook(hook, deepResult, type, payoff, lang) {
  const dims = deepResult.dimensions;
  const labels = {
    contentStrength: "kekuatan isi", curiosity: "curiosity gap", emotional: "intensitas emosi",
    novelty: "kebaruan informasi", conflict: "konflik/ketegangan", specificity: "spesifisitas",
    consequence: "konsekuensi nyata", clarity: "kejelasan", standalone: "mandiri tanpa konteks",
    retention: "alasan menonton lanjut", sourceFidelity: "kesetiaan ke sumber", delivery: "kekuatan penyampaian"
  };
  const reasons = [];
  const strong = Object.keys(dims).filter((k) => dims[k] >= 0.5).sort((a, b) => dims[b] - dims[a]).slice(0, 3);
  for (const k of strong) reasons.push(`${labels[k]} (${Math.round(dims[k] * 100)}%)`);
  if (!reasons.length) reasons.push("struktur kalimat yang jelas");
  const typeNote = {
    QUESTION: "dibuka dengan pertanyaan yang membuka rasa penasaran",
    CURIOSITY: "menciptakan gap informasi yang membuat penonton penasaran",
    MYSTERY: "menggantung misteri yang ingin dipecahkan",
    SURPRISE: "mematahkan ekspektasi dengan fakta tak terduga",
    REVELATION: "mengungkap fakta yang sebelumnya tidak disadari",
    SHOCK: "memberi kejutan langsung di detik pertama",
    PROBLEM: "langsung menyentuh masalah yang relevan",
    CONTRAST: "memperlihatkan perbedaan yang mencolok",
    "DIRECT VALUE": "menjanjikan nilai langsung untuk penonton",
    EDUCATIONAL: "menawarkan pengetahuan konkret",
    TRANSFORMATION: "menunjukkan perubahan yang signifikan",
    STORY: "mengajak masuk ke dalam cerita",
    CONFESSION: "membangun koneksi emosional lewat kejujuran",
    EMOTIONAL: "menggugah emosi penonton",
    CONTROVERSY: "memicu perdebatan",
    HUMOR: "menghibur dan relatable"
  }[type] || "bukaannya kuat dan spesifik";
  let text = `Terpilih karena ${reasons.join(", ")}; ${typeNote}.`;
  if (payoff && payoff.fulfilled != null) {
    text += ` Payoff terpenuhi (${payoff.confidence}%) — clip benar-benar menjawab hook.`;
  }
  return text;
}

// ---------------------------------------------------------------------------
// VARIATION ENGINE — MODE A (DIRECT) & MODE B (EDITORIAL) + strategi varian.
// Setiap varian tetap source-faithful: hanya menyusun ulang kata/fakta sumber.
// ---------------------------------------------------------------------------
function buildVariants(hook, sentences, lang) {
  const langKey = lang === "en" ? "en" : "id";
  const text = cleanText(hook || "");
  if (!text) return [];
  const clause = lowerFirst(stripLeading(text, langKey === "en"
    ? ["so", "okay", "alright", "well", "right", "you know", "basically", "hey", "guys", "now", "actually", "look"]
    : ["jadi", "oke", "nah", "ya", "baiklah", "gini", "begini", "kayaknya", "guys", "teman-teman", "biasanya", "intinya", "sebenarnya"]));
  const nums = extractNumbers(text);
  const topics = extractTopic(text, langKey);
  const contrast = extractContrastParts(text);
  const num = nums.length ? nums[0].full : "";
  const topic = topics[0] || "";
  const isQuestion = detectQuestion(text);
  const variants = [];
  const seen = new Set();

  const push = (strategy, str) => {
    const s = cleanText(str);
    if (!s) return;
    const key = s.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    variants.push({ strategy, text: s, type: strategy, sourceFidelity: true });
  };

  // MODE A — DIRECT: kalimat asli pembicara, dipertahankan verbatim.
  push("Direct", text);

  // MODE B — Editorial: hook ringkas yang diturunkan dari sumber.
  if (langKey === "en") {
    // CURIOSITY
    push("Curiosity", num ? `${capFirst(num)} — and not many know why` : `${capFirst(topic || clause)}: the answer isn't what you think`);
    // CONTRARIAN
    push("Contrarian", `Just the opposite of what you'd expect: ${clause}`);
    // QUESTION
    push("Question", isQuestion ? text : `Why ${clause}?`);
    // EMOTIONAL
    push("Emotional", `Honestly, this wasn't easy: ${clause}`);
    // STORY
    push("Story", `The story behind ${topic || "this"} nobody expected`);
  } else {
    push("Curiosity", num ? `${capFirst(num)} — dan gak banyak yang sadar kenapa` : `${capFirst(topic || clause)}: jawabannya nggak seperti yang kamu kira`);
    push("Contrarian", contrast ? `${capFirst(contrast.a)} bukan ${lowerFirst(contrast.b)} — padahal kebanyakan orang mengira sama` : `Justru kebalikannya dari yang kamu kira: ${clause}`);
    push("Question", isQuestion ? text : `Kenapa ${clause}?`);
    push("Emotional", `Jujur aja, ini bukan hal yang gampang: ${clause}`);
    push("Story", `Cerita ${topic || "ini"} yang nggak disangka-sangka`);
  }

  return variants;
}

// ---------------------------------------------------------------------------
// SEMANTIC DUPLICATE DETECTION — cluster kandidat yang maknanya mirip.
// Cores dihitung dari kata-kata NON-stopword agar "mengubah segalanya untuk
// saya" dan "benar-benar mengubah segalanya buat gue" dikenali kembar.
// ---------------------------------------------------------------------------
function contentWordsOf(sentence, lang) {
  const stop = (HOOK_WORDS[lang] && HOOK_WORDS[lang].stopwords) || [];
  const extraStop = ["ini", "itu", "saya", "aku", "gue", "gw", "kamu", "mereka", "kita", "kami", "my", "our", "their", "your", "his", "her", "its", "yang", "dan", "di", "ke", "dari", "untuk", "dengan", "pada", "the", "a", "an", "and", "to", "of", "in", "on", "for", "with", "at", "by", "is", "are", "was", "were"];
  return new Set(
    wordsOf(sentence || "").filter((w) => w.length > 2 && !stop.includes(w) && !extraStop.includes(w))
  );
}

function clusterDuplicates(candidates, lang) {
  const groups = [];
  for (const c of candidates) {
    const core = contentWordsOf(c.sentence, lang);
    let placed = false;
    for (const g of groups) {
      const gCore = g.core;
      const inter = [...core].filter((w) => gCore.has(w)).length;
      const union = new Set([...core, ...gCore]);
      const jac = union.size > 0 ? inter / union.size : 0;
      // Kembar bila: jaccard tinggi, ATAU berbagi >= 2 kata isi dengan kemiripan
      // sedang (mis. "mengubah segalanya" muncul di dua kalimat).
      const sharedPhrase = inter >= 2 && jac >= 0.3;
      if (jac >= 0.5 || sharedPhrase) {
        g.items.push(c);
        placed = true;
        break;
      }
    }
    if (!placed) groups.push({ core, items: [c] });
  }
  return groups.map((g) => ({
    items: g.items,
    best: g.items.slice().sort((a, b) => b.score - a.score || a.index - b.index)[0]
  }));
}

// ---------------------------------------------------------------------------
// SELECTION — evaluasi semua kalimat, pilih hook terbaik (boleh reorder).
// ---------------------------------------------------------------------------
function selectHook(sentences, lang, options) {
  const opts = options || {};
  const sents = (sentences || []).map((s) => cleanText(s)).filter(Boolean);
  if (!sents.length) {
    return { hook: "", score: 0, deepScore: 0, dimensions: {}, weights: DEEP_WEIGHTS, type: "CURIOSITY", intent: "curiosity", confidence: 0, originalHook: "", recommendedHook: "", reordered: false, coldOpen: false, coldOpenStartIndex: -1, candidates: [], alternatives: [], variants: [], explanation: "", mode: "direct", payoff: { confidence: 0, fulfilled: false, payoffSentence: "" }, contextIndependent: false };
  }

  const candidates = [];
  for (let i = 0; i < sents.length; i++) {
    const s = sents[i];
    const r = scoreHook(s, lang, { index: i, sentences: sents });
    if (r.excluded) {
      candidates.push({ sentence: s, index: i, score: 0, deep: 0, excluded: true, reason: r.reason });
      continue;
    }
    const type = classifyHookType(s, lang);
    candidates.push({
      sentence: s,
      index: i,
      score: r.score,
      deep: r.deep,
      excluded: false,
      reason: "ok",
      type,
      intent: hookIntent(type, s, lang),
      evidence: r.evidence,
      dimensions: r.dimensions,
      penalties: r.penalties
    });
  }

  // Semantic dedup: kandidat yang maknanya mirip dikelompokkan; hanya yang
  // terbaik per cluster yang jadi pesaing (anti "Ini mengubah semuanya" x3).
  const clusters = clusterDuplicates(candidates.filter((c) => !c.excluded), lang);
  const unique = clusters.map((g) => g.best);
  const rankScore = (c) => (c ? (c.deep || c.score) : 0);
  const viable = unique.slice().sort((a, b) => rankScore(b) - rankScore(a) || a.index - b.index);
  const best = viable[0] || null;

  // Selection: pilih kandidat terbaik dengan skor layak. Bila tidak ada yang
  // layak: pakai kalimat pertama HANYA bila tidak tereksklusi (pembuka/sapaan).
  // Kalau pembuka cuma "Halo guys" → pilih kandidat viable terkuat, bukan
  // sapaan (source fidelity > reorder, tapi isi > sapaan kosong).
  let chosen = best && rankScore(best) >= 40 ? best : null;
  if (!chosen) {
    const first = candidates.find((c) => c.index === 0);
    const topViable = viable[0] || null;
    chosen = first && !first.excluded ? first : (topViable || first || candidates[0]);
  }

  // Reorder hanya aman bila: kandidat terbaik BUKAN kalimat pertama, dan tidak
  // bergantung pada konteks sebelumnya (pronoun tanpa antecedent).
  const pronounNoAnte = chosen && chosen.penalties && chosen.penalties.pronounNoAntecedent > 0;
  const firstCandidate = candidates.find((c) => c.index === 0);
  const reordered = !!best && best.index > 0 && rankScore(best) >= 40 && !pronounNoAnte && rankScore(best) > rankScore(firstCandidate) + 5;

  if (reordered) chosen = best;

  const sentence = chosen.sentence;
  const type = classifyHookType(sentence, lang);
  const intent = hookIntent(type, sentence, lang);
  const norm = normalizeHook(sentence, lang, { stripContextPronoun: reordered });
  // recommendedHook = hook VIRAL yang dikarang ulang dari kata/fakta sumber,
  // BUKAN minimal-edit caption asli. hasil asli tetap tersedia di `hook`.
  const crafted = craftViralHook(sentence, sents, lang);

  // Confidence: gap terhadap kandidat kedua + skor absolut.
  const secondBest = viable.filter((c) => c !== best).sort((a, b) => rankScore(b) - rankScore(a))[0] || null;
  const gap = best && secondBest ? Math.max(0, rankScore(best) - rankScore(secondBest)) : (best ? 10 : 0);
  const confidence = Math.max(0, Math.min(100, Math.round(rankScore(best) * 0.5 + gap * 3 + 10)));

  const payoff = validatePayoff(sentence, sents, lang);

  const contextIndependent = !(chosen.penalties && (chosen.penalties.deictic > 0 || chosen.penalties.pronounNoAntecedent > 0));

  // MODE A/B: DIRECT bila kalimat asli sudah terkuat, EDITORIAL bila dikarang
  // ulang. Kedua varian tetap tersedia di `alternatives`.
  const mode = crafted.text === sentence || (norm.level === 0 && crafted.text === norm.text) ? "direct" : "editorial";

  // Variation engine — strategi berbeda, source-faithful.
  const variants = buildVariants(sentence, sents, lang);
  const alternatives = variants.slice(0, 6);

  const deepResult = {
    dimensions: chosen.dimensions || {},
    deep: rankScore(chosen),
    weights: DEEP_WEIGHTS
  };
  const explanation = explainHook(sentence, deepResult, type, payoff, lang);

  // Cold open: hook terkuat bukan pembuka clip → rekomendasi mulai di sana.
  const coldOpen = reordered && chosen.index > 0;

  // Length/platform intelligence: target kata per platform (tidak memotong
  // kalimat; hanya memandu varian pendek).
  const platform = opts.platform || "generic";
  const lengthTargets = { tiktok: 6, reels: 6, shorts: 7, generic: 9 };
  const lengthTarget = lengthTargets[platform] || 9;

  return {
    hook: sentence,
    score: chosen.score,
    deepScore: rankScore(chosen),
    dimensions: chosen.dimensions || {},
    weights: DEEP_WEIGHTS,
    type,
    intent,
    confidence,
    originalHook: sentence,
    recommendedHook: crafted.text,
    craftPattern: crafted.pattern,
    normalizeLevel: norm.level,
    mode,
    reordered,
    coldOpen,
    coldOpenStartIndex: coldOpen ? chosen.index : -1,
    lengthTarget,
    platform,
    explanation,
    alternatives,
    variants,
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
  craftViralHook,
  selectHook,
  diversifyHooks,
  DEEP_WEIGHTS,
  dimensionScores,
  explainHook,
  buildVariants,
  clusterDuplicates,
  helpers: {
    detectQuestion,
    detectParallelStructure,
    detectResultFirst,
    openerCategory,
    startsWithFiller,
    wordsOf,
    extractNumbers,
    extractTopic,
    extractContrastParts
  }
};
