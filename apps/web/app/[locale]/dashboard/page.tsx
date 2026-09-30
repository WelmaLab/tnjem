"use client";
import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Link } from "@/components/Link";
import { Button, Spinner, Chip } from "@/components/ui";
import { useLocale } from "@/components/LocaleProvider";
import { Gear, Bell, Wallet, Share, Copy, Video, Plus, Bulb, Users, Eye, Book, Shield, Check, Phone, Clock, Mail } from "@/components/icons";
import { SiteShell } from "@/components/SiteShell";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { getDashboard, getNotifications, markNotificationsRead, setFreeFirstSession } from "@/app/actions";
import { MessageBookingButton } from "@/components/MessageBookingButton";
import { ClassActions } from "@/components/dashboard/ClassActions";
import { AvatarUpload } from "@/components/dashboard/AvatarUpload";
import { WrongRoleNotice } from "@/components/WrongRoleNotice";
import { UserText } from "@/components/UserText";
import { buildTutorSteps, STEP_COPY } from "@/lib/onboarding-steps";
import type { OnboardingStep, StepState } from "@/lib/onboarding-steps";
import type { DashboardData, DashboardBooking, NotificationItem, DashboardResult } from "@tnajem/shared";
import { initials, monthLabel, formatLongDate } from "@tnajem/shared";
import { classPhase, type ClassPhase } from "@tnajem/shared"; // phase-a lane L5 (A18.10)
import { bilingual } from "@/lib/i18n";
import { PaymentStory } from "@/components/PaymentStory"; // phase-a lane L3 (A22)

/* Page-local copy (never edit lib/i18n.ts from here). FR + Derija, RTL-safe.
   The shared t.dashboard.s1p/s2p/s3p keys are truthful but generic; this page
   uses its own steps below so the wording can stay specific to what a tutor sees
   here. Whatever it says must remain true of the pilot: Tnajem processes no
   money, so nothing on this screen may describe a charge, a split or a payout. */
const copy = bilingual({
  fr: {
    signedOutTitle: "Connecte-toi pour voir ton tableau de bord",
    signedOutBody: "Tes cours, tes élèves inscrits et ton lien s'affichent ici une fois connecté.",
    signIn: "Se connecter",
    hello: "Ton tableau de bord",
    bookings: "Tes élèves inscrits",
    bookingsSub: "Qui a réservé ta séance.",
    bookingsEmpty: "Personne n'a encore réservé.",
    bookingsEmptyBody: "Partage ton lien. Dès qu'un élève réserve, tu le vois ici — son prénom, quand il a réservé, et le lien de la séance.",
    signedUp: (n: number) => (n > 1 ? `${n} inscrits` : `${n} inscrit`),
    /* Replaces call / mail / noPhone. Those keys are gone with the tel: and
       mailto: links they labelled — a dead key is a key someone re-renders. */
    contactClosed: "Coordonnées non partagées",
    messageStudent: "Écrire à",
    anon: "Élève",
    free: "Gratuit",
    paid: "Payé",
    reserved: "Réservé",
    attended: "Présent",
    bookedAgo: "Réservé",
    paymentsSoonTitle: "Les paiements arrivent bientôt",
    // phase-a lane L3 (A22): no provider named, no second payment story (D4).
    paymentsSoonBody: "Pour l'instant, aucun paiement ne passe par Tnajem et tu gardes 100 %. Dès que les paiements en ligne s'ouvrent, ton solde s'affiche ici.",
    notifTitle: "Notifications",
    notifEmpty: "Rien de neuf pour l'instant.",
    justNow: "à l'instant",
    minsAgo: (n: number) => `il y a ${n} min`,
    hoursAgo: (n: number) => `il y a ${n} h`,
    daysAgo: (n: number) => `il y a ${n} j`,

    /* The 4-step ladder's own strings live in lib/onboarding-steps.ts — they are
       shared with /onboarding and /onboarding/verify, which used to describe the
       same funnel with a different number of steps each. */

    // ── how you get paid (replaces the outdated shared strings) ──
    howTitle: "Comment ça marche", // phase-a lane L3 (A22)
    h1t: "Tu fixes ton prix",
    h1b: "Classe par classe, sans plafond.",
    h2t: "L'élève réserve",
    h2b: "Son prénom et sa réservation arrivent ici, tout de suite.",
    // phase-a lane L3 (A22): the HOW is <PaymentStory audience="tutor"> under h3b.
    h3t: "Le paiement",
    h3b: "Pendant le pilote, Tnajem ne prend aucune commission.",
    shareLabel: "Ton lien de prof",
    editStore: "Modifier ma page",
    materials: "Mes documents",
    ffTitle: "Première séance offerte",
    ffBody:
      "Si tu l'actives, ta page annonce que la première séance est offerte — et tu peux la réserver classe par classe en créant une séance. Tant que c'est désactivé, Tnajem ne promet rien à ta place.",
    ffOn: "Activée",
    ffOff: "Désactivée",
    ffSaving: "Enregistrement…",
    ffError: "Ça n'a pas marché. Réessaie.",

    /* TON OFFRE (Step 16). A limit a tutor cannot see is a limit they discover
       by hitting it, halfway through creating a class. */
    planTitle: "Ton offre",
    planPilot: "Pilote",
    planPilotBody:
      "Pendant le pilote, tous les profs ont l'offre complète : séances illimitées, et rien n'est facturé. On te préviendra avant que ça change.",
    planGrantedBody: "Offre activée par l'équipe Tnajem. Rien ne t'est facturé.",
    // phase-a lane L3 (A25): séances (D3).
    planUnlimited: "Séances publiées : illimitées",
    planUsage: (used: number, max: number) => `Séances publiées : ${used} sur ${max}`,
    planUsageNote:
      "On compte les séances à venir. Une séance annulée ou déjà passée libère la place.",
    planUntil: (d: string) => `Jusqu'au ${d}.`,
    planSeeTarifs: "Voir les offres",
    // phase-a lane L5 (A18.10): where each class stands
    phaseUpcoming: "À venir",
    phaseLive: "En direct",
    phaseDone: "Terminée",
    phaseCancelled: "Annulée",
  },
  ar: {
    signedOutTitle: "ادخل لحسابك باش تشوف لوحتك",
    signedOutBody: "حصصك، التلاميذ اللي حجزو، والرابط متاعك يبانو هوني كي تدخل.",
    signIn: "دخول",
    hello: "لوحتك",
    bookings: "التلاميذ اللي حجزو",
    bookingsSub: "شكون حجز في حصتك.",
    bookingsEmpty: "ما زال حتّى حد ما حجز.",
    bookingsEmptyBody: "شارك رابطك. أوّل ما تلميذ يحجز، تشوفو هوني — اسمو، وقتاش حجز، ورابط الحصة.",
    signedUp: (n: number) => `${n} محجوز`,
    contactClosed: "معلومات الاتصال ما تتشاركش",
    messageStudent: "راسل",
    anon: "تلميذ",
    free: "فابور",
    paid: "خالص",
    reserved: "محجوز",
    attended: "حاضر",
    bookedAgo: "حجز",
    paymentsSoonTitle: "الخلاص أونلاين يوصل قريب",
    paymentsSoonBody: "توّا، حتى خلاص ما يعدّي من Tnajem وإنتي تحتفظ بـ 100 %. كي يتحل الخلاص أونلاين، رصيدك يبان هوني.", // phase-a lane L3 (A22)
    notifTitle: "الإشعارات",
    notifEmpty: "ما فماش جديد توّا.",
    justNow: "توّا",
    minsAgo: (n: number) => `هاذي ${n} دقيقة`,
    hoursAgo: (n: number) => `هاذي ${n} ساعة`,
    daysAgo: (n: number) => `هاذي ${n} يوم`,

    howTitle: "كيفاش يخدم", // phase-a lane L3 (A22)
    h1t: "إنتي تحدّد ثمنك",
    h1b: "حصة بحصة، بلا سقف.",
    h2t: "التلميذ يحجز",
    h2b: "إسمو الأول والحجز متاعو يوصلو لهوني في الحين.",
    // phase-a lane L3 (A22)
    h3t: "الخلاص",
    h3b: "في فترة التجربة، Tnajem ما تاخذ حتى عمولة.",
    shareLabel: "اللينك متاعك متاع أستاذ",
    editStore: "عدّل صفحتي",
    materials: "وثائقي",
    ffTitle: "الحصة الأولى مجانية",
    ffBody:
      "كان تفعّلها، صفحتك تقول إلّي الحصة الأولى مجانية — وتنجّم تختارها حصة بحصة وقتلي تعمل وحدة. مادامها مطفية، تنجّم ما توعدش في بلاصتك.",
    ffOn: "مفعّلة",
    ffOff: "مطفية",
    ffSaving: "قاعد يتسجّل…",
    ffError: "ما مشاتش. عاود حاول.",

    planTitle: "العرض متاعك",
    planPilot: "تجربة",
    planPilotBody:
      "في فترة التجربة، الأساتذة الكل عندهم العرض الكامل : حصص بلا حدّ، وما فمّا حتى فاتورة. باش نعلموك قبل ما يتبدّل الحال.",
    planGrantedBody: "العرض فعّلو فريق Tnajem. ما تتفوترش حتى مليم.",
    // phase-a lane L3 (A25)
    planUnlimited: "الحصص المنشورة : بلا حدّ",
    planUsage: (used: number, max: number) => `الحصص المنشورة : ${used} من ${max}`,
    planUsageNote: "نحسبو الحصص الجايّة برك. حصة تلغات ولا فاتت ترجّعلك البلاصة.",
    planUntil: (d: string) => `حتى لـ ${d}.`,
    planSeeTarifs: "شوف العروض",
    // phase-a lane L5 (A18.10)
    phaseUpcoming: "جاية",
    phaseLive: "دايركت",
    phaseDone: "وفات",
    phaseCancelled: "تلغات",
  },
});

// Union of both locales — copy[locale] is fr-shaped OR ar-shaped (same keys).
// (Named CopyDict, not Copy: `Copy` is already the clipboard icon import.)
type CopyDict = (typeof copy)["fr"] | (typeof copy)["ar"];

/* Page-scoped CSS (`qd-`), injected with dangerouslySetInnerHTML and UNLAYERED so
   it wins over globals.css's @layer components without !important.
   • .balance .amt is 42px / -1.4px tracking in globals: a 5-digit amount blows out
     of the card, and Space Grotesk (--fd) has NO Arabic glyphs while the negative
     tracking severs Arabic cursive joins. Clamped + RTL fallback here.
   • The amount is isolated LTR so "1 280 TND" can't reorder inside an RTL page. */
const CSS = `
.qd-balance .amt{font-size:clamp(26px,6.5vw,40px);letter-spacing:-1px;line-height:1.08;
  overflow-wrap:anywhere;font-variant-numeric:tabular-nums;margin-top:4px}
.qd-balance.is-quiet .amt{font-size:clamp(22px,4.5vw,28px);letter-spacing:-.5px}
html[dir="rtl"] .qd-balance .amt{font-family:var(--fa);letter-spacing:normal}
.qd-num{direction:ltr;unicode-bidi:isolate;display:inline-block}
.qd-step{display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;
  padding:14px 0;border-block-end:1px solid var(--line)}
.qd-step:last-child{border-block-end:0;padding-bottom:2px}
.qd-step-txt{flex:1 1 220px;min-width:0}
.qd-mark{width:28px;height:28px;border-radius:10px;flex:none;display:grid;place-items:center;
  font-family:var(--fd);font-size:13px;font-weight:700;margin-top:1px}
.qd-cta{flex:none;width:auto}
.qd-tel{direction:ltr;unicode-bidi:isolate}
/* a .chip is inline-flex: next to shrinking text in a flex row it deforms */
.qd-step .chip{flex:none}
`;

// Relative time. Rendered client-side only (data arrives in an effect) → no hydration risk.
function timeAgo(iso: string, c: CopyDict): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return c.justNow;
  if (mins < 60) return c.minsAgo(mins);
  const hours = Math.floor(mins / 60);
  if (hours < 24) return c.hoursAgo(hours);
  return c.daysAgo(Math.floor(hours / 24));
}

// ── Notifications bell (real: getNotifications / markNotificationsRead) ──────
function NotifBell() {
  const { t, locale } = useLocale();
  const c = copy[locale];
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [unread, setUnread] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    getNotifications()
      .then((n) => {
        if (!alive) return;
        setItems(n);
        setUnread(n.filter((x) => !x.read).length);
      })
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDocDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next) return;
    // Refresh, then mark read server-side. We keep the per-item dots visible for
    // this open panel so the tutor can still see what was new.
    const fresh = await getNotifications().catch(() => [] as NotificationItem[]);
    setItems(fresh);
    if (fresh.some((n) => !n.read)) {
      await markNotificationsRead().catch(() => {});
      setUnread(0);
    }
  }

  const list = items ?? [];

  return (
    <div ref={wrapRef} className="relative">
      <button
        className="iconbtn relative"
        type="button"
        aria-label={t.extra.notifications}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={toggle}
      >
        <Bell />
        {unread > 0 && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              top: 6,
              insetInlineEnd: 6,
              minWidth: 8,
              height: 8,
              borderRadius: 999,
              background: "var(--green)",
              boxShadow: "0 0 0 2px var(--sand)",
            }}
          />
        )}
      </button>

      {/* Plain <div>, not role="menu". A menu promises menuitem children and
          arrow-key roving focus; this is a scrollable list of notification
          links, so the ARIA role was describing a widget that does not exist
          and broke navigation for anyone relying on it. */}
      {open && (
        <div
          aria-label={c.notifTitle}
          className="panel absolute top-[calc(100%_+_8px)] end-0 w-[min(330px,_calc(100vw_-_32px))] max-h-[420px] overflow-y-auto z-[60] p-1.5 text-start"
        >
          <div
            style={{
              fontFamily: "var(--fd)",
              fontSize: 13,
              fontWeight: 700,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: ".5px",
              padding: "10px 12px 8px",
            }}
          >
            {c.notifTitle}
          </div>

          {items === null ? (
            <div className="grid place-items-center p-6">
              <Spinner />
            </div>
          ) : list.length === 0 ? (
            <div style={{ padding: "14px 12px 18px", fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
              {c.notifEmpty}
            </div>
          ) : (
            list.map((n) => {
              const inner = (
                <>
                  <span
                    aria-hidden="true"
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 999,
                      background: n.read ? "transparent" : "var(--blue)",
                      flexShrink: 0,
                      marginTop: 7,
                    }}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13.5px] font-bold text-ink">
                      {n.title}
                    </span>
                    <span className="block text-[13px] text-ink2 leading-[1.5] mt-0.5">
                      {n.body}
                    </span>
                    <span className="block text-[13px] text-muted mt-1">
                      {timeAgo(n.createdAt, c)}
                    </span>
                  </span>
                </>
              );
              const rowStyle: React.CSSProperties = {
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
                padding: "11px 12px",
                borderRadius: 12,
                color: "inherit",
                background: n.read ? "transparent" : "var(--blue50)",
                marginBottom: 3,
              };
              return n.href ? (
                <Link key={n.id} href={n.href} role="menuitem" style={rowStyle} onClick={() => setOpen(false)}>
                  {inner}
                </Link>
              ) : (
                <div key={n.id} role="menuitem" style={rowStyle}>
                  {inner}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ── "What to do next" — the tutor's whole job, in order ─────────────────────
function StepMark({ state, n }: { state: StepState; n: number }) {
  const style: React.CSSProperties =
    state === "done"
      ? { background: "var(--green-btn)", color: "#fff" }
      : state === "waiting"
      ? { background: "var(--blue50)", color: "var(--blue)" }
      : state === "current"
      ? { background: "var(--ochre-btn)", color: "#fff" }
      : { background: "var(--sand)", color: "var(--muted)" };
  return (
    <span className="qd-mark" style={style} aria-hidden="true">
      {state === "done" ? <Check className="w-[15px] h-[15px]" /> : state === "waiting" ? <Clock className="w-[15px] h-[15px]" /> : n}
    </span>
  );
}

/* heroOwnsCta: the no-storefront screen already shows "Créer ma page" as its ONE ochre
   action in the hero card, so the checklist repeats it as a ghost button (UI Option A, A3). */
function NextSteps({ steps, heroOwnsCta = false }: { steps: OnboardingStep[]; heroOwnsCta?: boolean }) {
  const { locale } = useLocale();
  const c = STEP_COPY[locale];
  return (
    <div className="panel panel-pad mb-[clamp(14px,2vw,22px)]">
      <div className="mb-1.5">
        <h2 className="font-display text-[16px] font-bold">{c.nextTitle}</h2>
        <div className="text-[13px] text-muted mt-[3px]">{c.nextSub}</div>
      </div>

      {steps.map((s, i) => (
        <div key={s.key} className="qd-step">
          <StepMark state={s.state} n={i + 1} />
          <div className="qd-step-txt">
            <div className="flex items-center gap-2 flex-wrap">
              <span style={{ fontSize: 14.5, fontWeight: 700, color: s.state === "todo" ? "var(--ink2)" : "var(--ink)" }}>
                {s.title}
              </span>
              {s.state === "done" && <span className="chip chip-soft bg-green50 text-green-ink">{c.done}</span>}
              {s.state === "waiting" && <span className="chip chip-soft">{c.inProgress}</span>}
            </div>
            <div className="text-[13px] text-muted leading-[1.6] mt-[3px]">{s.body}</div>
          </div>
          {s.cta && (
            <Link href={s.cta.href} className={`btn ${heroOwnsCta ? "btn-ghost" : "btn-primary"} btn-sm qd-cta`}>
              {s.cta.label}
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}

// ── How you actually get paid during the pilot (honest, page-local copy) ────
function HowItWorks({ c, paymentsOn = false }: { c: CopyDict; paymentsOn?: boolean }) {
  const { locale } = useLocale(); // phase-a lane L3 (A22)
  const steps = [
    { n: 1, title: c.h1t, body: c.h1b },
    { n: 2, title: c.h2t, body: c.h2b },
    { n: 3, title: c.h3t, body: c.h3b },
  ];
  return (
    <div className="panel panel-pad">
      <div className="font-display text-[16px] font-bold mb-2.5">{c.howTitle}</div>
      {steps.map((s) => (
        <div
          key={s.n}
          style={{
            display: "flex",
            gap: 13,
            alignItems: "flex-start",
            padding: "13px 0",
            borderBottom: s.n < 3 ? "1px solid var(--line)" : "none",
          }}
        >
          <div
            className="w-[27px] h-[27px] rounded-[9px] bg-blue text-white grid place-items-center font-display text-[13px] shrink-0" /* UI Option A (A3): step numbers are cobalt */
          >
            {s.n}
          </div>
          <div className="min-w-0">
            <div className="text-[14px] font-semibold mb-0.5">{s.title}</div>
            <div className="text-[13px] text-muted leading-[1.55]">{s.body}</div>
            {/* phase-a lane L3 (A22): the one payment story, labelled "Bientôt" while payments are off. */}
            {s.n === 3 && (
              <div className="text-[13px] text-muted leading-[1.55] mt-1">
                <PaymentStory locale={locale} audience="tutor" enabled={paymentsOn} />
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Shared: copyable storefront link box (real slug) ────────────────────────
function StoreLinkBox({ slug }: { slug: string }) {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);
  const url = `tnajem.com/${slug}`;
  function handleCopy() {
    navigator.clipboard.writeText(`https://${url}`).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", background: "var(--sand)",
        border: "1.4px dashed var(--blue)", borderRadius: 13, padding: "11px 13px",
      }}
    >
      <span className="text-blue shrink-0 flex" aria-hidden="true">
        <Share />
      </span>
      <span
        dir="ltr"
        style={{
          fontFamily: "var(--fd)", fontSize: 13, color: "var(--blue)", textAlign: "start",
          overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", flex: "1 1 140px", minWidth: 0,
        }}
      >
        {url}
      </span>
      <button
        type="button"
        onClick={handleCopy}
        style={{
          marginInlineStart: "auto", background: copied ? "var(--green)" : "var(--blue)", color: "#fff",
          border: 0, padding: "10px 13px", borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: "pointer",
          flexShrink: 0, minHeight: 44, fontFamily: "var(--fb)", transition: "background .2s",
          display: "inline-flex", alignItems: "center", gap: 5,
        }}
      >
        {copied ? t.common.copied : (<><Copy />{t.common.copy}</>)}
      </button>
    </div>
  );
}

// ── Share panel — the growth loop, always visible once the page exists ───────
function SharePanel({ slug, c }: { slug: string; c: CopyDict }) {
  const { t } = useLocale();
  return (
    <div id="share" className="panel panel-pad" style={{ marginBottom: "clamp(14px,2vw,22px)", scrollMarginTop: 84 }}>
      <div className="flex items-baseline justify-between gap-2.5 flex-wrap mb-1">
        <h2 className="font-display text-[16px] font-bold">{t.dashboard.shareTitle}</h2>
        <span className="text-[13px] font-bold text-muted uppercase tracking-[.5px]">
          {c.shareLabel}
        </span>
      </div>
      <p className="text-[13px] text-muted leading-[1.6] mb-3">{t.dashboard.shareBody}</p>
      <StoreLinkBox slug={slug} />
      <div className="mt-3 flex gap-2 flex-wrap">
        <Link href={`/${slug}`} className="btn btn-ghost btn-sm">
          <Eye />
          {t.dashboard.viewStore}
        </Link>
        {/* STEP 9. /onboarding has always updated in place and opened pre-filled,
            but it was linked ONLY from the no-storefront state — so a tutor who
            finished onboarding had no route back to fix a typo in their own public
            page. The feature existed; the door did not. */}
        <Link href="/onboarding" className="btn btn-ghost btn-sm">
          {c.editStore}
        </Link>
        {/* Step 10. Beside the storefront links because that is what a library
            attaches to — a tutor thinks about it as part of their page. */}
        <Link href="/dashboard/materials" className="btn btn-ghost btn-sm">
          {c.materials}
        </Link>
      </div>
    </div>
  );
}

/* ── Free first session — the tutor's own opt-in ─────────────────────────────

   Before Step 6 the platform said "Première séance offerte" on every storefront,
   in the JSON-LD Offer and in llms.txt, on behalf of every tutor — because
   classes.is_free_first defaulted to true and nobody had ever been asked. Terms
   §5 has always said a tutor "peut choisir". This is where they choose.

   OPTIMISTIC, then reconciled. The switch flips immediately because a toggle that
   waits on a network round trip over Tunisian 3G feels broken; if the call fails
   it snaps BACK and says so, rather than leaving the UI claiming a state the
   server never accepted. That direction matters: the failure mode to avoid is a
   tutor believing they turned it off when they did not. */
/* TON OFFRE — the tutor's own plan, and what it lets them do.

   READ-ONLY, and that is the honest shape today: there is no checkout, so a
   button here would either lead nowhere or imply a purchase that cannot happen.
   It links to /tarifs, which is where the offers are described and labelled as
   future.

   The usage line is the point. "Cours en ligne : 3 sur 5" is the number the API
   enforces in POST /classes, so a tutor meets the limit here — on a calm screen
   — instead of at the end of a form they have just filled in. */
function PlanPanel({ d, c, locale }: { d: DashboardData; c: CopyDict; locale: "fr" | "ar" }) {
  const p = d.plan;
  const until =
    p.expiresAt
      ? formatLongDate(p.expiresAt, locale) // the Tunis calendar day, not the browser's
      : null;

  return (
    <div className="panel panel-pad mb-[clamp(14px,2vw,22px)]">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h2 className="font-display text-[16px] font-bold">{c.planTitle}</h2>
            <Chip kind="soft">{p.isPilot ? c.planPilot : p.code}</Chip>
          </div>
          {/* Two different true sentences, never one that covers both: "you are on
              the pilot and nothing is billed" is not the same statement as "an
              admin put you on this offer and nothing is billed". */}
          <p className="text-[13px] text-muted leading-[1.6]">
            {p.isPilot ? c.planPilotBody : c.planGrantedBody}
          </p>
          {until && <p className="text-[13px] text-muted leading-[1.6] mt-1">{c.planUntil(until)}</p>}
        </div>
        <Link href="/tarifs" className="btn btn-ghost btn-sm flex-none">
          {c.planSeeTarifs}
        </Link>
      </div>

      <p className="text-[13px] font-bold mt-3">
        {p.maxClasses === null ? c.planUnlimited : c.planUsage(p.openClasses, p.maxClasses)}
      </p>
      {p.maxClasses !== null && (
        <p className="text-[13px] text-muted leading-[1.6] mt-1">{c.planUsageNote}</p>
      )}
    </div>
  );
}

function FreeFirstPanel({ d, c }: { d: DashboardData; c: CopyDict }) {
  const [on, setOn] = useState(d.offersFreeFirstSession);
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
    /* id: the new-class form links here while the option is off (phase-a lane L5, A18.6). */
    <div id="free-first" className="panel panel-pad mb-[clamp(14px,2vw,22px)]" style={{ scrollMarginTop: 84 }}>
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
          /* min-h-11: py-2 around 14px text gave a 40px switch. It is a
             role="switch" that turns a public promise about money on and off —
             the last control on this page that should be easy to mis-tap. */
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
            {/* Inline, with an explicit white stroke, exactly as new-class/page.tsx
                does it: the shared <Check /> inherits currentColor, which on a
                --green fill is dark-on-dark. globals.css says --green is a BRAND
                fill, not a text colour, for the same contrast reason. */}
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

// ── Balance card — always the REAL balance (0 while payments are off) ────────
function BalanceCard({ d }: { d: DashboardData }) {
  const { t, locale } = useLocale();
  const c = copy[locale];
  return (
    <div
      className={`balance qd-balance zellige hero-blue panel${d.paymentsEnabled ? "" : " is-quiet"}`}
      style={{ borderRadius: "var(--r-l)", padding: "clamp(18px,2.4vw,26px)", border: "none", minWidth: 0 }}
    >
      <div className="lbl">
        <Wallet />
        {t.dashboard.balance}
      </div>
      <div className="amt">
        <span className="qd-num">
          {d.balance_tnd.toLocaleString("fr-FR")}
          <small> TND</small>
        </span>
      </div>
      <div
        style={{
          display: "flex", alignItems: "flex-start", gap: 8, marginTop: 15, background: "rgba(255,255,255,.13)",
          padding: "10px 12px", borderRadius: 12, fontSize: 13, color: "var(--on-blue)", position: "relative", zIndex: 2,
          lineHeight: 1.55,
        }}
      >
        <span className="inline-flex text-amber shrink-0 mt-[1px]" aria-hidden="true">
          <Bulb className="w-4 h-4" />
        </span>
        <span className="min-w-0">{d.paymentsEnabled ? t.dashboard.emptyNote : c.paymentsSoonBody}</span>
      </div>
    </div>
  );
}

// ── Bookings: who actually booked (name + phone + when) ──────────────────────
type BookingGroup = { classId: string; classTitle: string; classTs: number; items: DashboardBooking[] };

function statusLabel(s: DashboardBooking["status"], c: CopyDict): string {
  if (s === "paid") return c.paid;
  if (s === "attended") return c.attended;
  return c.reserved;
}

function BookingsPanel({ d }: { d: DashboardData }) {
  const { locale } = useLocale();
  const c = copy[locale];

  const groups: BookingGroup[] = useMemo(() => {
    const map = new Map<string, BookingGroup>();
    for (const b of d.bookings) {
      if (b.status === "cancelled") continue; // a freed seat isn't a student
      const g = map.get(b.classId);
      if (g) g.items.push(b);
      else map.set(b.classId, { classId: b.classId, classTitle: b.classTitle, classTs: b.classTs, items: [b] });
    }
    return [...map.values()].sort((a, b) => a.classTs - b.classTs);
  }, [d.bookings]);

  return (
    <div className="panel panel-pad mb-[clamp(14px,2vw,22px)]">
      <div className="mb-3.5">
        <h2 className="font-display text-[16px] font-bold">{c.bookings}</h2>
        <div className="text-[13px] text-muted mt-0.5">{c.bookingsSub}</div>
      </div>

      {groups.length === 0 ? (
        <div
          style={{
            display: "flex", gap: 13, alignItems: "flex-start", padding: "16px 16px",
            background: "var(--cream)", border: "1px dashed var(--line)", borderRadius: 14,
          }}
        >
          <span className="text-blue inline-flex shrink-0 mt-0.5" aria-hidden="true">
            <Users />
          </span>
          <div className="min-w-0">
            <div className="text-[14px] font-bold mb-[3px]">{c.bookingsEmpty}</div>
            <div className="text-[13px] text-muted leading-[1.6]">{c.bookingsEmptyBody}</div>
          </div>
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.classId} className="mb-4">
            <div
              style={{
                display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
                paddingBottom: 8, borderBottom: "1px solid var(--line)", marginBottom: 6,
              }}
            >
              <span className="text-blue inline-flex shrink-0" aria-hidden="true">
                <Video className="w-4 h-4" />
              </span>
              <Link
                href={`/class/${g.classId}`}
                style={{
                  fontSize: 13.5, fontWeight: 700, color: "var(--ink)", flex: "1 1 140px", minWidth: 0,
                  overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
                }}
              >
                <UserText>{g.classTitle}</UserText>
              </Link>
              <span
                className="ms-auto text-[13px] font-bold text-blue bg-blue50 py-[3px] px-[9px] rounded-[999px] shrink-0"
              >
                {c.signedUp(g.items.length)}
              </span>
            </div>

            {g.items.map((b) => (
              <div
                key={b.bookingId}
                style={{
                  display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap",
                  padding: "11px 0", borderBottom: "1px solid var(--line)",
                }}
              >
                <div
                  aria-hidden="true"
                  className="w-[38px] h-[38px] rounded-[12px] flex-none grid place-items-center bg-sand text-ink2 font-display text-[14px] font-bold"
                >
                  {(b.studentName ?? "?").trim().charAt(0).toUpperCase() || "?"}
                </div>

                <div className="flex-[1_1_150px] min-w-0">
                  <UserText as="div"
                    style={{
                      fontSize: 13.5, fontWeight: 600, overflow: "hidden",
                      whiteSpace: "nowrap", textOverflow: "ellipsis",
                    }}
                  >
                    {b.studentName?.trim() || c.anon}
                  </UserText>
                  <div
                    className="text-[13px] text-muted mt-0.5 flex items-center gap-[5px] flex-wrap"
                  >
                    <Clock className="w-3 h-3" />
                    {c.bookedAgo} {timeAgo(b.bookedAt, c)}
                    <span aria-hidden="true">·</span>
                    <span style={{ color: b.isFree ? "var(--green)" : "var(--ink2)", fontWeight: 700 }}>
                      {b.isFree ? c.free : statusLabel(b.status, c)}
                    </span>
                  </div>
                </div>

                {/* NO CONTACT DETAILS. Step 8 — zero contact exchange.

                    This block used to render the student's phone as a `tel:`
                    link and fall back to a `mailto:` with the address as the
                    visible label. The data no longer reaches this component at
                    all: apps/api does not select those columns (see the note in
                    routes/classes.ts), so there is nothing here to render even
                    by accident.

                    What replaces it is the thing a tutor actually needs before a
                    class — when the seat was taken and whether it is free —
                    already shown above, plus a plain statement of the rule so the
                    absence reads as a policy rather than a bug. Messaging (Step
                    8b) is the replacement channel; until it ships, saying so is
                    better than an empty column. */}
                <div className="flex-none flex items-center gap-2 flex-wrap" style={{ marginInlineStart: "auto" }}>
                  <span className="text-[13px] italic" style={{ color: "var(--muted)" }}>
                    {c.contactClosed}
                  </span>
                  {/* THE REPLACEMENT, in the same place as the thing removed.
                      Without it a tutor experiences Step 8 as a capability taken
                      away rather than a channel moved. */}
                  <MessageBookingButton
                    bookingId={b.bookingId}
                    ariaLabel={`${c.messageStudent} ${b.studentName ?? ""}`.trim()}
                  />
                </div>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

// phase-a lane L5 (A18.10): À venir · En direct · Terminée · Annulée.
function PhaseChip({ phase, c }: { phase: ClassPhase; c: CopyDict }) {
  // Phase A+ (U3): "En direct" is the paper pill with a rose dot (.tag-live) — never green.
  const [label, cls] =
    phase === "live" ? [c.phaseLive, "tag tag-live"]
      : phase === "done" ? [c.phaseDone, "chip chip-sand"]
      : phase === "cancelled" ? [c.phaseCancelled, "chip chip-rose"]
      : [c.phaseUpcoming, "chip chip-soft"];
  return (
    <span className={`${cls} mt-1.5`} data-e2e="class-phase" data-phase={phase}>
      {label}
    </span>
  );
}

// ── Real: tutor with a live storefront ──────────────────────────────────────
function RealDashboard(
  { d, steps, onChanged }: { d: DashboardData; steps: OnboardingStep[]; onChanged: () => void },
) {
  const { t, locale } = useLocale();
  const c = copy[locale];
  const stats = [
    { value: d.students, label: t.dashboard.stStudents, color: "var(--blue)" },
    { value: d.sessions, label: t.dashboard.stSessions, color: "var(--ink)" },
    {
      value: d.reviewCount > 0 ? d.rating : "—",
      label: t.dashboard.stRating,
      color: "var(--amber)",
    },
  ];

  return (
    <>
      <NextSteps steps={steps} />

      {/* Who booked — the tutor's core job-to-be-done */}
      <BookingsPanel d={d} />

      {/* Share link — the only way students find them */}
      {d.slug && <SharePanel slug={d.slug} c={c} />}

      {/* Step 13. Beside the free-session toggle because both are things a tutor
          sets ABOUT their public page, and both only make sense once one exists. */}
      {d.has_storefront && d.slug && (
        <AvatarUpload
          slug={d.slug}
          initials={initials(d.name ?? "")}
          status={d.avatarStatus}
          onChanged={onChanged}
        />
      )}

      {/* Free first session — only once a storefront exists, since it is a claim
          made ON that page and there is nowhere to make it before then. */}
      {/* NOT gated on has_storefront, unlike the panels below it. The plan and
          what it costs apply from the moment someone is a tutor, and gating this
          meant a tutor who had not published yet could not find the offers
          anywhere in the product — the sidebar link and this panel were the only
          two routes, and this one was hidden exactly when the other was most
          needed. getDashboard already returns the default plan for a tutor with
          no storefront, so there is nothing to guard against. */}
      <PlanPanel d={d} c={c} locale={locale} />
      {d.has_storefront && <FreeFirstPanel d={d} c={c} />}

      {/* My classes */}
      {d.classes.length > 0 && (
        <div className="panel panel-pad mb-[clamp(14px,2vw,22px)]">
          <h2 className="font-display text-[16px] font-bold mb-3.5">{t.dashboard.myClasses}</h2>
          {d.classes.map((cl) => (
            /* The row is a WRAPPER, not the link itself. ClassActions renders
               <button>s, and a button nested inside an <a> is invalid HTML whose
               click both navigates and acts — the worst possible behaviour for a
               control that cancels a class. */
            <div key={cl.id} style={{ padding: "13px 0", borderBottom: "1px solid var(--line)" }}>
              <Link
                href={`/class/${cl.id}`}
                style={{ display: "flex", gap: 12, alignItems: "center", color: "inherit" }}
              >
                <div aria-hidden="true" className="w-10 h-10 rounded-[12px] grid place-items-center flex-none bg-blue50 text-blue">
                  <Video />
                </div>
                <div className="flex-1 min-w-0">
                  <UserText as="div" style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{cl.title}</UserText>
                  <time className="block text-[13px] text-muted mt-0.5" dateTime={cl.starts_at}>{cl.day} {monthLabel(cl.month, locale)} · {cl.time}</time>
                  {/* phase-a lane L5 (A18.10): a cancelled or finished class no longer looks live. */}
                  <PhaseChip phase={classPhase(cl)} c={c} />
                </div>
                <div className="text-end flex-none ms-auto">
                  <div className="qd-num font-display font-bold text-ink">{cl.price_tnd} TND</div>
                  <div className="qd-num text-[13px] text-muted flex items-center gap-1 justify-end mt-0.5">
                    <Users className="w-3 h-3" />{cl.seats_left}/{cl.seats}
                  </div>
                </div>
              </Link>
              {/* Only for a class that can still be acted on. Offering "cancel"
                  on one that already ran is a button whose only outcome is an
                  error message. */}
              {cl.status === "scheduled" && (
                <ClassActions classId={cl.id} startsAt={cl.starts_at} onChanged={onChanged} />
              )}
            </div>
          ))}
        </div>
      )}

      {/* My packs */}
      {d.packs.length > 0 && (
        <div className="panel panel-pad mb-[clamp(14px,2vw,22px)]">
          <h2 className="font-display text-[16px] font-bold mb-3.5">{t.dashboard.myPacks}</h2>
          {d.packs.map((p) => (
            <div
              key={p.id}
              style={{ display: "flex", gap: 12, alignItems: "center", padding: "13px 0", borderBottom: "1px solid var(--line)" }}
            >
              <div aria-hidden="true" className="w-10 h-10 rounded-[12px] grid place-items-center flex-none bg-blue50 text-blue" /* Phase A+ (U1): decorative, not a success — as the storefront pack tile */>
                <Book />
              </div>
              <div className="flex-1 min-w-0">
                <UserText as="div" style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.title}</UserText>
                {p.meta && <UserText as="div" className="text-[13px] text-muted mt-0.5">{p.meta}</UserText>}
              </div>
              <div className="qd-num font-display font-bold text-ink flex-none ms-auto">{p.price_tnd} TND</div>
            </div>
          ))}
        </div>
      )}

      {/* Money + numbers, below the work. Balance is the REAL 0 while payments are off. */}
      <div className="grid-2 mb-[clamp(14px,2vw,22px)]">
        <BalanceCard d={d} />

        <div className="panel panel-pad flex flex-col gap-[clamp(10px,1.5vw,18px)] min-w-0">
          <div className="font-display text-[13px] font-bold text-muted uppercase tracking-[.5px]">
            {t.dashboard.recent}
          </div>
          {stats.map((s) => (
            <div key={s.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 14px", background: "var(--cream)", borderRadius: 13, border: "1px solid var(--line)" }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink2)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{s.label}</span>
              <b className="qd-num" style={{ fontFamily: "var(--fd)", fontSize: 22, color: s.color, flex: "none" }}>{s.value}</b>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-[clamp(14px,2vw,22px)]">
        <HowItWorks c={c} paymentsOn={d.paymentsEnabled} /> {/* phase-a lane L3 (A22) */}
      </div>

      {/* Cash-out CTA — only when payouts can actually happen. No promise otherwise. */}
      {d.paymentsEnabled && (
        <div className="mb-[clamp(14px,2vw,22px)]">
          <Link href="/dashboard/payout">
            <Button variant="primary">{/* Phase A+ (U3): the one main action, ochre — green is Vérifié/success */}
              <Wallet />
              {t.dashboard.cashout}
            </Button>
          </Link>
        </div>
      )}

      {/* Create CTAs — wrap instead of squashing on a 320px screen */}
      <div className="flex gap-2.5 flex-wrap">
        <Link href="/dashboard/new-class" className="flex-[1_1_180px] min-w-0">
          <Button variant={d.classes.length === 0 ? "primary" : "ghost"}>
            <Plus />
            {t.dashboard.newClass}
          </Button>
        </Link>
        <Link href="/dashboard/new-pack" className="flex-[1_1_180px] min-w-0">
          <Button variant="ghost">
            <Plus />
            {t.dashboard.newPack}
          </Button>
        </Link>
      </div>
    </>
  );
}

// ── Real: signed in but no storefront yet ───────────────────────────────────
function RealNoStore({ steps }: { steps: OnboardingStep[] }) {
  const { t, locale } = useLocale();
  const c = copy[locale];
  const sc = STEP_COPY[locale];
  return (
    <>
      <div className="panel panel-pad text-center mb-[clamp(14px,2vw,22px)]">
        <div aria-hidden="true" style={{ width: 60, height: 60, borderRadius: 18, background: "var(--blue50)", color: "var(--blue)", display: "grid", placeItems: "center", margin: "0 auto 13px" }}>
          <Share />
        </div>
        <h2 className="font-display text-[18px] mb-[7px]">{t.dashboard.createStore}</h2>
        <p className="text-[13px] text-muted leading-[1.6] mb-[18px] max-w-[440px] mx-auto">
          {t.dashboard.createStoreBody}
        </p>
        <Link href="/onboarding" className="btn btn-primary max-w-[300px] mx-auto">
          <Plus />
          {sc.st1cta}
        </Link>
      </div>
      <NextSteps steps={steps} heroOwnsCta />
      <HowItWorks c={c} />
    </>
  );
}

// ── Signed out / no session — never fabricate an earning view ───────────────
function SignedOut() {
  const { locale } = useLocale();
  const c = copy[locale];
  return (
    <div className="panel panel-pad text-center max-w-[560px] mx-auto">
      <div aria-hidden="true" style={{ width: 60, height: 60, borderRadius: 18, background: "var(--blue50)", color: "var(--blue)", display: "grid", placeItems: "center", margin: "0 auto 13px" }}>
        <Shield />
      </div>
      <h2 className="font-display text-[18px] mb-[7px]">{c.signedOutTitle}</h2>
      <p className="text-[13px] text-muted leading-[1.6] mb-[18px]">{c.signedOutBody}</p>
      <Link href="/auth" className="btn btn-primary max-w-[260px] mx-auto">
        {c.signIn}
      </Link>
    </div>
  );
}

// ── Page header (greeting + actions + settings/notifications) ───────────────
function DashHeader({
  title,
  subtitle,
  actions,
  showTools,
}: {
  title: string;
  /* Optional: the signed-out state's whole message lives in the <SignedOut>
     panel, so repeating it here rendered the same sentence twice on the page. */
  subtitle?: string;
  actions?: React.ReactNode;
  showTools?: boolean;
}) {
  const { t } = useLocale();
  return (
    <div
      className="flex items-center justify-between gap-3.5 mb-[clamp(18px,2.5vw,28px)] flex-wrap"
    >
      <div className="flex-[1_1_220px] min-w-0">
        <h1 className="font-display text-[clamp(20px,2.4vw,28px)] tracking-[-.5px] leading-[1.15]">
          {title}
        </h1>
        {subtitle ? <div className="text-[13px] text-muted mt-[3px]">{subtitle}</div> : null}
      </div>
      <div className="flex items-center gap-2 flex-wrap flex-none">
        {actions}
        {showTools && (
          <>
            <Link href="/account" className="iconbtn" aria-label={t.extra.settings}>
              <Gear />
            </Link>
            <NotifBell />
          </>
        )}
      </div>
    </div>
  );
}

/* Adapt the dashboard payload to the shared ladder's input (lib/onboarding-steps.ts). */
function progressOf(d: DashboardData | null) {
  return {
    hasStorefront: !!d?.has_storefront,
    status: d?.status ?? ("draft" as const),
    hasClass: (d?.classes.length ?? 0) > 0,
    hasSlug: !!d?.slug,
  };
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { t, locale } = useLocale();
  const c = copy[locale];
  /* undefined = loading · null = signed out / no session · {wrongRole} = signed in
     as the OTHER role · object = real tutor data */
  const [result, setResult] = useState<DashboardResult | undefined>(undefined);

  /* Reusable, because Step 11 gave the tutor two actions that CHANGE this data:
     cancelling a class and moving one. Re-fetching is the honest way to reflect
     that — patching the local array would drift from what the server actually
     did the first time one of those calls half-succeeded. */
  const reload = useCallback(() => {
    getDashboard()
      .then((d) => setResult(d))
      .catch(() => setResult(null));
  }, []);

  useEffect(() => {
    let alive = true;
    getDashboard()
      .then((d) => alive && setResult(d))
      .catch(() => alive && setResult(null));
    return () => {
      alive = false;
    };
  }, []);

  // Split the wrong-role case off so the rest of this component keeps the exact
  // three states it already reasons about (loading / signed out / tutor data).
  const wrong = result && "wrongRole" in result ? result : null;
  const data: DashboardData | null | undefined =
    result === undefined ? undefined
      : result === null || "wrongRole" in result ? null
      : result;

  const firstName = (data?.name ?? "").trim().split(/\s+/)[0];
  const hasPublished = !!data && (data.classes.length > 0 || data.packs.length > 0);

  let header: React.ReactNode = null;
  let body: React.ReactNode;

  if (data === undefined) {
    body = (
      <div className="panel panel-pad grid place-items-center min-h-[200px]">
        <Spinner />
      </div>
    );
  } else if (wrong) {
    /* Signed in, but as a student. Checked BEFORE the signed-out branch: they do
       have a session, and "connecte-toi" would be a lie. */
    header = <DashHeader title={t.nav.dashboard} />;
    body = <WrongRoleNotice role={wrong.wrongRole} />;
  } else if (data === null) {
    // No session (or no DB). Never render fabricated earnings — prompt sign-in.
    /* Title is the page name, not the panel's message: passing signedOutTitle +
       signedOutBody here printed the identical heading and paragraph twice, once
       as the page header and again inside <SignedOut>. */
    header = <DashHeader title={t.nav.dashboard} />;
    body = <SignedOut />;
  } else if (!data.has_storefront) {
    header = <DashHeader title={t.dashboard.createStore} subtitle={t.dashboard.createStoreBody} showTools />;
    body = <RealNoStore steps={buildTutorSteps(progressOf(data), locale)} />;
  } else {
    header = (
      <DashHeader
        title={firstName ? t.dashboard.hi(firstName) : c.hello}
        subtitle={hasPublished ? t.dashboard.online : t.dashboard.createStoreBody}
        showTools
        actions={
          data.slug ? (
            <Link href={`/${data.slug}`} className="btn btn-ghost btn-sm">
              <Eye />
              {t.dashboard.viewStore}
            </Link>
          ) : null
        }
      />
    );
    body = (
      <RealDashboard d={data} steps={buildTutorSteps(progressOf(data), locale)} onChanged={reload} />
    );
  }

  return (
    <SiteShell>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <section className="web-section tight">
        <div className="container">
          <div className="app-layout">
            {/* Fail closed: while loading, signed out, or wrong-role, no payout link. */}
            <DashboardSidebar paymentsEnabled={data?.paymentsEnabled ?? false} />
            <div className="min-w-0">
              {header}
              {body}
            </div>
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
