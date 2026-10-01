import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  and, asc, desc, eq, or, sql as raw,
  bookings, classes, messages, messageReports, messageThreads, profiles, reports, tutors,
  notify,
} from "@tnajem/db";
import {
  isUuid,
  isAdult,
  messageBodyText,
  parseMessageBody,
  publicDisplayName,
  shownThreadState,
  vUuid,
  vOptionalText,
  type MessageThreadSummary,
  type MessageThreadDetail,
} from "@tnajem/shared";
import { db } from "../db";
import { getSession } from "../lib/session";
import { maskAndFlag } from "../lib/contact-guard";
import { checkRateLimit } from "../lib/rate-limit";
import { threadState } from "../lib/thread-state";
import { visibleMessageBody } from "../lib/moderation-hide"; // phase-a lane L4 (A28)

/* MESSAGING (Step 8b) — the channel that replaces the contact details Step 8
   closed.

   ══════════════════════════════════════════════════════════════════════════════
   EVERY THREAD IS A BOOKING. There are no cold DMs.
   ══════════════════════════════════════════════════════════════════════════════
   You cannot start a conversation with someone who has not taken a seat in your
   class, or whose class you have not booked. That one rule removes the entire
   category of abuse an open marketplace inbox invites — unsolicited approaches to
   minors above all — and it is enforced by a UNIQUE NOT NULL booking_id in the
   schema, not by a check on each endpoint that the next endpoint might forget.

   ══════════════════════════════════════════════════════════════════════════════
   THREE THINGS HAPPEN TO EVERY MESSAGE, IN THIS ORDER.
   ══════════════════════════════════════════════════════════════════════════════
     1. SANITISE  parseMessageBody escapes & < > (phase-a A20: escape, don't
                  strip). messages.body is the product's only stored-XSS surface:
                  user-authored, persisted, rendered to somebody else. Escaping on
                  the way in means the database never holds a payload for a future
                  consumer to render unescaped; messageBodyText() decodes it for
                  the JSON a reader gets, which apps/web renders as a text node.
     2. MASK      detectContactInfo, then remove what it found. NOT rejected —
                  see the header of lib/contact-guard.ts. A message is a
                  conversation; refusing it loses the point the person was making,
                  and pushes them to work around the filter rather than live with
                  it.
     3. FLAG      the pattern class only, never the text.

   ══════════════════════════════════════════════════════════════════════════════
   WHAT THIS DOES NOT DO YET, STATED PLAINLY.
   ══════════════════════════════════════════════════════════════════════════════
   The plan asks for a minor's thread to be visible to their linked guardian.
   That is NOT built here, and pretending otherwise would be worse than the gap:
   guardians have no accounts yet. `consents` stores a guardian's NAME and PHONE
   against the minor, not a profile they can sign into, so there is nobody to
   grant access to. Step 14 promotes guardians to real linked accounts; that is
   the change that can honestly deliver this.

   What exists now, and what the UI says on both sides, is true today:
   threads involving a minor are marked, retained, and readable by Tnajem when a
   message is reported. No claim is made about a parent logging in to read them. */

const sendBody = z.object({ body: z.string() });
const reportBody = z.object({ reason: z.string().optional() });

/** Per-sender ceiling. Generous for a real conversation, useless for flooding. */
const SEND_LIMIT = 30;
const SEND_WINDOW_MS = 10 * 60_000;

type Participant = {
  threadId: string;
  role: "tutor" | "student";
  otherProfileId: string | null;
  studentIsMinor: boolean;
  classTitle: string;
};

/** Resolve a thread the caller is actually in. Null means "not yours".

    Deliberately does NOT distinguish "no such thread" from "not a participant":
    a thread id is a bare uuid, and telling a stranger which ids exist is a small
    but free information leak. */
async function participantIn(threadId: string, uid: string): Promise<Participant | null> {
  const [row] = await db
    .select({
      id: messageThreads.id,
      tutorProfileId: messageThreads.tutorProfileId,
      studentProfileId: messageThreads.studentProfileId,
      studentIsMinor: messageThreads.studentIsMinor,
      classTitle: classes.title,
    })
    .from(messageThreads)
    .innerJoin(classes, eq(messageThreads.classId, classes.id))
    .where(eq(messageThreads.id, threadId))
    .limit(1);
  if (!row) return null;
  if (row.tutorProfileId === uid) {
    return {
      threadId: row.id,
      role: "tutor",
      otherProfileId: row.studentProfileId,
      studentIsMinor: row.studentIsMinor,
      classTitle: row.classTitle,
    };
  }
  if (row.studentProfileId === uid) {
    return {
      threadId: row.id,
      role: "student",
      otherProfileId: row.tutorProfileId,
      studentIsMinor: row.studentIsMinor,
      classTitle: row.classTitle,
    };
  }
  return null;
}

export async function messageRoutes(app: FastifyInstance): Promise<void> {
  /* ── POST /threads — open (or reopen) the thread for a booking ───────────── */
  app.post("/threads", async (req, reply) => {
    const parsed = z.object({ bookingId: z.string() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad-request" });
    const bookingId = vUuid(parsed.data.bookingId, { field: "booking" });
    if (!bookingId.ok) return { ok: false, error: "not-found" };

    const session = await getSession(req);
    if (!session) return { ok: false, error: "not-authenticated" };
    const uid = session.profile.id;

    const [bk] = await db
      .select({
        id: bookings.id,
        status: bookings.status,
        studentId: bookings.studentId,
        classId: classes.id,
        tutorProfileId: tutors.profileId,
      })
      .from(bookings)
      .innerJoin(classes, eq(bookings.classId, classes.id))
      .innerJoin(tutors, eq(classes.tutorId, tutors.id))
      .where(eq(bookings.id, bookingId.value))
      .limit(1);
    if (!bk) return { ok: false, error: "not-found" };

    /* Only the two people the booking is between. Same reason participantIn does
       not distinguish its failures: "not-found" for everyone else. */
    const isStudent = bk.studentId === uid;
    const isTutor = bk.tutorProfileId === uid;
    if (!isStudent && !isTutor) return { ok: false, error: "not-found" };

    /* A CANCELLED booking opens nothing. The seat is the reason the channel
       exists; give it up and the channel goes with it. An EXISTING thread is
       still readable afterwards — the conversation that already happened is not
       retroactively private — but no new one is created. */
    if (bk.status === "cancelled") {
      const [existing] = await db
        .select({ id: messageThreads.id })
        .from(messageThreads)
        .where(eq(messageThreads.bookingId, bk.id))
        .limit(1);
      if (!existing) return { ok: false, error: "booking-cancelled" };
      return { ok: true, threadId: existing.id };
    }

    const [student] = await db
      .select({ birthYear: profiles.birthYear, birthMonth: profiles.birthMonth })
      .from(profiles)
      .where(eq(profiles.id, bk.studentId))
      .limit(1);

    /* onConflictDoNothing on the UNIQUE booking_id, then read back. Two taps on
       "Message" from a slow phone must not create two threads, and the database
       is the only place that can decide the race. */
    await db
      .insert(messageThreads)
      .values({
        bookingId: bk.id,
        classId: bk.classId,
        tutorProfileId: bk.tutorProfileId,
        studentProfileId: bk.studentId,
        // phase-a/integrate (A24): month-aware and fail-safe, like every other minor check.
        studentIsMinor: !isAdult(student?.birthYear ?? null, student?.birthMonth ?? null),
      })
      .onConflictDoNothing();

    const [thread] = await db
      .select({ id: messageThreads.id })
      .from(messageThreads)
      .where(eq(messageThreads.bookingId, bk.id))
      .limit(1);
    return { ok: true, threadId: thread?.id ?? null };
  });

  /* ── GET /threads — my conversations ─────────────────────────────────────── */
  app.get("/threads", async (req): Promise<MessageThreadSummary[] | null> => {
    const session = await getSession(req);
    if (!session) return null;
    const uid = session.profile.id;

    /* One query, one join per side. The counterparty's name comes out of
       publicDisplayName — a thread list is a counterparty surface like any other,
       and Step 8's allow-list does not stop applying because this is a new
       feature. */
    const rows = await db
      .select({
        id: messageThreads.id,
        classTitle: classes.title,
        classId: messageThreads.classId,
        scheduledAt: classes.scheduledAt,
        lastMessageAt: messageThreads.lastMessageAt,
        studentIsMinor: messageThreads.studentIsMinor,
        tutorProfileId: messageThreads.tutorProfileId,
        studentProfileId: messageThreads.studentProfileId,
        tutorName: tutors.fullName,
        studentName: profiles.fullName,
      })
      .from(messageThreads)
      .innerJoin(classes, eq(messageThreads.classId, classes.id))
      .innerJoin(tutors, eq(classes.tutorId, tutors.id))
      .leftJoin(profiles, eq(messageThreads.studentProfileId, profiles.id))
      .where(
        or(
          eq(messageThreads.tutorProfileId, uid),
          eq(messageThreads.studentProfileId, uid),
        ),
      )
      .orderBy(desc(messageThreads.lastMessageAt), desc(messageThreads.createdAt))
      .limit(200);

    return rows.map((r) => {
      const iAmTutor = r.tutorProfileId === uid;
      return {
        id: r.id,
        classId: r.classId,
        classTitle: r.classTitle,
        classTs: new Date(r.scheduledAt).getTime(),
        withName: publicDisplayName(iAmTutor ? r.studentName : r.tutorName),
        lastMessageAt: r.lastMessageAt ? new Date(r.lastMessageAt).toISOString() : null,
        studentIsMinor: r.studentIsMinor,
        iAm: iAmTutor ? ("tutor" as const) : ("student" as const),
      };
    });
  });

  /* ── GET /threads/:id — the conversation ─────────────────────────────────── */
  app.get<{ Params: { id: string } }>("/threads/:id", async (req): Promise<MessageThreadDetail | null> => {
    const session = await getSession(req);
    if (!session) return null;
    if (!isUuid(req.params.id)) return null;

    const me = await participantIn(req.params.id, session.profile.id);
    if (!me) return null;

    const rows = await db
      .select({
        id: messages.id,
        senderProfileId: messages.senderProfileId,
        body: visibleMessageBody(session.profile.locale), // phase-a lane L4 (A28): hidden by moderation → placeholder
        masked: messages.masked,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(eq(messages.threadId, me.threadId))
      .orderBy(asc(messages.createdAt))
      .limit(500);

    const [other] = me.otherProfileId
      ? await db
          .select({ fullName: profiles.fullName })
          .from(profiles)
          .where(eq(profiles.id, me.otherProfileId))
          .limit(1)
      : [undefined];

    /* espace prof v2 · shell (0036): opening the conversation reads it — this side's
       mark moves to now, so the shell's unread count (GET /messages/unread-count)
       drops. Only a PARTICIPANT gets here; a guardian reads through /guardian and
       never moves the child's mark. */
    await db
      .update(messageThreads)
      .set(me.role === "tutor" ? { tutorReadAt: raw`now()` } : { studentReadAt: raw`now()` })
      .where(eq(messageThreads.id, me.threadId));

    return {
      id: me.threadId,
      classTitle: me.classTitle,
      withName: publicDisplayName(other?.fullName ?? null),
      iAm: me.role,
      studentIsMinor: me.studentIsMinor,
      // phase-a A2: the banner and the disabled composer. Reasons shown are filtered.
      state: shownThreadState(await threadState(me.threadId)),
      messages: rows.map((m) => ({
        id: m.id,
        mine: m.senderProfileId === session.profile.id,
        body: messageBodyText(m.body), // phase-a A20: stored escaped, read as typed
        masked: m.masked,
        at: new Date(m.createdAt).toISOString(),
      })),
    };
  });

  /* ── POST /threads/:id/messages ──────────────────────────────────────────── */
  app.post<{ Params: { id: string } }>("/threads/:id/messages", async (req, reply) => {
    const parsed = sendBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad-request" });

    const session = await getSession(req);
    if (!session) return { ok: false, error: "not-authenticated" };
    if (!isUuid(req.params.id)) return { ok: false, error: "not-found" };

    const me = await participantIn(req.params.id, session.profile.id);
    if (!me) return { ok: false, error: "not-found" };

    /* A CLOSED CONVERSATION TAKES NO NEW MESSAGES (phase-a A2). Both sides keep
       the history, but a minor who cancels to get away from a tutor must not keep
       receiving messages — each one a notification (security review, 15 Sept 2026)
       — and neither may anyone once consent is withdrawn, an account is blocked, or
       the class ended THREAD_CLOSE_DAYS ago. threadState() is the one place that
       decides. A cancelled booking keeps its own error code (the existing
       contract); every other reason is one neutral "thread-closed", because the
       tutor is never told WHY (consent, block). */
    const state = await threadState(me.threadId);
    if (state === "closed:booking-cancelled") return { ok: false, error: "booking-cancelled" };
    if (state !== "open") return { ok: false, error: "thread-closed" };

    /* Keyed on the SENDER, not the IP: the abuse being prevented is one account
       flooding another, and a shared connection must not throttle a classroom. */
    const rl = await checkRateLimit(`msg:send:${session.profile.id}`, SEND_LIMIT, SEND_WINDOW_MS);
    if (!rl.ok) return { ok: false, error: "too-many-requests" };

    // 1. SANITISE — markup never reaches the database live: & < > are escaped.
    const text = parseMessageBody(parsed.data.body);
    if (!text.ok) return { ok: false, error: text.error };

    // 2 + 3. MASK and FLAG. Never rejected: see the note at the top of this file.
    const scrubbed = await maskAndFlag(session.profile.id, "message", text.value);
    const body = scrubbed.text ?? "";
    if (!body) return { ok: false, error: "message-empty" };

    const [row] = await db
      .insert(messages)
      .values({ threadId: me.threadId, senderProfileId: session.profile.id, body, masked: scrubbed.masked })
      .returning({ id: messages.id, createdAt: messages.createdAt });

    await db
      .update(messageThreads)
      .set({ lastMessageAt: raw`now()` })
      .where(eq(messageThreads.id, me.threadId));

    /* Tell the other side. notify() never throws and does its own I/O, so it runs
       after the write rather than inside it. */
    if (me.otherProfileId) {
      await notify(db, me.otherProfileId, {
        kind: "message",
        title: "Nouveau message",
        body: `Tu as un nouveau message à propos de « ${me.classTitle} ».`,
        href: `/messages/${me.threadId}`,
      });
    }

    return {
      ok: true,
      id: row.id,
      at: new Date(row.createdAt).toISOString(),
      body: messageBodyText(body),
      /* The sender is told when their own message was edited. Silently altering
         someone's words and delivering the result is how a filter turns into a
         trust problem. */
      masked: scrubbed.masked,
    };
  });

  /* ── POST /messages/:id/report ───────────────────────────────────────────── */
  app.post<{ Params: { id: string } }>("/messages/:id/report", async (req, reply) => {
    const parsed = reportBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "bad-request" });
    const reason = vOptionalText(parsed.data.reason, { field: "reason", max: 500 });
    if (!reason.ok) return { ok: false, error: reason.error };

    const session = await getSession(req);
    if (!session) return { ok: false, error: "not-authenticated" };
    if (!isUuid(req.params.id)) return { ok: false, error: "not-found" };

    const [msg] = await db
      .select({ id: messages.id, threadId: messages.threadId, senderProfileId: messages.senderProfileId })
      .from(messages)
      .where(eq(messages.id, req.params.id))
      .limit(1);
    if (!msg) return { ok: false, error: "not-found" };

    // You may only report a message in a thread you are actually in.
    const me = await participantIn(msg.threadId, session.profile.id);
    if (!me) return { ok: false, error: "not-found" };
    if (msg.senderProfileId === session.profile.id) return { ok: false, error: "own-message" };

    /* IDEMPOTENT via unique(message_id, reporter_profile_id). Pressing the button
       twice is one report, and a queue that double-counts is one nobody trusts.
       It returns ok either way so the UI can confirm without the user wondering
       whether it worked. */
    const [filed] = await db
      .insert(messageReports)
      .values({ messageId: msg.id, reporterProfileId: session.profile.id, reason: reason.value })
      .onConflictDoNothing()
      .returning({ id: messageReports.id });

    /* INTO THE MODERATION QUEUE. message_reports alone was read by nothing: no admin
       screen listed it, so a minor reporting a message from a tutor reached no one
       (Stage 5). The first report by this person on this message also opens a
       report an admin works on /admin/moderation, with the message text as context. */
    if (filed) {
      await db.insert(reports).values({
        subjectKind: "message",
        subjectId: msg.id,
        reporterProfileId: session.profile.id,
        reason: reason.value ?? "Message signalé dans une conversation (sans commentaire).",
      });
    }

    return { ok: true };
  });
}
