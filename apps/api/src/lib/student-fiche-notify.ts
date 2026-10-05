import { and, eq, sql as raw, bookings, classes, tutors, notify } from "@tnajem/db";
import { publicTutorName } from "@tnajem/shared";
import { db } from "../db";

/* « NOUVELLE FICHE POUR TA SÉANCE » — student-space-v1 · E.

   When a prof adds a material to one of their classes, every student holding a LIVE
   seat in that class (not a cancelled one) gets a bell item: a message key + its
   parameters (@tnajem/shared/notification-messages), rendered FR or AR when read,
   linking to that class's fiches in « Mes fiches ».

   Only for a material those students may open (lib/material-access.ts): attached to
   the class and not private — a private file is the prof's alone, so nobody is told
   about it.

   THE BELL IS ALWAYS ON (notification_prefs governs e-mail only — packages/db/src/
   notification-prefs.ts, and « La cloche reste toujours active » in Profil ›
   Notifications). No e-mail is sent for a new fiche; the followers' daily digest
   (follow-digest.ts) already covers a FOLLOWED prof's new fiches, under the
   « followers » e-mail preference.

   Never throws into the upload: notify() logs and moves on. */
export async function notifyFicheAdded(m: { classId: string | null; visibility: string; title: string; kind: string }): Promise<number> {
  if (!m.classId || m.visibility === "private") return 0;
  try {
    const rows = await db
      .select({ studentId: bookings.studentId, classTitle: classes.title, tutorName: tutors.fullName })
      .from(bookings)
      .innerJoin(classes, eq(classes.id, bookings.classId))
      .innerJoin(tutors, eq(tutors.id, classes.tutorId))
      .where(and(eq(bookings.classId, m.classId), raw`coalesce(${bookings.status}, 'reserved') <> 'cancelled'`))
      .limit(500);
    for (const r of rows) {
      await notify(db, r.studentId, {
        key: "materialAdded",
        params: { classTitle: r.classTitle, materialTitle: m.title, tutorName: publicTutorName(r.tutorName), video: m.kind === "youtube" },
        href: `/student/fiches?class=${m.classId}`,
      });
    }
    return rows.length;
  } catch {
    return 0;
  }
}
