"use client";
import { useLocale } from "@/components/LocaleProvider";
import { CANCEL_FREE_WINDOW_HOURS, type StudentClassRow } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";
import { tnd } from "./format";

/* Where a booking stands, as « Mes cours » says it (student-space-v1 · C):

     « Inscrit »               upcoming (« En direct » while it runs)
     « Passée »                after its end (start + duration) — NOT « Suivie »: we do
                               not track attendance, so we never claim it
     « Annulée par toi »       the student cancelled
     « Annulée par le prof »   the prof cancelled (the class, or the seat)
     « Annulée par Tnajem »    an admin, or a parent withdrawing consent
   + the late-cancellation note when the student cancelled inside 48 h (the ledger's
     figure, noted for the prof — never taken while payments are off). */

const copy = bilingual({
  fr: {
    booked: "Inscrit",
    live: "En direct",
    past: "Passée",
    byMe: "Annulée par toi",
    byProf: "Annulée par le prof",
    bySystem: "Annulée par Tnajem",
    lateAmount: (a: string) => `Annulation à moins de ${CANCEL_FREE_WINDOW_HOURS} h : ${a} notés comme retenus pour ton prof. Rien n'est prélevé pendant le pilote.`,
    lateCharged: (a: string) => `Annulation à moins de ${CANCEL_FREE_WINDOW_HOURS} h : ${a} retenus pour ton prof.`,
    lateNothing: `Annulation à moins de ${CANCEL_FREE_WINDOW_HOURS} h : rien n'est retenu pour cette place.`,
  },
  ar: {
    booked: "مسجّل",
    live: "دايركت",
    past: "فاتت",
    byMe: "لغيتها إنتي",
    byProf: "لغاها الأستاذ",
    bySystem: "لغاتها Tnajem",
    lateAmount: (a: string) => `إلغاء في أقل من ${CANCEL_FREE_WINDOW_HOURS} ساعة : ${a} تسجّلو كمستحق لأستاذك. ما يتخصم حتى مليم في فترة التجربة.`,
    lateCharged: (a: string) => `إلغاء في أقل من ${CANCEL_FREE_WINDOW_HOURS} ساعة : ${a} تحسبو لأستاذك.`,
    lateNothing: `إلغاء في أقل من ${CANCEL_FREE_WINDOW_HOURS} ساعة : ما تحسب عليك حتى شي على هالبلاصة.`,
  },
});

export function StatusTag({ row }: { row: StudentClassRow }) {
  const { locale } = useLocale();
  const c = copy[locale];
  if (row.state === "live") return <span className="tag tag-live" data-e2e="class-status" data-status="live">{c.live}</span>;
  if (row.state === "upcoming") return <span className="tag tag-success" data-e2e="class-status" data-status="booked">{c.booked}</span>;
  if (row.state === "past") return <span className="chip chip-sand" data-e2e="class-status" data-status="past">{c.past}</span>;
  const label = row.cancelledBy === "student" ? c.byMe : row.cancelledBy === "tutor" ? c.byProf : c.bySystem;
  return <span className="chip chip-rose" data-e2e="class-status" data-status={`cancelled-${row.cancelledBy ?? "system"}`}>{label}</span>;
}

/** The late-cancellation note, or null. */
export function lateNote(row: StudentClassRow, locale: "fr" | "ar"): string | null {
  if (!row.lateCancel) return null;
  const c = copy[locale];
  if (row.lateCancel.retainedTnd <= 0) return c.lateNothing;
  const amount = tnd(row.lateCancel.retainedTnd, locale);
  return row.lateCancel.paymentsEnabled ? c.lateCharged(amount) : c.lateAmount(amount);
}
