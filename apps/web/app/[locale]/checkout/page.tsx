import { redirect } from "next/navigation";
import { isUuid } from "@tnajem/shared";
import { getClass } from "@/app/actions";
import { localeOf, localePath } from "@/lib/page-guard";
import { CheckoutShell } from "@/components/checkout/CheckoutShell";

/* /checkout?class=<id> — live-fixes-3 · A4: a SERVER page, so the tutor who owns the
   class never reaches a « Confirmer ma place » the API would refuse (`own-class`):
   they are sent straight to their own room, /live/<id>.

   The route is request-time already (./layout.tsx, force-dynamic), so reading the
   session here caches nothing: getClass() calls the API WITH the visitor's cookie,
   and viewer_is_owner is true for the owning tutor only. Anyone else — a student, a
   guest, a missing class, an API that does not answer — gets the checkout exactly
   as before (CheckoutShell → CheckoutInner, which reads the class itself). */
export default async function CheckoutPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale: raw }, sp] = await Promise.all([props.params, props.searchParams]);
  const classId = typeof sp.class === "string" ? sp.class : "";
  if (isUuid(classId)) {
    const cls = await getClass(classId).catch(() => null);
    if (cls?.viewer_is_owner) redirect(localePath(localeOf(raw), `/live/${classId}`));
  }
  return <CheckoutShell />;
}
