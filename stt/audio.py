"""
audio.py — Audio I/O, preprocessing, VAD, format conversion, video extraction.

Supports: wav, mp3, aac, m4a, flac, ogg, opus, webm, mp4, mov, mkv
"""

import os
import subprocess
import tempfile
from typing import List, Optional, Tuple
from pathlib import Path

import numpy as np

from .errors import AudioFormatError, AudioLoadError
from .logging import log

# Supported extensions (lowercase)
AUDIO_EXTENSIONS = {".wav", ".mp3", ".aac", ".m4a", ".flac", ".ogg", ".opus"}
VIDEO_EXTENSIONS = {".webm", ".mp4", ".mov", ".mkv"}
ALL_EXTENSIONS = AUDIO_EXTENSIONS | VIDEO_EXTENSIONS

# FFmpeg path (auto-detect)
FFMPEG_PATHS = [
    "ffmpeg",
    os.environ.get("FFMPEG_PATH", ""),
    os.path.join(os.environ.get("CLIPFORGE_BIN_DIR", ""), "ffmpeg.exe"),
    os.path.join(os.path.dirname(__file__), "..", "bin", "ffmpeg.exe"),
    "/usr/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
]


def _find_ffmpeg() -> str:
    for p in FFMPEG_PATHS:
        if os.path.exists(p) or (p == "ffmpeg" and _which("ffmpeg")):
            return p
    return "ffmpeg"  # hope it's in PATH


def _which(cmd: str) -> bool:
    try:
        import shutil
        return shutil.which(cmd) is not None
    except Exception:
        return False


class AudioProcessor:
    """Audio loader, preprocessor, VAD, and format converter.

    Designed for streaming-friendly memory usage.
    Uses FFmpeg for format conversion and video audio extraction.
    """

    def __init__(self, config: dict):
        self.cfg = config.get("audio", config)
        self.vad_cfg = config.get("vad", {})
        self.ffmpeg = _find_ffmpeg()
        self._sr = self.cfg.get("sample_rate", 16000)
        self._noisereduce = None
        self._webrtcvad = None

        # Optional dependencies
        try:
            import noisereduce
            self._noisereduce = noisereduce
        except ImportError:
            pass
        try:
            import webrtcvad
            self._webrtcvad = webrtcvad
        except ImportError:
            pass

    def load(self, path: str, sr: Optional[int] = None) -> Tuple[np.ndarray, int]:
        """Load audio from file. Supports all formats via FFmpeg."""
        if not os.path.exists(path):
            raise AudioLoadError(f"File tidak ditemukan: {path}")

        ext = os.path.splitext(path)[1].lower()
        target_sr = sr or self._sr

        # Native WAV support via soundfile
        if ext == ".wav":
            try:
                import soundfile as sf
                audio, file_sr = sf.read(path)
                if file_sr != target_sr:
                    audio = self._resample(audio, file_sr, target_sr)
                if audio.ndim > 1:
                    audio = audio.mean(axis=1)
                return audio.astype(np.float32), target_sr
            except ImportError:
                pass

        # FFmpeg conversion
        return self._load_via_ffmpeg(path, target_sr)

    def _load_via_ffmpeg(self, path: str, sr: int) -> Tuple[np.ndarray, int]:
        """Use FFmpeg to decode any audio/video to PCM float32."""
        cmd = [
            self.ffmpeg, "-y", "-i", path,
            "-f", "f32le",
            "-ac", "1",
            "-ar", str(sr),
            "-loglevel", "error",
            "pipe:1",
        ]
        try:
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            raw, err = proc.communicate()
            if proc.returncode != 0:
                raise AudioLoadError(f"FFmpeg error: {err.decode(errors='replace')[:200]}")
            audio = np.frombuffer(raw, dtype=np.float32).copy()
            if audio.size == 0:
                raise AudioLoadError("Audio kosong setelah decoding")
            return audio, sr
        except FileNotFoundError:
            raise AudioLoadError("FFmpeg tidak ditemukan. Install FFmpeg untuk dukungan format ini.")

    def _resample(self, audio: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
        """Resample audio using FFmpeg."""
        if orig_sr == target_sr:
            return audio
        import subprocess
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".f32le", delete=False) as tmp:
            tmp_path = tmp.name
            tmp.write(audio.tobytes())
        try:
            cmd = [
                self.ffmpeg, "-y", "-f", "f32le", "-ar", str(orig_sr), "-ac", "1",
                "-i", tmp_path,
                "-f", "f32le", "-ar", str(target_sr), "-ac", "1",
                "-loglevel", "error", "pipe:1",
            ]
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            raw, _ = proc.communicate()
            return np.frombuffer(raw, dtype=np.float32).copy()
        finally:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass

    # ── Preprocessing ─────────────────────────────────────────────

    def reduce_noise(self, audio: np.ndarray, sr: int) -> np.ndarray:
        """Apply noise reduction. Falls back gracefully if noisereduce unavailable."""
        if self._noisereduce is None:
            return audio
        try:
            return self._noisereduce.reduce_noise(y=audio, sr=sr, stationary=True, prop_decrease=0.8)
        except Exception as e:
            log.warn(f"Noise reduction skipped: {e}")
            return audio

    def remove_silence(self, audio: np.ndarray, sr: int) -> np.ndarray:
        """Remove silence using WebRTC VAD or energy-based fallback."""
        if self._webrtcvad is not None and self.vad_cfg.get("enabled", True):
            return self._vad_remove(audio, sr)
        return self._energy_remove(audio, sr)

    def vad(self, audio: np.ndarray, sr: int) -> List[Tuple[int, int]]:
        """Voice Activity Detection — returns list of (start_sample, end_sample) speech regions."""
        if self._webrtcvad is not None:
            return self._vad_regions(audio, sr)
        return self._energy_regions(audio, sr)

    def enhance(self, audio: np.ndarray, sr: int) -> np.ndarray:
        """Audio enhancement: normalize + pre-emphasis."""
        max_val = np.max(np.abs(audio))
        if max_val > 0:
            audio = audio / max_val * 0.95
        pre = self.cfg.get("pre_emphasis", 0.97)
        if pre > 0:
            audio = np.append(audio[0], audio[1:] - pre * audio[:-1])
        return audio

    def process(self, audio: np.ndarray, sr: int,
                do_noise_reduce: bool = False,
                do_silence_remove: bool = False,
                do_enhance: bool = False) -> np.ndarray:
        """Full preprocessing pipeline."""
        if do_noise_reduce:
            audio = self.reduce_noise(audio, sr)
        if do_silence_remove:
            audio = self.remove_silence(audio, sr)
        if do_enhance:
            audio = self.enhance(audio, sr)
        return audio

    # ── VAD ───────────────────────────────────────────────────────

    def _vad_remove(self, audio: np.ndarray, sr: int) -> np.ndarray:
        regions = self._vad_regions(audio, sr)
        if not regions:
            return audio
        parts = [audio[s:e] for s, e in regions]
        return np.concatenate(parts)

    def _vad_regions(self, audio: np.ndarray, sr: int) -> List[Tuple[int, int]]:
        vad = self._webrtcvad.Vad(self.vad_cfg.get("aggressiveness", 3))
        frame_size = int(sr * 0.03)
        min_speech = int(self.vad_cfg.get("min_speech_duration_ms", 250) / 1000 * sr)
        min_silence = int(self.vad_cfg.get("min_silence_duration_ms", 100) / 1000 * sr)

        frames = []
        for i in range(0, len(audio), frame_size):
            frame = audio[i:i + frame_size]
            if len(frame) < frame_size:
                frame = np.pad(frame, (0, frame_size - len(frame)))
            pcm = (frame * 32767).astype(np.int16).tobytes()
            try:
                is_speech = vad.is_speech(pcm, sr)
            except Exception:
                is_speech = bool(np.abs(frame).mean() > 0.01)
            frames.append(is_speech)

        # Merge frames into speech regions
        regions = []
        in_speech = False
        start = 0
        for i, sp in enumerate(frames):
            if sp and not in_speech:
                start = i * frame_size
                in_speech = True
            elif not sp and in_speech:
                end = i * frame_size
                if end - start >= min_speech:
                    # Extend by min_silence
                    end = min(end + min_silence, len(audio))
                    regions.append((start, end))
                in_speech = False
        if in_speech:
            regions.append((start, len(audio)))

        # Merge adjacent regions
        merged = []
        for region in regions:
            if merged and region[0] - merged[-1][1] < min_silence:
                merged[-1] = (merged[-1][0], region[1])
            else:
                merged.append(region)

        return merged

    def _energy_remove(self, audio: np.ndarray, sr: int) -> np.ndarray:
        regions = self._energy_regions(audio, sr)
        if not regions:
            return audio
        parts = [audio[s:e] for s, e in regions]
        return np.concatenate(parts)

    def _energy_regions(self, audio: np.ndarray, sr: int) -> List[Tuple[int, int]]:
        frame_size = int(sr * 0.03)
        threshold = np.abs(audio).mean() * 0.3
        regions = []
        in_speech = False
        start = 0
        for i in range(0, len(audio), frame_size):
            frame = audio[i:i + frame_size]
            is_speech = bool(np.abs(frame).mean() > threshold)
            if is_speech and not in_speech:
                start = i
                in_speech = True
            elif not is_speech and in_speech:
                end = i + frame_size
                regions.append((start, min(end, len(audio))))
                in_speech = False
        if in_speech:
            regions.append((start, len(audio)))
        return regions

    @staticmethod
    def supported_formats() -> dict:
        return {
            "audio": sorted(AUDIO_EXTENSIONS),
            "video": sorted(VIDEO_EXTENSIONS),
        }
