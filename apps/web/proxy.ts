import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { DEFAULT_LOCALE, isLocale, localeFromPath, stripLocale, type AppLocale } from "@/lib/locale";
import { RESERVED_SLUGS, isValidSlug } from "@tnajem/shared/validation";
import { createTutorLookup } from "@/lib/tutor-lookup";
import { clientIpFrom } from "@/lib/client-ip";
import { matchRoute, NOT_FOUND_SEGMENT } from "@/lib/route-table";

/* Three jobs, in order:

   1. LOCALE ROUTING. Every page lives under /fr/… or /ar/… (app/[locale]/…). A
      request with no locale prefix is redirected to the preferred locale (the
      NEXT_LOCALE cookie set by the language toggle, else French). This is what puts
      the locale in the URL — visible to crawlers, and knowable server-side so the
      public pages can stay statically/ISR-rendered per locale.

   2. AUTH GUARD (presence only). Redirects to /<locale>/auth when the session cookie
      is absent on a protected route. Real validation happens server-side via
      getSession(); the proxy only checks presence and never touches Postgres.

   3. EVERY 404 IS DECIDED HERE, with the status set before anything renders:
        • a path that is no page (lib/route-table.ts)          → catch-all 404
        • one segment that cannot be a slug, or a reserved name
          with no page of its own (/fr/class, /fr/live)          → catch-all 404
        • a well-formed slug no tutor has (lib/tutor-lookup.ts) → catch-all 404
      "Catch-all 404" is a rewrite to app/[locale]/[...rest] with status 404: a
      localized, server-rendered page that is never cached. A runtime notFound()
      could not do this job on Next 14.2 (it shipped an empty body); the decision
      stays here on Next 16, where it is already made before rendering starts. */

const SESSION_COOKIE = "tnajem_session";

const tutorLookup = createTutorLookup({
  fetch: (url, init) => fetch(url, init),
  now: Date.now,
  log: (line) => console.warn(line),
});

function selfOrigin(req: NextRequest): string {
  if (process.env.NODE_ENV !== "production") return req.nextUrl.origin;
  /* Production sits behind nginx, where nextUrl.origin is the PUBLIC host — a
     lookup through it would leave the box and come back in. Ask the server
     directly. HOSTNAME is the bind address (Dockerfile: 0.0.0.0; standalone
     script: localhost — never the 127.0.0.1 literal, which breaks every rewrite);
     a wildcard bind is reachable on loopback. */
  const host = process.env.HOSTNAME;
  const loopback = !host || host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  return `http://${loopback}:${process.env.PORT || "3000"}`;
}

/** Serve the localized 404 page under the requested URL, with a 404 status. */
function notFound(req: NextRequest, locale: AppLocale, bare: string): NextResponse {
  const url = req.nextUrl.clone();
  url.pathname = `/${locale}/${NOT_FOUND_SEGMENT}${bare === "/" ? "" : bare}`;
  return NextResponse.rewrite(url, { status: 404 });
}

/* Path prefixes (locale-stripped) that require a session. Mirrors the old matcher. */
const PROTECTED = ["/dashboard", "/onboarding", "/account", "/student", "/checkout", "/live", "/admin", "/messages", "/guardian"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const locale = localeFromPath(pathname);

  /* 1. No locale in the URL → serve the preferred one.

     THE ROOT IS REWRITTEN, NOT REDIRECTED. "tnajem.com" is the URL people type,
     read out loud and print; a 307 there costs a whole extra round trip before
     the first byte of HTML — 0.5-1s on Tunisian 3G — on the single most common
     entry point in the product. A rewrite serves /<locale> under the typed URL
     with no extra hop.

     Deeper paths still REDIRECT, deliberately: "/explore" and "/fr/explore"
     would otherwise both serve the same page at two URLs, which splits ranking
     signals and duplicates the crawl. The canonical form is the prefixed one,
     and a redirect is how you say so. The root is the one place where the
     canonical URL is genuinely the unprefixed one — layout.tsx already points
     its canonical/hreflang at the prefixed variants. */
  if (!locale) {
    const cookieLoc = req.cookies.get("NEXT_LOCALE")?.value;
    const preferred = isLocale(cookieLoc) ? cookieLoc : DEFAULT_LOCALE;
    const url = req.nextUrl.clone();
    url.pathname = pathname === "/" ? `/${preferred}` : `/${preferred}${pathname}`;
    /* THE ROOT'S BODY MUST NOT DEPEND ON THE COOKIE. /fr is prerendered, so the
       rewrite answers with "s-maxage=31536000" and Next REPLACES any Vary header set
       here (it sends its own: RSC, Next-Router-State-Tree…). It used to rewrite to
       the cookie's locale with "Vary: Cookie" — harmless while every page was
       no-store, but once /fr became static a shared cache (a CDN honouring
       s-maxage) could store one visitor's language and serve it to the next.
       So: the default locale is a rewrite — no extra hop for the first visit, the
       common case — and a stored non-default choice is a redirect. */
    if (pathname === "/" && preferred === DEFAULT_LOCALE) return NextResponse.rewrite(url);
    return NextResponse.redirect(url);
  }

  // 2. Auth guard, evaluated on the locale-stripped path.
  const bare = stripLocale(pathname);
  const isProtected = PROTECTED.some((p) => bare === p || bare.startsWith(`${p}/`));
  if (isProtected) {
    const raw = req.cookies.get(SESSION_COOKIE)?.value ?? "";
    // "demo" is the dev-mode sentinel (never a valid token, and forgeable) — don't
    // let it satisfy the presence check in production. Authorization itself never
    // trusts this cookie: every action re-reads the session from Postgres.
    const hasSession = Boolean(raw) && !(process.env.NODE_ENV === "production" && raw === "demo");
    if (!hasSession) {
      const url = req.nextUrl.clone();
      url.pathname = `/${locale}/auth`;
      // Carry the FULL destination (locale-prefixed path + query) so a guest bounced
      // off /fr/checkout?class=<id> resumes there after login.
      const next = `${pathname}${req.nextUrl.search}`;
      url.search = "";
      url.searchParams.set("next", next);
      return NextResponse.redirect(url);
    }
  }

  // 3. Real pages pass. Everything below this line is a tutor slug or a 404.
  if (matchRoute(bare) !== null) return NextResponse.next();

  const segments = bare.slice(1).split("/").filter(Boolean);
  if (segments.length !== 1 || RESERVED_SLUGS.includes(segments[0])) return notFound(req, locale, bare);

  let slug: string;
  try {
    slug = decodeURIComponent(segments[0]);
  } catch {
    return notFound(req, locale, bare); // malformed escape: no tutor has it
  }
  /* A string no signup could have produced (uppercase, a dot, 2 or 41 characters)
     is answered without a lookup — it costs nothing and caches nothing. */
  if (!isValidSlug(slug)) return notFound(req, locale, bare);

  const answer = await tutorLookup.lookup(slug, { ip: clientIpFrom(req.headers), origin: selfOrigin(req) });
  if (answer === "missing") return notFound(req, locale, bare);
  /* "exists" renders the storefront. "unknown" (over budget, lookup failed) also
     lets the storefront page answer: it renders the not-found screen inline if
     there is no such tutor — a soft 404 beats a hard 404 on a real tutor. */
  return NextResponse.next();
}

export const config = {
  /* Run on everything EXCEPT Next internals, API routes and root-level files with an
     extension (robots.txt, sitemap.xml, llms.txt, favicon.*, og.png). The second
     pattern brings dotted paths UNDER a locale back in: /fr/x.y is never a file, and
     skipping it would let it reach the ISR storefront route unchecked. */
  matcher: ["/((?!api|_next/static|_next/image|.*\\..*).*)", "/(fr|ar)/:path*"],
};
