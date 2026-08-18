// CLIPME Auto Caption Engine
// Spec: Auto Caption System Prompt Implementation
// Version: 1.0.0
// Author: Auto Caption Engine Team

const fs = require('fs');
const path = require('path');

// Load the system prompt
function loadClipmeCaptionPrompt() {
  try {
    const promptModule = require('./clipme-caption-prompt.js');
    return promptModule.default || promptModule;
  } catch (e) {
    console.error('Gagal memuat clipme-caption-prompt.js:', e.message);
    return '';
  }
}

// Load the shared hook engine (single source of truth for hook intelligence).
function loadClipmeHookEngine() {
  try {
    const engine = require('./clipme-hook-engine.js');
    return engine;
  } catch (e) {
    console.error('Gagal memuat clipme-hook-engine.js:', e.message);
    return null;
  }
}

const hookEngine = loadClipmeHookEngine();

const CLAUSE_CONJUNCTIONS = new Set([
  'dan', 'atau', 'karena', 'tetapi', 'namun', 'kalau', 'jika', 'sehingga',
  'yang', 'agar', 'supaya', 'tapi', 'sedangkan', 'sementara', 'maka',
  'untuk', 'serta', 'bahwa', 'ketika', 'setelah', 'sebelum', 'supaya'
]);

const NUMBER_UNITS = new Set([
  'juta', 'ribu', 'miliar', 'milyar', 'triliun', 'persen', '%', 'hari',
  'jam', 'menit', 'detik', 'tahun', 'bulan', 'minggu', 'buah', 'orang',
  'kali', 'rupiah', 'rb', 'sen', 'dolar', 'euro', 'kg', 'gram', 'liter'
]);

function isNumberToken(token) {
  return /^\d+([.,]\d+)*%?$/.test(String(token || '').trim());
}

function isUnitToken(token) {
  return NUMBER_UNITS.has(String(token || '').trim().toLowerCase());
}

function isCapitalizedToken(token) {
  const t = String(token || '');
  return t.length > 1 && /[\p{Lu}]/u.test(t[0]) && !/[\p{N}]/u.test(t[0]);
}

// Common Indonesian sentence-starters / function words that are capitalized at
// sentence start but are NOT proper names. Prevents "Kalau", "Solusi",
// "Ternyata", "Saya" etc. from being flagged as emphasis "names".
const NAME_STOPLIST = new Set([
  'kalau', 'jadi', 'solusi', 'ternyata', 'tapi', 'saya', 'apalagi', 'walaupun',
  'maka', 'namun', 'sedangkan', 'sementara', 'padahal', 'untungnya', 'sayangnya',
  'oke', 'nah', 'terus', 'lalu', 'gitu', 'ini', 'itu', 'dia', 'kita', 'mereka',
  'kami', 'anda', 'kamu', 'gua', 'elu', 'bisa', 'mau', 'harus', 'sudah', 'belum',
  'dengan', 'tanpa', 'dari', 'kepada', 'bukan', 'tidak', 'juga', 'hanya', 'saja',
  'paling', 'sangat', 'benar', 'memang', 'emang', 'justru', 'sebenarnya',
  'mungkin', 'seperti', 'begitu', 'bilang', 'kata', 'cuma', 'nih', 'tuh',
  'maunya', 'sekali', 'banget', 'mau', 'nggak', 'tidak', 'pakai', 'pak',
  'yang', 'agar', 'supaya', 'ketika', 'setelah', 'sebelum', 'biar', 'pertama',
  'kedua', 'ketiga', 'selanjutnya', 'akhirnya', 'intinya', 'pokoknya', 'gue',
  'gw', 'lo', 'lu', 'dong', 'kok', 'kan', 'deh', 'soalnya', 'tentang',
  'sebagai', 'menurut', 'tapi'
]);

// CapCut-like two-line layout: balanced, clause-aware, orphan-preventing,
// keeps number+unit and proper-name units together. Falls back to a greedy
// fill when no balanced break fits within the length constraints.
function layoutCaptionLines(words, maxLines, maxLineLength) {
  const tokens = (words || [])
    .map((w) => String(w && w.text != null ? w.text : w).trim())
    .filter(Boolean);
  if (!tokens.length) return [];
  const joined = tokens.join(' ');
  const maxLen = Math.max(1, Number(maxLineLength) || 40);
  const maxL = Math.max(1, Number(maxLines) || 2);
  if (joined.length <= maxLen) return [joined];
  if (maxL === 1) return [joined];

  const endsWithClause = (t) => /[,.;:…?!]$/.test(String(t || ''));
  const startsConjunction = (t) => CLAUSE_CONJUNCTIONS.has(String(t || '').trim().toLowerCase());

  const n = tokens.length;
  let best = { score: -Infinity, k: -1 };
  for (let k = 1; k < n; k++) {
    const left = tokens.slice(0, k);
    const right = tokens.slice(k);
    const leftLen = left.join(' ').length;
    const rightLen = right.join(' ').length;
    if (leftLen > maxLen || rightLen > maxLen) continue;

    let score = 100 - Math.abs(leftLen - rightLen) * 5;

    // Prefer a break at a clause/punctuation/conjunction boundary.
    if (endsWithClause(tokens[k - 1]) || startsConjunction(tokens[k])) score += 15;

    // Avoid orphan single-word lines.
    if (left.length === 1 || right.length === 1) score -= 40;

    // Keep number+unit expressions together ("50 juta", "3 hari").
    if ((isNumberToken(tokens[k - 1]) && isUnitToken(tokens[k])) ||
        (isNumberToken(tokens[k]) && isUnitToken(tokens[k - 1]))) score -= 50;

    // Avoid splitting a proper-name pair ("Jondry Suitela").
    if (isCapitalizedToken(tokens[k - 1]) && isCapitalizedToken(tokens[k])) score -= 30;

    if (score > best.score) best = { score, k };
  }

  if (best.k > 0) {
    return [tokens.slice(0, best.k).join(' '), tokens.slice(best.k).join(' ')];
  }

  // Greedy fill fallback (matches previous behavior). Never emits more than
  // maxL lines: overflow beyond the last line folds into it.
  const lines = [];
  let current = '';
  let lineCount = 0;
  for (const t of tokens) {
    const test = current ? `${current} ${t}` : t;
    if (lineCount >= maxL - 1) {
      current = test;
      continue;
    }
    if (test.length > maxLen && current) {
      lines.push(current);
      lineCount++;
      current = t;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Auto Caption Engine Core
function AutoCaptionEngine(options = {}) {
  const config = {
    style: options.style || 'dynamic',
    fillerMode: options.fillerMode || 'none',
    maxLines: options.maxLines || 2,
    maxLineLength: options.maxLineLength || 40,
    emphasisThreshold: options.emphasisThreshold || 0.7,
    minSegmentDuration: options.minSegmentDuration || 1.2,
    maxSegmentDuration: options.maxSegmentDuration || 3.0,
    minWords: options.minWords || 3,
    maxWords: options.maxWords || 7,
    ...options
  };

  // System prompt for LLM
  const systemPrompt = loadClipmeCaptionPrompt();

  // Load OpenAI API key from environment
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
  const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  // Internal helper functions
  const helpers = {
    // Extract emphasis candidates from text
    extractEmphasisCandidates: (text) => {
      const lowerText = String(text || '').toLowerCase();
      const emphasisCandidates = [
        'ingin', 'butuh', 'perlu', 'harus', 'penting', 'utama', 'besar',
        'kunci', 'terakhir', 'pertama', 'sangat', 'benar-benar', 'harus',
        'cara', 'solusi', 'masalah', 'kesalahan', 'viral', 'trending', 'populer',
        'mengubah', 'merubah', 'membantu', 'mempermudah', 'bangkrut', 'gagal',
        'sial', 'hancur', 'berubah', 'jatuh', 'menang', 'berhasil',
        'paling', 'terbaik', 'terburuk', 'terbesar', 'mustahil', 'jangan',
        'tidak', 'meledak', 'panik', 'takut', 'bahagia', 'rahasia',
        'baru', 'misteri', 'kenapa', 'bagaimana', 'sebenarnya', 'justru',
        'terus', 'pertanyaan', 'jawaban', 'pentingnya', 'kuncinya', 'intinya'
      ];
      const found = [];
      for (const word of lowerText.split(/[^\p{L}\p{N}]+/u)) {
        if (word && emphasisCandidates.includes(word) && !found.includes(word)) {
          found.push(word);
        }
      }
      // Numeric expressions are emphasis-worthy ("50", "2026", "10 persen").
      const raw = String(text || '');
      const numberMatches = raw.match(/\d+(?:[.,]\d+)*\s*(?:juta|ribu|miliar|persen|%)?/gi) || [];
      for (const m of numberMatches) {
        const clean = m.trim().toLowerCase();
        if (clean && !found.includes(clean)) found.push(clean);
      }
      // Proper names (capitalized) are emphasis-worthy — but not sentence
      // starters / function words ("Kalau", "Saya", "Ternyata").
      const nameMatches = raw.match(/[\p{Lu}][\p{Ll}]{1,}(?:[\s-]+[\p{Lu}][\p{Ll}]{1,})*/gu) || [];
      for (const m of nameMatches) {
        let clean = m.trim();
        const ntokens = clean.split(/[\s-]+/);
        while (ntokens.length && NAME_STOPLIST.has(ntokens[0].toLowerCase())) ntokens.shift();
        clean = ntokens.join(' ');
        if (!clean || clean.length < 3) continue;
        if (!found.includes(clean.toLowerCase())) found.push(clean);
      }
      return found;
    },

    // Detect emotion from text
    detectEmotion: (text) => {
      const lowerText = text.toLowerCase();
      if (lowerText.includes('tidak') && (lowerText.includes('senang') || lowerText.includes('bahagia'))) {
        return 'mixed';
      }
      if (lowerText.includes('senang') || lowerText.includes('bahagia') || lowerText.includes('gembira')) {
        return 'happy';
      }
      if (lowerText.includes('marah') || lowerText.includes('kesal') || lowerText.includes('frustasi')) {
        return 'angry';
      }
      if (lowerText.includes('sedih') || lowerText.includes('kecewa') || lowerText.includes('putus asa')) {
        return 'sad';
      }
      if (lowerText.includes('kaget') || lowerText.includes('terkejut') || lowerText.includes('terkejut')) {
        return 'surprised';
      }
      return 'neutral';
    },

    // Check if word is filler
    isFillerWord: (word) => {
      const hesitation = ['um', 'uh', 'hmm', 'eh', 'eee', 'ehm', 'anu'];
      const conversational = [
        'jadi', 'kayak', 'basically', 'you know', 'i mean', 'so', 'well',
        'actually', 'literally', 'just', 'karena', 'lalu', 'terus', 'gitu',
        'aja', 'lah', 'kan', 'deh', 'nih', 'tuh', 'sih', 'ya', 'yuk'
      ];
      // Mode "none" = simpan SEMUA kata apa adanya (spec: keep every word).
      // Hesitation hanya dibuang di mode light/aggressive; kata conversational
      // hanya dibuang di aggressive.
      if (config.fillerMode === 'none') return false;
      const raw = String(word || '').toLowerCase().trim().replace(/\s+/g, ' ');
      const w = raw.replace(/[^\p{L}\p{N} ]+/gu, '').trim();
      if (!w) return false;
      if (hesitation.includes(w)) return true;
      if (config.fillerMode === 'aggressive' && conversational.includes(w)) return true;
      return false;
    },

    // Classify an inter-word pause as a segmentation signal.
    boundaryStrength: (gap) => {
      const g = Number(gap) || 0;
      if (g >= 0.7) return 'veryStrong';
      if (g >= 0.35) return 'strong';
      if (g >= 0.18) return 'medium';
      if (g >= 0.08) return 'weak';
      return 'none';
    },

    // Analyze speech rhythm: inter-word gaps, speech rate (words/sec,
    // chars/sec). Used for CapCut-like pause-driven segmentation.
    analyzeSpeechRhythm: (words) => {
      const w = words || [];
      const gaps = [];
      for (let i = 0; i < w.length - 1; i++) {
        const gap = (Number(w[i + 1]?.start) || 0) - (Number(w[i]?.end) || 0);
        gaps.push({ from: i, to: i + 1, gap, strength: helpers.boundaryStrength(gap) });
      }
      let duration = 0;
      if (w.length) duration = (Number(w[w.length - 1]?.end) || 0) - (Number(w[0]?.start) || 0);
      const totalChars = w.reduce((s, x) => s + String(x?.text || '').length, 0);
      return {
        gaps,
        duration,
        wordsPerSec: duration > 0 ? w.length / duration : 0,
        charsPerSec: duration > 0 ? totalChars / duration : 0
      };
    },

    // Calculate segment score based on quality metrics
    calculateSegmentScore: (segment, allWords) => {
      const score = {};
      
      // Semantic completeness (avoiding overly short segments)
      if (segment.text.split(' ').length < 2) score.wordCount = 0;
      else score.wordCount = Math.min(30, segment.text.split(' ').length * 8);
      
      // Time synchronization (penalaran jika terlalu awal/akhir)
      const timeVariance = Math.abs(segment.start - segment.end - 1.5); // Target ~1.5 seconds
      score.timeSync = Math.max(0, 30 - timeVariance * 2);
      
      // Emphasis quality
      score.emphasis = segment.emphasisWords ? Math.min(25, segment.emphasisWords.length * 8) : 0;
      
      // Readability (avoiding very long lines)
      const lineCount = segment.lines ? segment.lines.length : 1;
      score.readability = Math.max(0, 15 - lineCount * 5);
      
      // Speaker consistency
      const uniqueSpeakers = new Set(allWords.map(w => w.speaker_id)).size;
      score.speakerConsistency = Math.max(0, 10 - (uniqueSpeakers - 1) * 5);
      
      // Total score
      const total = Object.values(score).reduce((sum, val) => sum + val, 0);
      return { ...score, total };
    },

    // Build segment from words
    buildSegmentFromWords: (words, segmentId, allWords) => {
      if (words.length === 0) return null;
      
      const start = words[0].start;
      const end = words[words.length - 1].end;
      const text = words.map(w => w.text).join(' ');
      
      const emphasisCandidates = helpers.extractEmphasisCandidates(text);
      const emphasisWords = emphasisCandidates.slice(0, Math.min(3, emphasisCandidates.length));
      const emotion = helpers.detectEmotion(text);
      
      return {
        id: segmentId,
        speaker_id: words[0].speaker_id || "",
        start,
        end,
        text,
        words: words.map(w => ({ text: String(w.text || "").trim(), start: Number(w.start) || 0, end: Number(w.end) || 0, speaker_id: w.speaker_id || words[0].speaker_id || "" })),
        emphasis_words: emphasisWords,
        emotion,
        wordCount: words.length,
        lines: helpers.splitIntoLines(text, config.maxLines, config.maxLineLength)
      };
    },

    // Split text into lines respecting length constraints.
    // CapCut-like: balanced two-line layout, clause-aware, orphan-preventing.
    splitIntoLines: (text, maxLines, maxLineLength) => {
      return layoutCaptionLines(String(text || '').split(/\s+/), maxLines, maxLineLength);
    },

    // Determine if word should start a new segment
    shouldStartNewSegment: (word, previousWord, context) => {
      const wordText = String(word?.text ?? word ?? "");
      const prevText = String(previousWord?.text ?? previousWord ?? "");
      
      // Start new segment if previous word was emphasis and this word continues
      if (context.emphasisWords && context.emphasisWords.includes(prevText)) {
        return true;
      }
      
      // Start new segment if word is filler and fillerMode is aggressive
      if (config.fillerMode === 'aggressive' && helpers.isFillerWord(wordText)) {
        return true;
      }
      
      // Start new segment if word is question
      if (wordText.endsWith('?')) {
        return true;
      }
      
      // Start new segment if word starts with capital (beginning of sentence)
      if (wordText.length && wordText[0] === wordText[0].toUpperCase() && context.wordCount > 0) {
        return true;
      }
      
      return false;
    },

    // Determine if segment should end
    shouldEndSegment: (word, segmentWords, context) => {
      const wordText = String(word?.text ?? word ?? "");
      const segmentText = segmentWords.map((w) => String(w.text ?? w ?? "")).join(' ');
      const firstStart = Number(segmentWords[0]?.start ?? 0);
      const lastEnd = Number(word?.end ?? segmentWords[segmentWords.length - 1]?.end ?? 0);
      const segmentDuration = Math.max(0, lastEnd - firstStart);
      const gapToNext = Number(context?.gapToNext ?? 0);
      const strength = context?.boundaryStrength || helpers.boundaryStrength(gapToNext);
      const nextWordText = String(context?.nextWordText ?? "").trim();

      // 1. Hard caps: never exceed maxWords or maxSegmentDuration.
      if (segmentWords.length >= config.maxWords) return true;
      if (segmentDuration >= config.maxSegmentDuration) return true;

      // 2. Long silence: caption must not hang across a big gap.
      if (strength === 'veryStrong') return true;

      // 3. Complete thought / sentence terminator — also enables micro captions
      //    such as "Ya." / "Serius?" regardless of word count.
      if (/[.!?…]$/.test(wordText)) return true;

      // 4. Keep number+unit and proper-name units together unless the pause is
      //    clearly a boundary (strong/very strong).
      const unitPair =
        (isNumberToken(wordText) && isUnitToken(nextWordText)) ||
        (isNumberToken(nextWordText) && isUnitToken(wordText));
      const namePair = isCapitalizedToken(wordText) && isCapitalizedToken(nextWordText);
      if ((unitPair || namePair) && (strength === 'none' || strength === 'weak' || strength === 'medium')) {
        return false;
      }

      // 5. Natural-break signals need a minimum number of words — unless a real
      //    pause (medium+) marks a clear boundary. A 0.3s pause mid-phrase is a
      //    boundary even if the preceding caption is short (§8, §37).
      if (segmentWords.length < config.minWords && (strength === 'none' || strength === 'weak')) return false;

      // 6. Clause break (comma/semicolon/colon) needs a little pause to feel
      //    natural; otherwise only break when the segment is nearly full.
      if (/[,;:—]$/.test(wordText)) {
        if (gapToNext >= 0.12) return true;
        if (segmentWords.length >= config.maxWords - 1) return true;
        return false;
      }

      // 7. Pause-driven: a medium/strong pause is a segmentation signal.
      if (strength === 'strong' || strength === 'medium') return true;

      // 8. Reading speed: once a segment is mature, a caption that is too dense
      //    to read comfortably is a bad caption — split earlier (§14, §25).
      const density = Number(context?.density) || (segmentText.length / Math.max(0.1, segmentDuration));
      if (density > 20 && segmentDuration >= config.minSegmentDuration && segmentWords.length >= config.minWords) return true;

      // 9. Existing duration window. Prefer reaching a natural boundary: if the
      //    very next word lands on a sentence end or a strong pause, extend
      //    to it instead of cutting mid-phrase.
      if (segmentDuration >= config.minSegmentDuration && segmentDuration <= config.maxSegmentDuration) {
        const nextGap = Number(context?.nextGap ?? -1);
        const nextStrength = nextGap >= 0 ? helpers.boundaryStrength(nextGap) : null;
        const nextEndsUtterance = nextWordText ? /[.!?…]$/.test(nextWordText) : false;
        if (nextWordText && (nextEndsUtterance || nextStrength === 'strong' || nextStrength === 'veryStrong')) {
          return false;
        }
        return true;
      }

      // 10. Emphasis near the end of a mature segment.
      if (context?.emphasisWords && context.emphasisWords.includes(wordText) && segmentWords.length >= config.minWords) return true;

      return false;
    }
  };

  // Main LLM integration
  async function processWithLLM(transcript, style, fillerMode, speaker, language) {
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY tidak tersedia');
    }
    
    const systemPrompt = loadClipmeCaptionPrompt();
    if (!systemPrompt) {
      throw new Error('clipme-caption-prompt.js tidak ditemukan');
    }
    
    const userPrompt = buildUserPrompt(transcript, style, fillerMode, speaker, language);
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.4,
        response_format: { type: 'json_object' }
      })
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${error}`);
    }
    
    const data = await response.json();
    const content = data.choices[0]?.message?.content;
    
    if (!content) {
      throw new Error('OpenAI tidak mengembalikan konten');
    }
    
    try {
      const parsedContent = JSON.parse(content);
      return {
        segments: parsedContent.segments || [],
        provider: 'llm',
        confidence: parsedContent.confidence || 85
      };
    } catch (parseError) {
      throw new Error('Gagal memparsing respons OpenAI: ' + parseError.message);
    }
  }

  // Heuristic fallback processing
  function processHeuristic(transcript, style, fillerMode, speaker) {
    const segments = [];
    let segmentId = 1;
    const activeFillerMode = fillerMode || config.fillerMode || 'none';
    const multiWordFillers = ['you know', 'i mean'];

    // Skip a single filler word OR a multi-word filler phrase starting at idx.
    // Returns the number of tokens consumed (0 when not a filler).
    const fillerSpan = (idx) => {
      if (idx >= transcript.length) return 0;
      const one = helpers.isFillerWord(transcript[idx].text);
      if (one) return 1;
      if (config.fillerMode === 'aggressive' && idx + 1 < transcript.length) {
        const joined = `${String(transcript[idx].text || '').toLowerCase()} ${String(transcript[idx + 1].text || '').toLowerCase()}`.replace(/\s+/g, ' ').trim();
        if (multiWordFillers.includes(joined)) return 2;
      }
      return 0;
    };

    const nextNonFiller = (from) => {
      let k = from;
      while (k < transcript.length) {
        const n = fillerSpan(k);
        if (!n) break;
        k += n;
      }
      return k;
    };
    const gapAfter = (idx) => {
      const nf = nextNonFiller(idx + 1);
      if (nf >= transcript.length) return 0;
      return (Number(transcript[nf].start) || 0) - (Number(transcript[idx].end) || 0);
    };

    for (let i = 0; i < transcript.length; i++) {
      const word = transcript[i];

      // Skip filler words (and multi-word filler phrases) based on mode
      const skipN = fillerSpan(i);
      if (skipN) {
        i += skipN - 1;
        continue;
      }

      const segmentWords = [word];
      let lastIdx = i;
      let j = i + 1;

      // Micro-caption check: a single complete utterance (e.g. "Ya.") may
      // legitimately stand on its own when followed by a pause. Only a real
      // sentence terminator — or a strong/very strong pause — may produce a
      // single-word caption here, so a big gap is never bridged.
      const g0 = gapAfter(lastIdx);
      const s0 = helpers.boundaryStrength(g0);
      const strongGap0 = s0 === 'strong' || s0 === 'veryStrong';
      const ctx0 = {
        emphasisWords: helpers.extractEmphasisCandidates(word.text),
        wordCount: 1,
        gapToNext: g0,
        boundaryStrength: s0,
        nextWordText: nextNonFiller(lastIdx + 1) < transcript.length ? transcript[nextNonFiller(lastIdx + 1)].text : '',
        density: String(word.text || '').length / Math.max(0.1, (Number(word.end) || 0) - (Number(word.start) || 0))
      };
      const endsUtterance = /[.!?…]$/.test(String(word.text));
      const singleEnded = (endsUtterance || strongGap0) && helpers.shouldEndSegment(word, segmentWords, ctx0);

      if (!singleEnded) {
        while (j < transcript.length) {
          const currentWord = transcript[j];

          if (helpers.isFillerWord(currentWord.text)) {
            j++;
            continue;
          }

          segmentWords.push(currentWord);
          lastIdx = j;
          j++;

          const g = gapAfter(lastIdx);
          const nf = nextNonFiller(lastIdx + 1);
          const text = segmentWords.map((w) => w.text).join(' ');
          const firstStart = Number(segmentWords[0].start) || 0;
          const context = {
            emphasisWords: helpers.extractEmphasisCandidates(text),
            wordCount: segmentWords.length,
            gapToNext: g,
            boundaryStrength: helpers.boundaryStrength(g),
            nextWordText: nf < transcript.length ? transcript[nf].text : '',
            nextGap: nf < transcript.length ? gapAfter(nf) : -1,
            density: text.length / Math.max(0.1, (Number(currentWord.end) || 0) - firstStart)
          };

          if (helpers.shouldEndSegment(currentWord, segmentWords, context)) {
            break;
          }
        }
      }

      const segment = helpers.buildSegmentFromWords(segmentWords, segmentId++, transcript);
      if (segment && segment.wordCount > 0) {
        segments.push(segment);
      }

      i = lastIdx;
    }

    return {
      segments,
      provider: 'heuristic',
      confidence: 75
    };
  }

  // Build user prompt for LLM
  function buildUserPrompt(transcript, style, fillerMode, speaker, language) {
    const timeWindowText = transcript
      .map(word => `[${word.start.toFixed(1)}-${word.end.toFixed(1)}s] ${word.text}`)
      .join('\n');
    
    return `
Role: Auto Caption Intelligence Engine

Task: Ubah transkrip kata-per-kata di atas menjadi subtitle profesional yang mudah dibaca untuk video singkat, sambil mempertahankan makna dan waktu.

PARAMETER:
- Bahasa target: ${language || 'Indonesia'}
- Gaya caption: ${style}
- Mode penghapusan filler: ${fillerMode}
- Speaker ID: ${speaker || 'unknown (single speaker)'}

TRANSKRIP KATA-LEVEL:
${timeWindowText}

INSTRUKSI:
1. Setiap caption segment harus berisi 2-7 kata maksimal, kira-kira 1.2-3.0 detik di layar, maksimal 2 baris.
2. Pertahankan urutan kata asli.
3. Jangan menghapus kata yang mengubah makna kecuali filler words.
4. Jika fillerMode adalah "aggressive", hapus kata seperti "um", "uh", "hmm", "eee", "eh", "anu", "jadi", "kayak", "basically", "you know", "I mean", "so", "well", "actually", "literally", "just", "karena", "lalu", "terus", "gitu", "aja"
5. Pertahankan tanda baca dan kapitalisasi seperti asli, kecuali untuk memperbaiki kesalahan jelas STT.
6. Identifikasi dan berikan penekanan pada 1-3 kata yang paling penting per segment.
7. Pertahankan speaker ID asli untuk setiap kata.
8. Gunakan jeda (gap antar kata) dan tanda baca sebagai sinyal batas segment; jangan potong di tengah frasa angka ("50 juta") atau nama orang ("Jondry Suitela") kecuali jeda sangat panjang.
9. JANGAN menebak atau mengarang timestamp baru; mulai/akhir segment harus mengikuti timestamp kata asli yang diberikan.
10. Output harus berupa JSON dengan format berikut:
{
  "segments": [
    {
      "id": 1,
      "speaker_id": "speaker_1",
      "start": 0.00,
      "end": 1.50,
      "text": "kata1 kata2 kata3",
      "emphasis_words": ["kata2"],
      "emotion": "neutral"
    }
  ]
}

PENTING:
- Setiap kata dalam output HARUS ada di transkrip sumber.
- Pertahankan makna persis dari setiap frasa.
- Jangan mengarang kata-kata baru, merangkum, atau menulis ulang.
- Jangan mengarang timestamp: semua start/end harus berasal dari timestamp kata di transkrip sumber.
- Setiap segmen harus realistis untuk ditampilkan di video vertikal.
- Engine deterministik (bukan LLM) adalah otoritas akhir untuk timing dan urutan kata; kamu hanya memberi saran segmentasi.

Berdasarkan transkrip di atas, buat segmen caption sesuai dengan instruksi.
    `;
  }

  // Derive a post caption (1-4 short paragraphs) from the segment texts.
  function deriveCaption(segments) {
    const text = (segments || [])
      .map((s) => String(s.text || "").trim())
      .filter(Boolean)
      .join(" ");
    if (!text) return "";
    const clean = text.replace(/\s+/g, " ").trim();
    if (clean.length <= 160) return clean;
    const first = clean.slice(0, 160).trim();
    const cut = first.lastIndexOf(" ");
    const p1 = cut > 60 ? first.slice(0, cut) : first;
    const rest = clean.slice(p1.length).trim();
    if (!rest) return p1;
    const paragraphs = [p1];
    if (rest.length > 160) {
      const r2 = rest.slice(0, 160).trim();
      const c2 = r2.lastIndexOf(" ");
      paragraphs.push(c2 > 60 ? r2.slice(0, c2) : r2);
      const rest2 = rest.slice(paragraphs[1].length).trim();
      if (rest2) paragraphs.push(rest2);
    } else {
      paragraphs.push(rest);
    }
    return paragraphs.slice(0, 4).join("\n\n");
  }

  // Derive a hook from the strongest early segment opening.
  function deriveHook(segments, language) {
    const segs = segments || [];
    if (!segs.length) return "";
    const sentences = segs.map((s) => String(s.text || "").trim()).filter(Boolean);
    // PHASE 10: delegasi ke hook engine bersama (single source of truth).
    if (hookEngine && typeof hookEngine.selectHook === "function") {
      const lang = (hookEngine.langTag && hookEngine.langTag(language)) || "id";
      const result = hookEngine.selectHook(sentences, lang, {});
      if (result && result.recommendedHook) return result.recommendedHook.slice(0, 90);
    }
    // Legacy fallback bila hook engine gagal dimuat.
    const candidates = sentences
      .slice(0, 8)
      .filter((t) => {
        const wc = t.split(/\s+/).length;
        return wc >= 2 && wc <= 12;
      });
    if (!candidates.length) return "";
    let best = candidates[0];
    let bestScore = -1;
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      let score = (segs.length - i) * 1.5;
      if (/[?]/.test(c)) score += 3;
      if (/[.!…]$/.test(c)) score += 2;
      if (segs[i] && Array.isArray(segs[i].emphasis_words) && segs[i].emphasis_words.length) score += 2;
      if (c.length > 25 && c.length <= 90) score += 1.5;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (best.length <= 90) return best;
    const cut = best.slice(0, 88).lastIndexOf(" ");
    return cut > 30 ? best.slice(0, cut) + " ..." : best.slice(0, 88) + "...";
  }

  // Public API
  return {
    processWithLLM,
    processHeuristic,
    deriveCaption,
    deriveHook,
    helpers
  };
}

// Export the engine
module.exports = AutoCaptionEngine;

// Standalone layout helper shared with the server for preview/export parity.
module.exports.layoutCaptionLines = layoutCaptionLines;
module.exports.analyzeSpeechRhythm = (words) => {
  try { return AutoCaptionEngine({}).helpers.analyzeSpeechRhythm(words); } catch (e) { return { gaps: [], duration: 0, wordsPerSec: 0, charsPerSec: 0 }; }
};