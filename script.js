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
  localUploadPromise: null,
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
  fps: 30,
  crf: 18,
  audioBitrate: 128,
  sourceDuration: 0,
  history: [],
  historyIndex: -1,
  sttModel: "",
  facePreviewByClip: Object.create(null)
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
const cutToFacePreviewBadge = $("#cutToFacePreviewBadge");
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
  const style = effectiveCaptionStyle();
  captionBox.style.fontSize = `${captionPreviewFontPx()}px`;
  captionBox.className = "caption-box" + (style !== "off" ? ` lc-${style}` : "");
  // Sama dengan export: posisi diukur dari ATAS frame (baseY = H * position).
  applyCaptionPosition();
  applyCaptionVisuals();
  const hasText = captionBox.textContent && captionBox.textContent.replace(/"/g, "").trim();
  captionBox.style.display = style !== "off" && hasText ? "block" : "none";
}

// Master switch "Auto caption": mati => gaya efektif "off" di semua jalur
// (preview, live overlay, export burn) dan generate caption nonaktif.
function autoCaptionEnabled() {
  const el = $("#autoCaptionToggle");
  return !el || el.checked;
}

function effectiveCaptionStyle() {
  return autoCaptionEnabled()
    ? (($("#captionStyleSelect") && $("#captionStyleSelect").value) || "bold")
    : "off";
}

function generationMode() {
  const active = $("#genModeSegmented button.active");
  return (active && active.dataset.genmode) || "ai";
}

function durationSettingsPayload() {
  const gm = generationMode();
  const ceilEl = $("#maxCeilingInput");
  const ceiling = Math.max(15, Math.min(180, Number(ceilEl && ceilEl.value) || 90));
  const base = {
    maxClips: Number(($("#maxClipsSelect") && $("#maxClipsSelect").value) || 6) || 6,
    hookStrategy: ($("#hookStrategySelect") && $("#hookStrategySelect").value) || "balanced",
    focus: ($("#focusInput") && $("#focusInput").value.trim()) || "",
    genMode: gm
  };
  if (gm === "manual") return { durationMode: "FIXED", fixedDuration: ceiling, ...base };
  if (gm === "hybrid") return { durationMode: "AUTO", fixedDuration: 0, maxDuration: ceiling, ...base };
  return { durationMode: "AUTO", fixedDuration: 0, ...base };
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
    // BUG FIX: Deep copy words array to prevent reference pollution during Undo/Redo
    state.liveSegments = (state.captionByClip[captionTimelineKey()] || []).map((s) => ({ ...s, words: Array.isArray(s.words) ? s.words.slice() : [] }));
    state.captionSegments = state.liveSegments.map(s => ({...s, words: Array.isArray(s.words) ? s.words.slice() : []}));
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
  markStudioDirty();
  syncTrimInputs();
  clipTime.textContent = clipRange(clip);
  $("#clipRange").textContent = clipRange(clip);
  renderClips(state.sorted ? [...clips].sort((a, b) => (b.score || -1) - (a.score || -1)) : clips);
  state.previewClipKey = "";
  resetPreviewFaceTransform();
  updateFinalPreviewStrip();
  if (state.sourceUrl && Number.isFinite(clip.start)) previewVideo.currentTime = clip.start;
  showToast(`Clip dipangkas: ${formatTime(start)} - ${formatTime(end)}`);
}

const RATIO_PRESETS = ["portrait", "square", "wide", "four5"];

function setRatio(token) {
  const ratio = RATIO_PRESETS.includes(token) ? token : "portrait";
  previewFrame.classList.remove("portrait", "square", "wide", "four5");
  previewFrame.classList.add(ratio);
  previewFrame.dataset.layout = ratio;
  // Sync semua pilihan rasio (preview panel + create workspace) — satu sumber.
  $$(".segmented button[data-ratio]").forEach((item) => {
    item.classList.toggle("active", item.dataset.ratio === ratio);
  });
  $$(".segmented button[data-cratio]").forEach((item) => {
    item.classList.toggle("active", item.dataset.cratio === ratio);
  });
  updatePreviewFaceTransform();
  updateFinalPreviewStrip();
}

function currentRatio() {
  if (previewFrame.classList.contains("wide")) return "wide";
  if (previewFrame.classList.contains("four5")) return "four5";
  return "portrait";
}

function facePreviewKey(clip = state.activeClip) {
  if (!clip || !state.projectId) return "";
  const startMs = Math.round((Number(clip.start) || 0) * 1000);
  const endMs = Math.round((Number(clip.end) || 0) * 1000);
  return `${state.projectId}:${clip.id}:${startMs}:${endMs}`;
}

function cutToFacePreviewEnabled() {
  return Boolean(document.getElementById("speakerCutToggle")?.checked);
}

function previewUsesClipRelativeMedia() {
  const source = String(previewVideo.currentSrc || previewVideo.src || "");
  return Boolean(state.youtubeUrl) || /\/sections\//.test(source);
}

function resetPreviewFaceTransform() {
  const alreadyReset = !previewFrame.classList.contains("cut-to-face-active")
    && !previewVideo.style.transform
    && !cutToFacePreviewBadge?.classList.contains("visible");
  if (alreadyReset) return;
  previewVideo.style.transition = "none";
  previewFrame.classList.remove("cut-to-face-active");
  previewVideo.style.removeProperty("transform");
  void previewVideo.offsetWidth;
  previewVideo.style.removeProperty("transition");
  if (cutToFacePreviewBadge) {
    cutToFacePreviewBadge.textContent = "";
    cutToFacePreviewBadge.classList.remove("visible");
  }
}

function registerFacePreviewAnalysis(key, data) {
  if (!key || !data || !window.ClipmeCutToFace) return;
  const source = data.source || {};
  const sourceWidth = Math.max(1, Number(source.width || data.sourceWidth || previewVideo.videoWidth || 1));
  const sourceHeight = Math.max(1, Number(source.height || data.sourceHeight || previewVideo.videoHeight || 1));
  state.facePreviewByClip[key] = {
    associations: Array.isArray(data.associations) ? data.associations : [],
    sourceWidth,
    sourceHeight,
    timeline: source.timeline || "clip",
    preparedRatio: "",
    preparedAssociations: []
  };
}

function updatePreviewFaceTransform() {
  const engine = window.ClipmeCutToFace;
  const analysis = state.facePreviewByClip[facePreviewKey()];
  if (!engine || !cutToFacePreviewEnabled() || !analysis || !analysis.associations.length) {
    resetPreviewFaceTransform();
    return;
  }

  const ratio = currentRatio();
  if (analysis.preparedRatio !== ratio) {
    analysis.preparedRatio = ratio;
    analysis.preparedAssociations = engine.prepareAssociations(
      analysis.associations,
      analysis.sourceWidth,
      analysis.sourceHeight,
      engine.ratioValue(ratio)
    );
  }
  if (!analysis.preparedAssociations.length) {
    resetPreviewFaceTransform();
    return;
  }

  const mediaTime = Number(previewVideo.currentTime) || 0;
  const clipStart = Number(state.activeClip && state.activeClip.start) || 0;
  const timelineSeconds = analysis.timeline === "source"
    ? mediaTime
    : mediaTime - (previewUsesClipRelativeMedia() ? 0 : clipStart);
  const active = timelineSeconds >= 0
    ? engine.findActiveAssociation(analysis.preparedAssociations, timelineSeconds * 1000)
    : null;
  const crop = active
    ? active.crop
    : engine.centerCrop(analysis.sourceWidth, analysis.sourceHeight, engine.ratioValue(ratio));
  const transform = engine.cropTransform(
    crop,
    analysis.sourceWidth,
    analysis.sourceHeight,
    previewFrame.clientWidth,
    previewFrame.clientHeight
  );

  if (!previewFrame.classList.contains("cut-to-face-active")) {
    // Prime with the same center crop as object-fit: cover before animating to
    // the face. This prevents a one-frame stretched flash on first activation.
    const centerTransform = engine.cropTransform(
      engine.centerCrop(analysis.sourceWidth, analysis.sourceHeight, engine.ratioValue(ratio)),
      analysis.sourceWidth,
      analysis.sourceHeight,
      previewFrame.clientWidth,
      previewFrame.clientHeight
    );
    previewVideo.style.transition = "none";
    previewFrame.classList.add("cut-to-face-active");
    previewVideo.style.transform = centerTransform.css;
    void previewVideo.offsetWidth;
    previewVideo.style.removeProperty("transition");
  }
  previewVideo.style.transform = transform.css;
  if (cutToFacePreviewBadge) {
    const speaker = active && active.speaker_id ? ` · ${active.speaker_id}` : " · CENTER";
    cutToFacePreviewBadge.textContent = `CUT-TO-FACE${speaker}`;
    cutToFacePreviewBadge.classList.add("visible");
  }
}

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
  resetPreviewFaceTransform();
}

function setActiveClipOrEmpty(clip) {
  if (clip) selectClip(clip);
  else renderEmptyClips();
}

function activeClipKey() {
  if (!state.activeClip) return "";
  return `${state.projectId}:${state.activeClip.id}:${state.activeClip.start}:${state.activeClip.end}`;
}

// FIX: source preview berupa section terpotong (/sections/...) — waktunya
// relatif terhadap clip (0..durasi), bukan absolut terhadap video sumber.
function sourceIsBoundedSection(url) {
  return /\/sections\//.test(String(url || state.sourceUrl || ""));
}

// Thumbnail clip via ffmpeg server-side (cache disk) — dipakai Studio & Results.
function thumbUrlFor(projectId, clipId) {
  return `/api/thumb/${projectId}/${clipId}`;
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
    if (state.projectId) {
      const img = document.createElement("img");
      img.loading = "lazy";
      img.alt = "";
      img.src = thumbUrlFor(state.projectId, clip.id);
      img.addEventListener("error", () => img.remove());
      thumb.appendChild(img);
      thumb.classList.add("has-img");
    }
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
  // Sinkronkan preview dengan timeline: kalau clip ini sudah punya segmen
  // caption di cache (captionByClip), pulihkan liveSegments + overlay langsung
  // supaya preview tidak tertinggal bahasa lama (mis. Inggris) saat timeline
  // sudah berubah (Indonesia). Kalau belum ada cache, kosongkan segmen live
  // agar caption clip sebelumnya tidak bocor ke clip baru.
  const cachedSegments = state.captionByClip[captionTimelineKey()];
  if (Array.isArray(cachedSegments) && cachedSegments.length) {
    state.captionSegments = cachedSegments.map((s) => ({ ...s, words: Array.isArray(s.words) ? s.words.slice() : [] }));
    state.liveSegments = state.captionSegments.map((s) => ({ ...s, words: Array.isArray(s.words) ? s.words.slice() : [] }));
    state.captionLoadedFor = captionTimelineKey();
    state.liveOffset = (state.youtubeUrl || sourceIsBoundedSection()) ? 0 : (Number(clip.start) || 0);
    captionTimelinePanel.style.display = "block";
    loadCaptionTimeline(state.liveSegments);
    // Static box juga ikut bahasa segmen (bukan clip.caption lama yang asing).
    const combined = state.captionSegments.map((s) => s.text).join(" ").trim().slice(0, 155);
    if (combined) {
      captionBox.textContent = `"${combined}"`;
      captionInput.value = combined;
    }
  } else {
    state.captionSegments = [];
    state.liveSegments = [];
    state.captionLoadedFor = captionTimelineKey();
    captionTimelinePanel.style.display = "none";
  }
  const translateFromSel = $("#translateFrom");
  if (translateFromSel && translateFromSel.value !== "auto") translateFromSel.value = "auto";
  liveCaption.innerHTML = "";
  liveCaption.style.display = "none";
  previewTitle.textContent = `Clip ${String(clip.id).padStart(2, "0")} - ${clip.title}`;
  // Kalau segmen cache sudah tersedia (bahasa target), JANGAN timpa static
  // box dengan clip.caption lama (bahasa asing). clip.caption hanya dipakai
  // saat clip belum punya segmen caption.
  if (!(Array.isArray(cachedSegments) && cachedSegments.length)) {
    captionBox.textContent = `"${clip.caption}"`;
    captionInput.value = clip.caption;
  }
  renderStaticCaption();
  hookInput.value = clip.hook;
  clipTime.textContent = clipRange(clip);
  $("#clipScore").textContent = clip.score != null && !clip.placeholder ? `${clip.score}%` : "--";
  $("#clipDuration").textContent = clipRange(clip);
  syncTrimInputs();

  if (state.sourceUrl && Number.isFinite(clip.start)) {
    previewVideo.currentTime = clip.start;
  }

  renderClips(state.sorted ? [...clips].sort((a, b) => (b.score || -1) - (a.score || -1)) : clips);
  syncTrimHandles();
  updatePreviewFaceTransform();
  updateFinalPreviewStrip();
  renderClipSuggestions();
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
  try {
    const response = await fetch("/api/queue");
    const data = await response.json();
    const jobs = Array.isArray(data.jobs) ? data.jobs : [];
    updateEngineStatus(jobs);
    renderActiveJobs(jobs);
    for (const el of [$("#queueList"), $("#procQueueList")].filter(Boolean)) {
      renderQueueInto(el, jobs);
    }
  } catch {}
}

function renderQueueInto(el, jobs) {
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
    name.textContent = JOB_LABELS[job.type] || job.type;
    name.title = `Job ${job.id.slice(0, 8)}…`;
    const meta = document.createElement("span");
    meta.textContent = `${job.progress || 0}%${job.stage ? ` - ${job.stage}` : ""}`;
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
}

// Dashboard — kartu ACTIVE PROCESSING dari data /api/queue nyata.
function renderActiveJobs(jobs) {
  const wrap = document.getElementById("dashActiveJobs");
  const count = document.getElementById("dashActiveCount");
  if (!wrap) return;
  const live = (jobs || []).filter((j) => j.status === "running" || j.status === "queued");
  if (count) count.textContent = String(live.length);
  if (!live.length) {
    wrap.innerHTML = '<div class="empty-state">NO ACTIVE JOBS &mdash; start a new project to begin clipping.</div>';
    return;
  }
  wrap.innerHTML = "";
  for (const job of live) {
    const isOwn = processingState.jobId === job.id && processingState.label;
    const label = isOwn ? processingState.label : (JOB_LABELS[job.type] || job.type);

    const row = document.createElement("div");
    row.className = "dj-row";

    const main = document.createElement("div");
    main.className = "dj-main";
    const nameEl = document.createElement("strong");
    nameEl.textContent = label;
    const sub = document.createElement("span");
    sub.textContent = job.stage || `${job.status}…`;
    main.appendChild(nameEl);
    main.appendChild(sub);
    row.appendChild(main);

    const bar = document.createElement("div");
    bar.className = "dj-bar";
    const fill = document.createElement("span");
    fill.style.width = `${Math.min(100, Number(job.progress) || 0)}%`;
    bar.appendChild(fill);
    row.appendChild(bar);

    const pct = document.createElement("span");
    pct.className = "dj-pct";
    pct.textContent = `${job.progress || 0}%`;
    row.appendChild(pct);

    const viewBtn = document.createElement("button");
    viewBtn.type = "button";
    viewBtn.className = "secondary-button compact";
    viewBtn.textContent = "VIEW JOB";
    viewBtn.addEventListener("click", () => openProcessingForJob(job.id, label));
    row.appendChild(viewBtn);

    wrap.appendChild(row);
  }
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
    setEngineVal("engineRuntime", mode, mode === "GPU" ? "busy" : "ok", rt.reason || "");

    const cpuLabel = cpu.model
      ? `${cpu.model}${cpu.cores ? ` · ${cpu.cores} core` : ""}`.slice(0, 42)
      : "✓ Available";
    setEngineVal("engineCpu", cpuLabel, "ok", `CPU: ${cpu.model || "?"} (${cpu.cores || "?"} core)`);

    if (gpu.present) {
      const gpuLabel = `${gpu.name}${gpu.vramGb ? ` · ${gpu.vramGb} GB` : ""}`.slice(0, 42);
      const gpuCls = cuda.available ? "ok" : "busy";
      const gpuTitle = cuda.available
        ? `${gpu.name} — CUDA ✓ (${cuda.deviceCount} device)`
        : `${gpu.name} terdeteksi, tapi Python runtime tidak punya CUDA — fallback CPU`;
      setEngineVal("engineGpu", gpuLabel, gpuCls, gpuTitle);
    } else {
      setEngineVal("engineGpu", "— Not detected", "idle", "Tidak ada GPU terdeteksi — mode CPU");
    }

    const accelParts = [];
    if (String(rt.sttDevice || "") === "cuda") accelParts.push("STT: GPU");
    else if (String(rt.sttDevice || "") === "auto") accelParts.push("STT: AUTO");
    else accelParts.push("STT: CPU");
    accelParts.push(`ENC: ${nvenc.available ? "NVENC" : "CPU"}`);
    setEngineVal("engineAccel", accelParts.join(" · "), rt.gpuUsed ? "busy" : "ok", rt.reason || accel.reason || "");
  } catch {
    setEngineVal("engineRuntime", "OFFLINE", "idle");
    setEngineVal("engineCpu", "—", "idle");
    setEngineVal("engineGpu", "—", "idle");
    setEngineVal("engineAccel", "—", "idle");
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

  const requestedProjectId = state.projectId;
  const requestedClip = {
    id: state.activeClip.id,
    start: Number(state.activeClip.start) || 0,
    end: Number(state.activeClip.end) || 0
  };
  const requestedKey = facePreviewKey(state.activeClip);
  const requestedRatio = currentRatio();
  const speakerToggle = document.getElementById("speakerCutToggle");
  if (speakerToggle && !speakerToggle.checked) {
    speakerToggle.checked = true;
    saveSettings();
  }

  btn.disabled = true;
  const oldLabel = btn.textContent;
  btn.textContent = "Analyzing…";
  if (meta) meta.innerHTML = "Analyzing speaker + face...<br><i>(bisa memakan waktu tergantung durasi video & GPU)</i>";
  try {
    const res = await fetch("/api/localai/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: requestedProjectId,
        clipId: requestedClip.id,
        start: requestedClip.start,
        end: requestedClip.end,
        sampleFps: 3,
        minSegmentMs: 300,
        noiseDb: -35,
        speakerCut: true,
        faceTrack: !!document.getElementById("faceTrackToggle")?.checked,
    reframe: !!document.getElementById("reframeToggle")?.checked,
        sourceW: previewVideo.videoWidth || 0,
        sourceH: previewVideo.videoHeight || 0,
        targetAspect: window.ClipmeCutToFace
          ? window.ClipmeCutToFace.ratioValue(requestedRatio)
          : 9 / 16
      })
    });
    let data = await res.json();
    if (!res.ok && res.status !== 202) throw new Error(data.error || "Analyze gagal");
    if (res.status === 202) {
      if (!data.jobId) throw new Error("Server tidak mengembalikan job analisis.");
      if (meta) meta.textContent = "Cut-to-Face sedang dianalisis di background…";
      data = await waitForJob(data.jobId);
    }
    if (!data) throw new Error("Hasil analisis kosong.");

    localAiState.lastTimeline = data.speakerTimeline;
    localAiState.lastAnalysisAtMs = Date.now();
    registerFacePreviewAnalysis(requestedKey, data);
    if (facePreviewKey() === requestedKey) updatePreviewFaceTransform();

    const segCount = (data.speakerTimeline && data.speakerTimeline.segments || []).length;
    const totalDur = (data.speakerTimeline && data.speakerTimeline.total_duration_ms) || 0;
    const faceCount = (data.faceTimeline && !data.faceTimeline.skipped) ? (data.faceTimeline.frames || []).length : 0;
    const associationCount = Array.isArray(data.associations) ? data.associations.length : 0;
    const backendSrc = (data.summary && data.summary.backend && data.summary.backend.speaker) || "energy";

    let dbgHtml = `<b>Speaker analysis:</b> ${segCount} segments (${(totalDur / 1000).toFixed(1)}s via ${backendSrc}).<br>`;
    dbgHtml += `<b>Face frames:</b> ${faceCount}<br>`;

    if (associationCount > 0) {
      dbgHtml += `<br><b>CSS Cut-to-Face preview aktif (${associationCount} cuts, max 48):</b><br>`;
      data.associations.forEach((a) => {
        const s = (a.start_ms / 1000).toFixed(1);
        const e = (a.end_ms / 1000).toFixed(1);
        const confidence = Number(a.face && a.face.confidence);
        const confidenceText = Number.isFinite(confidence) ? confidence.toFixed(2) : "-";
        const trackId = a.track_id != null ? a.track_id : (a.face && a.face.track_id != null ? a.face.track_id : null);
        const trackText = trackId != null && trackId >= 0 ? `track #${trackId}` : "no-track";
        const mouth = Number(a.mouth_motion != null ? a.mouth_motion : (a.face && a.face.mouth_motion));
        const mouthText = Number.isFinite(mouth) && mouth > 0 ? mouth.toFixed(2) : "-";
        dbgHtml += `<div style="font-family: monospace; font-size: 9px; padding: 2px 0;">[${s}s - ${e}s] ${a.speaker_id || "speaker"} → Face {x:${a.face?.x ?? "-"}, y:${a.face?.y ?? "-"}, conf:${confidenceText}, ${trackText}, mouth:${mouthText}}</div>`;
      });
      // Active-track + mouth-motion summary (requirement 13)
      const tracked = data.associations.filter((a) => a.track_id != null && a.track_id >= 0);
      const avgMouth = tracked.length
        ? (tracked.reduce((sum, a) => sum + (Number(a.mouth_motion) || 0), 0) / tracked.length)
        : 0;
      dbgHtml += `<br><b>Active track:</b> ${tracked.length ? `${tracked.length} association(s) dengan track_id` : "n/a"} · <b>Avg mouth-motion:</b> ${avgMouth > 0 ? avgMouth.toFixed(2) : "n/a"}`;
    } else {
      dbgHtml += "<br><b>Cut-to-Face:</b> wajah aktif belum ditemukan; preview tetap center-crop.";
    }

    if (meta) meta.innerHTML = dbgHtml;
    uploadStatus.textContent = `${clips.length} clips ready`;
    showToast(associationCount
      ? `Cut-to-Face aktif: ${associationCount} perpindahan siap dipreview.`
      : "Analisis selesai, tetapi tidak ada wajah yang bisa diikuti.");
  } catch (e) {
    if (meta) meta.textContent = `Error: ${e.message || "Analyze gagal"}`;
    resetPreviewFaceTransform();
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
      _ts: Number(p.createdAt) || 0,
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
      size: e.size,
      _ts: Number(e.createdAt) || 0,
      clipId: e.clipId != null ? Number(e.clipId) : null,
      project: e.project || "",
      hook: e.hook || "",
      caption: e.caption || "",
      ratio: e.ratio || ""
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
  const prevPanel = document.querySelector(".app-view.active");
  $$(".app-view").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.viewPanel === view);
  });
  if (prevPanel && prevPanel.dataset.viewPanel === "captions" && view !== "captions") capPlayStop();
  $$(".nav-item").forEach((item) => {
    const active = item.dataset.view === view;
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  const backBtn = document.getElementById("backToResultsBtn");
  if (backBtn) backBtn.hidden = !(view === "studio" && resultsState.projectId);
  const saveBtn = document.getElementById("saveProjectBtn");
  if (saveBtn) saveBtn.hidden = !(view === "studio" && state.projectId);
  if (view === "captions") {
    const capPanel = document.getElementById("captionTimelinePanel");
    if (capPanel && state.projectId) capPanel.style.display = "";
    renderCaptionsWorkspace();
  }
  if (view === "settings") fillSettingsView();
}

// Pindahkan panel eksisting ke workspace barunya (node move — ID/listener utuh).
function mountWorkspaces() {
  const uploadPanel = document.querySelector(".upload-panel");
  const npMount = document.getElementById("npMount");
  if (uploadPanel && npMount && uploadPanel.parentElement !== npMount) npMount.appendChild(uploadPanel);
  const capPanel = document.getElementById("captionTimelinePanel");
  const capMount = document.getElementById("capTimelineMount");
  if (capPanel && capMount && capPanel.parentElement !== capMount) capMount.appendChild(capPanel);
  // Studio preview dipindah ke RESULTS — studio murni editor teks (tanpa video).
  // ID semua tetap, jadi tidak ada regresi; preview utama ada di Results + Captions.
  const previewPanel = document.querySelector(".preview-panel");
  const resVideoMount = document.getElementById("resVideoMount");
  if (previewPanel && resVideoMount && previewPanel.parentElement !== resVideoMount) {
    resVideoMount.appendChild(previewPanel);
  }
  // SEMUA kontrol auto-caption terkonsolidasi di Caption Workspace.
  const controlsMount = document.getElementById("capControlsMount");
  if (controlsMount) {
    for (const id of ["captionStyleSelect", "captionFontSelect", "captionColor", "captionSize", "captionPosition"]) {
      const el = document.getElementById(id);
      if (!el || el.parentElement === controlsMount) continue;
      const prev = el.previousElementSibling;
      const label = prev && prev.nodeType === 1 && prev.classList && prev.classList.contains("field-label")
        ? prev : null;
      if (label) controlsMount.appendChild(label);
      controlsMount.appendChild(el);
      if (id === "captionPosition") {
        const presets = document.querySelector(".pos-presets");
        if (presets) controlsMount.appendChild(presets);
      }
    }
    const act = document.getElementById("autoCaptionToggle");
    const slotAct = document.getElementById("slotAutoCaption");
    if (act) slotAct.appendChild(act.closest("label") || act); else if (slotAct) slotAct.remove();
    const filler = document.getElementById("fillerModeSelect");
    const slotFiller = document.getElementById("slotFiller");
    if (filler) {
      const fp = filler.previousElementSibling;
      const flabel = filler.closest(".cap-slot") ? null : (fp && fp.nodeType === 1 && fp.classList && fp.classList.contains("field-label") ? fp : null);
      if (flabel) controlsMount.appendChild(flabel);
      controlsMount.appendChild(filler);
    } else if (slotFiller) slotFiller.remove();
    const grid = document.getElementById("createCapConfig");
    if (grid && !grid.querySelector("input,select")) grid.remove();
  }
}

function setLocalPreview(file) {
  if (state.sourceUrl) URL.revokeObjectURL(state.sourceUrl);
  state.facePreviewByClip = Object.create(null);
  resetPreviewFaceTransform();
  state.sourceUrl = URL.createObjectURL(file);
  state.sourceName = file.name.replace(/\.[^.]+$/, "");
  previewVideo.src = state.sourceUrl;
  previewVideo.controls = true;
  previewFrame.classList.add("has-video");
}

async function uploadToBackend(file) {
  const form = new FormData();
  form.append("video", file);
  form.append("durationMode", durationSettingsPayload().durationMode);
  if (durationSettingsPayload().durationMode === "FIXED") {
    form.append("fixedDuration", durationSettingsPayload().fixedDuration);
  }

  uploadStatus.textContent = "Uploading";
  $("#generateButton").disabled = true;
  showJobProgress("Mengunggah video", { indeterminate: true });

  // FIX: `data` harus di scope fungsi — dipakai lagi SETELAH blok try.
  // Sebelumnya const di dalam try membuat ReferenceError setelah upload SUKSES,
  // sehingga projectId tak pernah terisi & dropzone salah ditandai gagal.
  let data;
  try {
    const response = await fetch("/api/upload", {
      method: "POST",
      body: form
    });

    data = await response.json();
    if (!response.ok) throw new Error(data.error || "Upload gagal.");
    setJobProgress(100, `${data.probe ? formatTime(data.probe.duration) : ""} - metadata siap`);
    settleJobProgress("success", `${Array.isArray(data.clips) ? data.clips.length : 0} clip placeholder dibuat`);
  } catch (err) {
    settleJobProgress("error", err.message);
    throw err;
  }

  state.projectId = data.id;
  // FIX: reset state turunan YouTube dari sesi sebelumnya — kalau tidak,
  // noDownload=true membuat play video lokal masuk jalur preview tanpa batas.
  state.noDownload = false;
  state.youtubeUrl = "";
  clips = Array.isArray(data.clips) ? data.clips : [];
  state.sourceDuration = data.probe && data.probe.duration;
  state.sorted = false;
  setActiveClipOrEmpty(clips[0]);

  $("#fileTitle").textContent = data.name;
  $("#fileMeta").textContent = `${formatTime(data.probe.duration)} - ${data.probe.width}x${data.probe.height} - ${data.probe.codec}`;
  fillSourceInfo(data.name, data.probe);
  await applyProjectNamePatch(data.id);
  uploadStatus.textContent = `${clips.length} clips ready`;
  showToast(`${clips.length} clip dibuat. Klik "Analyze Hook Viral" untuk analisis lengkap.`);

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
  state.facePreviewByClip = Object.create(null);
  resetPreviewFaceTransform();
  // Project library (bukan drop baru) — hapus indikator file di dropzone.
  markDropzone("");
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

  // FIX: jangan duplikasi entri library saat project yang sudah ada dibuka lagi,
  // dan pastikan tombol generate aktif (bisa saja ter-disable dari alur sebelumnya).
  state.projects = state.projects.filter((p) => p.id !== data.id);
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
  $("#generateButton").disabled = false;
  applyCreateConfig(data.createConfig);
}

// Terapkan konfigurasi create yang tersimpan di manifest saat project dibuka ulang.
function applyCreateConfig(cfg) {
  if (!cfg || typeof cfg !== "object") return;
  try {
    if (cfg.genMode) {
      $$("#genModeSegmented button").forEach((b) => b.classList.toggle("active", b.dataset.genmode === cfg.genMode));
      const label = document.getElementById("maxCeilingLabel");
      if (label) label.textContent = generationMode() === "manual" ? "Fixed duration (detik)" : "Max clip duration (detik)";
    }
    if (Number(cfg.maxDuration)) { const el = $("#maxCeilingInput"); if (el) el.value = String(Number(cfg.maxDuration)); }
    if (Number(cfg.maxClips)) { const el = $("#maxClipsSelect"); if (el) el.value = String(Number(cfg.maxClips)); }
    if (cfg.hookStrategy) { const el = $("#hookStrategySelect"); if (el) el.value = cfg.hookStrategy; }
    if (typeof cfg.focus === "string") { const el = $("#focusInput"); if (el) el.value = cfg.focus; }
    if (cfg.ratio && RATIO_PRESETS.includes(cfg.ratio)) setRatio(cfg.ratio);
    if (cfg.captionTemplateId) {
      state.captionTemplateId = cfg.captionTemplateId;
      const tpl = window.ClipmeCaptionTemplates && window.ClipmeCaptionTemplates.getById(cfg.captionTemplateId);
      if (tpl) applyCaptionTemplate(tpl, { previewOnly: true });
    }
  } catch {}
}

// ── Banner progres job di dashboard utama ──────────────────────────────────
const JOB_LABELS = {
  "upload-analyze": "Analisis hook viral",
  "localai-analyze": "Generate clips (AI lokal)",
  "export": "Export clip",
  "batch-export": "Export semua clip",
  "export-combined": "Menggabungkan clip"
};
const JOB_DONE = {
  "upload-analyze": "Analisis selesai",
  "localai-analyze": "Clips siap",
  "export": "Export selesai",
  "batch-export": "Semua clip ter-export",
  "export-combined": "Clip gabungan siap"
};

const jobProgress = {
  el: null, fill: null, pct: null, label: null, stage: null,
  lastPct: -1, hideTimer: 0
};

function jpRefs() {
  if (!jobProgress.el) {
    jobProgress.el = $("#jobProgress");
    jobProgress.fill = $("#jpFill");
    jobProgress.pct = $("#jpPct");
    jobProgress.label = $("#jpLabel");
    jobProgress.stage = $("#jpStage");
  }
  return jobProgress.el;
}

function showJobProgress(label, { indeterminate = false } = {}) {
  const el = jpRefs();
  if (!el) return;
  window.clearTimeout(jobProgress.hideTimer);
  el.hidden = false;
  el.classList.remove("leaving", "success", "error", "indeterminate");
  // Restart animasi entrance.
  el.classList.remove("enter");
  void el.offsetWidth;
  el.classList.add("enter");
  if (jobProgress.label) jobProgress.label.textContent = label || "Memproses";
  jobProgress.lastPct = -1;
  setJobProgress(0, "");
  if (indeterminate) el.classList.add("indeterminate");
}

function setJobProgress(pct, stage) {
  const el = jpRefs();
  if (!el || el.hidden) return;
  const clamped = Math.max(0, Math.min(100, Math.round(pct) || 0));
  if (clamped > 0) el.classList.remove("indeterminate");
  if (clamped !== jobProgress.lastPct && jobProgress.fill && jobProgress.pct) {
    jobProgress.fill.style.width = `${Math.max(clamped, 2)}%`;
    jobProgress.pct.textContent = `${clamped}%`;
    if (clamped > jobProgress.lastPct) {
      jobProgress.pct.classList.remove("pop");
      void jobProgress.pct.offsetWidth;
      jobProgress.pct.classList.add("pop");
    }
    jobProgress.lastPct = clamped;
  }
  if (jobProgress.stage && stage != null) jobProgress.stage.textContent = stage;
}

function settleJobProgress(mode, message) {
  const el = jpRefs();
  if (!el || el.hidden) return;
  el.classList.remove("indeterminate", "enter");
  if (mode === "success") {
    el.classList.add("success");
    setJobProgress(100, message || "Selesai");
  } else {
    el.classList.add("error");
    setJobProgress(jobProgress.lastPct < 0 ? 0 : jobProgress.lastPct, message || "Gagal");
  }
  jobProgress.hideTimer = window.setTimeout(() => {
    el.classList.add("leaving");
    window.setTimeout(() => {
      el.hidden = true;
      el.classList.remove("leaving", "success", "error");
      jobProgress.lastPct = -1;
      if (jobProgress.fill) jobProgress.fill.style.width = "0%";
      if (jobProgress.pct) jobProgress.pct.textContent = "0%";
    }, 340);
  }, mode === "success" ? 2300 : 3600);
}

async function waitForJob(jobId, opts = {}) {
  const startedAt = Date.now();
  const timeoutMs = 20 * 60 * 1000;
  let intervalMs = 1200;
  const maxIntervalMs = 5000;

  while (true) {
    if (Date.now() - startedAt >= timeoutMs) {
      settleJobProgress("error", "Timeout");
      throw new Error("Export tidak selesai dalam batas waktu. Coba lagi.");
    }

    const response = await fetch(`/api/jobs/${jobId}`);
    const job = await response.json();
    if (!response.ok) {
      // 404 = server restart / job dibersihkan: pesan pemulihan, bukan error generik.
      const msg = response.status === 404
        ? "Job hilang setelah aplikasi/server restart. Jalankan ulang analisis atau export."
        : (job.error || "Job tidak ditemukan.");
      settleJobProgress("error", msg);
      throw new Error(msg);
    }

    uploadStatus.textContent = `${job.status} ${job.progress}%`;
    const jpEl = jpRefs();
    if (jpEl && jpEl.hidden) showJobProgress(JOB_LABELS[job.type] || "Memproses");
    setJobProgress(job.progress, job.stage || "");
    if (typeof opts.onUpdate === "function") {
      try { opts.onUpdate(job); } catch {}
    }

    if (job.status === "done") {
      settleJobProgress("success", JOB_DONE[job.type] || "Selesai");
      return job.result;
    }
    if (job.status === "failed") {
      settleJobProgress("error", job.error || "Gagal");
      throw new Error(job.error || "Export gagal.");
    }
    if (job.status === "cancelled") {
      settleJobProgress("error", "Dibatalkan");
      throw new Error(job.error || "Export dibatalkan.");
    }

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

  // Validasi ringan sebelum kirim — tolak baris yang bukan link YouTube.
  const badLines = urls
    .map((u, i) => ({ u: u.trim(), line: i + 1 }))
    .filter(({ u }) => !/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(u));
  if (badLines.length) {
    showToast(`Baris tidak valid: ${badLines.map((b) => b.line).join(", ")} — gunakan link youtube.com atau youtu.be.`);
    return;
  }

  uploadStatus.textContent = "Analyzing";
  setProcessStep("metadata");
  renderClipSkeleton();
  $("#attachUrl").disabled = true;
  $("#generateButton").disabled = true;
  showJobProgress("Analyze YouTube", { indeterminate: true });

  try {
    if (urls.length === 1) {
      const response = await fetch("/api/youtube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: urls[0],
          language: CAPTION_LANG,
          assumedDuration: 3600,
          ...durationSettingsPayload()
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Download YouTube gagal.");
      setProcessStep("clips", ["metadata"]);
      loadProject(data);
      fillSourceInfo(data.name || state.sourceName, data.probe);
      await applyProjectNamePatch(data.id);
      setProcessStep("", ["metadata", "clips"]);
      settleJobProgress("success", `${clips.length} clip dibuat`);
      showToast(data.fastMode ? `${clips.length} clip dibuat instan. Preview akan mengambil section asli.` : `${clips.length} clip dibuat. ${data.transcriptStatus || "Transcript tidak ditemukan."}`);
      return;
    }

    showToast(`Memproses ${urls.length} URL...`);
    const response = await fetch("/api/youtube-bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        urls,
        language: CAPTION_LANG,
        assumedDuration: 3600,
        ...durationSettingsPayload()
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
    settleJobProgress("success", summary);
    if (failed.length) {
      showToast(`${summary}. ${failed.length} gagal (${failed[0].error || "error"}).`);
    } else {
      showToast(`${summary}. ${ok.length} project siap di Library.`);
    }
  } catch (error) {
    settleJobProgress("error", error.message);
    uploadStatus.textContent = "Failed";
    setProcessStep("");
    showToast(error.message);
  } finally {
    $("#attachUrl").disabled = false;
    $("#generateButton").disabled = false;
  }
}

// Indikator visual dropzone: video sudah masuk / sedang diunggah / gagal.
function formatDzSize(bytes) {
  const mb = Number(bytes) / (1024 * 1024);
  if (!Number.isFinite(mb) || mb <= 0) return "";
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

function markDropzone(mode, file) {
  const dz = $("#dropzone");
  if (!dz) return;
  if (!mode) {
    delete dz.dataset.state;
    const tag = $("#dzFileTag");
    if (tag) tag.hidden = true;
    return;
  }
  dz.dataset.state = mode;
  const tag = $("#dzFileTag");
  if (!tag) return;
  tag.hidden = false;
  // Restart animasi masuk tag.
  tag.style.animation = "none";
  void tag.offsetWidth;
  tag.style.animation = "";
  const nameEl = $("#dzFileName");
  const sizeEl = $("#dzFileSize");
  const checkEl = tag.querySelector(".dz-check");
  if (mode === "error") {
    if (nameEl) nameEl.textContent = file ? `${file.name} - gagal diunggah` : "Gagal diunggah";
    if (sizeEl) sizeEl.textContent = "coba lagi";
    if (checkEl) checkEl.textContent = "!";
  } else {
    if (nameEl) nameEl.textContent = file ? file.name : "video";
    if (sizeEl) sizeEl.textContent = mode === "uploading" ? "mengunggah..." : (formatDzSize(file && file.size) || "siap");
    if (checkEl) checkEl.textContent = "✓";
  }
}

// Inspeksi instan sisi klien: metadata nyata dari elemen <video> lokal
// (bukan tebakan). FPS & audio butuh ffprobe — ditampilkan "—" sampai
// probe server mengganti kartu ini setelah upload.
function inspectLocalVideo(file) {
  const card = document.getElementById("sourceInfoCard");
  if (!card || !file) return;
  const url = URL.createObjectURL(file);
  const localVideo = document.createElement("video");
  localVideo.preload = "metadata";
  localVideo.onloadedmetadata = () => {
    $("#siName").textContent = file.name;
    $("#siDuration").textContent = Number.isFinite(localVideo.duration)
      ? formatTime(localVideo.duration) : "—";
    $("#siRes").textContent = localVideo.videoWidth && localVideo.videoHeight
      ? `${localVideo.videoWidth} × ${localVideo.videoHeight}` : "—";
    $("#siFps").textContent = "—";
    $("#siAudio").textContent = "—";
    card.hidden = false;
    URL.revokeObjectURL(url);
  };
  localVideo.onerror = () => URL.revokeObjectURL(url);
  localVideo.src = url;
}

async function attachFile(file) {
  if (!file) return;

  if (!file.type.startsWith("video/")) {
    showToast("Pilih file video, misalnya MP4, MOV, MKV, atau WebM.");
    return;
  }

  markDropzone("uploading", file);
  inspectLocalVideo(file);
  try {
    setLocalPreview(file);
    const uploadPromise = uploadToBackend(file);
    // Diingat agar tombol Analyze bisa menunggu upload yang masih berjalan
    // (projectId baru terisi SETELAH request upload selesai).
    state.localUploadPromise = uploadPromise;
    await uploadPromise;
    markDropzone("loaded", file);
  } catch (error) {
    markDropzone("error", file);
    uploadStatus.textContent = "Failed";
    showToast(error.message);
  } finally {
    state.localUploadPromise = null;
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
  // FIX: source section (/sections/) relatif terhadap clip — mulai dari 0 dan
  // stop relatif; media penuh memakai waktu absolut. Tanpa ini, replay clip
  // YouTube/download & lokal men-seek di luar durasi section.
  const bounded = state.noDownload || sourceIsBoundedSection();
  previewVideo.currentTime = bounded ? 0 : state.activeClip.start;
  previewVideo.play();

  // Pastikan overlay live caption aktif saat play — selectClip mematikan
  // liveActive, jadi tanpa ini preview tidak pernah menampilkan segmen
  // (mis. hasil terjemahan) walau timeline sudah berubah bahasa.
  if (!state.liveActive && state.liveSegments && state.liveSegments.length && effectiveCaptionStyle() !== "off") {
    state.liveActive = true;
  }
  updateLiveCaption();

  state.loopTimer = window.setInterval(() => {
    const playingClip = state.activeClip;
    // Guard: clip aktif hilang diganti — jangan biarkan TypeError mematikan
    // pengecekan stop secara diam-diam (playback jalan tanpa batas).
    if (!playingClip) { previewVideo.pause(); window.clearInterval(state.loopTimer); return; }
    const stopAt = bounded ? playingClip.end - playingClip.start : playingClip.end;
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
  showJobProgress("Menyiapkan preview", { indeterminate: true });
  showToast("Mengambil potongan clip ringan untuk preview di aplikasi.");

  try {
    const requestedClip = state.activeClip;
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
        captionStyle: effectiveCaptionStyle(),
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

    // Race guard: user berpindah clip saat request berjalan — jangan menimpa
    // clip lain dengan caption/hook/status preview milik clip yang lama.
    if (state.activeClip !== requestedClip) {
      requestedClip.previewLoading = false;
      renderClips(state.sorted ? [...clips].sort((a, b) => (b.score || -1) - (a.score || -1)) : clips);
      settleJobProgress("success", "Ganti clip");
      return;
    }

    if (data.transcript?.caption || (data.segments && data.segments.length > 0)) {
      // Prioritize segments text over basic transcript caption to ensure translated version shows up
      const combinedCaption = data.segments && data.segments.length > 0 ? 
        data.segments.map(s => s.text).join(" ").trim().slice(0, 155) : 
        data.transcript?.caption;
        
      if (combinedCaption) {
          captionInput.value = combinedCaption;
          captionBox.textContent = `"${combinedCaption}"`;
          state.activeClip.caption = combinedCaption;
      }
      
      if (data.transcript?.hook) {
        hookInput.value = data.transcript.hook;
        state.activeClip.hook = data.transcript.hook;
      }
      
      renderStaticCaption();
      renderClips(state.sorted ? [...clips].sort((a, b) => (b.score || -1) - (a.score || -1)) : clips);
    }

    state.sourceUrl = data.previewUrl;
    state.previewClipKey = activeClipKey();
    state.activeClip.previewReady = true;
    state.activeClip.previewLoading = false;
    if (data.transcriptError) {
      console.warn("Preview transcript:", data.transcriptError);
    }
    
    // BUG FIX: Pastikan liveSegments selalu mengambil data TERBARU dari data.segments (yang sudah ter-translate jika berbeda)
    state.liveSegments = Array.isArray(data.segments) ? data.segments.map(s => ({...s, words: Array.isArray(s.words) ? s.words.slice() : []})) : [];
    // Force sinkronisasi ke captionSegments juga
    state.captionSegments = state.liveSegments.map(s => ({...s, words: Array.isArray(s.words) ? s.words.slice() : []}));
    state.captionByClip[captionTimelineKey()] = state.captionSegments.map(s => ({...s, words: Array.isArray(s.words) ? s.words.slice() : []}));
    
    state.liveActive = state.liveSegments.length > 0 && data.baked !== true && effectiveCaptionStyle() !== "off";
    // FIX: file section (/sections/) relatif terhadap clip — offset harus 0;
    // media penuh (/media/ atau blob) memakai start absolut.
    const sectionBounded = String(data.previewUrl || "").includes("/sections/");
    state.liveOffset = sectionBounded ? 0 : (state.activeClip ? Number(state.activeClip.start) || 0 : 0);
    previewVideo.src = data.previewUrl;
    previewVideo.controls = true;
    previewFrame.classList.add("has-video");
    previewVideo.currentTime = state.liveOffset;
    await previewVideo.play();
    // FIX: pasang timer stop — section (/sections/) relatif (end-start),
    // media penuh absolut (end). File section sendiri sudah membatasi durasi;
    // timer ini pengaman untuk fallback media penuh.
    window.clearInterval(state.loopTimer);
    const previewedClip = state.activeClip;
    state.loopTimer = window.setInterval(() => {
      if (!previewedClip || state.activeClip !== previewedClip) {
        window.clearInterval(state.loopTimer);
        return;
      }
      const stopAt = sectionBounded
        ? Number(previewedClip.end) - Number(previewedClip.start)
        : Number(previewedClip.end);
      if (previewVideo.currentTime >= stopAt) {
        previewVideo.pause();
        window.clearInterval(state.loopTimer);
      }
    }, 120);
    loadCaptionTimeline(state.liveSegments);
    uploadStatus.textContent = `${clips.length} clips ready`;
    setProcessStep("", ["metadata", "clips", "preview"]);
    settleJobProgress("success", "Preview siap");
  } catch (error) {
    settleJobProgress("error", error.message);
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
    const exportRatio = currentRatio();
    const basePayload = {
      projectId: state.projectId,
      clipId: state.activeClip.id,
      start: state.activeClip.start,
      end: state.activeClip.end,
      caption: captionInput.value,
      language: CAPTION_LANG,
      captionStyle: effectiveCaptionStyle(),
      captionSize: captionSize.value,
      fontFamily: captionFontSelect ? captionFontSelect.value : "Arial",
      captionColor: captionColorInput ? captionColorInput.value : "",
      captionPosition: state.captionPosition || 0.76,
      fps: Number(state.fps) || 0,
      crf: Number(state.crf) || 23,
      audioBitrate: Number(state.audioBitrate) || 128,
      speakerCut: !!document.getElementById("speakerCutToggle")?.checked,
      faceTrack: !!document.getElementById("faceTrackToggle")?.checked,
    reframe: !!document.getElementById("reframeToggle")?.checked,
      ratio: exportRatio,
      segments: exportSegments
    };
    let response;
    response = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(basePayload)
    });

    const data = await response.json();
    if (!response.ok && response.status !== 202) throw new Error(data.error || "Export gagal.");
    if (!data.jobId) throw new Error("Server tidak mengembalikan job export.");

    const result = await waitForJob(data.jobId);
    const results = Array.isArray(result.results) && result.results.length ? result.results : [result];
    const warnings = [];
    for (const item of results) {
      if (!item.downloadUrl) continue;
      if (Array.isArray(item.warnings)) warnings.push(...item.warnings);
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
    showToast(warnings.length
      ? `Export selesai. ${warnings.join(" ")}`
      : `Export selesai: ${results.length} file`);
  } catch (error) {
    showToast(error.message);
  } finally {
    state.isExporting = false;
    $("#exportButton").disabled = false;
    $("#exportButton").textContent = "Export selected clip";
  }
}

$("#videoInput").addEventListener("change", (event) => attachFile(event.target.files[0]));

// ---- Create workspace: satu pintu masuk — view studio (tanpa modal duplikat) ----
// newProjectBtn removed from topbar — sidebar is primary CTA

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
  showJobProgress("Generate clips", { indeterminate: true });
  try {
    persistCreateConfig();
    const response = await fetch(`/api/projects/${state.projectId}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(durationSettingsPayload())
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Gagal generate ulang clips.");
    clips = data.clips;
    setActiveClipOrEmpty(clips[0]);
    uploadStatus.textContent = `${clips.length} clips ready`;
    settleJobProgress("success", `${clips.length} clip dari transcript`);
    showToast(`${clips.length} clip dibuat dari transcript.`);
  } catch (err) {
    settleJobProgress("error", err.message);
    showToast(err.message);
    renderClips(clips);
  } finally {
    $("#generateButton").disabled = false;
  }
});

$("#playClip").addEventListener("click", playSelectedClip);

// Tombol "Analyze Hook Viral": analisis video AKTIF (lokal) via job — progres
// persen + tahap tampil di banner dashboard lewat waitForJob.
async function startHookAnalysis() {
  if (!state.projectId) {
    // Video sudah di-drop tapi request upload masih berjalan? Tunggu dulu —
    // jangan langsung menolak dengan "upload video dulu".
    if (state.localUploadPromise) {
      showToast("Upload masih berjalan - menunggu selesai dulu...");
      showJobProgress("Mengunggah video", { indeterminate: true });
      try {
        await state.localUploadPromise;
      } catch {
        return; // toast gagal sudah ditampilkan attachFile
      }
    } else {
      showToast("Upload video dulu sebelum analisis.");
      return;
    }
  }
  const btn = $("#analyzeHookBtn");
  if (btn.disabled) return;
  btn.disabled = true;
  const oldLabel = btn.textContent;
  btn.textContent = "Analyzing...";
  uploadStatus.textContent = "Analisis hook viral dimulai...";
  const label = state.sourceName || "Analysis";
  showJobProgress(JOB_LABELS["upload-analyze"], { indeterminate: true });
  try {
    persistCreateConfig();
    const response = await fetch(`/api/projects/${state.projectId}/analyze-hook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(durationSettingsPayload())
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Gagal memulai analisis.");
    enterProcessingView(data.jobId, label, startHookAnalysis, { projectId: state.projectId });
    const result = await waitForJob(data.jobId, { onUpdate: renderProcessingTick });
    completeProcessingView(result);
    const analyzed = result && Array.isArray(result.clips) ? result.clips : [];
    if (!analyzed.length) throw new Error((result && result.warning) || "Analisis tidak menghasilkan clip.");
    clips = analyzed;
    state.selectedClipIds = new Set();
    state.sorted = false;
    setActiveClipOrEmpty(clips[0]);
    uploadStatus.textContent = `${clips.length} clips ready`;
    showToast(`Analisis hook viral selesai: ${(result && result.transcriptStatus) || ""} - ${clips.length} clip.`);
    persistCreateConfig();
    openResultsForProject(state.projectId);
  } catch (err) {
    settleJobProgress("error", err.message);
    await failProcessingView(err);
    showToast(err.message);
    uploadStatus.textContent = "Failed";
  } finally {
    btn.disabled = false;
    btn.textContent = oldLabel;
  }
}

$("#analyzeHookBtn").addEventListener("click", () => startHookAnalysis());

// RE-RANK (#25-26): ranking ulang dari cache transkrip — tanpa STT.
$("#rerankBtn").addEventListener("click", async () => {
  const btn = $("#rerankBtn");
  if (!state.projectId) { showToast("Upload & analisis dulu sebelum re-rank."); return; }
  if (btn.disabled) return;
  btn.disabled = true;
  showJobProgress("Re-rank kandidat", { indeterminate: true });
  try {
    const response = await fetch(`/api/projects/${state.projectId}/rerank`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(durationSettingsPayload())
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Re-rank gagal.");
    clips = data.clips;
    state.selectedClipIds = new Set();
    state.sorted = false;
    setActiveClipOrEmpty(clips[0]);
    uploadStatus.textContent = `${clips.length} clips (re-ranked)`;
    settleJobProgress("success", `${data.intel ? data.intel.candidates + " kandidat -> " : ""}${clips.length} clip`);
    showToast(`Re-rank selesai${data.intel ? `: ${data.intel.candidates} kandidat` : ""}.`);
  } catch (err) {
    settleJobProgress("error", err.message);
    showToast(err.message || "Re-rank gagal.");
  } finally {
    btn.disabled = false;
  }
});


previewVideo.addEventListener("timeupdate", updateLiveCaption);
previewVideo.addEventListener("timeupdate", updatePreviewFaceTransform);
previewVideo.addEventListener("loadedmetadata", updatePreviewFaceTransform);
previewVideo.addEventListener("seeked", updatePreviewFaceTransform);
previewVideo.addEventListener("play", () => {
  if (state.liveActive) updateLiveCaption();
  updatePreviewFaceTransform();
});
previewVideo.addEventListener("pause", () => {
  if (state.liveActive) updateLiveCaption();
  updatePreviewFaceTransform();
});
previewVideo.addEventListener("ended", () => {
  liveCaption.innerHTML = "";
  liveCaption.style.display = "none";
  captionBox.style.display = "none";
});
previewVideo.addEventListener("seeked", () => { if (captionTimelinePanel && captionTimelinePanel.style.display !== "none") updateCaptionPlayhead(); });
previewVideo.addEventListener("timeupdate", () => { if (captionTimelinePanel && captionTimelinePanel.style.display !== "none") updateCaptionPlayhead(); });
// Caption Workspace: playhead timeline mengikuti player caption (capPreviewVideo).
const capPreviewVideoEl = document.getElementById("capPreviewVideo");
if (capPreviewVideoEl) {
  const syncCapTimeline = () => {
    if (captionTimelinePanel && captionTimelinePanel.style.display !== "none") updateCaptionPlayhead();
  };
  capPreviewVideoEl.addEventListener("seeked", syncCapTimeline);
  capPreviewVideoEl.addEventListener("timeupdate", syncCapTimeline);
}

if (typeof ResizeObserver === "function") {
  const facePreviewResizeObserver = new ResizeObserver(() => updatePreviewFaceTransform());
  facePreviewResizeObserver.observe(previewFrame);
} else {
  window.addEventListener("resize", updatePreviewFaceTransform);
}

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
    // Timeline = transport: seek (dan play) di player aktif sesuai view.
    const av = capActiveVideo();
    av.currentTime = Math.max(0, target);
    if (av !== previewVideo && av.paused) av.play().catch(() => {});
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

  // Caption timeline shortcuts (J/K/L like professional NLEs)
  if (timelineVisible && (event.code === "KeyJ" || event.code === "KeyK" || event.code === "KeyL")) {
    event.preventDefault();
    const activeVid = capActiveVideo();
    if (event.code === "KeyK") {
      // K = play/pause (same as Space)
      if (activeVid.paused) activeVid.play().catch(() => {});
      else activeVid.pause();
    } else if (event.code === "KeyJ") {
      // J = back 1 second
      activeVid.currentTime = Math.max(0, activeVid.currentTime - 1);
      updateCaptionPlayhead();
    } else if (event.code === "KeyL") {
      // L = forward 1 second
      activeVid.currentTime = Math.min(activeVid.duration || 0, activeVid.currentTime + 1);
      updateCaptionPlayhead();
    }
    return;
  }

  if (event.ctrlKey || event.metaKey) {
    if (event.code === "KeyS") {
      event.preventDefault();
      if (timelineVisible) {
        saveCaptionTimeline();
        showToast("Timeline caption disimpan.");
      } else if (studioDirty) {
        saveStudioToServer();
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

  // Caption timeline: ArrowLeft/Right = ±5s (standard video player behavior)
  if (timelineVisible && (key === "ArrowLeft" || key === "ArrowRight")) {
    const activeVid = capActiveVideo();
    event.preventDefault();
    activeVid.currentTime = Math.max(0, Math.min(activeVid.duration || 0, activeVid.currentTime + (key === "ArrowRight" ? 5 : -5)));
    updateCaptionPlayhead();
    return;
  }

  // Results view toggle shortcut
  if (event.code === "KeyV" && document.querySelector('[data-view-panel="results"].active')) {
    event.preventDefault();
    const list = document.getElementById("resultsClipList");
    if (list) {
      list.classList.toggle("horizontal-mode");
      const toggle = document.getElementById("resViewToggle");
      if (toggle) toggle.textContent = list.classList.contains("horizontal-mode") ? "\u2630 Grid" : "\u2630 List";
    }
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
$("#translateBtn").addEventListener("click", () => translateCaptionSegments());

async function translateCaptionSegments() {
  if (!state.activeClip) { showToast("Pilih clip dulu (dari Results atau Studio)."); return; }
  let segs = state.captionSegments || [];
  // Sesi baru? Muat segmen caption persisten dari server sebelum menyerah.
  if (!segs.length && state.projectId) {
    try {
      const q = new URLSearchParams({ start: Number(state.activeClip.start) || 0, end: Number(state.activeClip.end) || 0 });
      const r = await fetch(`/api/projects/${state.projectId}/captions/${state.activeClip.id}?${q}`);
      const d = await r.json();
      if (r.ok && Array.isArray(d.segments) && d.segments.length) {
        state.captionSegments = d.segments.map((s) => ({ ...s, words: Array.isArray(s.words) ? s.words.slice() : [] }));
        state.liveSegments = state.captionSegments.map((s) => ({ ...s, words: Array.isArray(s.words) ? s.words.slice() : [] }));
        captionTimelinePanel.style.display = "block";
        loadCaptionTimeline(state.liveSegments);
        segs = state.captionSegments;
      }
    } catch {}
  }
  if (!segs.length) { showToast("Belum ada caption untuk clip ini — jalankan Auto Caption dulu."); return; }
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

  const btn = $("#translateBtn") || $("#createTranslateBtn");
  const old = btn ? btn.textContent : "";
  if (btn) btn.disabled = true;
  if (btn) btn.textContent = "Menerjemahkan...";
  showJobProgress("Menerjemahkan caption", { indeterminate: true });
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
      // FIX: timing kata karaoke milik bahasa ASAL (dari STT). Setelah translate,
      // teksnya tidak cocok lagi — overlay preview masih menampilkan kata bahasa
      // lama walau timeline sudah berbahasa baru. Bangun ulang timing kata dari
      // teks hasil terjemahan (pola sama dengan edit manual segmen).
      const next = { ...s, text: keep };
      if (keep !== s.text) rebuildSegmentKaraoke(next);
      return next;
    });
    if (!changedCount) {
      settleJobProgress("success", "Tidak ada perubahan");
      showToast("Tidak ada segmen yang berubah — caption tampaknya sudah dalam bahasa target.");
      return;
    }
    state.captionByClip[captionTimelineKey()] = state.captionSegments.map((s) => ({ ...s }));
    state.liveSegments = state.captionSegments.map((s) => ({ ...s }));
    state.liveActive = state.liveSegments.length > 0 && effectiveCaptionStyle() !== "off";
    state.liveOffset = (state.youtubeUrl || sourceIsBoundedSection()) ? 0 : (state.activeClip ? Number(state.activeClip.start) || 0 : 0);
    renderCaptionTimeline();
    // Refresh preview: live caption saat play/pause dan caption box statis saat idle.
    
    const combined = state.captionSegments.map((s) => s.text).join(" ").trim().slice(0, 155);
    if (combined) {
      // 1. Update text input box
      captionInput.value = combined;
      // 2. Update visual static box
      captionBox.textContent = `"${combined}"`;
      // 3. IMPORTANT: Update global state!
      if (state.activeClip) state.activeClip.caption = combined;
    }
    
    // Force re-render overlay and static captions
    renderStaticCaption();
    updateLiveCaption();
    
    renderClips(state.sorted ? [...clips].sort((a, b) => (b.score || -1) - (a.score || -1)) : clips);
    settleJobProgress("success", `${changedCount}/${translated.length} segmen berubah`);
    showToast(`Terjemahan selesai (${changedCount}/${translated.length} segmen berubah). Klik "Simpan Perubahan" untuk menyimpan.`);
  } catch (err) {
    settleJobProgress("error", err.message || "Terjemahan gagal.");
    showToast(err.message || "Terjemahan gagal.");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = old; }
  }
}

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

function getSpeakerColor(speakerId) {
  // Palet stabil per speaker — updateLiveCaption memanggil fungsi ini untuk
  // mewarnai teks per speaker_id; sebelumnya undefined dan membuat overlay
  // caption crash (ReferenceError) sehingga preview tidak pernah update.
  const palette = ["#FFD700", "#00E5FF", "#FF6B6B", "#7CFF6B", "#C77DFF", "#FF9E5E", "#5E9EFF", "#FF5EF0"];
  const id = String(speakerId || "");
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
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
  const style = effectiveCaptionStyle();
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
  // Sinkronkan liveSegments dengan timeline — sebelumnya jalur restore
  // (captionByClip -> loadCaptionTimeline) tidak menyentuh liveSegments,
  // sehingga overlay preview memakai data basi (bahasa lama) padahal
  // timeline sudah berubah (mis. hasil terjemahan).
  state.liveSegments = state.captionSegments.map((s) => ({
    ...s,
    words: Array.isArray(s.words) ? s.words.slice() : []
  }));
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
  const t = capActiveVideo().currentTime - state.liveOffset;
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
  if (!autoCaptionEnabled()) { showToast("Auto caption dimatikan — nyalakan toggle-nya dulu."); return; }
  if (!state.projectId) { showToast("Analyze URL dulu sebelum auto caption."); return; }
  if (!state.activeClip) { showToast("Tidak ada clip untuk auto caption."); return; }
  const btn = $("#autoCaptionBtn");
  btn.disabled = true;
  btn.textContent = "Processing...";
  showJobProgress("Auto caption", { indeterminate: true });
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
        style: effectiveCaptionStyle() || "dynamic",
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
    settleJobProgress("success", `${segs.length} segmen (${data.provider})`);
    $("#captionStatus").textContent = `${data.provider}: ${segs.length} segmen`;
    // BUG FIX: Paksa sinkronisasi penuh antara liveSegments dan captionSegments agar UI dan Video Overlay tidak desync
    state.captionSegments = segs.map((s) => ({
      ...s,
      words: Array.isArray(s.karaoke) ? s.karaoke.slice() : (Array.isArray(s.words) ? s.words.slice() : [])
    }));
    state.liveSegments = state.captionSegments.map(s => ({...s, words: Array.isArray(s.words) ? s.words.slice() : []}));
    state.captionByClip[captionTimelineKey()] = state.captionSegments.map((s) => ({
      ...s,
      words: Array.isArray(s.words) ? s.words.slice() : []
    }));
    state.liveActive = state.liveSegments.length > 0 && effectiveCaptionStyle() !== "off";
    // Align the live caption window to this clip. Karaoke timestamps are
    // clip-relative (0..duration), so liveOffset must match this clip's start
    // — otherwise captions drift onto the wrong part of the video (mirrors
    // loadPreviewClip) and go empty once playback leaves the segment window.
    state.liveOffset = (state.youtubeUrl || sourceIsBoundedSection()) ? 0 : (state.activeClip ? Number(state.activeClip.start) || 0 : 0);
    try { previewVideo.currentTime = (state.noDownload || sourceIsBoundedSection()) ? 0 : state.liveOffset; } catch {}
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
    settleJobProgress("error", err.message);
    showToast(err.message);
    uploadStatus.textContent = "Auto caption failed";
  } finally {
    btn.disabled = false;
    btn.textContent = "Auto Caption";
  }
});

$("#autoCaptionToggle").addEventListener("change", () => {
  const enabled = autoCaptionEnabled();
  const btn = $("#autoCaptionBtn");
  btn.disabled = !enabled;
  btn.title = enabled ? "" : "Auto caption dimatikan — nyalakan toggle untuk generate caption";
  if (!enabled) {
    state.liveActive = false;
    liveCaption.style.display = "none";
    liveCaption.innerHTML = "";
    renderStaticCaption();
    if (typeof renderCaptionTimeline === "function") renderCaptionTimeline();
    showToast("Auto caption dimatikan: export tanpa caption terbakar.");
  } else {
    renderStaticCaption();
    showToast("Auto caption aktif.");
  }
  saveSettingsDebounced();
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
  markStudioDirty();
});

hookInput.addEventListener("input", () => {
  if (!state.activeClip) return;
  state.activeClip.hook = hookInput.value;
  markStudioDirty();
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
  const style = effectiveCaptionStyle();
  renderStaticCaption();
  updateFinalPreviewStrip();
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

// Hanya tombol rasio (data-ratio) yang memicu setRatio — klik pada segmented
// lain (genMode/batch/platform) TIDAK boleh mengubah aspek rasio.
$$(".segmented button[data-ratio]").forEach((button) => {
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

$("#intelRegenerate").addEventListener("click", analyzeSelectedClip);

// ---- Applier saran engine: SATU jalur untuk tombol Intel & strip Clip tab ----
function applyHookSuggestion(value, label) {
  if (!value || value === "—" || value === "--") return false;
  hookInput.value = value;
  if (state.activeClip) state.activeClip.hook = value;
  markStudioDirty();
  showToast(`${label} dipakai sebagai hook.`);
  return true;
}

function applyCaptionVariant() {
  const meta = state.activeClip && state.activeClip.analysis;
  const best = meta && meta.bestCaption ? meta.captionVariants[meta.bestCaption] : $("#intelCaptionA").textContent;
  if (!best || best === "--" || best === "—") return false;
  captionInput.value = best;
  if (state.activeClip) state.activeClip.caption = best;
  captionBox.textContent = `"${best}"`;
  renderStaticCaption();
  markStudioDirty();
  showToast(`Caption ${meta && meta.bestCaption ? meta.bestCaption : "A"} diterapkan.`);
  return true;
}

function applyTitleSuggestion(value) {
  if (!value || value === "—" || value === "--") return false;
  hookInput.value = value;
  if (state.activeClip) { state.activeClip.hook = value; state.activeClip.title = value; }
  markStudioDirty();
  showToast("Judul rekomendasi dipakai sebagai judul & hook.");
  return true;
}

// ---- Suggestions strip di tab Clip: saran engine aktif, apply satu klik ----
function renderClipSuggestions() {
  const strip = document.getElementById("suggestStrip");
  if (!strip) return;
  const clip = state.activeClip;
  const a = clip && clip.analysis;
  strip.innerHTML = "";
  const labelEl = document.createElement("span");
  labelEl.className = "ss-label";
  strip.appendChild(labelEl);

  if (!a) {
    labelEl.textContent = "AI SUGGESTIONS — belum dianalisis";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "secondary-button compact";
    btn.textContent = "ANALYZE CLIP";
    btn.addEventListener("click", () => {
      $$(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === "intel"));
      $$(".tab-panel").forEach((p) => p.classList.remove("active"));
      $("#intelTab").classList.add("active");
      analyzeSelectedClip();
    });
    strip.appendChild(btn);
    return;
  }

  labelEl.textContent = "AI SUGGESTIONS";
  const addChip = (text, title, fn) => {
    if (!text || text === "—" || text === "--") return;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "ghost-button compact ss-chip";
    chip.title = title || "";
    chip.textContent = String(text).length > 42 ? `${String(text).slice(0, 42)}…` : String(text);
    chip.addEventListener("click", fn);
    strip.appendChild(chip);
  };
  addChip(a.recommendedHook, "Pakai recommended hook", () => applyHookSuggestion(a.recommendedHook, "Recommended hook"));
  addChip(a.deepHook, "Pakai deep hook", () => applyHookSuggestion(a.deepHook, "Deep hook"));
  const capKey = a.bestCaption || (a.captionVariants ? "A" : "");
  addChip(a.captionVariants && a.captionVariants[capKey], `Pakai caption ${capKey}`, () => applyCaptionVariant());
  addChip(a.deepTitle, "Pakai judul", () => applyTitleSuggestion(a.deepTitle));
}

$("#intelApplyHook").addEventListener("click", () => applyHookSuggestion($("#intelRecommendedHook").textContent, "Recommended hook"));

$("#intelApplyCaption").addEventListener("click", () => applyCaptionVariant());

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
        language: CAPTION_LANG,
        keepOriginal: !!$("#keepOriginalToggle").checked,
        disableRewrite: !!$("#disableRewriteToggle").checked,
        ...durationSettingsPayload()
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Analyze gagal.");
    const a = data.analysis;
    state.activeClip.analysis = a;
    renderIntel(a);
    renderClipSuggestions();
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
  $("#intelBestOpening").textContent = a.openingBest || a.recommendedHook || "--";
  const openingMeta = $("#intelOpeningMeta");
  openingMeta.innerHTML = "";
  if (a.openingStrategy) {
    const meta = document.createElement("span");
    meta.className = "intel-badge intel-badge--mode";
    meta.textContent = `Strategy: ${a.openingStrategy}`;
    openingMeta.appendChild(meta);
  }
  if (a.openingEditorialScore != null) {
    const meta = document.createElement("span");
    meta.className = "intel-badge intel-badge--active";
    meta.textContent = `Editorial score ${a.openingEditorialScore}/100`;
    openingMeta.appendChild(meta);
  }
  if (a.openingConfidence != null) {
    const meta = document.createElement("span");
    meta.className = "intel-badge";
    meta.textContent = `Confidence ${a.openingConfidence}%`;
    openingMeta.appendChild(meta);
  }
  if (a.openingOpenLoop) {
    const meta = document.createElement("span");
    meta.className = "intel-badge";
    meta.textContent = `Open loop${a.openingOpenLoopQuestion ? ": " + a.openingOpenLoopQuestion.slice(0, 48) : ""}`;
    openingMeta.appendChild(meta);
  }
  if (a.openingSourceStart != null && a.openingSourceStart !== "") {
    const meta = document.createElement("span");
    meta.className = "intel-badge";
    meta.textContent = `Moment @${Number(a.openingSourceStart).toFixed(1)}s`;
    openingMeta.appendChild(meta);
  }
  if (a.openingReason) {
    const meta = document.createElement("div");
    meta.className = "intel-opening-reason";
    meta.textContent = a.openingReason;
    openingMeta.appendChild(meta);
  }
  renderIntelDuration(a);
  renderDeepIntel(a);
  $("#intelOriginalHook").textContent = a.originalHook || "--";
  $("#intelRecommendedHook").textContent = a.recommendedHook || "--";
  $("#intelKeyMessage").textContent = a.keyMessage || "--";

  const badges = $("#intelHookBadges");
  badges.innerHTML = "";
  if (a.hookMode) {
    const b = document.createElement("span");
    b.className = "intel-badge intel-badge--mode";
    b.textContent = a.hookMode === "editorial" ? "Editorial rewrite" : "Direct (asli)";
    badges.appendChild(b);
  }
  if (a.hookColdOpen) {
    const b = document.createElement("span");
    b.className = "intel-badge intel-badge--active";
    b.textContent = `Cold open (mulai dari kalimat #${(a.hookColdOpenStartIndex || 0) + 1})`;
    badges.appendChild(b);
  }
  if (a.hookDeepScore != null) {
    const b = document.createElement("span");
    b.className = "intel-badge";
    b.textContent = `Hook score ${a.hookDeepScore}/100`;
    badges.appendChild(b);
  }

  $("#intelExplanation").textContent = a.hookExplanation || "--";

  const altsEl = $("#intelAlternatives");
  altsEl.innerHTML = "";
  if (a.hookAlternatives && a.hookAlternatives.length) {
    a.hookAlternatives.forEach((alt) => {
      const row = document.createElement("div");
      row.className = "intel-alt";
      const strategy = document.createElement("span");
      strategy.className = "intel-alt-strategy";
      strategy.textContent = alt.strategy || "Varian";
      const text = document.createElement("span");
      text.className = "intel-alt-text";
      text.textContent = alt.text;
      const useBtn = document.createElement("button");
      useBtn.type = "button";
      useBtn.className = "ghost-button compact";
      useBtn.textContent = "Gunakan";
      useBtn.addEventListener("click", () => {
        hookInput.value = alt.text;
        if (state.activeClip) state.activeClip.hook = alt.text;
        $("#intelRecommendedHook").textContent = alt.text;
        showToast("Hook alternatif diterapkan.");
      });
      row.appendChild(strategy);
      row.appendChild(text);
      row.appendChild(useBtn);
      altsEl.appendChild(row);
    });
  } else {
    altsEl.textContent = "--";
  }

  const dimsEl = $("#intelDimensions");
  dimsEl.innerHTML = "";
  if (a.hookDimensions && Object.keys(a.hookDimensions).length) {
    const labels = {
      contentStrength: "Kekuatan isi", curiosity: "Curiosity gap", emotional: "Emosi",
      novelty: "Kebaruan", conflict: "Konflik", specificity: "Spesifisitas",
      consequence: "Konsekuensi", clarity: "Kejelasan", standalone: "Mandiri",
      retention: "Retensi", sourceFidelity: "Fidelity sumber", delivery: "Penyampaian"
    };
    const entries = Object.entries(a.hookDimensions).sort((x, y) => y[1] - x[1]);
    for (const [key, val] of entries) {
      const chip = document.createElement("span");
      chip.className = "intel-dim";
      chip.innerHTML = `${labels[key] || key} <b>${Math.round(val * 100)}%</b>`;
      dimsEl.appendChild(chip);
    }
  } else {
    dimsEl.textContent = "--";
  }
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

function renderIntelDuration(a) {
  const mainEl = $("#intelDuration");
  const rec = Number(a.openingRecommended);
  const hasDur = Number.isFinite(rec) && rec > 0;
  if (!hasDur) {
    mainEl.textContent = "--";
    $("#intelDurationSub").textContent = "";
    $("#intelDurRecommended").textContent = "--";
    $("#intelDurRange").textContent = "--";
    $("#intelDurMax").textContent = "--";
    $("#intelDurMode").textContent = "--";
    $("#intelCutReason").textContent = "";
    return;
  }
  const main = document.createElement("span");
  main.className = "intel-dur-main";
  main.textContent = `~${Math.round(rec)} detik`;
  mainEl.innerHTML = "";
  mainEl.appendChild(main);
  const clipLen = state.activeClip ? Math.round(state.activeClip.end - state.activeClip.start) : null;
  const sub = document.createElement("span");
  sub.className = "intel-dur-sub";
  sub.textContent = clipLen != null ? `vs clip saat ini ${clipLen}s` : "";
  mainEl.appendChild(sub);

  $("#intelDurRecommended").textContent = `Recommended ${Math.round(rec)}s`;
  const min = Number(a.openingMinViable);
  const maxUse = Number(a.openingMaxUseful);
  $("#intelDurRange").textContent =
    Number.isFinite(min) && Number.isFinite(maxUse) ? `Optimal ${Math.round(min)}–${Math.round(maxUse)}s` : "--";
  const maxAllowed = Number(a.openingMaxAllowed);
  $("#intelDurMax").textContent = Number.isFinite(maxAllowed) ? `Max ${Math.round(maxAllowed)}s` : "--";
  $("#intelDurMode").textContent = a.openingDurationMode ? `Mode ${a.openingDurationMode}` : "--";
  $("#intelCutReason").textContent = a.openingNaturalCutReason || "";

  if (Number.isFinite(Number(a.openingClipPotential))) {
    const chip = document.createElement("span");
    chip.className = "intel-badge intel-badge--active";
    chip.textContent = `Viral potential ${Math.round(a.openingClipPotential)}/100`;
    $("#intelOpeningMeta").appendChild(chip);
  }
}

function renderDeepIntel(a) {
  const titleEl = $("#intelDeepTitle");
  const hasTitle = a.deepTitle && String(a.deepTitle).trim() !== "";
  titleEl.textContent = hasTitle ? a.deepTitle : "--";
  titleEl.classList.toggle("intel-block--empty", !hasTitle);

  const metaEl = $("#intelDeepTitleMeta");
  metaEl.innerHTML = "";
  if (hasTitle) {
    const score = Number(a.deepTitleScore);
    if (Number.isFinite(score) && score > 0) {
      const b = document.createElement("span");
      b.className = "intel-badge intel-badge--active";
      b.textContent = `Title score ${Math.round(score)}/100`;
      metaEl.appendChild(b);
    }
    if (a.deepTopic) {
      const b = document.createElement("span");
      b.className = "intel-badge";
      b.textContent = `Topik: ${a.deepTopic.slice(0, 40)}`;
      metaEl.appendChild(b);
    }
    if (Array.isArray(a.deepNumbers) && a.deepNumbers.length) {
      const b = document.createElement("span");
      b.className = "intel-badge";
      b.textContent = `Angka: ${a.deepNumbers.map((n) => n.full).join(", ")}`;
      metaEl.appendChild(b);
    }
    if (a.deepOpenQuestion) {
      const b = document.createElement("span");
      b.className = "intel-badge";
      b.textContent = `Pertanyaan: ${a.deepOpenQuestion.slice(0, 48)}`;
      metaEl.appendChild(b);
    }
  }
  $("#intelDeepTitleReason").textContent = a.deepTitleReason || "";

  $("#intelDeepHook").textContent = a.deepHook || "--";
  $("#intelDeepHookReason").textContent = a.deepHookReason || "";

  const altEl = $("#intelDeepAlternatives");
  altEl.innerHTML = "";
  if (Array.isArray(a.deepTitleAlternatives) && a.deepTitleAlternatives.length) {
    a.deepTitleAlternatives.forEach((alt) => {
      const row = document.createElement("div");
      row.className = "intel-alt";
      const text = document.createElement("span");
      text.className = "intel-alt-text";
      text.textContent = alt.text;
      const useBtn = document.createElement("button");
      useBtn.type = "button";
      useBtn.className = "ghost-button compact";
      useBtn.textContent = "Gunakan";
      useBtn.addEventListener("click", () => {
        if (state.activeClip) state.activeClip.hook = alt.text;
        hookInput.value = alt.text;
        $("#intelDeepTitle").textContent = alt.text;
        showToast("Judul alternatif diterapkan sebagai hook.");
      });
      row.appendChild(text);
      row.appendChild(useBtn);
      altEl.appendChild(row);
    });
  } else {
    altEl.textContent = "--";
  }

  const thinkEl = $("#intelDeepThinking");
  thinkEl.innerHTML = "";
  if (Array.isArray(a.deepThinking) && a.deepThinking.length) {
    for (const step of a.deepThinking) {
      const row = document.createElement("div");
      row.className = "intel-dim";
      row.innerHTML = "";
      const name = document.createElement("span");
      name.className = "intel-dim-name";
      name.textContent = (step.step || "Langkah") + ":";
      const detail = document.createElement("span");
      detail.className = "intel-dim-val";
      detail.textContent = step.detail || "";
      row.appendChild(name);
      row.appendChild(detail);
      thinkEl.appendChild(row);
    }
  } else {
    thinkEl.textContent = "--";
  }
}

$("#intelUseTitle").addEventListener("click", () => applyTitleSuggestion($("#intelDeepTitle").textContent));

$("#intelUseDeepHook").addEventListener("click", () => applyHookSuggestion($("#intelDeepHook").textContent, "Deep hook"));

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
          captionStyle: effectiveCaptionStyle(),
          captionSize: captionSize.value,
          fontFamily: captionFontSelect ? captionFontSelect.value : "Arial",
          captionColor: captionColorInput ? captionColorInput.value : "",
          captionPosition: state.captionPosition || 0.76,
          ratio: currentRatio(),
          fps: Number(state.fps) || 0,
          crf: Number(state.crf) || 23,
          audioBitrate: Number(state.audioBitrate) || 128,
          speakerCut: !!document.getElementById("speakerCutToggle")?.checked,
          faceTrack: !!document.getElementById("faceTrackToggle")?.checked,
    reframe: !!document.getElementById("reframeToggle")?.checked,
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
    const warnings = (result.results || []).flatMap((item) => item.warnings || []);

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
    } else if (warnings.length) {
      showToast(`${summary}. ${warnings.join(" ")}`);
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
    if (button.dataset.view === "dashboard") loadDashboardData();
    if (button.dataset.view === "studio") checkEngineReadiness(false);
    if (button.dataset.view === "results" && resultsState.projectId) renderResultsAll();
    if (button.dataset.view === "publish") { populatePubSources(); pubChecklistUpdate(); ensurePublishMetadata(); populatePubProjects(); }
    if (button.dataset.view === "calendar") { populateCalSources(); renderCalendar(); }
    if (button.dataset.view === "integrations") loadIntegrations();
    if (button.dataset.view === "analytics") { loadIntegrations(); loadAnalytics(); }
    if (button.dataset.view === "intel") populateIntelProjects();
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
    captionStyle: effectiveCaptionStyle(),
    captionSize: captionSize.value,
    fontFamily: captionFontSelect ? captionFontSelect.value : "Arial",
    captionColor: captionColorInput ? captionColorInput.value : "",
    captionPosition: state.captionPosition || 0.76,
    ratio: currentRatio(),
    fps: Number(state.fps) || 0,
    crf: Number(state.crf) || 23,
    audioBitrate: Number(state.audioBitrate) || 128,
    speakerCut: !!document.getElementById("speakerCutToggle")?.checked,
    faceTrack: !!document.getElementById("faceTrackToggle")?.checked,
    reframe: !!document.getElementById("reframeToggle")?.checked,
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
    const warnings = Array.isArray(result.warnings) ? result.warnings : [];
    showToast(warnings.length
      ? `Video gabungan selesai. ${warnings.join(" ")}`
      : `Video gabungan selesai: ${result.filename}`);
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

// ================= DASHBOARD (Phase 1 — command center) =================
// Semua angka dari API nyata (/api/projects, /api/exports, /api/system,
// /api/localai/status, /api/queue). Tidak ada metrik buatan: kalau data
// belum ada, tampil "—".

function openCreateWorkspace() {
  showView("newproject");
  const dz = $("#dropzone");
  if (dz) { dz.classList.add("dragging"); setTimeout(() => dz.classList.remove("dragging"), 600); }
}

// ---- CAPTION WORKSPACE renderer ----
let capLibFilter = "";
function renderCaptionsWorkspace() {
  if (!window.ClipmeCaptionTemplates) return;
  const list = document.getElementById("capLibList");
  if (!list) return;
  list.innerHTML = "";
  const q = capLibFilter.trim().toLowerCase();
  const activeId = state.captionTemplateId || window.ClipmeCaptionTemplates.DEFAULT_TEMPLATE_ID;
  let shown = 0;
  for (const t of window.ClipmeCaptionTemplates.TEMPLATES) {
    if (q && !(t.name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q))) continue;
    shown++;
    const card = document.createElement("button");
    card.type = "button";
    card.className = `tpl-card ${t.id === activeId ? "selected" : ""}`;
    card.dataset.tplId = t.id;
    const swatch = document.createElement("span");
    swatch.className = "tpl-swatch";
    Object.assign(swatch.style, window.ClipmeCaptionTemplates.swatchStyle(t));
    swatch.textContent = "Aa";
    const name = document.createElement("strong");
    name.textContent = t.name;
    const cat = document.createElement("span");
    cat.className = "tpl-cat";
    cat.textContent = `${t.category} · ${t.style}`;
    card.append(swatch, name, cat);
    card.addEventListener("click", () => {
      applyCaptionTemplate(t, { previewOnly: true });
      renderCaptionsWorkspace();
    });
    list.appendChild(card);
  }
  const countEl = document.getElementById("capLibCount");
  if (countEl) countEl.textContent = `${shown}/${window.ClipmeCaptionTemplates.TEMPLATES.length}`;
  renderCaptionPreview(activeId);
}

function renderCaptionPreview(templateId) {
  const tpl = window.ClipmeCaptionTemplates && window.ClipmeCaptionTemplates.getById(templateId);
  const nameEl = document.getElementById("capPreviewName");
  if (!tpl) return;
  if (nameEl) nameEl.textContent = tpl.name;
  const props = document.getElementById("capProps");
  if (props) {
    props.innerHTML = "";
    const rows = [
      ["Template", tpl.name], ["Category", tpl.category], ["Style preset", tpl.style],
      ["Font", tpl.fontFamily], ["Color", tpl.color || "preset"], ["Size scale", `×${tpl.sizeScale}`],
      ["Position", `${Math.round((tpl.position || 0.76) * 100)}%`]
    ];
    for (const [k, v] of rows) {
      const dt = document.createElement("dt"); dt.textContent = k;
      const dd = document.createElement("dd"); dd.textContent = v;
      props.append(dt, dd);
    }
  }
  capPlayEnsureVideo();
  renderCapFrameAt(capPlay.t || 0);
}

// ---- CAPTION PLAY: pemutar preview caption dengan timing kata asli ----
const capPlay = { raf: 0, t: 0, playing: false, lastTs: 0 };
const CAP_DEMO_WORDS = ["Ini", "hook", "pembuka", "yang", "menahan", "scroll", "dan", "kata", "kunci", "highlight", "muncul", "di", "sini"];

function capSegmentsForPlay() {
  if (Array.isArray(state.captionSegments) && state.captionSegments.length) return state.captionSegments;
  const words = CAP_DEMO_WORDS.map((w, i) => ({ text: w, start: i * 0.32, end: i * 0.32 + 0.3 }));
  const segs = [];
  for (let i = 0; i < words.length; i += 5) {
    const grp = words.slice(i, i + 5);
    segs.push({ start: grp[0].start, end: grp[grp.length - 1].end + 0.15, text: grp.map((w) => w.text).join(" "), words: grp });
  }
  return segs;
}

function capTemplateNow() {
  return (window.ClipmeCaptionTemplates && window.ClipmeCaptionTemplates.getById(state.captionTemplateId))
    || (window.ClipmeCaptionTemplates ? window.ClipmeCaptionTemplates.getById(window.ClipmeCaptionTemplates.DEFAULT_TEMPLATE_ID) : null);
}

function capPlayDuration() {
  const segs = capSegmentsForPlay();
  const fromSegs = segs.length ? Number(segs[segs.length - 1].end) || 0 : 0;
  const vid = document.getElementById("capPreviewVideo");
  const fromVid = vid && vid.duration && Number.isFinite(vid.duration) ? vid.duration : 0;
  return Math.max(fromSegs, fromVid, 1);
}

function renderCapFrameAt(t) {
  const tpl = capTemplateNow();
  const wrap = document.getElementById("capPreviewLines");
  if (!wrap || !tpl) return;
  const style = window.ClipmeCaptionTemplates.swatchStyle(tpl);
  const segs = capSegmentsForPlay();
  const active = segs.find((s) => t >= Number(s.start) && t < Number(s.end)) || null;
  wrap.innerHTML = "";
  wrap.style.bottom = `${Math.round((1 - (tpl.position || 0.76)) * 100)}%`;
  if (!active) { wrap.style.display = "none"; return; }
  wrap.style.display = "";
  const words = Array.isArray(active.words) && active.words.length
    ? active.words.map((w) => ({ text: String(w.text), start: Number(w.start), end: Number(w.end) }))
    : String(active.text || "").split(/\s+/).filter(Boolean).map((w, i, arr) => ({ text: w, start: Number(active.start) + i * ((Number(active.end) - Number(active.start)) / Math.max(arr.length, 1)), end: 0 }));
  const perLine = 5;
  for (let i = 0; i < words.length; i += perLine) {
    const line = document.createElement("div");
    line.className = "cap-line";
    Object.assign(line.style, style);
    line.style.fontSize = `${Math.round(24 * (tpl.sizeScale || 1))}px`;
    line.style.display = "inline-block";
    line.style.margin = "2px";
    for (const w of words.slice(i, i + perLine)) {
      const span = document.createElement("span");
      span.textContent = `${w.text} `;
      if (tpl.style === "karaoke" && t >= w.start && t < w.end) {
        span.style.color = tpl.color || "#00FFFF";
        span.style.textShadow = "0 0 10px currentColor";
      } else if (t >= w.start && t < w.end && tpl.style !== "karaoke") {
        span.style.filter = "brightness(1.25)";
      }
      line.appendChild(span);
    }
    wrap.appendChild(line);
  }
}

function capPlayTick(ts) {
  if (!capPlay.playing) return;
  const vid = document.getElementById("capPreviewVideo");
  const videoDriven = vid && vid.src && vid.readyState > 1;
  if (videoDriven) {
    capPlay.t = vid.currentTime;
    if (vid.ended) { capPlayStop(); renderCapFrameAt(capPlayDuration()); return; }
  } else {
    const dt = capPlay.lastTs ? (ts - capPlay.lastTs) / 1000 : 0;
    capPlay.t += dt;
    const dur = capPlayDuration();
    if (capPlay.t >= dur) { capPlay.t = dur; capPlayStop(); }
  }
  capPlay.lastTs = ts;
  renderCapFrameAt(capPlay.t);
  const fill = document.getElementById("capPlayFill");
  const timeEl = document.getElementById("capPlayTime");
  const pct = Math.min(100, (capPlay.t / capPlayDuration()) * 100);
  if (fill) fill.style.width = `${pct}%`;
  if (timeEl) timeEl.textContent = `${capPlay.t.toFixed(1)}s / ${capPlayDuration().toFixed(1)}s`;
  capPlay.raf = requestAnimationFrame(capPlayTick);
}

// Player aktif untuk sinkronisasi caption: di Caption Workspace pakai capPreviewVideo,
// di tempat lain tetap video editor studio.
function capActiveVideo() {
  const activeView = document.querySelector(".app-view.active");
  if (activeView && activeView.dataset.viewPanel === "captions") {
    const v = document.getElementById("capPreviewVideo");
    if (v && v.src && v.readyState > 0) return v;
  }
  return previewVideo;
}

function capPlayStart() {
  if (capPlay.playing) return;
  capPlay.playing = true;
  capPlay.lastTs = 0;
  const btn = document.getElementById("capPlayBtn");
  if (btn) btn.innerHTML = "&#10074;&#10074; PAUSE";
  const vid = document.getElementById("capPreviewVideo");
  if (vid && vid.src && vid.readyState > 1) vid.play().catch(() => {});
  capPlay.raf = requestAnimationFrame(capPlayTick);
}

function capPlayStop() {
  capPlay.playing = false;
  cancelAnimationFrame(capPlay.raf);
  const btn = document.getElementById("capPlayBtn");
  if (btn) btn.innerHTML = "&#9654; PLAY CAPTIONS";
  const vid = document.getElementById("capPreviewVideo");
  if (vid && !vid.paused) vid.pause();
}

function capPlayToggle() {
  if (capPlay.playing) capPlayStop();
  else capPlayStart();
}

function capPlayEnsureVideo() {
  const vid = document.getElementById("capPreviewVideo");
  if (!vid) return;
  const wantSrc = state.projectId && !state.noDownload ? `/media/${state.projectId}` : "";
  if (wantSrc && (!vid.src || !vid.src.endsWith(wantSrc))) {
    vid.src = wantSrc;
    vid.currentTime = 0;
    capPlay.t = 0;
  } else if (!wantSrc && vid.src) {
    vid.removeAttribute("src");
    vid.load();
    capPlay.t = 0;
  }
}

if ($("#capPlayBtn")) $("#capPlayBtn").addEventListener("click", capPlayToggle);
if ($("#createTranslateBtn")) {
  $("#createTranslateBtn").addEventListener("click", () => translateCaptionSegments());
}
if ($("#capPlayBar")) {
  $("#capPlayBar").addEventListener("click", (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    capPlay.t = pct * capPlayDuration();
    const vid = document.getElementById("capPreviewVideo");
    if (vid && vid.src && vid.readyState > 1) vid.currentTime = capPlay.t;
    renderCapFrameAt(capPlay.t);
    const fill = document.getElementById("capPlayFill");
    if (fill) fill.style.width = `${pct * 100}%`;
  });
}
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && capPlay.playing) capPlayStop();
});

// ---- SETTINGS view ----
let settingsLoadedOnce = false;
async function fillSettingsView() {
  const body = document.getElementById("setSysBody");
  if (!body || settingsLoadedOnce) return;
  try {
    const r = await fetch("/api/system");
    const d = await r.json();
    body.innerHTML = "";
    const rows = [
      ["App", "Clipper Studio desktop"],
      ["STT engine", d.sttEngine || d.stt || "faster-whisper"],
      ["Device", d.device || d.runtime?.sttDevice || "auto"],
      ["FFmpeg", d.ffmpeg || "bundled bin/ffmpeg.exe"],
      ["Queue", d.queueMax ? `max ${d.queueMax} job` : "ready"],
      ["Data root", d.dataRoot || d.dataDir || "(userData)"]
    ];
    for (const [k, v] of rows) {
      const dt = document.createElement("dt"); dt.textContent = k;
      const dd = document.createElement("dd"); dd.textContent = String(v);
      body.append(dt, dd);
    }
    settingsLoadedOnce = true;
  } catch {
    body.innerHTML = '<div class="empty-state">System info tidak tersedia.</div>';
  }
}

let dashBusy = false;

async function loadDashboardData() {
  if (dashBusy) return;
  dashBusy = true;
  try {
    await Promise.all([loadProjects(), loadExports()]);
    updateDashboardStats();
    renderDashboardProjects(state.projects);
    renderRecentExportsDashboard();
    renderDashboardActivity();
    renderDashActivityFeed();
    await updateDashboardAvgScore();
  } catch {}
  dashBusy = false;
  updateDashboardEngineStatus();
}

function updateDashboardStats() {
  const set = (id, v) => {
    const node = document.getElementById(id);
    if (!node) return;
    if (v == null) { node.textContent = "—"; node.classList.add("is-empty"); }
    else { node.textContent = String(v); node.classList.remove("is-empty"); }
  };
  set("kpiProjects", state.projects.length || null);
  const totalClips = state.projects.reduce((acc, p) => acc + (Number(p.clips) || 0), 0);
  set("kpiClips", totalClips || null);
  set("kpiExports", state.exports.length || null);
  const count = document.getElementById("dashProjectCount");
  if (count) count.textContent = String(state.projects.length);
}

// Dashboard — TOP CLIPS dari detail project yang sama (ranking backend score).
function renderDashTopClips(details) {
  const wrap = document.getElementById("dashTopClips");
  const count = document.getElementById("dashTopClipsCount");
  if (!wrap) return;
  const scored = [];
  for (const d of details || []) {
    if (!d || !Array.isArray(d.clips)) continue;
    for (const c of d.clips) {
      if (typeof c.score === "number" && Number.isFinite(c.score)) {
        scored.push({ clip: c, projectId: d.id, projectName: d.name });
      }
    }
  }
  scored.sort((a, b) => b.clip.score - a.clip.score);
  const top = scored.slice(0, 5);
  if (count) count.textContent = String(top.length);
  if (!top.length) {
    wrap.innerHTML = '<div class="empty-state">Belum ada clip ter-analisis.</div>';
    return;
  }
  wrap.innerHTML = "";
  top.forEach((entry, i) => {
    const row = document.createElement("div");
    row.className = "rr-row";
    const rankEl = document.createElement("span");
    rankEl.className = "tc-rank";
    rankEl.textContent = `#${i + 1}`;
    const main = document.createElement("div");
    main.className = "rr-main";
    const nameEl = document.createElement("strong");
    nameEl.textContent = entry.clip.deepTitle || entry.clip.recommendedHook || entry.clip.hook || `Clip ${entry.clip.id}`;
    nameEl.title = `${entry.projectName} · Clip ${entry.clip.id}`;
    const metaEl = document.createElement("span");
    metaEl.textContent = [
      entry.projectName,
      `${formatTime(entry.clip.start)} → ${formatTime(entry.clip.end)}`,
      entry.clip.hookType
    ].filter(Boolean).join(" · ");
    main.appendChild(nameEl);
    main.appendChild(metaEl);
    const scoreEl = document.createElement("span");
    scoreEl.className = "dj-pct";
    scoreEl.textContent = String(Math.round(Number(entry.clip.score)));
    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "secondary-button compact";
    openBtn.textContent = "OPEN";
    openBtn.setAttribute("aria-label", `Open ${nameEl.textContent} in Results`);
    openBtn.addEventListener("click", () => openResultsForProject(entry.projectId, entry.clip.id));
    row.appendChild(rankEl);
    row.appendChild(main);
    row.appendChild(scoreEl);
    row.appendChild(openBtn);
    wrap.appendChild(row);
  });
}

// Dashboard — RECENT ACTIVITY feed: event lokal nyata (project & export).
function renderDashActivityFeed() {
  const wrap = document.getElementById("dashActivityFeed");
  const count = document.getElementById("dashFeedCount");
  if (!wrap) return;
  const events = [];
  for (const p of state.projects) {
    if (p._ts) events.push({ ts: p._ts, kind: "Project", label: p.name });
  }
  for (const e of state.exports) {
    if (e._ts) events.push({ ts: e._ts, kind: "Export", label: e.filename });
  }
  events.sort((a, b) => b.ts - a.ts);
  const recent = events.slice(0, 8);
  if (count) count.textContent = String(events.length);
  if (!recent.length) {
    wrap.innerHTML = '<div class="empty-state">Belum ada aktivitas.</div>';
    return;
  }
  wrap.innerHTML = "";
  for (const ev of recent) {
    const row = document.createElement("div");
    row.className = "af-row";
    const kindEl = document.createElement("span");
    kindEl.className = `af-kind${ev.kind === "Export" ? " export" : ""}`;
    kindEl.textContent = ev.kind.toUpperCase();
    const main = document.createElement("div");
    main.className = "rr-main";
    const nameEl = document.createElement("strong");
    nameEl.textContent = ev.label;
    nameEl.title = ev.label;
    const timeEl = document.createElement("span");
    timeEl.textContent = new Date(ev.ts).toLocaleString();
    main.appendChild(nameEl);
    main.appendChild(timeEl);
    row.appendChild(kindEl);
    row.appendChild(main);
    wrap.appendChild(row);
  }
}

// Performance Ledger UI: form angka aktual + history snapshot per export.
function engagementPct(rec) {
  if (!rec || !rec.views) return "—";
  const eng = (Number(rec.likes) + Number(rec.comments) + Number(rec.shares)) / Number(rec.views) * 100;
  return `${eng.toFixed(2)}%`;
}

async function renderPerfEditor(container, filename) {
  const enc = encodeURIComponent(filename);
  let perf = { postId: "", records: [], updatedAt: 0 };
  try {
    const r = await fetch(`/api/perf/${enc}`);
    const d = await r.json();
    if (r.ok && d.perf) perf = d.perf;
  } catch (err) {
    console.error("[perf]", err);
  }
  const latest = perf.records.length ? perf.records[perf.records.length - 1] : null;

  container.innerHTML = "";
  const grid = document.createElement("div");
  grid.className = "perf-grid";

  const platformSelect = document.createElement("select");
  platformSelect.className = "inspector-input";
  platformSelect.dataset.perfField = "Platform";
  for (const p of ["", "YouTube Shorts", "TikTok", "Instagram Reels", "Facebook", "X"]) {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p || "Platform…";
    if (perf.platform === p && p) opt.selected = true;
    platformSelect.appendChild(opt);
  }
  const platWrap = document.createElement("label");
  platWrap.className = "perf-field";
  const platSpan = document.createElement("span");
  platSpan.textContent = "Platform";
  platWrap.appendChild(platSpan);
  platWrap.appendChild(platformSelect);
  grid.appendChild(platWrap);

  const fields = [
    ["Post ID", "text", perf.postId || ""],
    ["Views", "number", latest ? latest.views : ""],
    ["Likes", "number", latest ? latest.likes : ""],
    ["Comments", "number", latest ? latest.comments : ""],
    ["Shares", "number", latest ? latest.shares : ""]
  ].map(([label, type, value]) => {
    const wrapEl = document.createElement("label");
    wrapEl.className = "perf-field";
    const nameSpan = document.createElement("span");
    nameSpan.textContent = label;
    const input = document.createElement("input");
    input.className = "inspector-input";
    input.type = type;
    input.min = type === "number" ? "0" : undefined;
    input.step = type === "number" ? "1" : undefined;
    input.dataset.perfField = label;
    if (value !== "") input.value = String(value);
    wrapEl.appendChild(nameSpan);
    wrapEl.appendChild(input);
    grid.appendChild(wrapEl);
    return input;
  });

  const engLine = document.createElement("p");
  engLine.className = "caption-hint";
  const refreshEngagement = () => {
    const get = (name) => Number(fields.find((f) => f.dataset.perfField === name).value) || 0;
    const views = get("Views");
    const likes = get("Likes");
    const comments = get("Comments");
    const shares = get("Shares");
    engLine.textContent = views > 0
      ? `Engagement (terhitung dari angka di atas): ${(((likes + comments + shares) / views) * 100).toFixed(2)}%`
      : "Engagement muncul setelah Views > 0.";
  };
  fields.forEach((f) => f.addEventListener("input", refreshEngagement));
  refreshEngagement();
  grid.appendChild(engLine);

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "primary-button compact";
  saveBtn.textContent = "SAVE SNAPSHOT";
  saveBtn.addEventListener("click", async () => {
    const get = (name) => fields.find((f) => f.dataset.perfField === name).value;
    saveBtn.disabled = true;
    try {
      const r = await fetch(`/api/perf/${encodeURIComponent(filename)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId: get("Post ID").trim(),
          platform: (fields.find((f) => f.dataset.perfField === "Platform").value || "").trim(),
          views: get("Views"),
          likes: get("Likes"),
          comments: get("Comments"),
          shares: get("Shares")
        })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Gagal menyimpan.");
      perf = d.perf;
      showToast("Snapshot performa tersimpan.");
      renderPerfHistory(container, perf);
    } catch (err) {
      showToast(err.message || "Gagal menyimpan snapshot.");
    } finally {
      saveBtn.disabled = false;
    }
  });
  grid.appendChild(saveBtn);
  container.appendChild(grid);

  renderPerfHistory(container, perf);
}

function renderPerfHistory(container, perf) {
  let hist = container.querySelector(".perf-hist");
  if (!hist) {
    hist = document.createElement("div");
    hist.className = "perf-hist";
    container.appendChild(hist);
  }
  hist.innerHTML = "";
  const records = perf.records || [];
  if (!records.length) return;
  const title = document.createElement("p");
  title.className = "field-label";
  title.textContent = `HISTORY (${records.length} snapshot)`;
  hist.appendChild(title);
  for (const rec of records.slice(-6).reverse()) {
    const line = document.createElement("div");
    line.className = "af-row";
    const main = document.createElement("div");
    main.className = "rr-main";
    const strong = document.createElement("strong");
    strong.textContent = new Date(rec.at).toLocaleString();
    const meta = document.createElement("span");
    meta.textContent = `${rec.views.toLocaleString()} views · ${rec.likes.toLocaleString()} likes · ${rec.comments.toLocaleString()} comments · ${rec.shares.toLocaleString()} shares · engagement ${engagementPct(rec)}`;
    main.appendChild(strong);
    main.appendChild(meta);
    line.appendChild(main);
    hist.appendChild(line);
  }
}

// ================= ANALYTICS + CONTENT DNA (#10-12) ==========================
// Semua dari Performance Ledger (input aktual user) + skor engine.
// Tidak ada views/likes karangan; korelasi dilabel observasional.

const analyticsCache = { details: new Map(), perf: new Map() };

function latestRecord(perf) {
  return perf && perf.records && perf.records.length ? perf.records[perf.records.length - 1] : null;
}

async function loadAnalytics() {
  const emptyEl = document.getElementById("analyticsEmpty");
  const panels = document.getElementById("analyticsPanels");
  if (!emptyEl || !panels) return;

  // 1) Ledger untuk ≤20 export terbaru (cache per filename)
  const targets = state.exports.slice(0, 20);
  const ledger = [];
  for (const item of targets) {
    if (!analyticsCache.perf.has(item.filename)) {
      try {
        const r = await fetch(`/api/perf/${encodeURIComponent(item.filename)}`);
        const d = await r.json();
        analyticsCache.perf.set(item.filename, r.ok && d.perf ? d.perf : { records: [] });
      } catch { analyticsCache.perf.set(item.filename, { records: [] }); }
    }
    const perf = analyticsCache.perf.get(item.filename);
    const rec = latestRecord(perf);
    if (rec) ledger.push({ item, perf, rec });
  }

  const totalViews = ledger.reduce((n, l) => n + (Number(l.rec.views) || 0), 0);
  if (!ledger.length || !totalViews) {
    emptyEl.hidden = false;
    panels.hidden = true;
    return;
  }
  emptyEl.hidden = true;
  panels.hidden = false;

  // 2) Join intel: clipId (dari info.txt) → project detail (skor/hookType/duration)
  const byName = new Map(state.projects.map((p) => [p.name, p.id]));
  for (const l of ledger) {
    l.clip = null;
    const pid = l.item.project ? byName.get(l.item.project) : null;
    const cid = Number(l.item.clipId);
    if (!pid || !cid) continue;
    if (!analyticsCache.details.has(pid)) {
      try {
        const r = await fetch(`/api/projects/${pid}`);
        const d = await r.json();
        analyticsCache.details.set(pid, r.ok ? d : null);
      } catch { analyticsCache.details.set(pid, null); }
    }
    const detail = analyticsCache.details.get(pid);
    if (detail && Array.isArray(detail.clips)) {
      l.clip = detail.clips.find((c) => Number(c.id) === cid) || null;
      l.projectId = pid;
    }
  }

  // 3) Totals
  $("#anViews").textContent = ledger.reduce((n, l) => n + (Number(l.rec.views) || 0), 0).toLocaleString();
  $("#anLikes").textContent = ledger.reduce((n, l) => n + (Number(l.rec.likes) || 0), 0).toLocaleString();
  $("#anComments").textContent = ledger.reduce((n, l) => n + (Number(l.rec.comments) || 0), 0).toLocaleString();
  $("#anShares").textContent = ledger.reduce((n, l) => n + (Number(l.rec.shares) || 0), 0).toLocaleString();

  // 4) Top clips by views (dengan skor engine bila ter-link)
  const topWrap = document.getElementById("anTop");
  topWrap.innerHTML = "";
  [...ledger].sort((a, b) => (Number(b.rec.views) || 0) - (Number(a.rec.views) || 0)).slice(0, 5).forEach((l, i) => {
    const row = document.createElement("div");
    row.className = "rr-row";
    const rank = document.createElement("span");
    rank.className = "tc-rank";
    rank.textContent = `#${i + 1}`;
    const main = document.createElement("div");
    main.className = "rr-main";
    const nameEl = document.createElement("strong");
    nameEl.textContent = l.item.hook || l.item.filename;
    nameEl.title = l.item.filename;
    const meta = document.createElement("span");
    meta.textContent = [
      `${Number(l.rec.views).toLocaleString()} views`,
      `eng ${engagementPct(l.rec)}`,
      l.clip && typeof l.clip.score === "number" ? `engine score ${Math.round(Number(l.clip.score))}` : null
    ].filter(Boolean).join(" · ");
    main.appendChild(nameEl);
    main.appendChild(meta);
    row.appendChild(rank);
    row.appendChild(main);
    topWrap.appendChild(row);
  });

  // 5) Platform breakdown (platform diisi manual di ledger)
  const platWrap = document.getElementById("anPlatforms");
  platWrap.innerHTML = "";
  const byPlat = {};
  for (const l of ledger) {
    const key = (l.perf.platform || "").trim() || "(belum ditandai)";
    byPlat[key] = (byPlat[key] || 0) + (Number(l.rec.views) || 0);
  }
  Object.entries(byPlat).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    const li = document.createElement("li");
    li.className = "ok";
    li.textContent = `${k}: ${v.toLocaleString()} views`;
    platWrap.appendChild(li);
  });

  // 6) Growth & velocity — hanya dari snapshot yang benar-benar ada
  const growth = document.getElementById("anGrowth");
  growth.innerHTML = "";
  let prevSum = 0;
  const dated = ledger.flatMap((l) => l.perf.records.map((r) => ({ ...r, file: l.item.filename })));
  const sortedRecs = dated.sort((a, b) => a.at - b.at);
  if (sortedRecs.length >= 2) {
    const lastT = sortedRecs[sortedRecs.length - 1].at;
    const firstT = sortedRecs[0].at;
    const lastViews = sortedRecs.filter((r) => r.at === lastT).reduce((n, r) => n + (Number(r.views) || 0), 0);
    const firstViews = sortedRecs.filter((r) => r.at === firstT).reduce((n, r) => n + (Number(r.views) || 0), 0);
    const days = Math.max(1, Math.round((lastT - firstT) / 86400000));
    const delta = lastViews - firstViews;
    const li1 = document.createElement("li");
    li1.className = delta >= 0 ? "ok" : "warn";
    li1.textContent = `Growth: ${delta >= 0 ? "+" : ""}${delta.toLocaleString()} views dibanding snapshot pertama (${days} hari).`;
    growth.appendChild(li1);
    const velocity = (lastViews / days).toLocaleString(undefined, { maximumFractionDigits: 0 });
    const li2 = document.createElement("li");
    li2.className = "ok";
    li2.textContent = `Observed velocity ≈ ${velocity} views/hari (rata-rata sejak snapshot pertama).`;
    growth.appendChild(li2);
  } else {
    const li = document.createElement("li");
    li.className = "warn";
    li.textContent = "Simpan ≥2 snapshot untuk melihat growth & velocity.";
    growth.appendChild(li);
  }

  // 7) Content DNA — observed bests dari join ledger × intel
  const dna = document.getElementById("anDNA");
  dna.innerHTML = "";
  const linked = ledger.filter((l) => l.clip && typeof l.clip.score === "number" && Number(l.rec.views) > 0);
  const groupAvg = (keyFn) => {
    const g = {};
    for (const l of linked) {
      const k = keyFn(l);
      if (!k) continue;
      (g[k] = g[k] || { sum: 0, n: 0 }).sum += Number(l.rec.views);
      g[k].n += 1;
    }
    return Object.entries(g).map(([k, v]) => ({ k, avg: v.sum / v.n, n: v.n })).sort((a, b) => b.avg - a.avg);
  };
  const addDna = (text) => {
    if (!text) return;
    const li = document.createElement("li");
    li.className = "ok";
    li.textContent = text;
    dna.appendChild(li);
  };
  const byHook = groupAvg((l) => l.clip.hookType);
  if (byHook.length && byHook[0].n >= 1) addDna(`Hook type dengan views tertinggi (observed): ${byHook[0].k} — avg ${Math.round(byHook[0].avg).toLocaleString()} views.`);
  const byDur = groupAvg((l) => {
    const d = (Number(l.clip.end) || 0) - (Number(l.clip.start) || 0);
    if (d < 30) return "<30s";
    if (d < 45) return "30–45s";
    if (d < 60) return "45–60s";
    return "≥60s";
  });
  if (byDur.length) addDna(`Durasi dengan views tertinggi (observed): bucket ${byDur[0].k}.`);
  const byRatio = groupAvg(() => "");
  const ratioCount = {};
  for (const l of ledger) { const k = l.item.ratio || ""; if (k) ratioCount[k] = (ratioCount[k] || 0) + 1; }
  const topRatio = Object.entries(ratioCount).sort((a, b) => b[1] - a[1])[0];
  if (topRatio) addDna(`Format paling sering diproduksi: ${topRatio[0]} (${topRatio[1]} file).`);
  // Prediction vs actual (observational): apakah clip berskor tertinggi juga paling banyak dilihat?
  const withBoth = linked.slice().sort((a, b) => b.clip.score - a.clip.score);
  if (withBoth.length >= 2) {
    const topScoredViewRank = withBoth.map((l) => Number(l.rec.views));
    const isTopAlsoBest = Math.max(...topScoredViewRank) === topScoredViewRank[0];
    addDna(isTopAlsoBest
      ? "Clip dengan skor engine tertinggi juga yang paling banyak dilihat (observasi awal)."
      : "Clip skor tertinggi BELUM menjadi yang paling banyak dilihat (observasi awal).");
    addDna("Korelasi tidak disimpulkan sebagai sebab-akibat; data observasional.");
  } else if (linked.length === 1) {
    addDna("Butuh ≥2 clip ter-link untuk membandingkan prediksi vs aktual.");
  }
  computeProductionInsights();
}

$("#anRefreshBtn").addEventListener("click", () => loadAnalytics());

async function updateDashboardAvgScore() {
  const el = document.getElementById("kpiScore");
  const hint = document.getElementById("kpiScoreHint");
  if (!el) return;
  const recent = state.projects.slice(0, 8);
  const details = await Promise.all(recent.map((p) =>
    fetch(`/api/projects/${p.id}`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
  ));
  let sum = 0;
  let n = 0;
  for (const d of details) {
    const cs = Array.isArray(d && d.clips) ? d.clips : [];
    for (const c of cs) {
      if (typeof c.score === "number" && Number.isFinite(c.score)) { sum += c.score; n += 1; }
    }
  }
  renderRecentResults(details);
  renderDashTopClips(details);
  renderDashboardInsights(details, { scoredClips: n, totalScore: sum });
  if (!n) {
    el.textContent = "—";
    el.classList.add("is-empty");
    if (hint) hint.textContent = "No data yet";
    return;
  }
  el.classList.remove("is-empty");
  el.textContent = String(Math.round(sum / n));
  if (hint) hint.textContent = `from ${n} scored clips`;
}

// Dashboard — kartu RECENT RESULTS dari detail project yang SAMA dengan
// perhitungan avg score (tanpa API call tambahan).
function renderRecentResults(details) {
  const wrap = document.getElementById("dashRecentResults");
  const pill = document.getElementById("dashRecentPill");
  if (!wrap) return;
  const withClips = (details || []).filter((d) => d && Array.isArray(d.clips) && d.clips.length);
  if (!withClips.length) {
    wrap.innerHTML = '<div class="empty-state">NO RECENT RESULTS &mdash; complete an analysis to see outcomes here.</div>';
    if (pill) pill.hidden = true;
    return;
  }
  const latest = withClips[0];
  const analyzedCount = latest.clips.filter((c) => c.score != null || !!c.analysis).length;
  const topScore = latest.clips.reduce((max, c) => {
    const s = Number(c.score);
    return Number.isFinite(s) && s > max ? s : max;
  }, -1);

  wrap.innerHTML = "";
  const row = document.createElement("div");
  row.className = "rr-row";

  const main = document.createElement("div");
  main.className = "rr-main";
  const nameEl = document.createElement("strong");
  nameEl.textContent = latest.name || "—";
  const metaEl = document.createElement("span");
  metaEl.textContent = `${latest.clips.length} clips · ${analyzedCount} analyzed`;
  main.appendChild(nameEl);
  main.appendChild(metaEl);
  row.appendChild(main);

  const top = document.createElement("div");
  top.className = "rr-top";
  const em = document.createElement("em");
  em.textContent = "TOP CLIP SCORE";
  const b = document.createElement("b");
  b.textContent = topScore > -1 ? String(Math.round(topScore)) : "—";
  top.appendChild(em);
  top.appendChild(b);
  row.appendChild(top);

  const viewBtn = document.createElement("button");
  viewBtn.type = "button";
  viewBtn.className = "secondary-button compact";
  viewBtn.textContent = "VIEW RESULTS";
  viewBtn.addEventListener("click", () => openResultsForProject(latest.id));
  row.appendChild(viewBtn);

  wrap.appendChild(row);
  if (pill) { pill.hidden = false; pill.textContent = "latest"; }
}

function renderDashboardProjects(projects) {
  const list = document.getElementById("dashboardProjects");
  if (!list) return;
  list.innerHTML = "";
  if (!projects.length) {
    list.innerHTML = '<div class="empty-state">Waiting for first project.</div>';
    return;
  }
  for (const project of projects.slice(0, 8)) {
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

    const pill = document.createElement("span");
    const hasTranscript = project.transcriptStatus && project.transcriptStatus !== "No transcript";
    pill.className = `status-pill ${hasTranscript ? "status-pill-done" : "status-pill-queued"}`;
    pill.textContent = hasTranscript ? "Ready" : "No transcript";

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "secondary-button compact";
    openBtn.setAttribute("data-open-project", project.id);
    openBtn.setAttribute("aria-label", `Open project ${project.name}`);
    openBtn.textContent = "Open";

    row.appendChild(main);
    row.appendChild(date);
    row.appendChild(pill);
    row.appendChild(openBtn);
    list.appendChild(row);
  }
}

function setDashChip(id, chipState, text, title = "") {
  const chip = document.getElementById(id);
  if (!chip) return;
  chip.dataset.state = chipState;
  const b = chip.querySelector("b");
  if (b) b.textContent = text;
  chip.title = title;
}

async function updateDashboardEngineStatus() {
  const stamp = document.getElementById("dashEngineStamp");
  try {
    const [sysRes, aiRes, qRes] = await Promise.all([
      fetch("/api/system").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/localai/status").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/queue").then((r) => (r.ok ? r.json() : null)).catch(() => null)
    ]);

    if (sysRes) {
      const hw = sysRes.hardware || {};
      const cpu = hw.cpu || {};
      const gpu = hw.gpu || {};
      const cuda = hw.cuda || {};
      const nvenc = hw.nvenc || {};
      setDashChip("dashCpu", cpu.cores ? "ok" : "unknown",
        cpu.model ? `${cpu.model} · ${cpu.cores} core`.slice(0, 34) : (cpu.cores ? `${cpu.cores} core` : "—"),
        cpu.model || "");
      if (gpu.present) {
        setDashChip("dashGpu", cuda.available ? "ok" : "busy",
          `${gpu.name}${gpu.vramGb ? ` · ${gpu.vramGb} GB` : ""}`.slice(0, 30),
          cuda.available ? "CUDA ready" : "GPU detected, runtime tanpa CUDA — fallback CPU");
      } else {
        setDashChip("dashGpu", "idle", "Not detected", "Mode CPU");
      }
      // Endpoint system hidup = ffmpeg server berfungsi (dipakai probe/NVENC check).
      setDashChip("dashFfmpeg", "ok", nvenc && nvenc.available ? "NVENC ready" : "CPU encode",
        nvenc && nvenc.available ? "Hardware encode aktif" : "Encode lewat CPU");
    } else {
      setDashChip("dashCpu", "offline", "Offline");
      setDashChip("dashGpu", "offline", "—");
      setDashChip("dashFfmpeg", "offline", "Offline");
    }

    if (aiRes) {
      const be = aiRes.aiBackend || {};
      const spk = String(be.speaker || "skip");
      const face = String(be.face || "skip");
      const anyOn = spk !== "skip" || face !== "skip";
      setDashChip("dashAi", anyOn ? "ok" : "idle",
        anyOn ? `${spk}/${face}`.slice(0, 24) : "models off",
        `Speaker: ${spk} · Face: ${face}`);
    } else {
      setDashChip("dashAi", sysRes ? "unknown" : "offline", sysRes ? "—" : "Offline");
    }

    const jobs = qRes && Array.isArray(qRes.jobs) ? qRes.jobs : null;
    if (jobs) {
      const running = jobs.filter((j) => j.status === "running").length;
      const queued = jobs.filter((j) => j.status === "queued").length;
      if (running > 0) setDashChip("dashQueue", "busy", `${running} running${queued ? ` +${queued}` : ""}`);
      else if (queued > 0) setDashChip("dashQueue", "idle", `${queued} queued`);
      else setDashChip("dashQueue", "ok", "Ready");
    } else {
      setDashChip("dashQueue", sysRes ? "unknown" : "offline", sysRes ? "—" : "Offline");
    }

    if (stamp) stamp.textContent = "live";
  } catch {
    ["dashCpu", "dashGpu", "dashFfmpeg", "dashAi", "dashQueue"].forEach((id) => setDashChip(id, "offline", "Offline"));
    if (stamp) stamp.textContent = "offline";
  }
}

function initDashboard() {
  const greetEl = document.getElementById("dashGreeting");
  if (greetEl) {
    const h = new Date().getHours();
    greetEl.textContent = h < 11 ? "Good morning" : h < 15 ? "Good afternoon" : "Good evening";
  }
  const cta = document.getElementById("dashNewProjectBtn");
  if (cta) cta.addEventListener("click", openCreateWorkspace);
  const list = document.getElementById("dashboardProjects");
  if (list) list.addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-open-project]");
    if (!btn) return;
    const projectId = btn.getAttribute("data-open-project");
    try {
      const response = await fetch(`/api/projects/${projectId}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Gagal memuat project.");
      loadProject(data);
      showView("studio");
      showToast(`Project "${data.name}" dimuat.`);
    } catch (err) {
      showToast(err.message || "Gagal memuat project.");
    }
  });
  loadDashboardData();
  setInterval(() => {
    const panel = document.querySelector('[data-view-panel="dashboard"]');
    if (panel && panel.classList.contains("active")) updateDashboardEngineStatus();
  }, 30000);
}

// ================= PROCESSING WORKSPACE (Phase 2) =================
// Semua state dari job nyata server (/api/jobs/:id, /api/queue).
// Tidak ada progres buatan, tidak ada job ID karangan.

const PIPELINE_STAGES = {
  // Label tahap HARUS sama dengan yang dikirim worker analyzeLocalUpload.
  "upload-analyze": [
    "Menyiapkan berkas",
    "Ekstraksi audio",
    "Transkripsi suara (STT)",
    "Analisis hook viral",
    "Menganalisis struktur cerita",
    "Menyiapkan clip",
    "Skor & judul Deep AI"
  ]
};

// Peta tahap → engine untuk indikator per-engine (dari stage nyata server).
const PROC_ENGINES = [
  { chip: "engSource", stage: PIPELINE_STAGES["upload-analyze"][0], label: "SOURCE" },
  { chip: "engFfmpeg", stage: PIPELINE_STAGES["upload-analyze"][1], label: "FFMPEG" },
  { chip: "engWhisper", stage: PIPELINE_STAGES["upload-analyze"][2], label: "WHISPER" },
  { chip: "engHook", stage: PIPELINE_STAGES["upload-analyze"][3], label: "HOOK" },
  { chip: "engStory", stage: PIPELINE_STAGES["upload-analyze"][4], label: "STORY" },
  { chip: "engScore", stage: PIPELINE_STAGES["upload-analyze"][5], label: "SCORING" },
  { chip: "engDeep", stage: PIPELINE_STAGES["upload-analyze"][6], label: "DEEP TITLE" }
];

function setProcEngine(chipId, state, text) {
  const chip = document.getElementById(chipId);
  if (!chip) return;
  chip.dataset.state = state;
  const b = chip.querySelector("b");
  if (b) b.textContent = text;
}

function renderProcEngines(jobType, currentStage, done) {
  const wrapEl = document.getElementById("procEngineWrap");
  const stages = PIPELINE_STAGES[jobType];
  if (!wrapEl) return;
  if (!stages) { wrapEl.style.display = "none"; return; }
  wrapEl.style.display = "";
  const curIdx = stages.indexOf(currentStage);
  for (const eng of PROC_ENGINES) {
    const idx = stages.indexOf(eng.stage);
    if (done) setProcEngine(eng.chip, "ok", "DONE");
    else if (curIdx === -1) setProcEngine(eng.chip, "idle", "WAITING");
    else if (idx < curIdx) setProcEngine(eng.chip, "ok", "DONE");
    else if (idx === curIdx) setProcEngine(eng.chip, "busy", "ACTIVE");
    else setProcEngine(eng.chip, "idle", "WAITING");
  }
}

const processingState = {
  jobId: null,
  projectId: null,
  label: "",
  status: "idle",
  progress: 0,
  stage: "",
  startedAt: 0,
  error: null,
  retryFn: null,
  lastType: "",
  timer: 0
};

function formatMMss(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function fillSourceInfo(name, probe) {
  const card = document.getElementById("sourceInfoCard");
  if (!card || !probe) return;
  const p = probe || {};
  $("#siName").textContent = name || "—";
  $("#siDuration").textContent = p.duration ? formatTime(p.duration) : "—";
  $("#siRes").textContent = p.width && p.height ? `${p.width} × ${p.height}` : "—";
  $("#siFps").textContent = p.fps ? `${p.fps} FPS` : "—";
  $("#siAudio").textContent = p.hasAudio === true ? "Audio detected" : p.hasAudio === false ? "No audio" : "—";
  card.hidden = false;
}

async function applyProjectNamePatch(projectId) {
  const input = document.getElementById("projectNameInput");
  const custom = input ? input.value.trim() : "";
  if (!projectId || !custom) return;
  try {
    await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: custom })
    });
    const entry = state.projects.find((p) => p.id === projectId);
    if (entry) entry.name = custom;
    $("#fileTitle").textContent = custom;
  } catch {}
}

// ---- Engine Readiness: semua dari API nyata, tidak ada status karangan ----
const readinessCache = { stt: undefined, sttAt: 0 };

function setEr(id, state, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.dataset.state = state;
  el.textContent = text;
}

async function checkEngineReadiness(force = false) {
  const wantStt = force || readinessCache.stt === undefined || Date.now() - readinessCache.sttAt > 120000;
  const [sys, ai, stt] = await Promise.all([
    fetch("/api/system").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch("/api/localai/status").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    wantStt
      ? fetch("/api/stt/models").then((r) => (r.ok ? r.json() : { models: [] })).then((d) => {
          readinessCache.stt = d; readinessCache.sttAt = Date.now(); return d;
        }).catch(() => null)
      : Promise.resolve(readinessCache.stt)
  ]);

  const hw = sys && sys.hardware ? sys.hardware : {};
  const cpu = hw.cpu || {};
  const gpu = hw.gpu || {};
  const cuda = hw.cuda || {};
  const nvenc = hw.nvenc || {};

  // CPU/GPU/FFmpeg: endpoint /api/system hidup = backend & ffmpeg berfungsi.
  setEr("erCpu", cpu.cores ? "ready" : (sys ? "unknown" : "offline"),
    cpu.cores ? `READY · ${cpu.cores} CORE` : (sys ? "UNKNOWN" : "OFFLINE"));
  setEr("erGpu",
    gpu.present ? (cuda.available ? "ready" : "busy") : (sys ? "idle" : "offline"),
    gpu.present
      ? (cuda.available ? "READY · CUDA" : "BUSY · DETECTED, CPU FALLBACK")
      : (sys ? "NOT DETECTED" : "OFFLINE"));
  setEr("erFfmpeg", sys ? "ready" : "offline", sys ? (nvenc.available ? "READY · NVENC" : "READY") : "OFFLINE");

  // STT: /api/stt/models menjalankan runtime Python list-models.
  if (stt && Array.isArray(stt.models)) {
    setEr("erStt", "ready", `READY · ${stt.models.length} MODEL`);
  } else {
    setEr("erStt", sys ? "error" : "offline", sys ? "! ERROR" : "OFFLINE");
  }

  // Local AI: backend speaker/face nyata dari /api/localai/status.
  const be = ai && ai.aiBackend ? ai.aiBackend : {};
  const spk = String(be.speaker || "");
  const face = String(be.face || "");
  const aiOn = (spk && spk !== "skip") || (face && face !== "skip");
  setEr("erAi", ai ? (aiOn ? "ready" : "idle") : (sys ? "unknown" : "offline"),
    ai ? (aiOn ? `READY · ${`${spk}/${face}`.slice(0, 20).toUpperCase()}` : "MODELS OFF") : (sys ? "UNKNOWN" : "OFFLINE"));

  // Hook/Caption engine: module lokal yang di-require server saat boot —
  // server hidup berarti engine termuat; tidak ada klaim lebih jauh.
  setEr("erHook", sys ? "ready" : "offline", sys ? "READY" : "OFFLINE");
  setEr("erCaption", sys ? "ready" : "offline", sys ? "READY" : "OFFLINE");

  const summary = document.getElementById("erSummary");
  if (summary) {
    const coreReady = Boolean(sys) && Boolean(stt);
    summary.textContent = coreReady ? "SYSTEM READY" : (sys ? "PARTIAL — CHECK ITEMS ABOVE" : "SERVER OFFLINE");
    summary.dataset.state = coreReady ? "ready" : "partial";
  }
}

// ---- Processing view controller ----
// Tiering Analysis Complete: bucket presentasi dari SKOR BACKEND ASLI.
// Threshold eksplisit di sini hanya mengelompokkan, tidak mengubah nilai.
const SCORE_TIERS = [
  { key: "HIGH POTENTIAL", min: 85 },
  { key: "STRONG", min: 70 },
  { key: "MODERATE", min: 50 },
  { key: "LOW", min: 0 }
];

function scoreTierOf(score) {
  const s = Number(score);
  if (!Number.isFinite(s)) return null;
  return SCORE_TIERS.find((t) => s >= t.min) || SCORE_TIERS[SCORE_TIERS.length - 1];
}

function renderScoreTiers(clips, wrapId) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  const counts = {};
  let scored = 0;
  for (const c of clips || []) {
    const t = scoreTierOf(c && c.score);
    if (!t) continue;
    scored += 1;
    counts[t.key] = (counts[t.key] || 0) + 1;
  }
  if (!scored) { wrap.hidden = true; wrap.innerHTML = ""; return; }
  wrap.hidden = false;
  wrap.innerHTML = "";
  for (const t of SCORE_TIERS) {
    const chip = document.createElement("span");
    chip.className = `tier-chip tier-${t.key.split(" ")[0].toLowerCase()}`;
    chip.textContent = `${t.key} · ${counts[t.key] || 0}`;
    wrap.appendChild(chip);
  }
}

function setProcPill(state, text) {
  const pill = document.getElementById("procStatePill");
  if (!pill) return;
  pill.dataset.state = state;
  pill.className = `status-pill ${statusPillClass(state === "analyzing" || state === "processing" ? "running" : state === "completed" ? "done" : state === "failed" ? "failed" : state === "cancelled" ? "cancelled" : "queued")}`;
  pill.textContent = text;
}

function enterProcessingView(jobId, label, retryFn, opts = {}) {
  processingState.jobId = jobId || null;
  processingState.projectId = opts.projectId || null;
  processingState.label = label || "Processing";
  processingState.retryFn = retryFn || null;
  processingState.status = jobId ? "preparing" : "preparing";
  processingState.progress = 0;
  processingState.stage = "";
  processingState.startedAt = Date.now();
  processingState.error = null;

  $("#procTitle").textContent = processingState.label;
  $("#procJobId").textContent = jobId ? String(jobId).slice(0, 8).toUpperCase() : "Preparing…";
  $("#procErrorBox").hidden = true;
  $("#procRetryBtn").hidden = true;
  $("#procResultsBtn").hidden = true;
  $("#procCancelBtn").hidden = !jobId;
  $("#procCancelBtn").disabled = false;
  $("#procFill").style.width = "0%";
  $("#procPct").textContent = "0%";
  $("#procTask").textContent = "Waiting to start…";
  $("#procEta").textContent = "—";
  $("#procElapsed").textContent = "00:00";
  renderProcEngines(processingState.lastType || "upload-analyze", "", false);
  setProcPill("preparing", "PREPARING");

  window.clearInterval(processingState.timer);
  processingState.timer = window.setInterval(() => {
    if (processingState.status !== "running" && processingState.status !== "preparing" && processingState.status !== "analyzing") return;
    $("#procElapsed").textContent = formatMMss((Date.now() - processingState.startedAt) / 1000);
  }, 1000);

  showView("processing");

  if (opts.passive && jobId) {
    waitForJob(jobId, { onUpdate: renderProcessingTick })
      .then((result) => completeProcessingView(result))
      .catch((err) => failProcessingView(err));
  }
}

function renderProcessingTick(job) {
  if (!job || job.id !== processingState.jobId) return;
  processingState.lastType = job.type;
  processingState.stage = job.stage || "";
  processingState.progress = Number(job.progress) || 0;
  if (["done", "failed", "cancelled"].includes(job.status)) return;
  processingState.status = "analyzing";
  setProcPill("analyzing", "ANALYZING");

  $("#procFill").style.width = `${processingState.progress}%`;
  $("#procPct").textContent = `${Math.round(processingState.progress)}%`;
  $("#procTask").textContent = job.stage || JOB_LABELS[job.type] || "Working…";
  renderProcEngines(job.type, job.stage || "", false);

  const pctNum = processingState.progress;
  if (pctNum >= 10) {
    const elapsedSec = (Date.now() - processingState.startedAt) / 1000;
    const etaSec = (elapsedSec / pctNum) * (100 - pctNum);
    $("#procEta").textContent = formatMMss(etaSec);
  }

  const stages = PIPELINE_STAGES[job.type];
  const list = $("#procPipeline");
  const labelEl = $("#procPipelineLabel");
  if (!stages) {
    if (list) list.innerHTML = "";
    if (labelEl) labelEl.style.display = "none";
    return;
  }
  if (labelEl) labelEl.style.display = "";
  const curIdx = stages.indexOf(job.stage);
  list.innerHTML = "";
  stages.forEach((name, i) => {
    const li = document.createElement("li");
    if (curIdx > -1) {
      li.className = i < curIdx ? "done" : i === curIdx ? "current" : "";
    } else if (job.progress >= 99) {
      li.className = "current";
    }
    li.textContent = name;
    list.appendChild(li);
  });
}

function completeProcessingView(result) {
  processingState.status = "completed";
  window.clearInterval(processingState.timer);
  $("#procElapsed").textContent = formatMMss((Date.now() - processingState.startedAt) / 1000);
  $("#procFill").style.width = "100%";
  $("#procPct").textContent = "100%";
  $("#procEta").textContent = "00:00";
  setProcPill("completed", "COMPLETED");
  $("#procCancelBtn").hidden = true;
  $("#procResultsBtn").hidden = false;

  const clipCount = result && Array.isArray(result.clips) ? result.clips.length : null;
  $("#procTask").textContent = clipCount != null
    ? `ANALYSIS COMPLETE — ${clipCount} potential clips found.`
    : (JOB_DONE[processingState.lastType] || "COMPLETED");

  const list = $("#procPipeline");
  if (list && list.children.length) {
    [...list.children].forEach((li) => { li.className = "done"; });
  }
  renderProcEngines(processingState.lastType, "", true);
  renderScoreTiers(result && result.clips, "procTierStrip");
}

async function failProcessingView(err) {
  window.clearInterval(processingState.timer);
  let terminalStatus = "failed";
  if (processingState.jobId) {
    try {
      const r = await fetch(`/api/jobs/${processingState.jobId}`);
      if (r.ok) terminalStatus = (await r.json()).status || "failed";
    } catch {}
  }
  console.error("[processing]", err);

  if (terminalStatus === "cancelled") {
    processingState.status = "cancelled";
    setProcPill("cancelled", "CANCELLED");
    $("#procTask").textContent = "JOB CANCELLED — Processing stopped safely.";
    $("#procFill").style.width = "0%";
  } else {
    processingState.status = "failed";
    processingState.error = err.message || "Unknown error";
    setProcPill("failed", "FAILED");
    $("#procErrorReason").textContent = processingState.error;
    $("#procErrorBox").hidden = false;
    $("#procTask").textContent = "PROCESSING FAILED";
  }
  $("#procCancelBtn").hidden = true;
  $("#procRetryBtn").hidden = !processingState.retryFn;
}

function openProcessingForJob(jobId, label) {
  enterProcessingView(jobId, label || "Job", null, { passive: true });
}

$("#procCancelBtn").addEventListener("click", async () => {
  if (!processingState.jobId) return;
  const btn = $("#procCancelBtn");
  btn.disabled = true;
  try {
    await fetch(`/api/jobs/${encodeURIComponent(processingState.jobId)}`, { method: "DELETE" });
  } catch (err) {
    showToast(err.message || "Gagal membatalkan job.");
  }
});

$("#procRetryBtn").addEventListener("click", () => {
  const fn = processingState.retryFn;
  if (typeof fn === "function") fn();
});

$("#procResultsBtn").addEventListener("click", () => {
  if (processingState.projectId) openResultsForProject(processingState.projectId);
  else showView("studio");
});

$("#procBackBtn").addEventListener("click", () => {
  showView("dashboard");
  loadDashboardData();
});

// ================= RESULTS WORKSPACE (Phase 3) =================
// Semua nilai dari GET /api/projects/:id (manifest nyata) + POST /api/analyze-clip
// (engine ClipMe). Field yang tidak ada ditampilkan "—" — tidak ada skor judulan.

const resultsState = {
  projectId: null,
  name: "",
  sourceLabel: "",
  duration: 0,
  clips: [],
  visible: [],
  selectedClipId: null,
  status: "idle",
  analyzing: false,
  analyzingClipId: null,
  transcripts: {}
};

function resIsAnalyzed(clip) {
  return clip.score != null || !!clip.analysis;
}

async function openResultsForProject(projectId, selectClipId = null) {
  if (!projectId) return;
  showView("results");
  setResPill("loading", "LOADING");
  try {
    const response = await fetch(`/api/projects/${projectId}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Gagal memuat project.");
    resultsState.projectId = data.id;
    resultsState.name = data.name || "";
    resultsState.sourceLabel = data.url || String(data.type || "local").toUpperCase();
    resultsState.duration = Number(data.probe && data.probe.duration) || 0;
    resultsState.clips = Array.isArray(data.clips) ? data.clips : [];
    resultsState.selectedIds = resultsState.selectedIds || new Set();
    resultsState.selectedIds.clear();
    const wanted = selectClipId != null
      ? resultsState.clips.find((c) => c.id === selectClipId)
      : null;
    resultsState.selectedClipId = wanted ? wanted.id : null;
    resultsState.transcripts = {};
    resultsState.status = resultsState.clips.length ? "ready" : "empty";
    $("#resErrorBox").hidden = true;
    renderResultsAll();
  } catch (err) {
    console.error("[results]", err);
    showToast(err.message || "Gagal memuat hasil.");
  }
}

function setResPill(stateKey, text) {
  const pill = document.getElementById("resStatePill");
  if (!pill) return;
  pill.className = `status-pill ${statusPillClass(
    stateKey === "ready" ? "done" : stateKey === "failed" ? "failed" : stateKey === "partial" ? "running" : "queued"
  )}`;
  pill.textContent = text;
}

// Jumlah clip yang sudah dianalisis (skor/analysis ada) — dipakai header Results.
function resAnalyzedCount() {
  return resultsState.clips.filter(resIsAnalyzed).length;
}

function renderResultsAll() {
  renderResHeader();
  applyResView();
  const sel = resultsState.clips.find((c) => c.id === resultsState.selectedClipId);
  if (sel) fillResultIntel(sel);
}

function renderResHeader() {
  $("#resProjectName").textContent = resultsState.name || "—";
  $("#resSource").textContent = resultsState.sourceLabel || "—";
  $("#resDuration").textContent = resultsState.duration ? formatTime(resultsState.duration) : "—";
  $("#resClipsCount").textContent = String(resultsState.clips.length);
  $("#resAnalyzed").textContent = `${resAnalyzedCount()} / ${resultsState.clips.length}`;
  renderScoreTiers(resultsState.clips, "resTierStrip");
  $("#analyzeAllBtn").disabled = !resultsState.clips.length || resultsState.analyzing;
  if (resultsState.analyzing) setResPill("analyzing", "ANALYZING");
  else if (!resultsState.clips.length) setResPill("idle", "NO RESULTS");
  else setResPill("ready", `${resultsState.clips.length} CLIPS FOUND`);
}

function applyResView() {
  const list = document.getElementById("resultsClipList");
  if (!list) return;
  const q = ($("#resSearch").value || "").trim().toLowerCase();
  const mode = $("#resFilter").value;
  const sort = $("#resSort").value;

  let arr = resultsState.clips.slice();
  if (mode === "top") arr = arr.filter((c) => Number.isFinite(Number(c.score)));
  if (mode === "analyzed") arr = arr.filter(resIsAnalyzed);
  if (mode === "unanalyzed") arr = arr.filter((c) => !resIsAnalyzed(c));
  if (q) {
    arr = arr.filter((c) => {
      const hay = [c.title, c.deepTitle, c.hook, c.caption, c.recommendedHook, c.analysis && c.analysis.keyMessage]
        .map((v) => String(v || "").toLowerCase()).join(" ");
      return hay.includes(q);
    });
  }
  if (sort === "scoreDesc") arr.sort((a, b) => (Number(b.score) || -1) - (Number(a.score) || -1));
  if (sort === "scoreAsc") arr.sort((a, b) => (Number(a.score) || 1e9) - (Number(b.score) || 1e9));
  if (sort === "duration") arr.sort((a, b) => ((b.end - b.start) || 0) - ((a.end - a.start) || 0));
  resultsState.visible = arr;

  list.innerHTML = "";
  if (!arr.length) {
    list.innerHTML = `<div class="empty-state">${resultsState.clips.length ? "Tidak ada clip yang cocok dengan filter." : "NO CLIPS YET &mdash; run analysis to discover potential clips."}</div>`;
    return;
  }

  for (const clip of arr) {
    const dur = Math.max(0, Math.round((clip.end || 0) - (clip.start || 0)));
    const analyzed = resIsAnalyzed(clip);

    const card = document.createElement("article");
    card.className = `rc-card${clip.id === resultsState.selectedClipId ? " selected" : ""}`;
    card.dataset.clipId = clip.id;

    if (resultsState.projectId) {
      const imgWrap = document.createElement("div");
      imgWrap.className = "rc-thumb";
      const img = document.createElement("img");
      img.loading = "lazy";
      img.alt = "";
      img.src = thumbUrlFor(resultsState.projectId, clip.id);
      img.addEventListener("error", () => imgWrap.remove());
      imgWrap.appendChild(img);
      // Hook type badge overlay on thumbnail
      if (clip.hookType) {
        const badge = document.createElement("span");
        badge.className = "rc-hook-badge";
        badge.textContent = clip.hookType;
        imgWrap.appendChild(badge);
      }
      // Direct play overlay — klik thumbnail langsung putar video clip
      const playOverlay = document.createElement("button");
      playOverlay.type = "button";
      playOverlay.className = "rc-play-overlay";
      playOverlay.setAttribute("aria-label", `Play clip ${clip.id}`);
      playOverlay.innerHTML = "&#9654;";
      playOverlay.addEventListener("click", (e) => {
        e.stopPropagation();
        resultsState.selectedClipId = clip.id;
        handoffToStudio(true);
      });
      imgWrap.appendChild(playOverlay);
      card.appendChild(imgWrap);
    }

    // Title (primary text, satu baris sumber)
    const titleEl = document.createElement("p");
    titleEl.className = "rc-title";
    titleEl.textContent = clip.deepTitle || clip.recommendedHook || clip.hook || `Clip ${String(clip.id).padStart(2, "0")}`;
    card.appendChild(titleEl);

    // Meta: selector + CLIP xx + skor
    const head = document.createElement("div");
    head.className = "rc-head";
    const sel = document.createElement("label");
    sel.className = "rc-select";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = resultsState.selectedIds.has(clip.id);
    cb.setAttribute("aria-label", `Select clip ${clip.id}`);
    cb.addEventListener("click", (e) => e.stopPropagation());
    cb.addEventListener("change", () => {
      if (cb.checked) resultsState.selectedIds.add(clip.id);
      else resultsState.selectedIds.delete(clip.id);
      updateResSelectionBar();
    });
    sel.appendChild(cb);
    head.appendChild(sel);
    const idEl = document.createElement("span");
    idEl.className = "rc-id";
    idEl.textContent = `CLIP ${String(clip.id).padStart(2, "0")}${analyzed ? "" : " · NEW"}`;
    const scoreEl = document.createElement("span");
    scoreEl.className = "rc-score";
    const tierOfClip = scoreTierOf(clip.score);
    if (tierOfClip) scoreEl.classList.add(`tier-${tierOfClip.key.split(" ")[0].toLowerCase()}`);
    scoreEl.textContent = clip.score != null ? `★${Math.round(Number(clip.score))}` : "—";
    head.appendChild(idEl);
    head.appendChild(scoreEl);
    card.appendChild(head);

    const time = document.createElement("p");
    time.className = "rc-time";
    time.textContent = `${formatTime(clip.start)} → ${formatTime(clip.end)} · ${dur}s`;
    card.appendChild(time);

    // Hook quote — hanya bila berbeda dari judul (hindari duplikat teks)
    const quoteText = clip.recommendedHook || clip.hook || "";
    if (quoteText && quoteText !== titleEl.textContent.trim()) {
      const quote = document.createElement("p");
      quote.className = "rc-quote";
      quote.textContent = quoteText;
      card.appendChild(quote);
    }

    if (clip.id === resultsState.analyzingClipId) {
      const st = document.createElement("p");
      st.className = "rc-analyzing";
      st.textContent = "ANALYZING…";
      card.appendChild(st);
    }

    const actions = document.createElement("div");
    actions.className = "rc-actions";
    const playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.className = "primary-button compact";
    playBtn.textContent = "PLAY";
    playBtn.addEventListener("click", (e) => { e.stopPropagation(); resultsState.selectedClipId = clip.id; handoffToStudio(true); });
    const studioBtn = document.createElement("button");
    studioBtn.type = "button";
    studioBtn.className = "ghost-button compact";
    studioBtn.textContent = "EDIT";
    studioBtn.addEventListener("click", (e) => { e.stopPropagation(); resultsState.selectedClipId = clip.id; handoffToStudio(false); });
    const pubBtn = document.createElement("button");
    pubBtn.type = "button";
    pubBtn.className = "ghost-button compact";
    pubBtn.textContent = "PUBLISH";
    pubBtn.title = "Siapkan metadata publish dari intel clip ini";
    pubBtn.addEventListener("click", (e) => { e.stopPropagation(); openPublishForClip(clip); });
    actions.appendChild(playBtn);
    actions.appendChild(studioBtn);
    actions.appendChild(pubBtn);
    card.appendChild(actions);

    // Copy button metadata (title + hashtags) — dipisah rapi dari action utama
    const hasTags = Array.isArray(clip.analysis && clip.analysis.hashtags) && clip.analysis.hashtags.length;
    if (clip.deepTitle || hasTags) {
      const metaRow = document.createElement("div");
      metaRow.className = "rc-meta-row";
      if (clip.deepTitle) {
        const copyTitle = document.createElement("button");
        copyTitle.type = "button";
        copyTitle.className = "rc-copy-sm";
        copyTitle.textContent = "Copy Title";
        copyTitle.addEventListener("click", (e) => { e.stopPropagation(); copyToClipboard(clip.deepTitle, "title"); });
        metaRow.appendChild(copyTitle);
      }
      if (hasTags) {
        const copyTags = document.createElement("button");
        copyTags.type = "button";
        copyTags.className = "rc-copy-sm";
        copyTags.textContent = "Copy Tags";
        copyTags.addEventListener("click", (e) => {
          e.stopPropagation();
          const tags = clip.analysis.hashtags;
          const text = tags.map((t) => String(t).startsWith("#") ? t : `#${t}`).join(" ");
          copyToClipboard(text, "hashtags");
        });
        metaRow.appendChild(copyTags);
      }
      card.appendChild(metaRow);
    }

    card.addEventListener("click", () => {
      resultsState.selectedClipId = clip.id;
      $$(".rc-card").forEach((el) => el.classList.toggle("selected", el.dataset.clipId === String(clip.id)));
      fillResultIntel(clip);
    });

    list.appendChild(card);
  }
  updateResSelectionBar();
}

function fillResultIntel(clip) {
  $("#resIntelEmpty").hidden = true;
  $("#resIntelBody").hidden = false;
  const provider = document.getElementById("resIntelProvider");

  const dur = Math.max(0, Math.round((clip.end || 0) - (clip.start || 0)));
  $("#riTiming").textContent = `${formatTime(clip.start)} → ${formatTime(clip.end)}`;
  $("#riDuration").textContent = `${dur} sec`;
  $("#riScore").textContent = clip.score != null ? `${Math.round(Number(clip.score))}/100` : "—";
  $("#riHookScore").textContent = clip.hookScore != null ? `${Math.round(Number(clip.hookScore))}/100` : "—";
  $("#riHookType").textContent = clip.hookType || "—";
  $("#riOptimal").textContent = clip.optimalRange
    ? `${clip.optimalRange}s`
    : (clip.optimalDuration ? `${Math.round(clip.optimalDuration)}s` : "—");
  $("#riHook").textContent = clip.recommendedHook || clip.hook || "—";
  $("#riTitle").textContent = clip.deepTitle || "No title generated yet.";
  $("#riAltTitles").textContent = Array.isArray(clip.deepTitleAlternatives) && clip.deepTitleAlternatives.length
    ? clip.deepTitleAlternatives.map(altTitleText).filter(Boolean).map((t, i) => `${i + 1}. ${t}`).join("\n") || "—"
    : "—";
  $("#riKeyMessage").textContent = (clip.analysis && clip.analysis.keyMessage) || "—";

  if (provider) {
    const prov = clip.analysis ? (clip.analysis.provider || "clipme") : "";
    provider.hidden = !prov;
    if (prov) provider.textContent = prov;
  }

  const totalDur = resultsState.duration;
  if (totalDur > 0) {
    const left = Math.min(100, (Number(clip.start) / totalDur) * 100);
    const width = Math.max(0.5, Math.min(100 - left, ((clip.end - clip.start) / totalDur) * 100));
    const region = $("#rtRegion");
    region.style.left = `${left}%`;
    region.style.width = `${width}%`;
  } else {
    $("#rtRegion").style.left = "0%";
    $("#rtRegion").style.width = "0%";
  }
  $("#rtStart").textContent = formatTime(clip.start);
  $("#rtEnd").textContent = formatTime(Math.min(resultsState.duration || clip.end, clip.end));

  renderResTranscript(clip);
  renderClipMetadataCard(clip);
  $("#riStatus").textContent = "";
}

// ---- AI METADATA GENERATOR (title/description/hashtags) — Results card ----
let metaInflight = new Set();

function renderClipMetadataCard(clip) {
  const m = clip.metadata || null;
  const titleEl = document.getElementById("riMetaTitle");
  const descEl = document.getElementById("riMetaDesc");
  const tagsEl = document.getElementById("riMetaTags");
  if (!titleEl) return;
  titleEl.textContent = m && m.title ? m.title : "—";
  descEl.textContent = m && m.description ? m.description : "—";
  tagsEl.textContent = m && Array.isArray(m.hashtags) && m.hashtags.length ? m.hashtags.join(" ") : "—";
  const regenBtn = document.getElementById("riMetaRegen");
  if (regenBtn) {
    regenBtn.disabled = metaInflight.has(clip.id);
    regenBtn.textContent = metaInflight.has(clip.id) ? "GENERATING…" : "REGENERATE";
  }
  // Auto-generate sekali saat clip dipilih bila metadata belum ada.
  if (!m && !metaInflight.has(clip.id) && resultsState.projectId) {
    generateClipMetadata(clip, { quiet: true });
  }
}

async function generateClipMetadata(clip, opts = {}) {
  if (!resultsState.projectId || !clip) return;
  if (metaInflight.has(clip.id)) return;
  metaInflight.add(clip.id);
  renderClipMetadataCard(clip);
  try {
    const r = await fetch(`/api/projects/${resultsState.projectId}/metadata`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clipId: clip.id, regenerate: !!opts.regenerate })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Gagal generate metadata.");
    clip.metadata = d.metadata;
    const live = (resultsState.clips || []).find((c) => c.id === clip.id);
    if (live) live.metadata = d.metadata;
    if (!opts.quiet) showToast("Metadata di-generate dari konten clip.");
  } catch (err) {
    if (!opts.quiet) showToast(err.message || "Metadata gagal.");
  } finally {
    metaInflight.delete(clip.id);
    renderClipMetadataCard(clip);
  }
}

function metadataTextFor(clip) {
  const m = clip && clip.metadata;
  if (!m) return { title: "", description: "", hashtags: "" };
  return {
    title: typeof m.title === "string" ? m.title.trim() : "",
    description: typeof m.description === "string" ? m.description.trim() : "",
    hashtags: Array.isArray(m.hashtags) ? m.hashtags.map(String).join(" ").trim() : ""
  };
}

// Normalisasi deepTitleAlternatives: object {text,...} → string.
function altTitleText(t) {
  if (typeof t === "string") return t;
  if (t && typeof t === "object" && typeof t.text === "string") return t.text;
  return "";
}

function renderResTranscript(clip) {
  const wrap = document.getElementById("riTranscript");
  const lines = resultsState.transcripts[clip.id];
  wrap.innerHTML = "";
  if (!lines || !lines.length) {
    wrap.innerHTML = '<div class="empty-state">Jalankan ANALYZE pada clip ini untuk mendapat baris transkrip bertimestamp.</div>';
    return;
  }
  for (const seg of lines) {
    const row = document.createElement("div");
    row.className = "rt-line";
    const t = document.createElement("time");
    t.textContent = formatTime(seg.start);
    t.title = "Klik untuk seek preview";
    t.addEventListener("click", () => seekPreviewToSegment(clip, seg));
    const p = document.createElement("p");
    p.textContent = seg.text || "";
    row.appendChild(t);
    row.appendChild(p);
    wrap.appendChild(row);
  }
}

// Preview full-source memakai waktu absolut; section ter-bound mulai dari 0.
function seekPreviewToSegment(clip, seg) {
  if (!state.projectId) return;
  if (state.projectId !== resultsState.projectId) return;
  const abs = state.noDownload ? Number(seg.start) || 0 : (Number(clip.start) || 0) + (Number(seg.start) || 0);
  if (!previewVideo.src) { playSelectedClip(); return; }
  previewVideo.currentTime = Math.max(0, abs);
  previewVideo.play().catch(() => {});
}

async function analyzeResultClip(clip) {
  if (!resultsState.projectId || !clip || resultsState.analyzing) return false;
  resultsState.analyzing = true;
  resultsState.analyzingClipId = clip.id;
  $("#riStatus").textContent = "Menganalisis dengan ClipMe engine...";
  renderResHeader();
  applyResView();
  const sel = resultsState.clips.find((c) => c.id === resultsState.selectedClipId);
  if (sel && sel.id === clip.id) fillResultIntel(sel);

  try {
    const response = await fetch("/api/analyze-clip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: resultsState.projectId,
        clipId: clip.id,
        start: clip.start,
        end: clip.end,
        language: CAPTION_LANG,
        keepOriginal: false,
        disableRewrite: false,
        ...durationSettingsPayload()
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Analyze gagal.");
    clip.analysis = data.analysis;
    if (data.timedSegments) resultsState.transcripts[clip.id] = data.timedSegments;
    $("#riStatus").textContent = data.provider === "clipme-llm" ? "AI (LLM)" : "Heuristic";
    return true;
  } catch (err) {
    console.error("[results-analyze]", err);
    $("#riStatus").textContent = "Gagal";
    showToast(err.message || "Analyze clip gagal.");
    return false;
  } finally {
    resultsState.analyzing = false;
    resultsState.analyzingClipId = null;
    renderResHeader();
    applyResView();
    const sel2 = resultsState.clips.find((c) => c.id === resultsState.selectedClipId);
    if (sel2) fillResultIntel(sel2);
  }
}

let resAnalyzingAll = false;

async function analyzeAllClips() {
  if (resAnalyzingAll) return;
  const targets = resultsState.clips.filter((c) => !resIsAnalyzed(c));
  if (!targets.length) { showToast("Semua clip sudah dianalisis."); return; }
  resAnalyzingAll = true;
  resultsState.analyzing = true;
  $("#analyzeAllBtn").disabled = true;
  const progressPill = document.getElementById("resProgressPill");
  if (progressPill) progressPill.hidden = false;
  let done = 0;
  let failures = 0;
  let firstError = "";

  for (const clip of targets) {
    if (progressPill) progressPill.textContent = `${done}/${targets.length}`;
    const okResult = await analyzeResultClip(clip);
    done += 1;
    if (!okResult) {
      failures += 1;
      if (!firstError) firstError = $("#riStatus").textContent === "Gagal" ? "Analyze clip gagal." : "";
    }
  }

  resAnalyzingAll = false;
  resultsState.analyzing = false;
  if (progressPill) { progressPill.hidden = true; progressPill.textContent = "0%"; }
  $("#analyzeAllBtn").disabled = false;

  if (failures) {
    resultsState.status = "partial";
    setResPill("partial", "PARTIAL RESULTS");
    $("#resErrorReason").textContent = firstError || `${failures} clip gagal dianalisis.`;
    $("#resErrorBox").hidden = false;
  } else {
    resultsState.status = "ready";
    $("#resErrorBox").hidden = true;
    setResPill("ready", `${resultsState.clips.length} CLIPS FOUND`);
  }
}

async function ensureResultsProjectInStudio() {
  const cid = resultsState.selectedClipId;
  let liveClip = state.projectId === resultsState.projectId
    ? clips.find((c) => c.id === cid) || null
    : null;
  if (!liveClip) {
    const response = await fetch(`/api/projects/${resultsState.projectId}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Gagal memuat project.");
    loadProject(data);
    liveClip = clips.find((c) => c.id === cid) || clips[0] || null;
  }
  return liveClip;
}

async function handoffToStudio(autoplay) {
  try {
    const liveClip = await ensureResultsProjectInStudio();
    if (!liveClip) throw new Error("Clip tidak ditemukan di project.");
    selectClip(liveClip);
    // Studio tidak memiliki preview lagi — preview hidup di RESULTS (video) &
    // Captions (caption rate). Autoplay membuka Results dengan video terpilih.
    if (autoplay) {
      showView("results");
      playSelectedClip();
    } else {
      showView("studio");
    }
  } catch (err) {
    showToast(err.message || "Gagal membuka preview.");
  }
}

$("#analyzeAllBtn").addEventListener("click", analyzeAllClips);
$("#resRetryBtn").addEventListener("click", () => {
  $("#resErrorBox").hidden = true;
  analyzeAllClips();
});
// "EXPORT & PUBLISH" — buka alur publish dengan metadata clip terpilih.
$("#riAnalyzeBtn").addEventListener("click", () => {
  const clip = resultsState.clips.find((c) => c.id === resultsState.selectedClipId);
  if (!clip) { showToast("Pilih clip dulu."); return; }
  openPublishForClip(clip);
});
$("#riPreviewBtn").addEventListener("click", () => handoffToStudio(true));
$("#riStudioBtn").addEventListener("click", () => handoffToStudio(false));
$("#resSearch").addEventListener("input", applyResView);
$("#resFilter").addEventListener("change", applyResView);
$("#resSort").addEventListener("change", applyResView);

// ================= STUDIO PERSISTENCE (Phase 4) =================
// SAVE memakai PATCH /api/projects/:id existing (menulis manifest.clips).
// Tidak ada penyimpanan kedua; toast "Saved" hanya setelah server konfirmasi.

let studioDirty = false;
let savingStudio = false;

function markStudioDirty() {
  studioDirty = true;
  const pill = document.getElementById("studioDirtyPill");
  if (pill) pill.hidden = false;
  const btn = document.getElementById("saveProjectBtn");
  if (btn) { btn.hidden = false; btn.classList.add("primary-button"); btn.classList.remove("ghost-button"); }
}

function clearStudioDirty() {
  studioDirty = false;
  const pill = document.getElementById("studioDirtyPill");
  if (pill) pill.hidden = true;
  const btn = document.getElementById("saveProjectBtn");
  if (btn) { btn.classList.remove("primary-button"); btn.classList.add("ghost-button"); }
  updateFinalPreviewStrip();
}

async function saveStudioToServer() {
  if (!state.projectId) { showToast("Tidak ada project untuk disimpan."); return false; }
  if (savingStudio) return false;
  if (!clips.length) { showToast("Tidak ada clip untuk disimpan."); return false; }
  savingStudio = true;
  const btn = document.getElementById("saveProjectBtn");
  const oldLabel = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "Saving..."; }
  try {
    const payload = clips.map((c) => ({
      id: c.id,
      title: c.title || "",
      deepTitle: c.deepTitle || "",
      start: Number(c.start) || 0,
      end: Number(c.end) || 0,
      score: c.score != null ? c.score : null,
      hook: c.hook || "",
      caption: c.caption || "",
      recommendedHook: c.recommendedHook || "",
      hookType: c.hookType || "",
      hookScore: c.hookScore != null ? c.hookScore : null
    }));
    const response = await fetch(`/api/projects/${state.projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clips: payload })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Gagal menyimpan perubahan.");
    clearStudioDirty();
    showToast("Perubahan tersimpan ke server.");
    return true;
  } catch (err) {
    console.error("[studio-save]", err);
    showToast(err.message || "Gagal menyimpan perubahan.");
    return false;
  } finally {
    savingStudio = false;
    if (btn) { btn.disabled = false; btn.textContent = oldLabel || "SAVE"; }
  }
}

$("#saveProjectBtn").addEventListener("click", () => saveStudioToServer());

// ---- Template Gallery: library caption template dengan preview nyata ----
const CAPTION_TPL = (typeof window !== "undefined" && window.ClipmeCaptionTemplates) ? window.ClipmeCaptionTemplates : null;
let tplState = { search: "", category: "All", selectedId: "" };

function openTemplateGallery() {
  if (!CAPTION_TPL) return;
  const modal = document.getElementById("templateGalleryModal");
  if (!modal) return;
  tplState.selectedId = "";
  renderTplCategories();
  renderTplGrid();
  modal.hidden = false;
}

function closeTemplateGallery() {
  const modal = document.getElementById("templateGalleryModal");
  if (modal) modal.hidden = true;
}

function renderTplCategories() {
  const wrap = document.getElementById("tplCategories");
  if (!wrap || !CAPTION_TPL) return;
  const cats = ["All", ...CAPTION_TPL.CATEGORIES];
  wrap.innerHTML = "";
  for (const cat of cats) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `tpl-chip ${tplState.category === cat ? "active" : ""}`;
    chip.textContent = cat;
    chip.addEventListener("click", () => { tplState.category = cat; renderTplCategories(); renderTplGrid(); });
    wrap.appendChild(chip);
  }
}

function tplMatches(t) {
  const q = tplState.search.trim().toLowerCase();
  const okCat = tplState.category === "All" || t.category === tplState.category;
  const okQ = !q || t.name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q);
  return okCat && okQ;
}

function renderTplGrid() {
  const grid = document.getElementById("tplGrid");
  if (!grid || !CAPTION_TPL) return;
  grid.innerHTML = "";
  const list = CAPTION_TPL.TEMPLATES.filter(tplMatches);
  const countEl = document.getElementById("tplCount");
  if (countEl) countEl.textContent = `${list.length}/${CAPTION_TPL.TEMPLATES.length}`;
  for (const t of list) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `tpl-card ${tplState.selectedId === t.id ? "selected" : ""}`;
    card.dataset.tplId = t.id;
    const swatch = document.createElement("span");
    swatch.className = "tpl-swatch";
    Object.assign(swatch.style, CAPTION_TPL.swatchStyle(t));
    swatch.textContent = "Aa";
    const name = document.createElement("strong");
    name.textContent = t.name;
    const cat = document.createElement("span");
    cat.className = "tpl-cat";
    cat.textContent = `${t.category} · ${t.style}${t.color ? " · " + t.color : ""}`;
    card.append(swatch, name, cat);
    card.addEventListener("click", () => {
      tplState.selectedId = t.id;
      grid.querySelectorAll(".tpl-card").forEach((c) => c.classList.toggle("selected", c.dataset.tplId === t.id));
      applyCaptionTemplate(t, { previewOnly: true });
    });
    grid.appendChild(card);
  }
}

function applyCaptionTemplate(t, opts = {}) {
  if (!t) return;
  const styleSel = $("#captionStyleSelect");
  const fontSel = $("#captionFontSelect");
  const colorIn = $("#captionColor");
  const sizeIn = $("#captionSize");
  const posIn = $("#captionPosition");
  if (!styleSel || !fontSel) return;
  styleSel.value = t.style;
  fontSel.value = t.fontFamily;
  if (colorIn && t.color) colorIn.value = t.color;
  if (sizeIn && t.sizeScale) sizeIn.value = Math.round(23 * t.sizeScale);
  if (posIn && t.position) posIn.value = Math.round(t.position * 100);
  state.captionTemplateId = t.id;
  const tplNameEl = document.getElementById("createTplName");
  if (tplNameEl) tplNameEl.textContent = `Template aktif: ${t.name}`;
  for (const el of [styleSel, fontSel, colorIn, sizeIn, posIn]) {
    if (el) el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input"));
  }
  if (!opts.previewOnly) {
    saveSettingsDebounced();
    closeTemplateGallery();
    showToast(`Template "${t.name}" diterapkan.`);
  }
}

if ($("#templateGalleryBtn")) {
  $("#templateGalleryBtn").addEventListener("click", openTemplateGallery);
}
if ($("#tplCloseBtn")) $("#tplCloseBtn").addEventListener("click", closeTemplateGallery);
if ($("#tplSearch")) {
  $("#tplSearch").addEventListener("input", () => {
    tplState.search = $("#tplSearch").value;
    renderTplGrid();
  });
}
if ($("#tplApplyBtn")) {
  $("#tplApplyBtn").addEventListener("click", () => {
    if (!tplState.selectedId || !CAPTION_TPL) { showToast("Pilih satu template dulu."); return; }
    applyCaptionTemplate(CAPTION_TPL.getById(tplState.selectedId));
  });
}
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !document.getElementById("templateGalleryModal").hidden) {
    closeTemplateGallery();
  }
  if (event.key === "Escape" && !document.getElementById("batchModal").hidden) {
    document.getElementById("batchModal").hidden = true;
  }
});

// ---- Generation mode segmented control ----
$$("#genModeSegmented button").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$("#genModeSegmented button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const label = document.getElementById("maxCeilingLabel");
    if (label) label.textContent = generationMode() === "manual" ? "Fixed duration (detik)" : "Max clip duration (detik)";
    saveSettingsDebounced();
  });
});

$("#backToResultsBtn").addEventListener("click", () => {
  if (resultsState.projectId) openResultsForProject(resultsState.projectId);
  else showView("results");
});

// ---- Metadata card actions (Results) ----
function currentMetaClip() {
  return (resultsState.clips || []).find((c) => c.id === resultsState.selectedClipId) || null;
}
if ($("#riMetaTitleCopy")) {
  $("#riMetaTitleCopy").addEventListener("click", () => copyToClipboard(metadataTextFor(currentMetaClip()).title, "title"));
  $("#riMetaDescCopy").addEventListener("click", () => copyToClipboard(metadataTextFor(currentMetaClip()).description, "description"));
  $("#riMetaTagsCopy").addEventListener("click", () => copyToClipboard(metadataTextFor(currentMetaClip()).hashtags, "hashtags"));
  $("#riMetaCopyAll").addEventListener("click", () => {
    const m = metadataTextFor(currentMetaClip());
    const text = [`TITLE\n${m.title || "—"}`, `DESCRIPTION\n${m.description || "—"}`, `HASHTAGS\n${m.hashtags || "—"}`].join("\n\n");
    copyToClipboard(m.title ? text : "", "semua metadata");
  });
  $("#riMetaRegen").addEventListener("click", () => {
    const clip = currentMetaClip();
    if (clip) generateClipMetadata(clip, { regenerate: true });
  });
}

// ---- Create workspace: back-link + aspect ratio sync + workspace mode ----
if ($("#backToProjectsBtn")) $("#backToProjectsBtn").addEventListener("click", () => showView("library"));
if ($("#npBackBtn")) $("#npBackBtn").addEventListener("click", () => showView("library"));
if ($("#libNewProjectBtn")) $("#libNewProjectBtn").addEventListener("click", openCreateWorkspace);
if ($("#sidebarNewProjectBtn")) $("#sidebarNewProjectBtn").addEventListener("click", openCreateWorkspace);
if ($("#capOpenLibraryBtn")) $("#capOpenLibraryBtn").addEventListener("click", openTemplateGallery);
if ($("#setOpenTemplates")) $("#setOpenTemplates").addEventListener("click", () => { showView("captions"); openTemplateGallery(); });
if ($("#setOpenIntegrations")) $("#setOpenIntegrations").addEventListener("click", () => showView("integrations"));
if ($("#setRefreshBtn")) $("#setRefreshBtn").addEventListener("click", () => { settingsLoadedOnce = false; fillSettingsView(); });
if ($("#capLibSearch")) {
  $("#capLibSearch").addEventListener("input", () => {
    capLibFilter = $("#capLibSearch").value;
    renderCaptionsWorkspace();
  });
}
$$("#createRatioSegmented button").forEach((btn) => {
  btn.addEventListener("click", () => {
    setRatio(btn.dataset.cratio);
    saveSettingsDebounced();
  });
});

// ---- Project create-config persistence ----
async function persistCreateConfig() {
  if (!state.projectId) return;
  try {
    await fetch(`/api/projects/${state.projectId}/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ createConfig: {
        genMode: generationMode(),
        maxDuration: Number(($("#maxCeilingInput") && $("#maxCeilingInput").value) || 90),
        maxClips: Number(($("#maxClipsSelect") && $("#maxClipsSelect").value) || 6),
        hookStrategy: ($("#hookStrategySelect") && $("#hookStrategySelect").value) || "balanced",
        focus: ($("#focusInput") && $("#focusInput").value.trim()) || "",
        ratio: currentRatio(),
        captionTemplateId: state.captionTemplateId || ""
      } })
    });
  } catch {}
}

// Strip konfigurasi render final — semua nilai dari state nyata yang sama
// dengan yang dikirim ke pipeline export.
const RATIO_LABELS = { portrait: "9:16", wide: "16:9", four5: "4:5" };

function updateFinalPreviewStrip() {
  const fmtEl = document.getElementById("fpFormat");
  if (!fmtEl) return;
  fmtEl.textContent = RATIO_LABELS[currentRatio()] || currentRatio();
  const capEl = document.getElementById("fpCaptions");
  if (capEl) {
    const tpl = state.captionTemplateId && window.ClipmeCaptionTemplates
      ? window.ClipmeCaptionTemplates.getById(state.captionTemplateId) : null;
    capEl.textContent = autoCaptionEnabled()
      ? (tpl ? `ON — ${tpl.name}` : `ON · ${(($("#captionStyleSelect") && $("#captionStyleSelect").value) || "").toUpperCase()}`)
      : "OFF";
  }
  const durEl = document.getElementById("fpDuration");
  if (durEl && state.activeClip) {
    durEl.textContent = formatTime(Math.max(0, (state.activeClip.end || 0) - (state.activeClip.start || 0)));
  }
}

// Preset posisi caption: menyalurkan nilai ke slider existing sehingga preview
// DAN export menerima konfigurasi yang sama (satu jalur, tanpa style duplikat).
$$("[data-cpos]").forEach((btn) => {
  btn.addEventListener("click", () => {
    captionPosition.value = btn.dataset.cpos;
    captionPosition.dispatchEvent(new Event("input"));
    saveSettingsDebounced();
    showToast(`Posisi caption: ${btn.textContent}`);
  });
});

// Sumber video gagal dimuat — pesan bersih, detail di console.
previewVideo.addEventListener("error", () => {
  if (!previewVideo.getAttribute("src")) return;
  console.error("[preview] source failed to load:", previewVideo.src);
  uploadStatus.textContent = "VIDEO UNAVAILABLE";
  showToast("Video sumber tidak bisa dimuat. Coba BACK TO RESULTS lalu buka ulang clip.");
});

// ================= BATCH PRODUCTION + EXPORT MANAGER + PUBLISHING (Phase 5) ==
// Orkestrasi di atas sistem existing: multi-select Results → modal config →
// POST /api/export-batch (queue & FFmpeg yang sama). Tidak ada queue kedua,
// tidak ada publishing palsu — metadata disiapkan & dicopy manual.

resultsState.selectedIds = new Set();

function updateResSelectionBar() {
  const n = resultsState.selectedIds.size;
  const pill = document.getElementById("resSelCount");
  const produce = document.getElementById("batchProduceBtn");
  const selAll = document.getElementById("resSelectAllBtn");
  const clearBtn = document.getElementById("resClearSelBtn");
  if (pill) {
    pill.hidden = !n;
    pill.textContent = `${n} SELECTED`;
  }
  if (produce) produce.hidden = !n;
  if (selAll) selAll.hidden = !resultsState.clips.length;
  if (clearBtn) clearBtn.hidden = !n;
}

$("#resSelectAllBtn").addEventListener("click", () => {
  resultsState.visible.forEach((c) => resultsState.selectedIds.add(c.id));
  updateResSelectionBar();
  applyResView();
});
$("#resClearSelBtn").addEventListener("click", () => {
  resultsState.selectedIds.clear();
  updateResSelectionBar();
  applyResView();
});
if ($("#resViewToggle")) {
  $("#resViewToggle").addEventListener("click", () => {
    const list = document.getElementById("resultsClipList");
    if (!list) return;
    list.classList.toggle("horizontal-mode");
    const btn = $("#resViewToggle");
    if (btn) btn.textContent = list.classList.contains("horizontal-mode") ? "\u2630 Grid" : "\u2630 List";
  });
}

// ---- Batch modal ----
let batchRatio = "portrait";
let lastFailedClipIds = [];

function bpValidateSelected() {
  const dur = resultsState.duration || 0;
  return resultsState.clips
    .filter((c) => resultsState.selectedIds.has(c.id))
    .map((clip) => {
      const start = Number(clip.start);
      const end = Number(clip.end);
      let ok = true;
      let why = "";
      if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 1) { ok = false; why = "rentang waktu tidak valid"; }
      else if (dur > 0 && (start < -0.5 || end > dur + 0.5)) { ok = false; why = `di luar durasi sumber (${formatTime(dur)})`; }
      return { clip, ok, why };
    });
}

function openBatchModal() {
  if (!resultsState.projectId) { showToast("Buka project dari Results dulu."); return; }
  const items = bpValidateSelected();
  $("#bpCount").textContent = `${items.length} CLIP`;
  $$(".bp-format button").forEach((b) => b.classList.toggle("active", b.dataset.bpratio === currentRatio()));
  batchRatio = currentRatio();
  $("#bpCaptions").checked = autoCaptionEnabled();
  const list = $("#bpValidation");
  list.innerHTML = "";
  for (const it of items) {
    const li = document.createElement("li");
    li.className = it.ok ? "ok" : "warn";
    li.textContent = `Clip ${String(it.clip.id).padStart(2, "0")}${it.ok ? "" : ` — ${it.why}`}`;
    list.appendChild(li);
  }
  $("#bpStartBtn").disabled = !items.some((it) => it.ok);
  document.getElementById("batchModal").hidden = false;
}

$$(".bp-format button").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$(".bp-format button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    batchRatio = btn.dataset.bpratio;
  });
});

$("#bpCancelBtn").addEventListener("click", () => { document.getElementById("batchModal").hidden = true; });
document.getElementById("batchModal").addEventListener("click", (event) => {
  if (event.target.id === "batchModal") event.target.hidden = true;
});

let batchRunning = false;

async function startBatch() {
  if (batchRunning) return;
  const valid = bpValidateSelected().filter((it) => it.ok);
  if (!valid.length) { showToast("Tidak ada clip valid untuk batch."); return; }
  if (!state.projectId || state.projectId !== resultsState.projectId) {
    // pastikan project aktif di Studio state agar segments/caption cache dipakai
    await ensureResultsProjectInStudio();
  }
  batchRunning = true;
  $("#bpStartBtn").disabled = true;
  document.getElementById("batchModal").hidden = true;

  try {
    const response = await fetch("/api/export-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: resultsState.projectId,
        clips: valid.map(({ clip }) => ({
          clipId: clip.id,
          start: clip.start,
          end: clip.end,
          caption: clip.caption || "",
          language: CAPTION_LANG,
          captionStyle: $("#bpCaptions").checked ? effectiveCaptionStyle() : "off",
          captionSize: captionSize.value,
          fontFamily: captionFontSelect ? captionFontSelect.value : "Arial",
          captionColor: captionColorInput ? captionColorInput.value : "",
          captionPosition: state.captionPosition || 0.76,
          ratio: batchRatio,
          fps: Number(state.fps) || 0,
          crf: Number(state.crf) || 23,
          audioBitrate: Number(state.audioBitrate) || 128,
          speakerCut: !!document.getElementById("speakerCutToggle")?.checked,
          faceTrack: !!document.getElementById("faceTrackToggle")?.checked,
    reframe: !!document.getElementById("reframeToggle")?.checked,
          segments: captionSegmentsForClip(clip)
        }))
      })
    });
    const data = await response.json();
    if (!response.ok && response.status !== 202) throw new Error(data.error || "Batch export gagal.");
    if (!data.jobId) throw new Error("Server tidak mengembalikan job batch export.");

    enterProcessingView(data.jobId, `Batch ${valid.length} clips`, retryFailedBatch, { projectId: resultsState.projectId });
    const result = await waitForJob(data.jobId, { onUpdate: renderProcessingTick });

    const okResults = (result.results || []).filter((item) => item && item.filename);
    const failedItems = (result.results || []).filter((item) => item && item.error);
    for (const item of okResults) addExportResult(item, `Batch export`);
    completeProcessingView({ clips: okResults.map((r) => ({ id: r.clipId })), _countOnly: true });
    $("#procExportsBtn").hidden = false;
    lastFailedClipIds = [];
    if (failedItems.length) {
      lastFailedClipIds = failedItems
        .map((item) => item.clipId)
        .filter((id) => valid.some(({ clip }) => clip.id === id));
      processingState.status = "failed";
      setProcPill("failed", "PARTIAL");
      $("#procErrorReason").textContent = `${okResults.length}/${valid.length} berhasil. Contoh error: ${failedItems[0].error}`;
      $("#procErrorBox").hidden = false;
      $("#procRetryBtn").hidden = false;
      console.error("[batch]", failedItems);
    }
    $("#procTask").textContent = `BATCH COMPLETE — ${okResults.length}/${valid.length} clips exported.`;
    showToast(`Batch selesai: ${okResults.length}/${valid.length} clip ter-export.`);
    loadExports();
  } catch (err) {
    console.error("[batch]", err);
    await failProcessingView(err);
    showToast(err.message);
  } finally {
    batchRunning = false;
    $("#bpStartBtn").disabled = false;
  }
}

function retryFailedBatch() {
  if (!lastFailedClipIds.length) { showToast("Tidak ada clip gagal untuk di-retry."); return; }
  resultsState.selectedIds = new Set(lastFailedClipIds);
  openBatchModalFromSelection();
  showToast(`Retry ${lastFailedClipIds.length} clip gagal — review lalu START BATCH.`);
}

function openBatchModalFromSelection() {
  updateResSelectionBar();
  openBatchModal();
}

$("#batchProduceBtn").addEventListener("click", openBatchModal);
$("#bpStartBtn").addEventListener("click", startBatch);

$("#procExportsBtn").addEventListener("click", () => {
  showView("exports");
  loadExports();
});

// ---- Export Manager: filter/search/sort + detail expandable ----
function renderExports() {
  const countPill = document.getElementById("exportsCount");
  if (countPill) countPill.textContent = String(state.exports.length);
  if (!state.exports.length) {
    exportsList.innerHTML = '<div class="empty-state">Belum ada export. Export clip dari Studio akan muncul di sini.</div>';
    return;
  }

  const q = ($("#exportsSearch").value || "").trim().toLowerCase();
  const sortMode = ($("#exportsSort").value || "newest");
  let arr = state.exports.slice();
  if (q) {
    arr = arr.filter((e) => `${e.filename} ${e.project || ""} ${e.clipTitle || ""}`.toLowerCase().includes(q));
  }
  if (sortMode === "newest") arr.sort((a, b) => b._ts - a._ts);
  if (sortMode === "oldest") arr.sort((a, b) => a._ts - b._ts);
  if (sortMode === "name") arr.sort((a, b) => String(a.filename).localeCompare(String(b.filename)));

  exportsList.innerHTML = "";
  for (const item of arr) {
    const row = document.createElement("div");
    row.className = "table-row clickable";

    const main = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = item.filename;
    const meta = document.createElement("span");
    meta.textContent = `${item.clipTitle}${item.createdAt ? ` - ${item.createdAt}` : ""}${item.size ? ` (${formatBytes(item.size)})` : ""}`;
    main.appendChild(name);
    main.appendChild(meta);

    const status = document.createElement("span");
    status.textContent = "READY";

    const download = document.createElement("a");
    download.className = "secondary-button compact";
    download.href = item.downloadUrl;
    download.setAttribute("download", item.filename);
    download.textContent = "Download";

    row.appendChild(main);
    row.appendChild(status);
    row.appendChild(download);
    exportsList.appendChild(row);

    const detail = document.createElement("div");
    detail.className = "exp-detail";
    detail.hidden = true;
    detail.innerHTML = [
      ["Project", item.project],
      ["Ratio", item.ratio],
      ["Caption", item.caption],
      ["Hook", item.hook]
    ].map(([k, v]) => `<span>${k}: <b>${v ? String(v).replace(/</g, "&lt;") : "—"}</b></span>`).join("");

    const perfWrap = document.createElement("div");
    perfWrap.className = "perf-block";
    const perfHead = document.createElement("p");
    perfHead.className = "field-label";
    perfHead.style.marginTop = "8px";
    perfHead.textContent = "PERFORMANCE (isi angka aktual dari platform — manual)";
    perfWrap.appendChild(perfHead);
    const loadBtn = document.createElement("button");
    loadBtn.type = "button";
    loadBtn.className = "secondary-button compact";
    loadBtn.textContent = "LOAD / EDIT PERFORMANCE";
    loadBtn.addEventListener("click", () => {
      loadBtn.disabled = true;
      renderPerfEditor(perfWrap, item.filename).finally(() => { loadBtn.remove(); });
    });
    perfWrap.appendChild(loadBtn);
    detail.appendChild(perfWrap);

    row.addEventListener("click", (event) => {
      if (event.target.closest("a")) return;
      detail.hidden = !detail.hidden;
    });
    exportsList.appendChild(detail);
  }

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

$("#exportsSearch").addEventListener("input", renderExports);
$("#exportsSort").addEventListener("change", renderExports);

// Ringkasan export per project di header Results (match via nama project nyata)
function updateResExportsLine() {
  const el = document.getElementById("resExports");
  if (!el || !resultsState.name) return;
  const matches = state.exports.filter((e) => e.project && e.project === resultsState.name).length;
  el.textContent = matches ? String(matches) : "—";
}
const _origRenderResHeader = renderResHeader;
renderResHeader = function () { _origRenderResHeader(); updateResExportsLine(); };

// ---- Publishing workspace: metadata prep + copy (TANPA auto-upload) ----
const publishState = { platform: "YouTube Shorts", clipRef: null };

function pubFillFields(meta) {
  if (!meta) return;
  if (meta.title) $("#pubTitle").value = meta.title;
  if (meta.description) $("#pubDesc").value = meta.description;
  if (Array.isArray(meta.hashtags) && meta.hashtags.length) {
    $("#pubHashtags").value = meta.hashtags.map((t) => (String(t).startsWith("#") ? t : `#${t}`)).join(" ");
  }
  pubChecklistUpdate();
}

// Auto-isi title/description/hashtags dari analisis AI clip terkait export yang dipilih.
async function ensurePublishMetadata(opts = {}) {
  const selEl = $("#pubSourceSelect");
  if (!selEl || !selEl.value) return;
  const entry = state.exports[Number(selEl.value)];
  let projectId = publishState.clipRef && publishState.clipRef.projectId;
  let clipId = publishState.clipRef && publishState.clipRef.clipId;
  if ((!projectId || !clipId) && entry) {
    clipId = clipId || entry.clipId || "";
    const byName = state.projects.find((p) => p.name === entry.project);
    projectId = projectId || (byName && byName.id) || "";
  }
  if (!projectId) { showToast("Project sumber tidak dikenal — jalankan PUBLISH dari tab Results."); return; }
  try {
    const pr = await fetch(`/api/projects/${projectId}`);
    const data = await pr.json();
    if (!pr.ok || !Array.isArray(data.clips)) throw new Error(data.error || "Project tidak terbaca.");
    const target = (clipId && data.clips.find((c) => String(c.id) === String(clipId)))
      || data.clips.find((c) => c.analysis || c.metadata)
      || null;
    if (!target) throw new Error("Clip hasil analisis tidak ditemukan di project ini.");
    if (!opts.regenerate && target.metadata) { pubFillFields(target.metadata); showToast("Metadata dimuat dari analisis AI."); return; }
    const mr = await fetch(`/api/projects/${projectId}/metadata`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clipId: target.id, regenerate: !!opts.regenerate })
    });
    const md = await mr.json();
    if (!mr.ok) throw new Error(md.error || "Gagal generate metadata.");
    pubFillFields(md.metadata);
    showToast(opts.regenerate ? "Metadata di-generate ulang dari konten clip." : "Title/description/hashtags terisi otomatis dari analisis AI.");
  } catch (err) {
    showToast(err.message || "Auto-metadata gagal.");
  }
}

function populatePubSources() {
  const selEl = $("#pubSourceSelect");
  if (!selEl) return;
  selEl.innerHTML = "";
  if (!state.exports.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Belum ada export — render clip dulu";
    selEl.appendChild(opt);
    return;
  }
  for (const [i, e] of state.exports.entries()) {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = e.filename;
    selEl.appendChild(opt);
  }
}

async function copyToClipboard(text, label, statusEl) {
  const value = String(text == null ? "" : text);
  const status = statusEl || $("#pubCopyStatus");
  if (!value.trim() || value.trim() === "—") {
    if (status) status.textContent = "Kosong — isi/generate metadata dulu.";
    showToast(`${label} masih kosong — tidak ada yang disalin.`);
    return false;
  }
  let ok = false;
  // Jalur 1: Clipboard API (butuh halaman focused — di Electron sering gagal).
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(value);
      ok = true;
    }
  } catch (err) {
    console.error("[clipboard] api:", err.message);
  }
  // Jalur 2 (fallback): textarea sementara + execCommand — selalu tersedia.
  if (!ok) {
    try {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ok = document.execCommand("copy");
      ta.remove();
    } catch (err) {
      console.error("[clipboard] fallback:", err.message);
    }
  }
  if (ok) {
    if (status) status.textContent = `Copied ${label}.`;
    showToast(`Copied ${label}.`);
  } else {
    if (status) status.textContent = "Gagal menyalin.";
    showToast("Clipboard diblokir — blok teks lalu Ctrl+C manual.");
  }
  return ok;
}

function pubChecklistUpdate() {
  const list = $("#pubChecklist");
  if (!list) return;
  const hasExport = !!state.exports.length;
  const ratioOk = RATIO_PRESETS.includes(currentRatio()) || true; // semua preset renderer supported
  const title = $("#pubTitle").value.trim();
  const desc = $("#pubDesc").value.trim();
  const tags = $("#pubHashtags").value.trim();
  const items = [
    [`Video exported (${state.exports.length} file)`, hasExport],
    [`Format target: ${publishState.platform}`, ratioOk],
    [`Title ready`, !!title],
    [`Description ready`, !!desc],
    [`Hashtags ready`, !!tags]
  ];
  list.innerHTML = "";
  for (const [label, ok] of items) {
    const li = document.createElement("li");
    li.className = ok ? "ok" : "warn";
    li.textContent = label;
    list.appendChild(li);
  }
}

$$(".pub-platform button").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$(".pub-platform button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    publishState.platform = btn.dataset.platform;
    pubChecklistUpdate();
  });
});

["input", "change"].forEach((ev) => {
  $("#pubTitle").addEventListener(ev, pubChecklistUpdate);
  $("#pubDesc").addEventListener(ev, pubChecklistUpdate);
  $("#pubHashtags").addEventListener(ev, pubChecklistUpdate);
});

$("#copyTitleBtn").addEventListener("click", () => copyToClipboard($("#pubTitle").value.trim(), "title"));
$("#copyDescBtn").addEventListener("click", () => copyToClipboard($("#pubDesc").value.trim(), "description"));
$("#copyTagsBtn").addEventListener("click", () => copyToClipboard($("#pubHashtags").value.trim(), "hashtags"));
$("#copyAllBtn").addEventListener("click", () => {
  const title = $("#pubTitle").value.trim();
  const desc = $("#pubDesc").value.trim();
  const tags = $("#pubHashtags").value.trim();
  if (!title && !desc && !tags) {
    showToast("Metadata masih kosong — klik Generate Metadata dulu.");
    return;
  }
  const blocks = [];
  if (title) blocks.push(`TITLE\n${title}`);
  if (desc) blocks.push(`DESCRIPTION\n${desc}`);
  if (tags) blocks.push(`HASHTAGS\n${tags}`);
  copyToClipboard(blocks.join("\n\n"), "semua metadata");
});
if ($("#pubGenMetaBtn")) {
  $("#pubGenMetaBtn").addEventListener("click", () => ensurePublishMetadata({ regenerate: true }));
}
if ($("#pubSourceSelect")) {
  $("#pubSourceSelect").addEventListener("change", () => {
    publishState.clipRef = null;
    $("#pubTitle").value = "";
    $("#pubDesc").value = "";
    $("#pubHashtags").value = "";
    pubChecklistUpdate();
    ensurePublishMetadata();
  });
}

// ---- EXPORT LANGSUNG DARI PUBLISH: project → candidate → render → siap publish ----
async function populatePubProjects() {
  const sel = $("#pubProjSelect");
  if (!sel) return;
  await loadProjects();
  sel.innerHTML = '<option value="">Pilih project…</option>';
  for (const p of state.projects) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.name} (${p.clips} clip)`;
    sel.appendChild(opt);
  }
}

if ($("#pubProjSelect")) {
  $("#pubProjSelect").addEventListener("change", async () => {
    const clipSel = $("#pubClipSelect");
    clipSel.innerHTML = '<option value="">Pilih clip…</option>';
    if (!$("#pubProjSelect").value) return;
    try {
      const r = await fetch(`/api/projects/${$("#pubProjSelect").value}`);
      const d = await r.json();
      if (!r.ok || !Array.isArray(d.clips)) throw new Error(d.error || "Project gagal dibuka.");
      for (const c of d.clips) {
        const opt = document.createElement("option");
        opt.value = c.id;
        const scoreTxt = c.score != null ? ` ★${Math.round(c.score)}` : "";
        const dur = Math.max(0, Math.round((c.end || 0) - (c.start || 0)));
        opt.textContent = `#${String(c.id).padStart(2, "0")} ${dur}s${scoreTxt} — ${(c.title || "").slice(0, 40)}`;
        clipSel.appendChild(opt);
      }
    } catch (err) {
      showToast(err.message || "Gagal memuat clip.");
    }
  });
}

if ($("#pubExportBtn")) {
  $("#pubExportBtn").addEventListener("click", async () => {
    const projectId = $("#pubProjSelect") && $("#pubProjSelect").value;
    const clipId = $("#pubClipSelect") && $("#pubClipSelect").value;
    const statusEl = $("#pubExportStatus");
    if (!projectId || !clipId) { showToast("Pilih project dan candidate clip dulu."); return; }
    let clip = null;
    try {
      const r = await fetch(`/api/projects/${projectId}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Project gagal dibuka.");
      clip = (d.clips || []).find((c) => String(c.id) === String(clipId));
      if (!clip) throw new Error("Clip tidak ditemukan.");
    } catch (err) {
      showToast(err.message); return;
    }
    const btn = $("#pubExportBtn");
    btn.disabled = true;
    btn.textContent = "MENGEXPORT…";
    if (statusEl) statusEl.textContent = "Render berjalan di queue…";
    try {
      const payload = {
        projectId,
        clipId,
        start: Number(clip.start) || 0,
        end: Number(clip.end) || 0,
        language: "Indonesia",
        ratio: currentRatio(),
        captionStyle: effectiveCaptionStyle(),
        fontFamily: ($("#captionFontSelect") && $("#captionFontSelect").value) || "Arial",
        captionColor: ($("#captionColor") && $("#captionColor").value) || "#FFFFFF",
        captionSize: Number(captionSize.value) || 23,
        captionPosition: state.captionPosition || 0.76,
        speakerCut: !!document.getElementById("speakerCutToggle")?.checked,
        faceTrack: !!document.getElementById("faceTrackToggle")?.checked
      };
      const res = await fetch("/api/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Export gagal dimulai.");
      showJobProgress(JOB_LABELS["export"], { indeterminate: true });
      const result = await waitForJob(data.jobId, { onUpdate: renderProcessingTick });
      settleJobProgress("success", result && result.filename ? result.filename : "");
      await loadExports();
      populatePubSources();
      // Auto-pilih file baru + isi metadata dari clip sumbernya.
      const idx = state.exports.findIndex((e) => e.filename === result.filename);
      if (idx >= 0) { $("#pubSourceSelect").value = String(idx); publishState.clipRef = { projectId, clipId }; }
      pubFillFieldsFromClip(clip);
      ensurePublishMetadata();
      showToast("Export selesai — metadata siap, tinggal COPY / schedule.");
    } catch (err) {
      settleJobProgress("error", err.message);
      showToast(err.message || "Export gagal.");
    } finally {
      btn.disabled = false;
      btn.textContent = "Export + Prepare for Publish";
    }
  });
}

function pubFillFieldsFromClip(clip) {
  if (!clip) return;
  if (clip.metadata) pubFillFields(clip.metadata);
  else {
    if (clip.deepTitle) $("#pubTitle").value = clip.deepTitle;
    const km = clip.analysis && clip.analysis.keyMessage;
    if (km && !$("#pubDesc").value.trim()) $("#pubDesc").value = String(km).trim();
    const tags = clip.analysis && clip.analysis.hashtags;
    if (Array.isArray(tags) && tags.length && !$("#pubHashtags").value.trim()) {
      $("#pubHashtags").value = tags.map((t) => (String(t).startsWith("#") ? t : `#${t}`)).join(" ");
    }
    pubChecklistUpdate();
  }
}

// Buka Publishing dengan metadata intel dari clip Results (judul/alternatif/hashtags)
function openPublishForClip(clip) {
  showView("publish");
  publishState.clipRef = { projectId: resultsState.projectId, clipId: clip.id };
  populatePubSources();
  if (clip.metadata) pubFillFields(clip.metadata);
  else if (!clip.deepTitle && !(clip.analysis && clip.analysis.hashtags)) {
    // Clip belum punya metadata — generate otomatis dari konten.
    ensurePublishMetadata();
  }
  $("#pubMetaSource").hidden = !(clip.deepTitle || (clip.analysis && clip.analysis.hashtags));
  if (clip.deepTitle) $("#pubTitle").value = clip.deepTitle;
  if (Array.isArray(clip.deepTitleAlternatives) && clip.deepTitleAlternatives.length) {
    const box = $("#pubTitleOptions");
    box.hidden = false;
    box.innerHTML = "";
    for (const raw of [clip.deepTitle, ...clip.deepTitleAlternatives].filter(Boolean)) {
      const t = typeof raw === "string" ? raw : altTitleText(raw);
      if (!t) continue;
      const labelEl = document.createElement("label");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "pubTitleOpt";
      radio.checked = t === clip.deepTitle;
      radio.addEventListener("change", () => { $("#pubTitle").value = t; pubChecklistUpdate(); });
      labelEl.appendChild(radio);
      const span = document.createElement("span");
      span.textContent = t;
      labelEl.appendChild(span);
      box.appendChild(labelEl);
    }
  } else {
    $("#pubTitleOptions").hidden = true;
  }
  const tags = clip.analysis && clip.analysis.hashtags;
  if (Array.isArray(tags) && tags.length) {
    $("#pubHashtags").value = tags.map((t) => (String(t).startsWith("#") ? t : `#${t}`)).join(" ");
  } else if (typeof tags === "string" && tags.trim()) {
    $("#pubHashtags").value = tags.trim();
  }
  if (!$("#pubDesc").value.trim() && clip.analysis && clip.analysis.keyMessage) {
    $("#pubDesc").value = String(clip.analysis.keyMessage).trim();
  }
  pubChecklistUpdate();
  showToast("Metadata siap — review lalu COPY ALL / download video.");
}

// Dashboard RECENT EXPORTS — top 3 file nyata
function renderRecentExportsDashboard() {
  const wrap = document.getElementById("dashRecentExports");
  const count = document.getElementById("dashExportsCount");
  if (!wrap) return;
  if (count) count.textContent = String(state.exports.length);
  wrap.innerHTML = "";
  if (!state.exports.length) {
    wrap.innerHTML = '<div class="empty-state">Belum ada export.</div>';
    return;
  }
  for (const item of state.exports.slice(0, 3)) {
    const row = document.createElement("div");
    row.className = "rr-row";
    const main = document.createElement("div");
    main.className = "rr-main";
    const nameEl = document.createElement("strong");
    nameEl.textContent = item.filename;
    const metaEl = document.createElement("span");
    metaEl.textContent = `${item.createdAt || ""}${item.size ? ` · ${formatBytes(item.size)}` : ""}`;
    main.appendChild(nameEl);
    main.appendChild(metaEl);
    const pill = document.createElement("span");
    pill.className = "status-pill status-pill-done";
    pill.textContent = "READY";
    row.appendChild(main);
    row.appendChild(pill);
    wrap.appendChild(row);
  }
}

// ================= CALENDAR + INTEGRATIONS + INSIGHTS (Phase 6) ==============
// Kalender = RENCANA LOKAL (localStorage), berlabel jelas — bukan jadwal
// platform (tidak ada OAuth di build ini). Status integrasi dari deteksi
// nyata /api/integrations. Insights dihitung dari data export asli.

const CAL_KEY = "clipperStudio.calendar";

function loadCalendar() {
  try { return JSON.parse(localStorage.getItem(CAL_KEY) || "[]") || []; }
  catch { return []; }
}
function saveCalendar(list) {
  localStorage.setItem(CAL_KEY, JSON.stringify(list));
}

const calView = { year: new Date().getFullYear(), month: new Date().getMonth() };

function populateCalSources() {
  const selEl = $("#calSourceSelect");
  if (!selEl) return;
  selEl.innerHTML = "";
  if (!state.exports.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Belum ada export — render clip dulu";
    selEl.appendChild(opt);
    return;
  }
  state.exports.forEach((e, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = e.filename;
    selEl.appendChild(opt);
  });
}

function calDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function renderCalendar() {
  const grid = document.getElementById("calGrid");
  if (!grid) return;
  const label = document.getElementById("calMonthLabel");
  const monthName = new Date(calView.year, calView.month, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
  if (label) label.textContent = monthName;

  const entries = loadCalendar();
  const byDay = {};
  for (const e of entries) {
    const d = new Date(e.at);
    const key = calDateKey(d);
    (byDay[key] = byDay[key] || []).push(e);
  }

  grid.innerHTML = "";
  for (const dow of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
    const h = document.createElement("span");
    h.className = "cal-dow";
    h.textContent = dow;
    grid.appendChild(h);
  }

  const first = new Date(calView.year, calView.month, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const todayKey = calDateKey(new Date());
  for (let i = 0; i < 42; i++) {
    const cellDate = new Date(calView.year, calView.month, 1 - startOffset + i);
    const cell = document.createElement("div");
    cell.className = "cal-cell" + (cellDate.getMonth() !== calView.month ? " out" : "") + (calDateKey(cellDate) === todayKey ? " today" : "");
    const num = document.createElement("span");
    num.textContent = String(cellDate.getDate());
    cell.appendChild(num);
    for (const e of byDay[calDateKey(cellDate)] || []) {
      const chip = document.createElement("div");
      chip.className = "cal-entry";
      chip.title = `${e.filename} — ${e.platform} (klik untuk hapus dari plan)`;
      const t = new Date(e.at);
      const time = document.createElement("b");
      time.textContent = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
      chip.appendChild(time);
      chip.append(` ${String(e.platform || "")}`);
      chip.setAttribute("role", "button");
      chip.setAttribute("tabindex", "0");
      const removeEntry = () => {
        if (!confirm(`Hapus rencana "${e.platform} — ${e.filename}"?`)) return;
        saveCalendar(loadCalendar().filter((x) => x.id !== e.id));
        renderCalendar();
        renderUpcoming();
        showToast("Rencana dihapus.");
      };
      chip.addEventListener("click", removeEntry);
      chip.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); removeEntry(); } });
      cell.appendChild(chip);
    }
    grid.appendChild(cell);
  }
  renderUpcoming();
}

function renderUpcoming() {
  const wrap = document.getElementById("calUpcoming");
  const count = document.getElementById("calCount");
  if (!wrap) return;
  const entries = loadCalendar().sort((a, b) => new Date(a.at) - new Date(b.at));
  if (count) count.textContent = String(entries.length);
  if (!entries.length) {
    wrap.innerHTML = '<div class="empty-state">Belum ada rencana.</div>';
    return;
  }
  wrap.innerHTML = "";
  for (const e of entries) {
    const row = document.createElement("div");
    row.className = "table-row";
    const main = document.createElement("div");
    const nameEl = document.createElement("strong");
    nameEl.textContent = e.filename;
    const meta = document.createElement("span");
    const t = new Date(e.at);
    meta.textContent = `${t.toLocaleString()} · ${e.platform}`;
    main.appendChild(nameEl);
    main.appendChild(meta);
    const del = document.createElement("button");
    del.type = "button";
    del.className = "ghost-button compact danger-btn";
    del.textContent = "Hapus";
    del.addEventListener("click", () => {
      saveCalendar(loadCalendar().filter((x) => x.id !== e.id));
      renderCalendar();
      showToast("Rencana dihapus.");
    });
    row.appendChild(main);
    row.appendChild(del);
    wrap.appendChild(row);
  }
}

$("#calAddBtn").addEventListener("click", () => {
  const idx = $("#calSourceSelect").value;
  if (idx === "" || idx == null) { showToast("Belum ada file export untuk dipilih."); return; }
  const whenVal = $("#calWhen").value;
  if (!whenVal) { showToast("Pilih tanggal & jam dulu."); return; }
  const when = new Date(whenVal);
  if (Number.isNaN(when.getTime())) { showToast("Tanggal tidak valid."); return; }
  if (when.getTime() < Date.now()) { showToast("Tidak bisa menjadwalkan waktu yang sudah lewat."); return; }
  const entry = {
    id: Date.now(),
    filename: state.exports[Number(idx)].filename,
    platform: $("#calPlatform").value,
    at: when.toISOString()
  };
  const list = loadCalendar();
  list.push(entry);
  saveCalendar(list);
  $("#calStatus").textContent = `Plan tersimpan lokal: ${entry.platform} @ ${when.toLocaleString()}`;
  showToast("Rencana disimpan ke kalender lokal.");
  renderCalendar();
});
$("#calPrevBtn").addEventListener("click", () => { calView.month--; if (calView.month < 0) { calView.month = 11; calView.year--; } renderCalendar(); });
$("#calNextBtn").addEventListener("click", () => { calView.month++; if (calView.month > 11) { calView.month = 0; calView.year++; } renderCalendar(); });
$("#calTodayBtn").addEventListener("click", () => { calView.year = new Date().getFullYear(); calView.month = new Date().getMonth(); renderCalendar(); });

// ---- Integrations: deteksi nyata, tanpa OAuth palsu ----
// PHASE 6 — Social Hub: OAuth accounts (utama) + fallback deteksi kredensial.
const socialUi = { polling: {} };
function waitMs(ms) { return new Promise((r) => window.setTimeout(r, ms)); }

async function fetchSocialAccounts() {
  try {
    const r = await fetch("/api/social/accounts");
    const d = await r.json();
    return Array.isArray(d.accounts) ? d.accounts : [];
  } catch { return []; }
}

async function pollSocialConnected(providerId, timeoutMs = 120000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await waitMs(2000);
    const acc = await fetch(`/api/social/account/${providerId}`);
    if (acc.ok) return await acc.json();
    if (Date.now() - startedAt >= timeoutMs) break;
  }
  return null;
}

async function loadIntegrations() {
  const wrap = document.getElementById("integList");
  if (!wrap) return;
  loadIntegrationsConfig();
  let platforms = [];
  let socialAccounts = [];
  try {
    const [pr, sa] = await Promise.all([fetch("/api/integrations"), fetchSocialAccounts()]);
    const data = await pr.json();
    platforms = Array.isArray(data.platforms) ? data.platforms : [];
    socialAccounts = sa;
  } catch (err) {
    console.error("[integrations]", err);
  }
  const socialById = {};
  for (const s of socialAccounts) socialById[s.id] = s;

  wrap.innerHTML = "";
  if (!platforms.length) {
    wrap.innerHTML = '<div class="empty-state">Status tidak tersedia (server offline?).</div>';
    updatePublishAvailability(false);
    return;
  }
  let anyConnected = false;
  for (const p of platforms) {
    // Sumber utama: akun OAuth nyata; kredensial file hanya pelengkap status.
    const soc = socialById[p.id] || null;
    const connected = Boolean(soc && soc.connected) || Boolean(p.connected);

    const card = document.createElement("div");
    card.className = "integ-card";
    const main = document.createElement("div");
    main.className = "integ-main";
    const nameEl = document.createElement("strong");
    nameEl.textContent = p.name;
    const sub = document.createElement("span");
    sub.dataset.socialSub = p.id;
    sub.textContent = connected
      ? (soc && soc.connected ? "Terhubung via akun." : "Kredensial terdeteksi di server.")
      : "Belum terhubung — aktifkan toggle untuk otorisasi resmi.";
    main.appendChild(nameEl);
    main.appendChild(sub);

    const pill = document.createElement("span");
    pill.className = `status-pill ${connected ? "status-pill-done" : "status-pill-queued"} integ-state`;
    pill.textContent = connected ? "🟢 CONNECTED" : "⚪ NOT CONNECTED";

    const actions = document.createElement("div");
    actions.className = "integ-actions";
    if (soc && soc.connected) {
      anyConnected = true;
      const infoBtn = document.createElement("button");
      infoBtn.type = "button";
      infoBtn.className = "ghost-button compact";
      infoBtn.textContent = "Account Info";
      infoBtn.addEventListener("click", async () => {
        try {
          const r = await fetch(`/api/social/account/${p.id}`);
          const d = await r.json();
          sub.textContent = r.ok ? `${d.account.accountName}${d.account.username ? " (" + d.account.username + ")" : ""}` : (d.error || "Sesi berakhir.");
        } catch {}
      });
      actions.appendChild(infoBtn);
    }

    // Toggle menghubungkan: ON = mulai OAuth resmi, OFF = putuskan koneksi.
    const toggleWrap = document.createElement("label");
    toggleWrap.className = "integ-toggle";
    const toggleInput = document.createElement("input");
    toggleInput.type = "checkbox";
    toggleInput.setAttribute("aria-label", `Hubungkan ${p.name}`);
    toggleInput.checked = Boolean(soc && soc.connected);
    if (!soc) {
      toggleInput.disabled = true;
      toggleWrap.title = "Modul OAuth belum tersedia untuk platform ini.";
    }
    toggleInput.addEventListener("change", async () => {
      if (toggleInput.checked) {
        toggleInput.disabled = true;
        try {
          const r = await fetch(`/api/social/connect/${p.id}`);
          const d = await r.json();
          if (!r.ok || !d.url) throw new Error(d.error || "Gagal membuat URL otorisasi.");
          window.open(d.url, "_blank");
          sub.textContent = "Menunggu otorisasi di browser…";
          const result = await pollSocialConnected(p.id);
          if (result && result.account) {
            sub.textContent = `${result.account.accountName}${result.account.username ? " (" + result.account.username + ")" : ""}`;
            pill.className = "status-pill status-pill-done integ-state";
            pill.textContent = "🟢 CONNECTED";
            showToast(`${p.name} terhubung.`);
            updatePublishAvailability(true);
            loadIntegrations();
          } else {
            toggleInput.checked = false;
            sub.textContent = "Otorisasi belum selesai / dibatalkan.";
            showToast("Otorisasi belum selesai / dibatalkan.");
          }
        } catch (err) {
          toggleInput.checked = false;
          sub.textContent = connected ? sub.textContent : "Belum terhubung — aktifkan toggle untuk otorisasi resmi.";
          showToast(err.message || "Connect gagal.");
        } finally {
          toggleInput.disabled = false;
        }
      } else {
        if (!confirm(`Putuskan koneksi ${p.name}? (hanya autentikasi — konten lokal aman)`)) {
          toggleInput.checked = true;
          return;
        }
        try { await fetch(`/api/social/disconnect/${p.id}`, { method: "POST" }); } catch {}
        sub.textContent = "Belum terhubung — aktifkan toggle untuk otorisasi resmi.";
        pill.className = "status-pill status-pill-queued integ-state";
        pill.textContent = "⚪ NOT CONNECTED";
        updatePublishAvailability(false);
        loadIntegrations();
        showToast(`${p.name} diputus.`);
      }
    });
    const sliderEl = document.createElement("span");
    sliderEl.className = "integ-slider";
    toggleWrap.appendChild(toggleInput);
    toggleWrap.appendChild(sliderEl);
    actions.appendChild(toggleWrap);

    card.appendChild(main);
    card.appendChild(pill);
    card.appendChild(actions);
    wrap.appendChild(card);
  }
  updatePublishAvailability(anyConnected);
}

function updatePublishAvailability(anyConnected) {
  const btn = document.getElementById("pubPublishNowBtn");
  const hint = document.getElementById("pubPublishHint");
  if (!btn) return;
  // Deteksi kredensial ≠ kapabilitas upload: modul OAuth/upload belum ada,
  // jadi tombol TETAP non-fungsional dan jujur menyatakannya.
  btn.disabled = true;
  btn.title = "Modul upload belum tersedia pada build ini.";
  if (hint) {
    hint.textContent = anyConnected
      ? "Kredensial terdeteksi, namun mesin upload/OAuth belum dibangun — gunakan download manual."
      : "PUBLISH NOW butuh integrasi platform terhubung (tab Integrations). Tidak ada simulasi upload.";
  }
}

$("#integRefreshBtn").addEventListener("click", () => loadIntegrations());

// ---- BYO credentials: form kredensial OAuth milik user (disimpan lokal) ----
let integCredsBuilt = false;
async function loadIntegrationsConfig() {
  const form = document.getElementById("integCredsForm");
  if (!form) return;
  try {
    const r = await fetch("/api/integrations/config");
    const d = await r.json();
    if (!r.ok || !Array.isArray(d.keys)) throw new Error(d.error || "Gagal memuat konfigurasi.");
    if (!integCredsBuilt) {
      const groups = {};
      for (const k of d.keys) (groups[k.platform] = groups[k.platform] || []).push(k);
      for (const [plat, keys] of Object.entries(groups)) {
        const h = document.createElement("div");
        h.className = "integ-creds-group";
        h.textContent = plat;
        form.appendChild(h);
        for (const k of keys) {
          const row = document.createElement("label");
          row.className = "integ-creds-row";
          const span = document.createElement("span");
          span.textContent = k.label;
          const input = document.createElement("input");
          input.type = k.secret ? "password" : "text";
          input.dataset.key = k.key;
          input.placeholder = k.configured ? "••••••••  (terisi — kosongkan untuk mempertahankan)" : "belum diisi";
          row.append(span, input);
          form.appendChild(row);
        }
      }
      integCredsBuilt = true;
    } else {
      for (const k of d.keys) {
        const input = form.querySelector(`input[data-key="${k.key}"]`);
        if (input && !input.value) input.placeholder = k.configured ? "••••••••  (terisi — kosongkan untuk mempertahankan)" : "belum diisi";
      }
    }
    const filled = d.keys.filter((k) => k.configured).length;
    const hint = document.getElementById("integCredsHint");
    if (hint) hint.textContent = `${filled}/${d.keys.length} kredensial terisi${d.file ? " · " + d.file : ""}`;
  } catch (err) {
    console.error("[integrations-config]", err);
  }
}

(async () => {
  const saveBtn = document.getElementById("integCredsSaveBtn");
  if (!saveBtn) return;
  saveBtn.addEventListener("click", async () => {
    const form = document.getElementById("integCredsForm");
    if (!form) return;
    const payloadKeys = {};
    let changed = 0;
    for (const input of form.querySelectorAll("input[data-key]")) {
      if (input.value.trim()) { payloadKeys[input.dataset.key] = input.value.trim(); changed++; }
    }
    if (!changed) { showToast("Isi minimal satu kredensial baru. Kolom kosong mempertahankan nilai lama."); return; }
    saveBtn.disabled = true;
    try {
      const r = await fetch("/api/integrations/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: payloadKeys })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Gagal menyimpan kredensial.");
      showToast("Kredensial tersimpan lokal (file 0600).");
      for (const input of form.querySelectorAll("input[data-key]")) input.value = "";
      loadIntegrations();
    } catch (err) {
      showToast(err.message || "Gagal menyimpan kredensial.");
    } finally {
      saveBtn.disabled = false;
    }
  });
})();

// Publishing → SCHEDULE (local plan): pindah ke Calendar dengan export terpilih
$("#pubScheduleBtn").addEventListener("click", () => {
  showView("calendar");
  populateCalSources();
  const pubIdx = $("#pubSourceSelect").value;
  if (pubIdx) $("#calSourceSelect").value = pubIdx;
  $("#calPlatform").value = publishState.platform;
  showToast("Atur tanggal & jam lalu klik ADD TO PLAN.");
});

// ---- Production insights: observasi dari data nyata, tanpa klaim AI ----
function computeProductionInsights() {
  const list = document.getElementById("prodInsights");
  if (!list) return;
  const lines = [];
  const exportsArr = state.exports;
  if (exportsArr.length >= 3) {
    const ratioCount = {};
    for (const e of exportsArr) {
      const k = e.ratio ? String(e.ratio) : "unknown";
      ratioCount[k] = (ratioCount[k] || 0) + 1;
    }
    const topRatio = Object.entries(ratioCount).sort((a, b) => b[1] - a[1])[0];
    if (topRatio && topRatio[0] !== "unknown") {
      lines.push(`Format paling sering di-export: ${topRatio[0]} (${topRatio[1]}/${exportsArr.length} file).`);
    }
    const projCount = {};
    for (const e of exportsArr) {
      const k = e.project ? String(e.project) : "unknown";
      projCount[k] = (projCount[k] || 0) + 1;
    }
    const topProj = Object.entries(projCount).sort((a, b) => b[1] - a[1])[0];
    if (topProj && topProj[0] !== "unknown") {
      lines.push(`Project paling produktif: "${topProj[0]}" (${topProj[1]} export).`);
    }
    const planned = loadCalendar().length;
    lines.push(planned
      ? `${planned} rencana tayang tersimpan di kalender lokal.`
      : "Belum ada rencana tayang di kalender lokal.");
    lines.push("Observasi berbasis data lokal yang tersedia — tanpa prediksi performa.");
  } else {
    lines.push("Belum cukup data export untuk observasi (minimal 3 file).");
  }
  list.innerHTML = "";
  for (const line of lines) {
    const li = document.createElement("li");
    li.className = "ok";
    li.textContent = line;
    list.appendChild(li);
  }
}

$$("[data-qview]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const view = btn.dataset.qview;
    showView(view);
    if (view === "exports") loadExports();
    if (view === "calendar") { populateCalSources(); renderCalendar(); }
    if (view === "integrations") loadIntegrations();
  });
});

// ================= CONTENT INTELLIGENCE (Phase 7) ============================
// Orkestrasi engine existing via GET /api/intelligence/:projectId (transkrip
// STT + ranking backend + field reason asli). Tidak ada AI karangan: field
// yang tidak ada tampil "—"/"not available".

const intelState = { projectId: null, data: null, loading: false };

function setIntelPill(state, text) {
  const pill = document.getElementById("intelStatePill");
  if (!pill) return;
  pill.className = `status-pill ${statusPillClass(state)}`;
  pill.textContent = text;
}

async function populateIntelProjects() {
  const selEl = $("#intelProjectSelect");
  if (!selEl) return;
  if (!state.projects.length) await loadProjects();
  selEl.innerHTML = "";
  if (!state.projects.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Belum ada project";
    selEl.appendChild(opt);
    return;
  }
  for (const p of state.projects.slice(0, 12)) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    if (resultsState.projectId === p.id || state.projectId === p.id) opt.selected = true;
    selEl.appendChild(opt);
  }
}

async function loadProjectIntelligence() {
  const pid = $("#intelProjectSelect").value;
  if (!pid) { showToast("Belum ada project untuk dianalisis."); return; }
  if (intelState.loading) return;
  intelState.loading = true;
  intelState.projectId = pid;
  $("#intelErrorBox").hidden = true;
  setIntelPill("running", "ANALYZING…");

  try {
    const response = await fetch(`/api/intelligence/${pid}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Gagal memuat intelligence.");
    intelState.data = data;
    renderIntelligence(data);
    setIntelPill("done", "READY");
  } catch (err) {
    console.error("[intel]", err);
    $("#intelErrorReason").textContent = err.message || "Unknown error";
    $("#intelErrorBox").hidden = false;
    setIntelPill("failed", "FAILED");
  } finally {
    intelState.loading = false;
  }
}

function renderIntelligence(data) {
  // Summary ekstraktif dari transkrip asli — kalau tidak ada transkrip, jujur.
  $("#intelSummary").textContent = data.summary
    ? data.summary
    : (data.hasTranscript ? "Summary not available." : "No transcript yet — jalankan analisis/STT dulu.");
  const srcPill = document.getElementById("intelSourcePill");
  if (srcPill) {
    srcPill.hidden = !data.summary;
    srcPill.textContent = data.summary ? "extractive · transcript" : "";
  }

  const kwWrap = document.getElementById("intelKeywords");
  kwWrap.innerHTML = "";
  if (!data.keywords || !data.keywords.length) {
    kwWrap.innerHTML = '<span class="caption-hint">&mdash;</span>';
  } else {
    for (const k of data.keywords.slice(0, 10)) {
      const chip = document.createElement("span");
      chip.className = "kw-chip";
      chip.innerHTML = `${String(k.word).replace(/</g, "&lt;")}<b>${k.count}</b>`;
      kwWrap.appendChild(chip);
    }
  }

  $("#intelStatClips").textContent = String(data.stats.clips);
  $("#intelStatAnalyzed").textContent = `${data.stats.analyzed} / ${data.stats.clips}`;
  $("#intelStatAvg").textContent = data.stats.avgScore != null ? `${data.stats.avgScore}/100` : "—";

  const topWrap = document.getElementById("intelTopClips");
  topWrap.innerHTML = "";
  if (!data.topClips.length) {
    topWrap.innerHTML = '<div class="empty-state">Belum ada clip ter-analisis.</div>';
  } else {
    data.topClips.forEach((clip, i) => {
      const card = document.createElement("article");
      card.className = "rc-card";
      const head = document.createElement("div");
      head.className = "rc-head";
      const rank = document.createElement("span");
      rank.className = "rc-id";
      rank.textContent = `#${i + 1} · CLIP ${String(clip.id).padStart(2, "0")}`;
      const scoreEl = document.createElement("span");
      scoreEl.className = "rc-score";
      scoreEl.textContent = clip.score != null ? String(Math.round(Number(clip.score))) : "—";
      head.appendChild(rank);
      head.appendChild(scoreEl);
      card.appendChild(head);

      const time = document.createElement("p");
      time.className = "rc-time";
      time.textContent = `${formatTime(clip.start)} → ${formatTime(clip.end)}${clip.hookType ? ` · ${clip.hookType}` : ""}`;
      card.appendChild(time);

      const quote = document.createElement("p");
      quote.className = "rc-quote";
      quote.textContent = clip.hook ? `"${clip.hook}"` : (clip.title || "—");
      card.appendChild(quote);

      if (clip.why && clip.why.length) {
        const whyLabel = document.createElement("p");
        whyLabel.className = "caption-hint";
        whyLabel.style.marginTop = "6px";
        whyLabel.textContent = "WHY (dari engine):";
        card.appendChild(whyLabel);
        const ul = document.createElement("ul");
        ul.className = "why-list";
        for (const reason of clip.why) {
          const li = document.createElement("li");
          li.textContent = reason;
          ul.appendChild(li);
        }
        card.appendChild(ul);
      }

      const actions = document.createElement("div");
      actions.className = "rc-actions";
      const prevBtn = document.createElement("button");
      prevBtn.type = "button";
      prevBtn.className = "primary-button compact";
      prevBtn.textContent = "PREVIEW";
      prevBtn.addEventListener("click", () => openIntelClip(clip.start, true));
      const studioBtn = document.createElement("button");
      studioBtn.type = "button";
      studioBtn.className = "secondary-button compact";
      studioBtn.textContent = "STUDIO";
      studioBtn.addEventListener("click", () => openIntelClip(clip.start, false));
      actions.appendChild(prevBtn);
      actions.appendChild(studioBtn);
      card.appendChild(actions);
      topWrap.appendChild(card);
    });
  }

  renderIntelRecommendations(data);
}

// Rekomendasi deterministik dari hitungan nyata — tanpa prediksi.
function renderIntelRecommendations(data) {
  const list = document.getElementById("intelRecommendations");
  if (!list) return;
  list.innerHTML = "";
  const recs = [];
  const unanalyzed = data.stats.clips - data.stats.analyzed;
  if (unanalyzed > 0) {
    recs.push([`${unanalyzed} clip belum dianalisis — jalankan ANALYZE ALL di Results.`, () => {
      resultsState.projectId = intelState.projectId;
      openResultsForProject(intelState.projectId);
    }, "OPEN RESULTS"]);
  }
  if (data.stats.analyzed > 0 && data.topClips.length) {
    const top = data.topClips[0];
    recs.push([`Top clip #${top.id} (skor ${Math.round(Number(top.score))}) siap diproduksi.`, () => openIntelClip(top.start, true), "PREVIEW TOP"]);
  }
  if (state.exports.filter((e) => e.project && data.name && e.project === data.name).length === 0 && data.stats.analyzed > 0) {
    recs.push(["Project ini belum punya export — batch produce dari Results.", () => {
      resultsState.projectId = intelState.projectId;
      openResultsForProject(intelState.projectId);
    }, "GO RESULTS"]);
  }
  if (!loadCalendar().length && state.exports.length) {
    recs.push(["Ada export tapi kalender masih kosong — susun rencana tayang.", () => {
      showView("calendar");
      populateCalSources();
      renderCalendar();
    }, "OPEN CALENDAR"]);
  }
  if (!recs.length) recs.push(["Semua tahap utama sudah berjalan untuk project ini.", null, null]);

  for (const [text, fn, label] of recs) {
    const li = document.createElement("li");
    li.className = "ok";
    li.style.display = "flex";
    li.style.justifyContent = "space-between";
    li.style.gap = "10px";
    li.style.alignItems = "center";
    const span = document.createElement("span");
    span.textContent = text;
    li.appendChild(span);
    if (fn && label) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "secondary-button compact";
      btn.textContent = label;
      btn.addEventListener("click", fn);
      li.appendChild(btn);
    }
    list.appendChild(li);
  }
}

async function openIntelClip(startSec, autoplay) {
  if (!intelState.projectId) return;
  await openResultsForProject(intelState.projectId);
  const target = resultsState.clips.find((c) => Number(c.start) <= startSec + 0.5 && Number(c.end) >= startSec - 0.5)
    || resultsState.clips.find((c) => c.id === 1)
    || resultsState.clips[0];
  if (!target) { showToast("Clip tidak ditemukan di project ini."); return; }
  resultsState.selectedClipId = target.id;
  applyResView();
  fillResultIntel(target);
  await handoffToStudio(autoplay);
}

$("#intelLoadBtn").addEventListener("click", loadProjectIntelligence);
$("#intelRetryBtn").addEventListener("click", loadProjectIntelligence);
$("#intelProjectSelect").addEventListener("focus", populateIntelProjects);

// Transcript search memakai endpoint EXISTING /api/stt/search (python search).
$("#intelSearchBtn").addEventListener("click", async () => {
  const wrap = document.getElementById("intelSearchResults");
  const keyword = $("#intelSearchInput").value.trim();
  if (!wrap) return;
  if (!intelState.data || !intelState.data.transcriptAbs) { showToast("Butuh transcript — jalankan ANALYZE SOURCE dulu."); return; }
  if (!keyword) { showToast("Ketik frasa yang dicari."); return; }
  wrap.innerHTML = '<div class="empty-state">Mencari…</div>';
  try {
    const response = await fetch("/api/stt/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcriptPath: intelState.data.transcriptAbs, keyword })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Pencarian gagal.");
    const rows = Array.isArray(data.results) ? data.results : [];
    wrap.innerHTML = "";
    if (!rows.length) {
      wrap.innerHTML = '<div class="empty-state">Tidak ada hasil.</div>';
      return;
    }
    for (const row of rows.slice(0, 30)) {
      const line = document.createElement("div");
      line.className = "rt-line";
      const t = document.createElement("time");
      const startVal = Number(row.start) || 0;
      t.textContent = formatTime(startVal);
      t.title = "Buka clip ini di Studio";
      t.addEventListener("click", () => openIntelClip(startVal, true));
      const p = document.createElement("p");
      p.textContent = row.text || "";
      line.appendChild(t);
      line.appendChild(p);
      wrap.appendChild(line);
    }
  } catch (err) {
    console.error("[intel-search]", err);
    wrap.innerHTML = `<div class="empty-state">${String(err.message || "Gagal mencari.").replace(/</g, "&lt;")}</div>`;
  }
});

const SETTINGS_KEY = "clipperStudio.settings";

function collectSettings() {
  const style = $("#captionStyleSelect") ? $("#captionStyleSelect").value : "bold";
  return {
    captionStyle: style,
    captionSize: Number(captionSize.value) || 23,
    captionPosition: state.captionPosition || 0.76,
    speakerCut: !!$("#speakerCutToggle")?.checked,
    faceTrack: !!$("#faceTrackToggle")?.checked,
    reframe: !!$("#reframeToggle")?.checked,
    autoCaption: autoCaptionEnabled(),
    captionTemplateId: state.captionTemplateId || "",
    genMode: generationMode(),
    maxCeiling: Number(($("#maxCeilingInput") && $("#maxCeilingInput").value) || 90)
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
  if (data.captionPosition != null) state.captionPosition = Number(data.captionPosition);
  state.speakerCut = !!data.speakerCut;
  state.faceTrack = !!data.faceTrack;
  state.reframe = !!data.reframe;

  if ($("#captionStyleSelect")) $("#captionStyleSelect").value = data.captionStyle || "bold";
  if (Number(data.captionSize)) captionSize.value = String(data.captionSize);
  captionPosition.value = String(Math.round((state.captionPosition || 0.76) * 100));
  const sct = document.getElementById("speakerCutToggle");
  if (sct) sct.checked = state.speakerCut;
  const ftt = document.getElementById("faceTrackToggle");
  if (ftt) ftt.checked = state.faceTrack;
  const rft = document.getElementById("reframeToggle");
  if (rft) rft.checked = state.reframe;
  const act = $("#autoCaptionToggle");
  if (act && data.autoCaption != null) act.checked = !!data.autoCaption;
  syncAutoCaptionToggle();
  state.captionTemplateId = data.captionTemplateId || "";
  if (data.genMode) {
    $$("#genModeSegmented button").forEach((b) => b.classList.toggle("active", b.dataset.genmode === data.genMode));
    const label = document.getElementById("maxCeilingLabel");
    if (label) label.textContent = generationMode() === "manual" ? "Fixed duration (detik)" : "Max clip duration (detik)";
  }
  if (Number(data.maxCeiling)) {
    const mci = $("#maxCeilingInput");
    if (mci) mci.value = String(Number(data.maxCeiling));
  }
  applyCaptionPosition();
}

function syncAutoCaptionToggle() {
  const btn = $("#autoCaptionBtn");
  if (btn) {
    btn.disabled = !autoCaptionEnabled();
    btn.title = autoCaptionEnabled() ? "" : "Auto caption dimatikan — nyalakan toggle untuk generate caption";
  }
  updateFinalPreviewStrip();
}

function syncDurationModeUi() {
  const modeEl = $("#durationModeSelect");
  const fixedEl = $("#fixedDurationInput");
  if (fixedEl) {
    const isFixed = modeEl && modeEl.value === "FIXED";
    fixedEl.style.display = isFixed ? "" : "none";
    if (!isFixed) fixedEl.value = "30";
  }
}
if ($("#durationModeSelect")) {
  $("#durationModeSelect").addEventListener("change", () => {
    syncDurationModeUi();
    saveSettingsDebounced();
  });
}

const saveSettingsDebounced = (() => {
  let timer = 0;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(saveSettings, 300);
  };
})();

const settingsControls = [
  ["change", "#captionStyleSelect"],
  ["input", "#captionSize"],
  ["input", "#captionPosition"],
  ["change", "#speakerCutToggle"],
  ["change", "#faceTrackToggle"],
  ["change", "#reframeToggle"],
  ["change", "#autoCaptionToggle"],
  ["change", "#durationModeSelect"],
  ["input", "#fixedDurationInput"]
];
settingsControls.forEach(([eventName, sel]) => {
  $$(sel).forEach((el) => el.addEventListener(eventName, saveSettingsDebounced));
});

loadSettings();

function setBootStep(name, state, text) {
  const item = document.querySelector(`[data-boot-step="${name}"]`);
  if (!item) return;
  item.dataset.state = state;
  const status = item.querySelector("em");
  if (status) status.textContent = text;
}

function renderDashboardActivity() {
  const chart = document.getElementById("dashActivityChart");
  const note = document.getElementById("dashActivityNote");
  if (!chart) return;
  const dayMs = 24 * 60 * 60 * 1000;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, index) => {
    const start = today.getTime() - ((6 - index) * dayMs);
    return { start, end: start + dayMs, projects: 0, exports: 0 };
  });
  const add = (items, field) => {
    for (const item of items) {
      const ts = Number(item._ts) || 0;
      const day = days.find((entry) => ts >= entry.start && ts < entry.end);
      if (day) day[field] += 1;
    }
  };
  add(state.projects, "projects");
  add(state.exports, "exports");
  const max = Math.max(1, ...days.map((day) => Math.max(day.projects, day.exports)));
  chart.innerHTML = "";
  for (const day of days) {
    const column = document.createElement("div");
    column.className = "dash-chart-column";
    const date = new Date(day.start);
    column.title = `${date.toLocaleDateString()}: ${day.projects} project, ${day.exports} export`;
    const bars = document.createElement("div");
    bars.className = "dash-chart-bars";
    for (const [kind, count] of [["project", day.projects], ["export", day.exports]]) {
      const bar = document.createElement("span");
      bar.className = `dash-chart-bar${kind === "export" ? " export" : ""}`;
      bar.style.height = `${count ? Math.max(8, Math.round((count / max) * 100)) : 3}%`;
      bars.appendChild(bar);
    }
    const label = document.createElement("span");
    label.className = "dash-chart-day";
    label.textContent = date.toLocaleDateString(undefined, { weekday: "short" });
    column.appendChild(bars);
    column.appendChild(label);
    chart.appendChild(column);
  }
  if (note) {
    const total = days.reduce((sum, day) => sum + day.projects + day.exports, 0);
    note.textContent = total
      ? `${total} local project/export event${total === 1 ? "" : "s"} in the last 7 days.`
      : "No project or export events recorded in the last 7 days.";
  }
}

function renderDashboardInsights(details, metrics) {
  const list = document.getElementById("dashInsightList");
  if (!list) return;
  const clips = (details || []).flatMap((detail) => Array.isArray(detail && detail.clips) ? detail.clips : []);
  const scored = clips.filter((clip) => typeof clip.score === "number" && Number.isFinite(clip.score));
  const transcriptReady = (details || []).filter((detail) => detail && detail.transcriptStatus && detail.transcriptStatus !== "No transcript").length;
  const insights = [];
  if (scored.length) {
    const top = scored.reduce((best, clip) => Number(clip.score) > Number(best.score) ? clip : best);
    insights.push(`Highest observed clip score is ${Math.round(Number(top.score))}${top.hookType ? ` (${top.hookType})` : ""}.`);
    insights.push(`Average score is ${Math.round(metrics.totalScore / metrics.scoredClips)} across ${metrics.scoredClips} analyzed clips.`);
  }
  if (transcriptReady) insights.push(`${transcriptReady} recent project${transcriptReady === 1 ? " has" : "s have"} transcript data available for analysis.`);
  if (!insights.length) insights.push("Run clip analysis to generate evidence-based local insights.");
  list.innerHTML = "";
  for (const insight of insights.slice(0, 3)) {
    const item = document.createElement("li");
    item.textContent = insight;
    list.appendChild(item);
  }
}

function updateBootSummary() {
  const checks = Array.from(document.querySelectorAll("[data-boot-step]"));
  const done = checks.filter((item) => item.dataset.state && item.dataset.state !== "running").length;
  const summary = document.getElementById("bootSummary");
  if (summary) summary.textContent = `${done} / ${checks.length} checks complete`;
}

async function bootCheck(name, label, work) {
  setBootStep(name, "running", "Checking");
  const message = document.getElementById("bootMessage");
  if (message) message.textContent = label;
  try {
    const value = await work();
    setBootStep(name, value ? "ready" : "warning", value ? "Ready" : "Unavailable");
    updateBootSummary();
    return value;
  } catch {
    setBootStep(name, "offline", "Offline");
    updateBootSummary();
    return null;
  }
}

async function bootstrapApplication() {
  mountWorkspaces();
  // Paralel - total waktu tunggu = check terlambat, bukan jumlah semua.
  const checks = await Promise.all([
    bootCheck("system", "Connecting to the local engine…", async () => {
      const response = await fetch("/api/system");
      return response.ok ? response.json() : null;
    }),
    bootCheck("stt", "Checking local speech-to-text models…", async () => {
      const response = await fetch("/api/stt/models");
      if (!response.ok) return null;
      const data = await response.json();
      return Array.isArray(data.models) ? data : null;
    }),
    bootCheck("queue", "Initializing the local job queue…", async () => {
      const response = await fetch("/api/queue");
      if (!response.ok) return null;
      const data = await response.json();
      return Array.isArray(data.jobs) ? data : null;
    }),
    bootCheck("workspace", "Loading projects and export metadata…", async () => {
      await Promise.all([loadProjects(), loadExports(), refreshStorage()]);
      return true;
    })
  ]);
  const system = checks[0];
  const stt = checks[1];
  const queue = checks[2];

  setBootStep("ffmpeg", "running", "Checking");
  const runtime = system && system.runtime ? system.runtime : null;
  setBootStep("ffmpeg", system ? "ready" : "offline", system
    ? (runtime && runtime.encoder ? String(runtime.encoder).toUpperCase() : "Ready")
    : "Offline");
  updateBootSummary();

  if (stt) setBootStep("stt", "ready", `${stt.models.length} model${stt.models.length === 1 ? "" : "s"}`);
  if (queue) setBootStep("queue", "ready", queue.jobs.length ? `${queue.jobs.length} active` : "Ready");

  // Reveal TIDAK BOLEH digagalkan oleh error inisialisasi mana pun:
  // workspace selalu tampil, detail error tetap tercatat di console.
  const message = document.getElementById("bootMessage");
  const boot = document.getElementById("engineBoot");
  try {
    renderClips();
    selectClip(clips[0]);
    setRatio(currentRatio());
    syncUndoRedoButtons();
    initDashboard();
    if (message) {
      const gpuPresent = Boolean(system && system.hardware && system.hardware.gpu && system.hardware.gpu.present);
      message.textContent = `Engine ready — ${gpuPresent ? "GPU detected" : "CPU runtime ready"}.`;
    }
  } catch (err) {
    console.error("[boot] init warning:", err);
    if (message) message.textContent = "Workspace loaded with init warnings — check console (F12).";
  } finally {
    if (boot) boot.hidden = true;
  }

  // Check sekunder berat (STT readiness penuh, LocalAI/pyannote probing)
  // berjalan SETELAH workspace tampil — tidak boleh menahan UI.
  if (stt) { readinessCache.stt = stt; readinessCache.sttAt = Date.now(); }
  Promise.allSettled([checkEngineReadiness(false), loadEngineCompute(), loadLocalAIStatus(), pollQueue()]);
}

const analyzeSpeakerBtn = document.getElementById("analyzeSpeakerBtn");
if (analyzeSpeakerBtn) analyzeSpeakerBtn.addEventListener("click", analyzeSpeakerForClip);
const speakerCutToggle = document.getElementById("speakerCutToggle");
if (speakerCutToggle) {
  speakerCutToggle.addEventListener("change", () => {
    if (speakerCutToggle.checked) updatePreviewFaceTransform();
    else resetPreviewFaceTransform();
  });
}
const downloadModelBtn = document.getElementById("downloadModelBtn");
if (downloadModelBtn) downloadModelBtn.addEventListener("click", downloadLocalAIModel);
bootstrapApplication();
setInterval(pollQueue, 5000);
setInterval(loadEngineCompute, 15000);
setInterval(loadLocalAIStatus, 30000);
