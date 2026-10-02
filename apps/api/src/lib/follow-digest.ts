import {
  and, eq, gt, inArray, isNull, lte, lt, sql as raw,
  classes, consents, followDigests, packs, profiles, tutorFollows, tutors,
  notify, wantsEmail,
} from "@tnajem/db";
import { isAdult, minorsAllowed, publicDisplayName, publicTutorName } from "@tnajem/shared";
import { digestLine, type DigestItem } from "@tnajem/shared/notification-messages";
import { sendMail, type MailExtras } from "@tnajem/shared/mail";
import { listUnsubscribeHeaders, siteUrl, unsubscribeUrl } from "@tnajem/shared/unsubscribe";
import { onSaleClassSql } from "./class-sale";
import type { db as appDb } from "../db";

/* THE FOLLOWERS DIGEST — Espace prof v2 · Phase 4.

   "Followers: an in-app notification and an e-mail when the teacher publishes a
   new class or fiche (pack), sent at most once a day as a digest. Every e-mail has
   a one-click unsubscribe link."

   Nightly, inside /cron/purge (lib/growth-cron.ts). For every follower with news:

     • in-app: ONE notification per tutor with news (it names that tutor, so
       aboutProfileId lets an erasure rewrite it — one row cannot name two people);
     • e-mail: ONE digest for all of them, if the person has an address and has
       not switched "followers" off (wantsEmail), with List-Unsubscribe headers and
       the footer link (packages/shared/src/unsubscribe.ts);
     • the cursors advance: tutor_follows.notified_through = the run's start, so
       nothing is announced twice and a new follow never announces the back
       catalogue; follow_digests.last_sent_at makes it AT MOST ONE A DAY even if
       the job runs twice.

   "New" = created since the cursor AND still worth announcing: a class still on
   sale (not started, not cancelled) of a tutor who is public; a pack of a public
   tutor. MINORS: the booking rule — only with ALLOW_MINORS on and a live guardian
   consent; otherwise nothing is sent and the cursor still moves (stale news is no
   news). Blocked, erased or deleting accounts get nothing. */

type Db = typeof appDb;
export type MailSender = (to: string, subject: string, text: string, extras?: MailExtras) => Promise<boolean>;
export type DigestOptions = { dryRun?: boolean; log?: (line: string) => void; now?: Date; send?: MailSender };
export type DigestResult = { due: number; notified: number; emailed: number; tooSoon: number; ineligible: number };

/** A digest at most once a day; 20h so a nightly job that drifts an hour still sends. */
const MIN_GAP_MS = 20 * 3600_000;

/** The database's now(), as text to the MICROSECOND — the precision created_at has.
    A JS Date would truncate to the millisecond and skip a row created in the same
    millisecond as the run. (drizzle hands raw execute() values back as text.) */
export async function dbNow(db: Db): Promise<string> {
  const rows = (await db.execute(
    raw`select to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as now`,
  )) as unknown as { now: string }[];
  return rows[0].now;
}

type Item = {
  studentId: string;
  tutorId: string;
  tutorProfileId: string | null;
  slug: string;
  tutorName: string;
  kind: "class" | "pack";
  id: string;
  title: string;
  at: Date | null;
};

/** A class or fiche as a notification parameter: the instant travels as ISO, rendered by the reader. */
const digestItem = (it: Item): DigestItem =>
  it.kind === "class" && it.at ? { type: "class", title: it.title, at: it.at.toISOString() } : { type: "pack", title: it.title };

const COPY = {
  fr: {
    subject: "Du nouveau chez tes profs sur Tnajem",
    hello: (n: string | null) => (n ? `Bonjour ${n},` : "Bonjour,"),
    lead: "Du nouveau chez les profs que tu suis sur Tnajem :",
    why: "Tu reçois cet e-mail parce que tu suis ces profs sur Tnajem (au plus un par jour).",
    stop: "Ne plus recevoir ces e-mails :",
  },
  ar: {
    subject: "جديد أساتذتك على Tnajem",
    hello: (n: string | null) => (n ? `عسلامة ${n}،` : "عسلامة،"),
    lead: "فما جديد عند الأساتذة اللي تتبع فيهم على Tnajem :",
    why: "توصلك الرسالة هاذي خاطر تتبع الأساتذة هاذوما على Tnajem (مرّة في النهار على الأكثر).",
    stop: "باش ما عادش توصلك :",
  },
} as const;

export async function runFollowDigest(db: Db, opts: DigestOptions = {}): Promise<DigestResult> {
  const log = opts.log ?? (() => {});
  /* The DATABASE clock: the cursors are compared to created_at, which the database
     wrote. An app clock a second behind would skip a class made that second. */
  const startText = opts.now ? opts.now.toISOString() : await dbNow(db);
  const runStart = new Date(startText); // for the once-a-day arithmetic only
  const runStartSql = raw`${startText}::timestamptz`;
  const send = opts.send ?? sendMail;
  const publicTutor = and(eq(tutors.status, "verified"), isNull(tutors.suspendedAt), isNull(tutors.erasedAt));

  const newClasses = await db
    .select({
      studentId: tutorFollows.studentProfileId, tutorId: tutors.id, tutorProfileId: tutors.profileId,
      slug: tutors.slug, tutorName: tutors.fullName, id: classes.id, title: classes.title, at: classes.scheduledAt,
    })
    .from(tutorFollows)
    .innerJoin(tutors, eq(tutors.id, tutorFollows.tutorId))
    .innerJoin(classes, and(
      eq(classes.tutorId, tutorFollows.tutorId),
      gt(classes.createdAt, tutorFollows.notifiedThrough),
      lte(classes.createdAt, runStartSql),
    ))
    .where(and(publicTutor, onSaleClassSql))
    .limit(5000);
  const newPacks = await db
    .select({
      studentId: tutorFollows.studentProfileId, tutorId: tutors.id, tutorProfileId: tutors.profileId,
      slug: tutors.slug, tutorName: tutors.fullName, id: packs.id, title: packs.title,
    })
    .from(tutorFollows)
    .innerJoin(tutors, eq(tutors.id, tutorFollows.tutorId))
    .innerJoin(packs, and(
      eq(packs.tutorId, tutorFollows.tutorId),
      gt(packs.createdAt, tutorFollows.notifiedThrough),
      lte(packs.createdAt, runStartSql),
    ))
    .where(publicTutor)
    .limit(5000);

  const byStudent = new Map<string, Item[]>();
  const add = (it: Item) => byStudent.set(it.studentId, [...(byStudent.get(it.studentId) ?? []), it]);
  for (const r of newClasses) add({ ...r, kind: "class", at: new Date(r.at) });
  for (const r of newPacks) add({ ...r, kind: "pack", at: null });

  const result: DigestResult = { due: byStudent.size, notified: 0, emailed: 0, tooSoon: 0, ineligible: 0 };
  if (opts.dryRun || byStudent.size === 0) {
    log(`follow-digest${opts.dryRun ? " (dry-run)" : ""}: due=${byStudent.size}`);
    return result;
  }

  const ids = [...byStudent.keys()];
  const people = await db
    .select({
      id: profiles.id, email: profiles.email, locale: profiles.locale, fullName: profiles.fullName,
      birthYear: profiles.birthYear, birthMonth: profiles.birthMonth,
      blockedAt: profiles.blockedAt, purgedAt: profiles.purgedAt, deletionStatus: profiles.deletionStatus,
    })
    .from(profiles)
    .where(inArray(profiles.id, ids));
  const lastSent = new Map(
    (await db.select().from(followDigests).where(inArray(followDigests.profileId, ids))).map((r) => [r.profileId, new Date(r.lastSentAt)]),
  );
  const withConsent = new Set(
    (await db.select({ id: consents.minorId }).from(consents).where(and(inArray(consents.minorId, ids), isNull(consents.withdrawnAt)))).map((r) => r.id),
  );

  const advance = (studentId: string) =>
    db.update(tutorFollows)
      .set({ notifiedThrough: runStartSql })
      .where(and(eq(tutorFollows.studentProfileId, studentId), lt(tutorFollows.notifiedThrough, runStartSql)));

  for (const p of people) {
    const items = byStudent.get(p.id) ?? [];
    const last = lastSent.get(p.id);
    if (last && runStart.getTime() - last.getTime() < MIN_GAP_MS) {
      result.tooSoon++; // the cursor stays: tomorrow's digest carries these
      continue;
    }
    const minorOk = isAdult(p.birthYear, p.birthMonth) || (minorsAllowed() && withConsent.has(p.id));
    if (p.blockedAt || p.purgedAt || p.deletionStatus === "requested" || !minorOk) {
      result.ineligible++;
      await advance(p.id);
      continue;
    }

    // Classes in date order, then fiches; grouped per tutor for the in-app rows.
    items.sort((a, b) => (a.kind === b.kind ? (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0) : a.kind === "class" ? -1 : 1));
    const perTutor = new Map<string, Item[]>();
    for (const it of items) perTutor.set(it.tutorId, [...(perTutor.get(it.tutorId) ?? []), it]);

    for (const list of perTutor.values()) {
      const t = list[0];
      await notify(db, p.id, {
        key: "followDigest",
        params: { who: publicTutorName(t.tutorName), items: list.slice(0, 3).map(digestItem), more: Math.max(0, list.length - 3) },
        href: list.length === 1 && t.kind === "class" ? `/class/${t.id}` : `/${t.slug}`,
        aboutProfileId: t.tutorProfileId, // names the tutor: rewritten if that account is erased
      });
      result.notified++;
    }

    if (p.email && (await wantsEmail(db, p.id, "followers"))) {
      const loc = p.locale === "ar" ? "ar" : "fr";
      const c = COPY[loc];
      const site = siteUrl();
      const body = [
        c.hello(publicDisplayName(p.fullName)),
        "",
        c.lead,
        "",
        ...items.flatMap((it) => {
          // The same line the bell shows (@tnajem/shared/notification-messages), after the tutor's name.
          const who = publicTutorName(it.tutorName) ?? "";
          const line = `• ${who ? `${who} — ` : ""}${digestLine(digestItem(it), loc)}`;
          return it.kind === "class" && it.at ? [line, `  ${site}/${loc}/class/${it.id}`] : [line, `  ${site}/${loc}/${it.slug}`];
        }),
        "",
        "—",
        c.why,
        `${c.stop} ${unsubscribeUrl(p.id, "followers")}`,
      ].join("\n");
      if (await send(p.email, c.subject, body, { headers: listUnsubscribeHeaders(p.id, "followers") })) result.emailed++;
    }

    await advance(p.id);
    await db
      .insert(followDigests)
      .values({ profileId: p.id, lastSentAt: raw`now()` })
      .onConflictDoUpdate({ target: followDigests.profileId, set: { lastSentAt: raw`now()` } });
  }

  log(`follow-digest: due=${result.due} notified=${result.notified} emailed=${result.emailed} too-soon=${result.tooSoon} ineligible=${result.ineligible}`);
  return result;
}
