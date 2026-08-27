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

  // ---- LAYOUT ENGINE (Wayin-style multi-subject composition) ----
  // Layout untuk bingkai: group mana yang "relevan" (conf ≥ minConfidence &
  // ukuran cukup), lalu pilih layout sesuai jumlah & sebaran.
  function layoutsForRatio(ratio) {
    const base = ["AUTO", "FULL", "SPLIT_2", "PIP", "SCREEN_FIRST"];
    if (ratio === "square") return ["AUTO", "FULL", "SPLIT_2", "GRID_4"];
    if (ratio === "four5") return ["AUTO", "FULL", "SPLIT_2", "PIP"];
    return base; // 9:16 & 16:9
  }

  // subjects: [{x,y,w,h,confidence,t}] — pilih layout untuk momen ini.
  function layoutDecision(subjects, opts = {}) {
    const o = { ...DEFAULT, ...opts };
    const relevant = (Array.isArray(subjects) ? subjects : [])
      .filter((s) => (Number(s.confidence) || 0) >= o.minConfidence)
      .sort((a, b) => Number(b.confidence) - Number(a.confidence));
    if (!relevant.length) return { layout: "FULL", subjects: [], reason: "none-detected" };

    // Jarak antar 2 subjek paling relevan (normalized).
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    if (relevant.length === 1) return { layout: "SINGLE", subjects: [relevant[0]], reason: "single-subject" };

    const pair = dist(relevant[0], relevant[1]);
    const bothSmall = relevant.slice(0, 2).every((s) => (Number(s.w) * Number(s.h)) < 0.08);
    if (relevant.length >= 4) {
      return { layout: "GRID_4", subjects: relevant.slice(0, 4), reason: "four-or-more-subjects", pairDistance: pair };
    }
    if (relevant.length === 3) {
      return pair > 0.3 && bothSmall ? { layout: "GRID_4", subjects: relevant.slice(0, 3), reason: "trio-spread" }
        : { layout: "SPLIT_2", subjects: relevant.slice(0, 2), reason: "trio-compact" };
    }
    if (pair > 0.34) {
      return { layout: "SPLIT_2", subjects: relevant.slice(0, 2), reason: "two-distant" };
    }
    // Dua subjek dekat = pinggir layar (presenter + konten) atau grup.
    return { layout: "PIP", subjects: relevant.slice(0, 2), reason: "close-pair", pairDistance: pair };
  }

  // Jendela crop STABIL per scene: hitung dari subjek (normalized, dalam sumber).
  // window: {x,y,w,h} dengan penjagaan safeMargin. return [w1, w2, ...] sesuai layout.
  function layoutWindows(layout, subjects, opts = {}) {
    const o = { ...DEFAULT, ...opts };
    const safe = o.safeMargin;
    const n = subjects.length;
    const w = (s, pad = 0.06) => Math.min(0.95, Math.max(0.14, (Number(s.w) || 0.2) + pad));
    const boundsCenter = (s) => ({
      cx: clamp((Number(s.x) || 0.5) + (Number(s.w) || 0.2) / 2, 0.02, 0.98),
      cy: clamp((Number(s.y) || 0.5) + (Number(s.h) || 0.3) / 2, 0.02, 0.98)
    });

    if (layout === "FULL" || !n) return [{ x: safe + 0.1, y: safe, w: 0.8, h: 0.9 }];
    if (layout === "SINGLE" || n === 1) {
      const c = boundsCenter(subjects[0]);
      const cw = w(subjects[0]);
      const ch = Math.min(0.9, cw * (16 / 9));
      return [{ x: clamp(c.cx - cw / 2, safe, 1 - safe - cw), y: clamp(c.cy - ch / 2, safe, 1 - safe - ch), w: cw, h: ch }];
    }
    if (layout === "SPLIT_2") {
      const c1 = boundsCenter(subjects[0]);
      const c2 = boundsCenter(subjects[1]);
      const half = (1 - 2 * safe) / 2; // dua kolom utuh + margin, tidak overflow
      const wk = half, hk = Math.min(0.7, half * (16 / 9));
      return [
        { x: clamp(c1.cx - wk / 2, safe, safe + half - wk), y: clamp(c1.cy - hk / 2, safe, 1 - safe - hk), w: wk, h: hk },
        { x: clamp(c2.cx - wk / 2, 1 - safe - half, 1 - safe - wk), y: clamp(c2.cy - hk / 2, safe, 1 - safe - hk), w: wk, h: hk }
      ];
    }
    if (layout === "PIP") {
      const main = boundsCenter(subjects[0]);
      const mainW = Math.max(0.62, 1 - 2 * safe);
      const mainH = Math.min(0.85, mainW * (16 / 9));
      return [
        { x: clamp(main.cx - mainW / 2, safe, 1 - safe - mainW), y: clamp(main.cy - mainH / 2, safe, 1 - safe - mainH), w: mainW, h: mainH },
        { x: 1 - safe - 0.26, y: safe, w: 0.26, h: 0.19 } // pip kecil pojok kanan atas
      ];
    }
    if (layout === "GRID_4") {
      const half = 0.5 - safe * 0.5;
      const cells = [
        { x: safe, y: safe }, { x: safe + half, y: safe },
        { x: safe, y: safe + half }, { x: safe + half, y: safe + half }
      ];
      return cells.slice(0, Math.min(4, n)).map((c, i) => {
        const s = subjects[i] || { x: 0.5, y: 0.5, w: 0.3, h: 0.4, confidence: 1 };
        const cxy = boundsCenter(s);
        const dx = clamp(cxy.cx - (c.x + half / 2), -half * 0.25, half * 0.25);
        const dy = clamp(cxy.cy - (c.y + half / 2), -half * 0.25, half * 0.25);
        return { x: c.x + dx, y: c.y + dy, w: half, h: half };
      });
    }
    return [{ x: safe, y: safe, w: 1 - 2 * safe, h: 1 - 2 * safe }];
  }

  return { DEFAULT, generatePath, sampleAt, cropFilter, zoomFilter, analyze, layoutDecision, layoutWindows, layoutsForRatio };
});
