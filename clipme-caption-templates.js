// Clipme Caption Templates — library template caption nyata.
// Setiap template memetakan ke konfigurasi render yang benar-benar dipakai
// FFmpeg (CAPTION_STYLES + FONT_MAP + captionPosition/captionSize di server.js).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ClipmeCaptionTemplates = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const STYLES = ["bold", "minimal", "pop", "glow", "karaoke"];
  const FONTS = [
    "Arial", "Arial Black", "Calibri", "Cambria", "Comic Sans MS", "Consolas",
    "Courier New", "Franklin Gothic Medium", "Georgia", "Impact", "Segoe UI",
    "Segoe UI Black", "Tahoma", "Times New Roman", "Trebuchet MS", "Verdana"
  ];

  const TEMPLATES = [
    // Trending
    { id: "trend-hype", name: "Hype Yellow", category: "Trending", style: "pop", fontFamily: "Impact", color: "#FFE100", sizeScale: 1.05, position: 0.76 },
    { id: "trend-hormozi", name: "Hormozi Cut", category: "Trending", style: "bold", fontFamily: "Arial Black", color: "#FFFFFF", sizeScale: 1.1, position: 0.72 },
    { id: "trend-viral-glow", name: "Viral Glow", category: "Trending", style: "glow", fontFamily: "Segoe UI Black", color: "#00CCFF", sizeScale: 1.0, position: 0.78 },

    // Bold
    { id: "bold-blackout", name: "Blackout", category: "Bold", style: "bold", fontFamily: "Impact", color: "#FFFFFF", sizeScale: 1.08, position: 0.74 },
    { id: "bold-red-alert", name: "Red Alert", category: "Bold", style: "bold", fontFamily: "Arial Black", color: "#FF3B30", sizeScale: 1.02, position: 0.76 },
    { id: "bold-poster", name: "Poster", category: "Bold", style: "bold", fontFamily: "Franklin Gothic Medium", color: "#FFFFFF", sizeScale: 1.0, position: 0.75 },

    // Dynamic
    { id: "dyn-neon-pink", name: "Neon Pulse", category: "Dynamic", style: "glow", fontFamily: "Segoe UI Black", color: "#FF2BD6", sizeScale: 1.0, position: 0.77 },
    { id: "dyn-lime-pop", name: "Lime Pop", category: "Dynamic", style: "pop", fontFamily: "Verdana", color: "#7CFC00", sizeScale: 1.0, position: 0.75 },
    { id: "dyn-blaze", name: "Blaze", category: "Dynamic", style: "bold", fontFamily: "Impact", color: "#FF6B00", sizeScale: 1.06, position: 0.74 },

    // Podcast
    { id: "pod-clean", name: "Podcast Clean", category: "Podcast", style: "bold", fontFamily: "Segoe UI", color: "#FFFFFF", sizeScale: 0.88, position: 0.86 },
    { id: "pod-warm", name: "Warm Talk", category: "Podcast", style: "bold", fontFamily: "Georgia", color: "#FFF4E0", sizeScale: 0.92, position: 0.84 },

    // Cinematic
    { id: "cin-serif", name: "Cinema Serif", category: "Cinematic", style: "minimal", fontFamily: "Times New Roman", color: "#FFFFFF", sizeScale: 0.9, position: 0.88 },
    { id: "cin-gold", name: "Epic Gold", category: "Cinematic", style: "bold", fontFamily: "Cambria", color: "#E5C07B", sizeScale: 0.95, position: 0.87 },

    // Educational
    { id: "edu-clear", name: "Clear Lesson", category: "Educational", style: "bold", fontFamily: "Verdana", color: "#FFFFFF", sizeScale: 0.95, position: 0.8 },
    { id: "edu-board", name: "Classroom", category: "Educational", style: "bold", fontFamily: "Comic Sans MS", color: "#FFFFFF", sizeScale: 0.95, position: 0.82 },

    // Business
    { id: "biz-slate", name: "Corporate Slate", category: "Business", style: "bold", fontFamily: "Segoe UI Black", color: "#F2F5F7", sizeScale: 0.92, position: 0.83 },
    { id: "biz-exec", name: "Executive", category: "Business", style: "minimal", fontFamily: "Arial", color: "#FFFFFF", sizeScale: 0.88, position: 0.85 },

    // Emotional
    { id: "emo-soft", name: "Soft Story", category: "Emotional", style: "bold", fontFamily: "Georgia", color: "#FFE9EC", sizeScale: 0.94, position: 0.84 },
    { id: "emo-sepia", name: "Memory Film", category: "Emotional", style: "minimal", fontFamily: "Cambria", color: "#F5E6C8", sizeScale: 0.9, position: 0.87 },

    // Funny
    { id: "fun-meme", name: "Meme Classic", category: "Funny", style: "pop", fontFamily: "Impact", color: "#FFFFFF", sizeScale: 1.04, position: 0.78 },
    { id: "fun-comic", name: "Comic Zing", category: "Funny", style: "pop", fontFamily: "Comic Sans MS", color: "#FFEB3B", sizeScale: 1.0, position: 0.79 },

    // Gaming
    { id: "game-glitch", name: "Glitch Green", category: "Gaming", style: "glow", fontFamily: "Consolas", color: "#39FF14", sizeScale: 0.98, position: 0.8 },
    { id: "game-fire", name: "Esports Fire", category: "Gaming", style: "bold", fontFamily: "Impact", color: "#FF4500", sizeScale: 1.05, position: 0.78 },

    // News
    { id: "news-headline", name: "Headline", category: "News", style: "bold", fontFamily: "Arial Black", color: "#FFFFFF", sizeScale: 0.96, position: 0.82 },
    { id: "news-report", name: "Broadcast", category: "News", style: "bold", fontFamily: "Tahoma", color: "#F5F5F5", sizeScale: 0.9, position: 0.84 },

    // Minimal
    { id: "min-pure", name: "Pure White", category: "Minimal", style: "minimal", fontFamily: "Arial", color: "#FFFFFF", sizeScale: 0.9, position: 0.85 },
    { id: "min-thin", name: "Thin Line", category: "Minimal", style: "minimal", fontFamily: "Calibri", color: "#F0F0F0", sizeScale: 0.86, position: 0.86 },
    { id: "min-mono", name: "Mono Note", category: "Minimal", style: "minimal", fontFamily: "Consolas", color: "#DDDDDD", sizeScale: 0.82, position: 0.88 },

    // Colorful
    { id: "col-candy", name: "Candy Pink", category: "Colorful", style: "pop", fontFamily: "Verdana", color: "#FF4FD8", sizeScale: 1.0, position: 0.77 },
    { id: "col-sunset", name: "Sunset", category: "Colorful", style: "bold", fontFamily: "Arial Black", color: "#FF7A59", sizeScale: 1.0, position: 0.78 },
    { id: "col-ocean", name: "Ocean Pop", category: "Colorful", style: "pop", fontFamily: "Trebuchet MS", color: "#22D3EE", sizeScale: 1.0, position: 0.76 },

    // Premium
    { id: "pre-gold", name: "Luxe Gold", category: "Premium", style: "bold", fontFamily: "Georgia", color: "#D4AF37", sizeScale: 0.98, position: 0.83 },
    { id: "pre-platinum", name: "Platinum", category: "Premium", style: "minimal", fontFamily: "Segoe UI Black", color: "#ECECEC", sizeScale: 0.9, position: 0.85 },

    // Luxury
    { id: "lux-noir", name: "Noir", category: "Luxury", style: "minimal", fontFamily: "Times New Roman", color: "#D9D9D9", sizeScale: 0.88, position: 0.86 },
    { id: "lux-champagne", name: "Champagne", category: "Luxury", style: "bold", fontFamily: "Cambria", color: "#F7E7CE", sizeScale: 0.92, position: 0.85 },

    // Conversational
    { id: "conv-casual", name: "Casual Chat", category: "Conversational", style: "bold", fontFamily: "Verdana", color: "#FFFFFF", sizeScale: 0.94, position: 0.81 },
    { id: "conv-friendly", name: "Friendly", category: "Conversational", style: "bold", fontFamily: "Calibri", color: "#FFFFFF", sizeScale: 0.92, position: 0.82 },

    // Highlight
    { id: "hl-marker", name: "Marker Green", category: "Highlight", style: "bold", fontFamily: "Arial Black", color: "#22C55E", sizeScale: 1.0, position: 0.77 },
    { id: "hl-spotlight", name: "Spotlight", category: "Highlight", style: "pop", fontFamily: "Franklin Gothic Medium", color: "#FB923C", sizeScale: 1.02, position: 0.76 },

    // Karaoke (word-level highlight via ASS \k tags)
    { id: "kar-classic", name: "Karaoke Classic", category: "Karaoke", style: "karaoke", fontFamily: "Consolas", color: "#00FFFF", sizeScale: 0.98, position: 0.8 },
    { id: "kar-pop", name: "Karaoke Pop", category: "Karaoke", style: "karaoke", fontFamily: "Verdana", color: "#FFFF66", sizeScale: 1.0, position: 0.78 },
    { id: "kar-night", name: "Karaoke Night", category: "Karaoke", style: "karaoke", fontFamily: "Trebuchet MS", color: "#FF66CC", sizeScale: 0.98, position: 0.81 },

    // Storytelling
    { id: "story-tale", name: "Fable", category: "Storytelling", style: "bold", fontFamily: "Georgia", color: "#FFF8E7", sizeScale: 0.93, position: 0.84 },
    { id: "story-narrator", name: "Narrator", category: "Storytelling", style: "minimal", fontFamily: "Cambria", color: "#EAEAEA", sizeScale: 0.9, position: 0.86 }
  ];

  const CATEGORIES = [...new Set(TEMPLATES.map((t) => t.category))];

  function getById(id) {
    return TEMPLATES.find((t) => t.id === id) || null;
  }

  function resolve(templateId, fallback) {
    const t = getById(templateId);
    if (!t) return fallback || null;
    return {
      captionStyle: t.style,
      fontFamily: t.fontFamily,
      captionColor: t.color || "#FFFFFF",
      captionSize: Math.round(23 * (t.sizeScale || 1)),
      captionPosition: t.position
    };
  }

  function swatchStyle(t) {
    const presetShadows = {
      bold: "2px 2px 0 rgba(0,0,0,.65)",
      minimal: "none",
      pop: "1px 1px 0 #000, -1px -1px 0 #000",
      glow: "0 0 8px rgba(90,160,255,.9)",
      karaoke: "2px 2px 0 rgba(0,0,0,.6)"
    };
    return {
      fontFamily: `"${t.fontFamily}", sans-serif`,
      color: t.color || "#FFFFFF",
      fontWeight: t.style === "minimal" ? 500 : 800,
      textShadow: presetShadows[t.style] || "none",
      WebkitTextStroke: t.style === "bold" ? "1px rgba(0,0,0,.85)" : "none"
    };
  }

  return {
    TEMPLATES,
    CATEGORIES,
    STYLES,
    FONTS,
    getById,
    resolve,
    swatchStyle,
    DEFAULT_TEMPLATE_ID: "trend-hype"
  };
});
