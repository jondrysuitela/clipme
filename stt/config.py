"""
config.py — Centralized configuration with JSON/YAML/env/runtime override support.
"""

import os
import json
import copy
from typing import Any, Dict, List, Optional
from pathlib import Path

from .errors import ConfigError, ConfigValidationError

DEFAULT_CONFIG = {
    "model": {
        "name": "small",
        "device": "auto",
        "compute_type": "auto",
        "cpu_threads": 4,
        "num_workers": 1,
        "download_root": "",
        "cache_dir": "",
    },
    "transcription": {
        "beam_size": 10,
        "best_of": 5,
        "temperature": 0.0,
        "compression_ratio_threshold": 2.4,
        "log_prob_threshold": -1.0,
        "no_speech_threshold": 0.6,
        "condition_on_previous_text": True,
        "word_timestamps": True,
        "vad_filter": True,
        "vad_threshold": 0.5,
        "chunk_length": 30,
        "hotwords": [],
    },
    "language": {
        "auto_detect": True,
        "default": "id",
        "allowed": ["id", "en", "ms", "zh", "ja", "ar", "th", "vi"],
    },
    "vad": {
        "enabled": True,
        "threshold": 0.5,
        "min_speech_duration_ms": 250,
        "min_silence_duration_ms": 100,
        "aggressiveness": 3,
    },
    "audio": {
        "sample_rate": 16000,
        "channels": 1,
        "normalize": True,
        "pre_emphasis": 0.97,
    },
    "output": {
        "word_timestamps": True,
        "sentence_timestamps": True,
        "punctuation": True,
        "capitalization": True,
        "max_line_width": 80,
        "max_line_count": 2,
    },
    "performance": {
        "max_audio_duration": 36000,
        "chunk_overlap_seconds": 2.0,
        "stream_buffer_seconds": 5.0,
        "preload_model": True,
    },
    "queue": {
        "max_concurrent": 2,
        "max_queued": 10,
        "default_timeout": 600,
    },
    "filler_words": [
        "uh", "um", "emm", "ah", "er", "hmm", "like", "you know",
        "actually", "basically", "literally", "so", "well", "right",
        "anu", "ee", "mmm", "hah", "eh", "ahh", "umm",
    ],
}

ENV_MAP = {
    "STT_MODEL": ("model", "name"),
    "STT_DEVICE": ("model", "device"),
    "STT_COMPUTE_TYPE": ("model", "compute_type"),
    "STT_BEAM_SIZE": ("transcription", "beam_size"),
    "STT_LANGUAGE": ("language", "default"),
    "STT_LOG_LEVEL": None,
    "STT_LOG_FILE": None,
    "STT_CACHE_DIR": ("model", "cache_dir"),
}


class STTConfig:
    """Configuration manager with JSON/YAML/env/runtime override support.

    Usage:
        cfg = STTConfig()
        cfg.load("stt-config.json")
        cfg.override("model.name", "large-v3")
        cfg.override("transcription.beam_size", 15)
    """

    def __init__(self, base: dict = None):
        self._data = copy.deepcopy(DEFAULT_CONFIG)
        if base:
            self._merge(self._data, base)

    @property
    def data(self) -> dict:
        return self._data

    def _merge(self, base: dict, override: dict) -> None:
        for k, v in override.items():
            if k in base and isinstance(base[k], dict) and isinstance(v, dict):
                self._merge(base[k], v)
            else:
                base[k] = copy.deepcopy(v)

    def load(self, path: str = "") -> "STTConfig":
        """Load config from JSON file."""
        p = path or os.environ.get("STT_CONFIG", "")
        if not p:
            return self
        if not os.path.exists(p):
            raise ConfigValidationError(f"Config file not found: {p}")
        try:
            with open(p, "r", encoding="utf-8") as f:
                user = json.load(f)
            self._merge(self._data, user)
        except json.JSONDecodeError as e:
            raise ConfigValidationError(f"Invalid JSON in {p}: {e}")
        return self

    def load_yaml(self, path: str) -> "STTConfig":
        """Load config from YAML file (requires PyYAML)."""
        try:
            import yaml
        except ImportError:
            raise ConfigError("PyYAML required for YAML config: pip install pyyaml")
        with open(path, "r", encoding="utf-8") as f:
            user = yaml.safe_load(f)
        if user:
            self._merge(self._data, user)
        return self

    def load_env(self) -> "STTConfig":
        """Override config from environment variables."""
        for env_key, config_path in ENV_MAP.items():
            val = os.environ.get(env_key)
            if val is None:
                continue
            if config_path is None:
                continue
            # Convert types
            keys = list(config_path)
            parent = self._data
            for k in keys[:-1]:
                parent = parent[k]
            target_key = keys[-1]
            existing = parent.get(target_key)
            if isinstance(existing, bool):
                parent[target_key] = val.lower() in ("1", "true", "yes")
            elif isinstance(existing, int):
                try:
                    parent[target_key] = int(val)
                except (TypeError, ValueError):
                    parent[target_key] = val
            elif isinstance(existing, float):
                try:
                    parent[target_key] = float(val)
                except (TypeError, ValueError):
                    parent[target_key] = val
            else:
                parent[target_key] = val
        return self

    def override(self, key: str, value: Any) -> "STTConfig":
        """Runtime override using dot notation: 'model.name' = 'large-v3'."""
        keys = key.split(".")
        parent = self._data
        for k in keys[:-1]:
            if k not in parent:
                parent[k] = {}
            parent = parent[k]
        parent[keys[-1]] = copy.deepcopy(value)
        return self

    def get(self, key: str, default: Any = None) -> Any:
        """Get config value using dot notation."""
        keys = key.split(".")
        parent = self._data
        for k in keys:
            if isinstance(parent, dict) and k in parent:
                parent = parent[k]
            else:
                return default
        return parent

    def validate(self) -> List[str]:
        """Validate required config values. Returns list of errors (empty if valid)."""
        errors = []
        model = self.get("model.name", "")
        if model not in ("tiny", "base", "small", "medium", "large-v3", "large-v3-turbo"):
            errors.append(f"Model tidak dikenal: {model}")
        device = self.get("model.device", "")
        if device not in ("auto", "cpu", "cuda"):
            errors.append(f"Device tidak dikenal: {device}")
        ct = self.get("model.compute_type", "")
        if ct not in ("auto", "float16", "float32", "int8", "int8_float16"):
            errors.append(f"Compute type tidak dikenal: {ct}")
        bs = self.get("transcription.beam_size", 1)
        if bs < 1 or bs > 100:
            errors.append(f"Beam size di luar range: {bs}")
        return errors

    def to_dict(self) -> dict:
        return copy.deepcopy(self._data)

    def save(self, path: str) -> None:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(self._data, f, indent=2, ensure_ascii=False)
