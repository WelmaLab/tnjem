import { createHmac } from "node:crypto";
import { authSecret, safeEq, TRUSTED_BROWSER_DAYS } from "@tnajem/shared/auth-core";

/* ── THE « TRUSTED BROWSER » TOKEN (VULN-001 follow-up, security audit Nov 2026) ──
   After a successful sign-in (code, password, or a reset that signs in) the browser
   is given a token the web stores as an httpOnly cookie (TRUSTED_BROWSER_COOKIE,
   180 days). A browser that presents a valid token for the address it is trying
   keeps the lenient guessing path (lib/attempt-guard.ts); every other attempt on
   that address counts towards a strict, identity-wide delay. A stranger cannot hold
   one: it is only ever issued to whoever just proved the account.

   A token is

       v1.<subject>.<issuedAtMs>.<mac>

     subject   keyed hash of the identity (HMAC with AUTH_SECRET, its own label):
               the cookie never holds the address, and a token is found for an
               address without trying every one;
     mac       HMAC-SHA256(AUTH_SECRET) over the version, the PROFILE id, the
               subject, the issue time and the profile's trusted_browser_epoch
               (0048). So a token is bound to one account (A's token is nothing on
               B, nor on a new account later created with A's address), its issue
               time cannot be moved, and bumping the epoch (« Se déconnecter
               partout », a password reset) retires every older token.

   Expiry is enforced here, from the signed issue time, whatever the cookie's own
   expiry says. The comparison is constant-time (safeEq). The cookie holds up to
   five tokens, newest first, separated by "~", so a shared family computer keeps a
   few accounts trusted. Stateless: nothing is stored but the epoch. */

export const TRUSTED_TOKEN_TTL_MS = TRUSTED_BROWSER_DAYS * 86_400_000;
export const TRUSTED_TOKENS_PER_BROWSER = 5;
/** A token "issued" further in the future than this is refused (clock skew allowance). */
const FUTURE_SKEW_MS = 5 * 60_000;
const TOKEN_RE = /^v1\.([0-9a-f]{32})\.(\d{13})\.([0-9a-f]{64})$/;

/** The identity, as the cookie may hold it: a keyed hash, meaningless without AUTH_SECRET. */
export function trustedSubject(identity: string): string {
  return createHmac("sha256", authSecret()).update(`tnajem:trusted-browser:subject:${identity}`).digest("hex").slice(0, 32);
}

function mac(profileId: string, subject: string, issuedAt: number, epoch: number): string {
  return createHmac("sha256", authSecret())
    .update(`tnajem:trusted-browser:v1:${profileId}:${subject}:${issuedAt}:${epoch}`)
    .digest("hex");
}

export function issueTrustedToken(profileId: string, identity: string, epoch: number, now = Date.now()): string {
  const subject = trustedSubject(identity);
  return `v1.${subject}.${now}.${mac(profileId, subject, now, epoch)}`;
}

type Parsed = { raw: string; subject: string; issuedAt: number; mac: string };

function parse(token: string): Parsed | null {
  const m = TOKEN_RE.exec(token);
  return m ? { raw: token, subject: m[1], issuedAt: Number(m[2]), mac: m[3] } : null;
}

const fresh = (issuedAt: number, now: number) => issuedAt <= now + FUTURE_SKEW_MS && now - issuedAt <= TRUSTED_TOKEN_TTL_MS;

/** The well-formed, unexpired tokens of a cookie value, newest first as stored. Never throws. */
function tokensOf(cookie: string | undefined | null, now: number): Parsed[] {
  if (!cookie || cookie.length > 2048) return [];
  return cookie
    .split("~")
    .slice(0, TRUSTED_TOKENS_PER_BROWSER)
    .map(parse)
    .filter((t): t is Parsed => t !== null && fresh(t.issuedAt, now));
}

/** The token this cookie holds for `identity`, if any — before any database lookup,
    so a caller without one (every stranger) costs nothing and learns nothing. */
export function tokenFor(cookie: string | undefined | null, identity: string, now = Date.now()): string | null {
  const subject = trustedSubject(identity);
  return tokensOf(cookie, now).find((t) => t.subject === subject)?.raw ?? null;
}

/** Is `token` a valid, unexpired token for this account, address and epoch? Constant-time MAC check. */
export function trustedTokenValid(token: string | null, profileId: string, identity: string, epoch: number, now = Date.now()): boolean {
  const t = token ? parse(token) : null;
  if (!t || !fresh(t.issuedAt, now)) return false;
  if (!safeEq(t.subject, trustedSubject(identity))) return false;
  return safeEq(t.mac, mac(profileId, t.subject, t.issuedAt, epoch));
}

/** The cookie value after a successful sign-in: the new token first, then the other
    addresses' still-unexpired tokens, at most five in all. */
export function nextTrustedCookie(
  previous: string | undefined | null,
  profileId: string,
  identity: string,
  epoch: number,
  now = Date.now(),
): { token: string; expiresAt: string } {
  const own = issueTrustedToken(profileId, identity, epoch, now);
  const subject = trustedSubject(identity);
  const others = tokensOf(previous, now).filter((t) => t.subject !== subject).map((t) => t.raw);
  return {
    token: [own, ...others].slice(0, TRUSTED_TOKENS_PER_BROWSER).join("~"),
    expiresAt: new Date(now + TRUSTED_TOKEN_TTL_MS).toISOString(),
  };
}
