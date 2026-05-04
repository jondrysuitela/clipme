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
  brandKit: {
    name: "CLIPFORGE",
    color: "#f97316",
    captionSize: "23"
  },
  isExporting: false,
  loopTimer: 0
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const clipList = $("#clipList");
const previewTitle = $("#previewTitle");
const captionBox = $("#captionBox");
const hookInput = $("#hookInput");
const captionInput = $("#captionInput");
const captionSize = $("#captionSize");
const brandInput = $("#brandInput");
const brandBadge = $("#brandBadge");
const previewFrame = $("#previewFrame");
const previewVideo = $("#previewVideo");
const uploadStatus = $("#uploadStatus");
const toast = $("#toast");
const clipTime = $("#clipTime");
const libraryList = $("#libraryList");
const exportsList = $("#exportsList");
const processSteps = $("#processSteps");

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

function currentRatio() {
  if (previewFrame.classList.contains("wide")) return "wide";
  if (previewFrame.classList.contains("square")) return "square";
  return "portrait";
}

function activeClipKey() {
  return `${state.projectId}:${state.activeClip.id}:${state.activeClip.start}:${state.activeClip.end}`;
}

function renderClips(list = clips) {
  clipList.innerHTML = "";

  list.forEach((clip) => {
    const button = document.createElement("button");
    button.type = "button";
    const readiness = clip.previewLoading ? "Loading" : clip.previewReady ? "Ready" : "Needs preview";
    button.className = `clip-card${clip.id === state.activeClip.id ? " active" : ""}`;
    button.innerHTML = `
      <span class="thumb ${clip.previewReady ? "ready" : ""} ${clip.previewLoading ? "loading" : ""}" aria-hidden="true">
        <span class="thumb-badge">${readiness}</span>
      </span>
      <span>
        <h3>Clip ${String(clip.id).padStart(2, "0")} - ${clip.title}</h3>
        <p>${clipRange(clip)}<br>${clip.hook}</p>
      </span>
      <span class="score">${clip.score}%</span>
    `;
    button.addEventListener("click", () => selectClip(clip));
    clipList.appendChild(button);
  });
}

function selectClip(clip) {
  state.activeClip = clip;
  previewTitle.textContent = `Clip ${String(clip.id).padStart(2, "0")} - ${clip.title}`;
  captionBox.textContent = `"${clip.caption}"`;
  hookInput.value = clip.hook;
  captionInput.value = clip.caption;
  clipTime.textContent = clipRange(clip);

  if (state.sourceUrl && Number.isFinite(clip.start)) {
    previewVideo.currentTime = clip.start;
  }

  renderClips(state.sorted ? [...clips].sort((a, b) => b.score - a.score) : clips);
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

function renderLibrary() {
  if (!state.projects.length) {
    libraryList.innerHTML = '<div class="empty-state">Belum ada project. Paste URL YouTube di Studio untuk mulai.</div>';
    return;
  }

  libraryList.innerHTML = state.projects.map((project) => `
    <div class="table-row">
      <div>
        <strong>${project.name}</strong>
        <span>${formatTime(project.duration)} - ${project.clips} clips - ${project.transcriptStatus}</span>
      </div>
      <span>${project.createdAt}</span>
      <button class="secondary-button compact" type="button" data-open-project="${project.id}">Open</button>
    </div>
  `).join("");

  $$("[data-open-project]").forEach((button) => {
    button.addEventListener("click", () => {
      showView("studio");
      showToast("Project metadata tersimpan. Paste URL lagi jika ingin regenerate clip.");
    });
  });
}

function renderExports() {
  if (!state.exports.length) {
    exportsList.innerHTML = '<div class="empty-state">Belum ada export. Export clip dari Studio akan muncul di sini.</div>';
    return;
  }

  exportsList.innerHTML = state.exports.map((item) => `
    <div class="table-row">
      <div>
        <strong>${item.filename}</strong>
        <span>${item.clipTitle} - ${item.createdAt}</span>
      </div>
      <span>${item.status}</span>
      <a class="secondary-button compact" href="${item.downloadUrl}" download="${item.filename}">Download</a>
    </div>
  `).join("");
}

function applyBrandKit() {
  brandInput.value = state.brandKit.name;
  brandBadge.textContent = state.brandKit.name || "BRAND";
  captionSize.value = state.brandKit.captionSize;
  captionBox.style.fontSize = `${state.brandKit.captionSize}px`;
  document.documentElement.style.setProperty("--accent", state.brandKit.color);
  document.documentElement.style.setProperty("--accent-strong", state.brandKit.color);
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
  $("#processTop").disabled = true;

  const response = await fetch("/api/upload", {
    method: "POST",
    body: form
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Upload gagal.");

  state.projectId = data.id;
  clips = data.clips;
  state.sorted = false;
  selectClip(clips[0]);

  $("#fileTitle").textContent = data.name;
  $("#fileMeta").textContent = `${formatTime(data.probe.duration)} - ${data.probe.width}x${data.probe.height} - ${data.probe.codec}`;
  uploadStatus.textContent = `${clips.length} clips ready`;
  showToast(`${clips.length} clip dibuat. Kamu bisa preview dan export MP4.`);
}

function loadProject(data) {
  state.projectId = data.id;
  state.sourceUrl = data.previewUrl || "";
  state.previewClipKey = "";
  state.youtubeUrl = data.youtubeUrl || "";
  state.noDownload = Boolean(data.noDownload);
  state.sourceName = data.name || "youtube-video";
  clips = data.clips;
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

  selectClip(clips[0]);
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
  while (true) {
    const response = await fetch(`/api/jobs/${jobId}`);
    const job = await response.json();
    if (!response.ok) throw new Error(job.error || "Job tidak ditemukan.");

    uploadStatus.textContent = `${job.status} ${job.progress}%`;

    if (job.status === "done") return job.result;
    if (job.status === "failed") throw new Error(job.error || "Export gagal.");

    await new Promise((resolve) => window.setTimeout(resolve, 1200));
  }
}

async function processYouTubeUrl() {
  const url = $("#videoUrl").value.trim();

  if (!url) {
    showToast("Paste URL YouTube dulu.");
    return;
  }

  uploadStatus.textContent = "Analyzing";
  setProcessStep("metadata");
  renderClipSkeleton();
  $("#attachUrl").disabled = true;
  $("#generateButton").disabled = true;
  $("#processTop").disabled = true;
  showToast("Membaca metadata YouTube tanpa download full video.");

  try {
    const response = await fetch("/api/youtube", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        duration: $("#durationSelect").value,
        language: $("#languageSelect").value,
        assumedDuration: 3600
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Download YouTube gagal.");

    setProcessStep("clips", ["metadata"]);
    loadProject(data);
    setProcessStep("", ["metadata", "clips"]);
    showToast(data.fastMode ? `${clips.length} clip dibuat instan. Preview akan mengambil section asli.` : `${clips.length} clip dibuat. ${data.transcriptStatus || "Transcript tidak ditemukan."}`);
  } catch (error) {
    uploadStatus.textContent = "Failed";
    setProcessStep("");
    showToast(error.message);
  } finally {
    $("#attachUrl").disabled = false;
    $("#generateButton").disabled = false;
    $("#processTop").disabled = false;
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
    $("#processTop").disabled = false;
  }
}

function playSelectedClip() {
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

  $("#playClip").disabled = true;
  $("#playClip").textContent = "Loading...";
  state.activeClip.previewLoading = true;
  renderClips(state.sorted ? [...clips].sort((a, b) => b.score - a.score) : clips);
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
        language: $("#languageSelect").value
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Preview gagal.");

    if (data.transcript?.caption) {
      captionInput.value = data.transcript.caption;
      captionBox.textContent = `"${data.transcript.caption}"`;
      state.activeClip.caption = data.transcript.caption;
      if (data.transcript.hook) {
        hookInput.value = data.transcript.hook;
        state.activeClip.hook = data.transcript.hook;
      }
      renderClips(state.sorted ? [...clips].sort((a, b) => b.score - a.score) : clips);
    }

    state.sourceUrl = data.previewUrl;
    state.previewClipKey = activeClipKey();
    state.activeClip.previewReady = true;
    state.activeClip.previewLoading = false;
    previewVideo.src = data.previewUrl;
    previewVideo.controls = true;
    previewFrame.classList.add("has-video");
    previewVideo.currentTime = 0;
    await previewVideo.play();
    uploadStatus.textContent = `${clips.length} clips ready`;
    setProcessStep("", ["metadata", "clips", "preview"]);
  } catch (error) {
    state.activeClip.previewLoading = false;
    uploadStatus.textContent = "Failed";
    setProcessStep("");
    showToast(error.message);
  } finally {
    renderClips(state.sorted ? [...clips].sort((a, b) => b.score - a.score) : clips);
    $("#playClip").disabled = false;
    $("#playClip").textContent = "Play clip";
  }
}

async function exportSelectedClip() {
  if (!state.projectId) {
    showToast("Upload video dulu sebelum export.");
    return;
  }

  if (state.isExporting) return;

  state.isExporting = true;
  $("#exportButton").disabled = true;
  $("#exportButton").textContent = "Exporting MP4...";
  showToast(state.noDownload ? "Mengambil bagian clip dari YouTube lalu membuat MP4." : "FFmpeg sedang membuat clip MP4.");

  try {
    const response = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: state.projectId,
        clipId: state.activeClip.id,
        start: state.activeClip.start,
        end: state.activeClip.end,
        caption: captionInput.value,
        language: $("#languageSelect").value,
        brand: brandInput.value,
        ratio: currentRatio(),
        color: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()
      })
    });

    const data = await response.json();
    if (!response.ok && response.status !== 202) throw new Error(data.error || "Export gagal.");
    if (!data.jobId) throw new Error("Server tidak mengembalikan job export.");

    const result = await waitForJob(data.jobId);
    const anchor = document.createElement("a");
    anchor.href = result.downloadUrl;
    anchor.download = result.filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    state.exports.unshift({
      filename: result.filename,
      downloadUrl: result.downloadUrl,
      clipTitle: previewTitle.textContent,
      status: "Done",
      createdAt: new Date().toLocaleString()
    });
    renderExports();
    uploadStatus.textContent = `${clips.length} clips ready`;
    showToast(`Export selesai: ${result.filename}`);
  } catch (error) {
    showToast(error.message);
  } finally {
    state.isExporting = false;
    $("#exportButton").disabled = false;
    $("#exportButton").textContent = "Export selected clip";
  }
}

$("#videoInput").addEventListener("change", (event) => attachFile(event.target.files[0]));

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
  if (event.key === "Enter") processYouTubeUrl();
});

$("#generateButton").addEventListener("click", () => {
  if (!state.projectId) {
    processYouTubeUrl();
    return;
  }
  showToast("Clip sudah dibuat dari video YouTube.");
});

$("#processTop").addEventListener("click", () => $("#generateButton").click());
$("#playClip").addEventListener("click", playSelectedClip);

$("#loadDemo").addEventListener("click", () => {
  $("#fileTitle").textContent = "Demo mode";
  $("#fileMeta").textContent = "Paste URL YouTube untuk proses sungguhan.";
  uploadStatus.textContent = "Demo only";
  showToast("Demo hanya UI. Paste URL YouTube untuk download dan export nyata.");
});

$("#sortClips").addEventListener("click", () => {
  state.sorted = !state.sorted;
  const list = state.sorted ? [...clips].sort((a, b) => b.score - a.score) : clips;
  renderClips(list);
  showToast(state.sorted ? "Diurutkan berdasarkan viral score." : "Urutan kembali ke timeline.");
});

captionInput.addEventListener("input", () => {
  captionBox.textContent = `"${captionInput.value}"`;
  state.activeClip.caption = captionInput.value;
});

hookInput.addEventListener("input", () => {
  state.activeClip.hook = hookInput.value;
  renderClips(state.sorted ? [...clips].sort((a, b) => b.score - a.score) : clips);
});

captionSize.addEventListener("input", () => {
  captionBox.style.fontSize = `${captionSize.value}px`;
});

brandInput.addEventListener("input", () => {
  brandBadge.textContent = brandInput.value || "BRAND";
  state.brandKit.name = brandInput.value || "BRAND";
});

$("#layoutSelect").addEventListener("change", (event) => {
  previewFrame.dataset.layout = event.target.value;
  showToast(`Layout diganti ke ${event.target.selectedOptions[0].text}.`);
});

$$(".segmented button").forEach((button) => {
  button.addEventListener("click", () => {
    $$(".segmented button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    previewFrame.classList.remove("portrait", "wide", "square");
    previewFrame.classList.add(button.dataset.ratio);
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

$$(".swatch").forEach((button) => {
  button.addEventListener("click", () => {
    $$(".swatch").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    document.documentElement.style.setProperty("--accent", button.dataset.color);
    document.documentElement.style.setProperty("--accent-strong", button.dataset.color);
    state.brandKit.color = button.dataset.color;
  });
});

$("#exportButton").addEventListener("click", exportSelectedClip);

$$(".nav-item").forEach((button) => {
  button.addEventListener("click", () => {
    showView(button.dataset.view);
  });
});

$("#clearLibrary").addEventListener("click", () => {
  state.projects = [];
  renderLibrary();
  showToast("Library dibersihkan.");
});

$("#clearExports").addEventListener("click", () => {
  state.exports = [];
  renderExports();
  showToast("Riwayat export dibersihkan.");
});

$("#brandKitName").addEventListener("input", (event) => {
  state.brandKit.name = event.target.value || "BRAND";
  $("#brandKitPreview").textContent = state.brandKit.name;
});

$("#brandKitCaption").addEventListener("change", (event) => {
  state.brandKit.captionSize = event.target.value;
});

$$(".brand-swatch").forEach((button) => {
  button.addEventListener("click", () => {
    $$(".brand-swatch").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.brandKit.color = button.dataset.color;
    document.documentElement.style.setProperty("--accent", button.dataset.color);
    document.documentElement.style.setProperty("--accent-strong", button.dataset.color);
  });
});

$("#applyBrandKit").addEventListener("click", () => {
  applyBrandKit();
  showView("studio");
  showToast("Brand Kit diterapkan ke Studio.");
});

renderClips();
selectClip(clips[0]);
renderLibrary();
renderExports();
