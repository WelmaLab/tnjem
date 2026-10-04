import { test, expect } from "@playwright/test";
import { sql } from "./support/db";
import { seedProfile, seedTutor, seedClass, seedBooking } from "./support/seed";
import { backdateBooking } from "./support/seed"; // live-fixes-3 · C
import { mintSession } from "./support/session";

/* CANCELLATION — 48h free, 40% retained, and the ledger that records it.

   apps/api/test/cancellation.test.ts pins the arithmetic. This pins the two
   things only a real request can show: that the endpoint APPLIES it, and that
   the ledger row is actually written — in the same transaction as the seat
   release, so a crash between them cannot leave the two disagreeing.

   THE HEADLINE IS A LOOSENING. The old rule refused inside 24h ("too-late"), so
   the seat stayed locked to someone who was not coming and the tutor could not
   resell it. A late cancellation now succeeds.

   ADDED, never edited into an existing spec — the Stage A rule still holds. */

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:4000";

type CancelBody = {
  ok: boolean;
  error?: string;
  late?: boolean;
  amountTnd?: number;
  retainedTnd?: number;
  retainedPct?: number;
  paymentsEnabled?: boolean;
};

async function cancel(token: string, bookingId: string): Promise<CancelBody> {
  const res = await fetch(`${API}/bookings/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `tnajem_session=${token}` },
    body: JSON.stringify({ bookingId }),
  });
  return res.json() as Promise<CancelBody>;
}

type LedgerRow = {
  late: boolean;
  amount_tnd: string;
  retained_tnd: string;
  released_tnd: string;
  retained_pct: string;
  actor: string;
  payments_enabled: boolean;
  hours_before_start: string;
};

async function ledger(bookingId: string): Promise<LedgerRow[]> {
  return sql<LedgerRow[]>`
    select late, amount_tnd, retained_tnd, released_tnd, retained_pct, actor,
           payments_enabled, hours_before_start
      from cancellations where booking_id = ${bookingId}` as unknown as Promise<LedgerRow[]>;
}

async function seatsTaken(classId: string): Promise<number> {
  const [r] = await sql<{ n: number }[]>`
    select coalesce(seats_taken, 0)::int n from classes where id = ${classId}`;
  return r?.n ?? 0;
}

/** A student holding a real booking on a class `hoursFromNow` away. */
async function scenario(opts: { hoursFromNow: number; priceTnd?: number; isFree?: boolean }) {
  const tutorProfile = await seedProfile({ role: "tutor", birthYear: 1990 });
  const tutor = await seedTutor({ profileId: tutorProfile.id, status: "verified" });
  const klass = await seedClass({
    tutorId: tutor.id,
    seats: 10,
    seatsTaken: 1,
    priceTnd: opts.priceTnd ?? 20,
    hoursFromNow: opts.hoursFromNow,
  });
  const student = await seedProfile({ role: "student", birthYear: 1995 });
  const booking = await seedBooking({
    classId: klass.id,
    studentId: student.id,
    isFree: opts.isFree ?? false,
  });
  // live-fixes-3 · C: a seat booked an hour ago — outside the 15-minute grace after booking.
  await backdateBooking(booking.id);
  return { tutor, klass, student, booking, token: await mintSession(student.id) };
}

test("cancelling more than 48h out is free, and the seat comes back", async () => {
  const s = await scenario({ hoursFromNow: 96, priceTnd: 20 });

  const res = await cancel(s.token, s.booking.id);
  expect(res.ok).toBe(true);
  expect(res.late).toBe(false);
  expect(res.retainedTnd).toBe(0);

  expect(await seatsTaken(s.klass.id), "the seat must be released").toBe(0);

  const [row] = await ledger(s.booking.id);
  expect(row, "a ledger row is written even when nothing is retained — the absence of a charge is itself the record").toBeTruthy();
  expect(row.late).toBe(false);
  expect(Number(row.retained_tnd)).toBe(0);
  expect(Number(row.released_tnd)).toBe(20);
  expect(row.actor).toBe("student");
});

test("THE BEHAVIOUR CHANGE: cancelling inside 48h now SUCCEEDS, with 40% recorded", async () => {
  /* Under the old rule this returned { ok:false, error:"too-late" }, the seat
     stayed taken, and nothing was recorded anywhere. */
  const s = await scenario({ hoursFromNow: 5, priceTnd: 20 });

  const res = await cancel(s.token, s.booking.id);
  expect(res.ok, "a late cancellation is allowed now").toBe(true);
  expect(res.late).toBe(true);
  expect(res.retainedTnd).toBe(8); // 40% of 20
  expect(res.retainedPct).toBe(0.4);

  expect(await seatsTaken(s.klass.id), "the seat is released even when late — that is the point").toBe(0);

  const [row] = await ledger(s.booking.id);
  expect(row.late).toBe(true);
  expect(Number(row.amount_tnd)).toBe(20);
  expect(Number(row.retained_tnd)).toBe(8);
  expect(Number(row.released_tnd)).toBe(12);
  expect(Number(row.retained_pct)).toBe(0.4);
  expect(Number(row.hours_before_start)).toBeGreaterThan(4);
  expect(Number(row.hours_before_start)).toBeLessThan(6);
});

test("NOTHING IS CHARGED: every pilot row records payments as disabled", async () => {
  /* The column that lets a future reader tell a "would have been retained" row
     from a real debit. If this ever comes back true while payments are off,
     every historical row becomes ambiguous. */
  const s = await scenario({ hoursFromNow: 2, priceTnd: 50 });
  const res = await cancel(s.token, s.booking.id);
  expect(res.paymentsEnabled).toBe(false);
  const [row] = await ledger(s.booking.id);
  expect(row.payments_enabled).toBe(false);
});

test("a free seat cancelled late retains nothing — 40% of zero", async () => {
  const s = await scenario({ hoursFromNow: 2, priceTnd: 30, isFree: true });
  const res = await cancel(s.token, s.booking.id);
  expect(res.ok).toBe(true);
  expect(res.late).toBe(true);
  expect(res.amountTnd, "a free seat is worth nothing, whatever the class price says").toBe(0);
  expect(res.retainedTnd).toBe(0);
  const [row] = await ledger(s.booking.id);
  expect(Number(row.amount_tnd)).toBe(0);
  expect(Number(row.retained_tnd)).toBe(0);
});

test("a class that has already started cannot be cancelled", async () => {
  /* NOT a policy change — nobody could ever do this. The old 24h refusal was
     also, accidentally, what blocked it; removing that check without replacing
     it would let a student free a seat on a class that already ran. */
  const s = await scenario({ hoursFromNow: -3, priceTnd: 20 });

  const res = await cancel(s.token, s.booking.id);
  expect(res.ok).toBe(false);
  expect(res.error).toBe("already-started");

  expect(await seatsTaken(s.klass.id), "no seat may be released for a class that ran").toBe(1);
  expect(await ledger(s.booking.id), "and no ledger row may be minted for it").toHaveLength(0);
});

test("another student cannot cancel my booking", async () => {
  const s = await scenario({ hoursFromNow: 96 });
  const attacker = await seedProfile({ role: "student", birthYear: 1995 });
  const res = await cancel(await mintSession(attacker.id), s.booking.id);
  expect(res.ok).toBe(false);
  expect(res.error).toBe("forbidden");
  expect(await ledger(s.booking.id)).toHaveLength(0);
});

test("concurrent cancels write exactly ONE ledger row and release exactly ONE seat", async () => {
  /* The retained amount is money. Two rows would double it. The atomic status
     flip already makes this impossible, and unique(booking_id) is the belt to
     that pair of braces — the same lesson as the missing unique index on
     bookings (0007), where the sequential case always looked fine and only the
     concurrent one leaked. */
  const s = await scenario({ hoursFromNow: 4, priceTnd: 25 });

  const results = await Promise.all(
    Array.from({ length: 6 }, () => cancel(s.token, s.booking.id)),
  );
  expect(results.every((r) => r.ok), "every concurrent cancel is idempotent, not an error").toBe(true);

  expect(await ledger(s.booking.id)).toHaveLength(1);
  expect(await seatsTaken(s.klass.id), "the seat must be released once, not six times").toBe(0);
});
