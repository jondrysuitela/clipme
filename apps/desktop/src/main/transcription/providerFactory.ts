import { getSettings } from "../services/settingsService";
import { MockTranscriber } from "./mockTranscriber";
import type { TranscriptionProviderId } from "../../shared/types";
import type { TranscriptionProvider } from "./transcriptionProvider";
import { WhisperCliTranscriber } from "./whisperCliTranscriber";

export function createTranscriptionProvider(providerId?: TranscriptionProviderId): TranscriptionProvider {
  const settings = getSettings();
  const selectedProvider = providerId ?? settings.transcriptionProvider;
  if (selectedProvider === "whisper-cli") {
    return new WhisperCliTranscriber({
      command: settings.whisperCommand || "whisper",
      model: settings.whisperModel
    });
  }
  return new MockTranscriber();
}
