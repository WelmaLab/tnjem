import { db } from "../db";
import { eq, rateLimits, sql as raw } from "@tnajem/db";
import { peekRateLimit, rateLimitInProcess, rlSubject, type RateLimitResult } from "./rate-limit";

/* ── GUESSING WITHOUT LOCKING ANYONE OUT (VULN-001, security audit Nov 2026) ──────
   Codes and passwords used to have a budget keyed on the ADDRESS alone: 10 wrong
   codes / 15 min, 20 wrong passwords / hour, from anywhere. Brute force is made of
   failures, so that bounded it — but anyone who knew an address could spend that
   budget for its owner, and the owner's correct code or password was then refused
   from every network. A lock any stranger can turn is a denial of service.

   Now no failure count keyed on the address alone ever REFUSES anybody. Three
   things remain, all counting failures only:

     pair  (address, IP bucket)   a hard budget: past `max` failures this network
                                  waits out the window for this address. It is the
                                  limit one attacker host meets; it cannot touch
                                  the owner on another network.
     id    (address, any IP)      a COUNTER, never a refusal. Past `free` failures
                                  in its (sliding) window, every further failure
                                  arms a gate for the address: 2 s, 4 s, 8 s … capped
                                  at `capSec` (60 s). A delay, never a lock.
     gate  (address)              the wait itself. It holds back only the networks
                                  that have already failed for this address at
                                  least `cleanPairFailures` times. A network that
                                  has not (the owner at home, at worst after one
                                  typo) is never held by it, so a stranger keeping
                                  the gate armed cannot starve the owner of the next
                                  slot. A network that has waits ≤ 60 s, and the
                                  right answer after the wait succeeds.

   Plus the per-IP caps each caller keeps (one host spraying many addresses).

   ── THE STRICT DELAY FOR UNTRUSTED BROWSERS (VULN-001 follow-up) ──────────────
   The above is the LENIENT path, and a botnet with fresh networks could ride it at
   the speed otp.ts allows (5 guesses per code, a code a minute: ~7,200 a day). It
   is now kept for browsers holding a valid « trusted browser » token for the
   address (lib/trusted-browser.ts) — something only whoever already signed in to
   that account can have. Every OTHER attempt, from any network, also meets:

     sid   (address, untrusted)   a sliding 24 h count of untrusted attempts,
                                  RESERVED atomically before the attempt is
                                  evaluated and given back on success;
     sgate (address, untrusted)   from the `free`-th (3rd) untrusted attempt on,
                                  each one must CLAIM this gate — atomically, only
                                  if it is open — and re-arms it: 60 s doubling to
                                  a 15-minute cap. Rotating IPs does not help: the
                                  gate is the address's, not the network's. A
                                  parallel burst cannot slip through either: the
                                  count and the claim are single statements.
   Still a delay, never a lock: the right answer after the wait succeeds, and the
   owner's trusted browser is never held by it (the escape hatch while an attack
   runs). A held attempt is refused before any hashing and gives its reservation
   back. Unknown addresses are counted exactly like real ones. `strictPrefix` lets
   flows that guess the SAME secret share one count (code sign-in and reset both
   guess the one code row).

   What this costs: a botnet with many fresh networks gets `cleanPairFailures`
   unthrottled guesses per network per pair window before the gate holds it. For
   codes that is still bounded by otp.ts (5 guesses per code, a new code at most
   once a minute per address); for passwords by the per-IP cap. The founder chose
   that over a lock a stranger can turn.

   Every key holds the address as a keyed hash (rate-limit.ts::rlSubject), never the
   address, and an unknown address is counted exactly like a real one, so a delay is
   no oracle. While held back, an attempt is refused before any hashing and is not
   counted, so the wait cannot be stretched by hammering. Keys: `<prefix>:pair:
   <hash>:<ip>` (ends in the IP, like every per-IP key), `<prefix>:id:<hash>` and
   `<prefix>:gate:<hash>` (end in the hash). Different flows use different prefixes,
   so they never share a counter. */

export type FailureBudget = { max: number; windowMs: number };
export type ProgressiveDelay = {
  /** Address-wide failures, in the window, before any wait. */
  free: number;
  /** The first wait; each further failure doubles it. */
  baseSec: number;
  /** The longest wait. Short enough to be a delay, never a lock. */
  capSec: number;
  /** Sliding: the address's count forgets everything this long after its last failure. */
  windowMs: number;
  /** A network with fewer failures than this for the address is not held by the gate. */
  cleanPairFailures: number;
};
/** The identity-wide delay every UNTRUSTED attempt meets (see the header). */
export type StrictDelay = {
  /** Untrusted attempts on the address before the gate must be claimed (the `free`-th arms it). */
  free: number;
  /** The wait the `free`-th attempt arms; each further one doubles it. */
  baseSec: number;
  /** The longest wait. */
  capSec: number;
  /** Sliding: the count forgets everything this long after its last untrusted attempt. */
  windowMs: number;
};
/** The founder's numbers (VULN-001 follow-up): past 3 untrusted attempts on an address
    in 24 h, 60 s doubling to a 15-minute cap. Codes and passwords both use it. */
export const UNTRUSTED_DELAY: StrictDelay = { free: 3, baseSec: 60, capSec: 15 * 60, windowMs: 24 * 60 * 60_000 };
export type AttemptGuard = { prefix: string; pair: FailureBudget; delay: ProgressiveDelay; strict: StrictDelay; strictPrefix?: string };

export const guardKeys = (prefix: string, identifier: string, ip: string, strictPrefix = prefix) => {
  const h = rlSubject(identifier);
  return {
    pair: `${prefix}:pair:${h}:${ip}`,
    id: `${prefix}:id:${h}`,
    gate: `${prefix}:gate:${h}`,
    sid: `${strictPrefix}:sid:${h}`,
    sgate: `${strictPrefix}:sgate:${h}`,
  };
};
const keysOf = (g: AttemptGuard, identifier: string, ip: string) => guardKeys(g.prefix, identifier, ip, g.strictPrefix);

/** Seconds of wait armed by the n-th address-wide failure in the window (0 = none). */
export function delayAfter(failures: number, d: ProgressiveDelay): number {
  if (failures <= d.free) return 0;
  return Math.min(d.capSec, d.baseSec * 2 ** Math.min(16, failures - d.free - 1));
}

/** Seconds of strict wait armed by the n-th untrusted attempt in the window (0 = none). */
export function strictDelayAfter(attempt: number, s: StrictDelay): number {
  if (attempt < s.free) return 0;
  return Math.min(s.capSec, s.baseSec * 2 ** Math.min(16, attempt - s.free));
}

/** May this (address, IP) attempt now? Spends nothing. Fails open, like the limiter.
    An untrusted caller is also held by the address's strict gate. */
export async function guardCheck(g: AttemptGuard, identifier: string, ip: string, trusted = false): Promise<RateLimitResult> {
  const k = keysOf(g, identifier, ip);
  const [pairFull, dirty, gate, strict] = await Promise.all([
    peekRateLimit(k.pair, g.pair.max),
    peekRateLimit(k.pair, g.delay.cleanPairFailures),
    peekRateLimit(k.gate, 1),
    trusted ? Promise.resolve<RateLimitResult>({ ok: true, retryAfter: 0 }) : peekRateLimit(k.sgate, 1),
  ]);
  if (!pairFull.ok) return pairFull;
  if (!strict.ok) return strict;
  if (!dirty.ok && !gate.ok) return gate;
  return { ok: true, retryAfter: 0 };
}

/** Let through by the strict delay. Call `succeeded()` when the attempt was right:
    a success is no attack, so it gives its reservation back. */
export type StrictPass = { ok: true; retryAfter: 0; succeeded: () => Promise<void> };
const TRUSTED_PASS: StrictPass = { ok: true, retryAfter: 0, succeeded: async () => {} };

/** Reserve this attempt against the address's strict delay, atomically. A trusted
    browser passes untouched. Run it LAST before evaluating the attempt (after every
    other check), so a reservation is only ever spent on an evaluated attempt. */
export async function strictEnter(
  g: AttemptGuard,
  identifier: string,
  trusted: boolean,
): Promise<StrictPass | { ok: false; retryAfter: number }> {
  if (trusted) return TRUSTED_PASS;
  const k = keysOf(g, identifier, "");
  const n = await countSliding(k.sid, g.strict.windowMs);
  const giveBack = () => uncount(k.sid);
  const pass: StrictPass = { ok: true, retryAfter: 0, succeeded: giveBack };
  if (n < g.strict.free) return pass; // n = 0 too: the count could not be written (fail open)
  const claimed = await claimGate(k.sgate, strictDelayAfter(n, g.strict));
  if (claimed.ok) return pass;
  await giveBack();
  return { ok: false, retryAfter: claimed.retryAfter };
}

/** One failure: the pair's budget, the address's counter, and the wait it arms. */
export async function guardFailure(g: AttemptGuard, identifier: string, ip: string): Promise<void> {
  const k = keysOf(g, identifier, ip);
  const [, failures] = await Promise.all([countFailure(k.pair, g.pair), countSliding(k.id, g.delay.windowMs)]);
  const wait = delayAfter(failures, g.delay);
  if (wait > 0) await armGate(k.gate, wait);
}

/** Count a failure in a fixed window that is EXTENDED when the budget fills, so the
    wait runs from the failure that filled it (not from whatever was left of a window
    the first failure opened, possibly seconds). */
export async function countFailure(key: string, { max, windowMs }: FailureBudget): Promise<void> {
  try {
    await db
      .insert(rateLimits)
      .values({ key, count: 1, resetAt: raw`now() + ${windowMs} * interval '1 millisecond'` })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: {
          count: raw`case when ${rateLimits.resetAt} <= now() then 1 else ${rateLimits.count} + 1 end`,
          resetAt: raw`case when ${rateLimits.resetAt} <= now() or ${rateLimits.count} + 1 >= ${max}
                            then now() + ${windowMs} * interval '1 millisecond'
                            else ${rateLimits.resetAt} end`,
        },
      });
  } catch (e) {
    // The code only (see rate-limit.ts): the key's parameters must not reach a log.
    console.error("[tnajem-api] failure count write failed — in-process fallback:", (e as { code?: string }).code ?? (e as Error).name);
    rateLimitInProcess(key, max, windowMs);
  }
}

/** The address-wide counter: every failure pushes its end out by `windowMs`. Returns
    the count, or 0 when the write fails (no wait armed: fail open). */
async function countSliding(key: string, windowMs: number): Promise<number> {
  try {
    const [row] = await db
      .insert(rateLimits)
      .values({ key, count: 1, resetAt: raw`now() + ${windowMs} * interval '1 millisecond'` })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: {
          count: raw`case when ${rateLimits.resetAt} <= now() then 1 else ${rateLimits.count} + 1 end`,
          resetAt: raw`now() + ${windowMs} * interval '1 millisecond'`,
        },
      })
      .returning({ count: rateLimits.count });
    return row?.count ?? 0;
  } catch (e) {
    console.error("[tnajem-api] failure count write failed:", (e as { code?: string }).code ?? (e as Error).name);
    return 0;
  }
}

/** The wait: a row whose reset_at is when the address may be tried again. Never shortened. */
async function armGate(key: string, seconds: number): Promise<void> {
  try {
    await db
      .insert(rateLimits)
      .values({ key, count: 1, resetAt: raw`now() + ${seconds} * interval '1 second'` })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: {
          count: 1,
          resetAt: raw`greatest(${rateLimits.resetAt}, now() + ${seconds} * interval '1 second')`,
        },
      });
  } catch (e) {
    console.error("[tnajem-api] delay write failed:", (e as { code?: string }).code ?? (e as Error).name);
  }
}

/** Take the strict gate if it is open, re-arming it for `seconds`: one statement, so
    of any number of concurrent claimants exactly one wins. Fails open. */
async function claimGate(key: string, seconds: number): Promise<RateLimitResult> {
  try {
    const won = await db
      .insert(rateLimits)
      .values({ key, count: 1, resetAt: raw`now() + ${seconds} * interval '1 second'` })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: { count: 1, resetAt: raw`now() + ${seconds} * interval '1 second'` },
        setWhere: raw`${rateLimits.resetAt} <= now()`,
      })
      .returning({ key: rateLimits.key });
    if (won.length) return { ok: true, retryAfter: 0 };
    const held = await peekRateLimit(key, 1);
    return held.ok ? { ok: false, retryAfter: 1 } : held;
  } catch (e) {
    console.error("[tnajem-api] delay write failed:", (e as { code?: string }).code ?? (e as Error).name);
    return { ok: true, retryAfter: 0 };
  }
}

/** Give one reservation back (a success, or an attempt the gate refused). */
async function uncount(key: string): Promise<void> {
  try {
    await db
      .update(rateLimits)
      .set({ count: raw`greatest(${rateLimits.count} - 1, 0)` })
      .where(eq(rateLimits.key, key));
  } catch (e) {
    console.error("[tnajem-api] failure count write failed:", (e as { code?: string }).code ?? (e as Error).name);
  }
}
