const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const WHISPER_VERSION = "v1.9.1";
const BINARY_URL = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_VERSION}/whisper-bin-x64.zip`;
const MODEL_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin";
const MODEL_NAME = "ggml-tiny.bin";

const resourcesDir = path.join(__dirname, "..", "resources", "whisper");
const binaryPath = path.join(resourcesDir, "whisper.exe");
const modelPath = path.join(resourcesDir, MODEL_NAME);

function downloadWithPowerShell(url, dest) {
  if (fs.existsSync(dest)) {
    console.log(`Already exists: ${dest}`);
    return Promise.resolve();
  }
  console.log(`Downloading ${path.basename(dest)} from ${url}...`);
  const temp = dest + ".tmp";
  return new Promise((resolve, reject) => {
    const ps = spawn("powershell", [
      "-NoProfile", "-Command",
      `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri "${url}" -OutFile "${temp}" -UseBasicParsing`
    ], { stdio: "inherit" });
    ps.on("close", (code) => {
      if (code !== 0) {
        if (fs.existsSync(temp)) fs.unlinkSync(temp);
        reject(new Error(`PowerShell download failed with code ${code}`));
        return;
      }
      fs.renameSync(temp, dest);
      console.log(`Downloaded: ${path.basename(dest)} (${(fs.statSync(dest).size / 1024 / 1024).toFixed(1)} MB)`);
      resolve();
    });
    ps.on("error", reject);
  });
}

function extractWithPowerShell(zipPath, destDir) {
  console.log(`Extracting ${path.basename(zipPath)}...`);
  return new Promise((resolve, reject) => {
    const ps = spawn("powershell", [
      "-NoProfile", "-Command",
      `Expand-Archive -Path "${zipPath}" -DestinationPath "${destDir}" -Force`
    ], { stdio: "inherit" });
    ps.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Extract failed with code ${code}`)));
    ps.on("error", reject);
  });
}

function findExe(dir) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (entry.endsWith(".exe") && entry.toLowerCase().includes("whisper")) return full;
    if (fs.statSync(full).isDirectory()) {
      const found = findExe(full);
      if (found) return found;
    }
  }
  return null;
}

async function main() {
  fs.mkdirSync(resourcesDir, { recursive: true });

  if (!fs.existsSync(binaryPath)) {
    const zipPath = path.join(resourcesDir, "whisper-binx64.zip");
    await downloadWithPowerShell(BINARY_URL, zipPath);
    await extractWithPowerShell(zipPath, resourcesDir);
    fs.unlinkSync(zipPath);

    const exePath = findExe(resourcesDir);
    if (exePath && exePath !== binaryPath) {
      fs.copyFileSync(exePath, binaryPath);
      fs.chmodSync(binaryPath, 0o755);
      console.log(`Moved whisper.exe to ${binaryPath}`);
    }

    // Cleanup extracted subfolders
    for (const entry of fs.readdirSync(resourcesDir)) {
      const full = path.join(resourcesDir, entry);
      if (fs.statSync(full).isDirectory() && !entry.includes("whisper")) {
        fs.rmSync(full, { recursive: true, force: true });
      }
    }
  } else {
    console.log(`whisper.exe already exists: ${binaryPath}`);
  }

  await downloadWithPowerShell(MODEL_URL, modelPath);
  console.log("\nWhisper setup complete!");
  console.log(`Binary: ${binaryPath}`);
  console.log(`Model:  ${modelPath}`);
}

main().catch((err) => {
  console.error("Setup failed:", err.message);
  process.exit(1);
});
