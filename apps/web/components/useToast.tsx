"use client";
import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/* Lightweight toast: returns a JSX node to render + a showToast(msg) function.
   Replaces blocking alert() calls. Uses the .toast class from globals.css. */
export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const showToast = useCallback((m: string) => {
    setMsg(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 2800);
  }, []);

  const toast = msg ? <Toast>{msg}</Toast> : null;

  return { toast, showToast };
}

/* ── live-fixes-3 · D1 — A TOAST NEVER SITS UNDER A BAR ─────────────────────────
   Live case: an unverified prof pressed « Publier la classe », and the refusal toast
   came up exactly where the pinned action bar is (both at the bottom edge), so the
   click looked dead. Every page with a bar pinned to the bottom had the same trap:
   the action bar and the phone tab bar of the prof space, the sticky « Réserver »
   bars of the storefront and of a class page.

   The toast now sits 16px above whatever is pinned to the bottom of the screen:
     bottom = max(28px + safe area,  bar height + 16px)
   where "bar height" is measured from the bar's top edge to the bottom of the
   screen — so it already holds the safe-area inset the bar pads itself with (the
   same border box the action bar publishes as --aps-bar-h). In the prof space the
   CSS also reads --aps-bottom (built from --aps-bar-h and the tab bar), so the very
   first frame is right before anything is measured; see globals.css,
   "live-fixes-3 · booking".

   Measured, not guessed, because the bars vary: the action bar's status line wraps
   on a phone, the storefront bar grows a note inside 48 h, a sticky bar is only at
   the bottom edge once it is stuck. Re-measured on scroll, resize and whenever a
   bar changes size while the toast is up. */
export const BOTTOM_BARS = ".aps-actionbar, .aps-tabs, .sf-mcta, .cd-mobile-cta, .tabbar, .barbtn";

/** How much of the bottom of the screen the pinned bars cover, in px (0: none). */
function bottomCover(): number {
  const vh = document.documentElement.clientHeight;
  let cover = 0;
  for (const el of document.querySelectorAll<HTMLElement>(BOTTOM_BARS)) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue; // display:none (e.g. the tab bar on a computer)
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || (cs.position !== "fixed" && cs.position !== "sticky")) continue;
    // On screen and reaching the bottom band, where the toast would otherwise land.
    if (r.top >= vh || r.bottom < vh - 96) continue;
    cover = Math.max(cover, Math.ceil(vh - r.top));
  }
  return cover;
}

/** THE toast element. Every toast in the app renders through this (useToast, and the
    follow button and share sheet, which keep their own timers). */
export function Toast({ children }: { children: ReactNode }) {
  const [cover, setCover] = useState(0);
  /* Before paint: a toast that first flashes under the bar and then jumps is the bug
     with extra steps. */
  useLayoutEffect(() => {
    const place = () => setCover(bottomCover());
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, { passive: true });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    if (ro) for (const el of document.querySelectorAll(BOTTOM_BARS)) ro.observe(el);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place);
      ro?.disconnect();
    };
  }, []);
  return (
    <div className="toast" role="status" aria-live="polite" data-e2e="toast" style={{ "--toast-bar": `${cover}px` } as CSSProperties}>
      {children}
    </div>
  );
}
