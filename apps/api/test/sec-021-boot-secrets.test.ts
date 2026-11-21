import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as envModule from "../src/env";

/* VULN-021: the API refuses to boot with a weak secret it owns.

   Before: any non-empty AUTH_SECRET / CRON_SECRET booted a production API, so
   `AUTH_SECRET=changeme` made every HMAC forgeable offline and `CRON_SECRET=b`
   opened /cron/*. Now every secret the API generates must be at least 32
   characters whenever NODE_ENV is not exactly development or test. The refusal
   names the variable and never its value. */

type Problem = { name: string; message: string };
// Looked up dynamically so this file reports a clean failure (not a type error) on
// the unfixed code, where the function does not exist yet.
const bootSecretProblems = (envModule as unknown as { bootSecretProblems?: (env: NodeJS.ProcessEnv) => Problem[] })
  .bootSecretProblems;

const STRONG = "k".repeat(40);
const DOC_KEY = "ab".repeat(32); // 64 hex characters = 32 bytes
const DOC_KEY_PREVIOUS = "cd".repeat(32);
// Distinctive weak values, so "the message does not contain the value" means something.
const WEAK = { one: "Z", short: "Weak-Val-7q" };

function prodEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    AUTH_SECRET: STRONG,
    CRON_SECRET: "c".repeat(32),
    DOC_ENCRYPTION_KEY: DOC_KEY,
  };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

function problems(env: NodeJS.ProcessEnv): Problem[] {
  assert.equal(typeof bootSecretProblems, "function", "env.ts must export bootSecretProblems(env)");
  return bootSecretProblems!(env);
}

const OWNED = ["AUTH_SECRET", "CRON_SECRET", "DOC_ENCRYPTION_KEY"] as const;

describe("VULN-021: bootSecretProblems (the check assertBootConfig runs)", () => {
  test("production with every owned secret ≥32 characters: no problem", () => {
    assert.deepEqual(problems(prodEnv()), []);
    assert.deepEqual(problems(prodEnv({ DOC_ENCRYPTION_KEY_PREVIOUS: DOC_KEY_PREVIOUS })), []);
  });

  for (const name of [...OWNED, "DOC_ENCRYPTION_KEY_PREVIOUS"]) {
    for (const [label, value] of Object.entries(WEAK)) {
      test(`production refuses ${name} set to a ${label} value, naming it without its value`, () => {
        const found = problems(prodEnv({ [name]: value }));
        assert.equal(found.length, 1, JSON.stringify(found.map((p) => p.name)));
        assert.equal(found[0].name, name);
        assert.match(found[0].message, new RegExp(`\\b${name}\\b`));
        assert.match(found[0].message, /shorter than 32 characters/);
        if (value.length > 1) assert.ok(!found[0].message.includes(value), "the message must never carry the value");
        assert.doesNotMatch(found[0].message, /\d+ characters? long|length/i, "no length detail beyond 'shorter than 32'");
      });
    }
  }

  for (const name of OWNED) {
    test(`production refuses a missing ${name}`, () => {
      for (const v of [undefined, "", "   "]) {
        const found = problems(prodEnv({ [name]: v }));
        assert.deepEqual(found.map((p) => p.name), [name]);
        assert.match(found[0].message, /missing/);
      }
    });
  }

  test("unknown NODE_ENV values are production", () => {
    for (const nodeEnv of ["staging", "Production", "prod", "", undefined]) {
      const found = problems(prodEnv({ NODE_ENV: nodeEnv, CRON_SECRET: WEAK.short }));
      assert.deepEqual(found.map((p) => p.name), ["CRON_SECRET"], `NODE_ENV=${JSON.stringify(nodeEnv)}`);
    }
  });

  test("development and test check nothing (local setups keep their short values)", () => {
    for (const nodeEnv of ["development", "test"]) {
      assert.deepEqual(problems({ NODE_ENV: nodeEnv, AUTH_SECRET: "a", CRON_SECRET: "" }), []);
    }
  });

  test("third-party credentials: no length rule, refused only when empty while their feature is configured", () => {
    // A provider password of any length is fine.
    assert.deepEqual(problems(prodEnv({ MAIL_HOST: "smtp.example.test", MAIL_USER: "u", MAIL_PASS: "p" })), []);
    assert.deepEqual(problems(prodEnv({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t" })), []);
    // Feature not configured at all: nothing to say.
    assert.deepEqual(problems(prodEnv({ MAIL_PASS: "", TWILIO_AUTH_TOKEN: "" })), []);
    // Configured, credential empty: refused, named.
    const mail = problems(prodEnv({ MAIL_HOST: "smtp.example.test", MAIL_USER: "u", MAIL_PASS: "" }));
    assert.deepEqual(mail.map((p) => p.name), ["MAIL_PASS"]);
    const sms = problems(prodEnv({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: " " }));
    assert.deepEqual(sms.map((p) => p.name), ["TWILIO_AUTH_TOKEN"]);
  });
});

describe("VULN-021: the real server refuses to boot", () => {
  const SERVER = fileURLToPath(new URL("../src/server.ts", import.meta.url));

  function boot(overrides: Record<string, string>) {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      API_PORT: "0",
      NODE_ENV: "production",
      CORS_ORIGINS: "http://localhost:3291",
      TRUSTED_PROXIES: "127.0.0.1",
      AUTH_SECRET: STRONG,
      CRON_SECRET: "c".repeat(32),
      DOC_ENCRYPTION_KEY: DOC_KEY,
      DOC_ENCRYPTION_KEY_PREVIOUS: "",
      MAIL_HOST: "",
      MAIL_USER: "",
      MAIL_PASS: "",
      TWILIO_ACCOUNT_SID: "",
      TWILIO_AUTH_TOKEN: "",
      ...overrides,
    };
    return spawnSync(process.execPath, ["--import", "tsx", SERVER], { encoding: "utf8", env, timeout: 60_000 });
  }

  test("NODE_ENV=production with a short CRON_SECRET exits 1, naming it, never its value", () => {
    const r = boot({ CRON_SECRET: WEAK.short });
    assert.equal(r.status, 1, `expected a refusal; stderr: ${r.stderr.slice(-300)}`);
    assert.match(r.stderr, /FATAL CONFIG: .*CRON_SECRET is shorter than 32 characters/);
    assert.ok(!`${r.stdout}${r.stderr}`.includes(WEAK.short), "the value must never be logged");
  });
});
