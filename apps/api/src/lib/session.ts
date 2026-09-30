import { randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { and, eq, gt, isNull, lt, ne, or, profiles, sessions } from "@tnajem/db";
import { SESSION_COOKIE, SESSION_DAYS, SESSION_IDLE_DAYS, sessionTokenHash } from "@tnajem/shared/auth-core";
import { db } from "../db";
import { COOKIE_DOMAIN, IS_PROD } from "../env";

/* Sessions, ported from apps/web/lib/auth.ts.

   THERE IS NO SIGNING, and that is not an omission — it is what makes the Step 4
   port incremental. A session token is 256 bits of randomness stored in the
   `sessions` table and validated by a join on every request. So while some actions
   still run in Next and others already run here, BOTH processes validate the exact
   same row and agree on identity with nothing shared but Postgres.

   Had sessions been signed JWTs, an incremental port would need the signing key in
   both processes plus a key-rotation story in the middle of a refactor. Someone
   will eventually propose "improving" this to JWTs; the cost is that the migration
   stops being incremental, and JWT-in-localStorage would additionally be
   XSS-readable, which is strictly worse than an httpOnly cookie. */

export type SessionProfile = {
  id: string;
  role: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  birthYear: number | null;
  birthMonth: number | null; // phase-a lane L2 (A24): isAdult needs month + year
  locale: string | null;
};

export type Session = { token: string; profile: SessionProfile };

export async function createSession(profileId: string): Promise<{ token: string; expiresAt: Date }> {
  /* Session fixation: a fresh 256-bit token is minted on every successful login
     and the cookie is overwritten, so a token an attacker planted pre-login is
     never the one that ends up authenticated. */
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  // The cookie gets the token; the table gets its hash (0020). See sessionTokenHash.
  await db.insert(sessions).values({ tokenHash: sessionTokenHash(token), profileId, expiresAt });
  // A login is activity: it restarts the inactive-account clock (@tnajem/shared/legal).
  await db.update(profiles).set({ lastSeenAt: new Date() }).where(eq(profiles.id, profileId));

  /* Opportunistic GC of this profile's expired rows — the sessions table
     otherwise grows forever (every login on every device leaves a row behind).
     Best-effort: a failed cleanup must not fail the login. */
  try {
    await db
      .delete(sessions)
      .where(and(eq(sessions.profileId, profileId), or(lt(sessions.expiresAt, new Date()), lt(sessions.lastSeenAt, idleCutoff()))));
  } catch (e) {
    // The code only: a driver error can carry query parameters.
    console.error("[tnajem-api] session cleanup failed", (e as { code?: string }).code ?? (e as Error).name);
  }

  return { token, expiresAt };
}

const idleCutoff = () => new Date(Date.now() - SESSION_IDLE_DAYS * 86_400_000);

/* How stale last_seen_at may get before a request moves it. The idle window is
   days long; a write per request to keep it minute-accurate would be the busiest
   write in the product for no benefit. */
const LAST_SEEN_RESOLUTION_MS = 15 * 60_000;

/** Resolve the caller's session, or null. One join, on every authenticated request. */
export async function getSession(req: FastifyRequest): Promise<Session | null> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = sessionTokenHash(token);

  const [row] = await db
    .select({
      lastSeenAt: sessions.lastSeenAt,
      id: profiles.id,
      role: profiles.role,
      fullName: profiles.fullName,
      email: profiles.email,
      phone: profiles.phone,
      birthYear: profiles.birthYear,
      birthMonth: profiles.birthMonth, // phase-a lane L2 (A24)
      locale: profiles.locale,
    })
    .from(sessions)
    .innerJoin(profiles, eq(profiles.id, sessions.profileId))
    /* A BLOCKED account has no session, whatever cookie it holds. Blocking also
       deletes the rows (routes/admin-accounts.ts); this is what makes a session
       minted a moment before the block — or restored from a backup — worthless. */
    /* Absolute expiry, idle expiry, and not blocked — all three on every request,
       so a revocation (logout everywhere, a block, a deletion request) takes effect
       on the very next call. */
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        gt(sessions.expiresAt, new Date()),
        gt(sessions.lastSeenAt, idleCutoff()),
        isNull(profiles.blockedAt),
      ),
    )
    .limit(1);

  if (!row) return null;

  if (Date.now() - new Date(row.lastSeenAt).getTime() > LAST_SEEN_RESOLUTION_MS) {
    try {
      const now = new Date();
      await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.tokenHash, tokenHash));
      // The same clock drives inactive-account erasure (INACTIVE_ACCOUNT_RETENTION_DAYS).
      await db.update(profiles).set({ lastSeenAt: now }).where(eq(profiles.id, row.id));
    } catch (e) {
      // Best-effort: a missed touch shortens the idle window by minutes, never lengthens it.
      req.log.warn({ code: (e as { code?: string }).code ?? (e as Error).name }, "session touch failed");
    }
  }

  return {
    token,
    profile: {
      id: row.id,
      role: row.role,
      fullName: row.fullName,
      email: row.email,
      phone: row.phone,
      birthYear: row.birthYear,
      birthMonth: row.birthMonth, // phase-a lane L2 (A24)
      locale: row.locale,
    },
  };
}

export async function destroySession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, sessionTokenHash(token)));
}

/** End every session of a profile, optionally keeping the one making the request. */
export async function destroyProfileSessions(profileId: string, opts: { keepToken?: string } = {}): Promise<number> {
  const rows = await db
    .delete(sessions)
    .where(
      opts.keepToken
        ? and(eq(sessions.profileId, profileId), ne(sessions.tokenHash, sessionTokenHash(opts.keepToken)))
        : eq(sessions.profileId, profileId),
    )
    .returning({ profileId: sessions.profileId });
  return rows.length;
}

/* ROTATION ON PRIVILEGE CHANGE. The token that authenticated a request as a
   student must not be the one that goes on to act as a tutor: if it had leaked
   (a shared device, a logged request), the leak would now carry the new powers.
   The old row is deleted and a fresh token minted in one transaction; the caller
   hands the new token to the web, which replaces the cookie. */
export async function rotateSession(oldToken: string, profileId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.transaction(async (tx) => {
    await tx.delete(sessions).where(eq(sessions.tokenHash, sessionTokenHash(oldToken)));
    await tx.insert(sessions).values({ tokenHash: sessionTokenHash(token), profileId, expiresAt });
  });
  return { token, expiresAt };
}

/* Cookie options, byte-identical to apps/web's createSession. Kept in ONE place
   so the two processes cannot set subtly different attributes for the same
   cookie name — a mismatch on sameSite or path produces two cookies and an
   intermittently-logged-out user. */
export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: IS_PROD,
    path: "/",
    expires: expiresAt,
    /* Scoped to .tnajem.com in production so tnajem.com and api.tnajem.com share it.
       Unset in dev — both are localhost, where a domain attribute breaks it. */
    domain: COOKIE_DOMAIN,
  };
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/", domain: COOKIE_DOMAIN });
}
