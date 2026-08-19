// ============================================================================
// CLIPME VIRAL DURATION ENGINE
// ----------------------------------------------------------------------------
// HOOK + STORY STRUCTURE + PAYOFF + OPTIMAL DURATION menjadi satu keputusan.
//
// Prinsip:
//   - MAX LENGTH = CEILING (bukan target). "Max 90s" ≠ "buat semua 90s".
//   - CONTENT DETERMINES DURATION, bukan sebaliknya.
//   - Durasi mengikuti: hook → required context → development → payoff →
//     natural ending → remove redundancy.
//   - Tidak pernah memotong speaker di tengah kalimat (segmen = batas alami).
//   - "Viral Duration" = estimasi editorial (retention potential), BUKAN
//     janji viral.
//
// API utama:
//   analyzeDuration(moments, chosen, opts) -> { minViable, optimal,
//     maxUseful, recommended, payoff, retention, efficiency, ending, ... }
//   rankCandidates(moments, lang, opts) -> [{moment, duration, score}]
// ============================================================================
const HE = require("./clipme-hook-engine.js");

const wordsOf = HE.helpers.wordsOf;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// ---------------------------------------------------------------------------
// UTIL — role & sinyal editorial
// ---------------------------------------------------------------------------
const STRONG_ENDING_SIGNALS = [
  /(pelajaran|pelajarannya|kesimpulannya|kuncinya|intinya|pesannya|jawabannya|akhirnya|sejak itu|sejak saat itu|sekarang saya|i learned|the lesson|the takeaway|in the end|that's why|the answer|so the lesson)/i
];

function isStrongEnding(m) {
  if (!m) return false;
  const roles = m.roles || [];
  if (roles.some((r) => ["LESSON", "PAYOFF", "CONSEQUENCE", "TRANSFORMATION", "ANSWER"].includes(r))) return true;
  return STRONG_ENDING_SIGNALS.some((re) => re.test(m.text || ""));
}

// Redundan: kepadatan rendah, tidak ada peran naratif, atau mirip dengan
// kalimat sebelum payoff (pengulangan kesimpulan).
function isRedundant(m, prev) {
  if (!m || m.filler) return true;
  if (m.infoDensity != null && m.infoDensity < 0.12) return true;
  const roles = m.roles || [];
  if (roles.includes("CONTEXT") && (m.infoDensity || 0) < 0.25) return true;
  if (prev && wordsOf(prev.text).length && wordsOf(m.text).length) {
    const shared = wordsOf(m.text).filter((w) => wordsOf(prev.text).includes(w)).length;
    const p = shared / Math.min(wordsOf(m.text).length, wordsOf(prev.text).length);
    if (p >= 0.75 && m.momentScore != null && prev.momentScore != null && m.momentScore < prev.momentScore - 5) return true;
  }
  return false;
}

function isWeakEnding(m) {
  if (!m) return true;
  if (m.filler) return true;
  if (m.openLoop) return true;
  return false;
}

// ---------------------------------------------------------------------------
// PAYOFF QUALITY — apakah payoff benar-benar menyelesaikan hook.
// ---------------------------------------------------------------------------
function payoffQuality(hook, payoff) {
  if (!payoff) return 0;
  const pText = String(payoff.text || "").toLowerCase();
  let quality = 55;
  if (/^(karena|because|jawabannya|alasannya|ternyata|the reason|the answer|turns out|that's why|it was|kuncinya)/.test(pText)) quality += 20;
  if (/(pelajaran|lesson|sejak|akhirnya|in the end|from now|sekarang)/i.test(pText)) quality += 10;
  if (/^dan|^and|^itu|^jadi|^so|^yang|^yang mana|^ya|^okay/.test(pText)) quality -= 15;
  const hookT = String(hook ? hook.text : "").toLowerCase();
  const hookWords = wordsOf(hookT);
  if (hookWords.length && wordsOf(pText).some((w) => hookWords.includes(w))) quality += 5;
  return Math.max(0, Math.min(100, quality));
}

// ---------------------------------------------------------------------------
// MAIN — analyzeDuration
// ---------------------------------------------------------------------------
// moments: array dari opening engine (punya start/end/index/roles/filler/
//          infoDensity/momentScore/contextDependency/openLoop/payoff/storyRole).
//          Timestamp RELATIF terhadap awal clip (boleh 0-offset).
// chosen : momen hook yang dipilih (salah satu dari moments).
// opts   : { maxAllowed, mode, fixedDuration }
function analyzeDuration(moments, chosen, opts) {
  opts = opts || {};
  const maxAllowed = Math.max(10, Number(opts.maxAllowed) || 90);
  const mode = String(opts.mode || "AUTO").toUpperCase();
  const fixed = Number(opts.fixedDuration) > 0 ? Number(opts.fixedDuration) : 0;

  const hook = chosen || moments[0];
  if (!hook) {
    return emptyDuration(maxAllowed);
  }

  const after = moments.filter((m) => m.index > hook.index);
  const payoff = hook.payoff || null;
  const hookDuration = Math.max(1.5, hook.end - hook.start);

  // ---- MINIMUM VIABLE STORY: hook + required context + payoff ----
  let minViable = hookDuration;
  if (payoff) {
    minViable = Math.max(minViable, payoff.end - hook.start);
  } else {
    // Tanpa payoff: butuh minimal hook + 1-2 kalimat konteks berikutnya.
    const need = after.filter((m) => !m.filler).slice(0, 2);
    if (need.length) minViable = Math.max(minViable, need[need.length - 1].end - hook.start);
  }

  // ---- OPTIMAL: hook → payoff → natural ending (tanpa redundansi) ----
  let optimal = minViable;
  let endIndex = hook.index;
  let lastStrong = null;
  if (payoff) {
    optimal = Math.max(optimal, payoff.end - hook.start);
    endIndex = payoff.index;
  }
  let stoppedRedundant = false;
  for (const m of after) {
    if (m.index <= endIndex) continue;
    const rel = m.end - hook.start;
    if (rel > maxAllowed) break;
    if (isStrongEnding(m)) {
      optimal = Math.max(optimal, rel);
      endIndex = m.index;
      lastStrong = m;
      continue;
    }
    if (isRedundant(m, moments[endIndex])) {
      stoppedRedundant = true;
      break;
    }
    // Development biasa: tetap dihitung bila masih bernilai.
    if (m.infoDensity != null && m.infoDensity >= 0.18) {
      optimal = Math.max(optimal, rel);
      endIndex = m.index;
    }
  }
  // Ending yang lemah (filler / open loop) TIDAK boleh jadi ujung.
  const weakEnd = moments.find((m) => m.index === endIndex);
  if (isWeakEnding(weakEnd) && lastStrong) {
    optimal = Math.max(minViable, lastStrong.end - hook.start);
    endIndex = lastStrong.index;
  }

  // ---- MAXIMUM USEFUL: perluas selama bernilai, sebelum drop retensi ----
  let maxUseful = optimal;
  for (const m of after) {
    if (m.index <= endIndex) continue;
    const rel = m.end - hook.start;
    if (rel > maxAllowed) break;
    if (isRedundant(m, moments[endIndex])) break;
    if (m.infoDensity != null && m.infoDensity >= 0.14) {
      maxUseful = Math.max(maxUseful, rel);
      endIndex = m.index;
    }
  }
  maxUseful = clamp(maxUseful, optimal, maxAllowed);

  // ---- RECOMMENDED by MODE ----
  let recommended;
  if (mode === "FIXED" && fixed > 0) {
    recommended = Math.max(minViable, Math.min(fixed, maxAllowed));
  } else if (mode === "SHORT") {
    recommended = Math.max(minViable, optimal - Math.max(2, (optimal - minViable) * 0.35));
  } else if (mode === "STORY" || mode === "MAXIMUM") {
    recommended = maxUseful;
  } else {
    recommended = optimal;
  }
  recommended = clamp(recommended, minViable, maxAllowed);

  // ---- Snap ke batas kalimat terdekat di bawah/tepat recommended ----
  const boundaries = moments
    .filter((m) => !m.filler && m.index >= hook.index)
    .map((m) => m.end - hook.start)
    .filter((b) => b >= minViable && b <= recommended)
    .sort((a, b) => b - a);
  if (boundaries.length) recommended = boundaries[0];

  // ---- Hitung ulang endIndex/endM dari recommended yang sudah di-snap ----
  let endM = hook;
  for (const m of moments) {
    if (m.index < hook.index) continue;
    if (m.end - hook.start <= recommended + 0.001) {
      endIndex = m.index;
      endM = m;
    }
  }

  // ---- SKOR ----
  const payoffDist = payoff ? Math.max(0, payoff.start - hook.start) : null;
  const storyCompleteness = scoreStoryCompleteness(hook, payoff, after, recommended, minViable);
  const endingQuality = scoreEndingQuality(endM, moments, recommended);
  const durationEfficiency = scoreDurationEfficiency(moments, hook, recommended, stoppedRedundant);
  const retentionPotential = scoreRetention(hook, payoff, payoffDist, moments, recommended, endingQuality);
  const payQuality = payoffQuality(hook, payoff);

  const reason = naturalCutReason(hook, payoff, recommended, endM, moments, mode);

  return {
    minimumViableDuration: Math.round(minViable * 10) / 10,
    optimalDuration: Math.round(optimal * 10) / 10,
    maximumUsefulDuration: Math.round(maxUseful * 10) / 10,
    recommendedDuration: Math.round(recommended * 10) / 10,
    maximumAllowedDuration: maxAllowed,
    mode,
    payoffTimestamp: payoff != null ? Math.round(payoff.start * 10) / 10 : null,
    payoffDistance: payoffDist != null ? Math.round(payoffDist * 10) / 10 : null,
    payoffQuality: Math.round(payQuality),
    endIndex,
    storyCompleteness: Math.round(storyCompleteness),
    retentionPotential: Math.round(retentionPotential),
    durationEfficiency: Math.round(durationEfficiency),
    endingQuality: Math.round(endingQuality),
    naturalCutReason: reason
  };
}

function emptyDuration(maxAllowed) {
  // Tanpa hook valid: berikan floor 3 detik agar nilai API selalu konsisten
  // (fallback aman, tidak pernah 0/negatif yang membingungkan UI).
  const floor = Math.min(3, maxAllowed);
  return {
    minimumViableDuration: floor,
    optimalDuration: floor,
    maximumUsefulDuration: floor,
    recommendedDuration: floor,
    maximumAllowedDuration: maxAllowed,
    mode: "AUTO",
    payoffTimestamp: null,
    payoffDistance: null,
    payoffQuality: 0,
    endIndex: -1,
    storyCompleteness: 0,
    retentionPotential: 0,
    durationEfficiency: 0,
    endingQuality: 0,
    naturalCutReason: "Tidak ada momen hook yang valid."
  };
}

// ---------------------------------------------------------------------------
// SKOR EDITORIAL
// ---------------------------------------------------------------------------
function scoreStoryCompleteness(hook, payoff, after, recommended, minViable) {
  let s = 30; // ada hook
  if (payoff) s += 25;
  else s += 5;
  const between = after.filter((m) => m.index < (payoff ? payoff.index : Infinity) && !m.filler);
  if (between.length >= 1) s += 15; // context
  if (between.length >= 2) s += 5;
  if (recommended >= minViable - 0.5) s += 15; // tidak memotong cerita
  if (recommended < minViable - 0.5) s -= 20;
  return clamp(s, 0, 100);
}

function scoreEndingQuality(endM, moments, recommended) {
  if (!endM) return 0;
  let s = 30; // ada ending (batas kalimat alami)
  if (!endM.filler) s += 15;
  if (isStrongEnding(endM)) s += 30;
  if (endM.openLoop) s -= 20;
  if (endM.infoDensity != null && endM.infoDensity >= 0.2) s += 10;
  // Tidak mengulang kesimpulan: ending harus "sesudah" payoff kalau ada.
  if (endM.roles && endM.roles.includes("CLAIM") && !isStrongEnding(endM)) s -= 5;
  return clamp(s, 0, 100);
}

function scoreDurationEfficiency(moments, hook, recommended, stoppedRedundant) {
  const dur = Math.max(2, recommended);
  const contentWords = moments
    .filter((m) => !m.filler && m.index >= hook.index && (m.end - hook.start) <= recommended)
    .reduce((acc, m) => acc + wordsOf(m.text || "").length, 0);
  const wps = contentWords / dur;
  let e = clamp((wps / 2.6) * 100, 0, 100);
  if (stoppedRedundant) e = Math.max(e, 55);
  return Math.round(clamp(e, 0, 100));
}

function scoreRetention(hook, payoff, payoffDist, moments, recommended, endingQuality) {
  // Kekuatan hook = gabungan kekuatan editorial (momentScore) & hook-engine (deep).
  const hookDeep = Math.max(hook.deep != null ? hook.deep : 0, hook.momentScore != null ? hook.momentScore : 0);
  let r = 0.35 * hookDeep;
  if (payoff) r += 0.2 * 100;
  else r += 0.05 * 100;
  // Payoff distance bukan hukuman bila konten di antara tetap padat & progresif.
  if (payoffDist != null && payoffDist <= 60) r += 0.08 * 100;
  else if (payoffDist != null) r += 0.03 * 100;
  const included = moments.filter((m) => !m.filler && (m.end - (hook.start)) <= recommended);
  const avgDensity = included.length
    ? included.reduce((a, m) => a + (m.infoDensity != null ? m.infoDensity : 0.3), 0) / included.length
    : 0.3;
  r += 0.12 * (avgDensity * 100);
  r += 0.15 * endingQuality;
  const redundant = included.filter((m) => isRedundant(m)).length;
  r -= redundant * 3;
  return Math.round(clamp(r, 0, 100));
}

// ---------------------------------------------------------------------------
// ALASAN CUT ALAMI
// ---------------------------------------------------------------------------
function naturalCutReason(hook, payoff, recommended, endM, moments, mode) {
  const h = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  const clipRef = hook.start;
  const endTxt = endM ? endM.text.slice(0, 60) : "";
  let reason = "";
  if (payoff) {
    reason = `Payoff di ${h(payoff.start)}; clip diakhiri di ${h(clipRef + recommended)}`;
  } else {
    reason = `Tidak ada payoff eksplisit; clip diakhiri di ${h(clipRef + recommended)}`;
  }
  if (endM && !isWeakEnding(endM)) reason += ` di batas kalimat yang alami ("${endTxt}...")`;
  if (endM && isRedundant(endM)) reason += ` sebelum materi redundan`;
  if (mode === "FIXED") reason += ` (mode FIXED, dibatasi durasi tetap)`;
  else if (mode === "SHORT") reason += ` (mode SHORT, dipadatkan)`;
  else if (mode === "STORY") reason += ` (mode STORY, cerita dipertahankan)`;
  return reason;
}

// ---------------------------------------------------------------------------
// CO-OPTIMIZATION — ranking HOOK + STORY + DURATION
// ---------------------------------------------------------------------------
// Untuk tiap momen non-filler: durasi + skor potensial clip gabungan.
// JANGAN pilih otomatis hook tertinggi — durasi/story ikut menentukan.
function rankCandidates(moments, lang, opts) {
  opts = opts || {};
  const maxAllowed = Math.max(10, Number(opts.maxAllowed) || 90);
  const candidates = (moments || [])
    .filter((m) => !m.filler)
    .map((m) => {
      const dur = analyzeDuration(moments, m, { ...opts, maxAllowed });
      const hookScore = m.momentScore != null ? m.momentScore : m.deep || 0;
      const clipScore = clipPotentialScore({
        hookQuality: hookScore,
        openingQuality: hookScore,
        storyCompleteness: dur.storyCompleteness,
        retentionPotential: dur.retentionPotential,
        payoffQuality: dur.payoffQuality,
        durationEfficiency: dur.durationEfficiency,
        endingQuality: dur.endingQuality,
        payoffPresent: !!m.payoff
      });
      return { moment: m, duration: dur, clipPotentialScore: clipScore, hookScore };
    })
    .sort((a, b) => b.clipPotentialScore - a.clipPotentialScore || b.hookScore - a.hookScore || a.moment.index - b.moment.index);
  return candidates;
}

// FINAL CLIP POTENTIAL SCORE (§20, §35).
// Hook tetap dominan, tapi story/retensi/durasi/ending ikut menentukan.
// Durasi TIDAK mendominasi skor.
function clipPotentialScore(f) {
  const hook = clamp(f.hookQuality || 0, 0, 100);
  const opening = clamp(f.openingQuality || 0, 0, 100);
  const story = clamp(f.storyCompleteness || 0, 0, 100);
  const retention = clamp(f.retentionPotential || 0, 0, 100);
  const payoff = clamp(f.payoffQuality || (f.payoffPresent ? 60 : 25), 0, 100);
  const efficiency = clamp(f.durationEfficiency || 0, 0, 100);
  const ending = clamp(f.endingQuality || 0, 0, 100);
  return Math.round(
    0.25 * hook +
    0.15 * opening +
    0.15 * story +
    0.15 * retention +
    0.1 * payoff +
    0.1 * efficiency +
    0.1 * ending
  );
}

module.exports = {
  clamp,
  isStrongEnding,
  isRedundant,
  isWeakEnding,
  payoffQuality,
  analyzeDuration,
  rankCandidates,
  clipPotentialScore,
  STRONG_ENDING_SIGNALS
};
