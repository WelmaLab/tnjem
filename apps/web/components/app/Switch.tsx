"use client";

/* espace prof v2 · shell — the on/off switch of Réglages (image 4). A real
   role="switch" button: Space/Enter toggle it, its state is aria-checked, and the
   label is the visible text it is described by — never a colour alone. */
export function Switch({
  checked,
  onChange,
  label,
  describedBy,
  disabled,
  id,
  e2e,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** The accessible name (the row's visible title). */
  label: string;
  describedBy?: string;
  disabled?: boolean;
  id?: string;
  /** live-fixes-1 · D1: a data-e2e hook (the class form's « 1re séance offerte »). */
  e2e?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="aps-switch"
      data-on={checked ? "true" : "false"}
      data-e2e={e2e}
    >
      <span className="aps-switch-track" aria-hidden="true">
        <span className="aps-switch-thumb" />
      </span>
    </button>
  );
}
