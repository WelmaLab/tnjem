import type { FastifyInstance } from "fastify";
import {
  and, asc, desc, eq, inArray, isNull, sql as raw,
  bookings, classes, consents, guardianLinks, messages, messageThreads, profiles, tutors,
  notify,
} from "@tnajem/db";
import {
  isUuid,
  messageBodyText,
  isAdult,
  publicDisplayName,
  shownThreadState, // phase-a lane L1 (A2)
  classWhen,
  CONSENT_POLICY_VERSION,
  type GuardianChild,
  type MessageThreadDetail,
} from "@tnajem/shared";
import { db } from "../db";
import { getSession } from "../lib/session";
import { releaseBookings, upcomingBookingsOf } from "../lib/booking-release";
import { threadState } from "../lib/thread-state"; // phase-a lane L1 (A2)
import { visibleMessageBody } from "../lib/moderation-hide"; // phase-a lane L4 (A28)

/* PARENT ACCOUNTS (Step 14).

   ══════════════════════════════════════════════════════════════════════════════
   WHAT A GUARDIAN IS FOR, AND WHAT THEY ARE NOT FOR.
   ══════════════════════════════════════════════════════════════════════════════
   FOR: seeing what their own child has booked, and reading the conversations
   their child is having with adults they have never met. That second one is the
   whole point — Step 8b built a private channel between a fifteen-year-old and a
   stranger, and said plainly at the time that guardian access was NOT built
   because guardians had no accounts. This is that gap closed.

   NOT FOR: reaching anybody. ⚠ Step 8 applies to a guardian identically. They see
   a tutor's FIRST NAME and nothing else — no phone, no email, no link. A parent
   account that leaked the tutor's number would be a contact bridge with a
   safeguarding label on it, which is worse than no feature at all, because it
   would be sold as protection.

   ══════════════════════════════════════════════════════════════════════════════
   READ-ONLY, DELIBERATELY.
   ══════════════════════════════════════════════════════════════════════════════
   A guardian cannot send a message as their child, cannot book, cannot cancel.
   Every one of those would put words or money in a minor's name from an account
   the minor does not control, and the audit trail would say the child did it.
   Oversight is a different thing from impersonation, and the line is worth
   holding even though "let the parent reply" is an obvious next request.

   The child is TOLD. apps/web says on both sides of a minor's thread that a
   linked parent can read it — a monitored conversation nobody disclosed is
   surveillance, and a fifteen-year-old is owed that sentence before they type. */

/** Resolve any consents naming this e-mail into real links. Idempotent.

    Called on every session read that matters, because there is no invitation and
    no callback: the link exists the moment the parent signs in. unique(guardian,
    minor) is what keeps that from accumulating a row per login. */
export async function resolveGuardianLinks(profileId: string, email: string | null): Promise<number> {
  if (!email) return 0;
  const rows = await db
    .select({ id: consents.id, minorId: consents.minorId })
    .from(consents)
    .where(eq(consents.guardianEmail, email))
    .limit(50);
  if (rows.length === 0) return 0;

  /* A parent cannot be their own guardian. It would take one typo on the consent
     form — a child entering their own address — to hand them "oversight" of
     themselves and, more to the point, a second role in the audit trail. */
  const links = rows.filter((r) => r.minorId !== profileId);
  if (links.length === 0) return 0;

  await db
    .insert(guardianLinks)
    .values(links.map((r) => ({ guardianProfileId: profileId, minorProfileId: r.minorId, consentId: r.id })))
    .onConflictDoNothing();
  return links.length;
}

/** The minors this profile is a guardian of, RESOLVING THE LINK FIRST.

    The resolve lives here rather than in one endpoint, and that is a bug fix
    rather than tidiness: it used to run only in GET /guardian/children, so a
    parent who followed a link straight to a conversation — which is exactly what
    a notification would do — got an empty answer on their first request, and the
    feature looked broken to precisely the person it was built for.

    Every guardian read goes through this function. There is no path that reads
    guardian_links without resolving them first. */
async function childrenOf(session: { id: string; email: string | null }): Promise<string[]> {
  if (!session.email) return [];
  await resolveGuardianLinks(session.id, session.email);
  /* A LINK IS ONLY AS GOOD AS THE CONSENT BEHIND IT, checked on every read. A link
     used to live forever: a consent naming a typo'd address — or an adult who
     "helped" with the signup — created it, and correcting the consent to the real
     parent left the first person reading the child's conversations indefinitely
     (security review, 15 Sept 2026). The join requires the consent the link was
     made from to still name THIS address, for THIS child. */
  const rows = await db
    .select({ minorProfileId: guardianLinks.minorProfileId })
    .from(guardianLinks)
    .innerJoin(
      consents,
      and(eq(consents.id, guardianLinks.consentId), eq(consents.minorId, guardianLinks.minorProfileId)),
    )
    .where(and(eq(guardianLinks.guardianProfileId, session.id), eq(consents.guardianEmail, session.email)));
  return rows.map((r) => r.minorProfileId);
}

export async function guardianRoutes(app: FastifyInstance): Promise<void> {
  /* ── GET /guardian/children ──────────────────────────────────────────────── */
  app.get("/guardian/children", async (req): Promise<GuardianChild[] | null> => {
    const session = await getSession(req);
    if (!session) return null;

    /* childrenOf resolves the link first, so a parent signing in for the very
       first time sees their child on THIS request — telling them "check back
       later" for a safeguarding feature is how it stops being used. */
    const kids = await childrenOf({ id: session.profile.id, email: session.profile.email ?? null });
    if (kids.length === 0) return [];

    const kidRows = await db
      .select({ id: profiles.id, fullName: profiles.fullName, birthYear: profiles.birthYear, birthMonth: profiles.birthMonth })
      .from(profiles)
      .where(inArray(profiles.id, kids));

    /* Upcoming bookings per child, one query for all of them. */
    const upcoming = await db
      .select({
        studentId: bookings.studentId,
        classId: classes.id,
        title: classes.title,
        scheduledAt: classes.scheduledAt,
        tutorName: tutors.fullName,
      })
      .from(bookings)
      .innerJoin(classes, eq(bookings.classId, classes.id))
      .innerJoin(tutors, eq(classes.tutorId, tutors.id))
      .where(
        and(
          inArray(bookings.studentId, kids),
          raw`coalesce(${bookings.status}, 'reserved') <> 'cancelled'`,
          raw`${classes.scheduledAt} > now()`,
        ),
      )
      .orderBy(asc(classes.scheduledAt))
      .limit(200);

    /* The consent each child's account rests on, as this guardian sees it. */
    const consentRows = await db
      .select({ minorId: consents.minorId, signedAt: consents.signedAt, policyVersion: consents.policyVersion, withdrawnAt: consents.withdrawnAt })
      .from(consents)
      .where(and(inArray(consents.minorId, kids), eq(consents.guardianEmail, session.profile.email ?? "")));

    /* Thread count per child, so the parent knows there is something to read
       without us shipping the messages into a list payload. */
    const threads = await db
      .select({ studentProfileId: messageThreads.studentProfileId, id: messageThreads.id })
      .from(messageThreads)
      .where(inArray(messageThreads.studentProfileId, kids))
      .limit(500);

    return kidRows.map((k) => ({
      /* The parent's OWN child, so the full name is theirs to see — this is not a
         counterparty surface. The TUTOR name beside it is, and gets
         publicDisplayName like everywhere else. */
      id: k.id,
      name: k.fullName,
      isMinor: !isAdult(k.birthYear, k.birthMonth), // phase-a lane L2 (A24): month-aware, fail-safe
      consent: (() => {
        const row = consentRows.find((r) => r.minorId === k.id);
        return row
          ? {
              signedAt: new Date(row.signedAt).toISOString(),
              policyVersion: row.policyVersion,
              withdrawnAt: row.withdrawnAt ? new Date(row.withdrawnAt).toISOString() : null,
            }
          : null;
      })(),
      threadCount: threads.filter((t) => t.studentProfileId === k.id).length,
      upcoming: upcoming
        .filter((u) => u.studentId === k.id)
        .map((u) => {
          const d = new Date(u.scheduledAt);
          return {
            classId: u.classId,
            title: u.title,
            ...classWhen(d), // Tunis time
            tutorName: publicDisplayName(u.tutorName),
          };
        }),
    }));
  });

  /* ── POST /guardian/children/:id/consent/withdraw ────────────────────────────
     WITHDRAWAL AS EASY AS GRANTING, and it means something the moment it happens:
     the child can no longer book, and every upcoming seat is released (waived, so
     nothing is retained), and each tutor is told a seat came free, never why. The
     consent row is kept as the record that consent was given and then withdrawn.
     This is the ONE thing a guardian account does rather than reads: it is the
     guardian's own decision, not an action taken in the child's name. */
  app.post<{ Params: { id: string } }>("/guardian/children/:id/consent/withdraw", async (req) => {
    const session = await getSession(req);
    if (!session) return { ok: false, error: "not-authenticated" };
    if (!isUuid(req.params.id)) return { ok: false, error: "not-found" };
    const kids = await childrenOf({ id: session.profile.id, email: session.profile.email ?? null });
    if (!kids.includes(req.params.id)) return { ok: false, error: "not-found" };

    const [row] = await db
      .update(consents)
      .set({ withdrawnAt: new Date(), withdrawnBy: session.profile.id })
      .where(and(eq(consents.minorId, req.params.id), eq(consents.guardianEmail, session.profile.email ?? ""), isNull(consents.withdrawnAt)))
      .returning({ id: consents.id });
    if (!row) return { ok: true, already: true };

    const { released, releasedRows } = await releaseBookings(await upcomingBookingsOf(req.params.id), {
      actorProfileId: session.profile.id,
      reason: "consent-withdrawn",
    });
    for (const b of releasedRows) {
      const [t] = await db
        .select({ profileId: tutors.profileId, title: classes.title })
        .from(classes)
        .innerJoin(tutors, eq(classes.tutorId, tutors.id))
        .where(eq(classes.id, b.classId))
        .limit(1);
      if (t?.profileId) {
        await notify(db, t.profileId, {
          key: "seatFreed",
          params: { classTitle: t.title },
          href: "/dashboard",
        });
      }
    }
    return { ok: true, releasedBookings: released };
  });

  /* ── POST /guardian/children/:id/consent/grant — give it back ─────────────── */
  app.post<{ Params: { id: string } }>("/guardian/children/:id/consent/grant", async (req) => {
    const session = await getSession(req);
    if (!session) return { ok: false, error: "not-authenticated" };
    if (!isUuid(req.params.id)) return { ok: false, error: "not-found" };
    const kids = await childrenOf({ id: session.profile.id, email: session.profile.email ?? null });
    if (!kids.includes(req.params.id)) return { ok: false, error: "not-found" };

    const [row] = await db
      .update(consents)
      .set({ withdrawnAt: null, withdrawnBy: null, signedAt: new Date(), policyVersion: CONSENT_POLICY_VERSION })
      .where(and(eq(consents.minorId, req.params.id), eq(consents.guardianEmail, session.profile.email ?? "")))
      .returning({ id: consents.id });
    return row ? { ok: true } : { ok: false, error: "not-found" };
  });

  /* ── GET /guardian/children/:id/threads ──────────────────────────────────── */
  app.get<{ Params: { id: string } }>("/guardian/children/:id/threads", async (req) => {
    const session = await getSession(req);
    if (!session) return null;
    if (!isUuid(req.params.id)) return null;

    const kids = await childrenOf({ id: session.profile.id, email: session.profile.email ?? null });
    /* NOT a participant check on the thread — a guardian is not in it. The check
       is "is this MY child", and it is the only thing standing between a parent
       account and every conversation on the platform. */
    if (!kids.includes(req.params.id)) return null;

    const rows = await db
      .select({
        id: messageThreads.id,
        classTitle: classes.title,
        classId: messageThreads.classId,
        scheduledAt: classes.scheduledAt,
        lastMessageAt: messageThreads.lastMessageAt,
        tutorName: tutors.fullName,
      })
      .from(messageThreads)
      .innerJoin(classes, eq(messageThreads.classId, classes.id))
      .innerJoin(tutors, eq(classes.tutorId, tutors.id))
      .where(eq(messageThreads.studentProfileId, req.params.id))
      .orderBy(desc(messageThreads.lastMessageAt), desc(messageThreads.createdAt))
      .limit(200);

    return rows.map((r) => ({
      id: r.id,
      classId: r.classId,
      classTitle: r.classTitle,
      classTs: new Date(r.scheduledAt).getTime(),
      withName: publicDisplayName(r.tutorName), // first name only, like everywhere
      lastMessageAt: r.lastMessageAt ? new Date(r.lastMessageAt).toISOString() : null,
      studentIsMinor: true,
      iAm: "guardian" as const,
    }));
  });

  /* ── GET /guardian/threads/:id — read one conversation ───────────────────── */
  app.get<{ Params: { id: string } }>("/guardian/threads/:id", async (req): Promise<MessageThreadDetail | null> => {
    const session = await getSession(req);
    if (!session) return null;
    if (!isUuid(req.params.id)) return null;

    const [thread] = await db
      .select({
        id: messageThreads.id,
        studentProfileId: messageThreads.studentProfileId,
        classTitle: classes.title,
        tutorName: tutors.fullName,
      })
      .from(messageThreads)
      .innerJoin(classes, eq(messageThreads.classId, classes.id))
      .innerJoin(tutors, eq(classes.tutorId, tutors.id))
      .where(eq(messageThreads.id, req.params.id))
      .limit(1);
    if (!thread?.studentProfileId) return null;

    const kids = await childrenOf({ id: session.profile.id, email: session.profile.email ?? null });
    if (!kids.includes(thread.studentProfileId)) return null;

    const rows = await db
      .select({
        id: messages.id,
        senderProfileId: messages.senderProfileId,
        body: visibleMessageBody(session.profile.locale), // phase-a lane L4 (A28): hidden by moderation → placeholder
        masked: messages.masked,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(eq(messages.threadId, thread.id))
      .orderBy(asc(messages.createdAt))
      .limit(500);

    return {
      id: thread.id,
      classTitle: thread.classTitle,
      withName: publicDisplayName(thread.tutorName),
      /* "guardian" is not a participant role, and the UI uses it to hide the
         composer entirely. A read-only view that still renders a text box is an
         invitation to a feature that does not exist. */
      iAm: "guardian",
      studentIsMinor: true,
      // phase-a lane L1 (A2): a closed thread stays readable here; the page shows the banner.
      state: shownThreadState(await threadState(thread.id)),
      messages: rows.map((m) => ({
        id: m.id,
        /* `mine` is FALSE for every message: none of them are the guardian's.
           Marking the child's own messages as "mine" would render them as the
           parent's own words in the parent's own view. */
        mine: false,
        /* Whose message it is, so a parent can follow the conversation at all.
           First names only — the child's is theirs to see, the tutor's is the
           same first name every other surface shows. */
        body: messageBodyText(m.body), // phase-a lane L1 (A20): stored escaped, read as typed
        masked: m.masked,
        at: new Date(m.createdAt).toISOString(),
        fromChild: m.senderProfileId === thread.studentProfileId,
      })),
    };
  });
}
