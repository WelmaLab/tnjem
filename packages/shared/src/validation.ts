/* Input validation for server actions — hand-rolled, zero deps.

   Every validator returns a discriminated result instead of throwing, so actions
   can map failures straight onto the existing ActionResult shape:

     const t = vText(input.title, { max: 120, field: "title" });
     if (!t.ok) return { ok: false, error: t.error };
     // t.value is a trimmed, bounded string

   Error strings are stable machine codes (`invalid-title`, `slug-reserved`, …)
   so the UI can localize them; never user-facing prose. Pure module — safe on
   both server and client (no DB, no env). */
import { parseScheduleInput } from "./time";
import { MINOR_AGE_YEARS } from "./legal";

export type Valid<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T,>(value: T): Valid<T> => ({ ok: true, value });
const bad = (error: string): Valid<never> => ({ ok: false, error });

/** Non-empty trimmed string with a max length. `field` shapes the error code. */
export function vText(
  raw: unknown,
  opts: { field: string; max: number; min?: number },
): Valid<string> {
  if (typeof raw !== "string") return bad(`invalid-${opts.field}`);
  const value = raw.trim();
  const min = opts.min ?? 1;
  if (value.length < min) return bad(`invalid-${opts.field}`);
  if (value.length > opts.max) return bad(`${opts.field}-too-long`);
  return ok(value);
}

/** Same as vText but "" / null / undefined → null (an intentionally absent value). */
export function vOptionalText(
  raw: unknown,
  opts: { field: string; max: number },
): Valid<string | null> {
  if (raw === null || raw === undefined) return ok(null);
  if (typeof raw !== "string") return bad(`invalid-${opts.field}`);
  if (!raw.trim()) return ok(null);
  const r = vText(raw, opts);
  return r.ok ? ok(r.value) : r;
}

/** Integer within [min, max] inclusive. Rejects NaN, floats and numeric strings that aren't ints. */
export function vInt(
  raw: unknown,
  opts: { field: string; min: number; max: number },
): Valid<number> {
  const n = typeof raw === "string" ? Number(raw.trim()) : raw;
  if (typeof n !== "number" || !Number.isFinite(n) || !Number.isInteger(n)) return bad(`invalid-${opts.field}`);
  if (n < opts.min || n > opts.max) return bad(`invalid-${opts.field}`);
  return ok(n);
}

/** Money / quantity: finite number >= 0 (never negative), capped, rounded to 2 decimals. */
export function vPrice(raw: unknown, opts: { field: string; max?: number }): Valid<number> {
  const n = typeof raw === "string" ? Number(raw.trim()) : raw;
  if (typeof n !== "number" || !Number.isFinite(n)) return bad(`invalid-${opts.field}`);
  if (n < 0) return bad(`negative-${opts.field}`);
  const max = opts.max ?? 100_000;
  if (n > max) return bad(`${opts.field}-too-high`);
  return ok(Math.round(n * 100) / 100);
}

/** A class start time that parses AND is not in the past (small clock-skew grace).
    A wall time ("2026-09-20T18:00", what a datetime-local input sends) is 18:00 IN
    TUNIS, whatever timezone this process runs in; an explicit Z/offset is taken
    as written. It used to be `new Date(raw)`, which read a wall time in the
    server's own timezone. */
export function vFutureDate(raw: unknown, opts: { field: string; graceMin?: number }): Valid<Date> {
  if (typeof raw !== "string" || !raw.trim()) return bad(`invalid-${opts.field}`);
  const d = parseScheduleInput(raw);
  if (!d) return bad(`invalid-${opts.field}`);
  const grace = (opts.graceMin ?? 1) * 60_000;
  if (d.getTime() < Date.now() - grace) return bad(`${opts.field}-in-past`);
  // Sanity ceiling: nobody schedules a Bac revision 5 years out.
  if (d.getTime() > Date.now() + 5 * 365 * 86_400_000) return bad(`invalid-${opts.field}`);
  return ok(d);
}

/** http/https URL only — blocks javascript:, data:, file: and other injection vectors.
    We embed these in hrefs/iframes (meet, whiteboard, quiz), so the scheme allowlist matters. */
export function vUrl(raw: unknown, opts: { field: string; max?: number }): Valid<string> {
  if (typeof raw !== "string" || !raw.trim()) return bad(`invalid-${opts.field}`);
  const value = raw.trim();
  if (value.length > (opts.max ?? 500)) return bad(`${opts.field}-too-long`);
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return bad(`invalid-${opts.field}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return bad(`invalid-${opts.field}`);
  if (!u.hostname) return bad(`invalid-${opts.field}`);
  return ok(u.toString());
}

/** Optional URL: "" / null / undefined → null; anything present must be a safe URL. */
export function vOptionalUrl(raw: unknown, opts: { field: string; max?: number }): Valid<string | null> {
  if (raw === null || raw === undefined) return ok(null);
  if (typeof raw !== "string" || !raw.trim()) return ok(null);
  const r = vUrl(raw, opts);
  return r.ok ? ok(r.value) : r;
}

/* ---------- Slugs ----------
   `/[slug]` is a ROOT catch-all: tnajem.com/<slug> is a tutor storefront. A tutor
   who grabbed the slug "explore" (or "admin", "api"…) would shadow a real route,
   so every app-level path segment is reserved and can never be claimed. */
export const RESERVED_SLUGS: readonly string[] = [
  "explore", "auth", "admin", "checkout", "dashboard", "onboarding", "student",
  "live", "class", "account", "messages", "api", "terms", "privacy", "_next",
  /* The split signup funnel: /signup/prof and /signup/eleve. Reserved BEFORE the
     routes shipped — the root catch-all would otherwise let a tutor claim
     tnajem.com/signup and shadow the top of the funnel. */
  "signup",
  /* Routes that shipped WITHOUT being reserved. A tutor could claim "tarifs" and
     get a storefront nobody can reach (Next serves the static route first) — and
     since proxy.ts now answers 404 for any unreserved one-segment path that
     is not a tutor, an unreserved route would 404 outright. e2e/not-found.spec.ts
     fails if any folder under app/[locale]/ is missing from this list. */
  "pour-les-profs", "tarifs", "guardian",
  /* Brand names, not routes. "tnajem" would let a tutor impersonate the
     platform at tnajem.com/tnajem; "9arini" is the name we renamed away from and
     is reserved so nobody squats it. */
  "tnajem", "9arini",
];

const SLUG_RE = /^[a-z0-9-]{3,40}$/;

/** lowercase a-z0-9-, 3–40 chars, no leading/trailing/double dash, not reserved. */
export function isValidSlug(raw: string): boolean {
  const s = (raw || "").trim();
  if (!SLUG_RE.test(s)) return false;
  if (s.startsWith("-") || s.endsWith("-") || s.includes("--")) return false;
  if (RESERVED_SLUGS.includes(s)) return false;
  return true;
}

export function vSlug(raw: unknown): Valid<string> {
  if (typeof raw !== "string") return bad("invalid-slug");
  const s = raw.trim().toLowerCase();
  if (!SLUG_RE.test(s) || s.startsWith("-") || s.endsWith("-") || s.includes("--")) return bad("invalid-slug");
  if (RESERVED_SLUGS.includes(s)) return bad("slug-reserved");
  return ok(s);
}

/* ---------- Ids ----------
   Every `classId` / `bookingId` / `tutorId` / doc id an action receives comes
   straight off the wire and lands in `eq(table.id, value)`. Drizzle parameterizes,
   so this is not an injection vector — but those columns are `uuid`, and Postgres
   raises 22P02 ("invalid input syntax for type uuid") on anything malformed. That
   throw escapes the action as an unhandled 500 instead of a clean `not-found`,
   which is both a crash-by-input DoS and an oracle that distinguishes "malformed
   id" from "someone else's id". Validate the shape before it reaches the DB. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(raw: unknown): raw is string {
  return typeof raw === "string" && UUID_RE.test(raw.trim());
}

export function vUuid(raw: unknown, opts: { field: string }): Valid<string> {
  if (typeof raw !== "string") return bad(`invalid-${opts.field}`);
  const v = raw.trim().toLowerCase();
  if (!UUID_RE.test(v)) return bad(`invalid-${opts.field}`);
  return ok(v);
}

/* ---------- File names ----------
   Two jobs, both required:
     • the ON-DISK name — must not escape its folder ("../x", "/etc/x", "C:\x", NUL)
     • the STORED name  — echoed back inside a Content-Disposition header by
       app/api/admin/doc/[id], so it must not carry CR/LF (header injection),
       quotes or semicolons.

   One strict allow-list pass does both: every byte outside [a-zA-Z0-9._-] becomes
   "_", which covers path separators, NUL, CR, LF, quotes and semicolons at once.
   The extension survives (admins recognise files by it). */
export function safeFileName(raw: unknown, max = 80): string {
  if (typeof raw !== "string") return "file";
  const base = raw.split(/[\\/]/).pop() ?? ""; // drop any directory component first
  const cleaned = base
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^\.+/, "") // no leading dots ("..", ".htaccess")
    .slice(0, max);
  return cleaned || "file";
}

/** Star rating: integer 1–5. */
export function vRating(raw: unknown): Valid<number> {
  return vInt(raw, { field: "rating", min: 1, max: 5 });
}

/* ---------- Age / minor-consent ----------
   A student's birth year is self-reported at signup and used for ONE thing: to
   decide whether guardian consent (INPDP / Loi 2004-63) is required before booking.
   Under-18 (or unknown age) needs it; adults don't. Everything here fails SAFE —
   an absent, malformed or out-of-range value collapses to null, which the consent
   gate treats as "minor" (consent required). It can never wave a real minor through. */

/** Parse a self-reported birth year → the year, or null if absent/implausible.
    Range: a ~4-year-old pupil up to a ~100-year-old — anything else is null. */
export function vBirthYear(raw: unknown, now: Date = new Date()): number | null {
  const y = typeof raw === "string" ? Number(raw.trim()) : raw;
  if (typeof y !== "number" || !Number.isFinite(y) || !Number.isInteger(y)) return null;
  const current = now.getFullYear();
  if (y > current - 4 || y < current - 100) return null;
  return y;
}

/** True when a birth year makes a student a minor (< 18) OR is unknown (null).
    Unknown → true (fail safe: consent required). Adults (>= 18) → false. */
export function isMinorBirthYear(birthYear: number | null | undefined, now: Date = new Date()): boolean {
  if (birthYear == null) return true;
  return now.getFullYear() - birthYear < MINOR_AGE_YEARS; // ./legal, LEGAL-REVIEW
}

/* ---------- Email (the login identity) ----------
   normalizeEmail() lives in lib/auth.ts next to normalizePhone; the VALIDITY check
   lives here because both sides need it — the server actions and the client-side
   form. lib/auth.ts is "server-only", so a client component could never import from
   it, which is precisely how the duplicated safeNext() got started. */
/* Is this a plausible email address?

   Deliberately permissive. RFC 5321 allows far more than people expect, so a
   strict pattern mostly succeeds at rejecting addresses that genuinely deliver —
   and the real proof of ownership is the code we are about to send, not this
   function. What it DOES enforce is the part that matters downstream: a bounded
   length (the value reaches Postgres and an outbound HTTP body), no whitespace,
   exactly one "@", and a dotted domain.

   Spelled out rather than written as one escaped regex: this is the check the
   whole login funnel rests on, and it should be readable at a glance. */
export function isValidEmail(e: string): boolean {
  /* Validates EXACTLY what it is given — it does not trim, exactly like
     isValidPhone below. Normalise first (normalizeEmail in lib/auth.ts), then
     validate, then use the normalised value. A validator that quietly cleans its
     input will happily approve a string its caller then sends verbatim. */
  if (!e || e.length > 254) return false;
  /* No whitespace and no control characters. Same codepoint walk safeNext() uses
     below, and for the same reason: this string is interpolated into an outbound
     mail request, where a stray CR/LF is header injection. 0x20 is the space. */
  for (const ch of e) {
    const c = ch.codePointAt(0) ?? 0;
    if (c <= 0x20 || c === 0x7f) return false;
  }
  const at = e.indexOf("@");
  if (at <= 0 || at !== e.lastIndexOf("@")) return false;   // needs exactly one, not leading
  const domain = e.slice(at + 1);
  if (!domain || domain.length > 253) return false;
  if (!domain.includes(".")) return false;                  // bare hostnames are not deliverable
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) return false;
  return true;
}

/** The Valid<T> wrapper, for actions that map failures onto ActionResult. */
export function vEmail(raw: unknown): Valid<string> {
  if (typeof raw !== "string") return bad("invalid-email");
  const value = raw.trim().toLowerCase();
  return isValidEmail(value) ? ok(value) : bad("invalid-email");
}

/** Loose phone check (normalization itself lives in lib/auth.ts). */
export function vPhone(raw: unknown): Valid<string> {
  if (typeof raw !== "string") return bad("invalid-phone");
  const value = raw.trim();
  const digits = value.replace(/\D/g, "").length;
  if (digits < 8 || digits > 15) return bad("invalid-phone");
  return ok(value);
}

/** Optional phone: "" / null / undefined → null; anything present must be valid.
    Since email became the login identity, the phone is a CONTACT field collected
    during onboarding — a student or tutor may legitimately not give one, but a
    half-typed number must still be rejected rather than stored. Mirrors the
    vOptionalText / vOptionalUrl pair above. */
export function vOptionalPhone(raw: unknown): Valid<string | null> {
  if (raw === null || raw === undefined) return ok(null);
  if (typeof raw !== "string" || !raw.trim()) return ok(null);
  const r = vPhone(raw);
  return r.ok ? ok(r.value) : r;
}

/* Open-redirect guard for ?next=. Lives here, not in the auth component, because
   BOTH sides need it: app/[locale]/auth/page.tsx (server) sanitises the query
   string and components/auth/AuthInner.tsx (client) consumes the result. A
   function exported from a "use client" module is replaced by a client REFERENCE
   when a server component imports it — calling it server-side throws
   "is not a function" — so the sanitiser has to sit in a plain module.
   proxy.ts and /live bounce guests here with ?next=<path> (e.g. /live/abc,
   /checkout?class=x). That value is attacker-controllable, so we only ever follow
   it when it is a *relative, same-origin* path:
     • must start with a single "/"
     • "//evil.tn" and "/\evil.tn" are protocol-relative → rejected
     • any backslash, control char, or "scheme:" prefix → rejected
     • "/auth..." → rejected (would loop back into this page)
   Anything suspicious falls through to the normal role-based destination. */
export function safeNext(raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (!v.startsWith("/")) return null;                 // absolute URL or bare word
  if (v.startsWith("//") || v.startsWith("/\\")) return null; // protocol-relative
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(v)) return null;   // "/javascript:…" & friends
  if (v.includes("\\")) return null;                   // "/\evil.tn", backslash tricks
  for (const ch of v) {                                // control chars (CR/LF header smuggling)
    const c = ch.codePointAt(0) ?? 0;
    if (c < 0x20 || c === 0x7f) return null;
  }
  if (v === "/auth" || v.startsWith("/auth/") || v.startsWith("/auth?")) return null;
  return v;
}

/* ── Identity normalisers ────────────────────────────────────────────────────
   Moved here from lib/auth.ts (which is `server-only`) so the admin allowlist —
   which must be importable by Fastify, by the web app, and by a plain unit test —
   can reach all four of these from one pure module. Behaviour is unchanged;
   lib/auth.ts re-exports them so no call site moved. */

/** Sibling of normalizePhone(). Lower-cased so "Sam@X.com" and "sam@x.com" are one
    account — the unique index on profiles.email is case-SENSITIVE, so without this
    the same person could sign up twice. */
export function normalizeEmail(raw: string): string {
  return (raw || "").trim().toLowerCase();
}

export function normalizePhone(raw: string): string {
  let p = (raw || "").replace(/[^\d+]/g, "");
  if (p.startsWith("00")) p = "+" + p.slice(2);
  if (!p.startsWith("+")) p = "+216" + p.replace(/^0+/, ""); // default Tunisia
  return p;
}

export function isValidPhone(p: string): boolean {
  const digits = p.replace(/\D/g, "").length;
  return digits >= 8 && digits <= 15; // E.164 upper bound
}

/* ── Public display helpers ──────────────────────────────────────────────────
   Moved here so apps/api and apps/web cannot drift. publicName in particular is
   a security boundary, not formatting: it is what keeps a reviewer's full name
   off a public, unauthenticated page. Step 8 tightens it to first-name-only. */

/* publicName ("Amine K.") WAS HERE. Step 8 replaced it with publicDisplayName in
   ./public-profile.ts, which returns the first name alone.

   Deleted rather than deprecated. Leaving it would mean two "safe public name"
   functions with different answers, and the next person to need one would pick
   whichever they found first — which is precisely how the admin allow-list ended
   up tested in one place and running in another. */

/** Two-letter monogram for the avatar. No photo exists yet (see Step 13). */
export function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase() || "?";
}

/* MONTHS_FR moved to ./time.ts (with the Arabic labels and every Tunis-time
   formatter); the barrel still exports it. */
