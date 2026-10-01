import type { NextRequest } from "next/server";
import { clientIpFrom } from "@/lib/client-ip";

/* ONE-CLICK UNSUBSCRIBE, the link end — Espace prof v2 · Phase 4 · contract C5.

   Every e-mail's footer link and its List-Unsubscribe header point HERE (one
   public origin; packages/shared/src/unsubscribe.ts builds the URL).

     GET   a person clicked the link → 303 to the confirm page in their language.
           Nothing changes on a GET: mail scanners prefetch links, and a prefetch
           must not unsubscribe anybody.
     POST  RFC 8058 one-click (the mail client's own "Unsubscribe" button sends
           `List-Unsubscribe=One-Click`, token in the query) → done, 200, no page.

   The decision lives in apps/api; the token is never logged (the API logs the
   path only, and `token` is a redacted field everywhere). */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000";

function api(path: string, req: NextRequest, init: RequestInit = {}) {
  const ip = clientIpFrom(req.headers);
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(ip ? { "x-forwarded-for": ip } : {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
}

export async function GET(req: NextRequest): Promise<Response> {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  let locale: "fr" | "ar" = "fr";
  try {
    const res = await api(`/email/unsubscribe?token=${encodeURIComponent(token)}`, req);
    const body = (await res.json()) as { ok?: boolean; locale?: string };
    if (body.ok && body.locale === "ar") locale = "ar";
  } catch {
    /* the page will say the link does not work */
  }
  // A relative Location: behind the TLS proxy the public origin is the browser's own.
  const location = `/${locale}/email/unsubscribe${token ? `?token=${encodeURIComponent(token)}` : ""}`;
  return new Response(null, { status: 303, headers: { location, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

export async function POST(req: NextRequest): Promise<Response> {
  let token = req.nextUrl.searchParams.get("token") ?? "";
  if (!token) {
    try {
      token = String((await req.formData()).get("token") ?? "");
    } catch {
      /* no form body */
    }
  }
  try {
    const res = await api("/email/unsubscribe", req, { method: "POST", body: JSON.stringify({ token }) });
    const body = (await res.json()) as { ok?: boolean };
    return new Response(body.ok ? "ok" : "invalid", {
      status: body.ok ? 200 : 400,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  } catch {
    return new Response("unavailable", { status: 503, headers: { "cache-control": "no-store" } });
  }
}
