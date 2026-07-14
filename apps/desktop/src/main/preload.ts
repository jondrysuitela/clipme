import { contextBridge, ipcRenderer } from "electron";
import type { AppDiagnostics, AppSettings, ClipAssets, ClipCandidate, ExportFinalPayload, FfmpegAvailability, IpcApi, Job, Project, TranscriptResult, VideoMetadata } from "../shared/types";

const api: IpcApi = {
  createProject: (name: string) => ipcRenderer.invoke("project:create", name) as Promise<Project>,
  listProjects: () => ipcRenderer.invoke("project:list") as Promise<Project[]>,
  openProject: (projectId: string) => ipcRenderer.invoke("project:open", projectId) as Promise<Project>,
  deleteProject: (projectId: string) => ipcRenderer.invoke("project:delete", projectId) as Promise<void>,
  importVideo: (projectId: string) => ipcRenderer.invoke("video:import", projectId) as Promise<Job>,
  importVideoFromUrl: (projectId: string, url: string) => ipcRenderer.invoke("video:importUrl", projectId, url) as Promise<Job>,
  scanMetadata: (videoPath: string) => ipcRenderer.invoke("video:scanMetadata", videoPath) as Promise<VideoMetadata>,
  checkFfmpeg: () => ipcRenderer.invoke("ffmpeg:check") as Promise<FfmpegAvailability>,
  listFfmpegEncoders: () => ipcRenderer.invoke("ffmpeg:encoders") as Promise<string[]>,
  startPipeline: (projectId: string) => ipcRenderer.invoke("pipeline:start", projectId) as Promise<Job[]>,
  transcribeMock: (projectId: string) => ipcRenderer.invoke("pipeline:transcribeMock", projectId) as Promise<Job>,
  transcribeAudio: (projectId: string) => ipcRenderer.invoke("pipeline:transcribeAudio", projectId) as Promise<Job>,
  analyzeHooks: (projectId: string) => ipcRenderer.invoke("pipeline:analyzeHooks", projectId) as Promise<Job>,
  analyzeHooksWithPreviews: (projectId: string) => ipcRenderer.invoke("pipeline:analyzeHooksWithPreviews", projectId) as Promise<Job[]>,
  generatePreview: (projectId: string, clipId: string) => ipcRenderer.invoke("clip:generatePreview", projectId, clipId) as Promise<Job>,
  transcribeClip: (projectId: string, clipId: string) => ipcRenderer.invoke("clip:transcribe", projectId, clipId) as Promise<Job>,
  exportFinal: (projectId: string, clipId: string, options?: Partial<ExportFinalPayload>) =>
    ipcRenderer.invoke("clip:exportFinal", projectId, clipId, options) as Promise<Job>,
  listJobs: (projectId?: string) => ipcRenderer.invoke("job:list", projectId) as Promise<Job[]>,
  cancelJob: (jobId: string) => ipcRenderer.invoke("job:cancel", jobId) as Promise<void>,
  cancelOtherProjectJobs: (projectId: string) => ipcRenderer.invoke("job:cancelOtherProjects", projectId) as Promise<void>,
  retryJob: (jobId: string) => ipcRenderer.invoke("job:retry", jobId) as Promise<Job>,
  getSettings: () => ipcRenderer.invoke("settings:get") as Promise<AppSettings>,
  updateSettings: (settings: Partial<AppSettings>) => ipcRenderer.invoke("settings:update", settings) as Promise<AppSettings>,
  listClips: (projectId: string) => ipcRenderer.invoke("clip:list", projectId) as Promise<ClipCandidate[]>,
  updateClip: (clip: ClipCandidate) => ipcRenderer.invoke("clip:update", clip) as Promise<ClipCandidate>,
  deleteClip: (projectId: string, clipId: string) => ipcRenderer.invoke("clip:delete", projectId, clipId) as Promise<void>,
  createExportPackSummary: (projectId: string) => ipcRenderer.invoke("clip:createExportPackSummary", projectId) as Promise<string>,
  generateClipAssets: (projectId: string, clipId: string) => ipcRenderer.invoke("clip:generateAssets", projectId, clipId) as Promise<ClipAssets>,
  generateAllClipAssets: (projectId: string) => ipcRenderer.invoke("clip:generateAllAssets", projectId) as Promise<number>,
  showItemInFolder: (filePath: string) => ipcRenderer.invoke("shell:showItemInFolder", filePath) as Promise<void>,
  openProjectFolder: (projectId: string) => ipcRenderer.invoke("shell:openProjectFolder", projectId) as Promise<void>,
  openProjectExportsFolder: (projectId: string) => ipcRenderer.invoke("shell:openProjectExportsFolder", projectId) as Promise<void>,
  copyText: (text: string) => ipcRenderer.invoke("clipboard:copyText", text) as Promise<void>,
  getDiagnostics: () => ipcRenderer.invoke("app:diagnostics") as Promise<AppDiagnostics>,
  cleanCache: (projectId?: string) => ipcRenderer.invoke("app:cleanCache", projectId) as Promise<void>,
  getTranscript: (projectId: string, clipId?: string) => ipcRenderer.invoke('clip:getTranscript', projectId, clipId) as Promise<TranscriptResult | null>,
  saveTranscript: (projectId: string, clipId: string | undefined, transcript: TranscriptResult) => ipcRenderer.invoke('clip:saveTranscript', projectId, clipId, transcript) as Promise<void>,
  onJobUpdated: (callback: (job: Job) => void) => {
    const listener = (_: Electron.IpcRendererEvent, job: Job) => callback(job);
    ipcRenderer.on("job:updated", listener);
    return () => ipcRenderer.removeListener("job:updated", listener);
  }
  ,onUpdateAvailable: (callback: (info: unknown) => void) => {
    const listener = (_: Electron.IpcRendererEvent, info: unknown) => callback(info);
    ipcRenderer.on("update:available", listener);
    return () => ipcRenderer.removeListener("update:available", listener);
  }
  ,onUpdateDownloaded: (callback: (info: unknown) => void) => {
    const listener = (_: Electron.IpcRendererEvent, info: unknown) => callback(info);
    ipcRenderer.on("update:downloaded", listener);
    return () => ipcRenderer.removeListener("update:downloaded", listener);
  }
  ,onUpdateError: (callback: (error: string) => void) => {
    const listener = (_: Electron.IpcRendererEvent, error: string) => callback(error);
    ipcRenderer.on("update:error", listener);
    return () => ipcRenderer.removeListener("update:error", listener);
  }
  ,getSentryDsn: () => ipcRenderer.invoke("app:getSentryDsn") as Promise<string | null>
  ,onProjectPreDelete: (callback: (projectId: string) => void) => {
    const listener = (_: Electron.IpcRendererEvent, projectId: string) => callback(projectId);
    ipcRenderer.on("project:pre-delete", listener);
    return () => ipcRenderer.removeListener("project:pre-delete", listener);
  }
  ,projectLogsList: (projectId: string) =>
    ipcRenderer.invoke("project:logs:list", projectId) as Promise<Array<{ name: string; file: string; size: number; mtimeMs: number }>>
  ,projectLogRead: (projectId: string, logName: string, maxChars?: number) =>
    ipcRenderer.invoke("project:logs:read", projectId, logName, maxChars) as Promise<string>

};


contextBridge.exposeInMainWorld("clipme", api);




