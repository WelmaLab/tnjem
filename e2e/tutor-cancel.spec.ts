import { test, expect } from "@playwright/test";
import { sql } from "./support/db";
import { seedProfile, seedTutor, seedClass, seedBooking } from "./support/seed";
import { backdateBooking } from "./support/seed"; // live-fixes-3 · C
import { mintSession } from "./support/session";

/* TUTOR CANCELS AND RESCHEDULES (Step 11).

   The point of the step is an ASYMMETRY, and that is what these tests pin. When a
   STUDENT cancels late, 40% is retained. When the TUTOR cancels, nothing is —
   ever, at any notice — because the student did not make the decision they would
   be charged for.

   The reschedule case is the subtle one: moving a class does not cancel anybody,
   but it does waive the deadline for everyone who booked the OLD time. They
   agreed to an appointment that no longer exists.

   ADDED, never edited into an existing spec. */

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:4000";

async function post(path: string, token: string, body: unknown = {}) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `tnajem_session=${token}` },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<Record<string, unknown>>;
}

type Ledger = {
  actor: string;
  late: boolean;
  amount_tnd: string;
  retained_tnd: string;
  released_tnd: string;
  reason: string | null;
};

async function ledger(bookingId: string): Promise<Ledger[]> {
  return sql<Ledger[]>`
    select actor, late, amount_tnd, retained_tnd, released_tnd, reason
      from cancellations where booking_id = ${bookingId}` as unknown as Promise<Ledger[]>;
}

/** A tutor's class with `students` students booked on it, `hoursFromNow` away. */
async function scenario(opts: { hoursFromNow?: number; students?: number; priceTnd?: number } = {}) {
  const tutorProfile = await seedProfile({ role: "tutor", birthYear: 1985 });
  const tutor = await seedTutor({ profileId: tutorProfile.id, status: "verified" });
  const klass = await seedClass({
    tutorId: tutor.id,
    seats: 10,
    seatsTaken: opts.students ?? 1,
    priceTnd: opts.priceTnd ?? 30,
    hoursFromNow: opts.hoursFromNow ?? 96,
  });
  const booked = [];
  for (let i = 0; i < (opts.students ?? 1); i++) {
    const student = await seedProfile({ role: "student", birthYear: 1995 });
    const booking = await seedBooking({ classId: klass.id, studentId: student.id, isFree: false });
    booked.push({ student, booking, token: await mintSession(student.id) });
  }
  return { tutor, klass, booked, tutorToken: await mintSession(tutorProfile.id) };
}

test.describe("the tutor cancels", () => {
  test("100% RELEASE even three hours out — the asymmetry that defines the step", async () => {
    /* A STUDENT cancelling at three hours keeps 60%; the tutor cancelling at three
       hours costs the student nothing. Same clock, opposite outcome, because the
       question is who made the decision. */
    const s = await scenario({ hoursFromNow: 3, priceTnd: 30 });
    const res = await post(`/classes/${s.klass.id}/cancel`, s.tutorToken);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(res.cancelled).toBe(1);

    const [row] = await ledger(s.booked[0].booking.id);
    expect(row.actor).toBe("tutor");
    expect(Number(row.retained_tnd), "the student owes nothing for the tutor's decision").toBe(0);
    expect(Number(row.released_tnd)).toBe(30);
    expect(row.late, "and the ledger still records that it WAS late, truthfully").toBe(true);
  });

  test("every booking is cancelled and every seat released", async () => {
    const s = await scenario({ students: 3 });
    const res = await post(`/classes/${s.klass.id}/cancel`, s.tutorToken);
    expect(res.cancelled).toBe(3);

    const [cls] = await sql<{ status: string; seats_taken: number }[]>`
      select status, seats_taken from classes where id = ${s.klass.id}`;
    expect(cls.status).toBe("cancelled");
    expect(cls.seats_taken, "a cancelled class holds no seats").toBe(0);

    const [live] = await sql<{ n: number }[]>`
      select count(*)::int n from bookings
       where class_id = ${s.klass.id} and coalesce(status,'reserved') <> 'cancelled'`;
    expect(live.n, "a half-cancelled class is worse than none — the students turn up").toBe(0);

    for (const b of s.booked) expect(await ledger(b.booking.id)).toHaveLength(1);
  });

  test("every affected student is told", async () => {
    const s = await scenario({ students: 2 });
    await post(`/classes/${s.klass.id}/cancel`, s.tutorToken);
    for (const b of s.booked) {
      const [n] = await sql<{ n: number }[]>`
        select count(*)::int n from notifications
         where profile_id = ${b.student.id} and kind = 'booking_cancelled'`;
      expect(n.n, "a cancellation nobody hears about is a no-show").toBeGreaterThan(0);
    }
  });

  test("cancelling twice is idempotent, and does not double the ledger", async () => {
    const s = await scenario();
    await post(`/classes/${s.klass.id}/cancel`, s.tutorToken);
    const again = await post(`/classes/${s.klass.id}/cancel`, s.tutorToken);
    expect(again.ok).toBe(true);
    expect(again.already).toBe(true);
    expect(await ledger(s.booked[0].booking.id)).toHaveLength(1);
  });

  test("a class that already started cannot be cancelled", async () => {
    const s = await scenario({ hoursFromNow: -2 });
    const res = await post(`/classes/${s.klass.id}/cancel`, s.tutorToken);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("already-started");
  });

  test("ANOTHER TUTOR CANNOT CANCEL MY CLASS", async () => {
    const mine = await scenario();
    const other = await scenario();
    const res = await post(`/classes/${mine.klass.id}/cancel`, other.tutorToken);
    expect(res.ok).toBe(false);
    expect(res.error, "and it must not confirm the id exists").toBe("not-found");

    const [cls] = await sql<{ status: string }[]>`
      select status from classes where id = ${mine.klass.id}`;
    expect(cls.status).toBe("scheduled");
  });

  test("a student cannot cancel the whole class", async () => {
    const s = await scenario();
    const res = await post(`/classes/${s.klass.id}/cancel`, s.booked[0].token);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("not-found");
  });
});

test.describe("the tutor reschedules", () => {
  const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

  test("moving the class does NOT cancel anybody", async () => {
    /* Cancelling their seats to force a re-book would lose the students who never
       read the notification — the opposite of helping them. */
    const s = await scenario({ students: 2 });
    const res = await post(`/classes/${s.klass.id}/reschedule`, s.tutorToken, {
      scheduledAt: inHours(120),
    });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(res.notified).toBe(2);

    const [live] = await sql<{ n: number }[]>`
      select count(*)::int n from bookings
       where class_id = ${s.klass.id} and coalesce(status,'reserved') <> 'cancelled'`;
    expect(live.n).toBe(2);
  });

  test("A STUDENT WHO BOOKED THE OLD TIME CANCELS FREE, INSIDE THE WINDOW", async () => {
    /* The whole point. The class is three hours away — normally 40% retained —
       but the tutor moved it after this student booked, so the deadline is being
       measured against a time they never agreed to. */
    const s = await scenario({ hoursFromNow: 96, priceTnd: 30 });
    await post(`/classes/${s.klass.id}/reschedule`, s.tutorToken, { scheduledAt: inHours(3) });

    const res = await post("/bookings/cancel", s.booked[0].token, {
      bookingId: s.booked[0].booking.id,
    });
    expect(res.ok).toBe(true);
    expect(res.late, "it IS inside the window, and the response says so").toBe(true);
    expect(res.retainedTnd, "...but nothing is retained, because they never chose this time").toBe(0);

    const [row] = await ledger(s.booked[0].booking.id);
    expect(Number(row.retained_tnd)).toBe(0);
    expect(Number(row.released_tnd)).toBe(30);
    expect(row.reason, "and the ledger explains its own number").toBe("class-rescheduled-waiver");
  });

  test("a student who booked AFTER the move is held to the normal window", async () => {
    /* The other half. They chose the new time with their eyes open, so the
       waiver would be a loophole rather than a fairness. */
    const s = await scenario({ hoursFromNow: 96, priceTnd: 30, students: 0 });
    await post(`/classes/${s.klass.id}/reschedule`, s.tutorToken, { scheduledAt: inHours(3) });

    const late = await seedProfile({ role: "student", birthYear: 1995 });
    const booking = await seedBooking({ classId: s.klass.id, studentId: late.id, isFree: false });
    /* live-fixes-3 · C: outside the 15-minute grace after booking — the move goes back
       further still, so this booking is still the one made AFTER it. */
    await sql`update classes set rescheduled_at = now() - interval '2 hours' where id = ${s.klass.id}`;
    await backdateBooking(booking.id);
    const res = await post("/bookings/cancel", await mintSession(late.id), { bookingId: booking.id });

    expect(res.ok).toBe(true);
    expect(res.late).toBe(true);
    expect(res.retainedTnd, "40% of 30").toBe(12);
    const [row] = await ledger(booking.id);
    expect(row.reason).toBeNull();
  });

  test("a past date is refused, exactly as on createClass", async () => {
    const s = await scenario();
    const res = await post(`/classes/${s.klass.id}/reschedule`, s.tutorToken, {
      scheduledAt: inHours(-24),
    });
    expect(res.ok).toBe(false);
  });

  test("another tutor cannot move my class", async () => {
    const mine = await scenario();
    const other = await scenario();
    const res = await post(`/classes/${mine.klass.id}/reschedule`, other.tutorToken, {
      scheduledAt: inHours(120),
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("not-found");
  });

  test("a cancelled class cannot be rescheduled back to life", async () => {
    const s = await scenario();
    await post(`/classes/${s.klass.id}/cancel`, s.tutorToken);
    const res = await post(`/classes/${s.klass.id}/reschedule`, s.tutorToken, {
      scheduledAt: inHours(120),
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("unavailable");
  });
});
