import { and, asc, eq, classes as classesT, packs as packsT, tutors } from "@tnajem/db";
import {
  initials,
  publicTutorName, // phase-a lane L2 (A23)
  classWhen,
  isEffectivelyFreeFirst,
  levelsLabel, sortLevels, isLevelCode, // phase-a lane L5 (A18.7)
  type Storefront,
  type Tutor,
  type ClassItem,
  type Pack,
  type TutorVerifStatus, // espace prof v2 · shell
  type TutorVisibility, // espace prof v2 · shell
} from "@tnajem/shared";
import { db } from "../db";
import { onSaleClassSql } from "./class-sale";
import { storefrontGrowthExtras } from "./storefront-growth"; // espace prof v2 · growth (P5)

/* The public storefront read, ported from apps/web/lib/data.ts::getStorefront.

   ANONYMOUS BY CONSTRUCTION. This feeds an ISR-cached page, so it must never
   depend on who is asking. If it ever needs to, that belongs on a separate
   authenticated endpoint — see the header of routes/tutors.ts.

   The demo-fallback branch did NOT move. It exists so `next build` and the
   ui-audit harness work without a database, and it throws in production rather
   than fabricating a tutor (lib/data.ts::DatabaseNotConfiguredError). apps/api
   asserts DATABASE_URL at boot, so it has no equivalent situation. */

export async function getStorefrontData(slug: string): Promise<Storefront | null> {
  const [t] = await db.select().from(tutors).where(eq(tutors.slug, slug)).limit(1);
  if (!t) return null;
  if (t.status !== "verified") return null; // pending/unverified tutors aren't public
  if (t.suspendedAt) return null; // A blocked account's storefront is suspended (0019): off every public read.
  return buildStorefront(t);
}

/* espace prof v2 · shell — WHAT /{slug} SHOWS, for the middleware and the page.
   "public" is exactly getStorefrontData's rule. "coming-soon" is a tutor who exists
   and is on the way (draft: not submitted yet · pending: under review) — the page
   says « Ce prof arrive bientôt » instead of a bare 404. A rejected, suspended or
   erased tutor stays "missing": we have decided against them, or they are gone, and
   announcing them as on the way would be untrue. Anonymous by construction. */
export async function tutorVisibility(slug: string): Promise<TutorVisibility> {
  const [t] = await db
    .select({ status: tutors.status, suspendedAt: tutors.suspendedAt, erasedAt: tutors.erasedAt })
    .from(tutors)
    .where(eq(tutors.slug, slug))
    .limit(1);
  if (!t || t.suspendedAt || t.erasedAt) return "missing";
  if (t.status === "verified") return "public";
  return t.status === "draft" || t.status === "pending" ? "coming-soon" : "missing";
}

/* espace prof v2 · shell — THE OWNER PREVIEW: the caller's own page, built exactly
   as the public one, whatever its status. SESSION-BOUND (the profile id comes from
   the session, never from the request), so it can never feed a cached page. The one
   difference: the owner also sees their own photo while it waits for review — the
   avatar route already serves it to them alone. */
export async function getOwnerPreviewData(
  profileId: string,
): Promise<{ storefront: Storefront; status: TutorVerifStatus; suspended: boolean } | null> {
  const [t] = await db.select().from(tutors).where(eq(tutors.profileId, profileId)).limit(1);
  if (!t) return null;
  const storefront = await buildStorefront(t);
  storefront.tutor.has_photo = Boolean(t.avatarPath) && t.avatarStatus !== "rejected";
  return { storefront, status: t.status, suspended: Boolean(t.suspendedAt) };
}

async function buildStorefront(t: typeof tutors.$inferSelect): Promise<Storefront> {
  /* Only classes still on sale, soonest first — the storefront's "Prochaine
     séance" is the first bookable row of this list, so the order is the product. */
  const cls = await db
    .select()
    .from(classesT)
    .where(and(eq(classesT.tutorId, t.id), onSaleClassSql))
    .orderBy(asc(classesT.scheduledAt));
  const pks = await db.select().from(packsT).where(eq(packsT.tutorId, t.id));

  /* phase-a lane L2 (A23) — D1: the public page names the tutor "Mohamed B.". The
     full name never leaves this function; `full_name` keeps its key for the web. */
  const shownName = publicTutorName(t.fullName) ?? "";

  const tutor: Tutor = {
    id: t.id,
    slug: t.slug,
    full_name: shownName,
    subject: t.subject,
    // phase-a lane L5 (A18.7): no more "Bac" fallback — the levels the tutor chose, and their FR labels.
    level: levelsLabel(t.levels, "fr"),
    levels: sortLevels(t.levels),
    bio: t.bio ?? "",
    avatar_initials: initials(shownName),
    rating: Number(t.rating ?? 0),
    students_count: t.studentsCount ?? 0,
    verified: Boolean(t.verified),
    offers_free_first_session: t.offersFreeFirstSession,
    /* APPROVED only. A pending photo is unreviewed — it could be anything — and
       this payload feeds an ISR-cached public page. */
    has_photo: t.avatarStatus === "approved" && Boolean(t.avatarPath),
  };

  const mapClass = (c: (typeof cls)[number]): ClassItem => {
    const d = new Date(c.scheduledAt);
    return {
      id: c.id,
      tutor_id: t.id,
      tutor_name: shownName, // phase-a lane L2 (A23)
      title: c.title,
      description: c.description ?? undefined,
      // starts_at + day/month/time, all in Tunis — never this process's timezone.
      ...classWhen(d),
      duration_min: c.durationMin ?? 90,
      price_tnd: Number(c.priceTnd),
      seats: c.seats ?? 0,
      seats_left: Math.max(0, (c.seats ?? 0) - (c.seatsTaken ?? 0)),
      // EFFECTIVE. The tutor's opt-in is the master switch — see isEffectivelyFreeFirst.
      is_free_first: isEffectivelyFreeFirst(t.offersFreeFirstSession, c.isFreeFirst),
      /* NO ROOM LINKS. This payload is anonymous and feeds an ISR-cached public
         page; it used to carry the tutor's own meet/whiteboard/quiz/replay URLs to
         anyone who opened the storefront. They ship only from GET /classes/:id and
         /classes/:id/join, to the owning tutor or a student with a live booking. */
      status: c.status ?? "scheduled",
      level: isLevelCode(c.level) ? c.level : null, // phase-a lane L5 (A18.7)
    };
  };

  const mapPack = (p: (typeof pks)[number]): Pack => ({
    id: p.id,
    tutor_id: t.id,
    title: p.title,
    meta: p.description ?? "",
    price_tnd: Number(p.priceTnd),
  });

  // espace prof v2 · growth (P5): the monthly offers and the live PUBLIC promotions — anonymous too.
  const { offers, promotions } = await storefrontGrowthExtras(t.id);
  return { tutor, classes: cls.map(mapClass), packs: pks.map(mapPack), offers, promotions };
}
