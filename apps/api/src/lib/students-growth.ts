import { and, eq, inArray, profiles, studentSubscriptions, tutorFollows } from "@tnajem/db";
import type { TutorStudentRelation } from "@tnajem/shared";
import { db } from "../db";

/* « Mes élèves » — what growth adds to GET /tutor/students (routes/tutor-space.ts).

   Phase 1 lists everyone who BOOKED. Growth adds, on the same rows, by appending to
   `relations`: the people who FOLLOW the page (Phase 4) and the ones with a running
   monthly SUBSCRIPTION — active or paused (Phase 5). Someone who never booked
   becomes a row with no bookings and status "none". Keyed by the student's profile
   id here only so the route can merge — the route turns it into its opaque
   per-tutor key and never sends the id. First names only, as everywhere a tutor
   sees a student. */

export type GrowthRelation = { name: string | null; relations: Exclude<TutorStudentRelation, "booked">[]; since: string };

export async function growthRelations(tutorId: string): Promise<Map<string, GrowthRelation>> {
  const out = new Map<string, GrowthRelation>();
  const add = (studentId: string, name: string | null, rel: GrowthRelation["relations"][number], at: Date | string) => {
    const iso = new Date(at).toISOString();
    const e = out.get(studentId);
    if (!e) out.set(studentId, { name, relations: [rel], since: iso });
    else {
      if (!e.relations.includes(rel)) e.relations.push(rel);
      if (iso < e.since) e.since = iso;
    }
  };

  const follows = await db
    .select({ studentId: tutorFollows.studentProfileId, name: profiles.fullName, at: tutorFollows.createdAt })
    .from(tutorFollows)
    .innerJoin(profiles, eq(profiles.id, tutorFollows.studentProfileId))
    .where(eq(tutorFollows.tutorId, tutorId))
    .limit(1000);
  for (const f of follows) add(f.studentId, f.name, "follower", f.at);

  const subs = await db
    .select({ studentId: studentSubscriptions.studentProfileId, name: profiles.fullName, at: studentSubscriptions.confirmedAt, created: studentSubscriptions.createdAt })
    .from(studentSubscriptions)
    .innerJoin(profiles, eq(profiles.id, studentSubscriptions.studentProfileId))
    .where(and(eq(studentSubscriptions.tutorId, tutorId), inArray(studentSubscriptions.status, ["active", "paused"])))
    .limit(1000);
  for (const s of subs) add(s.studentId, s.name, "subscriber", s.at ?? s.created);

  return out;
}
