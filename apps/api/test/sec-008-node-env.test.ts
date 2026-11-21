import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { authSecret, __resetAuthSecretCache } from "@tnajem/shared/auth-core";

/* VULN-008: the login code (devCode) is an ALLOW-LIST, not a deny-list.

   Before: only NODE_ENV === "production" hid the code, so a staging box, a
   mistyped `prod` or a capitalised `Production` with no MAIL_* answered
   /auth/otp/request with the code itself — anyone could sign in as anyone.
   Now: only NODE_ENV === "development" exactly shows it. Each case runs in a
   fresh process, because NODE_ENV is settled once at module load. */

const FIXTURE = fileURLToPath(new URL("./fixtures/otp-posture.ts", import.meta.url));

function otpProbe(nodeEnv: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: nodeEnv };
  // No provider: the configuration that leaks the code when the posture is wrong.
  for (const k of ["MAIL_HOST", "MAIL_USER", "MAIL_PASS", "MAIL_FROM_ADDRESS", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"]) env[k] = "";
  const identifier = `sec008-${randomBytes(4).toString("hex")}@tnajem.invalid`;
  const ip = `10.8.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;
  const r = spawnSync(process.execPath, ["--import", "tsx", FIXTURE, identifier, ip], { encoding: "utf8", env, timeout: 60_000 });
  assert.equal(r.status, 0, `probe failed: ${r.stderr}`);
  const line = r.stdout.split(/\r?\n/).find((l) => l.startsWith("POSTURE "));
  assert.ok(line, `no probe output: ${r.stdout.slice(-300)}`);
  return JSON.parse(line.slice("POSTURE ".length)).body as { ok: boolean; error?: string; devCode?: string };
}

describe("VULN-008: devCode only when NODE_ENV is exactly development", () => {
  for (const nodeEnv of ["staging", "Production", "prod", "production"]) {
    test(`NODE_ENV=${JSON.stringify(nodeEnv)} returns no devCode`, () => {
      const body = otpProbe(nodeEnv);
      assert.equal(body.devCode, undefined, "a code in the response is an account-takeover oracle");
      assert.deepEqual(body, { ok: false, error: "send-failed" });
    });
  }

  test(`NODE_ENV="" (unset) returns no devCode`, () => {
    // Blank, not deleted: dotenv skips a key already present, so the repo .env (CI writes
    // NODE_ENV=development there) cannot refill it. env.ts reads "" as unset = production.
    const body = otpProbe("");
    assert.equal(body.devCode, undefined);
  });

  test("NODE_ENV=development returns the code", () => {
    const body = otpProbe("development");
    assert.equal(body.ok, true);
    assert.match(String(body.devCode), /^\d{6}$/);
  });
});

describe("VULN-008: the public dev AUTH_SECRET is for development and test only", () => {
  function withEnv(nodeEnv: string | undefined, fn: () => void) {
    const prevSecret = process.env.AUTH_SECRET;
    const prevEnv = process.env.NODE_ENV;
    __resetAuthSecretCache();
    delete process.env.AUTH_SECRET;
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
    try {
      fn();
    } finally {
      __resetAuthSecretCache();
      process.env.NODE_ENV = prevEnv;
      if (prevSecret !== undefined) process.env.AUTH_SECRET = prevSecret;
    }
  }

  for (const nodeEnv of ["staging", "Production", "prod", "production", "", undefined]) {
    test(`NODE_ENV=${JSON.stringify(nodeEnv)} without AUTH_SECRET throws`, () => {
      withEnv(nodeEnv, () => assert.throws(() => authSecret(), /AUTH_SECRET is not set/));
    });
  }

  for (const nodeEnv of ["development", "test"]) {
    test(`NODE_ENV=${nodeEnv} without AUTH_SECRET falls back to the dev default`, () => {
      withEnv(nodeEnv, () => assert.doesNotThrow(() => authSecret()));
    });
  }
});
