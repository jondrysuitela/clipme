import React, { useState } from "react";
import Button from "./ui/Button";

export default function OnboardingModal({
  visible,
  onClose,
  onCreateSample
}: {
  visible: boolean;
  onClose: () => void;
  onCreateSample: () => Promise<void>;
}) {
  const [step, setStep] = useState(0);
  const steps = [
    {
      title: "Welcome to ClipMe",
      body: "ClipMe helps you turn long videos into short vertical clips optimized for social platforms."
    },
    {
      title: "Projects & Import",
      body: "Create a project, import a video (local or URL), then run ‘Analyze Hooks’ to generate clip candidates."
    },
    {
      title: "Export",
      body: "Select a clip, preview the result and export with presets for TikTok, Reels, or Shorts."
    }
  ];

  if (!visible) return null;

  const s = steps[step];

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="diagnostics-modal onboarding-modal" role="dialog" aria-modal="true" aria-label="Onboarding" onClick={(e) => e.stopPropagation()}>
        <div className="panel-heading">
          <h3>{s.title}</h3>
          <button className="ghost-button" onClick={onClose}>Close</button>
        </div>
        <div style={{ margin: "8px 0 18px 0", color: "var(--text-muted)" }}>{s.body}</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={() => (step > 0 ? setStep(step - 1) : onClose())}>Back</Button>
          {step < steps.length - 1 ? (
            <Button variant="primary" onClick={() => setStep(step + 1)}>Next</Button>
          ) : (
            <>
              <Button variant="primary" onClick={() => void onCreateSample()}>Create sample project</Button>
              <Button variant="ghost" onClick={onClose}>Skip</Button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
