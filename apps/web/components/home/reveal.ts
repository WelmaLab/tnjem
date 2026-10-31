/* home v2 · C — the reveal-on-scroll classes the body sections hand to the shared
   components/Reveal.tsx (it starts visible and only arms a section that is
   off-screen at hydration — the page is complete with JS off). The classes are the
   page's own .lp-rv / .lp-armed (components/home/home.css, with their
   reduced-motion kill-switch), so e2e/home-v2-perf.spec.ts keeps finding them:
   one per section — steps, facts, the tutor band — not per card, and none on the
   CTA banner, as before. */
export const HS_RV = { base: "lp-rv", armedClass: "lp-armed", delayVar: "--lp-d" } as const;
