import { db } from "../db";
import { rateLimits, sql as raw } from "@tnajem/db";
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
export type AttemptGuard = { prefix: string; pair: FailureBudget; delay: ProgressiveDelay };

export const guardKeys = (prefix: string, identifier: string, ip: string) => {
  const h = rlSubject(identifier);
  return { pair: `${prefix}:pair:${h}:${ip}`, id: `${prefix}:id:${h}`, gate: `${prefix}:gate:${h}` };
};

/** Seconds of wait armed by the n-th address-wide failure in the window (0 = none). */
export function delayAfter(failures: number, d: ProgressiveDelay): number {
  if (failures <= d.free) return 0;
  return Math.min(d.capSec, d.baseSec * 2 ** Math.min(16, failures - d.free - 1));
}

/** May this (address, IP) attempt now? Spends nothing. Fails open, like the limiter. */
export async function guardCheck(g: AttemptGuard, identifier: string, ip: string): Promise<RateLimitResult> {
  const k = guardKeys(g.prefix, identifier, ip);
  const [pairFull, dirty, gate] = await Promise.all([
    peekRateLimit(k.pair, g.pair.max),
    peekRateLimit(k.pair, g.delay.cleanPairFailures),
    peekRateLimit(k.gate, 1),
  ]);
  if (!pairFull.ok) return pairFull;
  if (!dirty.ok && !gate.ok) return gate;
  return { ok: true, retryAfter: 0 };
}

/** One failure: the pair's budget, the address's counter, and the wait it arms. */
export async function guardFailure(g: AttemptGuard, identifier: string, ip: string): Promise<void> {
  const k = guardKeys(g.prefix, identifier, ip);
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
