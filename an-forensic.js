const fs = require("fs");
const h = fs.readFileSync("index.html", "utf8");
const j = fs.readFileSync("script.js", "utf8");
const s = fs.readFileSync("server.js", "utf8");

// Panel analytics IDs
const start = h.indexOf('data-view-panel="analytics"');
const next = h.indexOf('data-view-panel=', start + 5);
const seg = h.slice(start, next > start ? next : start + 15000);
const ids = [...new Set([...seg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]))];
console.log("ANALYTICS PANEL IDS:", ids.join(", "));

// JS references
for (const t of ["anRefreshBtn", "anViews", "anLikes", "anComments", "anShares", "anTop", "anPlatforms", "anGrowth", "analyticsEmpty", "analyticsPanels", "loadAnalytics", "renderAnalytics", "anTitle"]) {
  const n = (j.match(new RegExp(t, "g")) || []).length;
  const hh = (h.match(new RegExp(t, "g")) || []).length;
  if (n || hh) console.log(`  ${t}: js=${n} html=${hh}`);
}
// api/perf usage in JS (shared consumers)
console.log("JS /api/perf:", (j.match(/\/api\/perf/g) || []).length);
console.log("JS perfPathFor-like callers:", (j.match(/\.perf\.json|renderPerf|perfRecords|loadPerf|savePerf|/g) || []).length);
console.log("server handleGetPerf:", (s.match(/handleGetPerf/g) || []).length, "| perfPathFor:", (s.match(/perfPathFor/g) || []).length);

// test refs
const ts = fs.readFileSync("preview-boundary-test.js", "utf8");
for (const t of ["anRefreshBtn", "analytics", "anViews", "analyticsEmpty", "anTop", "/api/perf", "computeProductionInsights"]) {
  const n = (ts.match(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
  if (n) console.log(`  TEST ${t}: ${n}`);
}