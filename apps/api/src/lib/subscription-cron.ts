import {
  and, eq, gt, inArray, lte, sql as raw,
  profiles, studentSubscriptions, tutorOffers, tutors,
  notify, wantsEmail,
} from "@tnajem/db";
import { MONTHLY_PAYMENT_NOTE, publicDisplayName, publicTutorName } from "@tnajem/shared";
import { renderMessage } from "@tnajem/shared/notification-messages";
import { sendMail } from "@tnajem/shared/mail";
import { listUnsubscribeHeaders, siteUrl, unsubscribeUrl } from "@tnajem/shared/unsubscribe";
import type { db as appDb } from "../db";
import type { MailSender } from "./follow-digest";

/* THE MONTHLY-SUBSCRIPTION SWEEP — Espace prof v2 · Phase 5 A.4, inside the nightly
   /cron/purge run (lib/growth-cron.ts).

     expire   active or paused, past period_end → expired; both sides told in-app.
     remind   active, ending within 3 days, not yet reminded FOR THIS period_end →
              the student in-app + e-mail (if "reminders" is on, with one-click
              unsubscribe), the tutor in-app. A renewal moves period_end and resets
              reminder_sent_for, so the next month gets its own reminder.

   Both flip the row FIRST (UPDATE … RETURNING) and notify from what came back, so a
   job that runs twice cannot announce one event twice. Payments are off: the
   reminder says plainly that the student settles with the tutor directly, beside
   "online payment soon" — the spec's own sentence (MONTHLY_PAYMENT_NOTE). */

type Db = typeof appDb;
export type SubscriptionJobOptions = { dryRun?: boolean; log?: (line: string) => void; send?: MailSender };

const REMINDER = {
  fr: {
    subject: "Ton abonnement se termine bientôt",
    hello: (n: string | null) => (n ? `Bonjour ${n},` : "Bonjour,"),
    stop: "Ne plus recevoir ces rappels :",
  },
  ar: {
    subject: "الاشتراك متاعك قريب يوفى",
    hello: (n: string | null) => (n ? `عسلامة ${n}،` : "عسلامة،"),
    stop: "باش ما عادش توصلك التذكيرات هاذي :",
  },
} as const;

export async function runSubscriptionJobs(db: Db, opts: SubscriptionJobOptions = {}): Promise<{ expired: number; reminded: number; emailed: number }> {
  const log = opts.log ?? (() => {});
  const send = opts.send ?? sendMail;
  const due = and(inArray(studentSubscriptions.status, ["active", "paused"]), lte(studentSubscriptions.periodEnd, raw`now()`));
  const remind = and(
    eq(studentSubscriptions.status, "active"),
    gt(studentSubscriptions.periodEnd, raw`now()`),
    lte(studentSubscriptions.periodEnd, raw`now() + interval '3 days'`),
    raw`${studentSubscriptions.reminderSentFor} is distinct from ${studentSubscriptions.periodEnd}`,
  );

  if (opts.dryRun) {
    const [{ e }] = await db.select({ e: raw<number>`count(*)::int` }).from(studentSubscriptions).where(due);
    const [{ r }] = await db.select({ r: raw<number>`count(*)::int` }).from(studentSubscriptions).where(remind);
    log(`subscriptions (dry-run): expire=${e} remind=${r}`);
    return { expired: 0, reminded: 0, emailed: 0 };
  }

  const expired = await db.update(studentSubscriptions)
    .set({ status: "expired", updatedAt: raw`now()` })
    .where(due)
    .returning();
  const reminded = await db.update(studentSubscriptions)
    .set({ reminderSentFor: raw`${studentSubscriptions.periodEnd}` })
    .where(remind)
    .returning();

  const ids = [...new Set([...expired, ...reminded].flatMap((s) => [s.offerId]))];
  const offers = new Map((ids.length ? await db.select({ id: tutorOffers.id, title: tutorOffers.title }).from(tutorOffers).where(inArray(tutorOffers.id, ids)) : []).map((o) => [o.id, o.title]));
  const tutorIds = [...new Set([...expired, ...reminded].map((s) => s.tutorId))];
  const tutorRows = new Map((tutorIds.length ? await db.select().from(tutors).where(inArray(tutors.id, tutorIds)) : []).map((t) => [t.id, t]));
  const studentIds = [...new Set([...expired, ...reminded].map((s) => s.studentProfileId))];
  const people = new Map((studentIds.length ? await db.select().from(profiles).where(inArray(profiles.id, studentIds)) : []).map((p) => [p.id, p]));

  for (const s of expired) {
    const t = tutorRows.get(s.tutorId);
    const title = offers.get(s.offerId) ?? "";
    const student = people.get(s.studentProfileId);
    await notify(db, s.studentProfileId, {
      key: "subscriptionExpiredStudent",
      params: { who: publicTutorName(t?.fullName), offerTitle: title },
      href: t ? `/${t.slug}` : "/student",
      aboutProfileId: t?.profileId ?? null,
    });
    if (t?.profileId) {
      await notify(db, t.profileId, {
        key: "subscriptionExpiredTutor",
        params: { who: publicDisplayName(student?.fullName), offerTitle: title },
        href: "/dashboard/subscriptions",
        aboutProfileId: s.studentProfileId,
      });
    }
  }

  let emailed = 0;
  for (const s of reminded) {
    const t = tutorRows.get(s.tutorId);
    const title = offers.get(s.offerId) ?? "";
    const student = people.get(s.studentProfileId);
    const until = new Date(s.periodEnd as Date).toISOString();
    const forStudent = { who: publicTutorName(t?.fullName), offerTitle: title, until };
    await notify(db, s.studentProfileId, {
      key: "subscriptionEndingStudent",
      params: forStudent,
      href: t ? `/${t.slug}` : "/student",
      aboutProfileId: t?.profileId ?? null,
    });
    if (t?.profileId) {
      await notify(db, t.profileId, {
        key: "subscriptionEndingTutor",
        params: { who: publicDisplayName(student?.fullName), offerTitle: title, until },
        href: "/dashboard/subscriptions",
        aboutProfileId: s.studentProfileId,
      });
    }
    if (student?.email && !student.purgedAt && !student.blockedAt && (await wantsEmail(db, student.id, "reminders"))) {
      const loc = student.locale === "ar" ? "ar" : "fr";
      const c = REMINDER[loc];
      const text = [
        c.hello(publicDisplayName(student.fullName)),
        "",
        // The bell's sentence, in the student's language (@tnajem/shared/notification-messages).
        renderMessage("subscriptionEndingStudent", forStudent, loc).body,
        t ? `${siteUrl()}/${loc}/${t.slug}` : "",
        "",
        MONTHLY_PAYMENT_NOTE[loc],
        "",
        "—",
        `${c.stop} ${unsubscribeUrl(student.id, "reminders")}`,
      ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
      if (await send(student.email, c.subject, text, { headers: listUnsubscribeHeaders(student.id, "reminders") })) emailed++;
    }
  }

  log(`subscriptions: expired=${expired.length} reminded=${reminded.length} emailed=${emailed}`);
  return { expired: expired.length, reminded: reminded.length, emailed };
}
