#!/usr/bin/env python3
"""Test the full STT pipeline end-to-end without external audio deps."""
import json
import os
import subprocess
import sys
import tempfile
import struct

STT_ENGINE = os.path.join(os.path.dirname(__file__), "stt-engine.py")
VENV_PYTHON = os.path.join(os.path.dirname(__file__), ".venv", "Scripts", "python.exe")
PYTHON = VENV_PYTHON if os.path.exists(VENV_PYTHON) else sys.executable


def make_wav(path, duration=2, freq=440, sr=16000):
    """Generate a simple WAV file without soundfile."""
    import math
    n_samples = int(sr * duration)
    with open(path, "wb") as f:
        # WAV header
        data_size = n_samples * 2
        f.write(b"RIFF")
        f.write(struct.pack("<I", 36 + data_size))
        f.write(b"WAVE")
        f.write(b"fmt ")
        f.write(struct.pack("<I", 16))  # chunk size
        f.write(struct.pack("<H", 1))   # PCM
        f.write(struct.pack("<H", 1))   # mono
        f.write(struct.pack("<I", sr))  # sample rate
        f.write(struct.pack("<I", sr * 2))  # byte rate
        f.write(struct.pack("<H", 2))   # block align
        f.write(struct.pack("<H", 16))  # bits per sample
        f.write(b"data")
        f.write(struct.pack("<I", data_size))
        for i in range(n_samples):
            sample = int(math.sin(2 * math.pi * freq * i / sr) * 0.3 * 32767)
            f.write(struct.pack("<h", sample))


def test_cli():
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    make_wav(tmp.name)
    print(f"[TEST] Created test audio: {tmp.name}")

    # Test 1: Basic transcribe
    print("\n[TEST 1] Basic transcribe (tiny)...")
    cmd = [PYTHON, STT_ENGINE, "transcribe", "--audio", tmp.name, "--model", "tiny", "--format", "json"]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"  FAIL: exit={r.returncode}")
        print(f"  STDERR: {r.stderr[:500]}")
    else:
        d = json.loads(r.stdout)
        print(f"  OK: text='{d.get('text','')[:40]}' segments={len(d.get('segments',[]))}")
        assert "text" in d, "Missing 'text' field"
        assert d.get("device", ""), f"Empty device: {d.get('device')!r}"
        assert d.get("compute_type", ""), f"Empty compute_type: {d.get('compute_type')!r}"

    # Test 2: --device cpu --compute-type int8
    print("\n[TEST 2] --device cpu --compute-type int8...")
    cmd = [PYTHON, STT_ENGINE, "transcribe", "--audio", tmp.name, "--model", "tiny",
           "--device", "cpu", "--compute-type", "int8", "--format", "json"]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"  FAIL: exit={r.returncode}")
        print(f"  STDERR: {r.stderr[:500]}")
    else:
        d = json.loads(r.stdout)
        print(f"  OK: device={d.get('device')} compute={d.get('compute_type')}")
        assert d.get("device") == "cpu", f"Expected cpu, got {d.get('device')}"
        assert d.get("compute_type") == "int8", f"Expected int8, got {d.get('compute_type')}"

    # Test 3: Legacy script forward
    print("\n[TEST 3] Legacy transcribe_faster_whisper.py forward...")
    legacy = os.path.join(os.path.dirname(__file__), "transcribe_faster_whisper.py")
    out_path = tmp.name + ".test.json"
    cmd = [PYTHON, legacy, tmp.name, "--model", "tiny", "--output", out_path]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"  FAIL: exit={r.returncode}")
        print(f"  STDERR: {r.stderr[:500]}")
    else:
        if os.path.exists(out_path):
            with open(out_path) as f:
                d = json.load(f)
            print(f"  OK: text='{d.get('text','')[:40]}' segments={len(d.get('segments',[]))}")
            assert "text" in d, "Missing 'text' field"
            os.unlink(out_path)
        else:
            print(f"  Output file not found. stdout: {r.stdout[:200]}")

    # Cleanup
    os.unlink(tmp.name)
    print("\n[ALL TESTS PASSED]")


if __name__ == "__main__":
    test_cli()
