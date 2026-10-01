/* Row factories. Every row is namespaced with RUN_ID so teardown deletes exactly
   what this run created and nothing else.

   NO GLOBAL TRUNCATE. This database holds real development data (14 profiles, 7
   tutors, 6 verification docs) and tools/ui-audit/routes.mjs depends on the real
   slug "yassine-math". Truncating would break `npm run ui:audit`. */
import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "./db";
import { RUN_ID } from "./env";
import { e2eStore } from "./store";
import { sealForE2E } from "./doc-crypto";

/* Uniqueness must not depend on a counter. globalSetup runs in its OWN process,
   so process.env.E2E_RUN_ID does not reach the workers, and a per-process counter
   restarts at 1 in every worker and on every rerun -- which collided on
   tutors.slug (UNIQUE). Random suffix, "e2e-" prefix preserved so teardown's
   LIKE pattern still matches exactly what the suite created. */
const tag = () => `e2e-${RUN_ID}-${randomBytes(5).toString("hex")}`;

/** RFC 2606 .invalid can never route mail — a typo here must not send a login
    code to a stranger. */
export const email = (s: string) => `${s}@tnajem.invalid`;

export type SeededProfile = { id: string; email: string; role: string };

export async function seedProfile(opts: {
  role: "student" | "tutor" | "guardian";
  birthYear?: number | null;
  /* phase-a lane L2 (A24): isAdult needs the month (0025). Defaults to January
     whenever a birth year is set, so "birthYear: 1990" still means an adult and
     "this year − 15" still means a minor; pass null for an unknown month. */
  birthMonth?: number | null;
  fullName?: string;
  phone?: string | null;
}): Promise<SeededProfile> {
  const t = tag();
  const addr = email(t);
  const birthYear = opts.birthYear === undefined ? 1990 : opts.birthYear;
  const birthMonth = opts.birthMonth !== undefined ? opts.birthMonth : birthYear == null ? null : 1; // phase-a lane L2 (A24)
  const [row] = await sql`
    insert into profiles (id, email, phone, role, locale, full_name, birth_year, birth_month)
    values (${randomUUID()}, ${addr}, ${opts.phone ?? null}, ${opts.role}, 'fr',
            ${opts.fullName ?? `E2E ${t}`},
            ${birthYear}, ${birthMonth})
    returning id, email, role`;
  return row as SeededProfile;
}

export async function seedTutor(opts: {
  profileId?: string;
  status?: "draft" | "pending" | "verified" | "rejected";
  fullName?: string;
  /* Defaults to FALSE, matching the column default and the policy: the free first
     session is opt-in per tutor. A spec that wants the free path has to say so,
     which is the point — a test fixture that silently opts in would hide exactly
     the regression free-first.spec.ts exists to catch. */
  offersFreeFirstSession?: boolean;
}): Promise<{ id: string; slug: string; profileId: string | null }> {
  const t = tag();
  const [row] = await sql`
    insert into tutors (id, profile_id, slug, full_name, subject, level, bio, status, verified,
                        offers_free_first_session)
    values (${randomUUID()}, ${opts.profileId ?? null}, ${t},
            ${opts.fullName ?? `E2E Tutor ${t}`}, 'Mathématiques', 'Bac',
            ${"Seeded by the E2E suite."}, ${opts.status ?? "verified"},
            ${(opts.status ?? "verified") === "verified"},
            ${opts.offersFreeFirstSession ?? false})
    returning id, slug, profile_id as "profileId"`;
  return row as { id: string; slug: string; profileId: string | null };
}

export async function seedClass(opts: {
  tutorId: string;
  seats?: number;
  seatsTaken?: number;
  isFreeFirst?: boolean;
  priceTnd?: number;
  hoursFromNow?: number;
  /** An exact instant, for specs that assert on the displayed time. Wins over hoursFromNow. */
  at?: Date;
}): Promise<{ id: string; title: string }> {
  const t = tag();
  const when = opts.at ?? new Date(Date.now() + (opts.hoursFromNow ?? 72) * 3600_000);
  const [row] = await sql`
    insert into classes (id, tutor_id, title, description, scheduled_at, duration_min,
                         price_tnd, seats, seats_taken, is_free_first, status)
    values (${randomUUID()}, ${opts.tutorId}, ${`E2E Class ${t}`},
            ${"Seeded by the E2E suite."}, ${when}, 90,
            ${String(opts.priceTnd ?? 40)}, ${opts.seats ?? 20},
            ${opts.seatsTaken ?? 0}, ${opts.isFreeFirst ?? true}, 'scheduled')
    returning id, title`;
  return row as { id: string; title: string };
}

export async function seedBooking(opts: {
  classId: string; studentId: string; isFree?: boolean;
  status?: "reserved" | "paid" | "attended" | "cancelled";
}): Promise<{ id: string }> {
  const [row] = await sql`
    insert into bookings (id, class_id, student_id, is_free, status)
    values (${randomUUID()}, ${opts.classId}, ${opts.studentId},
            ${opts.isFree ?? true}, ${opts.status ?? "reserved"})
    returning id`;
  return row as { id: string };
}

export async function seedConsent(minorId: string): Promise<void> {
  await sql`insert into consents (id, minor_id, guardian_name, guardian_phone, consent_text, policy_version)
            values (${randomUUID()}, ${minorId}, 'E2E Guardian', '+21620000000',
                    'Seeded by the E2E suite.', 'e2e')`;
}

/** Delete everything this run (or a named previous run) created. */
export async function purgeRun(runId: string): Promise<void> {
  const like = `e2e-${runId}-%`;
  // Order matters only where there is no ON DELETE CASCADE.
  await sql`delete from bookings  where class_id in (
              select c.id from classes c join tutors t on t.id = c.tutor_id where t.slug like ${like})`;
  await sql`delete from classes   where tutor_id in (select id from tutors where slug like ${like})`;
  await sql`delete from tutors    where slug like ${like}`;
  await sql`delete from profiles  where email like ${`e2e-${runId}-%@tnajem.invalid`}`;
}

/** Delete rows from ALL previous e2e runs. Used by globalSetup. */
export async function purgeAllRuns(): Promise<void> {
  await sql`delete from bookings where class_id in (
              select c.id from classes c join tutors t on t.id = c.tutor_id where t.slug like 'e2e-%')`;
  await sql`delete from classes  where tutor_id in (select id from tutors where slug like 'e2e-%')`;
  await sql`delete from tutors   where slug like 'e2e-%'`;
  await sql`delete from profiles where email like 'e2e-%@tnajem.invalid'`;
}

/* The admin identity. Fixed (not run-namespaced) because it must match the
   ADMIN_EMAILS value pinned in playwright.config.ts's webServer env. Teardown's
   `e2e-%@tnajem.invalid` pattern still matches it. */
export const ADMIN_EMAIL = "e2e-admin@tnajem.invalid";

export async function seedAdmin(): Promise<{ id: string }> {
  const [existing] = await sql<{ id: string }[]>`
    select id from profiles where email = ${ADMIN_EMAIL}`;
  if (existing) return existing;
  const [row] = await sql<{ id: string }[]>`
    insert into profiles (id, email, role, locale, full_name, birth_year)
    values (${randomUUID()}, ${ADMIN_EMAIL}, 'tutor', 'fr', 'E2E Admin', 1990)
    returning id`;
  return row;
}

/** A verification doc row plus the real object in the store the API reads. */
export async function seedVerificationDoc(tutorId: string): Promise<{ id: string; fileName: string }> {
  // A 1x1 PNG — must pass the doc route's SAFE_MIME check.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  const fileName = "id_front-e2e.png";
  const key = `verification/${tutorId}/${fileName}`;
  // Sealed, as every document the API writes is (packages/db/src/doc-crypto.ts).
  await e2eStore().put(key, sealForE2E(key, png));

  const [row] = await sql<{ id: string }[]>`
    insert into verification_docs (id, tutor_id, kind, file_name, storage_path, mime, size_bytes)
    values (${randomUUID()}, ${tutorId}, 'id_front', ${fileName},
            ${key}, 'image/png', ${png.length})
    returning id`;
  return { id: row.id, fileName };
}

// phase-a lane L4 (A15) ─────────────────────────────────────────────────────────
/** The Décret 2015-1619 declaration for the tutor's CURRENT round — what POST
    /verification writes. The API refuses to approve without it, so a spec that
    seeds a pending tutor and approves it has to seed this too. Call it AFTER
    setting submitted_at: the declaration is stamped with the same instant. */
export async function seedDeclaration(tutorId: string): Promise<void> {
  await sql`update tutors
               set public_teacher_declared_at = coalesce(submitted_at, now()),
                   public_teacher_declaration_version = '2026-09-15'
             where id = ${tutorId}`;
}

// espace prof v2 · auth (phase 2) ─────────────────────────────────────────────
/** Give a seeded profile a password, hashed exactly as apps/api/src/lib/password.ts
    does (argon2id, m=19456 t=2 p=1, NFKC first), so a spec can sign in with it via
    the real POST /auth/password/login or the /auth page. The hash is written, never
    the password (a CHECK refuses anything but "$argon2id$…"). */
export async function seedPassword(profileId: string, password: string): Promise<void> {
  const { default: argon2 } = await import("argon2");
  const hash = await argon2.hash(password.normalize("NFKC"), { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  await sql`update profiles set password_hash = ${hash}, password_set_at = now() where id = ${profileId}`;
}
