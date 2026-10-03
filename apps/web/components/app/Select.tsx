"use client";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { ChevronDown, Check } from "@/components/icons";
import { placePopover, type Placement } from "./popover-place";

/* live-fixes-1 · pages (B) — THE SELECT OF THE PROF SPACE, in place of the native
   <select>: the browser's own list rendered in the system's language and style
   (English on an English Windows, whatever the page said) and could not be styled
   to match the shell.

   The WAI-ARIA "select-only combobox" pattern: a button that names the field and
   shows the choice (aria-haspopup="listbox", aria-expanded), and a listbox of
   options with aria-selected. Focus moves INTO the list while it is open, the
   active option is aria-activedescendant, and
     ↓ ↑ Home End      move          Enter / Space   choose and close
     Escape            close          Tab             close, keep the choice
     a letter          jump to the next option starting with it
   Opening from the button with ↓ / ↑ / Enter / Space starts on the current choice.
   The list opens upward when the room below (under the sticky bars) is too short.

   live-fixes-2 · C — the same control everywhere else (signup, student welcome,
   upgrade, admin), so it also takes what those native selects had: a placeholder
   for a choice not made yet (« Mois », « Choisir… »: shown muted, never an option),
   a leading icon like any .inp field, and the field's state for assistive tech —
   aria-required, aria-invalid, aria-describedby (hint / error) — plus a ref the page
   focuses on a refusal. Those two states belong to a combobox, not to a plain
   button, so the button now says what it is: role="combobox" (allowed on <button>;
   the pattern's own name), still opening its listbox the same way.
   SelectField is the field around it: a <div>, not Field's <label> — a label
   would forward every click inside it (an option of the open list included) to
   the button, reopening the list it just closed. */

export type SelectOption = { value: string; label: string; hint?: string };

export function Select({
  id,
  value,
  onChange,
  options,
  labelledBy,
  e2e,
  disabled,
  placeholder,
  icon,
  describedBy,
  invalid,
  required,
  buttonRef,
}: {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  options: SelectOption[];
  /** The id of the VISIBLE label; the button's name is « label + current choice ». */
  labelledBy: string;
  e2e?: string;
  disabled?: boolean;
  /** Shown, muted, while the value is "" or matches no option. Not an option itself. */
  placeholder?: string;
  /** A leading (decorative) icon, as in an .inp field. */
  icon?: ReactNode;
  /** The field's hint and/or error ids. */
  describedBy?: string;
  invalid?: boolean;
  /** A choice the form cannot go on without (the page checks it; this announces it). */
  required?: boolean;
  /** For a page that moves focus to this field when it refuses a submit. */
  buttonRef?: RefObject<HTMLButtonElement | null>;
}) {
  const auto = useId();
  const btnId = id ?? `${auto}-btn`;
  const listId = `${auto}-list`;
  const optId = (i: number) => `${auto}-opt-${i}`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<Placement>("below");
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const setBtn = useCallback(
    (el: HTMLButtonElement | null) => {
      btnRef.current = el;
      if (buttonRef) buttonRef.current = el;
    },
    [buttonRef],
  );

  const match = options.findIndex((o) => o.value === value);
  const selectedIndex = Math.max(0, match);
  const selected = options[selectedIndex];
  const showPlaceholder = placeholder !== undefined && (value === "" || match < 0);

  // Click outside closes.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Placed before paint, so the list never flashes on the wrong side; then focused.
  useLayoutEffect(() => {
    if (!open || !listRef.current || !btnRef.current) return;
    setPlace(placePopover(btnRef.current, listRef.current.offsetHeight));
    listRef.current.focus();
  }, [open]);

  // The active option stays in view inside a long list.
  useEffect(() => {
    if (!open) return;
    document.getElementById(optId(active))?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  function openAt(i: number) {
    if (disabled) return;
    setActive(i);
    setOpen(true);
  }
  function choose(i: number) {
    const o = options[i];
    if (o) onChange(o.value);
    setOpen(false);
    btnRef.current?.focus();
  }

  function onButtonKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openAt(selectedIndex);
    }
  }

  function onListKey(e: KeyboardEvent<HTMLUListElement>) {
    const last = options.length - 1;
    const moves: Record<string, () => number> = {
      ArrowDown: () => Math.min(last, active + 1),
      ArrowUp: () => Math.max(0, active - 1),
      Home: () => 0,
      End: () => last,
      PageDown: () => Math.min(last, active + 5),
      PageUp: () => Math.max(0, active - 5),
    };
    if (moves[e.key]) {
      e.preventDefault();
      setActive(moves[e.key]());
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation(); // inside a <dialog>, Escape closes the list, not the dialog
      setOpen(false);
      btnRef.current?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    } else if (e.key.length === 1 && /\S/.test(e.key)) {
      // Type-ahead: the next option whose label starts with what was typed.
      const now = Date.now();
      typed.current = { text: now - typed.current.at < 700 ? typed.current.text + e.key : e.key, at: now };
      const q = typed.current.text.toLocaleLowerCase();
      const order = [...options.keys()].map((k) => (active + 1 + k) % options.length);
      const hit = order.find((k) => options[k].label.toLocaleLowerCase().startsWith(q));
      if (hit !== undefined) setActive(hit);
    }
  }

  return (
    <div ref={wrapRef} className="lf-sel">
      <button
        ref={setBtn}
        id={btnId}
        type="button"
        role="combobox"
        className="inp lf-sel-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={`${labelledBy} ${btnId}`}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        aria-required={required || undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openAt(selectedIndex))}
        onKeyDown={onButtonKey}
        data-e2e={e2e}
        data-value={value}
      >
        {icon}
        <span className={`lf-sel-v${showPlaceholder ? " is-ph" : ""}`} dir="auto">
          {showPlaceholder ? placeholder : (selected?.label ?? "")}
        </span>
        <ChevronDown className="lf-sel-chev" />
      </button>
      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-labelledby={labelledBy}
          aria-activedescendant={optId(active)}
          className={`aps-pop lf-sel-list is-${place}`}
          onKeyDown={onListKey}
          data-e2e={e2e ? `${e2e}-list` : undefined}
        >
          {options.map((o, i) => (
            <li
              key={o.value || `__none-${i}`}
              id={optId(i)}
              role="option"
              aria-selected={o.value === value}
              className={`lf-sel-opt${i === active ? " is-active" : ""}`}
              onMouseEnter={() => setActive(i)}
              // mousedown, not click: the list must not lose focus (and close) first.
              onMouseDown={(e) => {
                e.preventDefault();
                choose(i);
              }}
              data-value={o.value}
            >
              <span className="lf-sel-opt-t" dir="auto">
                {o.label}
                {o.hint ? <span className="lf-sel-opt-h">{o.hint}</span> : null}
              </span>
              {o.value === value ? <Check className="lf-sel-tick" /> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The field around one or more Selects: the visible label, the error (announced) and
    the hint, laid out exactly as <Field> lays them out — but in a <div> (see the
    header), and handing the ids to the children, since a Select takes them as props
    rather than having them cloned onto it. */
export function SelectField({
  label,
  help,
  error,
  e2e,
  className,
  children,
}: {
  label: string;
  help?: string;
  error?: string;
  e2e?: string;
  /** Extra classes on the field, e.g. « lf-mark-set »: a chosen value outlines it in blue. */
  className?: string;
  children: (a: { labelId: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}) {
  const uid = useId();
  const labelId = `${uid}-label`;
  const helpId = help ? `${uid}-help` : undefined;
  const errorId = error ? `${uid}-error` : undefined;
  const describedBy = [errorId, helpId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={className ? `field ${className}` : "field"} data-e2e={e2e}>
      <span className="field-label" id={labelId}>{label}</span>
      {children({ labelId, describedBy, invalid: Boolean(error) })}
      {error && (
        <div id={errorId} role="alert" className="help text-rose font-semibold">
          {error}
        </div>
      )}
      {help && <div id={helpId} className="help">{help}</div>}
    </div>
  );
}
