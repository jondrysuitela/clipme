const assert = require("assert");
const fs = require("fs");
const { _test } = require("./server.js");
const hardware = require("./clipme-hardware.js");

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`[OK  ] ${name}`);
  } catch (error) {
    results.push({ name, ok: false });
    process.exitCode = 1;
    console.error(`[FAIL] ${name}\n  -> ${error.message}`);
  }
}

(async () => {
  await test("recognizes missing nvcuda.dll as an NVENC runtime failure", () => {
    assert.strictEqual(_test.isNvencRuntimeFailure(new Error("Cannot load nvcuda.dll")), true);
    assert.strictEqual(_test.isNvencRuntimeFailure(new Error("ordinary input file error")), false);
  });

  await test("failed NVENC attempt retries exactly once on CPU", async () => {
    const attempts = [];
    let fallbackError = null;
    const result = await _test.runWithNvencCpuFallback(
      { encoder: "h264_nvenc" },
      async (forceCpu) => {
        attempts.push(forceCpu);
        if (!forceCpu) throw new Error("Cannot load nvcuda.dll");
        return "cpu-ok";
      },
      async (error) => { fallbackError = error; }
    );
    assert.strictEqual(result, "cpu-ok");
    assert.deepStrictEqual(attempts, [false, true]);
    assert.match(fallbackError.message, /nvcuda/i);
  });

  await test("non-encoder failures are not hidden by a CPU retry", async () => {
    const attempts = [];
    await assert.rejects(
      _test.runWithNvencCpuFallback(
        { encoder: "h264_nvenc" },
        async (forceCpu) => {
          attempts.push(forceCpu);
          throw new Error("input file is corrupt");
        }
      ),
      /input file is corrupt/
    );
    assert.deepStrictEqual(attempts, [false]);
  });

  await test("forceCpu command replaces h264_nvenc with libx264", () => {
    const base = {
      input: "input.mp4",
      duration: 3,
      filterGraph: "scale=1080:1920",
      outputPath: "output.mp4",
      encoderInfo: { encoder: "h264_nvenc", preset: "p4", qualityValue: "23" }
    };
    const gpuArgs = _test.buildFilterCommandArgs(base);
    const cpuArgs = _test.buildFilterCommandArgs({ ...base, forceCpu: true });
    assert.ok(gpuArgs.includes("h264_nvenc"));
    assert.ok(!gpuArgs.includes("libx264"));
    assert.ok(cpuArgs.includes("libx264"));
    assert.ok(!cpuArgs.includes("h264_nvenc"));
  });

  await test("AUTO runtime requires a successful NVENC runtime probe", () => {
    const runtime = hardware.resolveRuntime({
      gpu: { present: false },
      cuda: { available: false, fallback: false },
      nvenc: { h264: true, compiled: true, runtimeTested: true, available: false }
    }, { CLIPFORGE_ACCEL: "auto" });
    assert.strictEqual(runtime.encoder, "libx264");
    assert.strictEqual(runtime.nvencAvailable, false);
  });

  await test("hardware detection contains a real one-frame NVENC smoke test", () => {
    const source = fs.readFileSync("clipme-hardware.js", "utf8");
    assert.match(source, /color=c=black:s=64x64:d=0\.04/);
    assert.match(source, /"-c:v", "h264_nvenc"/);
    assert.match(source, /result\.available = commandSucceeds/);
  });

  if (!process.exitCode) console.log(`Encoder fallback done: ${results.length}/${results.length} PASS`);
})();
