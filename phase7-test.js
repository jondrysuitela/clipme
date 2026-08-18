// ============================================================================
// phase7-test.js
// Tests LocalAI (speaker cut & face tracking) endpoints and export integration
// ============================================================================

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { startServer } = require("./server.js");

const TIMEOUT = 30000;

async function t(name, fn) {
  try {
    await fn();
    console.log(`[OK  ] ${name}`);
  } catch (err) {
    console.error(`[FAIL] ${name}\n  -> ${err.message}`);
    process.exitCode = 1;
  }
}

async function request(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https:") ? require("https") : require("http");
    const req = lib.request(url, opts, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, data: JSON.parse(body) }));
    });
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

(async function () {
  process.env.CLIPFORGE_DATA_DIR = path.join(__dirname, "test-data");
  fs.mkdirSync(process.env.CLIPFORGE_DATA_DIR, { recursive: true });

  const { server, url, shutdown } = await startServer(0, "127.0.0.1");

  await t("GET /api/localai/status", async () => {
    const res = await request(`${url}/api/localai/status`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.localai);
    assert.ok(res.data.aiBackend);
  });

  await t("POST /api/localai/analyze (no project)", async () => {
    const res = await request(`${url}/api/localai/analyze`, {
      method: "POST",
      body: JSON.stringify({ projectId: "invalid-id" })
    });
    assert.strictEqual(res.status, 400);
  });

  console.log("Phase7 done.");
  shutdown();
  fs.rmSync(process.env.CLIPFORGE_DATA_DIR, { recursive: true, force: true });
})();
