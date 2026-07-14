import { app, BrowserWindow, clipboard, ipcMain, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import { createProject, deleteProject, getProject, listProjects, projectPaths } from "../services/projectService";
import { getSettings, updateSettings } from "../services/settingsService";
import {
  createAnalyzeHooksJob,
  createAnalyzeHooksWithPreviewsJobs,
  createExportFinalJob,
  createExtractAudioJob,
  createGeneratePreviewJob,
  createImportJob,
  createImportUrlJob,
  createTranscribeMockJob,
  createTranscribeClipJob,
  createTranscribeAudioJob,
  JobQueue,
  getYtDlpVersion,
  resolveYtDlpBinary
} from "../workers/jobQueue";
import { checkFfmpegAvailability, detectAvailableEncoders, resolveFfmpegBinary, scanMetadata } from "../ffmpeg/ffmpegEngine";
import { createExportPackSummary, deleteClip, listClips, updateClip } from "../services/clipService";
import { generateClipAssets, generateAllClipAssets } from "../services/assetService";
import type { ClipCandidate, ExportFinalPayload, TranscriptResult } from "../../shared/types";

let queue: JobQueue | undefined;

export function createIpcHandlers(getWindow: () => BrowserWindow | undefined) {
  queue = new JobQueue(getWindow);

  ipcMain.handle("project:create", (_event, name: string) => createProject(name));
  ipcMain.handle("project:list", () => listProjects());
  ipcMain.handle("project:open", (_event, projectId: string) => getProject(projectId));
  ipcMain.handle("project:delete", async (_event, projectId: string) => {
    requiredQueue().cancelProjectJobs(projectId);
    const win = getWindow();
    if (win) {
      try {
        win.webContents.send("project:pre-delete", projectId);
      } catch {}
      // give renderer a short moment to release video handles
      await new Promise((res) => setTimeout(res, 800));
    }
    await deleteProject(projectId);
  });

  ipcMain.handle("app:getSentryDsn", () => process.env.SENTRY_DSN ?? null);

  ipcMain.handle("video:import", (_event, projectId: string) => createImportJob(requiredQueue(), projectId));
  ipcMain.handle("video:importUrl", (_event, projectId: string, url: string) => createImportUrlJob(requiredQueue(), projectId, url));
  ipcMain.handle("video:scanMetadata", (_event, videoPath: string) => scanMetadata(videoPath));
  ipcMain.handle("ffmpeg:check", () => checkFfmpegAvailability());
  ipcMain.handle("ffmpeg:encoders", () => detectAvailableEncoders());

  ipcMain.handle("pipeline:start", (_event, projectId: string) => {
    const project = getProject(projectId);
    if (!project.originalVideoPath) throw new Error("Import video dulu sebelum memulai pipeline.");
    const jobs = [createExtractAudioJob(requiredQueue(), projectId)];
    return jobs;
  });

  ipcMain.handle("pipeline:transcribeMock", (_event, projectId: string) => createTranscribeMockJob(requiredQueue(), projectId));
  ipcMain.handle("pipeline:transcribeAudio", (_event, projectId: string) => createTranscribeAudioJob(requiredQueue(), projectId));
  ipcMain.handle("pipeline:analyzeHooks", (_event, projectId: string) => createAnalyzeHooksJob(requiredQueue(), projectId));
  ipcMain.handle("pipeline:analyzeHooksWithPreviews", (_event, projectId: string) => createAnalyzeHooksWithPreviewsJobs(requiredQueue(), projectId));

  ipcMain.handle("clip:generatePreview", (_event, projectId: string, clipId: string) => createGeneratePreviewJob(requiredQueue(), projectId, clipId));
  ipcMain.handle("clip:transcribe", (_event, projectId: string, clipId: string) => createTranscribeClipJob(requiredQueue(), projectId, clipId));
  ipcMain.handle("clip:exportFinal", (_event, projectId: string, clipId: string, options?: Partial<ExportFinalPayload>) =>
    createExportFinalJob(requiredQueue(), projectId, clipId, options)
  );
  ipcMain.handle("clip:list", (_event, projectId: string) => listClips(projectId));
  ipcMain.handle("clip:update", (_event, clip: ClipCandidate) => updateClip(clip));
  ipcMain.handle("clip:delete", (_event, projectId: string, clipId: string) => deleteClip(projectId, clipId));
  ipcMain.handle("clip:getTranscript", (_event, projectId: string, clipId?: string) => {
    const paths = projectPaths(projectId);
    const clipPath = clipId ? path.join(paths.transcripts, `${clipId}.json`) : undefined;
    const mainPath = path.join(paths.transcripts, "transcript.json");
    const targetPath = clipPath && fs.existsSync(clipPath) ? clipPath : (fs.existsSync(mainPath) ? mainPath : undefined);
    if (!targetPath) return null;
    return JSON.parse(fs.readFileSync(targetPath, "utf8"));
  });

  ipcMain.handle("clip:saveTranscript", (_event, projectId: string, clipId: string | undefined, transcript: TranscriptResult) => {
    const paths = projectPaths(projectId);
    const clipPath = clipId ? path.join(paths.transcripts, `${clipId}.json`) : undefined;
    const targetPath = clipPath || path.join(paths.transcripts, "transcript.json");
    fs.writeFileSync(targetPath, JSON.stringify(transcript, null, 2), "utf8");
  });
  ipcMain.handle("clip:createExportPackSummary", (_event, projectId: string) => createExportPackSummary(projectId));
  ipcMain.handle("clip:generateAssets", (_event, projectId: string, clipId: string) => generateClipAssets(projectId, clipId));
  ipcMain.handle("clip:generateAllAssets", (_event, projectId: string) => generateAllClipAssets(projectId));

  ipcMain.handle("job:list", (_event, projectId?: string) => requiredQueue().list(projectId));
  ipcMain.handle("job:cancel", (_event, jobId: string) => requiredQueue().cancel(jobId));
  ipcMain.handle("job:cancelOtherProjects", (_event, projectId: string) => requiredQueue().cancelOtherProjectJobs(projectId));
  ipcMain.handle("job:retry", (_event, jobId: string) => requiredQueue().retryJob(jobId));

  ipcMain.handle("settings:get", () => getSettings());
  ipcMain.handle("settings:update", (_event, patch) => updateSettings(patch));
  ipcMain.handle("shell:showItemInFolder", (_event, filePath: string) => {
    if (!fs.existsSync(filePath)) throw new Error(`File tidak ditemukan: ${filePath}`);
    shell.showItemInFolder(filePath);
  });
  ipcMain.handle("shell:openProjectFolder", async (_event, projectId: string) => {
    const project = getProject(projectId);
    if (!fs.existsSync(project.rootPath)) throw new Error(`Folder project tidak ditemukan: ${project.rootPath}`);
    const error = await shell.openPath(project.rootPath);
    if (error) throw new Error(error);
  });
  ipcMain.handle("shell:openProjectExportsFolder", async (_event, projectId: string) => {
    const exportsPath = projectPaths(projectId).exports;
    fs.mkdirSync(exportsPath, { recursive: true });
    const error = await shell.openPath(exportsPath);
    if (error) throw new Error(error);
  });
  ipcMain.handle("clipboard:copyText", (_event, text: string) => {
    clipboard.writeText(String(text ?? ""));
  });
  ipcMain.handle("app:cleanCache", async (_event, projectId?: string) => {
    const projectIds = projectId ? [projectId] : listProjects().map((p) => p.id);
    for (const pid of projectIds) {
      try {
        const paths = projectPaths(pid);
        for (const dir of [paths.audio, paths.transcripts, paths.previews, paths.exports, paths.subtitles]) {
          if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
          fs.mkdirSync(dir, { recursive: true });
        }
      } catch (err) {
        console.warn("Clean cache error for project", pid, err);
      }
    }
  });
  ipcMain.handle("app:diagnostics", async () => ({
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    platform: `${process.platform} ${process.arch}`,
    userDataPath: app.getPath("userData"),
    databasePath: path.join(app.getPath("userData"), "clipme.sqlite"),
    projectCount: listProjects().length,
    ffmpegPath: resolveFfmpegBinary("ffmpeg"),
    ffprobePath: resolveFfmpegBinary("ffprobe"),
    ytDlpPath: resolveYtDlpBinary(),
    ytDlpVersion: await getYtDlpVersion()
  }));

  ipcMain.handle("project:logs:list", (_event, projectId: string) => {
    const logsDir = projectPaths(projectId).logs;
    if (!fs.existsSync(logsDir)) return [];
    return fs
      .readdirSync(logsDir)
      .filter((f) => f.endsWith(".log"))
      .map((file) => {
        const full = path.join(logsDir, file);
        const stat = fs.statSync(full);
        return {
          name: file.replace(/\.log$/, ""),
          file: file,
          size: stat.size,
          mtimeMs: stat.mtimeMs
        };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  });

  ipcMain.handle("project:logs:read", (_event, projectId: string, logName: string, maxChars?: number) => {
    const logsDir = projectPaths(projectId).logs;
    const safe = String(logName ?? "").replace(/[^a-zA-Z0-9_\-]/g, "");
    const filePath = path.join(logsDir, `${safe}.log`);
    if (!fs.existsSync(filePath)) return "";
    const content = fs.readFileSync(filePath, "utf8");
    const limit = Math.max(1_000, maxChars ?? 20_000);
    return content.length > limit ? `${content.slice(-limit)}\n\n... (truncated)` : content;
  });
}

function requiredQueue() {
  if (!queue) throw new Error("Job queue is not initialized.");
  return queue;
}

