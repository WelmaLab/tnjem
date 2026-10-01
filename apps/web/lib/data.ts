import "server-only";
import { callAnonymous } from "./api";
import { demoFallback, backendReady } from "./backend";
import { demoEnabled, demoStorefrontFor } from "@/lib/demo";
import type { Storefront, Tutor, ClassItem, Pack, TutorVisibility } from "@tnajem/shared";

/* ══════════════════════════════════════════════════════════════════════════════
   Server-side reads.

   Two modes, and only two, when there is no API_URL:

     • DEMO MODE (dev + TNAJEM_DEMO=1) → demo fixtures (lib/demo.ts), with a
       banner on every page saying so.
     • ANYTHING ELSE                   → a hard error. NOT fixtures.

   The second rule is the important one. `backendReady` is false whenever API_URL
   is missing — including on a misconfigured deploy or after a rotated secret. The
   old code returned `demoStorefront` in that case *for any slug*, so a production
   boot without a DB would have served a fabricated "4.9★, 1,240 students,
   verified" tutor at every URL of the public site. Fabricating a verified tutor
   and their rating is a misrepresentation; a 500 is just an outage. We take the
   outage.

   Why throw instead of returning null: null makes app/[slug]/page.tsx call
   notFound(), and a site-wide 404 storm tells Google to deindex every real tutor
   page. A 5xx is the honest signal — "we are broken, come back" — and it is the
   one that gets us paged.
   ══════════════════════════════════════════════════════════════════════════════ */

/** Thrown when a read runs with no backend outside demo mode. Surfaces as app/error.tsx (500). */
export class DatabaseNotConfiguredError extends Error {
  constructor(op: string) {
    super(
      `[Tnajem] API_URL is not set — refusing to serve demo data from ${op}. ` +
        "Fix the environment; demo data is served only in development with TNAJEM_DEMO=1.",
    );
    this.name = "DatabaseNotConfiguredError";
  }
}

/** Single choke point for every "no backend" branch below.

    It used to sit INSIDE `if (demoFallback)`, whose condition already implied
    demoEnabled — so its `if (backendReady || demoEnabled) return` always
    returned and the throw was unreachable. A production process with no API_URL
    fell through to fetch() against the 127.0.0.1 default instead. It now runs
    before any fixture is considered: no backend and no demo mode → throw. A
    site-wide 404 storm would tell Google to deindex every real tutor page, while
    a 5xx honestly says "we are broken" and pages someone. */
function assertBackendOrDemo(op: string): void {
  if (backendReady || demoEnabled) return;
  console.error(`[Tnajem] FATAL: ${op} called with no API_URL outside demo mode.`);
  throw new DatabaseNotConfiguredError(op);
}

const initials = (name: string) => {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase() || "?";
};

export async function getStorefront(slug: string): Promise<Storefront | null> {
  assertBackendOrDemo("getStorefront");        // no API and no demo mode → throw, never fabricate
  if (demoFallback) return demoStorefrontFor(slug); // demo mode only: that slug's fixture, or not found

  /* PORTED to apps/api (GET /tutors/:slug/storefront).

     This is NOT a server action — it is a direct DB read feeding the ISR-cached
     storefront and the sitemap, which is exactly why GATE 4's grep
     (a grep for the db package under apps/web/app and apps/web/components) would have
     reported success while apps/web/lib still held a Postgres pool for the
     most-trafficked page in the product. Widen the gate to all of apps/web.

     callAnonymous, never call: [slug]/page.tsx reads this through unstable_cache
     (lib/cache.ts::getCachedStorefront), where cookies() throws, and outside that
     wrapper it would silently opt the route out of ISR. */
  return callAnonymous<Storefront | null>(`/tutors/${encodeURIComponent(slug)}/storefront`);
}

/* espace prof v2 · shell — what /{slug} shows when there is no public storefront:
   "coming-soon" (a tutor on the way: « Ce prof arrive bientôt ») or "missing" (the
   404). Anonymous, for the same ISR reason as getStorefront (callAnonymous, never
   call). Demo mode: a fixture slug is public, anything else is missing. */
export async function getTutorVisibility(slug: string): Promise<TutorVisibility> {
  assertBackendOrDemo("getTutorVisibility");
  if (demoFallback) return demoStorefrontFor(slug) ? "public" : "missing";
  const res = await callAnonymous<{ visibility: TutorVisibility }>(`/tutors/${encodeURIComponent(slug)}/visibility`);
  return res?.visibility ?? "missing";
}

/** One public storefront, for app/sitemap.ts. */
export type PublicTutorRef = { slug: string; lastModified: Date };

/* Verified tutors only — exactly what getStorefront() will actually serve. A
   pending/rejected tutor 404s, so listing them would feed Google dead URLs.

   Never throws: the sitemap is generated at build time, and a build box without
   no backend must still emit the static routes rather than fail the build. The
   caller degrades to the static list; it does NOT get fixtures (the demo slug is
   not a real page, and pointing a crawler at it would be exactly the fabrication
   the rest of this file exists to prevent). */
export async function getPublicTutorRefs(): Promise<PublicTutorRef[]> {
  if (demoFallback) return [];
  // PORTED to apps/api (GET /tutors/public-refs). Anonymous: it feeds the sitemap.
  const rows = await callAnonymous<{ slug: string; lastModified: string }[]>("/tutors/public-refs");
  return rows.map((r) => ({ slug: r.slug, lastModified: new Date(r.lastModified) }));
}

