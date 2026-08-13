"""
errors.py — Structured exception hierarchy.

Every operation returns structured errors instead of crashing.
"""


class STTError(Exception):
    """Base exception for all STT engine errors."""
    code: str = "STT_ERROR"
    detail: str = ""

    def __init__(self, message: str = "", detail: str = "", cause: Exception = None):
        super().__init__(message)
        self.detail = detail or message
        self.cause = cause

    def to_dict(self) -> dict:
        return {
            "error": self.code,
            "message": str(self),
            "detail": self.detail,
        }


class ModelNotFoundError(STTError):
    code = "MODEL_NOT_FOUND"

    def __init__(self, name: str):
        super().__init__(f"Model '{name}' tidak ditemukan. Gunakan 'list-models' untuk melihat model tersedia.")
        self.model_name = name


class ModelLoadError(STTError):
    code = "MODEL_LOAD_ERROR"


class ModelNotLoadedError(STTError):
    code = "MODEL_NOT_LOADED"

    def __init__(self):
        super().__init__("Model belum di-load. Panggil load() terlebih dahulu.")


class DeviceError(STTError):
    code = "DEVICE_ERROR"

    def __init__(self, device: str, cause: Exception = None):
        super().__init__(
            f"Gagal initialize device '{device}': {cause}",
            cause=cause,
        )
        self.target_device = device


class AudioError(STTError):
    code = "AUDIO_ERROR"


class AudioFormatError(AudioError):
    code = "AUDIO_FORMAT_ERROR"

    def __init__(self, path: str):
        super().__init__(f"Format audio tidak didukung: {path}")
        self.path = path


class AudioLoadError(AudioError):
    code = "AUDIO_LOAD_ERROR"


class AudioTooLongError(AudioError):
    code = "AUDIO_TOO_LONG"


class TranscriptionError(STTError):
    code = "TRANSCRIPTION_ERROR"


class TranscriptionTimeoutError(TranscriptionError):
    code = "TRANSCRIPTION_TIMEOUT"


class QueueError(STTError):
    code = "QUEUE_ERROR"


class QueueFullError(QueueError):
    code = "QUEUE_FULL"


class TaskCancelledError(QueueError):
    code = "TASK_CANCELLED"


class ConfigError(STTError):
    code = "CONFIG_ERROR"


class ConfigValidationError(ConfigError):
    code = "CONFIG_VALIDATION_ERROR"


class SearchError(STTError):
    code = "SEARCH_ERROR"


class ExportError(STTError):
    code = "EXPORT_ERROR"


class BenchmarkError(STTError):
    code = "BENCHMARK_ERROR"
