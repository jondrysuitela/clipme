const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const crypto = require("crypto");

const ROOT = __dirname;
const DATA_ROOT = process.env.CLIPFORGE_DATA_DIR || ROOT;
const UPLOAD_DIR = path.join(DATA_ROOT, "uploads");
const OUTPUT_DIR = path.join(DATA_ROOT, "outputs");
const TMP_DIR = path.join(DATA_ROOT, "tmp");
const PORT = Number(process.env.PORT || 4173);
const BIN_DIR = process.env.CLIPFORGE_BIN_DIR || path.join(ROOT, "bin");
const YTDLP = process.env.YTDLP_PATH || path.join(BIN_DIR, "yt-dlp.exe");
const FFMPEG = process.env.FFMPEG_PATH || path.join(BIN_DIR, "ffmpeg.exe");
const FFPROBE = process.env.FFPROBE_PATH || path.join(BIN_DIR, "ffprobe.exe");
const OPENAI_TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";
const VENV_PYTHON = path.join(ROOT, ".venv", "Scripts", "python.exe");
const FASTER_WHISPER_SCRIPT = path.join(ROOT, "transcribe_faster_whisper.py");
const jobs = new Map();
const jobQueue = [];
let activeJobs = 0;
const MAX_ACTIVE_JOBS = Number(process.env.CLIPFORGE_MAX_JOBS || 2);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4",
  ".webm": "video/webm"
};

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

function sendJson(res, status, data) {
  const body = Buffer.from(JSON.stringify(data));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length
  });
  res.end(body);
}

function sendFile(res, filePath) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

function sendMedia(req, res, filePath) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "video/mp4";
  const range = req.headers.range;

  if (!range) {
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stat.size,
      "Accept-Ranges": "bytes"
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  const match = /bytes=(\d+)-(\d*)/.exec(range);
  const start = match ? Number(match[1]) : 0;
  const end = match?.[2] ? Number(match[2]) : stat.size - 1;
  const chunkSize = end - start + 1;

  res.writeHead(206, {
    "Content-Range": `bytes ${start}-${end}/${stat.size}`,
    "Accept-Ranges": "bytes",
    "Content-Length": chunkSize,
    "Content-Type": contentType
  });
  fs.createReadStream(filePath, { start, end }).pipe(res);
}

function collectRequest(req, limitMb = 2048) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > limitMb * 1024 * 1024) {
        reject(new Error(`File terlalu besar. Batas demo lokal ${limitMb} MB.`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseMultipart(buffer, contentType) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!boundaryMatch) throw new Error("Missing multipart boundary.");

  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const parts = [];
  let cursor = buffer.indexOf(boundary);

  while (cursor !== -1) {
    const next = buffer.indexOf(boundary, cursor + boundary.length);
    if (next === -1) break;

    let part = buffer.slice(cursor + boundary.length, next);
    if (part.slice(0, 2).toString() === "\r\n") part = part.slice(2);
    if (part.slice(-2).toString() === "\r\n") part = part.slice(0, -2);
    if (part.length && part.slice(0, 2).toString() !== "--") parts.push(part);
    cursor = next;
  }

  const parsed = {};

  for (const part of parts) {
    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd === -1) continue;

    const headers = part.slice(0, headerEnd).toString("utf8");
    const body = part.slice(headerEnd + 4);
    const name = /name="([^"]+)"/.exec(headers)?.[1];
    const filename = /filename="([^"]*)"/.exec(headers)?.[1];
    if (!name) continue;

    parsed[name] = {
      filename,
      data: body,
      text: body.toString("utf8")
    };
  }

  return parsed;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      env: {
        ...process.env,
        TMP: TMP_DIR,
        TEMP: TMP_DIR,
        TMPDIR: TMP_DIR
      }
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited with ${code}\n${stderr || stdout}`));
    });
  });
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https:") ? require("https") : require("http");
    client.get(url, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        getJson(response.headers.location).then(resolve, reject);
        return;
      }

      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    }).on("error", reject);
  });
}

function postMultipart(url, fields, files, headers = {}) {
  return new Promise((resolve, reject) => {
    const boundary = `----clipforge-${crypto.randomBytes(12).toString("hex")}`;
    const chunks = [];

    for (const [name, value] of Object.entries(fields)) {
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
    }

    for (const file of files) {
      const filename = path.basename(file.path);
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${filename}"\r\nContent-Type: ${file.type}\r\n\r\n`));
      chunks.push(fs.readFileSync(file.path));
      chunks.push(Buffer.from("\r\n"));
    }

    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    const body = Buffer.concat(chunks);
    const target = new URL(url);

    const request = require("https").request({
      method: "POST",
      hostname: target.hostname,
      path: `${target.pathname}${target.search}`,
      headers: {
        ...headers,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": body.length
      }
    }, (response) => {
      let responseBody = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        responseBody += chunk;
      });
      response.on("end", () => {
        try {
          const data = JSON.parse(responseBody);
          if (response.statusCode >= 200 && response.statusCode < 300) resolve(data);
          else reject(new Error(data.error?.message || responseBody));
        } catch (error) {
          reject(error);
        }
      });
    });

    request.on("error", reject);
    request.end(body);
  });
}

async function probeVideo(filePath) {
  const { stdout } = await run(FFPROBE, [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    filePath
  ]);

  const data = JSON.parse(stdout);
  const videoStream = data.streams.find((stream) => stream.codec_type === "video") || {};
  const duration = Number(data.format.duration || videoStream.duration || 0);

  return {
    duration,
    width: Number(videoStream.width || 0),
    height: Number(videoStream.height || 0),
    codec: videoStream.codec_name || "unknown"
  };
}

function buildClips(duration, targetLength = 45) {
  const length = Math.max(15, Math.min(90, Number(targetLength) || 45));
  const count = Math.min(8, Math.max(1, Math.floor(duration / Math.max(length, 20))));
  const spacing = duration / (count + 1);
  const titles = [
    "Opening hook",
    "High energy moment",
    "Clear insight",
    "Strong quote",
    "Useful framework",
    "Story beat",
    "Audience trigger",
    "Closing punch"
  ];

  return Array.from({ length: count }, (_, index) => {
    const start = Math.max(0, Math.round(spacing * (index + 1) - length / 2));
    const end = Math.min(duration, start + length);

    return {
      id: index + 1,
      title: titles[index],
      start,
      end,
      score: Math.max(71, 96 - index * 4),
      hook: `Clip potensial ${index + 1}`,
      caption: "Edit caption ini sebelum export."
    };
  });
}

function cleanCaptionText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\[.*?\]/g, "")
    .trim();
}

function parseJson3Transcript(data) {
  return (data.events || [])
    .filter((event) => event.segs?.length && Number.isFinite(event.tStartMs))
    .map((event) => {
      const text = cleanCaptionText(event.segs.map((seg) => seg.utf8 || "").join(""));
      return {
        start: event.tStartMs / 1000,
        end: (event.tStartMs + (event.dDurationMs || 2500)) / 1000,
        text
      };
    })
    .filter((item) => item.text && !/^♪+$/.test(item.text));
}

function captionSources(info, preferredLanguage = "Indonesia") {
  const languageMap = {
    Indonesia: ["id", "en"],
    English: ["en", "id"],
    Mixed: ["id", "en"]
  };
  const preferred = languageMap[preferredLanguage] || languageMap.Indonesia;
  const sources = [];

  for (const collection of [info.subtitles || {}, info.automatic_captions || {}]) {
    for (const lang of [...preferred, ...Object.keys(collection)]) {
      const formats = collection[lang] || [];
      const json3 = formats.find((item) => item.ext === "json3");
      if (json3?.url) sources.push(json3.url);
    }
  }

  return [...new Set(sources)];
}

async function getTranscript(info, preferredLanguage) {
  for (const source of captionSources(info, preferredLanguage)) {
    try {
      const transcript = parseJson3Transcript(await getJson(source));
      if (transcript.length) return transcript;
    } catch {
      // Try the next caption source.
    }
  }

  return [];
}

function wordsFrom(text) {
  return cleanCaptionText(text)
    .toLowerCase()
    .split(/[^a-z0-9\u00c0-\u024f\u1e00-\u1eff]+/i)
    .filter((word) => word.length > 2);
}

function scoreText(text) {
  const words = wordsFrom(text);
  const keywordHits = [
    "why", "how", "secret", "mistake", "problem", "solution", "best", "worst",
    "kenapa", "bagaimana", "rahasia", "salah", "masalah", "solusi", "penting",
    "jangan", "harus", "bisa", "viral", "uang", "cepat", "mudah"
  ].filter((word) => words.includes(word)).length;
  const questionBonus = /[?]|kenapa|mengapa|bagaimana|why|how/i.test(text) ? 8 : 0;
  const density = Math.min(18, Math.round(words.length / 2));
  return keywordHits * 6 + questionBonus + density;
}

function clipCaption(segments) {
  const text = cleanCaptionText(segments.map((segment) => segment.text).join(" "));
  const sentence = text.split(/(?<=[.!?])\s+/).find((item) => item.length > 24) || text;
  return sentence.slice(0, 155);
}

function clipHook(caption, index) {
  const first = caption.split(/[.!?]/)[0].trim();
  if (/kenapa|mengapa|why/i.test(first)) return first;
  if (/bagaimana|how/i.test(first)) return first;
  return first ? `${first.slice(0, 58)}${first.length > 58 ? "..." : ""}` : `Highlight ${index + 1}`;
}

function buildTranscriptClips(transcript, duration, targetLength = 45, heatmap = []) {
  if (!transcript.length) return buildClips(duration, targetLength);

  const length = Math.max(15, Math.min(90, Number(targetLength) || 45));
  const candidates = [];

  for (let i = 0; i < transcript.length; i += 1) {
    const start = Math.max(0, transcript[i].start - 2);
    const end = Math.min(duration, start + length);
    const segments = transcript.filter((segment) => segment.start >= start && segment.start <= end);
    if (segments.length < 2) continue;

    const text = segments.map((segment) => segment.text).join(" ");
    const heat = heatmap.find((item) => start >= item.start_time && start <= item.end_time)?.value || 0;
    candidates.push({
      start,
      end,
      segments,
      rawScore: scoreText(text) + Math.round(heat * 18)
    });
  }

  const selected = [];
  candidates
    .sort((a, b) => b.rawScore - a.rawScore)
    .forEach((candidate) => {
      const overlaps = selected.some((clip) => Math.max(clip.start, candidate.start) < Math.min(clip.end, candidate.end));
      if (!overlaps && selected.length < 8) selected.push(candidate);
    });

  return selected
    .sort((a, b) => a.start - b.start)
    .map((candidate, index) => {
      const caption = clipCaption(candidate.segments);
      return {
        id: index + 1,
        title: ["Strong hook", "Key insight", "High-retention moment", "Useful quote", "Story beat", "Actionable advice", "Audience trigger", "Closing punch"][index],
        start: Math.round(candidate.start),
        end: Math.round(candidate.end),
        score: Math.max(72, Math.min(98, 68 + candidate.rawScore)),
        hook: clipHook(caption, index),
        caption
      };
    });
}

async function transcribeAudioWithOpenAI(audioPath, language) {
  if (!process.env.OPENAI_API_KEY) return "";

  const fields = {
    model: OPENAI_TRANSCRIBE_MODEL,
    response_format: "json"
  };

  if (language === "Indonesia") fields.language = "id";
  if (language === "English") fields.language = "en";

  const data = await postMultipart(
    "https://api.openai.com/v1/audio/transcriptions",
    fields,
    [{ name: "file", path: audioPath, type: "audio/mpeg" }],
    { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
  );

  return cleanCaptionText(data.text || "");
}

async function transcribeAudioWithLocalWhisper(audioPath) {
  const pythonPath = process.env.LOCAL_WHISPER_PYTHON || VENV_PYTHON;
  if (!fs.existsSync(pythonPath) || !fs.existsSync(FASTER_WHISPER_SCRIPT)) return "";

  const outputPath = path.join(path.dirname(audioPath), `${path.basename(audioPath, path.extname(audioPath))}.whisper.json`);
  const args = [
    FASTER_WHISPER_SCRIPT,
    audioPath,
    "--model", process.env.LOCAL_WHISPER_MODEL || "small",
    "--device", process.env.LOCAL_WHISPER_DEVICE || "cpu",
    "--compute-type", process.env.LOCAL_WHISPER_COMPUTE_TYPE || "int8",
    "--output", outputPath
  ];

  await run(pythonPath, args);

  if (!fs.existsSync(outputPath)) return "";

  const data = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  return cleanCaptionText(data.text || "");
}

async function transcribeAudio(audioPath, language) {
  const openAiText = await transcribeAudioWithOpenAI(audioPath, language);
  if (openAiText) return { text: openAiText, provider: "openai" };

  const localText = await transcribeAudioWithLocalWhisper(audioPath);
  if (localText) return { text: localText, provider: "local-whisper" };

  return { text: "", provider: "none" };
}

function writeProjectManifest(projectDir, data) {
  fs.writeFileSync(path.join(projectDir, "project.json"), JSON.stringify(data, null, 2));
}

function readProjectManifest(projectDir) {
  const manifestPath = path.join(projectDir, "project.json");
  if (!fs.existsSync(manifestPath)) return {};
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function ffmpegText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/\r?\n/g, " ");
}

function buildVideoFilter({ ratio, caption, brand, color }) {
  const presets = {
    portrait: { width: 1080, height: 1920 },
    wide: { width: 1280, height: 720 },
    square: { width: 1080, height: 1080 }
  };
  const size = presets[ratio] || presets.portrait;
  const safeColor = /^#[0-9a-f]{6}$/i.test(color || "") ? color : "#f97316";
  const captionText = ffmpegText(caption || "Caption");
  const brandText = ffmpegText(brand || "CLIPFORGE");
  const scale = `scale=${size.width}:${size.height}:force_original_aspect_ratio=increase`;
  const crop = `crop=${size.width}:${size.height}`;
  const captionFont = Math.round(size.width * 0.054);
  const brandFont = Math.round(size.width * 0.026);
  const captionY = Math.round(size.height * 0.76);
  const brandY = Math.round(size.height * 0.055);

  return [
    scale,
    crop,
    `drawbox=x=${Math.round(size.width * 0.07)}:y=${captionY - 36}:w=${Math.round(size.width * 0.86)}:h=${Math.round(size.height * 0.14)}:color=black@0.72:t=fill`,
    `drawtext=text='${captionText}':fontcolor=white:fontsize=${captionFont}:x=(w-text_w)/2:y=${captionY}:box=0:line_spacing=10`,
    `drawbox=x=${Math.round(size.width * 0.07)}:y=${brandY}:w=${Math.round(size.width * 0.28)}:h=${Math.round(size.height * 0.045)}:color=${safeColor}:t=fill`,
    `drawtext=text='${brandText}':fontcolor=black:fontsize=${brandFont}:x=${Math.round(size.width * 0.085)}:y=${brandY + Math.round(size.height * 0.01)}`
  ].join(",");
}

async function handleUpload(req, res) {
  const body = await collectRequest(req);
  const parts = parseMultipart(body, req.headers["content-type"]);
  const file = parts.video;

  if (!file?.filename || !file.data?.length) {
    sendJson(res, 400, { error: "Upload video tidak ditemukan." });
    return;
  }

  const id = crypto.randomUUID();
  const ext = path.extname(file.filename).toLowerCase() || ".mp4";
  const safeExt = [".mp4", ".mov", ".mkv", ".webm", ".avi"].includes(ext) ? ext : ".mp4";
  const projectDir = path.join(UPLOAD_DIR, id);
  fs.mkdirSync(projectDir, { recursive: true });

  const sourcePath = path.join(projectDir, `source${safeExt}`);
  fs.writeFileSync(sourcePath, file.data);

  const probe = await probeVideo(sourcePath);
  const clips = buildClips(probe.duration, parts.duration?.text);

  sendJson(res, 200, {
    id,
    name: file.filename,
    probe,
    clips
  });
}

function isSupportedVideoUrl(value) {
  try {
    const url = new URL(value);
    return ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(url.hostname);
  } catch {
    return false;
  }
}

function extractYouTubeId(value) {
  try {
    const url = new URL(value);
    if (url.hostname === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] || "";
    if (url.hostname.endsWith("youtube.com")) {
      if (url.searchParams.get("v")) return url.searchParams.get("v");
      const parts = url.pathname.split("/").filter(Boolean);
      if (["shorts", "embed", "live"].includes(parts[0])) return parts[1] || "";
    }
  } catch {
    return "";
  }

  return "";
}

function findSourceFile(projectDir) {
  if (!fs.existsSync(projectDir)) return "";
  const videoExts = new Set([".mp4", ".webm", ".mkv", ".mov", ".avi"]);
  return fs.readdirSync(projectDir)
    .map((name) => path.join(projectDir, name))
    .filter((filePath) => videoExts.has(path.extname(filePath).toLowerCase()))
    .find((filePath) => path.basename(filePath).startsWith("source")) || "";
}

async function handleYouTube(req, res) {
  const payload = JSON.parse((await collectRequest(req, 5)).toString("utf8"));
  const videoUrl = String(payload.url || "").trim();

  if (!isSupportedVideoUrl(videoUrl)) {
    sendJson(res, 400, { error: "Masukkan URL YouTube yang valid." });
    return;
  }

  const id = crypto.randomUUID();
  const projectDir = path.join(UPLOAD_DIR, id);
  fs.mkdirSync(projectDir, { recursive: true });
  const videoId = extractYouTubeId(videoUrl);

  if (process.env.CLIPFORGE_DEEP_ANALYZE !== "1") {
    const assumedDuration = Math.max(60, Number(payload.assumedDuration || 3600));
    const probe = {
      duration: assumedDuration,
      width: 0,
      height: 0,
      codec: "youtube-fast"
    };
    const title = videoId ? `YouTube ${videoId}` : "YouTube video";
    const clips = buildClips(probe.duration, payload.duration);

    writeProjectManifest(projectDir, {
      id,
      videoId,
      type: "youtube",
      url: videoUrl,
      title,
      probe,
      transcriptPath: "",
      transcriptProvider: "fast-mode"
    });

    sendJson(res, 200, {
      id,
      name: title,
      probe,
      clips: clips.map((clip) => ({
        ...clip,
        previewReady: false
      })),
      transcriptStatus: "Fast mode - preview validates clip",
      previewUrl: "",
      youtubeUrl: videoUrl,
      noDownload: true,
      fastMode: true
    });
    return;
  }

  const { stdout } = await run(YTDLP, [
    "--no-playlist",
    "--no-warnings",
    "--skip-download",
    "--print", "%(id)s\t%(title)s\t%(duration)s\t%(width)s\t%(height)s",
    videoUrl
  ]);

  const [printedVideoId, rawTitle, rawDuration, rawWidth, rawHeight] = stdout.trim().split("\t");
  const title = rawTitle || "YouTube video";
  const duration = Number(rawDuration || 0);
  let transcript = [];
  let transcriptProvider = transcript.length ? "youtube-captions" : "none";
  const probe = {
    duration,
    width: Number(rawWidth || 0),
    height: Number(rawHeight || 0),
    codec: "youtube-stream"
  };

  if (process.env.CLIPFORGE_ANALYZE_TRANSCRIPT === "1") {
    const detail = await run(YTDLP, [
      "--no-playlist",
      "--dump-single-json",
      "--skip-download",
      videoUrl
    ]);
    const info = JSON.parse(detail.stdout);
    transcript = await getTranscript(info, payload.language);
    transcriptProvider = transcript.length ? "youtube-captions" : "none";
  }

  if (!transcript.length && process.env.CLIPFORGE_AUTO_STT === "1" && (process.env.OPENAI_API_KEY || fs.existsSync(VENV_PYTHON))) {
    const speechResult = await getSpeechTranscriptForYouTube(projectDir, videoUrl, probe.duration, payload.duration, payload.language);
    transcript = speechResult.transcript;
    transcriptProvider = speechResult.provider;
  }

  const clips = buildTranscriptClips(transcript, probe.duration, payload.duration, []);

  writeProjectManifest(projectDir, {
    id,
    videoId: printedVideoId || videoId,
    type: "youtube",
    url: videoUrl,
    title,
    probe,
    transcriptPath: transcript.length ? "transcript.json" : "",
    transcriptProvider
  });

  if (transcript.length) {
    fs.writeFileSync(path.join(projectDir, "transcript.json"), JSON.stringify(transcript, null, 2));
  }

  sendJson(res, 200, {
    id,
    name: title,
    probe,
    clips: clips.map((clip) => ({
      ...clip,
      previewReady: false
    })),
    transcriptStatus: transcript.length ? `${transcriptProvider}: ${transcript.length} lines` : "No transcript/STT provider",
    previewUrl: "",
    youtubeUrl: videoUrl,
    noDownload: true
  });
}

function createJob(type, worker) {
  const id = crypto.randomUUID();
  const job = {
    id,
    type,
    status: "queued",
    progress: 0,
    createdAt: Date.now(),
    result: null,
    error: ""
  };

  job.worker = worker;
  jobs.set(id, job);
  jobQueue.push(job);
  pumpJobs();

  return job;
}

function pumpJobs() {
  while (activeJobs < MAX_ACTIVE_JOBS && jobQueue.length) {
    const job = jobQueue.shift();
    activeJobs += 1;
    job.status = "running";
    job.progress = Math.max(job.progress, 10);

    Promise.resolve()
      .then(() => job.worker((progress) => {
        job.progress = Math.max(job.progress, Math.min(99, progress));
      }))
      .then((result) => {
        job.result = result;
        job.progress = 100;
        job.status = "done";
      })
      .catch((error) => {
        job.error = error.message || "Job gagal.";
        job.status = "failed";
        job.progress = 100;
      })
      .finally(() => {
        delete job.worker;
        activeJobs -= 1;
        pumpJobs();
      });
  }
}

async function exportClip(payload, setProgress = () => {}) {
  const projectDir = path.join(UPLOAD_DIR, payload.projectId || "");
  const manifest = readProjectManifest(projectDir);
  const enriched = manifest.type === "youtube" ? await ensureClipTranscript(projectDir, manifest, payload) : null;
  if (enriched && (!payload.caption || /^Edit caption|Caption otomatis/i.test(payload.caption))) {
    payload.caption = enriched.caption;
  }
  setProgress(20);
  const sourcePath = findSourceFile(projectDir)
    || findCachedSection(projectDir, payload, "export")
    || findCachedSection(projectDir, payload, "preview")
    || (
    manifest.type === "youtube"
      ? await downloadYouTubeSection(projectDir, manifest, payload)
      : ""
  );

  if (!sourcePath) {
    throw new Error("Source video tidak ditemukan.");
  }

  setProgress(58);
  const outputName = `clip-${String(payload.clipId || 1).padStart(2, "0")}-${Date.now()}.mp4`;
  const outputPath = path.join(OUTPUT_DIR, outputName);
  const isSectionSource = manifest.type === "youtube" && sourcePath.includes(`${path.sep}sections${path.sep}`);
  const start = isSectionSource ? 0 : Math.max(0, Number(payload.start || 0));
  const originalStart = Math.max(0, Number(payload.start || 0));
  const originalEnd = Math.max(originalStart + 1, Number(payload.end || originalStart + 30));
  const end = isSectionSource ? originalEnd - originalStart : originalEnd;
  const filter = buildVideoFilter(payload);

  await run(FFMPEG, [
    "-y",
    "-ss", String(start),
    "-to", String(end),
    "-i", sourcePath,
    "-vf", filter,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "23",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    outputPath
  ]);

  setProgress(95);
  return {
    filename: outputName,
    downloadUrl: `/outputs/${outputName}`
  };
}

function sectionFileName(payload, suffix = "export") {
  const clipId = String(payload.clipId || 1).padStart(2, "0");
  const start = Math.max(0, Math.floor(Number(payload.start || 0)));
  const end = Math.max(start + 1, Math.ceil(Number(payload.end || start + 30)));
  return `${suffix}-${clipId}-${start}-${end}.mp4`;
}

function findCachedSection(projectDir, payload, suffix) {
  const sectionDir = path.join(projectDir, "sections");
  const stablePath = path.join(sectionDir, sectionFileName(payload, suffix));
  return fs.existsSync(stablePath) ? stablePath : "";
}

async function downloadYouTubeSection(projectDir, manifest, payload, options = {}) {
  const sectionDir = path.join(projectDir, "sections");
  fs.mkdirSync(sectionDir, { recursive: true });

  const clipId = String(payload.clipId || 1).padStart(2, "0");
  const suffix = options.preview ? "preview" : "export";
  const stablePath = path.join(sectionDir, sectionFileName(payload, suffix));
  if (fs.existsSync(stablePath)) return stablePath;

  const rawTemplate = path.join(sectionDir, `${suffix}-raw-${clipId}-%(id)s.%(ext)s`);
  const start = Math.max(0, Number(payload.start || 0));
  const end = Math.max(start + 1, Number(payload.end || start + 30));
  const section = `*${start}-${end}`;
  const format = options.preview
    ? "bv*[height<=360]+ba/b[height<=360]/best[height<=360]/best"
    : "bv*[height<=720]+ba/b[height<=720]/best[height<=720]/best";

  await run(YTDLP, [
    "--no-playlist",
    "-f", format,
    "--merge-output-format", "mp4",
    "--download-sections", section,
    "--force-keyframes-at-cuts",
    "-o", rawTemplate,
    manifest.url
  ]);

  const files = fs.readdirSync(sectionDir)
    .map((name) => path.join(sectionDir, name))
    .filter((filePath) => [".mp4", ".webm", ".mkv"].includes(path.extname(filePath).toLowerCase()))
    .filter((filePath) => path.basename(filePath).startsWith(`${suffix}-raw-${clipId}`))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  if (!files[0]) throw new Error("Gagal mengambil bagian clip dari YouTube.");

  await run(FFMPEG, [
    "-y",
    "-i", files[0],
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", options.preview ? "30" : "23",
    "-c:a", "aac",
    "-b:a", options.preview ? "96k" : "128k",
    "-movflags", "+faststart",
    stablePath
  ]);

  return stablePath;
}

async function handlePreview(req, res) {
  const payload = JSON.parse((await collectRequest(req, 20)).toString("utf8"));
  const projectDir = path.join(UPLOAD_DIR, payload.projectId || "");
  const manifest = readProjectManifest(projectDir);

  if (manifest.type !== "youtube") {
    const sourcePath = findSourceFile(projectDir);
    if (!sourcePath) {
      sendJson(res, 404, { error: "Source video tidak ditemukan." });
      return;
    }
    sendJson(res, 200, { previewUrl: `/media/${payload.projectId}` });
    return;
  }

  const sectionPath = await downloadYouTubeSection(projectDir, manifest, payload, { preview: true });
  sendJson(res, 200, {
    previewUrl: `/sections/${payload.projectId}/${path.basename(sectionPath)}`,
    cached: true
  });
}

async function downloadYouTubeAudioSection(projectDir, videoUrl, clip) {
  const audioDir = path.join(projectDir, "audio");
  fs.mkdirSync(audioDir, { recursive: true });

  const clipId = String(clip.id).padStart(2, "0");
  const outputPath = path.join(audioDir, `audio-${clipId}.mp3`);
  if (fs.existsSync(outputPath)) return outputPath;

  const rawTemplate = path.join(audioDir, `raw-${clipId}-%(id)s.%(ext)s`);
  const section = `*${clip.start}-${clip.end}`;

  await run(YTDLP, [
    "--no-playlist",
    "-f", "ba/best",
    "--download-sections", section,
    "--force-keyframes-at-cuts",
    "-o", rawTemplate,
    videoUrl
  ]);

  const rawFile = fs.readdirSync(audioDir)
    .map((name) => path.join(audioDir, name))
    .filter((filePath) => path.basename(filePath).startsWith(`raw-${clipId}`))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];

  if (!rawFile) throw new Error("Gagal mengambil audio clip dari YouTube.");

  await run(FFMPEG, [
    "-y",
    "-i", rawFile,
    "-vn",
    "-ar", "16000",
    "-ac", "1",
    "-b:a", "48k",
    outputPath
  ]);

  return outputPath;
}

async function getSpeechTranscriptForYouTube(projectDir, videoUrl, duration, targetLength, language) {
  const seedClips = buildClips(duration, targetLength).slice(0, 8);
  const transcript = [];
  let provider = "none";

  for (const clip of seedClips) {
    const audioPath = await downloadYouTubeAudioSection(projectDir, videoUrl, clip);
    const result = await transcribeAudio(audioPath, language);
    if (result.text) {
      provider = result.provider;
      transcript.push({
        start: clip.start,
        end: clip.end,
        text: result.text
      });
    }
  }

  return { transcript, provider };
}

function clipPayloadToClip(payload) {
  return {
    id: payload.clipId || 1,
    start: Math.max(0, Number(payload.start || 0)),
    end: Math.max(1, Number(payload.end || 30))
  };
}

async function ensureClipTranscript(projectDir, manifest, payload) {
  if (process.env.CLIPFORGE_ON_DEMAND_STT === "0") return null;
  if (!process.env.OPENAI_API_KEY && !fs.existsSync(VENV_PYTHON)) return null;

  const clip = clipPayloadToClip(payload);
  const transcriptDir = path.join(projectDir, "clip-transcripts");
  fs.mkdirSync(transcriptDir, { recursive: true });

  const transcriptPath = path.join(transcriptDir, `${sectionFileName(payload, "clip").replace(/\.mp4$/, ".json")}`);
  if (fs.existsSync(transcriptPath)) {
    return JSON.parse(fs.readFileSync(transcriptPath, "utf8"));
  }

  const audioPath = await downloadYouTubeAudioSection(projectDir, manifest.url, clip);
  const result = await transcribeAudio(audioPath, payload.language);
  if (!result.text) return null;

  const caption = cleanCaptionText(result.text).slice(0, 155);
  const data = {
    provider: result.provider,
    caption,
    hook: clipHook(caption, 0),
    start: clip.start,
    end: clip.end
  };
  fs.writeFileSync(transcriptPath, JSON.stringify(data, null, 2));
  return data;
}

async function handleExport(req, res) {
  const payload = JSON.parse((await collectRequest(req, 20)).toString("utf8"));
  const job = createJob("export", (setProgress) => exportClip(payload, setProgress));
  sendJson(res, 202, { jobId: job.id, status: job.status, progress: job.progress });
}

function handleJob(req, res, jobId) {
  const job = jobs.get(jobId);
  if (!job) {
    sendJson(res, 404, { error: "Job tidak ditemukan." });
    return;
  }

  sendJson(res, 200, job);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "POST" && url.pathname === "/api/upload") {
      await handleUpload(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/youtube") {
      await handleYouTube(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/export") {
      await handleExport(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/preview") {
      await handlePreview(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/jobs/")) {
      handleJob(req, res, path.basename(url.pathname));
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/outputs/")) {
      sendFile(res, path.join(OUTPUT_DIR, path.basename(url.pathname)));
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/media/")) {
      const id = path.basename(url.pathname);
      const sourcePath = findSourceFile(path.join(UPLOAD_DIR, id));
      sendMedia(req, res, sourcePath);
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/sections/")) {
      const [, , projectId, filename] = url.pathname.split("/");
      const sectionPath = path.join(UPLOAD_DIR, projectId || "", "sections", path.basename(filename || ""));
      sendMedia(req, res, sectionPath);
      return;
    }

    const requestPath = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = path.resolve(ROOT, `.${requestPath}`);

    if (!filePath.startsWith(ROOT) || filePath.includes(`${path.sep}uploads${path.sep}`)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    sendFile(res, filePath);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: error.message || "Server error" });
  }
});

function startServer(port = PORT, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      console.log(`ClipForge berjalan di http://${host}:${actualPort}`);
      resolve({ server, port: actualPort, url: `http://${host}:${actualPort}` });
    });
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { startServer };
