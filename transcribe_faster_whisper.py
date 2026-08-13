#!/usr/bin/env python3
"""
transcribe_faster_whisper.py — Legacy entry point for backward compatibility.
Delegates to stt-engine.py with proper argument mapping.

Old format:
    python transcribe_faster_whisper.py <audio_path> --model <model> --output <path>

New format:
    python stt-engine.py transcribe --audio <audio_path> --model <model> --output <path>
"""

import sys
import subprocess
import json

STT_ENGINE = __file__.replace("transcribe_faster_whisper.py", "stt-engine.py")


def main():
    args = sys.argv[1:]
    if not args:
        print("Usage: transcribe_faster_whisper.py <audio_path> [options]", file=sys.stderr)
        sys.exit(1)

    cmd = [sys.executable, STT_ENGINE, "transcribe"]

    # First positional arg is the audio path — map to --audio
    cmd.append("--audio")
    cmd.append(args[0])

    # Remaining args pass through
    i = 1
    while i < len(args):
        cmd.append(args[i])
        i += 1

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(result.stderr, file=sys.stderr)
        sys.exit(result.returncode)

    # Forward stdout
    try:
        parsed = json.loads(result.stdout)
        print(json.dumps(parsed, indent=2))
    except json.JSONDecodeError:
        print(result.stdout)


if __name__ == "__main__":
    main()
