import type { TranscriptResult } from "../../shared/types";

export interface TranscriptionProvider {
  transcribeAudio(audioPath: string, durationSeconds?: number, signal?: AbortSignal): Promise<TranscriptResult>;
}
