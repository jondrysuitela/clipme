import fs from "node:fs";
import path from "node:path";
import { runProcess, resolveFfmpegBinary, parseFfmpegProgress } from "../ffmpeg/ffmpegEngine";

export interface SceneChange {
  timestamp: number;
  score: number;
}

export interface AudioEnergyPoint {
  timestamp: number;
  volume: number;
  isSilent: boolean;
}

export interface VisualAnalysisResult {
  sceneChanges: SceneChange[];
  averageBrightness: number;
  motionScore: number;
}

export interface AudioAnalysisResult {
  energyPoints: AudioEnergyPoint[];
  averageVolume: number;
  highEnergySegments: Array<{ start: number; end: number; energy: number }>;
}

/**
 * Detect scene changes in a video segment using FFmpeg scene detection filter.
 */
export async function detectSceneChanges(
  inputPath: string,
  startTime: number,
  duration: number,
  threshold = 0.3
): Promise<SceneChange[]> {
  const ffmpeg = resolveFfmpegBinary("ffmpeg");
  const sceneFile = path.join(
    path.dirname(inputPath),
    `scenes-${Date.now()}.log`
  );

  try {
    const { stderr } = await runProcess(ffmpeg, [
      "-y",
      "-ss", String(startTime),
      "-i", inputPath,
      "-t", String(duration),
      "-vf", `select='gt(scene,${threshold})',metadata=print:file=${sceneFile}`,
      "-f", "null",
      "-"
    ]);

    // Parse scene change timestamps from stderr
    const scenes: SceneChange[] = [];
    const regex = /pts_time:([\d.]+)/g;
    let match;
    while ((match = regex.exec(stderr)) !== null) {
      const ts = parseFloat(match[1]) - startTime;
      if (ts > 0.5 && ts < duration - 0.5) {
        scenes.push({ timestamp: Math.max(0, ts), score: threshold });
      }
    }

    return scenes;
  } catch (err) {
    console.warn("Scene detection failed:", err);
    return [];
  } finally {
    try { if (fs.existsSync(sceneFile)) fs.unlinkSync(sceneFile); } catch { /* ignore */ }
  }
}

/**
 * Analyze audio energy levels using FFmpeg volume detection.
 */
export async function analyzeAudioEnergy(
  inputPath: string,
  startTime: number,
  duration: number,
  sampleInterval = 0.5
): Promise<AudioAnalysisResult> {
  const ffmpeg = resolveFfmpegBinary("ffmpeg");

  try {
    // Use astats filter to get per-frame volume stats
    const { stderr } = await runProcess(ffmpeg, [
      "-y",
      "-ss", String(startTime),
      "-i", inputPath,
      "-t", String(duration),
      "-af", `astats=metadata=1:reset=${Math.round(1 / sampleInterval)}`,
      "-f", "null",
      "-"
    ]);

    const points: AudioEnergyPoint[] = [];
    const rmsRegex = /Rms Level: (-?[\d.]+)/g;
    let match;
    let index = 0;

    while ((match = rmsRegex.exec(stderr)) !== null) {
      const db = parseFloat(match[1]);
      const ts = index * sampleInterval;
      points.push({
        timestamp: Math.min(ts, duration),
        volume: db,
        isSilent: db < -40
      });
      index++;
    }

    const volumes = points.filter((p) => !p.isSilent).map((p) => p.volume);
    const avgVolume =
      volumes.length > 0
        ? volumes.reduce((a, b) => a + b, 0) / volumes.length
        : -50;

    // Find high-energy segments (volume significantly above average)
    const threshold = Math.min(-15, avgVolume + 8);
    const highEnergySegments: Array<{ start: number; end: number; energy: number }> = [];
    let segStart: number | null = null;
    let segPeak = -Infinity;

    for (const pt of points) {
      if (pt.volume > threshold && !pt.isSilent) {
        if (segStart === null) segStart = pt.timestamp;
        segPeak = Math.max(segPeak, pt.volume);
      } else if (segStart !== null) {
        highEnergySegments.push({ start: segStart, end: pt.timestamp, energy: Math.round((segPeak + 40) * 2) });
        segStart = null;
        segPeak = -Infinity;
      }
    }
    if (segStart !== null) {
      highEnergySegments.push({ start: segStart, end: duration, energy: Math.round((segPeak + 40) * 2) });
    }

    return { energyPoints: points, averageVolume: avgVolume, highEnergySegments };
  } catch (err) {
    console.warn("Audio energy analysis failed:", err);
    return { energyPoints: [], averageVolume: -50, highEnergySegments: [] };
  }
}

/**
 * Analyze brightness from a video segment.
 */
export async function analyzeBrightness(
  inputPath: string,
  startTime: number,
  duration: number
): Promise<number> {
  const ffmpeg = resolveFfmpegBinary("ffmpeg");

  try {
    const { stderr } = await runProcess(ffmpeg, [
      "-y",
      "-ss", String(startTime),
      "-i", inputPath,
      "-t", String(Math.min(duration, 5)),
      "-vf", "signalstats",
      "-f", "null",
      "-"
    ]);

    const brightRegex = /YMin: (\d+).*YMax: (\d+).*YAvg: (\d+)/g;
    const match = brightRegex.exec(stderr);
    if (match) {
      const avg = parseInt(match[3], 10);
      return avg / 255; // Normalize to 0-1
    }
    return 0.5;
  } catch {
    return 0.5;
  }
}
