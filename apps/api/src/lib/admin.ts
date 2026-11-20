import type { FastifyRequest } from "fastify";
import { getSession, type Session } from "./session";

/* The API's admin gate.

   ADMIN IS A DATABASE FACT (security audit VULN-006): profiles.admin_granted_at,
   set and cleared only by the operator CLI (`npm run admin:grant` /
   `admin:revoke`, packages/db/bin/admin.ts). The session reloads the profile row
   on every request, so a revoke — or a block, which ends the session — takes
   effect on the very next call.

   It used to be an env allow-list (ADMIN_EMAILS, or ADMIN_PHONES under
   OTP_CHANNEL=sms) matched against profiles.email / profiles.phone. The phone is a
   field the user types on their own profile, so under sms typing the admin's
   number made you an admin. No environment variable is consulted here any more,
   and none may be: an authorization decision must never read a value the user can
   write. ADMIN_EMAILS survives only as the list of addresses to NOTIFY. */

/** Is this session's profile an admin? The one rule — GET /me and the accounts page ask it too. */
export function isAdminProfile(profile: { adminGrantedAt: Date | string | null }): boolean {
  return profile.adminGrantedAt != null;
}

export async function requireAdmin(req: FastifyRequest): Promise<Session | null> {
  const session = await getSession(req);
  if (!session) return null;
  return isAdminProfile(session.profile) ? session : null; // fail closed
}
