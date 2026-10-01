import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq, gte, isNull, sql as raw, classes, tutors, vitrineStatsDaily } from "@tnajem/db";
import { isUuid, normalizeUtmSource, tunisWallTime, vSlug } from "@tnajem/shared";
import { db } from "../db";
import { getSession } from "../lib/session";
import { checkRateLimit, ipBucket, rlSubject } from "../lib/rate-limit";

/* VITRINE STATISTICS — Espace prof v2 · Phase 3.

   "Vues · Clics · Abonnés" on Ma vitrine, privacy-safe and with no third-party
   tracker. Two endpoints:

     POST /vitrine/hit    the page beacon. /{slug} is ISR-cached HTML, so a view
                          cannot be counted where the page is rendered (one render
                          serves thousands of visitors): a tiny client island
                          (components/share/VitrineBeacon.tsx) posts once per load.
     GET  /vitrine/stats  the owner's own last-N-days aggregate.

   NOTHING ABOUT THE VISITOR IS STORED. The only write is `+1` on an aggregate row
   (tutor, Tunis day, source) — vitrine_stats_daily has no column that could hold
   an IP, a user agent or a session. The address IS read, transiently, to stop one
   machine inflating the count: it goes into the rate limiter as a keyed HMAC
   (rlSubject — meaningless outside this process, expiring with its window), never
   in clear, and never next to the tutor's counters.

   BOT-TOLERANT, not bot-proof — these are a tutor's own encouragement numbers,
   not billing: crawlers and link-preview fetchers do not run the beacon's JS,
   the beacon itself skips obvious bot user agents (in the browser), the same
   address counts once per tutor/source per 30 minutes, and an address that fires
   the beacon in bulk stops counting at all for the window. The owner's own visits
   never count.

   utm_source is ANALYTICS ONLY: normalizeUtmSource() maps it onto a closed
   vocabulary ("whatsapp", "qr", … "direct", "other"); it is never used to decide
   who anyone is. */

const hitBody = z.object({
  slug: z.string().max(80),
  classId: z.string().max(80).nullable().optional(),
  source: z.string().max(80).nullable().optional(),
});

/** Tunis calendar day, in SQL — the clock the write uses. */
const tunisToday = raw`(now() at time zone 'Africa/Tunis')::date`;

/** "YYYY-MM-DD", `n` Tunis calendar days before today — the read's lower bound. */
function tunisDayMinus(n: number, now: Date = new Date()): string {
  const w = tunisWallTime(now);
  const d = new Date(Date.UTC(w.year, w.month - 1, w.day - n));
  return d.toISOString().slice(0, 10);
}

const DEDUPE_WINDOW_MS = 30 * 60_000;
const IP_BUDGET = 60; // beacons per address per 10 minutes, across every tutor
const IP_WINDOW_MS = 10 * 60_000;

export async function vitrineRoutes(app: FastifyInstance): Promise<void> {
  /* ── POST /vitrine/hit — anonymous beacon ──────────────────────────────────
     Always answers { ok: true }, counted or not: the caller is a page that cannot
     do anything with a refusal, and a different answer for "deduplicated" vs
     "counted" would only tell a scraper how the limiter works. */
  app.post("/vitrine/hit", async (req, reply) => {
    const parsed = hitBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad-request" });
    const slug = vSlug(parsed.data.slug);
    if (!slug.ok) return { ok: true };
    const classId = parsed.data.classId && isUuid(parsed.data.classId) ? parsed.data.classId.toLowerCase() : null;
    const source = normalizeUtmSource(parsed.data.source);

    // A class page that was not reached through a shared link is not a vitrine event.
    if (classId && source === "direct") return { ok: true };

    const ip = ipBucket(req.ip);
    const budget = await checkRateLimit(`vitrine:ip:${rlSubject(ip)}`, IP_BUDGET, IP_WINDOW_MS);
    if (!budget.ok) return { ok: true };

    /* The tutor must be PUBLIC (verified, not suspended): an unverified tutor's
       page is not online, so nobody can have "visited" it. A class must belong to
       the tutor named in the beacon — a mismatched pair is a crafted request. */
    const [t] = await db
      .select({ id: tutors.id, profileId: tutors.profileId })
      .from(tutors)
      .where(and(eq(tutors.slug, slug.value), eq(tutors.status, "verified"), isNull(tutors.suspendedAt)))
      .limit(1);
    if (!t) return { ok: true };
    if (classId) {
      const [c] = await db.select({ id: classes.id }).from(classes)
        .where(and(eq(classes.id, classId), eq(classes.tutorId, t.id))).limit(1);
      if (!c) return { ok: true };
    }

    // The tutor looking at their own page is not an audience.
    const session = await getSession(req);
    if (session && t.profileId && session.profile.id === t.profileId) return { ok: true };

    const seen = await checkRateLimit(
      `vitrine:seen:${rlSubject(`${ip}|${t.id}|${classId ?? "profile"}|${source}`)}`,
      1,
      DEDUPE_WINDOW_MS,
    );
    if (!seen.ok) return { ok: true };

    const views = classId ? 0 : 1;
    const clicks = source === "direct" ? 0 : 1;
    await db
      .insert(vitrineStatsDaily)
      .values({ tutorId: t.id, day: tunisToday, source, views, clicks })
      .onConflictDoUpdate({
        target: [vitrineStatsDaily.tutorId, vitrineStatsDaily.day, vitrineStatsDaily.source],
        set: {
          views: raw`${vitrineStatsDaily.views} + ${views}`,
          clicks: raw`${vitrineStatsDaily.clicks} + ${clicks}`,
        },
      });
    return { ok: true };
  });

  /* ── GET /vitrine/stats?days=30 — the owner's numbers ──────────────────────
     Zero is a real answer and comes back as 0, never padded (the truth rule).
     `followers` is null until Phase 4 gives it a table. */
  app.get<{ Querystring: { days?: string } }>("/vitrine/stats", async (req) => {
    const session = await getSession(req);
    if (!session) return { ok: false, error: "not-authenticated" };
    if (session.profile.role !== "tutor") return { ok: false, error: "not-a-tutor" };
    const [mine] = await db.select({ id: tutors.id }).from(tutors)
      .where(eq(tutors.profileId, session.profile.id)).limit(1);
    if (!mine) return { ok: false, error: "no-storefront" };

    const asked = Number(req.query?.days ?? 30);
    const days = Number.isInteger(asked) && asked >= 1 && asked <= 90 ? asked : 30;
    const since = tunisDayMinus(days - 1);

    const rows = await db
      .select({
        day: raw<string>`to_char(${vitrineStatsDaily.day}, 'YYYY-MM-DD')`,
        source: vitrineStatsDaily.source,
        views: vitrineStatsDaily.views,
        clicks: vitrineStatsDaily.clicks,
      })
      .from(vitrineStatsDaily)
      .where(and(eq(vitrineStatsDaily.tutorId, mine.id), gte(vitrineStatsDaily.day, since)));

    const bySource = new Map<string, { views: number; clicks: number }>();
    const byDay = new Map<string, { views: number; clicks: number }>();
    let views = 0;
    let clicks = 0;
    for (const r of rows) {
      views += r.views;
      clicks += r.clicks;
      const s = bySource.get(r.source) ?? { views: 0, clicks: 0 };
      s.views += r.views;
      s.clicks += r.clicks;
      bySource.set(r.source, s);
      const d = byDay.get(r.day) ?? { views: 0, clicks: 0 };
      d.views += r.views;
      d.clicks += r.clicks;
      byDay.set(r.day, d);
    }

    return {
      ok: true,
      days,
      since,
      totals: { views, clicks },
      bySource: [...bySource].map(([source, v]) => ({ source, ...v })).sort((a, b) => b.views + b.clicks - (a.views + a.clicks)),
      daily: [...byDay].map(([day, v]) => ({ day, ...v })).sort((a, b) => a.day.localeCompare(b.day)),
      followers: null as number | null,
    };
  });
}
