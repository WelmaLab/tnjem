import { and, eq, inArray, sql as raw, bookings, classes, profiles, promotions, tutors } from "@tnajem/db";
import { siteUrl } from "@tnajem/shared/unsubscribe";
import {
  buildIcs, icsContentType, icsSequence, formatNumericDate, tunisClock,
  publicDisplayName, publicTutorName,
  type IcsMethod,
} from "@tnajem/shared";
import { DEFAULT_CLASS_DURATION_MIN } from "@tnajem/shared/live";
import { mailEnabled, sendMail, type MailExtras } from "@tnajem/shared/mail";
import { logEvent } from "@tnajem/shared/observability";
import { db } from "../db";
import { BOOKING_MAIL, mailLocale, type CancelOutcome, type Coverage, type MailClass, type MailLocale, type MailText } from "./booking-mail-copy";
import { mayEmail, unsubscribeFor, type MailPref } from "./notification-prefs-adapter";

/* THE BOOKING EMAILS — who gets what, with which .ics (espace prof v2 · phase 7).

   Copy lives in ./booking-mail-copy.ts; this file reads the rows, picks each
   recipient's language, asks the preference seam (./notification-prefs-adapter.ts)
   and sends. The in-app notifications (notify()) stay where they are: this is the
   second channel, not a replacement.

   NEVER THROWS INTO A CALLER, and never runs inside a write transaction: a booking
   that committed stays committed if Gmail is slow. Request paths use dispatchMail(),
   which runs the job after the response without awaiting it; the reminder cron
   awaits it directly.

   NEVER LOGS AN ADDRESS. Failures go to logEvent with a kind and an error code. */

/* ── Links ───────────────────────────────────────────────────────────────── */

/* The public site, for links in emails: the one origin every email uses
   (NEXT_PUBLIC_SITE_URL, @tnajem/shared/unsubscribe — growth's C5 helper). */
export { siteUrl };

export const mailLinks = {
  /** The Tnajem live page — it re-checks the booking on every visit (GET /classes/:id/join). */
  live: (loc: MailLocale, classId: string) => `${siteUrl()}/${loc}/live/${classId}`,
  /** The web app's pass-through to GET /bookings/:id/calendar.ics (session required). */
  calendar: (loc: MailLocale, bookingId: string) => `${siteUrl()}/api/calendar/${bookingId}?l=${loc}`,
  studentSpace: (loc: MailLocale) => `${siteUrl()}/${loc}/student`,
  explore: (loc: MailLocale) => `${siteUrl()}/${loc}/explore`,
  tutorClasses: (loc: MailLocale) => `${siteUrl()}/${loc}/dashboard/classes`,
};

function host(): string {
  try {
    return new URL(siteUrl()).hostname || "tnajem.com";
  } catch {
    return "tnajem.com";
  }
}

/* ── The calendar entries ────────────────────────────────────────────────── */

export type IcsClass = {
  id: string;
  title: string;
  scheduledAt: Date | string;
  durationMin: number | null;
  rescheduledAt: Date | string | null;
  createdAt?: Date | string | null;
};

const ms = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : 0);

function organizer(): { name: string; email: string } | null {
  const email = process.env.MAIL_FROM_ADDRESS?.trim();
  return email ? { name: "Tnajem", email } : null;
}

/* SEQUENCE: the revision that produced this version of the event. A cancellation
   is always at least one above the last published version. */
function sequenceFor(method: IcsMethod, revision: number, now: number): number {
  return method === "CANCEL" ? Math.max(icsSequence(now), icsSequence(revision) + 1) : icsSequence(revision);
}

/** The STUDENT's entry for one booking. UID per booking, so a move updates it and a cancel removes it. */
export function studentBookingIcs(input: {
  bookingId: string;
  bookedAt: Date | string;
  cls: IcsClass;
  tutorName: string;
  loc: MailLocale;
  method: IcsMethod;
  now?: number;
}): string {
  const now = input.now ?? Date.now();
  const c = BOOKING_MAIL[input.loc];
  const live = mailLinks.live(input.loc, input.cls.id);
  return buildIcs(
    {
      uid: `booking-${input.bookingId}@${host()}`,
      sequence: sequenceFor(input.method, Math.max(ms(input.bookedAt), ms(input.cls.rescheduledAt)), now),
      start: input.cls.scheduledAt,
      durationMin: input.cls.durationMin ?? DEFAULT_CLASS_DURATION_MIN,
      summary: c.icsSummary(input.cls.title, input.tutorName),
      description: c.icsDescription(live),
      location: c.icsLocation,
      url: live,
      organizer: organizer(),
      stamp: now,
    },
    input.method,
  );
}

/** The TUTOR's entry for one class — one per class, however many students booked. */
export function tutorClassIcs(input: { cls: IcsClass; loc: MailLocale; method: IcsMethod; now?: number }): string {
  const now = input.now ?? Date.now();
  const c = BOOKING_MAIL[input.loc];
  const live = mailLinks.live(input.loc, input.cls.id);
  return buildIcs(
    {
      uid: `class-${input.cls.id}@${host()}`,
      sequence: sequenceFor(input.method, Math.max(ms(input.cls.createdAt), ms(input.cls.rescheduledAt)), now),
      start: input.cls.scheduledAt,
      durationMin: input.cls.durationMin ?? DEFAULT_CLASS_DURATION_MIN,
      summary: c.icsTutorSummary(input.cls.title),
      description: c.icsDescription(live),
      location: c.icsLocation,
      url: live,
      organizer: organizer(),
      stamp: now,
    },
    input.method,
  );
}

export const ICS_FILENAME = "tnajem-seance.ics";

function icsAttachment(ics: string, method: IcsMethod): NonNullable<MailExtras["attachments"]>[number] {
  return { filename: ICS_FILENAME, content: ics, contentType: icsContentType(method) };
}

/* ── Delivery ────────────────────────────────────────────────────────────── */

type Deliver = (to: string, subject: string, text: string, extras?: MailExtras) => Promise<boolean>;

/* The API tests capture mail here instead of an SMTP server (no provider is ever
   configured in a lane or in CI). Production never sets it. */
let testDelivery: Deliver | null = null;
export function setMailDeliveryForTests(fn: Deliver | null): void {
  testDelivery = fn;
}

/** Is there anywhere for mail to go? With no provider configured, nothing is sent and nothing is claimed. */
export function mailDeliveryAvailable(): boolean {
  return testDelivery !== null || mailEnabled();
}

export type SendResult = "sent" | "skipped" | "failed";

export type Recipient = { id: string; email: string; locale: MailLocale; first: string | null };

type ProfileRow = {
  id: string;
  email: string | null;
  locale: string;
  fullName: string | null;
  blockedAt: Date | null;
  purgedAt: Date | null;
};

async function loadProfile(profileId: string | null | undefined): Promise<ProfileRow | null> {
  if (!profileId) return null;
  const [p] = await db
    .select({
      id: profiles.id,
      email: profiles.email,
      locale: profiles.locale,
      fullName: profiles.fullName,
      blockedAt: profiles.blockedAt,
      purgedAt: profiles.purgedAt,
    })
    .from(profiles)
    .where(eq(profiles.id, profileId))
    .limit(1);
  return p ?? null;
}

/** Someone we may write to: an address on file, not blocked, not erased. */
function asRecipient(p: ProfileRow | null): Recipient | null {
  if (!p || !p.email || p.blockedAt || p.purgedAt) return null;
  return { id: p.id, email: p.email, locale: mailLocale(p.locale), first: publicDisplayName(p.fullName) };
}

export async function recipientOf(profileId: string | null | undefined): Promise<Recipient | null> {
  return asRecipient(await loadProfile(profileId));
}

/** Preference check → copy (with the unsubscribe link, once C5 provides one) → send. */
export async function deliverTo(
  to: Recipient,
  pref: MailPref,
  build: (unsubscribeUrl: string | null) => MailText,
  attachment?: { ics: string; method: IcsMethod },
): Promise<SendResult> {
  if (!mailDeliveryAvailable()) return "skipped";
  if (!(await mayEmail(to.id, pref))) return "skipped";
  const unsub = await unsubscribeFor(to.id, pref);
  const m = build(unsub?.url ?? null);
  const extras: MailExtras = {
    ...(unsub ? { headers: unsub.headers } : {}),
    ...(attachment ? { attachments: [icsAttachment(attachment.ics, attachment.method)] } : {}),
  };
  const ok = await (testDelivery ?? sendMail)(to.email, m.subject, m.text, extras);
  return ok ? "sent" : "failed";
}

/* Fire-and-forget for request paths. The set exists so tests (and a graceful
   shutdown, if one ever wants it) can wait for what is still in flight. */
const inflight = new Set<Promise<void>>();

export function dispatchMail(kind: string, job: () => Promise<unknown>): void {
  if (!mailDeliveryAvailable()) return;
  const p = (async () => {
    try {
      await job();
    } catch (e) {
      logEvent("error", "booking_mail_failed", { kind, detail: (e as { code?: string }).code ?? (e as Error).name });
    }
  })();
  inflight.add(p);
  void p.finally(() => inflight.delete(p));
}

/** Resolves once every dispatched mail job has finished. */
export async function settleMail(): Promise<void> {
  while (inflight.size) await Promise.allSettled([...inflight]);
}

/* ── The class, as an email names it ─────────────────────────────────────── */

export function mailClass(cls: { title: string; scheduledAt: Date | string; durationMin: number | null }, tutorFullName: string | null): MailClass {
  return {
    title: cls.title,
    tutorName: publicTutorName(tutorFullName) ?? "",
    date: formatNumericDate(cls.scheduledAt),
    time: tunisClock(cls.scheduledAt),
    durationMin: cls.durationMin && cls.durationMin > 0 ? cls.durationMin : DEFAULT_CLASS_DURATION_MIN,
  };
}

/** What this seat costs the student, as far as Tnajem knows: covered by a monthly
    subscription (C7), the free first session, or the price RECORDED on the booking
    (bookings.price_tnd, after its one promotion — C6) — the class's list price only
    for a booking written before 0035. */
export function coverageOf(row: {
  isFree: boolean | null;
  /** classes.price_tnd — the list price. */
  priceTnd: string | number | null;
  /** bookings.price_tnd — what this seat was booked at. */
  bookedPriceTnd?: string | number | null;
  subscriptionId?: string | null;
  promotionPercent?: number | null;
}): Coverage {
  if (row.subscriptionId) return { kind: "subscription" };
  if (row.isFree) return { kind: "free" };
  const list = Number(row.priceTnd ?? 0);
  const price = row.bookedPriceTnd !== null && row.bookedPriceTnd !== undefined ? Number(row.bookedPriceTnd) : list;
  if (!(price > 0)) return { kind: "zero" };
  const promo = row.promotionPercent && list > price ? { percent: row.promotionPercent, listTnd: list } : null;
  return { kind: "paid", priceTnd: price, promo };
}

/* ── One booking, with its class and tutor ───────────────────────────────── */

async function loadBooking(bookingId: string) {
  const [row] = await db
    .select({
      bookingId: bookings.id,
      status: bookings.status,
      isFree: bookings.isFree,
      bookedAt: bookings.createdAt,
      studentId: bookings.studentId,
      // espace prof v2 · growth (P5, C7): the seat's own price, its promotion and its cover.
      bookedPriceTnd: bookings.priceTnd,
      subscriptionId: bookings.subscriptionId,
      promotionPercent: promotions.percent,
      classId: classes.id,
      title: classes.title,
      scheduledAt: classes.scheduledAt,
      durationMin: classes.durationMin,
      rescheduledAt: classes.rescheduledAt,
      classCreatedAt: classes.createdAt,
      classStatus: classes.status,
      priceTnd: classes.priceTnd,
      seats: classes.seats,
      seatsTaken: classes.seatsTaken,
      tutorFullName: tutors.fullName,
      tutorProfileId: tutors.profileId,
    })
    .from(bookings)
    .innerJoin(classes, eq(bookings.classId, classes.id))
    .innerJoin(tutors, eq(classes.tutorId, tutors.id))
    .leftJoin(promotions, eq(bookings.promotionId, promotions.id))
    .where(eq(bookings.id, bookingId))
    .limit(1);
  return row ?? null;
}

type BookingRow = NonNullable<Awaited<ReturnType<typeof loadBooking>>>;

const icsClassOf = (r: BookingRow): IcsClass => ({
  id: r.classId,
  title: r.title,
  scheduledAt: r.scheduledAt,
  durationMin: r.durationMin,
  rescheduledAt: r.rescheduledAt,
  createdAt: r.classCreatedAt,
});

/* ── The events ──────────────────────────────────────────────────────────── */

/** A seat was booked: the student's confirmation (+ .ics) and the tutor's notice (+ the class .ics). */
export async function mailBookingConfirmed(bookingId: string): Promise<{ student: SendResult; tutor: SendResult }> {
  const r = await loadBooking(bookingId);
  if (!r || r.status === "cancelled") return { student: "skipped", tutor: "skipped" };
  const coverage = coverageOf(r);
  const studentProfile = await loadProfile(r.studentId);

  let student: SendResult = "skipped";
  const s = asRecipient(studentProfile);
  if (s) {
    const cls = mailClass(r, r.tutorFullName);
    student = await deliverTo(
      s,
      "bookings",
      (unsubscribeUrl) =>
        BOOKING_MAIL[s.locale].studentConfirmed({
          first: s.first,
          cls,
          coverage,
          liveUrl: mailLinks.live(s.locale, r.classId),
          calendarUrl: mailLinks.calendar(s.locale, r.bookingId),
          spaceUrl: mailLinks.studentSpace(s.locale),
          unsubscribeUrl,
        }),
      {
        ics: studentBookingIcs({ bookingId: r.bookingId, bookedAt: r.bookedAt, cls: icsClassOf(r), tutorName: cls.tutorName, loc: s.locale, method: "PUBLISH" }),
        method: "PUBLISH",
      },
    );
  }

  let tutor: SendResult = "skipped";
  const t = await recipientOf(r.tutorProfileId);
  if (t) {
    tutor = await deliverTo(
      t,
      "bookings",
      (unsubscribeUrl) =>
        BOOKING_MAIL[t.locale].tutorNewBooking({
          first: t.first,
          cls: mailClass(r, r.tutorFullName),
          student: publicDisplayName(studentProfile?.fullName) ?? BOOKING_MAIL[t.locale].someone,
          coverage,
          seatsTaken: r.seatsTaken ?? 0,
          seats: r.seats ?? 0,
          liveUrl: mailLinks.live(t.locale, r.classId),
          dashboardUrl: mailLinks.tutorClasses(t.locale),
          unsubscribeUrl,
        }),
      { ics: tutorClassIcs({ cls: icsClassOf(r), loc: t.locale, method: "PUBLISH" }), method: "PUBLISH" },
    );
  }
  return { student, tutor };
}

/** POST /bookings knows the (class, student) pair, not the row id: the unique key finds it. */
export async function mailBookingConfirmedFor(classId: string, studentId: string): Promise<{ student: SendResult; tutor: SendResult }> {
  const [b] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.classId, classId), eq(bookings.studentId, studentId)))
    .limit(1);
  return b ? mailBookingConfirmed(b.id) : { student: "skipped", tutor: "skipped" };
}

/** The STUDENT cancelled their seat: their confirmation (+ a CANCEL .ics) and the tutor's notice. */
export async function mailBookingCancelled(bookingId: string, outcome: CancelOutcome): Promise<{ student: SendResult; tutor: SendResult }> {
  const r = await loadBooking(bookingId);
  if (!r) return { student: "skipped", tutor: "skipped" };
  const studentProfile = await loadProfile(r.studentId);

  let student: SendResult = "skipped";
  const s = asRecipient(studentProfile);
  if (s) {
    const cls = mailClass(r, r.tutorFullName);
    student = await deliverTo(
      s,
      "bookings",
      (unsubscribeUrl) =>
        BOOKING_MAIL[s.locale].studentCancelled({
          first: s.first,
          cls,
          outcome: { ...outcome, wasCovered: outcome.wasCovered ?? Boolean(r.subscriptionId) },
          spaceUrl: mailLinks.studentSpace(s.locale),
          exploreUrl: mailLinks.explore(s.locale),
          unsubscribeUrl,
        }),
      {
        ics: studentBookingIcs({ bookingId: r.bookingId, bookedAt: r.bookedAt, cls: icsClassOf(r), tutorName: cls.tutorName, loc: s.locale, method: "CANCEL" }),
        method: "CANCEL",
      },
    );
  }

  let tutor: SendResult = "skipped";
  const t = await recipientOf(r.tutorProfileId);
  if (t) {
    tutor = await deliverTo(t, "bookings", (unsubscribeUrl) =>
      BOOKING_MAIL[t.locale].tutorStudentCancelled({
        first: t.first,
        cls: mailClass(r, r.tutorFullName),
        student: publicDisplayName(studentProfile?.fullName) ?? BOOKING_MAIL[t.locale].someone,
        late: outcome.late && !outcome.waived,
        dashboardUrl: mailLinks.tutorClasses(t.locale),
        unsubscribeUrl,
      }),
    );
  }
  return { student, tutor };
}

/** The CLASS was called off (by its tutor, or by the platform): every booked student,
    each with a CANCEL .ics for their own entry, and — when the tutor did it — the tutor. */
export async function mailClassCancelled(
  classId: string,
  bookingIds: string[],
  opts: { tutorDidIt: boolean },
): Promise<{ students: number; tutor: SendResult }> {
  const [c] = await db
    .select({
      id: classes.id,
      title: classes.title,
      scheduledAt: classes.scheduledAt,
      durationMin: classes.durationMin,
      rescheduledAt: classes.rescheduledAt,
      createdAt: classes.createdAt,
      tutorFullName: tutors.fullName,
      tutorProfileId: tutors.profileId,
    })
    .from(classes)
    .innerJoin(tutors, eq(classes.tutorId, tutors.id))
    .where(eq(classes.id, classId))
    .limit(1);
  if (!c) return { students: 0, tutor: "skipped" };
  const icsCls: IcsClass = { id: c.id, title: c.title, scheduledAt: c.scheduledAt, durationMin: c.durationMin, rescheduledAt: c.rescheduledAt, createdAt: c.createdAt };

  let students = 0;
  const rows = bookingIds.length
    ? await db
        .select({ id: bookings.id, studentId: bookings.studentId, bookedAt: bookings.createdAt })
        .from(bookings)
        .where(and(eq(bookings.classId, c.id), inArray(bookings.id, bookingIds)))
    : [];
  for (const b of rows) {
    const s = await recipientOf(b.studentId);
    if (!s) continue;
    const cls = mailClass(c, c.tutorFullName);
    const res = await deliverTo(
      s,
      "bookings",
      (unsubscribeUrl) =>
        BOOKING_MAIL[s.locale].studentClassCancelled({
          first: s.first,
          cls,
          spaceUrl: mailLinks.studentSpace(s.locale),
          exploreUrl: mailLinks.explore(s.locale),
          unsubscribeUrl,
        }),
      { ics: studentBookingIcs({ bookingId: b.id, bookedAt: b.bookedAt, cls: icsCls, tutorName: cls.tutorName, loc: s.locale, method: "CANCEL" }), method: "CANCEL" },
    );
    if (res === "sent") students += 1;
  }

  let tutor: SendResult = "skipped";
  if (opts.tutorDidIt) {
    const t = await recipientOf(c.tutorProfileId);
    if (t) {
      tutor = await deliverTo(
        t,
        "bookings",
        (unsubscribeUrl) =>
          BOOKING_MAIL[t.locale].tutorClassCancelled({
            first: t.first,
            cls: mailClass(c, c.tutorFullName),
            notified: rows.length,
            dashboardUrl: mailLinks.tutorClasses(t.locale),
            unsubscribeUrl,
          }),
        { ics: tutorClassIcs({ cls: icsCls, loc: t.locale, method: "CANCEL" }), method: "CANCEL" },
      );
    }
  }
  return { students, tutor };
}

/** The tutor MOVED the class: every booked student gets the new time and an updated .ics
    (same UID, higher SEQUENCE — their calendar entry moves instead of doubling). */
export async function mailClassMoved(classId: string): Promise<{ students: number }> {
  const rows = await db
    .select({
      bookingId: bookings.id,
      studentId: bookings.studentId,
      bookedAt: bookings.createdAt,
      classId: classes.id,
      title: classes.title,
      scheduledAt: classes.scheduledAt,
      durationMin: classes.durationMin,
      rescheduledAt: classes.rescheduledAt,
      createdAt: classes.createdAt,
      tutorFullName: tutors.fullName,
    })
    .from(bookings)
    .innerJoin(classes, eq(bookings.classId, classes.id))
    .innerJoin(tutors, eq(classes.tutorId, tutors.id))
    .where(and(eq(classes.id, classId), raw`coalesce(${bookings.status}, 'reserved') <> 'cancelled'`));

  let students = 0;
  for (const r of rows) {
    const s = await recipientOf(r.studentId);
    if (!s) continue;
    const cls = mailClass(r, r.tutorFullName);
    const icsCls: IcsClass = { id: r.classId, title: r.title, scheduledAt: r.scheduledAt, durationMin: r.durationMin, rescheduledAt: r.rescheduledAt, createdAt: r.createdAt };
    const res = await deliverTo(
      s,
      "bookings",
      (unsubscribeUrl) =>
        BOOKING_MAIL[s.locale].studentClassMoved({
          first: s.first,
          cls,
          liveUrl: mailLinks.live(s.locale, r.classId),
          spaceUrl: mailLinks.studentSpace(s.locale),
          unsubscribeUrl,
        }),
      { ics: studentBookingIcs({ bookingId: r.bookingId, bookedAt: r.bookedAt, cls: icsCls, tutorName: cls.tutorName, loc: s.locale, method: "PUBLISH" }), method: "PUBLISH" },
    );
    if (res === "sent") students += 1;
  }
  return { students };
}

/* ── GET /bookings/:id/calendar.ics ──────────────────────────────────────── */

/** The .ics for one booking, as THIS viewer may see it: the student who owns it gets
    their entry, the class's tutor gets the class entry, anyone else gets null (the
    route answers 404, so a bare uuid confirms nothing). A cancelled booking or class
    downloads as METHOD:CANCEL, which removes an entry already imported. */
export async function calendarFor(
  bookingId: string,
  viewerProfileId: string,
): Promise<{ ics: string; method: IcsMethod } | null> {
  const r = await loadBooking(bookingId);
  if (!r) return null;
  const viewer = await loadProfile(viewerProfileId);
  const loc = mailLocale(viewer?.locale);
  const classGone = r.classStatus === "cancelled";

  if (r.studentId === viewerProfileId) {
    const method: IcsMethod = r.status === "cancelled" || classGone ? "CANCEL" : "PUBLISH";
    return {
      ics: studentBookingIcs({
        bookingId: r.bookingId,
        bookedAt: r.bookedAt,
        cls: icsClassOf(r),
        tutorName: publicTutorName(r.tutorFullName) ?? "",
        loc,
        method,
      }),
      method,
    };
  }
  if (r.tutorProfileId && r.tutorProfileId === viewerProfileId) {
    const method: IcsMethod = classGone ? "CANCEL" : "PUBLISH";
    return { ics: tutorClassIcs({ cls: icsClassOf(r), loc, method }), method };
  }
  return null;
}
