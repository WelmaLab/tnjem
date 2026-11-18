import "server-only";
import { cookies, headers } from "next/headers";
import { SESSION_COOKIE } from "@tnajem/shared/auth-core";
import { revalidateTutor, revalidatePublicTutors } from "./cache";
import { clientIpFrom } from "./client-ip";
import type { ActionResult } from "@tnajem/shared/contracts";

/* The proxy every ported server action calls.

   Step 4's whole premise is that each action keeps its exported SIGNATURE and
   only its body changes, so no call site moves and the diff stays provable. This
   file is where the one-hop-to-Fastify lives.

   ══════════════════════════════════════════════════════════════════════════════
   FIVE RULES. Each of them is a behaviour change if broken.
   ══════════════════════════════════════════════════════════════════════════════

   1. X-FORWARDED-FOR IS LOAD-BEARING, NOT PLUMBING.
      clientIp() keys the OTP rate limiter (otp:req:ip 10/10min, otp:vfy:ip
      30/15min). The API now sees the WEB SERVER's socket address for every
      request, so unless the real client address is forwarded, all traffic
      collapses into one bucket: one attacker exhausts the limit for the entire
      internet, and every real user's throttle is spent by strangers.
      We OVERWRITE the header with the address Next already resolved — never
      append, because appending lets a client prepend a forged hop. The API side
      only trusts it from configured addresses (apps/api/src/env.ts::TRUST_PROXY).

   2. RETHROW TRANSPORT FAILURES. Do not convert them to { ok: false }.
      Today a database failure THROWS out of the action and the promise rejects,
      so Next's error boundary fires. Swallowing an API outage into a tidy
      { ok: false, error: "server-error" } would turn "the error boundary fires"
      into "the UI quietly says try again", and would mask an outage in exactly
      the place it most needs to be visible. Stage A's contract is identity, not
      improvement.

   3. NEVER call cookies() or headers() in a proxy used by an ISR page.
      getTutorReviews and getExploreTutors are called during SSR — the first from
      inside unstable_cache, where touching cookies() THROWS, and outside it the
      route silently opts out of ISR with no error and no warning. /[slug] and
      /explore would just stop being cached, and every WhatsApp-storm hit would
      become a database round trip. Those use callAnonymous().

   4. revalidate STAYS ON THE WEB SIDE.
      revalidateTag/revalidatePath only work inside a Next request scope, so they
      cannot move. Mutating endpoints report what they invalidated and we replay
      it here — see the `revalidate` field in @tnajem/shared/contracts.

   5. RETRY GETs ONLY, ONCE, ON ECONNREFUSED.
      Never retry a POST: retrying reserveSeat double-books. */

const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000";

/** The client's address as the proxy in front of us saw it. Rule 1.
    It used to take the LEFTMOST X-Forwarded-For entry — the one the client writes
    itself — so the OTP limiter's per-IP key was whatever the caller sent. */
async function forwardedFor(): Promise<string> {
  try {
    return clientIpFrom(await headers());
  } catch {
    return ""; // outside a request scope
  }
}

async function sessionToken(): Promise<string | undefined> {
  try {
    return (await cookies()).get(SESSION_COOKIE)?.value;
  } catch {
    return undefined;
  }
}

class ApiTransportError extends Error {
  /* apiRequestId: the API's own x-request-id, which it sets on EVERY response
     (apps/api/src/server.ts's onSend hook) and logs with the failure. It was
     available on `res.headers` here and thrown away, so one failure produced two
     unrelated reports — a 500 in the web tier and an unconnected `request failed`
     in the API log. instrumentation.ts reads it off the error and tags the Sentry
     event with it; `/api/admin/doc/:id` already passes the same header through to
     the browser for the same reason. */
  constructor(message: string, readonly status?: number, readonly apiRequestId?: string) {
    super(message);
    this.name = "ApiTransportError";
  }
}

/** The API's request id, when it answered at all. Never throws. */
function apiRequestId(res: Response): string | undefined {
  return res.headers.get("x-request-id") ?? undefined;
}

type CallOptions = {
  method?: "GET" | "POST" | "PATCH"; // december-sprint · B: PATCH /admin/centre-leads/:id
  body?: unknown;
  anonymous?: boolean;
  /** Seconds Next may cache this fetch. Anonymous reads only — see request(). */
  revalidate?: number;
};

async function request(path: string, opts: CallOptions): Promise<unknown> {
  const method = opts.method ?? "POST";
  const headersOut: Record<string, string> = { "content-type": "application/json" };

  if (!opts.anonymous) {
    const token = await sessionToken();
    if (token) headersOut.cookie = `${SESSION_COOKIE}=${token}`;
    const ip = await forwardedFor();
    if (ip) headersOut["x-forwarded-for"] = ip; // OVERWRITE, never append
  }

  /* CACHING — and `no-store` is NOT the safe default here.

     An authenticated call must never be cached: the response depends on who is
     asking. So those stay no-store.

     An ANONYMOUS call is different, and getting this wrong cost a real regression:
     getPublicTutorRefs runs inside unstable_cache (lib/cache.ts), and Next 14
     REFUSES a no-store fetch in that scope — "Dynamic server usage: no-store
     fetch". The wrapper then failed, and /sitemap.xml quietly shipped with ZERO
     tutor slugs: 200 OK, 12 entries, every verified tutor's storefront missing
     from Google's discovery path. No error page, no failing test, just the
     product's main organic-growth surface silently emptied.

     So anonymous reads use a bounded `next.revalidate` instead: legal inside
     unstable_cache, and bounded so nothing can be cached indefinitely. The outer
     wrapper still owns the real TTL (60s storefront, 3600s sitemap); this inner
     bound is only ever fresher. */
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: headersOut,
    body: method === "GET" ? undefined : JSON.stringify(opts.body ?? {}),
    ...(opts.anonymous
      ? { next: { revalidate: opts.revalidate ?? 60 } }
      : { cache: "no-store" as const }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    /* Rule 2: a non-200 here is a transport or shape failure, never a domain
       outcome — those come back as 200 with { ok:false, error }. Throwing keeps
       today's behaviour, where a DB failure rejects the action's promise. */
    const id = apiRequestId(res);
    throw new ApiTransportError(
      `${method} ${path} -> ${res.status}${id ? ` (api request ${id})` : ""}`,
      res.status,
      id,
    );
  }
  return res.json();
}

/** Authenticated call: forwards the session cookie and the client address. */
export async function call<T>(path: string, body?: unknown, method: "GET" | "POST" | "PATCH" = "POST"): Promise<T> {
  const out = (await request(path, { method, body })) as T & Partial<ActionResult>;

  // Rule 4: replay the invalidations the API reported.
  const rv = out?.revalidate;
  if (rv) {
    for (const slug of rv.tutors ?? []) revalidateTutor(slug);
    if (rv.publicTutors) revalidatePublicTutors();
  }
  return out;
}

/** Anonymous call for SSR/ISR reads. Rule 3: touches NO cookies and NO headers,
    and never no-store — see the caching note in request(). */
export async function callAnonymous<T>(path: string, revalidate = 60): Promise<T> {
  return (await request(path, { method: "GET", anonymous: true, revalidate })) as T;
}

/** Multipart passthrough for the verification upload.

    The FormData object is handed straight to fetch: undici sets the boundary
    itself, and setting content-type by hand without one is the classic way to
    break a multipart request. It is deliberately NOT buffered — the action
    already holds the files in this process once, and reading them again here
    would double peak memory on the same box. */
export async function callMultipart<T>(path: string, form: FormData): Promise<T> {
  const token = await sessionToken();
  const ip = await forwardedFor();
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      ...(token ? { cookie: `${SESSION_COOKIE}=${token}` } : {}),
      ...(ip ? { "x-forwarded-for": ip } : {}),
    },
    body: form,
    cache: "no-store",
    // Uploads are up to 6 x 8 MB over a Tunisian 3G link; 10s is not enough.
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const id = apiRequestId(res);
    throw new ApiTransportError(`POST ${path} -> ${res.status}${id ? ` (api request ${id})` : ""}`, res.status, id);
  }
  return (await res.json()) as T;
}

export { ApiTransportError };
