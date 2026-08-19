#!/usr/bin/env python3
"""
clipme-face-detect.py - Face detection backend (Cut-to-Face Mode Lite)

Subcommands:
    analyze --video FILE [--sample-fps N] [--models-root DIR]
            [--start-seconds N] [--duration-seconds N]
    yunet-download --models-root DIR

Licensing: Apache-2.0 / MIT. No cloud APIs. Offline.
"""

import argparse
import json
import math
import sys
import urllib.request
from pathlib import Path

SCHEMA_VERSION = 2
DEFAULT_SAMPLE_FPS = 3
MAX_SAMPLE_FPS = 5
DEFAULT_CONFIDENCE = 0.5
TRACK_IOU_THRESHOLD = 0.2
TRACK_CENTROID_DIST = 100.0
MAX_TRACK_AGE = 15
HYSTERESIS_FRAMES = 2
HISTORY_SIZE = 48

YUET_URL = (
    "https://raw.githubusercontent.com/opencv/opencv_zoo/master/"
    "models/face_detector/yunet/face_detection_yunet_2023mar.onnx"
)
HAAR_URL = (
    "https://raw.githubusercontent.com/opencv/opencv/master/data/"
    "haarcascades/haarcascade_profileface.xml"
)


def ensure_yunet_model(models_root, allow_download=False):
    """Resolve YuNet ONNX. Analysis NEVER downloads (requirement 15):
    download happens only via the explicit 'yunet-download' subcommand,
    which the 'Download Models' button calls."""
    model_dir = Path(models_root) / "face"
    onnx = model_dir / "face_detection_yunet_2023mar.onnx"
    model_dir.mkdir(parents=True, exist_ok=True)
    if onnx.exists():
        return {"ok": True, "path": str(onnx), "source": "cached"}
    if not allow_download:
        return {"ok": False, "source": "missing", "hint": "Download via tombol 'Download Models'."}
    try:
        urllib.request.urlretrieve(YUET_URL, str(onnx))
        return {"ok": True, "path": str(onnx), "source": "downloaded"}
    except Exception as e:
        return {"ok": False, "source": "download-failed", "error": str(e)}


def ensure_haar_model(models_root, allow_download=False):
    """Resolve Haar profile cascade. Same explicit-download rule as YuNet."""
    model_dir = Path(models_root) / "face_extra"
    cascade = model_dir / "haarcascade_profileface.xml"
    model_dir.mkdir(parents=True, exist_ok=True)
    if cascade.exists():
        return {"ok": True, "path": str(cascade), "source": "cached"}
    if not allow_download:
        return {"ok": False, "source": "missing", "hint": "Download via tombol 'Download Models'."}
    try:
        urllib.request.urlretrieve(HAAR_URL, str(cascade))
        return {"ok": True, "path": str(cascade), "source": "downloaded"}
    except Exception as e:
        return {"ok": False, "source": "download-failed", "error": str(e)}


def write_model_metadata(models_root):
    """Persist license metadata for downloaded models (requirement 15)."""
    import datetime
    meta = {
        "schema_version": 1,
        "updated_utc": datetime.datetime.utcnow().isoformat() + "Z",
        "models": [
            {
                "id": "face-yunet",
                "name": "OpenCV Zoo YuNet Face Detector (2023mar)",
                "file": "face/face_detection_yunet_2023mar.onnx",
                "license": "MIT",
                "source": "https://github.com/opencv/opencv_zoo/tree/master/models/face_detector/yunet",
                "download": "explicit-only (tombol 'Download Models')"
            },
            {
                "id": "face-haar",
                "name": "OpenCV Haar Cascade Profile Face",
                "file": "face_extra/haarcascade_profileface.xml",
                "license": "Apache-2.0",
                "source": "https://github.com/opencv/opencv/blob/master/data/haarcascades/haarcascade_profileface.xml",
                "download": "explicit-only (tombol 'Download Models')"
            }
        ],
        "policy": [
            "No SCRFD, InsightFace, TalkNet, atau model berlisensi komersial.",
            "Analisis video tidak melakukan request jaringan apa pun.",
            "Unduhan hanya melalui tombol 'Download Models' (explicit)."
        ]
    }
    root = Path(models_root)
    root.mkdir(parents=True, exist_ok=True)
    (root / "MODELS-METADATA.json").write_text(
        json.dumps(meta, indent=2), encoding="utf-8"
    )


def adaptive_sample_fps(video_fps, requested_fps=DEFAULT_SAMPLE_FPS):
    """Adaptive face sampling: default 3 FPS, max 5 FPS (requirement 3)."""
    return max(1, min(MAX_SAMPLE_FPS, requested_fps, int(video_fps)))


def sample_frames(video_path, sample_fps, start_seconds=0, duration_seconds=0):
    """Extract frames from video at adaptive sample rate."""
    try:
        import cv2
    except Exception:
        return []
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return []
    video_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    total_frames = max(0, int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0))
    effective_fps = adaptive_sample_fps(video_fps, sample_fps)
    start_frame = max(0, int(round(max(0.0, start_seconds) * video_fps)))
    end_frame = total_frames
    if duration_seconds and duration_seconds > 0:
        end_frame = min(
            total_frames or (start_frame + int(duration_seconds * video_fps)),
            start_frame + max(1, int(round(duration_seconds * video_fps)))
        )
    if start_frame:
        cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
    step_frames = max(1, int(round(video_fps / max(1, effective_fps))))
    frames = []
    idx = start_frame
    while end_frame <= 0 or idx < end_frame:
        ok = cap.grab()
        if not ok:
            break
        if (idx - start_frame) % step_frames == 0:
            ok, frame = cap.retrieve()
            if ok:
                t_ms = int(((idx - start_frame) / video_fps) * 1000) if video_fps > 0 else 0
                frames.append((t_ms, frame))
        idx += 1
    cap.release()
    return frames


def compute_iou(a, b):
    ax1, ay1 = a["x"], a["y"]
    ax2, ay2 = a["x"] + a["w"], a["y"] + a["h"]
    bx1, by1 = b["x"], b["y"]
    bx2, by2 = b["x"] + b["w"], b["y"] + b["h"]
    xi1 = max(ax1, bx1)
    yi1 = max(ay1, by1)
    xi2 = min(ax2, bx2)
    yi2 = min(ay2, by2)
    inter = max(0, xi2 - xi1) * max(0, yi2 - yi1)
    area_a = a["w"] * a["h"]
    area_b = b["w"] * b["h"]
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def centroid_distance(a, b):
    cxa = a["x"] + a["w"] / 2
    cya = a["y"] + a["h"] / 2
    cxb = b["x"] + b["w"] / 2
    cyb = b["y"] + b["h"] / 2
    return math.sqrt((cxa - cxb)**2 + (cya - cyb)**2)


class Track:
    """Single face track across frames with confidence and mouth motion."""
    def __init__(self, track_id, face, frame_idx):
        self.track_id = track_id
        self.last_face = face
        self.age = 0
        self.last_seen = frame_idx
        self.confs = [face.get("confidence", 0.5)]
        self.mouth_scores = []

    @property
    def confidence(self):
        return sum(self.confs) / len(self.confs) if self.confs else 0.0

    @property
    def mouth_motion_avg(self):
        return sum(self.mouth_scores) / len(self.mouth_scores) if self.mouth_scores else 0.0

    def update(self, face, frame_idx):
        self.last_face = face
        self.age = 0
        self.last_seen = frame_idx
        if len(self.confs) >= HISTORY_SIZE:
            self.confs.pop(0)
        self.confs.append(face.get("confidence", 0.5))
        mm = face.get("mouth_motion", 0.0)
        if mm is not None and mm > 0:
            if len(self.mouth_scores) >= HISTORY_SIZE:
                self.mouth_scores.pop(0)
            self.mouth_scores.append(mm)


class Tracker:
    """IOU + centroid tracker for persistent face track_id (requirement 4)."""
    def __init__(self, max_age=MAX_TRACK_AGE):
        self.tracks = []
        self.next_id = 0
        self.max_age = max_age

    def step(self, detections, frame_idx):
        for t in self.tracks:
            t.age += 1
        sorted_dets = sorted(detections, key=lambda d: d.get("confidence", 0.0), reverse=True)
        matched = set()
        for det in sorted_dets:
            best = None
            best_score = -999.0
            for t in self.tracks:
                if t.age > self.max_age:
                    continue
                if t.track_id in matched:
                    continue
                iou = compute_iou(t.last_face, det)
                dist = centroid_distance(t.last_face, det)
                if iou > TRACK_IOU_THRESHOLD or dist < TRACK_CENTROID_DIST:
                    score = iou * 2.0 - (dist / 100.0)
                    if score > best_score:
                        best_score = score
                        best = t
            if best is not None:
                best.update(det, frame_idx)
                matched.add(best.track_id)
            else:
                self.tracks.append(Track(self.next_id, det, frame_idx))
                self.next_id += 1
        self.tracks = [t for t in self.tracks if t.age <= self.max_age]

    def get_track_by_face(self, face, frame_idx):
        for t in self.tracks:
            if t.last_seen != frame_idx:
                continue
            if (t.last_face.get("x") == face.get("x") and
                t.last_face.get("y") == face.get("y")):
                return t
        return None


def compute_mouth_motion(prev_gray, cur_gray, face, frame_shape):
    """Mouth motion via pixel diff + Farneback optical flow (requirement 5)."""
    if prev_gray is None or cur_gray is None:
        return 0.0
    h, w = frame_shape[:2]
    x, y, bw, bh = face["x"], face["y"], face["w"], face["h"]
    my = y + int(bh * 0.55)
    mh = max(1, int(bh * 0.25))
    mx = x + int(bw * 0.15)
    mw = max(1, int(bw * 0.70))
    mx = max(0, min(mx, w - 1))
    my = max(0, min(my, h - 1))
    mw = max(1, min(mw, w - mx))
    mh = max(1, min(mh, h - my))
    try:
        import cv2
        import numpy as np
    except Exception:
        return 0.0
    score = 0.0
    try:
        pm = prev_gray[my:my+mh, mx:mx+mw]
        cm = cur_gray[my:my+mh, mx:mx+mw]
        if pm.size > 0 and cm.size > 0 and pm.shape == cm.shape:
            diff = float(cv2.mean(cv2.absdiff(pm, cm))[0])
            score += min(1.0, diff / 30.0) * 0.4
    except Exception:
        pass
    try:
        flow = cv2.calcOpticalFlowFarneback(prev_gray, cur_gray, None, 0.5, 3, 15, 3, 5, 1.2, 0)
        fm = flow[my:my+mh, mx:mx+mw]
        if fm.size > 0:
            mag = np.sqrt(fm[:, :, 0]**2 + fm[:, :, 1]**2)
            score += min(1.0, float(np.mean(mag)) / 5.0) * 0.6
    except Exception:
        pass
    return min(1.0, score)


def create_yunet(model_path):
    """Create FaceDetectorYN from YuNet ONNX (requirement 1)."""
    try:
        import cv2
        return cv2.FaceDetectorYN.create(
            model=model_path, config="",
            input_size=(320, 320),
            score_threshold=DEFAULT_CONFIDENCE,
            nms_threshold=0.3, top_k=5000
        )
    except Exception as e:
        print("# YuNet creation failed: {0}".format(e), file=sys.stderr)
        return None


def create_haar(cascade_path):
    """Create Haar cascade for profile face detection (requirement 2)."""
    try:
        import cv2
        return cv2.CascadeClassifier(cascade_path)
    except Exception as e:
        print("# Haar cascade failed: {0}".format(e), file=sys.stderr)
        return None


def detect_yunet(model, frame, conf=DEFAULT_CONFIDENCE):
    """Detect faces using FaceDetectorYN API."""
    if model is None:
        return []
    try:
        import cv2
        h, w = frame.shape[:2]
        model.setInputSize((w, h))
        _, results = model.detect(frame)
        if results is None:
            return []
        faces = []
        for r in results:
            if len(r) < 5:
                continue
            confidence = float(r[-1])
            if confidence < conf:
                continue
            faces.append({
                "x": max(0, int(r[0])),
                "y": max(0, int(r[1])),
                "w": max(1, int(r[2])),
                "h": max(1, int(r[3])),
                "confidence": confidence
            })
        return faces
    except Exception as e:
        print("# YuNet detect error: {0}".format(e), file=sys.stderr)
        return []


def detect_haar(cascade, frame):
    """Detect profile faces using Haar cascade."""
    if cascade is None:
        return []
    try:
        import cv2
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        rects = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(50, 50))
        return [{"x": x, "y": y, "w": w, "h": h, "confidence": 0.55}
                for (x, y, w, h) in rects]
    except Exception as e:
        print("# Haar detect error: {0}".format(e), file=sys.stderr)
        return []


def merge_faces(yunet_faces, haar_faces):
    """Merge detections, prefer YuNet, dedup by IoU > 0.3."""
    combined = list(yunet_faces)
    for hf in haar_faces:
        dupe = False
        for yf in yunet_faces:
            if compute_iou(hf, yf) > 0.3:
                dupe = True
                break
        if not dupe:
            combined.append(hf)
    return combined


def analyze_video(video_path, models_root, sample_fps, start_seconds=0, duration_seconds=0):
    """Complete face analysis: detect, track, score mouth motion."""
    if not Path(video_path).exists():
        return {"schema_version": SCHEMA_VERSION, "source": "error",
                "fps": sample_fps, "frames": [],
                "error": "video not found: " + video_path}

    yunet_info = ensure_yunet_model(models_root)
    haar_info = ensure_haar_model(models_root)

    try:
        import cv2
        import numpy as np
    except Exception:
        return {"schema_version": SCHEMA_VERSION, "source": "skipped-no-backend",
                "fps": sample_fps, "frames": [], "skipped": True}

    yunet = create_yunet(yunet_info["path"]) if yunet_info.get("ok") else None
    haar = create_haar(haar_info["path"]) if haar_info.get("ok") else None

    if yunet is None and haar is None:
        return {"schema_version": SCHEMA_VERSION, "source": "skipped-no-backend",
                "fps": sample_fps, "frames": [], "skipped": True}

    frames = sample_frames(video_path, sample_fps, start_seconds, duration_seconds)
    if not frames:
        return {"schema_version": SCHEMA_VERSION, "source": "skipped-no-backend",
                "fps": sample_fps, "frames": [], "skipped": True}

    tracker = Tracker()
    prev_gray = None
    out_frames = []

    for idx, (t_ms, frame) in enumerate(frames):
        if frame is None:
            continue
        yf = detect_yunet(yunet, frame)
        hf = detect_haar(haar, frame)
        all_faces = merge_faces(yf, hf)

        cur_gray = None
        try:
            cur_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        except Exception:
            pass

        for f in all_faces:
            mm = compute_mouth_motion(prev_gray, cur_gray, f, frame.shape)
            f["mouth_motion"] = mm if mm > 0 else 0.0

        tracker.step(all_faces, idx)

        faces_out = []
        for f in all_faces:
            t = tracker.get_track_by_face(f, idx)
            track_id = -1
            track_conf = 0.0
            if t is not None:
                track_id = t.track_id
                track_conf = round(t.confidence, 4)
                if f.get("mouth_motion", 0.0) > 0:
                    t.mouth_scores.append(f["mouth_motion"])
            faces_out.append({
                "x": f["x"],
                "y": f["y"],
                "w": f["w"],
                "h": f["h"],
                "confidence": round(f["confidence"], 4),
                "track_id": track_id,
                "track_confidence": track_conf,
                "mouth_motion": round(f["mouth_motion"], 6) if f["mouth_motion"] else None
            })
        out_frames.append({"t_ms": t_ms, "faces": faces_out})
        prev_gray = cur_gray

    return {
        "schema_version": SCHEMA_VERSION,
        "source": "yunet-haar",
        "source_info": {
            "yunet": yunet_info.get("source", "missing"),
            "haar": haar_info.get("source", "missing")
        },
        "fps": sample_fps,
        "frames": out_frames,
        "metadata": {
            "model_license": {
                "yunet": "MIT (OpenCV Zoo)",
                "haar": "Apache-2.0 (OpenCV)"
            },
            "tracking": {
                "algorithm": "IoU + centroid",
                "iou_threshold": TRACK_IOU_THRESHOLD,
                "max_track_age": MAX_TRACK_AGE
            },
            "mouth_motion": {
                "algorithm": "pixel diff + Farneback optical flow"
            },
            "adaptive_sampling": {
                "default_fps": DEFAULT_SAMPLE_FPS,
                "max_fps": MAX_SAMPLE_FPS
            }
        }
    }


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="command", required=True)

    a = sub.add_parser("analyze")
    a.add_argument("--video", required=True)
    a.add_argument("--sample-fps", type=int, default=DEFAULT_SAMPLE_FPS)
    a.add_argument("--models-root", default="models")
    a.add_argument("--start-seconds", type=float, default=0)
    a.add_argument("--duration-seconds", type=float, default=0)

    d = sub.add_parser("yunet-download")
    d.add_argument("--models-root", default="models")

    args = p.parse_args()

    if args.command == "yunet-download":
        # Download BOTH YuNet (MIT) and Haar cascade (Apache-2.0) explicitly.
        yunet = ensure_yunet_model(args.models_root, allow_download=True)
        haar = ensure_haar_model(args.models_root, allow_download=True)
        write_model_metadata(args.models_root)
        print(json.dumps({
            "status": "downloaded" if (yunet["ok"] or haar["ok"]) else "failed",
            "yunet": yunet["source"],
            "haar": haar["source"]
        }, indent=2))
        return

    if args.command == "analyze":
        out = analyze_video(
            args.video, args.models_root,
            args.sample_fps, args.start_seconds,
            args.duration_seconds
        )
        print(json.dumps(out))


if __name__ == "__main__":
    main()
