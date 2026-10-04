import { isOpenForBooking, type ClassStatus } from "./class-time"; // phase-a lane L3 (A5)

/* THE FREE FIRST SESSION — one rule, one place.

   The policy: a free first session is OPT-IN, per tutor, and OFF by default.
   Before this existed the platform promised one on behalf of every tutor who
   never touched a checkbox, on ~30 screens, in the JSON-LD Offer, in the meta
   description and in llms.txt — a claim about money that no tutor made.

   The rule is an AND of two columns, and it lives here rather than being written
   out at each call site for the reason this project has now hit three separate
   times: two implementations of one rule that nothing forces to agree. A
   storefront that ANDs and a booking endpoint that does not is the difference
   between a page that says "free" and a charge that isn't. */

/** The effective answer for one class. Both halves must say yes.

    `tutorOptsIn` is the master switch — a policy the tutor set once.
    `classIsFree` is the per-listing detail, so a tutor who opts in can still run
    a paid intensive.

    Deliberately takes `boolean | null | undefined` on both sides: rows written
    before 0008 could be null, and a null must read as NO. Anything else would
    make "never set" mean "promised". */
export function isEffectivelyFreeFirst(
  tutorOptsIn: boolean | null | undefined,
  classIsFree: boolean | null | undefined,
): boolean {
  return tutorOptsIn === true && classIsFree === true;
}

/* ── ONCE PER STUDENT PER TUTOR (D2, phase-a lane L3 · A6) ─────────────────

   isEffectivelyFreeFirst says whether a CLASS offers the free first session. A
   BOOKING is free only if, in addition, the student has not already had it with
   this tutor: no other free booking with them that is still live, and no free
   seat of theirs that they cancelled late themselves. POST /bookings evaluates
   that inside the seat-claim transaction, under a (student, tutor) advisory lock,
   so two simultaneous bookings cannot both take it.

   It COMES BACK when the tutor cancels (the student did not choose that), when
   the student cancels 48h or more before, when the platform releases the seat
   (block, consent withdrawal), and when a late cancel is waived because the
   tutor moved the class, and (live-fixes-3 · C) when the student cancels within the
   15-minute grace after booking. It is SPENT only by the student's own late,
   un-waived cancellation of a free seat outside that grace — the one case the 40%
   rule would apply to. The
   ledger row carries FREE_FIRST_SPENT_REASON so the booking path can see it:
   bookings.is_free is overwritten when a cancelled row is re-booked, the ledger
   is not. */
export const FREE_FIRST_SPENT_REASON = "free-first-spent";

/** Does this cancellation spend the student's free first session with the tutor? */
export function cancelSpendsFreeFirst(input: {
  actor: "student" | "tutor" | "system";
  wasFree: boolean | null | undefined;
  late: boolean;
  waived: boolean;
  /** live-fixes-3 · C: inside the 15-minute grace after booking (CancellationOutcome.grace). */
  grace?: boolean;
}): boolean {
  return input.actor === "student" && input.wasFree === true && input.late && !input.waived && !input.grace;
}

/** Does this tutor advertise a free first session AT ALL?

    Separate from the per-class question because tutor-level surfaces — the
    storefront badge, the JSON-LD Offer, the profile meta description — render
    for tutors with no published class, and used to make the claim anyway. */
export function tutorOffersFreeFirst(tutorOptsIn: boolean | null | undefined): boolean {
  return tutorOptsIn === true;
}

/* phase-a lane L3 (A5) — may the storefront's LINK PREVIEW (the WhatsApp card,
   the Google snippet) promise a free first session?

   Only when the promise can be kept by tapping the link: the tutor's toggle is on
   AND at least one class still open for booking is a free first session. It used
   to follow the toggle alone, so a tutor with only paid classes — or none — was
   advertised to every stranger as "1ère séance offerte". */
export function advertisesFreeFirst(
  tutorOptsIn: boolean | null | undefined,
  classes: readonly { is_free_first: boolean | null | undefined; starts_at: string; status?: ClassStatus }[],
): boolean {
  return (
    tutorOffersFreeFirst(tutorOptsIn) &&
    classes.some((c) => isOpenForBooking(c) && isEffectivelyFreeFirst(tutorOptsIn, c.is_free_first))
  );
}

/* ── A free first session promised in FREE TEXT ─────────────────────────────

   The badge follows the toggle; a bio does not. A tutor who writes "1ère séance
   offerte" in their bio and leaves the option off advertises a session the
   booking flow will charge for (the demo bio did exactly that). It is their text,
   so the product WARNS rather than blocks — this only has to recognise the claim.

   Matched after folding case, accents and Arabic letter variants, in the three
   ways tutors actually write: French, Derija in Latin letters, Arabic script.
   "first" and "free" may sit a few words apart ("le premier cours est gratuit",
   "الحصة الأولى تكون مجانية"). */
const FIRST = "(?:1ere|1re|1er|1st|premiere|premier|awel|awwel|ewel|lowla|louwla|loula|lawla|اول|الاول|اولي|الاولي)";
const SESSION = "(?:seance|seances|cours|lecon|heure|ders|se9a|7essa|hessa|hissa|حصه|الحصه|درس|الدرس)";
const FREE = "(?:offerte?s?|gratuite?s?|gratis|free|b?bi?le?[sc]h|blech|fabor|fabour|mjenni|majjani|majeni|مجانيه|مجاني|مجانا|بلاش|ببلاش|فابور)";
const GAP = "(?:\\s+\\S+){0,3}\\s+";
const FREE_FIRST_PATTERNS = [
  new RegExp(`(?:^|\\s)${FIRST}\\s+(?:\\S+\\s+)?${SESSION}${GAP}${FREE}(?=\\s|$)`), // 1ère séance offerte · awel séance bilech · أول حصة مجانية
  new RegExp(`(?:^|\\s)${SESSION}\\s+${FIRST}${GAP}${FREE}(?=\\s|$)`), //               الحصة الأولى مجانية · el 7essa lowla fabor
  new RegExp(`(?:^|\\s)${SESSION}\\s+d?\\s?essai\\s+${FREE}(?=\\s|$)`), //               séance d'essai gratuite
  new RegExp(`(?:^|\\s)essai\\s+${FREE}(?=\\s|$)`), //                                   essai gratuit
];

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ًͯ-ٰٟ]/g, "") // Latin accents, Arabic harakat
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[’'`ʳᵉ]/g, (ch) => (ch === "ʳ" ? "r" : ch === "ᵉ" ? "e" : " "))
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Does this text promise a free first session? For a warning, not a block. */
export function mentionsFreeFirstSession(text: string | null | undefined): boolean {
  if (!text) return false;
  const folded = fold(text);
  return FREE_FIRST_PATTERNS.some((re) => re.test(folded));
}
