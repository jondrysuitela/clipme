import argparse
import json
from pathlib import Path

from faster_whisper import WhisperModel


def main():
    parser = argparse.ArgumentParser(description="Transcribe audio with faster-whisper.")
    parser.add_argument("audio_path")
    parser.add_argument("--model", default="small")
    parser.add_argument("--language", default="")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--output", default="")
    args = parser.parse_args()

    model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)
    transcribe_kwargs = {"beam_size": 5}
    if args.language:
        transcribe_kwargs["language"] = args.language

    segments, info = model.transcribe(args.audio_path, **transcribe_kwargs)
    items = [
        {
            "start": segment.start,
            "end": segment.end,
            "text": segment.text.strip(),
        }
        for segment in segments
        if segment.text.strip()
    ]
    text = " ".join(item["text"] for item in items).strip()
    payload = {
        "language": getattr(info, "language", ""),
        "duration": getattr(info, "duration", 0),
        "text": text,
        "segments": items,
    }

    if args.output:
        Path(args.output).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    else:
        print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
