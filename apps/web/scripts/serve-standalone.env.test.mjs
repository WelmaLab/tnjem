/* VULN-003 — the web process must not receive backend secrets.

     node --test apps/web/scripts/serve-standalone.env.test.mjs

   1. webChildEnv() / the generated .env.web keep the allow-list only.
   2. Behavioural: the REAL serve-standalone.mjs (copied with its siblings into a
      throwaway app root) is run against a fake .next/standalone server.js that
      dumps the environment it was given. The env file beside it holds every
      backend secret; the child must see none of them.

   The throwaway root lives under apps/web/.next (git-ignored) rather than the OS
   temp dir so that `import("dotenv")` in the copied scripts resolves through the
   repo's node_modules, exactly as it does for the real file. */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, copyFileSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const webDir = dirname(scriptsDir);

const SECRETS = {
  DATABASE_URL: "postgresql://owner:pw@127.0.0.1:5432/tnajem",
  MIGRATION_DATABASE_URL: "postgresql://owner:pw@127.0.0.1:5432/tnajem",
  DOC_ENCRYPTION_KEY: "a".repeat(64),
  DOC_ENCRYPTION_KEY_PREVIOUS: "b".repeat(64),
  AUTH_SECRET: "c".repeat(64),
  CRON_SECRET: "d".repeat(64),
  MAIL_PASS: "mail-pass",
  MAIL_USER: "mailer@example.invalid",
  S3_SECRET_ACCESS_KEY: "s3-secret",
  S3_ACCESS_KEY_ID: "s3-id",
  TWILIO_AUTH_TOKEN: "twilio-token",
  ADMIN_EMAILS: "admin@example.invalid",
};
const PUBLIC = {
  NODE_ENV: "production",
  API_URL: "http://127.0.0.1:4000",
  NEXT_PUBLIC_SITE_URL: "https://example.invalid",
  NEXT_PUBLIC_DEFAULT_MEET_BASE: "https://meet.jit.si/tnajem-",
  ALLOW_MINORS: "",
  OTP_CHANNEL: "email",
  SENTRY_DSN: "https://key@o0.ingest.example.invalid/1",
};
const MUST_BE_ABSENT = Object.keys(SECRETS);

const envText = (vars) => Object.entries(vars).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";

test("webChildEnv keeps the allow-list and drops every backend secret", async () => {
  const { webChildEnv } = await import(pathToFileURL(join(scriptsDir, "web-env.mjs")).href);
  const env = webChildEnv(
    { ...SECRETS, ...PUBLIC },
    { PATH: "/usr/bin", MAIL_PASS: "from-process", PORT: "3261", API_URL: "http://127.0.0.1:4261", ALLOW_MINORS: "" },
  );
  for (const k of MUST_BE_ABSENT) assert.equal(k in env, false, `${k} reached the web child`);
  assert.equal(env.API_URL, "http://127.0.0.1:4261", "a real env var beats the file");
  assert.equal(env.NEXT_PUBLIC_SITE_URL, PUBLIC.NEXT_PUBLIC_SITE_URL);
  assert.equal(env.ALLOW_MINORS, "", "blank in the real env beats the file");
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.PORT, "3261");
});

test("system variables are taken from the real environment, never from an env file", async () => {
  const { webChildEnv } = await import(pathToFileURL(join(scriptsDir, "web-env.mjs")).href);
  const env = webChildEnv({ PATH: "/evil", NODE_OPTIONS: "--require /tmp/x.js" }, {});
  assert.equal("PATH" in env, false);
  assert.equal("NODE_OPTIONS" in env, false);
});

test("the generated .env.web holds no secret and round-trips through dotenv", async () => {
  const { webEnvFileText } = await import(pathToFileURL(join(scriptsDir, "web-env.mjs")).href);
  const { parse } = await import("dotenv");
  const tricky = { NEXT_PUBLIC_SUPPORT_WHATSAPP: "216 # not a comment 'x'", SENTRY_ENVIRONMENT: 'a "b" c' };
  const back = parse(webEnvFileText({ ...SECRETS, ...PUBLIC, ...tricky }));
  for (const k of MUST_BE_ABSENT) assert.equal(k in back, false, `${k} written to .env.web`);
  assert.deepEqual(back, { ...PUBLIC, ...tricky });
});

/* ── behavioural ─────────────────────────────────────────────────────────── */
const sandbox = join(webDir, ".next", `vuln003-test-${randomBytes(4).toString("hex")}`);
after(() => rmSync(sandbox, { recursive: true, force: true }));

/** A fake repo: <sandbox>/.env + <sandbox>/apps/web/{scripts,.next/standalone/...}. */
function fakeRepo() {
  const appRoot = join(sandbox, "apps", "web");
  mkdirSync(join(appRoot, "scripts"), { recursive: true });
  for (const f of readdirSync(scriptsDir)) {
    if (f.endsWith(".mjs") && !f.endsWith(".test.mjs")) copyFileSync(join(scriptsDir, f), join(appRoot, "scripts", f));
  }
  const serverDir = join(appRoot, ".next", "standalone", "apps", "web");
  mkdirSync(serverDir, { recursive: true });
  mkdirSync(join(appRoot, ".next", "static"), { recursive: true });
  writeFileSync(
    join(serverDir, "server.js"),
    `require("node:fs").writeFileSync(require("node:path").join(__dirname, "env-dump.json"), JSON.stringify(process.env));\n`,
  );
  writeFileSync(join(sandbox, ".env"), envText({ ...SECRETS, ...PUBLIC }));
  return { appRoot, dump: join(serverDir, "env-dump.json") };
}

function runRunner(appRoot, args = []) {
  const env = { ...process.env, PORT: "3999" };
  delete env.HOSTNAME; // the runner defaults it to "localhost"; a loopback literal is refused
  for (const k of [...MUST_BE_ABSENT, ...Object.keys(PUBLIC)]) delete env[k];
  env.MAIL_PASS = "from-the-real-environment"; // a secret in the RUNNER's env must not pass either
  return spawnSync(process.execPath, [join(appRoot, "scripts", "serve-standalone.mjs"), ...args], {
    env,
    encoding: "utf8",
    timeout: 60_000,
  });
}

test("serve-standalone hands the Next child no backend secret (root .env, local default)", () => {
  const { appRoot, dump } = fakeRepo();
  const r = runRunner(appRoot);
  assert.equal(r.status, 0, `runner failed:\n${r.stdout}\n${r.stderr}`);
  const childEnv = JSON.parse(readFileSync(dump, "utf8"));
  const leaked = MUST_BE_ABSENT.filter((k) => k in childEnv);
  assert.deepEqual(leaked, [], `secrets in the web child's env: ${leaked.join(", ")}`);
  assert.equal(childEnv.API_URL, PUBLIC.API_URL);
  assert.equal(childEnv.NEXT_PUBLIC_SITE_URL, PUBLIC.NEXT_PUBLIC_SITE_URL);
  assert.equal(childEnv.PORT, "3999");
  assert.equal(childEnv.HOSTNAME, "localhost");
});

test("serve-standalone --env-file reads exactly that file (the pm2 / .env.web path)", () => {
  const { appRoot, dump } = fakeRepo();
  const webEnv = join(sandbox, ".env.web");
  writeFileSync(webEnv, envText({ ...SECRETS, ...PUBLIC, API_URL: "http://127.0.0.1:4555" }));
  const r = runRunner(appRoot, ["--env-file", webEnv]);
  assert.equal(r.status, 0, `runner failed:\n${r.stdout}\n${r.stderr}`);
  const childEnv = JSON.parse(readFileSync(dump, "utf8"));
  assert.deepEqual(MUST_BE_ABSENT.filter((k) => k in childEnv), []);
  assert.equal(childEnv.API_URL, "http://127.0.0.1:4555");

  const missing = runRunner(appRoot, ["--env-file", join(sandbox, "nope.env")]);
  assert.notEqual(missing.status, 0, "a named env file that does not exist must stop the runner");
});
