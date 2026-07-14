import { useEffect, useMemo, useRef, useState } from "react";
import type { AppDiagnostics, AppSettings, ClipAssets, ClipCandidate, ClipCurationStatus, ExportResolution, FfmpegAvailability, Job, Project, VerticalMode } from "../shared/types";
import { EXPORT_RESOLUTION_OPTIONS, PIPELINE_STEPS } from "../shared/constants/app";
import logoUrl from "./assets/clipme-mark.png";
import Toasts, { AppToast } from "./components/Toasts";
import LazyVideo from "./components/LazyVideo";
import Button from "./components/ui/Button";
import OnboardingModal from "./components/OnboardingModal";
import ShortcutsModal from "./components/ShortcutsModal";
import ReleaseNotesModal from "./components/ReleaseNotesModal";
import ClipTrim from "./components/ClipTrim";

const SMART_EXPORT_MODE: VerticalMode = "face-speaker-cut";
const SOCIAL_PLATFORMS = ["TikTok", "Reels", "Shorts", "LinkedIn"];
const PLATFORM_PRESETS: Record<string, { resolution: ExportResolution; verticalMode: VerticalMode }> = {
  TikTok: { resolution: "1080x1920", verticalMode: "face-speaker-cut" },
  Reels: { resolution: "1080x1920", verticalMode: "face-speaker-cut" },
  Shorts: { resolution: "720x1280", verticalMode: "center-crop" },
  LinkedIn: { resolution: "1080x1350", verticalMode: "center-crop" }
};
type ClipFilter = "all" | "high-score" | "exported" | "not-exported" | "keep" | "skip";
type ClipSort = "score" | "start" | "duration";

function formatDuration(seconds?: number) {
  if (!seconds) return "-";
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function formatBytes(bytes?: number) {
  if (!bytes) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function toFileUrl(filePath: string) {
  return `clipme-media://local/${encodeURIComponent(filePath)}`;
}

export default function App() {
  const activeProjectIdRef = useRef<string | undefined>(undefined);
  const deletingProjectIdRef = useRef<string | undefined>(undefined);
  const deletedProjectIdsRef = useRef<Set<string>>(new Set());
  const sessionStartedAtRef = useRef(new Date().toISOString());
  const projectNameInputRef = useRef<HTMLInputElement>(null);
  const previewPanelRef = useRef<HTMLElement>(null);
  const mainPreviewRef = useRef<HTMLVideoElement>(null);
  const sidebarPreviewRef = useRef<HTMLVideoElement>(null);
  const [urlToImport, setUrlToImport] = useState<string>("");
  const [dismissedFailedJobIds, setDismissedFailedJobIds] = useState<Set<string>>(new Set());
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | undefined>();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [settings, setSettings] = useState<AppSettings | undefined>();
  const [ffmpeg, setFfmpeg] = useState<FfmpegAvailability | undefined>();
  const [clips, setClips] = useState<ClipCandidate[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | undefined>();
  const [previewCaptionText, setPreviewCaptionText] = useState<string | undefined>();
  const [previewSegments, setPreviewSegments] = useState<Array<{ start: number; end: number; text: string }>>([]);
  const [previewCurrentTime, setPreviewCurrentTime] = useState(0);
  const [previewPanelVisible, setPreviewPanelVisible] = useState(true);
  const [diagnostics, setDiagnostics] = useState<AppDiagnostics | undefined>();
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [failedDetailsOpen, setFailedDetailsOpen] = useState(false);
  const [exportResolution, setExportResolution] = useState<ExportResolution>("1080x1920");
  const [copiedMessage, setCopiedMessage] = useState<string | undefined>();
  const [toasts, setToasts] = useState<AppToast[]>([]);
  const [selectedPlatform, setSelectedPlatform] = useState<string | undefined>(undefined);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [clipFilter, setClipFilter] = useState<ClipFilter>("all");
  const [clipSort, setClipSort] = useState<ClipSort>("score");
  const [scoreThreshold, setScoreThreshold] = useState(0);
  const [busy, setBusy] = useState(false);
  const [zoomEnabled, setZoomEnabled] = useState(true);
  const [jobsPanelOpen, setJobsPanelOpen] = useState(false);
  const [exportJobs, setExportJobs] = useState<Job[]>([]);
  const [generatingAssetsId, setGeneratingAssetsId] = useState<string | undefined>();
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);
  const [trimmingClipId, setTrimmingClipId] = useState<string | undefined>();
  const [subtitleVisible, setSubtitleVisible] = useState(true);
  const [logsOpen, setLogsOpen] = useState(false);
  const [projectLogsLoading, setProjectLogsLoading] = useState(false);
  const [projectLogs, setProjectLogs] = useState<Array<{ name: string; file: string; size: number; mtimeMs: number }>>([]);
  const [selectedLogName, setSelectedLogName] = useState<string | undefined>();
  const [selectedLogContent, setSelectedLogContent] = useState<string | undefined>();

  async function openProjectLogs() {
    if (!activeProject) return;
    setLogsOpen(true);
    setProjectLogsLoading(true);
    try {
      const list = await window.clipme.projectLogsList(activeProject.id);
      setProjectLogs(list);
      const nextName = list[0]?.name;
      setSelectedLogName(nextName);
      setSelectedLogContent(undefined);
      if (nextName) {
        const content = await window.clipme.projectLogRead(activeProject.id, nextName);
        setSelectedLogContent(content);
      }
    } finally {
      setProjectLogsLoading(false);
    }
  }

  async function readProjectLog(logName: string) {
    if (!activeProject) return;
    setSelectedLogName(logName);
    setSelectedLogContent(undefined);
    const content = await window.clipme.projectLogRead(activeProject.id, logName);
    setSelectedLogContent(content);
  }


  function addToast(message: string, variant?: AppToast["variant"]) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((current) => [...current, { id, message, variant }]);
  }

  function removeToast(id: string) {
    setToasts((current) => current.filter((t) => t.id !== id));
  }

  function humanizeJobType(type: string) {
    return String(type)
      .split("_")
      .map((p) => (p ? p[0] + p.slice(1).toLowerCase() : p))
      .join(" ");
  }

  function selectPlatform(platform: string) {
    setSelectedPlatform((current) => (current === platform ? undefined : platform));
    const preset = PLATFORM_PRESETS[platform];
    if (preset) {
      setExportResolution(preset.resolution);
      addToast(`${platform} preset selected`, "info");
    }
  }
  const visibleJobs = useMemo(
    () =>
      jobs.filter((job) => {
        if (job.projectId && deletedProjectIdsRef.current.has(job.projectId)) return false;
        if ((job.status === "waiting" || job.status === "running") && job.createdAt < sessionStartedAtRef.current) return false;
        return true;
      }),
    [jobs]
  );
  const activeJobs = useMemo(() => (activeProject ? visibleJobs.filter((job) => job.projectId === activeProject.id) : []), [visibleJobs, activeProject]);
  const activeQueue = activeJobs.filter((job) => job.status === "waiting" || job.status === "running");
  const importInProgress = activeQueue.some((job) => job.type === "IMPORT_VIDEO" || job.type === "IMPORT_URL");
  const hasImported = Boolean(activeProject?.originalVideoPath);
  const hasAudioExtracted = activeJobs.some((job) => job.type === "EXTRACT_AUDIO" && job.status === "completed");
  const hasTranscribed = activeJobs.some((job) => job.type === "TRANSCRIBE_AUDIO" && job.status === "completed");
  const hasAnalyzed = activeJobs.some((job) => job.type === "ANALYZE_HOOKS" && job.status === "completed") || clips.length > 0;
  const runningJob = activeJobs.find((job) => job.status === "running");
  const waitingJob = activeJobs.find((job) => job.status === "waiting");
  const failedJob = activeJobs.find(
    (job) =>
      job.status === "failed" &&
      job.updatedAt >= sessionStartedAtRef.current &&
      job.error?.message !== "Job interrupted because the app was restarted." &&
      !dismissedFailedJobIds.has(job.id)
  );
  const statusJob = runningJob ?? waitingJob ?? failedJob;
  const selectedClip = clips.find((clip) => clip.id === selectedClipId) ?? clips.find((clip) => clip.previewPath) ?? clips[0];
  const previewSource = selectedClip?.previewPath ?? activeProject?.originalVideoPath;
  const visibleClips = useMemo(() => {
    const filtered = clips.filter((clip) => {
      if (clipFilter === "high-score") return clip.hookScore >= 75;
      if (clipFilter === "exported") return Boolean(clip.exportPath);
      if (clipFilter === "not-exported") return !clip.exportPath;
      if (clipFilter === "keep") return clip.curationStatus === "keep";
      if (clipFilter === "skip") return clip.curationStatus === "skip";
      return true;
    });
    return [...filtered].sort((a, b) => {
      if (clipSort === "start") return a.startTime - b.startTime;
      if (clipSort === "duration") return b.duration - a.duration || b.hookScore - a.hookScore;
      return b.hookScore - a.hookScore || a.startTime - b.startTime;
    });
  }, [clips, clipFilter, clipSort]);
  const exportedCount = clips.filter((clip) => clip.exportPath).length;
  const highScoreCount = clips.filter((clip) => clip.hookScore >= 75).length;
  const keepCount = clips.filter((clip) => clip.curationStatus === "keep").length;

  useEffect(() => {
    const panel = previewPanelRef.current;
    if (!panel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setPreviewPanelVisible(entry.isIntersecting && entry.intersectionRatio > 0.25),
      { threshold: [0, 0.25, 0.6] }
    );
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const target = previewPanelVisible ? mainPreviewRef.current : sidebarPreviewRef.current;
    if (!target || !previewSource) return;
    target.currentTime = 0;
    void target.play().catch(() => {
      // Browser/Electron may block autoplay until the user's first gesture.
    });
  }, [previewSource, selectedClipId, previewPanelVisible]);

  useEffect(() => {
    if (settings && !settings.onboardingSeen) setShowOnboarding(true);
  }, [settings]);

        // Load transcript for preview subtitles
    useEffect(() => {
      if (!activeProject) {
        setPreviewSegments([]);
        setPreviewCaptionText(undefined);
        return;
      }
      let cancelled = false;
      async function load() {
        try {
          // Load project-level transcript (full transcription)
          const data = await window.clipme.getTranscript(activeProject!.id);
          if (cancelled) return;
          if (data && data.segments.length > 0) {
            let segments;
            if (selectedClip) {
              // Clip preview mode: timestamps relative to clip start
              segments = data.segments
                .filter((seg) => seg.end > selectedClip.startTime && seg.start < selectedClip.endTime)
                .map((seg) => ({
                  start: Math.max(0, seg.start - selectedClip.startTime),
                  end: Math.min(selectedClip.endTime, seg.end) - selectedClip.startTime,
                  text: seg.text,
                }))
                .sort((a, b) => a.start - b.start);
            } else {
              // Original video mode: use absolute timestamps
              segments = data.segments.map((seg) => ({
                start: seg.start,
                end: seg.end,
                text: seg.text,
              }));
            }
            setPreviewSegments(segments);
          } else {
            setPreviewSegments([]);
          }
        } catch {
          // Transcript not available
          setPreviewSegments([]);
        }
      }
      void load();
      return () => { cancelled = true; };
    }, [activeProject?.id, selectedClip?.id, activeProject, selectedClip]);

  // Track video time for caption overlay
  useEffect(() => {
    const video = mainPreviewRef.current;
    if (!video) return;
    const handler = () => setPreviewCurrentTime(video.currentTime);
    video.addEventListener("timeupdate", handler);
    return () => video.removeEventListener("timeupdate", handler);
  }, [previewSource, selectedClipId]);

  // Update caption text based on current time
  useEffect(() => {
    const active = previewSegments.find(
      (seg) => previewCurrentTime >= seg.start && previewCurrentTime < seg.end
    );
    setPreviewCaptionText(active?.text);
  }, [previewCurrentTime, previewSegments]);

  function releaseVideoElements() {
    for (const video of [mainPreviewRef.current, sidebarPreviewRef.current]) {
      if (!video) continue;
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
  }

  async function activateProject(project?: Project) {
    if (project && deletedProjectIdsRef.current.has(project.id)) return;
    activeProjectIdRef.current = project?.id;
    setDismissedFailedJobIds(new Set());
    setActiveProject(project);
    setSelectedClipId(undefined);
    if (!project) {
      setClips([]);
      setJobs((current) => current.filter((job) => !job.projectId || !deletedProjectIdsRef.current.has(job.projectId)));
      return;
    }
    await window.clipme.cancelOtherProjectJobs(project.id);
    const [projectClips, jobList] = await Promise.all([window.clipme.listClips(project.id), window.clipme.listJobs()]);
    if (deletedProjectIdsRef.current.has(project.id)) return;
    setClips(projectClips);
    setJobs(jobList.filter((job) => !job.projectId || !deletedProjectIdsRef.current.has(job.projectId)));
  }

  async function refresh() {
    const [projectList, jobList, appSettings] = await Promise.all([
      window.clipme.listProjects(),
      window.clipme.listJobs(),
      window.clipme.getSettings()
    ]);
    const ffmpegStatus = await window.clipme.checkFfmpeg();
    const visibleProjects = projectList.filter((project) => !deletedProjectIdsRef.current.has(project.id));
    setProjects(visibleProjects);
    setJobs(jobList);
    setSettings(appSettings);
    setExportResolution(appSettings.defaultExportResolution);
    setFfmpeg(ffmpegStatus);
    if (activeProject) {
      const nextProject = visibleProjects.find((project) => project.id === activeProject.id);
      activeProjectIdRef.current = nextProject?.id;
      setActiveProject(nextProject);
      setClips(nextProject ? await window.clipme.listClips(nextProject.id) : []);
      if (nextProject) await window.clipme.cancelOtherProjectJobs(nextProject.id);
    } else {
      activeProjectIdRef.current = visibleProjects[0]?.id;
      setActiveProject(visibleProjects[0]);
      setClips(visibleProjects[0] ? await window.clipme.listClips(visibleProjects[0].id) : []);
      if (visibleProjects[0]) await window.clipme.cancelOtherProjectJobs(visibleProjects[0].id);
    }
  }

  useEffect(() => {
    void refresh();

    let refreshTimer: number | undefined;
    const scheduleRefresh = (reasonJob?: Job) => {
      // Avoid full reload on every progress update; refresh only after completion/failure.
      if (reasonJob && reasonJob.status !== "completed" && reasonJob.status !== "failed") return;

      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = undefined;
        void refresh();
      }, 250);
    };

    return window.clipme.onJobUpdated((updated) => {
      if (updated.projectId && deletedProjectIdsRef.current.has(updated.projectId)) return;
      if (deletingProjectIdRef.current && updated.projectId === deletingProjectIdRef.current) return;

      setJobs((current) => [updated, ...current.filter((job) => job.id !== updated.id)]);

      // show concise toasts for completions and failures
      if (updated.status === "completed") {
        addToast(`${humanizeJobType(updated.type)} completed`, "success");
      } else if (updated.status === "failed") {
        addToast(`${humanizeJobType(updated.type)} failed: ${updated.error?.message ?? "Error"}`, "error");
      }

      scheduleRefresh(updated);
    });
  }, []);


  useEffect(() => {
    const offAvailable = window.clipme.onUpdateAvailable((info) => addToast("Update available", "info"));
    const offDownloaded = window.clipme.onUpdateDownloaded((info) => addToast("Update downloaded — will install on quit", "success"));
    const offError = window.clipme.onUpdateError((err) => addToast(`Update error: ${err}`, "error"));
    return () => {
      offAvailable();
      offDownloaded();
      offError();
    };
  }, []);

  useEffect(() => {
    // Renderer should release any open video handles when main requests pre-delete
    const off = window.clipme.onProjectPreDelete((projectId) => {
      // if the currently active project matches, release previews
      if (activeProject && projectId === activeProject.id) {
        releaseVideoElements();
        addToast("Releasing media resources before delete", "info");
      } else {
        // still release to be safe for any leftover elements
        releaseVideoElements();
      }
    });
    return () => off();
  }, [activeProject]);

  useEffect(() => {
    if (!settings?.telemetryEnabled) return;
    let mounted = true;
    (async () => {
      try {
        const dsn = await window.clipme.getSentryDsn();
        if (!dsn) return;
        const diagnostics = await window.clipme.getDiagnostics();
        // Renderer shouldn't import electron-only packages in Vite build.
        // Main process initializes telemetry.
        void diagnostics;
        if (mounted) addToast("Crash reporting enabled", "info");
      } catch (err) {
        console.warn("Sentry init failed", err);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [settings?.telemetryEnabled]);

  async function createNewProject() {
    const name = projectNameInputRef.current?.value.trim() || "My ClipMe Project";
    setBusy(true);
    try {
      const project = await window.clipme.createProject(name);
      setProjects((current) => [project, ...current]);
      await activateProject(project);
    } finally {
      setBusy(false);
    }
  }

  async function createSampleProject() {
    if (busy) return;
    setBusy(true);
    try {
      const project = await window.clipme.createProject("Sample Project");
      setProjects((current) => [project, ...current]);
      await activateProject(project);
      void window.clipme.updateSettings({ onboardingSeen: true });
      setShowOnboarding(false);
      addToast("Sample project created", "success");
    } catch (err) {
      addToast("Failed to create sample project", "error");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        void createNewProject();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "i") {
        e.preventDefault();
        void importVideo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        void analyzeHooksWithPreviews();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "e") {
        e.preventDefault();
        void exportSelectedPreview();
      }
      if (e.key === "?") {
        e.preventDefault();
        setShowShortcuts(true);
      }
      if (e.key.toLowerCase() === "g") {
        e.preventDefault();
        setShowOnboarding(true);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [createNewProject, importVideo, analyzeHooksWithPreviews, exportSelectedPreview]);

  async function importVideo() {
    if (!activeProject) return;
    setBusy(true);
    setDismissedFailedJobIds(new Set());
    try {
      const job = await window.clipme.importVideo(activeProject.id);
      setJobs((current) => [job, ...current]);
    } finally {
      setBusy(false);
    }
  }

  async function analyzeHooksWithPreviews() {
    if (!activeProject) return;
    setBusy(true);
    setDismissedFailedJobIds(new Set());
    try {
      // Create pipeline jobs sequentially so progress panel shows each step
      const allJobs: Job[] = [];

      // 1. Extract audio if not done yet
      if (!hasAudioExtracted) {
        const audioJob = await window.clipme.startPipeline(activeProject.id);
        allJobs.push(...audioJob);
        setJobs((current) => [...allJobs, ...current]);
      }

      // 2. Transcribe if not done yet
      if (!hasTranscribed) {
        const transcribeJob = await window.clipme.transcribeAudio(activeProject.id);
        allJobs.push(transcribeJob);
        setJobs((current) => [...allJobs, ...current]);
      }

      // 3. Analyze hooks + generate previews
      const analyzeJobs = await window.clipme.analyzeHooksWithPreviews(activeProject.id);
      allJobs.push(...analyzeJobs);
      setJobs((current) => [...allJobs, ...current]);
    } finally {
      setBusy(false);
    }
  }

  async function exportFinal(clipId: string) {
    if (!activeProject) return;
    setDismissedFailedJobIds(new Set());
    const verticalMode = selectedPlatform && PLATFORM_PRESETS[selectedPlatform] ? PLATFORM_PRESETS[selectedPlatform].verticalMode : SMART_EXPORT_MODE;
    const job = await window.clipme.exportFinal(activeProject.id, clipId, {
      subtitleOn: false,
      verticalMode,
      resolution: exportResolution,
      zoomEnabled
    });
    setJobs((current) => [job, ...current]);
  }

  async function exportSelectedPreview() {
    const clip = selectedClip ?? clips[0];
    if (!clip) return;
    setBusy(true);
    try {
      await exportFinal(clip.id);
    } finally {
      setBusy(false);
    }
  }

  async function exportAllHooks() {
    if (!activeProject || clips.length === 0) return;
    await exportClipBatch(clips);
  }

  async function exportKeptClips() {
    const keptClips = clips.filter((clip) => clip.curationStatus === "keep");
    if (!activeProject || keptClips.length === 0) return;
    await exportClipBatch(keptClips);
  }

  async function exportClipBatch(targetClips: ClipCandidate[]) {
    if (!activeProject || targetClips.length === 0) return;
    setBusy(true);
    setDismissedFailedJobIds(new Set());
    try {
      const createdJobs: Job[] = [];
      for (const clip of targetClips) {
        const job = await window.clipme.exportFinal(activeProject.id, clip.id, {
          subtitleOn: false,
          verticalMode: SMART_EXPORT_MODE,
          resolution: exportResolution,
          zoomEnabled
        });
        createdJobs.push(job);
      }
      setJobs((current) => [...createdJobs, ...current]);
    } finally {
      setBusy(false);
    }
  }

  async function cleanProjectCache(scope: string) {
    const title = scope === "active" ? "Clean active project cache?" : "Clean ALL projects cache?";
    const msg = "This will delete audio, transcripts, previews, exports, and subtitles. Derived data only, original videos are kept.";
    if (!window.confirm(title + "\n\n" + msg)) return;
    setBusy(true);
    try {
      await window.clipme.cleanCache(scope === "active" ? activeProject?.id : undefined);
      addToast("Cache cleaned" + (scope === "all" ? " for all projects" : ""), "success");
    } catch (err: any) {
      addToast("Failed to clean cache", "error");
    } finally {
      setBusy(false);
    }
  }

  async function retryJob(jobId: string) {
    try {
      const newJob = await window.clipme.retryJob(jobId);
      setJobs((current) => [newJob, ...current]);
      addToast("Job retry queued", "success");
    } catch (err: any) {
      addToast("Failed to retry job: " + (err.message ?? "Unknown"), "error");
    }
  }

  async function generateAssets(clipId: string) {
    if (!activeProject) return;
    setGeneratingAssetsId(clipId);
    try {
      const assets = await window.clipme.generateClipAssets(activeProject.id, clipId);
      setClips((current) => current.map((item) =>
        item.id === clipId ? { ...item, assets } : item
      ));
      addToast("Assets generated: SEO desc, keywords, tags", "success");
    } catch (err: any) {
      addToast("Failed to generate assets", "error");
    } finally {
      setGeneratingAssetsId(undefined);
    }
  }

  async function generateAllAssets() {
    if (!activeProject) return;
    setBusy(true);
    try {
      const count = await window.clipme.generateAllClipAssets(activeProject.id);
      const updatedClips = await window.clipme.listClips(activeProject.id);
      setClips(updatedClips);
      addToast(`Assets generated for ${count} clips`, "success");
    } catch (err: any) {
      addToast("Failed to generate assets", "error");
    } finally {
      setBusy(false);
    }
  }

  async function openDiagnostics() {
    setDiagnosticsOpen(true);
    setDiagnostics(await window.clipme.getDiagnostics());
  }

  async function copyClipCaption(clip: ClipCandidate) {
    const template = settings?.captionTemplate ?? "{caption}\n\n{hashtags}";
    const text = template.replace("{caption}", clip.suggestedCaption ?? "").replace("{hashtags}", clip.hashtags.join(" "));
    await copyToClipboard(text, "Caption copied");
  }

  async function copyToClipboard(text: string, message: string) {
    await window.clipme.copyText(text);
    setCopiedMessage(message);
    window.setTimeout(() => setCopiedMessage(undefined), 1800);
  }

  async function saveTrim(clipId: string, startTime: number, endTime: number) {
    const clip = clips.find((c) => c.id === clipId);
    if (!clip) return;
    try {
      const updated = await window.clipme.updateClip({
        ...clip, startTime, endTime,
        duration: Math.max(0, endTime - startTime)
      });
      setClips((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setTrimmingClipId(undefined);
      addToast("Clip trimmed", "success");
    } catch {
      addToast("Failed to save trim", "error");
    }
  }

  async function updateCurationStatus(clip: ClipCandidate, curationStatus: ClipCurationStatus) {
    const updated = await window.clipme.updateClip({ ...clip, curationStatus });
    setClips((current) => current.map((item) => (item.id === updated.id ? updated : item)));
  }

  async function createExportPack() {
    if (!activeProject || exportedCount === 0) return;
    const summaryPath = await window.clipme.createExportPackSummary(activeProject.id);
    setCopiedMessage("Export pack summary created");
    window.setTimeout(() => setCopiedMessage(undefined), 1800);
    await window.clipme.showItemInFolder(summaryPath);
  }

  async function deleteActiveProject(project: Project) {
    const ok = window.confirm(`Delete project "${project.name}" and all local files?`);
    if (!ok) return;
    setBusy(true);
    releaseVideoElements();
    deletingProjectIdRef.current = project.id;
    deletedProjectIdsRef.current.add(project.id);
    const fallbackProject = projects.find((candidate) => candidate.id !== project.id);
    setProjects((current) => current.filter((candidate) => candidate.id !== project.id));
    setJobs((current) => current.filter((job) => job.projectId !== project.id));
    setClips([]);
    setSelectedClipId(undefined);
    if (activeProjectIdRef.current === project.id) {
      activeProjectIdRef.current = fallbackProject?.id;
      setActiveProject(fallbackProject);
    }
    try {
      await delay(120);
      await window.clipme.deleteProject(project.id);
      const nextProjects = (await window.clipme.listProjects()).filter((candidate) => candidate.id !== project.id);
      setProjects(nextProjects);
      await activateProject(nextProjects.find((candidate) => candidate.id === activeProjectIdRef.current) ?? nextProjects[0]);
    } finally {
      setBusy(false);
      deletingProjectIdRef.current = undefined;
    }
  }

  function delay(ms: number) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-logo" src={logoUrl} alt="ClipMe" />
          <div className="brand-copy">
            <h1>ClipMe</h1>
            <span>Desktop clipper MVP</span>
          </div>
        </div>

        <section className="new-project">
          <label htmlFor="project-name">New project</label>
          <div className="inline-form">
            <input id="project-name" ref={projectNameInputRef} defaultValue="My ClipMe Project" autoComplete="off" />
            <button onClick={createNewProject} disabled={busy}>Create</button>
          </div>
        </section>

        {previewSource && !previewPanelVisible && (
          <section className="sidebar-preview-card">
            <div className="sidebar-preview-heading">
              <strong>{selectedClip?.title ?? "Preview"}</strong>
              <span>{selectedClip ? `${formatDuration(selectedClip.startTime)} - ${formatDuration(selectedClip.endTime)}` : "original video"}</span>
            </div>
            <div className="sidebar-preview-with-captions">
            <video ref={sidebarPreviewRef} className="sidebar-preview" src={toFileUrl(previewSource)} controls muted preload="metadata" />
            {subtitleVisible && previewCaptionText && (
              <div className="sidebar-caption-overlay">
                <span className="sidebar-caption-text">{previewCaptionText}</span>
              </div>
            )}
          </div>
          </section>
        )}

        <nav className="project-list" aria-label="Projects">
          {projects.map((project) => (
            <article
              key={project.id}
              className={project.id === activeProject?.id ? "project-item active" : "project-item"}
            >
              <button className="project-select" onClick={() => void activateProject(project)}>
                <strong>{project.name}</strong>
                <span>{project.status}</span>
              </button>
              <button className="icon-button danger" title="Delete project" onClick={() => void deleteActiveProject(project)} disabled={busy}>
                Delete
              </button>
            </article>
          ))}
          {projects.length === 0 && <p className="empty-text">No projects yet.</p>}
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">AI clipping studio</p>
            <h2>{activeProject?.name ?? "Create a project to begin"}</h2>
                                {/* Auto Subtitle Toggle */}
            <div className="subtitle-toggle-bar">
              <label className="subtitle-toggle-label">
                <input
                  type="checkbox"
                  checked={subtitleVisible}
                  onChange={(e) => setSubtitleVisible(e.target.checked)}
                  className="subtitle-checkbox"
                />
                <span className="subtitle-toggle-text">Subtitles</span>
              </label>
              {subtitleVisible && (
                <select
                  className="subtitle-position-select"
                  value={settings?.subtitlePosition ?? "bottom"}
                  onChange={(e) => {
                    const pos = e.target.value as "bottom" | "middle";
                    void window.clipme.updateSettings({ subtitlePosition: pos });
                  }}
                >
                  <option value="bottom">Bottom</option>
                  <option value="middle">Middle</option>
                </select>
              )}
            </div>
<div className="platform-chips" aria-label="Supported social formats">
                      {SOCIAL_PLATFORMS.map((platform) => (
                        <button key={platform} type="button" className={selectedPlatform === platform ? "active" : ""} onClick={() => selectPlatform(platform)}>
                          {platform}
                        </button>
                      ))}
                    </div>
          </div>
          <div className="toolbar">
            <Button variant="ghost" onClick={() => setShowOnboarding(true)}>Get started</Button>
            <Button variant="ghost" onClick={() => setShowShortcuts(true)}>Shortcuts</Button>
            <Button variant="ghost" onClick={() => setReleaseNotesOpen(true)}>What's New</Button>
            <label className="url-import">
              <input
                placeholder="Paste YouTube URL"
                value={urlToImport}
                onChange={(e) => setUrlToImport(e.target.value)}
              />
              <button
                onClick={async () => {
                  if (!activeProject) return;
                  const url = urlToImport.trim();
                  if (!url) return;
                  setBusy(true);
                  setDismissedFailedJobIds(new Set());
                  try {
                    const job = await window.clipme.importVideoFromUrl(activeProject.id, url);
                    setJobs((current) => [job, ...current]);
                    setUrlToImport("");
                  } finally {
                    setBusy(false);
                  }
                }}
                disabled={!activeProject || busy || urlToImport.trim().length === 0}
              >
                Import URL
              </button>
            </label>
            <button className="primary-action" onClick={importVideo} disabled={!activeProject || busy}>
              Import Video
            </button>
            {clips.length === 0 ? (
              <button className="primary-action" onClick={analyzeHooksWithPreviews} disabled={!activeProject || !hasImported || importInProgress || busy}>
                Analyze Hooks
              </button>
            ) : (
              <>
                <label className="export-format">
                  <span>Social format</span>
                  <select value={exportResolution} onChange={(event) => setExportResolution(event.target.value as ExportResolution)}>
                    {EXPORT_RESOLUTION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="zoom-toggle" title="Auto zoom-in on high-scoring moments">
                  <input
                    type="checkbox"
                    checked={zoomEnabled}
                    onChange={(e) => setZoomEnabled(e.target.checked)}
                  />
                  <span>Zoom</span>
                </label>
                <button className="ghost-button" onClick={() => void generateAllAssets()} disabled={clips.length === 0 || busy}>
                  Generate SEO
                </button>
                <button className="ghost-button" onClick={() => setJobsPanelOpen(true)} disabled={jobs.filter(j => j.type === "EXPORT_FINAL").length === 0}>
                  Export Queue ({jobs.filter(j => j.type === "EXPORT_FINAL").length})
                </button>
                <label>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <input
                      type="checkbox"
                      checked={settings?.telemetryEnabled ?? false}
                      onChange={(event) => setSettings((current) => current && { ...current, telemetryEnabled: event.target.checked })}
                      onBlur={() => settings && window.clipme.updateSettings({ telemetryEnabled: settings.telemetryEnabled }).then(() => refresh())}
                    />
                    <div>
                      <div>Enable crash reports</div>
                      <small style={{ color: "var(--muted)" }}>Anonymous crash reports to help improve ClipMe. Opt-in only.</small>
                    </div>
                  </div>
                </label>
                <button className="primary-action" onClick={exportSelectedPreview} disabled={!selectedClip || busy || activeQueue.length > 0}>
                  Export Previewed
                </button>
                <button className="primary-action secondary-action" onClick={exportKeptClips} disabled={keepCount === 0 || busy || activeQueue.length > 0}>
                  Export Keep ({keepCount})
                </button>
                <button onClick={exportAllHooks} disabled={clips.length === 0 || busy || activeQueue.length > 0}>
                  Export All Hooks
                </button>
              </>
            )}
            <button onClick={() => void openDiagnostics()}>
              Diagnostics
            </button>
          </div>
        </header>

        <section className="pipeline-strip">
          {PIPELINE_STEPS.map((step, index) => (
            <div
              key={step}
              className={
                (index === 0 && hasImported) ||
                (index === 1 && hasAudioExtracted) ||
                (index === 2 && hasTranscribed) ||
                (index === 3 && hasAnalyzed)
                  ? "step done"
                  : "step"
              }
            >
              <span>{index + 1}</span>
              <strong>{step}</strong>
            </div>
          ))}
        </section>

        <div className="content-grid">
          <section className="panel">
            <div className="panel-heading">
              <h3>Project</h3>
              <span>{activeProject?.status ?? "idle"}</span>
            </div>
            {logsOpen && activeProject && (
              <div className="panel" style={{ marginTop: 12 }}>
                <div className="panel-heading" style={{ marginBottom: 12 }}>
                  <h3 style={{ margin: 0 }}>Activity</h3>
                  <button className="ghost-button" onClick={() => setLogsOpen(false)}>Close</button>
                </div>
                {projectLogsLoading ? (
                  <p className="empty-text">Loading logs...</p>
                ) : projectLogs.length === 0 ? (
                  <p className="empty-text">No activity logs yet.</p>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 12 }}>
                    <div style={{ border: "1px solid #2d3440", borderRadius: 8, padding: 10, background: "#10141c" }}>
                      <div style={{ display: "grid", gap: 6 }}>
                        {projectLogs.map((log) => (
                          <button
                            key={log.name}
                            className="ghost-button"
                            style={{ justifyContent: "flex-start", textAlign: "left", background: log.name === selectedLogName ? "#202734" : undefined }}
                            onClick={() => void readProjectLog(log.name)}
                          >
                            {log.name}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div style={{ border: "1px solid #2d3440", borderRadius: 8, padding: 10, background: "#10141c" }}>
                      {selectedLogContent === undefined ? (
                        <p className="empty-text">Select a log.</p>
                      ) : (
                        <pre className="error-details" style={{ margin: 0, maxHeight: 360, whiteSpace: "pre-wrap" }}>
                          {selectedLogContent}
                        </pre>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeProject ? (
              <>
                <dl className="metadata-grid">
                  <div><dt>Folder</dt><dd>{activeProject.rootPath}</dd></div>
                  <div><dt>Original</dt><dd>{activeProject.originalVideoPath ?? "Not imported"}</dd></div>
                  <div><dt>Duration</dt><dd>{formatDuration(activeProject.metadata?.duration)}</dd></div>
                  <div><dt>Resolution</dt><dd>{activeProject.metadata ? `${activeProject.metadata.width}x${activeProject.metadata.height}` : "-"}</dd></div>
                  <div><dt>FPS</dt><dd>{activeProject.metadata?.fps ? activeProject.metadata.fps.toFixed(2) : "-"}</dd></div>
                  <div><dt>Video codec</dt><dd>{activeProject.metadata?.videoCodec ?? "-"}</dd></div>
                  <div><dt>Audio codec</dt><dd>{activeProject.metadata?.audioCodec ?? "-"}</dd></div>
                  <div><dt>File size</dt><dd>{formatBytes(activeProject.metadata?.fileSize)}</dd></div>
                </dl>
                <div className="panel-actions">
                  <button className="ghost-button" onClick={() => window.clipme.openProjectFolder(activeProject.id)}>
                    Open Project Folder
                  </button>
                  <button className="ghost-button" onClick={() => window.clipme.openProjectExportsFolder(activeProject.id)}>
                    Open Exports
                  </button>
                  <button className="ghost-button" onClick={() => void cleanProjectCache("active")} style={{ color: "#ff9c7f" }} title="Delete derived data (keep original video)">Clean Cache</button>
                  <button className="ghost-button" onClick={() => void openProjectLogs()}>
                    Activity
                  </button>
                </div>


              </>
            ) : (
              <p className="empty-text">Create or reopen a project, then import a local video.</p>
            )}
            <div className="project-settings">
              <div className="panel-heading compact-heading">
                <h3>Settings</h3>
                <span className={ffmpeg?.ffmpegOk && ffmpeg.ffprobeOk ? "status-good" : "status-bad"}>
                  {ffmpeg?.ffmpegOk && ffmpeg.ffprobeOk ? "FFmpeg ready" : "FFmpeg missing"}
                </span>
              </div>
              <div className="settings-grid compact-settings">
                <label>
                  Project folder
                  <input
                    value={settings?.defaultProjectFolder ?? ""}
                    onChange={(event) => setSettings((current) => current && { ...current, defaultProjectFolder: event.target.value })}
                    onBlur={() => settings && window.clipme.updateSettings({ defaultProjectFolder: settings.defaultProjectFolder }).then(() => refresh())}
                  />
                </label>
                <label>
                  Max jobs
                  <input
                    type="number"
                    min={1}
                    max={4}
                    value={settings?.maxConcurrentJobs ?? 1}
                    onChange={(event) => setSettings((current) => current && { ...current, maxConcurrentJobs: Number(event.target.value) })}
                    onBlur={() => settings && window.clipme.updateSettings({ maxConcurrentJobs: settings.maxConcurrentJobs }).then(() => refresh())}
                  />
                </label>
                <label>
                  Export format
                  <select
                    value={settings?.defaultExportResolution ?? "1080x1920"}
                    onChange={(event) => {
                      const defaultExportResolution = event.target.value as ExportResolution;
                      setExportResolution(defaultExportResolution);
                      setSettings((current) => current && { ...current, defaultExportResolution });
                      void window.clipme.updateSettings({ defaultExportResolution }).then(() => refresh());
                    }}
                  >
                    {EXPORT_RESOLUTION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  URL cookies
                  <select
                    value={settings?.ytdlpCookiesBrowser ?? "none"}
                    onChange={(event) => {
                      const ytdlpCookiesBrowser = event.target.value as AppSettings["ytdlpCookiesBrowser"];
                      setSettings((current) => current && { ...current, ytdlpCookiesBrowser });
                      void window.clipme.updateSettings({ ytdlpCookiesBrowser }).then(() => refresh());
                    }}
                  >
                    <option value="none">None</option>
                    <option value="chrome">Chrome</option>
                    <option value="edge">Edge</option>
                    <option value="firefox">Firefox</option>
                  </select>
                </label>
                <label>
                  Transcriber
                  <select
                    value={settings?.transcriptionProvider ?? "mock"}
                    onChange={(event) => {
                      const transcriptionProvider = event.target.value as "mock" | "whisper-cli";
                      setSettings((current) => current && { ...current, transcriptionProvider, transcriptionProviderInitialized: true });
                      void window.clipme.updateSettings({ transcriptionProvider, transcriptionProviderInitialized: true }).then(() => refresh());
                    }}
                  >
                    <option value="mock">Mock</option>
                    <option value="whisper-cli">Whisper CLI</option>
                  </select>
                </label>
                <label>
                  Whisper model
                  <select
                    value={settings?.whisperModel ?? "tiny"}
                    onChange={(event) => {
                      const whisperModel = event.target.value as AppSettings["whisperModel"];
                      setSettings((current) => current && { ...current, whisperModel });
                      void window.clipme.updateSettings({ whisperModel }).then(() => refresh());
                    }}
                  >
                    <option value="tiny">tiny</option>
                    <option value="base">base</option>
                    <option value="small">small</option>
                    <option value="medium">medium</option>
                    <option value="large-v3">large-v3</option>
                  </select>
                </label>
              </div>
            </div>
          </section>

          <section className="panel preview-panel" ref={previewPanelRef}>
            <div className="panel-heading">
              <h3>Preview</h3>
              <span>{selectedClip?.previewPath ? "clip preview" : activeProject?.originalVideoPath ? "original video" : "empty"}</span>
            </div>
            {previewSource ? (
              <div className="preview-with-captions">
              <video ref={mainPreviewRef} className="main-preview" src={toFileUrl(previewSource)} controls muted preload="metadata" />
              {subtitleVisible && previewCaptionText && (
                <div className="preview-caption-overlay">
                  <span className="preview-caption-text">{previewCaptionText}</span>
                </div>
              )}
            </div>
            ) : (
              <p className="empty-text">Import a video to start previewing.</p>
            )}
            {selectedClip && (
              <div className="preview-meta">
                <strong>{selectedClip.title}</strong>
                <span>{formatDuration(selectedClip.startTime)} - {formatDuration(selectedClip.endTime)}</span>
              </div>
            )}
          </section>
        </div>

        <section className="panel clips-panel">
          <div className="clips-toolbar">
            <div>
              <h3>Viral Clip Candidates</h3>
              <span>{clips.length} candidates · {highScoreCount} high score · {keepCount} keep · {exportedCount} exported</span>
            </div>
            <div className="clip-controls">
              <div className="segmented-control" aria-label="Filter clips">
                {[
                  ["all", "All"],
                  ["high-score", "High score"],
                  ["exported", "Exported"],
                  ["not-exported", "Todo"],
                  ["keep", "Keep"],
                  ["skip", "Skip"]
                ].map(([value, label]) => (
                  <button
                    key={value}
                    className={clipFilter === value ? "active" : ""}
                    onClick={() => setClipFilter(value as ClipFilter)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="sort-control">
                <span>Sort</span>
                <select value={clipSort} onChange={(event) => setClipSort(event.target.value as ClipSort)}>
                  <option value="score">Viral score</option>
                  <option value="start">Timeline</option>
                  <option value="duration">Duration</option>
                </select>
              </label>
              <button className="ghost-button export-pack-button" onClick={() => void createExportPack()} disabled={exportedCount === 0}>
                Export Pack
              </button>
            </div>
          </div>
          <div className="clips-list">
            {visibleClips.map((clip) => (
              <article key={clip.id} className={clip.id === selectedClip?.id ? "clip-row selected" : "clip-row"}>
                <button
                  className="clip-thumb-button"
                  onClick={() => setSelectedClipId(clip.id)}
                  disabled={!clip.previewPath}
                  title={clip.previewPath ? "Preview hook" : "Preview is being generated"}
                >
                    {clip.previewPath ? (
                    <LazyVideo className="clip-thumb" src={toFileUrl(clip.previewPath)} muted preload="metadata" />
                  ) : (
                    <span className="clip-thumb-placeholder">Preview</span>
                  )}
                </button>
                <div className="clip-card-body">
                  <div className="clip-card-header">
                    <div className="clip-title-row">
                      <strong>{clip.title}</strong>
                      <span className={clip.exportPath ? "export-badge exported" : `export-badge ${clip.curationStatus ?? "review"}`}>
                        {clip.exportPath ? "Exported" : clip.curationStatus ?? "Review"}
                      </span>
                    </div>
                    <span>{formatDuration(clip.startTime)} - {formatDuration(clip.endTime)} · {Math.round(clip.duration)}s</span>
                  </div>
                  <div className="score-row">
                    <meter min={0} max={100} value={clip.hookScore} />
                    <span>{clip.hookScore}% viral</span>
                  </div>
                  <p>{clip.reason}</p>
                  <small className="hook-caption">{clip.suggestedCaption}</small>
                  <small className="hook-tags">{clip.hashtags.join(" ")}</small>
                  {clip.momentLabels && clip.momentLabels.length > 0 && (
                    <div className="moment-labels">
                      {clip.momentLabels.map((label) => (
                        <span key={label} className="moment-badge">{label}</span>
                      ))}
                    </div>
                  )}
                  <div className="curation-control" aria-label="Clip curation status">
                    {[
                      ["review", "Review"],
                      ["keep", "Keep"],
                      ["skip", "Skip"]
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        className={(clip.curationStatus ?? "review") === value ? "active" : ""}
                        onClick={() => void updateCurationStatus(clip, value as ClipCurationStatus)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="clip-actions">
                    {clip.previewPath && (
                      <button className="ghost-button" onClick={() => setSelectedClipId(clip.id)}>
                        Preview
                      </button>
                    )}
                    <button className="ghost-button" onClick={() => void copyClipCaption(clip)}>
                      Copy Caption
                    </button>
                    
                    <button className="ghost-button" onClick={() => void exportFinal(clip.id)} disabled={busy || activeQueue.length > 0}>
                      Export
                    </button>
                    {clip.exportPath && (
                      <button className="ghost-button" onClick={() => window.clipme.showItemInFolder(clip.exportPath!)}>
                        Open Folder
                      </button>
                    )}
                    {clip.exportPath && (
                      <button className="ghost-button" onClick={() => void copyToClipboard(clip.exportPath!, "Export path copied")}>
                        Copy Path
                      </button>
                    )}
                    <button className="ghost-button" onClick={() => setTrimmingClipId(clip.id)} style={{ color: "#c4b5fd" }}>Trim</button>
                    <button className="ghost-button" onClick={() => void generateAssets(clip.id)} disabled={generatingAssetsId === clip.id || busy}>
                      {generatingAssetsId === clip.id ? "Gen..." : "SEO Assets"}
                    </button>
                  </div>
                  {trimmingClipId === clip.id && (
                    <div className="trim-wrapper">
                      <ClipTrim
                        clip={clip}
                        totalDuration={activeProject?.metadata?.duration ?? clip.duration}
                        onSave={(s, e) => void saveTrim(clip.id, s, e)}
                        onCancel={() => setTrimmingClipId(undefined)}
                      />
                    </div>
                  )}
                  {clip.assets && (
                    <div className="clip-assets">
                      <details>
                        <summary>SEO Assets</summary>
                        <div className="assets-content">
                          <div className="asset-section">
                            <strong>Keywords</strong>
                            <span>{clip.assets.keywords.join(", ")}</span>
                          </div>
                          <div className="asset-section">
                            <strong>Platform Tags</strong>
                            {Object.entries(clip.assets.platformTags).map(([platform, tags]) => (
                              <div key={platform} className="platform-tag-group">
                                <span className="platform-name">{platform}</span>
                                <span className="platform-tags">{tags.slice(0, 8).join(" ")}</span>
                              </div>
                            ))}
                          </div>
                          <div className="asset-section">
                            <strong>SEO Description</strong>
                            <p className="seo-desc">{clip.assets.seoDescription}</p>
                            <button className="ghost-button" onClick={() => void copyToClipboard(clip.assets!.seoDescription, "SEO description copied")}>
                              Copy Desc
                            </button>
                          </div>
                        </div>
                      </details>
                    </div>
                  )}
                </div>
              </article>
            ))}
            {clips.length === 0 && <p className="empty-text">Run Analyze 10 Hooks after importing a video.</p>}
            {clips.length > 0 && visibleClips.length === 0 && <p className="empty-text">No clips match this filter.</p>}
          </div>
          <div className="score-threshold-bar">
            <label>Min score: {scoreThreshold}</label>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={scoreThreshold}
              onChange={(e) => setScoreThreshold(Number(e.target.value))}
            />
            <button className="ghost-button" onClick={() => setScoreThreshold(0)} style={{ fontSize: 11, padding: "4px 8px" }}>Reset</button>
          </div>
        </section>
      </section>
      {statusJob && (activeQueue.length > 0 || statusJob.status === "failed") && (
        <footer className={statusJob.status === "failed" ? "status-bar failed" : "status-bar"}>
          <div className="status-main">
            <strong>{statusJob ? statusJob.type.replace(/_/g, " ") : "Working"}</strong>
            <span>
              {statusJob.status === "failed"
                ? `failed · ${statusJob.error?.message ?? "Unknown error"}`
                : `${statusJob.status} · ${statusJob.progress}%`}
            </span>
          </div>
          <progress value={statusJob?.progress ?? 0} max="100" />
          <div className="status-meta">
            {activeQueue.slice(0, 3).map((job) => (
              <button key={job.id} className="ghost-button" onClick={() => window.clipme.cancelJob(job.id)}>
                {job.type.replace(/_/g, " ")} · {job.progress}%
              </button>
            ))}
            {statusJob.status === "failed" && statusJob.error?.likelyReason && <span>{statusJob.error.likelyReason}</span>}
            {statusJob.status === "failed" && (
              <button className="ghost-button" onClick={() => setFailedDetailsOpen((open) => !open)}>
                Details
              </button>
            )}
            {statusJob.status === "failed" && (
              <button className="ghost-button" onClick={() => setDismissedFailedJobIds((current) => new Set(current).add(statusJob.id))}>
                Dismiss
              </button>
            )}
          </div>
          {statusJob.status === "failed" && failedDetailsOpen && (
            <pre className="error-details">{[
              statusJob.error?.message,
              statusJob.error?.command,
              statusJob.error?.stderr
            ].filter(Boolean).join("\n\n")}</pre>
          )}
        </footer>
      )}
      {jobsPanelOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => setJobsPanelOpen(false)}>
          <section className="diagnostics-modal" role="dialog" aria-modal="true" aria-label="Export Queue" onClick={(event) => event.stopPropagation()}>
            <div className="panel-heading">
              <h3>Export Queue ({exportJobs.length})</h3>
              <button className="ghost-button" onClick={() => setJobsPanelOpen(false)}>Close</button>
            </div>
            <div className="jobs-queue-list">
              {exportJobs.length === 0 && <p className="empty-text">No export jobs.</p>}
              {exportJobs.map((job) => (
                <div key={job.id} className="job-row">
                  <div className="job-info">
                    <strong>{job.type.replace(/_/g, " ")}</strong>
                    <span className={`job-status ${job.status}`}>{job.status}</span>
                  </div>
                  <div className="job-progress">
                    <meter min={0} max={100} value={job.progress} />
                    <span>{job.progress}%</span>
                  </div>
                  {job.status === "running" && (
                    <button className="ghost-button" onClick={() => window.clipme.cancelJob(job.id)}>Cancel</button>
                  )}
                  {job.status === "failed" && job.error && (
                    <details className="job-error-details">
                      <summary>Error</summary>
                      <pre>{job.error.message}{job.error.stderr ? `\n\n${job.error.stderr}` : ""}</pre>
                    </details>
                  )}
                  {job.status === "failed" && (
                    <button className="ghost-button" onClick={() => void retryJob(job.id)} style={{ color: "#72d597" }}>Retry</button>
                  )}
                  {job.status === "completed" && <span className="job-completed">Done</span>}
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
      {diagnosticsOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => setDiagnosticsOpen(false)}>
          <section className="diagnostics-modal" role="dialog" aria-modal="true" aria-label="Diagnostics" onClick={(event) => event.stopPropagation()}>
            <div className="panel-heading">
              <h3>Diagnostics</h3>
              <button className="ghost-button" onClick={() => setDiagnosticsOpen(false)}>Close</button>
            </div>
            {diagnostics ? (
              <dl className="metadata-grid diagnostics-grid">
                <div><dt>Version</dt><dd>{diagnostics.appVersion}</dd></div>
                <div><dt>Electron</dt><dd>{diagnostics.electronVersion}</dd></div>
                <div><dt>Platform</dt><dd>{diagnostics.platform}</dd></div>
                <div><dt>Projects</dt><dd>{diagnostics.projectCount}</dd></div>
                <div><dt>User data</dt><dd>{diagnostics.userDataPath}</dd></div>
                <div><dt>Database</dt><dd>{diagnostics.databasePath}</dd></div>
                <div><dt>FFmpeg</dt><dd>{diagnostics.ffmpegPath}</dd></div>
                <div><dt>ffprobe</dt><dd>{diagnostics.ffprobePath}</dd></div>
                <div><dt>yt-dlp</dt><dd>{diagnostics.ytDlpPath}</dd></div>
                <div><dt>yt-dlp ver.</dt><dd>{diagnostics.ytDlpVersion}</dd></div>
              </dl>
            ) : (
              <p className="empty-text">Loading diagnostics...</p>
            )}
          </section>
        </div>
      )}
      {copiedMessage && <div className="toast">{copiedMessage}</div>}
      
      <OnboardingModal
        visible={showOnboarding}
        onClose={async () => {
          setShowOnboarding(false);
          void window.clipme.updateSettings({ onboardingSeen: true });
        }}
        onCreateSample={createSampleProject}
      />
      <ReleaseNotesModal visible={releaseNotesOpen} onClose={() => setReleaseNotesOpen(false)} />
      <ShortcutsModal visible={showShortcuts} onClose={() => setShowShortcuts(false)} />
      <Toasts toasts={toasts} onRemove={removeToast} />
    </main>
  );
}







