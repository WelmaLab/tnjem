/* profs-v2 · A — the icon names of the landing kit. Same stroke style as
   components/icons.tsx (24 viewBox, the .ic class's 1.85 round stroke), and where
   that set already has the drawing this name IS that drawing. The new ones
   (building, chart, arrow) are ours.

   profs-v2 · F: each icon is a <span> painted with a CSS mask (kit.css, « the page's
   line icons as CSS masks »), no longer an inline <svg>: an inline icon is sent twice
   (HTML + RSC payload) and they pushed /ar past the first TCP window. The span keeps
   the `ic` class, so every `.x .ic { width; height }` rule still sizes it; `flip`
   still mirrors the arrows in Arabic. The drawings live in kit.css now.

   Decorative (aria-hidden); a label always sits beside them. Server-safe. */
import type { CSSProperties } from "react";

type P = { className?: string; style?: CSSProperties };

/* Literal class names (Tailwind and the reader both need to see them). */
const MASK = {
  person: "lk-mi-person",
  calendar: "lk-mi-calendar",
  video: "lk-mi-video",
  users: "lk-mi-users",
  shield: "lk-mi-shield",
  building: "lk-mi-building",
  chart: "lk-mi-chart",
  arrow: "lk-mi-arrow",
  forward: "lk-mi-forward",
  book: "lk-mi-book",
  check: "lk-mi-check",
  board: "lk-mi-board",
  play: "lk-mi-play",
  plus: "lk-mi-plus",
  wallet: "lk-mi-wallet",
  pencil: "lk-mi-pencil",
  share: "lk-mi-share",
  store: "lk-mi-store",
} as const;

function mask(name: keyof typeof MASK, flip = false) {
  return function MaskIcon({ className, style }: P) {
    return (
      <span
        className={`ic lk-mi ${MASK[name]}${flip ? " flip" : ""}${className ? ` ${className}` : ""}`}
        style={style}
        aria-hidden="true"
      />
    );
  };
}

export const IconPerson = mask("person");
export const IconCalendar = mask("calendar");
export const IconVideo = mask("video");
export const IconUsers = mask("users");
export const IconShieldCheck = mask("shield");
export const IconBuilding = mask("building");
export const IconChart = mask("chart");
/** Points to the inline END: drawn towards the right, and .flip mirrors it in RTL.
    To nudge it on hover use the `translate` property: `transform` is .flip's. */
export const IconArrow = mask("arrow", true);
/** components/icons Forward (a chevron), mirrored in RTL like it. */
export const IconForward = mask("forward", true);
export const IconBook = mask("book");
export const IconCheck = mask("check");
export const IconBoard = mask("board");
export const IconPlay = mask("play");
export const IconPlus = mask("plus");
export const IconWallet = mask("wallet");
export const IconPencil = mask("pencil");
export const IconShare = mask("share");
export const IconStore = mask("store");
