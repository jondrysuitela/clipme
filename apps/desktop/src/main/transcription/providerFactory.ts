import { getSettings } from "../services/settingsService";
import { MockTranscriber } from "./mockTranscriber";
import type { TranscriptionProviderId } from "../../shared/types";
import type { TranscriptionProvider } from "./transcriptionProvider";
import { WhisperCliTranscriber } from "./whisperCliTranscriber";
import { WhisperCppTranscriber } from "./whisperCppTranscriber";

export function createTranscriptionProvider(providerId?: TranscriptionProviderId): TranscriptionProvider {
  const settings = getSettings();
  const selectedProvider = providerId ?? settings.transcriptionProvider;
  if (selectedProvider === "whisper-cli") {
    return new WhisperCliTranscriber({
      command: settings.whisperCommand || "whisper",
      model: settings.whisperModel
    });
  }
  if (selectedProvider === "whisper-cpp") {
    return new WhisperCppTranscriber({ modelName: settings.whisperModel });
  }
  return new MockTranscriber();
}
