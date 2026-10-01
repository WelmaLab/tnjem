import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { bilingual } from "@/lib/i18n";
import { isLocale, DEFAULT_LOCALE } from "@/lib/locale";
import { pageMetadata } from "@/lib/metadata";
import { pageGuard, localeOf, localePath } from "@/lib/page-guard";
import { TutorShellLayout } from "@/components/app/TutorShellLayout";

/* Metadata for the tutor dashboard and everything under it (materials, new class,
   new pack, payout). The pages are client components, so this pass-through layout
   carries it. NOINDEX: a signed-in workspace has nothing a search engine should
   list. */
const copy = bilingual({
  fr: {
    title: "Mon tableau de bord",
    description: "Tes cours, tes réservations et ta page de prof sur Tnajem.",
  },
  ar: {
    title: "لوحة التحكم متاعي",
    description: "دروسك، الحجوزات وصفحتك كأستاذ في Tnajem.",
  },
});

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const params = await props.params;
  const locale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  return pageMetadata({ locale, path: "/dashboard", ...copy[locale], noindex: true });
}

/* phase-a lane L2 (A17) — REQUEST-TIME ONLY. The guard below reads the visitor's
   session; prerendered, a build would bake one answer into HTML served to all. */
export const dynamic = "force-dynamic";

/* phase-a lane L2 (A17) — THE ROLE CHECK, SERVER-SIDE, for /dashboard and every
   page under it. A student who opened /dashboard used to get the tutor shell with
   "Crée ta vitrine" — the role check was lost when the backend was split. They are
   sent to their own space before anything renders. (GET /dashboard also answers
   { wrongRole } now, so the client pages stay safe if this ever stops running.)
   Guests and the build-time "inert" state fall through: the page has its own
   signed-out screen.

   espace prof v2 · shell — a TUTOR gets every page under /dashboard inside the
   AppShell (components/app/AppShell.tsx), including pages added later. */
export default async function DashboardLayout(props: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const guard = await pageGuard();
  if (guard.kind === "user" && guard.profile.role === "student") {
    redirect(localePath(localeOf((await props.params).locale), "/student"));
  }
  return <TutorShellLayout guard={guard}>{props.children}</TutorShellLayout>;
}
