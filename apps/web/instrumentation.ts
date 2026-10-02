/* Next's server instrumentation hook. Deliberately a SHIM and nothing else.
 *
 * Next runs `register()` once per server process, before any request is handled,
 * and calls `onRequestError` for every error thrown while rendering a page, a
 * route handler or a server action. That is the whole surface the app needs —
 * which is why error tracking lives here instead of @sentry/nextjs +
 * withSentryConfig:
 *
 *   - withSentryConfig WRAPS next.config.mjs, and that file's `webpack()` is
 *     contractual: it installs the NormalModuleReplacementPlugin that keeps the
 *     invented demo tutors out of production bundles, and guardrails.mjs §6 fails
 *     the build if a fixture string survives. A config wrapper that reorders or
 *     drops that plugin turns a hard gate into a silent one.
 *   - the wizard's setup also ships a BROWSER SDK, and the site's CSP is
 *     `connect-src 'self'` plus Cloudflare's analytics endpoint, nothing else
 *     (next.config.mjs). Reporting
 *     browser errors would mean widening that policy and shipping more JavaScript
 *     to every page on a 3G connection. Decided against, 16 Sept: server-side only.
 *
 * WHY NOTHING IS IMPORTED AT THE TOP OF THIS FILE. Next compiles this one file into
 * BOTH the node-server and the edge-server bundles, always, even in an app with no
 * edge code — and `serverExternalPackages` does not apply to the edge compile. A
 * top-level `import "@sentry/node"` here therefore got bundled for the edge and
 * failed to build ("Can't resolve 'path'", via import-in-the-middle). The runtime
 * check below is what keeps the SDK on the node side: Next's DefinePlugin inlines
 * `process.env.NEXT_RUNTIME` per compile, so the edge build sees `if (false)` and
 * drops the import() unresolved. lib/sentry-server.ts has the full account.
 *
 * Keep this file free of value imports. A type-only import is fine — it is erased.
 */
import type { RequestInfo, ErrorContext } from "@/lib/sentry-server";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initSentry } = await import("@/lib/sentry-server");
    initSentry();
  }
}

/* Next's hook for server-side render/route/action errors. Its third argument is
   the useful one: routePath is the PATTERN (/[locale]/[slug]), which groups
   errors properly, where request.path is one visitor's concrete URL. */
export async function onRequestError(err: unknown, request: RequestInfo, context: ErrorContext): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { captureRequestError } = await import("@/lib/sentry-server");
    captureRequestError(err, request, context);
  }
}
