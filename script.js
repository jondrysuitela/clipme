let clips = [
  {
    id: 1,
    title: "Upload video untuk mulai",
    start: 0,
    end: 30,
    caption: "Upload video, lalu aplikasi akan membuat clip dan export MP4.",
    hook: "Belum ada video",
    score: 0
  }
];

const state = {
  activeClip: clips[0],
  sorted: false,
  sourceUrl: "",
  previewClipKey: "",
  sourceName: "",
  youtubeUrl: "",
  noDownload: false,
  projectId: "",
  projects: [],
  exports: [],
  isExporting: false,
  loopTimer: 0,
  liveSegments: [],
  liveActive: false,
  liveOffset: 0,
  captionSegments: [],
  captionSelected: -1,
  captionLoadedFor: "",
  captionByClip: {},
  timelineZoom: 1,
  userScrolling: false,
  userScrollTimer: 0,
  suppressScrollMark: false,
  selectedClipIds: new Set(),
  captionPosition: 0.76,
  fps: 25,
  crf: 23,
  audioBitrate: 128,
  watermark: "",
  watermarkPosition: "br",
  watermarkOpacity: 0.6,
  sourceDuration: 0,
  exportRatios: ["portrait"],
  history: [],
  historyIndex: -1,
  sttModel: ""
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function clipmeLangTag(language) {
  if (language === "English") return "en";
  if (language === "Mixed") return "mix";
  return "id";
}

// Bahasa target caption tetap Indonesia (dropdown Language dihapus). STT
// auto-detect bahasa asli audio; terjemahan otomatis menyesuaikan.
const CAPTION_LANG = "Indonesia";

const clipList = $("#clipList");
const previewTitle = $("#previewTitle");
const captionBox = $("#captionBox");
const liveCaption = $("#liveCaption");
const hookInput = $("#hookInput");
const captionInput = $("#captionInput");
const captionSize = $("#captionSize");
const captionPosition = $("#captionPosition");
const captionFontSelect = $("#captionFontSelect");
const captionColorInput = $("#captionColor");
const previewFrame = $("#previewFrame");
const previewVideo = $("#previewVideo");
const uploadStatus = $("#uploadStatus");
const toast = $("#toast");
const clipTime = $("#clipTime");
const libraryList = $("#libraryList");
const exportsList = $("#exportsList");
const processSteps = $("#processSteps");
const captionTimelinePanel = $("#captionTimelinePanel");
const captionTrack = $("#captionTrack");
const captionPlayhead = $("#captionPlayhead");
const captionEditInput = $("#captionEditInput");
const captionEditIndex = $("#captionEditIndex");
const captionEditTime = $("#captionEditTime");

const CAPTION_FONT_RATIO = 0.07;
const CAPTION_FONT_BASE = 23;

function captionPreviewFontPx() {
  const frameW = previewFrame.clientWidth || 330;
  return Math.max(8, Math.round(frameW * CAPTION_FONT_RATIO * (Number(captionSize.value || CAPTION_FONT_BASE) / CAPTION_FONT_BASE)));
}

function applyCaptionPosition() {
  const bottom = `${(1 - (state.captionPosition || 0.76)) * 100}%`;
  captionBox.style.bottom = bottom;
  liveCaption.style.bottom = bottom;
}

function applyCaptionVisuals() {
  const font = (captionFontSelect && captionFontSelect.value) || "Arial";
  const color = captionColorInput ? captionColorInput.value : "";
  const style = ($("#captionStyleSelect") && $("#captionStyleSelect").value) || "bold";
  captionBox.style.fontFamily = font;
  liveCaption.style.fontFamily = font;
  const useColor = /^#[0-9a-fA-F]{6}$/.test(color) && color.toLowerCase() !== "#ffffff";
  if (useColor) {
    if (style === "karaoke") {
      captionBox.style.setProperty("--lc-color-active", color);
      liveCaption.style.setProperty("--lc-color-active", color);
    } else {
      captionBox.style.setProperty("--lc-color", color);
      liveCaption.style.setProperty("--lc-color", color);
    }
  } else {
    captionBox.style.removeProperty("--lc-color");
    captionBox.style.removeProperty("--lc-color-active");
    liveCaption.style.removeProperty("--lc-color");
    liveCaption.style.removeProperty("--lc-color-active");
  }
}

function renderStaticCaption() {
  const style = $("#captionStyleSelect").value;
  captionBox.style.fontSize = `${captionPreviewFontPx()}px`;
  captionBox.className = "caption-box" + (style !== "off" ? ` lc-${style}` : "");
  // Sama dengan export: posisi diukur dari ATAS frame (baseY = H * position).
  applyCaptionPosition();
  applyCaptionVisuals();
  const hasText = captionBox.textContent && captionBox.textContent.replace(/"/g, "").trim();
  captionBox.style.display = style !== "off" && hasText ? "block" : "none";
}

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function formatTime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const parts = hours > 0 ? [hours, minutes, secs] : [minutes, secs];
  return parts.map((part) => String(part).padStart(2, "0")).join(":");
}

function clipRange(clip) {
  return `${formatTime(clip.start)} - ${formatTime(clip.end)}`;
}

function parseTimeInput(value) {
  const str = String(value || "").trim();
  if (!str) return NaN;
  if (/^\d+(\.\d+)?$/.test(str)) return Number(str);
  const m = str.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
  if (m) return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  const mm = str.match(/^(?:(\d+)m)?\s*(\d+)(?:\.(\d+))?s?$/);
  if (mm) return Number(mm[1] || 0) * 60 + Number(mm[2]) + Number(mm[3] || 0) / 10;
  return NaN;
}

function syncTrimInputs() {
  if (!state.activeClip) return;
  $("#trimStart").value = formatTime(state.activeClip.start);
  $("#trimEnd").value = formatTime(state.activeClip.end);
}

function snapshotEditable() {
  return {
    clips: (clips || []).map((clip) => ({
      ...clip,
      start: Number(clip.start) || 0,
      end: Number(clip.end) || 0,
      caption: clip.caption || "",
      hook: clip.hook || ""
    })),
    captionByClip: Object.fromEntries(Object.entries(state.captionByClip || {}).map(([key, segs]) => [
      key,
      (Array.isArray(segs) ? segs : []).map((s) => ({ ...s, words: Array.isArray(s.words) ? s.words.slice() : [] }))
    ]))
  };
}

function restoreSnapshot(snap) {
  if (!snap) return;
  const prevActiveId = state.activeClip ? state.activeClip.id : (clips[0] ? clips[0].id : null);
  clips.splice(0, clips.length, ...snap.clips);
  state.captionByClip = snap.captionByClip;
  state.activeClip = clips.find((clip) => clip.id === prevActiveId) || clips[0] || null;
  if (state.activeClip) {
    state.liveSegments = (state.captionByClip[captionTimelineKey()] || []).map((s) => ({ ...s }));
  } else {
    state.liveSegments = [];
  }
}

function pushHistory() {
  const snap = snapshotEditable();
  state.history.splice(state.historyIndex + 1);
  state.history.push(snap);
  if (state.history.length > 50) state.history.shift();
  state.historyIndex = state.history.length - 1;
  syncUndoRedoButtons();
}

function undoEditable() {
  if (state.historyIndex < 0) { showToast("Tidak ada yang bisa di-undo."); return; }
  state.historyIndex -= 1;
  restoreSnapshot(state.historyIndex >= 0 ? state.history[state.historyIndex] : null);
  syncUndoRedoButtons();
  refreshAfterEditableChange();
}

function redoEditable() {
  if (state.historyIndex >= state.history.length - 1) { showToast("Tidak ada yang bisa di-redo."); return; }
  state.historyIndex += 1;
  restoreSnapshot(state.history[state.historyIndex]);
  syncUndoRedoButtons();
  refreshAfterEditableChange();
}

function syncUndoRedoButtons() {
  const undoBtn = $("#undoBtn");
  const redoBtn = $("#redoBtn");
  if (undoBtn) undoBtn.disabled = state.historyIndex < 0;
  if (redoBtn) redoBtn.disabled = state.historyIndex >= state.history.length - 1;
}

function refreshAfterEditableChange() {
  renderClips(state.sorted ? [...clips].sort((a, b) => (b.score || -1) - (a.score || -1)) : clips);
  syncTrimInputs();
  if (state.activeClip) {
    $("#clipRange").textContent = clipRange(state.activeClip);
    clipTime.textContent = clipRange(state.activeClip);
  }
  if (state.projectId && state.activeClip) {
    const segs = state.captionByClip[captionTimelineKey()];
    if (Array.isArray(segs) && segs.length) loadCaptionTimeline(segs);
  }
}

function applyTrim(opts = {}) {
  const clip = state.activeClip;
  if (!clip) { showToast("Pilih clip dulu."); return; }
  const startRaw = parseTimeInput($("#trimStart").value);
  const endRaw = parseTimeInput($("#trimEnd").value);
  if (!Number.isFinite(startRaw) || !Number.isFinite(endRaw)) {
    showToast("Format waktu tidak valid. Gunakan 00:00 atau 12.5.");
    syncTrimInputs();
    return;
  }
  const maxEnd = Number(state.sourceDuration) || Math.max(endRaw, clip.end);
  const start = Math.max(0, Math.min(startRaw, endRaw - 1, maxEnd - 1));
  const end = Math.min(Math.max(endRaw, start + 1), maxEnd);
  if (end - start < 1) { showToast("Clip minimal 1 detik."); syncTrimInputs(); return; }
  if (!opts.noHistory) pushHistory();
  clip.start = start;
  clip.end = end;
  syncTrimInputs();
  clipTime.textContent = clipRange(clip);
  $("#clipRange").textContent = clipRange(clip);
  renderClips(state.sorted ? [...clips].sort((a, b) => (b.score || -1) - (a.score || -1)) : clips);
  state.previewClipKey = "";
  if (state.sourceUrl && Number.isFinite(clip.start)) previewVideo.currentTime = clip.start;
  showToast(`Clip dipangkas: ${formatTime(start)} - ${formatTime(end)}`);
}

const RATIO_PRESETS = ["portrait", "wide", "four5"];

function setRatio(token) {
  const ratio = RATIO_PRESETS.includes(token) ? token : "portrait";
  previewFrame.classList.remove("portrait", "wide", "four5");
  previewFrame.classList.add(ratio);
  previewFrame.dataset.layout = ratio;
  const layoutSelect = $("#layoutSelect");
  if (layoutSelect) layoutSelect.value = ratio;
  $$(".segmented button").forEach((item) => {
    item.classList.toggle("active", item.dataset.ratio === ratio);
  });
}

function currentRatio() {
  if (previewFrame.classList.contains("wide")) return "wide";
  if (previewFrame.classList.contains("four5")) return "four5";
  return "portrait";
}

function selectedExportRatios() {
  const checked = $$(".export-ratio-chk:checked").map((el) => el.dataset.ratio);
  if (checked.length) return checked;
  return [currentRatio()];
}

$$(".export-ratio-chk").forEach((el) => {
  el.addEventListener("change", () => {
    const checked = $$(".export-ratio-chk:checked").map((item) => item.dataset.ratio);
    state.exportRatios = checked.length ? checked : [currentRatio()];
  });
});

function renderEmptyClips(message) {
  state.activeClip = null;
  clipList.innerHTML = "";
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = message || "Tidak ada clip yang cocok untuk video ini. Coba ganti durasi clip atau gunakan video lain.";
  clipList.appendChild(empty);

  previewTitle.textContent = "No clips";
  captionBox.textContent = "";
  hookInput.value = "";
  captionInput.value = "";
  clipTime.textContent = "--:-- - --:--";
  $("#clipRange").textContent = "--:-- - --:--";
  captionBox.style.display = "none";
  previewVideo.removeAttribute("src");
  previewVideo.controls = false;
  previewFrame.classList.remove("has-video");
}

function setActiveClipOrEmpty(clip) {
  if (clip) selectClip(clip);
  else renderEmptyClips();
}

function activeClipKey() {
  if (!state.activeClip) return "";
  return `${state.projectId}:${state.activeClip.id}:${state.activeClip.start}:${state.activeClip.end}`;
}

function renderClips(list = clips) {
  clipList.innerHTML = "";

  list.forEach((clip) => {
    const button = document.createElement("button");
    button.type = "button";
    button.draggable = !state.sorted;
    button.dataset.clipId = String(clip.id);
    const readiness = clip.previewLoading ? "Loading" : clip.previewReady ? "Ready" : "Needs preview";
    const selected = state.selectedClipIds.has(clip.id);
    button.className = `clip-card${state.activeClip && clip.id === state.activeClip.id ? " active" : ""}${selected ? " selected" : ""}`;
    button.addEventListener("dragstart", (event) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(clip.id));
      button.classList.add("dragging");
    });
    button.addEventListener("dragend", () => button.classList.remove("dragging"));
    button.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    });
    button.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const draggedId = event.dataTransfer.getData("text/plain");
      if (!draggedId || draggedId === String(clip.id)) return;
      const draggedIndex = clips.findIndex((c) => String(c.id) === draggedId);
      const targetIndex = clips.findIndex((c) => String(c.id) === String(clip.id));
      if (draggedIndex < 0 || targetIndex < 0) return;
      pushHistory();
      const [moved] = clips.splice(draggedIndex, 1);
      clips.splice(targetIndex, 0, moved);
      renderClips(state.sorted ? [...clips].sort((a, b) => (b.score || -1) - (a.score || -1)) : clips);
      showToast(`Urutan clip diubah: Clip ${String(moved.id).padStart(2, "0")}.`);
    });

    const check = document.createElement("span");
    check.className = `clip-check${selected ? " checked" : ""}`;
    check.setAttribute("aria-hidden", "true");
    check.textContent = selected ? "✓" : "";
    check.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleClipSelected(clip.id);
    });

    const thumb = document.createElement("span");
    thumb.className = `thumb ${clip.previewReady ? "ready" : ""} ${clip.previewLoading ? "loading" : ""}`;
    thumb.setAttribute("aria-hidden", "true");
    const thumbBadge = document.createElement("span");
    thumbBadge.className = "thumb-badge";
    thumbBadge.textContent = readiness;
    thumb.appendChild(thumbBadge);

    const body = document.createElement("span");
    const heading = document.createElement("h3");
    heading.textContent = `Clip ${String(clip.id).padStart(2, "0")} - ${clip.title}`;

    const tags = document.createElement("span");
    tags.className = "clip-meta";
    if (!clip.placeholder && clip.hookType) {
      const hookTag = document.createElement("span");
      hookTag.className = "clip-tag hook-type";
      hookTag.textContent = clip.hookType;
      tags.appendChild(hookTag);
    }
    if (!clip.placeholder && Number.isFinite(clip.confidence)) {
      const confTag = document.createElement("span");
      confTag.className = "clip-tag meta";
      confTag.textContent = `${clip.confidence}%`;
      tags.appendChild(confTag);
    }
    if (Number.isFinite(clip.start) && Number.isFinite(clip.end)) {
      const durTag = document.createElement("span");
      durTag.className = "clip-tag meta";
      durTag.textContent = clipRange(clip);
      tags.appendChild(durTag);
    }

    const meta = document.createElement("p");
    meta.appendChild(document.createTextNode(clip.hook));
    body.appendChild(heading);
    body.appendChild(tags);
    body.appendChild(meta);

    const score = document.createElement("span");
    score.className = "score";
    score.textContent = clip.score != null && !clip.placeholder ? `${clip.score}%` : "--";

    button.appendChild(check);
    button.appendChild(thumb);
    button.appendChild(body);
    button.appendChild(score);
    button.addEventListener("click", () => selectClip(clip));
    clipList.appendChild(button);
  });
}

function toggleClipSelected(clipId) {
  if (state.selectedClipIds.has(clipId)) {
    state.selectedClipIds.delete(clipId);
  } else {
    state.selectedClipIds.add(clipId);
  }
  renderClips(state.sorted ? [...clips].sort((a, b) => (b.score || -1) - (a.score || -1)) : clips);
}

function syncTrimHandles() {
  const track = $("#progressTrack");
  const startHandle = $("#trimHandleStart");
  const endHandle = $("#trimHandleEnd");
  if (!track || !startHandle || !endHandle || !state.activeClip) return;
  const total = Math.max(1, Number(state.sourceDuration) || (state.activeClip.end || 1));
  const startPct = Math.max(0, Math.min(100, ((state.activeClip.start || 0) / total) * 100));
  const endPct = Math.max(0, Math.min(100, ((state.activeClip.end || total) / total) * 100));
  startHandle.style.left = `${startPct}%`;
  endHandle.style.left = `${endPct}%`;
}

function initTrimHandleDrag() {
  const track = $("#progressTrack");
  if (!track) return;
  const startHandle = $("#trimHandleStart");
  const endHandle = $("#trimHandleEnd");
  if (!startHandle || !endHandle) return;

  const drag = (handle, isStart) => {
    handle.addEventListener("mousedown", (event) => {
      if (!state.activeClip) return;
      event.preventDefault();
      event.stopPropagation();
      let historyPushed = false;
      const onMove = (moveEvent) => {
        const rect = track.getBoundingClientRect();
        const total = Math.max(1, Number(state.sourceDuration) || state.activeClip.end);
        const pct = Math.max(0, Math.min(1, (moveEvent.clientX - rect.left) / rect.width));
        const t = pct * total;
        const clip = state.activeClip;
        const min = 1;
        const candidate = isStart
          ? Math.max(0, Math.min(t, clip.end - min, total - min))
          : Math.min(total, Math.max(t, clip.start + min));
        if (!historyPushed && Math.abs(candidate - (isStart ? clip.start : clip.end)) > 0.01) {
          pushHistory();
          historyPushed = true;
        }
        if (isStart) {
          clip.start = Math.round(candidate * 10) / 10;
        } else {
          clip.end = Math.round(candidate * 10) / 10;
        }
        syncTrimInputs();
        clipTime.textContent = clipRange(clip);
        $("#clipRange").textContent = clipRange(clip);
        syncTrimHandles();
        if (state.sourceUrl && Number.isFinite(clip.start)) previewVideo.currentTime = clip.start;
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        renderClips(state.sorted ? [...clips].sort((a, b) => (b.score || -1) - (a.score || -1)) : clips);
        if (historyPushed) showToast("Trim diubah via drag.");
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  };
  drag(startHandle, true);
  drag(endHandle, false);
}

initTrimHandleDrag();

function selectClip(clip) {
  if (!clip) {
    window.clearInterval(state.loopTimer);
    renderEmptyClips();
    captionTimelinePanel.style.display = "none";
    state.captionLoadedFor = "";
    $("#clipScore").textContent = "--";
    $("#clipDuration").textContent = "--";
    return;
  }
  window.clearInterval(state.loopTimer);
  state.activeClip = clip;
  state.liveActive = false;
  state.captionSelected = -1;
  if (state.captionLoadedFor !== captionTimelineKey()) {
    state.captionSegments = [];
    captionTimelinePanel.style.display = "none";
  }
  const translateFromSel = $("#translateFrom");
  if (translateFromSel && translateFromSel.value !== "auto") translateFromSel.value = "auto";
  liveCaption.innerHTML = "";
  liveCaption.style.display = "none";
  previewTitle.textContent = `Clip ${String(clip.id).padStart(2, "0")} - ${clip.title}`;
  captionBox.textContent = `"${clip.caption}"`;
  renderStaticCaption();
  hookInput.value = clip.hook;
  captionInput.value = clip.caption;
  clipTime.textContent = clipRange(clip);
  $("#clipScore").textContent = clip.score != null && !clip.placeholder ? `${clip.score}%` : "--";
  $("#clipDuration").textContent = clipRange(clip);
  syncTrimInputs();

  if (state.sourceUrl && Number.isFinite(clip.start)) {
    previewVideo.currentTime = clip.start;
  }

  renderClips(state.sorted ? [...clips].sort((a, b) => (b.score || -1) - (a.score || -1)) : clips);
  syncTrimHandles();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 3200);
}

function setProcessStep(activeStep, doneSteps = []) {
  if (!processSteps) return;
  $$("[data-step]").forEach((step) => {
    step.classList.toggle("active", step.dataset.step === activeStep);
    step.classList.toggle("done", doneSteps.includes(step.dataset.step));
  });
}

function renderClipSkeleton(count = 4) {
  clipList.innerHTML = Array.from({ length: count }, (_, index) => `
    <button class="clip-card skeleton" type="button">
      <span class="thumb" aria-hidden="true"></span>
      <span>
        <h3>Loading clip ${index + 1}</h3>
        <p>Loading range<br>Loading hook</p>
      </span>
      <span class="score">--</span>
    </button>
  `).join("");
}

async function refreshStorage() {
  try {
    const response = await fetch("/api/storage", { method: "HEAD" });
    const bytes = Number(response.headers.get("X-Storage-Used") || 0);
    const mb = bytes / (1024 * 1024);
    const el = document.getElementById("storageUsed");
    const meter = document.getElementById("storageMeter");
    if (el) el.textContent = `${mb.toFixed(1)} MB`;
    if (meter) {
      const pct = Math.min(100, (mb / 512) * 100);
      meter.style.width = `${pct}%`;
    }
  } catch {}
}

async function pollQueue() {
  const el = $("#queueList");
  if (!el) return;
  try {
    const response = await fetch("/api/queue");
    const data = await response.json();
    const jobs = Array.isArray(data.jobs) ? data.jobs : [];
    updateEngineStatus(jobs);
    if (!jobs.length) {
      el.innerHTML = '<div class="empty-state">Tidak ada job aktif.</div>';
      return;
    }
    el.innerHTML = "";
    for (const job of jobs) {
      const row = document.createElement("div");
      row.className = "table-row";
      row.dataset.status = job.status;

      const main = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = job.type;
      const meta = document.createElement("span");
      meta.textContent = `${job.progress || 0}%`;
      main.appendChild(name);
      main.appendChild(meta);
      row.appendChild(main);

      const pill = document.createElement("span");
      pill.className = `status-pill ${statusPillClass(job.status)}`;
      pill.textContent = job.status;
      row.appendChild(pill);

      if (job.status === "queued" || job.status === "running") {
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "secondary-button compact";
        cancel.textContent = "Cancel";
        cancel.addEventListener("click", () => {
          fetch(`/api/jobs/${encodeURIComponent(job.id)}`, { method: "DELETE" })
            .then(() => pollQueue())
            .catch(() => {});
        });
        row.appendChild(cancel);
      }
      el.appendChild(row);
    }
  } catch {}
}

function statusPillClass(status) {
  switch (String(status || "").toLowerCase()) {
    case "running": return "status-pill-running";
    case "done": return "status-pill-done";
    case "failed": return "status-pill-failed";
    case "cancelled": case "canceled": return "status-pill-cancelled";
    default: return "status-pill-queued";
  }
}

function updateEngineStatus(jobs) {
  const el = $("#engineQueueStatus");
  if (!el) return;
  const active = (jobs || []).filter((j) => j.status === "running").length;
  const queued = (jobs || []).filter((j) => j.status === "queued").length;
  if (active === 0 && queued === 0) {
    el.textContent = "QUEUE READY";
    el.className = "engine-value idle";
  } else if (active > 0) {
    el.textContent = `${active} RUNNING${queued ? " +" + queued + " QUEUED" : ""}`;
    el.className = "engine-value busy";
  } else {
    el.textContent = `${queued} QUEUED`;
    el.className = "engine-value idle";
  }
}

// F11: tampilkan konfigurasi engine NYATA dari server (device + model + tipe
// komputasi), bukan label statis "CPU-ONLY". Update ulang tiap 15 detik.
function setEngineVal(id, text, cls = "idle", title = "") {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = `engine-value ${cls}`;
  if (title) el.title = title;
}
async function loadEngineCompute() {
  try {
    const res = await fetch("/api/system");
    if (!res.ok) throw new Error("bad status");
    const info = await res.json();
    const accel = info.acceleration || {};
    const hw = info.hardware || {};
    const gpu = hw.gpu || {};
    const cuda = hw.cuda || {};
    const nvenc = hw.nvenc || {};
    const cpu = hw.cpu || {};
    const rt = info.runtime || {};

    const mode = String(rt.mode || accel.mode || "AUTO").toUpperCase();
    set("engineRuntime", mode, mode === "GPU" ? "busy" : "ok", rt.reason || "");

    const cpuLabel = cpu.model
      ? `${cpu.model}${cpu.cores ? ` · ${cpu.cores} core` : ""}`.slice(0, 42)
      : "✓ Available";
    set("engineCpu", cpuLabel, "ok", `CPU: ${cpu.model || "?"} (${cpu.cores || "?"} core)`);

    if (gpu.present) {
      const gpuLabel = `${gpu.name}${gpu.vramGb ? ` · ${gpu.vramGb} GB` : ""}`.slice(0, 42);
      const gpuCls = cuda.available ? "ok" : "busy";
      const gpuTitle = cuda.available
        ? `${gpu.name} — CUDA ✓ (${cuda.deviceCount} device)`
        : `${gpu.name} terdeteksi, tapi Python runtime tidak punya CUDA — fallback CPU`;
      set("engineGpu", gpuLabel, gpuCls, gpuTitle);
    } else {
      set("engineGpu", "— Not detected", "idle", "Tidak ada GPU terdeteksi — mode CPU");
    }

    const accelParts = [];
    if (String(rt.sttDevice || "") === "cuda") accelParts.push("STT: GPU");
    else if (String(rt.sttDevice || "") === "auto") accelParts.push("STT: AUTO");
    else accelParts.push("STT: CPU");
    accelParts.push(`ENC: ${nvenc.available ? "NVENC" : "CPU"}`);
    set("engineAccel", accelParts.join(" · "), rt.gpuUsed ? "busy" : "ok", rt.reason || accel.reason || "");
  } catch {
    set("engineRuntime", "OFFLINE", "idle");
    set("engineCpu", "—", "idle");
    set("engineGpu", "—", "idle");
    set("engineAccel", "—", "idle");
  }
}

// F12: status panel AI Engine. Polls /api/localai/status every 30s — speaker
// detection backend (pyannote/energy), face (MediaPipe/OpenCV/skip), runtime
// info. Show real backend availability, bukan "GPU Unknown" placeholder.
const localAiState = { lastTimeline: null, lastAnalysisAtMs: 0 };

async function loadLocalAIStatus() {
  try {
    const res = await fetch("/api/localai/status");
    if (!res.ok) throw new Error("bad status");
    const s = await res.json();
    const setStatus = (id, text, cls = "idle", title = "") => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = text;
      el.className = `ai-status-val ${cls}`;
      if (title) el.title = title;
    };
    const aiBackend = (s && s.aiBackend) || {};
    const spk = aiBackend.speaker || {};
    const fce = aiBackend.face || {};
    const runtime = (s && s.runtime) || { mode: "AUTO", encoder: "libx264" };
    const titleSpk = spk.available
      ? `${spk.label}${spk.backend ? " · " + spk.backend : ""}`
      : (spk.label || "tidak tersedia — install pyannote-audio atau pakai ffmpeg fallback");
    setStatus("localaiSpeaker", spk.available ? "✓ Auto" : "— Skip", spk.available ? "ok" : "idle", titleSpk);
    setStatus("localaiFace", fce.available ? "✓ Auto" : "— Skip", fce.available ? "ok" : "idle", fce.label || "tidak tersedia — install opencv-python / mediapipe");
    setStatus("localaiRuntime", String(runtime.mode || "AUTO").toUpperCase(), runtime.mode === "GPU" ? "busy" : "ok", runtime.reason || "");
    setStatus("localaiBackend", ["STT:" + (runtime.sttDevice || runtime.encoder || "CPU"), "ENC:" + (runtime.encoder || "libx264")].join(" · "), runtime.gpuUsed ? "busy" : "ok", runtime.reason || "");
  } catch {
    const off = (id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = "—";
      el.className = "ai-status-val idle";
    };
    off("localaiSpeaker"); off("localaiFace"); off("localaiRuntime"); off("localaiBackend");
  }
}

async function analyzeSpeakerForClip() {
  if (!state.projectId || !state.activeClip) {
    showToast("Pilih clip dan project dulu.");
    return;
  }
  const btn = $("#analyzeSpeakerBtn");
  const meta = $("#speakerTimelineMeta");
  if (!btn) return;
  btn.disabled = true;
  const oldLabel = btn.textContent;
  btn.textContent = "Analyzing…";
  if (meta) meta.innerHTML = "Analyzing speaker + face...<br><i>(bisa memakan waktu tergantung durasi video & GPU)</i>";
  try {
    const res = await fetch("/api/localai/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: state.projectId,
        clipId: state.activeClip.id,
        start: state.activeClip.start,
        end: state.activeClip.end,
        sampleFps: 1,
        minSegmentMs: 300,
        noiseDb: -35,
        speakerCut: !!document.getElementById("speakerCutToggle")?.checked,
        faceTrack: !!document.getElementById("faceTrackToggle")?.checked,
        sourceW: previewVideo.videoWidth || 1920,
        sourceH: previewVideo.videoHeight || 1080,
        targetAspect: currentRatio() === "portrait" ? (9/16) : currentRatio() === "wide" ? (16/9) : currentRatio() === "square" ? 1 : (4/5)
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Analyze gagal");
    localAiState.lastTimeline = data.speakerTimeline;
    localAiState.lastAnalysisAtMs = Date.now();
    const segCount = (data.speakerTimeline && data.speakerTimeline.segments || []).length;
    const totalDur = (data.speakerTimeline && data.speakerTimeline.total_duration_ms) || 0;
    const faceCount = (data.faceTimeline && !data.faceTimeline.skipped) ? (data.faceTimeline.frames || []).length : 0;
    const backendSrc = (data.summary && data.summary.backend && data.summary.backend.speaker) || "energy";
    
    let dbgHtml = `<b>Speaker analysis:</b> ${segCount} segments (${(totalDur / 1000).toFixed(1)}s via ${backendSrc}).<br>`;
    dbgHtml += `<b>Face frames:</b> ${faceCount}<br>`;
    
    if (data.associations && data.associations.length > 0) {
      dbgHtml += `<br><b>Speaker ↔ Face Association:</b><br>`;
      data.associations.forEach((a, i) => {
        const s = (a.start_ms / 1000).toFixed(1);
        const e = (a.end_ms / 1000).toFixed(1);
        dbgHtml += `<div style="font-family: monospace; font-size: 9px; padding: 2px 0;">[${s}s - ${e}s] ${a.speaker_id} → Face {x:${a.face.x}, y:${a.face.y}, conf:${a.face.confidence.toFixed(2)}}</div>`;
      });
    }

    if (meta) meta.innerHTML = dbgHtml;
    showToast(`Analisis selesai: ${segCount} segmen, ${faceCount} wajah.`);
  } catch (e) {
    if (meta) meta.textContent = `Error: ${e.message || "Analyze gagal"}`;
    showToast(e.message || "Analyze gagal");
  } finally {
    btn.disabled = false;
    btn.textContent = oldLabel;
  }
}

async function downloadLocalAIModel() {
  const btn = $("#downloadModelBtn");
  if (!btn) return;
  const oldLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Downloading…";
  try {
    const res = await fetch("/api/localai/download-model", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "face" })
    });
    const data = await res.json();
    if (!res.ok || (data && data.error)) throw new Error((data && data.error) || "Download gagal");
    showToast("Face model downloaded.");
    await loadLocalAIStatus();
  } catch (e) {
    showToast(e.message || "Download gagal");
  } finally {
    btn.disabled = false;
    btn.textContent = oldLabel;
  }
}

async function loadProjects() {
  try {
    const response = await fetch("/api/projects");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Gagal memuat Library.");
    state.projects = (Array.isArray(data.projects) ? data.projects : []).map((p) => ({
      ...p,
      createdAt: p.createdAt ? new Date(p.createdAt).toLocaleString() : ""
    }));
  } catch (err) {
    state.projects = [];
  }
  renderLibrary();
}

async function loadExports() {
  try {
    const response = await fetch("/api/exports");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Gagal memuat Exports.");
    state.exports = (Array.isArray(data.exports) ? data.exports : []).map((e) => ({
      filename: e.filename,
      downloadUrl: e.downloadUrl || `/outputs/${encodeURIComponent(e.filename)}`,
      clipTitle: e.hook || e.project || "Export",
      status: e.hook || e.project ? "Selesai" : "Selesai",
      createdAt: e.createdAt ? new Date(e.createdAt).toLocaleString() : "",
      size: e.size
    }));
  } catch (err) {
    state.exports = [];
  }
  renderExports();
}

function renderLibrary() {
  if (!state.projects.length) {
    libraryList.innerHTML = '<div class="empty-state">Belum ada project. Paste URL YouTube di Studio untuk mulai.</div>';
    return;
  }

  libraryList.innerHTML = "";
  state.projects.forEach((project) => {
    const row = document.createElement("div");
    row.className = "table-row";

    const main = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = project.name;
    const meta = document.createElement("span");
    meta.textContent = `${formatTime(project.duration)} - ${project.clips} clips - ${project.transcriptStatus}`;
    main.appendChild(name);
    main.appendChild(meta);

    const date = document.createElement("span");
    date.textContent = project.createdAt;

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "secondary-button compact";
    openBtn.setAttribute("data-open-project", project.id);
    openBtn.textContent = "Open";

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "ghost-button compact danger-btn";
    delBtn.setAttribute("data-delete-project", project.id);
    delBtn.textContent = "Hapus";

    row.appendChild(main);
    row.appendChild(date);
    row.appendChild(openBtn);
    row.appendChild(delBtn);
    libraryList.appendChild(row);
  });

  $$("[data-delete-project]").forEach((button) => {
    button.addEventListener("click", async () => {
      const projectId = button.getAttribute("data-delete-project");
      const project = state.projects.find((p) => p.id === projectId);
      const name = project ? project.name : "project ini";
      if (!confirm(`Hapus project "${name}" beserta semua clip-nya?`)) return;
      try {
        const response = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Gagal menghapus project.");
        showToast("Project dihapus.");
        await loadProjects();
      } catch (err) {
        showToast(err.message || "Gagal menghapus project.");
      }
    });
  });

  $$("[data-open-project]").forEach((button) => {
    button.addEventListener("click", async () => {
      const projectId = button.getAttribute("data-open-project");
      try {
        const response = await fetch(`/api/projects/${projectId}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Gagal memuat project.");
        loadProject(data);
        showView("studio");
        showToast(`Project "${data.name}" dimuat dari Library.`);
      } catch (err) {
        showToast(err.message || "Gagal memuat project.");
      }
    });
  });
}

function renderExports() {
  if (!state.exports.length) {
    exportsList.innerHTML = '<div class="empty-state">Belum ada export. Export clip dari Studio akan muncul di sini.</div>';
    return;
  }

  exportsList.innerHTML = "";
  state.exports.forEach((item) => {
    const row = document.createElement("div");
    row.className = "table-row";

    const main = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = item.filename;
    const meta = document.createElement("span");
    meta.textContent = `${item.clipTitle} - ${item.createdAt}${item.size ? ` (${formatBytes(item.size)})` : ""}`;
    main.appendChild(name);
    main.appendChild(meta);

    const status = document.createElement("span");
    status.textContent = "Selesai";

    const download = document.createElement("a");
    download.className = "secondary-button compact";
    download.href = item.downloadUrl;
    download.setAttribute("download", item.filename);
    download.textContent = "Download";

    row.appendChild(main);
    row.appendChild(status);
    row.appendChild(download);
    exportsList.appendChild(row);
  });

  const openBtn = document.createElement("button");
  openBtn.className = "secondary-button compact";
  openBtn.textContent = "Buka folder output";
  openBtn.addEventListener("click", async () => {
    try {
      const r = await fetch("/api/open-output", { method: "POST" });
      const j = await r.json();
      if (r.ok) showToast("Folder output dibuka di File Explorer.");
      else showToast(j.error || "Gagal membuka folder.");
    } catch {
      showToast("Gagal membuka folder output.");
    }
  });
  exportsList.appendChild(openBtn);
}

function showView(view) {
  $$(".app-view").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.viewPanel === view);
  });
  $$(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === view);
  });
}

function setLocalPreview(file) {
  if (state.sourceUrl) URL.revokeObjectURL(state.sourceUrl);
  state.sourceUrl = URL.createObjectURL(file);
  state.sourceName = file.name.replace(/\.[^.]+$/, "");
  previewVideo.src = state.sourceUrl;
  previewVideo.controls = true;
  previewFrame.classList.add("has-video");
}

async function uploadToBackend(file) {
  const form = new FormData();
  form.append("video", file);
  form.append("duration", $("#durationSelect").value);

  uploadStatus.textContent = "Uploading";
  $("#generateButton").disabled = true;

  const response = await fetch("/api/upload", {
    method: "POST",
    body: form
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Upload gagal.");

  state.projectId = data.id;
  clips = Array.isArray(data.clips) ? data.clips : [];
  state.sourceDuration = data.probe && data.probe.duration;
  state.sorted = false;
  setActiveClipOrEmpty(clips[0]);

  $("#fileTitle").textContent = data.name;
  $("#fileMeta").textContent = `${formatTime(data.probe.duration)} - ${data.probe.width}x${data.probe.height} - ${data.probe.codec}`;
  uploadStatus.textContent = `${clips.length} clips ready`;
  showToast(`${clips.length} clip dibuat. Kamu bisa preview dan export MP4.`);

  state.projects.unshift({
    id: data.id,
    name: data.name,
    duration: data.probe.duration,
    clips: clips.length,
    transcriptStatus: "No transcript",
    createdAt: new Date().toLocaleString()
  });
  state.projects = state.projects.slice(0, 20);
  renderLibrary();
}

function loadProject(data) {
  state.projectId = data.id;
  state.sourceUrl = data.previewUrl || "";
  state.previewClipKey = "";
  state.selectedClipIds = new Set();
  state.youtubeUrl = data.youtubeUrl || data.url || "";
  state.noDownload = Boolean(data.noDownload);
  state.sourceName = data.name || "youtube-video";
  clips = Array.isArray(data.clips) ? data.clips : [];
  state.sorted = false;

  if (data.previewUrl) {
    previewVideo.src = data.previewUrl;
    previewVideo.controls = true;
    previewFrame.classList.add("has-video");
  } else {
    previewVideo.removeAttribute("src");
    previewVideo.controls = false;
    previewFrame.classList.remove("has-video");
  }

  setActiveClipOrEmpty(clips[0]);
  state.sourceDuration = data.probe && data.probe.duration;
  $("#fileTitle").textContent = data.name;
  $("#fileMeta").textContent = `${formatTime(data.probe.duration)} - ${data.transcriptStatus || "No transcript"} - ${data.probe.codec}`;
  uploadStatus.textContent = `${clips.length} clips ready`;

  state.projects.unshift({
    id: data.id,
    name: data.name,
    duration: data.probe.duration,
    clips: clips.length,
    transcriptStatus: data.transcriptStatus || "No transcript",
    createdAt: new Date().toLocaleString()
  });
  state.projects = state.projects.slice(0, 20);
  renderLibrary();
}

async function waitForJob(jobId) {
  const startedAt = Date.now();
  const timeoutMs = 20 * 60 * 1000;
  let intervalMs = 1200;
  const maxIntervalMs = 5000;

  while (true) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error("Export tidak selesai dalam batas waktu. Coba lagi.");
    }

    const response = await fetch(`/api/jobs/${jobId}`);
    const job = await response.json();
    if (!response.ok) throw new Error(job.error || "Job tidak ditemukan.");

    uploadStatus.textContent = `${job.status} ${job.progress}%`;

    if (typeof $ === "function") {
      const progressBar = $("#progressBar");
      const progressText = $("#progressText");
      if (progressBar) progressBar.style.width = `${Math.max(5, Math.min(100, job.progress || 5))}%`;
      if (progressText) progressText.textContent = `${job.status} ${job.progress || 0}%`;
    }

    if (job.status === "done") return job.result;
    if (job.status === "failed") throw new Error(job.error || "Export gagal.");
    if (job.status === "cancelled") throw new Error(job.error || "Export dibatalkan.");

    await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
    intervalMs = Math.min(intervalMs * 2, maxIntervalMs);
  }
}

async function processYouTubeUrl() {
  const raw = $("#videoUrl").value.trim();
  const urls = raw.split(/\r?\n/).map((u) => u.trim()).filter((u) => u.length > 0);

  if (!urls.length) {
    showToast("Paste URL YouTube dulu.");
    return;
  }

  if (urls.length > 10) {
    showToast("Maksimal 10 URL dalam satu batch.");
    return;
  }

  uploadStatus.textContent = "Analyzing";
  setProcessStep("metadata");
  renderClipSkeleton();
  $("#attachUrl").disabled = true;
  $("#generateButton").disabled = true;

  try {
    if (urls.length === 1) {
      const response = await fetch("/api/youtube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: urls[0],
          duration: $("#durationSelect").value,
          language: CAPTION_LANG,
          assumedDuration: 3600
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Download YouTube gagal.");
      setProcessStep("clips", ["metadata"]);
      loadProject(data);
      setProcessStep("", ["metadata", "clips"]);
      showToast(data.fastMode ? `${clips.length} clip dibuat instan. Preview akan mengambil section asli.` : `${clips.length} clip dibuat. ${data.transcriptStatus || "Transcript tidak ditemukan."}`);
      return;
    }

    showToast(`Memproses ${urls.length} URL...`);
    const response = await fetch("/api/youtube-bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        urls,
        duration: $("#durationSelect").value,
        language: CAPTION_LANG,
        assumedDuration: 3600
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Batch YouTube gagal.");

    const ok = (Array.isArray(data.projects) ? data.projects : []).filter((p) => p && p.ok);
    const failed = (Array.isArray(data.projects) ? data.projects : []).filter((p) => p && !p.ok);
    const firstOk = ok[0];

    const otherProjects = ok.slice(1).map((p) => p.project);
    if (otherProjects.length) {
      otherProjects.forEach((proj) => {
        if (!proj || !proj.id) return;
        state.projects.unshift({
          id: proj.id,
          name: proj.name || "project",
          duration: proj.probe && proj.probe.duration,
          clips: Array.isArray(proj.clips) ? proj.clips.length : 0,
          transcriptStatus: proj.transcriptStatus || "No transcript",
          createdAt: new Date().toLocaleString()
        });
      });
      state.projects = state.projects.slice(0, 30);
      renderLibrary();
    }

    if (firstOk) {
      setProcessStep("clips", ["metadata"]);
      loadProject(firstOk.project);
      setProcessStep("", ["metadata", "clips"]);
    }

    const summary = `${ok.length}/${urls.length} berhasil`;
    if (failed.length) {
      showToast(`${summary}. ${failed.length} gagal (${failed[0].error || "error"}).`);
    } else {
      showToast(`${summary}. ${ok.length} project siap di Library.`);
    }
  } catch (error) {
    uploadStatus.textContent = "Failed";
    setProcessStep("");
    showToast(error.message);
  } finally {
    $("#attachUrl").disabled = false;
    $("#generateButton").disabled = false;
  }
}

async function attachFile(file) {
  if (!file) return;

  if (!file.type.startsWith("video/")) {
    showToast("Pilih file video, misalnya MP4, MOV, MKV, atau WebM.");
    return;
  }

  try {
    setLocalPreview(file);
    await uploadToBackend(file);
  } catch (error) {
    uploadStatus.textContent = "Failed";
    showToast(error.message);
  } finally {
    $("#generateButton").disabled = false;
  }
}

function playSelectedClip() {
  if (!state.activeClip) {
    showToast("Tidak ada clip untuk diputar.");
    return;
  }
  if (!state.sourceUrl || (state.noDownload && state.previewClipKey !== activeClipKey())) {
    loadPreviewClip();
    return;
  }

  window.clearInterval(state.loopTimer);
  previewVideo.currentTime = state.noDownload ? 0 : state.activeClip.start;
  previewVideo.play();

  state.loopTimer = window.setInterval(() => {
    const stopAt = state.noDownload ? state.activeClip.end - state.activeClip.start : state.activeClip.end;
    if (previewVideo.currentTime >= stopAt) {
      previewVideo.pause();
      window.clearInterval(state.loopTimer);
    }
  }, 120);
}

async function loadPreviewClip() {
  if (!state.projectId) {
    showToast("Analyze URL dulu sebelum preview.");
    return;
  }
  if (!state.activeClip) {
    showToast("Tidak ada clip untuk dipreview.");
    return;
  }

  $("#playClip").disabled = true;
  $("#playClip").textContent = "Loading...";
  state.activeClip.previewLoading = true;
  renderClips(state.sorted ? [...clips].sort((a, b) => (b.score || -1) - (a.score || -1)) : clips);
  uploadStatus.textContent = "Previewing";
  setProcessStep("preview", ["metadata", "clips"]);
  showToast("Mengambil potongan clip ringan untuk preview di aplikasi.");

  try {
    const response = await fetch("/api/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: state.projectId,
        clipId: state.activeClip.id,
        start: state.activeClip.start,
        end: state.activeClip.end,
        caption: captionInput.value,
        language: CAPTION_LANG,
        captionStyle: $("#captionStyleSelect").value,
        captionSize: captionSize.value,
        fontFamily: captionFontSelect ? captionFontSelect.value : "Arial",
        captionColor: captionColorInput ? captionColorInput.value : "",
        ratio: currentRatio(),
        segments: state.captionSegments && state.captionSegments.length
          ? state.captionSegments.map((s) => ({
              start: Number(s.start) || 0,
              end: Number(s.end) || 0,
              text: String(s.text || "").trim(),
              words: Array.isArray(s.words) && s.words.length ? s.words : []
            }))
          : []
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Preview gagal.");

    if (data.transcript?.caption) {
      captionInput.value = data.transcript.caption;
      captionBox.textContent = `"${data.transcript.caption}"`;
      renderStaticCaption();
      state.activeClip.caption = data.transcript.caption;
      if (data.transcript.hook) {
        hookInput.value = data.transcript.hook;
        state.activeClip.hook = data.transcript.hook;
      }
      renderClips(state.sorted ? [...clips].sort((a, b) => (b.score || -1) - (a.score || -1)) : clips);
    }

    state.sourceUrl = data.previewUrl;
    state.previewClipKey = activeClipKey();
    state.activeClip.previewReady = true;
    state.activeClip.previewLoading = false;
    if (data.transcriptError) {
      console.warn("Preview transcript:", data.transcriptError);
    }
    state.liveSegments = Array.isArray(data.segments) ? data.segments : [];
    state.liveActive = state.liveSegments.length > 0 && data.baked !== true && $("#captionStyleSelect").value !== "off";
    state.liveOffset = state.youtubeUrl ? 0 : (state.activeClip ? Number(state.activeClip.start) || 0 : 0);
    previewVideo.src = data.previewUrl;
    previewVideo.controls = true;
    previewFrame.classList.add("has-video");
    previewVideo.currentTime = state.liveOffset;
    await previewVideo.play();
    loadCaptionTimeline(state.liveSegments);
    uploadStatus.textContent = `${clips.length} clips ready`;
    setProcessStep("", ["metadata", "clips", "preview"]);
  } catch (error) {
    state.activeClip.previewLoading = false;
    uploadStatus.textContent = "Failed";
    setProcessStep("");
    showToast(error.message);
  } finally {
    renderClips(state.sorted ? [...clips].sort((a, b) => (b.score || -1) - (a.score || -1)) : clips);
    $("#playClip").disabled = false;
    $("#playClip").textContent = "Play clip";
  }
}

async function exportSelectedClip() {
  if (!state.projectId) {
    showToast("Upload video dulu sebelum export.");
    return;
  }
  if (!state.activeClip) {
    showToast("Tidak ada clip untuk di-export.");
    return;
  }

  if (state.isExporting) return;

  state.isExporting = true;
  $("#exportButton").disabled = true;
  $("#exportButton").textContent = "Exporting MP4...";
  showToast(state.noDownload ? "Mengambil bagian clip dari YouTube lalu membuat MP4." : "FFmpeg sedang membuat clip MP4.");

  try {
    const exportSegments = state.captionSegments && state.captionSegments.length
      ? state.captionSegments.map((s) => ({
          start: Number(s.start) || 0,
          end: Number(s.end) || 0,
          text: String(s.text || "").trim(),
          words: Array.isArray(s.words) && s.words.length ? s.words : []
        }))
      : [];
    const ratios = selectedExportRatios();
    // Honor the checked export ratio(s). When exactly one ratio is checked the
    // single-export path must export at THAT ratio, not the preview's ratio —
    // otherwise checking only "16:9 (wide)" while previewing portrait still
    // produces a portrait file.
    const exportRatio = ratios.length ? ratios[0] : currentRatio();
    const basePayload = {
      projectId: state.projectId,
      clipId: state.activeClip.id,
      start: state.activeClip.start,
      end: state.activeClip.end,
      caption: captionInput.value,
      language: CAPTION_LANG,
      captionStyle: $("#captionStyleSelect").value,
      captionSize: captionSize.value,
      fontFamily: captionFontSelect ? captionFontSelect.value : "Arial",
      captionColor: captionColorInput ? captionColorInput.value : "",
      captionPosition: state.captionPosition || 0.76,
      fps: Number(state.fps) || 0,
      crf: Number(state.crf) || 23,
      audioBitrate: Number(state.audioBitrate) || 128,
      watermark: state.watermark,
      watermarkPosition: state.watermarkPosition,
      watermarkOpacity: state.watermarkOpacity,
      ratio: exportRatio,
      segments: exportSegments
    };
    let response;
    if (ratios.length > 1) {
      response = await fetch("/api/export-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: state.projectId,
          clips: [{ ...basePayload, ratios }]
        })
      });
    } else {
      response = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(basePayload)
      });
    }

    const data = await response.json();
    if (!response.ok && response.status !== 202) throw new Error(data.error || "Export gagal.");
    if (!data.jobId) throw new Error("Server tidak mengembalikan job export.");

    const result = await waitForJob(data.jobId);
    const results = Array.isArray(result.results) && result.results.length ? result.results : [result];
    for (const item of results) {
      if (!item.downloadUrl) continue;
      const anchor = document.createElement("a");
      anchor.href = item.downloadUrl;
      anchor.download = item.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      state.exports.unshift({
        filename: item.filename,
        downloadUrl: item.downloadUrl,
        clipTitle: previewTitle.textContent,
        status: "Selesai",
        createdAt: new Date().toLocaleString()
      });
    }
    renderExports();
    uploadStatus.textContent = `${clips.length} clips ready`;
    showToast(`Export selesai: ${results.length} file`);
  } catch (error) {
    showToast(error.message);
  } finally {
    state.isExporting = false;
    $("#exportButton").disabled = false;
    $("#exportButton").textContent = "Export selected clip";
  }
}

$("#videoInput").addEventListener("change", (event) => attachFile(event.target.files[0]));

$("#newProjectBtn").addEventListener("click", () => $("#videoInput").click());

$("#dropzone").addEventListener("dragover", (event) => {
  event.preventDefault();
  event.currentTarget.classList.add("dragging");
});

$("#dropzone").addEventListener("dragleave", (event) => {
  event.currentTarget.classList.remove("dragging");
});

$("#dropzone").addEventListener("drop", (event) => {
  event.preventDefault();
  event.currentTarget.classList.remove("dragging");
  attachFile(event.dataTransfer.files[0]);
});

$("#attachUrl").addEventListener("click", processYouTubeUrl);

$("#videoUrl").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    processYouTubeUrl();
  }
});

$("#generateButton").addEventListener("click", async () => {
  if (!state.projectId) {
    processYouTubeUrl();
    return;
  }
  $("#generateButton").disabled = true;
  uploadStatus.textContent = "Regenerating clips...";
  renderClipSkeleton();
  try {
    const response = await fetch(`/api/projects/${state.projectId}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ duration: $("#durationSelect").value })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Gagal generate ulang clips.");
    clips = data.clips;
    setActiveClipOrEmpty();
    uploadStatus.textContent = `${clips.length} clips ready`;
    showToast(`${clips.length} clip dibuat dari transcript.`);
  } catch (err) {
    showToast(err.message);
    renderClips(clips);
  } finally {
    $("#generateButton").disabled = false;
  }
});

$("#playClip").addEventListener("click", playSelectedClip);


previewVideo.addEventListener("timeupdate", updateLiveCaption);
previewVideo.addEventListener("play", () => { if (state.liveActive) updateLiveCaption(); });
previewVideo.addEventListener("pause", () => { if (state.liveActive) updateLiveCaption(); });
previewVideo.addEventListener("ended", () => {
  liveCaption.innerHTML = "";
  liveCaption.style.display = "none";
  captionBox.style.display = "none";
});
previewVideo.addEventListener("seeked", () => { if (captionTimelinePanel && captionTimelinePanel.style.display !== "none") updateCaptionPlayhead(); });
previewVideo.addEventListener("timeupdate", () => { if (captionTimelinePanel && captionTimelinePanel.style.display !== "none") updateCaptionPlayhead(); });

function togglePreviewPlayback() {
  if (!state.projectId) { showToast("Analyze URL dulu sebelum preview."); return; }
  if (!state.activeClip) { showToast("Tidak ada clip untuk diputar."); return; }
  if (!state.sourceUrl || (state.noDownload && state.previewClipKey !== activeClipKey())) {
    loadPreviewClip();
    return;
  }
  if (previewVideo.paused) {
    previewVideo.play();
  } else {
    previewVideo.pause();
  }
}

const captionTlScroller = document.getElementById("captionTlScroll");
const USER_SCROLL_HOLD_MS = 2500;
function markUserScrolling() {
  state.userScrolling = true;
  window.clearTimeout(state.userScrollTimer);
  state.userScrollTimer = window.setTimeout(() => {
    state.userScrolling = false;
    updateCaptionPlayhead();
  }, USER_SCROLL_HOLD_MS);
}
if (captionTlScroller) {
  captionTlScroller.addEventListener("wheel", (event) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const factor = event.deltaY < 0 ? 1.2 : 1 / 1.2;
      state.timelineZoom = clampZoom((state.timelineZoom || 1) * factor);
      markUserScrolling();
      renderCaptionTimeline();
      return;
    }
    const isTrackScroll = Math.abs(event.deltaY) > Math.abs(event.deltaX);
    captionTlScroller.scrollLeft += isTrackScroll ? event.deltaY : event.deltaX;
    markUserScrolling();
  }, { passive: false });

  captionTlScroller.addEventListener("scroll", () => {
    if (state.suppressScrollMark) return;
    if (state.userScrolling) markUserScrolling();
  }, { passive: true });

  captionTlScroller.addEventListener("click", (event) => {
    const block = event.target.closest(".caption-block");
    if (block) return;
    if (event.target.closest(".caption-playhead")) return;
    const rect = captionTlScroller.getBoundingClientRect();
    const x = event.clientX - rect.left + captionTlScroller.scrollLeft;
    const t = captionPxToTime(x, captionPxPerSec(state.timelineZoom));
    const start = Number(state.activeClip ? state.activeClip.start : 0) || 0;
    const end = Number(state.activeClip ? state.activeClip.end : 0) || start + 30;
    const target = state.liveOffset + clampPlayheadTime(t, end - start);
    previewVideo.currentTime = target;
    if (state.liveActive) updateLiveCaption();
    updateCaptionPlayhead();
  });
}

document.addEventListener("keydown", (event) => {
  const target = event.target;
  const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
  if (typing) return;

  const timelineVisible = captionTimelinePanel && captionTimelinePanel.style.display !== "none";

  if (event.code === "Space") {
    if (timelineVisible) {
      event.preventDefault();
      togglePreviewPlayback();
    }
    return;
  }

  if (event.ctrlKey || event.metaKey) {
    if (event.code === "KeyS") {
      event.preventDefault();
      if (timelineVisible) {
        saveCaptionTimeline();
        showToast("Timeline caption disimpan.");
      }
    }
    if (event.code === "KeyZ" && !event.shiftKey) {
      event.preventDefault();
      undoEditable();
    } else if (event.code === "KeyY" || (event.code === "KeyZ" && event.shiftKey)) {
      event.preventDefault();
      redoEditable();
    }
    return;
  }

  const key = event.code;

  if (key === "ArrowLeft" || key === "ArrowRight") {
    if (previewVideo.src) {
      event.preventDefault();
      previewVideo.currentTime = Math.max(0, Math.min(previewVideo.duration || 0, previewVideo.currentTime + (key === "ArrowRight" ? 5 : -5)));
    }
    return;
  }

  if (key === "KeyB") {
    event.preventDefault();
    exportSelectedClip();
    return;
  }

  if (key === "KeyE") {
    event.preventDefault();
    $("#exportAllBtn").click();
    return;
  }

  if (key === "KeyT") {
    event.preventDefault();
    applyTrim();
    return;
  }

  if (key === "Digit1" || key === "Digit2" || key === "Digit3") {
    const ratio = key === "Digit1" ? "portrait" : key === "Digit2" ? "wide" : "four5";
    event.preventDefault();
    setRatio(ratio);
    showToast(`Layout: ${ratio}`);
  }
});

$("#refreshTimeline").addEventListener("click", () => {
  if (!state.liveSegments.length) {
    showToast("Belum ada segmen. Klik Generate Captions atau Preview dulu.");
    return;
  }
  loadCaptionTimeline(state.liveSegments);
  showToast("Timeline caption dimuat ulang.");
});

async function loadSttModels() {
  const select = $("#sttModelSelect");
  if (!select) return;
  try {
    const response = await fetch("/api/stt/models");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Gagal memuat model STT.");
    const models = Array.isArray(data.models) ? data.models : [];
    const current = state.sttModel || "";
    select.innerHTML = '<option value="">Auto (default)</option>';
    for (const model of models) {
      const name = typeof model === "string" ? model : (model.name || model.id || "");
      if (!name) continue;
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    }
    if (current) select.value = current;
  } catch (err) {
    select.innerHTML = '<option value="">Auto (default)</option>';
  }
}

$("#sttModelSelect").addEventListener("change", (event) => {
  state.sttModel = event.target.value || "";
  showToast(state.sttModel ? `Model STT: ${state.sttModel}` : "Model STT kembali ke Auto.");
});

$("#captionSearchInput").addEventListener("input", (event) => {
  const query = String(event.target.value || "").trim().toLowerCase();
  const blocks = Array.from(captionTrack.querySelectorAll(".caption-block"));
  const countEl = $("#captionSearchCount");
  if (!query) {
    blocks.forEach((b) => b.classList.remove("search-hit", "search-hidden"));
    if (countEl) countEl.textContent = "";
    return;
  }
  let matches = 0;
  blocks.forEach((block) => {
    const text = (block.textContent || "").toLowerCase();
    const hit = text.includes(query);
    block.classList.toggle("search-hit", hit);
    block.classList.toggle("search-hidden", !hit);
    if (hit) matches += 1;
  });
  if (countEl) countEl.textContent = `${matches} hasil`;
});

loadSttModels();

$("#saveTimeline").addEventListener("click", saveCaptionTimeline);

$("#exportSrt").addEventListener("click", exportCaptionSrt);

$("#undoBtn").addEventListener("click", undoEditable);
$("#redoBtn").addEventListener("click", redoEditable);

$("#importSrtBtn").addEventListener("click", () => {
  const input = $("#importSrtInput");
  if (!input) return;
  input.value = "";
  input.click();
});

$("#importSrtInput").addEventListener("change", (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const text = String(reader.result || "");
      const segments = parseSrtVtt(text);
      if (!segments.length) { showToast("Tidak ada segmen yang valid di file subtitle."); return; }
      if (!state.activeClip) { showToast("Pilih clip dulu sebelum import."); return; }
      pushHistory();
      const offset = Number(state.activeClip.start) || 0;
      const clipEnd = Number(state.activeClip.end) || offset + 30;
      const normalized = segments
        .map((s) => ({
          start: Math.max(0, s.start - offset),
          end: Math.max(0.1, s.end - offset),
          text: String(s.text || "").trim(),
          words: []
        }))
        .filter((s) => s.text && s.end >= 0);
      state.captionSegments = normalized;
      state.captionByClip[captionTimelineKey()] = normalized.map((s) => ({ ...s }));
      state.liveSegments = normalized.map((s) => ({ ...s }));
      state.captionSelected = -1;
      renderCaptionTimeline();
      captionTimelinePanel.style.display = "block";
      showToast(`Imported ${normalized.length} segmen dari ${file.name}. Klik "Simpan Perubahan" untuk menyimpan.`);
    } catch (err) {
      showToast(`Gagal membaca file subtitle: ${err.message}`);
    }
  };
  reader.readAsText(file);
});

// Terjemahkan semua segmen caption ke bahasa target (inspector) via offline Argos.
// Estimasi bahasa sumber dari isi caption (kata umum Indonesia vs Inggris).
// Saat mode "auto" dan hasil deteksi = bahasa target, JANGAN blokir — caption
// bisa jadi campuran (mis. Indonesia + Inggris), jadi pakai bahasa kebalikannya.
const ID_HINT_WORDS = new Set(("yang di dan aku saya kita kamu tidak ini itu untuk dengan pada ke dari ada akan sudah bisa atau juga tapi jika kalau apa karena mari ayo).".replace(/[().]/g, "").split(" ")));
const EN_HINT_WORDS = new Set(("the and of to you i we they it is are was were have has had not this that with for on in from be can will do you're we're they're don't can't won't".replace(/'/g, "").split(" ")));
function guessCaptionLang(segs) {
  let idScore = 0;
  let enScore = 0;
  for (const s of segs) {
    for (const w of String(s.text || "").toLowerCase().split(/[^a-z]+/)) {
      if (!w || w.length < 2) continue;
      if (ID_HINT_WORDS.has(w)) idScore += 1;
      if (EN_HINT_WORDS.has(w)) enScore += 1;
    }
  }
  if (idScore === 0 && enScore === 0) return "";
  return idScore >= enScore ? "id" : "en";
}
// Rasio kesamaan dua teks (0..1) berbasis token umum — dipakai untuk menolak
// hasil terjemahan yang nyaris identik dengan aslinya (mis. caption sudah dalam
// bahasa target, Argos mengembalikan teks hampir sama + kadang typo).
function textSimilarity(a, b) {
  const ta = String(a || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const tb = String(b || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!ta.length || !tb.length) return 0;
  const setB = new Set(tb);
  let hits = 0;
  for (const w of ta) if (setB.has(w)) hits += 1;
  return hits / Math.max(ta.length, tb.length);
}
$("#translateBtn").addEventListener("click", async () => {
  if (!state.activeClip) { showToast("Pilih clip dulu."); return; }
  const segs = state.captionSegments || [];
  if (!segs.length) { showToast("Tidak ada segmen untuk diterjemahkan."); return; }
  const targetTag = clipmeLangTag(CAPTION_LANG);
  if (!targetTag || targetTag === "mix") { showToast("Bahasa target harus Indonesia atau English."); return; }
  const fromSel = $("#translateFrom") ? $("#translateFrom").value : "auto";
  const autoGuess = guessCaptionLang(segs) || "";
  let from;
  if (fromSel && fromSel !== "auto") {
    from = fromSel;
    // Pilihan dropdown bisa tertinggal "Indonesia" dari clip sebelumnya. Kalau
    // dropdown = bahasa target tapi isi caption terdeteksi bahasa lain (mis.
    // masih asing/Inggris), ikuti auto-detect supaya terjemahan tetap jalan.
    if (from === targetTag && autoGuess && autoGuess !== targetTag) from = autoGuess;
  } else {
    from = autoGuess;
    // Caption campuran/ambigu: tetap coba terjemahkan dari bahasa kebalikannya.
    if (!from || from === targetTag) from = targetTag === "id" ? "en" : "id";
  }
  if (from === targetTag) {
    showToast(`Bahasa sumber sama dengan bahasa target (${targetTag === "id" ? "Indonesia" : "English"}). Kalau caption masih bahasa asing, pilih bahasa sumber di dropdown lalu coba lagi.`);
    return;
  }

  const btn = $("#translateBtn");
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Menerjemahkan...";
  try {
    const res = await fetch("/api/stt/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        segments: segs.map((s) => ({ start: s.start, end: s.end, text: s.text })),
        from,
        to: targetTag
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Terjemahan gagal.");
    pushHistory();
    const translated = (data.segments || []).filter((s) => s && s.text);
    if (!translated.length) throw new Error("Hasil terjemahan kosong.");
    let changedCount = 0;
    state.captionSegments = segs.map((s, i) => {
      const t = translated[i] || {};
      const newText = String(t.text || "");
      // Tolak hasil yang nyaris sama dengan aslinya (caption sudah bahasa target
      // atau Argos mengembalikan teks hampir identik) — biar tidak ada typo.
      const keep = newText && textSimilarity(s.text, newText) < 0.7 ? newText : s.text;
      if (keep !== s.text) changedCount += 1;
      return { ...s, text: keep };
    });
    if (!changedCount) {
      showToast("Tidak ada segmen yang berubah — caption tampaknya sudah dalam bahasa target.");
      return;
    }
    state.captionByClip[captionTimelineKey()] = state.captionSegments.map((s) => ({ ...s }));
    state.liveSegments = state.captionSegments.map((s) => ({ ...s }));
    state.liveActive = state.liveSegments.length > 0 && $("#captionStyleSelect").value !== "off";
    state.liveOffset = state.youtubeUrl ? 0 : (state.activeClip ? Number(state.activeClip.start) || 0 : 0);
    renderCaptionTimeline();
    // Refresh preview: live caption saat play/pause dan caption box statis saat idle.
    updateLiveCaption();
    const combined = state.captionSegments.map((s) => s.text).join(" ").trim().slice(0, 155);
    if (combined) {
      captionInput.value = combined;
      captionBox.textContent = `"${combined}"`;
      renderStaticCaption();
      if (state.activeClip) state.activeClip.caption = combined;
    }
    renderClips(state.sorted ? [...clips].sort((a, b) => (b.score || -1) - (a.score || -1)) : clips);
    showToast(`Terjemahan selesai (${changedCount}/${translated.length} segmen berubah). Klik "Simpan Perubahan" untuk menyimpan.`);
  } catch (err) {
    showToast(err.message || "Terjemahan gagal.");
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
});

function parseSrtVtt(text) {
  const cleaned = String(text || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n");
  const blocks = cleaned.split(/\n\s*\n/);
  const segments = [];
  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    let timeIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/-->/.test(lines[i])) { timeIndex = i; break; }
    }
    if (timeIndex < 0) continue;
    const timeMatch = lines[timeIndex].match(/([\d:.]+)\s*-->\s*([\d:.]+)/);
    if (!timeMatch) continue;
    const start = srtTimeToSeconds(timeMatch[1]);
    const end = srtTimeToSeconds(timeMatch[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const textLines = lines.slice(timeIndex + 1);
    if (!textLines.length) continue;
    const text = textLines
      .map((l) => l.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&"))
      .filter((l) => l.trim())
      .join(" ");
    if (!text.trim()) continue;
    segments.push({ start, end, text: text.trim() });
  }
  return segments;
}

function srtTimeToSeconds(value) {
  const parts = String(value || "").replace(/,/g, ".").split(":");
  if (parts.length < 2) return NaN;
  const h = Number(parts[0]) || 0;
  const m = Number(parts[1]) || 0;
  const s = Number(parts.slice(2).join(":")) || 0;
  return h * 3600 + m * 60 + s;
}

function exportCaptionSrt() {
  const segments = state.captionSegments && state.captionSegments.length
    ? state.captionSegments
    : state.liveSegments;
  if (!state.activeClip) { showToast("Pilih clip dulu."); return; }
  if (!segments || !segments.length) {
    showToast("Belum ada caption untuk diexport.");
    return;
  }
  const offset = Number(state.activeClip.start) || 0;
  const dur = Math.max(1, (Number(state.activeClip.end) || 0) - offset);
  const srt = buildSrt(segments, offset, offset + dur);
  const name = `clip${String(state.activeClip.id).padStart(2, "0")}-captions.srt`;
  const blob = new Blob([srt], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast(`SRT diexport: ${name}`);
}

function updateLiveCaption() {
  if (!state.liveActive || !state.liveSegments.length) return;
  const t = previewVideo.currentTime - state.liveOffset;
  let seg = null;
  for (const s of state.liveSegments) {
    if (t >= s.start && t < s.end) { seg = s; break; }
  }
  if (!seg) {
    liveCaption.innerHTML = "";
    liveCaption.style.display = "none";
    if (previewVideo.paused && !previewVideo.ended) renderStaticCaption();
    return;
  }
  const cap = document.createElement("div");
  const style = $("#captionStyleSelect").value;
  liveCaption.style.fontSize = `${captionPreviewFontPx()}px`;
  liveCaption.className = "live-caption" + (style !== "off" ? ` lc-${style}` : "");
  applyCaptionPosition();
  applyCaptionVisuals();
  if (style === "karaoke" && seg.words && seg.words.length) {
    seg.words.forEach((w) => {
      const span = document.createElement("span");
      span.className = "lc-word" + (t >= w.start && (w.end == null || t < w.end) ? " lc-active" : "");
      span.textContent = w.text;
      cap.appendChild(span);
    });
  } else {
    const span = document.createElement("span");
    span.className = "lc-word";
    span.textContent = seg.text;
    
    // Warnai teks jika ada speaker_id dan bukan style karaoke
    if (seg.speaker_id && style !== "karaoke" && style !== "off") {
        span.style.color = getSpeakerColor(seg.speaker_id);
    }
    
    cap.appendChild(span);
  }
  liveCaption.innerHTML = "";
  liveCaption.appendChild(cap);
  liveCaption.style.display = "block";
  captionBox.style.display = "none";
}

function captionTimelineKey() {
  return captionKeyForClip(state.activeClip);
}

function captionKeyForClip(clip) {
  return state.projectId && clip
    ? `${state.projectId}:${clip.id}:${clip.start}:${clip.end}`
    : "";
}

function captionSegmentsForClip(clip) {
  const stored = state.captionByClip[captionKeyForClip(clip)];
  if (Array.isArray(stored) && stored.length) {
    return stored.map((s) => ({
      start: Number(s.start) || 0,
      end: Number(s.end) || 0,
      text: String(s.text || "").trim(),
      words: Array.isArray(s.words) && s.words.length ? s.words : []
    }));
  }
  if (state.activeClip && state.activeClip.id === clip.id && state.captionSegments.length) {
    return state.captionSegments.map((s) => ({
      start: Number(s.start) || 0,
      end: Number(s.end) || 0,
      text: String(s.text || "").trim(),
      words: Array.isArray(s.words) && s.words.length ? s.words : []
    }));
  }
  return [];
}

function normalizeCaptionSegments(segments, start, end) {
  const dur = Math.max(1, end - start);
  return (Array.isArray(segments) ? segments : [])
    .map((s) => ({
      start: Math.max(0, Number(s.start || 0)),
      end: Math.min(dur, Math.max(Number(s.end || 0), Number(s.start || 0) + 0.1)),
      text: String(s.text || "").trim(),
      words: Array.isArray(s.words) ? s.words : []
    }))
    .filter((s) => s.text && s.end > s.start);
}

function loadCaptionTimeline(segments) {
  if (!state.activeClip || !state.projectId) return;
  const dur = Math.max(1, state.activeClip.end - state.activeClip.start);
  state.captionSegments = normalizeCaptionSegments(segments, 0, dur);
  state.captionSelected = -1;
  state.captionLoadedFor = captionTimelineKey();
  state.captionByClip[captionTimelineKey()] = state.captionSegments.map((s) => ({
    ...s,
    words: Array.isArray(s.words) ? s.words.slice() : []
  }));
  renderCaptionTimeline();
}

const CAPTION_PX_PER_SEC = 24;
const CAPTION_ZOOM_MIN = 0.4;
const CAPTION_ZOOM_MAX = 4;

function clampZoom(z) {
  return Math.max(CAPTION_ZOOM_MIN, Math.min(CAPTION_ZOOM_MAX, Number(z) || 1));
}

function captionPxPerSec(zoom) {
  return CAPTION_PX_PER_SEC * clampZoom(zoom == null ? state.timelineZoom : zoom);
}

function captionTimelineWidth(dur, zoom) {
  return Math.max(1, dur) * captionPxPerSec(zoom);
}

function captionTickStep(pxPerSec) {
  if (pxPerSec >= 60) return 0.5;
  if (pxPerSec >= 24) return 1;
  if (pxPerSec >= 8) return 5;
  return 10;
}

function captionTickTimes(dur, pxPerSec) {
  const step = captionTickStep(pxPerSec);
  const ticks = [];
  for (let t = 0; t <= dur + 1e-6; t += step) {
    ticks.push({ t, left: t * pxPerSec });
  }
  return ticks;
}

function clampPlayheadTime(t, dur) {
  return Math.max(0, Math.min(dur, t));
}

function captionBlockPx(seg, pxPerSec) {
  return {
    left: Math.max(0, Number(seg.start) || 0) * pxPerSec,
    width: Math.max(10, ((Number(seg.end) || 0) - (Number(seg.start) || 0)) * pxPerSec)
  };
}

function captionPxToTime(px, pxPerSec) {
  const rate = Number(pxPerSec) || 0;
  if (rate <= 0) return 0;
  return Math.max(0, px / rate);
}

const CAPTION_MIN_DUR = 0.2;

function moveCaptionSegment(seg, deltaT, dur) {
  const start = Number(seg.start) || 0;
  const end = Number(seg.end) || start + CAPTION_MIN_DUR;
  const len = Math.max(CAPTION_MIN_DUR, end - start);
  let newStart = clampPlayheadTime(start + deltaT, dur);
  if (newStart + len > dur) newStart = Math.max(0, dur - len);
  return { start: newStart, end: newStart + len };
}

function resizeCaptionSegment(seg, edge, at, dur) {
  const start = Number(seg.start) || 0;
  const end = Number(seg.end) || start + CAPTION_MIN_DUR;
  if (edge === "left") {
    const newStart = clampPlayheadTime(at, dur);
    if (end - newStart < CAPTION_MIN_DUR) return { start, end };
    return { start: newStart, end };
  }
  const newEnd = clampPlayheadTime(at, dur);
  if (newEnd - start < CAPTION_MIN_DUR) return { start, end };
  return { start, end: newEnd };
}

function captionDragMode(target) {
  if (target.closest(".cb-resize-left")) return "resize-left";
  if (target.closest(".cb-resize-right")) return "resize-right";
  if (target.closest(".caption-block")) return "move";
  return null;
}

function srtTimestamp(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const ms = Math.round((total % 1) * 1000);
  const sec = Math.floor(total) % 60;
  const min = Math.floor(total / 60) % 60;
  const hr = Math.floor(total / 3600);
  const pad = (n, w) => String(n).padStart(w, "0");
  return `${pad(hr, 2)}:${pad(min, 2)}:${pad(sec, 2)},${pad(ms, 3)}`;
}

function buildSrt(segments, offset = 0, maxDur = Infinity) {
  const items = (Array.isArray(segments) ? segments : [])
    .map((s) => ({
      start: Math.max(0, Number(s.start) || 0),
      end: Math.max(0, Number(s.end) || 0),
      text: String(s.text || "").replace(/\r?\n/g, " ").trim()
    }))
    .filter((s) => s.text && s.end > s.start);
  let n = 0;
  const lines = [];
  for (const seg of items) {
    const start = offset + seg.start;
    const end = Math.min(offset + seg.end, Number(maxDur) >= 0 ? maxDur : Infinity);
    if (end <= start) continue;
    n++;
    lines.push(String(n));
    lines.push(`${srtTimestamp(start)} --> ${srtTimestamp(end)}`);
    lines.push(seg.text);
    lines.push("");
  }
  return lines.join("\n");
}

function renderCaptionTimeline() {
  if (!captionTimelinePanel) return;
  if (!state.activeClip || !state.captionSegments.length) {
    captionTimelinePanel.style.display = "none";
    return;
  }
  const start = Number(state.activeClip.start) || 0;
  const end = Number(state.activeClip.end) || start + 30;
  const dur = Math.max(1, end - start);

  captionTimelinePanel.style.display = "block";
  const inner = document.getElementById("captionTlInner");
  const scroller = document.getElementById("captionTlScroll");
  const pxPerSec = captionPxPerSec(state.timelineZoom);
  if (inner) inner.style.width = `${captionTimelineWidth(dur, state.timelineZoom)}px`;
  const prevScrollLeft = scroller ? scroller.scrollLeft : 0;
  captionTrack.querySelectorAll(".caption-block").forEach((el) => el.remove());

  const ruler = document.getElementById("captionRuler");
  ruler.innerHTML = "";
  captionTickTimes(dur, pxPerSec).forEach((tick) => {
    const el = document.createElement("span");
    el.style.left = `${tick.left}px`;
    el.textContent = formatTime(start + tick.t);
    ruler.appendChild(el);
  });
  ruler.style.width = `${captionTimelineWidth(dur, state.timelineZoom)}px`;

  state.captionSegments.forEach((seg, index) => {
    const block = document.createElement("div");
    block.className = "caption-block" + (index === state.captionSelected ? " active" : "");
    const pos = captionBlockPx(seg, pxPerSec);
    block.style.left = `${pos.left}px`;
    block.style.width = `${pos.width}px`;
    const time = document.createElement("span");
    time.className = "cb-time";
    time.textContent = `${formatTime(start + seg.start)}-${formatTime(start + seg.end)}`;
    block.appendChild(time);
    block.appendChild(document.createTextNode(seg.text));
    const rl = document.createElement("div");
    rl.className = "cb-resize cb-resize-left";
    block.appendChild(rl);
    const rr = document.createElement("div");
    rr.className = "cb-resize cb-resize-right";
    block.appendChild(rr);
    block.addEventListener("mousedown", (event) => startCaptionDrag(event, index));
    block.addEventListener("click", (event) => {
      event.stopPropagation();
      if (state.suppressCaptionClick) { state.suppressCaptionClick = false; return; }
      selectCaptionSegment(index);
    });
    captionTrack.appendChild(block);
  });

  if (scroller) scroller.scrollLeft = prevScrollLeft;
  updateCaptionZoomLabel();
  updateCaptionPlayhead();
  updateCaptionEditor();
}

function captionDragX(event) {
  const rect = captionTlScroller.getBoundingClientRect();
  return event.clientX - rect.left + captionTlScroller.scrollLeft;
}

function startCaptionDrag(event, index) {
  if (event.button !== 0) return;
  const mode = captionDragMode(event.target);
  if (!mode) return;
  const seg = state.captionSegments[index];
  if (!seg) return;
  event.preventDefault();
  event.stopPropagation();
  state.captionSelected = index;
  renderCaptionTimeline();

  const startX = captionDragX(event);
  const origStart = Number(seg.start) || 0;
  const origEnd = Number(seg.end) || origStart + CAPTION_MIN_DUR;
  const pxPerSec = captionPxPerSec(state.timelineZoom);
  const dur = Math.max(1, (Number(state.activeClip.end) || 0) - (Number(state.activeClip.start) || 0));

  const dragMove = (moveEvent) => {
    const deltaX = captionDragX(moveEvent) - startX;
    const deltaT = deltaX / pxPerSec;
    if (mode === "move") {
      const moved = moveCaptionSegment({ start: origStart, end: origEnd }, deltaT, dur);
      seg.start = moved.start;
      seg.end = moved.end;
    } else if (mode === "resize-left") {
      const resized = resizeCaptionSegment(seg, "left", origStart + deltaT, dur);
      seg.start = resized.start;
      seg.end = resized.end;
    } else {
      const resized = resizeCaptionSegment(seg, "right", origEnd + deltaT, dur);
      seg.start = resized.start;
      seg.end = resized.end;
    }
    renderCaptionTimeline();
  };

  const dragEnd = () => {
    window.removeEventListener("mousemove", dragMove);
    window.removeEventListener("mouseup", dragEnd);
    state.suppressCaptionClick = true;
    updateCaptionEditor();
  };
  window.addEventListener("mousemove", dragMove);
  window.addEventListener("mouseup", dragEnd);
}

function updateCaptionZoomLabel() {
  const el = document.getElementById("captionZoomValue");
  if (el) el.textContent = `${Math.round((state.timelineZoom || 1) * 100)}%`;
}

function selectCaptionSegment(index) {
  state.captionSelected = index;
  renderCaptionTimeline();
  captionEditInput.focus();
}

function updateCaptionEditor() {
  if (!captionEditInput || !captionEditTime || !captionEditIndex) return;
  const start = Number(state.activeClip ? state.activeClip.start : 0) || 0;
  if (state.captionSelected < 0 || !state.captionSegments[state.captionSelected]) {
    captionEditIndex.textContent = "--";
    captionEditTime.textContent = "00:00 - 00:00";
    captionEditInput.value = "";
    captionEditInput.placeholder = "Klik blok di timeline untuk edit teks caption";
    return;
  }
  const seg = state.captionSegments[state.captionSelected];
  captionEditIndex.textContent = `Segmen ${state.captionSelected + 1}`;
  captionEditTime.textContent = `${formatTime(start + seg.start)} - ${formatTime(start + seg.end)}`;
  captionEditInput.value = seg.text;
}

function updateCaptionPlayhead() {
  if (!captionPlayhead || !state.activeClip) return;
  const dur = Math.max(1, state.activeClip.end - state.activeClip.start);
  const t = previewVideo.currentTime - state.liveOffset;
  const clamped = clampPlayheadTime(t, dur);
  const pxPerSec = captionPxPerSec(state.timelineZoom);
  const headLeft = clamped * pxPerSec;
  captionPlayhead.style.left = `${headLeft}px`;
  const scroller = document.getElementById("captionTlScroll");
  if (scroller) {
    const scrollRight = scroller.scrollLeft + scroller.clientWidth;
    if (state.userScrolling) {
      const farBehind = headLeft < scroller.scrollLeft - scroller.clientWidth * 0.5;
      const farAhead = headLeft > scrollRight + scroller.clientWidth * 0.5;
      if (!farBehind && !farAhead) return;
    }
    if (headLeft < scroller.scrollLeft || headLeft > scrollRight) {
      state.suppressScrollMark = true;
      scroller.scrollLeft = Math.max(0, headLeft - scroller.clientWidth * 0.4);
      window.requestAnimationFrame(() => { state.suppressScrollMark = false; });
    }
  }
}

function saveCaptionTimeline() {
  if (!state.projectId || !state.activeClip) {
    showToast("Tidak ada clip untuk disimpan.");
    return;
  }
  if (!state.captionSegments.length) {
    showToast("Belum ada segmen caption untuk disimpan.");
    return;
  }
  if (state.captionSelected >= 0 && captionEditInput.value !== state.captionSegments[state.captionSelected]?.text) {
    state.captionSegments[state.captionSelected].text = captionEditInput.value;
    renderCaptionTimeline();
  }

  const payload = {
    projectId: state.projectId,
    clipId: state.activeClip.id,
    start: state.activeClip.start,
    end: state.activeClip.end,
    language: CAPTION_LANG,
    segments: state.captionSegments
  };

  $("#saveTimeline").disabled = true;
  $("#saveTimeline").textContent = "Menyimpan...";
  fetch("/api/edit-transcript", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  })
    .then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Simpan gagal.");
      state.liveSegments = state.captionSegments.map((s) => ({ ...s }));
      state.captionByClip[captionTimelineKey()] = state.captionSegments.map((s) => ({
        ...s,
        words: Array.isArray(s.words) ? s.words.slice() : []
      }));
      showToast(`Caption tersimpan: ${data.segments} segmen.`);
      return data;
    })
    .catch((err) => showToast(err.message))
    .finally(() => {
      $("#saveTimeline").disabled = false;
      $("#saveTimeline").textContent = "Simpan Perubahan";
    });
}

captionEditInput.addEventListener("input", () => {
  if (state.captionSelected < 0 || !state.captionSegments[state.captionSelected]) return;
  const seg = state.captionSegments[state.captionSelected];
  seg.text = captionEditInput.value;
  rebuildSegmentKaraoke(seg);
  const block = captionTrack.children[state.captionSelected + 1];
  if (block) {
    block.childNodes[1].textContent = captionEditInput.value;
  }
  state.liveSegments = state.captionSegments.map((s) => ({ ...s, words: (s.words || []).slice() }));
  if (state.liveActive) updateLiveCaption();
});

function rebuildSegmentKaraoke(seg) {
  const raw = String(seg.text || "").trim();
  if (!raw) {
    seg.words = [];
    seg.lines = [];
    return;
  }
  const words = raw.split(/\s+/).filter(Boolean);
  const start = Number(seg.start) || 0;
  const end = Number(seg.end) || start + 1;
  const dur = Math.max(0.05, end - start);
  const n = Math.max(1, words.length);
  const old = Array.isArray(seg.words) ? seg.words : [];
  const oldFocus = new Set((old || []).filter((w) => w && w.focus).map((w) => String(w.text).toLowerCase()));
  const oldStarts = (old || []).map((w) => Number(w.start)).filter((v) => Number.isFinite(v));
  seg.words = words.map((t, i) => {
    const wStart = oldStarts[i] != null && i < oldStarts.length ? oldStarts[i] : start + (dur * i) / n;
    const wEnd = i < words.length - 1
      ? (oldStarts[i + 1] != null ? oldStarts[i + 1] : start + (dur * (i + 1)) / n)
      : end;
    return {
      text: t,
      start: Math.max(start, Math.round(wStart * 100) / 100),
      end: Math.min(end, Math.round(wEnd * 100) / 100),
      focus: oldFocus.has(t.toLowerCase())
    };
  });
  seg.lines = splitLineText(raw);
}

function splitLineText(text, maxLines, maxLineLength) {
  const maxL = maxLines || 2;
  const maxLen = maxLineLength || 40;
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const w of words) {
    const test = current ? `${current} ${w}` : w;
    if (current && (lines.length >= maxL - 1 || test.length > maxLen)) {
      lines.push(current);
      current = w;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

document.addEventListener("click", (event) => {
  if (state.captionSelected < 0) return;
  if (captionTimelinePanel && !captionTimelinePanel.contains(event.target)) {
    state.captionSelected = -1;
    updateCaptionEditor();
    renderCaptionTimeline();
  }
});

$("#autoCaptionBtn").addEventListener("click", async () => {
  if (!state.projectId) { showToast("Analyze URL dulu sebelum auto caption."); return; }
  if (!state.activeClip) { showToast("Tidak ada clip untuk auto caption."); return; }
  const btn = $("#autoCaptionBtn");
  btn.disabled = true;
  btn.textContent = "Processing...";
  try {
    const response = await fetch("/api/auto-captions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: state.projectId,
        clipId: state.activeClip.id,
        start: state.activeClip.start,
        end: state.activeClip.end,
        language: CAPTION_LANG,
        style: $("#captionStyleSelect").value || "dynamic",
        fillerMode: ($("#fillerModeSelect") && $("#fillerModeSelect").value) || "aggressive",
        maxLines: 2,
        maxLineLength: 40,
        model: state.sttModel || ""
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Auto caption gagal.");
    const segs = Array.isArray(data.segments) ? data.segments : [];
    if (!segs.length) throw new Error("Auto caption tidak menghasilkan segmen.");
    showToast(`Auto caption siap: ${segs.length} segmen (${data.provider})`);
    $("#captionStatus").textContent = `${data.provider}: ${segs.length} segmen`;
    state.liveSegments = segs.map((s) => ({
      ...s,
      words: Array.isArray(s.karaoke) ? s.karaoke : []
    }));
    state.captionSegments = segs.map((s) => ({
      ...s,
      words: Array.isArray(s.karaoke) ? s.karaoke : (Array.isArray(s.words) ? s.words : [])
    }));
    state.captionByClip[captionTimelineKey()] = state.captionSegments.map((s) => ({
      ...s,
      words: Array.isArray(s.words) ? s.words.slice() : []
    }));
    state.liveActive = state.liveSegments.length > 0 && $("#captionStyleSelect").value !== "off";
    // Align the live caption window to this clip. Karaoke timestamps are
    // clip-relative (0..duration), so liveOffset must match this clip's start
    // — otherwise captions drift onto the wrong part of the video (mirrors
    // loadPreviewClip) and go empty once playback leaves the segment window.
    state.liveOffset = state.youtubeUrl ? 0 : (state.activeClip ? Number(state.activeClip.start) || 0 : 0);
    try { previewVideo.currentTime = state.noDownload ? 0 : state.liveOffset; } catch {}
    loadCaptionTimeline(state.liveSegments);
    updateLiveCaption();
    if (data.hook || data.caption) {
      if (data.hook) {
        $("#hookInput").value = data.hook;
        if (state.activeClip) state.activeClip.hook = data.hook;
      }
      if (data.caption) {
        $("#captionInput").value = data.caption;
        captionBox.textContent = `"${data.caption}"`;
        renderStaticCaption();
        if (state.activeClip) state.activeClip.caption = data.caption;
      }
      renderClips(state.sorted ? [...clips].sort((a, b) => (b.score || -1) - (a.score || -1)) : clips);
    }
  } catch (err) {
    showToast(err.message);
    uploadStatus.textContent = "Auto caption failed";
  } finally {
    btn.disabled = false;
    btn.textContent = "Auto Caption";
  }
});

$("#sortClips").addEventListener("click", () => {
  state.sorted = !state.sorted;
  const list = state.sorted ? [...clips].sort((a, b) => (b.score || -1) - (a.score || -1)) : clips;
  renderClips(list);
  showToast(state.sorted ? "Diurutkan berdasarkan viral score." : "Urutan kembali ke timeline.");
});

captionInput.addEventListener("input", () => {
  if (!state.activeClip) return;
  captionBox.textContent = `"${captionInput.value}"`;
  renderStaticCaption();
  state.activeClip.caption = captionInput.value;
});

hookInput.addEventListener("input", () => {
  if (!state.activeClip) return;
  state.activeClip.hook = hookInput.value;
  renderClips(state.sorted ? [...clips].sort((a, b) => (b.score || -1) - (a.score || -1)) : clips);
});

captionSize.addEventListener("input", () => {
  renderStaticCaption();
  if (state.liveActive) {
    liveCaption.style.fontSize = `${captionPreviewFontPx()}px`;
    updateLiveCaption();
  }
});

captionPosition.addEventListener("input", () => {
  state.captionPosition = Number(captionPosition.value) / 100;
  renderStaticCaption();
  if (state.liveActive) updateLiveCaption();
});

$("#captionStyleSelect").addEventListener("change", () => {
  const style = $("#captionStyleSelect").value;
  renderStaticCaption();
  if (!state.projectId || !state.activeClip || !state.liveSegments.length) return;
  state.liveActive = style !== "off";
  if (state.liveActive) {
    liveCaption.innerHTML = "";
    updateLiveCaption();
  } else {
    liveCaption.innerHTML = "";
    liveCaption.style.display = "none";
  }
});

$("#fpsSelect").addEventListener("change", (e) => { state.fps = Number(e.target.value) || 25; });
$("#qualitySelect").addEventListener("change", (e) => { state.crf = Number(e.target.value) || 23; });
$("#audioBitrateSelect").addEventListener("change", (e) => { state.audioBitrate = Number(e.target.value) || 128; });
$("#watermarkText").addEventListener("input", (e) => { state.watermark = e.target.value; });
$("#watermarkPosition").addEventListener("change", (e) => { state.watermarkPosition = e.target.value; });
$("#watermarkOpacity").addEventListener("input", (e) => { state.watermarkOpacity = Number(e.target.value) / 100; });

$("#layoutSelect").addEventListener("change", (event) => {
  setRatio(event.target.value);
  showToast(`Layout diganti ke ${event.target.selectedOptions[0].text}.`);
});

if (captionFontSelect) {
  captionFontSelect.addEventListener("change", () => {
    renderStaticCaption();
    if (state.liveActive) updateLiveCaption();
  });
}

if (captionColorInput) {
  captionColorInput.addEventListener("input", () => {
    renderStaticCaption();
    if (state.liveActive) updateLiveCaption();
  });
}

$$(".segmented button").forEach((button) => {
  button.addEventListener("click", () => {
    setRatio(button.dataset.ratio);
  });
});

$$(".tabs button").forEach((button) => {
  button.addEventListener("click", () => {
    $$(".tabs button").forEach((item) => item.classList.remove("active"));
    $$(".tab-panel").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    $(`#${button.dataset.tab}Tab`).classList.add("active");
  });
});

$("#analyzeIntelBtn").addEventListener("click", analyzeSelectedClip);

$("#intelApplyHook").addEventListener("click", () => {
  const value = $("#intelRecommendedHook").textContent;
  if (value && value !== "--") {
    hookInput.value = value;
    state.activeClip.hook = value;
    showToast("Recommended hook dipakai sebagai hook.");
  }
});

$("#intelApplyCaption").addEventListener("click", () => {
  const value = $("#intelCaptionA").textContent;
  const meta = state.activeClip && state.activeClip.analysis;
  const best = meta && meta.bestCaption ? meta.captionVariants[meta.bestCaption] : value;
  if (best && best !== "--") {
    captionInput.value = best;
    state.activeClip.caption = best;
    captionBox.textContent = `"${best}"`;
    renderStaticCaption();
    showToast(`Caption ${meta ? meta.bestCaption : "A"} diterapkan.`);
  }
});

async function analyzeSelectedClip() {
  if (!state.projectId || !state.activeClip) {
    showToast("Pilih clip dulu sebelum analyze.");
    return;
  }
  const btn = $("#analyzeIntelBtn");
  btn.disabled = true;
  btn.textContent = "Analyzing...";
  $("#intelStatus").textContent = "Menganalisis dengan ClipMe engine...";

  try {
    const response = await fetch("/api/analyze-clip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: state.projectId,
        clipId: state.activeClip.id,
        start: state.activeClip.start,
        end: state.activeClip.end,
        language: CAPTION_LANG
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Analyze gagal.");
    const a = data.analysis;
    state.activeClip.analysis = a;
    renderIntel(a);
    $("#intelStatus").textContent = data.provider === "clipme-llm" ? "AI (LLM)" : "Heuristic";
  } catch (error) {
    $("#intelStatus").textContent = "Gagal";
    showToast(error.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Analyze clip";
  }
}

function renderIntel(a) {
  $("#intelScore").textContent = a.score != null ? `${a.score}/100` : "--";
  $("#intelConfidence").textContent = a.confidence != null ? `${a.confidence}%` : "--";
  $("#intelHookType").textContent = a.hookType || "--";
  $("#intelOriginalHook").textContent = a.originalHook || "--";
  $("#intelRecommendedHook").textContent = a.recommendedHook || "--";
  $("#intelKeyMessage").textContent = a.keyMessage || "--";
  $("#intelPayoff").textContent = a.payoff || "--";
  $("#intelStory").textContent = a.storyStructure || "--";
  $("#intelContext").textContent = a.contextWarning || "--";
  $("#intelQuote").textContent = a.quoteLine || "--";
  $("#intelCaptionA").textContent = a.captionVariants ? a.captionVariants.A : "--";
  $("#intelCaptionB").textContent = a.captionVariants ? a.captionVariants.B : "--";
  $("#intelCaptionC").textContent = a.captionVariants ? a.captionVariants.C : "--";
  $("#intelCta").textContent = a.cta || "--";
  $("#intelQuestion").textContent = a.discussionQuestion || "--";
  $("#intelHashtags").textContent = a.hashtags
    ? `${a.hashtags.primary}\n${a.hashtags.niche}\n${a.hashtags.broad}`.trim()
    : "--";
  $("#intelQuality").textContent = a.qualityGate && a.qualityGate.pass != null
    ? (a.qualityGate.pass ? "LULUS (pas untuk publish)" : "GAGAL (perbaiki atau reject)")
    : "--";
}

$("#exportButton").addEventListener("click", exportSelectedClip);

$("#applyTrim").addEventListener("click", applyTrim);
$("#trimStart").addEventListener("change", applyTrim);
$("#trimEnd").addEventListener("change", applyTrim);

$("#selectAllClips").addEventListener("click", () => {
  const allSelected = clips.length > 0 && clips.every((clip) => state.selectedClipIds.has(clip.id));
  state.selectedClipIds = new Set(allSelected ? [] : clips.map((clip) => clip.id));
  renderClips(state.sorted ? [...clips].sort((a, b) => (b.score || -1) - (a.score || -1)) : clips);
  showToast(allSelected ? "Semua clip di-unselect." : `Selected ${clips.length} clips`);
});

$("#exportAllBtn").addEventListener("click", async () => {
  const selectedIds = state.selectedClipIds;
  const targetClips = selectedIds.size > 0
    ? clips.filter((clip) => selectedIds.has(clip.id))
    : clips;
  if (!targetClips.length) {
    showToast("Tidak ada clip untuk di-export.");
    return;
  }
  if (!state.projectId) {
    showToast("Upload video dulu sebelum export.");
    return;
  }
  if (state.isExporting) return;

  state.isExporting = true;
  $("#exportAllBtn").disabled = true;
  $("#exportAllBtn").textContent = "Exporting...";
  showToast(`Mengekspor ${targetClips.length} clip...`);

  try {
    const response = await fetch("/api/export-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: state.projectId,
        clips: targetClips.map((clip) => ({
          clipId: clip.id,
          start: clip.start,
          end: clip.end,
          caption: clip.caption || "",
          language: CAPTION_LANG,
          captionStyle: $("#captionStyleSelect").value,
          captionSize: captionSize.value,
          fontFamily: captionFontSelect ? captionFontSelect.value : "Arial",
          captionColor: captionColorInput ? captionColorInput.value : "",
          captionPosition: state.captionPosition || 0.76,
          ratio: currentRatio(),
          ratios: selectedExportRatios(),
          fps: Number(state.fps) || 0,
          crf: Number(state.crf) || 23,
          audioBitrate: Number(state.audioBitrate) || 128,
          watermark: state.watermark,
          watermarkPosition: state.watermarkPosition,
          watermarkOpacity: state.watermarkOpacity,
          segments: captionSegmentsForClip(clip)
        }))
      })
    });

    const data = await response.json();
    if (!response.ok && response.status !== 202) throw new Error(data.error || "Batch export gagal.");
    if (!data.jobId) throw new Error("Server tidak mengembalikan job batch export.");

    const result = await waitForJob(data.jobId);
    const okResults = (result.results || []).filter((item) => item && item.filename);
    const errors = (result.results || []).filter((item) => item && item.error);

    for (const item of okResults) {
      state.exports.unshift({
        filename: item.filename,
        downloadUrl: item.downloadUrl,
        clipTitle: `Batch export`,
        status: "Selesai",
        createdAt: new Date().toLocaleString()
      });
    }
    renderExports();

    const summary = `${okResults.length}/${result.total || targetClips.length} berhasil`;
    if (errors.length) {
      showToast(`${summary}, ${errors.length} gagal (${errors[0].error || "error"}).`);
    } else {
      showToast(`${summary}.`);
    }
    uploadStatus.textContent = summary;
  } catch (err) {
    showToast(err.message);
  } finally {
    state.isExporting = false;
    $("#exportAllBtn").disabled = false;
    $("#exportAllBtn").textContent = "Export all";
  }
});

$$(".nav-item").forEach((button) => {
  button.addEventListener("click", () => {
    showView(button.dataset.view);
    if (button.dataset.view === "library") loadProjects();
    if (button.dataset.view === "exports") loadExports();
  });
});

function exportClipPayloadFor(clip) {
  return {
    clipId: clip.id,
    start: clip.start,
    end: clip.end,
    caption: clip.caption || "",
    language: CAPTION_LANG,
    captionStyle: $("#captionStyleSelect").value,
    captionSize: captionSize.value,
    fontFamily: captionFontSelect ? captionFontSelect.value : "Arial",
    captionColor: captionColorInput ? captionColorInput.value : "",
    captionPosition: state.captionPosition || 0.76,
    ratio: currentRatio(),
    fps: Number(state.fps) || 0,
    crf: Number(state.crf) || 23,
    audioBitrate: Number(state.audioBitrate) || 128,
    watermark: state.watermark,
    watermarkPosition: state.watermarkPosition,
    watermarkOpacity: state.watermarkOpacity,
    segments: captionSegmentsForClip(clip)
  };
}

function addExportResult(item, title) {
  if (!item || !item.filename) return;
  state.exports.unshift({
    filename: item.filename,
    downloadUrl: item.downloadUrl,
    clipTitle: title,
    status: "Selesai",
    createdAt: new Date().toLocaleString()
  });
  renderExports();
}

$("#exportCombinedBtn").addEventListener("click", async () => {
  const selectedIds = state.selectedClipIds;
  const targetClips = selectedIds.size > 0
    ? clips.filter((clip) => selectedIds.has(clip.id))
    : clips;
  if (!targetClips.length) { showToast("Tidak ada clip untuk digabung."); return; }
  if (!state.projectId) { showToast("Upload video dulu sebelum export."); return; }
  if (state.isExporting) return;

  state.isExporting = true;
  $("#exportCombinedBtn").disabled = true;
  $("#exportCombinedBtn").textContent = "Menggabung...";
  showToast(`Menggabung ${targetClips.length} clip jadi satu video...`);

  try {
    const response = await fetch("/api/export-combined", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: state.projectId,
        clips: targetClips.map(exportClipPayloadFor)
      })
    });
    const data = await response.json();
    if (!response.ok && response.status !== 202) throw new Error(data.error || "Gabung clip gagal.");
    if (!data.jobId) throw new Error("Server tidak mengembalikan job gabung.");
    const result = await waitForJob(data.jobId);
    addExportResult(result, `Gabungan ${targetClips.length} clip`);
    showToast(`Video gabungan selesai: ${result.filename}`);
  } catch (err) {
    showToast(err.message);
  } finally {
    state.isExporting = false;
    $("#exportCombinedBtn").disabled = false;
    $("#exportCombinedBtn").textContent = "Gabung jadi 1";
  }
});

$("#clearLibrary").addEventListener("click", async () => {
  const ids = state.projects.map((p) => p.id);
  for (const id of ids) {
    try {
      await fetch(`/api/projects/${id}`, { method: "DELETE" });
    } catch {}
  }
  state.projects = [];
  renderLibrary();
  showToast("Project dan file di server dihapus.");
  refreshStorage();
});

$("#clearExports").addEventListener("click", async () => {
  const files = state.exports.map((e) => e.filename);
  for (const filename of files) {
    try {
      await fetch(`/api/exports/${encodeURIComponent(filename)}`, { method: "DELETE" });
    } catch {}
  }
  state.exports = [];
  renderExports();
  showToast("Export dan file MP4 di server dihapus.");
  refreshStorage();
});

const SETTINGS_KEY = "clipperStudio.settings";

function collectSettings() {
  const style = $("#captionStyleSelect") ? $("#captionStyleSelect").value : "bold";
  return {
    fps: state.fps,
    crf: state.crf,
    audioBitrate: state.audioBitrate,
    watermark: state.watermark,
    watermarkPosition: state.watermarkPosition,
    watermarkOpacity: state.watermarkOpacity,
    exportRatios: state.exportRatios,
    captionStyle: style,
    captionSize: Number(captionSize.value) || 23,
    captionPosition: state.captionPosition || 0.76,
    speakerCut: !!$("#speakerCutToggle")?.checked,
    faceTrack: !!$("#faceTrackToggle")?.checked,
  };
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(collectSettings()));
  } catch {}
}

function loadSettings() {
  let data;
  try {
    data = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
  } catch {
    data = null;
  }
  if (!data || typeof data !== "object") return;
  if (Number(data.fps)) state.fps = Number(data.fps);
  if (Number(data.crf)) state.crf = Number(data.crf);
  if (Number(data.audioBitrate)) state.audioBitrate = Number(data.audioBitrate);
  if (typeof data.watermark === "string") state.watermark = data.watermark;
  if (["tl", "tr", "bl", "br"].includes(data.watermarkPosition)) state.watermarkPosition = data.watermarkPosition;
  if (data.watermarkOpacity != null) state.watermarkOpacity = Number(data.watermarkOpacity);
  if (Array.isArray(data.exportRatios)) {
    const valid = data.exportRatios.filter((r) => ["portrait", "wide", "four5"].includes(r));
    if (valid.length) state.exportRatios = valid;
  }  if (data.captionPosition != null) state.captionPosition = Number(data.captionPosition);
  state.speakerCut = !!data.speakerCut;
  state.faceTrack = !!data.faceTrack;

  state.speakerCut = !!data.speakerCut;
  state.faceTrack = !!data.faceTrack;

  state.speakerCut = !!data.speakerCut;
  state.faceTrack = !!data.faceTrack;


  $("#fpsSelect").value = String(state.fps);
  $("#qualitySelect").value = String(state.crf);
  $("#audioBitrateSelect").value = String(state.audioBitrate);
  $("#watermarkText").value = state.watermark;
  $("#watermarkPosition").value = state.watermarkPosition;
  $("#watermarkOpacity").value = String(Math.round(state.watermarkOpacity * 100));
  $$(".export-ratio-chk").forEach((el) => { el.checked = state.exportRatios.includes(el.dataset.ratio); });
  if ($("#captionStyleSelect")) $("#captionStyleSelect").value = data.captionStyle || "bold";
  if (Number(data.captionSize)) captionSize.value = String(data.captionSize);
  captionPosition.value = String(Math.round((state.captionPosition || 0.76) * 100));  $("#speakerCutToggle").checked = state.speakerCut;
  $("#faceTrackToggle").checked = state.faceTrack;  $("#speakerCutToggle").checked = state.speakerCut;
  $("#faceTrackToggle").checked = state.faceTrack;  const sct = document.getElementById("speakerCutToggle");
  if (sct) sct.checked = state.speakerCut;
  const ftt = document.getElementById("faceTrackToggle");
  if (ftt) ftt.checked = state.faceTrack;
  applyCaptionPosition();
}

const saveSettingsDebounced = (() => {
  let timer = 0;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(saveSettings, 300);
  };
})();

const settingsControls = [
  ["change", "#fpsSelect"],
  ["change", "#qualitySelect"],
  ["change", "#audioBitrateSelect"],
  ["input", "#watermarkText"],
  ["change", "#watermarkPosition"],
  ["input", "#watermarkOpacity"],
  ["change", ".export-ratio-chk"],
  ["change", "#captionStyleSelect"],
  ["input", "#captionSize"],
  ["input", "#captionPosition"],
  ["change", "#speakerCutToggle"],
  ["change", "#faceTrackToggle"]
];
settingsControls.forEach(([eventName, sel]) => {
  $$(sel).forEach((el) => el.addEventListener(eventName, saveSettingsDebounced));
});

loadSettings();

const TEMPLATES_KEY = "clipperStudio.templates";

function loadTemplates() {
  try {
    return JSON.parse(localStorage.getItem(TEMPLATES_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveTemplates(templates) {
  try {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
  } catch {}
}

function applyTemplateData(data) {
  if (Number(data.fps)) state.fps = Number(data.fps);
  if (Number(data.crf)) state.crf = Number(data.crf);
  if (Number(data.audioBitrate)) state.audioBitrate = Number(data.audioBitrate);
  if (typeof data.watermark === "string") state.watermark = data.watermark;
  if (["tl", "tr", "bl", "br"].includes(data.watermarkPosition)) state.watermarkPosition = data.watermarkPosition;
  if (data.watermarkOpacity != null) state.watermarkOpacity = Number(data.watermarkOpacity);
  if (Array.isArray(data.exportRatios)) {
    const valid = data.exportRatios.filter((r) => ["portrait", "wide", "four5"].includes(r));
    if (valid.length) state.exportRatios = valid;
  }  if (data.captionPosition != null) state.captionPosition = Number(data.captionPosition);
  state.speakerCut = !!data.speakerCut;
  state.faceTrack = !!data.faceTrack;

  state.speakerCut = !!data.speakerCut;
  state.faceTrack = !!data.faceTrack;

  state.speakerCut = !!data.speakerCut;
  state.faceTrack = !!data.faceTrack;


  $("#fpsSelect").value = String(state.fps);
  $("#qualitySelect").value = String(state.crf);
  $("#audioBitrateSelect").value = String(state.audioBitrate);
  $("#watermarkText").value = state.watermark;
  $("#watermarkPosition").value = state.watermarkPosition;
  $("#watermarkOpacity").value = String(Math.round(state.watermarkOpacity * 100));
  $$(".export-ratio-chk").forEach((el) => { el.checked = state.exportRatios.includes(el.dataset.ratio); });
  if ($("#captionStyleSelect")) $("#captionStyleSelect").value = data.captionStyle || "bold";
  if (Number(data.captionSize)) captionSize.value = String(data.captionSize);
  captionPosition.value = String(Math.round((state.captionPosition || 0.76) * 100));
}

function renderTemplateOptions() {
  const select = $("#templateSelect");
  select.innerHTML = '<option value="__default">Pilih template...</option>';
  Object.entries(loadTemplates()).forEach(([name]) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  });
}

$("#saveTemplateBtn").addEventListener("click", () => {
  const name = window.prompt("Nama template:", "My template");
  if (!name || !name.trim()) return;
  const trimmed = name.trim();
  const templates = loadTemplates();
  templates[trimmed] = collectSettings();
  saveTemplates(templates);
  renderTemplateOptions();
  $("#templateSelect").value = trimmed;
  showToast(`Template "${trimmed}" disimpan.`);
});

$("#deleteTemplateBtn").addEventListener("click", () => {
  const name = $("#templateSelect").value;
  if (!name || name === "__default") return;
  const templates = loadTemplates();
  delete templates[name];
  saveTemplates(templates);
  renderTemplateOptions();
  $("#templateSelect").value = "__default";
  showToast(`Template "${name}" dihapus.`);
});

$("#templateSelect").addEventListener("change", (e) => {
  const name = e.target.value;
  if (!name || name === "__default") return;
  const templates = loadTemplates();
  const data = templates[name];
  if (data) {
    applyTemplateData(data);
    saveSettings();
    showToast(`Template "${name}" diterapkan.`);
  }
});

renderTemplateOptions();
renderClips();
selectClip(clips[0]);
loadProjects();
loadExports();
setRatio(currentRatio());
refreshStorage();
pollQueue();
loadEngineCompute();
syncUndoRedoButtons();
const analyzeSpeakerBtn = document.getElementById("analyzeSpeakerBtn");
if (analyzeSpeakerBtn) analyzeSpeakerBtn.addEventListener("click", analyzeSpeakerForClip);
const downloadModelBtn = document.getElementById("downloadModelBtn");
if (downloadModelBtn) downloadModelBtn.addEventListener("click", downloadLocalAIModel);
loadLocalAIStatus();
setInterval(pollQueue, 5000);
setInterval(loadEngineCompute, 15000);
setInterval(loadLocalAIStatus, 30000);
