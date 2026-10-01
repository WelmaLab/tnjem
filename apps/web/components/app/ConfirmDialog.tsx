"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";

/* espace prof v2 · shell — the confirmation dialog for destructive actions (cancel
   a class…) and the small forms that belong in one (move a class).

   The NATIVE <dialog> + showModal(): the browser traps focus inside, makes the rest
   of the page inert, closes on Escape and returns focus to the control that opened
   it — the four things a hand-rolled modal most often gets wrong. The confirm button
   is the LAST button and is never focused first: the default answer to "cancel this
   class for everyone?" must not be one Enter away. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onClose,
  busy,
  tone = "danger",
  confirmDisabled,
}: {
  open: boolean;
  title: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  busy?: boolean;
  /** "danger" = the rose destructive pill; "primary" = the ochre main action. */
  tone?: "danger" | "primary";
  confirmDisabled?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="aps-dialog"
      aria-labelledby={titleId}
      aria-describedby={children ? bodyId : undefined}
      onClose={onClose}
      onCancel={(e) => {
        if (busy) e.preventDefault(); // no Escape while the request is in flight
      }}
      data-e2e="confirm-dialog"
    >
      <h2 id={titleId} className="aps-dialog-t">{title}</h2>
      {children ? <div id={bodyId} className="aps-dialog-b">{children}</div> : null}
      <div className="aps-dialog-btns">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy} autoFocus>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={tone === "danger" ? "btn btn-sm aps-danger" : "btn btn-primary btn-sm"}
          onClick={onConfirm}
          disabled={busy || confirmDisabled}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
