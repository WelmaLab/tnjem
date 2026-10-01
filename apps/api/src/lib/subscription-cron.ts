import {
  and, eq, gt, inArray, lte, sql as raw,
  profiles, studentSubscriptions, tutorOffers, tutors,
  notify, wantsEmail,
} from "@tnajem/db";
import { MONTHLY_PAYMENT_NOTE, formatNumericDate, publicDisplayName, publicTutorName } from "@tnajem/shared";
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
    body: (title: string, tutor: string, end: string) =>
      `Ton abonnement « ${title} » avec ${tutor} se termine le ${end}.\nPour continuer, vois avec ton prof : il le renouvelle en un clic sur Tnajem dès qu'il a reçu ton paiement.`,
    stop: "Ne plus recevoir ces rappels :",
  },
  ar: {
    subject: "الاشتراك متاعك قريب يوفى",
    hello: (n: string | null) => (n ? `عسلامة ${n}،` : "عسلامة،"),
    body: (title: string, tutor: string, end: string) =>
      `الاشتراك متاعك « ${title} » مع ${tutor} يوفى نهار ${end}.\nباش تكمّل، تفاهم مع أستاذك : يجدّدو بكليك وحدة على Tnajem كيف يوصلو الخلاص متاعك.`,
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
      kind: "subscription_expired",
      title: "Abonnement terminé",
      body: `Ton abonnement « ${title} »${t ? ` avec ${publicTutorName(t.fullName)}` : ""} est arrivé à son terme. Ton prof peut le renouveler en un clic.`,
      href: t ? `/${t.slug}` : "/student",
      aboutProfileId: t?.profileId ?? null,
    });
    if (t?.profileId) {
      await notify(db, t.profileId, {
        kind: "subscription_expired",
        title: "Abonnement terminé",
        body: `L'abonnement de ${publicDisplayName(student?.fullName) ?? "ton élève"} (« ${title} ») est arrivé à son terme. Renouvelle-le en un clic quand tu as reçu le paiement.`,
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
    const end = formatNumericDate(s.periodEnd as Date);
    const tutorName = publicTutorName(t?.fullName) ?? "";
    await notify(db, s.studentProfileId, {
      kind: "subscription_ending",
      title: "Abonnement : fin dans 3 jours",
      body: `Ton abonnement « ${title} »${tutorName ? ` avec ${tutorName}` : ""} se termine le ${end}. Pour continuer, vois avec ton prof : il le renouvelle en un clic.`,
      href: t ? `/${t.slug}` : "/student",
      aboutProfileId: t?.profileId ?? null,
    });
    if (t?.profileId) {
      await notify(db, t.profileId, {
        kind: "subscription_ending",
        title: "Abonnement : fin dans 3 jours",
        body: `L'abonnement de ${publicDisplayName(student?.fullName) ?? "ton élève"} (« ${title} ») se termine le ${end}.`,
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
        c.body(title, tutorName, end),
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
