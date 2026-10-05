import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { bilingual } from "@/lib/i18n";
import { isLocale, DEFAULT_LOCALE } from "@/lib/locale";
import { pageMetadata } from "@/lib/metadata";
import { pageGuard, localeOf, localePath } from "@/lib/page-guard";
import { StudentShellLayout } from "@/components/app/StudentShellLayout";

/* Metadata for the student's space — Accueil and every page under it (Mes cours,
   Mes profs, Mes fiches, /student/welcome). The pages are client components, so this
   layout carries it. student-space-v1 · A: /student is no longer « Mes cours » but
   the space's home, so the title names the space, « Mon espace » — the words of the
   public header's button that leads here. NOINDEX: private. */
const copy = bilingual({
  fr: {
    title: "Mon espace",
    description: "Tes prochains cours en direct, tes profs et tes fiches sur Tnajem.",
  },
  ar: {
    title: "فضائي",
    description: "حصصك الدايركت الجاية، أساتذتك والملخّصات متاعك في Tnajem.",
  },
});

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const params = await props.params;
  const locale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  return pageMetadata({ locale, path: "/student", ...copy[locale], noindex: true });
}

/* phase-a lane L2 (A17) — REQUEST-TIME ONLY: the guard reads the session. */
export const dynamic = "force-dynamic";

/* phase-a lane L2 (A17) — the reverse of app/[locale]/dashboard/layout.tsx: a
   TUTOR who opens /student (or anything under it) is sent to their dashboard,
   server-side, before anything renders. Guests and the build-time "inert" state
   fall through to the pages' own handling.

   student-space-v1 · A — a STUDENT gets every page under /student inside the
   StudentShell (components/app/StudentShell.tsx), including the pages added later. */
export default async function StudentLayout(props: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const guard = await pageGuard();
  if (guard.kind === "user" && guard.profile.role === "tutor") {
    redirect(localePath(localeOf((await props.params).locale), "/dashboard"));
  }
  return <StudentShellLayout guard={guard}>{props.children}</StudentShellLayout>;
}
