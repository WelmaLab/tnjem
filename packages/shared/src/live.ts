/* Live class rooms — never blank, never guessable.

   A room always exists: a class without its own URL gets a Jitsi room named after
   its ROOM TOKEN (classes.room_token, a random UUID — 0018_class_room_token.sql).
   It used to be named after the class id, which is printed on every public
   storefront (/class/<id>), so anyone could build the room URL of a live class
   without the API. The token is never on a public page: it reaches only the owning
   tutor or a student with a live booking (GET /classes/:id, /classes/:id/join,
   /student/dashboard).

   A tutor CAN still bring their own room (Zoom, Google Meet, their school's
   Jitsi) by setting classes.meet_url — that always wins, and it is just as private.

   Residual risk: a meet.jit.si room has no authentication — whoever holds the link
   is in. Gating that for real needs a JWT-protected Jitsi (JaaS or self-hosted).

   Uses a NEXT_PUBLIC_ env var only, so this module is safe on the client too
   (no `server-only` guard on purpose — the live page renders the join button). */

const DEFAULT_BASE = "https://meet.jit.si/tnajem-";

/** The fallback room for a class, from its private room token. */
export function liveRoomUrl(roomToken: string): string {
  const base = process.env.NEXT_PUBLIC_DEFAULT_MEET_BASE ?? DEFAULT_BASE;
  return base + roomToken;
}

/* phase-a lane L3 (A16) — WHEN A CLASS ENDS: start + duration, one definition.

   Reviews opened one minute into a class and the live page said "EN DIRECT" for
   ever after the start; both now read the real end. A missing or nonsensical
   duration falls back to the column default (90 min) rather than to zero, which
   would open reviews at the very start again. */
export const DEFAULT_CLASS_DURATION_MIN = 90;

export function classEndMs(cls: { scheduledAt: Date | string | number; durationMin?: number | null }): number {
  const d = cls.durationMin;
  const minutes = typeof d === "number" && Number.isFinite(d) && d > 0 ? d : DEFAULT_CLASS_DURATION_MIN;
  return new Date(cls.scheduledAt).getTime() + minutes * 60_000;
}

/** Resolve the room a class actually uses: the tutor's own URL if set, else its token room. */
export function resolveMeetUrl(cls: { roomToken: string; meetUrl?: string | null }): string {
  const own = (cls.meetUrl ?? "").trim();
  return own || liveRoomUrl(cls.roomToken);
}

/* live-fixes-3 · A1 — THE TUTOR'S WAY INTO THEIR OWN CLASS: « Démarrer la séance ».

   Nothing in the prof space linked to /live/<id>, so a tutor had no way into the
   class they were about to teach. Every surface that offers the button (Mes
   classes, Accueil › Prochaines séances, the owner's class page) asks this one rule:

     soon  more than 30 min before the start — offered, as a secondary button
     open  from 30 min before the start until the real end — THE main action
     over  ended, cancelled or done — no button at all */
export const START_WINDOW_MIN = 30;
export type StartState = "soon" | "open" | "over";

export function startState(
  cls: { starts_at: string; duration_min?: number | null; status?: string | null },
  now: number = Date.now(),
): StartState {
  if (cls.status === "cancelled" || cls.status === "done") return "over";
  const start = Date.parse(cls.starts_at);
  if (!Number.isFinite(start)) return "over";
  if (now >= classEndMs({ scheduledAt: start, durationMin: cls.duration_min })) return "over";
  return now >= start - START_WINDOW_MIN * 60_000 ? "open" : "soon";
}
