import type { Config } from "tailwindcss";

/* Tailwind maps onto the existing Tnajem design tokens (globals.css :root) via
   CSS variables, so utilities like bg-cobalt / text-ink / border-line stay in
   sync with the design system. Preflight is OFF — globals.css already provides
   the reset, and preflight would clobber the custom-styled pages. */
const v = (name: string) => `var(--${name})`;

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        ink: v("ink"), ink2: v("ink2"), muted: v("muted"),
        blue: v("blue"), cobalt: v("blue"), blue700: v("blue700"), blue50: v("blue50"),
        sand: v("sand"), cream: v("cream"), paper: v("paper"),
        bg: v("bg"), band: v("band"), // UI Option A (A1): page background + the one band colour
        ochre: v("ochre"), ochre600: v("ochre600"), amber: v("amber"),
        green: v("green"), green50: v("green50"), rose: v("rose"), rose50: v("rose50"),
        line: v("line"), lineCool: v("lineCool"),
        /* Text-safe / white-label-safe variants of the two brand hues. `ochre` and
           `green` are BRAND values and fail WCAG AA as text or under a white label
           (2.78:1 and 3.48:1) — use `-ink` for text on a light surface and `-btn`
           for a solid fill that carries a white label. See globals.css :root. */
        "ochre-ink": v("ochre-ink"), "green-ink": v("green-ink"),
        "ochre-btn": v("ochre-btn"), "green-btn": v("green-btn"),
        "ochre-tint": v("ochre-tint"),
        /* Dark-surface palette — the colours that only exist ON the cobalt/ink
           panels, plus the rose steps used by the alert blocks. See globals.css. */
        blue300: v("blue300"), blue100: v("blue100"), blue900: v("blue900"),
        ink800: v("ink800"), ink900: v("ink900"), ochre300: v("ochre300"),
        mint: v("mint"), mint200: v("mint200"),
        "on-blue": v("on-blue"), "on-blue-soft": v("on-blue-soft"),
        "on-dark": v("on-dark"), "on-dark-soft": v("on-dark-soft"),
        rose700: v("rose700"), rose600: v("rose600"), rose300: v("rose300"), rose200: v("rose200"),
      },
      fontFamily: {
        display: [v("fd")],
        body: [v("fb")],
        ar: [v("fa")],
        num: [v("fn")], // live-fixes-1 · C1: prices and figures (globals.css --fn)
      },
      borderRadius: {
        "brand-sm": "var(--r-s)",
        brand: "var(--r)",
        "brand-lg": "var(--r-l)",
        "brand-xl": "var(--r-xl)",
      },
      boxShadow: {
        "brand-sm": "var(--sh-s)",
        brand: "var(--sh)",
        "brand-lg": "var(--sh-l)",
      },
    },
  },
  plugins: [],
} satisfies Config;
