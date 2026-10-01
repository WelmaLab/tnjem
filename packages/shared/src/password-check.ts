/* espace prof v2 · phase 2 — the SERVER's password policy check.

   Reached through the "@tnajem/shared/password-check" subpath and deliberately NOT
   re-exported from the barrel: it pulls in the 10k list (./common-passwords.ts,
   ~75 KB), which must never reach a client bundle. apps/api is the only importer;
   the browser gets the pure half (./password-policy.ts) for its meter.

   THE RULES, all applied to the NFKC-normalised password:
     1. at least PASSWORD_MIN_LENGTH (10) code points, at most PASSWORD_MAX_LENGTH;
     2. not one of the 10,000 most common passwords (case-insensitive);
     3. not one of them wrapped in digits or symbols — "Password2024!", "123azertyuiop".
        That is the shape most real choices take, and at 10+ characters rule 2 alone
        only ever matches 51 entries of the list, because the rest are shorter. The
        core must be 4+ characters, so a random string that happens to end in digits
        is not refused for a two-letter prefix;
     4. not a single character repeated.
   A handful of local favourites the English-language list cannot know are added
   below. Nothing else: no composition rules (NIST SP 800-63B §5.1.1.2). */
import { COMMON_PASSWORDS_10K } from "./common-passwords";
import { normalizePassword, passwordLengthProblem, type PasswordProblem } from "./password-policy";

/* French / Tunisian staples, as words people actually build passwords from. They
   only matter through rule 3 ("motdepasse2024", "Tunisie@123"). */
const LOCAL_ADDITIONS = ["motdepasse", "azerty", "azertyuiop", "tunisie", "tunis", "tnajem", "bonjour", "soleil"];

let common: Set<string> | null = null;
function commonSet(): Set<string> {
  // Built on first use: a cold API boot does not pay for a check nobody has asked for yet.
  common ??= new Set(
    [...COMMON_PASSWORDS_10K.split("\n"), ...LOCAL_ADDITIONS].map((p) => p.trim().toLowerCase()).filter(Boolean),
  );
  return common;
}

/* Digits, punctuation, symbols and spaces at either end — Unicode-aware, so an Arabic
   letter is a letter here and is never stripped as "not a word character". */
const EDGES = /^[\s\p{N}\p{P}\p{S}]+|[\s\p{N}\p{P}\p{S}]+$/gu;

export function isCommonPassword(password: string): boolean {
  const lower = normalizePassword(password).toLowerCase();
  const set = commonSet();
  if (set.has(lower)) return true;
  const core = lower.replace(EDGES, "");
  if ([...core].length >= 4 && set.has(core)) return true;
  if (new Set(lower).size === 1) return true;
  return false;
}

/** null when the password is acceptable, else the ONE reason, in priority order. */
export function passwordProblem(password: string): PasswordProblem | null {
  return passwordLengthProblem(password) ?? (isCommonPassword(password) ? "too-common" : null);
}
