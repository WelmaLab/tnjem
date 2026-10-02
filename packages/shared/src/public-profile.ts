/* ZERO CONTACT EXCHANGE — the allow-list.

   ══════════════════════════════════════════════════════════════════════════════
   ALLOW-LIST, NEVER A DENY-LIST. This is the whole design.
   ══════════════════════════════════════════════════════════════════════════════
   A deny-list ("strip phone and email before sending") fails the day someone adds
   a column. The new field ships to the counterparty by default and nobody
   notices, because nothing broke — that is how `studentPhone` and `studentEmail`
   ended up rendered as a `tel:` link and a `mailto:` link with the address as the
   visible label on the tutor dashboard.

   These functions BUILD a new object from named fields. A column added to
   `profiles` tomorrow is invisible here until someone deliberately adds it, and
   adding it means editing a file whose entire purpose is this rule.

   ── WHAT A COUNTERPARTY MAY SEE ──────────────────────────────────────────────
   A tutor looking at who booked, and a student looking at a tutor, get:

       a display name, and nothing else that could reach the person off-platform.

   Which display name (decision D1, 23 Sept 2026 — phase-a lane L2, A23):
     • a STUDENT, as a tutor sees them: first name only — publicDisplayName().
     • a TUTOR, as students, guardians and the public see them: first name +
       initial, "Sami B." — publicTutorName(). Every student-facing surface
       (storefront, Explore and search, checkout, class page, student dashboard,
       notifications, the link preview and JSON-LD) goes through it, and it is
       applied ON THE API: the last name is never sent to those endpoints at all.
       Messaging and the guardian space show the tutor's first name only, which
       is stricter and stays. The tutor sees their own full name; admins see it too.

   Not the phone. Not the email. Not an address, not a city, not a social handle.
   Guardian contact is NOT an exception: a parent's number is a contact detail
   like any other, and Step 14 gives guardians real accounts rather than a bridge.

   ── WHAT THIS DOES NOT DO ────────────────────────────────────────────────────
   It does not stop a tutor reading a phone number aloud on Jitsi, and it is not
   meant to. The goal is to move contact exchange off the default path and make it
   a deliberate, visible act. detectContactInfo() in ./contact-info.ts handles the
   text channels; this file handles the structured fields.

   ── SELF IS NOT A COUNTERPARTY ───────────────────────────────────────────────
   None of this applies to a user's own data. GET /me and
   /profile/student/prefill return the caller's own phone and email, and must:
   you cannot edit a number you cannot see. The rule is about what one user sees
   of ANOTHER. */

import { displayName } from "./display"; // live-fixes-1 · C2

/** A person as a counterparty may see them. Deliberately tiny. */
export type PublicProfile = {
  /** First name only. See publicDisplayName. */
  name: string | null;
  /** Monogram for the avatar. Derived from the same trimmed name. */
  initials: string;
};

/** "Amine Karoui" -> "Amine". FIRST NAME ONLY.

    Tightened from publicName's "Amine K." — a surname initial plus a subject and
    a city narrows a person a long way in a country of twelve million, and it buys
    the reader nothing a first name does not.

    A single-word name is returned as-is; a name that is only whitespace or
    punctuation returns null rather than an empty string, so a caller cannot
    render an anonymous blank and think it is a name. */
export function publicDisplayName(full: string | null | undefined): string | null {
  if (!full) return null;
  const first = full.trim().split(/\s+/)[0] ?? "";
  /* Strip characters that are not part of a name. Someone whose display name is
     "Amine +21620123456" would otherwise pass the first token through untouched
     the moment they put the number first. */
  const cleaned = first.replace(/[^\p{L}\p{M}'’-]/gu, "").trim();
  /* live-fixes-1 · C2: capitalised FOR DISPLAY (« walid » → « Walid »); the stored
     name is untouched. publicTutorName and publicInitials build on this. */
  return cleaned.length > 0 ? displayName(cleaned) : null;
}

/** "Mohamed Ben Ali" -> "Mohamed B." — a TUTOR as a student sees them (D1).

    Call it with the full name, or with (first, last). The first token is the
    first name, cleaned exactly as publicDisplayName cleans it (so a number glued
    to it never passes); the initial is the first LETTER of everything after it.
    A single-word name is returned as-is, an empty one as null. Idempotent —
    "Mohamed B." gives "Mohamed B." — so masking twice is harmless.
    phase-a lane L2 (A23). */
export function publicTutorName(first: string | null | undefined, last?: string | null): string | null {
  const whole = last === undefined ? (first ?? "") : `${first ?? ""} ${last ?? ""}`;
  const [head = "", ...rest] = whole.trim().split(/\s+/);
  const name = publicDisplayName(head);
  if (!name) return null;
  const initial = rest.join(" ").match(/\p{L}/u)?.[0];
  return initial ? `${name} ${initial.toLocaleUpperCase("fr")}.` : name;
}

/** Two-letter monogram, from the FIRST name only — never the surname, which
    would leak the initial publicDisplayName just removed. */
export function publicInitials(full: string | null | undefined): string {
  const name = publicDisplayName(full);
  if (!name) return "?";
  const chars = [...name];
  return ((chars[0] ?? "") + (chars[1] ?? "")).toUpperCase();
}

/** Build the counterparty view. Pass the whole row; only these fields escape. */
export function publicProfile(row: { fullName?: string | null } | null | undefined): PublicProfile {
  const name = publicDisplayName(row?.fullName ?? null);
  return { name, initials: publicInitials(row?.fullName ?? null) };
}

/* ── The guard, for tests and for anything that serialises a counterparty ──────

   A cheap structural check that a payload carries no contact-shaped field. It is
   NOT the enforcement — publicProfile() is — but it is what lets a test assert
   "this whole response contains nothing that could reach the person", including
   fields added after the test was written.

   Names are matched, not values: a value scan would flag a class titled
   "Exercice 24" or a bio mentioning "Bac 2025". Detecting contact info inside
   free TEXT is a different problem with different false positives, and it lives
   in ./contact-info.ts. */
const CONTACT_FIELD = /(phone|tel|mobile|whatsapp|email|mail|address|adresse|city|ville|governorate|postal|zip|handle|instagram|facebook|tiktok|telegram|snapchat)/i;

/** Every contact-shaped KEY path found anywhere in `value`. Empty means clean. */
export function contactFieldPaths(value: unknown, path = ""): string[] {
  if (value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => contactFieldPaths(v, `${path}[${i}]`));
  }
  const out: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const here = path ? `${path}.${k}` : k;
    /* A key only counts when it actually CARRIES something. A nulled-out
       `studentPhone: null` is the shape of a field that was closed properly, and
       failing on it would push people to delete the key and lose that signal. */
    if (CONTACT_FIELD.test(k) && v !== null && v !== undefined && v !== "") out.push(here);
    out.push(...contactFieldPaths(v, here));
  }
  return out;
}
