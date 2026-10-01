import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { eq, getNotificationPrefs, profiles, setNotificationPrefs } from "@tnajem/db";
import { verifyUnsubscribeToken } from "@tnajem/shared/unsubscribe";
import { db } from "../db";
import { getSession } from "../lib/session";
import { checkRateLimit, ipBucket, rlSubject } from "../lib/rate-limit";

/* E-MAIL PREFERENCES AND ONE-CLICK UNSUBSCRIBE — Espace prof v2 · P4 · contract C5.

     GET          /me/notification-prefs   the caller's switches (no row = all on)
     PUT | POST   /me/notification-prefs   change some of them (POST because the
                                           web proxy speaks GET/POST only)
     GET          /email/unsubscribe?token= what a token would switch off — changes
                                           NOTHING (a mail scanner prefetching the
                                           link must not unsubscribe anyone)
     POST         /email/unsubscribe?token= switch it off (the click, and the RFC 8058
                                           one-click a mail client sends)

   The token is an HMAC signature (packages/shared/src/unsubscribe.ts), not a
   session: it can only turn one kind OFF for one profile, never sign anybody in,
   never read anything back but the kind and the profile's language. */

const prefsBody = z
  .object({
    followers: z.boolean(),
    bookings: z.boolean(),
    messages: z.boolean(),
    reminders: z.boolean(),
  })
  .partial()
  .strict();

const tokenBody = z.object({ token: z.string().max(200) }).partial();

async function unsubscribeBudget(req: FastifyRequest): Promise<boolean> {
  return (await checkRateLimit(`unsub:ip:${rlSubject(ipBucket(req.ip))}`, 30, 10 * 60_000)).ok;
}

export async function notificationPrefRoutes(app: FastifyInstance): Promise<void> {
  app.get("/me/notification-prefs", async (req) => {
    const session = await getSession(req);
    if (!session) return { ok: false, error: "not-authenticated" };
    return { ok: true, prefs: await getNotificationPrefs(db, session.profile.id) };
  });

  const save = async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = prefsBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "bad-request" });
    const session = await getSession(req);
    if (!session) return { ok: false, error: "not-authenticated" };
    const rl = await checkRateLimit(`prefs:${session.profile.id}`, 60, 60 * 60_000);
    if (!rl.ok) return { ok: false, error: "too-many-requests" };
    return { ok: true, prefs: await setNotificationPrefs(db, session.profile.id, parsed.data) };
  };
  app.put("/me/notification-prefs", save);
  app.post("/me/notification-prefs", save);

  app.get<{ Querystring: { token?: string } }>("/email/unsubscribe", async (req) => {
    if (!(await unsubscribeBudget(req))) return { ok: false, error: "too-many-requests" };
    const t = verifyUnsubscribeToken(req.query?.token);
    if (!t) return { ok: false, error: "invalid-token" };
    const [p] = await db.select({ locale: profiles.locale, purgedAt: profiles.purgedAt }).from(profiles).where(eq(profiles.id, t.profileId)).limit(1);
    if (!p || p.purgedAt) return { ok: false, error: "invalid-token" };
    const prefs = await getNotificationPrefs(db, t.profileId);
    return { ok: true, kind: t.kind, locale: p.locale === "ar" ? "ar" : "fr", already: !prefs[t.kind] };
  });

  app.post<{ Querystring: { token?: string } }>("/email/unsubscribe", async (req, reply) => {
    const body = tokenBody.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "bad-request" });
    if (!(await unsubscribeBudget(req))) return { ok: false, error: "too-many-requests" };
    const t = verifyUnsubscribeToken(body.data.token ?? req.query?.token);
    if (!t) return { ok: false, error: "invalid-token" };
    const [p] = await db.select({ locale: profiles.locale, purgedAt: profiles.purgedAt }).from(profiles).where(eq(profiles.id, t.profileId)).limit(1);
    if (!p || p.purgedAt) return { ok: false, error: "invalid-token" };
    await setNotificationPrefs(db, t.profileId, { [t.kind]: false });
    req.log.info({ kind: t.kind }, "email unsubscribe"); // the kind only — never the token, never who
    return { ok: true, kind: t.kind, locale: p.locale === "ar" ? "ar" : "fr" };
  });
}
