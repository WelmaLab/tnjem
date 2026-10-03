import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
/** @type {import('next').NextConfig} */

/* ── ONE ENV FILE, AT THE REPO ROOT ──────────────────────────────────────────────
   Next only reads .env* from its own folder (apps/web), and there is none there —
   so `npm run dev` never saw API_URL and silently served DEMO DATA that looks
   real. On a product with a truth rule that is the worst possible failure mode.
   Load the root files the same way apps/api/src/env.ts does: .env.local, then
   .env, neither overriding a value already in the environment (so a host's
   injected secrets, or `API_URL= npm run dev`, always win). Silent when absent:
   the Docker build has no .env and must not need one. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
loadDotenv({ path: join(REPO_ROOT, ".env.local") });
loadDotenv({ path: join(REPO_ROOT, ".env") });

const isProd = process.env.NODE_ENV === "production";

/* DEMO MODE IS OPT-IN, and only ever in development. It is active when someone
   asked for it (TNAJEM_DEMO=1) AND there is no API to call. Inlined into both
   bundles as a build-time constant so the banner (a client-safe component) and
   the data layer agree. scripts/preflight.mjs refuses to start otherwise. */
const demoActive = !isProd && process.env.TNAJEM_DEMO === "1" && !process.env.API_URL?.trim();

/* ── Content-Security-Policy ───────────────────────────────────────────────────
   Why 'unsafe-inline' rather than a nonce, deliberately:

   Next's App Router streams the RSC flight payload and hydration bootstrap as
   INLINE <script>/<style> on every page. The robust alternative — a per-request
   nonce injected by middleware — strips 'unsafe-inline' but forces EVERY response
   to be dynamically rendered (the nonce differs per request), which would defeat
   the ISR/static caching of the storefront that the whole scaling plan rests on
   (SCALABILITY.md: cache the viral page's HTML perfectly). For this app, allowing
   inline while keeping the page cacheable is the right trade — and the highest-risk
   surface (the ID-scan viewer, app/api/admin/doc) already ships its own
   `default-src 'none'; sandbox` CSP, which combines with this one, never loosens it.

   Live video runs on meet.jit.si in a NEW TAB (window.open in app/live), not an
   iframe, so no camera/microphone grant is needed on our origin. That keeps the
   policy tight: nothing may frame us, no plugins, no base-tag or form-action
   hijack, and img/font are self-only.

   WE FRAME ONE THING (live-fixes-2 · D): a tutor's YouTube video, on the
   storefront, from youtube-nocookie only, and only once someone presses « Voir la
   vidéo » (components/storefront/MaterialsPanel.tsx, the one embed). With no
   frame-src the policy fell back to default-src 'self' and refused that frame —
   the video slot showed a broken page. frame-src names exactly that origin, and
   'self' keeps what default-src already allowed. /privacy §9 already says a video
   loads from YouTube's no-cookie domain only when it is started.

   ONE THIRD PARTY, by exact origin (live-fixes-1 · I): Cloudflare, which fronts
   the site, injects its Web Analytics beacon into every HTML page; blocked, it
   was a console error on every page. The script comes from CF_BEACON_SCRIPT. It
   reports to this origin's /cdn-cgi/rum while Cloudflare proxies the site
   ('self' covers it) and to CF_BEACON_REPORT when it does not (Cloudflare's
   docs), so both are allowed. /privacy (§2, §3, §4, §9) discloses it — turn
   the analytics off in Cloudflare and both lines go, together with that copy.
   e2e/security-headers.spec.ts pins every directive's exact source list and
   apps/api/test/lf1-csp.test.ts pins dev and prod: a new origin is a decision
   made in those tests, never a side effect. */
const CF_BEACON_SCRIPT = "https://static.cloudflareinsights.com";
const CF_BEACON_REPORT = "https://cloudflareinsights.com";
// The host youTubeEmbedUrl() (packages/shared/src/uploads.ts) builds every embed on.
const YOUTUBE_EMBED = "https://www.youtube-nocookie.com";

function contentSecurityPolicy() {
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'", // clickjacking — supersedes X-Frame-Options on modern browsers
    "form-action 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    // Dev (HMR) additionally needs eval; prod is inline-only (+ the Cloudflare beacon).
    `script-src 'self' 'unsafe-inline' ${CF_BEACON_SCRIPT}${isProd ? "" : " 'unsafe-eval'"}`,
    // Dev needs the HMR websocket; prod talks to its own origin (server actions) and
    // the beacon's report endpoint.
    `connect-src 'self' ${CF_BEACON_REPORT}${isProd ? "" : " ws: wss:"}`,
    `frame-src 'self' ${YOUTUBE_EMBED}`,
    "manifest-src 'self'",
  ];
  if (isProd) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

/* Sent on every response. Cheap headers ship in dev too; HSTS + CSP are prod-only
   (HSTS is ignored over http anyway, and the CSP's prod form would fight HMR). */
function securityHeaders() {
  const headers = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-DNS-Prefetch-Control", value: "off" },
    // No feature this app uses needs these; the Jitsi tab is a separate origin that
    // grants its own camera/mic. Payments are off, so opt out of the Payment API too.
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
    { key: "Content-Security-Policy", value: contentSecurityPolicy() },
  ];
  if (isProd) {
    // Two years, subdomains, preload-eligible. Also set this at the edge (nginx/
    // Cloudflare, DEPLOY.md) — belt and braces if a request ever bypasses Next.
    headers.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" });
  }
  return headers;
}

/* Tuned for the actual client: a mid-range Android on 3G in Tunisia, opening a
   tutor's storefront from a WhatsApp link. Every kilobyte and every round trip
   on that path is the product. */
const nextConfig = {
  env: { TNAJEM_DEMO_ACTIVE: demoActive ? "1" : "" },

  /* WEBPACK, NOT TURBOPACK. Next 16 builds with Turbopack by default and refuses a
     custom webpack() config under it; the scripts pass --webpack. The replacement
     below is what keeps the invented demo tutors out of production bundles, and
     guardrails.mjs §6 proves it on every build — moving bundlers is a change to
     that guarantee, made separately and proven again, not a side effect.

     NO FIXTURE TEXT IN A PRODUCTION BUNDLE. Every production compile (server,
     client, edge) gets lib/demo-fixtures.empty.ts in place of the invented tutors.
     Gating the calls on demoEnabled was not enough: the minifier kept the fixture
     bodies, and the 15 Sept build shipped them in the /explore client chunk. */
  webpack(config, { dev, webpack }) {
    if (!dev) {
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/[\\/]demo-fixtures(\.ts)?$/, (resource) => {
          resource.request = resource.request.replace(/demo-fixtures(\.ts)?$/, "demo-fixtures.empty.ts");
        }),
      );
    }
    return config;
  },

  async headers() {
    /* What a file route takes from the API instead (app/api/admin/doc and
       app/api/material pass these through verbatim); only the rest is added here. */
    const fromTheApi = ["Content-Security-Policy", "Referrer-Policy", "X-Content-Type-Options"];
    const fileRouteHeaders = () => securityHeaders().filter((h) => !fromTheApi.includes(h.key));
    return [
      { source: "/:path((?!api/admin/doc/|api/material/).*)", headers: securityHeaders() },
      /* THE ID-SCAN ROUTE IS EXCLUDED from the site-wide set, and gets no CSP here.
         Since Next 15/16, a header named in this config REPLACES the same header set
         by a route handler (on 14 the handler won). The site-wide CSP therefore
         overwrote the document's `default-src 'none'; sandbox` — the one policy that
         stops a crafted file rendering as an active page in the admin's session —
         with the app's permissive page policy (and its Referrer-Policy over the
         document's no-referrer). e2e/admin.spec.ts caught it. The route passes the
         API's headers through; only the ones the API does not set are added here. */
      { source: "/api/admin/doc/:id", headers: fileRouteHeaders() },
      /* A TEACHING MATERIAL, the same way (live-fixes-2 · D). The file a student
         opens is a PDF or an image, never a page: it keeps the API's own policy
         (`default-src 'none'` — no script, no connection, no frame, and nothing may
         frame it), not the page policy with its inline scripts and Cloudflare's
         beacon. e2e/lf2-d-material-csp.spec.ts pins it, and proves a PDF still
         opens in the browser's viewer and an image still displays. */
      { source: "/api/material/:id", headers: fileRouteHeaders() },
    ];
  },

  output: "standalone", // self-contained server build for Docker/Render/Railway
  reactStrictMode: true,

  /* gzip/brotli on the Node responses. nginx sits in front (DEPLOY.md §6) and can
     compress too — if you enable `gzip on` there, set this back to false so the
     HTML is not compressed twice (wasted CPU on every request). Leaving it ON
     here is the safe default: the current nginx block does NOT enable gzip, so
     without this the storefront HTML ships uncompressed over 3G. */
  compress: true,

  /* Stop advertising the framework on every response. One header off every
     response is a rounding error in bytes and one less free hint for a scanner. */
  poweredByHeader: false,

  /* Do not ship the source-map payload for the client bundles in prod (default,
     stated explicitly): they are megabytes, and on a metered 3G connection a
     devtools-open user would pay for them. */
  productionBrowserSourceMaps: false,

  /* SERVER source maps, which are a different decision from the one above: they
     are never sent to a browser, so they cost a visitor nothing, and without them
     every stack trace in an error report points into a minified server chunk —
     "app/(routes)/page-4f2a.js:1:98214" instead of a file and a line. The web
     process runs with --enable-source-maps (ecosystem.config.cjs), so Node maps
     the trace itself before Sentry ever sees it: readable stacks with no upload
     step, no auth token and no CI artifact job. */
  experimental: {
    serverSourceMaps: true,
    // Verification doc uploads (ID/diploma images or PDFs) exceed the 1MB default.
    serverActions: { bodySizeLimit: "12mb" },
  },

  /* @sentry/node stays OUT of the webpack bundle: it resolves optional native and
     hook-based dependencies (import-in-the-middle) that a bundler cannot follow,
     and instrumentation.ts is the only thing that imports it. Next traces it into
     .next/standalone/node_modules instead, which is where the runtime finds it. */
  serverExternalPackages: ["@sentry/node"],

  images: {
    /* THE OPTIMIZER IS OFF. Every image in the app (Logo, Avatar) already renders
       `unoptimized`, so /_next/image served nobody — yet it answered, and it is
       the entry point of GHSA-2xp9-vwfh-vxw4 (remote code execution through sharp's
       libheif on an AVIF). It could also be pointed at our own routes: tutor-uploaded
       materials are same-origin, so "local images only" did not mean "our images
       only". An endpoint with no user is attack surface and nothing else.

       Turning it back on is a decision, not a default: it needs a patched Next and
       sharp, an allow-list of the paths it may read (images.localPatterns), and
       never the materials or avatar routes. */
    unoptimized: true,
    remotePatterns: [],

    /* SVGs are never optimised, they are passed through — a hostile SVG is a
       script. Explicitly off (also the default). */
    dangerouslyAllowSVG: false,
  },

  /* MONOREPO. Without this, Next infers the tracing root from the nearest
     lockfile and either misses packages/* (they are symlinks in the root
     node_modules) or traces the whole repo -- including tools/ui-audit/shots*,
     which is hundreds of megabytes of PNGs. Top-level since Next 15. */
  outputFileTracingRoot: REPO_ROOT,
  outputFileTracingExcludes: {
    "/**": ["tools/ui-audit/**", "e2e/**", "**/*.png", ".storage/**", ".e2e-storage/**", "backups/**"],
  },
  /* espace prof v2 · growth (P3): the social-card fonts (lib/og-card.tsx) are read
     from disk at request time, which the tracer cannot see — without this the
     standalone server renders every card with no font at all. ~420 KB, once. */
  outputFileTracingIncludes: {
    "/**": ["./assets/og/**"],
  },


  /* NOT set: `experimental.optimizePackageImports`. It only rewrites imports from
     node_modules barrels, and this app has no icon/UI library in its dependencies
     (the whole UI is local + Tailwind). It would be a no-op here; the real client
     bundle problem is architectural — see SCALABILITY.md §Frontend. */
};
export default nextConfig;
