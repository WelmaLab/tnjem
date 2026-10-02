import { getCachedStorefront } from "@/lib/cache";
import { fallbackCard, OG_SIZE, tutorCard } from "@/lib/og-card";
import { displaySubject, isOpenForBooking } from "@tnajem/shared";

/* The tutor's social preview card — Espace prof v2 · Phase 3.

   Next links it as og:image / twitter:image on /{locale}/{slug} automatically
   (file convention, it takes precedence over the page's static /og.png). Reads
   the SAME cached, anonymous storefront the ISR page reads — no cookies(), no
   headers() — so a WhatsApp storm of link previews costs no extra query. The
   photo is fetched only when has_photo is true, which the API sets for an
   APPROVED photo of a PUBLIC tutor and nothing else. */

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Tnajem";
/* Cached like the page: rendered on first request, then served for 10 minutes. */
export const revalidate = 600;
export function generateStaticParams(): { locale: string; slug: string }[] {
  return [];
}

const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000";
const SITE_HOST = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://tnajem.com").replace(/^https?:\/\//, "").replace(/\/+$/, "");

/** The approved photo as a PNG data URI (Satori does not read WebP), or null. */
async function approvedPhoto(slug: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_URL}/tutors/${encodeURIComponent(slug)}/avatar/md`, {
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const sharp = (await import("sharp")).default;
    const png = await sharp(Buffer.from(await res.arrayBuffer())).png().toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null; // the monogram is a fine card; a broken photo fetch must not break the preview
  }
}

export default async function Image(props: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale: raw, slug } = await props.params;
  const locale = raw === "ar" ? "ar" : "fr";
  const data = await getCachedStorefront(slug).catch(() => null);
  if (!data) return fallbackCard(locale);

  const { tutor } = data;
  const prices = data.classes.filter((c) => isOpenForBooking(c)).map((c) => c.price_tnd).filter((p) => Number.isFinite(p) && p >= 0);
  return tutorCard({
    locale,
    name: tutor.full_name, // already "Mohamed B." from the API (A23)
    subject: displaySubject(tutor.subject, locale), // live-fixes-1 · C2
    initials: tutor.avatar_initials,
    verified: tutor.verified,
    photo: tutor.has_photo ? await approvedPhoto(tutor.slug) : null,
    fromPrice: prices.length ? Math.min(...prices) : null,
    displayUrl: `${SITE_HOST}/${tutor.slug}`,
  });
}
