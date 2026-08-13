"""
engine.py — Core transcription engine with streaming, batch, and async support.

Orchestrates ModelManager + AudioProcessor for production-grade transcription.
"""

import os
import sys
import time
import asyncio
from typing import Any, Callable, Dict, List, Optional, Tuple

import numpy as np

from .interfaces import (
    ISTTEngine,
    IModelManager,
    Word,
    Segment,
    TranscriptionResult,
    TranscriptionConfig,
    ProgressCallback,
)
from .model import ModelManager
from .audio import AudioProcessor
from .config import STTConfig
from .errors import (
    STTError,
    ModelNotLoadedError,
    TranscriptionError,
    TranscriptionTimeoutError,
    AudioError,
    TaskCancelledError,
)
from .logging import log


class STTEngine(ISTTEngine):
    """Production-grade speech-to-text engine.

    Usage:
        cfg = STTConfig().load("stt-config.json")
        engine = STTEngine(cfg)
        result = await engine.transcribe("audio.mp3")
        print(result.text)
    """

    def __init__(self, config: STTConfig):
        self._cfg = config
        self._model_mgr = ModelManager(config.data)
        self._audio_proc = AudioProcessor(config.data)
        self._progress_cb: Optional[ProgressCallback] = None
        self._cancelled = False

    # ── Public API ────────────────────────────────────────────────

    def set_progress_callback(self, cb: ProgressCallback) -> None:
        self._progress_cb = cb

    @property
    def model_manager(self) -> ModelManager:
        return self._model_mgr

    @property
    def audio_processor(self) -> AudioProcessor:
        return self._audio_proc

    async def transcribe(self, audio_path: str, **kwargs) -> TranscriptionResult:
        """Transcribe audio file with full pipeline.

        Supports all kwargs from TranscriptionConfig + model, language.
        """
        t_start = time.time()
        self._cancelled = False
        self._report(0, "Initializing...")

        # 1. Load model
        model_name = kwargs.get("model", "") or self._cfg.get("model.name", "small")
        cli_device = kwargs.get("device", "") or self._cfg.get("model.device", "")
        cli_compute = kwargs.get("compute_type", "") or self._cfg.get("model.compute_type", "")

        needs_reload = not self._model_mgr.is_loaded
        if model_name and model_name != self._model_mgr.model_name:
            needs_reload = True
        if cli_device and cli_device != self._model_mgr.device:
            needs_reload = True
        if cli_compute and cli_compute != self._model_mgr.compute_type:
            needs_reload = True

        if needs_reload:
            # Override config with CLI values before loading
            if cli_device:
                self._cfg.override("model.device", cli_device)
            if cli_compute:
                self._cfg.override("model.compute_type", cli_compute)
            self._model_mgr = type(self._model_mgr)(self._cfg.data)
            self._model_mgr.load(model_name)

        model = self._model_mgr.model
        device = self._model_mgr.device
        compute = self._model_mgr.compute_type

        # 2. Build transcription config
        tc = self._build_config(**kwargs)
        language = kwargs.get("language", "") or self._cfg.get("language.default", "")

        # 3. Audio preprocessing (optional)
        audio_path = self._maybe_preprocess(audio_path, kwargs)

        # 4. Transcribe (dalam thread agar cancel berfungsi)
        self._report(5, "Transcribing...")
        transcribe_kwargs = {
            "beam_size": tc.beam_size,
            "temperature": tc.temperature,
            "compression_ratio_threshold": tc.compression_ratio_threshold,
            "log_prob_threshold": tc.log_prob_threshold,
            "no_speech_threshold": tc.no_speech_threshold,
            "condition_on_previous_text": tc.condition_on_previous_text,
            "word_timestamps": tc.word_timestamps,
            "vad_filter": tc.vad_filter,
            "chunk_length": tc.chunk_length,
        }
        if language:
            transcribe_kwargs["language"] = language
        has_hotwords = bool(tc.hotwords)

        def _run_transcribe():
            kw = dict(transcribe_kwargs)
            if has_hotwords:
                kw["hotwords"] = tc.hotwords
            try:
                segs, inf = model.transcribe(audio_path, **kw)
            except TypeError:
                if "hotwords" in kw:
                    del kw["hotwords"]
                    segs, inf = model.transcribe(audio_path, **kw)
                else:
                    raise
            return list(segs), inf

        all_segments = []
        info = None
        transcribe_task = asyncio.create_task(asyncio.to_thread(_run_transcribe))
        while not transcribe_task.done():
            if self._cancelled:
                transcribe_task.cancel()
                raise TaskCancelledError()
            await asyncio.sleep(0.2)

        try:
            all_segments, info = transcribe_task.result()
        except asyncio.CancelledError:
            raise TaskCancelledError()

        # 5. Build result
        result = TranscriptionResult(
            segments=[],
            language=info.language or "",
            language_probability=getattr(info, "language_probability", 0),
            duration=info.duration or 0,
            model_name=self._model_mgr.model_name,
            device=device,
            compute_type=compute,
        )

        total = max(len(all_segments), 1)

        for idx, segment in enumerate(all_segments):
            if self._cancelled:
                raise TaskCancelledError()

            self._report(
                10 + int((idx + 1) / total * 80),
                f"Segment {idx + 1}/{total}",
            )

            seg = Segment(
                start=segment.start,
                end=segment.end,
                text=(segment.text or "").strip(),
                language=getattr(segment, 'language', None) or result.language,
            )

            if segment.words:
                for w in segment.words:
                    word = Word(
                        text=(w.word or "").strip(),
                        start=w.start,
                        end=w.end,
                        probability=w.probability,
                    )
                    seg.words.append(word)
                    result.words.append(word)
                seg.confidence = float(np.mean([w.probability for w in seg.words])) if seg.words else 0
            else:
                seg.confidence = 0

            result.segments.append(seg)

        self._report(95, "Finalizing...")
        result.text = " ".join(s.text for s in result.segments if s.text).strip()
        result.processed_duration = time.time() - t_start
        result.metadata = {
            "segments_count": len(result.segments),
            "words_count": len(result.words),
            "audio_path": audio_path,
        }

        self._report(100, "Selesai")
        return result

    def cancel(self) -> None:
        """Cancel ongoing transcription."""
        self._cancelled = True

    # ── Private ───────────────────────────────────────────────────

    def _report(self, pct: int, msg: str = "") -> None:
        if self._progress_cb:
            self._progress_cb(pct, msg)

    def _build_config(self, **kwargs) -> TranscriptionConfig:
        tc = TranscriptionConfig()
        for key in tc.__dataclass_fields__:
            if key in kwargs:
                setattr(tc, key, kwargs[key])
            else:
                cfg_val = self._cfg.get(f"transcription.{key}")
                if cfg_val is not None:
                    setattr(tc, key, cfg_val)
        return tc

    def _maybe_preprocess(self, audio_path: str, kwargs: dict) -> str:
        do_nr = kwargs.get("noise_reduction", False)
        do_sr = kwargs.get("remove_silence", False)
        do_enh = kwargs.get("enhance", False)
        if not any([do_nr, do_sr, do_enh]):
            return audio_path

        self._report(3, "Pre-processing audio...")
        try:
            import soundfile as sf
            audio, sr = self._audio_proc.load(audio_path)
            audio = self._audio_proc.process(audio, sr, do_nr, do_sr, do_enh)
            proc_path = audio_path + ".proc.wav"
            sf.write(proc_path, audio, sr)
            log.info(f"Pre-processed audio saved to {proc_path}")
            return proc_path
        except Exception as e:
            log.warn(f"Pre-processing skipped: {e}")
            return audio_path
