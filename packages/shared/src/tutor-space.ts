/* espace prof v2 · shell — the payloads of the tutor's own space (AppShell, home,
   Mes élèves, Ma vitrine). Pure types plus one predicate: safe in the barrel.

   EVERYTHING HERE IS THE OWNER'S VIEW OF THEIR OWN SPACE. Nothing in it may feed a
   public, cached page — the public storefront stays on Storefront (types.ts). */
import type { DashboardBooking, TutorVerifStatus } from "./types";

/** What the shell (sidebar, top bar, avatar card) needs on every prof page. GET /tutor/shell. */
export type TutorShell = {
  /** The tutor's OWN full name — this is their own screen, not a counterparty one. */
  name: string | null;
  /** "WT" — for the avatar card. */
  initials: string;
  /** "draft" until a storefront exists. Drives the badge on « Vérification ». */
  status: TutorVerifStatus;
  slug: string | null;
  hasStorefront: boolean;
  /** isPilot: no grant and payments off — the « Pilote » in "Prof · Pilote". */
  plan: { code: string; isPilot: boolean };
};

/* Why a student appears on « Mes élèves ». Phase 1 knows bookings only; growth adds
   "follower" (phase 4, tutor_follows) and "subscriber" (phase 5, student_subscriptions)
   by appending to the same array — the page renders a tag per relation. */
export type TutorStudentRelation = "booked" | "follower" | "subscriber";

/** Where the student stands with this tutor, from their bookings. "none" = no booking (a follower only). */
export type TutorStudentStatus = "upcoming" | "past" | "cancelled" | "none";

export type TutorStudentBooking = {
  bookingId: string;
  classId: string;
  classTitle: string;
  classTs: number; // epoch ms of the class start
  /** student-space-v1 · H2 (C7): epoch ms of the class END (classEndMs) — a class in progress is not past yet. */
  classEndTs?: number;
  status: DashboardBooking["status"];
  isFree: boolean;
  bookedAt: string; // ISO
};

/** One row of « Mes élèves ». GET /tutor/students. */
export type TutorStudent = {
  /** OPAQUE and stable per tutor — never the profile id (zero contact exchange, Step 8). */
  key: string;
  /** FIRST NAME ONLY, through publicDisplayName. */
  name: string | null;
  initials: string;
  relations: TutorStudentRelation[];
  status: TutorStudentStatus;
  /** ISO — the first relation (first booking, or follow/subscription once growth adds them). */
  since: string;
  /** ISO — the latest thing that happened between them. */
  lastActivityAt: string;
  /** Newest first. Empty for a follower who never booked. */
  bookings: TutorStudentBooking[];
};

/** Where a student stands, from their bookings alone. Upcoming wins over past; all-cancelled is "cancelled". */
export function studentStatusOf(bookings: Pick<TutorStudentBooking, "status" | "classTs" | "classEndTs">[], now = Date.now()): TutorStudentStatus {
  if (!bookings.length) return "none";
  const live = bookings.filter((b) => b.status !== "cancelled");
  if (!live.length) return "cancelled";
  return live.some((b) => (b.classEndTs ?? b.classTs) > now) ? "upcoming" : "past";
}

/** The answer to "what does /{slug} show?" — GET /tutors/:slug/visibility (anonymous, cached). */
export type TutorVisibility = "public" | "coming-soon" | "missing";
