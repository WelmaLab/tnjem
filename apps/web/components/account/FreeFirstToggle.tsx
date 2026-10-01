"use client";
import { useState } from "react";
import { setFreeFirstSession } from "@/app/actions";
import { bilingual } from "@/lib/i18n";
import { useLocale } from "@/components/LocaleProvider";

/* ── Free first session — the tutor's own opt-in ─────────────────────────────
   Moved here from the dashboard by espace prof v2 (phase 1); phase 6 puts it in
   Réglages › Vitrine. The id="free-first" anchor is what the new-class form links
   to while the option is off.

   Before Step 6 the platform said "Première séance offerte" on every storefront,
   in the JSON-LD Offer and in llms.txt, on behalf of every tutor — because
   classes.is_free_first defaulted to true and nobody had ever been asked. Terms
   §5 has always said a tutor "peut choisir". This is where they choose.

   OPTIMISTIC, then reconciled. The switch flips immediately because a toggle that
   waits on a network round trip over Tunisian 3G feels broken; if the call fails
   it snaps BACK and says so, rather than leaving the UI claiming a state the
   server never accepted. That direction matters: the failure mode to avoid is a
   tutor believing they turned it off when they did not. */

const copy = bilingual({
  fr: {
    ffTitle: "Première séance offerte",
    ffBody:
      "Si tu l'actives, ta page annonce que la première séance est offerte — et tu peux la réserver classe par classe en créant une séance. Tant que c'est désactivé, Tnajem ne promet rien à ta place.",
    ffOn: "Activée",
    ffOff: "Désactivée",
    ffSaving: "Enregistrement…",
    ffError: "Ça n'a pas marché. Réessaie.",
  },
  ar: {
    ffTitle: "الحصة الأولى مجانية",
    ffBody:
      "كان تفعّلها، صفحتك تقول إلّي الحصة الأولى مجانية — وتنجّم تختارها حصة بحصة وقتلي تعمل وحدة. مادامها مطفية، تنجّم ما توعدش في بلاصتك.",
    ffOn: "مفعّلة",
    ffOff: "مطفية",
    ffSaving: "قاعد يتسجّل…",
    ffError: "ما مشاتش. عاود حاول.",
  },
});

export function FreeFirstToggle({ initial }: { initial: boolean }) {
  const { locale } = useLocale();
  const c = copy[locale];
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function toggle() {
    if (busy) return;
    const next = !on;
    setOn(next);
    setBusy(true);
    setFailed(false);
    try {
      const res = await setFreeFirstSession(next);
      if (!res.ok) {
        setOn(!next);
        setFailed(true);
      }
    } catch {
      setOn(!next);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div id="free-first" className="panel panel-pad" style={{ scrollMarginTop: 84 }}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[16px] font-bold mb-1">{c.ffTitle}</h2>
          <p className="text-[13px] text-muted leading-[1.6]">{c.ffBody}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={c.ffTitle}
          onClick={toggle}
          disabled={busy}
          /* min-h-11: it is a role="switch" that turns a public promise about money
             on and off — the last control that should be easy to mis-tap. */
          className="flex items-center gap-2.5 flex-none rounded-[12px] px-3 py-2 text-[14px] font-semibold min-h-11"
          style={{
            border: on ? "2px solid var(--blue)" : "1px solid var(--line)", // Phase A+ (U1): a selected state is cobalt
            background: on ? "var(--blue50)" : "var(--paper)",
            color: "inherit",
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.65 : 1,
          }}
        >
          <span
            aria-hidden="true"
            className="w-[22px] h-[22px] rounded-[7px] grid place-items-center flex-none"
            style={{
              border: on ? "none" : "2px solid var(--line)",
              background: on ? "var(--blue)" : "transparent",
              transition: ".15s",
            }}
          >
            {/* Inline, with an explicit white stroke: the shared <Check /> inherits
                currentColor, which on a filled box is dark-on-dark. */}
            {on && (
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="5 13 10 18 19 7" />
              </svg>
            )}
          </span>
          {busy ? c.ffSaving : on ? c.ffOn : c.ffOff}
        </button>
      </div>
      {failed && (
        <p role="alert" className="text-[13px] mt-2.5" style={{ color: "var(--rose)" }}>
          {c.ffError}
        </p>
      )}
    </div>
  );
}
