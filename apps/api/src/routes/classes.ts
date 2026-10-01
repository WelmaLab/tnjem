import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  and, desc, eq, sql as raw,
  bookings, cancellations, classes, packs, profiles, reviews, tutors,
  notify,
} from "@tnajem/db";
import {
  vText, vOptionalText, vFutureDate, vInt, vPrice, vOptionalUrl, isUuid,
  classWhen, notificationWhen,
  type ClassItem, type DashboardResult, type DashboardBooking,
  isEffectivelyFreeFirst,
  canOpenAnotherClass,
  effectivePlan,
  cancellationOutcome,
  publicProfile,
  publicInitials,
} from "@tnajem/shared";
import { parseClassLevel, sortLevels, isLevelCode } from "@tnajem/shared"; // phase-a lane L5 (A18.7)
import { classPhase } from "@tnajem/shared"; // phase-a lane L5 (A18.10)
import { checkClassLimits } from "@tnajem/shared/class-input"; // phase-a lane L5 (A18.16): the ONE limits schema
import { paymentsEnabled, tutorBalanceTnd } from "@tnajem/shared/payments";
import { resolveMeetUrl } from "@tnajem/shared/live";
import type { Role } from "@tnajem/shared"; // phase-a lane L2 (A17)
import { publicTutorName } from "@tnajem/shared"; // phase-a lane L2 (A23)
import { freeFirstStillAvailable } from "../lib/free-first-entitlement"; // phase-a/integrate (A6)
import { db } from "../db";
import { getSession } from "../lib/session";
import { recomputeTutorStats } from "../lib/stats";
import { cancelClassForEveryone } from "../lib/class-cancel";
import { assertNoContactInfo, CONTACT_ERROR } from "../lib/contact-guard";
import { planForTutor, openClassCount, planStateForTutor } from "../lib/entitlements";

/* classes — createClass, createPack, getClass, getDashboard. */

const createClassBody = z.object({
  title: z.string(),
  description: z.string().optional(),
  scheduledAt: z.string(),
  durationMin: z.number(),
  priceTnd: z.number(),
  seats: z.number(),
  isFreeFirst: z.boolean(),
  meetUrl: z.string().optional(),
  whiteboardUrl: z.string().optional(),
  quizUrl: z.string().optional(),
  level: z.string().nullable().optional(), // phase-a lane L5 (A18.7): optional level code
});

const createPackBody = z.object({
  title: z.string(),
  meta: z.string().optional(),
  priceTnd: z.number(),
});

export async function classRoutes(app: FastifyInstance): Promise<void> {
  /* ── POST /classes ───────────────────────────────────────────────────────── */
  app.post("/classes", async (req, reply) => {
    const parsed = createClassBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad-request" });
    const input = parsed.data;

    // Was accepting past dates, negative prices and arbitrary meetUrl strings
    // (javascript: …). Every one of these validators is load-bearing.
    /* phase-a lane L5 (A18.16): title, description, duration, price and seats are
       checked by the ONE schema the new-class form imports too
       (@tnajem/shared/class-input). It used to be vText/vInt here with limits of
       120 / 480 / 500 while the form said 80 / 240 / 200. FOUNDER defaults:
       title 120, duration 240, seats 200. Same error codes as before. */
    const limits = checkClassLimits({
      title: input.title,
      description: input.description,
      durationMin: input.durationMin,
      seats: input.seats,
      priceTnd: input.priceTnd,
    });
    if (!limits.ok) return { ok: false, error: limits.error };
    const title = { value: limits.value.title };
    const description = { value: limits.value.description || null };
    const duration = { value: limits.value.durationMin };
    const price = { value: Math.round(limits.value.priceTnd * 100) / 100 };
    const seats = { value: limits.value.seats };
    const when = vFutureDate(input.scheduledAt, { field: "date" });
    if (!when.ok) return { ok: false, error: when.error };
    const meetUrl = vOptionalUrl(input.meetUrl, { field: "meet-url" });
    if (!meetUrl.ok) return { ok: false, error: meetUrl.error };
    const whiteboardUrl = vOptionalUrl(input.whiteboardUrl, { field: "whiteboard-url" });
    if (!whiteboardUrl.ok) return { ok: false, error: whiteboardUrl.error };
    const quizUrl = vOptionalUrl(input.quizUrl, { field: "quiz-url" });
    if (!quizUrl.ok) return { ok: false, error: quizUrl.error };
    const level = parseClassLevel(input.level); // phase-a lane L5 (A18.7)
    if (!level.ok) return { ok: false, error: level.error };

    const session = await getSession(req);
    if (!session) return { ok: false, error: "not-authenticated" };
    const [mine] = await db
      .select()
      .from(tutors)
      .where(eq(tutors.profileId, session.profile.id))
      .limit(1);
    if (!mine) return { ok: false, error: "no-storefront" };

    /* VERIFICATION GATE. A draft/pending tutor could already build a catalogue,
       and — the part that actually matters — so could a REJECTED one: nothing here
       ever looked at `status`. The content is not publicly visible, but a tutor we
       have refused should not keep stocking a storefront that goes live the
       instant anyone flips their status, and the class id is a bookable handle the
       moment it exists. Creating the storefront stays open: that is the step that
       gets them INTO verification. */
    if (mine.status !== "verified") return { ok: false, error: "not-verified" };

    /* phase-a lane L5 (A18.6): the per-class free-first flag only means something
       while the tutor's own option is on (isEffectivelyFreeFirst). The form now
       disables the box and links to the setting; refusing it here too means a
       crafted POST cannot store a promise the tutor never switched on, which would
       silently go live the day they did. */
    if (input.isFreeFirst && !mine.offersFreeFirstSession) return { ok: false, error: "free-first-off" };

    /* ── THE PLAN LIMIT (Step 16) ─────────────────────────────────────────────

       ENFORCED HERE, not in the form. /tarifs sells "1 cours en ligne" on the
       free plan and "jusqu'à 5" on Essentiel; a limit that lives only in the UI
       is not a limit, it is a suggestion that a crafted POST ignores — the same
       hole Step 6 closed for the free first session.

       Counts OPEN listings (upcoming, not cancelled), so cancelling or letting a
       class run frees the slot back up. During the pilot every tutor is on
       `pilot`, whose maxClasses is null, so this refuses nobody today — it binds
       the moment an admin grants a limited plan, or the day payments go live and
       the default drops to Gratuit. */
    const plan = await planForTutor(mine.id);
    if (plan.maxClasses !== null) {
      const open = await openClassCount(mine.id);
      if (!canOpenAnotherClass(plan, open)) {
        /* The limit travels with the refusal so the dashboard can name the
           number. "Not allowed" with no number is a dead end for the person who
           would happily upgrade if they knew what they had hit. */
        return { ok: false, error: "plan-limit-classes", planCode: plan.code, limit: plan.maxClasses };
      }
    }

    /* ZERO CONTACT EXCHANGE (Step 8). A class title and description are rendered
       on the PUBLIC storefront and in the class page's meta description, so a
       number here reaches the open internet, not just the students who book.
       Rejected, not masked: the tutor is on the form and can fix it now.

       After the auth and verification gates, because assertNoContactInfo WRITES
       flag rows and an unauthenticated caller must not be able to fill that table. */
    if (
      !(await assertNoContactInfo(session.profile.id, [
        { surface: "class_title", value: title.value },
        { surface: "class_description", value: description.value },
      ]))
    ) {
      return { ok: false, error: CONTACT_ERROR };
    }

    // meetUrl stays nullable: lib/live.ts derives a room from the class id when it
    // is empty, so the student's Join button is never dead.
    // espace prof v2 · growth (P3): the id comes back, so the tutor can share the class right away.
    const [created] = await db.insert(classes).values({
      tutorId: mine.id,
      title: title.value,
      description: description.value,
      scheduledAt: when.value,
      durationMin: duration.value,
      priceTnd: String(price.value),
      seats: seats.value,
      isFreeFirst: Boolean(input.isFreeFirst),
      meetUrl: meetUrl.value,
      whiteboardUrl: whiteboardUrl.value,
      quizUrl: quizUrl.value,
      level: level.value, // phase-a lane L5 (A18.7)
    }).returning({ id: classes.id });

    // The storefront lists this tutor's classes — the web drops its 60s ISR entry.
    return { ok: true, id: created?.id, revalidate: { tutors: [mine.slug] } };
  });

  /* ── POST /packs ─────────────────────────────────────────────────────────── */
  app.post("/packs", async (req, reply) => {
    const parsed = createPackBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad-request" });
    const input = parsed.data;

    const title = vText(input.title, { field: "title", max: 120, min: 3 });
    if (!title.ok) return { ok: false, error: title.error };
    const meta = vOptionalText(input.meta, { field: "meta", max: 200 });
    if (!meta.ok) return { ok: false, error: meta.error };
    const price = vPrice(input.priceTnd, { field: "price", max: 5000 });
    if (!price.ok) return { ok: false, error: price.error };

    const session = await getSession(req);
    if (!session) return { ok: false, error: "not-authenticated" };
    const [mine] = await db
      .select()
      .from(tutors)
      .where(eq(tutors.profileId, session.profile.id))
      .limit(1);
    if (!mine) return { ok: false, error: "no-storefront" };
    // Same verification gate as createClass — a rejected tutor does not get to
    // keep building a catalogue.
    if (mine.status !== "verified") return { ok: false, error: "not-verified" };

    // A pack title is public storefront copy too. Same rule, same reason.
    if (
      !(await assertNoContactInfo(session.profile.id, [
        { surface: "pack_title", value: title.value },
        { surface: "pack_title", value: meta.value },
      ]))
    ) {
      return { ok: false, error: CONTACT_ERROR };
    }

    await db.insert(packs).values({
      tutorId: mine.id,
      title: title.value,
      description: meta.value,
      priceTnd: String(price.value),
    });

    return { ok: true, revalidate: { tutors: [mine.slug] } }; // packs render publicly
  });

  /* ── GET /classes/:id ────────────────────────────────────────────────────── */
  app.get<{ Params: { id: string } }>("/classes/:id", async (req): Promise<ClassItem | null> => {
    const id = req.params.id;
    if (!isUuid(id)) return null;

    const [c] = await db.select().from(classes).where(eq(classes.id, id)).limit(1);
    if (!c) return null;

    const [tut] = await db.select().from(tutors).where(eq(tutors.id, c.tutorId)).limit(1);

    const session = await getSession(req);
    const uid = session?.profile.id ?? null;
    const isOwner = Boolean(uid && tut?.profileId === uid);

    let hasBooking = false;
    let bookedFree = false; // phase-a/integrate (A6)
    if (uid) {
      const [bk] = await db
        .select({ status: bookings.status, isFree: bookings.isFree })
        .from(bookings)
        .where(and(eq(bookings.classId, c.id), eq(bookings.studentId, uid)))
        .limit(1);
      hasBooking = Boolean(bk && bk.status !== "cancelled");
      bookedFree = hasBooking && Boolean(bk?.isFree);
    }
    const entitled = isOwner || hasBooking;

    /* A non-verified tutor's class is visible only to the tutor themselves and to
       students who already hold a booking — so a tutor whose status changed after
       people booked does not strand them. */
    if ((tut?.status !== "verified" || tut?.suspendedAt) && !entitled) return null; // A blocked account's storefront is suspended (0019): off every public read.

    const d = new Date(c.scheduledAt);

    /* ROOM LINKS ARE THE REAL LEAK. meet_url is the ONLY thing protecting a live
       session: anyone holding it can walk into a class full of minors. It ships
       exclusively to the owning tutor or a student with a live booking. Everything
       else about the class is public; these four fields are not. */
    /* phase-a/integrate (A6 × D2): what the page and checkout PROMISE must match what
       POST /bookings will do. The free first session is once per student per tutor,
       so a student who already had it is not shown "1ʳᵉ séance gratuite" here. A
       booked student sees what their own seat is; the tutor and a signed-out visitor
       see the class's offer. */
    const classOffers = isEffectivelyFreeFirst(tut?.offersFreeFirstSession, c.isFreeFirst);
    const freeFirstShown = hasBooking
      ? bookedFree
      : classOffers && uid && !isOwner && tut
        ? await freeFirstStillAvailable(db, uid, tut.id)
        : classOffers;

    return {
      id: c.id,
      tutor_id: c.tutorId,
      tutor_name: isOwner ? (tut?.fullName ?? "") : (publicTutorName(tut?.fullName) ?? ""), // phase-a lane L2 (A23): D1, the owner sees their own full name
      title: c.title,
      description: c.description ?? undefined,
      ...classWhen(d), // Tunis time
      duration_min: c.durationMin ?? 90,
      price_tnd: Number(c.priceTnd),
      seats: c.seats ?? 0,
      seats_left: Math.max(0, (c.seats ?? 0) - (c.seatsTaken ?? 0)),
      // EFFECTIVE: the tutor's opt-in gates the per-class flag — and, for a signed-in
      // student, whether they still have their free first session with this tutor.
      is_free_first: freeFirstShown,
      meet_url: entitled ? resolveMeetUrl(c) : undefined,
      whiteboard_url: entitled ? (c.whiteboardUrl ?? undefined) : undefined,
      quiz_url: entitled ? (c.quizUrl ?? undefined) : undefined,
      replay_url: entitled ? (c.replayUrl ?? undefined) : undefined,
      status: c.status ?? "scheduled",
      // phase-a lane L4 (A9): the tutor by SLUG — the page no longer searches by name.
      // Only a storefront that is actually public: a link to a suspended, erased or
      // unverified tutor's page would 404 for the booked student who can still see this.
      tutor_slug: tut && tut.status === "verified" && !tut.suspendedAt && !tut.erasedAt ? tut.slug : null,
      tutor_subject: tut?.subject ?? null,
      // phase-a/integrate (A9 × A18.7): the chosen levels (codes) and the class's own
      // level; the page translates them. Never the legacy tutors.level ('Bac' default).
      tutor_levels: sortLevels(tut?.levels),
      level: isLevelCode(c.level) ? c.level : null,
    };
  });

  /* ── POST /classes/:id/cancel — the TUTOR calls it off ──────────────────────

     100% RELEASE, ALWAYS. Retaining a share of a seat the student still wanted
     would be charging them for someone else's decision. The ledger records this
     as `waived` rather than pretending the cancellation was early — see the note
     on that flag in @tnajem/shared/cancellation.ts.

     The class status, every booking, the seat count and the ledger rows move in
     ONE transaction. A half-cancelled class — status flipped, students still
     holding seats — is worse than not cancelling at all: they would turn up. */
  app.post<{ Params: { id: string } }>("/classes/:id/cancel", async (req) => {
    const parsed = z.object({ reason: z.string().optional() }).safeParse(req.body ?? {});
    if (!parsed.success) return { ok: false, error: "bad-request" };
    const reason = vOptionalText(parsed.data.reason, { field: "reason", max: 500 });
    if (!reason.ok) return { ok: false, error: reason.error };

    const session = await getSession(req);
    if (!session) return { ok: false, error: "not-authenticated" };
    if (!isUuid(req.params.id)) return { ok: false, error: "not-found" };

    const [c] = await db
      .select({
        id: classes.id,
        title: classes.title,
        status: classes.status,
        scheduledAt: classes.scheduledAt,
        priceTnd: classes.priceTnd,
        tutorId: classes.tutorId,
        tutorProfileId: tutors.profileId,
        slug: tutors.slug,
      })
      .from(classes)
      .innerJoin(tutors, eq(classes.tutorId, tutors.id))
      .where(eq(classes.id, req.params.id))
      .limit(1);
    if (!c) return { ok: false, error: "not-found" };
    /* Ownership, not just authentication: a class id is a bare uuid, and
       "not-found" rather than "forbidden" so it does not confirm the id exists. */
    if (c.tutorProfileId !== session.profile.id) return { ok: false, error: "not-found" };
    if (c.status === "cancelled") return { ok: true, already: true }; // idempotent
    if (c.status === "done") return { ok: false, error: "already-started" };
    if (new Date(c.scheduledAt).getTime() <= Date.now()) {
      return { ok: false, error: "already-started" };
    }

    const cancelled = await cancelClassForEveryone(c, {
      actor: "tutor",
      actorProfileId: session.profile.id,
      reason: reason.value ?? "cancelled-by-tutor",
      notifyBody: (title, when) => `« ${title} » (${when}) est annulée par le prof. Tu ne dois rien.`,
    });

    return { ok: true, cancelled, revalidate: { tutors: [c.slug] } };
  });

  /* ── POST /classes/:id/reschedule — the TUTOR moves it ──────────────────────

     Moving a class does NOT cancel anyone. Most students will simply come at the
     new time, and cancelling their seats to force a re-book would lose the ones
     who never read the notification — the opposite of helping them.

     What it does is WAIVE the 48h window for everyone who booked the OLD time.
     They agreed to an appointment that no longer exists; holding them to a
     deadline measured against a time they never chose would charge them for the
     tutor's change of plan. classes.rescheduled_at is the whole mechanism — see
     the column comment for why it is not a per-booking flag. */
  app.post<{ Params: { id: string } }>("/classes/:id/reschedule", async (req) => {
    const parsed = z.object({ scheduledAt: z.string() }).safeParse(req.body);
    if (!parsed.success) return { ok: false, error: "bad-request" };

    const session = await getSession(req);
    if (!session) return { ok: false, error: "not-authenticated" };
    if (!isUuid(req.params.id)) return { ok: false, error: "not-found" };

    // The same validator createClass uses: a past date is refused on both paths.
    const when = vFutureDate(parsed.data.scheduledAt, { field: "date" });
    if (!when.ok) return { ok: false, error: when.error };

    const [c] = await db
      .select({
        id: classes.id,
        title: classes.title,
        status: classes.status,
        scheduledAt: classes.scheduledAt,
        tutorProfileId: tutors.profileId,
        slug: tutors.slug,
      })
      .from(classes)
      .innerJoin(tutors, eq(classes.tutorId, tutors.id))
      .where(eq(classes.id, req.params.id))
      .limit(1);
    if (!c) return { ok: false, error: "not-found" };
    if (c.tutorProfileId !== session.profile.id) return { ok: false, error: "not-found" };
    if (c.status === "cancelled" || c.status === "done") return { ok: false, error: "unavailable" };
    if (new Date(c.scheduledAt).getTime() <= Date.now()) {
      return { ok: false, error: "already-started" };
    }

    await db
      .update(classes)
      .set({ scheduledAt: when.value, rescheduledAt: raw`now()` })
      .where(eq(classes.id, c.id));

    const live = await db
      .select({ studentId: bookings.studentId })
      .from(bookings)
      .where(
        and(
          eq(bookings.classId, c.id),
          raw`coalesce(${bookings.status}, 'reserved') <> 'cancelled'`,
        ),
      );

    const whenLabel = notificationWhen(when.value); // Tunis time, stored in the body
    for (const b of live) {
      /* The notification SAYS they can cancel free. A student who cannot make the
         new time needs to know that before they go looking for the deadline. */
      await notify(db, b.studentId, {
        kind: "class_reminder",
        title: "Séance déplacée",
        body: `« ${c.title} » est déplacée au ${whenLabel}. Si ça ne te convient pas, tu peux annuler sans frais.`,
        href: "/student",
      });
    }

    return { ok: true, notified: live.length, revalidate: { tutors: [c.slug] } };
  });

  /* ── GET /dashboard (the signed-in tutor's own view) ─────────────────────── */
  app.get("/dashboard", async (req): Promise<DashboardResult> => {
    const session = await getSession(req);
    if (!session) return null;
    // phase-a lane L2 (A17): the role check lost in the split — a student got "Crée ta vitrine".
    if (session.profile.role !== "tutor") return { wrongRole: session.profile.role as Role };
    const uid = session.profile.id;

    const [mine] = await db.select().from(tutors).where(eq(tutors.profileId, uid)).limit(1);
    if (!mine) {
      // Signed in but no storefront yet → prompt them to create one.
      return {
        name: session.profile.fullName,
        slug: null,
        has_storefront: false,
        balance_tnd: 0,
        paymentsEnabled: paymentsEnabled(),
        students: 0,
        sessions: 0,
        rating: 0,
        reviewCount: 0,
        status: "draft",
        offersFreeFirstSession: false,
        avatarStatus: null,
        /* No storefront means no tutor row, so there is nothing to resolve a
           grant against — report the DEFAULT plan rather than inventing one.
           effectivePlan(null, …) is the same function the real branch uses. */
        plan: {
          code: effectivePlan(null, paymentsEnabled()).code,
          maxClasses: effectivePlan(null, paymentsEnabled()).maxClasses,
          openClasses: 0,
          isPilot: !paymentsEnabled(),
          granted: false,
          expiresAt: null,
        },
        classes: [],
        packs: [],
        bookings: [],
        linkShared: false, // espace prof v2 · shell: no page, nothing to share yet
      };
    }

    /* Bounded reads. These are per-tutor so they grow slowly, but "slowly" is
       still unbounded: a tutor running weekly classes for two years has ~100 rows,
       and the bookings join multiplies by attendees. Caps keep one prolific tutor
       from turning their own dashboard into a timeout. */
    const rows = await db
      .select()
      .from(classes)
      .where(eq(classes.tutorId, mine.id))
      .orderBy(desc(classes.scheduledAt))
      .limit(200);

    const mapped = rows.map((c) => {
      const d = new Date(c.scheduledAt);
      return {
        id: c.id,
        title: c.title,
        ...classWhen(d), // Tunis time
        price_tnd: Number(c.priceTnd),
        seats: c.seats ?? 0,
        seats_left: Math.max(0, (c.seats ?? 0) - (c.seatsTaken ?? 0)),
        status: c.status ?? "scheduled",
        // phase-a lane L5 (A18.10): real end time + where the class stands (À venir · En direct · Terminée · Annulée).
        duration_min: c.durationMin ?? 90,
        phase: classPhase({ starts_at: d.toISOString(), duration_min: c.durationMin, status: c.status }),
      };
    });

    const packRows = await db.select().from(packs).where(eq(packs.tutorId, mine.id)).limit(100);
    const mappedPacks = packRows.map((p) => ({
      id: p.id,
      title: p.title,
      meta: p.description ?? "",
      price_tnd: Number(p.priceTnd),
    }));

    /* Who actually booked — A FIRST NAME AND NOTHING ELSE.

       Step 8 closed this. It used to select profiles.phone and profiles.email and
       the dashboard rendered them as a `tel:` link and a `mailto:` link with the
       address as the visible label: the product's largest counterparty-PII
       surface, contradicted by its own copy ("Ton numéro reste privé").

       THE COLUMNS ARE NOT SELECTED AT ALL. Not selected-then-dropped, not
       selected-then-nulled — absent from the query, so there is no value in this
       process to leak through a log line, an error payload or a future field. */
    const bookingRows = await db
      .select({
        bookingId: bookings.id,
        classId: classes.id,
        classTitle: classes.title,
        scheduledAt: classes.scheduledAt,
        isFree: bookings.isFree,
        status: bookings.status,
        bookedAt: bookings.createdAt,
        studentName: profiles.fullName,
      })
      .from(bookings)
      // Single join, NOT a query per class.
      .innerJoin(classes, eq(bookings.classId, classes.id))
      .innerJoin(profiles, eq(bookings.studentId, profiles.id))
      .where(eq(classes.tutorId, mine.id))
      .orderBy(desc(bookings.createdAt))
      .limit(500);

    const mappedBookings: DashboardBooking[] = bookingRows.map((b) => ({
      bookingId: b.bookingId,
      classId: b.classId,
      classTitle: b.classTitle,
      // publicProfile is the ALLOW-LIST: it builds a new object from named
      // fields, so a column added to profiles tomorrow cannot ride along.
      studentName: publicProfile({ fullName: b.studentName }).name,
      studentInitials: publicInitials(b.studentName),
      bookedAt: new Date(b.bookedAt).toISOString(),
      classTs: new Date(b.scheduledAt).getTime(),
      isFree: Boolean(b.isFree),
      status: b.status ?? "reserved",
    }));

    const [revAgg] = await db
      .select({ n: raw<number>`count(*)::int` })
      .from(reviews)
      .where(eq(reviews.tutorId, mine.id));

    // Real balance from payments.ts — 0 while payments are hard-disabled. Never fabricated.
    const balance = await tutorBalanceTnd(mine.id);
    const planState = await planStateForTutor(mine.id);

    return {
      name: mine.fullName ?? session.profile.fullName,
      slug: mine.slug,
      has_storefront: true,
      balance_tnd: balance,
      paymentsEnabled: paymentsEnabled(),
      students: mine.studentsCount ?? 0,
      sessions: rows.length,
      rating: Number(mine.rating ?? 0),
      reviewCount: revAgg?.n ?? 0,
      status: mine.status,
      offersFreeFirstSession: mine.offersFreeFirstSession,
      avatarStatus: mine.avatarStatus ?? null,
      plan: {
        code: planState.plan.code,
        maxClasses: planState.plan.maxClasses,
        openClasses: planState.openClasses,
        /* PILOT means "no grant, and payments are off" — i.e. the tutor has the
           full offer because billing has not started, which is a different
           sentence from "you are on the Gratuit plan". */
        isPilot: !paymentsEnabled() && !planState.granted,
        granted: planState.granted,
        expiresAt: planState.expiresAt ? new Date(planState.expiresAt).toISOString() : null,
      },
      classes: mapped,
      packs: mappedPacks,
      bookings: mappedBookings,
      linkShared: Boolean(mine.linkSharedAt), // espace prof v2 · shell (0036): the last checklist step
    };
  });
}
