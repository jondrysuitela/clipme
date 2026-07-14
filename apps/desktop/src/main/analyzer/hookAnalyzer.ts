import type { ClipCandidate, TranscriptSegment } from "../../shared/types";
import { createId } from "../utils/ids";

const STRONG_WORDS = ["rahasia", "masalah", "kenapa", "ternyata", "jangan", "cara", "gagal", "viral", "uang", "penting"];
const EMOTION_WORDS = ["takut", "senang", "marah", "sedih", "kaget", "aneh", "gila", "parah", "bahaya", "mahal", "murah"];
const ACTION_WORDS = ["coba", "pakai", "buat", "bikin", "jual", "belajar", "mulai", "stop", "hindari", "ubah"];
const CONTRAST_WORDS = ["tapi", "padahal", "bukan", "ternyata", "malah", "sementara"];
const TITLE_POWER_WORDS = ["ternyata", "jangan", "kenapa", "rahasia", "gagal", "penting", "masalah", "viral", "bukan", "harus"];
const FILLER_PREFIXES = [
  "jadi",
  "nah",
  "oke",
  "ok",
  "terus",
  "lalu",
  "dan",
  "tapi",
  "kalau",
  "kalo",
  "sebenarnya",
  "sebenernya",
  "intinya"
];
const MIN_HOOK_DURATION = 24;
const DEFAULT_TARGET_HOOK_DURATION = 52;
const MAX_HOOK_DURATION = 88;

export interface HookVideoContext {
  title?: string;
  uploader?: string;
  description?: string;
  tags?: string[];
  categories?: string[];
}

export function analyzeHooks(projectId: string, segments: TranscriptSegment[]): ClipCandidate[] {
  const candidates = segments.map((segment, index) => {
    const window = buildWindow(segments, index);
    const text = window.map((item) => item.text).join(" ");
    const rawStart = window[0]?.start ?? segment.start;
    const rawEnd = window[window.length - 1]?.end ?? segment.end;
    const startTime = Math.max(0, rawStart - 1.5);
    const endTime = rawEnd + 2.5;
    const duration = Math.max(0, endTime - startTime);
    const score = scoreText(text, duration, startTime);

    return {
      id: createId(10),
      projectId,
      title: makeHookTitle(text, index),
      startTime,
      endTime,
      duration,
      hookScore: score,
      reason: makeReason(text, score, duration),
      suggestedCaption: makeViralCaption(text, index, score),
      hashtags: makeTranscriptHashtags(text)
    };
  });

  const rankedCandidates = candidates
    .filter((clip) => clip.duration >= MIN_HOOK_DURATION * 0.75)
    .sort((a, b) => b.hookScore - a.hookScore || a.startTime - b.startTime);
  return finalizeCandidates(diversifyCandidates(rankedCandidates, 10));
}

export function generateTimedHookCandidates(projectId: string, durationSeconds: number, context: HookVideoContext = {}): ClipCandidate[] {
  const duration = Math.max(0, durationSeconds);
  if (duration <= 0) return [];

  const durations = pickTimedClipDurations(duration);
  const longestClip = Math.max(...durations);
  const maxStart = Math.max(0, duration - longestClip);
  const count = Math.min(10, Math.max(1, Math.floor(duration / Math.max(longestClip * 0.9, 1))));
  const starts = Array.from({ length: count }, (_, index) => {
    if (count === 1) return 0;
    return Math.round((maxStart * index) / (count - 1));
  });

  return starts.map((startTime, index) => {
    const clipDuration = durations[index % durations.length];
    const endTime = Math.min(duration, startTime + clipDuration + bufferForDuration(clipDuration));
    const clipLength = endTime - startTime;
    const score = scoreByPosition(index, count, startTime, duration);
    const profile = hookProfile(index, count, startTime, duration, context);
    return {
      id: createId(10),
      projectId,
      title: makeTimedHookTitle(profile, index, count, startTime, duration, context),
      startTime,
      endTime,
      duration: clipLength,
      hookScore: score,
      reason: `${profile.reason} Window ${Math.round(clipLength)}s dipilih sebagai titik potensi viral dengan buffer start/end agar cut terasa utuh.`,
      suggestedCaption: makeTimedCaption(profile, index, count, startTime, duration, context),
      hashtags: profile.hashtags
    };
  }).map((clip, index, clips) => {
    const unique = finalizeCandidates(clips);
    return unique[index];
  });
}

function buildWindow(segments: TranscriptSegment[], startIndex: number) {
  const picked: TranscriptSegment[] = [];
  const targetDuration = targetDurationForSegment(segments[startIndex]);
  for (let index = startIndex; index < segments.length; index += 1) {
    picked.push(segments[index]);
    const duration = picked[picked.length - 1].end - picked[0].start;
    const text = picked.map((item) => item.text).join(" ");
    if (duration >= MIN_HOOK_DURATION && isNaturalEnding(text)) break;
    if (duration >= targetDuration || duration >= MAX_HOOK_DURATION) break;
  }
  return picked;
}

function targetDurationForSegment(segment?: TranscriptSegment) {
  const textLength = segment?.text.length ?? 0;
  if (textLength < 80) return 34;
  if (textLength > 220) return 68;
  return DEFAULT_TARGET_HOOK_DURATION;
}

function pickTimedClipDurations(videoDuration: number) {
  if (videoDuration <= 35) return [videoDuration];
  if (videoDuration <= 90) return [42, 48, 54].map((value) => Math.min(value, videoDuration * 0.82));
  if (videoDuration <= 240) return [48, 54, 58, 62];
  if (videoDuration <= 900) return [52, 56, 60, 64];
  return [54, 58, 60, 62, 66];
}

function bufferForDuration(clipDuration: number) {
  if (clipDuration < 50) return 2;
  if (clipDuration < 62) return 3;
  return 4;
}

function isNaturalEnding(text: string) {
  const clean = text.trim();
  if (/[.!?)]$/.test(clean)) return true;
  const lower = clean.toLowerCase();
  return ["jadi", "nah", "makanya", "intinya", "akhirnya", "kesimpulannya"].some((word) => lower.endsWith(word));
}

function scoreText(text: string, duration = DEFAULT_TARGET_HOOK_DURATION, startTime = 0) {
  const lower = text.toLowerCase();
  let score = 32;
  const matchedStrong = countMatches(lower, STRONG_WORDS);
  const matchedEmotion = countMatches(lower, EMOTION_WORDS);
  const matchedAction = countMatches(lower, ACTION_WORDS);
  const matchedContrast = countMatches(lower, CONTRAST_WORDS);
  if (text.includes("?")) score += 18;
  score += Math.min(26, matchedStrong * 7);
  score += Math.min(14, matchedEmotion * 5);
  score += Math.min(12, matchedAction * 4);
  score += Math.min(12, matchedContrast * 4);
  if (/\b\d+([.,]\d+)?\b/.test(text)) score += 10;
  if (/\b(kamu|anda|lo|lu|gue|gua|kita)\b/i.test(text)) score += 6;
  if (duration >= 28 && duration <= 72) score += 9;
  else if (duration > 88) score -= 8;
  if (startTime <= 90) score += 4;
  if (lower.includes("mock") || lower.includes("pipeline")) score += 6;
  if (lower.length > 120 && lower.length < 520) score += 5;
  return Math.max(0, Math.min(100, score));
}

function makeHookTitle(text: string, index: number) {
  const clean = normalizeTitleSource(text);
  if (!clean) return `Hook Paling Menarik #${index + 1}`;

  const sentence = pickBestHookSentence(clean);
  return clampTitle(headlineFromSentence(sentence, index));
}

function makeReason(text: string, score: number, duration: number) {
  const lower = text.toLowerCase();
  const matched = STRONG_WORDS.filter((word) => lower.includes(word));
  const signals = [];
  if (matched.length > 0) signals.push(`kata hook: ${matched.slice(0, 3).join(", ")}`);
  if (text.includes("?")) signals.push("pola pertanyaan");
  if (CONTRAST_WORDS.some((word) => lower.includes(word))) signals.push("kontras/turning point");
  if (/\b\d+([.,]\d+)?\b/.test(text)) signals.push("angka spesifik");
  if (duration >= 28 && duration <= 72) signals.push("durasi ideal short clip");
  return `${signals.length ? signals.join(", ") : "density transkrip cukup kuat"}. Score ${score}.`;
}

function diversifyCandidates(candidates: ClipCandidate[], limit: number) {
  const picked: ClipCandidate[] = [];
  for (const candidate of candidates) {
    const overlapsExisting = picked.some((clip) => overlapRatio(clip, candidate) > 0.45 || Math.abs(clip.startTime - candidate.startTime) < 18);
    if (!overlapsExisting) picked.push(candidate);
    if (picked.length >= limit) return picked;
  }
  for (const candidate of candidates) {
    if (!picked.some((clip) => clip.id === candidate.id)) picked.push(candidate);
    if (picked.length >= limit) break;
  }
  return picked;
}

function overlapRatio(a: ClipCandidate, b: ClipCandidate) {
  const overlap = Math.max(0, Math.min(a.endTime, b.endTime) - Math.max(a.startTime, b.startTime));
  const shortest = Math.max(0.1, Math.min(a.duration, b.duration));
  return overlap / shortest;
}

function countMatches(text: string, words: string[]) {
  return words.reduce((count, word) => count + (text.includes(word) ? 1 : 0), 0);
}

function makeSuggestedCaption(text: string) {
  const clean = normalizeTitleSource(text);
  if (clean.length <= 180) return clean;
  const sliced = clean.slice(0, 180);
  const lastSpace = sliced.lastIndexOf(" ");
  return `${sliced.slice(0, lastSpace > 120 ? lastSpace : 177).trim()}...`;
}

function makeViralCaption(text: string, index: number, score: number) {
  const clean = normalizeTitleSource(text);
  const sentence = pickBestHookSentence(clean);
  const subject = extractSubjectPhrase(sentence);
  const lower = clean.toLowerCase();
  const directQuote = makeSuggestedCaption(sentence);
  const templates = [];

  if (clean.includes("?") || lower.includes("kenapa")) {
    templates.push(
      `Kenapa ${subject.toLowerCase()}? Jawabannya sering kelewat.`,
      `Pertanyaan kecil ini bisa ngubah cara kamu lihat ${subject.toLowerCase()}.`
    );
  }
  if (CONTRAST_WORDS.some((word) => lower.includes(word))) {
    templates.push(
      `Bukan cuma soal ${subject.toLowerCase()}, ada twist yang jarang dibahas.`,
      `Awalnya terlihat biasa, tapi bagian ini yang bikin konteksnya kebalik.`
    );
  }
  if (/\b\d+([.,]\d+)?\b/.test(clean)) {
    templates.push(
      `Angka di bagian ini penting banget buat dipahami.`,
      `Simpan bagian ini kalau kamu suka insight yang konkret.`
    );
  }
  if (ACTION_WORDS.some((word) => lower.includes(word))) {
    templates.push(
      `Coba perhatikan langkah ini sebelum kamu mulai.`,
      `Ini bagian praktis yang paling gampang langsung diterapkan.`
    );
  }
  if (STRONG_WORDS.some((word) => lower.includes(word)) || score >= 80) {
    templates.push(
      `Bagian ini punya hook kuat: ${directQuote}`,
      `Kalau cuma nonton satu bagian, mulai dari sini.`
    );
  }

  templates.push(
    directQuote,
    `Yang sering dilewatkan orang: ${subject}.`,
    `Ini potongan yang paling cocok jadi pembuka diskusi.`,
    `Kalau kamu bikin konten pendek, angle ini layak dicoba.`
  );

  return clampCaption(templates[index % templates.length]);
}

function makeTimedCaption(
  profile: ReturnType<typeof hookProfile>,
  index: number,
  count: number,
  startTime: number,
  duration: number,
  context: HookVideoContext
) {
  const topic = makeTopic(context);
  const progress = duration > 0 ? startTime / duration : 0;
  const angle = pickTimelineAngle(index, count, progress);
  const templates: Record<TimelineAngle, string[]> = {
    opening: [
      `Pembuka dari "${topic}" ini cocok buat narik perhatian sejak detik awal.`,
      `Start dari sini kalau kamu mau penonton langsung paham konteksnya.`
    ],
    promise: [
      `Bagian ini mulai nunjukin janji utama dari "${topic}".`,
      `Ini setup yang bikin penonton punya alasan buat lanjut nonton.`
    ],
    problem: [
      `Masalah di "${topic}" mulai kelihatan jelas di bagian ini.`,
      `Hook ini kuat karena langsung masuk ke problem yang terasa.`
    ],
    tension: [
      `Di sini tensinya mulai naik dan cocok jadi potongan short.`,
      `Bagian ini punya konflik yang enak buat dijadikan teaser.`
    ],
    proof: [
      `Bukti atau contoh di bagian ini bikin clip terasa lebih meyakinkan.`,
      `Potongan ini cocok buat penonton yang butuh alasan konkret.`
    ],
    turn: [
      `Ada perubahan arah di bagian ini yang bisa bikin orang penasaran.`,
      `Twist kecilnya ada di sini, pas buat bikin penonton berhenti scroll.`
    ],
    payoff: [
      `Payoff dari "${topic}" terasa paling kuat di bagian ini.`,
      `Ini bagian yang paling siap jadi highlight utama.`
    ],
    surprise: [
      `Bagian ini punya surprise yang bisa jadi caption pemancing komentar.`,
      `Kalau mau angle yang bikin penasaran, potongan ini paling masuk.`
    ],
    recap: [
      `Bagian ini merangkum inti "${topic}" dengan cukup padat.`,
      `Cocok jadi clip singkat buat orang yang butuh takeaway cepat.`
    ],
    closing: [
      `Closing ini cocok buat punchline atau kesimpulan short clip.`,
      `Bagian akhir ini bisa jadi clip yang terasa selesai dan utuh.`
    ]
  };
  const options = templates[angle] ?? [profile.caption];
  return clampCaption(options[index % options.length]);
}

function clampCaption(caption: string) {
  const clean = normalizeTitleSource(caption);
  if (clean.length <= 180) return clean;
  const sliced = clean.slice(0, 180);
  const lastSpace = sliced.lastIndexOf(" ");
  return `${sliced.slice(0, lastSpace > 120 ? lastSpace : 177).trim()}...`;
}

function makeTranscriptHashtags(text: string) {
  const lower = text.toLowerCase();
  const tags = ["#shorts", "#clipme"];
  if (lower.includes("bisnis") || lower.includes("jual") || lower.includes("uang")) tags.push("#Bisnis");
  if (lower.includes("konten") || lower.includes("video") || lower.includes("kreator")) tags.push("#ContentCreator");
  if (lower.includes("belajar") || lower.includes("cara") || lower.includes("tips")) tags.push("#Tips");
  if (lower.includes("viral")) tags.push("#Viral");
  tags.push("#fyp");
  return tags.filter((tag, index, values) => values.indexOf(tag) === index).slice(0, 6);
}

function scoreByPosition(index: number, count: number, startTime: number, duration: number) {
  const progress = duration > 0 ? startTime / duration : 0;
  let score = 72 - index * 3;
  if (progress > 0.08 && progress < 0.45) score += 12;
  if (progress >= 0.45 && progress < 0.75) score += 6;
  return Math.max(45, Math.min(92, score));
}

function hookProfile(index: number, count: number, startTime: number, duration: number, context: HookVideoContext) {
  const progress = duration > 0 ? startTime / duration : 0;
  const topic = makeTopic(context);
  const hashtags = makeContextHashtags(context);
  const bucket =
    index === 0 || progress < 0.08
      ? "opening"
      : progress < 0.32
        ? "early"
        : progress < 0.62
          ? "middle"
          : progress < 0.84
            ? "payoff"
            : "ending";

  const profiles = {
    opening: {
      title: "Opening Hook",
      reason: `Dipilih dari awal video "${topic}" untuk menangkap setup, janji cerita, atau statement pembuka.`,
      caption: `Pembuka dari "${topic}" yang paling cocok jadi pemancing rasa penasaran.`,
      hashtags: ["#opening", "#hook", ...hashtags]
    },
    early: {
      title: "Momentum Hook",
      reason: `Dipilih saat video "${topic}" mulai masuk ke poin utama setelah intro.`,
      caption: `Momen awal "${topic}" yang mulai masuk ke inti dan cocok buat nahan penonton.`,
      hashtags: ["#momentum", "#hook", ...hashtags]
    },
    middle: {
      title: "Mid Story Hook",
      reason: `Dipilih dari tengah video "${topic}" untuk mencari momen cerita, contoh, atau konflik.`,
      caption: `Potongan "${topic}" ini punya konteks cukup untuk berdiri sendiri sebagai short clip.`,
      hashtags: ["#storyhook", "#highlight", ...hashtags]
    },
    payoff: {
      title: "Payoff Hook",
      reason: `Dipilih dekat bagian payoff video "${topic}", biasanya berisi jawaban, reaksi, atau momen penting.`,
      caption: `Highlight "${topic}" yang terasa seperti payoff dari video panjang.`,
      hashtags: ["#payoff", "#highlight", ...hashtags]
    },
    ending: {
      title: "Closing Hook",
      reason: `Dipilih dari bagian akhir video "${topic}" untuk menangkap kesimpulan atau punchline.`,
      caption: `Bagian akhir "${topic}" yang bisa terasa seperti kesimpulan atau punchline.`,
      hashtags: ["#closing", "#punchline", ...hashtags]
    }
  };

  return profiles[bucket] ?? profiles.middle;
}

function makeTimedHookTitle(
  profile: ReturnType<typeof hookProfile>,
  index: number,
  count: number,
  startTime: number,
  duration: number,
  context: HookVideoContext
) {
  const source = [context.title, context.description, ...(context.tags ?? [])].filter(Boolean).join(". ");
  if (!source.trim()) return clampTitle(`${profile.title} ${index + 1}`);

  const phrases = extractTitlePhrases(source);
  const phrase = phrases[index % Math.max(1, phrases.length)] ?? makeTopic(context);
  const progress = duration > 0 ? startTime / duration : 0;
  const title = timedHeadlineFromPhrase(phrase, index, count, progress);
  return clampTitle(title || phrase || profile.title);
}

type TimelineAngle = "opening" | "promise" | "problem" | "tension" | "proof" | "turn" | "payoff" | "surprise" | "recap" | "closing";

function pickTimelineAngle(index: number, count: number, progress: number): TimelineAngle {
  if (count >= 9) {
    return ["opening", "promise", "problem", "tension", "proof", "turn", "payoff", "surprise", "recap", "closing"][index] as TimelineAngle;
  }
  if (index === 0 || progress < 0.08) return "opening";
  if (progress < 0.2) return "promise";
  if (progress < 0.35) return "problem";
  if (progress < 0.5) return "tension";
  if (progress < 0.65) return "proof";
  if (progress < 0.78) return "payoff";
  if (progress < 0.9) return "recap";
  return "closing";
}

function headlineFromSentence(sentence: string, index: number) {
  const clean = stripFiller(sentence);
  const lower = clean.toLowerCase();
  const compact = compactTopic(clean);
  const subject = extractSubjectPhrase(clean);

  if (clean.includes("?")) return clean;
  if (/^jangan\b/i.test(clean)) return clean;
  if (/^kenapa\b/i.test(clean)) return clean.endsWith("?") ? clean : `${clean}?`;
  if (/^ternyata\b/i.test(clean)) return clean;
  if (/^cara\b/i.test(clean)) return clean;
  if (lower.includes("bukan") && lower.includes("tapi")) return compact;
  if (lower.includes("ternyata")) return `Ternyata ${subject}`;
  if (lower.includes("jangan")) return `Jangan ${subject}`;
  if (lower.includes("kenapa")) return `Kenapa ${subject}?`;
  if (lower.includes("rahasia")) return `Rahasia ${subject}`;
  if (lower.includes("gagal")) return `${subject} Bisa Gagal Karena Ini`;
  if (lower.includes("masalah")) return `Masalahnya Ada di ${subject}`;
  if (/\b\d+([.,]\d+)?\b/.test(clean)) return `${subject} dalam Angka`;

  const variants = [
    subject,
    compact,
    `${subject}?`,
    `Yang Orang Sering Lewatkan: ${subject}`
  ];
  return variants[index % variants.length];
}

function timedHeadlineFromPhrase(phrase: string, index: number, count: number, progress: number) {
  const clean = stripFiller(phrase);
  const subject = extractSubjectPhrase(clean);
  const angle = pickTimelineAngle(index, count, progress);
  if (angle === "opening" || angle === "promise") return subject;
  if (angle === "problem" || angle === "tension") return subject.includes("?") ? subject : `${subject}?`;
  if (angle === "proof") return `Buktinya: ${subject}`;
  if (angle === "turn" || angle === "surprise") return `Ternyata ${subject}`;
  if (angle === "payoff") return `Jawabannya Ada di ${subject}`;
  if (angle === "recap") return `Intinya: ${subject}`;
  return subject;
}

function normalizeTitleSource(text: string) {
  return text.replace(/\s+/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
}

function stripFiller(text: string) {
  let clean = normalizeTitleSource(text);
  for (const filler of FILLER_PREFIXES) {
    clean = clean.replace(new RegExp(`^${filler}[,\\s:-]+`, "i"), "");
  }
  return clean.trim();
}

function pickBestHookSentence(text: string) {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (sentences.length === 0) return text;
  return sentences
    .map((sentence, index) => ({ sentence, score: scoreTitleSentence(sentence, index) }))
    .sort((a, b) => b.score - a.score)[0].sentence;
}

function scoreTitleSentence(sentence: string, index: number) {
  const lower = sentence.toLowerCase();
  let score = 60 - index * 4;
  if (sentence.includes("?")) score += 24;
  if (/\b\d+([.,]\d+)?\b/.test(sentence)) score += 12;
  for (const word of TITLE_POWER_WORDS) {
    if (lower.includes(word)) score += 10;
  }
  if (sentence.length >= 35 && sentence.length <= 120) score += 8;
  return score;
}

function compactTopic(text: string) {
  const clean = stripFiller(text).replace(/^ini\s+/i, "").trim();
  const words = clean.split(/\s+/).filter(Boolean);
  const compact = words.slice(0, 8).join(" ");
  return compact || "Video Ini";
}

function extractSubjectPhrase(text: string) {
  const clean = stripFiller(text)
    .replace(/^(aku|saya|gue|gua|kita|kami)\s+/i, "")
    .replace(/^(ini|itu)\s+/i, "")
    .trim();
  const clauses = clean
    .split(/\s+(?:karena|tapi|dan|atau|yang|buat|untuk|supaya)\s+/i)
    .map((item) => item.trim())
    .filter(Boolean);
  const picked = clauses.find((item) => item.split(/\s+/).length >= 3) ?? clauses[0] ?? clean;
  return compactTopic(picked);
}

function extractTitlePhrases(source: string) {
  const sentences = normalizeTitleSource(source)
    .split(/(?<=[.!?])\s+|[|]/)
    .map(stripFiller)
    .filter((item) => item.length >= 12);
  const phrases = sentences.flatMap((sentence) => {
    const subject = extractSubjectPhrase(sentence);
    const compact = compactTopic(sentence);
    return [subject, compact];
  });
  return phrases
    .map((item) => item.replace(/^#/, "").trim())
    .filter((item) => item.length >= 8)
    .filter((item, index, values) => values.findIndex((value) => value.toLowerCase() === item.toLowerCase()) === index)
    .slice(0, 12);
}

function clampTitle(title: string) {
  const clean = normalizeTitleSource(title);
  return clean.length > 76 ? `${clean.slice(0, 73).trim()}...` : clean;
}

function ensureUniqueTitles(clips: ClipCandidate[]) {
  const seen = new Map<string, number>();
  return clips.map((clip) => {
    const key = clip.title.toLowerCase();
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    if (count === 0) return clip;
    const suffix = titleSuffix(count);
    return { ...clip, title: clampTitleWithSuffix(clip.title, suffix) };
  });
}

function finalizeCandidates(clips: ClipCandidate[]) {
  return ensureUniqueCaptions(ensureUniqueTitles(clips));
}

function ensureUniqueCaptions(clips: ClipCandidate[]) {
  const seen = new Map<string, number>();
  return clips.map((clip) => {
    const key = clip.suggestedCaption.toLowerCase();
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    if (count === 0) return clip;
    const suffixes = [
      "Angle lain: simpan bagian ini buat pembuka yang lebih tajam.",
      "Versi pendeknya: ini bagian yang paling enak buat bikin orang berhenti scroll.",
      "Hook alternatif: potongan ini punya konteks yang cukup buat berdiri sendiri.",
      "Caption cadangan: bagian ini cocok buat ngetes angle berbeda."
    ];
    return { ...clip, suggestedCaption: clampCaption(suffixes[Math.min(count - 1, suffixes.length - 1)]) };
  });
}

function clampTitleWithSuffix(title: string, suffix: string) {
  const suffixText = ` (${suffix})`;
  const maxBaseLength = Math.max(1, 76 - suffixText.length);
  const base = normalizeTitleSource(title);
  const clampedBase = base.length > maxBaseLength ? `${base.slice(0, Math.max(1, maxBaseLength - 3)).trim()}...` : base;
  return `${clampedBase}${suffixText}`;
}

function titleSuffix(index: number) {
  return ["Angle Baru", "Versi Tengah", "Payoff", "Closing"][Math.min(index - 1, 3)];
}

function makeTopic(context: HookVideoContext) {
  const title = context.title?.replace(/\s+/g, " ").trim();
  if (title) return title.length > 70 ? `${title.slice(0, 67)}...` : title;
  return context.categories?.[0] ?? "video ini";
}

function makeContextHashtags(context: HookVideoContext) {
  const source = [
    ...(context.tags ?? []),
    ...(context.categories ?? []),
    context.uploader
  ].filter(Boolean) as string[];
  const picked = source
    .map(toHashtag)
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 4);
  return [...picked, "#shorts", "#fyp"].slice(0, 6);
}

function toHashtag(value: string) {
  const clean = value
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, "")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return clean ? `#${clean}` : "";
}
