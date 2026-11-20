import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  and, eq, gt, isNull, sql as raw,
  bookings, cancellations, classes, profiles, sessions, tutors,
} from "@tnajem/db";
import {
  vText, vUuid, normalizeEmail, isValidEmail,
  cancellationOutcome,
  type AdminAccount,
} from "@tnajem/shared";
import { paymentsEnabled } from "@tnajem/shared/payments";
import { db } from "../db";
import { isAdminProfile, requireAdmin } from "../lib/admin";
import { auditAdmin } from "../lib/audit";
import { cancelClassForEveryone } from "../lib/class-cancel";
import { releaseBookings } from "../lib/booking-release";
import { recomputeTutorStats } from "../lib/stats";

/* ACCOUNT BLOCKS (production readiness, Stage 2).

   A block is the stop an admin reaches for when someone must not use the platform
   — an abusive tutor, a fake account, a safeguarding report. Before it existed the
   only lever was "reject", which took any tutor, needed no reason, logged nothing,
   ended no session and left every booking standing.

   What a block does, all of it:
     • profiles.blocked_at/reason/by — getSession refuses the account, login answers
       "account-blocked", and every session row is deleted;
     • tutors.suspended_at — the storefront leaves every public read and cannot be
       booked; the verification decision is untouched, so unblocking restores it;
     • upcoming classes and bookings: it REFUSES while any exist, and says how many,
       unless the admin explicitly asks to cancel them. Then every student is
       released in full (actor "system", waived) and told the class will not take
       place — never why. A tutor blocked mid-week must not leave students waiting
       in a room, and an admin must not discover that consequence afterwards.

   Refused: blocking yourself, and blocking an admin (profiles.admin_granted_at,
   VULN-006): that is an `npm run admin:revoke` on the server, made by the operator.
   Every block and unblock writes an admin_actions row. The reason is stored on
   the profile for admins; the audit row carries no copy of it. */

const REASON_MIN = 5;
const blockBody = z.object({ profileId: z.string(), reason: z.string(), cancelUpcoming: z.boolean().optional() });
const unblockBody = z.object({ profileId: z.string() });
const testBody = z.object({ profileId: z.string(), isTest: z.boolean() });

/* coalesce: classes.status is nullable, and NULL NOT IN (…) is NULL — a legacy row
   with no status would silently not count as upcoming, and survive the block. */
const upcomingClassWhere = (tutorId: string) =>
  and(eq(classes.tutorId, tutorId), gt(classes.scheduledAt, new Date()), raw`coalesce(${classes.status}, 'scheduled') not in ('cancelled', 'done')`);

async function upcomingFor(profileId: string, tutorId: string | null) {
  const classRows = tutorId
    ? await db
        .select({ id: classes.id, title: classes.title, scheduledAt: classes.scheduledAt, priceTnd: classes.priceTnd, tutorId: classes.tutorId })
        .from(classes)
        .where(upcomingClassWhere(tutorId))
    : [];
  const bookingRows = await db
    .select({
      id: bookings.id,
      classId: classes.id,
      isFree: bookings.isFree,
      scheduledAt: classes.scheduledAt,
      priceTnd: classes.priceTnd,
      tutorId: classes.tutorId,
    })
    .from(bookings)
    .innerJoin(classes, eq(bookings.classId, classes.id))
    .where(
      and(
        eq(bookings.studentId, profileId),
        raw`coalesce(${bookings.status}, 'reserved') <> 'cancelled'`,
        gt(classes.scheduledAt, new Date()),
        raw`coalesce(${classes.status}, 'scheduled') not in ('cancelled', 'done')`,
      ),
    );
  return { classRows, bookingRows };
}

export async function adminAccountRoutes(app: FastifyInstance): Promise<void> {
  /* ── POST /admin/accounts/find { email } ───────────────────────────────────
     POST with a body, not GET ?email=: an address in a query string ends up in
     proxy access logs, browser history and error trackers, none of which redact. */
  app.post("/admin/accounts/find", async (req) => {
    const session = await requireAdmin(req);
    if (!session) return { ok: false, error: "forbidden" };

    const body = (req.body ?? {}) as { email?: unknown };
    const email = normalizeEmail(typeof body.email === "string" ? body.email : "");
    if (!isValidEmail(email)) return { ok: false, error: "invalid-email" };

    const [p] = await db.select().from(profiles).where(eq(profiles.email, email)).limit(1);
    if (!p) return { ok: true, account: null };

    const [t] = await db.select().from(tutors).where(eq(tutors.profileId, p.id)).limit(1);
    const { classRows, bookingRows } = await upcomingFor(p.id, t?.id ?? null);

    const account: AdminAccount = {
      id: p.id,
      email: p.email,
      role: p.role,
      name: p.fullName,
      blockedAt: p.blockedAt ? new Date(p.blockedAt).toISOString() : null,
      blockedReason: p.blockedReason,
      isAdmin: isAdminProfile(p), // VULN-006: the DB column
      tutor: t ? { id: t.id, slug: t.slug, status: t.status ?? "draft", suspended: Boolean(t.suspendedAt), isTest: t.isTest } : null,
      upcomingClasses: classRows.length,
      upcomingBookings: bookingRows.length,
    };
    return { ok: true, account };
  });

  /* ── POST /admin/accounts/block ──────────────────────────────────────────── */
  app.post("/admin/accounts/block", async (req, reply) => {
    const parsed = blockBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad-request" });

    const session = await requireAdmin(req);
    if (!session) return { ok: false, error: "forbidden" };

    const profileId = vUuid(parsed.data.profileId, { field: "profile" });
    if (!profileId.ok) return { ok: false, error: "not-found" };
    const reason = vText(parsed.data.reason, { field: "reason", max: 500, min: REASON_MIN });
    if (!reason.ok) return { ok: false, error: reason.error === "reason-too-long" ? "reason-too-long" : "reason-required" };

    const [p] = await db.select().from(profiles).where(eq(profiles.id, profileId.value)).limit(1);
    if (!p) return { ok: false, error: "not-found" };
    if (p.id === session.profile.id) return { ok: false, error: "cannot-block-self" };
    // An erased account has nothing left to block, and must not be brought back.
    if (p.purgedAt) return { ok: false, error: "account-erased" };
    if (isAdminProfile(p)) {
      return { ok: false, error: "cannot-block-admin" };
    }
    if (p.blockedAt) return { ok: true, already: true };

    const [t] = await db.select().from(tutors).where(eq(tutors.profileId, p.id)).limit(1);
    const { classRows, bookingRows } = await upcomingFor(p.id, t?.id ?? null);
    if ((classRows.length > 0 || bookingRows.length > 0) && !parsed.data.cancelUpcoming) {
      return {
        ok: false,
        error: "has-upcoming",
        upcomingClasses: classRows.length,
        upcomingBookings: bookingRows.length,
      };
    }

    /* 1. THE STOP, first and atomically: no session, no login, no storefront, no new
       booking — before anything slower happens. */
    const blocked = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(profiles)
        .set({ blockedAt: new Date(), blockedReason: reason.value, blockedBy: session.profile.id })
        .where(and(eq(profiles.id, p.id), isNull(profiles.blockedAt)))
        .returning({ id: profiles.id });
      if (!row) return false;
      if (t) await tx.update(tutors).set({ suspendedAt: new Date() }).where(eq(tutors.id, t.id));
      await tx.delete(sessions).where(eq(sessions.profileId, p.id));
      await auditAdmin(session.profile.id, "account.block", { kind: "profile", id: p.id }, null, tx); // Phase A+ (P3)
      return true;
    });
    if (!blocked) return { ok: true, already: true };

    /* 2. Then release everyone the account was holding. Students are told the class
       will not take place — never that the tutor was blocked. */
    let cancelledClasses = 0;
    for (const c of classRows) {
      await cancelClassForEveryone(c, {
        actor: "system",
        actorProfileId: session.profile.id,
        reason: "account-blocked",
        notifyKey: "classCancelledByPlatform",
      });
      cancelledClasses++;
    }

    // Waived, seat released, ledger written, room rotated: lib/booking-release.ts.
    const { released: cancelledBookings } = await releaseBookings(bookingRows, {
      actorProfileId: session.profile.id,
      reason: "account-blocked",
    });

    return {
      ok: true,
      cancelledClasses,
      cancelledBookings,
      ...(t ? { revalidate: { tutors: [t.slug], publicTutors: true } } : {}),
    };
  });

  /* ── POST /admin/accounts/test { profileId, isTest } — december-sprint · A (D11)

     Marks (or unmarks) a tutor's account as a TEST account. tutors.is_test takes
     the storefront out of every public list (publicTutorSql: Explore and its
     search, the home card, the sitemap; the student suggestions) while its direct
     links keep working, with robots noindex, so live tests stay possible. Nothing
     else changes: no session ended, no booking touched, no verification decision.
     Admin-only (requireAdmin), and every change writes an admin_actions row in the
     same transaction — no audit row, no change. Setting the value it already has is
     an answer (`already`), not a second audit row. */
  app.post("/admin/accounts/test", async (req, reply) => {
    const parsed = testBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad-request" });

    const session = await requireAdmin(req);
    if (!session) return { ok: false, error: "forbidden" };
    const profileId = vUuid(parsed.data.profileId, { field: "profile" });
    if (!profileId.ok) return { ok: false, error: "not-found" };
    const isTest = parsed.data.isTest;

    const result = await db.transaction(async (tx) => {
      const [t] = await tx
        .select({ id: tutors.id, slug: tutors.slug, isTest: tutors.isTest })
        .from(tutors)
        .where(eq(tutors.profileId, profileId.value))
        .limit(1);
      if (!t) return null;
      if (t.isTest === isTest) return { slug: t.slug, already: true };
      await tx.update(tutors).set({ isTest }).where(eq(tutors.id, t.id));
      await auditAdmin(session.profile.id, isTest ? "account.test.mark" : "account.test.unmark", { kind: "tutor", id: t.id }, null, tx);
      return { slug: t.slug, already: false };
    });
    if (!result) return { ok: false, error: "not-a-tutor" };
    if (result.already) return { ok: true, already: true, isTest };
    return { ok: true, isTest, revalidate: { tutors: [result.slug], publicTutors: true } };
  });

  /* ── POST /admin/accounts/unblock ────────────────────────────────────────── */
  app.post("/admin/accounts/unblock", async (req, reply) => {
    const parsed = unblockBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad-request" });

    const session = await requireAdmin(req);
    if (!session) return { ok: false, error: "forbidden" };
    const profileId = vUuid(parsed.data.profileId, { field: "profile" });
    if (!profileId.ok) return { ok: false, error: "not-found" };

    const result = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(profiles)
        .set({ blockedAt: null, blockedReason: null, blockedBy: null })
        // Never on an erased account: unblocking would un-suspend its tutor record.
        .where(and(eq(profiles.id, profileId.value), isNull(profiles.purgedAt)))
        .returning({ id: profiles.id });
      if (!row) return null;
      const [t] = await tx
        .update(tutors)
        .set({ suspendedAt: null })
        .where(eq(tutors.profileId, profileId.value))
        .returning({ slug: tutors.slug });
      await auditAdmin(session.profile.id, "account.unblock", { kind: "profile", id: profileId.value }, null, tx); // Phase A+ (P3)
      return { slug: t?.slug ?? null };
    });
    if (!result) return { ok: false, error: "not-found" };

    /* Classes cancelled by the block stay cancelled: students were told they would
       not happen. The tutor publishes new ones. */
    return { ok: true, ...(result.slug ? { revalidate: { tutors: [result.slug], publicTutors: true } } : {}) };
  });
}
