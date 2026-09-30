import type { Metadata } from "next";

/* Per-page metadata, in one shape.

   On 14 Sept nine routes shared the home page's <title> and link preview. The one
   that hurt was /pour-les-profs: tutors forward it to recruit other tutors, and the
   WhatsApp card said "apprends avec ton prof" — the student pitch.

   Why a helper and not a bare `title`: a child's `openGraph` and `twitter` REPLACE
   the layout's rather than merging, so a page that sets only a title and an
   openGraph object silently loses the og:image, the siteName and the twitter card.
   Every page built here gets all of them.

   No copy lives here. Each route passes its own bilingual strings (bilingual() in
   the route file), so FR/AR parity stays compiler- and guardrail-checked where the
   words are. */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tnajem.com";

/* Same cache-busted image as the root layout (app/[locale]/layout.tsx). Bump both
   together when og.png is rebuilt. */
const OG_IMAGE = "/og.png?v=3";

export function pageMetadata({
  locale,
  path,
  title,
  description,
  noindex = false,
}: {
  locale: "fr" | "ar";
  /** Locale-less route path, e.g. "/pour-les-profs". */
  path: string;
  /** Page title; the layout's "%s · Tnajem" template is applied to it. */
  title: string;
  description: string;
  /** Private surfaces (dashboard, student, onboarding): kept out of search results. */
  noindex?: boolean;
}): Metadata {
  const ar = locale === "ar";
  const canonical = `/${locale}${path}`;
  const shareTitle = `${title} · Tnajem`;
  return {
    title,
    description,
    alternates: {
      canonical,
      languages: { "fr-TN": `/fr${path}`, "ar-TN": `/ar${path}`, "x-default": `/fr${path}` },
    },
    openGraph: {
      type: "website",
      siteName: "Tnajem",
      url: `${SITE_URL}${canonical}`,
      locale: ar ? "ar_TN" : "fr_TN",
      alternateLocale: ar ? ["fr_TN"] : ["ar_TN"],
      title: shareTitle,
      description,
      images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: shareTitle }],
    },
    twitter: { card: "summary_large_image", title: shareTitle, description, images: [OG_IMAGE] },
    robots: noindex ? { index: false, follow: false } : { index: true, follow: true },
  };
}
