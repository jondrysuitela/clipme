(function initClipmeCutToFace(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ClipmeCutToFace = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createClipmeCutToFace() {
  "use strict";

  const RATIO_VALUES = Object.freeze({
    portrait: 9 / 16,
    wide: 16 / 9,
    four5: 4 / 5
  });

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function ratioValue(token) {
    return RATIO_VALUES[token] || RATIO_VALUES.portrait;
  }

  function centerCrop(sourceWidth, sourceHeight, targetAspect) {
    const sourceW = Math.max(1, finite(sourceWidth, 1));
    const sourceH = Math.max(1, finite(sourceHeight, 1));
    const aspect = finite(targetAspect, RATIO_VALUES.portrait) > 0
      ? finite(targetAspect, RATIO_VALUES.portrait)
      : RATIO_VALUES.portrait;

    let h = sourceH;
    let w = h * aspect;
    if (w > sourceW) {
      w = sourceW;
      h = w / aspect;
    }

    return {
      x: (sourceW - w) / 2,
      y: (sourceH - h) / 2,
      w,
      h
    };
  }

  function smartCrop(face, sourceWidth, sourceHeight, targetAspect) {
    if (!face || typeof face !== "object") return centerCrop(sourceWidth, sourceHeight, targetAspect);

    const sourceW = Math.max(1, finite(sourceWidth, 1));
    const sourceH = Math.max(1, finite(sourceHeight, 1));
    const base = centerCrop(sourceW, sourceH, targetAspect);
    const faceW = Math.max(0, finite(face.w));
    const faceH = Math.max(0, finite(face.h));
    if (!faceW || !faceH) return base;

    const cx = clamp(finite(face.x) + faceW / 2, 0, sourceW);
    const cy = clamp(finite(face.y) + faceH / 2, 0, sourceH);
    const x = clamp(cx - base.w / 2, 0, Math.max(0, sourceW - base.w));
    // Keep the face around the upper third, matching the FFmpeg smart framing.
    const y = clamp(cy - base.h * 0.33, 0, Math.max(0, sourceH - base.h));

    return { x, y, w: base.w, h: base.h, cx, cy };
  }

  function validCrop(crop, sourceWidth, sourceHeight) {
    if (!crop || typeof crop !== "object") return null;
    const sourceW = Math.max(1, finite(sourceWidth, 1));
    const sourceH = Math.max(1, finite(sourceHeight, 1));
    const w = clamp(finite(crop.w), 1, sourceW);
    const h = clamp(finite(crop.h), 1, sourceH);
    if (!finite(crop.w) || !finite(crop.h)) return null;
    return {
      x: clamp(finite(crop.x), 0, Math.max(0, sourceW - w)),
      y: clamp(finite(crop.y), 0, Math.max(0, sourceH - h)),
      w,
      h
    };
  }

  function prepareAssociations(associations, sourceWidth, sourceHeight, targetAspect) {
    return (Array.isArray(associations) ? associations : [])
      .map((association, index) => {
        const startMs = Math.max(0, finite(association && association.start_ms));
        const endMs = Math.max(startMs, finite(association && association.end_ms));
        if (endMs <= startMs) return null;
        const providedCrop = validCrop(association.crop, sourceWidth, sourceHeight);
        const aspect = finite(targetAspect, RATIO_VALUES.portrait);
        const providedMatchesAspect = providedCrop
          && Math.abs((providedCrop.w / providedCrop.h) - aspect) < 0.005;
        const crop = providedMatchesAspect
          ? providedCrop
          : association.face
            ? smartCrop(association.face, sourceWidth, sourceHeight, aspect)
            : providedCrop;
        if (!crop) return null;
        return {
          ...association,
          _index: index,
          start_ms: startMs,
          end_ms: endMs,
          crop
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms);
  }

  function findActiveAssociation(associations, timeMs) {
    const timeline = Array.isArray(associations) ? associations : [];
    const now = Math.max(0, finite(timeMs));
    return timeline.find((association) => now >= association.start_ms && now < association.end_ms) || null;
  }

  // The video element occupies the complete preview frame and uses object-fit:
  // fill while Cut-to-Face is active. This matrix remaps the selected source
  // crop back onto that frame. Because crop aspect === frame aspect, the final
  // visible pixels keep their original proportions even though scaleX/scaleY
  // are expressed in the element's normalized coordinate system.
  function cropTransform(crop, sourceWidth, sourceHeight, frameWidth, frameHeight) {
    const sourceW = Math.max(1, finite(sourceWidth, 1));
    const sourceH = Math.max(1, finite(sourceHeight, 1));
    const frameW = Math.max(1, finite(frameWidth, 1));
    const frameH = Math.max(1, finite(frameHeight, 1));
    const safeCrop = validCrop(crop, sourceW, sourceH)
      || centerCrop(sourceW, sourceH, frameW / frameH);

    const scaleX = sourceW / safeCrop.w;
    const scaleY = sourceH / safeCrop.h;
    const translateX = -(safeCrop.x * frameW / safeCrop.w);
    const translateY = -(safeCrop.y * frameH / safeCrop.h);
    const round = (value) => Math.round(value * 100000) / 100000;
    const values = [scaleX, scaleY, translateX, translateY].map(round);

    return {
      scaleX: values[0],
      scaleY: values[1],
      translateX: values[2],
      translateY: values[3],
      css: `matrix(${values[0]}, 0, 0, ${values[1]}, ${values[2]}, ${values[3]})`,
      crop: safeCrop
    };
  }

  return {
    RATIO_VALUES,
    ratioValue,
    centerCrop,
    smartCrop,
    prepareAssociations,
    findActiveAssociation,
    cropTransform
  };
});
