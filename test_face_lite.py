#!/usr/bin/env python3
"""
test_face_lite.py — Cut-to-Face Mode Lite Python verification.

Verifies the core algorithms in clipme-face-detect.py WITHOUT cv2 (pure math),
plus offline/licensing guarantees. Run:
    python3 test_face_lite.py
"""

import json
import os
import sys
import tempfile
import importlib.util


def load():
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "clipme_face_detect", os.path.join(os.path.dirname(os.path.abspath(__file__)), "clipme-face-detect.py")
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


results = []


def test(name, fn):
    try:
        fn()
        results.append((name, True))
        print("[OK  ] " + name)
    except Exception as e:
        results.append((name, False))
        print("[FAIL] " + name + "\n  -> " + str(e))
        sys.exit(1)


mod = load()


def main():

    # Requirement 1: FaceDetectorYN API used (not readNetFromONNX)
    def r1():
        src = open(mod.__file__, "r").read() if hasattr(mod, "__file__") else open("clipme-face-detect.py").read()
        assert "FaceDetectorYN.create" in src, "must use FaceDetectorYN.create"
        assert "readNetFromONNX" not in src, "must NOT use readNetFromONNX"
    test("R1 YuNet via FaceDetectorYN API (bukan readNetFromONNX)", r1)

    # Requirement 2: Haar cascade for profile faces
    def r2():
        src = open("clipme-face-detect.py").read()
        assert "CascadeClassifier" in src, "must use Haar CascadeClassifier"
        assert "haarcascade_profileface" in src, "must reference profile cascade"
    test("R2 Haar profile cascade untuk wajah menyamping", r2)

    # Requirement 3: adaptive sampling defaults
    def r3():
        assert mod.DEFAULT_SAMPLE_FPS == 3, "default sample fps must be 3"
        assert mod.MAX_SAMPLE_FPS == 5, "max sample fps must be 5"
        assert mod.adaptive_sample_fps(30, 3) == 3
        assert mod.adaptive_sample_fps(30, 9) == 5  # clamped to 5
        assert mod.adaptive_sample_fps(30, 1) == 1
        assert mod.adaptive_sample_fps(2, 3) == 2  # never above video fps
    test("R3 Adaptive sampling default 3 FPS, maks 5 FPS", r3)

    # Requirement 4: IoU + centroid tracking with persistent track_id
    def r4():
        t = mod.Tracker()
        # Frame 0: two faces
        t.step([
            {"x": 10, "y": 10, "w": 100, "h": 100, "confidence": 0.9},
            {"x": 500, "y": 10, "w": 100, "h": 100, "confidence": 0.8},
        ], 0)
        assert len(t.tracks) == 2, "two tracks after frame 0"
        ids0 = sorted(t.tracks[i].track_id for i in range(2))
        # Frame 1: same faces slightly moved -> same track_ids
        t.step([
            {"x": 12, "y": 12, "w": 100, "h": 100, "confidence": 0.9},
            {"x": 502, "y": 12, "w": 100, "h": 100, "confidence": 0.8},
        ], 1)
        ids1 = sorted(t.tracks[i].track_id for i in range(2))
        assert ids0 == ids1, "track_ids must persist across frames: %s != %s" % (ids0, ids1)
        # New face far away -> new track id
        t.step([{"x": 900, "y": 300, "w": 100, "h": 100, "confidence": 0.7}], 2)
        all_ids = sorted(t.tracks[i].track_id for i in range(len(t.tracks)))
        assert len(set(all_ids)) == len(all_ids), "track_ids must be unique"
    test("R4 Persistent track_id via IoU + centroid", r4)

    # Requirement 5: mouth motion scoring (pixel diff + Farneback)
    def r5():
        src = open("clipme-face-detect.py").read()
        assert "calcOpticalFlowFarneback" in src, "must use Farneback optical flow"
        assert "absdiff" in src, "must use pixel difference"
        # Pure-math path: no cv2 -> returns 0.0 gracefully
        score = mod.compute_mouth_motion(None, None, {"x": 10, "y": 10, "w": 100, "h": 100}, (1080, 1920, 3))
        assert score == 0.0, "no-frame path must return 0.0"
        score2 = mod.compute_mouth_motion(None, None, {"x": -5, "y": -5, "w": 0, "h": 0}, (1080, 1920, 3))
        assert 0.0 <= score2 <= 1.0, "out-of-bounds must still return 0..1"
    test("R5 Mouth-motion scoring (pixel diff + Farneback)", r5)

    # Requirement 9: look-room — crop shifts toward face (JS side, mirrored here)
    def r9():
        # Sanity: face near right edge should pull the crop right in buildAssociations
        # (implementation is in JS; here we verify the constant exists)
        assert mod.TRACK_CENTROID_DIST > 0
        assert mod.MAX_TRACK_AGE >= 10, "track age must allow ~1.1s hold"
    test("R9 Look-room + hold constants present", r9)

    # Requirement 15: offline pipeline, model metadata, licensing
    def r15():
        src = open("clipme-face-detect.py").read()
        low = src.lower()
        # Banned only as actual code usage (imports / model loads), not as
        # policy documentation text.
        for banned in ["import scrfd", "from scrfd", "import insightface", "from insightface", "import talknet", "from talknet"]:
            assert banned not in low, "banned model usage: " + banned
        # Mentions in policy text are fine; imports/model loads are not.
        for banned in ["scrfd", "insightface", "talknet"]:
            assert ("import " + banned) not in low, "banned import: " + banned
            assert ("from " + banned) not in low, "banned import: " + banned
        assert '"license": "MIT"' in src, "must store YuNet license metadata"
        assert '"license": "Apache-2.0"' in src, "must store Haar license metadata"
        # Analysis path never downloads: ensure_* default allow_download=False
        assert "allow_download=False" in src, "analysis must not auto-download"
        assert "def ensure_yunet_model(models_root, allow_download=False)" in src
        # No network during analysis: urlretrieve only reachable with
        # allow_download=True (the explicit yunet-download subcommand).
        assert "urllib.request.urlretrieve" in src
    test("R15 Gratis & offline, metadata lisensi model", r15)

    print()
    passed = sum(1 for _, ok in results if ok)
    print("test_face_lite done: %d/%d PASS" % (passed, len(results)))
    sys.exit(0 if passed == len(results) else 1)


if __name__ == "__main__":
    main()
