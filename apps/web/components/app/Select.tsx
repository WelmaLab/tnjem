"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
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
   The list opens upward when the room below (under the sticky bars) is too short. */

export type SelectOption = { value: string; label: string; hint?: string };

export function Select({
  id,
  value,
  onChange,
  options,
  labelledBy,
  e2e,
  disabled,
}: {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  options: SelectOption[];
  /** The id of the VISIBLE label; the button's name is « label + current choice ». */
  labelledBy: string;
  e2e?: string;
  disabled?: boolean;
}) {
  const auto = useId();
  const btnId = id ?? `${auto}-btn`;
  const listId = `${auto}-list`;
  const optId = (i: number) => `${auto}-opt-${i}`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<Placement>("below");
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });

  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));
  const selected = options[selectedIndex];

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
        ref={btnRef}
        id={btnId}
        type="button"
        className="inp lf-sel-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={`${labelledBy} ${btnId}`}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openAt(selectedIndex))}
        onKeyDown={onButtonKey}
        data-e2e={e2e}
        data-value={value}
      >
        <span className="lf-sel-v" dir="auto">{selected?.label ?? ""}</span>
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
