import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TranscriptResult, TranscriptSegment } from "../../shared/types";
import type { TranscriptionProvider } from "./transcriptionProvider";
import { resolveFfmpegBinary } from "../ffmpeg/ffmpegEngine";

interface WhisperCliOptions {
  command: string;
  model: string;
}

export class WhisperCliTranscriber implements TranscriptionProvider {
  constructor(private options: WhisperCliOptions) {}

  async transcribeAudio(audioPath: string, _durationSeconds?: number, signal?: AbortSignal): Promise<TranscriptResult> {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "clipme-whisper-"));
    await runWhisper(this.options.command, [
      audioPath,
      "--model",
      this.options.model,
      "--output_dir",
      outputDir,
      "--output_format",
      "json",
      "--language",
      "Indonesian",
      "--fp16",
      "False"
    ], signal);

    const jsonFile = fs.readdirSync(outputDir).find((file) => file.toLowerCase().endsWith(".json"));
    if (!jsonFile) throw new Error("Whisper CLI selesai tapi file JSON transcript tidak ditemukan.");

    const raw = JSON.parse(fs.readFileSync(path.join(outputDir, jsonFile), "utf8"));
    const segments = normalizeSegments(raw);
    return {
      fullText: segments.map((segment) => segment.text).join(" "),
      segments
    };
  }
}

function runWhisper(command: string, args: string[], signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const ffmpegPath = resolveFfmpegBinary("ffmpeg");
    const env = {
      ...process.env,
      PYTHONUTF8: "1",
      PATH: `${path.dirname(ffmpegPath)}${path.delimiter}${process.env.PATH ?? ""}`
    };
    const child = spawn(command, args, { windowsHide: true, env });
    let stderr = "";
    let aborted = false;
    const abort = () => {
      aborted = true;
      child.kill();
    };
    signal?.addEventListener("abort", abort, { once: true });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      signal?.removeEventListener("abort", abort);
      if (error.code === "ENOENT") {
        reject(
          new Error(
            `Whisper CLI tidak ditemukan: ${command}. Install faster-whisper-xxl atau isi Whisper command dengan path executable yang benar.`
          )
        );
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      if (aborted || signal?.aborted) {
        reject(new Error("Whisper transcription canceled."));
        return;
      }
      if (code === 0) resolve();
      else reject(new Error(`Whisper CLI failed with code ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

function normalizeSegments(raw: any): TranscriptSegment[] {
  const source = Array.isArray(raw?.segments) ? raw.segments : [];
  return source
    .map((segment: any) => ({
      start: Number(segment.start ?? 0),
      end: Number(segment.end ?? 0),
      text: String(segment.text ?? "").trim()
    }))
    .filter((segment: TranscriptSegment) => segment.end > segment.start && segment.text.length > 0);
}
