const fs = require("fs");
const h = fs.readFileSync("index.html", "utf8");
const j = fs.readFileSync("script.js", "utf8");
const s = fs.readFileSync("server.js", "utf8");

const panelStart = h.indexOf('data-view-panel="publish"');
const panelNext = h.indexOf('data-view-panel=', panelStart + 5);
const seg = h.slice(panelStart, panelNext > panelStart ? panelNext : panelStart + 15000);
const ids = [...new Set([...seg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]))];
console.log("PUBLISH PANEL IDS:", ids.join(", "));

console.log("\n=== CALLERS of openPublishForClip ===");
for (const m of j.matchAll(/openPublishForClip/g)) {
  const line = j.slice(j.lastIndexOf("\n", m.index - 1) + 1, j.indexOf("\n", m.index)).trim();
  console.log("  →", line.slice(0, 100));
}
console.log("\n=== riAnalyzeBtn refs ===");
for (const m of j.matchAll(/riAnalyzeBtn/g)) {
  const line = j.slice(j.lastIndexOf("\n", m.index - 1) + 1, j.indexOf("\n", m.index) + 1).trim();
  console.log("  →", line.slice(0, 100));
}
console.log("\n=== JS publish-state/functions ===");
for (const t of ["publishState", "pubChecklistUpdate", "populatePubSources", "ensurePublishMetadata", "populatePubProjects", "pubFillFieldsFromClip", "updatePublishAvailability", "openPublishForClip"]) {
  const n = (j.match(new RegExp(t, "g")) || []).length;
  if (n) console.log(`  ${t}: ${n}`);
}
console.log("\n=== copyToClipboard usage (shared) ===");
console.log("  def+callers:", (j.match(/copyToClipboard/g) || []).length);
console.log("\n=== server /api/export + social routes ===");
console.log("  /api/export:", (s.match(/\/api\/export/g) || []).length, "| /api/social:", (s.match(/\/api\/social/g) || []).length);
console.log("\n=== tests referencing publish ===");
const ts = fs.readFileSync("preview-boundary-test.js", "utf8");
for (const t of ["publish", "pubTitle", "pubExportBtn", "copyTitleBtn", "openPublishForClip", "riAnalyzeBtn", "pubPublishNowBtn"]) {
  const n = (ts.match(new RegExp(t, "g")) || []).length;
  if (n) console.log(`  ${t}: ${n}`);
}