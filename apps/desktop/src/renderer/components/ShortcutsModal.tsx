import React from "react";
import Button from "./ui/Button";

export default function ShortcutsModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  if (!visible) return null;
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="diagnostics-modal" role="dialog" aria-modal="true" aria-label="Keyboard Shortcuts" onClick={(e) => e.stopPropagation()}>
        <div className="panel-heading">
          <h3>Keyboard Shortcuts</h3>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
        <div style={{ marginTop: 8 }}>
          <dl className="metadata-grid">
            <div><dt>Ctrl+N</dt><dd>Create new project</dd></div>
            <div><dt>Ctrl+I</dt><dd>Import video into active project</dd></div>
            <div><dt>Ctrl+A</dt><dd>Analyze hooks</dd></div>
            <div><dt>Ctrl+E</dt><dd>Export selected preview</dd></div>
            <div><dt>G</dt><dd>Open onboarding</dd></div>
            <div><dt>?</dt><dd>Show this help</dd></div>
          </dl>
        </div>
      </section>
    </div>
  );
}
