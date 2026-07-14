import { useEffect, useMemo, useRef, useState } from "react";
import type { TranscriptResult, TranscriptSegment } from "../../shared/types";
import Button from "./ui/Button";

interface CaptionEditorProps {
  projectId: string;
  clipId: string;
  clipTitle: string;
  clipStart: number;
  clipEnd: number;
  previewPath?: string;
  onClose: () => void;
}

interface CaptionStyle {
  fontSize: number;
  position: "bottom" | "middle";
  textColor: string;
  bgColor: string;
  outlineColor: string;
  highlightCurrent: boolean;
}

const DEFAULT_STYLE: CaptionStyle = {
  fontSize: 48,
  position: "bottom",
  textColor: "#FFFFFF",
  bgColor: "#AA000000",
  outlineColor: "#111111",
  highlightCurrent: true,
};

export default function CaptionEditor({
  projectId,
  clipId,
  clipTitle,
  clipStart,
  clipEnd,
  previewPath,
  onClose,
}: CaptionEditorProps) {
  const [transcript, setTranscript] = useState<TranscriptResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [style, setStyle] = useState<CaptionStyle>(DEFAULT_STYLE);
  const [currentTime, setCurrentTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewUrl = previewPath ? `clipme-media://local/${encodeURIComponent(previewPath)}` : undefined;

  // Load transcript
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        const data = await window.clipme.getTranscript(projectId, clipId);
        if (cancelled) return;
        if (data) {
          setTranscript(data);
          // Also try to load any saved caption styles
          const settings = await window.clipme.getSettings();
          if (!cancelled) {
            setStyle((prev) => ({
              ...prev,
              fontSize: settings.subtitleFontSize ?? prev.fontSize,
              position: settings.subtitlePosition ?? prev.position,
            }));
          }
        } else {
          // Try project-level transcript
          const mainData = await window.clipme.getTranscript(projectId);
          if (cancelled) return;
          if (mainData) setTranscript(mainData);
          else setError("No transcript found. Run transcription first.");
        }
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [projectId, clipId]);

  // Filter segments relevant to this clip's time range
  const clipSegments = useMemo(() => {
    if (!transcript) return [];
    return transcript.segments
      .filter((seg) => seg.end > clipStart && seg.start < clipEnd)
      .map((seg, idx) => ({
        ...seg,
        _idx: idx,
        // Relativize times to clip
        relStart: Math.max(0, seg.start - clipStart),
        relEnd: Math.min(clipEnd, seg.end) - clipStart,
      }))
      .sort((a, b) => a.relStart - b.relStart);
  }, [transcript, clipStart, clipEnd]);

  // Current active segment based on playback time
  const activeSegmentIndex = useMemo(() => {
    if (!style.highlightCurrent) return -1;
    return clipSegments.findIndex(
      (seg) => currentTime >= seg.relStart && currentTime < seg.relEnd
    );
  }, [clipSegments, currentTime, style.highlightCurrent]);

  // Sync video time
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const handler = () => setCurrentTime(video.currentTime);
    video.addEventListener("timeupdate", handler);
    return () => video.removeEventListener("timeupdate", handler);
  }, []);

  const handleTextChange = (idx: number, newText: string) => {
    if (!transcript) return;
    const segments = [...transcript.segments];
    const globalIdx = clipSegments[idx]?._idx;
    if (globalIdx === undefined) return;
    segments[globalIdx] = { ...segments[globalIdx], text: newText };
    setTranscript({ ...transcript, segments });
    setDirty(true);
  };

  const handleTimeChange = (idx: number, field: "start" | "end", value: number) => {
    if (!transcript) return;
    const segments = [...transcript.segments];
    const globalIdx = clipSegments[idx]?._idx;
    if (globalIdx === undefined) return;
    const seg = clipSegments[idx];
    const globalStart = clipStart + seg.relStart;
    const globalEnd = clipStart + seg.relEnd;
    if (field === "start") {
      // Adjust relative start, clamping to clip bounds
      const newRelStart = Math.max(0, Math.min(value, seg.relEnd - 0.1));
      const delta = newRelStart - seg.relStart;
      segments[globalIdx] = { ...segments[globalIdx], start: Math.max(clipStart, globalStart + delta) };
    } else {
      const newRelEnd = Math.max(seg.relStart + 0.1, Math.min(value, clipEnd - clipStart));
      const delta = newRelEnd - seg.relEnd;
      segments[globalIdx] = { ...segments[globalIdx], end: Math.min(clipEnd, globalEnd + delta) };
    }
    setTranscript({ ...transcript, segments });
    setDirty(true);
  };

  const handleDelete = (idx: number) => {
    if (!transcript) return;
    const globalIdx = clipSegments[idx]?._idx;
    if (globalIdx === undefined) return;
    const segments = transcript.segments.filter((_, i) => i !== globalIdx);
    setTranscript({ ...transcript, segments });
    setDirty(true);
  };

  const handleAdd = () => {
    if (!transcript) return;
    const lastSeg = clipSegments[clipSegments.length - 1];
    const newRelStart = lastSeg ? Math.min(lastSeg.relEnd + 0.5, clipEnd - clipStart - 1) : 0;
    const newRelEnd = Math.min(newRelStart + 2, clipEnd - clipStart);
    const newSeg: TranscriptSegment = {
      start: clipStart + newRelStart,
      end: clipStart + newRelEnd,
      text: "[new caption]",
    };
    setTranscript({ ...transcript, segments: [...transcript.segments, newSeg] });
    setDirty(true);
  };

  const handleSave = async () => {
    if (!transcript) return;
    setSaving(true);
    try {
      await window.clipme.saveTranscript(projectId, clipId, transcript);
      setDirty(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleHighlight = () => {
    setStyle((prev) => ({ ...prev, highlightCurrent: !prev.highlightCurrent }));
  };

  // Get caption text for the current playback time (for overlay)
  const currentCaption = style.highlightCurrent && activeSegmentIndex >= 0
    ? clipSegments[activeSegmentIndex].text
    : undefined;

  const allCaptionText = clipSegments.map((seg) => seg.text).join(" ");

  if (loading) {
    return (
      <div className="modal-backdrop" role="presentation" onClick={onClose}>
        <section className="caption-editor-modal" role="dialog" aria-modal="true" aria-label="Caption Editor" onClick={(e) => e.stopPropagation()}>
          <div className="panel-heading">
            <h3>Loading captions...</h3>
            <button className="ghost-button" onClick={onClose}>Close</button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="caption-editor-modal" role="dialog" aria-modal="true" aria-label="Caption Editor" onClick={(e) => e.stopPropagation()}>
        <div className="panel-heading">
          <h3>Auto Captions &mdash; {clipTitle}</h3>
          <div className="panel-heading-actions">
            {dirty && <span className="unsaved-badge">Unsaved</span>}
            <button className="ghost-button" onClick={onClose}>Close</button>
          </div>
        </div>

        {error && <div className="caption-editor-error">{error}</div>}

        <div className="caption-editor-layout">
          {/* Left: Video preview with caption overlay */}
          <div className="caption-preview-panel">
            <div className="caption-preview-container">
              {previewUrl ? (
                <video ref={videoRef} className="caption-preview-video" src={previewUrl} controls muted preload="metadata" />
              ) : (
                <div className="caption-preview-placeholder">
                  <span>No preview available</span>
                </div>
              )}
              {/* Caption overlay */}
              {style.highlightCurrent && currentCaption && (
                <div
                  className={`caption-overlay ${style.position === "middle" ? "caption-middle" : "caption-bottom"}`}
                  style={{
                    fontSize: `${Math.round(style.fontSize * 0.65)}px`,
                    color: style.textColor,
                    textShadow: `2px 2px 4px ${style.outlineColor}`,
                  }}
                >
                  <span className="caption-overlay-bg" style={{ background: style.bgColor }}>
                    {currentCaption}
                  </span>
                </div>
              )}
            </div>

            {/* Style controls */}
            <div className="caption-style-controls">
              <strong className="caption-style-title">Style</strong>
              <div className="caption-style-row">
                <label>
                  Size
                  <input
                    type="range"
                    min={24}
                    max={72}
                    value={style.fontSize}
                    onChange={(e) => setStyle((p) => ({ ...p, fontSize: Number(e.target.value) }))}
                  />
                  <span className="style-value">{style.fontSize}</span>
                </label>
                <label>
                  Position
                  <select
                    value={style.position}
                    onChange={(e) => setStyle((p) => ({ ...p, position: e.target.value as "bottom" | "middle" }))}
                  >
                    <option value="bottom">Bottom</option>
                    <option value="middle">Middle</option>
                  </select>
                </label>
              </div>
              <div className="caption-style-row">
                <label>
                  Text Color
                  <input
                    type="color"
                    value={style.textColor}
                    onChange={(e) => setStyle((p) => ({ ...p, textColor: e.target.value }))}
                  />
                </label>
                <label className="toggle-label">
                  <input type="checkbox" checked={style.highlightCurrent} onChange={toggleHighlight} />
                  <span>Highlight active</span>
                </label>
              </div>
            </div>
          </div>

          {/* Right: Segment list */}
          <div className="caption-segments-panel">
            <div className="caption-segments-header">
              <strong>{clipSegments.length} segments</strong>
              <button className="ghost-button" onClick={handleAdd} style={{ fontSize: 12, padding: "4px 10px" }}>
                + Add
              </button>
            </div>
            <div className="caption-segments-list">
              {clipSegments.length === 0 && (
                <p className="empty-text">No caption segments in this clip range.</p>
              )}
              {clipSegments.map((seg, idx) => (
                <div
                  key={idx}
                  className={`caption-segment-item ${activeSegmentIndex === idx ? "active-segment" : ""}`}
                >
                  <div className="segment-times">
                    <label>
                      <span className="time-label">Start</span>
                      <input
                        type="number"
                        step={0.1}
                        min={0}
                        max={clipEnd - clipStart}
                        value={Math.round(seg.relStart * 10) / 10}
                        onChange={(e) => handleTimeChange(idx, "start", Number(e.target.value))}
                      />
                    </label>
                    <label>
                      <span className="time-label">End</span>
                      <input
                        type="number"
                        step={0.1}
                        min={0}
                        max={clipEnd - clipStart}
                        value={Math.round(seg.relEnd * 10) / 10}
                        onChange={(e) => handleTimeChange(idx, "end", Number(e.target.value))}
                      />
                    </label>
                    <button
                      className="ghost-button delete-seg"
                      onClick={() => handleDelete(idx)}
                      title="Delete segment"
                      style={{ color: "#ff9c7f", padding: "2px 6px", fontSize: 12 }}
                    >
                      ✕
                    </button>
                  </div>
                  <textarea
                    className="segment-text-input"
                    value={seg.text}
                    onChange={(e) => handleTextChange(idx, e.target.value)}
                    rows={2}
                  />
                </div>
              ))}
            </div>
            <div className="caption-segments-footer">
              <Button variant="primary" onClick={handleSave} disabled={!dirty || saving}>
                {saving ? "Saving..." : "Save Captions"}
              </Button>
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
