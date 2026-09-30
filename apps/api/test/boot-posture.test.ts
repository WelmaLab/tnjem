import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

/* security: an API process nobody configured runs with the production rules ON.

   Found by the 15 Sept 2026 security review: NODE_ENV unset used to mean
   development, the pm2/systemd deploy never set it, and with one MAIL_* key
   missing the OTP request answered with the code itself — readable by whoever
   typed the address, an admin's included. Each case runs in a fresh process,
   because NODE_ENV is settled once at module load. */

const FIXTURE = fileURLToPath(new URL("./fixtures/otp-posture.ts", import.meta.url));
const SERVER = fileURLToPath(new URL("../src/server.ts", import.meta.url));

function childEnv(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // Blank, not deleted: dotenv skips keys already present, so a deleted key would be
  // refilled from the repo .env (CI writes NODE_ENV=development there). "" reads as unset.
  env.NODE_ENV = "";
  // No mail provider: the configuration that used to leak the code.
  for (const k of ["MAIL_HOST", "MAIL_USER", "MAIL_PASS", "MAIL_FROM_ADDRESS", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"]) env[k] = "";
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) env[k] = "";
    else env[k] = v;
  }
  return env;
}

function otpProbe(overrides: Record<string, string | undefined>) {
  const identifier = `posture-${randomBytes(4).toString("hex")}@tnajem.invalid`;
  const r = spawnSync(process.execPath, ["--import", "tsx", FIXTURE, identifier], {
    encoding: "utf8",
    env: childEnv(overrides),
    timeout: 60_000,
  });
  assert.equal(r.status, 0, `probe failed: ${r.stderr}`);
  // The server logs to stdout too; the probe marks its own line.
  const line = r.stdout.split(/\r?\n/).find((l) => l.startsWith("POSTURE "));
  assert.ok(line, `no probe output: ${r.stdout.slice(-300)}`);
  return JSON.parse(line.slice("POSTURE ".length)) as {
    nodeEnv: string | null;
    body: { ok: boolean; error?: string; devCode?: string };
  };
}

function boot(overrides: Record<string, string | undefined>) {
  return spawnSync(process.execPath, ["--import", "tsx", SERVER], {
    encoding: "utf8",
    env: childEnv({ API_PORT: "0", ...overrides }),
    timeout: 60_000,
  });
}

describe("security: production is the default posture", () => {
  test("NODE_ENV unset is production, and no login code is ever returned", () => {
    const { nodeEnv, body } = otpProbe({ NODE_ENV: undefined });
    assert.equal(nodeEnv, "production", "the API must write the default back so shared/db agree");
    assert.equal(body.devCode, undefined, "a code in the response is an account-takeover oracle");
    assert.deepEqual(body, { ok: false, error: "send-failed" });
  });

  test("development is opt-in: only an explicit NODE_ENV=development shows the code", () => {
    const { body } = otpProbe({ NODE_ENV: "development" });
    assert.equal(body.ok, true);
    assert.match(String(body.devCode), /^\d{6}$/);
  });

  test("production refuses to boot without TRUSTED_PROXIES", () => {
    const r = boot({
      NODE_ENV: undefined,
      TRUSTED_PROXIES: undefined,
      CORS_ORIGINS: "http://localhost:3000",
      AUTH_SECRET: "x".repeat(40),
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /FATAL CONFIG: missing .*TRUSTED_PROXIES/);
  });

  test("a trust-every-hop value is refused in every environment", () => {
    for (const value of ["true", "*", "0.0.0.0/0", "127.0.0.1,::/0"]) {
      const r = boot({ NODE_ENV: "development", TRUSTED_PROXIES: value });
      assert.equal(r.status, 1, `TRUSTED_PROXIES=${value} must not boot`);
      assert.match(r.stderr, /TRUSTED_PROXIES trusts every hop/);
    }
  });
});
