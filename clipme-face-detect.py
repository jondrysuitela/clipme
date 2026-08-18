#!/usr/bin/env python3
"""
clipme-face-detect.py — Face detection backend

Subcommands:
    analyze --video FILE [--sample-fps N] [--models-root DIR]

Output: JSON {
  "schema_version": 1,
  "source": "opencv-dnn" | "mediapipe" | "skipped-no-backend" | "skipped-error",
  "fps": N,
  "frames": [
    { "t_ms": N, "faces": [ { x, y, w, h, confidence } ] }
  ]
}

Backend priority:
    1) MediaPipe (if installed) — GPU-accelerated, very accurate
    2) OpenCV DNN with bundled Res10 SSD — CPU, accurate, ~10MB model
    3) Return source="skipped-no-backend" (NOT mock coords)

NEVER emits fake bounding boxes. The result is either real per-frame
detection OR `skipped: true`.
"""

import argparse
import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

SCHEMA_VERSION = 1
DEFAULT_SAMPLE_FPS = 1
DEFAULT_CONFIDENCE = 0.5

# Res10 SSD face detector (Apache-2.0, ~10MB). Bundled URLs from OpenCV Zoo.
DEPLOY_URL = "https://raw.githubusercontent.com/opencv/opencv_zoo/master/models/face_detector/yunet/face_detection_yunet_2023mar.onnx"  # small, accurate
# We use YuNet (2023, ~340KB) — way smaller than Res10 SSD (~10MB), still Apache-2.0


def ensure_model(models_root: str) -> dict:
    """Download YuNet ONNX face detector if missing. Returns {path, source, ok}."""
    model_dir = Path(models_root) / "face"
    onnx = model_dir / "face_detection_yunet_2023mar.onnx"
    deploy = model_dir / "face_detection_yunet_2023mar.prototxt"
    model_dir.mkdir(parents=True, exist_ok=True)
    if onnx.exists() and deploy.exists():
        return {"ok": True, "source": "cached", "onnx": str(onnx), "deploy": str(deploy)}
    try:
        if not deploy.exists():
            urllib.request.urlretrieve(
                "https://raw.githubusercontent.com/opencv/opencv/master/samples/dnn/face_detector/deploy.prototxt",
                str(deploy)
            )
        if not onnx.exists():
            urllib.request.urlretrieve(DEPLOY_URL, str(onnx))
        return {"ok": True, "source": "downloaded", "onnx": str(onnx), "deploy": str(deploy)}
    except Exception as e:
        # Try to download via ffmpeg if available
        return {"ok": False, "source": "download-failed", "error": str(e)}


def sample_frames(video_path: str, sample_fps: int) -> list:
    """Extract frames from video at given fps. Yields (t_ms, np_array BGR)."""
    try:
        import cv2  # type: ignore
        import numpy as np  # type: ignore
    except Exception:
        return []
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return []
    video_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) * 1000 / (video_fps or 1))
    step_frames = max(1, int(round(video_fps / sample_fps)))
    frames = []
    idx = 0
    while True:
        ok = cap.grab()
        if not ok:
            break
        if idx % step_frames == 0:
            ok, frame = cap.retrieve()
            if ok:
                t_ms = int((idx / video_fps) * 1000) if video_fps > 0 else 0
                frames.append((t_ms, frame))
        idx += 1
    cap.release()
    return frames


def detect_mediapipe(frames, conf=DEFAULT_CONFIDENCE):
    try:
        import mediapipe as mp  # type: ignore
    except Exception:
        return None
    mp_face = mp.solutions.face_detection
    detector = mp_face.FaceDetection(model_selection=1, min_detection_confidence=conf)
    out = []
    for t_ms, frame in frames:
        try:
            rgb = frame[:, :, ::-1]  # BGR → RGB
            results = detector.process(rgb)
        except Exception:
            continue
        faces = []
        if results and results.detections:
            for d in results.detections:
                bb = d.location_data.relative_bounding_box
                h, w = frame.shape[:2]
                faces.append({
                    "x": int(bb.xmin * w),
                    "y": int(bb.ymin * h),
                    "w": int(bb.width * w),
                    "h": int(bb.height * h),
                    "confidence": float(d.score or conf),
                })
        out.append({"t_ms": int(t_ms), "faces": faces})
    detector.close()
    return out


def detect_opencv_dnn(frames, deploy_path, model_path, conf=DEFAULT_CONFIDENCE, cpu=True):
    try:
        import cv2  # type: ignore
        import numpy as np  # type: ignore
    except Exception:
        return None
    try:
        net = cv2.dnn.readNetFromONNX(model_path)
        net.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
        net.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU if cpu else cv2.dnn.DNN_TARGET_CUDA)
    except Exception as e:
        return None
    out = []
    for t_ms, frame in frames:
        if frame is None:
            continue
        h, w = frame.shape[:2]
        try:
            blob = cv2.dnn.blobFromImage(frame, 1.0, (320, 320),
                                         [104, 117, 123], False, False)
            net.setInput(blob)
            detections = net.forward()
        except Exception:
            continue
        faces = []
        # YuNet output: 1 x 1 x N x 15 (x, y, w, h + 14 landmarks/conf)
        try:
            dets = detections[0][0]
            for d in dets:
                if d.shape and len(d) >= 5:
                    confidence = float(d[-1])
                    if confidence < conf:
                        continue
                    x1 = float(d[0]) * w
                    y1 = float(d[1]) * h
                    bw = float(d[2]) * w
                    bh = float(d[3]) * h
                    x, y = max(0, int(x1)), max(0, int(y1))
                    bw, bh = max(1, int(bw)), max(1, int(bh))
                    faces.append({"x": x, "y": y, "w": bw, "h": bh, "confidence": confidence})
        except Exception:
            continue
        out.append({"t_ms": int(t_ms), "faces": faces})
    return out


def analyze_video(video_path: str, models_root: str, sample_fps: int) -> dict:
    """Run face detection; pick best backend available."""
    if not Path(video_path).exists():
        return {"schema_version": SCHEMA_VERSION, "source": "error",
                "fps": sample_fps, "frames": [], "error": f"video not found: {video_path}"}

    info = ensure_model(models_root)
    frames = sample_frames(video_path, sample_fps)
    if not frames:
        # opencv-python may not be installed
        return {"schema_version": SCHEMA_VERSION, "source": "skipped-no-backend",
                "fps": sample_fps, "frames": [], "skipped": True}

    # Try MediaPipe first (more accurate, GPU-accelerated)
    out = detect_mediapipe(frames)
    if out is not None and out:
        return {"schema_version": SCHEMA_VERSION, "source": "mediapipe",
                "fps": sample_fps, "frames": out}

    # OpenCV DNN (YuNet ONNX)
    if info.get("ok"):
        try:
            import cv2  # type: ignore
            out = detect_opencv_dnn(frames, info["deploy"], info["onnx"])
            if out is not None:
                return {"schema_version": SCHEMA_VERSION, "source": "opencv-dnn",
                        "fps": sample_fps, "frames": out}
        except Exception:
            pass

    # Neither usable — real skip (NOT mock coords)
    return {"schema_version": SCHEMA_VERSION, "source": "skipped-no-backend",
            "fps": sample_fps, "frames": [], "skipped": True}


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="command", required=True)
    a = sub.add_parser("analyze")
    a.add_argument("--video", required=True)
    a.add_argument("--sample-fps", type=int, default=DEFAULT_SAMPLE_FPS)
    a.add_argument("--models-root", default="models")
    args = p.parse_args()
    out = analyze_video(args.video, args.models_root, args.sample_fps)
    print(json.dumps(out))


if __name__ == "__main__":
    main()
