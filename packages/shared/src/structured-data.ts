/* JSON-LD FOR THE PUBLIC PAGES — pure builders (espace prof v2 · phase 7).

   The tutor profile (/[slug]) and the class page (/class/[id]) both ship
   structured data in their first HTML. The builders live here, as plain
   functions of plain data, so the TRUTH RULES are tested once instead of being
   re-derived inline in each page:

     • A rating (AggregateRating) only when the tutor has REAL reviews — the same
       tutorStanding() the visible page uses, so markup can never claim more than
       the screen. No Review objects at all: the reviews are on the page.
     • Prices only from what can actually be booked, at the price a student would
       actually be quoted. Never "0" for a free first session: that offer is per
       student and per tutor (./free-first.ts), not a property of the class.
     • The tutor's PUBLIC name ("Mohamed B.", publicTutorName) — callers pass it in.
     • A photo URL only when an approved photo exists (callers pass it or null).
     • A cancelled class has no Course markup at all.

   The output is rendered by apps/web/components/JsonLd.tsx, which escapes "<". */

import { tutorStanding } from "./standing";
import { isOpenForBooking, type ClassStatus } from "./class-time";
import { classEndMs } from "./live";

export type JsonLdObject = Record<string, unknown>;
type Loc = "fr" | "ar";

const CRUMBS: Record<Loc, { home: string; explore: string }> = {
  fr: { home: "Accueil", explore: "Explorer" },
  ar: { home: "الرئيسية", explore: "اكتشف" },
};

const trimSite = (siteUrl: string) => siteUrl.replace(/\/+$/, "");

export type ProfileJsonLdInput = {
  siteUrl: string;
  locale: Loc;
  slug: string;
  /** The PUBLIC name (publicTutorName) — never the full legal name. */
  name: string;
  subject: string;
  bio?: string | null;
  /** Absolute URL of an APPROVED photo, or null. */
  imageUrl?: string | null;
  /** Real review aggregates (GET /tutors/:slug/reviews). */
  reviews: { count: number; average: number };
  students: number;
  /** The tutor's classes as the storefront lists them. */
  classes: { id?: string; starts_at: string; status?: ClassStatus; price_tnd: number }[];
  /** Optional per-class price override (promotions, C6): what a student is quoted. */
  quotedPrice?: (cls: { id?: string; price_tnd: number }) => number;
  now?: number;
};

export function profileUrl(siteUrl: string, locale: Loc, slug: string): string {
  return `${trimSite(siteUrl)}/${locale}/${slug}`;
}

/** Person — the tutor. */
export function personJsonLd(input: ProfileJsonLdInput): JsonLdObject {
  const site = trimSite(input.siteUrl);
  const url = profileUrl(site, input.locale, input.slug);
  const standing = tutorStanding({ reviewCount: input.reviews.count, rating: input.reviews.average, students: input.students });
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    name: input.name,
    url,
    jobTitle: input.subject,
    ...(input.bio ? { description: input.bio } : {}),
    ...(input.imageUrl ? { image: input.imageUrl } : {}),
    worksFor: { "@type": "Organization", name: "Tnajem", url: site },
    knowsLanguage: ["fr", "ar"],
    areaServed: { "@type": "Country", name: "Tunisia" },
    ...(standing.kind === "rated"
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: standing.rating,
            reviewCount: standing.reviewCount,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
  };
}

/** The bookable prices of a storefront: classes that are on sale, as quoted. */
export function bookablePrices(input: Pick<ProfileJsonLdInput, "classes" | "quotedPrice" | "now">): number[] {
  const now = input.now ?? Date.now();
  return input.classes
    .filter((c) => isOpenForBooking(c, now))
    .map((c) => (input.quotedPrice ? input.quotedPrice(c) : c.price_tnd))
    .filter((p) => Number.isFinite(p) && p >= 0);
}

/** Person + Service (+ AggregateOffer when something is on sale) + BreadcrumbList. */
export function profileJsonLd(input: ProfileJsonLdInput): JsonLdObject[] {
  const site = trimSite(input.siteUrl);
  const url = profileUrl(site, input.locale, input.slug);
  const prices = bookablePrices(input);
  const crumbs = CRUMBS[input.locale];
  return [
    personJsonLd(input),
    {
      "@context": "https://schema.org",
      "@type": "Service",
      serviceType: "Cours particuliers en direct",
      provider: { "@type": "Person", name: input.name, url },
      areaServed: { "@type": "Country", name: "Tunisia" },
      availableLanguage: ["fr", "ar"],
      description: input.bio || input.subject,
      ...(prices.length
        ? {
            offers: {
              "@type": "AggregateOffer",
              priceCurrency: "TND",
              lowPrice: String(Math.min(...prices)),
              highPrice: String(Math.max(...prices)),
              offerCount: prices.length,
            },
          }
        : {}),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: crumbs.home, item: `${site}/${input.locale}` },
        { "@type": "ListItem", position: 2, name: crumbs.explore, item: `${site}/${input.locale}/explore` },
        { "@type": "ListItem", position: 3, name: input.name, item: url },
      ],
    },
  ];
}

export type CourseJsonLdInput = {
  siteUrl: string;
  locale: Loc;
  classId: string;
  title: string;
  description?: string | null;
  startsAt: string;
  durationMin?: number | null;
  status?: ClassStatus;
  priceTnd: number;
  /** What a student is quoted today (promotions, C6). Defaults to priceTnd. */
  quotedPriceTnd?: number;
  seatsLeft: number;
  tutor: { name: string; slug?: string | null };
  now?: number;
};

/** Course with one CourseInstance (an online, scheduled session). null for a cancelled class. */
export function courseJsonLd(input: CourseJsonLdInput): JsonLdObject | null {
  if (input.status === "cancelled") return null;
  const site = trimSite(input.siteUrl);
  const url = `${site}/${input.locale}/class/${input.classId}`;
  const now = input.now ?? Date.now();
  const start = new Date(input.startsAt);
  if (!Number.isFinite(start.getTime())) return null;
  const end = new Date(classEndMs({ scheduledAt: start, durationMin: input.durationMin }));
  const instructor: JsonLdObject = {
    "@type": "Person",
    name: input.tutor.name,
    ...(input.tutor.slug ? { url: profileUrl(site, input.locale, input.tutor.slug) } : {}),
  };
  const onSale = isOpenForBooking({ starts_at: input.startsAt, status: input.status }, now);
  const price = input.quotedPriceTnd ?? input.priceTnd;
  const description = (input.description ?? "").trim() || input.title;

  return {
    "@context": "https://schema.org",
    "@type": "Course",
    name: input.title,
    description,
    url,
    provider: { "@type": "Organization", name: "Tnajem", sameAs: site },
    hasCourseInstance: {
      "@type": "CourseInstance",
      courseMode: "online",
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      location: { "@type": "VirtualLocation", url },
      instructor,
      ...(input.durationMin && input.durationMin > 0 ? { courseWorkload: `PT${Math.round(input.durationMin)}M` } : {}),
    },
    ...(onSale && Number.isFinite(price) && price >= 0
      ? {
          offers: {
            "@type": "Offer",
            category: price > 0 ? "Paid" : "Free",
            price: String(price),
            priceCurrency: "TND",
            availability: input.seatsLeft > 0 ? "https://schema.org/InStock" : "https://schema.org/SoldOut",
            url,
          },
        }
      : {}),
  };
}
