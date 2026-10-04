/* Database fixtures for API ROUTE tests (Fastify inject against a real Postgres).

   The unit tests in this folder need no database. A route test does: it seeds rows,
   mints a session the way the API itself would validate it, and drives the real
   handler through app.inject(). This is the one place that knows how.

   ISOLATION. `node --test` runs every *.test.ts file in its OWN process, in
   parallel, against the same database. So every row a file creates carries a tag
   unique to that file's run (`fx-<hex>-...`), and cleanup() deletes exactly those
   rows and nothing else. Never truncate: this database may be a developer's.

   The row shapes mirror e2e/support/seed.ts on purpose — same defaults (a verified
   tutor, a class 72h out, free-first OFF for the tutor), so a behaviour proven here
   and one proven in Playwright are proven about the same thing. */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { buildServer } from "../../src/server";
import { sql as dbSql } from "../../src/db";

/* phase-a lane L2 (typecheck): src/db types its handle as nullable, so `sql\`…\``
   failed `tsc` in every file using it ("not all constituents are callable"). A route
   test without a database proves nothing — fail loudly here instead. */
if (!dbSql) throw new Error("route tests need DATABASE_URL (see test/support/fx.ts)");
export const sql = dbSql;

export type App = Awaited<ReturnType<typeof buildServer>>;

const RUN = randomBytes(4).toString("hex");
const tag = () => `fx-${RUN}-${randomBytes(4).toString("hex")}`;

/** RFC 2606 .invalid never routes mail. */
export const fxEmail = (s: string) => `${s}@tnajem.invalid`;

export async function startApp(): Promise<App> {
  /* A sink, not stdout: route tests would otherwise print every request line. */
  const app = await buildServer({ logStream: { write: () => {} } });
  await app.ready();
  return app;
}

export type Profile = { id: string; email: string; role: string };

export async function seedProfile(
  opts: {
    role?: "student" | "tutor" | "guardian";
    birthYear?: number | null;
    /* phase-a lane L2 (A24): isAdult needs the month. Defaults to January whenever
       a birth year is set, so "birthYear: 1990" still means an adult; pass null
       for an unknown month. */
    birthMonth?: number | null;
    fullName?: string;
    email?: string;
  } = {},
): Promise<Profile> {
  const t = tag();
  const birthYear = opts.birthYear === undefined ? 1990 : opts.birthYear;
  const birthMonth = opts.birthMonth !== undefined ? opts.birthMonth : birthYear == null ? null : 1; // phase-a lane L2 (A24)
  const [row] = await sql<Profile[]>`
    insert into profiles (id, email, role, locale, full_name, birth_year, birth_month)
    values (${randomUUID()}, ${opts.email ?? fxEmail(t)}, ${opts.role ?? "student"}, 'fr',
            ${opts.fullName ?? `FX ${t}`},
            ${birthYear}, ${birthMonth})
    returning id, email, role`;
  return row;
}

export type Tutor = { id: string; slug: string; profileId: string };

/** A tutor row AND its owning profile (role tutor). */
export async function seedTutor(
  opts: {
    status?: "draft" | "pending" | "verified" | "rejected";
    fullName?: string;
    offersFreeFirstSession?: boolean;
    profileId?: string;
  } = {},
): Promise<Tutor> {
  const t = tag();
  const profileId = opts.profileId ?? (await seedProfile({ role: "tutor", fullName: opts.fullName })).id;
  const status = opts.status ?? "verified";
  const [row] = await sql<Tutor[]>`
    insert into tutors (id, profile_id, slug, full_name, subject, level, bio, status, verified,
                        offers_free_first_session)
    values (${randomUUID()}, ${profileId}, ${t}, ${opts.fullName ?? `FX Tutor ${t}`},
            'Mathématiques', 'Bac', ${"Seeded by an API test."}, ${status},
            ${status === "verified"}, ${opts.offersFreeFirstSession ?? false})
    returning id, slug, profile_id as "profileId"`;
  return row;
}

export async function seedClass(opts: {
  tutorId: string;
  seats?: number;
  seatsTaken?: number;
  isFreeFirst?: boolean;
  hoursFromNow?: number;
  at?: Date;
  durationMin?: number;
  status?: string;
}): Promise<{ id: string; title: string }> {
  const t = tag();
  const when = opts.at ?? new Date(Date.now() + (opts.hoursFromNow ?? 72) * 3600_000);
  const [row] = await sql<{ id: string; title: string }[]>`
    insert into classes (id, tutor_id, title, description, scheduled_at, duration_min,
                         price_tnd, seats, seats_taken, is_free_first, status)
    values (${randomUUID()}, ${opts.tutorId}, ${`FX Class ${t}`}, ${"Seeded by an API test."},
            ${when.toISOString()}, ${opts.durationMin ?? 90}, '40', ${opts.seats ?? 20},
            ${opts.seatsTaken ?? 0}, ${opts.isFreeFirst ?? false}, ${opts.status ?? "scheduled"})
    returning id, title`;
  return row;
}

export async function seedBooking(opts: {
  classId: string;
  studentId: string;
  isFree?: boolean;
  status?: "reserved" | "paid" | "attended" | "cancelled";
}): Promise<{ id: string }> {
  const [row] = await sql<{ id: string }[]>`
    insert into bookings (id, class_id, student_id, is_free, status)
    values (${randomUUID()}, ${opts.classId}, ${opts.studentId}, ${opts.isFree ?? false},
            ${opts.status ?? "reserved"})
    returning id`;
  return row;
}

/** A real session row (sha256 of the token, as 0020 stores it). Returns the Cookie header. */
export async function login(profileId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(token).digest("hex");
  await sql`insert into sessions (token_hash, profile_id, expires_at)
            values (${hash}, ${profileId}, now() + interval '1 day')`;
  return `tnajem_session=${token}`;
}

export type Res = { status: number; body: any; raw: string };

export async function call(
  app: App,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  cookie: string | null,
  payload?: unknown,
): Promise<Res> {
  const res = await app.inject({
    method,
    url,
    payload: payload as Record<string, unknown> | undefined,
    headers: cookie ? { cookie } : {},
  });
  let body: any = null;
  try {
    body = res.body ? JSON.parse(res.body) : null;
  } catch {
    body = res.body;
  }
  return { status: res.statusCode, body, raw: res.body };
}

/** Delete every row THIS process created. Call from after(). Children first where
    there is no ON DELETE CASCADE; each step tolerates a table another lane added. */
export async function cleanup(): Promise<void> {
  const t = `fx-${RUN}-%`;
  const steps = [
    () => sql`delete from bookings where class_id in (select c.id from classes c join tutors tu on tu.id = c.tutor_id where tu.slug like ${t})`,
    () => sql`delete from bookings where student_id in (select id from profiles where email like ${t})`,
    () => sql`delete from classes where tutor_id in (select id from tutors where slug like ${t})`,
    () => sql`delete from tutors where slug like ${t}`,
    () => sql`delete from sessions where profile_id in (select id from profiles where email like ${t})`,
    () => sql`delete from profiles where email like ${t}`,
  ];
  for (const step of steps) {
    try {
      await step();
    } catch {
      /* a FK from a newer table: the test file deletes its own children first */
    }
  }
}

export async function stopApp(app: App | undefined): Promise<void> {
  await cleanup();
  await app?.close();
  await sql.end({ timeout: 5 });
}

// phase-a lane L2 ─────────────────────────────────────────────────────────────
/* SIGN-UP THROUGH THE REAL OTP ENDPOINTS (A24, A14).

   Every inject() comes from 127.0.0.1, and the per-IP OTP budgets (10 requests /
   10 min, 30 verifies / 15 min) live in Postgres, shared by every test process
   running in parallel. A random private address per file gives each caller its
   own budget instead of spending everybody's.

   The identifier is fx-tagged, so cleanup() removes the profile and its sessions
   like any other fixture row. */
export function fxClientIp(): string {
  const b = randomBytes(3);
  return `10.${b[0]}.${b[1]}.${b[2]}`;
}

/** A fresh fx-tagged address for a sign-up the API itself will create. */
export const fxSignupEmail = (): string => fxEmail(tag());

/** POST /auth/otp/request then /auth/otp/verify with `body`, from `ip`. */
export async function otpVerify(
  app: App,
  ip: string,
  body: { identifier: string; role?: "student" | "tutor"; birthYear?: number; birthMonth?: number },
): Promise<Res> {
  // No provider configured → the API returns the code on screen (dev posture).
  for (const k of ["MAIL_HOST", "MAIL_USER", "MAIL_PASS", "MAIL_FROM_ADDRESS"]) process.env[k] = "";
  const req = await app.inject({
    method: "POST",
    url: "/auth/otp/request",
    payload: { identifier: body.identifier, locale: "fr" },
    remoteAddress: ip,
  });
  const code = String((JSON.parse(req.body) as { devCode?: string }).devCode);
  const res = await app.inject({
    method: "POST",
    url: "/auth/otp/verify",
    payload: { ...body, code, locale: "fr" },
    remoteAddress: ip,
  });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null, raw: res.body };
}

/** The Tunis (year, month) `monthsAgo` months before now — "17 years 11 months ago"
    is monthsAgo = 17 * 12 + 11. Month is 1–12. */
export function tunisMonthsAgo(monthsAgo: number, now: Date = new Date()): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Tunis", year: "numeric", month: "numeric" })
    .formatToParts(now);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const total = y * 12 + (m - 1) - monthsAgo;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

/** rate_limits rows keyed on this file's address. Call from after(). */
export async function cleanupIp(ip: string): Promise<void> {
  await sql`delete from rate_limits where key like ${`%:${ip}`}`;
}
// end phase-a lane L2 ─────────────────────────────────────────────────────────

// live-fixes-3 · C ────────────────────────────────────────────────────────────
/* A cancellation within 15 minutes of booking is free (@tnajem/shared/cancellation,
   the grace runs from bookings.created_at). A test that books and cancels at once
   now lands inside it; one that means "a seat booked earlier, cancelled late" moves
   the booking back with this — its SETUP, never its assertions. */
export async function backdateBooking(bookingId: string, minutes = 60): Promise<void> {
  await sql`update bookings set created_at = now() - ${minutes} * interval '1 minute' where id = ${bookingId}`;
}
