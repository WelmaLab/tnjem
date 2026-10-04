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

export const DEFAULT_MEET_BASE = "https://meet.jit.si/tnajem-";

/* live-fixes-3 · B1 — AN EMPTY BASE IS NOT A BASE.

   Production's .env carried `NEXT_PUBLIC_DEFAULT_MEET_BASE=` (the deploy workflow
   wrote it empty when no repo variable existed), and this read it with `??`, so the
   empty string won: the "room" became the bare token, the browser opened it as a
   RELATIVE link — tnajem.com/fr/live/<token> — and every class said « Aucun prof
   trouvé ». Now unset, empty or blank means the default, and a value that is not an
   absolute https:// URL prefix is refused (the default again, logged once per
   process). `npm run db:check -- --production` fails on such a value, so the deploy
   stops before it ships (packages/db/bin/check.ts). */

/** An absolute https:// URL prefix a room token can be appended to: scheme, host, then a "/". */
export function isValidMeetBase(raw: string): boolean {
  if (!/^https:\/\/[^/?#\s]+\/[^#\s]*$/i.test(raw)) return false;
  try {
    return new URL(raw).protocol === "https:";
  } catch {
    return false;
  }
}

let warnedBadBase = false;

/** The room base in force: the configured one when it is valid, else the default. */
export function meetBase(): string {
  /* Spelled out in full: Next inlines NEXT_PUBLIC_* into the client bundle only for
     this exact expression. */
  const raw = (process.env.NEXT_PUBLIC_DEFAULT_MEET_BASE || "").trim();
  if (!raw) return DEFAULT_MEET_BASE;
  if (isValidMeetBase(raw)) return raw;
  if (!warnedBadBase) {
    warnedBadBase = true;
    // The value itself is not logged — only that it was refused.
    console.warn(`[live] NEXT_PUBLIC_DEFAULT_MEET_BASE is not an absolute https:// URL prefix; using ${DEFAULT_MEET_BASE}`);
  }
  return DEFAULT_MEET_BASE;
}

/** The fallback room for a class, from its private room token. Always absolute https://. */
export function liveRoomUrl(roomToken: string): string {
  return meetBase() + roomToken;
}

/** The class uses the token room (no room of the tutor's own). */
export function isDefaultRoom(url: string | null | undefined): boolean {
  return Boolean(url) && (url as string).startsWith(meetBase());
}

function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** A Jitsi room: the token room's host (meet.jit.si, or the configured Jitsi). A
    tutor's own Zoom / Google Meet link is not one. */
export function isJitsiRoom(url: string): boolean {
  const host = hostOf(url);
  return host !== null && (host === hostOf(DEFAULT_MEET_BASE) || host === hostOf(meetBase()));
}

/** meet.jit.si itself — where, since 2023, the first person in a room must sign in. */
export function isPublicJitsi(url: string | null | undefined): boolean {
  return Boolean(url) && hostOf(url as string) === "meet.jit.si";
}

/* live-fixes-3 · B2 — THE ROOM'S TITLE AND THE VIEWER'S NAME.

   Jitsi showed the room NAME as the meeting title (« Tnajem 19921812 7 E 67 … ») and
   asked everyone to type a name. It reads JSON-valued settings from the URL
   fragment, joined with "&" in ONE fragment:
     #config.subject=%22<title>%22&userInfo.displayName=%22<name>%22
   Only for a Jitsi room; any other link is returned untouched. A setting already in
   the tutor's own Jitsi link is left alone. */
export function jitsiJoinUrl(url: string, opts: { subject?: string | null; displayName?: string | null }): string {
  if (!isJitsiRoom(url)) return url;
  const hash = url.indexOf("#");
  const fragment = hash === -1 ? "" : url.slice(hash + 1);
  const present = new Set(fragment.split("&").map((p) => p.split("=")[0]));
  const add: string[] = [];
  const subject = (opts.subject ?? "").trim();
  const name = (opts.displayName ?? "").trim();
  if (subject && !present.has("config.subject")) add.push(`config.subject=${encodeURIComponent(JSON.stringify(subject))}`);
  if (name && !present.has("userInfo.displayName")) add.push(`userInfo.displayName=${encodeURIComponent(JSON.stringify(name))}`);
  if (add.length === 0) return url;
  return hash === -1 ? `${url}#${add.join("&")}` : `${url}${fragment ? "&" : ""}${add.join("&")}`;
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
