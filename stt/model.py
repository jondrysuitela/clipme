"""
model.py — Model management with auto-detect, GPU fallback, quantization, runtime switching.
"""

import os
import sys
import time
import json
from typing import Any, Dict, List, Optional, Tuple
from pathlib import Path

from .errors import ModelNotFoundError, ModelLoadError, DeviceError, ModelNotLoadedError
from .logging import log

MODEL_REGISTRY = {
    "tiny": {"size_mb": 75, "ram_gb": 1, "speed_rank": 10, "description": "Cepat, akurasi rendah"},
    "base": {"size_mb": 150, "ram_gb": 1.5, "speed_rank": 7, "description": "Cukup untuk percobaan"},
    "small": {"size_mb": 461, "ram_gb": 2, "speed_rank": 4, "description": "Default — keseimbangan cepat/akurat"},
    "medium": {"size_mb": 1500, "ram_gb": 4, "speed_rank": 2, "description": "Akurat, butuh RAM lebih"},
    "large-v3": {"size_mb": 3000, "ram_gb": 6, "speed_rank": 1, "description": "Paling akurat, lambat"},
    "large-v3-turbo": {"size_mb": 1800, "ram_gb": 4, "speed_rank": 3, "description": "Akurat dengan kecepatan lebih baik"},
}

AVAILABLE_COMPUTE_TYPES = ["float16", "float32", "int8", "int8_float16"]
# GPU-compatible compute types
GPU_COMPUTE_TYPES = ["float16"]


class ModelManager:
    """Manages Whisper model lifecycle: load, unload, switch, detect.

    Supports:
    - Auto device detection (CUDA / CPU)
    - Auto quantization (float16 for GPU, int8 for CPU)
    - Graceful GPU fallback to CPU
    - Runtime model switching
    - Custom model paths
    - Model validation
    - Future Whisper-compatible model support
    """

    def __init__(self, config: dict):
        self._cfg = config.get("model", config)
        self._perf_cfg = config.get("performance", {})
        self._model = None
        self._model_name = ""
        self._device = ""
        self._compute_type = ""
        self._loaded = False
        self._faster_whisper = None

    # ── Public API ────────────────────────────────────────────────

    def load(self, name: str = "") -> None:
        """Load model by name. Auto-detects device and compute type."""
        model_name = name or self._cfg.get("name", "small")
        if model_name not in MODEL_REGISTRY:
            # Allow custom path or future model
            if not os.path.exists(model_name):
                raise ModelNotFoundError(model_name)

        self._model_name = model_name
        device = self._detect_device()
        compute = self._detect_compute_type(device)

        log.info(f"Loading model '{model_name}' | device={device} | compute={compute}")

        if not self._faster_whisper:
            self._import_engine()

        t0 = time.time()
        try:
            self._model = self._faster_whisper.WhisperModel(
                model_name,
                device=device,
                compute_type=compute,
                cpu_threads=self._cfg.get("cpu_threads", 4),
                num_workers=self._cfg.get("num_workers", 1),
                download_root=self._cfg.get("download_root") or self._cfg.get("cache_dir", ""),
            )
        except Exception as e:
            # Graceful GPU → CPU fallback
            if device == "cuda":
                log.warn(f"CUDA load failed: {e}. Falling back to CPU (int8)...")
                self._model = self._faster_whisper.WhisperModel(
                    model_name, device="cpu", compute_type="int8",
                    cpu_threads=self._cfg.get("cpu_threads", 4),
                )
                self._device = "cpu"
                self._compute_type = "int8"
            else:
                raise ModelLoadError(f"Gagal load model '{model_name}'", detail=str(e), cause=e)

        self._loaded = True
        elapsed = time.time() - t0
        log.info(f"Model loaded in {elapsed:.1f}s | device={self._device} | compute={self._compute_type}")

    def unload(self) -> None:
        """Release model and free GPU memory."""
        self._model = None
        self._loaded = False
        log.info("Model unloaded — GPU memory released")
        # Force Python GC
        import gc
        gc.collect()

        if self._device == "cuda":
            try:
                import torch
                torch.cuda.empty_cache()
                log.debug("CUDA cache emptied")
            except Exception:
                pass

    def switch(self, name: str) -> None:
        """Switch to a different model at runtime."""
        log.info(f"Switching model: {self._model_name} → {name}")
        self.unload()
        self.load(name)

    def validate(self) -> bool:
        """Validate that the loaded model works with a tiny inference test."""
        if not self._loaded or self._model is None:
            return False
        try:
            import numpy as np
            dummy = np.zeros(int(16000 * 0.5), dtype=np.float32)
            segs, _ = self._model.transcribe(dummy, beam_size=1)
            list(segs)
            log.debug("Model validation passed")
            return True
        except Exception as e:
            log.warn(f"Model validation failed: {e}")
            return False

    # ── Properties ────────────────────────────────────────────────

    @property
    def model(self) -> Any:
        if not self._loaded or self._model is None:
            raise ModelNotLoadedError()
        return self._model

    @property
    def device(self) -> str:
        return self._device

    @property
    def compute_type(self) -> str:
        return self._compute_type

    @property
    def model_name(self) -> str:
        return self._model_name

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    # ── Private ───────────────────────────────────────────────────

    def _import_engine(self) -> None:
        try:
            import faster_whisper
            self._faster_whisper = faster_whisper
        except ImportError:
            raise ModelLoadError(
                "faster-whisper tidak terinstall. Jalankan: pip install faster-whisper"
            )

    def _detect_device(self) -> str:
        requested = self._cfg.get("device", "auto")
        if requested != "auto":
            self._device = requested
            return requested

        cuda_available = False
        try:
            import torch
            cuda_available = torch.cuda.is_available()
            if cuda_available:
                gpu_name = torch.cuda.get_device_name(0)
                gpu_mem = torch.cuda.get_device_properties(0).total_mem
                log.info(f"GPU: {gpu_name} ({gpu_mem / 1024**3:.1f} GB VRAM)")
        except ImportError:
            log.debug("torch not found — CUDA unavailable")
        except Exception as e:
            log.warn(f"GPU detection failed: {e}")

        device = "cuda" if cuda_available else "cpu"
        self._device = device
        return device

    def _detect_compute_type(self, device: str) -> str:
        requested = self._cfg.get("compute_type", "auto")
        if requested != "auto":
            if requested in AVAILABLE_COMPUTE_TYPES:
                self._compute_type = requested
                return requested
            log.warn(f"Compute type '{requested}' tidak dikenal, pake auto")

        # FIX BUG-01: self._compute_type harus selalu di-set di semua jalur
        if device == "cuda":
            self._compute_type = "float16"
            return "float16"
        self._compute_type = "int8"
        return "int8"

    @staticmethod
    def list_supported() -> List[dict]:
        return [
            {
                "name": k,
                "size_mb": v["size_mb"],
                "ram_gb": v["ram_gb"],
                "speed_rank": v["speed_rank"],
                "description": v["description"],
            }
            for k, v in MODEL_REGISTRY.items()
        ]

    @staticmethod
    def estimate(name: str, duration_seconds: float) -> dict:
        info = MODEL_REGISTRY.get(name, MODEL_REGISTRY["small"])
        speed = info["speed_rank"]
        est = (duration_seconds / 10) * (10 / max(speed, 1))
        return {
            "model": name,
            "duration": duration_seconds,
            "estimated_seconds": round(est, 1),
            "ram_gb": info["ram_gb"],
        }
