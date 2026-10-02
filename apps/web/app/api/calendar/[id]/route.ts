import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@tnajem/shared/auth-core";

/* "Ajouter au calendrier" — the download link in the booking emails and the
   student space (espace prof v2 · phase 7).

   A PASS-THROUGH, shaped like app/api/material/[id]: the access rule (the owner
   student or the class's tutor, 404 for everyone else) lives in apps/api —
   GET /bookings/:id/calendar.ics — and this handler makes no decision of its own.

   One thing it adds: an email link opened without a session. The API answers 401,
   and a raw 401 in a browser tab is a dead end, so this sends the reader to log in
   and then to the place the button lives (« Mes cours » for a student). ?l= is the
   email's language; the student space works for a tutor too (it bounces them home). */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000";
const PASSTHROUGH = ["content-type", "content-disposition", "cache-control", "x-content-type-options"];

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const locale = req.nextUrl.searchParams.get("l") === "ar" ? "ar" : "fr";

  if (!token) return toLogin(req, locale);

  const upstream = await fetch(`${API_URL}/bookings/${encodeURIComponent(params.id)}/calendar.ics`, {
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (upstream.status === 401) return toLogin(req, locale);

  const headers = new Headers();
  for (const h of PASSTHROUGH) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (!headers.has("cache-control")) headers.set("cache-control", "private, no-store, max-age=0");
  if (!headers.has("x-content-type-options")) headers.set("x-content-type-options", "nosniff");
  return new Response(upstream.body, { status: upstream.status, headers });
}

function toLogin(req: NextRequest, locale: "fr" | "ar"): Response {
  const url = req.nextUrl.clone();
  url.pathname = `/${locale}/auth`;
  url.search = "";
  url.searchParams.set("next", `/${locale}/student`);
  return Response.redirect(url, 303);
}
