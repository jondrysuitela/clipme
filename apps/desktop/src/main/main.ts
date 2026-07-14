import { app, BrowserWindow, net, protocol, screen } from "electron";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { initDatabase } from "./database/db";
import { createIpcHandlers } from "./ipc/handlers";
import { listProjects } from "./services/projectService";
import { getSettings } from "./services/settingsService";

let mainWindow: BrowserWindow | undefined;
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "clipme-media",
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true
    }
  }
]);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    title: "ClipMe",
    backgroundColor: "#101215",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });

  mainWindow.once("ready-to-show", () => {
    showMainWindow();
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  const load = devUrl ? mainWindow.loadURL(devUrl) : mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  void load.then(() => showMainWindow()).catch((error) => {
    console.error("Failed to load ClipMe window", error);
    showMainWindow();
  });
}

function initAutoUpdater() {
  try {
    // dynamically require so builds without electron-updater still work
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { autoUpdater } = require("electron-updater");
    autoUpdater.autoDownload = true;
    autoUpdater.on("checking-for-update", () => mainWindow?.webContents.send("update:checking"));
    autoUpdater.on("update-available", (info: unknown) => mainWindow?.webContents.send("update:available", info));
    autoUpdater.on("update-not-available", (info: unknown) => mainWindow?.webContents.send("update:not-available", info));
    autoUpdater.on("error", (err: unknown) => mainWindow?.webContents.send("update:error", String(err)));
    autoUpdater.on("update-downloaded", (info: unknown) => mainWindow?.webContents.send("update:downloaded", info));
    setTimeout(() => {
      try {
        void autoUpdater.checkForUpdates();
      } catch {}
    }, 5000);
  } catch (err) {
    console.info("autoUpdater not available", err);
  }
}

function initTelemetry() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sentry = require("@sentry/electron");
    const settings = getSettings();
    const dsn = process.env.SENTRY_DSN;
    if (!dsn) {
      console.info("Sentry DSN not configured; skipping telemetry initialization.");
      return;
    }
    if (!settings.telemetryEnabled) {
      console.info("Telemetry disabled in settings.");
      return;
    }
    Sentry.init({
      dsn,
      release: `${app.getName()}@${app.getVersion()}`,
      environment: process.env.NODE_ENV || "production"
    });
    console.info("Sentry telemetry initialized.");
  } catch (err) {
    console.info("Telemetry initialization failed", err);
  }
}

function showMainWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  ensureWindowIsOnScreen(mainWindow);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function ensureWindowIsOnScreen(window: BrowserWindow) {
  const bounds = window.getBounds();
  if (bounds.x <= -10000 || bounds.y <= -10000) {
    window.center();
    return;
  }

  const displays = screen.getAllDisplays();
  const isVisible = displays.some((display) => {
    const area = display.workArea;
    return (
      bounds.x < area.x + area.width &&
      bounds.x + bounds.width > area.x &&
      bounds.y < area.y + area.height &&
      bounds.y + bounds.height > area.y
    );
  });
  if (!isVisible) window.center();
}

app.on("second-instance", () => {
  showMainWindow();
});

app.whenReady().then(async () => {
  await initDatabase(app.getPath("userData"));
  protocol.handle("clipme-media", (request) => {
    const filePath = decodeMediaPath(request.url);
    if (!isAllowedMediaPath(filePath)) {
      return new Response("Media not available.", { status: 404 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
  createIpcHandlers(() => mainWindow);
  initTelemetry();
  createWindow();
  initAutoUpdater();

  app.on("activate", () => {
    showMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

function decodeMediaPath(requestUrl: string) {
  const url = new URL(requestUrl);
  if (url.hostname !== "local") throw new Error("Invalid ClipMe media host.");
  const encodedPath = url.pathname.replace(/^\//, "");
  return decodeURIComponent(encodedPath);
}

function isAllowedMediaPath(filePath: string) {
  const resolvedFile = normalizeExistingPath(filePath);
  if (!resolvedFile || !fs.statSync(resolvedFile).isFile()) return false;

  const allowedRoots = listProjects().map((project) => project.rootPath);

  return allowedRoots.some((root) => isPathInside(resolvedFile, root));
}

function normalizeExistingPath(filePath: string) {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return undefined;
  }
}

function isPathInside(filePath: string, rootPath: string) {
  const resolvedRoot = normalizeExistingPath(rootPath);
  if (!resolvedRoot) return false;
  const relative = path.relative(resolvedRoot, filePath);
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}
