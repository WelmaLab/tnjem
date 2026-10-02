import { callAnonymous } from "@/lib/api";
import { classCard, fallbackCard, OG_SIZE } from "@/lib/og-card";
import { displaySubject, formatNumericDate, isUuid, tunisClock, type ClassItem } from "@tnajem/shared";

/* A class's social preview card — Espace prof v2 · Phase 3.

   GET /classes/:id asked ANONYMOUSLY (callAnonymous: no cookie, no header): it
   answers only for a class whose tutor is public, and never carries a room link
   to a caller with no booking. Date and time in Africa/Tunis, DD/MM/YYYY and 24h.
   The price only — no free-session claim: the card cannot follow the student's
   own entitlement (scripts/brand/build-og.mjs explains why such claims came out
   of images). */

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Tnajem";
export const revalidate = 600;
export function generateStaticParams(): { locale: string; id: string }[] {
  return [];
}

const SITE_HOST = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://tnajem.com").replace(/^https?:\/\//, "").replace(/\/+$/, "");

export default async function Image(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale: raw, id } = await props.params;
  const locale = raw === "ar" ? "ar" : "fr";
  if (!isUuid(id)) return fallbackCard(locale);
  const cls = await callAnonymous<ClassItem | null>(`/classes/${encodeURIComponent(id)}`, 600).catch(() => null);
  if (!cls) return fallbackCard(locale);

  return classCard({
    locale,
    title: cls.title,
    tutorName: cls.tutor_name ?? "",
    subject: displaySubject(cls.tutor_subject, locale), // live-fixes-1 · C2
    verified: Boolean(cls.tutor_slug), // the API names a slug only for a public, verified tutor
    date: formatNumericDate(cls.starts_at),
    time: tunisClock(cls.starts_at),
    durationMin: cls.duration_min,
    priceTnd: cls.price_tnd,
    // A class URL is a UUID — the card names the tutor's page instead, which is what a reader remembers.
    displayUrl: cls.tutor_slug ? `${SITE_HOST}/${cls.tutor_slug}` : SITE_HOST,
  });
}
