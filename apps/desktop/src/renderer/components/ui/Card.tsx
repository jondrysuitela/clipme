import React from "react";

export default function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`.trim()}>
      {children}
    </section>
  );
}
