"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { Toast } from "@/components/useToast";
import { Check } from "@/components/icons";
import { bilingual } from "@/lib/i18n";
import { BookedPanel } from "./BookedPanel";
import { forgetSeat, useMySeatsWithTutor } from "./booked-store";

/* The storefront's booked state — student-space-v1 · H1.

   /<slug> stays ISR: the server renders the booking CTA for everyone (it is the
   `children` here), and once hydrated these islands ask, from the session, whether
   the viewer already holds a seat (booked-store.ts). If they do, the aside panel and
   the phone bar show « ✓ Tu es inscrit à cette séance » for it instead. A guest, a
   student with no seat here and the tutor themselves keep the server's HTML,
   untouched.

   Which seat: one on right now first (the storefront no longer lists a class once it
   has started, so this is the only place it can still be joined from), else the one
   the panel is about — `classIds`, the « Prochaine séance » it names and the class
   its button books. A seat on a later class does not hide « Réserver » for an
   earlier one; its row carries « Inscrit » instead (StorefrontBookedTag). */

const copy = bilingual({
  fr: { tag: "Inscrit" },
  ar: { tag: "مسجّل" },
});

function useSeatFor(slug: string, classIds: readonly string[]) {
  const seats = useMySeatsWithTutor(slug);
  return seats?.find((s) => s.phase === "live") ?? seats?.find((s) => classIds.includes(s.classId)) ?? null;
}

/** Seconds a cancel outcome stays up in the phone bar's toast (it is a long sentence). */
const BAR_MESSAGE_MS = 9000;

export function StorefrontBooked({
  slug,
  classIds,
  variant,
  eyebrow,
  children,
}: {
  slug: string;
  classIds: readonly string[];
  variant: "panel" | "bar";
  eyebrow?: string;
  children?: ReactNode;
}) {
  const seat = useSeatFor(slug, classIds);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!message || variant !== "bar") return;
    const id = setTimeout(() => setMessage(null), BAR_MESSAGE_MS);
    return () => clearTimeout(id);
  }, [message, variant]);

  const onCancelled = (m: string) => {
    setMessage(m);
    if (seat) forgetSeat(slug, seat.bookingId);
  };

  if (variant === "bar") {
    return (
      <>
        {seat ? (
          <div data-sf-mobilecta="true" className="sf-mcta" data-e2e="booked-bar">
            <BookedPanel booking={seat} variant="bar" onCancelled={onCancelled} />
          </div>
        ) : (
          children
        )}
        {message && <Toast>{message}</Toast>}
      </>
    );
  }

  return seat ? (
    <BookedPanel booking={seat} variant="panel" eyebrow={eyebrow} onCancelled={onCancelled} />
  ) : (
    <>
      {message && <p className="bk-done" role="status" data-e2e="booked-cancelled">{message}</p>}
      {children}
    </>
  );
}

/** « ✓ Inscrit » on a storefront class row the viewer holds a seat on. */
export function StorefrontBookedTag({ slug, classId }: { slug: string; classId: string }) {
  const { locale } = useLocale();
  const seats = useMySeatsWithTutor(slug);
  if (!seats?.some((s) => s.classId === classId)) return null;
  return (
    <span className="bk-tag" data-e2e="booked-tag">
      <Check /> {copy[locale].tag}
    </span>
  );
}
