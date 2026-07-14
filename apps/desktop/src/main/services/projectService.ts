import fs from "node:fs";
import path from "node:path";
import { dialog } from "electron";
import { getDb } from "../database/db";
import { getSettings } from "./settingsService";
import type { Project, ProjectFileStructure, ProjectStatus, VideoMetadata } from "../../shared/types";
import { upsertProjectVideo } from "./videoService";
import { createId } from "../utils/ids";

function now() {
  return new Date().toISOString();
}

export function projectPaths(projectId: string, rootPath?: string): ProjectFileStructure {
  const root = rootPath ?? getProject(projectId).rootPath;
  return {
    root,
    original: path.join(root, "original"),
    audio: path.join(root, "audio"),
    transcripts: path.join(root, "transcripts"),
    previews: path.join(root, "previews"),
    exports: path.join(root, "exports"),
    subtitles: path.join(root, "subtitles"),
    logs: path.join(root, "logs"),
    manifest: path.join(root, "project.json")
  };
}

export function ensureProjectFolders(paths: ProjectFileStructure) {
  for (const dir of [paths.root, paths.original, paths.audio, paths.transcripts, paths.previews, paths.exports, paths.subtitles, paths.logs]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function createProject(name: string): Project {
  const id = createId(12);
  const safeName = name.trim().replace(/[<>:"/\\|?*]+/g, "-") || "Untitled Project";
  const rootPath = path.join(getSettings().defaultProjectFolder, `${safeName}-${id}`);
  const paths = projectPaths(id, rootPath);
  ensureProjectFolders(paths);

  const project: Project = {
    id,
    name: safeName,
    rootPath,
    status: "empty",
    createdAt: now(),
    updatedAt: now()
  };
  getDb()
    .prepare(
      `INSERT INTO projects (id, name, root_path, status, created_at, updated_at)
       VALUES (@id, @name, @rootPath, @status, @createdAt, @updatedAt)`
    )
    .run(project);
  writeManifest(project);
  return project;
}

export function listProjects(): Project[] {
  return getDb()
    .prepare("SELECT * FROM projects ORDER BY updated_at DESC")
    .all()
    .map(rowToProject);
}

export function getProject(projectId: string): Project {
  const row = getDb().prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
  if (!row) throw new Error(`Project not found: ${projectId}`);
  return rowToProject(row);
}

export async function deleteProject(projectId: string) {
  const project = getProject(projectId);
  getDb().prepare("DELETE FROM jobs WHERE project_id = ?").run(projectId);
  getDb().prepare("DELETE FROM clips WHERE project_id = ?").run(projectId);
  getDb().prepare("DELETE FROM videos WHERE project_id = ?").run(projectId);
  getDb().prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  await removeProjectFolder(project.rootPath);
}

export function updateProject(projectId: string, patch: Partial<Project>) {
  const current = getProject(projectId);
  const next: Project = { ...current, ...patch, updatedAt: now() };
  getDb()
    .prepare(
      `UPDATE projects SET
        name = @name,
        root_path = @rootPath,
        status = @status,
        updated_at = @updatedAt,
        original_video_path = @originalVideoPath,
        transcript_path = @transcriptPath,
        metadata_json = @metadataJson
       WHERE id = @id`
    )
    .run({
      ...next,
      metadataJson: next.metadata ? JSON.stringify(next.metadata) : null
    });
  writeManifest(next);
  return next;
}

export async function pickVideoFile() {
  const result = await dialog.showOpenDialog({
    title: "Import video",
    properties: ["openFile"],
    filters: [{ name: "Videos", extensions: ["mp4", "mov", "mkv", "webm", "avi", "m4v"] }]
  });
  if (result.canceled || result.filePaths.length === 0) return undefined;
  return result.filePaths[0];
}

export function attachOriginalVideo(projectId: string, sourcePath: string, metadata: VideoMetadata) {
  const paths = projectPaths(projectId);
  resetProjectDerivedData(projectId);
  const ext = path.extname(sourcePath) || ".mp4";
  const destination = path.join(paths.original, `original${ext}`);
  if (path.resolve(sourcePath) !== path.resolve(destination)) {
    fs.copyFileSync(sourcePath, destination);
  }
  upsertProjectVideo(projectId, sourcePath, destination, metadata);
  return updateProject(projectId, {
    status: "imported",
    originalVideoPath: destination,
    metadata
  });
}

export function resetProjectDerivedData(projectId: string) {
  const paths = projectPaths(projectId);
  for (const dir of [paths.audio, paths.transcripts, paths.previews, paths.exports, paths.subtitles]) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    fs.mkdirSync(dir, { recursive: true });
  }
  getDb().prepare("DELETE FROM clips WHERE project_id = ?").run(projectId);
  getDb().prepare("DELETE FROM videos WHERE project_id = ?").run(projectId);
  getDb().prepare("DELETE FROM jobs WHERE project_id = ? AND status IN ('completed', 'failed', 'canceled')").run(projectId);
}

export function writeManifest(project: Project) {
  const paths = projectPaths(project.id, project.rootPath);
  ensureProjectFolders(paths);
  fs.writeFileSync(paths.manifest, JSON.stringify(project, null, 2), "utf8");
}

export function setProjectStatus(projectId: string, status: ProjectStatus) {
  return updateProject(projectId, { status });
}

function rowToProject(row: any): Project {
  return {
    id: row.id,
    name: row.name,
    rootPath: row.root_path,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    originalVideoPath: row.original_video_path ?? undefined,
    transcriptPath: row.transcript_path ?? undefined,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined
  };
}

async function removeProjectFolder(rootPath: string) {
  if (!fs.existsSync(rootPath)) return;
  try {
    await fs.promises.rm(rootPath, { recursive: true, force: true });
    return;
  } catch (error) {
    // try to rename and remove with retries
  }

  const pendingPath = `${rootPath}.pending-delete-${Date.now()}`;
  let renamed = false;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      fs.renameSync(rootPath, pendingPath);
      renamed = true;
      break;
    } catch (err) {
      // wait and retry
      // eslint-disable-next-line no-await-in-loop
      await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
    }
  }
  if (!renamed) {
    console.warn("Project folder could not be renamed for pending delete:", rootPath);
    return;
  }

  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      await fs.promises.rm(pendingPath, { recursive: true, force: true });
      return;
    } catch (err) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
    }
  }
  console.warn("Pending project folder could not be fully removed yet:", pendingPath);
}
