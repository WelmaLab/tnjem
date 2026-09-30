import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@tnajem/shared/auth-core";

/* Protected viewer for uploaded verification documents — national ID scans.

   This is now a STREAMING PASS-THROUGH to apps/api. The URL does not change, and
   that is deliberate: e2e/admin.spec.ts asserts this exact path, and it is the URL
   the admin console links to. Moving it would have been a behaviour change dressed
   up as plumbing. It moves in Step 5, when the browser talks to api.tnajem.com
   directly — and that is a new file with its own gate.

   THE AUTHORISATION LIVES IN apps/api. This handler deliberately makes NO access
   decision of its own: a second gate here would be a second implementation of the
   most sensitive check in the product, and this codebase has already been bitten
   three times by two copies of a rule that nothing forced to agree. It forwards
   the session cookie and returns whatever the API decides, including the 403.

   Every hardening header comes from the API response and is passed through
   verbatim (CSP sandbox, nosniff, no-store, Content-Disposition). They are not
   re-derived here, for the same reason. */

export const runtime = "nodejs";        // needs a real fetch to the API
export const dynamic = "force-dynamic"; // never cached or prerendered

const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000";

const PASSTHROUGH_HEADERS = [
  "content-type",
  "content-disposition",
  "content-security-policy",
  "x-content-type-options",
  "cache-control",
  "referrer-policy",
  // Ties an admin-reported problem to the API log line and the audit row.
  "x-request-id",
];

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;

  /* The signed link's two parameters, and nothing else, are forwarded. The API
     checks them (apps/api/src/lib/doc-links.ts); this route still decides nothing. */
  const link = new URLSearchParams();
  for (const k of ["exp", "sig"]) {
    const v = req.nextUrl.searchParams.get(k);
    if (v) link.set(k, v);
  }

  const upstream = await fetch(
    `${API_URL}/admin/doc/${encodeURIComponent(params.id)}${link.size ? `?${link}` : ""}`,
    {
      headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : {},
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    },
  );

  const headers = new Headers();
  for (const h of PASSTHROUGH_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  /* Belt and braces: if the API ever forgot one of these, the document must still
     not be cached or sniffed. Only set what is missing — never override the API. */
  if (!headers.has("cache-control")) headers.set("cache-control", "private, no-store, max-age=0");
  if (!headers.has("x-content-type-options")) headers.set("x-content-type-options", "nosniff");

  return new Response(upstream.body, { status: upstream.status, headers });
}
