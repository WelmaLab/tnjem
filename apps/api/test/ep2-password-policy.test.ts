import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  normalizePassword,
  passwordLength,
  passwordStrength,
} from "@tnajem/shared";
import { isCommonPassword, passwordProblem } from "@tnajem/shared/password-check";
import { COMMON_PASSWORDS_10K } from "../../../packages/shared/src/common-passwords";

/* espace prof v2 · phase 2 — THE PASSWORD POLICY, as the API applies it.
   (Unit tests: no database, no server. The routes are in ep2-passwords.test.ts.) */

const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("ep2 · policy: at least 10 characters", () => {
  test("9 is refused, 10 is enough", () => {
    assert.equal(PASSWORD_MIN_LENGTH, 10);
    assert.equal(passwordProblem("kq7#vm2!x"), "too-short", "9 characters");
    assert.equal(passwordProblem("kq7#vm2!xz"), null, "10 characters, not common");
  });

  test("length is counted in characters a person sees, after NFKC", () => {
    // 10 Arabic letters are 10, not 20 bytes' worth; a decomposed "é" is one character.
    assert.equal(passwordLength("كلمةسرّطويلة"), [..."كلمةسرّطويلة".normalize("NFKC")].length);
    assert.equal(normalizePassword("é"), "é", "NFKC composes the accent");
    assert.equal(passwordLength("café-garden"), passwordLength("café-garden"));
    assert.equal(passwordProblem("شمس تونس الجميلة"), null, "an Arabic passphrase is accepted");
  });

  test("a ceiling, so nobody can make the server hash a megabyte", () => {
    assert.equal(passwordProblem("x9".repeat(PASSWORD_MAX_LENGTH / 2) + "!"), "too-long");
    assert.equal(passwordProblem("x9#".repeat(40)), null, "120 characters is fine");
  });
});

describe("ep2 · policy: the 10,000 most common passwords are refused", () => {
  test("the list is the full SecLists file, one entry per line", () => {
    const entries = COMMON_PASSWORDS_10K.split("\n").filter(Boolean);
    assert.equal(entries.length, 10_001);
    assert.equal(entries[0], "password");
    assert.ok(entries.includes("pic\\'s"), "the one entry with a backslash survived the template literal");
  });

  test("an entry of 10+ characters is refused, whatever its case", () => {
    for (const pw of ["1234567890", "qwertyuiop", "QwertyUiop", "basketball", "1q2w3e4r5t"]) {
      assert.equal(passwordProblem(pw), "too-common", pw);
    }
  });

  test("…and so is a listed password wrapped in digits or symbols", () => {
    for (const pw of ["password2024!", "Password123456", "2024!dragon2024", "football_1990", "Azertyuiop12", "motdepasse2026", "Tunisie@1234"]) {
      assert.equal(isCommonPassword(pw), true, pw);
      assert.equal(passwordProblem(pw), "too-common", pw);
    }
  });

  test("one character repeated is refused", () => {
    assert.equal(passwordProblem("aaaaaaaaaaaa"), "too-common");
    assert.equal(passwordProblem("############"), "too-common");
  });

  test("an ordinary long passphrase is accepted", () => {
    for (const pw of ["correct-horse-staple-tunis", "Le soleil de Sousse 2026", "kq7#vm2!xz", "ma-prof-de-maths-est-top"]) {
      assert.equal(passwordProblem(pw), null, pw);
    }
  });
});

describe("ep2 · the list never reaches a browser", () => {
  test("the barrel exports the pure policy only — never the list or the checker", () => {
    const barrel = src("../../../packages/shared/src/index.ts");
    assert.match(barrel, /export \* from "\.\/password-policy"/);
    const reexports = barrel.split("\n").filter((l) => /^\s*export\b.*\bfrom\b/.test(l)).join("\n");
    assert.doesNotMatch(reexports, /common-passwords|password-check/, "the barrel must not pull the 75 KB list into client bundles");
    const policy = src("../../../packages/shared/src/password-policy.ts");
    assert.doesNotMatch(policy, /from "\.\/common-passwords"|from "\.\/password-check"/, "the client half imports no list");
  });

  test("no apps/web module imports the server-only checker", () => {
    for (const file of ["components/auth/PasswordField.tsx", "components/settings/SecurityPanel.tsx", "app/actions-auth.ts"]) {
      const text = src(`../../web/${file}`);
      assert.doesNotMatch(text, /password-check|common-passwords/, file);
    }
  });
});

describe("ep2 · the strength meter is a heuristic, and an honest one", () => {
  test("too short scores 0; obvious patterns stay weak; a long mixed passphrase scores high", () => {
    assert.equal(passwordStrength("short"), 0);
    assert.equal(passwordStrength("1234567890"), 1, "digits only");
    assert.equal(passwordStrength("aaaaaaaaaaaa"), 1, "one character");
    assert.ok(passwordStrength("azertyuiop12") <= 2, "a keyboard row");
    assert.ok(passwordStrength("Le soleil de Sousse 2026!") >= 3);
  });
});
