import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { StorefrontView } from "@/components/storefront/StorefrontView";
import { NotFoundScreen } from "@/components/NotFoundScreen";
import { ComingSoonScreen } from "@/components/storefront/ComingSoonScreen"; // espace prof v2 · shell
import { JsonLd } from "@/components/JsonLd";
import { getCachedStorefront, getCachedVisibility, STOREFRONT_TTL, tutorTag } from "@/lib/cache";
import { getTutorReviews } from "@/app/actions";
import { isLocale, DEFAULT_LOCALE, type AppLocale } from "@/lib/locale";
import { dict } from "@/lib/i18n";
import { priceWithPromotion, profileJsonLd } from "@tnajem/shared"; // espace prof v2 · pro (P7)
import { publicTutorName, publicDisplayName } from "@tnajem/shared"; // phase-a lane L2 (A23)
import { advertisesFreeFirst } from "@tnajem/shared"; // phase-a lane L3 (A5)

type Props = { params: Promise<{ locale: string; slug: string }> };

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tnajem.com";

/* espace prof v2 · shell — the tab title of « Ce prof arrive bientôt » (no name: see ComingSoonScreen). */
const COMING_SOON_TITLE = { fr: "Ce prof arrive bientôt", ar: "الأستاذ هذا جاي قريب" } as const;

/** hreflang alternates for a locale-agnostic subpath (relative → resolved by metadataBase). */
function altLanguages(subpath: string): Record<string, string> {
  return { "fr-TN": `/fr${subpath}`, "ar-TN": `/ar${subpath}`, "x-default": `/fr${subpath}` };
}

/* ══════════════════════════════════════════════════════════════════════════════
   RENDERING STRATEGY — this is the page that goes viral.

   A tutor drops tnajem.com/<slug> in a WhatsApp group; thousands of mid-range
   Androids on 3G open it inside a few minutes. Before this change, EVERY one of
   those hits ran four sequential Postgres queries (tutor, classes, packs,
   reviews) and re-rendered the whole React tree — the database was the first
   thing to fall over, and it would take the login flow (same pool) down with it.

   Two layers now stand in front of that:

     1. ISR (`revalidate` below). Next renders the page once, then serves the
        SAME HTML from disk to everyone for up to 60s, re-rendering in the
        background afterwards (stale-while-revalidate: nobody ever waits for it).
        A cache HIT costs zero database queries and zero React renders. This is
        the layer that actually survives the spike.

     2. unstable_cache around the data reads (lib/cache.ts). Belt and braces for
        the paths ISR does not cover — generateMetadata, a background
        re-render, an on-demand revalidation — so even a cache MISS storm from
        N workers collapses to one query per slug per window.

   Safe to cache as HTML because this page is 100% anonymous: it reads no
   cookies, and the only session-aware thing on screen (the header's login state)
   is fetched client-side by SiteHeader via getMe(). Nothing user-specific is
   ever baked into the cached bytes.

   60s is the staleness ceiling for a REJECTED tutor's page staying up — the
   trade-off is argued in full in lib/cache.ts. approveTutor/rejectTutor should
   call revalidateTutor(slug) to make it instant; see SCALABILITY.md.
   ═════════════════════════════════════════════════════════════════════════════ */

/* ISR window, in seconds. Next only accepts a statically analyzable literal here,
   so this cannot import STOREFRONT_TTL — keep the two equal (both 60). */
export const revalidate = 60;

/* Slugs not rendered at build time are generated on first request and then
   cached like any other (this is the default; it is stated explicitly because
   the whole marketplace depends on a brand-new tutor's link working the second
   they share it). */
export const dynamicParams = true;

/* THIS IS WHAT MAKES `revalidate` REAL. Without generateStaticParams a dynamic
   segment is rendered on every request and the ISR comment above was a wish: on
   15 Sept every storefront hit answered "Cache-Control: private, no-store" and
   .next/prerender-manifest.json listed no storefront at all. An empty list
   prerenders nothing at build (no API needed on the build box) and turns every
   slug into on-demand ISR: rendered on first request, then served from cache for
   60s. Unknown slugs never reach this cache — middleware rewrites them to the
   catch-all 404 before the page renders. */
export function generateStaticParams(): { locale: string; slug: string }[] {
  return [];
}

/** Reviews come from a "use server" module, so they get their own cache wrapper here. */
const cachedTutorReviews = (slug: string) =>
  unstable_cache(
    async (s: string) => getTutorReviews(s),
    ["tutor-reviews"],
    { revalidate: STOREFRONT_TTL, tags: [tutorTag(slug)] },
  )(slug);

/** Trim a bio down to something that survives a WhatsApp/Google preview. */
function clamp(s: string, max: number) {
  const clean = s.replace(/[«»"]/g, "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const stop = Math.max(cut.lastIndexOf(" "), max - 20);
  return `${cut.slice(0, stop).trimEnd()}…`;
}

/* This is the single most-shared page in the product: tutors paste their link on
   WhatsApp, TikTok and Insta. The preview card has to say WHO the tutor is and
   WHAT they teach — not "Tnajem — apprends avec ton prof". */
export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  // Same cached read as the page body → the OG-card crawler (WhatsApp fetches the
  // link preview once per share) does not add a second round of queries.
  const data = await getCachedStorefront(params.slug);
  const locale: AppLocale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE;

  /* Unknown slug → the body renders <NotFoundScreen>, middleware sets the 404
     status, and this keeps the dead URL out of the index. A tutor on the way
     (espace prof v2) → « Ce prof arrive bientôt », noindex all the same: nothing on
     it is theirs to rank yet. */
  if (!data) {
    if ((await getCachedVisibility(params.slug)) === "coming-soon") {
      return { title: COMING_SOON_TITLE[locale], robots: { index: false, follow: false } };
    }
    return { title: dict[locale].err.nfTitle, robots: { index: false, follow: false } };
  }

  const { tutor } = data;
  // phase-a lane L2 (A23) — D1: the link preview says "Mohamed B.", never the last name.
  const shownName = publicTutorName(tutor.full_name) ?? "";
  const subpath = `/${params.slug}`;
  const canonical = `/${locale}${subpath}`; // this locale's canonical URL
  // layout.tsx applies the "%s · Tnajem" template on top of this.
  const title = `${shownName} — ${tutor.subject}`;
  /* "paiement en dinar" promised a checkout that does not exist: payments are OFF
     for the pilot (lib/payments.ts), the storefront takes no card, and the link
     preview is the first thing a WhatsApp reader sees. Promise what we deliver. */
  /* CONDITIONAL since Step 6. This string is the WhatsApp link preview and the
     Google snippet — the first thing a stranger reads about this tutor — and it
     used to promise a free first session for every one of them. It can be
     conditional here, unlike the site-wide description, precisely because we know
     WHICH tutor this is. */
  // phase-a lane L3 (A5): the toggle AND a bookable free-first class, never the toggle alone.
  /* espace prof v2 · growth (P3): the card speaks the page's language — an Arabic
     link preview used to be French. */
  const ar = locale === "ar";
  const pitch = advertisesFreeFirst(tutor.offers_free_first_session, data.classes)
    ? (ar ? "احجز درس دايركت — أول حصة فابور، بلا التزام." : "Réserve un cours en direct — 1ère séance offerte, sans engagement.")
    : (ar ? "احجز درس دايركت — السوم معروف، بلا التزام." : "Réserve un cours en direct — tarif affiché, sans engagement.");
  const description = tutor.bio ? `${clamp(tutor.bio, 120)} · ${pitch}` : `${tutor.subject}. ${pitch}`;
  const ogTitle = `${title} · Tnajem`;
  const alt = ar ? `${shownName} على Tnajem — ${tutor.subject}` : `${shownName} sur Tnajem — ${tutor.subject}`;
  /* espace prof v2 · growth (P3): the tutor's own social card (opengraph-image.tsx in
     this folder — name, subject, Vérifié, the approved photo, the « à partir de »
     price), in this page's language, for og: AND twitter:. It replaces /og.png. */
  const card = `${canonical}/opengraph-image`;
  const firstName = publicDisplayName(tutor.full_name) ?? undefined; // phase-a lane L2 (A23): no og:last_name

  return {
    title,
    description,
    keywords: [
      shownName,
      tutor.subject,
      tutor.level,
      "cours particuliers",
      "cours en direct",
      "Tunisie",
      "Tnajem",
    ].filter(Boolean),
    // Per-locale canonical + fr-TN ⇄ ar-TN hreflang for this exact storefront.
    alternates: { canonical, languages: altLanguages(subpath) },
    openGraph: {
      type: "profile",
      firstName,
      username: tutor.slug,
      url: canonical,
      siteName: "Tnajem",
      locale: locale === "ar" ? "ar_TN" : "fr_TN",
      alternateLocale: locale === "ar" ? ["fr_TN"] : ["ar_TN"],
      title: ogTitle,
      description,
      images: [{ url: card, width: 1200, height: 630, alt }],
    },
    twitter: {
      card: "summary_large_image",
      title: ogTitle,
      description,
      images: [{ url: card, width: 1200, height: 630, alt }],
    },
  };
}

// Public tutor storefront (tnajem.com/<slug>). Server component: fetches from Postgres
// via the cached data layer (falls back to demo data when no API_URL is set).
// Reviews are fetched here (server-side) so the storefront ships them in the first
// paint — no client round-trip on a 3G phone.
export default async function StorefrontPage(props: Props) {
  const params = await props.params;
  // Still parallel: on a cold cache the two reads overlap, so the miss costs one
  // round trip's latency, not two.
  const [data, reviews] = await Promise.all([
    getCachedStorefront(params.slug),
    cachedTutorReviews(params.slug),
  ]);
  const loc: AppLocale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE;

  /* Unknown slug → render the branded "not found" screen INLINE rather than
     calling notFound().

     Measured on Next 14.2: a runtime notFound() fails the server render and
     ships `<html id="__next_error__"><body/>` — the production <body> for a bad
     slug came back literally empty — so a visitor whose bundle had not landed
     yet saw a white screen. This is the most-shared URL shape in the product (a
     tutor pastes their link into WhatsApp); a typo'd or retired slug has to
     still say what happened and offer a way onward, on a 3G Android, with no JS.

     The STATUS is still a real 404: proxy.ts asks app/api/tutor-exists
     (same cache entry as this read) and sets it before this render starts. It
     used to be a 200 — that was reversed by the 14 Sept review, because a soft
     404 gives Google unlimited duplicate URLs on the route that must rank. */
  /* espace prof v2 · shell — no public storefront, but a tutor on the way (draft or
     under review): « Ce prof arrive bientôt », a 200 the proxy lets through. It
     shows nothing of theirs; its owner is sent to /dashboard/storefront/preview
     client-side (components/storefront/OwnerCheck.tsx), so this stays ISR. */
  if (!data) {
    if ((await getCachedVisibility(params.slug)) === "coming-soon") {
      return <ComingSoonScreen locale={loc} slug={params.slug} />;
    }
    return <NotFoundScreen locale={loc} />;
  }

  const { tutor } = data;
  /* Truthful structured data for the storefront — espace prof v2 · pro (P7): built by
     @tnajem/shared/structured-data.ts, where the truth rules are tested once
     (apps/api/test/ep2-structured-data.test.ts): an AggregateRating ONLY from real
     reviews (the same tutorStanding the page renders), no Review objects, the public
     name ("Mohamed B.", A23), an image only for an approved photo, and an
     AggregateOffer only from classes that can actually be booked — at the price a
     student is quoted today (the one best PUBLIC promotion, pricing.ts / C6). Never a
     "0" for a free first session: that is per student, not a property of a class. */
  const promotions = data.promotions ?? [];
  const jsonLd = profileJsonLd({
    siteUrl: SITE_URL,
    locale: loc,
    slug: params.slug,
    name: publicTutorName(tutor.full_name) ?? "",
    subject: tutor.subject,
    bio: tutor.bio,
    imageUrl: tutor.has_photo ? `${SITE_URL}/api/avatar/${tutor.slug}/md` : null,
    reviews: { count: reviews.count, average: reviews.average },
    students: tutor.students_count,
    classes: data.classes,
    quotedPrice: (c) => (c.id ? priceWithPromotion({ kind: "class", id: c.id, priceTnd: c.price_tnd }, promotions).finalTnd : c.price_tnd),
  });

  return (
    <>
      <JsonLd data={jsonLd} />
      <StorefrontView data={data} reviews={reviews} locale={loc} />
    </>
  );
}
