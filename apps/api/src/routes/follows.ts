import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  and, desc, eq, isNull, sql as raw,
  notifications, profiles, tutorFollows, tutors,
  notify,
} from "@tnajem/db";
import { publicDisplayName, publicTutorName, vSlug } from "@tnajem/shared";
import { db } from "../db";
import { getSession } from "../lib/session";
import { checkRateLimit } from "../lib/rate-limit";
import { minorGate } from "../lib/minor-gate";

/* FOLLOWS — "Suivre / Abonné ✓" (Espace prof v2 · Phase 4 · contract C4).

   A student follows a teacher from the profile, a class page, or the "Ce prof
   arrive bientôt" page of a tutor who is not public yet — that is the point of
   following someone who has not opened: being told when they do. The followers
   are told about new classes and fiches by the nightly digest
   (lib/growth-cron.ts), at most once a day; the teacher is told about each new
   follower here.

   THE RULES, all enforced here:
     • students only — a tutor or a guardian account cannot follow (a guardian
       oversees a child's account, they do not become a follower themselves);
     • never your own page;
     • MINORS follow exactly the booking rules (routes/bookings.ts): while
       ALLOW_MINORS is off a minor cannot follow at all; with it on, a live
       guardian consent is required. An unknown age fails safe (minor);
     • the teacher sees FIRST NAMES ONLY (publicDisplayName), like every other
       place a student is named to a tutor (Step 8);
     • a suspended or erased tutor cannot be followed.

   Unfollowing DELETES the row: who follows whom is personal data. */

const slugBody = z.object({ slug: z.string().max(80) });

/** A tutor that can be followed: exists, not suspended, not erased — verified or still coming. */
async function followableTutor(slug: string) {
  const [t] = await db
    .select({ id: tutors.id, profileId: tutors.profileId, slug: tutors.slug, status: tutors.status })
    .from(tutors)
    .where(and(eq(tutors.slug, slug), isNull(tutors.suspendedAt), isNull(tutors.erasedAt)))
    .limit(1);
  return t ?? null;
}

export async function followRoutes(app: FastifyInstance): Promise<void> {
  /* ── POST /follows {slug} ─────────────────────────────────────────────────── */
  app.post("/follows", async (req, reply) => {
    const parsed = slugBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad-request" });
    const slug = vSlug(parsed.data.slug);
    if (!slug.ok) return { ok: false, error: "not-found" };

    const session = await getSession(req);
    if (!session) return { ok: false, error: "not-authenticated" };
    const uid = session.profile.id;

    // A follow writes a row AND notifies a tutor: not something to hammer.
    const rl = await checkRateLimit(`follow:${uid}`, 30, 60 * 60_000);
    if (!rl.ok) return { ok: false, error: "too-many-requests" };

    const t = await followableTutor(slug.value);
    if (!t) return { ok: false, error: "not-found" };
    if (t.profileId === uid) return { ok: false, error: "own-page" };
    if (session.profile.role !== "student") return { ok: false, error: "students-only" };
    const gate = await minorGate(session);
    if (!gate.ok) return gate;

    const inserted = await db
      .insert(tutorFollows)
      .values({ studentProfileId: uid, tutorId: t.id })
      .onConflictDoNothing()
      .returning({ tutorId: tutorFollows.tutorId });
    if (inserted.length === 0) return { ok: true, following: true, already: true };

    /* The teacher hears about each NEW follower. Not twice for one person: an
       unfollow/follow loop must not become a notification stream, so an unread
       "new follower" about the same student is enough. */
    if (t.profileId) {
      const [pending] = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(and(
          eq(notifications.profileId, t.profileId),
          eq(notifications.kind, "new_follower"),
          eq(notifications.aboutProfileId, uid),
          isNull(notifications.readAt),
        ))
        .limit(1);
      if (!pending) {
        await notify(db, t.profileId, {
          kind: "new_follower",
          title: "Nouvel abonné",
          // First name only (Step 8); aboutProfileId so an erasure can rewrite it.
          body: `${publicDisplayName(session.profile.fullName) ?? "Un élève"} te suit : il sera prévenu de tes nouvelles séances et fiches.`,
          href: "/dashboard/students",
          aboutProfileId: uid,
        });
      }
    }
    return { ok: true, following: true };
  });

  /* ── POST /follows/unfollow {slug} ────────────────────────────────────────── */
  app.post("/follows/unfollow", async (req, reply) => {
    const parsed = slugBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad-request" });
    const slug = vSlug(parsed.data.slug);
    if (!slug.ok) return { ok: true, following: false };
    const session = await getSession(req);
    if (!session) return { ok: false, error: "not-authenticated" };

    const [t] = await db.select({ id: tutors.id }).from(tutors).where(eq(tutors.slug, slug.value)).limit(1);
    if (t) {
      await db
        .delete(tutorFollows)
        .where(and(eq(tutorFollows.studentProfileId, session.profile.id), eq(tutorFollows.tutorId, t.id)));
    }
    // Idempotent: not following is the state asked for, whatever it was.
    return { ok: true, following: false };
  });

  /* ── GET /follows/status?slug= — what the Suivre button shows ─────────────── */
  app.get<{ Querystring: { slug?: string } }>("/follows/status", async (req) => {
    const slug = vSlug(req.query?.slug ?? "");
    const session = await getSession(req);
    if (!session) return { signedIn: false, following: false, canFollow: true };
    if (!slug.ok) return { signedIn: true, following: false, canFollow: false, reason: "not-found" };
    const t = await followableTutor(slug.value);
    if (!t) return { signedIn: true, following: false, canFollow: false, reason: "not-found" };
    if (t.profileId === session.profile.id) return { signedIn: true, following: false, canFollow: false, reason: "own-page" };
    if (session.profile.role !== "student") return { signedIn: true, following: false, canFollow: false, reason: "students-only" };
    const [row] = await db
      .select({ at: tutorFollows.createdAt })
      .from(tutorFollows)
      .where(and(eq(tutorFollows.studentProfileId, session.profile.id), eq(tutorFollows.tutorId, t.id)))
      .limit(1);
    return { signedIn: true, following: Boolean(row), canFollow: true };
  });

  /* ── GET /follows/mine — the tutors this student follows ──────────────────── */
  app.get("/follows/mine", async (req) => {
    const session = await getSession(req);
    if (!session) return null;
    const rows = await db
      .select({ slug: tutors.slug, fullName: tutors.fullName, subject: tutors.subject, status: tutors.status, since: tutorFollows.createdAt })
      .from(tutorFollows)
      .innerJoin(tutors, eq(tutors.id, tutorFollows.tutorId))
      .where(and(eq(tutorFollows.studentProfileId, session.profile.id), isNull(tutors.suspendedAt), isNull(tutors.erasedAt)))
      .orderBy(desc(tutorFollows.createdAt))
      .limit(200);
    return rows.map((r) => ({
      slug: r.slug,
      name: publicTutorName(r.fullName) ?? "", // "Mohamed B." — never the last name (A23)
      subject: r.subject,
      live: r.status === "verified",
      since: new Date(r.since).toISOString(),
    }));
  });

  /* ── GET /tutor/followers — the teacher's own followers (Mes élèves) ───────── */
  app.get("/tutor/followers", async (req) => {
    const session = await getSession(req);
    if (!session) return { ok: false, error: "not-authenticated" };
    if (session.profile.role !== "tutor") return { ok: false, error: "not-a-tutor" };
    const [mine] = await db.select({ id: tutors.id }).from(tutors).where(eq(tutors.profileId, session.profile.id)).limit(1);
    if (!mine) return { ok: false, error: "no-storefront" };

    const [{ n }] = await db
      .select({ n: raw<number>`count(*)::int` })
      .from(tutorFollows)
      .where(eq(tutorFollows.tutorId, mine.id));
    const rows = await db
      .select({ fullName: profiles.fullName, since: tutorFollows.createdAt })
      .from(tutorFollows)
      .innerJoin(profiles, eq(profiles.id, tutorFollows.studentProfileId))
      .where(eq(tutorFollows.tutorId, mine.id))
      .orderBy(desc(tutorFollows.createdAt))
      .limit(500);
    return {
      ok: true,
      count: n,
      /* FIRST NAME ONLY, and nothing else about the person: no id, no e-mail, no
         age. The projection above is the boundary — it selects the name alone. */
      items: rows.map((r) => ({ firstName: publicDisplayName(r.fullName), since: new Date(r.since).toISOString() })),
    };
  });
}
