const assert = require("node:assert/strict");
const test = require("node:test");

const { parseFfmpegProgress } = require("../dist/main/ffmpeg/ffmpegEngine.js");
const { analyzeHooks, generateTimedHookCandidates } = require("../dist/main/analyzer/hookAnalyzer.js");
const { EXPORT_RESOLUTION_OPTIONS } = require("../dist/shared/constants/app.js");

test("parseFfmpegProgress maps ffmpeg time to percent when duration is known", () => {
  const stderr = "frame=120 fps=30 time=00:00:15.00 bitrate=1000kbits/s";
  assert.equal(parseFfmpegProgress(stderr, 60), 25);
});

test("parseFfmpegProgress clamps progress below completion", () => {
  const stderr = "frame=999 fps=30 time=00:02:30.00 bitrate=1000kbits/s";
  assert.equal(parseFfmpegProgress(stderr, 60), 99);
});

test("generateTimedHookCandidates creates bounded candidates from metadata duration", () => {
  const clips = generateTimedHookCandidates("project-1", 180, {
    title: "Cara bikin short video yang lebih menarik",
    tags: ["content strategy", "shorts"]
  });

  assert.ok(clips.length > 0);
  assert.ok(clips.length <= 10);
  assert.ok(clips.every((clip) => clip.startTime >= 0 && clip.endTime <= 180));
});

test("analyzeHooks returns transcript-based clips with unique titles", () => {
  const segments = Array.from({ length: 4 }, (_, index) => ({
    start: index * 18,
    end: index * 18 + 18,
    text: "Ternyata banyak kreator gagal karena opening video terlalu lama dan penonton langsung pergi."
  }));
  const clips = analyzeHooks("project-1", segments);
  const titles = new Set(clips.map((clip) => clip.title));
  const captions = new Set(clips.map((clip) => clip.suggestedCaption));

  assert.ok(clips.length > 0);
  assert.equal(titles.size, clips.length);
  assert.equal(captions.size, clips.length);
});

test("supported export resolutions include 4:5", () => {
  assert.ok(EXPORT_RESOLUTION_OPTIONS.some((option) => option.value === "1080x1350"));
});

test("analyzeHooks diversifies transcript candidates across the timeline", () => {
  const texts = [
    "Kenapa banyak kreator gagal di tiga detik pertama? Ternyata opening mereka terlalu panjang.",
    "Cara bikin penonton tahan adalah mulai dari masalah yang paling terasa.",
    "Jangan kasih intro panjang, langsung tunjukkan konflik atau hasil akhirnya.",
    "Ada 3 angka penting yang harus dilihat sebelum upload video pendek.",
    "Tapi bagian paling sering dilewatkan adalah caption dan angle visual.",
    "Intinya, video pendek butuh janji yang jelas dan payoff yang cepat."
  ];
  const segments = texts.map((text, index) => ({
    start: index * 24,
    end: index * 24 + 22,
    text
  }));
  const clips = analyzeHooks("project-1", segments);
  const starts = clips.map((clip) => clip.startTime);

  assert.ok(clips.length >= 3);
  assert.ok(Math.max(...starts) - Math.min(...starts) >= 40);
  assert.ok(clips.some((clip) => clip.reason.includes("pola pertanyaan") || clip.reason.includes("angka spesifik")));
  assert.ok(clips.every((clip) => clip.suggestedCaption.length <= 183));
});

test("generateTimedHookCandidates creates varied captions for social posting", () => {
  const clips = generateTimedHookCandidates("project-1", 360, {
    title: "Strategi konten pendek untuk kreator pemula",
    description: "Video ini membahas opening, problem, proof, payoff, dan closing untuk short-form content.",
    tags: ["content creator", "short video", "viral hooks"]
  });
  const captions = new Set(clips.map((clip) => clip.suggestedCaption));

  assert.ok(clips.length >= 5);
  assert.ok(captions.size >= Math.min(5, clips.length));
});
