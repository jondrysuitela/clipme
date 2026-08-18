"""
interfaces.py — Abstract base classes for engine-agnostic design.

Allows Faster-Whisper to be replaced by another engine without
affecting the rest of Clipper Studio.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import AsyncGenerator, Dict, List, Optional, Protocol, Tuple


@dataclass
class Word:
    text: str
    start: float
    end: float
    probability: float = 0.0
    speaker: str = ""


@dataclass
class Segment:
    start: float
    end: float
    text: str
    words: List[Word] = field(default_factory=list)
    speaker: str = ""
    confidence: float = 0.0
    language: str = ""


@dataclass
class TranscriptionResult:
    segments: List[Segment]
    language: str = ""
    language_probability: float = 0.0
    duration: float = 0.0
    processed_duration: float = 0.0
    words: List[Word] = field(default_factory=list)
    text: str = ""
    model_name: str = ""
    device: str = ""
    compute_type: str = ""
    metadata: dict = field(default_factory=dict)


@dataclass
class TranscriptionConfig:
    """Portable transcription parameters — not tied to any engine."""
    language: str = ""
    beam_size: int = 10
    temperature: float = 0.0
    compression_ratio_threshold: float = 2.4
    log_prob_threshold: float = -1.0
    no_speech_threshold: float = 0.6
    condition_on_previous_text: bool = True
    word_timestamps: bool = True
    vad_filter: bool = True
    chunk_length: int = 30
    hotwords: List[str] = field(default_factory=list)
    diarization: bool = True


class ProgressCallback(Protocol):
    def __call__(self, percent: int, message: str = "") -> None: ...


class IModelManager(ABC):
    @abstractmethod
    def load(self, name: str = "") -> None: ...
    @abstractmethod
    def unload(self) -> None: ...
    @property
    @abstractmethod
    def device(self) -> str: ...
    @property
    @abstractmethod
    def compute_type(self) -> str: ...
    @property
    @abstractmethod
    def model_name(self) -> str: ...
    @staticmethod
    @abstractmethod
    def list_supported() -> List[dict]: ...


class IAudioProcessor(ABC):
    @abstractmethod
    def load(self, path: str) -> Tuple: ...
    @abstractmethod
    def reduce_noise(self, audio, sr: int): ...
    @abstractmethod
    def remove_silence(self, audio, sr: int): ...
    @abstractmethod
    def enhance(self, audio, sr: int): ...
    @abstractmethod
    def vad(self, audio, sr: int): ...


class ISTTEngine(ABC):
    @abstractmethod
    async def transcribe(self, audio_path: str, **kwargs) -> TranscriptionResult: ...
    @abstractmethod
    def set_progress_callback(self, cb: ProgressCallback) -> None: ...
    @property
    @abstractmethod
    def model_manager(self) -> IModelManager: ...
