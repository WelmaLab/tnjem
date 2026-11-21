import { normalizeEmail, isValidEmail } from "./validation";

/* WHO IS AN ADMIN — not decided here any more (security audit VULN-006).

   This module used to hold THE admin allowlist: ADMIN_EMAILS under e-mail sign-in,
   ADMIN_PHONES under OTP_CHANNEL=sms, matched against profiles.email /
   profiles.phone. profiles.phone is a field the user types on their own profile,
   so under sms anyone could make themselves an admin by typing the admin's number.

   Admin is now a DATABASE fact: profiles.admin_granted_at (0046), set and cleared
   only by the operator CLI (`npm run admin:grant` / `admin:revoke`,
   packages/db/bin/admin.ts). apps/api/src/lib/admin.ts::requireAdmin and GET /me
   read that column and nothing else. No environment variable grants anything:
   adminAuthIdentities() and isAllowlistedAdmin() are gone, and must not come back
   in another shape — an authorization decision taken from a user-editable field
   is exactly the bug. */

/* Who to EMAIL when something needs review. NOTIFICATION ONLY: being on this list
   gives no access to anything. It keeps the trim/drop-empties/validate discipline:
   an empty entry is dropped before normalising, an invalid one is discarded. */
export function adminNotifyEmails(env: NodeJS.ProcessEnv): string[] {
  return (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => normalizeEmail(s))
    .filter((e) => isValidEmail(e));
}
