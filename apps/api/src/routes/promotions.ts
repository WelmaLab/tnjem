import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, desc, eq, isNull, sql as raw, classes, packs, promotions, tutorOffers, tutors } from "@tnajem/db";
import {
  isUuid, normalizePromoCode, promoCodeState, vSlug,
  type PromoScope, type TutorPricing, type TutorPromotionRow,
} from "@tnajem/shared";
import { checkInput, promotionInputSchema } from "@tnajem/shared/growth-input";
import { db } from "../db";
import { getSession } from "../lib/session";
import { requireAdmin } from "../lib/admin";
import { auditAdmin, auditAdminStrict } from "../lib/audit";
import { checkRateLimit, ipBucket, rlSubject } from "../lib/rate-limit";
import { isUniqueViolation } from "../lib/db-errors";
import { livePublicPromotions, promotionByCode, toPublicPromotion } from "../lib/promotions";

/* PROMOTIONS, 20 % MAXIMUM — Espace prof v2 · Phase 5 B.

     GET  /tutor/promotions                          the owner's list, with a derived state
     POST /tutor/promotions                          create (Zod: 1–20 %, scope/target, window)
     POST /tutor/promotions/:id/{pause|resume|end}   end is terminal
     GET  /tutors/:slug/pricing?code=                PUBLIC: live public promotions + the
                                                     visitor's code (rate-limited per address)
     GET  /admin/tutors/:tutorId/promotions          an admin's read-only view (audited)

   THE CAP, THREE TIMES: Zod here (percent-out-of-range), the SQL CHECK (a raw
   insert of 25 fails), and pricing.ts clamps whatever it is handed. No stacking is
   pricing.ts's job.

   AUDIT. Creating and ending a promotion are written to admin_actions — the
   existing append-only audit log (lib/audit.ts), in the same transaction, "no
   audit row, no action". The actor is a TUTOR, not an admin, so admin_profile_id
   stays NULL, as for the other non-admin event already logged there
   (consent.guardian_change_refused, routes/misc.ts); the note names the tutor and
   what was done ("tutor <id> · 15 % · all · code RENTREE"). A tutor reads their
   own promotions without a log line; an ADMIN reading a tutor's promotions is a
   disclosure, so it is logged first and refused if the log fails (auditAdminStrict). */

type PromoRow = typeof promotions.$inferSelect;

function stateOf(p: PromoRow, now = Date.now()): TutorPromotionRow["state"] {
  if (p.endedAt) return "ended";
  if (new Date(p.endsAt).getTime() <= now) return "expired";
  if (!p.active) return "paused";
  if (new Date(p.startsAt).getTime() > now) return "scheduled";
  if (p.maxUses != null && p.uses >= p.maxUses) return "exhausted";
  return "live";
}

function toRow(p: PromoRow): TutorPromotionRow {
  return {
    ...toPublicPromotion(p, true),
    maxUses: p.maxUses,
    uses: p.uses,
    active: p.active,
    endedAt: p.endedAt ? new Date(p.endedAt).toISOString() : null,
    createdAt: new Date(p.createdAt).toISOString(),
    state: stateOf(p),
  };
}

async function myTutor(req: FastifyRequest) {
  const session = await getSession(req);
  if (!session) return { ok: false as const, error: "not-authenticated" };
  if (session.profile.role !== "tutor") return { ok: false as const, error: "not-a-tutor" };
  const [t] = await db.select().from(tutors).where(eq(tutors.profileId, session.profile.id)).limit(1);
  return t ? { ok: true as const, tutor: t } : { ok: false as const, error: "no-storefront" };
}

/** The one class, pack or offer a scoped promotion names must be the tutor's own. */
async function ownsTarget(tutorId: string, scope: PromoScope, targetId: string | null | undefined): Promise<boolean> {
  if (!targetId) return true;
  const rows =
    scope === "class"
      ? await db.select({ id: classes.id }).from(classes).where(and(eq(classes.id, targetId), eq(classes.tutorId, tutorId))).limit(1)
      : scope === "pack"
        ? await db.select({ id: packs.id }).from(packs).where(and(eq(packs.id, targetId), eq(packs.tutorId, tutorId))).limit(1)
        : scope === "monthly"
          ? await db.select({ id: tutorOffers.id }).from(tutorOffers).where(and(eq(tutorOffers.id, targetId), eq(tutorOffers.tutorId, tutorId))).limit(1)
          : [];
  return rows.length > 0;
}

const note = (tutorId: string, p: { percent: number; scope: string; code: string | null }) =>
  [`tutor ${tutorId}`, `${p.percent} %`, p.scope, p.code ? `code ${p.code}` : "public"].join(" · ");

export async function promotionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/tutor/promotions", async (req) => {
    const me = await myTutor(req);
    if (!me.ok) return me;
    const rows = await db.select().from(promotions).where(eq(promotions.tutorId, me.tutor.id)).orderBy(desc(promotions.createdAt)).limit(100);
    return { ok: true, promotions: rows.map(toRow) };
  });

  app.post("/tutor/promotions", async (req) => {
    const me = await myTutor(req);
    if (!me.ok) return me;
    const input = checkInput(promotionInputSchema, req.body ?? {});
    if (!input.ok) return input;
    const v = input.value;
    const rl = await checkRateLimit(`promo:write:${me.tutor.id}`, 30, 60 * 60_000);
    if (!rl.ok) return { ok: false, error: "too-many-requests" };
    if (!(await ownsTarget(me.tutor.id, v.scope, v.targetId))) return { ok: false, error: "not-found" };

    let created: PromoRow | undefined;
    try {
      created = await db.transaction(async (tx) => {
        const [row] = await tx.insert(promotions).values({
          tutorId: me.tutor.id,
          code: v.code ?? null,
          percent: v.percent,
          scope: v.scope,
          targetId: v.scope === "all" ? null : (v.targetId ?? null),
          ...(v.startsAt ? { startsAt: new Date(v.startsAt) } : {}),
          endsAt: new Date(v.endsAt),
          maxUses: v.maxUses ?? null,
        }).returning();
        // No audit row, no promotion (lib/audit.ts throws, the transaction rolls back).
        await auditAdmin(null, "promotion.create", { kind: "promotion", id: row.id }, note(me.tutor.id, row), tx);
        return row;
      });
    } catch (e) {
      if (isUniqueViolation(e)) return { ok: false, error: "code-taken" };
      throw e;
    }
    // Cards, the profile and class pages show public promotions: their caches drop.
    return { ok: true, promotion: toRow(created), revalidate: { tutors: [me.tutor.slug], publicTutors: true } };
  });

  async function transition(req: FastifyRequest, to: "pause" | "resume" | "end") {
    const me = await myTutor(req);
    if (!me.ok) return me;
    const id = (req.params as { id?: string }).id ?? "";
    if (!isUuid(id)) return { ok: false, error: "not-found" };
    const mine = and(eq(promotions.id, id), eq(promotions.tutorId, me.tutor.id), isNull(promotions.endedAt));
    const row = await db.transaction(async (tx) => {
      const [r] = await tx.update(promotions)
        .set(to === "end"
          ? { endedAt: raw`now()`, active: false, updatedAt: raw`now()` }
          : { active: to === "resume", updatedAt: raw`now()` })
        .where(mine)
        .returning();
      if (r && to === "end") await auditAdmin(null, "promotion.end", { kind: "promotion", id: r.id }, note(me.tutor.id, r), tx);
      return r;
    });
    if (!row) return { ok: false, error: "not-found" };
    return { ok: true, promotion: toRow(row), revalidate: { tutors: [me.tutor.slug], publicTutors: true } };
  }
  app.post("/tutor/promotions/:id/pause", (req) => transition(req, "pause"));
  app.post("/tutor/promotions/:id/resume", (req) => transition(req, "resume"));
  app.post("/tutor/promotions/:id/end", (req) => transition(req, "end"));

  /* ── PUBLIC: what a visitor's page needs to price things ───────────────────
     Anonymous and the same for everyone, EXCEPT the code the visitor brought —
     which is why a page calls this from the browser (an ISR page never does).
     Code lookups are rate-limited per address: a code is a small secret, and this
     must not be a way to try them all. The answer never says how many uses are
     left or what the cap is. */
  app.get<{ Params: { slug: string }; Querystring: { code?: string } }>("/tutors/:slug/pricing", async (req): Promise<TutorPricing | null> => {
    const slug = vSlug(req.params.slug);
    if (!slug.ok) return null;
    const [t] = await db.select({ id: tutors.id }).from(tutors)
      .where(and(eq(tutors.slug, slug.value), eq(tutors.status, "verified"), isNull(tutors.suspendedAt))).limit(1);
    if (!t) return null;
    const out: TutorPricing = { promotions: (await livePublicPromotions(db, [t.id])).map((p) => toPublicPromotion(p)) };
    const raw = req.query?.code;
    if (raw) {
      const budget = await checkRateLimit(`promo:code:${rlSubject(ipBucket(req.ip))}`, 30, 10 * 60_000);
      if (!budget.ok) {
        out.code = { state: "invalid" };
      } else if (!normalizePromoCode(raw)) {
        out.code = { state: "invalid" };
      } else {
        const p = await promotionByCode(db, t.id, raw);
        const state = promoCodeState(p);
        out.code = state === "ok" && p ? { state, promotion: toPublicPromotion(p, true) } : { state };
      }
    }
    return out;
  });

  /* ── ADMIN, read-only: a tutor's promotions (the admin tutor page) ──────────── */
  app.get<{ Params: { tutorId: string } }>("/admin/tutors/:tutorId/promotions", async (req) => {
    const session = await requireAdmin(req);
    if (!session) return { ok: false, error: "forbidden" };
    if (!isUuid(req.params.tutorId)) return { ok: false, error: "not-found" };
    const [t] = await db.select({ id: tutors.id }).from(tutors).where(eq(tutors.id, req.params.tutorId)).limit(1);
    if (!t) return { ok: false, error: "not-found" };
    // Logged BEFORE the data leaves; a failed log is a refused read.
    await auditAdminStrict(session.profile.id, "promotions.read", { kind: "tutor", id: t.id }, `request ${req.id}`);
    const rows = await db.select().from(promotions).where(eq(promotions.tutorId, t.id)).orderBy(desc(promotions.createdAt)).limit(200);
    return { ok: true, promotions: rows.map(toRow) };
  });
}
