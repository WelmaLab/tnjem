import type { FocusEvent } from "react";

/** live-fixes-2 · F — a disclosure (the avatar menu, the « + », the bell, the « ? ») closes
    when keyboard focus moves to a control OUTSIDE it, so no panel is left open over the
    page — under it sat the very field the Tab had just reached. Put it on the wrapper's
    onBlur (React's onBlur bubbles: it is focusout).

    Only for a real destination: a tap that moves focus nowhere (Safari does not focus a
    tapped link) must not close the menu before its click lands — the mousedown /
    pointerdown-outside handlers deal with pointers. */
export function closeOnLeave(e: FocusEvent<HTMLElement>, close: () => void) {
  const to = e.relatedTarget as Node | null;
  if (to && !e.currentTarget.contains(to)) close();
}
