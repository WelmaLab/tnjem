"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { AppPage, Blocker, EmptyState, ErrorState, PageSkeleton, useShell } from "@/components/app/AppShell";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { ShareButton } from "@/components/share/ShareButton";
import { Field } from "@/components/ui";
import { Calendar, Plus, Users } from "@/components/icons";
import { useToast } from "@/components/useToast";
import { bilingual } from "@/lib/i18n";
import { OFFER_MAX_PER_TUTOR, formatNumericDate, type TutorOfferRow, type TutorSubscriptionRow } from "@tnajem/shared";
import {
  actOnSubscription, archiveOffer, createOffer, getMyOffers, getTutorSubscriptions, updateOffer,
} from "@/app/actions-growth";

/* ABONNEMENTS — Espace prof v2 · Phase 5 A (/dashboard/subscriptions).

   The teacher's monthly offers (at most 3: title, sessions per month 1–31, price
   per month > 0) and the students on them. PAYMENTS ARE OFF: a student asks from
   the public page; the teacher is paid outside Tnajem and confirms by hand —
   « Confirmer (paiement reçu hors Tnajem) » — which starts one month; each next
   month is one click (« Renouveler »). Pause, resume and stop are there; the
   nightly job reminds both sides 3 days before the end and closes what ran out.

   Every rule is the API's (routes/offers.ts); this page shows its answers. The
   student by FIRST NAME only. Destructive steps go through a confirmation dialog;
   the confirmations that mean "I was paid" say so in words. */

const copy = bilingual({
  fr: {
    title: "Abonnements",
    sub: "Un forfait de séances par mois avec tes élèves.",
    note: "Paiement en ligne bientôt : pour l'instant l'élève te paie hors Tnajem. Confirme ici chaque mois, une fois le paiement reçu.",
    bOfflineT: "Ta page n'est pas encore en ligne",
    bOfflineB: "tes offres seront visibles dès que ton compte est vérifié.",
    bOfflineCta: "Envoyer mes documents",
    offers: "Mes offres",
    count: (n: number) => `${n} / ${OFFER_MAX_PER_TUTOR}`,
    newOffer: "Nouvelle offre",
    maxed: `${OFFER_MAX_PER_TUTOR} offres au maximum : archive-en une pour en créer une autre.`,
    emptyT: "Pas encore d'offre mensuelle",
    emptyB: "Propose un nombre de séances par mois à un prix fixe : tes élèves s'abonnent depuis ta page.",
    fTitle: "Nom de l'offre",
    fTitlePh: "ex. Suivi Bac — 4 séances",
    fSessions: "Séances par mois",
    fSessionsHelp: "Entre 1 et 31.",
    fPrice: "Prix par mois (TND)",
    fPriceHelp: "Plus de 0 TND. Tu pourras y ajouter une promotion.",
    save: "Enregistrer",
    create: "Créer l'offre",
    cancel: "Annuler",
    edit: "Modifier",
    archive: "Archiver",
    visible: "Visible sur ma page",
    hidden: "Masquée",
    show: "Afficher sur ma page",
    hide: "Masquer",
    perMonth: (p: number) => `${p} TND / mois`,
    sessions: (n: number) => (n === 1 ? "1 séance par mois" : `${n} séances par mois`),
    live: (n: number) => (n === 0 ? "aucun abonné" : n === 1 ? "1 abonnement en cours" : `${n} abonnements en cours`),
    archiveT: "Archiver cette offre ?",
    archiveB: "Elle disparaît de ta page. Les abonnements en cours continuent jusqu'à la fin de leur mois.",
    requests: "Demandes",
    noRequests: "Aucune demande en attente.",
    requestLine: (offer: string, p: number, d: string) => `${offer} · ${p} TND / mois · demandé le ${d}`,
    promo: (p: number) => `−${p} %`,
    confirm: "Confirmer (paiement reçu hors Tnajem)",
    confirmT: "Tu as reçu le paiement ?",
    confirmB: "L'abonnement démarre aujourd'hui pour un mois. Ne confirme qu'après avoir reçu le paiement de l'élève, hors Tnajem.",
    confirmCta: "Oui, confirmer",
    decline: "Refuser",
    declineT: "Refuser cette demande ?",
    declineB: "L'élève est prévenu. Il pourra refaire une demande plus tard.",
    declineCta: "Refuser",
    active: "Abonnés",
    noActive: "Aucun abonné pour l'instant.",
    used: (u: number, n: number) => `${u} / ${n} séances ce mois`,
    until: (d: string) => `jusqu'au ${d}`,
    ending: "Se termine bientôt",
    paused: "En pause",
    renew: "Renouveler (+1 mois)",
    renewT: "Renouveler pour un mois ?",
    renewB: "Ne renouvelle qu'après avoir reçu le paiement du mois suivant, hors Tnajem.",
    renewCta: "Oui, renouveler",
    pause: "Mettre en pause",
    resume: "Reprendre",
    stop: "Arrêter",
    stopT: "Arrêter cet abonnement ?",
    stopB: "L'élève est prévenu. Ses séances déjà réservées restent réservées.",
    stopCta: "Arrêter l'abonnement",
    past: "Terminés",
    expired: "Terminé",
    cancelled: "Annulé",
    student: "Élève",
    toastSaved: "Offre enregistrée.",
    toastArchived: "Offre archivée.",
    toastConfirmed: "Abonnement confirmé pour un mois.",
    toastRenewed: "Abonnement renouvelé.",
    toastDone: "C'est fait.",
    errors: {
      "invalid-title": "Donne un nom à l'offre (3 caractères au moins).",
      "title-too-long": "Le nom est trop long (80 caractères au plus).",
      "invalid-sessions": "Le nombre de séances va de 1 à 31.",
      "price-must-be-positive": "Le prix doit être supérieur à 0 TND.",
      "price-too-high": "Le prix est trop élevé.",
      "invalid-price": "Indique un prix.",
      "max-offers": `${OFFER_MAX_PER_TUTOR} offres au maximum.`,
      "already-live": "Cet élève a déjà refait une demande : confirme-la plutôt.",
      generic: "Ça n'a pas marché. Réessaie dans un instant.",
    } as Record<string, string>,
  },
  ar: {
    title: "الاشتراكات",
    sub: "عدد حصص في الشهر بسوم ثابت مع تلامذتك.",
    note: "الخلاص أونلاين قريب : للوقت هذا التلميذ يخلّصك برّا Tnajem. أكّد هوني كل شهر كيف يوصلك الخلاص.",
    bOfflineT: "صفحتك موش على الخط لتوّا",
    bOfflineB: "العروض متاعك يبانو أوّل ما يتثبّت حسابك.",
    bOfflineCta: "ابعث وثائقي",
    offers: "العروض متاعي",
    count: (n: number) => `${n} / ${OFFER_MAX_PER_TUTOR}`,
    newOffer: "عرض جديد",
    maxed: `${OFFER_MAX_PER_TUTOR} عروض على الأكثر : ارشيفي واحد باش تعمل آخر.`,
    emptyT: "ما عندكش عرض شهري لتوّا",
    emptyB: "اقترح عدد حصص في الشهر بسوم ثابت : تلامذتك يشتركو من صفحتك.",
    fTitle: "إسم العرض",
    fTitlePh: "مثلاً : متابعة الباك — 4 حصص",
    fSessions: "عدد الحصص في الشهر",
    fSessionsHelp: "بين 1 و 31.",
    fPrice: "السوم في الشهر (د.ت)",
    fPriceHelp: "أكثر من 0 د.ت. تنجّم تزيد عليه برومسيون.",
    save: "سجّل",
    create: "اعمل العرض",
    cancel: "بطّل",
    edit: "بدّل",
    archive: "ارشيفي",
    visible: "ظاهر في صفحتي",
    hidden: "مخبّي",
    show: "ورّيه في صفحتي",
    hide: "خبّيه",
    perMonth: (p: number) => `${p} د.ت في الشهر`,
    sessions: (n: number) => (n === 1 ? "حصة وحدة في الشهر" : `${n} حصص في الشهر`),
    live: (n: number) => (n === 0 ? "حتى مشترك" : `${n} اشتراك ماشي`),
    archiveT: "ترشيفي العرض هذا؟",
    archiveB: "يتنحّى من صفحتك. الاشتراكات الماشية تكمّل حتى لآخر شهرها.",
    requests: "الطلبات",
    noRequests: "ما فماش طلبات تستنّى.",
    requestLine: (offer: string, p: number, d: string) => `${offer} · ${p} د.ت في الشهر · الطلب نهار ${d}`,
    promo: (p: number) => `−${p} %`,
    confirm: "أكّد (الخلاص وصلني برّا Tnajem)",
    confirmT: "وصلك الخلاص؟",
    confirmB: "الاشتراك يبدا اليوم لمدّة شهر. ما تأكّدش كان ما يوصلك خلاص التلميذ، برّا Tnajem.",
    confirmCta: "إيه، أكّد",
    decline: "ارفض",
    declineT: "ترفض الطلب هذا؟",
    declineB: "التلميذ يوصلو خبر. ينجّم يعاود يطلب من بعد.",
    declineCta: "ارفض",
    active: "المشتركين",
    noActive: "ما فماش مشتركين لتوّا.",
    used: (u: number, n: number) => `${u} / ${n} حصص هالشهر`,
    until: (d: string) => `حتى لـ ${d}`,
    ending: "قريب يوفى",
    paused: "موقّف",
    renew: "جدّد (+شهر)",
    renewT: "تجدّد لمدّة شهر؟",
    renewB: "ما تجدّدش كان ما يوصلك خلاص الشهر الجاي، برّا Tnajem.",
    renewCta: "إيه، جدّد",
    pause: "وقّف مؤقتًا",
    resume: "كمّل",
    stop: "وقّف",
    stopT: "توقّف الاشتراك هذا؟",
    stopB: "التلميذ يوصلو خبر. الحصص اللي حجزها تقعد محجوزة.",
    stopCta: "وقّف الاشتراك",
    past: "الكملو",
    expired: "وفى",
    cancelled: "تبطّل",
    student: "تلميذ",
    toastSaved: "العرض تسجّل.",
    toastArchived: "العرض ترشيفا.",
    toastConfirmed: "الاشتراك تأكّد لمدّة شهر.",
    toastRenewed: "الاشتراك تجدّد.",
    toastDone: "تعمل.",
    errors: {
      "invalid-title": "عطي إسم للعرض (3 حروف على الأقل).",
      "title-too-long": "الإسم طويل برشا (80 حرف على الأكثر).",
      "invalid-sessions": "عدد الحصص من 1 حتى 31.",
      "price-must-be-positive": "السوم لازم يكون أكثر من 0 د.ت.",
      "price-too-high": "السوم غالي برشا.",
      "invalid-price": "حطّ سوم.",
      "max-offers": `${OFFER_MAX_PER_TUTOR} عروض على الأكثر.`,
      "already-live": "التلميذ هذا عاود طلب : أكّد الطلب الجديد خير.",
      generic: "ما مشاتش. عاود حاول بعد شويّة.",
    } as Record<string, string>,
  },
});

type Draft = { id: string | null; title: string; sessions: string; price: string };
type Pending =
  | { kind: "archive"; offer: TutorOfferRow }
  | { kind: "confirm" | "decline" | "renew" | "stop"; row: TutorSubscriptionRow }
  | null;

export function SubscriptionsView() {
  const { locale } = useLocale();
  const c = copy[locale];
  const shell = useShell();
  const { toast, showToast } = useToast();
  const [offers, setOffers] = useState<TutorOfferRow[] | null>(null);
  const [rows, setRows] = useState<TutorSubscriptionRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const [o, s] = await Promise.all([getMyOffers(), getTutorSubscriptions()]);
      if (!o.ok || !s.ok) throw new Error("load");
      setOffers(o.offers);
      setRows(s.rows);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const errText = (code?: string) => c.errors[code ?? "generic"] ?? c.errors.generic;

  async function saveDraft(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setFormErr(null);
    setBusy(true);
    const input = { title: draft.title, sessionsPerMonth: Number(draft.sessions), priceTnd: Number(draft.price) };
    try {
      const res = draft.id ? await updateOffer(draft.id, input) : await createOffer(input);
      if (!res.ok) return setFormErr(errText(res.error));
      setDraft(null);
      showToast(c.toastSaved);
      await load();
    } catch {
      setFormErr(errText());
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(o: TutorOfferRow) {
    const res = await updateOffer(o.id, { active: !o.active }).catch(() => ({ ok: false }));
    if (res.ok) await load();
    else showToast(errText());
  }

  async function runPending() {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.kind === "archive") {
        const res = await archiveOffer(pending.offer.id);
        showToast(res.ok ? c.toastArchived : errText(res.error));
      } else {
        const action = pending.kind === "decline" || pending.kind === "stop" ? "cancel" : pending.kind;
        const res = await actOnSubscription(pending.row.id, action);
        showToast(res.ok ? (pending.kind === "confirm" ? c.toastConfirmed : pending.kind === "renew" ? c.toastRenewed : c.toastDone) : errText(res.error));
      }
      setPending(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function simple(row: TutorSubscriptionRow, action: "pause" | "resume") {
    const res = await actOnSubscription(row.id, action).catch(() => ({ ok: false, error: "generic" }));
    showToast(res.ok ? c.toastDone : errText(res.error));
    await load();
  }

  const status = shell?.shell?.status;
  const blocker = status && status !== "verified" ? (
    <Blocker title={c.bOfflineT} action={{ href: "/onboarding/verify", label: c.bOfflineCta }}>{c.bOfflineB}</Blocker>
  ) : null;

  let body: React.ReactNode;
  if (failed) body = <ErrorState onRetry={() => void load()} />;
  else if (!offers || !rows) body = <PageSkeleton rows={3} />;
  else {
    const requests = rows.filter((r) => r.status === "requested");
    const live = rows.filter((r) => r.status === "active" || r.status === "paused");
    const ended = rows.filter((r) => r.status === "expired" || r.status === "cancelled").slice(0, 20);
    const canCreate = offers.length < OFFER_MAX_PER_TUTOR;

    body = (
      <>
        {/* ── Mes offres ── */}
        <section className="u-card u-card-pad sb-card" aria-labelledby="sb-offers-t">
          <div className="sb-head">
            <h2 id="sb-offers-t" className="sb-t">{c.offers} <span className="sb-count">{c.count(offers.length)}</span></h2>
            {!draft && canCreate && (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => { setFormErr(null); setDraft({ id: null, title: "", sessions: "4", price: "" }); }} data-e2e="offer-new">
                <Plus />
                {c.newOffer}
              </button>
            )}
          </div>
          {!canCreate && !draft && <p className="sb-muted">{c.maxed}</p>}

          {draft && (
            <form className="sb-form" onSubmit={saveDraft} data-e2e="offer-form" noValidate>
              <Field label={c.fTitle}>
                <div className="inp">
                  <input value={draft.title} maxLength={80} placeholder={c.fTitlePh} onChange={(e) => setDraft({ ...draft, title: e.target.value })} data-e2e="offer-title" />
                </div>
              </Field>
              <div className="sb-form-row">
                <Field label={c.fSessions} help={c.fSessionsHelp}>
                  <div className="inp">
                    <input type="number" inputMode="numeric" min={1} max={31} step={1} value={draft.sessions} onChange={(e) => setDraft({ ...draft, sessions: e.target.value })} data-e2e="offer-sessions" />
                  </div>
                </Field>
                <Field label={c.fPrice} help={c.fPriceHelp}>
                  <div className="inp">
                    <input type="number" inputMode="decimal" min={0.5} step={0.5} value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} data-e2e="offer-price" />
                  </div>
                </Field>
              </div>
              {formErr && <p className="sb-err" role="alert">{formErr}</p>}
              <div className="cluster">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft(null)}>{c.cancel}</button>
                <button type="submit" className="btn btn-outline btn-sm" disabled={busy} data-e2e="offer-save">{draft.id ? c.save : c.create}</button>
              </div>
            </form>
          )}

          {offers.length === 0 && !draft ? (
            <EmptyState icon={<Calendar />} title={c.emptyT}>{c.emptyB}</EmptyState>
          ) : (
            <ul className="sb-list" role="list">
              {offers.map((o) => (
                <li key={o.id} className="sb-row" data-e2e="offer-row">
                  <div className="min-w-0 sb-main">
                    <div className="sb-name">{o.title}</div>
                    <div className="sb-meta">
                      {c.sessions(o.sessions_per_month)} · <b>{c.perMonth(o.price_tnd)}</b> · {c.live(o.liveSubscriptions)}
                    </div>
                    <span className={o.active ? "tag tag-neutral" : "chip chip-sand"}>{o.active ? c.visible : c.hidden}</span>
                  </div>
                  <div className="sb-actions">
                    <ShareButton kind="offer" sessionsPerMonth={o.sessions_per_month} priceTnd={o.price_tnd} />
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggleActive(o)}>{o.active ? c.hide : c.show}</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setFormErr(null); setDraft({ id: o.id, title: o.title, sessions: String(o.sessions_per_month), price: String(o.price_tnd) }); }}>{c.edit}</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPending({ kind: "archive", offer: o })}>{c.archive}</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Demandes ── */}
        <section className="u-card u-card-pad sb-card" aria-labelledby="sb-req-t" data-e2e="subscription-requests">
          <h2 id="sb-req-t" className="sb-t">{c.requests}</h2>
          {requests.length === 0 ? (
            <p className="sb-muted">{c.noRequests}</p>
          ) : (
            <ul className="sb-list" role="list">
              {requests.map((r) => (
                <li key={r.id} className="sb-row" data-e2e="request-row">
                  <div className="min-w-0 sb-main">
                    <div className="sb-name">{r.studentFirstName ?? c.student}</div>
                    <div className="sb-meta">
                      {c.requestLine(r.offerTitle, r.priceTnd, formatNumericDate(r.requestedAt))}
                      {r.promotionPercent ? <> · <span className="tag tag-neutral" dir="ltr">{c.promo(r.promotionPercent)}</span></> : null}
                    </div>
                  </div>
                  <div className="sb-actions">
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setPending({ kind: "confirm", row: r })} data-e2e="request-confirm">{c.confirm}</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPending({ kind: "decline", row: r })}>{c.decline}</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Abonnés ── */}
        <section className="u-card u-card-pad sb-card" aria-labelledby="sb-live-t" data-e2e="subscription-active">
          <h2 id="sb-live-t" className="sb-t">{c.active}</h2>
          {live.length === 0 ? (
            <p className="sb-muted">{c.noActive}</p>
          ) : (
            <ul className="sb-list" role="list">
              {live.map((r) => (
                <li key={r.id} className="sb-row" data-e2e="active-row" data-status={r.status}>
                  <div className="min-w-0 sb-main">
                    <div className="sb-name">
                      <Users className="sb-ic" />
                      {r.studentFirstName ?? c.student}
                    </div>
                    <div className="sb-meta">
                      {r.offerTitle} · {c.used(r.usedThisPeriod, r.sessionsPerMonth)}
                      {r.periodEnd ? <> · {c.until(formatNumericDate(r.periodEnd))}</> : null}
                    </div>
                    {r.status === "paused" ? <span className="tag tag-neutral">{c.paused}</span> : r.expiringSoon ? <span className="tag tag-soon">{c.ending}</span> : null}
                  </div>
                  <div className="sb-actions">
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setPending({ kind: "renew", row: r })} data-e2e="sub-renew">{c.renew}</button>
                    {r.status === "active" ? (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => simple(r, "pause")}>{c.pause}</button>
                    ) : (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => simple(r, "resume")}>{c.resume}</button>
                    )}
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPending({ kind: "stop", row: r })}>{c.stop}</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Terminés ── */}
        {ended.length > 0 && (
          <section className="u-card u-card-pad sb-card" aria-labelledby="sb-past-t">
            <h2 id="sb-past-t" className="sb-t">{c.past}</h2>
            <ul className="sb-list" role="list">
              {ended.map((r) => (
                <li key={r.id} className="sb-row" data-e2e="ended-row">
                  <div className="min-w-0 sb-main">
                    <div className="sb-name">{r.studentFirstName ?? c.student}</div>
                    <div className="sb-meta">
                      {r.offerTitle}
                      {r.periodEnd ? <> · {formatNumericDate(r.periodEnd)}</> : null} · {r.status === "expired" ? c.expired : c.cancelled}
                    </div>
                  </div>
                  {r.status === "expired" && (
                    <div className="sb-actions">
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => setPending({ kind: "renew", row: r })}>{c.renew}</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </>
    );
  }

  const dlg =
    pending?.kind === "archive" ? { t: c.archiveT, b: c.archiveB, cta: c.archive, tone: "danger" as const }
      : pending?.kind === "confirm" ? { t: c.confirmT, b: c.confirmB, cta: c.confirmCta, tone: "primary" as const }
        : pending?.kind === "renew" ? { t: c.renewT, b: c.renewB, cta: c.renewCta, tone: "primary" as const }
          : pending?.kind === "decline" ? { t: c.declineT, b: c.declineB, cta: c.declineCta, tone: "danger" as const }
            : pending?.kind === "stop" ? { t: c.stopT, b: c.stopB, cta: c.stopCta, tone: "danger" as const }
              : null;

  return (
    <AppPage title={c.title} subtitle={c.sub} blockers={blocker} note={c.note}>
      <div className="sb-stack">{body}</div>
      <ConfirmDialog
        open={Boolean(dlg)}
        title={dlg?.t ?? ""}
        confirmLabel={dlg?.cta ?? ""}
        cancelLabel={c.cancel}
        onConfirm={() => void runPending()}
        onClose={() => setPending(null)}
        busy={busy}
        tone={dlg?.tone ?? "primary"}
      >
        {dlg ? <p>{dlg.b}</p> : null}
      </ConfirmDialog>
      {toast}
      <style dangerouslySetInnerHTML={{ __html: SB_CSS }} />
    </AppPage>
  );
}

const SB_CSS = `
  .sb-stack{display:grid;gap:16px}
  .sb-card{height:auto;gap:12px}
  .sb-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
  .sb-t{font-family:var(--fd);font-size:17px;font-weight:700;color:var(--ink);display:flex;align-items:center;gap:8px}
  .sb-count{font-family:var(--fb);font-size:13px;font-weight:700;color:var(--muted)}
  .sb-muted{font-size:13.5px;color:var(--muted);margin:0;line-height:1.55}
  .sb-list{list-style:none;margin:0;padding:0;display:grid;gap:10px}
  .sb-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;
    padding:12px 14px;border:1px solid var(--line);border-radius:14px;background:var(--paper)}
  .sb-main{flex:1 1 240px;display:grid;gap:5px;justify-items:start}
  .sb-name{display:flex;align-items:center;gap:6px;font-weight:700;font-size:15px;color:var(--ink);overflow-wrap:anywhere}
  .sb-ic{width:16px;height:16px;color:var(--blue)}
  .sb-meta{font-size:13.5px;color:var(--ink2);line-height:1.55}
  .sb-meta b{color:var(--ink)}
  .sb-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .sb-form{display:grid;gap:4px;padding:14px;border:1px solid var(--lineCool);border-radius:14px;background:var(--blue50)}
  .sb-form-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
  .sb-err{font-size:13.5px;color:var(--rose700);font-weight:600;margin:0 0 8px}
`;
