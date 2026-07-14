const { spawn } = require("node:child_process");
const path = require("node:path");

const electron = require("electron");
const env = { ...process.env };

delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_NO_ATTACH_CONSOLE;
env.VITE_DEV_SERVER_URL = env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173";

const child = spawn(electron, [path.join(__dirname, "..")], {
  env,
  stdio: "inherit",
  windowsHide: false
});

child.on("exit", (code) => process.exit(code ?? 0));
