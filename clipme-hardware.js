// ============================================================================
// clipme-hardware.js — Hardware Detection & Runtime Resolution
//
// Detects:
//   - CPU model / cores
//   - NVIDIA GPU via nvidia-smi
//   - CUDA availability via Python venv (ctranslate2)
//   - NVENC encoder via ffmpeg
//
// Resolves runtime:
//   - STT device (cuda / cpu / auto)
//   - Video encoder (h264_nvenc / libx264)
//   - Acceleration mode (AUTO / CPU / GPU)
//
// Architecture:
//   detectHardware() → { cpu, gpu, cuda, nvenc, ... }
//   resolveRuntime(hardware, envOverrides) → { sttDevice, encoder, mode, ... }
// ============================================================================

const { spawn, execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

// ── Cache ──
let _cached = null;
let _cacheTime = 0;
const CACHE_TTL = 60000; // 60s

// ── Helpers ──

function runSync(cmd, args, timeout = 8000) {
  try {
    const out = execFileSync(cmd, args, {
      encoding: "utf8",
      timeout,
      windowsHide: true,
    });
    return String(out || "").trim();
  } catch {
    return "";
  }
}

function which(cmd) {
  // Check PATH for the given executable
  const paths = (process.env.PATH || "").split(path.delimiter);
  for (const dir of paths) {
    const full = path.join(dir, cmd);
    if (fs.existsSync(full)) return full;
    // Windows .exe extension
    const fullExe = full + ".exe";
    if (fs.existsSync(fullExe)) return fullExe;
  }
  // Also check common locations
  const common = [
    "C:\\Windows\\System32\\nvidia-smi.exe",
    "/usr/bin/nvidia-smi",
    "/usr/local/bin/nvidia-smi",
  ];
  for (const loc of common) {
    if (fs.existsSync(loc)) return loc;
  }
  return "";
}

// ── CPU Detection ──

function detectCpu() {
  const result = { model: "", cores: 0, arch: process.arch };
  try {
    if (process.platform === "win32") {
      const out = runSync(
        "wmic",
        ["cpu", "get", "name,NumberOfCores", "/format:csv"],
        5000
      );
      const lines = out.split("\n").filter((l) => l.includes(","));
      for (const line of lines) {
        const parts = line.split(",");
        if (parts.length >= 3) {
          result.model = (parts[2] || "").trim();
          result.cores = parseInt(parts[1], 10) || 0;
        }
      }
    } else {
      // Linux / macOS
      try {
        result.model = runSync("cat", ["/proc/cpuinfo"], 2000)
          .split("\n")
          .find((l) => l.startsWith("model name"))
          ?.split(":")[1]
          ?.trim() || "";
      } catch {
        result.model = "";
      }
      result.cores = parseInt(runSync("nproc", [], 2000) || "0", 10) || 0;
    }
  } catch {
    // fallback
  }
  if (!result.model) result.model = `${process.arch} CPU`;
  if (!result.cores) result.cores = 1;
  return result;
}

// ── GPU Detection (NVIDIA via nvidia-smi) ──

function detectGpu() {
  const result = {
    present: false,
    name: "",
    driverVersion: "",
    cudaVersion: "",
    vramGb: 0,
    vendor: "",
  };

  const smi = which("nvidia-smi");
  if (!smi) return result;

  // Format: name, driver_version, cuda_version, memory.total
  const out = runSync(
    smi,
    [
      "--query-gpu=name,driver_version,cuda_version,memory.total",
      "--format=csv,noheader,nounits",
    ],
    8000
  );
  if (!out) return result;

  const parts = out.split(",").map((s) => s.trim());
  if (parts.length >= 1 && parts[0]) {
    result.present = true;
    result.name = parts[0] || "";
    result.driverVersion = parts[1] || "";
    result.cudaVersion = parts[2] || "";
    result.vramGb = Math.round((parseFloat(parts[3]) || 0) / 1024);
    result.vendor = "NVIDIA";
  }
  return result;
}

// ── CUDA Check via Python venv ──
// Run stt-engine.py check-cuda to verify faster-whisper/ctranslate2 CUDA support

function detectCudaViaPython(venvPython) {
  const result = { available: false, deviceCount: 0, fallback: false };
  if (!venvPython || !fs.existsSync(venvPython)) return result;

  // Find stt-engine.py: project layout is <root>/.venv/Scripts/python.exe + <root>/stt-engine.py,
  // jadi naik DUA level (Scripts/.venv/) bukan satu agar path-nya bener.
  const sttEngine = path.join(path.dirname(path.dirname(venvPython)), "stt-engine.py");
  // Fallback: try relative to ROOT if not found near venv
  const enginePath = fs.existsSync(sttEngine)
    ? sttEngine
    : path.join(__dirname, "stt-engine.py");

  if (!fs.existsSync(enginePath)) return result;

  try {
    const out = runSync(
      venvPython,
      [enginePath, "check-cuda", "--json"],
      15000
    );
    if (out) {
      try {
        const data = JSON.parse(out);
        result.available = !!data.available;
        result.deviceCount = data.device_count || 0;
        result.fallback = !!data.fallback;
      } catch {
        if (out.includes("true") || out.includes("1")) {
          result.available = true;
        }
      }
    }
  } catch {
    // Python check failed
  }
  return result;
}

// ── NVENC Detection via ffmpeg ──

function detectNvenc(ffmpegPath) {
  const result = { h264: false, hevc: false, available: false };
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) return result;

  try {
    const out = runSync(ffmpegPath, ["-hide_banner", "-encoders"], 10000);
    result.h264 = out.includes("h264_nvenc");
    result.hevc = out.includes("hevc_nvenc");
    result.available = result.h264 || result.hevc;
  } catch {
    // ffmpeg failed
  }
  return result;
}

// ── Main Detection ──

async function detectHardware(options = {}) {
  const now = Date.now();
  if (_cached && now - _cacheTime < CACHE_TTL) return _cached;

  const cpu = detectCpu();
  const gpu = detectGpu();

  // Resolve paths
  const ffmpegPath =
    options.ffmpegPath ||
    process.env.FFMPEG_PATH ||
    path.join(__dirname, "bin", "ffmpeg.exe");
  const venvPython =
    options.venvPython ||
    process.env.LOCAL_WHISPER_PYTHON ||
    process.env.CLIPFORGE_VENV_PYTHON ||
    "";

  // NVENC
  const nvenc = detectNvenc(ffmpegPath);

  // Python CUDA check (only if GPU is detected from nvidia-smi)
  let pythonCuda = { available: false, deviceCount: 0, fallback: false };
  if (gpu.present && venvPython) {
    pythonCuda = detectCudaViaPython(venvPython);
  }

  // CUDA is truly available: GPU present AND Python venv supports it
  const cudaAvailable = gpu.present && pythonCuda.available;

  // Fallback mode: GPU present but Python doesn't support CUDA
  const cudaFallback = gpu.present && !pythonCuda.available && !!venvPython;

  const hardware = {
    cpu,
    gpu,
    cuda: {
      available: cudaAvailable,
      deviceCount: pythonCuda.deviceCount,
      fallback: cudaFallback,
      pythonCheck: pythonCuda,
    },
    nvenc,
    ffmpeg: {
      available: fs.existsSync(ffmpegPath),
      path: ffmpegPath,
    },
    detectedAt: now,
  };

  _cached = hardware;
  _cacheTime = now;
  return hardware;
}

// ── Runtime Resolution ──

function resolveRuntime(hardware, envOverrides = {}) {
  const mode = String(
    envOverrides.CLIPFORGE_ACCEL || process.env.CLIPFORGE_ACCEL || "auto"
  ).toLowerCase();

  // Force CPU mode
  if (mode === "cpu") {
    return {
      mode: "CPU",
      sttDevice: "cpu",
      sttComputeType: "int8",
      encoder: "libx264",
      encoderPreset: "veryfast",
      encoderCrf: 23,
      nvencAvailable: false,
      gpuUsed: false,
      reason: "Forced CPU via CLIPFORGE_ACCEL=cpu",
    };
  }

  // Force GPU mode
  if (mode === "gpu") {
    const gpuOk = hardware.gpu.present && hardware.cuda.available;
    const nvencOk = hardware.nvenc.available;
    return {
      mode: "GPU",
      sttDevice: gpuOk ? "cuda" : "cpu",
      sttComputeType: gpuOk ? "float16" : "int8",
      encoder: nvencOk ? "h264_nvenc" : "libx264",
      encoderPreset: nvencOk ? "p4" : "veryfast",
      encoderCrfOrCq: nvencOk ? 23 : 23,
      nvencAvailable: nvencOk,
      gpuUsed: gpuOk || nvencOk,
      reason: gpuOk
        ? "GPU mode (CUDA + NVENC)"
        : nvencOk
          ? "GPU mode (NVENC only, no CUDA)"
          : "GPU mode forced but no GPU available — fallback CPU",
    };
  }

  // AUTO mode
  const gpuOk = hardware.gpu.present && hardware.cuda.available;
  const nvencOk = hardware.nvenc.available;
  const cudaFallback = hardware.cuda.fallback;

  return {
    mode: "AUTO",
    sttDevice: gpuOk ? "cuda" : cudaFallback ? "auto" : "cpu",
    sttComputeType: gpuOk ? "float16" : "int8",
    encoder: nvencOk ? "h264_nvenc" : "libx264",
    encoderPreset: nvencOk ? "p4" : "veryfast",
    encoderCrfOrCq: nvencOk ? 23 : 23,
    nvencAvailable: nvencOk,
    gpuUsed: gpuOk || nvencOk,
    reason: gpuOk
      ? "GPU acceleration (CUDA + NVENC)"
      : nvencOk
        ? "GPU acceleration (NVENC only)"
        : cudaFallback
          ? "GPU detected but Python venv lacks CUDA — fallback CPU"
          : "CPU-only mode (no GPU detected)",
  };
}

// ── Force re-detection ──

function clearCache() {
  _cached = null;
  _cacheTime = 0;
}

// ── Public API ──

module.exports = {
  detectHardware,
  resolveRuntime,
  clearCache,
  // Internal helpers exposed for testing
  _internals: { detectCpu, detectGpu, detectNvenc, detectCudaViaPython, which },
};