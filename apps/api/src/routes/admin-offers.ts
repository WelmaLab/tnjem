import type { FastifyInstance } from "fastify";
import { desc, eq, profiles, promotions, studentSubscriptions, tutorOffers, tutors } from "@tnajem/db";
import { isUuid, publicDisplayName, type AdminOfferRow, type AdminSubscriptionRow, type SubscriptionStatus } from "@tnajem/shared";
import { db } from "../db";
import { requireAdmin } from "../lib/admin";
import { auditAdminStrict } from "../lib/audit";

/* GET /admin/tutors/:tutorId/offers — an admin's READ-ONLY view of a tutor's monthly
   offers and the subscriptions to them (espace prof v2 · phase 7, spec item 6).

   Next to growth's /admin/tutors/:tutorId/promotions, and built the same way:
     • the admin allow-list decides (requireAdmin), a bare uuid confirms nothing;
     • it is a DISCLOSURE (who subscribes to whom), so the read is written to the
       append-only audit log BEFORE any data leaves — auditAdminStrict throws, and a
       failed log is a refused read ("offers.read");
     • the student appears by FIRST NAME only, like everywhere a counterparty is named;
     • nothing here changes anything: an offer and a subscription belong to the
       tutor and the student; support only needs to see what they agreed. */

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

export async function adminOfferRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { tutorId: string } }>("/admin/tutors/:tutorId/offers", async (req) => {
    const session = await requireAdmin(req);
    if (!session) return { ok: false, error: "forbidden" };
    if (!isUuid(req.params.tutorId)) return { ok: false, error: "not-found" };
    const [t] = await db.select({ id: tutors.id }).from(tutors).where(eq(tutors.id, req.params.tutorId)).limit(1);
    if (!t) return { ok: false, error: "not-found" };

    // Logged BEFORE the data leaves; a failed log is a refused read.
    await auditAdminStrict(session.profile.id, "offers.read", { kind: "tutor", id: t.id }, `request ${req.id}`);

    const offerRows = await db
      .select()
      .from(tutorOffers)
      .where(eq(tutorOffers.tutorId, t.id))
      .orderBy(desc(tutorOffers.createdAt))
      .limit(50);
    const subRows = await db
      .select({ s: studentSubscriptions, offerTitle: tutorOffers.title, fullName: profiles.fullName, percent: promotions.percent })
      .from(studentSubscriptions)
      .innerJoin(tutorOffers, eq(tutorOffers.id, studentSubscriptions.offerId))
      .innerJoin(profiles, eq(profiles.id, studentSubscriptions.studentProfileId))
      .leftJoin(promotions, eq(promotions.id, studentSubscriptions.promotionId))
      .where(eq(studentSubscriptions.tutorId, t.id))
      .orderBy(desc(studentSubscriptions.createdAt))
      .limit(200);

    const offers: AdminOfferRow[] = offerRows.map((o) => ({
      id: o.id,
      title: o.title,
      sessionsPerMonth: o.sessionsPerMonth,
      priceTnd: Number(o.priceTndPerMonth),
      active: o.active,
      archived: Boolean(o.archivedAt),
      createdAt: new Date(o.createdAt).toISOString(),
    }));
    const subscriptions: AdminSubscriptionRow[] = subRows.map((r) => ({
      id: r.s.id,
      offerTitle: r.offerTitle,
      studentFirstName: publicDisplayName(r.fullName),
      status: r.s.status as SubscriptionStatus,
      sessionsPerMonth: r.s.sessionsPerMonth,
      priceTnd: Number(r.s.priceTnd),
      promotionPercent: r.percent ?? null,
      requestedAt: new Date(r.s.createdAt).toISOString(),
      confirmedAt: iso(r.s.confirmedAt),
      periodStart: iso(r.s.periodStart),
      periodEnd: iso(r.s.periodEnd),
      cancelledAt: iso(r.s.cancelledAt),
    }));
    return { ok: true, offers, subscriptions };
  });
}
