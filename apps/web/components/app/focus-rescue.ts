"use client";
import { useEffect } from "react";

/* live-fixes-2 · F — FOCUS NEVER FALLS TO THE PAGE'S BODY.

   When the control that has focus is removed — the row a confirmed « Retirer » took
   away, the « Annuler » of a class that is now cancelled (its row moves to « Passées »),
   a request accepted — the browser drops focus on <body>. A screen reader loses its
   place, and in some browsers the next Tab starts over from the skip link.

   Focus goes instead where the next Tab would have gone: the first control AFTER the
   place the removed one held (what is there now — the next row, or the section the
   class moved to), else the last control before it, within the same region (main, a
   dialog, the sidebar…), else <main>. The place is remembered as the elements around
   the control at every level (its next and previous siblings, its parent's, …), so it
   survives the control's own row going away.

   It only acts when focus is on <body> AND the control that had it is gone — a page
   that moves focus itself is left alone — and one task later, so a Tab that removed
   what it left (a Select's list) has already landed. */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const REGION = "dialog, main, nav, aside, header, [role=dialog]";

const usable = (el: HTMLElement) =>
  el.getClientRects().length > 0 && // not display:none, nor inside it
  !el.closest("[hidden], [inert], dialog:not([open])") &&
  getComputedStyle(el).visibility !== "hidden";

type Place = { control: Element; region: Element | null; after: Element[]; before: Element[] };

function placeOf(control: Element): Place {
  const after: Element[] = [];
  const before: Element[] = [];
  for (let n: Element | null = control; n && n !== document.body; n = n.parentElement) {
    if (n.nextElementSibling) after.push(n.nextElementSibling);
    if (n.previousElementSibling) before.push(n.previousElementSibling);
  }
  return { control, region: control.closest(REGION), after, before };
}

function rescueFocus(p: Place) {
  const main = document.getElementById("main");
  const region = p.region?.isConnected ? p.region : main;
  if (region) {
    const all = [...region.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(usable);
    const anchorAfter = p.after.find((a) => a.isConnected && region.contains(a));
    if (anchorAfter) {
      const hit = all.find((el) => el === anchorAfter || anchorAfter.contains(el) || (anchorAfter.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
      if (hit) return hit.focus();
    }
    const anchorBefore = p.before.find((a) => a.isConnected && region.contains(a));
    if (anchorBefore) {
      // The LAST one before it (no Array#findLast: older Android WebViews lack it).
      const hit = [...all].reverse().find((el) => el === anchorBefore || anchorBefore.contains(el) || (anchorBefore.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING));
      if (hit) return hit.focus();
    }
  }
  main?.focus();
}

export function useFocusRescue() {
  useEffect(() => {
    let place: Place | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onFocusIn = (e: FocusEvent) => {
      place = placeOf(e.target as Element);
    };
    const check = () => {
      const p = place;
      if (!p || p.control.isConnected) return;
      const active = document.activeElement;
      if (active && active !== document.body) return;
      place = null;
      rescueFocus(p);
    };
    const mo = new MutationObserver(() => {
      if (!place || place.control.isConnected) return;
      clearTimeout(timer);
      timer = setTimeout(check, 0);
    });
    document.addEventListener("focusin", onFocusIn);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      mo.disconnect();
      clearTimeout(timer);
    };
  }, []);
}
