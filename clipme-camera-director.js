// clipme-camera-director.js — AI Camera Path Generator
// Input: per-frame subject detections [{t,x,y,w,h,confidence,type}]
// Output: smoothed cameraPath [{t,x,y,w,h,zoom}] siap dipakai preview & export.
// Pendekatan: EMA smoothing + dead zone + max speed limiter + scene boundary reset.
// TANPA dependency ML — murni mathematical filtering.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ClipmeCameraDirector = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const DEFAULT = {
    alpha: 0.18,          // EMA smoothing factor (0.06=very smooth, 0.35=responsive)
    deadZone: 0.03,       // position change <= deadZone → no camera move (normalized 0-1)
    maxSpeed: 0.6,        // max position change per second (normalized units/sec)
    sceneThreshold: 0.12, // subject position jump > threshold treated as scene change → snap reset
    minConfidence: 0.35,
    safeMargin: 0.08,
    zoomMin: 0.85,
    zoomMax: 1.15,
    zoomAlpha: 0.12,
    zoomDeadZone: 0.01
  };

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // EMA (exponential moving average) smooth: prev + alpha * (target - prev)
  function emaSmooth(prev, target, alpha) { return prev + alpha * (target - prev); }

  // Smooth camera path dari raw detections.
  // detections: [{t, x, y, w, h, confidence?, type?}]
  // opts: override DEFAULT
  function generatePath(detections, sourceMeta, targetMeta, opts = {}) {
    const o = { ...DEFAULT, ...opts };
    if (!Array.isArray(detections) || !detections.length) return [];
    const sorted = [...detections].sort((a, b) => Number(a.t) - Number(b.t));
    const path = [];
    let camX = null, camY = null, camW = null, camH = null, camZoom = 1;
    let lastSceneT = null;

    for (const det of sorted) {
      const t = Number(det.t) || 0;
      const conf = Number(det.confidence) || 0;
      // Skip low-confidence frames (noise) — retain previous position.
      if (conf < o.minConfidence && camX !== null) {
        path.push({ t, x: camX, y: camY, w: camW, h: camH, zoom: camZoom });
        continue;
      }

      // Target crop window: normalize subject center → crop window.
      const subjectCX = (Number(det.x) || 0.5) + (Number(det.w) || 0.18) / 2;
      const subjectCY = (Number(det.y) || 0.5) + (Number(det.h) || 0.25) / 2;
      // Tentukan ukuran crop berdasarkan target aspect.
      let cropW, cropH;
      if (targetMeta && targetMeta.width && targetMeta.height) {
        const targetAspect = targetMeta.width / targetMeta.height;
        if (targetAspect >= 1) { cropH = 0.9; cropW = cropH * targetAspect; }
        else { cropW = 0.9; cropH = cropW / targetAspect; }
      } else {
        cropW = 0.45; cropH = 0.8;
      }
      cropW = clamp(cropW, 0.15, 0.98);
      cropH = clamp(cropH, 0.15, 0.98);
      // Target camera center = subject center, clamped to safe margins.
      const safeL = o.safeMargin + cropW / 2;
      const safeR = 1 - o.safeMargin - cropW / 2;
      const safeT = o.safeMargin + cropH / 2;
      const safeB = 1 - o.safeMargin - cropH / 2;
      const targetX = clamp(subjectCX, safeL, safeR);
      const targetY = clamp(subjectCY, safeT, safeB);
      const targetZoom = clamp(1 / Math.max(cropW, cropH), o.zoomMin, o.zoomMax);

      // Scene boundary detection: large jump after low-confidence gap = reset.
      const isSceneBreak = lastSceneT !== null
        && (t - lastSceneT > 2.0 || (camX !== null && Math.hypot(targetX - camX, targetY - camY) > o.sceneThreshold));

      if (camX === null || isSceneBreak) {
        // Snap to target (no smoothing on first frame or scene break).
        camX = targetX; camY = targetY; camW = cropW; camH = cropH; camZoom = targetZoom;
        lastSceneT = t;
      } else {
        // Dead zone check: skip small movements.
        const dist = Math.hypot(targetX - camX, targetY - camY);
        const dt = path.length ? Math.max(0.001, t - path[path.length - 1].t) : 1;
        const speed = dist / dt;
        if (dist > o.deadZone) {
          // Clamp speed.
          const effAlpha = Math.min(1, (speed > o.maxSpeed ? o.alpha * (o.maxSpeed / speed) : o.alpha));
          camX = emaSmooth(camX, targetX, effAlpha);
          camY = emaSmooth(camY, targetY, effAlpha);
          camW = emaSmooth(camW, cropW, effAlpha);
          camH = emaSmooth(camH, cropH, effAlpha);
          camZoom = emaSmooth(camZoom, targetZoom, o.zoomAlpha);
        }
        // Else: position within dead zone, keep current camera.
      }
      camW = clamp(camW, 0.15, 0.98);
      camH = clamp(camH, 0.15, 0.98);
      camZoom = clamp(camZoom, o.zoomMin, o.zoomMax);
      path.push({ t, x: camX, y: camY, w: camW, h: camH, zoom: camZoom });
    }
    return path;
  }

  // Interpolasi camera path ke waktu tertentu (linear).
  function sampleAt(cameraPath, time) {
    if (!cameraPath.length) return null;
    if (time <= cameraPath[0].t) return cameraPath[0];
    if (time >= cameraPath[cameraPath.length - 1].t) return cameraPath[cameraPath.length - 1];
    for (let i = 0; i < cameraPath.length - 1; i++) {
      const a = cameraPath[i], b = cameraPath[i + 1];
      if (time >= a.t && time <= b.t) {
        const frac = b.t === a.t ? 0 : (time - a.t) / (b.t - a.t);
        return {
          t: time,
          x: a.x + (b.x - a.x) * frac,
          y: a.y + (b.y - a.y) * frac,
          w: a.w + (b.w - a.w) * frac,
          h: a.h + (b.h - a.h) * frac,
          zoom: a.zoom + (b.zoom - a.zoom) * frac
        };
      }
    }
    return cameraPath[cameraPath.length - 1];
  }

  // Build FFmpeg crop filter string dari camera path sample.
  function cropFilter(sample, srcW, srcH, targetW, targetH) {
    if (!sample) return `crop=${targetW}:${targetH}:(iw-${targetW})/2:(ih-${targetH})/2`;
    const cw = clamp(Math.round(sample.w * srcW), 32, srcW);
    const ch = clamp(Math.round(sample.h * srcH), 32, srcH);
    const cx = clamp(Math.round((sample.x - sample.w / 2) * srcW), 0, srcW - cw);
    const cy = clamp(Math.round((sample.y - sample.h / 2) * srcH), 0, srcH - ch);
    return `crop=${cw}:${ch}:${cx}:${cy}`;
  }

  // Build smooth zoom expression.
  function zoomFilter(sample) {
    if (!sample || Math.abs(sample.zoom - 1) < 0.01) return "";
    return `zoompan=z=${sample.zoom.toFixed(3)}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${Math.round(1920 * sample.zoom)}x${Math.round(1080 * sample.zoom)}:fps=30`;
  }

  // Full analysis pipeline: detections → cameraPath + filter-per-frame.
  function analyze(detections, sourceMeta, targetMeta, opts = {}) {
    const path = generatePath(detections, sourceMeta, targetMeta, opts);
    const srcW = sourceMeta?.width || 1920;
    const srcH = sourceMeta?.height || 1080;
    const targetW = targetMeta?.width || 1080;
    const targetH = targetMeta?.height || 1920;
    const segments = [];
    if (path.length) {
      let cur = path[0];
      segments.push({ t: cur.t, filter: cropFilter(cur, srcW, srcH, targetW, targetH) });
      for (let i = 1; i < path.length; i++) {
        const p = path[i];
        const a = segments[segments.length - 1];
        if (Math.hypot(p.x - cur.x, p.y - cur.y) > 0.005 || Math.abs(p.w - cur.w) > 0.003) {
          segments.push({ t: p.t, filter: cropFilter(p, srcW, srcH, targetW, targetH) });
          cur = p;
        }
      }
    }
    return { path, segments, confidence: calcConfidence(path, detections), fallbackUsed: !path.length };
  }

  function calcConfidence(path, detections) {
    if (!path.length) return 0;
    const avgConf = detections.reduce((s, d) => s + (Number(d.confidence) || 0), 0) / Math.max(detections.length, 1);
    const smoothness = 1 - Math.min(1, path.reduce((s, p, i) => {
      if (!i) return 0;
      return s + Math.hypot(p.x - path[i - 1].x, p.y - path[i - 1].y);
    }, 0) / Math.max(path.length, 1) * 10);
    return clamp(Math.round((avgConf * 0.6 + smoothness * 0.4) * 100), 0, 100);
  }

  return { DEFAULT, generatePath, sampleAt, cropFilter, zoomFilter, analyze };
});
