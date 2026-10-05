import type { Metadata } from "next";
import { MesCoursView } from "@/components/student/MesCoursView";
import { coursTab } from "@/components/student/cours-tabs";
import { bilingual } from "@/lib/i18n";
import { isLocale, DEFAULT_LOCALE } from "@/lib/locale";
import { pageMetadata } from "@/lib/metadata";
import { isUuid } from "@tnajem/shared";

/* /student/cours — MES COURS (student-space-v1 · C). ?tab=avenir|passees|annulees and
   &prof=<tutorId> are read HERE (no client search-params hook: it would push the page
   into a client-only Suspense bail-out). NOINDEX: private. */

const copy = bilingual({
  fr: { title: "Mes cours", description: "Tes séances à venir, passées et annulées sur Tnajem." },
  ar: { title: "حصصي", description: "حصصك الجاية، اللي فاتت والملغية في Tnajem." },
});

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const params = await props.params;
  const locale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  return pageMetadata({ locale, path: "/student/cours", ...copy[locale], noindex: true });
}

export default async function MesCoursPage(props: { searchParams: Promise<{ tab?: string | string[]; prof?: string | string[] }> }) {
  const sp = await props.searchParams;
  const prof = typeof sp.prof === "string" && isUuid(sp.prof) ? sp.prof : null;
  return <MesCoursView initialTab={coursTab(sp.tab)} prof={prof} />;
}
