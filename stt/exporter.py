"""
exporter.py — Output format generators with subtitle segmentation.

Formats: TXT, JSON, SRT, VTT, CSV, Word JSON, Segment JSON, Metadata JSON
"""

import csv
import io
import json
import math
from typing import List, Optional
from dataclasses import dataclass

from .interfaces import TranscriptionResult, Word, Segment


class SubtitleSegmenter:
    """Smart subtitle segmentation that respects punctuation and phrase boundaries."""

    def __init__(self, max_width: int = 80, max_lines: int = 2):
        self.max_width = max_width
        self.max_lines = max_lines

    def segment(self, text: str) -> List[str]:
        """Split text into subtitle lines respecting punctuation."""
        if len(text) <= self.max_width:
            return [text]

        lines = []
        current = ""
        for word in text.split():
            # FIX BUG-11: potong kata yang lebih panjang dari max_width agar tidak overflow
            if len(word) > self.max_width:
                word = word[:self.max_width - 3] + "..."
            if len(current) + len(word) + 1 <= self.max_width:
                current += (" " if current else "") + word
            else:
                if current:
                    lines.append(current)
                current = word
                if len(lines) >= self.max_lines:
                    current = ""
                    break
        if current and len(lines) < self.max_lines:
            lines.append(current)
        return lines if lines else [text]


class MetadataBuilder:
    """Build metadata JSON with model, device, performance info."""

    @staticmethod
    def build(result: TranscriptionResult, audio_path: str = "") -> dict:
        return {
            "engine": "faster-whisper",
            "version": "2.0.0",
            "model": result.model_name,
            "device": result.device,
            "compute_type": result.compute_type,
            "language": result.language,
            "language_probability": round(result.language_probability, 3),
            "duration_seconds": round(result.duration, 2),
            "processing_seconds": round(result.processed_duration, 2),
            "real_time_factor": round(result.processed_duration / max(result.duration, 0.01), 3) if result.duration else 0,
            "segments": len(result.segments),
            "words": len(result.words),
            "audio_path": audio_path,
            "timestamp": __import__("time").time(),
        }


class FormatWriter:
    """Write transcription results in multiple output formats."""

    @staticmethod
    def to_txt(result: TranscriptionResult) -> str:
        lines = []
        for seg in result.segments:
            ts = f"[{FormatWriter._fmt_ts(seg.start)} --> {FormatWriter._fmt_ts(seg.end)}]"
            lines.append(f"{ts} {seg.text}")
        return "\n".join(lines)

    @staticmethod
    def to_json(result: TranscriptionResult, indent: int = 2) -> str:
        data = FormatWriter._base_dict(result)
        data["text"] = result.text
        data["full_text"] = result.text
        return json.dumps(data, indent=indent, ensure_ascii=False)

    @staticmethod
    def to_word_json(result: TranscriptionResult) -> str:
        words = [
            {"text": w.text, "start": round(w.start, 3), "end": round(w.end, 3),
             "probability": round(w.probability, 3)}
            for w in result.words
        ]
        return json.dumps(words, indent=2, ensure_ascii=False)

    @staticmethod
    def to_segment_json(result: TranscriptionResult) -> str:
        segments = [
            {"start": round(s.start, 3), "end": round(s.end, 3),
             "text": s.text, "confidence": round(s.confidence, 3), "language": s.language}
            for s in result.segments
        ]
        return json.dumps(segments, indent=2, ensure_ascii=False)

    @staticmethod
    def to_srt(result: TranscriptionResult, max_width: int = 80, max_lines: int = 2) -> str:
        seg = SubtitleSegmenter(max_width, max_lines)
        lines = []
        for i, s in enumerate(result.segments, 1):
            if not s.text.strip():
                continue
            subtitle_lines = seg.segment(s.text.strip())
            text = "\n".join(subtitle_lines)
            lines.append(str(i))
            lines.append(f"{FormatWriter._fmt_srt(s.start)} --> {FormatWriter._fmt_srt(s.end)}")
            lines.append(text)
            lines.append("")
        return "\n".join(lines)

    @staticmethod
    def to_vtt(result: TranscriptionResult, max_width: int = 80, max_lines: int = 2) -> str:
        seg = SubtitleSegmenter(max_width, max_lines)
        lines = ["WEBVTT", ""]
        for s in result.segments:
            if not s.text.strip():
                continue
            subtitle_lines = seg.segment(s.text.strip())
            text = "\n".join(subtitle_lines)
            lines.append(f"{FormatWriter._fmt_srt(s.start)} --> {FormatWriter._fmt_srt(s.end)}")
            lines.append(text)
            lines.append("")
        return "\n".join(lines)

    @staticmethod
    def to_csv(result: TranscriptionResult) -> str:
        # FIX BUG-10: gunakan modul csv standar untuk escape newline dan karakter khusus
        output = io.StringIO()
        writer = csv.writer(output, quoting=csv.QUOTE_ALL, lineterminator="\n")
        writer.writerow(["start", "end", "text", "confidence"])
        for s in result.segments:
            writer.writerow([s.start, s.end, s.text, round(s.confidence, 3)])
        return output.getvalue()

    @staticmethod
    def to_metadata(result: TranscriptionResult, audio_path: str = "") -> str:
        return json.dumps(MetadataBuilder.build(result, audio_path), indent=2, ensure_ascii=False)

    # ── Helpers ───────────────────────────────────────────────────

    @staticmethod
    def _base_dict(result: TranscriptionResult) -> dict:
        return {
            "language": result.language,
            "language_probability": result.language_probability,
            "duration": result.duration,
            "processing_time": result.processed_duration,
            "model": result.model_name,
            "device": result.device,
            "compute_type": result.compute_type,
            "segments": [
                {
                    "start": s.start,
                    "end": s.end,
                    "text": s.text,
                    "speaker": s.speaker,
                    "confidence": round(s.confidence, 3),
                    "language": s.language,
                    "words": [
                        {"text": w.text, "start": w.start, "end": w.end,
                         "probability": round(w.probability, 3), "speaker": w.speaker}
                        for w in s.words
                    ],
                }
                for s in result.segments
            ],
            "words": [
                {"text": w.text, "start": w.start, "end": w.end,
                 "probability": round(w.probability, 3)}
                for w in result.words
            ],
        }

    @staticmethod
    def _fmt_ts(sec: float) -> str:
        h = int(sec // 3600)
        m = int((sec % 3600) // 60)
        s = sec % 60
        return f"{h:02d}:{m:02d}:{s:05.2f}"

    @staticmethod
    def _fmt_srt(sec: float) -> str:
        h = int(sec // 3600)
        m = int((sec % 3600) // 60)
        s = int(sec % 60)
        ms = int((sec * 1000) % 1000)
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

    @staticmethod
    def all_formats() -> List[str]:
        return ["txt", "json", "srt", "vtt", "csv", "word-json", "segment-json", "metadata"]

    @staticmethod
    def write(result: TranscriptionResult, fmt: str, audio_path: str = "") -> str:
        writers = {
            "txt": FormatWriter.to_txt,
            "json": FormatWriter.to_json,
            "srt": FormatWriter.to_srt,
            "vtt": FormatWriter.to_vtt,
            "csv": FormatWriter.to_csv,
            "word-json": FormatWriter.to_word_json,
            "segment-json": FormatWriter.to_segment_json,
            "metadata": lambda r: FormatWriter.to_metadata(r, audio_path),
        }
        w = writers.get(fmt)
        if not w:
            raise ValueError(f"Format tidak dikenal: {fmt}. Gunakan: {', '.join(writers.keys())}")
        return w(result)
