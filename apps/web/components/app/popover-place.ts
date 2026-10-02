/* live-fixes-1 · pages — WHERE A POPOVER ANCHORED TO A FIELD FITS (the date picker's
   calendar, the « Séance liée » list…).

   The prof space pins three bars over the page: the sticky top bar (.aps-top), the
   sticky action bar of a form (.aps-actionbar) and, on a phone, the fixed tab bar
   (.aps-tabs). A popover that opens below a field near the bottom of the screen ran
   under the action bar and was cut off. The room that counts is the room between
   those bars: it opens below when it fits there (or when below is still the larger
   side), above otherwise. Measured, not guessed: the bars' heights change with the
   breakpoint and the safe-area inset. */

export type Placement = "below" | "above";

/** The free band around `anchor`: from the lowest bar above it to the highest bar below it. */
export function freeBand(anchor: Element): { top: number; bottom: number; rect: DOMRect } {
  const rect = anchor.getBoundingClientRect();
  let top = 0;
  let bottom = window.innerHeight;
  document.querySelectorAll<HTMLElement>(".aps-top, .aps-actionbar, .aps-tabs").forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return;
    const b = el.getBoundingClientRect();
    if (b.height === 0) return;
    if (b.bottom <= rect.top + 1) top = Math.max(top, b.bottom);
    else if (b.top >= rect.bottom - 1) bottom = Math.min(bottom, b.top);
  });
  return { top, bottom, rect };
}

/** Below when `popHeight` fits under the field (or below is still the roomier side), else above. */
export function placePopover(anchor: Element, popHeight: number, gap = 6): Placement {
  const { top, bottom, rect } = freeBand(anchor);
  const below = bottom - rect.bottom - gap;
  const above = rect.top - top - gap;
  return below >= popHeight || below >= above ? "below" : "above";
}
