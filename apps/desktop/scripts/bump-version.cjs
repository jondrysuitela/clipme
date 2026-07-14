const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.join(__dirname, "..", "..", "..");
const rootPackagePath = path.join(rootDir, "package.json");
const appPackagePath = path.join(rootDir, "apps", "desktop", "package.json");
const lockPath = path.join(rootDir, "package-lock.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function nextPatch(version) {
  const parts = version.split(".").map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
    throw new Error(`Unsupported semver version: ${version}`);
  }
  parts[2] += 1;
  return parts.join(".");
}

const rootPackage = readJson(rootPackagePath);
const appPackage = readJson(appPackagePath);
const nextVersion = nextPatch(appPackage.version);

rootPackage.version = nextVersion;
appPackage.version = nextVersion;

writeJson(rootPackagePath, rootPackage);
writeJson(appPackagePath, appPackage);

if (fs.existsSync(lockPath)) {
  const lock = readJson(lockPath);
  lock.version = nextVersion;
  if (lock.packages?.[""]) lock.packages[""].version = nextVersion;
  if (lock.packages?.["apps/desktop"]) lock.packages["apps/desktop"].version = nextVersion;
  writeJson(lockPath, lock);
}

console.log(`ClipMe version bumped to ${nextVersion}`);
