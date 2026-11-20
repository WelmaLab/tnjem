import { createHash, timingSafeEqual } from "node:crypto";
import { SESSION_DAYS, SESSION_IDLE_DAYS } from "./legal";

/* The parts of authentication that BOTH apps/web and apps/api must agree on,
   byte for byte.

   During Step 4 the two processes validate the same sessions and the same OTP
   codes against the same tables at the same time. If the hash construction or the
   cookie name drifted even slightly, a code minted by one process could not be
   verified by the other and login would break in a way that looks intermittent.
   So the constants and the hash live here, in one pure module, and both sides
   import them rather than keeping a copy.

   DB-bound logic (session lookup, the OTP row lifecycle, the rate-limit upsert)
   stays on each side, because it needs a database handle. Only the agreements
   live here. */

export const SESSION_COOKIE = "tnajem_session";

/* NON-SENSITIVE UI hint, readable by the client. It lets the global <SiteHeader>
   show the right nav link WITHOUT a getMe() POST on every page load. It is NOT a
   credential: it is readable and forgeable, holds only the coarse role, and only
   ever decides which link the header renders. Every server-side check re-derives
   identity from the httpOnly SESSION_COOKIE, so forging this buys nothing but a
   nav link that bounces you to /auth.

   It stays entirely on the web side — the API must never read it. */
export const ROLE_HINT_COOKIE = "tnajem_role";

/* VULN-001 follow-up — the « trusted browser » cookie. httpOnly, set by the web
   (apps/web/lib/auth.ts::adoptTrustedBrowser) from the value apps/api returns after
   a successful sign-in, and forwarded back to the API's /auth/* routes only. It
   marks the DEVICE, not the session: logout leaves it. Holds up to five signed
   tokens (apps/api/src/lib/trusted-browser.ts), never an address. */
export const TRUSTED_BROWSER_COOKIE = "tnajem_tb";
export const TRUSTED_BROWSER_DAYS = 180;

/* Two clocks on every session. ABSOLUTE: 30 days from login, whatever happens.
   IDLE: a session nobody has used for SESSION_IDLE_DAYS stops working, so a
   forgotten login on a shared or lost phone does not stay open for a month. */
// Values live in ./legal (LEGAL-REVIEW); re-exported where auth code expects them.
export { SESSION_DAYS, SESSION_IDLE_DAYS };

/** What the sessions table stores for a cookie token: sha256, hex. Never the token. */
export function sessionTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
export const OTP_TTL_MIN = 5;
export const MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 60_000;

/* The same two numbers in seconds, exported so the server can hand them to the
   client and the login screens can draw a countdown. The client must never carry
   its own copy: a hardcoded 60 in the UI is a promise about a rule enforced on the
   server, and it becomes a lie the first time someone tunes the cooldown — the
   button re-enables while the server still refuses, which reads as the product
   being broken. */
export const OTP_RESEND_COOLDOWN_SEC = OTP_RESEND_COOLDOWN_MS / 1000;
export const OTP_TTL_SEC = OTP_TTL_MIN * 60;

const DEV_SECRET = "dev-insecure-secret-change-me";

export function missingSecretError(): Error {
  return new Error(
    "[Tnajem] AUTH_SECRET is not set (or is empty). It is REQUIRED in production: every " +
      "OTP hash depends on it and the dev default is public. Generate one with " +
      "`openssl rand -hex 32` and put it in the environment. Refusing to hash an OTP.",
  );
}

let cachedSecret: string | null = null;

/** Resolved on FIRST USE, never at module load. Throws in production if unset.

    ── WHY LAZY AND NOT A MODULE-LOAD THROW ────────────────────────────────────
    It used to throw in a module-level IIFE, and that breaks `next build`.

    `next build` runs with NODE_ENV=production and evaluates this module: every
    page imports SiteShell -> SiteHeader -> the actions module -> auth, so auth is
    in the server module graph of literally every route, including the ones
    prerendered to static HTML. A module-level throw therefore fires during
    "Generating static pages" on any box that injects secrets at RUNTIME rather
    than at build time — which is most of them. The build dies with no useful
    message and the deploy never happens.

    Lazy resolution gives the same guarantee where it matters (no production login
    is ever served with the public dev default) without making a secret a
    build-time requirement. Do not "fix" this by throwing at import time. */
export function authSecret(): string {
  if (cachedSecret) return cachedSecret;
  const fromEnv = process.env.AUTH_SECRET?.trim();
  if (fromEnv) {
    cachedSecret = fromEnv;
    return cachedSecret;
  }
  if (process.env.NODE_ENV === "production") throw missingSecretError();
  cachedSecret = DEV_SECRET;
  return cachedSecret;
}

/** Test seam. Never call this from application code. */
export function __resetAuthSecretCache(): void {
  cachedSecret = null;
}

/* Boot-time loudness without boot-time death: a production process that starts
   without AUTH_SECRET says so in the logs on first import, then dies on the first
   login attempt (authSecret() above). `next build` is unaffected. */
export function warnIfSecretMissing(): void {
  if (process.env.NODE_ENV === "production" && !process.env.AUTH_SECRET?.trim()) {
    console.error(
      "[Tnajem] FATAL CONFIG: AUTH_SECRET is not set. Every login WILL fail until it is. " +
        "Generate one with `openssl rand -hex 32`.",
    );
  }
}

/** Binds the code to the identity it was issued for, so a code minted for one
    address/number cannot be replayed against another. `identifier` is a phone
    under OTP_CHANNEL=sms and an email address under =email; the hash does not
    care. AUTH_SECRET is the whole strength of it — with the public dev default,
    all 1,000,000 hashes for an identity are computable offline and the 5-attempt
    budget stops meaning anything. */
export function hashOtpCode(identifier: string, code: string): string {
  return createHash("sha256").update(`${identifier}:${code}:${authSecret()}`).digest("hex");
}

/** Constant-time compare of two hex digests. Length-checked first, because
    timingSafeEqual throws on a length mismatch. */
export function safeEq(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export type OtpChannel = "email" | "sms";

/* Which identity a login code is sent to. Email is the default; `sms` is the
   revert path and is kept fully live and compiling, not commented out — commented
   code is invisible to tsc and to the audit gates, so it rots the first time
   anything around it moves. Flipping OTP_CHANNEL is the entire revert. */
export function otpChannel(): OtpChannel {
  return process.env.OTP_CHANNEL?.trim().toLowerCase() === "sms" ? "sms" : "email";
}
