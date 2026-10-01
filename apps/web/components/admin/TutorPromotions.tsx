"use client";
import { useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { bilingual } from "@/lib/i18n";
import { getTutorPromotionsAsAdmin } from "@/app/actions-growth";
import { formatNumericDate, type PromoScope, type TutorPromotionRow } from "@tnajem/shared";

/* An admin's READ-ONLY view of a tutor's promotions (espace prof v2 · growth, phase 5).

   Shown on /admin/accounts under a tutor account. Reading another person's
   promotions is a disclosure, so it is the admin's explicit click — never loaded
   with the lookup — and the API logs it before it answers (auditAdminStrict
   "promotions.read", routes/promotions.ts). There is nothing to change here: a
   promotion is the tutor's; this list exists so support can see what a student saw. */

const copy = bilingual({
  fr: {
    show: "Voir ses promotions",
    loading: "Chargement…",
    title: "Promotions (lecture seule)",
    logged: "Cette consultation est enregistrée dans le journal admin.",
    empty: "Aucune promotion.",
    error: "Impossible de charger les promotions. Réessaie.",
    scopes: { all: "toute la page", class: "une séance", pack: "une fiche", monthly: "l'abonnement mensuel" } as Record<PromoScope, string>,
    states: { live: "En cours", scheduled: "Programmée", paused: "En pause", ended: "Terminée", expired: "Expirée", exhausted: "Épuisée" } as Record<TutorPromotionRow["state"], string>,
    publicTag: "publique",
    line: (pct: number, scope: string) => `−${pct} % sur ${scope}`,
    window: (from: string, to: string) => `du ${from} au ${to}`,
    uses: (n: number, max: number | null) => (max ? `${n} / ${max} utilisations` : `${n} utilisation${n > 1 ? "s" : ""}`),
  },
  ar: {
    show: "شوف البرومسيونات متاعو",
    loading: "قاعد يتحمّل…",
    title: "البرومسيونات (قراية برك)",
    logged: "القراية هاذي تتسجّل في سجلّ الأدمين.",
    empty: "ما فمّاش برومسيون.",
    error: "ما نجّمناش نحمّلو البرومسيونات. عاود.",
    scopes: { all: "الصفحة الكل", class: "حصة وحدة", pack: "فيشة وحدة", monthly: "الاشتراك الشهري" } as Record<PromoScope, string>,
    states: { live: "ماشية", scheduled: "مبرمجة", paused: "موقّفة", ended: "كملت", expired: "وفات", exhausted: "تكمّلت" } as Record<TutorPromotionRow["state"], string>,
    publicTag: "للناس الكل",
    line: (pct: number, scope: string) => `\u2066−${pct} %\u2069 على ${scope}`,
    window: (from: string, to: string) => `من ${from} حتى لـ ${to}`,
    uses: (n: number, max: number | null) => (max ? `${n} / ${max} استعمال` : `${n} استعمال`),
  },
});

export function TutorPromotions({ tutorId }: { tutorId: string }) {
  const { locale } = useLocale();
  const c = copy[locale];
  const [state, setState] = useState<"idle" | "loading" | "error" | "done">("idle");
  const [rows, setRows] = useState<TutorPromotionRow[]>([]);

  async function load() {
    setState("loading");
    try {
      const res = await getTutorPromotionsAsAdmin(tutorId);
      if (!res.ok) { setState("error"); return; }
      setRows(res.promotions);
      setState("done");
    } catch {
      setState("error");
    }
  }

  if (state === "idle" || state === "loading" || state === "error") {
    return (
      <div className="flex flex-col gap-2" data-e2e="admin-promotions">
        <div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()} disabled={state === "loading"}>
            {state === "loading" ? c.loading : c.show}
          </button>
        </div>
        {state === "error" && <p role="alert" className="text-[14px] text-rose">{c.error}</p>}
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-2" aria-labelledby="admin-promos-t" data-e2e="admin-promotions">
      <h3 id="admin-promos-t" className="font-bold text-[15px]">{c.title}</h3>
      <p className="muted text-[13px]">{c.logged}</p>
      {rows.length === 0 ? (
        <p className="muted text-[14px]">{c.empty}</p>
      ) : (
        <ul className="flex flex-col gap-2" role="list">
          {rows.map((p) => (
            <li key={p.id} className="text-[14px] leading-[1.6]" data-e2e="admin-promo-row" data-state={p.state}>
              <b>{c.line(p.percent, c.scopes[p.scope])}</b>
              {" · "}
              {p.code ? <span dir="ltr" className="font-bold">{p.code}</span> : c.publicTag}
              {" · "}
              {c.states[p.state]}
              <div className="muted text-[13px]">
                {c.window(formatNumericDate(p.startsAt), formatNumericDate(p.endsAt))} · {c.uses(p.uses, p.maxUses)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
