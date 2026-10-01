import type { Metadata } from "next";
import { callAnonymous } from "@/lib/api";
import { isLocale, DEFAULT_LOCALE, type AppLocale } from "@/lib/locale";
import { formatNumericDate, isUuid, tunisClock, type ClassItem } from "@tnajem/shared";
import { ClassDetail } from "./ClassDetail";

/* The class page's route and share card — Espace prof v2 · Phase 3.

   What the visitor sees is a client component (./ClassDetail.tsx — it reads the
   viewer's own booking). Its og:/twitter: tags live HERE, in the server PAGE: the
   class read ANONYMOUSLY (callAnonymous — no cookie, no header, the same answer
   for everyone), in the page's language, pointing at the generated card
   (opengraph-image.tsx). In the page and not in a layout because a layout's
   metadata loses to the card file of the same segment (og:image:alt became the
   file's static "Tnajem"); a page's wins. On-demand ISR like the storefront:
   rendered on first request, cached for a minute.

   Truth rule: what the class page shows and nothing more — no free-session claim
   (it depends on the reader's own history), no rating, no payment wording. */

export const revalidate = 60;
export function generateStaticParams(): { locale: string; id: string }[] {
  return [];
}

type Props = { params: Promise<{ locale: string; id: string }> };

const COPY = {
  fr: {
    notFound: "Séance introuvable",
    desc: (when: string, at: string, who: string, subject: string, price: string) =>
      `Séance en direct le ${when} à ${at} avec ${who}${subject ? ` (${subject})` : ""} — ${price}, sans engagement.`,
    price: (p: number) => (p > 0 ? `${p} TND la séance` : "séance gratuite"),
    alt: (title: string, who: string) => `« ${title} » avec ${who} sur Tnajem`,
  },
  ar: {
    notFound: "الحصة ما تلقاتش",
    desc: (when: string, at: string, who: string, subject: string, price: string) =>
      `حصة دايركت نهار ${when} على ${at} مع ${who}${subject ? ` (${subject})` : ""} — ${price}، بلا التزام.`,
    price: (p: number) => (p > 0 ? `${p} د.ت للحصة` : "حصة فابور"),
    alt: (title: string, who: string) => `« ${title} » مع ${who} على Tnajem`,
  },
} as const;

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { locale: raw, id } = await props.params;
  const locale: AppLocale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const c = COPY[locale];
  const cls = isUuid(id) ? await callAnonymous<ClassItem | null>(`/classes/${encodeURIComponent(id)}`, 60).catch(() => null) : null;
  if (!cls) return { title: c.notFound, robots: { index: false, follow: false } };

  const who = cls.tutor_name ?? "";
  const subpath = `/class/${cls.id}`;
  const canonical = `/${locale}${subpath}`;
  const title = who ? `${cls.title} — ${who}` : cls.title;
  const description = c.desc(formatNumericDate(cls.starts_at), tunisClock(cls.starts_at), who, cls.tutor_subject ?? "", c.price(cls.price_tnd));
  const card = `${canonical}/opengraph-image`;
  const image = { url: card, width: 1200, height: 630, alt: c.alt(cls.title, who) };
  return {
    title,
    description,
    alternates: { canonical, languages: { "fr-TN": `/fr${subpath}`, "ar-TN": `/ar${subpath}`, "x-default": `/fr${subpath}` } },
    openGraph: {
      type: "website",
      url: canonical,
      siteName: "Tnajem",
      locale: locale === "ar" ? "ar_TN" : "fr_TN",
      alternateLocale: locale === "ar" ? ["fr_TN"] : ["ar_TN"],
      title: `${title} · Tnajem`,
      description,
      images: [image],
    },
    twitter: { card: "summary_large_image", title: `${title} · Tnajem`, description, images: [image] },
  };
}

export default async function ClassPage(props: Props) {
  const { id } = await props.params;
  return <ClassDetail id={id} />;
}
