const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const https = require("node:https");
const ffmpegStatic = require("ffmpeg-static");
const ffprobeStatic = require("ffprobe-static");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyIfExists(src, destDir, destName) {
  if (!src || !fs.existsSync(src)) {
    console.warn("Binary not found for", destName);
    return false;
  }

  ensureDir(destDir);
  const dest = path.join(destDir, destName);
  try {
    fs.copyFileSync(src, dest);
    fs.chmodSync(dest, 0o755);
    console.log("Copied", src, "->", dest);
    return true;
  } catch (err) {
    console.warn("Failed to copy", src, "->", dest, err.message);
    return false;
  }
}

function findOnPath(command) {
  const lookup = process.platform === "win32" ? "where.exe" : "command";
  const args = process.platform === "win32" ? [command] : ["-v", command];
  const result = spawnSync(lookup, args, { encoding: "utf8", shell: process.platform !== "win32" });
  if (result.status !== 0) return undefined;
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

function downloadFile(url, dest) {
  return new Promise((resolve) => {
    const request = https.get(url, { headers: { "User-Agent": "ClipMe-builder" } }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode || 0) && response.headers.location) {
        response.resume();
        downloadFile(response.headers.location, dest).then(resolve);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        console.warn("Failed to download", url, "HTTP", response.statusCode);
        resolve(false);
        return;
      }

      ensureDir(path.dirname(dest));
      const temp = `${dest}.download`;
      const file = fs.createWriteStream(temp);
      response.pipe(file);
      file.on("finish", () => {
        file.close(() => {
          fs.renameSync(temp, dest);
          fs.chmodSync(dest, 0o755);
          console.log("Downloaded", url, "->", dest);
          resolve(true);
        });
      });
      file.on("error", (error) => {
        console.warn("Failed to write download", error.message);
        resolve(false);
      });
    });
    request.on("error", (error) => {
      console.warn("Failed to download", url, error.message);
      resolve(false);
    });
    request.setTimeout(30000, () => {
      request.destroy(new Error("download timeout"));
    });
  });
}

const resourcesDir = path.join(__dirname, "..", "resources");
const ffmpegDir = path.join(resourcesDir, "ffmpeg");
const ytdlpDir = path.join(resourcesDir, "yt-dlp");

ensureDir(ffmpegDir);
ensureDir(ytdlpDir);

copyIfExists(ffmpegStatic, ffmpegDir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
copyIfExists(ffprobeStatic.path || ffprobeStatic, ffmpegDir, process.platform === "win32" ? "ffprobe.exe" : "ffprobe");

const ytdlpPath = process.env.YTDLP_BIN || findOnPath(process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp") || findOnPath("yt-dlp");

async function main() {
  const ytdlpName = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
  const ytdlpDest = path.join(ytdlpDir, ytdlpName);
  const downloaded = process.platform === "win32" && !process.env.YTDLP_BIN
    ? await downloadFile("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe", ytdlpDest)
    : false;
  if (!downloaded) copyIfExists(ytdlpPath, ytdlpDir, ytdlpName);

  console.log("Runtime binary copy complete");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
