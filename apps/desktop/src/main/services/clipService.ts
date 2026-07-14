import fs from "node:fs";
import path from "node:path";
import { getDb } from "../database/db";
import type { ClipCandidate } from "../../shared/types";
import { createId } from "../utils/ids";
import { projectPaths } from "./projectService";

function now() {
  return new Date().toISOString();
}

export function replaceClips(projectId: string, clips: ClipCandidate[]) {
  const db = getDb();
  db.beginTransaction();
  try {
    db.prepare("DELETE FROM clips WHERE project_id = ?").run(projectId);
    for (const clip of clips) {
      db.prepare(
        `INSERT INTO clips (
          id, project_id, title, start_time, end_time, duration, hook_score, reason,
          suggested_caption, hashtags_json, reframe_anchors_json, assets_json, curation_status, preview_path, export_path, selected, created_at, updated_at
        ) VALUES (
          @id, @projectId, @title, @startTime, @endTime, @duration, @hookScore, @reason,
          @suggestedCaption, @hashtagsJson, @reframeAnchorsJson, @assetsJson, @curationStatus, @previewPath, @exportPath, @selectedInt, @createdAt, @updatedAt
        )`
    ).run(toRow({ ...clip, id: clip.id || createId(10), projectId }));
    }
    db.commit();
  } catch (err) {
    db.rollback();
    throw err;
  }
}

export function listClips(projectId: string): ClipCandidate[] {
  return getDb().prepare("SELECT * FROM clips WHERE project_id = ? ORDER BY hook_score DESC, start_time ASC").all(projectId).map(rowToClip);
}

export function getClip(projectId: string, clipId: string): ClipCandidate {
  const row = getDb().prepare("SELECT * FROM clips WHERE project_id = ? AND id = ?").get(projectId, clipId);
  if (!row) throw new Error(`Clip not found: ${clipId}`);
  return rowToClip(row);
}

export function updateClip(clip: ClipCandidate): ClipCandidate {
  getDb()
    .prepare(
      `UPDATE clips SET
        title = @title,
        start_time = @startTime,
        end_time = @endTime,
        duration = @duration,
        hook_score = @hookScore,
        reason = @reason,
        suggested_caption = @suggestedCaption,
        hashtags_json = @hashtagsJson,
        reframe_anchors_json = @reframeAnchorsJson,
        assets_json = @assetsJson,
        curation_status = @curationStatus,
        preview_path = @previewPath,
        export_path = @exportPath,
        selected = @selectedInt,
        updated_at = @updatedAt
      WHERE project_id = @projectId AND id = @id`
    )
    .run(toRow({ ...clip, duration: Math.max(0, clip.endTime - clip.startTime) }));
  return getClip(clip.projectId, clip.id);
}

export function deleteClip(projectId: string, clipId: string) {
  getDb().prepare("DELETE FROM clips WHERE project_id = ? AND id = ?").run(projectId, clipId);
}

export function createExportPackSummary(projectId: string) {
  const paths = projectPaths(projectId);
  fs.mkdirSync(paths.exports, { recursive: true });
  const clips = listClips(projectId).filter((clip) => clip.exportPath);
  const outputPath = path.join(paths.exports, `export-pack-${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
  const body = [
    "# ClipMe Export Pack",
    "",
    `Generated: ${new Date().toLocaleString()}`,
    `Exported clips: ${clips.length}`,
    "",
    ...clips.flatMap((clip, index) => [
      `## ${index + 1}. ${clip.title}`,
      "",
      `- Status: ${clip.curationStatus ?? "review"}`,
      `- Viral score: ${clip.hookScore}`,
      `- Time: ${formatTime(clip.startTime)} - ${formatTime(clip.endTime)} (${Math.round(clip.duration)}s)`,
      `- File: ${clip.exportPath}`,
      "",
      "Caption:",
      "",
      clip.suggestedCaption,
      "",
      "Hashtags:",
      "",
      clip.hashtags.join(" "),
      ""
    ])
  ].join("\n");
  fs.writeFileSync(outputPath, body, "utf8");
  return outputPath;
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function toRow(clip: ClipCandidate) {
  const timestamp = now();
  return {
    ...clip,
    hashtagsJson: JSON.stringify(clip.hashtags),
    reframeAnchorsJson: clip.reframeAnchors?.length ? JSON.stringify(clip.reframeAnchors) : null,
    assetsJson: clip.assets ? JSON.stringify(clip.assets) : null,
    selectedInt: clip.selected ? 1 : 0,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function rowToClip(row: any): ClipCandidate {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    startTime: row.start_time,
    endTime: row.end_time,
    duration: row.duration,
    hookScore: row.hook_score,
    reason: row.reason,
    suggestedCaption: row.suggested_caption,
    hashtags: JSON.parse(row.hashtags_json),
    previewPath: row.preview_path ?? undefined,
    exportPath: row.export_path ?? undefined,
    selected: Boolean(row.selected),
    curationStatus: row.curation_status ?? undefined,
    reframeAnchors: row.reframe_anchors_json ? JSON.parse(row.reframe_anchors_json) : undefined,
    momentLabels: undefined,
    assets: row.assets_json ? JSON.parse(row.assets_json) : undefined
  };
}

