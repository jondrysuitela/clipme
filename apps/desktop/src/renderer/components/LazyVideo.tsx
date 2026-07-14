import React, { useEffect, useRef, useState } from "react";

export default function LazyVideo({ src, className, muted, preload }: { src: string; className?: string; muted?: boolean; preload?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (visible) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            obs.disconnect();
            break;
          }
        }
      },
      { rootMargin: "200px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [visible]);

  return (
    <div ref={ref} style={{ width: "100%", height: "100%" }}>
      {visible ? <video className={className} src={src} muted={muted} preload={preload} /> : null}
    </div>
  );
}
