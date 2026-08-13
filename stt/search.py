"""
search.py — Transcript search with keyword, timestamp, context, and repeated word detection.
"""

import re
from typing import Dict, List, Optional, Tuple
from collections import Counter

from .interfaces import TranscriptionResult, Word, Segment


class SearchEngine:
    """Search through transcription results with context and highlighting."""

    def __init__(self, case_sensitive: bool = False, context_window: int = 3):
        self.case_sensitive = case_sensitive
        self.context_window = context_window

    def search(self, result: TranscriptionResult, keyword: str) -> dict:
        """Search for keyword in transcript. Returns matches with context."""
        flags = 0 if self.case_sensitive else re.IGNORECASE
        pattern = re.compile(re.escape(keyword), flags)
        matches = []

        for i, seg in enumerate(result.segments):
            for m in pattern.finditer(seg.text):
                # Context around match
                start_pos = max(m.start() - 60, 0)
                end_pos = min(m.end() + 60, len(seg.text))
                context = seg.text[start_pos:end_pos].strip()

                word_info = None
                for w in seg.words:
                    wt = (w.text or "").lower()
                    if keyword.lower() in wt:
                        word_info = {"text": w.text, "start": w.start, "end": w.end}
                        break

                matches.append({
                    "segment_index": i,
                    "segment_start": seg.start,
                    "segment_end": seg.end,
                    "text": seg.text,
                    "context": context,
                    "word": word_info,
                    "match_position": m.start(),
                })

        return {
            "keyword": keyword,
            "total": len(matches),
            "matches": matches,
        }

    def highlight(self, text: str, keyword: str, fmt: str = "**{text}**") -> str:
        """Highlight keyword in text using format template."""
        flags = 0 if self.case_sensitive else re.IGNORECASE
        pattern = re.compile(re.escape(keyword), flags)
        return pattern.sub(lambda m: fmt.format(text=m.group()), text)

    def find_repeated_words(self, result: TranscriptionResult, min_count: int = 3, max_results: int = 20) -> List[Tuple[str, int]]:
        counter = Counter()
        for w in result.words:
            wt = (w.text or "").lower().strip(".,!?;:\"'()[]")
            if len(wt) > 2:
                counter[wt] += 1
        return [(w, c) for w, c in counter.most_common(max_results) if c >= min_count]

    def word_lookup(self, result: TranscriptionResult, word: str) -> List[Word]:
        results = []
        kw = word.lower()
        for w in result.words:
            wt = (w.text or "").lower()
            if kw in wt:
                results.append(w)
        return results

    def sentence_lookup(self, result: TranscriptionResult, phrase: str) -> List[Segment]:
        """Find all segments containing a specific phrase."""
        flags = 0 if self.case_sensitive else re.IGNORECASE
        pattern = re.compile(re.escape(phrase), flags)
        return [s for s in result.segments if pattern.search(s.text)]
