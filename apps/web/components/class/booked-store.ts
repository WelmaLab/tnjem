"use client";
import { useEffect, useSyncExternalStore } from "react";
import type { ViewerBooking } from "@tnajem/shared";
import { getMyBookingsWithTutor } from "@/app/actions-booked";

/* The storefront's « am I booked with this prof? » — student-space-v1 · H1.

   /<slug> is ISR-cached HTML, identical for everyone, so the seat the viewer holds
   is learnt in the browser after hydration. Several islands on one page need it
   (the aside panel, the phone bar, the « Inscrit » tag on each class row): ONE
   request per page and tutor, shared here, and a cancelled seat leaves all of them
   at once.

   undefined = not known yet (the page shows what it shows anyone) · null = not a
   signed-in student · [] = a student with no seat here. */

type Snapshot = ViewerBooking[] | null | undefined;

const bySlug = new Map<string, Snapshot>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function load(slug: string) {
  if (bySlug.has(slug)) return;
  bySlug.set(slug, undefined);
  getMyBookingsWithTutor(slug)
    .then((b) => bySlug.set(slug, b))
    .catch(() => bySlug.set(slug, null)) // an API hiccup leaves the page as it is for anyone
    .finally(emit);
}

/** The viewer's live seats with this tutor (see the header for undefined / null / []). */
export function useMySeatsWithTutor(slug: string): Snapshot {
  useEffect(() => load(slug), [slug]);
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => bySlug.get(slug),
    () => undefined, // server render: nothing is known — the cached HTML stays anonymous
  );
}

/** A seat was cancelled on this page: every island stops showing it. */
export function forgetSeat(slug: string, bookingId: string) {
  const seats = bySlug.get(slug);
  if (!seats) return;
  bySlug.set(slug, seats.filter((s) => s.bookingId !== bookingId));
  emit();
}
