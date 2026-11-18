import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@tnajem/shared/auth-core";

/* december-sprint · B (D13, gate amendment 9) — the centre-lead CSV export, as a
   STREAMING PASS-THROUGH to the API's GET /admin/centre-leads.csv.

   THE AUTHORISATION LIVES IN apps/api (requireAdmin), exactly as for
   /api/admin/doc/[id]: this handler makes NO access decision of its own — it
   forwards the session cookie and returns whatever the API answers, the 403
   included. The headers that matter (content-type, content-disposition,
   cache-control, nosniff) come from the API and are passed through verbatim. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000";
const PASSTHROUGH = ["content-type", "content-disposition", "cache-control", "x-content-type-options", "x-request-id"];

export async function GET(): Promise<Response> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  let upstream: Response;
  try {
    upstream = await fetch(`${API_URL}/admin/centre-leads.csv`, {
      headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : {},
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    // The API is down or timed out: a plain 502, never cached, no data.
    return new Response(JSON.stringify({ ok: false, error: "upstream-unavailable" }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store, max-age=0", "x-content-type-options": "nosniff" },
    });
  }
  const headers = new Headers();
  for (const h of PASSTHROUGH) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  // Personal data: never cached, never sniffed, even if the API forgot to say so.
  if (!headers.has("cache-control")) headers.set("cache-control", "private, no-store, max-age=0");
  if (!headers.has("x-content-type-options")) headers.set("x-content-type-options", "nosniff");
  return new Response(upstream.body, { status: upstream.status, headers });
}
