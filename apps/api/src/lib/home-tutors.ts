import {
  and, asc, desc, eq, inArray, isNull, sql as raw,
  classes, reviews, tutorOffers, tutors,
} from "@tnajem/db";
import {
  initials,
  publicTutorName,
  sortLevels,
  subjectCodeFrom,
  displaySubject,
  SUBJECT_LABELS,
  HOME_TUTORS_MAX,
  HOME_RATING_MIN_REVIEWS,
  type HomeTutor,
} from "@tnajem/shared";
import { db } from "../db";
import { listedOnSaleClassSql } from "./class-listed"; // december-sprint · E (D18)

/* home v2 · B — THE HOME PAGE'S « real tutors » CARD (GET /tutors/home).

   ANONYMOUS BY CONSTRUCTION, like every read in routes/tutors.ts: it feeds the
   ISR-cached home page, so the answer is the same for every visitor on Earth.

   ── WHO IS SHOWN ──────────────────────────────────────────────────────────────
   publicTutorSql — the very predicate GET /tutors/explore filters on (verified,
   not suspended, not a test account). One constant, so the two lists cannot drift apart. An erased
   tutor is suspended by the erasure (0022), so it is out too.

   ── IN WHAT ORDER ─────────────────────────────────────────────────────────────
   Most recently verified first (reviewed_at, then created_at, then id so equal
   timestamps still give one order). Not explore's order, on purpose:
     • explore puts PAID placement first, and discloses it with a « Mis en avant »
       mark on the card. /tarifs sells that placement for Explorer — not for the
       home page — and a paid row here without the mark would be an undisclosed ad.
     • explore then sorts by rating. The home card does not claim « bien notés »
       (HOME_V2 honesty rule 2), and a pilot with almost no reviews would just let
       one early 5★ hold the page forever.
   Newest-verified rotates the card as tutors join, needs no number we cannot back,
   and is stable between two verifications.

   ── THE PRICE ─────────────────────────────────────────────────────────────────
   The cheapest class still ON SALE (onSaleClassSql — the rule /explore's « à partir
   de » and the storefront use), per session. With no class on sale: the cheapest
   ACTIVE monthly offer (tutor_offers, the « S'abonner — X TND / mois » block of the
   storefront), per MONTH. Never offer ÷ sessions: that would be a per-session price
   the tutor never wrote. A 0 is not a price either (a free-first class keeps its
   then-price in price_tnd). Promotions are left out: the listed price is the one
   the tutor set, and the storefront shows any reduction next to it.

   ── THE REVIEWS ───────────────────────────────────────────────────────────────
   Straight from the reviews table (tutors.rating is a cached mirror), and only from
   HOME_RATING_MIN_REVIEWS on — below that neither the count nor the average leaves
   this function. */

/** Verified, not suspended, not a test account: who is LISTED. Shared with GET
    /tutors/explore (and its search), GET /tutors/public-refs (the sitemap) and this
    card. december-sprint · A (D11): a test account (tutors.is_test, 0043, set from
    /admin/accounts) is absent from every list, while its storefront and class
    pages stay reachable by direct link — with robots noindex — so live tests on
    production stay possible. */
export const publicTutorSql = and(eq(tutors.status, "verified"), isNull(tutors.suspendedAt), eq(tutors.isTest, false));

/** The approved photo, through the web's pass-through (app/api/avatar/[slug]/[size]).
    md is 160px: sharp at the card's 44px on any screen. */
export const homeAvatarPath = (slug: string) => `/api/avatar/${encodeURIComponent(slug)}/md`;

export async function getHomeTutors(opts: { restrictTo?: string[] } = {}): Promise<HomeTutor[]> {
  /* restrictTo: tests only (the route never passes it). Route tests share one
     database with every other test file running in parallel, so "the card with
     0 / 1 tutors" can only be proved over a known set of rows. It narrows the
     public predicate; it can never widen it. */
  if (opts.restrictTo && opts.restrictTo.length === 0) return [];
  const where = opts.restrictTo ? and(publicTutorSql, inArray(tutors.id, opts.restrictTo)) : publicTutorSql;

  const rows = await db
    .select({
      id: tutors.id,
      slug: tutors.slug,
      fullName: tutors.fullName,
      subject: tutors.subject,
      levels: tutors.levels,
      avatarPath: tutors.avatarPath,
      avatarStatus: tutors.avatarStatus,
    })
    .from(tutors)
    .where(where)
    .orderBy(raw`${tutors.reviewedAt} desc nulls last`, desc(tutors.createdAt), asc(tutors.id))
    .limit(HOME_TUTORS_MAX);
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const [revAgg, classAgg, offerAgg] = await Promise.all([
    db
      .select({
        tutorId: reviews.tutorId,
        avg: raw<string | null>`avg(${reviews.rating})`,
        n: raw<number>`count(*)::int`,
      })
      .from(reviews)
      .where(inArray(reviews.tutorId, ids))
      .groupBy(reviews.tutorId),
    db
      .select({ tutorId: classes.tutorId, min: raw<string | null>`min(${classes.priceTnd})` })
      .from(classes)
      .where(and(inArray(classes.tutorId, ids), listedOnSaleClassSql, raw`${classes.priceTnd} > 0`)) // december-sprint · E (D18): listed classes only
      .groupBy(classes.tutorId),
    db
      .select({ tutorId: tutorOffers.tutorId, min: raw<string | null>`min(${tutorOffers.priceTndPerMonth})` })
      .from(tutorOffers)
      .where(and(
        inArray(tutorOffers.tutorId, ids),
        eq(tutorOffers.active, true),
        isNull(tutorOffers.archivedAt),
        raw`${tutorOffers.priceTndPerMonth} > 0`,
      ))
      .groupBy(tutorOffers.tutorId),
  ]);
  const revBy = new Map(revAgg.map((r) => [r.tutorId, r]));
  const classBy = new Map(classAgg.map((r) => [r.tutorId, r.min]));
  const offerBy = new Map(offerAgg.map((r) => [r.tutorId, r.min]));

  return rows.map((t): HomeTutor => {
    const name = publicTutorName(t.fullName) ?? "";
    const code = subjectCodeFrom(t.subject);
    const classMin = classBy.get(t.id);
    const offerMin = offerBy.get(t.id);
    const price: HomeTutor["price"] =
      classMin != null ? { tnd: Number(classMin), per: "session" }
      : offerMin != null ? { tnd: Number(offerMin), per: "month" }
      : null;
    const rev = revBy.get(t.id);
    const count = rev?.n ?? 0;
    return {
      slug: t.slug,
      name,
      initials: initials(name),
      subject: code
        ? { code, fr: SUBJECT_LABELS[code].fr, ar: SUBJECT_LABELS[code].ar }
        : { code: null, fr: displaySubject(t.subject, "fr"), ar: displaySubject(t.subject, "ar") },
      levels: sortLevels(t.levels),
      // APPROVED only — the storefront's has_photo rule. Pending/rejected = initials.
      avatar_url: t.avatarStatus === "approved" && t.avatarPath ? homeAvatarPath(t.slug) : null,
      price,
      ...(count >= HOME_RATING_MIN_REVIEWS && rev?.avg
        ? { reviews: { average: Math.round(Number(rev.avg) * 10) / 10, count } }
        : {}),
    };
  });
}
