import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  and, desc, eq, inArray, isNull, sql as raw,
  profiles, promotions, studentSubscriptions, tutorOffers, tutors,
  notify,
} from "@tnajem/db";
import {
  OFFER_MAX_PER_TUTOR, isUuid, publicDisplayName, publicTutorName, vSlug,
  type MySubscription, type SubscriptionStatus, type TutorOfferRow, type TutorSubscriptionRow,
} from "@tnajem/shared";
import { checkInput, offerInputSchema, offerPatchSchema, subscriptionRequestSchema } from "@tnajem/shared/growth-input";
import { paymentsEnabled } from "@tnajem/shared/payments";
import { db } from "../db";
import { getSession, type Session } from "../lib/session";
import { checkRateLimit } from "../lib/rate-limit";
import { isUniqueViolation } from "../lib/db-errors";
import { minorGate } from "../lib/minor-gate";
import { claimPromotionUse, quoteItem, releasePromotionUse } from "../lib/promotions";
import { sessionsUsedInWindow } from "../lib/subscription-seat";

/* MONTHLY OFFERS AND SUBSCRIPTIONS — Espace prof v2 · Phase 5 A.

   PAYMENTS ARE OFF. A student asks ("S'abonner — X TND / mois" → requested); the
   teacher is paid OUTSIDE Tnajem and confirms by hand ("Confirmer (paiement reçu
   hors Tnajem)" → active for one month from now); next month, one click renews
   (+1 month). Pause, resume and cancel are there; the nightly job expires what ran
   out and reminds both sides 3 days before (lib/growth-cron.ts).

   THE TUTOR                                       THE STUDENT
     GET  /tutor/offers                              POST /subscriptions {offerId, promoCode?}
     POST /tutor/offers            create (≤ 3)      GET  /subscriptions/mine?slug=
     POST /tutor/offers/:id        edit              POST /subscriptions/:id/cancel
     POST /tutor/offers/:id/archive
     GET  /tutor/subscriptions
     POST /tutor/subscriptions/:id/{confirm|renew|pause|resume|cancel}

   Every rule is here: role and ownership on every call, at most 3 offers (an
   advisory lock serialises two creates), price > 0 and 1–31 sessions (Zod, and the
   SQL CHECKs), one live subscription per student per tutor (the partial unique
   index), the minors rule of booking (lib/minor-gate.ts), the teacher sees a
   student's FIRST NAME only. The price agreed — after the best promotion
   (pricing.ts) — is written on the request and never recomputed. */

type Tutor = typeof tutors.$inferSelect;
type Sub = typeof studentSubscriptions.$inferSelect;

async function myTutor(session: Session | null): Promise<{ ok: true; tutor: Tutor } | { ok: false; error: string }> {
  if (!session) return { ok: false, error: "not-authenticated" };
  if (session.profile.role !== "tutor") return { ok: false, error: "not-a-tutor" };
  const [t] = await db.select().from(tutors).where(eq(tutors.profileId, session.profile.id)).limit(1);
  return t ? { ok: true, tutor: t } : { ok: false, error: "no-storefront" };
}

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

async function offerRows(tutorId: string): Promise<TutorOfferRow[]> {
  const rows = await db.select().from(tutorOffers)
    .where(and(eq(tutorOffers.tutorId, tutorId), isNull(tutorOffers.archivedAt)))
    .orderBy(tutorOffers.createdAt);
  const live = rows.length
    ? await db
      .select({ offerId: studentSubscriptions.offerId, n: raw<number>`count(*)::int` })
      .from(studentSubscriptions)
      .where(and(inArray(studentSubscriptions.offerId, rows.map((r) => r.id)), inArray(studentSubscriptions.status, ["active", "paused"]))) // a request is not running yet
      .groupBy(studentSubscriptions.offerId)
    : [];
  const byOffer = new Map(live.map((l) => [l.offerId, l.n]));
  return rows.map((o) => ({
    id: o.id,
    title: o.title,
    sessions_per_month: o.sessionsPerMonth,
    price_tnd: Number(o.priceTndPerMonth),
    active: o.active,
    createdAt: new Date(o.createdAt).toISOString(),
    liveSubscriptions: byOffer.get(o.id) ?? 0,
  }));
}

async function usedNow(s: Sub): Promise<number> {
  if (s.status !== "active" && s.status !== "paused") return 0;
  if (!s.periodStart || !s.periodEnd || new Date(s.periodEnd).getTime() <= Date.now()) return 0;
  return sessionsUsedInWindow(db, s.id, s.periodStart, new Date());
}

async function toMine(s: Sub, offerTitle: string): Promise<MySubscription> {
  return {
    id: s.id,
    status: s.status as SubscriptionStatus,
    offerId: s.offerId,
    offerTitle,
    sessionsPerMonth: s.sessionsPerMonth,
    priceTnd: Number(s.priceTnd),
    requestedAt: new Date(s.createdAt).toISOString(),
    periodStart: iso(s.periodStart),
    periodEnd: iso(s.periodEnd),
    usedThisPeriod: await usedNow(s),
  };
}

const offerParams = (req: FastifyRequest) => (req.params as { id?: string }).id ?? "";

export async function offerRoutes(app: FastifyInstance): Promise<void> {
  /* ══ The tutor's offers ═══════════════════════════════════════════════════ */

  app.get("/tutor/offers", async (req) => {
    const me = await myTutor(await getSession(req));
    if (!me.ok) return me;
    return { ok: true, offers: await offerRows(me.tutor.id), max: OFFER_MAX_PER_TUTOR };
  });

  app.post("/tutor/offers", async (req) => {
    const session = await getSession(req);
    const me = await myTutor(session);
    if (!me.ok) return me;
    const input = checkInput(offerInputSchema, req.body ?? {});
    if (!input.ok) return input;
    const rl = await checkRateLimit(`offers:write:${me.tutor.id}`, 30, 60 * 60_000);
    if (!rl.ok) return { ok: false, error: "too-many-requests" };

    /* AT MOST 3, race-safe: the count and the insert run under one advisory lock
       per tutor, so two tabs creating at once cannot make a fourth. */
    const created = await db.transaction(async (tx) => {
      await tx.execute(raw`select pg_advisory_xact_lock(hashtextextended(${`offers:${me.tutor.id}`}, 0))`);
      const [{ n }] = await tx.select({ n: raw<number>`count(*)::int` }).from(tutorOffers)
        .where(and(eq(tutorOffers.tutorId, me.tutor.id), isNull(tutorOffers.archivedAt)));
      if (n >= OFFER_MAX_PER_TUTOR) return null;
      const [row] = await tx.insert(tutorOffers).values({
        tutorId: me.tutor.id,
        title: input.value.title,
        sessionsPerMonth: input.value.sessionsPerMonth,
        priceTndPerMonth: input.value.priceTnd.toFixed(2),
        active: input.value.active ?? true,
      }).returning({ id: tutorOffers.id });
      return row;
    });
    if (!created) return { ok: false, error: "max-offers", max: OFFER_MAX_PER_TUTOR };
    return { ok: true, id: created.id, revalidate: { tutors: [me.tutor.slug] } };
  });

  app.post("/tutor/offers/:id", async (req) => {
    const me = await myTutor(await getSession(req));
    if (!me.ok) return me;
    const id = offerParams(req);
    if (!isUuid(id)) return { ok: false, error: "not-found" };
    const input = checkInput(offerPatchSchema, req.body ?? {});
    if (!input.ok) return input;
    const v = input.value;
    /* An edit changes what FUTURE requests agree to. Subscriptions already asked
       for keep their own price and quota (they are written on the row). */
    const rows = await db.update(tutorOffers)
      .set({
        ...(v.title !== undefined ? { title: v.title } : {}),
        ...(v.sessionsPerMonth !== undefined ? { sessionsPerMonth: v.sessionsPerMonth } : {}),
        ...(v.priceTnd !== undefined ? { priceTndPerMonth: v.priceTnd.toFixed(2) } : {}),
        ...(v.active !== undefined ? { active: v.active } : {}),
        updatedAt: raw`now()`,
      })
      .where(and(eq(tutorOffers.id, id), eq(tutorOffers.tutorId, me.tutor.id), isNull(tutorOffers.archivedAt)))
      .returning({ id: tutorOffers.id });
    if (rows.length === 0) return { ok: false, error: "not-found" };
    return { ok: true, revalidate: { tutors: [me.tutor.slug] } };
  });

  /* Archived, never deleted: a subscription points at it. Live subscriptions run
     to the end of their month; the offer only stops taking new requests. */
  app.post("/tutor/offers/:id/archive", async (req) => {
    const me = await myTutor(await getSession(req));
    if (!me.ok) return me;
    const id = offerParams(req);
    if (!isUuid(id)) return { ok: false, error: "not-found" };
    const rows = await db.update(tutorOffers)
      .set({ archivedAt: raw`now()`, active: false, updatedAt: raw`now()` })
      .where(and(eq(tutorOffers.id, id), eq(tutorOffers.tutorId, me.tutor.id), isNull(tutorOffers.archivedAt)))
      .returning({ id: tutorOffers.id });
    if (rows.length === 0) return { ok: false, error: "not-found" };
    return { ok: true, revalidate: { tutors: [me.tutor.slug] } };
  });

  /* ══ The tutor's subscriptions ════════════════════════════════════════════ */

  app.get("/tutor/subscriptions", async (req) => {
    const me = await myTutor(await getSession(req));
    if (!me.ok) return me;
    const rows = await db
      .select({ s: studentSubscriptions, offerTitle: tutorOffers.title, fullName: profiles.fullName, percent: promotions.percent })
      .from(studentSubscriptions)
      .innerJoin(tutorOffers, eq(tutorOffers.id, studentSubscriptions.offerId))
      .innerJoin(profiles, eq(profiles.id, studentSubscriptions.studentProfileId))
      .leftJoin(promotions, eq(promotions.id, studentSubscriptions.promotionId))
      .where(eq(studentSubscriptions.tutorId, me.tutor.id))
      .orderBy(desc(studentSubscriptions.createdAt))
      .limit(200);
    const week = Date.now() + 7 * 86_400_000;
    const out: TutorSubscriptionRow[] = [];
    for (const r of rows) {
      out.push({
        id: r.s.id,
        status: r.s.status as SubscriptionStatus,
        // FIRST NAME ONLY, nothing else about the student (Step 8).
        studentFirstName: publicDisplayName(r.fullName),
        offerId: r.s.offerId,
        offerTitle: r.offerTitle,
        sessionsPerMonth: r.s.sessionsPerMonth,
        priceTnd: Number(r.s.priceTnd),
        promotionPercent: r.percent ?? null,
        requestedAt: new Date(r.s.createdAt).toISOString(),
        periodStart: iso(r.s.periodStart),
        periodEnd: iso(r.s.periodEnd),
        usedThisPeriod: await usedNow(r.s),
        expiringSoon: r.s.status === "active" && Boolean(r.s.periodEnd) && new Date(r.s.periodEnd as Date).getTime() < week,
      });
    }
    return { ok: true, rows: out };
  });

  /** Load one of the caller's subscriptions — as its TUTOR (`as: "tutor"`) or its STUDENT. */
  async function own(req: FastifyRequest, as: "tutor" | "student") {
    const session = await getSession(req);
    if (!session) return { ok: false as const, error: "not-authenticated" };
    const id = offerParams(req);
    if (!isUuid(id)) return { ok: false as const, error: "not-found" };
    const [row] = await db
      .select({ s: studentSubscriptions, offerTitle: tutorOffers.title, tutor: tutors })
      .from(studentSubscriptions)
      .innerJoin(tutorOffers, eq(tutorOffers.id, studentSubscriptions.offerId))
      .innerJoin(tutors, eq(tutors.id, studentSubscriptions.tutorId))
      .where(eq(studentSubscriptions.id, id))
      .limit(1);
    if (!row) return { ok: false as const, error: "not-found" };
    // IDOR guard: a subscription id is a bare uuid, so ownership is checked here.
    const mine = as === "tutor" ? row.tutor.profileId === session.profile.id : row.s.studentProfileId === session.profile.id;
    if (!mine) return { ok: false as const, error: "not-found" };
    return { ok: true as const, session, ...row };
  }

  const tutorShown = (t: Tutor) => publicTutorName(t.fullName) ?? "Ton prof";

  /* "Confirmer (paiement reçu hors Tnajem)": requested → active, one month from now. */
  app.post("/tutor/subscriptions/:id/confirm", async (req) => {
    const o = await own(req, "tutor");
    if (!o.ok) return o;
    const [row] = await db.update(studentSubscriptions)
      .set({
        status: "active",
        periodStart: raw`now()`,
        periodEnd: raw`now() + interval '1 month'`,
        confirmedAt: raw`now()`,
        paymentsEnabled: paymentsEnabled(),
        updatedAt: raw`now()`,
      })
      .where(and(eq(studentSubscriptions.id, o.s.id), eq(studentSubscriptions.status, "requested")))
      .returning();
    if (!row) return { ok: false, error: "not-requested" };
    await notify(db, row.studentProfileId, {
      key: "subscriptionConfirmed",
      params: { who: tutorShown(o.tutor), offerTitle: o.offerTitle, until: new Date(row.periodEnd as Date).toISOString() },
      href: `/${o.tutor.slug}`,
      aboutProfileId: o.tutor.profileId,
    });
    return { ok: true, periodEnd: iso(row.periodEnd) };
  });

  /* One click, after the next payment: +1 month from the current end (the month
     windows stay aligned), or a fresh month from now if it had already ended. */
  app.post("/tutor/subscriptions/:id/renew", async (req) => {
    const o = await own(req, "tutor");
    if (!o.ok) return o;
    if (!["active", "paused", "expired"].includes(o.s.status)) return { ok: false, error: "not-renewable" };
    const stillRunning = o.s.periodEnd && new Date(o.s.periodEnd).getTime() > Date.now() && o.s.status !== "expired";
    let row: Sub | undefined;
    try {
      [row] = await db.update(studentSubscriptions)
        .set(stillRunning
          ? { status: "active", periodEnd: raw`${studentSubscriptions.periodEnd} + interval '1 month'`, renewedAt: raw`now()`, reminderSentFor: null, pausedAt: null, updatedAt: raw`now()` }
          : { status: "active", periodStart: raw`now()`, periodEnd: raw`now() + interval '1 month'`, renewedAt: raw`now()`, reminderSentFor: null, pausedAt: null, updatedAt: raw`now()` })
        .where(and(eq(studentSubscriptions.id, o.s.id), inArray(studentSubscriptions.status, ["active", "paused", "expired"])))
        .returning();
    } catch (e) {
      // The student already asked again after it expired: that newer request is the live one.
      if (isUniqueViolation(e)) return { ok: false, error: "already-live" };
      throw e;
    }
    if (!row) return { ok: false, error: "not-renewable" };
    await notify(db, row.studentProfileId, {
      key: "subscriptionRenewed",
      params: { who: tutorShown(o.tutor), offerTitle: o.offerTitle, until: new Date(row.periodEnd as Date).toISOString() },
      href: `/${o.tutor.slug}`,
      aboutProfileId: o.tutor.profileId,
    });
    return { ok: true, periodEnd: iso(row.periodEnd) };
  });

  app.post("/tutor/subscriptions/:id/pause", async (req) => {
    const o = await own(req, "tutor");
    if (!o.ok) return o;
    const [row] = await db.update(studentSubscriptions)
      .set({ status: "paused", pausedAt: raw`now()`, updatedAt: raw`now()` })
      .where(and(eq(studentSubscriptions.id, o.s.id), eq(studentSubscriptions.status, "active")))
      .returning();
    if (!row) return { ok: false, error: "not-active" };
    await notify(db, row.studentProfileId, {
      key: "subscriptionPaused",
      params: { who: tutorShown(o.tutor), offerTitle: o.offerTitle },
      href: `/${o.tutor.slug}`,
      aboutProfileId: o.tutor.profileId,
    });
    return { ok: true };
  });

  app.post("/tutor/subscriptions/:id/resume", async (req) => {
    const o = await own(req, "tutor");
    if (!o.ok) return o;
    // A month that ran out while paused is over: the nightly job would expire it anyway.
    const [row] = await db.update(studentSubscriptions)
      .set({ status: raw`case when ${studentSubscriptions.periodEnd} > now() then 'active' else 'expired' end::student_subscription_status`, pausedAt: null, updatedAt: raw`now()` })
      .where(and(eq(studentSubscriptions.id, o.s.id), eq(studentSubscriptions.status, "paused")))
      .returning();
    if (!row) return { ok: false, error: "not-paused" };
    if (row.status === "active") {
      await notify(db, row.studentProfileId, {
        key: "subscriptionResumed",
        params: { who: tutorShown(o.tutor), offerTitle: o.offerTitle },
        href: `/${o.tutor.slug}`,
        aboutProfileId: o.tutor.profileId,
      });
    }
    return { ok: true, status: row.status };
  });

  /** Cancel, by either side. A request never confirmed gives its promotion use back. */
  async function cancel(o: Extract<Awaited<ReturnType<typeof own>>, { ok: true }>, by: "tutor" | "student") {
    const row = await db.transaction(async (tx) => {
      const [r] = await tx.update(studentSubscriptions)
        .set({ status: "cancelled", cancelledAt: raw`now()`, updatedAt: raw`now()` })
        .where(and(eq(studentSubscriptions.id, o.s.id), inArray(studentSubscriptions.status, ["requested", "active", "paused"])))
        .returning();
      if (r && o.s.status === "requested" && r.promotionId) await releasePromotionUse(tx, r.promotionId);
      return r;
    });
    if (!row) return { ok: true, already: true }; // idempotent
    if (by === "student" && o.tutor.profileId) {
      await notify(db, o.tutor.profileId, {
        key: "subscriptionCancelledByStudent",
        params: { who: publicDisplayName(o.session.profile.fullName), offerTitle: o.offerTitle },
        href: "/dashboard/subscriptions",
        aboutProfileId: o.session.profile.id,
      });
    } else if (by === "tutor") {
      await notify(db, row.studentProfileId, {
        key: "subscriptionCancelledByTutor",
        params: { who: tutorShown(o.tutor), offerTitle: o.offerTitle },
        href: `/${o.tutor.slug}`,
        aboutProfileId: o.tutor.profileId,
      });
    }
    return { ok: true };
  }

  app.post("/tutor/subscriptions/:id/cancel", async (req) => {
    const o = await own(req, "tutor");
    if (!o.ok) return o;
    return cancel(o, "tutor");
  });

  /* ══ The student's side ═══════════════════════════════════════════════════ */

  app.post("/subscriptions", async (req, reply) => {
    const parsed = z.object({ offerId: z.string(), promoCode: z.string().nullable().optional() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad-request" });
    const input = checkInput(subscriptionRequestSchema, parsed.data);
    if (!input.ok) return input;

    const session = await getSession(req);
    if (!session) return { ok: false, error: "not-authenticated" };
    const uid = session.profile.id;
    const rl = await checkRateLimit(`subreq:${uid}`, 10, 60 * 60_000);
    if (!rl.ok) return { ok: false, error: "too-many-requests" };

    const [o] = await db
      .select({ offer: tutorOffers, tutor: tutors })
      .from(tutorOffers)
      .innerJoin(tutors, eq(tutors.id, tutorOffers.tutorId))
      .where(eq(tutorOffers.id, input.value.offerId))
      .limit(1);
    // Only an offer on a PUBLIC page can be asked for.
    if (!o || !o.offer.active || o.offer.archivedAt || o.tutor.status !== "verified" || o.tutor.suspendedAt || o.tutor.erasedAt) {
      return { ok: false, error: "unavailable" };
    }
    if (o.tutor.profileId === uid) return { ok: false, error: "own-offer" };
    if (session.profile.role !== "student") return { ok: false, error: "students-only" };
    const gate = await minorGate(session);
    if (!gate.ok) return gate;

    const base = Number(o.offer.priceTndPerMonth);
    let promoNotice: string | null = null;
    let created: Sub | undefined;
    try {
      created = await db.transaction(async (tx) => {
        // THE PRICE SHOWN, after the one best promotion (pricing.ts) — kept on the row.
        const { quote, notice } = await quoteItem(tx, o.tutor.id, { kind: "monthly", id: o.offer.id, priceTnd: base }, input.value.promoCode);
        promoNotice = notice;
        let price = base;
        let promotionId: string | null = null;
        if (quote.promotion && (await claimPromotionUse(tx, quote.promotion.id))) {
          price = quote.finalTnd;
          promotionId = quote.promotion.id;
        } else if (quote.promotion) promoNotice = "exhausted";
        const [row] = await tx.insert(studentSubscriptions).values({
          offerId: o.offer.id,
          tutorId: o.tutor.id,
          studentProfileId: uid,
          status: "requested",
          sessionsPerMonth: o.offer.sessionsPerMonth,
          priceTnd: price.toFixed(2),
          promotionId,
          paymentsEnabled: paymentsEnabled(),
        }).returning();
        return row;
      });
    } catch (e) {
      // One live subscription per student per tutor — the partial unique index decides.
      if (isUniqueViolation(e)) return { ok: false, error: "already-subscribed" };
      throw e;
    }
    if (!created) return { ok: false, error: "unavailable" };

    if (o.tutor.profileId) {
      await notify(db, o.tutor.profileId, {
        key: "subscriptionRequested",
        // First name only, aboutProfileId so an erasure can rewrite it.
        params: { who: publicDisplayName(session.profile.fullName), offerTitle: o.offer.title, priceTnd: Number(created.priceTnd) },
        href: "/dashboard/subscriptions",
        aboutProfileId: uid,
      });
    }
    return { ok: true, subscription: await toMine(created, o.offer.title), ...(promoNotice ? { promoNotice } : {}) };
  });

  /* The signed-in student's subscription with one tutor — live first, else the latest. */
  app.get<{ Querystring: { slug?: string } }>("/subscriptions/mine", async (req) => {
    const session = await getSession(req);
    if (!session) return { ok: false, error: "not-authenticated" };
    const slug = vSlug(req.query?.slug ?? "");
    if (!slug.ok) return { ok: true, subscription: null };
    const rows = await db
      .select({ s: studentSubscriptions, offerTitle: tutorOffers.title })
      .from(studentSubscriptions)
      .innerJoin(tutorOffers, eq(tutorOffers.id, studentSubscriptions.offerId))
      .innerJoin(tutors, eq(tutors.id, studentSubscriptions.tutorId))
      .where(and(eq(studentSubscriptions.studentProfileId, session.profile.id), eq(tutors.slug, slug.value)))
      .orderBy(desc(studentSubscriptions.createdAt))
      .limit(5);
    const pick = rows.find((r) => ["requested", "active", "paused"].includes(r.s.status)) ?? rows[0];
    return { ok: true, subscription: pick ? await toMine(pick.s, pick.offerTitle) : null };
  });

  app.post("/subscriptions/:id/cancel", async (req) => {
    const o = await own(req, "student");
    if (!o.ok) return o;
    return cancel(o, "student");
  });
}
