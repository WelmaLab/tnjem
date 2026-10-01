import { and, eq, isNull, consents } from "@tnajem/db";
import { isAdult, minorsAllowed } from "@tnajem/shared";
import { db } from "../db";
import type { Session } from "./session";

/* THE BOOKING RULE FOR MINORS, for the other ways a student engages a tutor —
   following one (Phase 4) and subscribing to a monthly offer (Phase 5). The SAME
   rule as POST /bookings (routes/bookings.ts), with the same answers the UI
   already maps:

     adult (month-aware, unknown fails safe)      → allowed
     minor while ALLOW_MINORS is off              → "adults-only"
     minor with no live guardian consent           → "needs-consent"

   One implementation, so the three entry points cannot drift apart. */
export async function minorGate(session: Session): Promise<{ ok: true } | { ok: false; error: "adults-only" | "needs-consent" }> {
  if (isAdult(session.profile.birthYear, session.profile.birthMonth)) return { ok: true };
  if (!minorsAllowed()) return { ok: false, error: "adults-only" };
  const [consent] = await db
    .select({ id: consents.id })
    .from(consents)
    .where(and(eq(consents.minorId, session.profile.id), isNull(consents.withdrawnAt)))
    .limit(1);
  return consent ? { ok: true } : { ok: false, error: "needs-consent" };
}
