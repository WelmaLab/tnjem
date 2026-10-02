"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { bilingual } from "@/lib/i18n";

/* live-fixes-1 · pages (E) — « ? »: the detail that used to be a SECOND note on the
   page (rule 7: one note per page), now beside the field or the section it is about.

   A disclosure, not a hover-only tooltip — touch has no hover:
     • a real button (a 44px target; the « ? » drawn smaller inside it) toggles the
       bubble on click or tap; Escape or a click elsewhere closes it;
     • a mouse hovering it shows the bubble too (pointerType "mouse" only, so a tap
       never leaves it stuck open);
     • the text is ALWAYS in the DOM and is the button's description (aria-describedby),
       so a screen reader hears it on focus without opening anything.
   The bubble starts at the « ? » and is nudged back inside the screen when it would
   overflow its end edge (a phone, a « ? » far along a line). The room is measured
   BEFORE it shows: once a box overflows, a phone widens its layout viewport to fit it,
   and a measure taken then would agree with the overflow instead of undoing it. */

const copy = bilingual({
  fr: { more: "Plus d'infos" },
  ar: { more: "معلومات أكثر" },
});

const EDGE = 8;
/** The bubble's widest (CSS: max-width min(300px, 100vw − 48px)), and its offset from the « ? ». */
const BUBBLE_MAX = 300;
const BUBBLE_OFFSET = 4;

export function InfoTip({ label, children, e2e }: { label?: string; children: ReactNode; e2e?: string }) {
  const { locale } = useLocale();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [shift, setShift] = useState(0);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const shown = open || hover;

  /** How far the bubble must move back toward the start to stay on screen. */
  function place() {
    const w = wrapRef.current;
    if (!w) return;
    const r = w.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const width = Math.min(BUBBLE_MAX, vw - 48);
    const rtl = getComputedStyle(w).direction === "rtl";
    const room = rtl ? r.right + BUBBLE_OFFSET - EDGE : vw - EDGE - (r.left - BUBBLE_OFFSET);
    setShift(Math.max(0, Math.ceil(width - room)));
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setHover(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span
      ref={wrapRef}
      className="lf-tip"
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse") return;
        place();
        setHover(true);
      }}
      onPointerLeave={(e) => e.pointerType === "mouse" && setHover(false)}
    >
      <button
        type="button"
        className="lf-tip-btn"
        aria-label={label ?? copy[locale].more}
        aria-expanded={shown}
        aria-controls={id}
        aria-describedby={id}
        onClick={() => {
          // A click decides on its own: it opens what is closed and closes what is shown.
          if (!shown) place();
          setOpen(!shown);
          setHover(false);
        }}
        data-e2e={e2e}
      >
        <span aria-hidden="true">?</span>
      </button>
      <span
        id={id}
        className="lf-tip-bubble"
        hidden={!shown}
        style={shift ? { marginInlineStart: -shift } : undefined}
        data-e2e={e2e ? `${e2e}-text` : undefined}
      >
        {children}
      </span>
    </span>
  );
}
