import { and, eq, inArray, sql as raw, bookings, classes, tutors } from "@tnajem/db";
import { db } from "../db";

/* WHO MAY OPEN A MATERIAL — THE ONE RULE (student-space-v1 · pages, contract C6).

   It lived inside routes/materials.ts as canRead(), used by the file endpoint and
   the storefront list. « Mes fiches », its counts and the fiches of a class detail
   now list materials too, and a list that decides on its own is a list that
   eventually shows a fiche the file endpoint then refuses (or hides one it would
   serve). So the decision is HERE, once, and every caller asks it:

     GET /materials/:id/file          canRead(material, uid)
     GET /tutors/:slug/materials      canRead(material, uid)
     GET /student/fiches (+ counts,   materialAccessContext(uid) once, then
         Accueil, Mes profs, a class)   canReadWith(material, ctx) per row

   canRead() IS canReadWith() over a context loaded for that one material: the two
   paths cannot disagree, because there is only one predicate.

     removed   nobody (an upheld takedown or a tutor's « Retirer »)
     public    anyone, signed in or not
     students  the tutor, plus a student with a LIVE booking (not a cancelled one)
               on one of their classes — on THAT class when the material is
               attached to one (« Élèves de cette séance »), on any of their
               classes when it is not (« Tous mes élèves »)
     private   the tutor alone

   Cancelled bookings do not count — giving up the seat gives up the materials with
   it, which is the same rule messaging follows. */

export type MaterialAccessRow = {
  tutorId: string;
  visibility: string;
  classId?: string | null;
  removedAt?: Date | string | null;
};

/** What the rule needs to know about the viewer. Load it with materialAccessContext(). */
export type MaterialAccessContext = {
  uid: string | null;
  /** tutors.id rows the viewer owns. */
  ownTutorIds: ReadonlySet<string>;
  /** `<tutorId>:<classId>` of every class the viewer holds a live (not cancelled) booking on —
      keyed with the tutor too, so a material only ever counts a class of its OWN tutor. */
  liveClassKeys: ReadonlySet<string>;
  /** The tutors of those classes. */
  liveTutorIds: ReadonlySet<string>;
};

/** THE RULE. Pure: everything it needs is in `ctx`. */
export function canReadWith(m: MaterialAccessRow, ctx: MaterialAccessContext): boolean {
  if (m.removedAt) return false;
  if (m.visibility === "public") return true;
  if (!ctx.uid) return false;
  if (ctx.ownTutorIds.has(m.tutorId)) return true; // the owner, whatever the visibility
  if (m.visibility !== "students") return false; // private
  return m.classId ? ctx.liveClassKeys.has(`${m.tutorId}:${m.classId}`) : ctx.liveTutorIds.has(m.tutorId);
}

/** The viewer's side of the rule, read once. `tutorIds` narrows the reads to those
    tutors (the file endpoint asks about one material; a list asks about many). */
export async function materialAccessContext(uid: string | null, tutorIds?: readonly string[]): Promise<MaterialAccessContext> {
  const empty: MaterialAccessContext = { uid, ownTutorIds: new Set(), liveClassKeys: new Set(), liveTutorIds: new Set() };
  if (!uid) return empty;
  if (tutorIds && tutorIds.length === 0) return empty;
  const scope = tutorIds ? [...new Set(tutorIds)] : null;

  const [own, live] = await Promise.all([
    db
      .select({ id: tutors.id })
      .from(tutors)
      .where(and(eq(tutors.profileId, uid), scope ? inArray(tutors.id, scope) : undefined)),
    db
      .select({ classId: bookings.classId, tutorId: classes.tutorId })
      .from(bookings)
      .innerJoin(classes, eq(bookings.classId, classes.id))
      .where(
        and(
          eq(bookings.studentId, uid),
          raw`coalesce(${bookings.status}, 'reserved') <> 'cancelled'`,
          scope ? inArray(classes.tutorId, scope) : undefined,
        ),
      )
      .limit(2000),
  ]);
  return {
    uid,
    ownTutorIds: new Set(own.map((r) => r.id)),
    liveClassKeys: new Set(live.map((r) => `${r.tutorId}:${r.classId}`)),
    liveTutorIds: new Set(live.map((r) => r.tutorId)),
  };
}

/** May `uid` (null = signed out) open this material? The file endpoint's question. */
export async function canRead(m: MaterialAccessRow, uid: string | null): Promise<boolean> {
  // Public needs no read at all, exactly as before.
  if (!m.removedAt && m.visibility === "public") return true;
  return canReadWith(m, await materialAccessContext(uid, [m.tutorId]));
}
