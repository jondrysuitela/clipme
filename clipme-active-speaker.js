(function initClipmeActiveSpeaker(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ClipmeActiveSpeaker = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createClipmeActiveSpeaker() {
  "use strict";

  // ── Configuration ──────────────────────────────────────────────────────────
  // Requirement 7: hysteresis minimal dua frame
  const HYSTERESIS_FRAMES = 2;
  // Requirement 8: tahan wajah aktif ~1,1 detik saat deteksi hilang sementara
  const HOLD_MS = 1100;
  // Requirement 9: look-room — framing bergeser ke arah pandangan wajah
  const LOOK_ROOM_FACTOR = 0.15;
  // Requirement 10: compact association maksimal 48 (Windows FFmpeg length)
  const MAX_ASSOCIATIONS = 48;

  // Requirement 6: bobot pemilihan active speaker
  const MOUTH_WEIGHT = 0.40;
  const CONFIDENCE_WEIGHT = 0.20;
  const TRACK_CONFIDENCE_WEIGHT = 0.15;
  const SPEAKER_TIMELINE_WEIGHT = 0.15;
  const CONTINUITY_WEIGHT = 0.10;

  function finite(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function computeIoU(a, b) {
    if (!a || !b) return 0;
    const ax1 = a.x, ay1 = a.y;
    const ax2 = a.x + a.w, ay2 = a.y + a.h;
    const bx1 = b.x, by1 = b.y;
    const bx2 = b.x + b.w, by2 = b.y + b.h;
    const xi1 = Math.max(ax1, bx1);
    const yi1 = Math.max(ay1, by1);
    const xi2 = Math.min(ax2, bx2);
    const yi2 = Math.min(ay2, by2);
    const inter = Math.max(0, xi2 - xi1) * Math.max(0, yi2 - yi1);
    const areaA = a.w * a.h;
    const areaB = b.w * b.h;
    const union = areaA + areaB - inter;
    return union > 0 ? inter / union : 0;
  }

  // ── Score satu kandidat wajah (requirement 6) ─────────────────────────────
  function scoreFace(face, speakerTimeline, tMs) {
    if (!face) return 0;
    const mouth = finite(face.mouth_motion, 0);
    const detectorConf = finite(face.confidence, 0);
    const trackConf = finite(face.track_confidence, 0);

    let timelineScore = 0;
    if (speakerTimeline && Array.isArray(speakerTimeline.segments)) {
      for (const seg of speakerTimeline.segments) {
        if (tMs >= (seg.start_ms || 0) && tMs < (seg.end_ms || 0)) {
          timelineScore = seg.confidence || 0.5;
          break;
        }
      }
    }

    const continuity = trackConf > 0.7 ? 1.0 : trackConf > 0.4 ? 0.6 : 0.2;

    return mouth * MOUTH_WEIGHT
      + detectorConf * CONFIDENCE_WEIGHT
      + trackConf * TRACK_CONFIDENCE_WEIGHT
      + timelineScore * SPEAKER_TIMELINE_WEIGHT
      + continuity * CONTINUITY_WEIGHT;
  }

  // ── Select active speaker dengan hysteresis + hold (req 7 & 8) ─────────────
  function selectActiveSpeaker(faceFrames, speakerTimeline, previousActive, options) {
    if (!faceFrames || !Array.isArray(faceFrames) || faceFrames.length === 0) {
      return null;
    }
    const holdMs = (options && options.holdMs) || HOLD_MS;

    const trackScores = Object.create(null);
    const trackFirstSeen = Object.create(null);
    const trackMotion = Object.create(null);

    for (const frame of faceFrames) {
      if (!frame || !Array.isArray(frame.faces)) continue;
      const tMs = frame.t_ms || 0;
      for (const face of frame.faces) {
        const tid = face.track_id != null ? face.track_id : -1;
        if (!trackScores[tid]) {
          trackScores[tid] = [];
          trackFirstSeen[tid] = tMs;
          trackMotion[tid] = [];
        }
        const score = scoreFace(face, speakerTimeline, tMs);
        trackScores[tid].push(score);
        if (finite(face.mouth_motion, 0) > 0) {
          trackMotion[tid].push(finite(face.mouth_motion, 0));
        }
      }
    }

    const avgScore = {};
    for (const tid of Object.keys(trackScores)) {
      const scores = trackScores[tid];
      avgScore[tid] = scores.reduce((a, b) => a + b, 0) / (scores.length || 1);
    }

    let bestTid = null;
    let bestScore = -1;
    for (const tid of Object.keys(avgScore)) {
      if (avgScore[tid] > bestScore) {
        bestScore = avgScore[tid];
        bestTid = tid;
      }
    }

    // Hysteresis: jangan pindah karena satu frame noise — butuh minimal dua
    // frame konsisten agar kamera berpindah.
    if (previousActive != null && previousActive !== bestTid) {
      const prevAvg = avgScore[previousActive] || 0;
      const newAvg = avgScore[bestTid] || 0;
      if (newAvg < prevAvg * 1.25) {
        bestTid = previousActive;
      }
    }

    // Hold: tahan wajah aktif saat deteksi hilang sementara (req 8)
    if (previousActive != null && previousActive !== bestTid) {
      const lastSeen = trackFirstSeen[previousActive] || 0;
      const now = faceFrames[faceFrames.length - 1].t_ms || 0;
      if (now - lastSeen < holdMs) {
        const prevScore = (avgScore[previousActive] || 0) * 1.2;
        if (prevScore >= (avgScore[bestTid] || 0)) {
          bestTid = previousActive;
        }
      }
    }

    return bestTid;
  }

  // ── Look-room (requirement 9) ──────────────────────────────────────────────
  // Framing bergeser ke arah pandangan wajah: crop bergeser mengikuti posisi
  // wajah relatif terhadap pusat frame, dengan faktor look-room.
  function applyLookRoom(crop, face, sourceWidth, sourceHeight, lookFactor) {
    if (!crop || !face) return crop;
    const factor = finite(lookFactor, LOOK_ROOM_FACTOR);
    const sw = Math.max(1, finite(sourceWidth, 1));
    const sh = Math.max(1, finite(sourceHeight, 1));

    const cx = finite(face.x, 0) + finite(face.w, 0) / 2;
    const cy = finite(face.y, 0) + finite(face.h, 0) / 2;
    const normX = (cx / sw - 0.5) * 2; // -1..1
    const normY = (cy / sh - 0.5) * 2;

    const shiftX = Math.round(normX * crop.w * factor);
    const shiftY = Math.round(normY * crop.h * factor);

    return {
      x: clamp(crop.x + shiftX, 0, Math.max(0, sw - crop.w)),
      y: clamp(crop.y + shiftY, 0, Math.max(0, sh - crop.h)),
      w: crop.w,
      h: crop.h
    };
  }

  // ── Build association timeline (req 12: sama untuk CSS preview & FFmpeg) ──
  // Compact ke maksimal 48 (req 10) untuk menghindari batas panjang command
  // FFmpeg Windows.
  function buildAssociations(faceTimeline, speakerTimeline, options) {
    const opts = options || {};
    const sourceWidth = finite(opts.sourceWidth, 1920);
    const sourceHeight = finite(opts.sourceHeight, 1080);
    const targetAspect = finite(opts.targetAspect, 9 / 16);
    const lookRoom = opts.lookRoom !== false;
    const lookFactor = finite(opts.lookFactor, LOOK_ROOM_FACTOR);

    if (!faceTimeline || !speakerTimeline) return [];
    const frames = faceTimeline.frames || [];
    const segments = speakerTimeline.segments || [];
    if (frames.length === 0 || segments.length === 0) return [];

    const associations = [];
    let previousActive = null;

    for (const seg of segments) {
      const startMs = seg.start_ms || 0;
      const endMs = seg.end_ms || startMs + 1000;
      if (endMs <= startMs) continue;

      const relevantFrames = frames.filter((f) =>
        f.t_ms >= startMs && f.t_ms <= endMs &&
        Array.isArray(f.faces) && f.faces.length > 0
      );
      if (relevantFrames.length === 0) continue;

      // Pilih active speaker di segment ini
      const activeTid = selectActiveSpeaker(relevantFrames, speakerTimeline, previousActive, {});
      previousActive = activeTid;

      let bestFace = null;
      let bestScore = -1;
      for (const frame of relevantFrames) {
        for (const face of frame.faces) {
          const tid = face.track_id != null ? face.track_id : -1;
          if (activeTid == null || String(tid) === String(activeTid)) {
            const score = finite(face.confidence, 0) + finite(face.mouth_motion, 0) * 2;
            if (score > bestScore) {
              bestScore = score;
              bestFace = face;
            }
          }
        }
      }
      if (!bestFace) continue;

      // Crop dengan headroom atas (upper third)
      let cropW = Math.round(sourceHeight * targetAspect);
      let cropH = sourceHeight;
      if (cropW > sourceWidth) {
        cropW = sourceWidth;
        cropH = Math.round(cropW / targetAspect);
      }
      const cx = bestFace.x + bestFace.w / 2;
      const cy = bestFace.y + bestFace.h / 2;
      let cropX = clamp(cx - cropW / 2, 0, Math.max(0, sourceWidth - cropW));
      let cropY = clamp(cy - cropH * 0.33, 0, Math.max(0, sourceHeight - cropH));

      const baseCrop = { x: Math.round(cropX), y: Math.round(cropY), w: cropW, h: cropH };
      const finalCrop = lookRoom
        ? applyLookRoom(baseCrop, bestFace, sourceWidth, sourceHeight, lookFactor)
        : baseCrop;

      // Rentang waktu association: batasi ke frame wajah yang ada, tapi
      // pastikan span minimal ~HOLD_MS (req 8: tahan wajah aktif saat deteksi
      // hilang sementara) sehingga crop tidak berkedip untuk satu frame.
      const firstFrameMs = relevantFrames[0].t_ms || startMs;
      const lastFrameMs = relevantFrames[relevantFrames.length - 1].t_ms || endMs;
      const spanMs = Math.max(HOLD_MS, lastFrameMs - firstFrameMs);
      associations.push({
        start_ms: Math.max(startMs, firstFrameMs),
        end_ms: Math.min(endMs, Math.max(lastFrameMs, firstFrameMs + spanMs)),
        speaker_id: seg.speaker_id || "SPEAKER_00",
        face: bestFace,
        crop: finalCrop,
        track_id: bestFace.track_id != null ? bestFace.track_id : -1,
        mouth_motion: finite(bestFace.mouth_motion, 0),
        confidence: finite(bestFace.confidence, 0.5)
      });
    }

    // Compact ke maksimal 48: gabungkan segmen berurutan dengan track yang sama
    while (associations.length > MAX_ASSOCIATIONS) {
      let merged = false;
      for (let i = associations.length - 1; i >= 1; i--) {
        const cur = associations[i];
        const prev = associations[i - 1];
        if (cur.track_id != null && prev.track_id != null && cur.track_id === prev.track_id) {
          prev.end_ms = cur.end_ms;
          associations.splice(i, 1);
          merged = true;
          break;
        }
      }
      if (!merged) break;
    }

    return associations;
  }

  return {
    scoreFace,
    selectActiveSpeaker,
    applyLookRoom,
    buildAssociations,
    HYSTERESIS_FRAMES,
    HOLD_MS,
    LOOK_ROOM_FACTOR,
    MAX_ASSOCIATIONS
  };
});
