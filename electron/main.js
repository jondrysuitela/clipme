const { app, BrowserWindow } = require("electron");
const { startServer } = require("../server.js");

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
    icon: require("path").join(__dirname, "..", "build", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadURL(server.url);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (server) server.server.close();
});

app.on("activate", () => {
  if (mainWindow) mainWindow.show();
});
