const { app, BrowserWindow, shell } = require("electron");
const path = require("node:path");
const { startServer } = require("../server.js");

// GPU acceleration: izinkan GPU rendering Chromium (kecuali user force CPU).
// ignore-gpu-blocklist: browser tetap pake GPU meski terdaftar di blocklist.
// enable-gpu-rasterization: GPU untuk rasterisasi (lebih cepat, lebih halus).
const accel = String(process.env.CLIPFORGE_ACCEL || "").toLowerCase();
if (accel !== "cpu") {
  app.commandLine.appendSwitch("ignore-gpu-blocklist");
  app.commandLine.appendSwitch("enable-gpu-rasterization");
  app.commandLine.appendSwitch("enable-features", "VaapiVideoDecoder");
}

let mainWindow;
let server;

app.whenReady().then(async () => {
  server = await startServer(0, "127.0.0.1");

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 620,
    title: "Clipper Studio",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.loadURL(server.url);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (server) {
    try { server.server.close(); } catch {}
    if (server.shutdown) server.shutdown();
  }
});

app.on("activate", () => {
  if (mainWindow) mainWindow.show();
});
