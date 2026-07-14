/**
 * Pure-math utilities: cosine similarity, WCAG contrast, text vectorization.
 * No external dependencies required.
 */

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter((w) => w.length > 2);
}

function buildVector(text: string, vocabulary: Map<string, number>): number[] {
  const tokens = tokenize(text);
  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1);
  const vec: number[] = [];
  for (const [word] of vocabulary) vec.push(freq.get(word) || 0);
  return vec;
}

export function cosineSimilarity(textA: string, textB: string): number {
  const tokensA = tokenize(textA);
  const tokensB = tokenize(textB);
  const vocab = new Map<string, number>();
  let idx = 0;
  for (const t of [...tokensA, ...tokensB]) if (!vocab.has(t)) vocab.set(t, idx++);
  if (vocab.size === 0) return 0;
  const vecA = buildVector(textA, vocab);
  const vecB = buildVector(textB, vocab);
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function filterRelevantHashtags(hashtags: string[], sourceText: string, threshold = 0.6): Array<{ tag: string; score: number }> {
  const results: Array<{ tag: string; score: number }> = [];
  for (const tag of hashtags) {
    const score = cosineSimilarity(tag.replace(/^#/, ""), sourceText);
    if (score >= threshold) results.push({ tag, score });
  }
  return results;
}

function relativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

export function contrastRatio(foreground: [number, number, number], background: [number, number, number]): number {
  const l1 = relativeLuminance(...foreground);
  const l2 = relativeLuminance(...background);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function meetsWcagAA(foreground: [number, number, number], background: [number, number, number]): boolean {
  return contrastRatio(foreground, background) >= 4.5;
}

export function validateSubtitleContrast(): { ratio: number; passesAA: boolean; recommendation?: string } {
  const white: [number, number, number] = [255, 255, 255];
  const black: [number, number, number] = [0, 0, 0];
  const ratio = contrastRatio(white, black);
  if (ratio >= 4.5) return { ratio: Math.round(ratio * 10) / 10, passesAA: true };
  return { ratio: Math.round(ratio * 10) / 10, passesAA: false, recommendation: "Add solid background behind text." };
}