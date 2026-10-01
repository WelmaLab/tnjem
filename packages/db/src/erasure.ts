/* ACCOUNT ERASURE — anonymise, don't delete (production readiness, Stage 5).

   What an erased account leaves behind is decided here, in one place, and /privacy
   §3 says exactly this. The profile row stays as a TOMBSTONE with no identity
   (0022's CHECK enforces it), so nothing cascades and every record that belongs
   to SOMEONE ELSE keeps its shape.

   GONE
     identity     e-mail, phone, name, birth year, level, subjects
     access       every session and pending login code, and the password hash (0032)
     private      notifications addressed to the account; consents and guardian
                  links; messages it wrote (see KEEP_REPORTED_MESSAGES_ON_ERASURE)
     tutor        the public page (name, bio, photo, links, intro video) — hidden,
                  its slug retired so nobody can take the address over; identity
                  documents, uploaded materials and every photo (every size, every
                  earlier version: all of avatars/<tutorId>/) DELETED FROM
                  STORAGE, not only from the database
     elsewhere    the account's name in other people's notifications
                  ("Amine a réservé…" becomes "Un compte supprimé a réservé…")

   KEPT, with nothing that identifies the person
     the booking shell   who-booked-which-seat as a tombstone id: the tutor's past
                         roster, the seat count and the cancellation ledger
     reviews             the rating and text, with no byline
     reports             about or by the account (safeguarding evidence)
     a child's consent   when the account was the GUARDIAN: that consent was given,
                         when, the text and the policy version — the guardian's
                         name, phone and e-mail are erased from it (phase-a A27)
     verification trace  document kinds, dates and decision (0021)
     audit               an admin_actions row saying the erasure happened

   ORDER. Files first, then one transaction for every row. A file that cannot be
   deleted aborts THIS account's erasure before any row changes, so it is due again
   on the next run — never a tombstone pointing at a scan still on disk.

   DEFERRED while the account has an upcoming booking or class. The request path
   already refuses that; the check is repeated here because a class can be created
   during the grace period, and erasing a tutor with students booked next week would
   be a no-show dressed up as a privacy action. */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, inArray, isNotNull, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { KEEP_REPORTED_MESSAGES_ON_ERASURE, publicDisplayName } from "@tnajem/shared";
import { objectStore, storageKey, type ObjectStore } from "./storage";
import {
  adminActions, bookings, classes, consents, guardianLinks, materials, messageReports, messages,
  messageThreads, notifications, otpCodes, profiles, reports, retiredSlugs, sessions, tutors,
  verificationDocs, verificationTraces,
  tutorFollows, notificationPrefs, followDigests, // espace prof v2 · growth (P4)
  studentSubscriptions, // espace prof v2 · growth (P5)
} from "./schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ErasureDb = PostgresJsDatabase<any>;

export type ErasureReason = "requested" | "inactive";

export type ErasureResult =
  | { outcome: "erased"; filesDeleted: number; filesMissing: number }
  | { outcome: "deferred"; why: "upcoming-booking" | "upcoming-class" | "storage" }
  | { outcome: "not-found" | "already-erased" };

/** The public photo sizes (apps/api/src/lib/avatar.ts AVATAR_SIZES). */
const AVATAR_SIZE_NAMES = ["sm", "md", "lg"] as const;

/** What an erased person's name becomes inside somebody else's notification. */
export const ERASED_NAME = "Un compte supprimé";

/** The stored form of a retired slug: never the slug, which is often a name. */
export function slugHash(slug: string): string {
  return createHash("sha256").update(`tnajem:slug:${slug.trim().toLowerCase()}`).digest("hex");
}

export async function isSlugRetired(db: ErasureDb, slug: string): Promise<boolean> {
  const [row] = await db.select({ h: retiredSlugs.slugHash }).from(retiredSlugs).where(eq(retiredSlugs.slugHash, slugHash(slug))).limit(1);
  return Boolean(row);
}

export async function eraseAccount(
  db: ErasureDb,
  profileId: string,
  opts: { reason: ErasureReason; store?: ObjectStore; log?: (line: string) => void },
): Promise<ErasureResult> {
  const log = opts.log ?? (() => {});
  const [p] = await db
    .select({ id: profiles.id, fullName: profiles.fullName, email: profiles.email, phone: profiles.phone, purgedAt: profiles.purgedAt })
    .from(profiles)
    .where(eq(profiles.id, profileId))
    .limit(1);
  if (!p) return { outcome: "not-found" };
  if (p.purgedAt) return { outcome: "already-erased" };

  const [tutor] = await db.select().from(tutors).where(eq(tutors.profileId, profileId)).limit(1);

  /* ── Deferred while someone is counting on this account ─────────────────── */
  const [upcomingBooking] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(classes, eq(bookings.classId, classes.id))
    .where(and(
      eq(bookings.studentId, profileId),
      sql`coalesce(${bookings.status}, 'reserved') <> 'cancelled'`,
      gt(classes.scheduledAt, sql`now()`),
    ))
    .limit(1);
  if (upcomingBooking) return { outcome: "deferred", why: "upcoming-booking" };
  if (tutor) {
    const [upcomingClass] = await db
      .select({ id: classes.id })
      .from(classes)
      .where(and(
        eq(classes.tutorId, tutor.id),
        sql`coalesce(${classes.status}, 'scheduled') <> 'cancelled'`,
        gt(classes.scheduledAt, sql`now()`),
      ))
      .limit(1);
    if (upcomingClass) return { outcome: "deferred", why: "upcoming-class" };
  }

  /* ── Files first ─────────────────────────────────────────────────────────── */
  const docs = tutor ? await db.select().from(verificationDocs).where(eq(verificationDocs.tutorId, tutor.id)) : [];
  const files = tutor
    ? await db
        .select({ id: materials.id, storagePath: materials.storagePath })
        .from(materials)
        .where(and(eq(materials.tutorId, tutor.id), isNotNull(materials.storagePath)))
    : [];
  const keys = [
    ...docs.map((d) => d.storagePath),
    ...files.map((m) => m.storagePath as string),
    ...(tutor?.avatarPath ? AVATAR_SIZE_NAMES.map((s) => `${tutor.avatarPath}-${s}.webp`) : []),
  ];

  const store = opts.store ?? objectStore();
  let filesDeleted = 0;
  let filesMissing = 0;
  for (const key of keys) {
    try {
      storageKey(key, { legacy: true });
      if ((await store.delete(key)) === "deleted") filesDeleted++;
      else filesMissing++;
    } catch (e) {
      log(`erasure: profile ${profileId} deferred — a stored file could not be deleted (${(e as { code?: string }).code ?? (e as Error).name})`);
      return { outcome: "deferred", why: "storage" };
    }
  }
  /* phase-a lane L4 (A11): EVERY photo, not only the current one. Replacing a photo
     used to leave the previous one in storage with no row pointing at it, so the
     current avatar_path was never the whole story. Same rule as above: a failure
     defers the erasure before any row changes. */
  if (tutor) {
    try {
      filesDeleted += (await store.deletePrefix(`avatars/${tutor.id}`)).deleted;
    } catch (e) {
      log(`erasure: profile ${profileId} deferred — stored photos could not be deleted (${(e as { code?: string }).code ?? (e as Error).name})`);
      return { outcome: "deferred", why: "storage" };
    }
  }
  if (tutor) {
    for (const prefix of [`verification/${tutor.id}`, `materials/${tutor.id}`, `avatars/${tutor.id}`]) {
      await store.pruneEmpty(prefix).catch(() => {});
    }
  }

  /* ── Every row, in one transaction ───────────────────────────────────────── */
  const fullName = p.fullName?.trim() || null;
  const displayName = publicDisplayName(fullName);

  await db.transaction(async (tx) => {
    // Who this account dealt with: the only people whose notifications can name it.
    const counterparties = new Set<string>();
    const asStudent = await tx
      .select({ tutorProfileId: tutors.profileId })
      .from(bookings)
      .innerJoin(classes, eq(bookings.classId, classes.id))
      .innerJoin(tutors, eq(classes.tutorId, tutors.id))
      .where(eq(bookings.studentId, profileId));
    for (const r of asStudent) if (r.tutorProfileId) counterparties.add(r.tutorProfileId);
    if (tutor) {
      const asTutor = await tx
        .select({ studentId: bookings.studentId })
        .from(bookings)
        .innerJoin(classes, eq(bookings.classId, classes.id))
        .where(eq(classes.tutorId, tutor.id));
      for (const r of asTutor) counterparties.add(r.studentId);
    }
    counterparties.delete(profileId);

    /* Other people's notifications that name this account. Rows written since 0022
       say who they are about; older rows are matched by the full name among the
       account's counterparties only. */
    const replaceName = (column: typeof notifications.body, name: string) =>
      sql`replace(${column}, ${name}, ${ERASED_NAME})`;
    if (displayName) {
      await tx
        .update(notifications)
        .set({ body: replaceName(notifications.body, fullName ?? displayName) })
        .where(and(eq(notifications.aboutProfileId, profileId), ne(notifications.profileId, profileId)));
      await tx
        .update(notifications)
        .set({ body: replaceName(notifications.body, displayName) })
        .where(and(eq(notifications.aboutProfileId, profileId), ne(notifications.profileId, profileId)));
    }
    if (fullName && counterparties.size > 0) {
      await tx
        .update(notifications)
        .set({ body: replaceName(notifications.body, fullName) })
        .where(and(
          inArray(notifications.profileId, [...counterparties]),
          isNull(notifications.aboutProfileId),
          sql`position(${fullName} in ${notifications.body}) > 0`,
        ));
    }
    await tx.update(notifications).set({ aboutProfileId: null }).where(eq(notifications.aboutProfileId, profileId));
    await tx.delete(notifications).where(eq(notifications.profileId, profileId));

    /* Messages the account wrote. A reported one survives as evidence
       (LEGAL-REVIEW in @tnajem/shared/legal); its author is already a tombstone. */
    const reported = tx.select({ id: messageReports.messageId }).from(messageReports);
    await tx
      .delete(messages)
      .where(KEEP_REPORTED_MESSAGES_ON_ERASURE
        ? and(eq(messages.senderProfileId, profileId), notInArray(messages.id, reported))
        : eq(messages.senderProfileId, profileId));

    /* phase-a lane L4 (A27): THE GUARDIAN IN THEIR CHILD'S CONSENT RECORD. The
       consent belongs to the child (minor_id) and survives the parent's erasure —
       but it carried the parent's name, phone and e-mail, so "your name and phone
       are erased" was untrue for every parent. The person goes; the record that
       consent was given, when, and under which policy version and text, stays.
       Found by the link, by the address (how a link resolves) and by the number.
       Erasing an account is not withdrawing consent: withdrawn_at is untouched.
       LEGAL-REVIEW: retention of consent proof — how long an anonymised consent
       record is kept, and whether it still proves consent once the signer is
       unidentifiable, is not decided. */
    const linkedConsents = tx
      .select({ id: guardianLinks.consentId })
      .from(guardianLinks)
      .where(and(eq(guardianLinks.guardianProfileId, profileId), isNotNull(guardianLinks.consentId)));
    const byGuardian = [
      inArray(consents.id, linkedConsents),
      ...(p.email ? [sql`lower(${consents.guardianEmail}) = lower(${p.email})`] : []),
      ...(p.phone ? [eq(consents.guardianPhone, p.phone)] : []),
    ];
    await tx
      .update(consents)
      .set({ guardianName: ERASED_NAME, guardianPhone: "", guardianEmail: null })
      .where(and(or(...byGuardian), ne(consents.minorId, profileId)));

    await tx.delete(guardianLinks).where(or(eq(guardianLinks.guardianProfileId, profileId), eq(guardianLinks.minorProfileId, profileId)));
    await tx.delete(consents).where(eq(consents.minorId, profileId));
    await tx.delete(sessions).where(eq(sessions.profileId, profileId));
    /* espace prof v2 · growth (P4): whom this account followed, who followed its
       page, and its e-mail switches — personal data with nothing to keep. */
    await tx.delete(tutorFollows).where(eq(tutorFollows.studentProfileId, profileId));
    if (tutor) await tx.delete(tutorFollows).where(eq(tutorFollows.tutorId, tutor.id));
    await tx.delete(notificationPrefs).where(eq(notificationPrefs.profileId, profileId));
    await tx.delete(followDigests).where(eq(followDigests.profileId, profileId));
    /* espace prof v2 · growth (P5): a live monthly subscription on either side ends
       with the account. The rows stay (what was agreed, as the ledger keeps its rows),
       pointing at a tombstone. */
    const liveSub = inArray(studentSubscriptions.status, ["requested", "active", "paused"]);
    await tx.update(studentSubscriptions).set({ status: "cancelled", cancelledAt: sql`now()` })
      .where(and(liveSub, eq(studentSubscriptions.studentProfileId, profileId)));
    if (tutor) {
      await tx.update(studentSubscriptions).set({ status: "cancelled", cancelledAt: sql`now()` })
        .where(and(liveSub, eq(studentSubscriptions.tutorId, tutor.id)));
    }
    const identifiers = [p.email, p.phone].filter((x): x is string => Boolean(x));
    if (identifiers.length) await tx.delete(otpCodes).where(inArray(otpCodes.identifier, identifiers));
    if (p.email) await tx.update(reports).set({ reporterEmail: null }).where(eq(reports.reporterEmail, p.email));

    if (tutor) {
      for (const d of docs) {
        await tx.insert(verificationTraces).values({
          tutorId: tutor.id,
          kind: d.kind,
          uploadedAt: d.createdAt,
          decision: tutor.status,
          decidedAt: tutor.reviewedAt,
          reason: "account-erased",
        });
      }
      await tx.delete(verificationDocs).where(eq(verificationDocs.tutorId, tutor.id));
      await tx
        .update(materials)
        .set({
          storagePath: null,
          fileName: null,
          removedAt: sql`coalesce(${materials.removedAt}, now())`,
          removedReason: sql`coalesce(${materials.removedReason}, 'account-erased')`,
        })
        .where(eq(materials.tutorId, tutor.id));
      await tx.insert(retiredSlugs).values({ slugHash: slugHash(tutor.slug) }).onConflictDoNothing();
      await tx
        .update(tutors)
        .set({
          slug: `supprime-${randomBytes(6).toString("hex")}`,
          fullName: "",
          pendingFullName: null, // phase-a lane L4 (A26): a requested name is a name too
          bio: null,
          avatarPath: null,
          avatarStatus: null,
          avatarUpdatedAt: null,
          introVideoUrl: null,
          experienceYears: null,
          institution: null,
          languages: null,
          pitch: null,
          linkedinUrl: null,
          instagramUrl: null,
          tiktokUrl: null,
          youtubeUrl: null,
          facebookUrl: null,
          websiteUrl: null,
          reviewNote: null,
          payoutMethod: null,
          suspendedAt: sql`coalesce(${tutors.suspendedAt}, now())`,
          erasedAt: sql`now()`,
        })
        .where(eq(tutors.id, tutor.id));
    }

    // Threads stay (the other side's history); nothing in them names anyone.
    await tx.update(messageThreads).set({ lastMessageAt: sql`(select max(${messages.createdAt}) from ${messages} where ${messages.threadId} = ${messageThreads.id})` })
      .where(or(eq(messageThreads.studentProfileId, profileId), eq(messageThreads.tutorProfileId, profileId)));

    await tx
      .update(profiles)
      .set({
        email: null,
        phone: null,
        fullName: null,
        birthYear: null,
        birthMonth: null, // phase-a lane L2 (A24): 0025's profiles_purged_has_no_birth_month
        // espace prof v2 · auth: 0032's profiles_purged_has_no_password — the hash goes with the account.
        passwordHash: null,
        passwordSetAt: null,
        passwordPromptedAt: null,
        level: null,
        subjects: null,
        deletionStatus: "purged",
        purgedAt: sql`now()`,
      })
      .where(eq(profiles.id, profileId));

    await tx.insert(adminActions).values({
      adminProfileId: null,
      action: "account.erased",
      subjectKind: "profile",
      subjectId: profileId,
      note: opts.reason,
    });
  });

  log(`erasure: profile ${profileId} erased (${opts.reason}) files=${filesDeleted} already-gone=${filesMissing}`);
  return { outcome: "erased", filesDeleted, filesMissing };
}

/** Accounts unused for longer than the window, oldest first. Admins are never due. */
export async function inactiveAccountsDue(
  db: ErasureDb,
  opts: { retentionDays: number; excludeEmails: string[]; limit?: number },
): Promise<{ id: string }[]> {
  const cutoff = new Date(Date.now() - opts.retentionDays * 86_400_000);
  return db
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(
      isNull(profiles.purgedAt),
      lt(profiles.lastSeenAt, cutoff),
      opts.excludeEmails.length
        ? or(isNull(profiles.email), notInArray(profiles.email, opts.excludeEmails))
        : undefined,
    ))
    .orderBy(profiles.lastSeenAt)
    .limit(opts.limit ?? 200);
}
