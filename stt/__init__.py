"""
stt — Clipmee Speech-to-Text Engine
=====================================

Enterprise-grade offline speech recognition built on Faster-Whisper.

Architecture:

    stt/
        __init__.py      Package root, version info
        interfaces.py    Abstract base classes (future engine-swap support)
        config.py        Centralized configuration (JSON/YAML/env)
        errors.py        Structured exception hierarchy
        logging.py       Structured logging to console/file
        model.py         Model management, device, quantization
        audio.py         Audio I/O, preprocessing, VAD, format conversion
        engine.py        Core transcription engine
        queue.py         Async task queue with cancel/resume/pause
        exporter.py      Output format generators
        search.py        Transcript search
        analytics.py     Analytics: filler words, speed, confidence
        benchmark.py     Performance measurement
"""

__version__ = "2.0.0"
__engine__ = "faster-whisper"
__all__ = [
    "STTEngine",
    "TranscriptionResult",
    "STTConfig",
    "STTError",
    "ModelManager",
    "AudioProcessor",
    "TaskQueue",
]
