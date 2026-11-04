import { OG_SIZE, profsCard } from "@/lib/og-card";
import { LOCALES } from "@/lib/locale";

/* The tutor-facing social preview card of /pour-les-profs (profs-v2 · D). Reads no
   data, so both locales are rendered once at build and served as static files. The
   page links it explicitly through pageMetadata's ogImage, for og: AND twitter:. */

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Tnajem";
export function generateStaticParams(): { locale: string }[] {
  return LOCALES.map((locale) => ({ locale }));
}

const SITE_HOST = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://tnajem.com").replace(/^https?:\/\//, "").replace(/\/+$/, "");

export default async function Image(props: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await props.params;
  return profsCard(raw === "ar" ? "ar" : "fr", `${SITE_HOST}/pour-les-profs`);
}
