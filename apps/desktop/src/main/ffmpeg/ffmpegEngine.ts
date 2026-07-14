import { app } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ExportVerticalOptions, FfmpegAvailability, PerformanceMode, ReframeAnchor, VideoMetadata } from "../../shared/types";
import { detectFaces, facesToReframeAnchors } from "../services/faceDetectionService";
import { getSettings } from "../services/settingsService";

export interface RunResult {
  stdout: string;
  stderr: string;
  command: string;
}

export class FfmpegError extends Error {
  command: string;
  stderr: string;
  likelyReason: string;

  constructor(message: string, command: string, stderr: string) {
    super(message);
    this.command = command;
    this.stderr = stderr.slice(-4000);
    this.likelyReason = inferReason(`${message}\n${stderr}`);
  }
}

export function resolveFfmpegBinary(binary: "ffmpeg" | "ffprobe") {
  const settings = getSettings();
  const configured = binary === "ffmpeg" ? settings.ffmpegPath : settings.ffprobePath;
  if (configured) return configured;

  const exe = process.platform === "win32" ? `${binary}.exe` : binary;
  const resourcePath = process.resourcesPath ? path.join(process.resourcesPath, "ffmpeg", exe) : "";
  const devPath = path.join(app.getAppPath(), "resources", "ffmpeg", exe);
  if (resourcePath && fs.existsSync(resourcePath)) return resourcePath;
  if (fs.existsSync(devPath)) return devPath;
  const staticBinary = resolveStaticBinary(binary);
  if (staticBinary) return staticBinary;
  return exe;
}

function resolveStaticBinary(binary: "ffmpeg" | "ffprobe") {
  try {
    if (binary === "ffmpeg") {
      const ffmpegPath = require("ffmpeg-static") as string | null;
      return ffmpegPath || undefined;
    }
    const ffprobe = require("ffprobe-static") as { path?: string };
    return ffprobe.path;
  } catch {
    return undefined;
  }
}

export function runProcess(
  binary: string,
  args: string[],
  onProgress?: (progress: number, stderr: string) => void,
  signal?: AbortSignal,
  durationSeconds?: number
): Promise<RunResult> {
  const command = `${binary} ${args.map(quoteArg).join(" ")}`;
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true });
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
      onProgress?.(parseFfmpegProgress(stderr, durationSeconds), stderr);
    });
    child.on("error", (error) => {
      signal?.removeEventListener("abort", abort);
      reject(new FfmpegError(error.message, command, stderr));
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      if (aborted || signal?.aborted) {
        reject(new FfmpegError("Process canceled", command, stderr));
        return;
      }
      if (code === 0) resolve({ stdout, stderr, command });
      else reject(new FfmpegError(`FFmpeg exited with code ${code}`, command, stderr));
    });
  });
}

export async function scanMetadata(videoPath: string): Promise<VideoMetadata> {
  const ffprobe = resolveFfmpegBinary("ffprobe");
  const { stdout } = await runProcess(ffprobe, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    videoPath
  ]);
  const data = JSON.parse(stdout);
  const video = data.streams?.find((stream: any) => stream.codec_type === "video");
  const audio = data.streams?.find((stream: any) => stream.codec_type === "audio");
  const fps = parseFraction(video?.avg_frame_rate || video?.r_frame_rate || "0/1");
  return {
    duration: Number(data.format?.duration ?? video?.duration ?? 0),
    width: Number(video?.width ?? 0),
    height: Number(video?.height ?? 0),
    fps,
    videoCodec: video?.codec_name ?? "unknown",
    audioCodec: audio?.codec_name ?? "none",
    fileSize: Number(data.format?.size ?? fs.statSync(videoPath).size)
  };
}

export async function detectAvailableEncoders() {
  const ffmpeg = resolveFfmpegBinary("ffmpeg");
  const { stdout } = await runProcess(ffmpeg, ["-hide_banner", "-encoders"]);
  const encoders = ["h264_nvenc", "h264_qsv", "h264_amf", "libx264"];
  return encoders.filter((encoder) => stdout.includes(encoder));
}

export async function checkFfmpegAvailability(): Promise<FfmpegAvailability> {
  const ffmpegPath = resolveFfmpegBinary("ffmpeg");
  const ffprobePath = resolveFfmpegBinary("ffprobe");
  const result: FfmpegAvailability = {
    ffmpegPath,
    ffprobePath,
    ffmpegOk: false,
    ffprobeOk: false,
    encoders: []
  };

  try {
    await runProcess(ffmpegPath, ["-version"]);
    result.ffmpegOk = true;
  } catch (error) {
    result.error = normalizeCheckError(error);
  }

  try {
    await runProcess(ffprobePath, ["-version"]);
    result.ffprobeOk = true;
  } catch (error) {
    result.error = result.error ?? normalizeCheckError(error);
  }

  if (result.ffmpegOk) {
    result.encoders = await detectAvailableEncoders().catch(() => []);
  }

  return result;
}

export async function pickH264Encoder() {
  const preference = getSettings().encoderPreference;
  const available = await detectAvailableEncoders().catch(() => ["libx264"]);
  const preferenceMap = {
    auto: ["h264_nvenc", "h264_qsv", "h264_amf", "libx264"],
    nvidia: ["h264_nvenc", "libx264"],
    intel: ["h264_qsv", "libx264"],
    amd: ["h264_amf", "libx264"],
    cpu: ["libx264"]
  } satisfies Record<string, string[]>;
  return preferenceMap[preference].find((encoder) => available.includes(encoder)) ?? "libx264";
}

export async function extractAudio(
  videoPath: string,
  outputAudioPath: string,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
  durationSeconds?: number
) {
  const ffmpeg = resolveFfmpegBinary("ffmpeg");
  await runProcess(ffmpeg, ["-y", "-i", videoPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", outputAudioPath], (progress) =>
    onProgress?.(progress)
  , signal, durationSeconds);
}

export async function extractAudioSegment(
  videoPath: string,
  outputAudioPath: string,
  startTime: number,
  endTime: number,
  onProgress?: (progress: number) => void
  ,
  signal?: AbortSignal
) {
  const ffmpeg = resolveFfmpegBinary("ffmpeg");
  await runProcess(
    ffmpeg,
    [
      "-y",
      "-ss",
      String(startTime),
      "-i",
      videoPath,
      "-t",
      String(Math.max(0.1, endTime - startTime)),
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      outputAudioPath
    ],
    (progress) => onProgress?.(progress),
    signal,
    Math.max(0.1, endTime - startTime)
  );
}

export async function generatePreview(
  inputPath: string,
  startTime: number,
  endTime: number,
  outputPath: string,
  mode: PerformanceMode,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
  verticalMode = "face-speaker-cut",
  reframeAnchors: ReframeAnchor[] = []
) {
  const ffmpeg = resolveFfmpegBinary("ffmpeg");
  const duration = Math.max(0.1, endTime - startTime);
  const resolution = mode === "fast" ? "360x640" : "540x960";
  const [width, height] = resolution.split("x").map(Number);
  const videoFilter = buildVerticalFilter(verticalMode, width, height, undefined, false, reframeAnchors);
  await runProcess(
    ffmpeg,
    [
      "-y",
      "-ss",
      String(startTime),
      "-i",
      inputPath,
      "-t",
      String(duration),
      "-vf",
      videoFilter,
      "-r",
      "24",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      mode === "quality" ? "27" : "31",
      "-c:a",
      "aac",
      "-b:a",
      "64k",
      outputPath
    ],
    (progress) => onProgress?.(progress),
    signal,
    duration
  );
}

export async function analyzeReframeAnchors(
  inputPath: string,
  startTime: number,
  endTime: number,
  signal?: AbortSignal
): Promise<ReframeAnchor[]> {
  const duration = Math.max(0.1, endTime - startTime);
  try {
    const faces = await detectFaces(inputPath, startTime, duration, signal);
    if (faces.length > 0) return facesToReframeAnchors(faces, startTime, duration);
  } catch { /* fallback */ }
  return analyzeReframeFallback(inputPath, startTime, endTime, signal);
}

async function analyzeReframeFallback(
  inputPath: string,
  startTime: number,
  endTime: number,
  signal?: AbortSignal
): Promise<ReframeAnchor[]> {
  const ffmpeg = resolveFfmpegBinary("ffmpeg");
  const duration = Math.max(0.1, endTime - startTime);
  const width = 96;
  const height = 54;
  const sampleCount = Math.min(3, Math.max(1, Math.ceil(duration / 25)));
  const fps = sampleCount / duration;
  const args = [
    "-v", "error", "-ss", String(startTime),
    "-i", inputPath, "-t", String(duration),
    "-vf", `fps=${fps.toFixed(4)},scale=${width}:${height},format=rgb24`,
    "-an", "-f", "rawvideo", "-"
  ];
  const frames = await runProcessBuffer(ffmpeg, args, signal);
  const frameSize = width * height * 3;
  const frameCount = Math.floor(frames.length / frameSize);
  if (frameCount <= 0) return [];
  const anchors: ReframeAnchor[] = [];
  let previousCenter = 0.5;
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const frame = frames.subarray(frameIndex * frameSize, (frameIndex + 1) * frameSize);
    const detected = estimateSubjectCenterX(frame, width, height);
    const centerX = previousCenter * 0.65 + detected * 0.35;
    previousCenter = centerX;
    const start = Math.min(duration, (frameIndex / Math.max(1, frameCount)) * duration);
    const end = frameIndex === frameCount - 1 ? duration : Math.min(duration, ((frameIndex + 1) / Math.max(1, frameCount)) * duration);
    anchors.push({ start, end, centerX, centerY: 0.5, confidence: 0.55, source: "face" });
  }
  return anchors;
}

export async function cutClip(inputPath: string, startTime: number, endTime: number, outputPath: string, onProgress?: (progress: number) => void) {
  const ffmpeg = resolveFfmpegBinary("ffmpeg");
  const duration = Math.max(0.1, endTime - startTime);
  await runProcess(
    ffmpeg,
    ["-y", "-ss", String(startTime), "-i", inputPath, "-t", String(duration), "-c", "copy", outputPath],
    (progress) => onProgress?.(progress),
    undefined,
    duration
  );
}

export async function exportVerticalClip(options: ExportVerticalOptions, onProgress?: (progress: number) => void, signal?: AbortSignal) {
  const ffmpeg = resolveFfmpegBinary("ffmpeg");
  const duration = Math.max(0.1, options.endTime - options.startTime);
  const [width, height] = options.resolution.split("x").map(Number);
  const preset = presetForMode(options.performanceMode, options.encoder);
  const bitrate = bitrateForMode(options.performanceMode);
  const videoFilter = buildVerticalFilter(options.verticalMode, width, height, options.subtitlePath, options.subtitleOn, options.reframeAnchors, options.zoomEnabled, options.startTime, options.endTime);
  const encoderArgs = preset ? ["-preset", preset] : [];

  await runProcess(
    ffmpeg,
    [
      "-y",
      "-ss",
      String(options.startTime),
      "-i",
      options.inputPath,
      "-t",
      String(duration),
      "-vf",
      videoFilter,
      "-r",
      "30",
      "-c:v",
      options.encoder,
      ...encoderArgs,
      "-b:v",
      bitrate,
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-movflags",
      "+faststart",
      options.outputPath
    ],
    (progress) => onProgress?.(progress),
    signal,
    duration
  );
}

function buildVerticalFilter(
  mode: string,
  width: number,
  height: number,
  subtitlePath?: string,
  subtitleOn?: boolean,
  reframeAnchors: ReframeAnchor[] = [],
  zoomEnabled?: boolean,
  clipStart?: number,
  clipEnd?: number
) {
  const base =
    mode === "blur-background"
      ? `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=24:1[bg];[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2`
      : mode === "face-speaker-cut"
        ? buildFaceSpeakerCutFilter(width, height, reframeAnchors)
        : buildManualCropFilter(mode, width, height);
  if (!subtitleOn || !subtitlePath) return base;
  return `${base},subtitles=filename='${escapeSubtitlePath(subtitlePath)}'`;
}

function buildManualCropFilter(mode: string, width: number, height: number) {
  const x =
    mode === "left-crop"
      ? "0"
      : mode === "right-crop"
        ? "iw-ow"
        : "(iw-ow)/2";
  return `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}:x='${x}':y='(ih-oh)/2'`;
}

function buildFaceSpeakerCutFilter(width: number, height: number, anchors: ReframeAnchor[]) {
  const validAnchors = anchors
    .filter((anchor) => anchor.end > anchor.start && Number.isFinite(anchor.centerX))
    .sort((a, b) => a.start - b.start);

  if (validAnchors.length === 0) {
    return `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
  }

  const centerExpression = validAnchors.reduceRight((fallback, anchor) => {
    const centerX = Math.min(0.95, Math.max(0.05, anchor.centerX));
    return `if(between(t\\,${anchor.start.toFixed(3)}\\,${anchor.end.toFixed(3)})\\,${centerX.toFixed(3)}\\,${fallback})`;
  }, "0.5");

  const xExpression = `min(max((${centerExpression})*iw-ow/2\\,0)\\,iw-ow)`;
  return `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}:x='${xExpression}':y='(ih-oh)/2'`;
}

function runProcessBuffer(binary: string, args: string[], signal?: AbortSignal): Promise<Buffer> {
  const command = `${binary} ${args.map(quoteArg).join(" ")}`;
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true });
    const stdout: Buffer[] = [];
    let stderr = "";
    let aborted = false;

    const abort = () => {
      aborted = true;
      child.kill();
    };
    signal?.addEventListener("abort", abort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      signal?.removeEventListener("abort", abort);
      reject(new FfmpegError(error.message, command, stderr));
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      if (aborted || signal?.aborted) {
        reject(new FfmpegError("Process canceled", command, stderr));
        return;
      }
      if (code === 0) resolve(Buffer.concat(stdout));
      else reject(new FfmpegError(`FFmpeg exited with code ${code}`, command, stderr));
    });
  });
}

function estimateSubjectCenterX(frame: Buffer, width: number, height: number) {
  let totalWeight = 0;
  let weightedX = 0;

  for (let y = 1; y < height - 1; y += 1) {
    const verticalBias = 1 - Math.abs(y / height - 0.42) * 1.2;
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width + x) * 3;
      const r = frame[index];
      const g = frame[index + 1];
      const b = frame[index + 2];
      const leftIndex = (y * width + x - 1) * 3;
      const rightIndex = (y * width + x + 1) * 3;
      const edge =
        Math.abs(frame[rightIndex] - frame[leftIndex]) +
        Math.abs(frame[rightIndex + 1] - frame[leftIndex + 1]) +
        Math.abs(frame[rightIndex + 2] - frame[leftIndex + 2]);
      const skin =
        r > 70 &&
        g > 35 &&
        b > 20 &&
        r > g * 1.05 &&
        r > b * 1.2 &&
        Math.max(r, g, b) - Math.min(r, g, b) > 12
          ? 2.8
          : 0;
      const brightness = (r + g + b) / 765;
      const centerBias = 0.65 + (1 - Math.abs(x / width - 0.5) * 2) * 0.35;
      const weight = Math.max(0, verticalBias) * centerBias * (skin + Math.min(2.2, edge / 70) + brightness * 0.15);
      totalWeight += weight;
      weightedX += weight * (x / (width - 1));
    }
  }

  if (totalWeight <= 0.001) return 0.5;
  return Math.min(0.82, Math.max(0.18, weightedX / totalWeight));
}

function applyZoomFilter(filterChain: string, zoomEnabled?: boolean, clipStart?: number, clipEnd?: number, width?: number, height?: number) {
  if (!zoomEnabled || clipStart === undefined || clipEnd === undefined || !width || !height) return filterChain;
  const clipDuration = Math.max(0.1, clipEnd - clipStart);
  const midFrame = Math.round(30 * clipDuration * 0.4);
  const zoomTarget = 1.12;
  const zoomExpr = "zoompan=z='" + "if(lte(in," + midFrame + "),1," + zoomTarget + ")" + "':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=" + width + "x" + height + ":fps=30";
  return filterChain ? filterChain + "," + zoomExpr : zoomExpr;
}

function parseFraction(value: string) {
  const [num, den] = value.split("/").map(Number);
  return den ? num / den : num || 0;
}

export function parseFfmpegProgress(stderr: string, durationSeconds?: number) {
  const matches = [...stderr.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  if (!matches?.length) return 0;
  const match = matches.at(-1);
  if (!match) return 0;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const currentSeconds = hours * 3600 + minutes * 60 + seconds;
  if (!durationSeconds || durationSeconds <= 0 || !Number.isFinite(durationSeconds)) {
    return Math.min(99, Math.max(0, Math.round(currentSeconds)));
  }
  return Math.min(99, Math.max(0, Math.round((currentSeconds / durationSeconds) * 100)));
}

function presetForMode(mode: PerformanceMode, encoder: string) {
  if (encoder === "h264_nvenc") {
    if (mode === "fast") return "p1";
    if (mode === "quality") return "p5";
    return "p4";
  }
  if (encoder === "h264_qsv" || encoder === "h264_amf") {
    return undefined;
  }
  if (mode === "fast") return "veryfast";
  if (mode === "quality") return "medium";
  return "faster";
}

function bitrateForMode(mode: PerformanceMode) {
  if (mode === "fast") return "3500k";
  if (mode === "quality") return "9000k";
  return "6000k";
}

function quoteArg(arg: string) {
  return /\s/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

function escapeSubtitlePath(subtitlePath: string) {
  const normalized = subtitlePath.replace(/\\/g, "/");
  const match = normalized.match(/^([a-zA-Z]:\/)/);
  const rest = match ? normalized.slice(2) : normalized;
  const escaped = rest
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
  return match ? `${match[1]}${escaped}` : escaped;
}

function inferReason(stderr: string) {
  const lower = stderr.toLowerCase();
  if (lower.includes("enoent") || lower.includes("spawn") || lower.includes("not recognized")) {
    return "FFmpeg/ffprobe tidak ditemukan. Isi path di Settings atau taruh binary di apps/desktop/resources/ffmpeg.";
  }
  if (lower.includes("unknown encoder") || lower.includes("cannot load")) return "Encoder GPU tidak tersedia atau codec tidak didukung.";
  if (lower.includes("no such file") || lower.includes("cannot find")) return "Path file bermasalah atau file tidak ditemukan.";
  if (lower.includes("invalid data")) return "File video rusak atau format tidak didukung.";
  if (lower.includes("no space")) return "Storage penuh atau output tidak bisa ditulis.";
  return "FFmpeg gagal menjalankan proses. Periksa log stderr untuk detail.";
}

function normalizeCheckError(error: unknown) {
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  return String(error);
}
