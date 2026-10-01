/* Structured logging config.

   THE RULE: a session token, an OTP (hashed or not), a document path, an e-mail
   address and a phone number must never reach a log line.

   This is not hygiene, it is the same rule the product enforces everywhere else.
   /api/cron/purge already keeps document ids out of its HTTP response and only in
   the server log; the storage path is the one string that says which national ID
   scan belongs to whom. And once Step 8 closes contact exchange, an e-mail in a
   request log is the same leak as an e-mail in a JSON response — DevTools is just
   replaced by whoever can read the logs.

   Fastify's redaction runs on the serialised object, so it covers anything we
   attach to the request/reply, plus the headers it logs by default. Paths are
   listed rather than guessed, so adding a field that carries PII means adding it
   here too. */

export const REDACT_PATHS = [
  // Credentials in transit
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  // OTP material
  "*.code",
  "*.codeHash",
  "*.code_hash",
  "*.devCode",
  "*.token",
  "*.sessionToken",
  // espace prof v2 · auth (phase 2): passwords, their hash, and the set-password grant
  "*.password",
  "*.currentPassword",
  "*.newPassword",
  "*.passwordHash",
  "*.password_hash",
  "*.passwordGrant",
  "*.grant",
  // Document locations
  "*.storagePath",
  "*.storage_path",
  // Personal data
  "*.email",
  "*.phone",
  "*.guardianPhone",
  "*.guardian_phone",
  "*.identifier",
];

export const loggerOptions = {
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  redact: { paths: REDACT_PATHS, censor: "[redacted]" },
  /* The default serialisers log the full URL. Query strings are a classic place
     for an identifier to end up, so log only the path. Nothing in this API should
     put PII in a query string either — but a log config that assumes discipline
     is a log config that eventually leaks. */
  serializers: {
    req(req: { method: string; url: string; id: string }) {
      return { id: req.id, method: req.method, path: req.url.split("?")[0] };
    },
  },
};
