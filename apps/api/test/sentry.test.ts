import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import * as Sentry from "@sentry/node";
import { REDACT_PATHS } from "../src/lib/logging";
import { SENTRY_SCRUB_KEYS, scrub, scrubUrl, sentryOptions } from "@tnajem/shared/observability";
import { initSentry, sentryActive, captureServerError } from "../src/lib/sentry";

/* WHAT AN ERROR REPORT MAY CONTAIN (production readiness Stage 7).
 *
 * test/log-pii.test.ts does this job for log lines: it captures every line the API
 * writes and asserts none of them holds an e-mail address or a phone number. Error
 * reports are a SECOND way out of the process, added in Stage 7, and they carry
 * more than a log line does — a stack, local context, the error's own message. So
 * they need the same guard, and it has to be a test rather than a habit: the whole
 * point of the reporter is that it is used on the day everyone is too busy to
 * review what it sends.
 *
 * The first test is the one that will actually catch a regression: it proves the
 * two policies cannot drift, so adding a PII field to the log redaction and
 * forgetting the scrubber fails here instead of shipping.
 */

/** `*.email` → `email`; `req.headers.cookie` → `cookie`; `res.headers["set-cookie"]` → `set-cookie`. */
function leafOf(path: string): string {
  const bracket = path.match(/\["([^"]+)"\]$/);
  if (bracket) return bracket[1];
  return path.split(".").pop() ?? path;
}

describe("sentry: the scrubber and the log redaction describe the same PII", () => {
  test("every field the log redacts is also scrubbed from an event", () => {
    const scrubbed = new Set(SENTRY_SCRUB_KEYS.map((k) => k.toLowerCase()));
    const missing = REDACT_PATHS.map(leafOf)
      .map((k) => k.toLowerCase())
      .filter((k) => !scrubbed.has(k));
    assert.deepEqual(
      missing,
      [],
      `these are redacted in logs but would be SENT in an error report: ${missing.join(", ")}. ` +
        "Add them to SENTRY_SCRUB_KEYS in packages/shared/src/observability.ts.",
    );
  });

  /* espace prof v2 · phase 2: a password, its hash and the set-password grant are
     credentials like a session token — in a request body, an extra or a context. */
  test("password fields are emptied, and the log redacts the same ones", () => {
    const event = scrub({
      request: { data: { identifier: "x@tnajem.invalid", password: "Le-soleil-de-Sousse-26" } },
      extra: { body: { currentPassword: "ancien-mot-2026", newPassword: "nouveau-mot-2026", grant: "1.abc" } },
      contexts: { row: { passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$x$y", password_hash: "$argon2id$z", passwordGrant: "2.def" } },
    });
    assert.equal(event.request.data.password, "[redacted]");
    assert.equal(event.extra.body.currentPassword, "[redacted]");
    assert.equal(event.extra.body.newPassword, "[redacted]");
    assert.equal(event.extra.body.grant, "[redacted]");
    assert.equal(event.contexts.row.passwordHash, "[redacted]");
    assert.equal(event.contexts.row.password_hash, "[redacted]");
    assert.equal(event.contexts.row.passwordGrant, "[redacted]");
    const leaves = new Set(REDACT_PATHS.map(leafOf));
    for (const k of ["password", "currentPassword", "newPassword", "passwordHash", "password_hash", "passwordGrant", "grant"]) {
      assert.ok(leaves.has(k), `REDACT_PATHS must cover *.${k}`);
    }
  });

  test("a named field is emptied wherever it sits in the event", () => {
    const event = {
      extra: { email: "parent@example.tn", phone: "+216 20 123 456", safe: "keep me" },
      contexts: { session: { sessionToken: "abc", token: "def" } },
      request: { headers: { cookie: "tnajem_session=zzz", authorization: "Bearer zzz" } },
      nested: [{ deep: { storagePath: "verification/abc/id.jpg" } }],
    };
    const out = scrub(event);
    assert.equal(out.extra.email, "[redacted]");
    assert.equal(out.extra.phone, "[redacted]");
    assert.equal(out.extra.safe, "keep me", "a field that is not PII must survive — an empty report is not the goal");
    assert.equal(out.contexts.session.sessionToken, "[redacted]");
    assert.equal(out.contexts.session.token, "[redacted]");
    assert.equal(out.request.headers.cookie, "[redacted]");
    assert.equal(out.request.headers.authorization, "[redacted]");
    assert.equal(out.nested[0].deep.storagePath, "[redacted]");
  });

  test("an address in an error MESSAGE is caught, where no field name exists", () => {
    /* This is the case the key list cannot cover and the one that actually happens:
       Postgres puts the offending value in the message of a unique violation. */
    const pg = scrub({
      message: 'duplicate key value violates unique constraint "profiles_email_unique" DETAIL: Key (email)=(rania@example.tn) already exists.',
    });
    assert.ok(!pg.message.includes("rania@example.tn"), pg.message);
    assert.ok(pg.message.includes("duplicate key value"), "the diagnosis must survive the scrub");

    const sms = scrub({ message: "twilio 21211 refused +216 55 000 111" });
    assert.ok(!sms.message.includes("55 000 111"), sms.message);
  });

  test("a URL keeps its path and loses its query string", () => {
    assert.equal(scrubUrl("/api/admin/doc/abc?exp=1&sig=deadbeef"), "/api/admin/doc/abc?[redacted]");
    assert.equal(scrubUrl("/fr/explore"), "/fr/explore");
    /* A url FIELD is scrubbed the same way, wherever Sentry put it. */
    const e = scrub({ request: { url: "/checkout?class=3f2b&email=a@b.tn" } });
    assert.equal(e.request.url, "/checkout?[redacted]");
  });

  test("cycles and giant objects do not hang the scrubber", () => {
    const cyclic: Record<string, unknown> = { email: "a@b.tn" };
    cyclic.self = cyclic;
    const out = scrub(cyclic) as { email: string };
    assert.equal(out.email, "[redacted]", "and it returned at all");
  });

  test("the options never opt into Sentry's own PII collection", () => {
    const o = sentryOptions({ dsn: "https://k@o.ingest.sentry.io/1", environment: "test", release: "r", serverName: "tnajem-api" });
    assert.equal(o.sendDefaultPii, false, "sendDefaultPii attaches cookies, headers and request bodies");
    assert.equal(o.tracesSampleRate, 0, "tracing needs an ESM loader hook this deploy does not install");
  });
});

describe("sentry: off by default", () => {
  test("no DSN means no client, and reporting an error is still safe", () => {
    delete process.env.SENTRY_DSN;
    assert.equal(initSentry(), false, "initSentry must not start a client without a DSN");
    assert.equal(sentryActive(), false);
    /* The API must behave identically with reporting off — this call happens on
       every 5xx, so if it threw, a 500 would become a crash. */
    assert.doesNotThrow(() =>
      captureServerError(new Error("boom"), { requestId: "r", route: "/x", method: "GET", status: 500 }),
    );
  });
});

describe("sentry: what actually leaves the process", () => {
  /* A stub transport: the event is assembled by the real client, with the real
     beforeSend, and then handed to us instead of the network. Nothing is sent
     anywhere, and the assertion is made on the bytes that would have been. */
  const sent: string[] = [];

  before(() => {
    Sentry.init({
      ...sentryOptions({
        dsn: "https://publickey@o0.ingest.sentry.io/0",
        environment: "test",
        release: "test-release",
        serverName: "tnajem-api",
      }),
      defaultIntegrations: false,
      integrations: [],
      skipOpenTelemetrySetup: true,
      transport: () => ({
        send: async (envelope: unknown) => {
          sent.push(JSON.stringify(envelope));
          return {};
        },
        flush: async () => true,
      }),
    } as Parameters<typeof Sentry.init>[0]);
  });

  after(async () => {
    await Sentry.flush(500);
    await Sentry.close(500);
  });

  test("an exception whose message holds an e-mail and a phone ships neither", async () => {
    Sentry.withScope((scope) => {
      scope.setTag("request_id", "11111111-2222-3333-4444-555555555555");
      scope.setExtra("identifier", "rania@example.tn");
      Sentry.captureException(new Error("insert failed for rania@example.tn / +216 20 123 456"));
    });
    await Sentry.flush(2000);

    assert.equal(sent.length, 1, "exactly one event was handed to the transport");
    const body = sent[0];
    assert.ok(!/[\w.+-]+@[\w-]+\.[\w.-]+/.test(body), `an e-mail address reached the transport: ${body.slice(0, 400)}`);
    assert.ok(!body.includes("20 123 456"), "a phone number reached the transport");
    assert.ok(body.includes("insert failed for"), "the diagnosis itself must survive");
    assert.ok(body.includes("11111111-2222-3333-4444-555555555555"), "the request id is the join to the log line");
    assert.ok(body.includes("test-release"), "events are tagged with the release");
  });
});
