import React, { useEffect } from "react";

export type AppToast = { id: string; message: string; variant?: "success" | "error" | "info" };

function ToastItem({ toast, onRemove }: { toast: AppToast; onRemove: (id: string) => void }) {
  useEffect(() => {
    const id = setTimeout(() => onRemove(toast.id), 4200);
    return () => clearTimeout(id);
  }, [toast, onRemove]);

  return (
    <div className={`toast ${toast.variant ?? ""}`} role="status">
      {toast.message}
    </div>
  );
}

export default function Toasts({ toasts, onRemove }: { toasts: AppToast[]; onRemove: (id: string) => void }) {
  return (
    <div className="toasts" aria-live="polite" aria-atomic="true">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onRemove={onRemove} />
      ))}
    </div>
  );
}
