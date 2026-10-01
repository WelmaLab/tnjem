/* ./env FIRST: it loads the root .env and settles NODE_ENV (unset = production)
   before any other module in this graph reads either. */
import "./env";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { randomUUID } from "node:crypto";
import { STATUS_CODES } from "node:http";
import { sql as rawSql, objectStore } from "@tnajem/db";
import { SESSION_COOKIE, warnIfSecretMissing } from "@tnajem/shared/auth-core";
import { APP_TIME_ZONE } from "@tnajem/shared";
import {
  PORT,
  HOST,
  VERSION,
  IS_PROD,
  CORS_ORIGINS,
  TRUST_PROXY,
  assertBootConfig,
} from "./env";
import { loggerOptions } from "./lib/logging";
import { captureServerError, flushSentry, initSentry, sentryActive } from "./lib/sentry";
import { storageHealthy } from "./lib/health";
import { db } from "./db";
import { meRoutes } from "./routes/me";
import { authRoutes } from "./routes/auth";
import { profileRoutes } from "./routes/profile";
import { tutorRoutes } from "./routes/tutors";
import { classRoutes } from "./routes/classes";
import { bookingRoutes } from "./routes/bookings";
import { miscRoutes } from "./routes/misc";
import { adminRoutes } from "./routes/admin";
import { cronRoutes } from "./routes/cron";
import { messageRoutes } from "./routes/messages";
import { materialRoutes } from "./routes/materials";
import { guardianRoutes } from "./routes/guardian";
import { moderationRoutes } from "./routes/moderation";
import { subscriptionRoutes } from "./routes/subscriptions";
import { adminAccountRoutes } from "./routes/admin-accounts";
import { debugRoutes } from "./routes/debug";
import { tutorSpaceRoutes } from "./routes/tutor-space"; // espace prof v2 · shell

/** logStream: tests capture every log line (test/log-pii.test.ts). */
export async function buildServer(opts: { logStream?: { write(line: string): void } } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logStream ? { ...loggerOptions, stream: opts.logStream } : loggerOptions,
    /* See env.ts. NEVER `true`: that makes X-Forwarded-For attacker-controlled and
       the per-IP OTP limiter bypassable by rotating a header. */
    trustProxy: TRUST_PROXY,
    genReqId: () => randomUUID(),
    /* Next's serverActions.bodySizeLimit is 12mb for ID-document uploads. Fastify
       defaults to 1 MiB, which would 413 every one of them. */
    bodyLimit: 13 * 1024 * 1024,
  });

  await app.register(cookie);

  /* EXACT origin allow-list, never "*" and never a reflected Origin header.
     Credentials here are cookies, and reflecting the origin is functionally "*"
     — it hands any site on the internet the ability to make authenticated
     requests as the logged-in user. */
  await app.register(cors, {
    origin: (origin, cb) => {
      // Same-origin/server-to-server requests send no Origin header.
      if (!origin) return cb(null, true);
      cb(null, CORS_ORIGINS.includes(origin));
    },
    credentials: true,
  });

  await app.register(multipart, {
    limits: {
      fileSize: 8 * 1024 * 1024, // MAX_DOC_BYTES, matching submitVerification
      files: 6,
      fields: 30,
    },
  });

  /* ONE ERROR HANDLER, and it logs a code, not an error object. Fastify's default
     logs the whole error — and a database error carries its statement parameters
     (names, phone numbers, tokens) in `params`, `query` and `cause.detail`, none of
     which the redaction paths reach. It also sent a 5xx error's MESSAGE to the
     client. Now: the code and the route in the log, a generic body for a 5xx, the
     framework's own 4xx fields (400/404/413…). */
  app.setErrorHandler((err, req, reply) => {
    const e = err as { statusCode?: number; code?: string; name?: string; cause?: { code?: string } };
    const status = e.statusCode && e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 500;
    const where = { code: e.code ?? e.name ?? "Error", cause: e.cause?.code, route: req.routeOptions?.url };
    if (status >= 500) {
      req.log.error(where, "request failed");
      /* The log line above is a code and a route, on purpose — it must stay
         readable and PII-free. The STACK goes to Sentry instead, which is the
         only place it exists at all: without this call a 500 leaves nothing
         behind but `{"code":"23505","route":"/bookings"}`, and finding the line
         of code means reproducing it. Tagged with the same request id the
         response carries, so a user-reported failure joins up. */
      captureServerError(err, {
        requestId: String(req.id),
        route: req.routeOptions?.url,
        method: req.method,
        status,
      });
      return reply.code(status).send({ statusCode: status, error: "Internal Server Error", message: "Internal Server Error" });
    }
    req.log.info(where, "request rejected");
    /* Built here rather than reply.send(err): that would hand the error to the
       framework default handler, which logs the whole object. */
    return reply
      .code(status)
      .send({ statusCode: status, code: e.code, error: STATUS_CODES[status] ?? "Error", message: (err as Error).message });
  });

  /* Request id on the way out, so a user-reported failure can be traced to a log
     line without asking them for anything identifying. */
  app.addHook("onSend", async (req, reply) => {
    reply.header("x-request-id", req.id);

    /* BASELINE HEADERS on every API response. The API renders no page, so it can
       refuse the lot: no sniffing, no framing, no referrer, no script, no
       embedding. A header a route set itself (the ID-scan CSP, a photo's cache
       policy) is never overwritten. */
    const baseline: Record<string, string> = {
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "cross-origin-resource-policy": "same-site",
    };
    if (IS_PROD) baseline["strict-transport-security"] = "max-age=63072000; includeSubDomains; preload";
    for (const [name, value] of Object.entries(baseline)) {
      if (!reply.hasHeader(name)) reply.header(name, value);
    }

    /* A response to a request that carried a session is about that person, so no
       cache (a shared proxy, the browser's disk) may keep it. Anonymous responses
       are left to their routes: the public catalogue is meant to be cached. */
    if (req.headers.cookie?.includes(`${SESSION_COOKIE}=`) && !reply.hasHeader("cache-control")) {
      reply.header("cache-control", "private, no-store");
    }
  });

  await app.register(meRoutes);
  await app.register(authRoutes);
  await app.register(profileRoutes);
  await app.register(tutorRoutes);
  await app.register(classRoutes);
  await app.register(bookingRoutes);
  await app.register(miscRoutes);
  await app.register(adminRoutes);
  await app.register(messageRoutes);
  await app.register(materialRoutes);
  await app.register(guardianRoutes);
  await app.register(moderationRoutes);
  await app.register(subscriptionRoutes);
  await app.register(adminAccountRoutes);
  await app.register(cronRoutes);
  await app.register(debugRoutes);
  await app.register(tutorSpaceRoutes); // espace prof v2 · shell
  await app.register((await import("./routes/passwords")).passwordRoutes); // espace prof v2 · auth (phase 2)
  await app.register((await import("./routes/vitrine")).vitrineRoutes); // espace prof v2 · growth (P3)
  await app.register((await import("./routes/follows")).followRoutes); // espace prof v2 · growth (P4)
  await app.register((await import("./routes/notification-prefs")).notificationPrefRoutes); // espace prof v2 · growth (P4, C5)

  app.get("/health", async (req) => {
    let dbOk = false;
    try {
      await db.execute(rawSql`select 1`);
      dbOk = true;
    } catch (err) {
      /* LOG IT. The bare `catch {}` this replaces cost real time: the container
         reported `db:false` forever and there was no way, from inside or outside,
         to learn that the cause was `ssl: "require"` against a Postgres with no
         TLS. A health check that can say "down" but never "why" is the operational
         equivalent of a silent failure.

         The message goes to the LOG, never to the response body: /health is
         unauthenticated, and a connection error can carry the host, port and user
         from the URL. */
      req.log.error({ err }, "health: database unreachable");
      dbOk = false;
    }
    /* Storage is the third dependency and it fails independently of the other two:
       a persistent volume that did not come back after a reboot leaves the API
       answering every request correctly until a tutor uploads an ID scan. Probed
       with a write, cached for 15s — see lib/health.ts for both reasons. */
    const storageOk = await storageHealthy();
    if (!storageOk) req.log.error({ driver: objectStore().driver }, "health: document store unwritable");
    /* Still 200 when the database is down, deliberately. The body is the signal
       (Docker's HEALTHCHECK reads .db, see apps/api/Dockerfile) and a 503 with an
       empty body would tell an operator strictly less than a 200 that says
       db:false. Anything routing on this must read the JSON.

       `ok` stays a hard-coded true for the same reason, and `storage:false` does
       NOT flip it: Docker's HEALTHCHECK reads .ok && .db, so making `ok` depend on
       storage would take the whole API out of rotation over a volume problem that
       stops ID-document review and nothing else. The status-code signal lives one
       layer out, in the web app's /api/health, which is what an uptime monitor
       watches and what may legitimately page a human. */
    /* tz: the zone every class time is shown and parsed in (always Africa/Tunis)
       next to the zone this process happens to run in — they are allowed to
       differ, and an operator chasing a "wrong hour" report should see both. */
    return {
      ok: true,
      db: dbOk,
      storage: storageOk,
      version: VERSION,
      tz: { app: APP_TIME_ZONE, process: Intl.DateTimeFormat().resolvedOptions().timeZone },
    };
  });

  return app;
}

/* Only start when run directly, so the test suite can build an instance without
   binding a port. */
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "");

if (isMain || process.env.API_FORCE_START === "1") {
  assertBootConfig();
  warnIfSecretMissing();
  /* BEFORE buildServer: a crash while wiring routes is exactly the kind of failure
     worth reporting, and initSentry() installs the uncaught-exception handler. */
  initSentry();

  const app = await buildServer();
  try {
    await app.listen({ port: PORT, host: HOST });
    /* `sentry` in the boot line so "is error reporting actually on?" is answerable
       from the log, without printing the DSN (which carries a project id and key). */
    app.log.info(
      { port: PORT, host: HOST, prod: IS_PROD, storage: objectStore().driver, sentry: sentryActive() },
      "tnajem-api listening",
    );
  } catch (err) {
    app.log.error(err, "failed to start");
    await flushSentry();
    process.exit(1);
  }

  /* CLOSE, THEN FLUSH. pm2 reload sends SIGINT and SIGKILLs after kill_timeout;
     systemd sends SIGTERM. Without this the process died on the default handler,
     which drops in-flight requests mid-response and loses any error event that had
     not been sent yet — including the crash that caused the restart. */
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void (async () => {
        try {
          await app.close();
        } catch {
          /* Shutting down is not the time to fail loudly; exit anyway. */
        }
        await flushSentry();
        process.exit(0);
      })();
    });
  }
}
