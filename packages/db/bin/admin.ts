/* npm run admin:grant  -- <email | profile id>
   npm run admin:revoke -- <email | profile id>
   npm run admin:list

   THE way an account becomes an admin (security audit VULN-006). Admin is
   profiles.admin_granted_at (0046): apps/api/src/lib/admin.ts::requireAdmin reads
   that column and nothing else. It used to be the ADMIN_EMAILS / ADMIN_PHONES env
   allow-list matched against profiles.email / profiles.phone — and the phone is a
   field the user types, so under OTP_CHANNEL=sms typing the admin's number made
   you an admin. No env variable grants anything now; ADMIN_EMAILS only says who is
   e-mailed when a verification arrives.

   Run on the server, by the operator, against the database in .env (DATABASE_URL).
   The account must exist first: sign up on the site, then grant it here. The
   change takes effect on the account's next request (the session reloads the
   profile row every time).

   Every grant and revoke writes an admin_actions row in the same transaction
   (admin_profile_id NULL = the operator CLI, like the retention job's erasures):
   no audit row, no change. Setting the state the account already has writes
   nothing and says so.

   Prints the profile id and role only — never an e-mail address or a phone number,
   so the output can be pasted into a ticket. Exits 1 on any refusal. */
import { loadEnv } from "./_paths";
loadEnv();

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { adminActions, profiles } from "../src/schema";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function usage(): never {
  console.error(
    "Usage:\n" +
      "  npm run admin:grant  -- <email | profile id>\n" +
      "  npm run admin:revoke -- <email | profile id>\n" +
      "  npm run admin:list",
  );
  process.exit(2);
}

async function main() {
  const [command, rawTarget] = process.argv.slice(2);
  if (command !== "grant" && command !== "revoke" && command !== "list") usage();

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = postgres(url, { max: 1, onnotice: () => {} });
  const db = drizzle(client);

  try {
    if (command === "list") {
      const rows = await db
        .select({ id: profiles.id, role: profiles.role, since: profiles.adminGrantedAt })
        .from(profiles)
        .where(isNotNull(profiles.adminGrantedAt))
        .orderBy(asc(profiles.adminGrantedAt));
      if (rows.length === 0) console.log("No admin account. Grant one: npm run admin:grant -- <email | profile id>");
      for (const r of rows) console.log(`  ${r.id}  ${r.role}  since ${r.since?.toISOString()}`);
      return 0;
    }

    const target = (rawTarget ?? "").trim();
    if (!target) usage();
    /* An e-mail is matched the way sign-in stores it (normalizeEmail lower-cases). */
    const where = UUID.test(target) ? eq(profiles.id, target.toLowerCase()) : eq(profiles.email, target.toLowerCase());
    const [p] = await db
      .select({ id: profiles.id, role: profiles.role, purgedAt: profiles.purgedAt, blockedAt: profiles.blockedAt, since: profiles.adminGrantedAt })
      .from(profiles)
      .where(where)
      .limit(1);
    if (!p) {
      console.error("✗ No account matches. Sign up on the site first, then run this again.");
      return 1;
    }

    if (command === "grant") {
      if (p.purgedAt) {
        console.error(`✗ Profile ${p.id} is an erased account: it cannot be an admin.`);
        return 1;
      }
      if (p.since) {
        console.log(`· Profile ${p.id} (${p.role}) is already an admin, since ${p.since.toISOString()}. Nothing changed.`);
        return 0;
      }
      await db.transaction(async (tx) => {
        await tx.update(profiles).set({ adminGrantedAt: new Date() }).where(and(eq(profiles.id, p.id), isNull(profiles.adminGrantedAt)));
        await tx.insert(adminActions).values({ adminProfileId: null, action: "admin.grant", subjectKind: "profile", subjectId: p.id, note: "operator CLI" });
      });
      console.log(`✓ Profile ${p.id} (${p.role}) is now an admin.`);
      if (p.blockedAt) console.log("  ! This account is BLOCKED: it cannot sign in until it is unblocked.");
      return 0;
    }

    // revoke
    if (!p.since) {
      console.log(`· Profile ${p.id} (${p.role}) is not an admin. Nothing changed.`);
      return 0;
    }
    await db.transaction(async (tx) => {
      await tx.update(profiles).set({ adminGrantedAt: null }).where(eq(profiles.id, p.id));
      await tx.insert(adminActions).values({ adminProfileId: null, action: "admin.revoke", subjectKind: "profile", subjectId: p.id, note: "operator CLI" });
    });
    console.log(`✓ Profile ${p.id} (${p.role}) is no longer an admin (from its next request).`);
    return 0;
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    /* Name and code only: a driver message can carry connection details or the value searched for. */
    console.error(`✗ admin: ${(e as Error)?.name ?? typeof e} ${(e as { code?: string }).code ?? ""}`.trim());
    process.exit(1);
  },
);
