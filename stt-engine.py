#!/usr/bin/env python3
"""
stt-engine.py — Enterprise-grade Offline Speech-to-Text Engine v2
========================================================================
Built with modular architecture. Imports from stt/ package.

Usage:
  python stt-engine.py transcribe --audio audio.mp3 --format srt
  python stt-engine.py search --transcript result.json --keyword "hello"
  python stt-engine.py list-models
  python stt-engine.py benchmark --audio audio.mp3
  python stt-engine.py analytics --transcript result.json
  python stt-engine.py config --output stt-config.json
"""

import argparse
import asyncio
import json
import os
import sys
import time

from stt.config import STTConfig, DEFAULT_CONFIG
from stt.model import ModelManager
from stt.audio import AudioProcessor
from stt.engine import STTEngine
from stt.exporter import FormatWriter
from stt.search import SearchEngine
from stt.analytics import SpeechAnalytics
from stt.benchmark import Benchmark
from stt.errors import STTError
from stt.logging import log
from stt.interfaces import TranscriptionResult, Segment, Word


def main():
    parser = argparse.ArgumentParser(description="Clipper Studio STT Engine v2")
    sub = parser.add_subparsers(dest="command")

    # transcribe
    tp = sub.add_parser("transcribe", help="Transcribe audio file")
    tp.add_argument("--audio", required=True)
    tp.add_argument("--model", default="", help="Model name (tiny/base/small/medium/large-v3/large-v3-turbo)")
    tp.add_argument("--device", default="", choices=["", "auto", "cpu", "cuda"],
                    help="Execution device (auto/cpu/cuda)")
    tp.add_argument("--compute-type", default="", choices=["", "auto", "float16", "float32", "int8", "int8_float16"],
                    help="Compute precision (auto/float16/float32/int8/int8_float16)")
    tp.add_argument("--language", default="", help="Language code")
    tp.add_argument("--format", default="json", choices=FormatWriter.all_formats())
    tp.add_argument("--output", default="", help="Output file path")
    tp.add_argument("--config", default="", help="Config file")
    tp.add_argument("--noise-reduction", action="store_true")
    tp.add_argument("--remove-silence", action="store_true")
    tp.add_argument("--enhance", action="store_true")
    tp.add_argument("--no-vad", action="store_true", help="Disable VAD")
    tp.add_argument("--no-diarization", action="store_true", help="Disable lightweight speaker diarization")

    # search
    sp = sub.add_parser("search", help="Search transcript")
    sp.add_argument("--transcript", required=True)
    sp.add_argument("--keyword", required=True)
    sp.add_argument("--context", type=int, default=3)
    sp.add_argument("--config", default="")

    # list-models
    lp = sub.add_parser("list-models")
    lp.add_argument("--config", default="")
    lp.add_argument("--json", action="store_true", help="Output as JSON")

    # benchmark
    bp = sub.add_parser("benchmark")
    bp.add_argument("--audio", default="", help="Audio file (optional — generates dummy if empty)")
    bp.add_argument("--model", default="small")
    bp.add_argument("--duration", type=float, default=30.0)
    bp.add_argument("--config", default="")
    bp.add_argument("--compare", nargs="*", help="Models to compare")

    # analytics
    ap = sub.add_parser("analytics")
    ap.add_argument("--transcript", required=True)
    ap.add_argument("--config", default="")

    # translate
    trp = sub.add_parser("translate", help="Translate text or transcript JSON (offline, Argos)")
    trp.add_argument("--text", default="", help="Plain text to translate")
    trp.add_argument("--json", default="", help="Transcript JSON file to translate")
    trp.add_argument("--from", dest="from_code", required=True)
    trp.add_argument("--to", dest="to_code", required=True)
    trp.add_argument("--output", default="", help="Output path for --json mode")

    # config
    cp = sub.add_parser("config")
    cp.add_argument("--output", default="stt-config.json")

    # models (detailed info)
    mp = sub.add_parser("models", help="Detailed model info")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return

    # ── Config ──
    if args.command == "config":
        cfg = STTConfig()
        cfg.save(args.output)
        print(f"Config saved to {args.output}")
        return

    # ── Translate (offline) ──
    if args.command == "translate":
        from stt.translate import translate_segments, translate_text

        if args.text:
            print(translate_text(args.text, args.from_code, args.to_code))
            return
        if args.json:
            if not os.path.exists(args.json):
                print(f"Error: File not found: {args.json}", file=sys.stderr)
                sys.exit(1)
            with open(args.json, "r", encoding="utf-8") as f:
                data = json.load(f)
            segments = data if isinstance(data, list) else data.get("segments", [])
            translated = translate_segments(segments, args.from_code, args.to_code)
            payload = translated if isinstance(data, list) else {**data, "segments": translated}
            if args.output:
                with open(args.output, "w", encoding="utf-8") as f:
                    json.dump(payload, f, ensure_ascii=False, indent=2)
                print(f"Output: {args.output}", file=sys.stderr)
            else:
                print(json.dumps(payload, ensure_ascii=False, indent=2))
            return
        print("Error: --text atau --json diperlukan.", file=sys.stderr)
        sys.exit(1)

    # ── List models ──
    if args.command == "list-models":
        models = ModelManager.list_supported()
        if getattr(args, "json", False):
            print(json.dumps(models, indent=2))
            return
        print(f"{'Model':20} {'Size':8} {'RAM':6} {'Speed':12} {'Description'}")
        print("-" * 75)
        # FIX BUG-12: hapus duplikat kunci 3 — large-v3-turbo (rank 3) label "Balanced", bukan "Fast"
        speed_map = {10: "Fast", 7: "Good", 4: "Normal", 3: "Balanced", 2: "Slow", 1: "Very Slow"}
        for m in models:
            speed = speed_map.get(m["speed_rank"], "?")
            print(f"{m['name']:20} {m['size_mb']:4} MB  {m['ram_gb']} GB  {speed:12} {m['description']}")
        return

    if args.command == "models":
        models = ModelManager.list_supported()
        print(json.dumps(models, indent=2, ensure_ascii=False))
        return

    # ── Load config ──
    cfg = STTConfig()
    if hasattr(args, "config") and args.config:
        cfg.load(args.config)
    cfg.load_env()

    # ── Transcribe ──
    if args.command == "transcribe":
        if not os.path.exists(args.audio):
            print(f"Error: Audio file not found: {args.audio}", file=sys.stderr)
            sys.exit(1)

        # Apply CLI overrides to config before engine creation
        if args.device:
            cfg.override("model.device", args.device)
        if args.compute_type:
            cfg.override("model.compute_type", args.compute_type)

        engine = STTEngine(cfg)

        def progress(pct, msg):
            bar = "#" * (pct // 5) + "." * (20 - pct // 5)
            print(f"\r[{bar}] {pct}% {msg}", end="", file=sys.stderr, flush=True)
            if pct >= 100:
                print(file=sys.stderr)

        engine.set_progress_callback(progress)

        kwargs = {"model": args.model} if args.model else {}
        if args.language:
            kwargs["language"] = args.language
        if args.noise_reduction:
            kwargs["noise_reduction"] = True
        if args.remove_silence:
            kwargs["remove_silence"] = True
        if args.enhance:
            kwargs["enhance"] = True
        if args.no_vad:
            kwargs["vad_filter"] = False
        if args.no_diarization:
            kwargs["diarization"] = False

        try:
            result = asyncio.run(engine.transcribe(args.audio, **kwargs))
        except STTError as e:
            print(f"\nError: {e}", file=sys.stderr)
            sys.exit(1)

        output = FormatWriter.write(result, args.format, args.audio)
        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                f.write(output)
            print(f"\nOutput: {args.output}", file=sys.stderr)
        else:
            print(output)

        # Analytics to stderr
        analytics = SpeechAnalytics().compute(result)
        print(f"\n{'─'*40}", file=sys.stderr)
        print(f"Language: {result.language} ({result.language_probability:.1%})", file=sys.stderr)
        print(f"Duration: {result.duration:.1f}s → Processed: {result.processed_duration:.1f}s", file=sys.stderr)
        print(f"Words: {analytics['summary']['total_words']} ({analytics['summary']['speaking_speed_wpm']} wpm)", file=sys.stderr)
        print(f"Confidence: {analytics['confidence']['average']:.1%}", file=sys.stderr)
        print(f"Filler: {analytics['filler_words']['total']} ({analytics['filler_words']['percentage_of_speech']}%)", file=sys.stderr)
        print(f"Model: {result.model_name} | Device: {result.device} | Compute: {result.compute_type}", file=sys.stderr)
        return

    # ── Search ──
    if args.command == "search":
        if not os.path.exists(args.transcript):
            print(f"Error: File not found: {args.transcript}", file=sys.stderr)
            sys.exit(1)
        with open(args.transcript, "r", encoding="utf-8") as f:
            data = json.load(f)

        result = TranscriptionResult(segments=[])
        for sd in data.get("segments", []):
            seg = Segment(start=sd["start"], end=sd["end"], text=sd.get("text", ""))
            for wd in sd.get("words", []):
                w = Word(
                    text=wd["text"], start=wd["start"], end=wd["end"],
                    probability=wd.get("probability", 0),
                )
                seg.words.append(w)
                result.words.append(w)
            result.segments.append(seg)
        result.text = data.get("full_text", "")

        searcher = SearchEngine(context_window=getattr(args, "context", 3))
        sr = searcher.search(result, args.keyword)
        print(json.dumps(sr, indent=2, ensure_ascii=False))
        return

    # ── Analytics ──
    if args.command == "analytics":
        if not os.path.exists(args.transcript):
            print(f"Error: File not found: {args.transcript}", file=sys.stderr)
            sys.exit(1)
        with open(args.transcript, "r", encoding="utf-8") as f:
            data = json.load(f)

        result = TranscriptionResult(segments=[])
        for sd in data.get("segments", []):
            seg = Segment(
                start=sd["start"], end=sd["end"], text=sd.get("text", ""),
                confidence=sd.get("confidence", 0),
            )
            for wd in sd.get("words", []):
                w = Word(
                    text=wd["text"], start=wd["start"], end=wd["end"],
                    probability=wd.get("probability", 0),
                )
                seg.words.append(w)
                result.words.append(w)
            result.segments.append(seg)
        result.duration = data.get("duration", 0)
        result.language = data.get("language", "")

        analytics = SpeechAnalytics().compute(result)
        print(json.dumps(analytics, indent=2, ensure_ascii=False))
        return

    # ── Benchmark ──
    if args.command == "benchmark":
        bench = Benchmark()

        if args.compare:
            results = Benchmark.compare(args.compare, args.audio, args.duration)
            print(json.dumps(results, indent=2))
        else:
            result = bench.run(args.model, args.audio, args.duration, cfg.data)
            print(json.dumps({
                "model": result.model,
                "device": result.device,
                "compute_type": result.compute_type,
                "load_time_s": result.load_time,
                "inference_time_s": result.inference_time,
                "total_time_s": result.total_time,
                "audio_duration_s": result.audio_duration,
                "words_per_second": result.words_per_second,
                "audio_minutes_per_minute": result.audio_minutes_per_minute,
                "peak_ram_mb": result.peak_ram_mb,
                "total_words": result.total_words,
                "errors": result.errors,
            }, indent=2))
        return


if __name__ == "__main__":
    main()
