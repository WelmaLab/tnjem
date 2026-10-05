import type { Metadata } from "next";
import { StudentHomeView } from "@/components/student/StudentHomeView";
import { bilingual } from "@/lib/i18n";
import { isLocale, DEFAULT_LOCALE } from "@/lib/locale";
import { pageMetadata } from "@/lib/metadata";

/* /student — ACCUEIL, the student's home (student-space-v1 · pages, letter B).
   A server shell for the page's own title; the page itself is a client component
   (components/student/StudentHomeView.tsx). NOINDEX: private. The layout above
   sends a tutor to /dashboard. */

const copy = bilingual({
  fr: { title: "Accueil", description: "Ta prochaine séance, tes profs et tes fiches sur Tnajem." },
  ar: { title: "الرئيسية", description: "حصّتك الجاية، أساتذتك وملفّاتك في Tnajem." },
});

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const params = await props.params;
  const locale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  return pageMetadata({ locale, path: "/student", ...copy[locale], noindex: true });
}

export default function StudentPage() {
  return <StudentHomeView />;
}
