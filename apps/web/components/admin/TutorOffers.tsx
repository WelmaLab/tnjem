"use client";
import { useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { bilingual } from "@/lib/i18n";
import { getTutorOffersAsAdmin } from "@/app/actions-pro";
import { formatNumericDate, type AdminOfferRow, type AdminSubscriptionRow, type SubscriptionStatus } from "@tnajem/shared";

/* An admin's READ-ONLY view of a tutor's monthly offers and the subscriptions to
   them (espace prof v2 · pro, phase 7 — spec item 6). Beside growth's
   <TutorPromotions> on /admin/accounts, and built the same way: reading who
   subscribes to whom is a disclosure, so it is the admin's explicit click, never
   loaded with the lookup, and the API logs it before it answers ("offers.read").
   Students by first name only. Nothing here changes anything. */

const copy = bilingual({
  fr: {
    show: "Voir ses offres et abonnements",
    loading: "Chargement…",
    title: "Offres mensuelles et abonnements (lecture seule)",
    logged: "Cette consultation est enregistrée dans le journal admin.",
    offersT: "Offres",
    subsT: "Abonnements",
    noOffers: "Aucune offre mensuelle.",
    noSubs: "Aucun abonnement.",
    error: "Impossible de charger les offres. Réessaie.",
    offer: (sessions: number, price: number) => `${sessions} séance${sessions > 1 ? "s" : ""} / mois · ${price} TND / mois`,
    offerState: (o: AdminOfferRow): string => (o.archived ? "Archivée" : o.active ? "Visible" : "Masquée"),
    statuses: { requested: "Demandé", active: "Actif", paused: "En pause", cancelled: "Annulé", expired: "Expiré" } as Record<SubscriptionStatus, string>,
    someone: "Un élève",
    sub: (s: AdminSubscriptionRow) => `${s.sessionsPerMonth} séance${s.sessionsPerMonth > 1 ? "s" : ""} / mois · ${s.priceTnd} TND / mois`,
    promo: (p: number) => `−${p} %`,
    requested: (d: string) => `demandé le ${d}`,
    period: (from: string, to: string) => `du ${from} au ${to}`,
    confirmed: (d: string) => `confirmé le ${d} (paiement reçu hors Tnajem)`,
    cancelled: (d: string) => `annulé le ${d}`,
  },
  ar: {
    show: "شوف العروض والاشتراكات متاعو",
    loading: "قاعد يتحمّل…",
    title: "العروض الشهرية والاشتراكات (قراية برك)",
    logged: "القراية هاذي تتسجّل في سجلّ الأدمين.",
    offersT: "العروض",
    subsT: "الاشتراكات",
    noOffers: "ما فمّاش عرض شهري.",
    noSubs: "ما فمّاش اشتراك.",
    error: "ما نجّمناش نحمّلو العروض. عاود.",
    offer: (sessions: number, price: number) => `${sessions} حصة في الشهر · ${price} د.ت في الشهر`,
    offerState: (o: AdminOfferRow) => (o.archived ? "مؤرشف" : o.active ? "ظاهر" : "مخبّي"),
    statuses: { requested: "مطلوب", active: "فعّال", paused: "موقّف", cancelled: "ملغى", expired: "وفى" } as Record<SubscriptionStatus, string>,
    someone: "تلميذ",
    sub: (s: AdminSubscriptionRow) => `${s.sessionsPerMonth} حصة في الشهر · ${s.priceTnd} د.ت في الشهر`,
    promo: (p: number) => `⁦−${p} %⁩`,
    requested: (d: string) => `مطلوب نهار ${d}`,
    period: (from: string, to: string) => `من ${from} حتى لـ ${to}`,
    confirmed: (d: string) => `مأكّد نهار ${d} (الخلاص وصل برّا Tnajem)`,
    cancelled: (d: string) => `ملغى نهار ${d}`,
  },
});

export function TutorOffers({ tutorId }: { tutorId: string }) {
  const { locale } = useLocale();
  const c = copy[locale];
  const [state, setState] = useState<"idle" | "loading" | "error" | "done">("idle");
  const [offers, setOffers] = useState<AdminOfferRow[]>([]);
  const [subs, setSubs] = useState<AdminSubscriptionRow[]>([]);

  async function load() {
    setState("loading");
    try {
      const res = await getTutorOffersAsAdmin(tutorId);
      if (!res.ok) {
        setState("error");
        return;
      }
      setOffers(res.offers);
      setSubs(res.subscriptions);
      setState("done");
    } catch {
      setState("error");
    }
  }

  if (state !== "done") {
    return (
      <div className="flex flex-col gap-2" data-e2e="admin-offers">
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
    <section className="flex flex-col gap-3" aria-labelledby="admin-offers-t" data-e2e="admin-offers">
      <h3 id="admin-offers-t" className="font-bold text-[15px]">{c.title}</h3>
      <p className="muted text-[13px]">{c.logged}</p>

      <div className="flex flex-col gap-1.5">
        <h4 className="font-bold text-[14px]">{c.offersT}</h4>
        {offers.length === 0 ? (
          <p className="muted text-[14px]">{c.noOffers}</p>
        ) : (
          <ul className="flex flex-col gap-1.5" role="list">
            {offers.map((o) => (
              <li key={o.id} className="text-[14px] leading-[1.6]" data-e2e="admin-offer-row">
                <b>{o.title}</b> · {c.offer(o.sessionsPerMonth, o.priceTnd)} · {c.offerState(o)}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <h4 className="font-bold text-[14px]">{c.subsT}</h4>
        {subs.length === 0 ? (
          <p className="muted text-[14px]">{c.noSubs}</p>
        ) : (
          <ul className="flex flex-col gap-2" role="list">
            {subs.map((s) => (
              <li key={s.id} className="text-[14px] leading-[1.6]" data-e2e="admin-sub-row" data-status={s.status}>
                <b>{s.studentFirstName ?? c.someone}</b> · {s.offerTitle} · {c.statuses[s.status]}
                <div className="muted text-[13px]">
                  {c.sub(s)}
                  {s.promotionPercent ? <> · <bdi dir="ltr">{c.promo(s.promotionPercent)}</bdi></> : null}
                  {" · "}
                  {c.requested(formatNumericDate(s.requestedAt))}
                  {s.confirmedAt && <> · {c.confirmed(formatNumericDate(s.confirmedAt))}</>}
                  {s.periodStart && s.periodEnd && <> · {c.period(formatNumericDate(s.periodStart), formatNumericDate(s.periodEnd))}</>}
                  {s.cancelledAt && <> · {c.cancelled(formatNumericDate(s.cancelledAt))}</>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
