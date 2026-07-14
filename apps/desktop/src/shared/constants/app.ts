import type { ExportResolution } from "../types";

export const APP_NAME = "ClipMe";
export const DEFAULT_PROJECTS_FOLDER_NAME = "ClipMeProjects";
export const PIPELINE_STEPS = [
  "Imported",
  "Audio Extracted",
  "Transcribed",
  "Hooks Analyzed",
  "Preview Ready",
  "Final Exported"
] as const;

export const EXPORT_RESOLUTION_OPTIONS: Array<{ value: ExportResolution; label: string }> = [
  { value: "1080x1920", label: "9:16 1080x1920" },
  { value: "1080x1350", label: "4:5 1080x1350" },
  { value: "720x1280", label: "9:16 720x1280" }
];
