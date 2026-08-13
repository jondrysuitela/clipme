"""
analytics.py — Speech analytics: filler words, speed, pauses, confidence, silence detection.
"""

from typing import Dict, List, Optional, Tuple
from collections import Counter

import numpy as np

from .interfaces import TranscriptionResult

DEFAULT_FILLERS = {
    "uh", "um", "ah", "er", "hmm", "mm", "huh",
    "like", "you know", "actually", "basically", "literally",
    "anu", "ee", "eh", "hah", "uhh",
}


class SpeechAnalytics:
    """Compute comprehensive speech analytics from transcription results."""

    def __init__(self, filler_words: Optional[set] = None):
        self.filler_set = filler_words or DEFAULT_FILLERS

    def compute(self, result: TranscriptionResult) -> dict:
        """Compute all analytics. Returns structured dict."""
        words = result.words
        segments = result.segments
        duration = result.duration

        word_texts = [(w.text or "").strip(".,!?;:\"'()[]") for w in words]

        # Word stats
        total_words = len(word_texts)
        unique_words = len(set(w.lower() for w in word_texts))

        # Speaking speed
        speaking_speed = 0.0
        if duration > 0:
            speaking_speed = round(total_words / (duration / 60), 1)

        # Confidence
        avg_confidence = 0.0
        if words:
            avg_confidence = round(float(np.mean([w.probability for w in words])), 3)

        # Filler words
        filler_counts: Dict[str, int] = {}
        filler_total = 0
        for w in word_texts:
            wl = w.lower()
            if wl in self.filler_set:
                filler_counts[wl] = filler_counts.get(wl, 0) + 1
                filler_total += 1

        # Pauses
        pauses = []
        if len(words) > 1:
            for i in range(1, len(words)):
                gap = words[i].start - words[i - 1].end
                if gap > 0.3:
                    pauses.append(gap)

        longest_pause = round(max(pauses), 2) if pauses else 0.0
        avg_pause = round(float(np.mean(pauses)), 2) if pauses else 0.0
        pause_count = len(pauses)

        # Silence %
        silence_pct = 0.0
        if duration > 0 and len(words) > 1:
            speech_time = sum(w.end - w.start for w in words)
            speech_time = min(speech_time, duration)
            silence_pct = round(max(0, (1 - speech_time / duration) * 100), 1)

        # Repeated words (excluding fillers)
        repeated = []
        counter = Counter(w.lower() for w in word_texts if len(w) > 2 and w.lower() not in self.filler_set)
        for word, count in counter.most_common(20):
            if count >= 3:
                repeated.append({"word": word, "count": count})

        return {
            "summary": {
                "language": result.language,
                "duration_seconds": round(duration, 2),
                "total_words": total_words,
                "unique_words": unique_words,
                "total_segments": len(segments),
                "speaking_speed_wpm": speaking_speed,
            },
            "confidence": {
                "average": avg_confidence,
                # FIX BUG-09: guard agar np.mean([]) tidak menghasilkan NaN yang crash JSON serialization
                "segments": round(float(np.mean([s.confidence for s in segments if s.confidence > 0])), 3)
                if any(s.confidence > 0 for s in segments) else 0.0,
            },
            "pauses": {
                "total": pause_count,
                "longest_seconds": longest_pause,
                "average_seconds": avg_pause,
            },
            "silence": {
                "percentage": silence_pct,
                "seconds": round(duration * silence_pct / 100, 2) if duration else 0,
            },
            "filler_words": {
                "total": filler_total,
                "details": dict(sorted(filler_counts.items(), key=lambda x: -x[1])),
                "percentage_of_speech": round(filler_total / max(total_words, 1) * 100, 1),
            },
            "repeated_words": repeated[:10],
        }
