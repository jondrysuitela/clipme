import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { app } from "electron";
import type { TranscriptResult, TranscriptSegment } from "../../shared/types";
import type { TranscriptionProvider } from "./transcriptionProvider";

export class WhisperCppTranscriber implements TranscriptionProvider {
  constructor(private options: { modelName?: string; threads?: number }) {}

  async transcribeAudio(audioPath: string, _durationSeconds?: number, signal?: AbortSignal): Promise<TranscriptResult> {
    const binary = this.resolveBinary();
    const model = this.resolveModel();
    if (!fs.existsSync(binary)) throw new Error(`Whisper binary tidak ditemukan: ${binary}. Jalankan 'npm run setup-whisper' dulu.`);
    if (!fs.existsSync(model)) throw new Error(`Whisper model tidak ditemukan: ${model}. Jalankan 'npm run setup-whisper' dulu.`);

    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "clipme-whisper-cpp-"));
    const outputPath = path.join(outputDir, "output");

    const args = [
      "-f", audioPath,
      "-m", model,
      "-oj",
      "-otxt",
      "--output-file", outputPath,
      "-t", String(this.options.threads ?? Math.max(1, os.cpus().length - 1)),
      "-l", "id"
    ];

    await runWhisperCpp(binary, args, signal);

    const jsonPath = outputPath + ".json";
    if (!fs.existsSync(jsonPath)) throw new Error("Whisper selesai tapi file output JSON tidak ditemukan.");

    const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    const segments = normalizeSegments(raw);
    return {
      fullText: segments.map((s) => s.text).join(" "),
      segments
    };
  }

  private resolveBinary() {
    if (process.env.WHISPER_CPP_BIN) return process.env.WHISPER_CPP_BIN;
    const exe = process.platform === "win32" ? "whisper.exe" : "whisper";
    const resourcePath = process.resourcesPath ? path.join(process.resourcesPath, "whisper", exe) : "";
    const devPath = path.join(app.getAppPath(), "resources", "whisper", exe);
    if (resourcePath && fs.existsSync(resourcePath)) return resourcePath;
    if (fs.existsSync(devPath)) return devPath;
    return exe;
  }

  private resolveModel() {
    if (process.env.WHISPER_CPP_MODEL) return process.env.WHISPER_CPP_MODEL;
    const modelName = this.options.modelName ?? "ggml-tiny.bin";
    const resourcePath = process.resourcesPath ? path.join(process.resourcesPath, "whisper", modelName) : "";
    const devPath = path.join(app.getAppPath(), "resources", "whisper", modelName);
    if (resourcePath && fs.existsSync(resourcePath)) return resourcePath;
    if (fs.existsSync(devPath)) return devPath;
    const userDataPath = path.join(app.getPath("userData"), "whisper", modelName);
    if (fs.existsSync(userDataPath)) return userDataPath;
    return path.join(app.getAppPath(), "resources", "whisper", modelName);
  }
}

function runWhisperCpp(binary: string, args: string[], signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true });
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
        reject(new Error(`Whisper binary tidak ditemukan: ${binary}. Jalankan 'npm run setup-whisper'.`));
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
      else reject(new Error(`Whisper gagal dengan kode ${code}:\n${stderr.slice(-2000)}`));
    });
  });
}

function normalizeSegments(raw: any): TranscriptSegment[] {
  const source = Array.isArray(raw?.transcription) ? raw.transcription
    : Array.isArray(raw?.segments) ? raw.segments : [];
  return source
    .map((seg: any) => {
      const start = Number(seg.start ?? seg.offsets?.from ?? 0) / 1000;
      const end = Number(seg.end ?? seg.offsets?.to ?? 0) / 1000;
      return { start, end, text: String(seg.text ?? "").trim() };
    })
    .filter((seg: TranscriptSegment) => seg.end > seg.start && seg.text.length > 0);
}
