/* /dashboard/storefront/preview — THE OWNER PREVIEW (espace prof v2 · phase 1).

   The signed-in tutor's OWN page, built exactly as the public one, whatever its
   status — the answer to « Voir ma vitrine » before verification, instead of a 404.

   A SEPARATE, DYNAMIC ROUTE on purpose. /{slug} is ISR: it must never read the
   session, or one visitor's view would be cached for the next (e2e/isr.spec.ts).
   So the public page stays static, and the owner's view lives here, behind the
   session: the data comes from GET /tutor/preview, which finds the tutor by the
   session's profile id — there is no slug parameter anyone could swap. Reached from
   the dashboard (« Aperçu privé ») and from the public « arrive bientôt » page, whose
   small client-side owner check sends the owner here. */
import { redirect } from "next/navigation";
import { StorefrontView } from "@/components/storefront/StorefrontView";
import { OwnerPreviewFrame, OwnerPreviewEmpty } from "@/components/dashboard/storefront/OwnerPreviewFrame";
import { getOwnerPreview } from "@/app/actions-shell";
import { getTutorReviews } from "@/app/actions";
import { pageGuard, localeOf, localePath } from "@/lib/page-guard";

export const dynamic = "force-dynamic";

export default async function OwnerPreviewPage(props: { params: Promise<{ locale: string }> }) {
  const locale = localeOf((await props.params).locale);
  const guard = await pageGuard();
  if (guard.kind === "guest") {
    redirect(localePath(locale, "/auth", localePath(locale, "/dashboard/storefront/preview")));
  }
  if (guard.kind !== "user") return <OwnerPreviewEmpty />;

  const preview = await getOwnerPreview().catch(() => null);
  if (!preview) return <OwnerPreviewEmpty />;

  const slug = preview.storefront.tutor.slug;
  /* Reviews exist only for a public tutor; the anonymous read answers empty for anyone else. */
  const reviews = preview.status === "verified" ? await getTutorReviews(slug).catch(() => undefined) : undefined;
  return (
    <OwnerPreviewFrame status={preview.status} slug={slug} suspended={preview.suspended}>
      <StorefrontView data={preview.storefront} reviews={reviews} locale={locale} />
    </OwnerPreviewFrame>
  );
}
