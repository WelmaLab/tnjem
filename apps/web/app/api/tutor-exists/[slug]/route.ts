import { NextResponse } from "next/server";
import { getCachedStorefront, getCachedVisibility } from "@/lib/cache";

/* Does this slug serve a page? Asked by proxy.ts, which cannot read the data
   layer itself (edge runtime), so that an unknown slug is answered with a real 404
   status while the page still renders <NotFoundScreen> in the server HTML.

   It reads through getCachedStorefront — the SAME unstable_cache entry the page
   uses, invalidated by the same revalidateTutor(slug) — so it adds no database
   load and can never disagree with the page for longer than the page's own TTL.

   espace prof v2 · shell: a tutor who exists and is on the way (not verified yet)
   is not a 404 any more — /{slug} says « Ce prof arrive bientôt » with a 200
   (noindex). So "exists" is: a public storefront, or a coming-soon tutor. Rejected,
   suspended and erased tutors stay missing.

   A lookup failure is a 503, never "does not exist": middleware passes the
   request through on anything but a clean answer, because 404-ing a real tutor
   during an API blip is worse than a soft 404 on a dead link. */
export const dynamic = "force-dynamic";

export async function GET(_req: Request, props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  try {
    const data = await getCachedStorefront(params.slug);
    const exists = data !== null || (await getCachedVisibility(params.slug)) === "coming-soon";
    return NextResponse.json({ exists }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ exists: null }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
