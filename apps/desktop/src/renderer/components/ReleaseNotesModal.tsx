import React from "react";
import Button from "./ui/Button";

const RELEASE_NOTES = `# ClipMe 0.1.9

## Highlights

- Improved URL import reliability by bundling the latest official yt-dlp.exe during release builds.
- Added URL cookies setting for Chrome, Edge, and Firefox to help with platform anti-bot/login restrictions.
- Added yt-dlp path and version to Diagnostics for easier remote troubleshooting.
- Improved yt-dlp error messages for anti-bot, HTTP 403, unsupported URL, unavailable format, cookies, and network failures.
- Strengthened hook analysis with better viral scoring signals, timeline diversification, cleaner captions, and contextual hashtags.
- Added social export format 4:5 1080x1350.
- Added clip curation workflow: Review, Keep, Skip, filters, and Export Keep.
- Added copy caption/path actions, export pack summary, diagnostics panel, app icon, and SaaS-style dashboard polish.

## New in 0.1.10+

- **Supporting Assets**: Generate SEO descriptions, keywords, and platform tags per clip.
- **Zoom Auto-Effect**: Auto zoom-in on high-scoring moments during export.
- **Export Queue Manager**: Monitor and manage export jobs in real-time.
- **Moment Labels**: Visual badges for Aha, Insight, Viral, and other moment types.
- **Retry Failed Jobs**: Retry failed export jobs with one click.
- **Activity Log**: View project activity logs per project.`;

export default function ReleaseNotesModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  if (!visible) return null;
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="diagnostics-modal" role="dialog" aria-modal="true" aria-label="Release Notes" onClick={(e) => e.stopPropagation()}>
        <div className="panel-heading">
          <h3>Release Notes</h3>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
        <pre className="release-notes-content">
          {RELEASE_NOTES}
        </pre>
      </section>
    </div>
  );
}
