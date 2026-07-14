import type { TranscriptSegment } from "../../shared/types";

export function buildClipAss(segments: TranscriptSegment[], clipStart: number, clipEnd: number, fontSize: number, position: "bottom" | "middle") {
  const marginV = position === "middle" ? 820 : 220;
  const events = segments
    .filter((segment) => segment.end > clipStart && segment.start < clipEnd)
    .map((segment) => ({
      start: Math.max(0, segment.start - clipStart),
      end: Math.max(0.1, Math.min(clipEnd, segment.end) - clipStart),
      text: wrapCaption(segment.text)
    }))
    .map((segment) => `Dialogue: 0,${formatAssTime(segment.start)},${formatAssTime(segment.end)},CapCut,,0,0,0,,${escapeAss(segment.text)}`)
    .join("\n");

  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: CapCut,Arial,${fontSize},&H00FFFFFF,&H00FFFFFF,&H00111111,&HAA000000,1,0,0,0,100,100,0,0,1,5,1,2,80,80,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events}
`;
}

function wrapCaption(text: string) {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > 28 && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 2).join("\\N");
}

function formatAssTime(seconds: number) {
  const centiseconds = Math.round(seconds * 100);
  const cs = centiseconds % 100;
  const totalSeconds = Math.floor(centiseconds / 100);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const rest = totalSeconds % 60;
  return `${hours}:${pad(minutes)}:${pad(rest)}.${pad(cs)}`;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function escapeAss(text: string) {
  return text.replace(/[{}]/g, "").replace(/\n/g, "\\N");
}
