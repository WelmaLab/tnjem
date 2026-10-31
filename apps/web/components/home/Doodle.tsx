/* home v2 · A — the hand-drawn accents of the mockup: the little rays beside the
   hero card and the banner, the curled arrow under the handwritten note, a squiggle
   and the soft blob behind the card. Pure decoration: aria-hidden, no pointer
   events, and mirrored in Arabic by CSS (html[dir=rtl] .hv2-doodle, globals.css
   « home v2 · A »), so an arrow drawn towards the card still points at it.

   Size: each kind has a default size in CSS; a width/height utility on `className`
   overrides it. Position it from the call site (absolute + inset-inline-*).
   Tone: rays and squiggle default to ochre, the arrow and the blob to blue.
   The blob is a FILL in its tone's tint (--blue50 / --ochre-tint), the others are
   strokes in --doodle-ochre / --doodle-blue. Server component. */
import type { ReactNode } from "react";

export type DoodleKind = "rays" | "arrow-curl" | "squiggle" | "blob";

type Shape = { viewBox: string; body: ReactNode };

const SHAPES: Record<DoodleKind, Shape> = {
  // three short strokes fanning out from the corner of what they point at (bottom-start)
  rays: {
    viewBox: "0 0 40 40",
    body: (
      <g fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
        <path d="M13.5 17.5 10.5 5" />
        <path d="M19.5 22.5 29 12" />
        <path d="M22.5 30.5 35 27.5" />
      </g>
    ),
  },
  // a loose hand-drawn arrow: down from the note, one loop, ending towards the start side
  "arrow-curl": {
    viewBox: "0 0 40 48",
    body: (
      <g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M30 3.5c4.6 8.4 3.6 17.6-3.4 22.4-5.2 3.5-11 1.6-10.2-2.2.8-3.9 8-3 8.4 3.4.4 6.6-6 13.4-15.6 16.2" />
        <path d="M14.6 37.6 9.2 43.3l7.6 1.6" />
      </g>
    ),
  },
  // a soft wave, for under a word
  squiggle: {
    viewBox: "0 0 72 18",
    body: (
      <path
        d="M3 10.5c3.5-6 7-6 10.5 0s7 6 10.5 0 7-6 10.5 0 7 6 10.5 0 7-6 10.5 0 7 6 10.5 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  // an organic blob, as a filled shape behind a card
  blob: {
    viewBox: "0 0 200 200",
    body: (
      <path
        d="M150 22c26 12 44 38 44 68 0 24-14 38-22 58-9 24-30 44-60 46-34 2-56-14-80-34C10 142 4 118 8 94c5-28 20-44 38-60C68 14 96 4 122 10c10 2 19 7 28 12z"
        fill="currentColor"
      />
    ),
  },
};

const DEFAULT_TONE: Record<DoodleKind, "ochre" | "blue"> = {
  rays: "ochre",
  "arrow-curl": "blue",
  squiggle: "ochre",
  blob: "blue",
};

/* Literal class names (Tailwind purges what it cannot read in the source — see
   BTN_VARIANT in components/ui.tsx). */
const KIND_CLASS: Record<DoodleKind, string> = {
  rays: "hv2-doodle-rays",
  "arrow-curl": "hv2-doodle-arrow-curl",
  squiggle: "hv2-doodle-squiggle",
  blob: "hv2-doodle-blob",
};
const TONE_CLASS = { ochre: "is-ochre", blue: "is-blue" } as const;

export function Doodle({ kind, tone, className }: { kind: DoodleKind; tone?: "ochre" | "blue"; className?: string }) {
  const s = SHAPES[kind];
  const t = tone ?? DEFAULT_TONE[kind];
  return (
    <svg
      viewBox={s.viewBox}
      className={`hv2-doodle ${KIND_CLASS[kind]} ${TONE_CLASS[t]}${className ? ` ${className}` : ""}`}
      aria-hidden="true"
      focusable="false"
    >
      {s.body}
    </svg>
  );
}
