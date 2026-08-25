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

// Port tetap supaya OAuth redirect URI stabil (TikTok/Meta butuh URI exact
// yang terdaftar di developer console). Fallback ke port acak bila terpakai.
const OAUTH_PORT = Number(process.env.CLIPFORGE_OAUTH_PORT || 43110);

async function startAppServer() {
  try {
    return await startServer(OAUTH_PORT, "127.0.0.1");
  } catch {
    console.warn(`[OAuth] Port ${OAUTH_PORT} terpakai — fallback port acak. Connect sosmed mungkin gagal sesi ini.`);
    return await startServer(0, "127.0.0.1");
  }
}

app.whenReady().then(async () => {
  server = await startAppServer();

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
    // shutdown() = server.close(). Panggil sekali saja; server.server.close()
    // diikuti shutdown() memicu ERR_SERVER_NOT_RUNNING (double close).
    try { server.shutdown(); } catch {}
  }
});

app.on("activate", () => {
  if (mainWindow) mainWindow.show();
});
