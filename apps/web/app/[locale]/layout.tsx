import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Plus_Jakarta_Sans, IBM_Plex_Sans_Arabic } from "next/font/google";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { LocaleProvider } from "@/components/LocaleProvider";
import { JsonLd } from "@/components/JsonLd";
import { DemoBanner } from "@/components/DemoBanner";
import { LOCALES, DEFAULT_LOCALE, isLocale, dir, type AppLocale } from "@/lib/locale";
import "../globals.css";

/* ── FONTS ARE SPLIT BY LOCALE ────────────────────────────────────────────────
   All three families used to ship to both locales. A French visitor downloaded
   four weights of IBM Plex Sans Arabic they would never see; an Arabic visitor
   downloaded five weights of Plus Jakarta Sans plus three of Space Grotesk that
   globals.css then overrode anyway (html[dir="rtl"] remaps --fd AND --fb to
   --fa). On the 3G Android this product is opened on, those are the bytes
   sitting in front of first paint.

   fr → Space Grotesk (display) + Plus Jakarta Sans (body) + ONE weight of the
        Arabic face, which the brand mark needs: the logo glyph is ق and the
        wordmark is "Tnajem تنجّم".
   ar → IBM Plex Sans Arabic only. It carries Latin glyphs too, so mixed strings
        ("15 TND", "Tnajem") still render correctly — which is exactly why the
        RTL token remap is safe.

   Weight 800 dropped (never used) and 500 dropped after moving this codebase's
   only two font-weight:500 declarations to 600. Measured by
   tools/ui-audit/weight.mjs. */
const displayFont = Space_Grotesk({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display" });
const bodyFont = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "600", "700"], variable: "--font-body" });
const arabicFont = IBM_Plex_Sans_Arabic({ subsets: ["arabic"], weight: ["400", "600", "700"], variable: "--font-ar" });
/* Same family, one weight: what French pages need of it is the brand mark and any
   Arabic user text (globals.css: [dir="auto"]:dir(rtl) on LTR pages). */
const arabicMark = IBM_Plex_Sans_Arabic({ subsets: ["arabic"], weight: ["400"], variable: "--font-ar" });

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tnajem.com";
/* NO FREE-SESSION CLAIM HERE. This is the SITE-WIDE description — it lands on
   every page Google indexes, including the storefronts of tutors who do not offer
   a free first session (which, since Step 6, is all of them until they opt in).
   A promise about money cannot live on a surface that has no idea which tutor it
   is describing. The verification claim stays: that one IS true of every tutor
   who is public. */
const DESCRIPTION =
  "Trouve un prof en direct, du primaire au Bac — toutes les matières, avec des profs tunisiens vérifiés un par un."; // phase-a lane L3 (A22): "Paie en dinar" removed (D4)
const DESCRIPTION_AR =
  "لقّي أستاذ دايركت، من الابتدائي للباك — كل المواد، مع أساتذة توانسة مؤكّدين واحد واحد."; // phase-a lane L3 (A22) · phase-a lane L6 (A18.derija-2)

/* Pre-render both locale roots (/fr, /ar) at build time; sub-pages inherit the param. */
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export const viewport: Viewport = {
  themeColor: "#0E5AA6",
  colorScheme: "light",
};

/* Locale is now in the URL, so metadata is locale-aware (og:locale, description).
   metadataBase makes the relative canonical/og URLs in child pages absolute. */
export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const params = await props.params;
  const locale: AppLocale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  const ar = locale === "ar";
  const description = ar ? DESCRIPTION_AR : DESCRIPTION;
  const title = ar ? "Tnajem — تعلّم مع أستاذك" : "Tnajem — apprends avec ton prof";

  return {
    metadataBase: new URL(SITE_URL),
    title: { default: title, template: "%s · Tnajem" },
    description,
    applicationName: "Tnajem",
    keywords: ["cours particuliers", "prof", "Tunisie", "Bac", "soutien scolaire", "Tnajem", "تنجّم", "دروس خصوصية"],
    authors: [{ name: "Tnajem" }],
    /* Generated from brand/logo-source.png by scripts/brand/build-raster.py.
       No SVG entry: there is no vector master of the mark, and an SVG wrapping a
       base64 PNG is a bigger file that buys nothing.
       The mark is fine line art, so at 16px it dissolves into grey mush on its
       own — every icon here is therefore the mark knocked out in white on a
       solid cobalt tile, which still reads as this brand in a strip of tabs. */
    icons: {
      icon: [
        { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
        { url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
      ],
      apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    },
    openGraph: {
      type: "website",
      siteName: "Tnajem",
      locale: ar ? "ar_TN" : "fr_TN",
      alternateLocale: ar ? ["fr_TN"] : ["ar_TN"],
      url: `${SITE_URL}/${locale}`,
      title,
      description,
      /* ?v=2 is a cache-bust, not decoration: WhatsApp and Facebook key their
         preview cache on the URL, so without it a tutor's link keeps showing the
         previous card long after this one shipped — and WhatsApp is how this
         product is actually distributed. Bump it whenever og.png is rebuilt. */
      images: [{ url: "/og.png?v=3", width: 1200, height: 630, alt: "Tnajem — ton prof, en direct." }],
    },
    twitter: { card: "summary_large_image", title, description, images: ["/og.png?v=3"] },
    robots: { index: true, follow: true },
  };
}

export default async function LocaleLayout({
  children,
  params: paramsPromise,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const params = await paramsPromise;

  // Guard the segment: only /fr and /ar are real locales. Anything else 404s rather
  // than rendering a page in an undefined language. (middleware also redirects, but
  // a direct hit to /xx must not slip a bad lang attribute into <html>.)
  if (!isLocale(params.locale)) notFound();
  const locale = params.locale as AppLocale;

  return (
    <html
      lang={locale}
      dir={dir(locale)}
      className={
        locale === "ar"
          ? arabicFont.variable
          : `${displayFont.variable} ${bodyFont.variable} ${arabicMark.variable}`
      }
    >
      <body>
        <DemoBanner locale={locale} />
        {/* Site-wide structured data — truthful + static; identifies the Tnajem entity
            and site to search engines and AI assistants. No SearchAction (search is
            client-side; a search endpoint would be a claim we can't back yet). */}
        <JsonLd
          data={[
            {
              "@context": "https://schema.org",
              "@type": "Organization",
              name: "Tnajem",
              alternateName: "تنجّم",
              url: SITE_URL,
              logo: `${SITE_URL}/apple-touch-icon.png`,
              description: DESCRIPTION,
              areaServed: { "@type": "Country", name: "Tunisia" },
              knowsLanguage: ["fr", "ar"],
            },
            {
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: "Tnajem",
              alternateName: "تنجّم",
              url: SITE_URL,
              inLanguage: ["fr", "ar"],
            },
          ]}
        />
        <LocaleProvider initialLocale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
