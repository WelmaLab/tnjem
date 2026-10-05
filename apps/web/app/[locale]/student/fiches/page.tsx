import type { Metadata } from "next";
import { MesFichesView } from "@/components/student/MesFichesView";
import { bilingual } from "@/lib/i18n";
import { isLocale, DEFAULT_LOCALE } from "@/lib/locale";
import { pageMetadata } from "@/lib/metadata";
import { isUuid } from "@tnajem/shared";

/* /student/fiches — MES FICHES (student-space-v1 · E). ?class=<classId> narrows to one
   class's fiches (C1); read here, not with the client search-params hook. NOINDEX. */

const copy = bilingual({
  fr: { title: "Mes fiches", description: "Les documents et vidéos que tes profs partagent avec toi sur Tnajem." },
  ar: { title: "ملفاتي", description: "الوثائق والفيديوات اللي يقسموها معاك أساتذتك في Tnajem." },
});

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const params = await props.params;
  const locale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  return pageMetadata({ locale, path: "/student/fiches", ...copy[locale], noindex: true });
}

export default async function MesFichesPage(props: { searchParams: Promise<{ class?: string | string[] }> }) {
  const sp = await props.searchParams;
  return <MesFichesView classId={typeof sp.class === "string" && isUuid(sp.class) ? sp.class : null} />;
}
