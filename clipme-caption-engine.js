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

// Auto Caption Engine Core
function AutoCaptionEngine(options = {}) {
  const config = {
    style: options.style || 'dynamic',
    fillerMode: options.fillerMode || 'none',
    maxLines: options.maxLines || 2,
    maxLineLength: options.maxLineLength || 40,
    emphasisThreshold: options.emphasisThreshold || 0.7,
    minSegmentDuration: options.minSegmentDuration || 0.8,
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
      const w = String(word || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
      if (!w) return false;
      if (hesitation.includes(w)) return true;
      if (config.fillerMode === 'aggressive' && conversational.includes(w)) return true;
      return false;
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
        speaker_id: words[0].speaker_id,
        start,
        end,
        text,
        emphasis_words: emphasisWords,
        emotion,
        wordCount: words.length,
        lines: helpers.splitIntoLines(text, config.maxLines, config.maxLineLength)
      };
    },

    // Split text into lines respecting length constraints
    splitIntoLines: (text, maxLines, maxLineLength) => {
      const words = text.split(' ');
      const lines = [];
      let currentLine = '';
      let lineCount = 0;
      
      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        
        if (lineCount >= maxLines || testLine.length > maxLineLength) {
          if (currentLine) {
            lines.push(currentLine);
            lineCount++;
          }
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }
      
      if (currentLine) {
        lines.push(currentLine);
      }
      
      return lines;
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
      
      // Hard cap: never exceed maxWords
      if (segmentWords.length >= config.maxWords) {
        return true;
      }
      
      // Hard cap: never exceed maxSegmentDuration
      const firstStart = Number(segmentWords[0]?.start ?? 0);
      const lastEnd = Number(segmentWords[segmentWords.length - 1]?.end ?? 0);
      const segmentDuration = lastEnd - firstStart;
      if (segmentDuration >= config.maxSegmentDuration) {
        return true;
      }
      
      // Only consider natural breaks once the segment is long enough
      if (segmentWords.length < config.minWords) {
        return false;
      }
      
      // End segment at a complete thought (sentence terminator)
      if (/[.!?…]$/.test(wordText)) {
        return true;
      }
      
      // End segment after comma/colon for rhythm
      if (/[,;:—]$/.test(wordText)) {
        return true;
      }
      
      // End segment when a strong emphasis word appears near the end
      if (context.emphasisWords && context.emphasisWords.includes(wordText) &&
          segmentWords.length >= config.minWords) {
        return true;
      }
      
      // End segment if it has grown long enough by duration
      if (segmentDuration >= config.minSegmentDuration && segmentDuration <= config.maxSegmentDuration) {
        return true;
      }
      
      return false;
    },

    // Main processing pipeline
    processTranscript: (transcript, style, fillerMode) => {
      const processedSegments = [];
      let segmentId = 1;
      const activeFillerMode = fillerMode || config.fillerMode || 'none';
      
      for (let i = 0; i < transcript.length; i++) {
        const word = transcript[i];
        
        // Skip filler words based on mode
        if (helpers.isFillerWord(word.text)) {
          continue;
        }
        
        // Start or continue segment
        let segmentWords = [];
        let segmentStart = word.start;
        
        // Collect words for segment
        for (let j = i; j < transcript.length; j++) {
          const currentWord = transcript[j];
          
          // Skip filler words in middle of segment
          if (helpers.isFillerWord(currentWord.text)) {
            continue;
          }
          
          segmentWords.push(currentWord);
          
          // Check if we should end segment after this word
          const context = {
            emphasisWords: helpers.extractEmphasisCandidates(segmentWords.map(w => w.text).join(' ')),
            wordCount: segmentWords.length
          };
          
          if (helpers.shouldEndSegment(currentWord, segmentWords, context) && segmentWords.length >= 1) {
            break;
          }
        }
        
        // Build segment from collected words
        const segment = helpers.buildSegmentFromWords(segmentWords, segmentId++, transcript);
        
        if (segment && segment.wordCount > 0) {
          processedSegments.push(segment);
        }
        
        i += segmentWords.length - 1;
      }
      
      return processedSegments;
    }
  };

  // Main LLM integration
  async function processWithLLM(transcript, style, fillerMode, speaker) {
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY tidak tersedia');
    }
    
    const systemPrompt = loadClipmeCaptionPrompt();
    if (!systemPrompt) {
      throw new Error('clipme-caption-prompt.js tidak ditemukan');
    }
    
    const userPrompt = buildUserPrompt(transcript, style, fillerMode, speaker);
    
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
    
    for (let i = 0; i < transcript.length; i++) {
      const word = transcript[i];
      
      // Skip filler words based on mode
      if (helpers.isFillerWord(word.text)) {
        continue;
      }
      
      const segmentWords = [word];
      let j = i + 1;
      
      while (j < transcript.length) {
        const currentWord = transcript[j];
        
        if (helpers.isFillerWord(currentWord.text)) {
          j++;
          continue;
        }
        
        segmentWords.push(currentWord);
        j++;
        
        const context = {
          emphasisWords: helpers.extractEmphasisCandidates(segmentWords.map((w) => w.text).join(' ')),
          wordCount: segmentWords.length
        };
        
        if (helpers.shouldEndSegment(currentWord, segmentWords, context)) {
          break;
        }
      }
      
      const segment = helpers.buildSegmentFromWords(segmentWords, segmentId++, transcript);
      if (segment && segment.wordCount > 0) {
        segments.push(segment);
      }
      
      i = j - 1;
    }
    
    return {
      segments,
      provider: 'heuristic',
      confidence: 75
    };
  }

  // Build user prompt for LLM
  function buildUserPrompt(transcript, style, fillerMode, speaker) {
    const timeWindowText = transcript
      .map(word => `[${word.start.toFixed(1)}-${word.end.toFixed(1)}s] ${word.text}`)
      .join('\n');
    
    return `
Role: Auto Caption Intelligence Engine

Task: Ubah transkrip kata-per-kata di atas menjadi subtitle profesional yang mudah dibaca untuk video singkat, sambil mempertahankan makna dan waktu.

PARAMETER:
- Bahasa target: ${style}
- Gaya caption: ${style}
- Mode penghapusan filler: ${fillerMode}
- Speaker ID: ${speaker}

TRANSKRIP KATA-LEVEL:
${timeWindowText}

INSTRUKSI:
1. Setiap caption segment harus berisi 2-7 kata maksimal, kira-kira 0.8-3.0 detik di layar, maksimal 2 baris.
2. Pertahankan urutan kata asli.
3. Jangan menghapus kata yang mengubah makna kecuali filler words.
4. Jika fillerMode adalah "aggressive", hapus kata seperti "um", "uh", "hmm", "eee", "eh", "anu", "jadi", "kayak", "basically", "you know", "I mean", "so", "well", "actually", "literally", "just", "karena", "lalu", "terus", "gitu", "aja"
5. Pertahankan tanda baca dan kapitalisasi seperti asli, kecuali untuk memperbaiki kesalahan jelas STT.
6. Identifikasi dan berikan penekanan pada 1-3 kata yang paling penting per segment.
7. Pertahankan speaker ID asli untuk setiap kata.
8. Output harus berupa JSON dengan format berikut:
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
- Setiap segmen harus realistis untuk ditampilkan di video vertikal.

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
  function deriveHook(segments) {
    const segs = segments || [];
    if (!segs.length) return "";
    // Hooks belong in the first seconds of the clip; score earlier segments higher.
    const candidates = segs
      .slice(0, 8)
      .map((s) => String(s.text || "").trim())
      .filter((t) => {
        const wc = t.split(/\s+/).length;
        return wc >= 2 && wc <= 12;
      });
    if (!candidates.length) return "";
    let best = candidates[0];
    let bestScore = -1;
    // Prefer segments with emphasis words, questions, or punchy endings.
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      let score = (segs.length - i) * 1.5; // earlier = better
      if (/[?]/.test(c)) score += 3;       // question = curiosity
      if (/[.!…]$/.test(c)) score += 2;    // complete thought
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