const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const { spawn } = require("node:child_process");

const WHISPER_VERSION = "v1.7.4";
const BINARY_URL = `https://github.com/ggerganov/whisper.cpp/releases/download/${WHISPER_VERSION}/whisper-binx64.zip`;
const MODEL_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin";
const MODEL_NAME = "ggml-tiny.bin";

const resourcesDir = path.join(__dirname, "..", "resources", "whisper");
const binaryPath = path.join(resourcesDir, "whisper.exe");
const modelPath = path.join(resourcesDir, MODEL_NAME);

async function download(url, dest) {
  if (fs.existsSync(dest)) {
    console.log(`Already exists: ${dest}`);
    return;
  }
  console.log(`Downloading ${url}...`);
  const temp = dest + ".tmp";
  const file = fs.createWriteStream(temp);
  await new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      res.pipe(file);
      file.on("finish", () => {
        file.close();
        fs.renameSync(temp, dest);
        resolve();
      });
    }).on("error", (err) => {
      fs.unlinkSync(temp);
      reject(err);
    });
  });
  console.log(`Downloaded: ${path.basename(dest)}`);
}

async function extractZip(zipPath, destDir) {
  const AdmZip = (await import("adm-zip")).default;
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(destDir, true);
  console.log(`Extracted to: ${destDir}`);
}

async function main() {
  fs.mkdirSync(resourcesDir, { recursive: true });

  if (!fs.existsSync(binaryPath)) {
    const zipPath = path.join(resourcesDir, "whisper-binx64.zip");
    await download(BINARY_URL, zipPath);
    // Extract the zip - try using PowerShell if adm-zip is not available
    try {
      await extractZip(zipPath, resourcesDir);
    } catch {
      console.log("Extracting with PowerShell...");
      await new Promise((resolve, reject) => {
        const proc = spawn("powershell", [
          "-Command",
          `Expand-Archive -Path "${zipPath}" -DestinationPath "${resourcesDir}" -Force`
        ], { stdio: "inherit" });
        proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Extract failed with code ${code}`)));
      });
    }
    fs.unlinkSync(zipPath);
    // The zip extracts to a folder named after the version; move the exe up
    const subdirs = fs.readdirSync(resourcesDir).filter((f) => f !== "whisper-binx64.zip" && f.endsWith(".exe"));
    if (!subdirs.length) {
      // Find the exe in subdirectories
      const findExe = (dir) => {
        for (const entry of fs.readdirSync(dir)) {
          const full = path.join(dir, entry);
          if (entry.endsWith(".exe")) return full;
          if (fs.statSync(full).isDirectory()) {
            const found = findExe(full);
            if (found) return found;
          }
        }
        return null;
      };
      const exePath = findExe(resourcesDir);
      if (exePath && exePath !== binaryPath) {
        fs.copyFileSync(exePath, binaryPath);
        console.log(`Moved whisper.exe to ${binaryPath}`);
      }
    }
  }

  await download(MODEL_URL, modelPath);
  console.log("Whisper setup complete!");
}

main().catch((err) => {
  console.error("Setup failed:", err.message);
  process.exit(1);
});
