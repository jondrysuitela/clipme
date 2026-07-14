import type { TranscriptSegment } from "../../shared/types";

export function buildClipSrt(segments: TranscriptSegment[], clipStart: number, clipEnd: number) {
  return segments
    .filter((segment) => segment.end > clipStart && segment.start < clipEnd)
    .map((segment) => ({
      start: Math.max(0, segment.start - clipStart),
      end: Math.max(0.1, Math.min(clipEnd, segment.end) - clipStart),
      text: segment.text
    }))
    .map((segment, index) => `${index + 1}\n${formatSrtTime(segment.start)} --> ${formatSrtTime(segment.end)}\n${segment.text}\n`)
    .join("\n");
}

function formatSrtTime(seconds: number) {
  const whole = Math.floor(seconds);
  const ms = Math.round((seconds - whole) * 1000);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(rest)},${String(ms).padStart(3, "0")}`;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
