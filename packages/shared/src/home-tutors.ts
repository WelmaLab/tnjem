/* THE HOME PAGE'S « real tutors » CARD — home v2 · B. Pure, client-safe, in the barrel.

   GET /tutors/home (apps/api/src/routes/tutors.ts) answers up to HOME_TUTORS_MAX
   of these, anonymous and ISR-cached by the web (apps/web/lib/home-tutors.ts).
   Every field is something the tutor's own public page already shows — nothing
   more:
     • the public name (« Mohamed B. », publicTutorName) — never the surname;
     • no e-mail, no phone, no profile id, no bio;
     • the photo only when a human APPROVED it (the same rule as the storefront);
     • a price only when one is real: the cheapest class still on sale, else the
       cheapest active monthly offer — each with ITS OWN unit, never divided;
     • the reviews only from HOME_RATING_MIN_REVIEWS on. Below that both the
       count and the average are ABSENT (the key is not sent), so a renderer has
       nothing to show by mistake. */
import type { LevelCode } from "./levels";
import type { SubjectCode } from "./subjects";

/** At most this many rows on the card. */
export const HOME_TUTORS_MAX = 3;

/** Reviews are shown on the home card from this many on — one or two reviews are
    not a rating anyone should read as « bien noté ». */
export const HOME_RATING_MIN_REVIEWS = 3;

export type HomeTutor = {
  slug: string;
  /** publicTutorName — « Mohamed B. ». */
  name: string;
  /** Two letters for the monogram, from the public name. */
  initials: string;
  /** code: the canonical subject when the tutor's free text maps to one, else null —
      and then fr/ar are both the tutor's own text. */
  subject: { code: SubjectCode | null; fr: string; ar: string };
  /** The levels the tutor chose, in ladder order. May be empty — never a default. */
  levels: LevelCode[];
  /** A path on the WEB origin (/api/avatar/<slug>/<size>) — only for an approved photo. */
  avatar_url: string | null;
  /** "session": the cheapest class still on sale. "month": no class on sale, the
      cheapest active monthly offer. null: neither — the card shows no price. */
  price: { tnd: number; per: "session" | "month" } | null;
  /** Present only when count >= HOME_RATING_MIN_REVIEWS. */
  reviews?: { average: number; count: number };
};
