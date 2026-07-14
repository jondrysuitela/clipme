import fs from "node:fs";
import path from "node:path";
import { getDb } from "../database/db";
import { getClip } from "./clipService";
import { projectPaths, getProject } from "./projectService";
import type { ClipAssets, ClipCandidate, Project, ThumbnailRecommendation, TranscriptSegment } from "../../shared/types";
import { cosineSimilarity } from "../../shared/utils/textUtils";

const SEO_POWER_WORDS = [
  "Cara", "Tips", "Trik", "Panduan", "Rahasia", "strategi", "ampuh",
  "efektif", "mudah", "cepat", "otomatis", "gratis", "wajib", "tonton",
  "bukti", "fakta", "ilmiah", "dijamin", "terbukti", "lengkap"
];

const PLATFORM_HASHTAGS: Record<string, string[]> = {
  TikTok: ["#tiktok", "#fyp", "#viral", "#tiktokindonesia"],
  Reels: ["#reels", "#reelsinstagram", "#trending", "#explore"],
  Shorts: ["#shorts", "#youtubeshorts", "#subscribe", "#trending"],
  LinkedIn: ["#linkedin", "#professional", "#tips", "#growth"]
};

export function generateClipAssets(projectId: string, clipId: string): ClipAssets {
  const clip = getClip(projectId, clipId);
  const project = getProject(projectId);
  const segments = loadTranscriptSegments(projectId);

  const seoDescription = generateSeoDescription(clip, project, segments);
  const keywords = generateKeywords(clip, project, segments);
  const platformTags = generatePlatformTags(clip, keywords);
  const thumbnailRecommendation = findBestThumbnailFrame(projectId, clip);

  return { seoDescription, keywords, platformTags, thumbnailRecommendation };
}

function loadTranscriptSegments(projectId: string): TranscriptSegment[] {
  const paths = projectPaths(projectId);
  if (!fs.existsSync(paths.transcripts)) return [];
  const files = fs.readdirSync(paths.transcripts).filter(f => f.endsWith(".json"));
  if (files.length === 0) return [];
  try {
    const raw = fs.readFileSync(path.join(paths.transcripts, files[0]), "utf8");
    const data = JSON.parse(raw);
    if (Array.isArray(data?.segments)) return data.segments as TranscriptSegment[];
    if (Array.isArray(data)) return data as TranscriptSegment[];
  } catch { /* ignore */ }
  return [];
}

function generateSeoDescription(clip: ClipCandidate, project: Project, segments: TranscriptSegment[]): string {
  const title = clip.title || "Video menarik";
  const mainKeywords = extractMainKeywords(clip, project);
  const keywordStr = mainKeywords.slice(0, 3).join(", ");
  const durationStr = `${Math.round(clip.duration)} detik`;
  const hookText = clip.suggestedCaption ? clip.suggestedCaption.slice(0, 120) : "";

  const templates = [
    `${title} 🎬 Temukan ${mainKeywords[0] || "rahasia"} dalam ${durationStr}! ${hookText ? `"${hookText}"` : ""} Jangan lewatkan momen viral ini. Simak selengkapnya! 🚀 #${mainKeywords.slice(0, 3).join(" #")}`,
    `Penasaran dengan ${mainKeywords[0] || "topik ini"}? 🤔 Video ${durationStr} ini akan membahas ${mainKeywords.slice(0, 2).join(" dan ")} secara lengkap. ${hookText ? `"${hookText}"` : ""} Tonton sekarang dan bagikan! 👇`,
    `${title} — ${durationStr} yang mengubah cara pandang kamu! 🔥 ${hookText ? hookText + " " : ""}${mainKeywords.slice(0, 2).map(k => `#${k}`).join(" ")} #viral #fyp`
  ];

  let description = templates[Math.floor(Math.random() * templates.length)];
  description += "\n\n" + generateCta();
  return description.length > 5000 ? description.slice(0, 4997) + "..." : description;
}

function generateCta(): string {
  const ctas = [
    "Jangan lupa like, comment, dan share! 🔄",
    "Follow untuk konten menarik setiap hari! ✅",
    "Subscribe biar nggak ketinggalan video terbaru! 🔔",
    "Save video ini buat referensi nanti! 💾",
    "Tag teman yang perlu lihat ini! 👥"
  ];
  return ctas[Math.floor(Math.random() * ctas.length)];
}

function generateKeywords(clip: ClipCandidate, project: Project, segments: TranscriptSegment[]): string[] {
  const keywords = new Set<string>();

  if (project.metadata) {
    keywords.add(`${project.metadata.width}x${project.metadata.height}`);
  }

  if (clip.title) {
    clip.title.replace(/[^\w\s]/g, " ").split(/\s+/).filter(w => w.length > 3).forEach(w => keywords.add(w.toLowerCase()));
  }

  if (clip.suggestedCaption) {
    clip.suggestedCaption.replace(/[^\w\s]/g, " ").split(/\s+/).filter(w => w.length > 4).slice(0, 8).forEach(w => keywords.add(w.toLowerCase()));
  }

  clip.hashtags.forEach(tag => {
    const clean = tag.replace(/^#/, "");
    if (clean.length > 2) keywords.add(clean.toLowerCase());
  });

  const segmentTexts = segments.map(s => s.text).join(" ");
  const wordFreq = new Map<string, number>();
  segmentTexts.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/)
    .filter(w => w.length > 4 && !["dengan", "tidak", "sudah", "akan", "dapat", "dalam", "antara", "untuk", "tentang"].includes(w))
    .forEach(w => wordFreq.set(w, (wordFreq.get(w) || 0) + 1));

  [...wordFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([word]) => word).forEach(w => keywords.add(w));

  const result = [...keywords].slice(0, 10);
  if (result.length < 5) {
    const fallbacks = ["video", "tips", "tutorial", "edukasi", "viral", "trending", "indonesia"];
    for (const fb of fallbacks) {
      if (result.length >= 5) break;
      if (!result.includes(fb)) result.push(fb);
    }
  }
  return result;
}

function generatePlatformTags(clip: ClipCandidate, keywords: string[]): Record<string, string[]> {
  const baseTags = keywords.slice(0, 5).map(k => `#${k.replace(/\s+/g, "")}`);
  const sourceText = [clip.title, clip.suggestedCaption].filter(Boolean).join(" ");
  const result: Record<string, string[]> = {};
  for (const [platform, platformTags] of Object.entries(PLATFORM_HASHTAGS)) {
    let tags = [...new Set([...baseTags, ...platformTags])].slice(0, 15);
    // Filter by cosine similarity with clip content
    const scored = tags.map(tag => ({ tag, score: cosineSimilarity(tag.replace(/^#/, ""), sourceText) }));
    tags = scored.sort((a, b) => b.score - a.score).slice(0, 12).map(s => s.tag);
    if (tags.length < 5) tags = [...tags, ...platformTags].slice(0, 15);
    result[platform] = tags;
  }
  return result;
}

function findBestThumbnailFrame(projectId: string, clip: ClipCandidate): ThumbnailRecommendation | undefined {
  const paths = projectPaths(projectId);
  if (!fs.existsSync(paths.previews)) return undefined;
  const previewFiles = fs.readdirSync(paths.previews).filter(f =>
    f.startsWith(clip.id) && (f.endsWith(".jpg") || f.endsWith(".png") || f.endsWith(".webp"))
  );
  if (previewFiles.length > 0) {
    const bestFile = previewFiles.sort().at(-1)!;
    return {
      framePath: path.join(paths.previews, bestFile),
      score: Math.round(clip.hookScore * (1 + Math.random() * 0.2)),
      timestamp: clip.startTime + clip.duration * 0.3
    };
  }
  return undefined;
}

function extractMainKeywords(clip: ClipCandidate, project: Project): string[] {
  const source = [clip.title, clip.suggestedCaption, project.name].filter(Boolean).join(" ");
  const words = source.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/)
    .filter(w => w.length > 3 && !["dengan", "tidak", "sudah", "akan", "dapat", "dalam", "antara", "untuk", "tentang", "sebuah", "sangat"].includes(w));
  return [...new Set(words)].slice(0, 5);
}

export async function generateAllClipAssets(projectId: string): Promise<number> {
  ensureAssetsColumn();
  const clips = (getDb().prepare("SELECT id FROM clips WHERE project_id = ?").all(projectId) as any[]).map((row: any) => row.id);
  let count = 0;
  for (const clipId of clips) {
    try {
      const assets = generateClipAssets(projectId, clipId);
      getDb()
        .prepare("UPDATE clips SET assets_json = ?, updated_at = ? WHERE id = ? AND project_id = ?")
        .run(JSON.stringify(assets), new Date().toISOString(), clipId, projectId);
      count++;
    } catch (err) {
      console.warn(`Failed to generate assets for clip ${clipId}:`, err);
    }
  }
  return count;
}

export function ensureAssetsColumn() {
  try {
    getDb().exec("ALTER TABLE clips ADD COLUMN assets_json TEXT");
  } catch { /* column already exists */ }
}
