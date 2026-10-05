import type { Metadata } from "next";
import { ClassDetailView } from "@/components/student/ClassDetailView";
import { bilingual } from "@/lib/i18n";
import { isLocale, DEFAULT_LOCALE } from "@/lib/locale";
import { pageMetadata } from "@/lib/metadata";

/* /student/cours/<bookingId> — one booking, on a phone (student-space-v1 · C). On a
   computer the same detail is the right column of « Mes cours ». NOINDEX: private;
   the booking is read through the session, so another student's id is a not-found. */

const copy = bilingual({
  fr: { title: "Ma séance", description: "Le détail d'une séance réservée sur Tnajem." },
  ar: { title: "حصّتي", description: "تفاصيل حصة محجوزة في Tnajem." },
});

export async function generateMetadata(props: { params: Promise<{ locale: string; bookingId: string }> }): Promise<Metadata> {
  const params = await props.params;
  const locale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  return pageMetadata({ locale, path: `/student/cours/${params.bookingId}`, ...copy[locale], noindex: true });
}

export default async function ClassDetailPage(props: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await props.params;
  return <ClassDetailView bookingId={bookingId} />;
}
