"""
benchmark.py — Performance measurement: loading time, inference, throughput, memory.
"""

import os
import sys
import time
import gc
from typing import Dict, List, Optional
from dataclasses import dataclass, field

import numpy as np

from .model import ModelManager
from .audio import AudioProcessor
from .errors import BenchmarkError
from .logging import log


@dataclass
class BenchmarkResult:
    model: str = ""
    device: str = ""
    compute_type: str = ""
    load_time: float = 0.0
    inference_time: float = 0.0
    total_time: float = 0.0
    audio_duration: float = 0.0
    words_per_second: float = 0.0
    audio_minutes_per_minute: float = 0.0
    peak_ram_mb: float = 0.0
    peak_vram_mb: float = 0.0
    total_words: int = 0
    errors: List[str] = field(default_factory=list)


class Benchmark:
    """Measure model and engine performance.

    Usage:
        bench = Benchmark()
        result = bench.run("small", audio_path="test.wav")
        print(result)
    """

    def __init__(self):
        self._model_mgr: Optional[ModelManager] = None

    def run(self, model_name: str, audio_path: str = "", duration: float = 30.0, config: dict = None) -> BenchmarkResult:
        """Run benchmark on specified model."""
        result = BenchmarkResult(model=model_name)
        cfg = config or {"model": {"name": model_name, "device": "auto", "compute_type": "auto"}}

        # Generate dummy audio if no path
        if not audio_path or not os.path.exists(audio_path):
            log.info(f"Generating {duration}s dummy audio for benchmark")
            sr = 16000
            audio = np.random.randn(int(sr * duration)).astype(np.float32) * 0.1
            import tempfile
            import soundfile as sf
            tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
            sf.write(tmp.name, audio, sr)
            audio_path = tmp.name
            result.audio_duration = duration
        else:
            import soundfile as sf
            info = sf.info(audio_path)
            result.audio_duration = info.duration

        try:
            # Load model
            self._model_mgr = ModelManager(cfg)
            t0 = time.time()
            self._model_mgr.load(model_name)
            result.load_time = round(time.time() - t0, 2)
            result.device = self._model_mgr.device
            result.compute_type = self._model_mgr.compute_type

            # Transcribe
            t0 = time.time()
            # Access private model directly for benchmark
            import faster_whisper
            model = self._model_mgr.model
            segs, info = model.transcribe(audio_path, beam_size=5, word_timestamps=True)
            segments = list(segs)

            result.inference_time = round(time.time() - t0, 2)
            result.total_time = round(result.load_time + result.inference_time, 2)

            # Word count
            word_count = sum(len(s.text.split()) for s in segments if s.text)
            result.total_words = word_count

            # Throughput
            if result.inference_time > 0:
                result.words_per_second = round(word_count / result.inference_time, 1)
            if result.audio_duration > 0 and result.inference_time > 0:
                result.audio_minutes_per_minute = round(
                    (result.audio_duration / 60) / (result.inference_time / 60), 2
                )

            # Memory (approximate)
            import psutil
            proc = psutil.Process()
            result.peak_ram_mb = round(proc.memory_info().rss / 1024 / 1024, 1)

            log.info(f"Benchmark complete: {result}")

        except Exception as e:
            result.errors.append(str(e))
            log.error(f"Benchmark failed: {e}")

        finally:
            # Cleanup temp file
            if audio_path and "tmp" in audio_path:
                try:
                    os.unlink(audio_path)
                except Exception:
                    pass
            if self._model_mgr:
                self._model_mgr.unload()

        return result

    @staticmethod
    def compare(models: List[str], audio_path: str = "", duration: float = 30.0) -> List[dict]:
        """Run benchmark on multiple models and return comparison."""
        results = []
        bench = Benchmark()
        for model in models:
            log.info(f"Benchmarking model: {model}")
            r = bench.run(model, audio_path, duration)
            results.append({
                "model": r.model,
                "device": r.device,
                "compute": r.compute_type,
                "load_time_s": r.load_time,
                "inference_time_s": r.inference_time,
                "total_time_s": r.total_time,
                "words_per_second": r.words_per_second,
                "audio_x_real_time": r.audio_minutes_per_minute,
                "peak_ram_mb": r.peak_ram_mb,
                "total_words": r.total_words,
                "errors": r.errors,
            })
        return results
