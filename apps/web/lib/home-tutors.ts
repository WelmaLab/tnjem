import "server-only";
import { HOME_RATING_MIN_REVIEWS, HOME_TUTORS_MAX, type HomeTutor } from "@tnajem/shared";
import { demoFallback } from "@/lib/backend";
import { PUBLIC_TUTORS_TAG, STOREFRONT_TTL } from "@/lib/cache";

/* home v2 · B — the home page's « real tutors » card, server side.

   ANONYMOUS, exactly like callAnonymous() (lib/api.ts rule 3): no cookies(), no
   headers(), no session — the home page is ISR-cached and the same for everyone,
   and touching the request here would silently make /fr dynamic.

   It is a plain fetch rather than callAnonymous() for ONE reason: the cache TAG.
   callAnonymous takes a revalidate and no tags; this read is cached 60 s like the
   storefront (STOREFRONT_TTL) AND tagged PUBLIC_TUTORS_TAG, which every write that
   changes the public set already busts (approve/reject, a verified tutor's edits —
   lib/api.ts replays `revalidate.publicTutors`). A fetch tag also reaches the
   prerendered page that used it, so a tutor taken off the public set leaves the
   home card at once, not a minute later. ONE cache layer: an unstable_cache wrapper
   around a revalidating fetch would be two stale-while-revalidate windows stacked.

   NEVER THROWS. `next build` prerenders the page with no API running, and an API
   outage must cost the visitor three neutral subject rows, not the home page. A
   failure is not cached (nothing is stored for a fetch that threw).

   NO DEMO TUTORS. In dev demo mode (TNAJEM_DEMO=1, no API) the card shows its
   neutral rows: invented tutors on the home page would need the « démo » badge
   /explore carries. Production never has demo data at all (lib/backend.ts). */

const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000";

export async function getHomeTutors(): Promise<HomeTutor[]> {
  if (demoFallback) return [];
  try {
    const res = await fetch(`${API_URL}/tutors/home`, {
      headers: { "content-type": "application/json" },
      next: { revalidate: STOREFRONT_TTL, tags: [PUBLIC_TUTORS_TAG] },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return [];
    return sanitize(await res.json());
  } catch {
    return [];
  }
}

/** The API's answer, held to the card's rules once more on this side: at most 3,
    well-formed rows only, and no reviews below the threshold whatever arrives. */
export function sanitize(rows: unknown): HomeTutor[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r): r is HomeTutor =>
      Boolean(r) && typeof r === "object" &&
      typeof (r as HomeTutor).slug === "string" && (r as HomeTutor).slug.length > 0 &&
      typeof (r as HomeTutor).subject?.fr === "string")
    .slice(0, HOME_TUTORS_MAX)
    .map((r) => {
      const { reviews, ...rest } = r;
      const price = r.price && r.price.tnd > 0 && (r.price.per === "session" || r.price.per === "month") ? r.price : null;
      return {
        ...rest,
        levels: Array.isArray(r.levels) ? r.levels : [],
        avatar_url: typeof r.avatar_url === "string" && r.avatar_url.startsWith("/api/avatar/") ? r.avatar_url : null,
        price,
        ...(reviews && reviews.count >= HOME_RATING_MIN_REVIEWS ? { reviews } : {}),
      };
    });
}
