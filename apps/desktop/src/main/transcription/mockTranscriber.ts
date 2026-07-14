import type { TranscriptResult } from "../../shared/types";
import type { TranscriptionProvider } from "./transcriptionProvider";

const SAMPLE_LINES = [
  "Ini adalah contoh transkrip mock untuk memvalidasi pipeline ClipMe.",
  "Nanti bagian ini bisa diganti dengan Whisper lokal atau provider API.",
  "Tujuan tahap ini adalah memastikan job queue tetap berjalan di background.",
  "Setiap segmen punya start time, end time, dan teks yang bisa dipakai editor.",
  "Setelah transcript stabil, analyzer clip bisa membaca segmen ini."
];

export class MockTranscriber implements TranscriptionProvider {
  async transcribeAudio(_audioPath: string, durationSeconds = 60): Promise<TranscriptResult> {
    const segmentLength = 8;
    const count = Math.max(3, Math.ceil(durationSeconds / segmentLength));
    const segments = Array.from({ length: count }, (_, index) => {
      const start = index * segmentLength;
      const end = Math.min(durationSeconds, start + segmentLength);
      return {
        start,
        end,
        text: SAMPLE_LINES[index % SAMPLE_LINES.length]
      };
    }).filter((segment) => segment.end > segment.start);

    return {
      fullText: segments.map((segment) => segment.text).join(" "),
      segments
    };
  }
}
