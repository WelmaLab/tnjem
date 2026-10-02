"use client";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { AppPage, Blocker, EmptyState, ErrorState, FormMode, PageSkeleton, useShell } from "@/components/app/AppShell";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { DatePicker } from "@/components/app/DatePicker";
import { ShareButton } from "@/components/share/ShareButton";
import { Field } from "@/components/ui";
import { Gift } from "@/components/icons";
import { useToast } from "@/components/useToast";
import { bilingual } from "@/lib/i18n";
import { getDashboard } from "@/app/actions";
import { actOnPromotion, createPromotion, getMyOffers, getMyPromotions } from "@/app/actions-growth";
import {
  PROMO_PERCENT_MAX, PROMO_PERCENT_MIN, discountedPrice, formatNumericDate, normalizePromoCode, parseScheduleInput,
  type DashboardData, type PromoScope, type TutorOfferRow, type TutorPromotionRow,
} from "@tnajem/shared";

/* PROMOTIONS — Espace prof v2 · Phase 5 B (/dashboard/promotions).

   Create, pause and end a promotion: 1 to 20 % — a SLIDER, with a live preview of
   the old and new price on the tutor's own classes, fiches and offers, computed by
   the one price calculation (pricing.ts::discountedPrice, contract C6: 20 % cap,
   rounded to 0.5 TND, never below 1 TND). On everything, one class, one fiche, or
   the monthly offer(s); until a date (DD/MM/YYYY, rule 6 — no native picker);
   optionally behind a code (shared as /{slug}?promo=CODE) and capped in uses.

   The cap and every other rule are the API's (routes/promotions.ts, and a CHECK in
   the database): this page shows them. Promotions never stack — the student gets
   the best one — and the note says so. Ending is final and confirmed in a dialog. */

const copy = bilingual({
  fr: {
    title: "Promotions",
    sub: "Une réduction de 1 à 20 %, sur toute ta page ou sur une séance, une fiche ou ton abonnement.",
    note: "20 % au maximum. Si plusieurs promotions s'appliquent, l'élève a seulement la meilleure : elles ne s'additionnent pas.",
    bOfflineT: "Ta page n'est pas encore en ligne",
    bOfflineB: "tes promotions seront visibles dès que ton compte est vérifié.",
    bOfflineCta: "Envoyer mes documents",
    newT: "Nouvelle promotion",
    percent: "Réduction",
    percentAria: "Pourcentage de réduction",
    preview: "Aperçu",
    tnd: "TND",
    example: "Exemple",
    was: "au lieu de",
    noChange: "trop petit pour changer ce prix",
    scope: "S'applique à",
    scopes: { all: "Toute ma page", class: "Une séance", pack: "Une fiche", monthly: "Mon abonnement mensuel" } as Record<PromoScope, string>,
    target: "Laquelle ?",
    allOffers: "Toutes mes offres mensuelles",
    pick: "Choisis…",
    noTarget: "Rien à choisir ici pour l'instant.",
    until: "Jusqu'au",
    untilHelp: "Inclus, jusqu'à 23:59. 180 jours au plus.",
    code: "Code (facultatif)",
    codeHelp: "Sans code, la promo s'affiche pour tout le monde. Avec un code, seulement par ton lien ?promo=CODE.",
    codePh: "ex. RENTREE",
    maxUses: "Utilisations au maximum (facultatif)",
    maxUsesHelp: "Vide = sans limite.",
    create: "Créer la promotion",
    mine: "Mes promotions",
    emptyT: "Pas encore de promotion",
    emptyB: "Une petite réduction, partagée au bon moment, aide tes premiers élèves à réserver.",
    on: (s: string) => `sur ${s}`,
    /* In a sentence (« −15 % sur toute ma page »), and a named target in quotes. */
    scopesIn: { all: "toute ma page", class: "une séance", pack: "une fiche", monthly: "mes abonnements mensuels" } as Record<PromoScope, string>,
    named: (t: string) => `« ${t} »`,
    untilD: (d: string) => `jusqu'au ${d}`,
    uses: (n: number, max: number | null) => (max ? `${n} / ${max} utilisations` : n === 1 ? "1 utilisation" : `${n} utilisations`),
    states: { live: "En cours", scheduled: "Programmée", paused: "En pause", ended: "Terminée", expired: "Expirée", exhausted: "Épuisée" } as Record<TutorPromotionRow["state"], string>,
    publicTag: "Pour tout le monde",
    pause: "Mettre en pause",
    resume: "Reprendre",
    end: "Terminer",
    endT: "Terminer cette promotion ?",
    endB: "C'est définitif : elle disparaît des prix et son lien ne s'applique plus. Les réservations déjà faites gardent leur prix.",
    cancel: "Annuler",
    toastCreated: "Promotion créée.",
    toastDone: "C'est fait.",
    errors: {
      "percent-out-of-range": "La réduction va de 1 à 20 %.",
      "target-required": "Choisis la séance, la fiche ou l'offre.",
      "invalid-dates": "Choisis une date de fin à venir.",
      "too-long": "Une promotion dure 180 jours au plus.",
      "invalid-code": "Le code : 3 à 20 lettres, chiffres ou tirets.",
      "code-taken": "Tu as déjà une promotion avec ce code.",
      "invalid-max-uses": "Le nombre d'utilisations doit être un entier positif.",
      "not-found": "Cette séance, fiche ou offre n'existe plus.",
      generic: "Ça n'a pas marché. Réessaie dans un instant.",
    } as Record<string, string>,
  },
  ar: {
    title: "البرومسيونات",
    sub: "تخفيض من 1 حتى \u206620 %\u2069، على صفحتك الكل ولا على حصة، فيشة ولا الاشتراك متاعك.",
    note: "\u206620 %\u2069 على الأكثر. كان فما برشا برومسيونات، التلميذ ياخذ الأحسن برك : ما يتجمّعوش.",
    bOfflineT: "صفحتك موش على الخط لتوّا",
    bOfflineB: "البرومسيونات متاعك يبانو أوّل ما يتثبّت حسابك.",
    bOfflineCta: "ابعث وثائقي",
    newT: "برومسيون جديدة",
    percent: "التخفيض",
    percentAria: "نسبة التخفيض",
    preview: "معاينة",
    tnd: "د.ت",
    example: "مثال",
    was: "عوض",
    noChange: "صغير برشا باش يبدّل السوم هذا",
    scope: "على شنوّة",
    scopes: { all: "صفحتي الكل", class: "حصة وحدة", pack: "فيشة وحدة", monthly: "الاشتراك الشهري" } as Record<PromoScope, string>,
    target: "أنهي واحد؟",
    allOffers: "العروض الشهرية الكل",
    pick: "اختار…",
    noTarget: "ما فما شي تختارو هوني لتوّا.",
    until: "حتى لـ",
    untilHelp: "محسوب، حتى لـ 23:59. 180 يوم على الأكثر.",
    code: "كود (اختياري)",
    codeHelp: "بلا كود، البرومسيون تبان للناس الكل. بكود، كان باللينك متاعك ?promo=CODE.",
    codePh: "مثلاً RENTREE",
    maxUses: "أقصى عدد استعمالات (اختياري)",
    maxUsesHelp: "فارغ = بلا حدّ.",
    create: "اعمل البرومسيون",
    mine: "البرومسيونات متاعي",
    emptyT: "ما عندكش برومسيون لتوّا",
    emptyB: "تخفيض صغير، تشاركو في الوقت المناسب، يعاون تلامذتك الأوّلين يحجزو.",
    on: (s: string) => `على ${s}`,
    scopesIn: { all: "صفحتي الكل", class: "حصة وحدة", pack: "فيشة وحدة", monthly: "الاشتراكات الشهرية متاعي" } as Record<PromoScope, string>,
    named: (t: string) => `« ${t} »`,
    untilD: (d: string) => `حتى لـ ${d}`,
    uses: (n: number, max: number | null) => (max ? `${n} / ${max} استعمال` : `${n} استعمال`),
    states: { live: "ماشية", scheduled: "مبرمجة", paused: "موقّفة", ended: "كملت", expired: "وفات", exhausted: "تكمّلت" } as Record<TutorPromotionRow["state"], string>,
    publicTag: "للناس الكل",
    pause: "وقّف مؤقتًا",
    resume: "كمّل",
    end: "كمّل نهائيًا",
    endT: "تكمّل البرومسيون هاذي؟",
    endB: "نهائي : تتنحّى من الأسوام واللينك متاعها ما عادش يخدم. الحجوزات اللي صارت تقعد بسومها.",
    cancel: "بطّل",
    toastCreated: "البرومسيون تعملت.",
    toastDone: "تعمل.",
    errors: {
      "percent-out-of-range": "التخفيض من 1 حتى \u206620 %\u2069.",
      "target-required": "اختار الحصة، الفيشة ولا العرض.",
      "invalid-dates": "اختار تاريخ نهاية جاي.",
      "too-long": "البرومسيون تدوم 180 يوم على الأكثر.",
      "invalid-code": "الكود : من 3 حتى 20 حرف، رقم ولا تيري.",
      "code-taken": "عندك برومسيون بنفس الكود.",
      "invalid-max-uses": "عدد الاستعمالات لازم يكون رقم صحيح موجب.",
      "not-found": "الحصة، الفيشة ولا العرض هذا ما عادش موجود.",
      generic: "ما مشاتش. عاود حاول بعد شويّة.",
    } as Record<string, string>,
  },
});

const SCOPES: PromoScope[] = ["all", "class", "pack", "monthly"];
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export function PromotionsView() {
  const { locale } = useLocale();
  const c = copy[locale];
  const shell = useShell();
  const { toast, showToast } = useToast();
  const [promos, setPromos] = useState<TutorPromotionRow[] | null>(null);
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [offers, setOffers] = useState<TutorOfferRow[]>([]);
  const [failed, setFailed] = useState(false);
  const [percent, setPercent] = useState(10);
  const [scope, setScope] = useState<PromoScope>("all");
  const [targetId, setTargetId] = useState("");
  const [until, setUntil] = useState("");
  const [code, setCode] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ending, setEnding] = useState<TutorPromotionRow | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const [p, d, o] = await Promise.all([getMyPromotions(), getDashboard(), getMyOffers()]);
      if (!p.ok) throw new Error("load");
      setPromos(p.promotions);
      setDash(d && !("wrongRole" in d) ? d : null);
      setOffers(o.ok ? o.offers : []);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const upcoming = useMemo(() => (dash?.classes ?? []).filter((k) => k.status !== "cancelled" && (k.phase === "upcoming" || k.phase === "live")), [dash]);
  const targets = scope === "class"
    ? upcoming.map((k) => ({ id: k.id, label: `${k.title} · ${formatNumericDate(k.starts_at)}`, price: k.price_tnd }))
    : scope === "pack"
      ? (dash?.packs ?? []).map((p) => ({ id: p.id, label: p.title, price: p.price_tnd }))
      : scope === "monthly"
        ? offers.map((o) => ({ id: o.id, label: o.title, price: o.price_tnd }))
        : [];

  /* A promotion on one class, fiche or offer names it (−15 % sur « Suites »), whatever its phase now. */
  const titleOf = useMemo(() => new Map<string, string>([
    ...(dash?.classes ?? []).map((k) => [k.id, k.title] as [string, string]),
    ...(dash?.packs ?? []).map((p) => [p.id, p.title] as [string, string]),
    ...offers.map((o) => [o.id, o.title] as [string, string]),
  ]), [dash, offers]);

  /* The live preview: the tutor's own prices in this scope (up to three), else an example. */
  const previewItems = (() => {
    if (scope === "all") {
      const all = [
        ...upcoming.filter((k) => k.price_tnd > 0).map((k) => ({ label: k.title, price: k.price_tnd })),
        ...offers.map((o) => ({ label: o.title, price: o.price_tnd })),
      ];
      return all.slice(0, 3);
    }
    const chosen = targets.filter((t) => (targetId ? t.id === targetId : scope === "monthly")).filter((t) => t.price > 0);
    return chosen.slice(0, 3).map((t) => ({ label: t.label, price: t.price }));
  })();
  const preview = previewItems.length ? previewItems : [{ label: c.example, price: 40 }];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormErr(null);
    const end = until ? parseScheduleInput(`${until}T23:59`) : null;
    if (!end) return setFormErr(c.errors["invalid-dates"]);
    if (code.trim() && !normalizePromoCode(code)) return setFormErr(c.errors["invalid-code"]);
    setBusy(true);
    try {
      const res = await createPromotion({
        percent,
        scope,
        targetId: scope === "all" ? null : targetId || null,
        code: code.trim() ? code.trim().toUpperCase() : null,
        endsAt: end.toISOString(),
        maxUses: maxUses.trim() ? Number(maxUses) : null,
      });
      if (!res.ok) return setFormErr(c.errors[res.error ?? "generic"] ?? c.errors.generic);
      showToast(c.toastCreated);
      setCode("");
      setMaxUses("");
      await load();
    } catch {
      setFormErr(c.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  async function act(p: TutorPromotionRow, action: "pause" | "resume" | "end") {
    setBusy(true);
    try {
      const res = await actOnPromotion(p.id, action);
      showToast(res.ok ? c.toastDone : c.errors[res.error ?? "generic"] ?? c.errors.generic);
      setEnding(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  const status = shell?.shell?.status;
  const blocker = status && status !== "verified" ? (
    <Blocker title={c.bOfflineT} action={{ href: "/onboarding/verify", label: c.bOfflineCta }}>{c.bOfflineB}</Blocker>
  ) : null;

  const today = new Date();

  let body: React.ReactNode;
  if (failed) body = <ErrorState onRetry={() => void load()} />;
  else if (!promos) body = <PageSkeleton rows={3} />;
  else {
    body = (
      <>
        <form className="u-card u-card-pad pv-card" onSubmit={submit} noValidate data-e2e="promo-form">
          <h2 className="pv-t">{c.newT}</h2>

          <div className="field">
            <span className="field-label" id="pv-pct-l">{c.percent}</span>
            <div className="pv-slider">
              <input
                type="range"
                min={PROMO_PERCENT_MIN}
                max={PROMO_PERCENT_MAX}
                step={1}
                value={percent}
                onChange={(e) => setPercent(Number(e.target.value))}
                aria-labelledby="pv-pct-l"
                aria-valuetext={`${percent} %`}
                data-e2e="promo-percent"
              />
              <output className="pv-pct" dir="ltr" aria-live="polite" data-e2e="promo-percent-value">−{percent} %</output>
            </div>
            <div className="pv-preview" role="group" aria-label={c.preview} data-e2e="promo-preview">
              {preview.map((p, i) => {
                const next = discountedPrice(p.price, percent);
                return (
                  <div key={i} className="pv-prev-row">
                    <span className="pv-prev-l">{p.label}</span>
                    {next < p.price ? (
                      <span className="pv-prev-v">
                        <span className="sr-only">{c.was}</span>
                        <del>{p.price} {c.tnd}</del> <b>{next} {c.tnd}</b>
                      </span>
                    ) : (
                      <span className="pv-prev-v pv-prev-same">{p.price} {c.tnd} · {c.noChange}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="field">
            <span className="field-label" id="pv-scope-l">{c.scope}</span>
            <div className="pv-chips" role="radiogroup" aria-labelledby="pv-scope-l">
              {SCOPES.map((s) => (
                <button key={s} type="button" role="radio" aria-checked={scope === s} className={`pv-chip${scope === s ? " is-on" : ""}`} onClick={() => { setScope(s); setTargetId(""); }} data-e2e={`promo-scope-${s}`}>
                  {c.scopes[s]}
                </button>
              ))}
            </div>
          </div>

          {scope !== "all" && (
            targets.length === 0 ? (
              <p className="pv-muted">{c.noTarget}</p>
            ) : (
              <Field label={c.target}>
                <div className="inp">
                  <select value={targetId} onChange={(e) => setTargetId(e.target.value)} data-e2e="promo-target">
                    <option value="">{scope === "monthly" ? c.allOffers : c.pick}</option>
                    {targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                </div>
              </Field>
            )
          )}

          <div className="pv-row">
            <div className="field">
              <label className="field-label" htmlFor="pv-until">{c.until}</label>
              <DatePicker id="pv-until" value={until} onChange={setUntil} min={ymd(new Date(today.getTime() + 86_400_000))} />
              <div className="help">{c.untilHelp}</div>
            </div>
            <Field label={c.code} help={c.codeHelp}>
              <div className="inp">
                <input value={code} maxLength={20} placeholder={c.codePh} dir="ltr" onChange={(e) => setCode(e.target.value.toUpperCase())} data-e2e="promo-code" />
              </div>
            </Field>
          </div>
          <Field label={c.maxUses} help={c.maxUsesHelp}>
            <div className="inp pv-narrow">
              <input type="number" inputMode="numeric" min={1} step={1} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} data-e2e="promo-max" />
            </div>
          </Field>
          {formErr && <p className="pv-err" role="alert">{formErr}</p>}
          <div>
            <button type="submit" className="btn btn-primary" disabled={busy} data-e2e="promo-create">{c.create}</button>
          </div>
        </form>

        <section className="u-card u-card-pad pv-card" aria-labelledby="pv-mine-t">
          <h2 id="pv-mine-t" className="pv-t">{c.mine}</h2>
          {promos.length === 0 ? (
            <EmptyState icon={<Gift />} title={c.emptyT}>{c.emptyB}</EmptyState>
          ) : (
            <ul className="pv-list" role="list">
              {promos.map((p) => {
                const open = p.state === "live" || p.state === "scheduled" || p.state === "paused";
                const scopeLabel = p.targetId && titleOf.get(p.targetId) ? c.named(titleOf.get(p.targetId) ?? "") : c.scopesIn[p.scope];
                return (
                  <li key={p.id} className="pv-item" data-e2e="promo-row" data-state={p.state}>
                    <div className="pv-big" dir="ltr" aria-hidden="true">−{p.percent} %</div>
                    <div className="min-w-0 pv-main">
                      <div className="pv-name">
                        <span className="sr-only">−{p.percent} % </span>
                        {c.on(scopeLabel)}
                        {p.code ? <span className="pv-code" dir="ltr">{p.code}</span> : <span className="tag tag-neutral">{c.publicTag}</span>}
                      </div>
                      <div className="pv-meta">{c.untilD(formatNumericDate(p.endsAt))} · {c.uses(p.uses, p.maxUses)}</div>
                      <span className={p.state === "live" ? "tag tag-neutral" : p.state === "scheduled" ? "tag tag-soon" : "chip chip-sand"}>{c.states[p.state]}</span>
                    </div>
                    {open && (
                      <div className="pv-actions">
                        {p.state !== "paused" && (
                          <ShareButton kind="promo" promoCode={p.code} percent={p.percent} endsAt={p.endsAt} />
                        )}
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void act(p, p.state === "paused" ? "resume" : "pause")} disabled={busy}>
                          {p.state === "paused" ? c.resume : c.pause}
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEnding(p)} data-e2e="promo-end">{c.end}</button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </>
    );
  }

  return (
    <AppPage title={c.title} subtitle={c.sub} blockers={blocker} note={c.note}>
      <div className="pv-stack">{body}</div>
      <ConfirmDialog
        open={Boolean(ending)}
        title={c.endT}
        confirmLabel={c.end}
        cancelLabel={c.cancel}
        onConfirm={() => ending && void act(ending, "end")}
        onClose={() => setEnding(null)}
        busy={busy}
      >
        <p>{c.endB}</p>
      </ConfirmDialog>
      {toast}
      {/* live-fixes-1 · A2: the promotion form IS this page — on a phone, no tab bar and no « + ». */}
      <FormMode />
      <style dangerouslySetInnerHTML={{ __html: PR_CSS }} />
    </AppPage>
  );
}

const PR_CSS = `
  .pv-stack{display:grid;gap:16px}
  .pv-card{height:auto;gap:12px}
  .pv-t{font-family:var(--fd);font-size:17px;font-weight:700;color:var(--ink)}
  .pv-muted{font-size:13.5px;color:var(--muted);margin:0}
  .pv-slider{display:flex;align-items:center;gap:14px}
  .pv-slider input[type=range]{flex:1 1 auto;min-width:0;min-height:44px;accent-color:var(--blue)}
  .pv-slider input[type=range]:focus-visible{outline:3px solid var(--blue);outline-offset:2px}
  .pv-pct{flex:none;min-width:72px;text-align:center;font-family:var(--fd);font-size:22px;font-weight:700;color:var(--blue700);
    background:var(--blue50);border-radius:12px;padding:6px 10px}
  .pv-preview{display:grid;gap:6px;margin-block-start:10px;padding:12px;border-radius:12px;background:var(--cream);border:1px solid var(--line)}
  .pv-prev-row{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:13.5px}
  .pv-prev-l{color:var(--ink2);min-width:0;overflow-wrap:anywhere}
  .pv-prev-v{white-space:nowrap;color:var(--ink)}
  .pv-prev-v del{color:var(--muted)}
  .pv-prev-same{color:var(--muted);white-space:normal}
  .pv-chips{display:flex;flex-wrap:wrap;gap:8px}
  .pv-chip{min-height:44px;padding-inline:14px;border-radius:999px;border:1.5px solid var(--line);background:var(--paper);color:var(--ink);font-weight:700;font-size:13.5px;cursor:pointer}
  .pv-chip.is-on{border-color:var(--blue);background:var(--blue50);color:var(--blue700)}
  .pv-chip:focus-visible{outline:3px solid var(--blue);outline-offset:2px}
  .pv-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
  .pv-narrow{max-width:200px}
  .pv-err{font-size:13.5px;color:var(--rose700);font-weight:600;margin:0}
  .pv-list{list-style:none;margin:0;padding:0;display:grid;gap:10px}
  .pv-item{display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap;padding:12px 14px;border:1px solid var(--line);border-radius:14px;background:var(--paper)}
  .pv-big{flex:none;font-family:var(--fd);font-size:22px;font-weight:700;color:var(--blue700);min-width:72px}
  .pv-main{flex:1 1 220px;display:grid;gap:5px;justify-items:start}
  .pv-name{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-weight:700;font-size:14.5px;color:var(--ink)}
  .pv-code{font-family:var(--fd);font-size:13px;font-weight:700;letter-spacing:.5px;padding:3px 8px;border-radius:8px;background:var(--sand);color:var(--ink2)}
  .pv-meta{font-size:13.5px;color:var(--ink2)}
  .pv-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
`;
