import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  and, desc, eq, inArray, isNull,
  bookings, classes, consents, guardianLinks, notifications, reviews, tutors,
} from "@tnajem/db";
import {
  vRating, vOptionalText, vUuid, vText, vPhone, isUuid,
  normalizePhone, isValidPhone,
  type NotificationItem, type NotificationKind,
  normalizeEmail, isValidEmail,
  CONSENT_TEXT, CONSENT_POLICY_VERSION,
} from "@tnajem/shared";
import { resolveMeetUrl, jitsiJoinUrl } from "@tnajem/shared/live";
import { publicDisplayName, publicTutorName } from "@tnajem/shared"; // live-fixes-3 · B2
import { vOptionalPhone } from "@tnajem/shared"; // phase-a lane L5 (A18.2)
import { db } from "../db";
import { getSession } from "../lib/session";
import { maskAndFlag } from "../lib/contact-guard";
import { checkRateLimit } from "../lib/rate-limit";
import { recomputeTutorStats } from "../lib/stats";
// phase-a lane L2 (A13): a refused guardian change is logged
import { auditAdmin } from "../lib/audit";
import { logEvent } from "@tnajem/shared/observability";
import { isUniqueViolation } from "../lib/db-errors"; // phase-a lane L3 (A16)
import { reviewEligibility } from "@tnajem/shared"; // espace prof v2 · pro (P7): the one review rule
import { renderNotification } from "@tnajem/shared/notification-messages";

/* reviews · consent · notifications · live-room access.

   Grouped because each is one or two endpoints; splitting them into four files
   would be filing, not structure. */

const reviewBody = z.object({
  classId: z.string(),
  rating: z.number(),
  text: z.string().optional(),
});

const consentBody = z.object({
  guardianName: z.string(),
  guardianPhone: z.string().optional(), // phase-a lane L5 (A18.2): optional — never used, no longer collected
  /* Step 14. Optional in the SCHEMA so a client that predates parent accounts
     still works, required by the handler below — the two are different questions
     and conflating them would return a 400 shape error where a domain code
     belongs. */
  guardianEmail: z.string().optional(),
});

const markReadBody = z.object({ ids: z.array(z.string()).optional() }).optional();
/* The reader's language: the page's, passed by the bell. Without one, the account's. */
const notificationsQuery = z.object({ locale: z.enum(["fr", "ar"]).optional() });

export async function miscRoutes(app: FastifyInstance): Promise<void> {
  /* ── POST /reviews ───────────────────────────────────────────────────────── */
  app.post("/reviews", async (req, reply) => {
    const parsed = reviewBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad-request" });
    const input = parsed.data;

    const rating = vRating(input.rating);
    if (!rating.ok) return { ok: false, error: rating.error };
    const text = vOptionalText(input.text, { field: "review", max: 1000 });
    if (!text.ok) return { ok: false, error: text.error };

    const classId = vUuid(input.classId, { field: "class" });
    if (!classId.ok) return { ok: false, error: "not-found" };

    const session = await getSession(req);
    if (!session) return { ok: false, error: "not-authenticated" };
    const uid = session.profile.id;

    const rl = await checkRateLimit(`review:${uid}`, 10, 60 * 60_000); // 10 attempts / hour
    if (!rl.ok) return { ok: false, error: "too-many-requests" };

    const [cls] = await db.select().from(classes).where(eq(classes.id, classId.value)).limit(1);
    if (!cls) return { ok: false, error: "not-found" };

    /* AUTHZ: you may only review a class you actually BOOKED, and the unique
       (student_id, class_id) index makes it once. The review is attributed to
       cls.tutorId read from the DATABASE — never to a tutor id supplied by the
       caller — so there is no way to spray 5★ reviews onto someone else's
       storefront. */
    const [bk] = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.classId, cls.id), eq(bookings.studentId, uid)))
      .limit(1);
    /* Booked and not cancelled, on a class that was not called off, has started
       and — phase-a lane L3 (A16) — has ENDED (start + duration, not one minute
       in). espace prof v2 · pro (P7): one shared rule, because the review-prompt
       cron (lib/reminders.ts) asks exactly the students this lets through. */
    const gate = reviewEligibility({
      bookingStatus: bk ? (bk.status ?? "reserved") : null,
      classStatus: cls.status,
      scheduledAt: cls.scheduledAt,
      durationMin: cls.durationMin,
    });
    if (!gate.ok) return { ok: false, error: gate.error };

    /* ZERO CONTACT EXCHANGE (Step 8) — MASKED here, not rejected.

       A review is published on a public storefront, so contact details in one
       cannot stand. But rejecting the write is the wrong tool: a student who has
       written three paragraphs about a class and put a number in the last line
       would lose the three paragraphs, and unlike a tutor editing their own bio
       they are unlikely to come back and try again. The details go, the argument
       stays, and a flag is recorded.

       The masking happens BEFORE the transaction on purpose: it does I/O (the
       flag insert), and holding a write transaction open across it would widen
       the window on the lost-update race the transaction exists to prevent. */
    const review = await maskAndFlag(uid, "review", text.value);

    /* Insert + stat recompute in ONE transaction. recomputeTutorStats is a single
       UPDATE with the aggregates as subqueries, so two students reviewing the same
       tutor concurrently cannot both read the old average and write it back — the
       lost update that silently dropped a review from the public rating. */
    try {
      await db.transaction(async (tx) => {
        await tx.insert(reviews).values({
          tutorId: cls.tutorId,
          studentId: uid,
          classId: cls.id,
          rating: rating.value,
          text: review.text,
        });
        await recomputeTutorStats(cls.tutorId, tx);
      });
    } catch (e) {
      /* phase-a lane L3 (A16): ONLY the unique(student, class) key is "already
         reviewed". Every other failure used to be reported as a duplicate too;
         re-thrown, the error handler answers 500 and the UI says it did not work. */
      if (isUniqueViolation(e, "reviews_student_id_class_id_unique")) {
        return { ok: false, error: "already-reviewed" };
      }
      throw e;
    }

    /* The storefront shows the rating AND the review feed, both cached for 60s.
       One extra point-lookup for the slug (indexed PK), OUTSIDE the transaction —
       a write path must not be held open for a cache concern. */
    const [tut] = await db
      .select({ slug: tutors.slug })
      .from(tutors)
      .where(eq(tutors.id, cls.tutorId))
      .limit(1);

    /* `masked` goes back so the UI can TELL the student what happened. Silently
       editing someone's words and publishing the result is worse than refusing:
       they would see "[masqué]" on the storefront and reasonably think the site
       is broken — or that we censored their opinion rather than their phone
       number. */
    return {
      ok: true,
      masked: review.masked,
      revalidate: tut?.slug ? { tutors: [tut.slug] } : undefined,
    };
  });

  /* ── POST /consent ───────────────────────────────────────────────────────── */
  app.post("/consent", async (req, reply) => {
    const parsed = consentBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad-request" });
    const input = parsed.data;

    const session = await getSession(req);
    if (!session) return { ok: false, error: "not-authenticated" };

    // This row is the legal record of parental consent (INPDP) — it must be real data.
    const name = vText(input.guardianName, { field: "guardian-name", max: 120, min: 2 });
    if (!name.ok) return { ok: false, error: name.error };
    // phase-a lane L5 (A18.2): the phone is OPTIONAL (absent → NULL, 0030_consent_phone_optional.sql);
    // one that is sent must still be a real number.
    const phone = vOptionalPhone(input.guardianPhone);
    if (!phone.ok) return { ok: false, error: phone.error };
    const normalized = phone.value ? normalizePhone(phone.value) : null;
    if (normalized && !isValidPhone(normalized)) return { ok: false, error: "invalid-phone" };

    /* THE PARENT'S E-MAIL is what turns this legal record into a real linked
       account (Step 14) — login is e-mail OTP, so an address is the only
       identifier that can ever resolve to one. The phone never could.

       REQUIRED, because a consent without it produces a parent who can sign a
       form and then see nothing: no bookings, and no access to the conversations
       their child is having with adult strangers. That gap is the thing Step 14
       exists to close, and making the field optional would leave it open by
       default. */
    const guardianEmail = normalizeEmail(input.guardianEmail ?? "");
    if (!isValidEmail(guardianEmail)) return { ok: false, error: "invalid-guardian-email" };

    /* A child cannot be their own guardian. One typo — a minor entering their own
       address — would otherwise hand them "oversight" of themselves and a second
       role in the audit trail. */
    if (guardianEmail === (session.profile.email ?? "").toLowerCase()) {
      return { ok: false, error: "guardian-is-self" };
    }

    /* `consents` has no unique key on minor_id and this had no dedupe, so a client
       could POST it in a loop and write unbounded rows against one profile —
       storage burn, and a legal record with no single answer to "who consented?".
       One consent per minor: re-submitting updates it in place. */
    const [existing] = await db
      .select()
      .from(consents)
      .where(eq(consents.minorId, session.profile.id))
      .limit(1);

    /* WITHDRAWN BY THE GUARDIAN: only the guardian gives it back (their account,
       /guardian). Otherwise a minor could undo the withdrawal by re-typing the form. */
    if (existing?.withdrawnAt) return { ok: false, error: "consent-withdrawn" };

    /* phase-a lane L2 (A13) — A LINKED GUARDIAN CANNOT BE REPLACED BY THE CHILD.
       Re-submitting with another address used to unlink the real parent on the
       spot, silently: a second address of the child's own was enough to end the
       oversight. Once the parent's account is linked to this consent, the address
       is locked. Only the guardian (withdrawal — and a withdrawn consent is already
       refused above) or an admin (removing the link) can change who it names.
       The attempt goes on the audit log and the ops log — ids only, never an
       address. Before any link exists the child can still fix a typo. */
    if (existing && (existing.guardianEmail ?? "") !== guardianEmail) {
      const [link] = await db
        .select({ id: guardianLinks.id })
        .from(guardianLinks)
        .where(eq(guardianLinks.consentId, existing.id))
        .limit(1);
      if (link) {
        await auditAdmin(null, "consent.guardian_change_refused", { kind: "consent", id: existing.id });
        logEvent("warn", "guardian_change_refused", { consentId: existing.id });
        return { ok: false, error: "guardian-locked" };
      }
    }
    // end phase-a lane L2 (A13)

    const values = {
      guardianName: name.value,
      guardianPhone: normalized,
      guardianEmail,
      consentText: CONSENT_TEXT, // @tnajem/shared/legal, LEGAL-REVIEW
      // The version it is given under, and the moment: refreshed on every re-signing.
      policyVersion: CONSENT_POLICY_VERSION,
      signedAt: new Date(),
    };

    if (existing) {
      await db.transaction(async (tx) => {
        await tx.update(consents).set(values).where(eq(consents.id, existing.id));
        /* The consent now names someone else: whoever the old address linked is
           unlinked at once, not merely filtered out on their next read. */
        if ((existing.guardianEmail ?? "") !== guardianEmail) {
          await tx.delete(guardianLinks).where(eq(guardianLinks.consentId, existing.id));
        }
      });
    } else {
      await db.insert(consents).values({ minorId: session.profile.id, ...values });
    }
    return { ok: true };
  });

  /* ── GET /notifications ──────────────────────────────────────────────────────
     Each row is a message key + parameters (0040), rendered HERE in the reader's
     language. A row from before 0040 has only its stored French text, which comes
     back as it is, marked lang "fr", so the bell can set its direction. */
  app.get("/notifications", async (req, reply): Promise<NotificationItem[] | void> => {
    const query = notificationsQuery.safeParse(req.query ?? {});
    if (!query.success) return reply.code(400).send({ error: "bad-request" });
    const session = await getSession(req);
    if (!session) return [];
    const locale = query.data.locale ?? (session.profile.locale === "ar" ? "ar" : "fr");

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.profileId, session.profile.id))
      .orderBy(desc(notifications.createdAt))
      .limit(50);

    return rows.map((n) => {
      const text = renderNotification({ key: n.msgKey, params: n.msgParams, title: n.title, body: n.body }, locale);
      return {
        id: n.id,
        kind: n.kind as NotificationKind,
        title: text.title,
        body: text.body,
        lang: text.lang,
        href: n.href ?? null,
        read: Boolean(n.readAt),
        createdAt: new Date(n.createdAt).toISOString(),
      };
    });
  });

  /* ── POST /notifications/read ────────────────────────────────────────────── */
  app.post("/notifications/read", async (req, reply) => {
    const parsed = markReadBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "bad-request" });

    const session = await getSession(req);
    if (!session) return { ok: false, error: "not-authenticated" };

    /* isUuid filter: a non-uuid string would reach a uuid column and throw 22P02.
       THE SCOPE IS WHAT ENFORCES OWNERSHIP — ids only ever narrow it, never widen
       it, so a caller cannot mark someone else's notifications read by passing
       their ids. */
    const ids = (parsed.data?.ids ?? []).filter((s) => isUuid(s)).slice(0, 100);
    const scope = and(
      eq(notifications.profileId, session.profile.id),
      isNull(notifications.readAt),
    );
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(ids.length ? and(scope, inArray(notifications.id, ids)) : scope);
    return { ok: true };
  });

  /* ── GET /classes/:id/join ───────────────────────────────────────────────── */
  app.get<{ Params: { id: string } }>("/classes/:id/join", async (req) => {
    const classId = req.params.id;
    if (!isUuid(classId)) return { canJoin: false, reason: "not-found" };

    const session = await getSession(req);
    if (!session) return { canJoin: false, reason: "not-authenticated" };
    const uid = session.profile.id;

    const [cls] = await db.select().from(classes).where(eq(classes.id, classId)).limit(1);
    if (!cls) return { canJoin: false, reason: "not-found" };
    /* phase-a lane L3 (A16): a CANCELLED class has no session and no room — for its
       booked students and its tutor alike. The gate handed the room out anyway. */
    if (cls.status === "cancelled") return { canJoin: false, reason: "cancelled" };

    /* live-fixes-3 · B2: a Jitsi room opens titled with the class, and with the VIEWER's
       own public name filled in — what the others in the room see of them: a tutor as
       « Walid T. » (publicTutorName, from the storefront name), a student by first name
       (publicDisplayName). Built here, behind the same gate as the room itself. */
    const room = (displayName: string | null) => jitsiJoinUrl(resolveMeetUrl(cls), { subject: cls.title, displayName });

    const [tut] = await db.select().from(tutors).where(eq(tutors.id, cls.tutorId)).limit(1);
    if (tut?.profileId === uid) {
      return { canJoin: true, role: "tutor" as const, meetUrl: room(publicTutorName(tut.fullName ?? session.profile.fullName)) };
    }

    const [bk] = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.classId, cls.id), eq(bookings.studentId, uid)))
      .limit(1);
    if (bk && bk.status !== "cancelled") {
      return { canJoin: true, role: "student" as const, meetUrl: room(publicDisplayName(session.profile.fullName)) };
    }

    /* meet_url is the ONLY thing protecting a live room full of minors, so anyone
       without an owner or a live booking gets no URL at all — not a URL plus a
       false flag. */
    return { canJoin: false, reason: "not-booked" };
  });
}
