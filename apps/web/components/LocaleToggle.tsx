"use client";
import "./LocaleToggle.css";
import { useLocale } from "./LocaleProvider";

/* FR ⇄ AR switch. Two labels ship in the markup and CSS picks one, so the
   compact header variant costs no JS and can't hydrate-mismatch:
     • default  → « Français » / « العربية »   (settings, wide surfaces)
     • compact  → « FR » / « ع » under 1140px   (header: at 320px the brand +
                  full toggle + burger overflow the row, and between 1024 and
                  1140px the full toggle crowds the nav links + CTA)
   Page-scoped CSS is prefixed `qlt-` and lives in ./LocaleToggle.css (home v2 · G:
   it was an inline <style> shipped in every page's HTML and in the JS bundle).
   It is UNLAYERED, so it wins over globals.css's @layer components. */


export function LocaleToggle({ onBlue, compact }: { onBlue?: boolean; compact?: boolean }) {
  const { locale, setLocale } = useLocale();
  const wrap = onBlue
    ? { background: "rgba(255,255,255,.16)", border: "1px solid rgba(255,255,255,.25)" }
    : { background: "var(--paper)", border: "1px solid var(--line)" };

  return (
    <>
      <div className={`qlt${compact ? " qlt-compact" : ""}`} style={wrap}>
        {(["fr", "ar"] as const).map((l) => {
          const on = locale === l;
          return (
            <button
              key={l}
              type="button"
              onClick={() => setLocale(l)}
              aria-pressed={on}
              lang={l}
              aria-label={l === "fr" ? "Français" : "العربية"}
              style={{
                fontFamily: l === "ar" ? "var(--fa)" : "var(--fb)",
                /* UI Option A (A3): the selected language is a STATE, so it is cobalt on
                   blue50 — not a near-black button. On the blue hero it stays white. */
                background: on ? (onBlue ? "#fff" : "var(--blue50)") : "transparent",
                color: on ? (onBlue ? "var(--ink)" : "var(--blue)") : onBlue ? "#fff" : "var(--muted)",
              }}
            >
              <span className="qlt-long">{l === "fr" ? "Français" : "العربية"}</span>
              <span className="qlt-short" aria-hidden="true">{l === "fr" ? "FR" : "ع"}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}
