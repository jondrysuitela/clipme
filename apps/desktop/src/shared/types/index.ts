export type ProjectStatus = "empty" | "imported" | "processing" | "ready" | "exporting" | "completed" | "failed";

export type JobType =
  | "IMPORT_VIDEO"
  | "IMPORT_URL"
  | "EXTRACT_AUDIO"
  | "TRANSCRIBE_AUDIO"
  | "ANALYZE_HOOKS"
  | "GENERATE_PREVIEW"
  | "EXPORT_FINAL";

export type JobStatus = "waiting" | "running" | "completed" | "failed" | "canceled";
export type EncoderPreference = "auto" | "nvidia" | "intel" | "amd" | "cpu";
export type PerformanceMode = "fast" | "balanced" | "quality";
export type VerticalMode = "left-crop" | "center-crop" | "right-crop" | "blur-background" | "face-speaker-cut";
export type ThemeMode = "system" | "dark" | "light";
export type TranscriptionProviderId = "mock" | "whisper-cli";
export type ExportResolution = "1080x1920" | "720x1280" | "1080x1350";
export type ClipCurationStatus = "review" | "keep" | "skip";
export type MomentLabel = "Aha" | "Insight" | "Fakta mengejutkan" | "Lucu" | "Emosional" | "Inspiratif" | "Kontroversial" | "Viral" | "Hook" | "Retensi";
export type YtDlpCookiesBrowser = "none" | "chrome" | "edge" | "firefox";

export interface AppSettings {
  ffmpegPath?: string;
  ffprobePath?: string;
  defaultProjectFolder: string;
  encoderPreference: EncoderPreference;
  performanceMode: PerformanceMode;
  defaultExportResolution: ExportResolution;
  subtitleDefaultOn: boolean;
  subtitleFontSize: number;
  subtitlePosition: "bottom" | "middle";
  maxConcurrentJobs: number;
  theme: ThemeMode;
  transcriptionProvider: TranscriptionProviderId;
  transcriptionProviderInitialized?: boolean;
  whisperCommand?: string;
  whisperModel: "tiny" | "base" | "small" | "medium" | "large-v3";
  ytdlpCookiesBrowser: YtDlpCookiesBrowser;
  onboardingSeen?: boolean;
  captionTemplate?: string;
  telemetryEnabled?: boolean;
}

export interface Project {
  id: string;
  name: string;
  rootPath: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  originalVideoPath?: string;
  transcriptPath?: string;
  metadata?: VideoMetadata;
}

export interface ProjectFileStructure {
  root: string;
  original: string;
  audio: string;
  transcripts: string;
  previews: string;
  exports: string;
  subtitles: string;
  logs: string;
  manifest: string;
}

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  audioCodec: string;
  fileSize: number;
}

export interface FfmpegAvailability {
  ffmpegPath: string;
  ffprobePath: string;
  ffmpegOk: boolean;
  ffprobeOk: boolean;
  encoders: string[];
  error?: string;
}

export interface AppDiagnostics {
  appVersion: string;
  electronVersion: string;
  platform: string;
  userDataPath: string;
  databasePath: string;
  projectCount: number;
  ffmpegPath: string;
  ffprobePath: string;
  ytDlpPath: string;
  ytDlpVersion: string;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptResult {
  fullText: string;
  segments: TranscriptSegment[];
}

export interface ClipCandidate {
  id: string;
  projectId: string;
  title: string;
  startTime: number;
  endTime: number;
  duration: number;
  hookScore: number;
  reason: string;
  suggestedCaption: string;
  hashtags: string[];
  momentLabels?: MomentLabel[];
  assets?: ClipAssets;
  previewPath?: string;
  exportPath?: string;
  selected?: boolean;
  curationStatus?: ClipCurationStatus;
  reframeAnchors?: ReframeAnchor[];
}

export interface Job<TPayload = unknown> {
  id: string;
  projectId?: string;
  type: JobType;
  status: JobStatus;
  progress: number;
  payload: TPayload;
  result?: unknown;
  error?: JobError;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface JobError {
  message: string;
  command?: string;
  stderr?: string;
  likelyReason?: string;
}

export interface ClipAssets {
  seoDescription: string;
  keywords: string[];
  platformTags: Record<string, string[]>;
  thumbnailRecommendation?: ThumbnailRecommendation;
}

export interface ThumbnailRecommendation {
  framePath: string;
  score: number;
  timestamp: number;
}

export interface ImportVideoPayload {
  projectId: string;
  videoPath: string;
}

export interface ExtractAudioPayload {
  projectId: string;
  videoPath: string;
  outputAudioPath: string;
  duration?: number;
}

export interface TranscribeAudioPayload {
  projectId: string;
  clipId?: string;
  providerId?: TranscriptionProviderId;
}

export interface GeneratePreviewPayload {
  projectId: string;
  clipId: string;
}

export interface ExportFinalPayload {
  projectId: string;
  clipId: string;
  subtitleOn: boolean;
  verticalMode: VerticalMode;
  resolution?: ExportResolution;
  zoomEnabled?: boolean;
}

export interface ZoomEffectConfig {
  enabled: boolean;
  intensity: "subtle" | "moderate" | "strong";
  peakTime: number;
}

export interface ExportVerticalOptions {
  inputPath: string;
  outputPath: string;
  startTime: number;
  endTime: number;
  subtitlePath?: string;
  subtitleOn: boolean;
  verticalMode: VerticalMode;
  performanceMode: PerformanceMode;
  encoder: string;
  resolution: ExportResolution;
  fontSize: number;
  subtitlePosition: "bottom" | "middle";
  reframeAnchors?: ReframeAnchor[];
  zoomEnabled?: boolean;
}

export interface ReframeAnchor {
  start: number;
  end: number;
  centerX: number;
  centerY: number;
  confidence: number;
  source: "face" | "speaker" | "manual";
}

export interface IpcApi {
  createProject(name: string): Promise<Project>;
  listProjects(): Promise<Project[]>;
  openProject(projectId: string): Promise<Project>;
  deleteProject(projectId: string): Promise<void>;
  importVideo(projectId: string): Promise<Job>;
  importVideoFromUrl(projectId: string, url: string): Promise<Job>;
  scanMetadata(videoPath: string): Promise<VideoMetadata>;
  checkFfmpeg(): Promise<FfmpegAvailability>;
  listFfmpegEncoders(): Promise<string[]>;
  startPipeline(projectId: string): Promise<Job[]>;
  transcribeMock(projectId: string): Promise<Job>;
  transcribeAudio(projectId: string): Promise<Job>;
  analyzeHooks(projectId: string): Promise<Job>;
  analyzeHooksWithPreviews(projectId: string): Promise<Job[]>;
  generatePreview(projectId: string, clipId: string): Promise<Job>;
  transcribeClip(projectId: string, clipId: string): Promise<Job>;
  exportFinal(projectId: string, clipId: string, options?: Partial<ExportFinalPayload>): Promise<Job>;
  listJobs(projectId?: string): Promise<Job[]>;
  cancelJob(jobId: string): Promise<void>;
  cancelOtherProjectJobs(projectId: string): Promise<void>;
  getSettings(): Promise<AppSettings>;
  updateSettings(settings: Partial<AppSettings>): Promise<AppSettings>;
  listClips(projectId: string): Promise<ClipCandidate[]>;
  updateClip(clip: ClipCandidate): Promise<ClipCandidate>;
  deleteClip(projectId: string, clipId: string): Promise<void>;
  createExportPackSummary(projectId: string): Promise<string>;
  showItemInFolder(filePath: string): Promise<void>;
  openProjectFolder(projectId: string): Promise<void>;
  openProjectExportsFolder(projectId: string): Promise<void>;
  copyText(text: string): Promise<void>;
  getDiagnostics(): Promise<AppDiagnostics>;
  onJobUpdated(callback: (job: Job) => void): () => void;
  onUpdateAvailable(callback: (info: unknown) => void): () => void;
  onUpdateDownloaded(callback: (info: unknown) => void): () => void;
  onUpdateError(callback: (error: string) => void): () => void;
  getSentryDsn(): Promise<string | null>;
  onProjectPreDelete(callback: (projectId: string) => void): () => void;

  projectLogsList(projectId: string): Promise<Array<{ name: string; file: string; size: number; mtimeMs: number }>>;
  projectLogRead(projectId: string, logName: string, maxChars?: number): Promise<string>;

  generateClipAssets(projectId: string, clipId: string): Promise<ClipAssets>;
  generateAllClipAssets(projectId: string): Promise<number>;
  retryJob(jobId: string): Promise<Job>;
  cleanCache(projectId?: string): Promise<void>;

  getTranscript(projectId: string, clipId?: string): Promise<TranscriptResult | null>;
  saveTranscript(projectId: string, clipId: string | undefined, transcript: TranscriptResult): Promise<void>;
}




