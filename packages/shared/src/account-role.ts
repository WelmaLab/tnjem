/* THE ROLE NAME ON /account — Phase A · A18.13 (lane L5).

   The page read "Rôle : Je suis prof": it reused the SIGN-UP BUTTON text as the
   name of a role, and showed "Je suis élève / parent" to a parent and to an admin.
   One rule picks the role to name; the page owns the words (FR + Derija).
   An admin is profiles.admin_granted_at (VULN-006), not a user role, so the API
   says so in GET /me (`isAdmin`). Pure module. */

export type AccountRole = "student" | "tutor" | "guardian" | "admin";

export function accountRole(me: { role: string; isAdmin?: boolean | null }): AccountRole {
  if (me.isAdmin) return "admin";
  if (me.role === "tutor" || me.role === "guardian") return me.role;
  return "student";
}
