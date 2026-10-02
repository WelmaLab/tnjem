import type { MetadataRoute } from "next";
import { getCachedPublicTutorRefs } from "@/lib/cache";
import { LOCALES } from "@/lib/locale";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tnajem.com";

/* Regenerate at most once an hour. Without this, every crawler hit would run an
   unbounded scan of verified tutors; cached, it runs once an hour no matter who
   asks. Literal on purpose (Next needs a static value); keep equal to SITEMAP_TTL.

   The actual caching is done by unstable_cache in lib/cache.ts, which is what
   bounds the API call. */
export const revalidate = 3600;

/* GENERATED AT REQUEST TIME, NOT AT BUILD TIME.

   The tutor list now comes from apps/api over HTTP, and there is no API running
   during `next build` — a container image is built with nothing else up. Left
   prerendered, the build FAILED with "Error occurred prerendering page
   /sitemap.xml", which is at least loud; the tempting "fix" of catching the fetch
   error and returning [] would have been far worse, silently shipping a sitemap
   with zero tutor pages and taking every storefront out of Google's discovery
   path. (That exact regression happened once already this refactor.)

   So the sitemap is dynamic and the hourly unstable_cache entry does the work.
   The first crawler after a deploy pays one API call; nobody else does. */
export const dynamic = "force-dynamic";

/* Every page exists in both locales (/fr/… and /ar/…). Each sitemap entry carries
   hreflang alternates (Next emits <xhtml:link rel="alternate">), so Google learns
   the fr-TN ⇄ ar-TN pairing even for the client-component pages that cannot export
   per-page <link rel="alternate"> tags themselves. x-default → the French version. */
function hreflang(subpath: string): Record<string, string> {
  return {
    "fr-TN": `${SITE_URL}/fr${subpath}`,
    "ar-TN": `${SITE_URL}/ar${subpath}`,
    "x-default": `${SITE_URL}/fr${subpath}`,
  };
}

/** One <url> per locale for a given path, each carrying the full alternates set. */
function localizedEntries(
  subpath: string,
  opts: { priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"]; lastModified: Date },
): MetadataRoute.Sitemap {
  const languages = hreflang(subpath);
  return LOCALES.map((loc) => ({
    url: `${SITE_URL}/${loc}${subpath}`,
    lastModified: opts.lastModified,
    changeFrequency: opts.changeFrequency,
    priority: opts.priority,
    alternates: { languages },
  }));
}

/* Static public routes (subpath after the locale; "" is the home page). */
const ROUTES: { subpath: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { subpath: "", priority: 1, changeFrequency: "weekly" },
  { subpath: "/pour-les-profs", priority: 0.9, changeFrequency: "weekly" },
  { subpath: "/explore", priority: 0.9, changeFrequency: "daily" },
  { subpath: "/tarifs", priority: 0.8, changeFrequency: "monthly" },
  { subpath: "/aide", priority: 0.5, changeFrequency: "monthly" }, // espace prof v2 · pro (P7)
  { subpath: "/terms", priority: 0.3, changeFrequency: "yearly" },
  { subpath: "/privacy", priority: 0.3, changeFrequency: "yearly" },
];

/* Tutor storefronts (/[locale]/<slug>) are the most-shared pages in the product.
   Only VERIFIED tutors are listed — exactly the set getStorefront() serves, so we
   never hand a crawler a dead URL. getPublicTutorRefs() swallows DB errors and
   returns [] so a build-time DB blip still yields a valid sitemap of static routes. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticRoutes = ROUTES.flatMap(({ subpath, priority, changeFrequency }) =>
    localizedEntries(subpath, { priority, changeFrequency, lastModified: now }),
  );

  const tutors = await getCachedPublicTutorRefs();
  const tutorRoutes = tutors.flatMap(({ slug, lastModified }) =>
    localizedEntries(`/${slug}`, { priority: 0.8, changeFrequency: "weekly", lastModified }),
  );

  return [...staticRoutes, ...tutorRoutes];
}
