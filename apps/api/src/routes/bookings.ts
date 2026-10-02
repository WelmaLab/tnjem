import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  and, desc, eq, isNull, ne, sql as raw,
  bookings, cancellations, classes, consents, tutors,
  notify,
} from "@tnajem/db";
import {
  vUuid, isMinorBirthYear, classWhen,
  type StudentDashboard,
  isEffectivelyFreeFirst,
  cancellationOutcome,
  CANCEL_FREE_WINDOW_HOURS,
  FREE_FIRST_SPENT_REASON, cancelSpendsFreeFirst, // phase-a lane L3 (A6)
  movedAfterBooking as isMovedAfterBooking, lateCancelRetainedTnd, retainedShare, // phase-a lane L3 (A21)
} from "@tnajem/shared";
import { resolveMeetUrl } from "@tnajem/shared/live";
import { rotateRoomToken } from "../lib/room-rotation";
import { publicDisplayName } from "@tnajem/shared";
import { isAdult, minorsAllowed } from "@tnajem/shared"; // phase-a lane L2 (A24)
import { publicTutorName } from "@tnajem/shared"; // phase-a lane L2 (A23)
import { paymentsEnabled } from "@tnajem/shared/payments";
import { db } from "../db";
import { getSession } from "../lib/session";
import { checkRateLimit } from "../lib/rate-limit";
import { recomputeTutorStats } from "../lib/stats";
import { isUniqueViolation } from "../lib/db-errors";
import { freeFirstStillAvailable } from "../lib/free-first-entitlement"; // phase-a/integrate (A6)
import { coveringSubscription } from "../lib/subscription-seat"; // espace prof v2 · growth (P5, C7)
import { claimPromotionUse, quoteItem, releasePromotionUse } from "../lib/promotions"; // espace prof v2 · growth (P5)
import { dispatchMail, mailBookingCancelled, mailBookingConfirmedFor } from "../lib/booking-mail"; // espace prof v2 · pro (P7)

/* bookings — reserveSeat, cancelBooking, getStudentDashboard.

   ══════════════════════════════════════════════════════════════════════════════
   THE SEAT CLAIM IS TRANSCRIBED STATEMENT FOR STATEMENT. DO NOT "CLEAN IT UP".
   ══════════════════════════════════════════════════════════════════════════════
   Any rewrite of the claim is where overselling comes back. It is guarded by
   e2e/seat-claim.race.spec.ts (16 genuinely concurrent claims on the last seat)
   and by the product-level invariant in e2e/student.spec.ts.

   recomputeTutorStats already moved to apps/api/src/lib/stats.ts in the classes
   domain, precisely so it could join THIS transaction. If it had stayed on the web
   side, the seat claim and the stats update would no longer share a transaction —
   and the lost-update race would return, reintroduced by the refactor. */

/** phase-a lane L3 (A7): the unique key on bookings(class_id, student_id), as named
    in packages/db/sql/0000_init.sql and 0007_bookings_unique_class_student.sql. */
export const BOOKING_CLASS_STUDENT_KEY = "bookings_class_id_student_id_unique";

/* phase-a lane L3 (A6) — THE FREE FIRST SESSION, ONCE PER STUDENT PER TUTOR (D2).

   `classOffers` is isEffectivelyFreeFirst (tutor toggle AND class flag). On top of
   it the student must not already hold a live free booking with this tutor, nor
   have spent it by cancelling a free seat late (the ledger row the cancel handler
   marks FREE_FIRST_SPENT_REASON — see @tnajem/shared/free-first.ts for when it
   comes back).

   RACE-SAFE: the check-then-insert runs under pg_advisory_xact_lock keyed on
   (student, tutor), taken as the FIRST statement of the seat-claim transaction and
   released at its commit. Two simultaneous bookings by one student with one tutor
   serialise here; the second one's reads (READ COMMITTED: a fresh snapshot per
   statement) see the first one's committed free seat. Only free-first bookings
   take the lock, and every booking tx takes it before any row lock, so it cannot
   deadlock against the class/tutor row locks. No schema change. */
type BookingTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function freeFirstSeatFor(
  tx: BookingTx,
  studentId: string,
  tutorId: string,
  classOffers: boolean,
): Promise<boolean> {
  if (!classOffers) return false;
  await tx.execute(raw`select pg_advisory_xact_lock(hashtextextended(${`free-first:${studentId}:${tutorId}`}, 0))`);
  // The checks themselves are shared with GET /classes/:id (lib/free-first-entitlement.ts).
  return freeFirstStillAvailable(tx, studentId, tutorId);
}

// espace prof v2 · growth (P5): + the code a visitor brought (?promo=CODE). Optional.
const reserveBody = z.object({ classId: z.string(), promoCode: z.string().max(40).nullable().optional() });
const cancelBody = z.object({ bookingId: z.string() });

/** The UI promises free cancellation up to 24h before — enforced here, not in copy.
    Step 7 replaces this with 48h/40%; until then the rule is unchanged. */
/* The 24h window is gone. The rule is 48h free / 40% retained after that, and it
   lives in ONE place — @tnajem/shared/cancellation.ts — because a deadline
   implemented twice is a deadline that eventually disagrees with the copy that
   promises it. apps/web's own copy of this constant was already dead and is
   deleted in the same commit. */

export async function bookingRoutes(app: FastifyInstance): Promise<void> {
  /* ── POST /bookings ──────────────────────────────────────────────────────── */
  app.post("/bookings", async (req, reply) => {
    const parsed = reserveBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad-request" });

    const classId = vUuid(parsed.data.classId, { field: "class" });
    if (!classId.ok) return { ok: false, error: "not-found" };

    const session = await getSession(req);
    if (!session) return { ok: false, error: "not-authenticated" };
    const uid = session.profile.id;

    // Booking is a DB-write endpoint anyone with a session can hammer.
    const rl = await checkRateLimit(`book:${uid}`, 20, 60_000);
    if (!rl.ok) return { ok: false, error: "too-many-requests" };

    /* ---- GUARDIAN CONSENT (INPDP / Loi 2004-63) ----
       This was once a promise, not a control. verifyOtp returns needsConsent and
       the client routes to /auth/consent, but NOTHING server-side re-checked the
       row — so a student who closed that page, hit Back, or went straight to
       /checkout?class=<id> booked a real tutor with no consent on file. The legal
       record we publicly commit to collecting was optional in practice, and the
       one surface that could enforce it — the booking, the moment a minor actually
       engages a tutor — did not look.

       Distinct error code so the UI routes to /auth/consent rather than showing
       "réessaie" for something retrying can never fix.

       Scoped to a MINOR student: an adult books without it, while a minor — or a
       student whose age we do not know (null fails SAFE via isMinorBirthYear) —
       must have a consent row. */
    // phase-a lane L2 (A24) ── adult-only pilot, and a month-aware consent gate ──
    /* While ALLOW_MINORS is off (D6) a minor cannot book at all: an existing minor
       account still signs in, and stops here. With it on, consent is required on
       the MONTH-aware age — the year-only check below lets a 17-year-old born later
       this year through as an adult. A missing month or year fails safe (minor). */
    if (!isAdult(session.profile.birthYear, session.profile.birthMonth)) {
      if (!minorsAllowed()) return { ok: false, error: "adults-only" };
      const [minorConsent] = await db
        .select({ id: consents.id })
        .from(consents)
        .where(and(eq(consents.minorId, uid), isNull(consents.withdrawnAt)))
        .limit(1);
      if (!minorConsent) return { ok: false, error: "needs-consent" };
    }
    // end phase-a lane L2 (A24)

    /* ANY ROLE. This was scoped to role === "student", so a minor who signed up at
       /signup/prof — which asks no age — booked with no consent at all (security
       review, 15 Sept 2026). Unknown age fails safe here as everywhere. */
    if (isMinorBirthYear(session.profile.birthYear)) {
      const [consent] = await db
        .select({ id: consents.id })
        .from(consents)
        // A WITHDRAWN consent is no consent (0023).
        .where(and(eq(consents.minorId, uid), isNull(consents.withdrawnAt)))
        .limit(1);
      if (!consent) return { ok: false, error: "needs-consent" };
    }

    const [cls] = await db.select().from(classes).where(eq(classes.id, classId.value)).limit(1);
    if (!cls) return { ok: false, error: "not-found" };
    if (cls.status === "cancelled" || cls.status === "done") return { ok: false, error: "unavailable" };
    // A class in the past cannot be booked (there was no check at all — you could
    // reserve a seat in last month's session and then review it).
    if (new Date(cls.scheduledAt).getTime() < Date.now()) return { ok: false, error: "unavailable" };

    /* The tutor must actually be verified. The discovery surfaces hide non-verified
       tutors, but NOTHING stopped a draft/pending/REJECTED tutor from handing out a
       direct /class/<id> link and taking real bookings from minors — the id was all
       you needed. The gate has to live on the booking path, not only on discovery. */
    const [tut] = await db.select().from(tutors).where(eq(tutors.id, cls.tutorId)).limit(1);
    if (!tut || tut.status !== "verified" || tut.suspendedAt) return { ok: false, error: "unavailable" }; // A blocked account's storefront is suspended (0019): off every public read.
    if (tut.profileId === uid) return { ok: false, error: "own-class" }; // no self-booking

    /* ---- Atomic seat claim ----
       BEFORE: read seats_taken → compare to seats → UPDATE seats_taken + 1. Two
       students hitting "Réserver" on the last seat both read 19 of 20, both passed,
       both incremented → 21 bookings on a 20-seat class. Classic TOCTOU; on a
       "1ère séance gratuite" launch with a popular tutor it fires on day one.

       AFTER: the availability test IS the UPDATE's WHERE clause, evaluated by
       Postgres under a row lock. The loser matches zero rows and gets "full"
       instead of a phantom seat. Insert + claim + stats ride ONE transaction, so a
       failure anywhere (e.g. unique(class,student) on a double-submit) rolls back
       the seat too — no leaked seats.

       The transaction RETURNS its outcome rather than assigning to a captured
       variable: TypeScript cannot know a callback ran, so a captured
       `let outcome = "full"` stays narrowed to that literal and every later
       comparison becomes a compile error. */
    type SeatOutcome = "booked" | "already" | "full";
    let outcome: SeatOutcome;
    // espace prof v2 · growth (P5): what this seat costs, decided inside the transaction.
    const priced = { priceTnd: Number(cls.priceTnd ?? 0), covered: false, promotionPercent: null as number | null, promoNotice: null as string | null };
    try {
      outcome = await db.transaction(async (tx): Promise<SeatOutcome> => {
        // phase-a lane L3 (A6): FIRST statement — it may take the (student, tutor) lock.
        const isFree = await freeFirstSeatFor(tx, uid, cls.tutorId, isEffectivelyFreeFirst(tut.offersFreeFirstSession, cls.isFreeFirst));
        /* espace prof v2 · growth (P5, C7): a subscriber's seat is covered by their
           month, up to the quota (lib/subscription-seat.ts). SECOND statement: it
           may take the subscription's lock, still before any row lock. A free
           first session is never charged to the quota. */
        const covering = isFree ? null : await coveringSubscription(tx, uid, cls.tutorId, new Date(cls.scheduledAt));
        const [existing] = await tx
          .select()
          .from(bookings)
          .where(and(eq(bookings.classId, classId.value), eq(bookings.studentId, uid)))
          .limit(1);
        if (existing && existing.status !== "cancelled") return "already";

        const claimed = await tx
          .update(classes)
          .set({ seatsTaken: raw`coalesce(${classes.seatsTaken}, 0) + 1` })
          .where(
            and(
              eq(classes.id, classId.value),
              raw`coalesce(${classes.seatsTaken}, 0) < coalesce(${classes.seats}, 0)`,
            ),
          )
          .returning({ id: classes.id });
        if (claimed.length === 0) return "full"; // sold out — nobody oversells

        /* espace prof v2 · growth (P5): THE PRICE SHOWN — the class price after the one
           best promotion (pricing.ts, C6), recorded on the booking with the promotion
           it used, for online payment later. The use is claimed only now, after the
           seat: a full class or a double-submit never spends one. Free or covered
           seats cost nothing on their own and take no promotion. */
        let promotionId: string | null = null;
        if (isFree || covering) {
          priced.priceTnd = 0;
          priced.covered = Boolean(covering);
        } else {
          const { quote, notice } = await quoteItem(tx, cls.tutorId, { kind: "class", id: cls.id, priceTnd: priced.priceTnd }, parsed.data.promoCode);
          priced.promoNotice = notice;
          if (quote.promotion && (await claimPromotionUse(tx, quote.promotion.id))) {
            priced.priceTnd = quote.finalTnd;
            priced.promotionPercent = quote.percent;
            promotionId = quote.promotion.id;
          } else if (quote.promotion) {
            priced.promoNotice = "exhausted"; // the last use went a moment ago — the normal price, calmly
          }
        }
        const growth = { subscriptionId: covering?.id ?? null, priceTnd: priced.priceTnd.toFixed(2), promotionId };

        if (existing) {
          /* phase-a lane L3 (A8): a re-booking is a NEW reservation on the old row.
             It used to flip only the status, so is_free kept the first booking's
             value whatever the rules say now, and created_at kept the first
             booking time — which the reschedule waiver compares to
             classes.rescheduled_at, so re-booking AFTER a move was still waived. */
          await tx
            .update(bookings)
            .set({
              status: "reserved",
              isFree, // phase-a lane L3 (A6): the CURRENT rule, once per student per tutor
              createdAt: raw`now()`,
              ...growth, // espace prof v2 · growth (P5): this booking's own price, promotion and cover
            })
            .where(eq(bookings.id, existing.id));
        } else {
          await tx.insert(bookings).values({
            classId: classId.value,
            studentId: uid,
            /* THE ENFORCEMENT POINT for the opt-in free first session.
               Not Boolean(cls.isFreeFirst): that trusted a per-class flag alone,
               so a tutor who never opted in — or who opted OUT — could still have
               a booking written against them marked free, by a crafted request or
               simply by a class row left over from when the column defaulted to
               true. is_free on a booking is what decides whether money is owed;
               it does not get to be a UI detail. */
            // phase-a lane L3 (A6): and once per student per tutor (D2) — freeFirstSeatFor.
            isFree,
            status: "reserved",
            ...growth, // espace prof v2 · growth (P5)
          });
        }

        /* students_count used to be a blind +1 per booking, so ONE student booking
           three classes advertised the tutor as having three students. Recompute
           the real distinct count instead — single statement, inside the tx. */
        await recomputeTutorStats(cls.tutorId, tx);
        return "booked";
      });
    } catch (e) {
      /* unique(class_id, student_id) → a concurrent double-submit from the same
         student. The tx rolled back, so the seat was NOT consumed. Idempotent. */
      /* phase-a lane L3 (A7): ONLY that key means "already booked". Every other
         error (a dropped connection, a failed statement) used to land here too and
         told the student "Tu avais déjà cette place" for a seat they did not get.
         Re-thrown, the error handler answers 500 and the UI shows a real failure. */
      if (isUniqueViolation(e, BOOKING_CLASS_STUDENT_KEY)) return { ok: true, already: true };
      throw e;
    }

    if (outcome === "already") return { ok: true, already: true };
    if (outcome === "full") return { ok: false, error: "full" };

    /* Notifications AFTER the commit. notify() never throws, and it does SMS I/O:
       running it inside the transaction would hold the seat lock open across a
       network round-trip, pinning one of the pool's connections. */
    const at = new Date(cls.scheduledAt).toISOString(); // rendered in Tunis time, in the reader's language
    await notify(db, uid, {
      key: "bookingConfirmed",
      params: { classTitle: cls.title, at, who: publicTutorName(tut?.fullName) }, // phase-a lane L2 (A23): "Mohamed B."
      href: `/class/${cls.id}`,
      // Names the tutor: rewritten if that account is ever erased.
      aboutProfileId: tut?.profileId ?? null,
      sms: true,
    });
    if (tut?.profileId) {
      await notify(db, tut.profileId, {
        /* First name only, like every other place a counterparty is named (Step 8),
           and aboutProfileId so an erasure can rewrite it. */
        key: "bookingNew",
        params: { classTitle: cls.title, at, who: publicDisplayName(session.profile.fullName) },
        href: "/dashboard",
        aboutProfileId: uid,
      });
    }
    // espace prof v2 · pro (P7): the confirmation emails (+ .ics) to both sides — after the commit, not awaited.
    dispatchMail("booking-confirmed", () => mailBookingConfirmedFor(cls.id, uid));

    /* seats_left just moved and the storefront caches it for 60s — a class the
       cache still shows as "3 places" is how a student reaches the checkout of a
       sold-out session. The web busts it from this envelope. */
    /* espace prof v2 · growth (P5): the price recorded, whether the subscription
       covered the seat, the promotion applied — and, when a code they brought did
       not apply, why (the checkout says it calmly; the normal price was booked). */
    return {
      ok: true,
      revalidate: { tutors: [tut.slug] },
      priceTnd: priced.priceTnd,
      covered: priced.covered,
      promotionPercent: priced.promotionPercent,
      ...(priced.promoNotice ? { promoNotice: priced.promoNotice } : {}),
    };
  });

  /* ── POST /bookings/cancel ───────────────────────────────────────────────── */
  app.post("/bookings/cancel", async (req, reply) => {
    const parsed = cancelBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad-request" });

    const bookingId = vUuid(parsed.data.bookingId, { field: "booking" });
    if (!bookingId.ok) return { ok: false, error: "not-found" };

    const session = await getSession(req);
    if (!session) return { ok: false, error: "not-authenticated" };
    const uid = session.profile.id;

    const [bk] = await db.select().from(bookings).where(eq(bookings.id, bookingId.value)).limit(1);
    if (!bk) return { ok: false, error: "not-found" };
    // IDOR guard: a booking id is a bare uuid, so ownership must be checked.
    if (bk.studentId !== uid) return { ok: false, error: "forbidden" };
    if (bk.status === "cancelled") return { ok: true }; // idempotent

    const [cls] = await db.select().from(classes).where(eq(classes.id, bk.classId)).limit(1);
    if (!cls) return { ok: false, error: "not-found" };

    /* Server time, never the client's. A cancellation deadline that trusts the
       caller's clock is not a deadline. */
    const now = Date.now();

    /* A class that has ALREADY STARTED cannot be cancelled.

       This check is NEW, and it is here because removing the 24-hour refusal
       removed the thing that was accidentally enforcing it. Under the old code
       `startsInMs < 24h` also caught every past class; drop that line without
       replacing it and a student could "cancel" last month's session, free a seat
       on a class that already ran, and mint a ledger row for it. Tightening this
       one case is not a policy change — nobody was ever able to do it. */
    if (new Date(cls.scheduledAt).getTime() <= now) {
      return { ok: false, error: "already-started" };
    }

    /* THE RULE: free up to 48h before, 40% retained after that.

       The seat's value is what the STUDENT was liable for, so a free first
       session is worth 0 and retains 0 — 40% of nothing. Reading the price off
       the class row rather than the booking is deliberate: booking.isFree is the
       authoritative "was this seat free", and the class holds the amount. */
    /* WAIVED IF THE TUTOR MOVED THE CLASS AFTER THIS STUDENT BOOKED (Step 11).

       They agreed to a time that no longer exists, so a 48h window measured
       against the NEW time is a deadline for an appointment they never made.
       Comparing the booking's creation to classes.rescheduled_at is the whole
       rule — a student who booked AFTER the move chose the new time and is held
       to the normal window like anyone else. */
    // phase-a lane L3 (A21): the same shared definition the dashboard's warning uses.
    const movedAfterBooking = isMovedAfterBooking(bk.createdAt, cls.rescheduledAt);

    const outcome = cancellationOutcome({
      scheduledAt: cls.scheduledAt,
      // espace prof v2 · growth (P5): the price THIS seat was booked at (after its
      // promotion); a seat covered by a monthly subscription is worth 0 on its own.
      amountTnd: bk.isFree || bk.subscriptionId ? 0 : Number(bk.priceTnd ?? cls.priceTnd ?? 0),
      now,
      waived: movedAfterBooking,
    });

    const [tut] = await db.select().from(tutors).where(eq(tutors.id, cls.tutorId)).limit(1);

    /* Atomic seat release, mirroring the claim: the "still active?" test is the
       UPDATE's WHERE clause with RETURNING, so only ONE writer can decrement.
       Two concurrent cancels of the same booking would otherwise both pass a plain
       read and both give the seat back — freeing a seat that never existed. */
    const released = await db.transaction(async (tx) => {
      const rows = await tx
        .update(bookings)
        .set({ status: "cancelled" })
        .where(
          and(
            eq(bookings.id, bookingId.value),
            /* coalesce(...,'reserved'), matching the original exactly: a NULL status
               is a live booking, and `status <> 'cancelled'` is NULL-false in SQL —
               which would silently refuse to release those seats. */
            raw`coalesce(${bookings.status}, 'reserved') <> 'cancelled'`,
          ),
        )
        .returning({ id: bookings.id });
      if (rows.length === 0) return false; // someone else already cancelled it

      await tx
        .update(classes)
        .set({ seatsTaken: raw`greatest(coalesce(${classes.seatsTaken}, 0) - 1, 0)` })
        .where(eq(classes.id, cls.id));

      /* THE LEDGER, in the SAME transaction as the status flip and the seat
         release. All three are one fact. A ledger written afterwards, outside the
         transaction, is a ledger that silently disagrees with reality the first
         time the process dies between the two writes — and this is the record a
         money dispute would be settled from.

         onConflictDoNothing on the unique booking_id: two concurrent cancels are
         already impossible past the atomic status flip above, so reaching this
         conflict means something upstream changed. Doing nothing is right either
         way — the first row is the true one, and a second would double the
         retained amount. */
      /* phase-a lane L3 (A8): the key is now (booking_id, cancelled_at) — 0026. A
         re-booked seat reactivates the same booking row, and its SECOND
         cancellation is a real event that the old unique(booking_id) dropped. The
         conflict now only catches a double-write of one cancellation. */
      await tx
        .insert(cancellations)
        .values({
          bookingId: bookingId.value,
          classId: cls.id,
          actorProfileId: uid,
          actor: "student",
          hoursBeforeStart: (outcome.msBeforeStart / 3_600_000).toFixed(2),
          late: outcome.late,
          amountTnd: outcome.amountTnd.toFixed(2),
          retainedTnd: outcome.retainedTnd.toFixed(2),
          releasedTnd: outcome.releasedTnd.toFixed(2),
          retainedPct: outcome.retainedPct.toFixed(3),
          /* What was true WHEN THIS ROW WAS WRITTEN. False for every pilot row.
             Without it, the day payments open, no reader can tell a "would have
             been retained" row from a real debit. */
          paymentsEnabled: paymentsEnabled(),
          /* WHY the number is what it is. A ledger row reading "late, nothing
             retained" with no explanation is one a future reader has to guess at,
             and the guess would be "a bug". */
          /* phase-a lane L3 (A6): a FREE seat the student cancels late (and not
             waived) spends their free first session with this tutor; the booking
             path reads this reason (freeFirstSeatFor). */
          reason: movedAfterBooking
            ? "class-rescheduled-waiver"
            : cancelSpendsFreeFirst({ actor: "student", wasFree: bk.isFree, late: outcome.late, waived: false })
              ? FREE_FIRST_SPENT_REASON
              : null,
        })
        .onConflictDoNothing();

      await recomputeTutorStats(cls.tutorId, tx);
      // The link this student may have fetched stops working (lib/room-rotation.ts).
      await rotateRoomToken(tx, cls.id);
      // espace prof v2 · growth (P5): the promotion use this seat took goes back.
      if (bk.promotionId) await releasePromotionUse(tx, bk.promotionId);
      return true;
    });

    if (!released) return { ok: true }; // already cancelled — idempotent

    if (tut?.profileId) {
      /* The tutor is told WHEN it happened relative to the deadline, because that
         is the whole difference between a cancellation they can refill and one
         they cannot. It says nothing about a payment: nothing is charged, and a
         notification implying otherwise would be the exact false money claim the
         ledger's payments_enabled column exists to keep straight. */
      await notify(db, tut.profileId, {
        key: "bookingCancelledByStudent",
        params: {
          classTitle: cls.title,
          at: new Date(cls.scheduledAt).toISOString(),
          who: publicDisplayName(session.profile.fullName),
          late: outcome.late,
          lateHours: CANCEL_FREE_WINDOW_HOURS,
        },
        href: "/dashboard",
        aboutProfileId: uid,
      });
    }
    /* espace prof v2 · pro (P7): the student's confirmation (with a METHOD:CANCEL .ics
       that removes the calendar entry) and the tutor's notice — the same outcome the
       ledger row just recorded. */
    dispatchMail("booking-cancelled", () =>
      mailBookingCancelled(bookingId.value, {
        late: outcome.late,
        waived: movedAfterBooking,
        wasFree: Boolean(bk.isFree),
        wasCovered: Boolean(bk.subscriptionId),
        retainedTnd: outcome.retainedTnd,
      }),
    );

    /* The outcome goes back to the UI so the confirmation can be SPECIFIC — "you
       cancelled in time" vs "this was a late cancellation, 40% is recorded" —
       instead of one vague success toast. paymentsEnabled rides along so the
       client never has to assume: while it is false the UI must say plainly that
       no money is taken, and it cannot say that honestly without being told. */
    return {
      ok: true,
      late: outcome.late,
      amountTnd: outcome.amountTnd,
      retainedTnd: outcome.retainedTnd,
      /* phase-a lane L3 (A21): the share ACTUALLY retained — 0 for a free seat, a
         waived one or an early cancel. It was the rate that applied (0.4 on a
         free seat), and the screen said "40 %" beside nothing retained. */
      retainedPct: retainedShare(outcome),
      waived: movedAfterBooking,
      paymentsEnabled: paymentsEnabled(),
      revalidate: tut?.slug ? { tutors: [tut.slug] } : undefined,
    };
  });

  /* ── GET /student/dashboard ──────────────────────────────────────────────
     Transcribed from getStudentDashboard. My first draft of this invented fields
     (reviewCount, tutorSlug, durationMin) and keyed on the BOOKING status where the
     original uses the CLASS status — caught by reading the original rather than
     trusting the draft. The shape below is exactly what StudentDashboard declares. */
  app.get("/student/dashboard", async (req): Promise<StudentDashboard | null> => {
    const session = await getSession(req);
    if (!session) return null;
    const uid = session.profile.id;

    const rows = await db
      .select({
        bookingId: bookings.id,
        isFree: bookings.isFree,
        // phase-a lane L3 (A21): what a late cancel of this seat would retain.
        priceTnd: classes.priceTnd,
        // espace prof v2 · growth (P5): the seat's own price (after its promotion), and its cover.
        bookedPriceTnd: bookings.priceTnd,
        subscriptionId: bookings.subscriptionId,
        bookedAt: bookings.createdAt,
        rescheduledAt: classes.rescheduledAt,
        classId: classes.id,
        title: classes.title,
        scheduledAt: classes.scheduledAt,
        status: classes.status,
        roomToken: classes.roomToken,
        meetUrl: classes.meetUrl,
        replayUrl: classes.replayUrl,
        tutorName: tutors.fullName,
      })
      .from(bookings)
      .innerJoin(classes, eq(bookings.classId, classes.id))
      .innerJoin(tutors, eq(classes.tutorId, tutors.id))
      // Cancelled reservations disappear from the list — the seat is back on sale.
      .where(and(eq(bookings.studentId, uid), ne(bookings.status, "cancelled")))
      .orderBy(desc(classes.scheduledAt))
      .limit(300); // one join, bounded — no per-booking query

    const items = rows.map((r) => {
      const d = new Date(r.scheduledAt);
      const { day, month, time } = classWhen(d); // Tunis time
      return {
        bookingId: r.bookingId,
        classId: r.classId,
        title: r.title,
        tutorName: publicTutorName(r.tutorName) ?? "", // phase-a lane L2 (A23): "Mohamed B.", never the last name
        day,
        month,
        time,
        ts: d.getTime(),
        isFree: Boolean(r.isFree),
        /* phase-a lane L3 (A21): the confirm box states THIS, not a flat "40 %" —
           0 for a free seat and for a class moved after the booking. */
        lateCancelRetainedTnd: lateCancelRetainedTnd({
          // espace prof v2 · growth (P5): the same amount POST /bookings/cancel will use.
          amountTnd: r.isFree || r.subscriptionId ? 0 : Number(r.bookedPriceTnd ?? r.priceTnd ?? 0),
          waived: isMovedAfterBooking(r.bookedAt, r.rescheduledAt),
        }),
        status: r.status ?? "scheduled",
        // Never blank: falls back to the class's private token room. This list is the
        // student's own live bookings, so the room is theirs to have.
        meetUrl: resolveMeetUrl({ roomToken: r.roomToken, meetUrl: r.meetUrl }),
        replayUrl: r.replayUrl ?? undefined,
      };
    });

    /* Keep a class "upcoming" for ~2h past its start: one that began 40 minutes ago
       is still the one the student is IN, and moving it to "past" mid-session takes
       the Join button away from someone sitting in the room. */
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    const upcoming = items.filter((i) => i.ts >= cutoff).sort((a, b) => a.ts - b.ts);
    const past = items.filter((i) => i.ts < cutoff).sort((a, b) => b.ts - a.ts);
    return { upcoming, past };
  });
}
