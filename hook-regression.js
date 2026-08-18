// Empirical harness: verifikasi 15 regression cases hook engine.
// Jalankan: node hook-regression.js
const HE = require("./clipme-hook-engine.js");

function show(label, sentence, lang) {
  const r = HE.scoreHook(sentence, lang, {});
  const type = HE.classifyHookType(sentence, lang);
  console.log(
    `${label.padEnd(28)} score=${String(r.score).padStart(3)}${r.excluded ? " [EXCLUDED:" + r.reason + "]" : ""} type=${String(type).padEnd(14)} ev={spec:${r.evidence.specificity||0},dens:${r.evidence.density||0},curio:${r.evidence.curiosity||0},tens:${r.evidence.tension||0},nov:${r.evidence.novelty||0},ctx:${r.evidence.context||0}}`
  );
  return r;
}

console.log("=== PAS harus NYATA > sebelumnya (punchy/understated/result-first) ===");
show("D2 punchy", "Satu keputusan bikin bisnis kolaps dalam semalam", "id");
show("A5 understated", "Orang kaya membeli aset, orang miskin membeli gaya hidup", "id");
show("A1 specific", "5 kebiasaan kecil bikin saya menabung 2 juta dalam sebulan", "id");

console.log("\n=== HARUS TURUN / DITOLAK (greeting, keyword gaming, fake curiosity) ===");
show("C1 greeting", "Halo guys, di video kali ini saya bakal bahas 5 cara jadi kaya", "id");
show("B1 ternyata x3", "Ternyata ternyata ternyata masalah ternyata solusi ternyata uang ternyata kaya", "id");
show("A2 fake curiosity", "Banyak hal yang jarang dibahas orang tentang cara jadi kaya yang sukses", "id");
show("Self-intro", "Nama saya Budi, kali ini saya akan menjelaskan cara investasi", "id");
show("Filler opener", "Jadi gini ya, pertama kita harus paham dasar dulu", "id");
show("CTA", "Jangan lupa subscribe channel ini ya teman-teman", "id");

console.log("\n=== SANITY (bukan regresi) ===");
show("Question", "Kenapa kebanyakan orang gagal jadi kaya?", "id");
show("Revelation", "Ternyata kunci sukses itu cuma satu kebiasaan kecil", "id");
show("Confession", "Jujur saya pernah bangkrut karena satu keputusan ini", "id");
show("Conflict", "Bisnis saya hampir kolaps padahal untung besar tiap bulan", "id");
show("Story tease", "Waktu itu saya pertama kali investasi dan langsung rugi besar", "id");
show("Plain fact", "Inflasi di Indonesia rata-rata 3 persen per tahun", "id");
show("Warm greeting", "Hi, welcome to my channel guys", "en");

console.log("\n=== SELECT (multi-sentence, reorder) ===");
const sel = HE.selectHook([
  "Jadi gini teman-teman, di video ini saya mau kasih tips.",
  "Kenapa kebanyakan orang gagal jadi kaya?",
  "Ternyata jawabannya cuma satu kebiasaan kecil yang jarang disadari.",
  "Saya buktikan sendiri selama 3 tahun terakhir."
], "id", {});
console.log("selected hook:", JSON.stringify({ hook: sel.hook, score: sel.score, type: sel.type, reordered: sel.reordered, confidence: sel.confidence, payoff: sel.payoff.confidence, fulfilled: sel.payoff.fulfilled, rec: sel.recommendedHook, level: sel.normalizeLevel }));

console.log("\n=== NORMALIZE (minimal-edit, anti-template) ===");
const n1 = HE.normalizeHook("Jadi gini ya, pertama kita harus paham dasar dulu", "id", {});
console.log("n1:", JSON.stringify(n1));
const n2 = HE.normalizeHook("Halo guys, di video kali ini saya bakal bahas cara investasi", "id", {});
console.log("n2:", JSON.stringify(n2));
const n3 = HE.normalizeHook("Kenapa kebanyakan orang gagal jadi kaya", "id", {});
console.log("n3:", JSON.stringify(n3));
