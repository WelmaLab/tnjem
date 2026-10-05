import type { Metadata } from "next";
import { MesProfsView } from "@/components/student/MesProfsView";
import { bilingual } from "@/lib/i18n";
import { isLocale, DEFAULT_LOCALE } from "@/lib/locale";
import { pageMetadata } from "@/lib/metadata";

/* /student/profs — MES PROFS (student-space-v1 · D). NOINDEX: private. */

const copy = bilingual({
  fr: { title: "Mes profs", description: "Les profs que tu suis et ceux avec qui tu as eu cours sur Tnajem." },
  ar: { title: "أساتذتي", description: "الأساتذة اللي تتابعهم واللي قريت معاهم في Tnajem." },
});

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const params = await props.params;
  const locale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  return pageMetadata({ locale, path: "/student/profs", ...copy[locale], noindex: true });
}

export default function MesProfsPage() {
  return <MesProfsView />;
}
