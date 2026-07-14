import { getDb } from "../database/db";
import type { VideoMetadata } from "../../shared/types";
import { createId } from "../utils/ids";

function now() {
  return new Date().toISOString();
}

export interface VideoRecord {
  id: string;
  projectId: string;
  originalPath: string;
  workingPath: string;
  metadata?: VideoMetadata;
  createdAt: string;
  updatedAt: string;
}

export function upsertProjectVideo(projectId: string, originalPath: string, workingPath: string, metadata: VideoMetadata) {
  const existing = getProjectVideo(projectId);
  const id = existing?.id ?? createId(12);
  const timestamp = now();
  getDb()
    .prepare(
      `INSERT INTO videos (
        id, project_id, original_path, working_path, duration, width, height, fps,
        video_codec, audio_codec, file_size, created_at, updated_at
      ) VALUES (
        @id, @projectId, @originalPath, @workingPath, @duration, @width, @height, @fps,
        @videoCodec, @audioCodec, @fileSize, @createdAt, @updatedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        original_path = excluded.original_path,
        working_path = excluded.working_path,
        duration = excluded.duration,
        width = excluded.width,
        height = excluded.height,
        fps = excluded.fps,
        video_codec = excluded.video_codec,
        audio_codec = excluded.audio_codec,
        file_size = excluded.file_size,
        updated_at = excluded.updated_at`
    )
    .run({ id, projectId, originalPath, workingPath, ...metadata, createdAt: timestamp, updatedAt: timestamp });
  return getProjectVideo(projectId);
}

export function getProjectVideo(projectId: string): VideoRecord | undefined {
  const row = getDb().prepare("SELECT * FROM videos WHERE project_id = ? ORDER BY updated_at DESC LIMIT 1").get(projectId);
  return row ? rowToVideo(row) : undefined;
}

function rowToVideo(row: any): VideoRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    originalPath: row.original_path,
    workingPath: row.working_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata: {
      duration: row.duration ?? 0,
      width: row.width ?? 0,
      height: row.height ?? 0,
      fps: row.fps ?? 0,
      videoCodec: row.video_codec ?? "unknown",
      audioCodec: row.audio_codec ?? "unknown",
      fileSize: row.file_size ?? 0
    }
  };
}
