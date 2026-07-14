import { app } from "electron";
import path from "node:path";
import { DEFAULT_PROJECTS_FOLDER_NAME } from "../../shared/constants/app";
import type { AppSettings } from "../../shared/types";
import { getDb } from "../database/db";

const SETTINGS_KEY = "app";

function defaults(): AppSettings {
  return {
    defaultProjectFolder: path.join(app.getPath("videos"), DEFAULT_PROJECTS_FOLDER_NAME),
    encoderPreference: "auto",
    performanceMode: "balanced",
    defaultExportResolution: "1080x1920",
    subtitleDefaultOn: false,
    subtitleFontSize: 42,
    subtitlePosition: "bottom",
    maxConcurrentJobs: 1,
    theme: "dark",
    transcriptionProvider: "whisper-cli",
    transcriptionProviderInitialized: true,
    whisperCommand: "whisper",
    whisperModel: "tiny",
    ytdlpCookiesBrowser: "none"
    ,onboardingSeen: false,
    captionTemplate: "{caption}\n\n{hashtags}",
    telemetryEnabled: false
  };
}

export function getSettings(): AppSettings {
  const row = getDb().prepare("SELECT value_json FROM settings WHERE key = ?").get(SETTINGS_KEY) as { value_json: string } | undefined;
  if (!row) {
    const initial = defaults();
    saveSettings(initial);
    return initial;
  }
  const stored = JSON.parse(row.value_json);
  const merged = { ...defaults(), ...stored };
  if (merged.whisperCommand === "faster-whisper-xxl") merged.whisperCommand = "whisper";
  if (!stored.transcriptionProviderInitialized) {
    merged.transcriptionProvider = "whisper-cli";
    merged.transcriptionProviderInitialized = true;
  }
  if (Object.keys(defaults()).some((key) => !(key in stored)) || merged.whisperCommand !== stored.whisperCommand) {
    saveSettings(merged);
  }
  return merged;
}

export function updateSettings(settings: Partial<AppSettings>): AppSettings {
  const next = { ...getSettings(), ...settings };
  saveSettings(next);
  return next;
}

function saveSettings(settings: AppSettings) {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
    )
    .run(SETTINGS_KEY, JSON.stringify(settings), new Date().toISOString());
}
