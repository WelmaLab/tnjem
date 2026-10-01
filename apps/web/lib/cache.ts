import "server-only";
import { unstable_cache, revalidateTag } from "next/cache";
import { getStorefront, getPublicTutorRefs, getTutorVisibility, type PublicTutorRef } from "@/lib/data";
import type { Storefront, TutorVisibility } from "@tnajem/shared";

/* ══════════════════════════════════════════════════════════════════════════════
   Cache layer for the PUBLIC, ANONYMOUS surface only.

   ── THE ONE RULE ────────────────────────────────────────────────────────────
   NOTHING derived from the session cookie may pass through this file. Ever.
   unstable_cache() has no notion of "who asked" — a value cached during Amine's
   request is served verbatim to Sarra. Everything here takes a slug and returns
   data that is, by definition, identical for every visitor on Earth. If you find
   yourself wanting to cache getDashboard(), getStudentDashboard(),
   getNotifications() or anything that calls getSession(), stop: that is how a
   marketplace shows one student another student's phone number.

   (Mechanically, Next also throws if you call cookies() inside unstable_cache —
   but do not rely on the framework to enforce your privacy model.)

   ── WHY IT EXISTS ───────────────────────────────────────────────────────────
   A tutor pastes tnajem.com/<slug> into a WhatsApp group. Thousands of phones
   open the same URL within minutes. Uncached, each one costs 3 sequential round
   trips to Postgres (tutor → classes → packs) plus a 4th for reviews, and a full
   React render. Cached, the whole storm collapses to ONE database read per slug
   per TTL window; the rest is served from memory/disk.
   ═════════════════════════════════════════════════════════════════════════════ */

/* ── TTLs ────────────────────────────────────────────────────────────────────
   STOREFRONT_TTL is the honest trade-off in this codebase.

   The page must not keep serving a tutor we have just REJECTED (getStorefront()
   returns null for anything that is not `verified`, and the page 404s) — a
   rejected tutor's storefront staying public is a trust/compliance problem, not
   a performance one. So the TTL is the WORST-CASE delay between an admin
   clicking "reject" and that page going dark.

   60 seconds is the number:
     • Long enough that a viral spike (which is measured in requests per second,
       not per minute) is absorbed almost entirely by the cache — at 500 req/s
       one slug costs Postgres 1 query per minute instead of 30,000.
     • Short enough that a rejection is live in under a minute, which is well
       inside any reasonable moderation SLA and far faster than the hours it
       takes for a shared link to make its next hop.
     • And it is a CEILING, not a floor: approveTutor/rejectTutor should call
       revalidateTutor(slug) (below) to make the change effective IMMEDIATELY.
       The TTL is what protects us on the day someone edits `tutors.status` by
       hand in psql and forgets the app exists.

   Do NOT push this to an hour to "save queries". Sixty seconds already removes
   ~99.9% of the load; the remaining 0.1% is not worth a rejected tutor being
   public for another 59 minutes. */
export const STOREFRONT_TTL = 60;

/* The sitemap is read by crawlers, not humans. It is a whole-table scan of every
   verified tutor and must never run per request. An hour of staleness costs a
   new tutor at most an hour before Google is told the URL exists — and the
   tutor's own WhatsApp link works instantly regardless. */
export const SITEMAP_TTL = 3600;

/* ── Tags ───────────────────────────────────────────────────────────────────
   A tag lets a write invalidate a read without either side knowing the other's
   cache keys. */

/** Everything public that belongs to one tutor: their storefront + their reviews. */
export const tutorTag = (slug: string) => `tutor:${slug}`;

/** The set of publicly-listed tutors (the sitemap). Changes when anyone is approved/rejected. */
export const PUBLIC_TUTORS_TAG = "public-tutors";

/* ── Reads ──────────────────────────────────────────────────────────────────── */

/**
 * The viral page. Cached per slug for STOREFRONT_TTL.
 *
 * Note the cache key includes the slug BOTH in the key parts and via the closure:
 * unstable_cache keys on (keyParts + the arguments of the wrapped function), and
 * a closure variable is neither — passing it as an argument is what keeps the
 * entries from colliding across tutors.
 */
export function getCachedStorefront(slug: string): Promise<Storefront | null> {
  return unstable_cache(
    async (s: string) => getStorefront(s),
    ["storefront"],
    // Tagged with THIS tutor only — deliberately not PUBLIC_TUTORS_TAG. Tagging
    // every storefront with a global tag would mean one approval invalidates all
    // of them at once and the next second re-reads the whole catalogue: a
    // self-inflicted thundering herd, exactly when an admin is busiest.
    { revalidate: STOREFRONT_TTL, tags: [tutorTag(slug)] },
  )(slug);
}

/** espace prof v2 · shell — "public" | "coming-soon" | "missing" for /{slug}, cached
    and tagged exactly like the storefront, so an approval (revalidateTutor) flips
    « Ce prof arrive bientôt » to the real page in the same breath. */
export function getCachedVisibility(slug: string): Promise<TutorVisibility> {
  return unstable_cache(
    async (s: string) => getTutorVisibility(s),
    ["tutor-visibility"],
    { revalidate: STOREFRONT_TTL, tags: [tutorTag(slug)] },
  )(slug);
}

/** All verified tutors, for app/sitemap.ts. Never a per-request full scan. */
export function getCachedPublicTutorRefs(): Promise<PublicTutorRef[]> {
  return unstable_cache(
    async () => getPublicTutorRefs(),
    ["public-tutor-refs"],
    { revalidate: SITEMAP_TTL, tags: [PUBLIC_TUTORS_TAG] },
  )();
}

/* ── Writes ─────────────────────────────────────────────────────────────────── */

/**
 * Drop every cached public artefact for one tutor, immediately.
 *
 * FOR THE OWNER OF app/actions.ts: call this (it is safe to call from a server
 * action) at the end of every write that changes what the public storefront
 * shows, so the tutor sees their edit instantly instead of up to 60s later:
 *
 *   approveTutor / rejectTutor  → revalidateTutor(t.slug)   ← the compliance one
 *   createTutor  (slug change)  → revalidateTutor(oldSlug) AND revalidateTutor(newSlug)
 *   createClass / createPack    → revalidateTutor(mine.slug)
 *   createReview                → revalidateTutor(<the class's tutor slug>)
 *   reserveSeat / cancelBooking → revalidateTutor(tut.slug)  (seats_left moved)
 *
 * It is intentionally cheap and non-throwing: a cache miss is a slow page, never
 * a failed booking, so a revalidation problem must not fail the write that
 * already committed.
 */
export function revalidateTutor(slug: string | null | undefined): void {
  if (!slug) return;
  try {
    /* { expire: 0 }: gone NOW, the Next 14 behaviour. Next 16's recommended "max"
       profile serves the stale page while it refetches, and the stale page of a
       tutor an admin has just rejected is exactly what must not be served. */
    revalidateTag(tutorTag(slug), { expire: 0 });
  } catch {
    /* Called outside a request scope (a cron/CLI context) — nothing to revalidate. */
  }
}

/** The tutor left or joined the public set: refresh the sitemap too. Approve/reject only. */
export function revalidatePublicTutors(): void {
  try {
    revalidateTag(PUBLIC_TUTORS_TAG, { expire: 0 });
  } catch {
    /* see above */
  }
}
