import React, { useState, useEffect, useCallback } from "react";
import type { ClipCandidate } from "../../shared/types";

interface ClipTrimProps {
  clip: ClipCandidate;
  totalDuration: number;
  onSave: (startTime: number, endTime: number) => void;
  onCancel: () => void;
}

export default function ClipTrim({ clip, totalDuration, onSave, onCancel }: ClipTrimProps) {
  const [startTime, setStartTime] = useState(clip.startTime);
  const [endTime, setEndTime] = useState(clip.endTime);
  const maxDuration = Math.min(60, totalDuration);

  const handleStartChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = Number(e.target.value);
      const clamped = Math.max(0, Math.min(val, endTime - 1));
      setStartTime(clamped);
    },
    [endTime]
  );

  const handleEndChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = Number(e.target.value);
      const clamped = Math.max(startTime + 1, Math.min(val, totalDuration));
      setEndTime(clamped);
    },
    [startTime, totalDuration]
  );

  const duration = endTime - startTime;
  const isValid = duration >= 3 && duration <= maxDuration;

  function formatTime(seconds: number) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  return (
    <div className="clip-trim-panel">
      <div className="trim-header">
        <strong>Trim Clip</strong>
        <span className="trim-duration">
          {formatTime(startTime)} - {formatTime(endTime)} ({Math.round(duration)}s)
        </span>
      </div>

      <div className="trim-sliders">
        <div className="trim-slider-group">
          <label>Start</label>
          <input
            type="range"
            min={0}
            max={totalDuration}
            step={0.5}
            value={startTime}
            onChange={handleStartChange}
          />
          <span className="trim-value">{formatTime(startTime)}</span>
        </div>

        <div className="trim-slider-group">
          <label>End</label>
          <input
            type="range"
            min={0}
            max={totalDuration}
            step={0.5}
            value={endTime}
            onChange={handleEndChange}
          />
          <span className="trim-value">{formatTime(endTime)}</span>
        </div>
      </div>

      <div className="trim-meter">
        <div
          className="trim-meter-fill"
          style={{ width: `${(duration / maxDuration) * 100}%` }}
        />
        <span>{Math.round(duration)}s / {maxDuration}s</span>
      </div>

      {!isValid && (
        <p className="trim-error">Duration must be between 3s and {maxDuration}s</p>
      )}

      <div className="trim-actions">
        <button className="ghost-button" onClick={onCancel}>Cancel</button>
        <button
          className="primary-action"
          disabled={!isValid}
          onClick={() => onSave(startTime, endTime)}
        >
          Save Trim
        </button>
      </div>
    </div>
  );
}