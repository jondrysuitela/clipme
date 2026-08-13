#!/usr/bin/env python3
"""Debug engine transcription - trace device/compute_type through pipeline."""
import asyncio
import json
import math
import os
import struct
import sys
import tempfile

sys.path.insert(0, os.path.dirname(__file__))
from stt.config import STTConfig
from stt.engine import STTEngine


def make_wav(path, duration=2):
    sr = 16000
    n = int(sr * duration)
    with open(path, "wb") as f:
        f.write(b"RIFF")
        f.write(struct.pack("<I", 36 + n * 2))
        f.write(b"WAVE")
        f.write(b"fmt ")
        f.write(struct.pack("<ihhiihh", 16, 1, 1, sr, sr * 2, 2, 16))
        f.write(b"data")
        f.write(struct.pack("<I", n * 2))
        for i in range(n):
            s = int(math.sin(2 * math.pi * 440 * i / sr) * 0.3 * 32767)
            f.write(struct.pack("<h", s))


async def main():
    cfg = STTConfig()
    cfg.override("model.device", "cpu")
    cfg.override("model.compute_type", "int8")

    print(f"Config device={cfg.get('model.device')!r} compute={cfg.get('model.compute_type')!r}")
    print(f"Config data model: {json.dumps(cfg.data.get('model', {}), indent=2)}")

    engine = STTEngine(cfg)

    # Check engine model manager config
    print(f"Engine ModelManager cfg device={engine._model_mgr._cfg.get('device','?')}")
    print(f"Engine ModelManager cfg compute_type={engine._model_mgr._cfg.get('compute_type','?')}")

    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    make_wav(tmp.name)

    try:
        result = await engine.transcribe(tmp.name)
        print(f"Result device={result.device!r} compute={result.compute_type!r}")
        print(f"PASS: device={bool(result.device)} compute={bool(result.compute_type)}")
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
    finally:
        os.unlink(tmp.name)


if __name__ == "__main__":
    asyncio.run(main())
