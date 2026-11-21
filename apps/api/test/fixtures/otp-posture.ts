/* Child-process probe for test/boot-posture.test.ts. Runs with whatever NODE_ENV the
   parent hands it (often none) and prints the JSON the API returns for an OTP
   request when no mail provider is configured. */
import { buildServer } from "../../src/server";

const identifier = process.argv[2];
// Optional client address, so repeated probes do not share one per-IP OTP bucket.
const remoteAddress = process.argv[3];
const app = await buildServer();
const res = await app.inject({
  method: "POST",
  url: "/auth/otp/request",
  ...(remoteAddress ? { remoteAddress } : {}),
  payload: { identifier, locale: "fr" },
});
// Marked: the server's own log lines share stdout.
process.stdout.write(`\nPOSTURE ${JSON.stringify({ nodeEnv: process.env.NODE_ENV ?? null, body: res.json() })}\n`);
await app.close();
process.exit(0);
