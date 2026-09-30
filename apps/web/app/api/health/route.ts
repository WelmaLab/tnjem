import { NextResponse } from "next/server";

/* THE PUBLIC HEALTH SURFACE — what an uptime monitor watches.
 *
 * It did not exist. PRODUCTION_READINESS.md's Stage 6 gate
 * (`curl -sf https://tnajem.com/api/health | jq -e '.ok'`) and Stage 7's "uptime
 * monitoring on / and /api/health" both named this URL, and nothing served it:
 * the only health endpoint was the API's, on loopback port 4000, which nginx
 * deliberately does not expose. So the documented check was a 404 and the
 * documented monitor had nothing to poll.
 *
 * WHY THE STATUS CODE IS THE SIGNAL HERE, and a bare 200 with a body is the signal
 * on the API. They are read by different things:
 *   - the API's /health answers Docker's HEALTHCHECK and an operator with curl. It
 *     stays 200 with `db:false` so a failure can SAY WHY (a 503 with an empty body
 *     tells an operator strictly less), and so a storage problem does not pull the
 *     whole API out of rotation.
 *   - this route answers an uptime monitor, and monitors alert on status codes.
 *     Anything degraded is 503, because a monitor that only reads 200 would stay
 *     green through a total database outage.
 *
 * WHAT IT MAY NOT LEAK. It is unauthenticated and world-reachable, so it reports
 * booleans and a version, never a reason: a connection error carries the database
 * host, port and user, and "which dependency is down" is enough for the person on
 * call, who then reads the log. The API's own /health applies the same rule.
 */

/* Never cached, never prerendered: a cached health check reports the health of a
   moment that has passed, and is the classic way a monitor stays green through an
   outage. force-dynamic and no-store belong together here. */
export const dynamic = "force-dynamic";
export const revalidate = 0;

const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000";

type ApiHealth = { ok?: boolean; db?: boolean; storage?: boolean; version?: string };

export async function GET(): Promise<NextResponse> {
  /* The web tier answering at all is the first fact: this code ran, so the Node
     process is up, the build is loadable and the runtime is serving. Everything
     else is a dependency. */
  let api = false;
  let db = false;
  let storage = false;
  let version: string | undefined;

  try {
    /* Short timeout on purpose. A monitor's own timeout is usually 10-30s, and a
       health check that hangs for 30s is indistinguishable from one that failed —
       except that it also ties up a Node worker per poll. 3s is well beyond a
       loopback round trip to a healthy API. */
    const res = await fetch(`${API_URL}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
      headers: { accept: "application/json" },
    });
    if (res.ok) {
      const body = (await res.json()) as ApiHealth;
      api = body.ok === true;
      db = body.db === true;
      storage = body.storage === true;
      version = typeof body.version === "string" ? body.version : undefined;
    }
  } catch {
    /* Unreachable, refused, or slower than the timeout — all the same fact from
       out here, and the reason is in the web process's own log. */
    api = false;
  }

  const ok = api && db && storage;
  return NextResponse.json(
    { ok, web: true, api, db, storage, version },
    {
      status: ok ? 200 : 503,
      headers: {
        /* Belt and braces with revalidate=0 above: a CDN in front of this (the
           nginx/Cloudflare layer in DEPLOY.md §6) must not serve a stale answer. */
        "cache-control": "no-store, no-cache, must-revalidate",
      },
    },
  );
}
