const fs = require('node:fs');
const path = require('node:path');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');

const outDir = path.join(__dirname, '..', 'resources', 'ffmpeg');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

function copyIfExists(src, destName) {
  if (!src) return console.warn('Binary not found for', destName);
  const dest = path.join(outDir, destName);
  try {
    fs.copyFileSync(src, dest);
    fs.chmodSync(dest, 0o755);
    console.log('Copied', src, '->', dest);
  } catch (err) {
    console.warn('Failed to copy', src, '->', dest, err.message);
  }
}

copyIfExists(ffmpegStatic, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
copyIfExists(ffprobeStatic.path || ffprobeStatic, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');

console.log('ffmpeg copy script complete');
