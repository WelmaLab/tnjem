"use client";
import { useState } from "react";
import { setFreeFirstSession } from "@/app/actions";
import { bilingual } from "@/lib/i18n";
import { useLocale } from "@/components/LocaleProvider";
import { Switch } from "@/components/app/Switch";

/* ── Free first session — the tutor's own opt-in ─────────────────────────────
   Réglages › Vitrine (espace prof v2 · phase 6). The id="free-first" anchor is what
   the new-class form links to while the option is off.

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
    ffTitle: "1ʳᵉ séance offerte sur ma vitrine",
    ffBody:
      "Si tu l'actives, ta page annonce que la première séance est offerte — et tu la proposes classe par classe en créant une séance. Tant que c'est désactivé, Tnajem ne promet rien à ta place.",
    ffError: "Ça n'a pas marché. Réessaie.",
  },
  ar: {
    ffTitle: "الحصة الأولى فابور في واجهتي",
    ffBody:
      "كان تفعّلها، صفحتك تقول إلّي الحصة الأولى مجانية — وتختارها حصة بحصة وقتلي تعمل وحدة. مادامها مطفية، Tnajem ما توعد بحتى شي في بلاصتك.",
    ffError: "ما مشاتش. عاود حاول.",
  },
});

export function FreeFirstToggle({ initial, onSaved }: { initial: boolean; onSaved?: (on: boolean) => void }) {
  const { locale } = useLocale();
  const c = copy[locale];
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function toggle(next: boolean) {
    if (busy) return;
    setOn(next);
    setBusy(true);
    setFailed(false);
    try {
      const res = await setFreeFirstSession(next);
      if (!res.ok) {
        setOn(!next);
        setFailed(true);
      } else {
        onSaved?.(next);
      }
    } catch {
      setOn(!next);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div id="free-first" className="st-row" style={{ scrollMarginTop: 84 }} data-e2e="free-first-toggle">
      <div className="min-w-0 flex-1">
        <div className="st-row-t">{c.ffTitle}</div>
        <p id="ff-help" className="st-row-b">{c.ffBody}</p>
        {failed && (
          <p role="alert" className="text-[13px] mt-1.5" style={{ color: "var(--rose)" }}>
            {c.ffError}
          </p>
        )}
      </div>
      <Switch checked={on} onChange={toggle} label={c.ffTitle} describedBy="ff-help" disabled={busy} />
    </div>
  );
}
