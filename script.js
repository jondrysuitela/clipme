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

function durationSettingsPayload() {
  const modeEl = $("#durationModeSelect");
  const mode = (modeEl && modeEl.value) || "AUTO";
  let fixed = 0;
  if (mode === "FIXED") {
    const fEl = $("#fixedDurationInput");
    const n = fEl ? Number(fEl.value) : 0;
    fixed = Number.isFinite(n) && n > 0 ? n : 30;
  }
  return { durationMode: mode, fixedDuration: fixed };
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
  syncTrimInputs();
  clipTime.textContent = clipRange(clip);
  $("#clipRange").textContent = clipRange(clip);
  renderClips(state.sorted ? [...clips].sort((a, b) => (b.score || -1) - (a.score || -1)) : clips);
  state.previewClipKey = "";
  resetPreviewFaceTransform();
  if (state.sourceUrl && Number.isFinite(clip.start)) previewVideo.currentTime = clip.start;
  showToast(`Clip dipangkas: ${formatTime(start)} - ${formatTime(end)}`);
}

const RATIO_PRESETS = ["portrait", "wide", "four5"];

function setRatio(token) {
  const ratio = RATIO_PRESETS.includes(token) ? token : "portrait";
  previewFrame.classList.remove("portrait", "wide", "four5");
  previewFrame.classList.add(ratio);
  previewFrame.dataset.layout = ratio;
  $$(".segmented button").forEach((item) => {
    item.classList.toggle("active", item.dataset.ratio === ratio);
  });
  updatePreviewFaceTransform();
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
    const active = item.dataset.view === view;
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
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

async function waitForJob(jobId) {
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
    if (!response.ok) throw new Error(job.error || "Job tidak ditemukan.");

    uploadStatus.textContent = `${job.status} ${job.progress}%`;
    const jpEl = jpRefs();
    if (jpEl && jpEl.hidden) showJobProgress(JOB_LABELS[job.type] || "Memproses");
    setJobProgress(job.progress, job.stage || "");

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

async function attachFile(file) {
  if (!file) return;

  if (!file.type.startsWith("video/")) {
    showToast("Pilih file video, misalnya MP4, MOV, MKV, atau WebM.");
    return;
  }

  markDropzone("uploading", file);
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
  showJobProgress("Generate clips", { indeterminate: true });
  try {
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
$("#analyzeHookBtn").addEventListener("click", async () => {
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
  showJobProgress(JOB_LABELS["upload-analyze"], { indeterminate: true });
  try {
    const response = await fetch(`/api/projects/${state.projectId}/analyze-hook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(durationSettingsPayload())
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Gagal memulai analisis.");
    const result = await waitForJob(data.jobId);
    const analyzed = result && Array.isArray(result.clips) ? result.clips : [];
    if (!analyzed.length) throw new Error((result && result.warning) || "Analisis tidak menghasilkan clip.");
    clips = analyzed;
    state.selectedClipIds = new Set();
    state.sorted = false;
    setActiveClipOrEmpty(clips[0]);
    uploadStatus.textContent = `${clips.length} clips ready`;
    showToast(`Analisis hook viral selesai: ${(result && result.transcriptStatus) || ""} - ${clips.length} clip.`);
  } catch (err) {
    settleJobProgress("error", err.message);
    showToast(err.message);
    uploadStatus.textContent = "Failed";
  } finally {
    btn.disabled = false;
    btn.textContent = oldLabel;
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
  const style = effectiveCaptionStyle();
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

$("#intelRegenerate").addEventListener("click", analyzeSelectedClip);

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

$("#intelUseTitle").addEventListener("click", () => {
  const value = $("#intelDeepTitle").textContent;
  if (value && value !== "--") {
    hookInput.value = value;
    if (state.activeClip) { state.activeClip.hook = value; state.activeClip.title = value; }
    showToast("Judul rekomendasi dipakai sebagai judul & hook.");
  }
});

$("#intelUseDeepHook").addEventListener("click", () => {
  const value = $("#intelDeepHook").textContent;
  if (value && value !== "--") {
    hookInput.value = value;
    if (state.activeClip) state.activeClip.hook = value;
    showToast("Deep hook dipakai sebagai hook.");
  }
});

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
  showView("studio");
  const input = document.getElementById("videoInput");
  if (input) input.click();
}

let dashBusy = false;

async function loadDashboardData() {
  if (dashBusy) return;
  dashBusy = true;
  try {
    await Promise.all([loadProjects(), loadExports()]);
    updateDashboardStats();
    renderDashboardProjects(state.projects);
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

const SETTINGS_KEY = "clipperStudio.settings";

function collectSettings() {
  const style = $("#captionStyleSelect") ? $("#captionStyleSelect").value : "bold";
  return {
    captionStyle: style,
    captionSize: Number(captionSize.value) || 23,
    captionPosition: state.captionPosition || 0.76,
    speakerCut: !!$("#speakerCutToggle")?.checked,
    faceTrack: !!$("#faceTrackToggle")?.checked,
    autoCaption: autoCaptionEnabled(),
    durationMode: ($("#durationModeSelect") && $("#durationModeSelect").value) || "AUTO",
    fixedDuration: Number(($("#fixedDurationInput") && $("#fixedDurationInput").value) || 30)
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

  if ($("#captionStyleSelect")) $("#captionStyleSelect").value = data.captionStyle || "bold";
  if (Number(data.captionSize)) captionSize.value = String(data.captionSize);
  captionPosition.value = String(Math.round((state.captionPosition || 0.76) * 100));
  const sct = document.getElementById("speakerCutToggle");
  if (sct) sct.checked = state.speakerCut;
  const ftt = document.getElementById("faceTrackToggle");
  if (ftt) ftt.checked = state.faceTrack;
  const act = $("#autoCaptionToggle");
  if (act && data.autoCaption != null) act.checked = !!data.autoCaption;
  syncAutoCaptionToggle();
  const dm = $("#durationModeSelect");
  if (dm && data.durationMode) dm.value = data.durationMode;
  const fd = $("#fixedDurationInput");
  if (fd) fd.value = String(Number(data.fixedDuration) || 30);
  syncDurationModeUi();
  applyCaptionPosition();
}

function syncAutoCaptionToggle() {
  const btn = $("#autoCaptionBtn");
  if (btn) {
    btn.disabled = !autoCaptionEnabled();
    btn.title = autoCaptionEnabled() ? "" : "Auto caption dimatikan — nyalakan toggle untuk generate caption";
  }
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
  ["change", "#autoCaptionToggle"],
  ["change", "#durationModeSelect"],
  ["input", "#fixedDurationInput"]
];
settingsControls.forEach(([eventName, sel]) => {
  $$(sel).forEach((el) => el.addEventListener(eventName, saveSettingsDebounced));
});

loadSettings();

renderClips();
selectClip(clips[0]);
initDashboard();
setRatio(currentRatio());
refreshStorage();
pollQueue();
loadEngineCompute();
syncUndoRedoButtons();
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
loadLocalAIStatus();
setInterval(pollQueue, 5000);
setInterval(loadEngineCompute, 15000);
setInterval(loadLocalAIStatus, 30000);
