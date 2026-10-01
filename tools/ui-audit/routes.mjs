/* Shared route + viewport config for shots.mjs / nojs.mjs / a11y.mjs.

   Every path here is LOCALE-BARE — the runners expand it across /fr and /ar, so a
   route can never be audited in one language and forgotten in the other. */

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/* The repo root, resolved from THIS FILE rather than from cwd. Everything below
   that touches the filesystem or the env goes through it. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const BASE = process.env.UI_AUDIT_BASE || "http://localhost:3111";
export const LOCALES = ["fr", "ar"];
export const WIDTHS = [320, 380, 768, 1280];

/* ── SESSIONS ────────────────────────────────────────────────────────────────
   The logged-in screens have to be audited AS the role they serve, and until now
   they were not audited at all.

   The old sentinel was `tnajem_session=demo`. It is not a session: getSession()
   matches it against the `sessions` table and finds nothing whenever a database is
   configured, and proxy.ts rejects the literal string outright in production.
   So every `auth: true` route was really being measured in its SIGNED-OUT state —
   which was survivable while those pages rendered an empty panel, and stopped being
   survivable when /onboarding, /onboarding/verify, /student/welcome and
   /onboarding/upgrade grew server-side role guards that REDIRECT. A harness that
   silently audits /auth six times while reporting six route names is worse than no
   harness.

   So: mint a real session row when a local database is available, one per role,
   and fall back to the sentinel when there is no DB (demo mode, where the page
   guards are inert by design and the screens render anyway).

   SAFETY RAIL: this writes rows, so it refuses any database that is not on
   localhost. An audit must never seed accounts into a real one. */
/* Email is the login identity (lib/auth.ts::otpChannel), so the audit accounts
   need one — a phone-only row would still session correctly, but it would not match
   what a real signup produces, and the account screen renders the address. The phone
   is kept alongside as the optional contact, so the tutor dashboard's contact column
   is exercised in its normal state. */
const AUDIT_IDS = {
  tutor: { email: "audit-tutor@tnajem.invalid", phone: "+21600000001" },
  student: { email: "audit-student@tnajem.invalid", phone: "+21600000002" },
};
const SENTINEL = { name: "tnajem_session", value: "demo", url: BASE };

/* THE ADMIN IDENTITY IS NOT A FIXED ADDRESS, because the allowlist decides who is
   an admin and the allowlist is ADMIN_EMAILS. A hardcoded audit-admin@ would
   render the "Accès réservé" panel on every admin screen — a shot of the refusal
   page, filed under the name of the queue, which is worse than no shot at all.

   So the harness signs in AS the first allowlisted address. That is picking an
   identity, not re-implementing the gate: requireAdmin() in apps/api is still the
   only thing that decides, and if this picks wrong the screenshot shows the denied
   panel and says so. Get-or-create, and the localhost-only rail above still
   applies — an audit must never seed accounts into a real database. */
function adminEmail() {
  const first = (process.env.ADMIN_EMAILS ?? "").split(",")[0]?.trim().toLowerCase();
  return first || null;
}

/* .env.local has to be loaded BEFORE we look for DATABASE_URL — the runners are
   plain node scripts, not the Next runtime, so nothing has loaded it for us.

   Cache the PROMISE, not a "done" flag: two concurrent sessionCookie() calls
   would otherwise have the second one see the flag already set and read
   DATABASE_URL while the first was still awaiting the import — so one role got a
   real session and the other silently fell back to the sentinel. */
let envPromise = null;
function loadEnv() {
  envPromise ??= (async () => {
    try {
      const { config } = await import("dotenv");
      /* Match Next.js precedence: .env holds the shared config, .env.local overrides it.
         Loading only .env.local left these scripts blind to CRON_SECRET, ADMIN_EMAILS,
         OTP_CHANNEL and MAIL_* — so the CLI and the running app disagreed. */
      /* From ROOT (lib-color.mjs resolves it from this module), not from cwd.
         These were cwd-relative and only worked because the runners are always
         invoked from the repo root. Run one from anywhere else and DATABASE_URL
         goes missing, sessionCookie() falls back to the sentinel, and every
         logged-in route is silently audited in its SIGNED-OUT state — the exact
         failure the header of this file exists to describe. */
      config({ path: join(ROOT, ".env") });
      config({ path: join(ROOT, ".env.local"), override: true }); // still wins over a stray shell var
    } catch {
      /* dotenv missing → fall through to whatever the shell exported */
    }
  })();
  return envPromise;
}

function localDb() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  try {
    const h = new URL(url).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "::1" ? url : null;
  } catch {
    return null;
  }
}

/* Promises, not values — see loadEnv(). Concurrent callers for the same role must
   await one mint, not start two. */
const cache = new Map();

/** A cookie descriptor carrying a REAL session for `role`, or the sentinel. */
export async function sessionCookie(role = "tutor") {
  const key = role === "student" || role === "admin" ? role : "tutor";
  if (!cache.has(key)) cache.set(key, mintSession(key));
  return cache.get(key);
}

async function mintSession(key) {

  await loadEnv();
  const url = localDb();
  if (!url) return SENTINEL;

  const [{ default: postgres }, { createHash, randomBytes }] = await Promise.all([
    import("postgres"),
    import("node:crypto"),
  ]);

  const sql = postgres(url, { max: 1 });
  try {
    /* The admin rides a real allowlisted address; the other two are synthetic
       .invalid identities that can never receive mail. */
    const { email, phone } =
      key === "admin" ? { email: adminEmail(), phone: null } : AUDIT_IDS[key];
    if (!email) {
      console.warn("  ! ADMIN_EMAILS is empty — admin routes will audit their DENIED state");
      return SENTINEL;
    }
    let [p] = await sql`select id from profiles where email = ${email}`;
    if (!p) {
      // birth_year: a comfortable adult, so the minor-consent gate never fires and
      // the student screens audit their normal state rather than the consent detour.
      // phase-a lane L2 (A24): + birth_month — isAdult() treats an unknown month as a minor.
      [p] = await sql`insert into profiles (email, phone, role, locale, full_name, birth_year, birth_month)
                      values (${email}, ${phone}, ${key === "admin" ? "tutor" : key}, 'fr',
                              'Audit Harness', 1990, 1) returning id`;
    } else if (key !== "admin") {
      /* The admin row is a REAL account (it is the developer's own address in the
         allowlist). Never rewrite its role or its phone to fit the harness. */
      await sql`update profiles set role = ${key}, phone = ${phone} where id = ${p.id}`;
    }
    /* THE TUTOR NEEDS A STOREFRONT, or /dashboard renders its "create your page"
       empty state and the populated dashboard — the main screen of the product
       for a tutor, and the one carrying the plan panel, the free-session toggle,
       the class list and the bookings table — is never screenshotted at any
       width. It was not, until the final verification pass looked at the shot and
       found an empty panel where the plan card should be.

       status 'draft' deliberately: /explore, the sitemap and every public read
       filter on 'verified', so this row can never surface as a real tutor. It is
       enough to make has_storefront true, which is all the dashboard branches on. */
    if (key === "tutor") {
      const [t] = await sql`select id from tutors where profile_id = ${p.id}`;
      if (!t) {
        await sql`insert into tutors (profile_id, slug, full_name, subject, level, bio, status, verified)
                  values (${p.id}, 'audit-harness', 'Audit Harness',
                          'Prof de Maths · Lycée & Bac', 'Bac',
                          'Seeded by the UI audit harness. Never verified, never public.',
                          'draft', false)`;
      }
    }

    const token = randomBytes(32).toString("hex");
    // The table stores sha256(token), never the token (packages/db/sql/0020).
    await sql`insert into sessions (token_hash, profile_id, expires_at)
              values (${createHash("sha256").update(token).digest("hex")}, ${p.id}, now() + interval '1 day')`;
    return { name: "tnajem_session", value: token, url: BASE };
  } catch (e) {
    console.warn(`  ! could not mint an audit session (${e.message}) — falling back to the sentinel`);
    return SENTINEL;
  } finally {
    await sql.end({ timeout: 2 });
  }
}

/** Set the session a given route needs. `auth: "student"` picks the student one;
    `auth: true` (or anything else) picks the tutor. Call it per route: the two
    roles cannot share one cookie, and the runners loop over both. */
export async function applySession(ctx, route) {
  const role =
    route?.auth === "student" ? "student" : route?.auth === "admin" ? "admin" : "tutor";
  await ctx.addCookies([await sessionCookie(role)]);
}

/* `nojs: true`  → must render h1 + sub + CTA with JavaScript disabled.
   `sub` / `cta`  → the selectors nojs.mjs asserts on. `null` means "not applicable"
                    (a page that legitimately has no lead paragraph or no CTA). */
export const ROUTES = [
  // ── public: indexed, shared on WhatsApp, must survive a failed bundle ──
  { path: "/", name: "home", nojs: true, h1: "h1.web-h1", sub: "p.web-lead", cta: "main a.btn-primary" },
  { path: "/pour-les-profs", name: "pour-les-profs", nojs: true, h1: "h1.web-h1", sub: "p.web-lead", cta: "main a.btn-primary" },
  { path: "/tarifs", name: "tarifs", nojs: true, h1: "main h1", sub: "main p.web-lead", cta: "main a.btn-primary" },
  { path: "/explore", name: "explore", nojs: true, h1: "main h1", sub: "main h1 + p", cta: "main a.u-card-int, main a[href*=\"/\"]" },
  /* The CTA is "Réserver" while the tutor has an upcoming class, and the empty
     state's "Voir d'autres profs" once they have none. Seeded dates age: since
     fix-04 a storefront no longer sells a class that already ran, so a dev
     database seeded last week has no booking CTA to find, and that is correct. */
  { path: "/yassine-math", name: "storefront", nojs: true, h1: "main h1", sub: "main .sf-bio", cta: "main a.btn-primary, main a.btn-green, main a.sf-empty-cta" },
  { path: "/terms", name: "terms", nojs: true, h1: "main h1", sub: "main p.web-lead", cta: null },
  { path: "/privacy", name: "privacy", nojs: true, h1: "main h1", sub: "main p.web-lead", cta: null },
  { path: "/nonexistent-404", name: "404", nojs: true, h1: "main h1", sub: "main p.web-lead", cta: "main a.btn-primary" },
  // espace prof v2 · growth (P4): the unsubscribe confirm page (no token → the "link does not work" state).
  { path: "/email/unsubscribe", name: "email-unsubscribe", nojs: true, h1: "main h1", sub: "main .eu-lead", cta: null },
  { path: "/auth", name: "auth", nojs: true, h1: "main h1", sub: "main h1 + p", cta: "main button" },
  /* The split signup funnel. These are PUBLIC and they are the top of both
     journeys, so they get the full no-JS contract: on Tunisian 3G the form has to
     be in the first HTML payload or the product has no front door. Their server
     shells exist precisely so that holds — see app/[locale]/signup/prof/page.tsx. */
  { path: "/signup/prof", name: "signup-prof", nojs: true, h1: "main h1", sub: "main h1 + p", cta: "main button" },
  { path: "/signup/eleve", name: "signup-eleve", nojs: true, h1: "main h1", sub: "main h1 + p", cta: "main button" },
  /* Guardian consent. It was the ONE funnel screen with no coverage at all — no
     axe run, no screenshots at any width, no no-JS check — while being the most
     inline-styled file in the flow AND legally load-bearing (INPDP / Loi 2004-63).
     It needs a session (saveConsent refuses an anonymous caller), so it rides the
     student identity; no `nojs` contract because its submit is a client action. */
  { path: "/auth/consent", name: "auth-consent", auth: "student" },

  // ── logged-in product (session cookie) — screenshots + axe, no nojs contract ──
  { path: "/onboarding", name: "onboarding", auth: true },
  { path: "/onboarding/verify", name: "onboarding-verify", auth: true },
  { path: "/dashboard", name: "dashboard", auth: true },
  { path: "/dashboard/new-class", name: "dashboard-new-class", auth: true },
  { path: "/dashboard/new-pack", name: "dashboard-new-pack", auth: true },
  { path: "/dashboard/payout", name: "dashboard-payout", auth: true },
  { path: "/student", name: "student", auth: "student" },
  { path: "/student/welcome", name: "student-welcome", auth: "student" },
  { path: "/onboarding/upgrade", name: "onboarding-upgrade", auth: "student" },
  { path: "/account", name: "account", auth: true },
  { path: "/checkout", name: "checkout", auth: true },
  { path: "/class/c1", name: "class", auth: true },
  /* The live room and the admin verification queue are low-traffic but they are
     real screens, and both were touched by the Tailwind conversion — leaving
     them out of the harness would mean converting code nothing measures. */
  { path: "/live/c1", name: "live", auth: true },
  { path: "/admin/verifications", name: "admin-verifications", auth: "admin" },
  /* Step 16. The plan grant surface. `admin`, or the shot would be the "Accès
     réservé" panel filed under the name of the screen it is refusing. */
  { path: "/admin/plans", name: "admin-plans", auth: "admin" },
  /* Production readiness Stage 2: account blocks. Audited from day one. */
  { path: "/admin/accounts", name: "admin-accounts", auth: "admin" },

  /* ── Stage C screens that shipped with no audit coverage at all ─────────────
     Found by the final verification pass: four real, reachable screens had never
     been screenshotted at any width, never run through axe, never keyboard-walked.
     Adding a page to the product and not to this list is how a screen silently
     stops being measured.

     All four are client components with no server redirect, so they render for
     the identity given and show their EMPTY state when the harness account has no
     data — which is the state most people see on their first visit, and the one
     worth getting right. */
  { path: "/messages", name: "messages", auth: true },
  { path: "/dashboard/materials", name: "dashboard-materials", auth: true },
  { path: "/guardian", name: "guardian", auth: "student" },

  /* espace prof v2 · phase 1 (shell): the AppShell's new pages. The harness tutor is
     a DRAFT storefront, so these show the « not verified yet » state — the blocker,
     the owner preview banner, the empty lists — which is the state a new tutor sees. */
  { path: "/dashboard/classes", name: "dashboard-classes", auth: true },
  { path: "/dashboard/students", name: "dashboard-students", auth: true },
  { path: "/dashboard/storefront", name: "dashboard-storefront", auth: true },
  { path: "/dashboard/storefront/preview", name: "dashboard-storefront-preview", auth: true },
  { path: "/dashboard/plan", name: "dashboard-plan", auth: true },
  /* The public « Ce prof arrive bientôt »: the harness tutor's own slug, seen anonymously. */
  { path: "/audit-harness", name: "coming-soon" },
];

/** Expand the bare routes across both locales. */
export function expand(filter = () => true) {
  const out = [];
  for (const r of ROUTES.filter(filter)) {
    for (const locale of LOCALES) {
      out.push({ ...r, locale, url: `${BASE}/${locale}${r.path === "/" ? "" : r.path}` });
    }
  }
  return out;
}

/** Fail loudly if the dev server is not up — a silent 0-route run is worse than a crash. */
export async function assertServer() {
  try {
    const res = await fetch(`${BASE}/fr`, { redirect: "manual" });
    if (res.status >= 500) throw new Error(`status ${res.status}`);
  } catch (e) {
    console.error(
      `\n  x Cannot reach the dev server at ${BASE}.\n` +
        `    Start it first:  npm run dev -- -p 3111\n` +
        `    (or set UI_AUDIT_BASE to point somewhere else)\n`
    );
    process.exit(1);
  }
}
