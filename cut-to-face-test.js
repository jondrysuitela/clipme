const assert = require("assert");
const fs = require("fs");
const cutToFace = require("./clipme-cut-to-face.js");

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`[OK  ] ${name}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.error(`[FAIL] ${name}\n  -> ${error.message}`);
    process.exitCode = 1;
  }
}

function close(actual, expected, epsilon = 0.001) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
}

test("smart crop keeps the face in the upper third and inside source bounds", () => {
  const crop = cutToFace.smartCrop({ x: 1450, y: 140, w: 180, h: 220 }, 1920, 1080, 9 / 16);
  close(crop.w, 607.5);
  close(crop.h, 1080);
  assert.ok(crop.x >= 0 && crop.x + crop.w <= 1920);
  assert.ok(crop.y >= 0 && crop.y + crop.h <= 1080);
  close(crop.x, 1236.25);
});

test("crop matrix maps crop edges exactly to preview edges", () => {
  const crop = { x: 656.25, y: 0, w: 607.5, h: 1080 };
  const transform = cutToFace.cropTransform(crop, 1920, 1080, 270, 480);
  close(transform.scaleX * (crop.x / 1920 * 270) + transform.translateX, 0, 0.002);
  close(transform.scaleX * ((crop.x + crop.w) / 1920 * 270) + transform.translateX, 270, 0.002);
  close(transform.scaleY * (crop.y / 1080 * 480) + transform.translateY, 0, 0.002);
  close(transform.scaleY * ((crop.y + crop.h) / 1080 * 480) + transform.translateY, 480, 0.002);
  assert.match(transform.css, /^matrix\(/);
});

test("association lookup switches at exact segment boundaries", () => {
  const associations = cutToFace.prepareAssociations([
    { start_ms: 1000, end_ms: 3000, speaker_id: "A", face: { x: 100, y: 100, w: 100, h: 100 } },
    { start_ms: 3000, end_ms: 5000, speaker_id: "B", face: { x: 900, y: 100, w: 100, h: 100 } }
  ], 1280, 720, 9 / 16);
  assert.strictEqual(cutToFace.findActiveAssociation(associations, 999), null);
  assert.strictEqual(cutToFace.findActiveAssociation(associations, 1000).speaker_id, "A");
  assert.strictEqual(cutToFace.findActiveAssociation(associations, 3000).speaker_id, "B");
  assert.strictEqual(cutToFace.findActiveAssociation(associations, 5000), null);
});

test("browser wiring loads helper and updates transform on video timeupdate", () => {
  const html = fs.readFileSync("index.html", "utf8");
  const script = fs.readFileSync("script.js", "utf8");
  const css = fs.readFileSync("styles.css", "utf8");
  assert.ok(html.indexOf("clipme-cut-to-face.js") < html.indexOf("script.js"));
  assert.match(script, /previewVideo\.addEventListener\("timeupdate", updatePreviewFaceTransform\)/);
  assert.match(script, /waitForJob\(data\.jobId\)/);
  assert.match(css, /\.phone-frame\.cut-to-face-active \.preview-video/);
});

if (!process.exitCode) console.log(`Cut-to-Face done: ${results.length}/${results.length} PASS`);
