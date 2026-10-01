import { eq, profiles, tutorFollows } from "@tnajem/db";
import type { TutorStudentRelation } from "@tnajem/shared";
import { db } from "../db";

/* « Mes élèves » — what growth adds to GET /tutor/students (routes/tutor-space.ts).

   Phase 1 lists everyone who BOOKED. Growth adds the people who FOLLOW the page
   (Phase 4) on the same rows, by appending to `relations`; a follower who never
   booked becomes a row with no bookings and status "none". Keyed by the student's
   profile id here only so the route can merge — the route turns it into its
   opaque per-tutor key and never sends the id. First names only, as everywhere a
   tutor sees a student. */

export type GrowthRelation = { name: string | null; relations: Exclude<TutorStudentRelation, "booked">[]; since: string };

export async function growthRelations(tutorId: string): Promise<Map<string, GrowthRelation>> {
  const out = new Map<string, GrowthRelation>();
  const follows = await db
    .select({ studentId: tutorFollows.studentProfileId, name: profiles.fullName, at: tutorFollows.createdAt })
    .from(tutorFollows)
    .innerJoin(profiles, eq(profiles.id, tutorFollows.studentProfileId))
    .where(eq(tutorFollows.tutorId, tutorId))
    .limit(1000);
  for (const f of follows) {
    out.set(f.studentId, { name: f.name, relations: ["follower"], since: new Date(f.at).toISOString() });
  }
  return out;
}
