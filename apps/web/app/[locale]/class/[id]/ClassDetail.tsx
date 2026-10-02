"use client";
import { useState, useEffect } from "react";
import { Link } from "@/components/Link";
import { Spinner } from "@/components/ui";
import { SiteShell } from "@/components/SiteShell";
import { Calendar, Clock, Users, Shield, Gift, Back } from "@/components/icons";
import { useLocale } from "@/components/LocaleProvider";
import { UserText } from "@/components/UserText";
import { ReportButton } from "@/components/ReportButton";
import { getClass } from "@/app/actions";
import { isOpenForBooking, monthLabel, LEVEL_LABELS, displaySubject, type ClassItem } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";
import { VitrineBeacon } from "@/components/share/VitrineBeacon"; // espace prof v2 · growth (P3)
import { FollowButton } from "@/components/follow/FollowButton"; // espace prof v2 · growth (P4)
import { PromoPrice } from "@/components/pricing/PromoPrice"; // espace prof v2 · growth (P5)
import { PromoCodeBanner } from "@/components/pricing/PromoCodeBanner"; // espace prof v2 · growth (P5)
import { getTutorPricing } from "@/app/actions-growth"; // espace prof v2 · growth (P5)
import type { PublicPromotion } from "@tnajem/shared";


/* Page-local copy (lib/i18n.ts is shared). One shared key is deliberately unused:
     • t.common.seats   → "${n} places", which reads "1 places" and, at 0, still
       looks bookable. `seats()` says "Complet" / "كامل".
   (t.common.secure used to be listed here too. It has been deleted outright: it
   was the last of the bank-card claims, it rendered nowhere, and a dead string
   is one nobody notices has stopped being true.)
     • t.extra.noResults→ "Aucun prof trouvé", which was shown when a CLASS 404s. */
const copy = bilingual({
  fr: {
    reassure: "1ère séance gratuite · annulation gratuite jusqu'à 48h avant",
    /* Shown when THIS class is not a free first session — the common case since
       the free session became a per-tutor opt-in (Step 6). */
    reassurePaid: "Annulation gratuite jusqu'à 48h avant",
    reassureShort: "Sans engagement",
    bookShort: "Réserver",
    loading: "On charge la séance…",
    notFound: "Séance introuvable",
    notFoundBody: "Le lien a peut-être expiré, ou le prof a annulé cette séance.",
    otherClasses: "Voir d'autres séances",
    seats: (n: number) =>
      n <= 0 ? "Complet" : n === 1 ? "1 place restante" : `${n} places restantes`,
    free: "Gratuite",
    then: (p: number) => `puis ${p} TND la séance`,
    perSession: "la séance",
    soldOutTitle: "Cette séance est complète",
    soldOutBody: "Toutes les places sont prises. Trouve une autre séance — il y en a d'autres.",
    closedTitle: "Cette séance n'est plus ouverte à la réservation",
    closedBody: "Elle a déjà commencé, ou elle a été annulée. Trouve une autre séance — il y en a d'autres.",
  },
  ar: {
    reassure: "أول حصة فابور · إلغاء مجاني حتى 48 ساعة قبل", // phase-a lane L6 (A18.derija-2)
    reassurePaid: "إلغاء مجاني حتى 48 ساعة قبل",
    reassureShort: "بلا التزام",
    bookShort: "احجز",
    loading: "قاعدين نحمّلو الحصة…",
    notFound: "الحصة ما تلقاتش",
    notFoundBody: "يمكن الرابط فات وقتو، ولا الأستاذ لغى الحصة.",
    otherClasses: "شوف حصص أخرى",
    seats: (n: number) =>
      n <= 0 ? "كامل" : n === 1 ? "بلاصة وحدة تبقات" : n === 2 ? "زوز بلايص تبقاو" : `${n} بلايص تبقاو`,
    free: "فابور", // phase-a lane L6 (A18.derija-2)
    then: (p: number) => `من بعد ${p} د.ت للحصة`,
    perSession: "للحصة",
    soldOutTitle: "الحصة هاذي كاملة", // phase-a lane L6 (A18.derija-2)
    soldOutBody: "الأماكن الكل تحجزو. لوّج على حصة أخرى — فما غيرها.",
    closedTitle: "الحصة هاذي ما عادش تتحجز", // phase-a lane L6 (A18.derija-2)
    closedBody: "الحصة بدات ولا تلغات. لوّج على حصة أخرى — فما غيرها.",
  },
});

/* Page-scoped CSS. Lives here (not inline) because the layout has to survive
   320px-wide Arabic strings: media queries, logical properties and the RTL
   display-font fallback cannot be expressed as inline style objects. */
const PAGE_CSS = `
  /* Display font. No RTL override here: globals.css redefines --fd → --fa and
     zeroes letter-spacing under html[dir="rtl"], which covers this. */
  .cd-amount{font-family:var(--fd);font-weight:700;letter-spacing:-.3px}

  .cd-back{display:inline-flex;align-items:center;gap:6px;color:var(--muted);
    font-size:13.5px;font-weight:600;min-height:44px}
  .cd-back .ic{width:16px;height:16px}

  .cd-head{margin-bottom:28px}
  .cd-title{margin-bottom:6px;overflow-wrap:anywhere}
  .cd-with{color:var(--muted);font-size:15px;overflow-wrap:anywhere}

  /* ── grid ── */
  .cd-grid{display:grid;grid-template-columns:1fr;gap:clamp(16px,2.4vw,28px);align-items:start}

  /* ── when / meta ── */
  .cd-when{display:flex;align-items:center;gap:12px;margin-bottom:16px}
  /* The badge is solid blue with white text: the month follows it, not .thumb span's
     grey (grey on blue was unreadable). */
  .cd-when .thumb span{color:inherit}
  .cd-when-main{flex:1 1 0;min-width:0}
  .cd-label{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;
    color:var(--muted);margin-bottom:7px}
  .cd-desc{font-size:14.5px;line-height:1.7;color:var(--ink2);overflow-wrap:anywhere}
  .cd-soldout{color:var(--rose);font-weight:700}

  /* ── price rows: label on one side, amount block on the other. Wraps instead of
       crushing when the Arabic label + a 4-digit price meet a 320px screen. ── */
  .cd-pricerow{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
  .cd-pricelabel{font-size:13px;color:var(--muted);font-weight:600;min-width:0}
  .cd-priceval{text-align:end;min-width:0;margin-inline-start:auto}
  .cd-priceval .pp{justify-items:end}
  .cd-promo{margin-bottom:16px}
  .cd-amount{font-size:19px;line-height:1.2;white-space:nowrap}
  .cd-amount-lg{font-size:26px;letter-spacing:-.7px}
  .cd-free{color:var(--green-ink)}
  .cd-cur{font-size:.72em;font-weight:600;color:var(--muted)}
  .cd-then{font-size:13px;color:var(--muted);font-weight:600;margin-top:3px;line-height:1.4}

  /* Phase A+ (U1): information, in blue (was green). */
  .cd-callout{margin-top:14px;padding:11px 13px;background:var(--blue50);border-radius:13px;
    font-size:13px;color:var(--blue700);line-height:1.55;display:flex;gap:9px;align-items:flex-start}
  .cd-callout .ic{color:var(--blue);flex:none;width:17px;height:17px;margin-top:1px}

  /* ── tutor card ── */
  .cd-tutor{flex-direction:row;align-items:center;gap:14px}
  .cd-tutor-av{width:52px;height:52px;border-radius:15px;flex:none;
    background:linear-gradient(150deg,var(--amber),var(--ochre));display:grid;place-items:center;
    font-family:var(--fd);font-size:20px;color:var(--ink);font-weight:700}
  .cd-tutor-name{font-weight:700;font-size:14.5px;overflow-wrap:anywhere}
  .cd-tutor-meta{font-size:13px;color:var(--muted);margin-top:2px;overflow-wrap:anywhere}
  .cd-tutor{flex-wrap:wrap}
  .cd-follow{margin-inline-start:auto}

  /* ── booking panel ── */
  .cd-panel{position:sticky;top:84px}
  .cd-panel-title{font-weight:700;font-size:15.5px;margin-bottom:6px;line-height:1.3;overflow-wrap:anywhere}
  .cd-cta{min-height:52px;margin-top:4px}
  .cd-note{display:flex;justify-content:center;align-items:center;gap:7px;margin-top:11px;
    color:var(--muted);font-size:13px;text-align:center;line-height:1.45}
  .cd-note .ic{width:13px;height:13px;color:var(--green);flex:none}

  /* ── sold out ── */
  .cd-soldout-box{text-align:center}
  .cd-soldout-box p{font-size:13px;color:var(--muted);line-height:1.6;margin:6px 0 14px}

  /* ── mobile sticky CTA ──
       The old .barbtn faded to var(--cream) over a --sand page background, leaving a
       visible mismatched band. A blurred bar with a hairline top border reads as a
       deliberate action bar at every scroll position. */
  .cd-mobile-cta{position:sticky;bottom:0;z-index:20;
    background:rgba(251,247,240,.94);
    -webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);
    border-top:1px solid var(--line);
    margin-inline:calc(-1 * clamp(16px,4vw,40px));
    padding:12px clamp(16px,4vw,40px) max(14px,env(safe-area-inset-bottom))}
  .cd-mcta-row{display:flex;align-items:center;gap:12px}
  .cd-mcta-price{min-width:0;display:flex;flex-direction:column;line-height:1.2}
  .cd-mcta-price b{font-family:var(--fn);font-variant-numeric:tabular-nums;font-size:17px;letter-spacing:-.3px;white-space:nowrap}
  .cd-mcta-price span{font-size:13px;color:var(--muted);margin-top:2px}
  .cd-mcta-btn{flex:1 1 auto;width:auto;max-width:260px;margin-inline-start:auto;min-height:50px}

  /* on tablet/desktop: two columns, panel right */
  @media (min-width:760px){
    .cd-grid{grid-template-columns:1fr 340px}
    /* hide mobile sticky CTA — panel handles it */
    .cd-mobile-cta{display:none!important}
  }
  /* on mobile: hide the desktop panel column */
  @media (max-width:759px){
    .cd-panel-col{display:none!important}
  }
  @media (min-width:760px){
    .cd-soldout-mobile{display:none!important}
  }
`;

/* The class page, in the browser (it reads the viewer's own booking). The route,
   its ISR window and its share card (og:/twitter:) are ./page.tsx, a server
   component — espace prof v2 · growth (P3). */
export function ClassDetail({ id }: { id: string }) {
  const params = { id };
  const { t, locale } = useLocale();
  const c = copy[locale];
  const [cls, setCls] = useState<ClassItem | null | undefined>(undefined);

  useEffect(() => { getClass(params.id).then(setCls).catch(() => setCls(null)); }, [params.id]);

  // espace prof v2 · growth (P5): the tutor's live public promotions, read in the browser.
  const [promos, setPromos] = useState<PublicPromotion[]>([]);
  const slugForPricing = cls?.tutor_slug ?? null;
  useEffect(() => {
    if (!slugForPricing) return;
    getTutorPricing(slugForPricing).then((r) => setPromos(r?.promotions ?? [])).catch(() => {});
  }, [slugForPricing]);

  const styles = <style dangerouslySetInnerHTML={{ __html: PAGE_CSS }} />;

  if (cls === undefined) {
    return (
      <SiteShell>
        {styles}
        <section className="web-section tight">
          <div className="container grid place-items-center min-h-[240px] text-center">
            <div>
              <Spinner />
              <p className="text-muted text-[13.5px]">{c.loading}</p>
            </div>
          </div>
        </section>
      </SiteShell>
    );
  }
  if (cls === null) {
    return (
      <SiteShell>
        {styles}
        <section className="web-section tight">
          <div className="container text-center py-[clamp(28px,6vw,60px)] px-0">
            <h1 className="web-h2 mb-2.5">{c.notFound}</h1>
            <p className="text-muted text-[14px] leading-[1.6] mb-5">
              {c.notFoundBody}
            </p>
            <Link href="/explore" className="btn btn-primary max-w-[240px] mx-auto">
              {t.nav.explore}
            </Link>
          </div>
        </section>
      </SiteShell>
    );
  }

  const tutorName = cls.tutor_name ?? "—";
  const tutorInits = tutorName.split(" ").filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";
  /* phase-a lane L4 (A9): the tutor comes from the class itself, BY SLUG. This page
     used to search Explore for the tutor's name and take the first exact match, so
     two tutors called "Mohamed Ben Ali" could send a student to the wrong teacher.
     No slug (demo mode, a storefront that is not public) → back to the catalogue. */
  const tutorSlug = cls.tutor_slug ?? null;
  const backHref = tutorSlug ? `/${tutorSlug}` : "/explore";
  // Real subject/level from the tutor row — shown only when we actually have it.
  const tutorSubject = displaySubject(cls.tutor_subject, locale); // live-fixes-1 · C2: the label, not the code
  /* phase-a/integrate (A18.7): the class's own level if the tutor set one, else the
     levels the tutor chose — codes from the API, labelled here in the page's
     language. Nothing chosen → nothing shown (no default "Bac"). */
  const tutorLevel = cls.level
    ? LEVEL_LABELS[cls.level][locale]
    : (cls.tutor_levels ?? []).map((l) => LEVEL_LABELS[l][locale]).join(" · ");
  const tutorMeta = [tutorSubject, tutorLevel && !tutorSubject.includes(tutorLevel) ? tutorLevel : ""]
    .filter(Boolean)
    .join(" · ");
  const month = monthLabel(cls.month, locale);
  /* A class that has started, finished or been cancelled offers no booking, however
     many seats it has left. This page used to check seats only, so a past class
     still carried "Réserver". The server refuses it too (POST /bookings). */
  const closed = !isOpenForBooking(cls);
  const soldOut = !closed && cls.seats_left <= 0;
  const blocked = closed || soldOut;

  /* One price renderer, so "1ère gratuite" and "15 TND" can never sit side by side
     as if both applied to the session being booked. */
  /* espace prof v2 · growth (P5): a paid seat may carry a promotion — the same
     <PromoPrice> as the storefront (pricing.ts), with the tutor's live public
     promotions and a code this tab already validated for them. */
  const promoPrice = (variant: "row" | "panel" | "bar") =>
    tutorSlug && !cls.is_free_first && cls.price_tnd > 0 ? (
      <PromoPrice slug={tutorSlug} item={{ kind: "class", id: cls.id, priceTnd: cls.price_tnd }} promotions={promos} variant={variant} />
    ) : null;

  const priceValue = (
    <div className="cd-priceval">
      {promoPrice("row") ?? (cls.is_free_first ? (
        <>
          <div className="cd-amount cd-free">{c.free}</div>
          {cls.price_tnd > 0 && <div className="cd-then">{c.then(cls.price_tnd)}</div>}
        </>
      ) : (
        <>
          <div className="cd-amount">
            {cls.price_tnd} <span className="cd-cur">{t.common.tnd}</span>
          </div>
          <div className="cd-then">{c.perSession}</div>
        </>
      ))}
    </div>
  );

  const soldOutBox = (
    <div className="cd-soldout-box">
      <h2 className="text-[15.5px] mb-0.5">{closed ? c.closedTitle : c.soldOutTitle}</h2>
      <p>{closed ? c.closedBody : c.soldOutBody}</p>
      <Link href="/explore" className="btn btn-ghost">{c.otherClasses}</Link>
    </div>
  );

  return (
    <SiteShell>
      {styles}
      <section className="web-section tight">
        <div className="container">

          {/* Back breadcrumb */}
          <div className="mb-3.5">
            <Link href={backHref} className="cd-back">
              <Back />
              {t.common.back}
            </Link>
          </div>

          {/* Eyebrow + title */}
          <div className="cd-head">
            {/* A category kicker, not t.classDetail.book ("Réserver cette séance") —
                static text that reads like a CTA is a trap next to the real one. */}
            <p className="web-eyebrow mb-2">{t.storefront.live}</p>
            <UserText as="h1" className="web-h2 cd-title">{cls.title}</UserText>
            <p className="cd-with">
              {t.classDetail.with} <UserText>{tutorName}</UserText>
            </p>
          </div>

          {/* espace prof v2 · growth (P5): a ?promo= code this tab validated for this tutor. */}
          {tutorSlug && <PromoCodeBanner slug={tutorSlug} className="cd-promo" />}

          {/* ── Two-column grid ── */}
          <div className="cd-grid">

            {/* LEFT col — class meta */}
            <div className="min-w-0">

              {/* When / duration / seats */}
              <div className="u-card u-card-pad mb-4">
                <div className="cd-when">
                  <time className="thumb bg-blue text-white" dateTime={cls.starts_at}>
                    <b>{cls.day}</b>
                    <span>{month}</span>
                  </time>
                  {/* min-width:0 — without it this flex item refuses to shrink and the
                      meta line pushes out of the card at 320px. */}
                  <div className="cd-when-main">
                    <div className="cd-label">{t.classDetail.when}</div>
                    <div className="metaline">
                      <span>
                        <Clock />
                        <time dateTime={cls.starts_at}>{cls.time}</time> · {cls.duration_min} {t.common.min}
                      </span>
                      <span className={soldOut ? "cd-soldout" : undefined}>
                        <Users />
                        {c.seats(cls.seats_left)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="divider" />

                {/* Description */}
                {cls.description && (
                  <>
                    <div className="cd-label mt-4 mb-2">
                      {t.classDetail.about}
                    </div>
                    <UserText as="p" className="cd-desc">{cls.description}</UserText>
                    <div className="divider mt-4" />
                  </>
                )}

                {/* Price row */}
                <div className="cd-pricerow mt-4">
                  <span className="cd-pricelabel">{t.classDetail.price}</span>
                  {priceValue}
                </div>

                {/* Free-first callout */}
                {cls.is_free_first && (
                  <div className="cd-callout">
                    <Gift />
                    <span>{t.classDetail.freeFirst}</span>
                  </div>
                )}
              </div>

              {/* Tutor card */}
              <div className="u-card u-card-pad cd-tutor">
                <span className="cd-tutor-av" aria-hidden="true">{tutorInits}</span>
                <div className="min-w-0">
                  <div className="cd-tutor-name">
                    {tutorSlug ? (
                      <Link href={`/${tutorSlug}`} style={{ color: "inherit" }}><UserText>{tutorName}</UserText></Link>
                    ) : (<UserText>{tutorName}</UserText>)}
                  </div>
                  {tutorMeta && <UserText as="div" className="cd-tutor-meta">{tutorMeta}</UserText>}
                </div>
                {/* espace prof v2 · growth (P4): only for a public tutor (a slug is shipped only then). */}
                {tutorSlug && <FollowButton slug={tutorSlug} tutorName={tutorName} className="cd-follow" />}
              </div>

              {/* Sold out, mobile: the booking panel that carries this message is
                  desktop-only, and the sticky bar is suppressed — without this the
                  small screen would just lose the CTA with no explanation. */}
              {blocked && (
                <div className="u-card u-card-pad cd-soldout-mobile mt-4">
                  {soldOutBox}
                </div>
              )}
            </div>

            {/* RIGHT col — sticky booking panel */}
            <div className="cd-panel-col">
              <div className="panel panel-pad cd-panel">
                {blocked ? (
                  soldOutBox
                ) : (
                  <>
                    {/* Mini summary — which session this button books. */}
                    <div className="mb-4">
                      <UserText as="div" className="cd-panel-title">{cls.title}</UserText>
                      <div className="metaline">
                        <span>
                          <Calendar />
                          <time dateTime={cls.starts_at}>{cls.day} {month} · {cls.time}</time>
                        </span>
                        <span>
                          <Clock />
                          {cls.duration_min} {t.common.min}
                        </span>
                        <span>
                          <Users />
                          {c.seats(cls.seats_left)}
                        </span>
                      </div>
                    </div>

                    <div className="divider mb-4" />

                    {/* Price */}
                    <div className="cd-pricerow mb-[18px]">
                      <span className="cd-pricelabel">{t.classDetail.price}</span>
                      <div className="cd-priceval">
                        {promoPrice("panel") ?? (cls.is_free_first ? (
                          <>
                            <div className="cd-amount cd-amount-lg cd-free">{c.free}</div>
                            {cls.price_tnd > 0 && <div className="cd-then">{c.then(cls.price_tnd)}</div>}
                          </>
                        ) : (
                          <>
                            <div className="cd-amount cd-amount-lg">
                              {cls.price_tnd} <span className="cd-cur">{t.common.tnd}</span>
                            </div>
                            <div className="cd-then">{c.perSession}</div>
                          </>
                        ))}
                      </div>
                    </div>

                    {/* Book CTA — a link, not a <button> nested inside an <a>. */}
                    <Link href={`/checkout?class=${cls.id}`} className="btn btn-primary cd-cta">
                      {t.classDetail.book}
                    </Link>

                    {/* Trust micro-copy */}
                    <div className="cd-note">
                      <Shield />
                      <span>{cls.is_free_first ? c.reassure : c.reassurePaid}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Anyone can report a class — no account needed (Stage 5). */}
          <div className="mt-6">
            <ReportButton subjectKind="class" subjectId={cls.id} />
          </div>
          {/* espace prof v2 · growth (P3): a click on a shared class link, for Ma vitrine. */}
          {tutorSlug && <VitrineBeacon slug={tutorSlug} classId={cls.id} />}

          {/* Mobile-only sticky bottom CTA */}
          {!blocked && (
            <div className="cd-mobile-cta">
              <div className="cd-mcta-row">
                <div className="cd-mcta-price">
                  {promoPrice("bar") ?? (cls.is_free_first ? (
                    <>
                      <b className="cd-free">{c.free}</b>
                      <span>{t.classDetail.freeFirst}</span>
                    </>
                  ) : (
                    <>
                      <b>{cls.price_tnd} {t.common.tnd}</b>
                      <span>{c.perSession}</span>
                    </>
                  ))}
                </div>
                {/* Short visible label so the bar never wraps at 320px; the full
                    label stays as the accessible name (and contains the visible
                    text, per WCAG 2.5.3 Label in Name). */}
                <Link
                  href={`/checkout?class=${cls.id}`}
                  className="btn btn-primary cd-mcta-btn"
                  aria-label={t.classDetail.book}
                >
                  {c.bookShort}
                </Link>
              </div>
              <div className="cd-note">
                <Shield />
                <span>{c.reassureShort}</span>
              </div>
            </div>
          )}

        </div>
      </section>
    </SiteShell>
  );
}
