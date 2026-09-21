import { CircleAlert, X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

interface ConfirmationDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  tone?: "default" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmationDialog({ open, title, message, confirmLabel, cancelLabel, tone = "default", busy = false, onConfirm, onCancel }: ConfirmationDialogProps) {
  const titleId = useId();
  const messageId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    confirmRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) { event.preventDefault(); onCancel(); return; }
      if (event.key !== "Tab") return;
      const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])") ?? [])];
      if (!controls.length) return;
      const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); previousFocus?.focus(); };
  }, [busy, onCancel, open]);

  if (!open) return null;
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
    <section ref={dialogRef} className="connection-dialog confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={messageId}>
      <div className="dialog-heading"><div><span className="confirmation-dialog-icon"><CircleAlert size={18} /></span><h2 id={titleId}>{title}</h2></div><button type="button" aria-label={cancelLabel} disabled={busy} onClick={onCancel}><X size={20} /></button></div>
      <div className="confirmation-dialog-body" id={messageId}>{message}</div>
      <div className="dialog-footer confirmation-dialog-actions"><button className="secondary-button" type="button" disabled={busy} onClick={onCancel}>{cancelLabel}</button><button ref={confirmRef} className={tone === "danger" ? "danger-button" : "primary-button"} type="button" disabled={busy} onClick={onConfirm}>{confirmLabel}</button></div>
    </section>
  </div>;
}
