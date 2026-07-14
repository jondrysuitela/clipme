import { app, BrowserWindow } from "electron";
import path from "node:path";
import { getDb } from "../database/db";
import fs from "node:fs";
import {
  analyzeReframeAnchors,
  exportVerticalClip,
  extractAudio,
  extractAudioSegment,
  generatePreview,
  pickH264Encoder,
  resolveFfmpegBinary,
  scanMetadata,
  runProcess
} from "../ffmpeg/ffmpegEngine";

import { attachOriginalVideo, getProject, pickVideoFile, projectPaths, setProjectStatus } from "../services/projectService";
import { getSettings } from "../services/settingsService";
import { writeProjectLog } from "../services/logService";
import { createTranscriptionProvider } from "../transcription/providerFactory";
import { analyzeHooks, generateTimedHookCandidates, type HookVideoContext } from "../analyzer/hookAnalyzer";
import { buildClipAss } from "../captions/ass";
import { getClip, replaceClips, updateClip } from "../services/clipService";
import { createId } from "../utils/ids";
import type {
  ExportFinalPayload,
  ExtractAudioPayload,
  GeneratePreviewPayload,
  ImportVideoPayload,
  ClipCandidate,
  Job,
  JobError,
  JobStatus,
  JobType,
  TranscribeAudioPayload,
  TranscriptResult
} from "../../shared/types";

type JobHandler = (job: Job, signal: AbortSignal) => Promise<unknown>;

export class JobQueue {
  private running = 0;
  private canceled = new Set<string>();
  private controllers = new Map<string, AbortController>();
  private handlers: Record<JobType, JobHandler>;

  constructor(private getWindow: () => BrowserWindow | undefined) {
    this.handlers = {
      IMPORT_VIDEO: (job, signal) => this.handleImportVideo(job, signal),
      IMPORT_URL: (job, signal) => this.handleImportUrl(job, signal),
      EXTRACT_AUDIO: (job, signal) => this.handleExtractAudio(job, signal),
      TRANSCRIBE_AUDIO: (job, signal) => this.handleTranscribeAudio(job, signal),
      ANALYZE_HOOKS: (job, signal) => this.handleAnalyzeHooks(job, signal),
      GENERATE_PREVIEW: (job, signal) => this.handleGeneratePreview(job, signal),
      EXPORT_FINAL: (job, signal) => this.handleExportFinal(job, signal)
    };
    this.recoverInterruptedJobs();
  }

  enqueue<TPayload>(type: JobType, payload: TPayload, projectId?: string) {
    const timestamp = new Date().toISOString();
    const job: Job<TPayload> = {
      id: createId(12),
      projectId,
      type,
      status: "waiting",
      progress: 0,
      payload,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    getDb()
      .prepare(
        `INSERT INTO jobs (id, project_id, type, status, progress, payload_json, created_at, updated_at)
         VALUES (@id, @projectId, @type, @status, @progress, @payloadJson, @createdAt, @updatedAt)`
      )
      .run({ ...job, payloadJson: JSON.stringify(payload) });
    this.emit(job);
    void this.pump();
    return job;
  }

  list(projectId?: string) {
    const rows = projectId
      ? getDb().prepare("SELECT * FROM jobs WHERE project_id = ? ORDER BY created_at DESC").all(projectId)
      : getDb().prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 100").all();
    return rows.map(rowToJob);
  }

  cancel(jobId: string) {
    const job = this.get(jobId);
    if (!job) return;
    this.canceled.add(jobId);
    this.controllers.get(jobId)?.abort();
    if (job.status === "waiting" || job.status === "running") this.update(jobId, { status: "canceled", progress: job.progress });
  }

  cancelProjectJobs(projectId: string) {
    const jobs = this.list(projectId).filter((job) => job.status === "waiting" || job.status === "running");
    for (const job of jobs) this.cancel(job.id);
  }

  cancelOtherProjectJobs(projectId: string) {
    const jobs = this.list().filter((job) => job.projectId !== projectId && (job.status === "waiting" || job.status === "running"));
    for (const job of jobs) this.cancel(job.id);
  }

  retryJob(jobId: string) {
    const existing = this.get(jobId);
    if (!existing) throw new Error("Job not found: " + jobId);
    if (existing.status !== "failed") throw new Error("Only failed jobs can be retried.");
    return this.enqueue(existing.type, existing.payload, existing.projectId);
  }

  private async pump() {
    const maxConcurrent = Math.max(1, getSettings().maxConcurrentJobs);
    while (this.running < maxConcurrent) {
      const next = getDb()
        .prepare(
          `SELECT * FROM jobs
           WHERE status = 'waiting'
           ORDER BY
            CASE type
              WHEN 'IMPORT_VIDEO' THEN 0
              WHEN 'EXTRACT_AUDIO' THEN 1
              WHEN 'TRANSCRIBE_AUDIO' THEN 2
              WHEN 'ANALYZE_HOOKS' THEN 3
              WHEN 'GENERATE_PREVIEW' THEN 4
              WHEN 'EXPORT_FINAL' THEN 5
              ELSE 9
            END,
            created_at ASC
           LIMIT 1`
        )
        .get();
      if (!next) return;
      const job = rowToJob(next);
      this.running += 1;
      void this.run(job).finally(() => {
        this.running -= 1;
        void this.pump();
      });
    }
  }

  private async run(job: Job) {
    if (this.canceled.has(job.id)) {
      this.update(job.id, { status: "canceled" });
      return;
    }
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    this.update(job.id, { status: "running", progress: 1, startedAt: new Date().toISOString() });
    try {
      const result = await this.handlers[job.type](job, controller.signal);
      if (this.canceled.has(job.id)) {
        this.update(job.id, { status: "canceled" });
        return;
      }
      this.update(job.id, { status: "completed", progress: 100, result, completedAt: new Date().toISOString() });
    } catch (error) {
      if (this.canceled.has(job.id)) {
        this.update(job.id, { status: "canceled", completedAt: new Date().toISOString() });
        return;
      }
      const jobError = normalizeError(error);
      this.update(job.id, { status: "failed", error: jobError, completedAt: new Date().toISOString() });
      if (job.projectId) {
        writeProjectLog(job.projectId, "jobs", `${job.type} failed\n${jobError.message}\n${jobError.command ?? ""}\n${jobError.stderr ?? ""}`);
        setProjectStatus(job.projectId, "failed");
      }
    } finally {
      this.controllers.delete(job.id);
    }
  }

  private async handleImportUrl(job: Job, signal: AbortSignal) {
    const payload = job.payload as ImportVideoPayload;
    const project = getProject(payload.projectId);
    const sourceUrl = payload.videoPath;
    const paths = projectPaths(project.id);

    fs.mkdirSync(paths.original, { recursive: true });

    const ytdlpBin = resolveYtDlpBinary();
    const ffmpegLocation = path.dirname(resolveFfmpegBinary("ffmpeg"));
    const metadataOutputBase = path.join(paths.original, "metadata");
    const metadataOutput = `${metadataOutputBase}.mp4`;

    this.update(job.id, { progress: 8 });
    if (signal.aborted) throw new Error("Import canceled.");
    removeMatchingFiles(paths.original, ["metadata", "original-download"]);
    const sourceMetadata = await fetchSourceMetadata(sourceUrl, signal).catch(() => undefined);
    if (sourceMetadata) fs.writeFileSync(path.join(paths.original, "source-metadata.json"), JSON.stringify(sourceMetadata, null, 2), "utf8");

    const metadataArgs = [
      "-f",
      "bestvideo[height<=480]+bestaudio/best[height<=480]/best",
      "--merge-output-format",
      "mp4",
      "--ffmpeg-location",
      ffmpegLocation,
      "--no-playlist",
      ...ytDlpCookieArgs(),
      "-o",
      `${metadataOutputBase.replace(/\\/g, "/")}.%(ext)s`,
      sourceUrl
    ];

    await runYtDlp(ytdlpBin, metadataArgs, (p: number) => {
      const mapped = 10 + Math.round(p * 0.28);
      this.update(job.id, { progress: Math.min(38, Math.max(10, mapped)) });
    }, signal);

    if (signal.aborted) throw new Error("Import canceled.");
    this.update(job.id, { progress: 40 });

    assertDownloadedFile(metadataOutput, metadataOutputBase);
    const previewMetadata = await scanMetadata(metadataOutput);
    const previewProject = attachOriginalVideo(project.id, metadataOutput, previewMetadata);
    fs.writeFileSync(path.join(paths.original, "source-url.txt"), sourceUrl, "utf8");
    setProjectStatus(project.id, "imported");
    this.update(job.id, { progress: 98, result: previewProject });
    writeProjectLog(project.id, "import", `Imported URL metadata proxy\nURL: ${sourceUrl}\nDownloaded: ${metadataOutput}\n${JSON.stringify(previewMetadata, null, 2)}`);
    return previewProject;
  }

  private async handleImportVideo(job: Job, signal: AbortSignal) {
    const payload = job.payload as ImportVideoPayload;
    const project = getProject(payload.projectId);
    const videoPath = payload.videoPath;
    this.update(job.id, { progress: 15 });
    if (signal.aborted) throw new Error("Import canceled.");
    const metadata = await scanMetadata(videoPath);
    this.update(job.id, { progress: 65 });
    if (signal.aborted) throw new Error("Import canceled.");
    const updated = attachOriginalVideo(project.id, videoPath, metadata);
    this.update(job.id, { progress: 90 });
    writeProjectLog(project.id, "import", `Imported ${path.basename(videoPath)}\n${JSON.stringify(metadata, null, 2)}`);
    return updated;
  }

  private async handleExtractAudio(job: Job, signal: AbortSignal) {
    const payload = job.payload as ExtractAudioPayload;
    this.update(job.id, { progress: 5 });
    await extractAudio(payload.videoPath, payload.outputAudioPath, (progress) => {
      this.update(job.id, { progress: Math.min(95, Math.max(5, progress)) });
    }, signal, payload.duration);
    this.update(job.id, { progress: 98 });
    writeProjectLog(payload.projectId, "audio", `Extracted audio\nInput: ${payload.videoPath}\nOutput: ${payload.outputAudioPath}`);
    return { audioPath: payload.outputAudioPath };
  }

  private async handleTranscribeAudio(job: Job, signal: AbortSignal) {
    if (!job.projectId) throw new Error("Project id diperlukan untuk transcribe audio.");
    const project = getProject(job.projectId);
    const paths = projectPaths(job.projectId);
    const payload = job.payload as TranscribeAudioPayload;
    let audioPath = path.join(paths.audio, "original.wav");
    let transcriptPath = path.join(paths.transcripts, "transcript.json");
    let duration = project.metadata?.duration;

    if (payload.clipId) {
      if (!project.originalVideoPath) throw new Error("Original video belum ditemukan. Import video dulu.");
      const clip = getClip(job.projectId, payload.clipId);
      audioPath = path.join(paths.audio, `${clip.id}.wav`);
      transcriptPath = path.join(paths.transcripts, `${clip.id}.json`);
      duration = clip.duration;
      this.update(job.id, { progress: 5 });
      await extractAudioSegment(project.originalVideoPath, audioPath, clip.startTime, clip.endTime, (progress) => {
        this.update(job.id, { progress: Math.min(25, Math.max(5, progress)) });
      }, signal);
    }

    if (!fs.existsSync(audioPath)) throw new Error("Audio belum ditemukan. Jalankan Extract Audio dulu.");

    this.update(job.id, { progress: 10 });
    const settings = getSettings();
    const provider = createTranscriptionProvider(payload.providerId);
    const transcript = await provider.transcribeAudio(audioPath, duration, signal);
    this.update(job.id, { progress: 80 });

    fs.writeFileSync(transcriptPath, JSON.stringify(transcript, null, 2), "utf8");
    writeProjectLog(
      job.projectId,
      "transcription",
      `Transcript created\nProvider: ${settings.transcriptionProvider}\nScope: ${payload.clipId ? `clip ${payload.clipId}` : "full video"}\nAudio: ${audioPath}\nTranscript: ${transcriptPath}`
    );
    this.update(job.id, { progress: 95 });
    return { transcriptPath, segments: transcript.segments.length };
  }

  private async handleAnalyzeHooks(job: Job, signal: AbortSignal) {
    if (!job.projectId) throw new Error("Project id diperlukan untuk analyze hooks.");
    const project = getProject(job.projectId);
    const transcriptPath = path.join(projectPaths(job.projectId).transcripts, "transcript.json");

    this.update(job.id, { progress: 15 });
    const transcript = fs.existsSync(transcriptPath) ? (JSON.parse(fs.readFileSync(transcriptPath, "utf8")) as TranscriptResult) : undefined;
    const hasRealTranscript = Boolean(transcript && !transcript.fullText.toLowerCase().includes("transkrip mock"));
    const hookContext = await this.readHookVideoContext(job.projectId, job.id, signal);
    const clips = hasRealTranscript ? analyzeHooks(job.projectId, transcript!.segments) : generateTimedHookCandidates(job.projectId, project.metadata?.duration ?? 0, hookContext);

    if (clips.length === 0) throw new Error("Tidak bisa membuat hook candidate. Metadata durasi video belum tersedia.");

    this.update(job.id, { progress: 45 });
    const shouldBuildSmartCrop = Boolean(project.originalVideoPath && (job.payload as { enqueuePreviews?: boolean }).enqueuePreviews);
    const clipsWithAnchors = shouldBuildSmartCrop
      ? await this.attachSmartCropAnchors(job.id, project.originalVideoPath!, clips, signal)
      : clips;

    this.update(job.id, { progress: 75 });
    replaceClips(job.projectId, clipsWithAnchors);
    if ((job.payload as { enqueuePreviews?: boolean }).enqueuePreviews) {
      for (const clip of clipsWithAnchors) {
        this.enqueue<GeneratePreviewPayload>("GENERATE_PREVIEW", { projectId: job.projectId, clipId: clip.id }, job.projectId);
      }
    }
    writeProjectLog(
      job.projectId,
      "analyzer",
      `Generated ${clips.length} hook candidates using ${hasRealTranscript ? "transcript" : "timed preview-first"} mode.`
    );
    this.update(job.id, { progress: 95 });
    return { clips: clipsWithAnchors.length, smartCrop: shouldBuildSmartCrop };
  }

  private async handleGeneratePreview(job: Job, signal: AbortSignal) {
    const payload = job.payload as GeneratePreviewPayload;
    const project = getProject(payload.projectId);
    if (!project.originalVideoPath) throw new Error("Original video belum ditemukan. Import video dulu.");

    const clip = getClip(payload.projectId, payload.clipId);
    const reframeAnchors = clip.reframeAnchors?.length
      ? clip.reframeAnchors
      : await analyzeReframeAnchors(project.originalVideoPath, clip.startTime, clip.endTime, signal).catch(() => []);
    const clipForPreview = reframeAnchors.length && !clip.reframeAnchors?.length ? updateClip({ ...clip, reframeAnchors }) : clip;
    const outputPath = path.join(projectPaths(payload.projectId).previews, `${clip.id}.mp4`);
    this.update(job.id, { progress: 5 });

    await generatePreview(project.originalVideoPath, clip.startTime, clip.endTime, outputPath, getSettings().performanceMode, (progress) => {
      this.update(job.id, { progress: Math.min(95, Math.max(5, progress)) });
    }, signal, "face-speaker-cut", reframeAnchors);

    const updated = updateClip({ ...clipForPreview, previewPath: outputPath });
    writeProjectLog(payload.projectId, "preview", `Generated preview\nClip: ${clip.id}\nOutput: ${outputPath}`);
    this.update(job.id, { progress: 98 });
    return updated;
  }

  private async handleExportFinal(job: Job, signal: AbortSignal) {
    const payload = job.payload as ExportFinalPayload;
    const project = getProject(payload.projectId);
    if (!project.originalVideoPath) throw new Error("Original video belum ditemukan. Import video dulu.");

    const paths = projectPaths(payload.projectId);
    const clip = getClip(payload.projectId, payload.clipId);
    const settings = getSettings();
    const resolution = payload.resolution ?? settings.defaultExportResolution;
    const exportSource = await this.prepareExportSource(payload.projectId, project.originalVideoPath, clip.startTime, clip.endTime, job.id, signal);
    const outputPath = path.join(paths.exports, `${sanitizeFileName(clip.title)}-${clip.id}-${resolution}.mp4`);
    const clipTranscriptPath = path.join(paths.transcripts, `${payload.clipId}.json`);
    const transcriptPath = fs.existsSync(clipTranscriptPath) ? clipTranscriptPath : path.join(paths.transcripts, "transcript.json");
    let subtitlePath: string | undefined;

    if (payload.subtitleOn && fs.existsSync(transcriptPath)) {
      const transcript = JSON.parse(fs.readFileSync(transcriptPath, "utf8")) as TranscriptResult;
      const isMockTranscript = transcript.fullText.toLowerCase().includes("transkrip mock");
      if (!isMockTranscript) {
        subtitlePath = path.join(paths.subtitles, `${clip.id}.ass`);
        fs.writeFileSync(
          subtitlePath,
          buildClipAss(transcript.segments, clip.startTime, clip.endTime, settings.subtitleFontSize, settings.subtitlePosition),
          "utf8"
        );
      }
    }

    this.update(job.id, { progress: 8 });
    const encoder = await pickH264Encoder();
    const baseOptions = {
      inputPath: exportSource.inputPath,
      outputPath,
      startTime: exportSource.startTime,
      endTime: exportSource.endTime,
      subtitlePath,
      verticalMode: payload.verticalMode,
      performanceMode: settings.performanceMode,
      resolution,
      fontSize: settings.subtitleFontSize,
      subtitlePosition: settings.subtitlePosition,
      reframeAnchors: clip.reframeAnchors
    };

    const attempts = [
      { encoder, subtitleOn: Boolean(payload.subtitleOn && subtitlePath), reason: "preferred settings" },
      { encoder, subtitleOn: false, reason: "subtitle fallback" },
      { encoder: "libx264", subtitleOn: Boolean(payload.subtitleOn && subtitlePath), reason: "CPU encoder fallback" },
      { encoder: "libx264", subtitleOn: false, reason: "CPU encoder without subtitle fallback" }
    ].filter((attempt, index, all) => {
      return all.findIndex((item) => item.encoder === attempt.encoder && item.subtitleOn === attempt.subtitleOn) === index;
    });

    let lastError: unknown;
    let usedEncoder = encoder;
    let usedSubtitle = Boolean(payload.subtitleOn && subtitlePath);

    for (const attempt of attempts) {
      try {
        usedEncoder = attempt.encoder;
        usedSubtitle = attempt.subtitleOn;
        if (attempt.reason !== "preferred settings") {
          writeProjectLog(payload.projectId, "export", `Retrying export with ${attempt.reason}: encoder=${attempt.encoder}, subtitle=${attempt.subtitleOn}`);
        }
        await exportVerticalClip(
          {
            ...baseOptions,
            encoder: attempt.encoder,
            subtitleOn: attempt.subtitleOn
          },
          (progress) => {
            const range = 95 - exportSource.progressStart;
            this.update(job.id, { progress: Math.min(95, Math.max(exportSource.progressStart, exportSource.progressStart + Math.round(progress * (range / 100)))) });
          },
          signal
        );
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError) throw lastError;

    const updated = updateClip({ ...clip, exportPath: outputPath, selected: true });
    writeProjectLog(payload.projectId, "export", `Exported final clip\nClip: ${clip.id}\nResolution: ${resolution}\nEncoder: ${usedEncoder}\nSubtitle: ${usedSubtitle}\nOutput: ${outputPath}`);
    this.update(job.id, { progress: 98 });
    return updated;
  }

  private async prepareExportSource(
    projectId: string,
    currentInputPath: string,
    startTime: number,
    endTime: number,
    jobId: string,
    signal: AbortSignal
  ) {
    const paths = projectPaths(projectId);
    const sourceUrlPath = path.join(paths.original, "source-url.txt");
    const sourceUrl = fs.existsSync(sourceUrlPath) ? fs.readFileSync(sourceUrlPath, "utf8").trim() : getImportSourceUrl(projectId);
    if (!sourceUrl) return { inputPath: currentInputPath, startTime, endTime, progressStart: 8 };
    if (!fs.existsSync(sourceUrlPath)) fs.writeFileSync(sourceUrlPath, sourceUrl, "utf8");

    const duration = Math.max(0.1, endTime - startTime);
    const sourceDir = path.join(paths.original, "export-sources");
    fs.mkdirSync(sourceDir, { recursive: true });
    const outputBase = path.join(sourceDir, `${Math.round(startTime)}-${Math.round(endTime)}`);
    const outputPath = `${outputBase}.mp4`;

    if (!fs.existsSync(outputPath)) {
      removeMatchingFiles(sourceDir, [path.basename(outputBase)]);
      this.update(jobId, { progress: 8 });
      const ytdlpBin = resolveYtDlpBinary();
      const ffmpegLocation = path.dirname(resolveFfmpegBinary("ffmpeg"));
      const args = [
        "-f",
        "bestvideo[height<=1920]+bestaudio/best[height<=1920]/best",
        "--merge-output-format",
        "mp4",
        "--ffmpeg-location",
        ffmpegLocation,
        "--no-playlist",
        ...ytDlpCookieArgs(),
        "--download-sections",
        `*${formatTimestamp(startTime)}-${formatTimestamp(endTime)}`,
        "-o",
        `${outputBase.replace(/\\/g, "/")}.%(ext)s`,
        sourceUrl
      ];
      await runYtDlp(ytdlpBin, args, (progress) => {
        this.update(jobId, { progress: Math.min(35, 8 + Math.round(progress * 0.27)) });
      }, signal);
      assertDownloadedFile(outputPath, outputBase);
      writeProjectLog(projectId, "export", `Downloaded high-resolution export source\nURL: ${sourceUrl}\nSection: ${formatTimestamp(startTime)}-${formatTimestamp(endTime)}\nOutput: ${outputPath}`);
    }

    return { inputPath: outputPath, startTime: 0, endTime: duration, progressStart: 35 };
  }

  private async attachSmartCropAnchors(jobId: string, videoPath: string, clips: ClipCandidate[], signal: AbortSignal) {
    const next = [];
    for (let index = 0; index < clips.length; index += 1) {
      if (signal.aborted) throw new Error("Analyze canceled.");
      const clip = clips[index];
      const progress = 45 + Math.round((index / Math.max(1, clips.length)) * 25);
      this.update(jobId, { progress });
      try {
        const reframeAnchors = await analyzeReframeAnchors(videoPath, clip.startTime, clip.endTime, signal);
        next.push({ ...clip, reframeAnchors });
      } catch {
        next.push(clip);
      }
    }
    return next;
  }

  private async readHookVideoContext(projectId: string, jobId?: string, signal?: AbortSignal): Promise<HookVideoContext> {
    const paths = projectPaths(projectId);
    const metadataPath = path.join(paths.original, "source-metadata.json");
    if (!fs.existsSync(metadataPath)) {
      const sourceUrl = getImportSourceUrl(projectId);
      if (sourceUrl) {
        try {
          if (jobId) this.update(jobId, { progress: 20 });
          const sourceMetadata = await fetchSourceMetadata(sourceUrl, signal);
          fs.writeFileSync(metadataPath, JSON.stringify(sourceMetadata, null, 2), "utf8");
        } catch {
          return {};
        }
      } else {
        return {};
      }
    }
    try {
      const data = JSON.parse(fs.readFileSync(metadataPath, "utf8")) as any;
      return {
        title: data.title,
        uploader: data.uploader ?? data.channel,
        description: data.description,
        tags: Array.isArray(data.tags) ? data.tags : undefined,
        categories: Array.isArray(data.categories) ? data.categories : data.category ? [data.category] : undefined
      };
    } catch {
      return {};
    }
  }

  private update(jobId: string, patch: Partial<Job>) {
    const existing = this.get(jobId);
    if (!existing) return;
    const next = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    getDb()
      .prepare(
        `UPDATE jobs SET
          status = @status,
          progress = @progress,
          result_json = @resultJson,
          error_json = @errorJson,
          updated_at = @updatedAt,
          started_at = @startedAt,
          completed_at = @completedAt
        WHERE id = @id`
      )
      .run({
        ...next,
        resultJson: next.result ? JSON.stringify(next.result) : null,
        errorJson: next.error ? JSON.stringify(next.error) : null
      });
    this.emit(next);
  }

  private get(jobId: string) {
    const row = getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
    return row ? rowToJob(row) : undefined;
  }

  private emit(job: Job) {
    this.getWindow()?.webContents.send("job:updated", job);
  }

  private recoverInterruptedJobs() {
    const timestamp = new Date().toISOString();
    getDb()
      .prepare(
        `UPDATE jobs SET
          status = 'failed',
          error_json = @errorJson,
          updated_at = @updatedAt,
          completed_at = @updatedAt
        WHERE status IN ('running', 'waiting')`
      )
      .run({
        errorJson: JSON.stringify({ message: "Job interrupted because the app was restarted." }),
        updatedAt: timestamp
      });
  }
}

export async function createImportJob(queue: JobQueue, projectId: string) {
  const videoPath = await pickVideoFile();
  if (!videoPath) throw new Error("Import dibatalkan.");
  return queue.enqueue<ImportVideoPayload>("IMPORT_VIDEO", { projectId, videoPath }, projectId);
}

export function createImportUrlJob(queue: JobQueue, projectId: string, url: string) {
  const parsedUrl = new URL(url.trim());
  if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error("URL harus diawali http:// atau https://.");
  return queue.enqueue<ImportVideoPayload>("IMPORT_URL", { projectId, videoPath: parsedUrl.toString() }, projectId);
}

export function createExtractAudioJob(queue: JobQueue, projectId: string) {
  const project = getProject(projectId);
  if (!project.originalVideoPath) throw new Error("Import video dulu sebelum extract audio.");
  const outputAudioPath = path.join(projectPaths(projectId).audio, "original.wav");
  return queue.enqueue<ExtractAudioPayload>(
    "EXTRACT_AUDIO",
      {
        projectId,
        videoPath: project.originalVideoPath,
        outputAudioPath,
        duration: project.metadata?.duration
      },
    projectId
  );
}

export function createTranscribeAudioJob(queue: JobQueue, projectId: string) {
  return queue.enqueue<TranscribeAudioPayload>("TRANSCRIBE_AUDIO", { projectId }, projectId);
}

export function createTranscribeMockJob(queue: JobQueue, projectId: string) {
  return queue.enqueue<TranscribeAudioPayload>("TRANSCRIBE_AUDIO", { projectId, providerId: "mock" }, projectId);
}

export function createAnalyzeHooksJob(queue: JobQueue, projectId: string) {
  return queue.enqueue("ANALYZE_HOOKS", { projectId, analyzer: "rule-based" }, projectId);
}

export function createAnalyzeHooksWithPreviewsJobs(queue: JobQueue, projectId: string) {
  const analyzeJob = queue.enqueue("ANALYZE_HOOKS", { projectId, analyzer: "timed-preview-first", enqueuePreviews: true }, projectId);
  return [analyzeJob];
}

export function createGeneratePreviewJob(queue: JobQueue, projectId: string, clipId: string) {
  return queue.enqueue<GeneratePreviewPayload>("GENERATE_PREVIEW", { projectId, clipId }, projectId);
}

export function createTranscribeClipJob(queue: JobQueue, projectId: string, clipId: string) {
  return queue.enqueue<TranscribeAudioPayload>("TRANSCRIBE_AUDIO", { projectId, clipId }, projectId);
}

export function createExportFinalJob(queue: JobQueue, projectId: string, clipId: string, options?: Partial<ExportFinalPayload>) {
  return queue.enqueue<ExportFinalPayload>(
    "EXPORT_FINAL",
    {
      projectId,
      clipId,
      subtitleOn: options?.subtitleOn ?? false,
      verticalMode: options?.verticalMode ?? "center-crop",
      resolution: options?.resolution
    },
    projectId
  );
}

function sanitizeFileName(value: string) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 48) || "clip";
}

function rowToJob(row: any): Job {
  return {
    id: row.id,
    projectId: row.project_id ?? undefined,
    type: row.type,
    status: row.status as JobStatus,
    progress: row.progress,
    payload: JSON.parse(row.payload_json),
    result: row.result_json ? JSON.parse(row.result_json) : undefined,
    error: row.error_json ? JSON.parse(row.error_json) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined
  };
}

function removeMatchingFiles(directory: string, prefixes: string[]) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory)) {
    const ext = path.extname(entry);
    const base = ext ? entry.slice(0, -ext.length) : entry;
    if (!prefixes.some((prefix) => entry === prefix || base === prefix)) continue;
    fs.rmSync(path.join(directory, entry), { force: true });
  }
}

function assertDownloadedFile(expectedPath: string, outputBase: string) {
  if (fs.existsSync(expectedPath)) return;
  const directory = path.dirname(outputBase);
  const prefix = path.basename(outputBase);
  const leftovers = fs.existsSync(directory)
    ? fs.readdirSync(directory).filter((entry) => entry === prefix || entry.startsWith(`${prefix}.`) || entry.startsWith(`${prefix}-`))
    : [];
  throw new Error(
    leftovers.length > 0
      ? `yt-dlp downloaded fragments but did not create ${path.basename(expectedPath)}. Files: ${leftovers.join(", ")}`
      : `yt-dlp did not create ${path.basename(expectedPath)}.`
  );
}

function getImportSourceUrl(projectId: string) {
  const row = getDb()
    .prepare("SELECT payload_json FROM jobs WHERE project_id = ? AND type = 'IMPORT_URL' ORDER BY created_at DESC LIMIT 1")
    .get(projectId) as { payload_json?: string } | undefined;
  if (!row?.payload_json) return undefined;
  try {
    const payload = JSON.parse(row.payload_json) as Partial<ImportVideoPayload>;
    return payload.videoPath?.startsWith("http") ? payload.videoPath : undefined;
  } catch {
    return undefined;
  }
}

function fetchSourceMetadata(sourceUrl: string, signal?: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const { spawn } = require("node:child_process") as typeof import("node:child_process");
    const ytdlpBin = resolveYtDlpBinary();
    const child = spawn(ytdlpBin, ["--dump-single-json", "--skip-download", "--no-playlist", ...ytDlpCookieArgs(), sourceUrl], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let aborted = false;

    const abort = () => {
      aborted = true;
      child.kill();
    };
    signal?.addEventListener("abort", abort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      signal?.removeEventListener("abort", abort);
      reject(error);
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      if (aborted || signal?.aborted) {
        reject(new Error("Metadata fetch canceled."));
        return;
      }
      if (code !== 0) {
        reject(new Error(stderr || `yt-dlp metadata exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(error);
      }
    });
  });
}

export function resolveYtDlpBinary() {
  if (process.env.YTDLP_BIN) return process.env.YTDLP_BIN;

  const exe = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
  const resourcePath = process.resourcesPath ? path.join(process.resourcesPath, "yt-dlp", exe) : "";
  const devPath = path.join(app.getAppPath(), "resources", "yt-dlp", exe);

  if (resourcePath && fs.existsSync(resourcePath)) return resourcePath;
  if (fs.existsSync(devPath)) return devPath;
  return "yt-dlp";
}

export function getYtDlpVersion(): Promise<string> {
  return new Promise((resolve) => {
    const { spawn } = require("node:child_process") as typeof import("node:child_process");
    const child = spawn(resolveYtDlpBinary(), ["--version"], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", () => resolve("unavailable"));
    child.on("close", (code) => {
      resolve(code === 0 ? stdout.trim() || "unknown" : stderr.trim() || "unavailable");
    });
  });
}

function ytDlpCookieArgs() {
  const browser = getSettings().ytdlpCookiesBrowser;
  if (!browser || browser === "none") return [];
  return ["--cookies-from-browser", browser];
}

function formatTimestamp(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  const whole = Math.floor(safeSeconds);
  const millis = Math.round((safeSeconds - whole) * 1000);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  const base = `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  return millis > 0 ? `${base}.${String(millis).padStart(3, "0")}` : base;
}

function runYtDlp(
  ytDlpBin: string,
  args: string[],
  onProgress?: (progress: number) => void,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const { spawn } = require("node:child_process") as typeof import("node:child_process");
    const child = spawn(ytDlpBin, args, { windowsHide: true }) as any;
    const command = `${ytDlpBin} ${args.map((arg) => (/\s/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg)).join(" ")}`;


    let stderr = "";
    let lastProgress = 0;

    const abort = () => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      reject(new Error("Import canceled."));
    };

    if (signal) {
      if (signal.aborted) return abort();
      signal.addEventListener("abort", abort, { once: true });
    }

    const parseProgress = () => {
      // yt-dlp usually prints percentage for some formats; if not, fallback to 0..100-ish.
      // We try a few common patterns.
      const matches = [...stderr.matchAll(/(\d{1,3}(?:\.\d+)?)%/g)];
      const match = matches.at(-1);
      if (match) {
        const v = Number(match[1]);
        if (Number.isFinite(v)) {
          lastProgress = Math.max(lastProgress, Math.min(100, Math.round(v)));
          onProgress?.(lastProgress);
        }
      }
    };

    child.stdout.on("data", (chunk: Buffer) => {
      // Some outputs go to stdout; treat similarly.
      const text = chunk.toString();
      stderr += text;
      parseProgress();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      parseProgress();
    });

    child.on("error", (err: unknown) => {
      reject(withYtDlpDetails(err, command, stderr));
    });

    child.on("close", (code: number | null) => {
      if (signal) signal.removeEventListener("abort", abort as any);
      if (code === 0) {
        onProgress?.(100);
        resolve();
      } else {
        reject(withYtDlpDetails(new Error(`yt-dlp exited with code ${code}`), command, stderr));
      }
    });
  });
}

function withYtDlpDetails(error: unknown, command: string, stderr: string) {
  const next = error instanceof Error ? error : new Error(String(error));
  const detail = next as Error & { command?: string; stderr?: string; likelyReason?: string };
  const combined = `${next.message}\n${stderr}`;
  detail.command = command;
  detail.stderr = stderr.slice(-4000);
  detail.likelyReason = inferYtDlpReason(combined);
  return detail;
}

function inferYtDlpReason(stderr: string) {
  const lower = stderr.toLowerCase();
  if (lower.includes("enoent") || lower.includes("not found") || lower.includes("no such file")) {
    return "yt-dlp tidak ditemukan atau output file tidak bisa dibuat. Pastikan installer terbaru dipakai.";
  }
  if (lower.includes("sign in to confirm") || lower.includes("not a bot") || lower.includes("confirm you're not a bot")) {
    return "Platform meminta login/anti-bot. Di Settings, coba URL cookies = Chrome/Edge/Firefox pada laptop yang login browser.";
  }
  if (lower.includes("http error 403") || lower.includes("forbidden")) {
    return "Platform menolak request dari jaringan/IP ini (HTTP 403). Coba hotspot lain atau aktifkan URL cookies dari browser.";
  }
  if (lower.includes("unsupported url")) {
    return "URL tidak didukung oleh yt-dlp. Coba URL video langsung, bukan halaman playlist/profile.";
  }
  if (lower.includes("requested format is not available") || lower.includes("no video formats found")) {
    return "Format video yang diminta tidak tersedia dari sumber. Coba URL lain atau update yt-dlp.";
  }
  if (lower.includes("failed to decrypt") || lower.includes("cookies") || lower.includes("cookie")) {
    return "Gagal membaca cookies browser. Tutup browser lalu coba lagi, atau ubah URL cookies ke browser lain.";
  }
  if (lower.includes("timed out") || lower.includes("unable to download webpage") || lower.includes("name resolution") || lower.includes("connection")) {
    return "Koneksi/jaringan gagal mengakses sumber video. Coba jaringan lain atau cek firewall/proxy.";
  }
  return "yt-dlp gagal download video. Cek URL, koneksi, restriction platform, atau aktifkan URL cookies dari browser.";
}

function normalizeError(error: unknown): JobError {
  if (error && typeof error === "object") {
    const candidate = error as { message?: string; command?: string; stderr?: string; likelyReason?: string };
    return {
      message: candidate.message ?? "Unknown error",
      command: candidate.command,
      stderr: candidate.stderr,
      likelyReason: candidate.likelyReason
    };
  }
  return { message: String(error) };
}
