/* espace prof v2 · phase 2 — THE PASSWORD RULES, the half both sides may hold.

   PURE and small, so it is safe in the barrel (client components import it for
   the strength meter and the length hint). The other half — the list of common
   passwords — is deliberately NOT here: it is ~75 KB and has no business in a
   browser bundle. It lives behind the server-only subpath
   `@tnajem/shared/password-check`, which apps/api imports.

   THE API IS THE AUTHORITY. Everything a client does with this module is a
   courtesy: the meter is a heuristic, the length check saves a round trip. The
   server re-checks every rule (Zod, apps/api/src/lib/password.ts) and its answer
   is the one shown on the field. */

/** OWASP ASVS / NIST SP 800-63B: at least 8, and we ask 10 — no composition rules. */
export const PASSWORD_MIN_LENGTH = 10;
/** A ceiling, so a megabyte "password" cannot be used to make the server hash
    for a long time. 128 is well above any passphrase a person types. */
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordProblem = "too-short" | "too-long" | "too-common";

/* NFKC, as NIST SP 800-63B §5.1.1.2 recommends: the same password typed on two
   keyboards (a precomposed "é" vs "e" + a combining accent, full-width digits on
   some Arabic/Asian layouts) must hash to the same thing, or a person is locked
   out by their own phone. Applied before EVERY length check, list check, hash and
   verify — the server's lib/password.ts calls this, never its own copy. */
export function normalizePassword(password: string): string {
  return password.normalize("NFKC");
}

/** Length in code points (what a person counts), after normalisation. */
export function passwordLength(password: string): number {
  return [...normalizePassword(password)].length;
}

export function passwordLengthProblem(password: string): "too-short" | "too-long" | null {
  const n = passwordLength(password);
  if (n < PASSWORD_MIN_LENGTH) return "too-short";
  if (n > PASSWORD_MAX_LENGTH) return "too-long";
  return null;
}

/* ── The strength meter (UI only) ──────────────────────────────────────────────
   0 = too short · 1 = weak · 2 = fair · 3 = good · 4 = strong.

   A HEURISTIC, and it says so to nobody but the code: length dominates (that is
   what actually resists guessing), variety helps a little, and the patterns that
   fill every leaked-password list cost points — one character repeated, a run
   like 123456 or abcdef, a keyboard row, the word "password" in two languages.
   It cannot know the server's list, so a password the API refuses as too common
   can still score "fair" here; the API's refusal is then shown on the field. */
const KEYBOARD_ROWS = ["azertyuiop", "qwertyuiop", "qsdfghjklm", "asdfghjkl", "wxcvbn", "zxcvbnm", "1234567890"];
const WEAK_WORDS = ["password", "motdepasse", "azerty", "qwerty", "123456", "tnajem", "tunisie", "bonjour", "admin"];

function hasRun(s: string, len: number): boolean {
  let up = 1;
  let down = 1;
  for (let i = 1; i < s.length; i++) {
    const d = s.charCodeAt(i) - s.charCodeAt(i - 1);
    up = d === 1 ? up + 1 : 1;
    down = d === -1 ? down + 1 : 1;
    if (up >= len || down >= len) return true;
  }
  return false;
}

export function passwordStrength(password: string): 0 | 1 | 2 | 3 | 4 {
  const pw = normalizePassword(password);
  const n = [...pw].length;
  if (n < PASSWORD_MIN_LENGTH) return 0;
  const lower = pw.toLowerCase();

  let score = n >= 20 ? 4 : n >= 16 ? 3 : n >= 12 ? 2 : 1;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
  if (classes >= 3) score += 1;

  if (new Set(lower).size <= 3) score = 1;
  if (hasRun(lower, 5)) score -= 1;
  if (KEYBOARD_ROWS.some((row) => lower.includes(row.slice(0, 6)))) score -= 1;
  if (WEAK_WORDS.some((w) => lower.includes(w))) score -= 1;
  if (/^\d+$/.test(pw)) score = 1;

  return Math.max(1, Math.min(4, score)) as 1 | 2 | 3 | 4;
}
