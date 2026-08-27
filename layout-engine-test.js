const assert = require("assert");
const d = require("./clipme-camera-director.js");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log(`[OK  ] ${name}`); }
  catch (e) { fail++; console.log(`[FAIL] ${name} — ${e.message}`); }
}

t("layoutsForRatio supports squaare/9:16/4:5 correctly", () => {
  assert.ok(d.layoutsForRatio("portrait").includes("PIP"));
  assert.ok(d.layoutsForRatio("square").includes("GRID_4"));
  assert.ok(!d.layoutsForRatio("square").includes("PIP"));
});

const mk = (x, y, w, h, confidence = 0.8) => ({ x, y, w, h, confidence });

t("autodetect 1 subject → SINGLE", () => {
  const dec = d.layoutDecision([mk(0.4, 0.3, 0.2, 0.35)]);
  assert.strictEqual(dec.layout, "SINGLE");
});

t("autodetect 2 distant subjects → SPLIT_2", () => {
  const dec = d.layoutDecision([mk(0.3, 0.4), mk(0.7, 0.4)]);
  assert.strictEqual(dec.layout, "SPLIT_2");
});

t("autodetect 2 close subjects → PIP", () => {
  const dec = d.layoutDecision([mk(0.42, 0.4), mk(0.5, 0.42)]);
  assert.strictEqual(dec.layout, "PIP");
});

t("autodetect 4 → GRID_4", () => {
  const dec = d.layoutDecision([
    mk(0.2, 0.2), mk(0.7, 0.2), mk(0.2, 0.7), mk(0.7, 0.7)
  ]);
  assert.strictEqual(dec.layout, "GRID_4");
});

t("low-confidence subjects ignored → FULL fallback", () => {
  const dec = d.layoutDecision([mk(0.4, 0.3, 0.2, 0.35, 0.1)]);
  assert.strictEqual(dec.layout, "FULL");
});

t("SPLIT_2 windows inside bounds & normalized", () => {
  const wins = d.layoutWindows("SPLIT_2", [mk(0.3, 0.4), mk(0.7, 0.4)]);
  assert.strictEqual(wins.length, 2);
  for (const win of wins) {
    assert.ok(win.x >= 0 && win.x + win.w <= 1, "x window in range");
    assert.ok(win.y >= 0 && win.y + win.h <= 1, "y window in range");
  }
  // dua jendela berdampingan (left/right)
  assert.ok(wins[0].x < wins[1].x, "left < right");
});

t("GRID_4 windows fill 2x2 cells", () => {
  const wins = d.layoutWindows("GRID_4", [mk(0.2,0.2),mk(0.7,0.2),mk(0.2,0.7),mk(0.7,0.7)]);
  assert.strictEqual(wins.length, 4);
});

t("PIP: main window + overlay (2 windows)", () => {
  const wins = d.layoutWindows("PIP", [mk(0.45,0.4), mk(0.75,0.4)]);
  assert.strictEqual(wins.length, 2);
  assert.ok(wins[0].w > wins[1].w, "main bigger than pip");
});

console.log(`\nLayout Engine: ${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);