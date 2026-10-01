/* What an error report is allowed to contain.
 *
 * ONE POLICY, TWO PROCESSES. The API and the web server each own their Sentry
 * client (they have different entry points and different failure shapes), but the
 * rule about what may leave the building must not exist twice — the second copy is
 * the one that quietly keeps an e-mail address.
 *
 * This module deliberately does NOT import @sentry/node. It is a pure options
 * factory: `sentryOptions()` returns a plain object each app hands to its own
 * Sentry.init, and `scrub()` is the function that empties the fields we refuse to
 * send. That keeps @tnajem/shared importable from a client component (it is, all
 * over apps/web) and keeps the node-only SDK out of every browser bundle.
 *
 * The sibling policy is apps/api/src/lib/logging.ts::REDACT_PATHS, which does the
 * same job for log lines. apps/api/test/sentry.test.ts asserts that every leaf key
 * listed there is also scrubbed here, so adding a PII field to one list and
 * forgetting the other fails a test instead of shipping.
 *
 * NOT SENT, EVER:
 *   - a session token or an OTP (hashed or not) — they are credentials
 *   - a password, its argon2 hash, or a set-password grant (espace prof v2 · phase 2)
 *   - an e-mail address or a phone number — they are the login identity here
 *   - a document storage path — it locates a national ID scan
 *   - the query string of a URL — /doc?sig=… carries a signed capability
 *   - request bodies, cookies and headers wholesale (sendDefaultPii stays off)
 */

/** Leaf field names that must be emptied wherever they appear in an event. */
export const SENTRY_SCRUB_KEYS = [
  // Credentials in transit
  "cookie",
  "authorization",
  "set-cookie",
  // OTP material
  "code",
  "codeHash",
  "code_hash",
  "devCode",
  "token",
  "sessionToken",
  // Passwords (espace prof v2 · auth, phase 2): the plaintext, its hash, the set-password grant
  "password",
  "currentPassword",
  "newPassword",
  "passwordHash",
  "password_hash",
  "passwordGrant",
  "grant",
  // Document locations
  "storagePath",
  "storage_path",
  // Personal data
  "email",
  "phone",
  "guardianPhone",
  "guardian_phone",
  "identifier",
] as const;

const SCRUB = new Set<string>(SENTRY_SCRUB_KEYS.map((k) => k.toLowerCase()));
const REPLACEMENT = "[redacted]";

/** A value that made it into an event without ever being a legitimate field name. */
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/* THE SAME SHAPE apps/api/test/log-pii.test.ts scans for: +216 and eight digits,
   or a bare eight-digit Tunisian number that is not part of a longer token.

   SPECIFIC ON PURPOSE. A generic "long run of digits and separators" also matches
   a UUID, and UUIDs are the most useful thing in an error report — the request id
   that joins the report to the log line, the class id, the booking id. The first
   draft of this file redacted `11111111-2222-3333-4444-555555555555` as a phone
   number, and the test caught it. An ISO date (2026-09-16) survives for the same
   reason: over-scrubbing does not protect anyone, it just makes the report useless
   and pushes whoever is debugging back to the raw logs. */
const PHONE_RE = /(\+?216[\s.-]?\d{2}[\s.-]?\d{3}[\s.-]?\d{3})|(?<![\w-])[2-9]\d{7}(?![\w-])/g;

/** Strip the query string but keep the path — the path is the useful part. */
export function scrubUrl(url: string): string {
  const cut = url.indexOf("?");
  return cut === -1 ? url : `${url.slice(0, cut)}?[redacted]`;
}

function scrubString(s: string): string {
  return s.replace(EMAIL_RE, REPLACEMENT).replace(PHONE_RE, REPLACEMENT);
}

/* Depth-first, in place, on the event Sentry is about to send.
 *
 * Both halves matter. Scrubbing by KEY catches the structured cases — a
 * `{ email }` in an extra, a cookie header. Scrubbing by PATTERN catches the
 * unstructured ones, which is where this actually earns its keep: an error
 * MESSAGE like `duplicate key value violates unique constraint (phone)=(+216…)`
 * has no field name at all. Postgres writes exactly that.
 *
 * maxDepth stops a cyclic or enormous object from turning a 500 into a hang. */
export function scrub<T>(value: T, depth = 0): T {
  if (depth > 12) return value;
  if (typeof value === "string") return scrubString(value) as unknown as T;
  if (!value || typeof value !== "object") return value;

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = scrub(value[i], depth + 1);
    return value;
  }

  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    const lower = key.toLowerCase();
    if (SCRUB.has(lower)) {
      obj[key] = REPLACEMENT;
      continue;
    }
    // A URL field keeps its path and loses its query string.
    if ((lower === "url" || lower === "full_url") && typeof obj[key] === "string") {
      obj[key] = scrubUrl(scrubString(obj[key] as string));
      continue;
    }
    obj[key] = scrub(obj[key], depth + 1);
  }
  return obj as unknown as T;
}

/* ONE JSON LINE, for the failures that happen where there is no request logger.
 *
 * The API's pino logger covers everything inside a request. Mail, SMS and notify
 * live in @tnajem/shared and @tnajem/db, are called from both servers and from
 * cron, and have always written plain prose to console.error — which means the
 * signals Stage 7 has to alert on ("OTP send failures") were unparseable prose in
 * a pm2 log file. This makes them queryable without pulling a logger dependency
 * into packages that are imported by client components.
 *
 * The shape deliberately matches the one line that already existed in the app,
 * apps/web/lib/tutor-lookup.ts's `tutor_lookup_fail_open`:
 *     {"level":"error","event":"mail_send_failed","detail":"…","at":"<ISO>"}
 * so ONE log query — `event` present — finds all of them, and the alert rules in
 * OBSERVABILITY.md are written once. Note the fields differ from pino's (`level`
 * is a word, the timestamp is `at`): two shapes in one file is worse than two
 * shapes in two places, and e2e/tutor-lookup.spec.ts pins that one exactly,
 * including its key set — which is itself a privacy guard.
 *
 * Fields are scrubbed on the way out. Every caller already reduces its error to a
 * code, but the scrubber is what makes that a guarantee rather than a habit.
 */
export function logEvent(level: "warn" | "error", event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, event, ...scrub(fields), at: new Date().toISOString() });
  // eslint-disable-next-line no-console
  if (level === "error") console.error(line);
  // eslint-disable-next-line no-console
  else console.warn(line);
}

export type SentryInitOptions = {
  dsn: string;
  environment: string;
  release: string | undefined;
  /** Where the event came from. One Sentry project, two servers. */
  serverName: "tnajem-api" | "tnajem-web";
};

/** The options object both apps pass to their own Sentry.init. */
export function sentryOptions(o: SentryInitOptions) {
  return {
    dsn: o.dsn,
    environment: o.environment,
    release: o.release,
    serverName: o.serverName,

    /* OFF. This is the switch that would attach cookies, headers and request
       bodies to every event — i.e. the session cookie and the OTP body. */
    sendDefaultPii: false,

    /* No tracing, no profiling: they need OpenTelemetry's ESM loader hook
       (`node --import`), which neither the pm2 config nor the Dockerfile
       provides, and a half-initialised OTel is worse than none. Errors are what
       Stage 7 asks for. */
    tracesSampleRate: 0,

    /* Breadcrumbs are automatic context — console lines, outgoing HTTP requests,
       queries. Every one of those is a place a phone number arrives without
       anyone deciding to send it, so the last scrub below covers them and the
       console integration stays off in the apps. */
    maxBreadcrumbs: 20,

    /* THE LAST GATE. Everything above is policy; this is enforcement. It runs on
       the fully assembled event, after every integration has added its context. */
    /* Generic in and out, so each app's SDK types survive: Sentry expects
       `(event: ErrorEvent) => ErrorEvent | null`, and scrub() edits in place and
       returns the same shape it was handed. */
    beforeSend: <T>(event: T): T => scrub(event),
    beforeBreadcrumb: <T>(breadcrumb: T): T => scrub(breadcrumb),
  };
}

/** `undefined` when error reporting is off, which is the default everywhere. */
export function sentryDsn(): string | undefined {
  return process.env.SENTRY_DSN?.trim() || undefined;
}

/** What the event is tagged with. Unset NODE_ENV means production (see env.ts). */
export function sentryEnvironment(): string {
  return process.env.SENTRY_ENVIRONMENT?.trim() || process.env.NODE_ENV?.trim() || "production";
}

/** The deploy's commit, exported by deploy.sh. Falls back to the app version. */
export function sentryRelease(fallbackVersion?: string): string | undefined {
  const explicit = process.env.SENTRY_RELEASE?.trim();
  if (explicit) return explicit;
  return fallbackVersion ? `tnajem@${fallbackVersion}` : undefined;
}
