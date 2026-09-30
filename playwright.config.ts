import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";
import { E2E_DOC_KEY } from "./e2e/support/env";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3210";

/* E2E_SERVER_TZ runs BOTH servers in that timezone (e2e/timezone.spec.ts): a class
   time must not depend on where the process runs. When it is set, an already
   running server is never reused — it would be in whatever zone it started in. */
const SERVER_TZ: Record<string, string> = process.env.E2E_SERVER_TZ ? { TZ: process.env.E2E_SERVER_TZ } : {};
const REUSE = !process.env.CI && !process.env.E2E_SERVER_TZ;

/* E2E_STORAGE_DRIVER=s3 runs the API on the s3 driver (S3_* come from the environment)
   and e2e/support/store.ts reads the same bucket. Default: local files. */
const STORAGE_ENV: Record<string, string> =
  process.env.E2E_STORAGE_DRIVER === "s3" ? { STORAGE_DRIVER: "s3" } : { STORAGE_DRIVER: "local" };

export default defineConfig({
  testDir: "./e2e",
  /* workers:1 — three things are process-global no matter how independent the
     specs look: the rate_limits table, STORAGE_DIR, and the on-disk ISR cache. */
  workers: 1,
  fullyParallel: false,
  /* retries:0 — a retry that passes hides a race, and this suite exists
     specifically to catch one (the seat claim). */
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: { baseURL: BASE, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  /* `next start` DOES NOT WORK with output:"standalone" — it logs Ready, listens,
     and never answers. And the standalone bundle ships without .next/static and
     public/. start:standalone handles both. A dev server is NOT usable here
     either: ISR/unstable_cache only behave correctly in a production build, and
     this suite has to protect that guardrail. */
  /* TWO servers now. From Step 4 the web app proxies actions to the API, so a
     suite that starts only the web app would exercise a half-wired system and
     fail in a way that looks like a product bug.

     Playwright starts these in order and waits for each `url` to answer. Note
     this is CONFIG, not a spec: the Stage A contract is that no spec file
     changes, and none has. */
  webServer: process.env.E2E_BASE_URL ? undefined : [
    {
      command: "npm run build -w @tnajem/api && npm run start -w @tnajem/api",
      url: "http://127.0.0.1:4000/health",
      reuseExistingServer: REUSE,
      timeout: 120_000,
      env: {
        ...SERVER_TZ,
        ...STORAGE_ENV,
        /* EXPLICIT. The API treats an unset NODE_ENV as production, and this suite
           relies on development behaviour (no mail provider, dev trust of loopback). */
        NODE_ENV: "development",
        // Test-only key (e2e/support/env.ts): seeded documents are sealed with it.
        DOC_ENCRYPTION_KEY: E2E_DOC_KEY,
        API_PORT: "4000",
        STORAGE_DIR: resolve(process.env.E2E_STORAGE_DIR ?? ".e2e-storage"),
        ADMIN_EMAILS: "e2e-admin@tnajem.invalid",
        /* NO REAL MAIL FROM THE TEST SUITE.

           MAIL_* are set in .env, so mailEnabled() was true and every OTP request
           opened a live SMTP connection from the developer's real account — to
           @tnajem.invalid addresses that can never be delivered. That is slow
           (it made the signup spec time out at 60s waiting on a submit button
           still showing "Chargement…"), and it is the kind of thing that quietly
           burns a sending reputation.

           dotenv does NOT overwrite a key that is already present in process.env,
           even when the value is an empty string — verified — so setting these
           blank here beats .env without editing it. requestOtp then takes its
           no-provider path, which is dev-only and safe: it fails CLOSED in
           production (IS_PROD refuses to return the code). The suite never reads
           the on-screen code anyway; support/otp.ts recovers it from the hash. */
        MAIL_HOST: "",
        MAIL_USER: "",
        MAIL_PASS: "",
        MAIL_FROM_ADDRESS: "",
        TWILIO_ACCOUNT_SID: "",
        TWILIO_AUTH_TOKEN: "",
        /* phase-a lane L2 (A24). The pilot is adults only by default, but the
           guardian-consent machinery must keep being PROVEN (§2: consent is checked
           on the server for every minor's booking), and the guardian, consent and
           minor-journey specs seed minors who book. So the suite runs with minors
           ON; the default-off gate is proven by apps/api/test/a24-adult-pilot.test.ts. */
        ALLOW_MINORS: "1",
      },
    },
    {
      command: "npm run build -w @tnajem/web && npm run start:standalone -w @tnajem/web",
      url: "http://localhost:3210/fr",
      reuseExistingServer: REUSE,
      timeout: 300_000,
      env: {
        ...SERVER_TZ,
        PORT: "3210",
        /* next build/start must run as production. e2e/support/env loads .env into this
           process, and CI's .env says NODE_ENV=development, which breaks prerendering. */
        NODE_ENV: "production",
        /* ABSOLUTE, always. Next's standalone server.js chdir()s to its own
           directory, so a relative STORAGE_DIR resolves to
           .next/standalone/.e2e-storage for the server while the seeder writes to
           <repo>/.e2e-storage. The doc route then 404s on a file that exists. */
        STORAGE_DIR: resolve(process.env.E2E_STORAGE_DIR ?? ".e2e-storage"),
        /* Pin the admin allowlist to a seeded identity so admin.spec.ts does not
           depend on whoever happens to be in the developer's .env. */
        ADMIN_EMAILS: "e2e-admin@tnajem.invalid",
        API_URL: "http://127.0.0.1:4000",
        /* phase-a lane L1 (A12): pinned UNSET, so zero-contact-copy.spec.ts proves the
           /account support row is hidden whatever the developer's .env holds. Blank
           here beats .env, as with MAIL_* above. */
        NEXT_PUBLIC_SUPPORT_WHATSAPP: "",
        // phase-a lane L2 (A24): the same switch as the API, so the signup copy matches it.
        /* phase-a lane L5 (A18.1): the guardian-consent form only renders while
           ALLOW_MINORS=1 (app/[locale]/auth/consent/layout.tsx). The suite keeps
           exercising the minor + guardian flows, so the web server runs with it
           on; lane L2 sets the API side of the same switch. */
        ALLOW_MINORS: "1",
      },
    },
    /* Phase A+ (P4): the SAME build, a second web process with ALLOW_MINORS UNSET.
       The adults-only pilot tag must show exactly when the flag is off, and the web
       server above runs with it on (the consent specs need it). Nothing is rebuilt:
       Playwright starts these in order, so the build above is done by now.
       e2e/pilot-tag.spec.ts reaches it through E2E_PILOT_BASE_URL. */
    {
      command: "npm run start:standalone -w @tnajem/web",
      url: "http://localhost:3212/fr",
      reuseExistingServer: REUSE,
      timeout: 120_000,
      env: {
        ...SERVER_TZ,
        PORT: "3212",
        /* next build/start must run as production. e2e/support/env loads .env into this
           process, and CI's .env says NODE_ENV=development, which breaks prerendering. */
        NODE_ENV: "production",
        STORAGE_DIR: resolve(process.env.E2E_STORAGE_DIR ?? ".e2e-storage"),
        ADMIN_EMAILS: "e2e-admin@tnajem.invalid",
        API_URL: "http://127.0.0.1:4000",
        NEXT_PUBLIC_SUPPORT_WHATSAPP: "",
        ALLOW_MINORS: "", // blank beats .env, as with MAIL_* above
      },
    },
  ],
});
