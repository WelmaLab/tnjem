"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  MONTHLY_PAYMENT_NOTE, PAYMENT_STORY, formatNumericDate, priceWithPromotion,
  type MySubscription, type PublicOffer, type PublicPromotion,
} from "@tnajem/shared";
import { Link, useLocalizedRouter } from "@/components/Link";
import { useLocale } from "@/components/LocaleProvider";
import { Tag } from "@/components/ui";
import { Calendar, Check } from "@/components/icons";
import { bilingual } from "@/lib/i18n";
import { cancelMySubscription, getMySubscription, requestSubscription } from "@/app/actions-growth";
import { PromoPrice } from "@/components/pricing/PromoPrice";
import { useAppliedPromo, useNow } from "@/components/pricing/promo-store";

/* "S'ABONNER — X TND / MOIS" — Espace prof v2 · Phase 5 A.3 (student side).

   The tutor's monthly offers on their public page. Rendered by the ISR page with
   anonymous data (the offers, the public promotions), and made personal HERE, in
   the browser: this student's own subscription status, renewal date and the
   cancel button come from GET /subscriptions/mine after paint — never in the
   cached HTML.

   PAYMENTS ARE OFF: "S'abonner" sends a REQUEST; the student pays the tutor
   directly and the tutor confirms it by hand. The spec's sentence says so beside
   the button, with the "Bientôt" tag (MONTHLY_PAYMENT_NOTE, @tnajem/shared). The
   price is the one the API will write on the request: the best promotion via
   pricing.ts, the visitor's ?promo= code included.

   /{slug}?offre=mensuel (the share sheet's "offer" link) scrolls here and marks
   the section. Signed out → /auth?next=<this page>?offre=mensuel. Cancelling asks
   for confirmation first. The button is BLUE: the page's one ochre action is
   booking a class. */

const copy = bilingual({
  fr: {
    title: "Abonnement mensuel",
    lead: "Un forfait de séances chaque mois avec ce prof.",
    sessions: (n: number) => (n === 1 ? "1 séance par mois" : `${n} séances par mois`),
    subscribe: (p: number) => `S'abonner — ${p} TND / mois`,
    requested: (d: string) => `Demande envoyée le ${d}. Ton prof la confirme dès qu'il a reçu ton paiement.`,
    active: "Abonné",
    activeLine: (used: number, n: number, end: string) => `${used} / ${n} séances utilisées ce mois · renouvellement le ${end}`,
    activeHint: "Réserve ses séances comme d'habitude : elles sont comprises dans ton abonnement.",
    paused: "Ton abonnement est en pause pour l'instant.",
    ended: (d: string) => `Ton dernier abonnement s'est terminé le ${d}.`,
    other: "Tu as déjà un abonnement avec ce prof.",
    cancelRequest: "Annuler la demande",
    cancelSub: "Annuler l'abonnement",
    confirmCancel: "Annuler pour de bon ?",
    yes: "Oui, annuler",
    no: "Non",
    cancelled: "C'est annulé.",
    sent: "Demande envoyée à ton prof.",
    needsConsent: "Pour t'abonner, il faut d'abord l'accord de ton parent ou tuteur.",
    consentCta: "Donner l'accord",
    adultsOnly: "Le pilote est réservé aux 18 ans et plus : ce compte ne peut pas s'abonner pour l'instant.",
    studentsOnly: "Seul un compte élève peut s'abonner.",
    unavailable: "Cette offre n'est plus disponible.",
    failed: "Ça n'a pas marché. Réessaie dans un instant.",
  },
  ar: {
    title: "اشتراك شهري",
    lead: "عدد حصص كل شهر مع هالأستاذ.",
    sessions: (n: number) => (n === 1 ? "حصة وحدة في الشهر" : `${n} حصص في الشهر`),
    subscribe: (p: number) => `اشترك — ${p} د.ت في الشهر`,
    requested: (d: string) => `الطلب تبعث نهار ${d}. أستاذك يأكّدو كيف يوصلو الخلاص متاعك.`,
    active: "مشترك",
    activeLine: (used: number, n: number, end: string) => `${used} / ${n} حصص استعملتهم هالشهر · التجديد نهار ${end}`,
    activeHint: "احجز حصصو كيف العادة : راهم محسوبين في الاشتراك متاعك.",
    paused: "الاشتراك متاعك موقّف توّا.",
    ended: (d: string) => `الاشتراك الأخير متاعك وفى نهار ${d}.`,
    other: "عندك اشتراك من قبل مع هالأستاذ.",
    cancelRequest: "بطّل الطلب",
    cancelSub: "بطّل الاشتراك",
    confirmCancel: "تبطّل نهائيًا؟",
    yes: "إيه، بطّل",
    no: "لا",
    cancelled: "تبطّل.",
    sent: "الطلب تبعث لأستاذك.",
    needsConsent: "باش تشترك، لازم موافقة وليّك قبل.",
    consentCta: "أعطي الموافقة",
    adultsOnly: "فترة التجربة كان للي عندهم 18 سنة ولا أكثر : الحساب هذا ما ينجّمش يشترك توّا.",
    studentsOnly: "كان حساب تلميذ ينجّم يشترك.",
    unavailable: "العرض هذا ما عادش موجود.",
    failed: "ما مشاتش. عاود حاول بعد شويّة.",
  },
});

const LIVE = ["requested", "active", "paused"];

export function OffersSection({
  slug,
  offers,
  promotions,
  renderedAt,
}: {
  slug: string;
  offers: PublicOffer[];
  promotions: PublicPromotion[];
  renderedAt: string;
}) {
  const { locale } = useLocale();
  const c = copy[locale];
  const router = useLocalizedRouter();
  const pathname = usePathname();
  const code = useAppliedPromo(slug);
  const now = useNow(renderedAt);
  const sectionRef = useRef<HTMLElement>(null);
  const [mine, setMine] = useState<MySubscription | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState<null | { text: string; consent?: boolean }>(null);
  const [flash, setFlash] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await getMySubscription(slug);
      setSignedIn(res.ok);
      setMine(res.ok ? (res.subscription ?? null) : null);
    } catch {
      setSignedIn(null);
    }
  }, [slug]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // /{slug}?offre=mensuel — the shared "offer" link lands on this section.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("offre") !== "mensuel") return;
    sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 2600);
    return () => clearTimeout(t);
  }, []);

  const live = mine && LIVE.includes(mine.status) ? mine : null;
  const priceOf = (o: PublicOffer) =>
    priceWithPromotion({ kind: "monthly", id: o.id, priceTnd: o.price_tnd }, code ? [...promotions, code.promotion] : promotions, { now, code: code?.code ?? null }).finalTnd;

  async function subscribe(o: PublicOffer) {
    setNote(null);
    if (signedIn === false) {
      const url = new URL(`${pathname}${window.location.search}`, window.location.origin);
      url.searchParams.set("offre", "mensuel");
      router.push(`/auth?next=${encodeURIComponent(`${url.pathname}${url.search}`)}`);
      return;
    }
    setBusy(o.id);
    try {
      const res = await requestSubscription({ offerId: o.id, promoCode: code?.code ?? null });
      if (res.ok && res.subscription) {
        setMine(res.subscription);
        setNote({ text: c.sent });
      } else if (res.error === "not-authenticated") {
        setSignedIn(false);
        await subscribe(o);
      } else if (res.error === "needs-consent") setNote({ text: c.needsConsent, consent: true });
      else if (res.error === "adults-only") setNote({ text: c.adultsOnly });
      else if (res.error === "students-only" || res.error === "own-offer") setNote({ text: c.studentsOnly });
      else if (res.error === "already-subscribed") await refresh();
      else if (res.error === "unavailable") setNote({ text: c.unavailable });
      else setNote({ text: c.failed });
    } catch {
      setNote({ text: c.failed });
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    if (!live) return;
    setBusy("cancel");
    try {
      const res = await cancelMySubscription(live.id);
      if (res.ok) {
        setConfirming(false);
        setNote({ text: c.cancelled });
        await refresh();
      } else setNote({ text: c.failed });
    } catch {
      setNote({ text: c.failed });
    } finally {
      setBusy(null);
    }
  }

  if (offers.length === 0 && !live) return null;

  return (
    <section ref={sectionRef} id="offres" className={`of-sec${flash ? " is-flash" : ""}`} aria-labelledby="of-title" data-e2e="offers">
      <div className="of-head">
        <h2 id="of-title" className="sf-h2">{c.title}</h2>
        <p className="of-lead">{c.lead}</p>
      </div>

      <ul className="of-list" role="list">
        {offers.map((o) => {
          const isMine = live?.offerId === o.id;
          return (
            <li key={o.id} className={`u-card u-card-pad of-card${isMine ? " is-mine" : ""}`} data-e2e="offer-card">
              <div className="of-top">
                <div className="min-w-0">
                  <h3 className="of-name">{o.title}</h3>
                  <div className="of-sessions"><Calendar />{c.sessions(o.sessions_per_month)}</div>
                </div>
                <PromoPrice
                  slug={slug}
                  item={{ kind: "monthly", id: o.id, priceTnd: o.price_tnd }}
                  promotions={promotions}
                  renderedAt={renderedAt}
                  variant="offer"
                  unit="month"
                />
              </div>

              {isMine && live ? (
                <div className="of-status" data-e2e="subscription-status" data-status={live.status}>
                  {live.status === "active" && (
                    <>
                      <p className="of-state"><span className="tag tag-neutral"><Check />{c.active}</span></p>
                      <p className="of-line">
                        {c.activeLine(live.usedThisPeriod, live.sessionsPerMonth, live.periodEnd ? formatNumericDate(live.periodEnd) : "—")}
                      </p>
                      <p className="of-line">{c.activeHint}</p>
                    </>
                  )}
                  {live.status === "requested" && <p className="of-line">{c.requested(formatNumericDate(live.requestedAt))}</p>}
                  {live.status === "paused" && <p className="of-line">{c.paused}</p>}
                  {live.status !== "paused" && (
                    confirming ? (
                      <div className="of-confirm" role="group" aria-label={c.confirmCancel}>
                        <span className="of-line">{c.confirmCancel}</span>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={cancel} disabled={busy === "cancel"} data-e2e="subscription-cancel-yes">{c.yes}</button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>{c.no}</button>
                      </div>
                    ) : (
                      <button type="button" className="btn btn-ghost btn-sm of-cancel" onClick={() => setConfirming(true)} data-e2e="subscription-cancel">
                        {live.status === "requested" ? c.cancelRequest : c.cancelSub}
                      </button>
                    )
                  )}
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn btn-outline of-cta"
                    onClick={() => subscribe(o)}
                    disabled={Boolean(live) || busy === o.id}
                    aria-busy={busy === o.id}
                    data-e2e="subscribe"
                  >
                    {c.subscribe(priceOf(o))}
                  </button>
                  {live && <p className="of-line">{c.other}</p>}
                </>
              )}
            </li>
          );
        })}
      </ul>

      {mine && !live && mine.periodEnd && <p className="of-line of-ended">{c.ended(formatNumericDate(mine.periodEnd))}</p>}
      {note && (
        <p className="of-msg" role="status">
          {note.text}{" "}
          {note.consent && <Link href={`/auth/consent?next=${encodeURIComponent(pathname)}`}>{c.consentCta}</Link>}
        </p>
      )}

      {/* The spec's sentence (P5.A.3), beside the "Bientôt" tag: nothing is paid on Tnajem today. */}
      <p className="of-note" data-e2e="offer-payment-note">
        <Tag kind="soon">{PAYMENT_STORY[locale].soon}</Tag> {MONTHLY_PAYMENT_NOTE[locale]}
      </p>

      <style dangerouslySetInnerHTML={{ __html: OF_CSS }} />
    </section>
  );
}

const OF_CSS = `
  .of-sec{margin-top:34px;scroll-margin-top:90px;border-radius:var(--r);transition:box-shadow .3s}
  .of-sec.is-flash{box-shadow:0 0 0 3px var(--blue)}
  .of-head{margin-bottom:12px}
  .of-lead{font-size:13.5px;color:var(--muted);margin:4px 0 0;line-height:1.5}
  .of-list{list-style:none;display:grid;gap:10px;margin:0;padding:0}
  .of-card{gap:12px}
  .of-card.is-mine{border-color:var(--blue)}
  .of-top{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap}
  .of-name{font-weight:700;font-size:15px;line-height:1.35;margin:0 0 6px;overflow-wrap:anywhere}
  .of-sessions{display:flex;align-items:center;gap:6px;font-size:13.5px;color:var(--ink2)}
  .of-sessions .ic{width:15px;height:15px;color:var(--blue)}
  .of-cta{min-height:48px;width:100%}
  .of-status{display:grid;gap:8px;justify-items:start}
  .of-state{margin:0}
  .of-state .tag .ic{width:13px;height:13px}
  .of-line{font-size:13px;color:var(--ink2);line-height:1.55;margin:0}
  .of-confirm{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .of-msg{font-size:13.5px;color:var(--ink2);margin:10px 0 0;line-height:1.55}
  .of-msg a{color:var(--blue700);font-weight:700;text-decoration:underline}
  .of-ended{margin-top:10px}
  .of-note{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;color:var(--muted);line-height:1.55;margin:12px 0 0}
`;
