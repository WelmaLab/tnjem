import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  displayName, displaySubject, editableSubject, formatPhone, publicDisplayName, publicInitials, publicTutorName, subjectToSave,
} from "@tnajem/shared";

/* live-fixes-1 · C2 — values shaped FOR DISPLAY (packages/shared/src/display.ts):
   a capitalised name, the subject's label instead of its code, a grouped Tunisian
   phone. Pure functions; what is stored never changes. */

describe("displayName", () => {
  test("capitalises the first letter of each word, keeps the rest as typed", () => {
    assert.equal(displayName("walid T."), "Walid T.");
    assert.equal(displayName("walid tester"), "Walid Tester");
    assert.equal(displayName("ben ali"), "Ben Ali");
    assert.equal(displayName("jean-pierre o'neil"), "Jean-Pierre O'Neil");
    assert.equal(displayName("McLeod"), "McLeod", "an inner capital stays");
    assert.equal(displayName("AMINE"), "AMINE", "never lower-cased");
    assert.equal(displayName("élodie"), "Élodie", "accented initial");
  });
  test("Arabic has no case; spaces collapse; blank is empty", () => {
    assert.equal(displayName("ليلى بن عمر"), "ليلى بن عمر");
    assert.equal(displayName("  walid   tester "), "Walid Tester");
    assert.equal(displayName(""), "");
    assert.equal(displayName(null), "");
    assert.equal(displayName(undefined), "");
  });
});

describe("the counterparty names are capitalised at the root", () => {
  test("publicDisplayName / publicTutorName / publicInitials", () => {
    assert.equal(publicDisplayName("walid tester"), "Walid");
    assert.equal(publicTutorName("walid tester"), "Walid T.");
    assert.equal(publicTutorName("walid T."), "Walid T.", "idempotent on an already-masked name");
    assert.equal(publicTutorName("mohamed", "ben ali"), "Mohamed B.");
    assert.equal(publicInitials("walid tester"), "WA");
    // The existing rules still hold: digits stripped, a number never passes.
    assert.equal(publicDisplayName("amine98123456"), "Amine");
    assert.equal(publicDisplayName("+21698123456 amine"), null);
  });
});

describe("formatPhone", () => {
  test("a Tunisian number, grouped 2 · 3 · 3 after +216", () => {
    assert.equal(formatPhone("+21656561226"), "+216 56 561 226");
    assert.equal(formatPhone("0021656561226"), "+216 56 561 226");
    assert.equal(formatPhone("21656561226"), "+216 56 561 226");
    assert.equal(formatPhone("56561226"), "+216 56 561 226");
    assert.equal(formatPhone("+216 56 561 226"), "+216 56 561 226", "idempotent");
    assert.equal(formatPhone("56.561.226"), "+216 56 561 226");
  });
  test("anything else is shown as stored", () => {
    assert.equal(formatPhone("+33612345678"), "+33612345678");
    assert.equal(formatPhone("5656"), "5656");
    assert.equal(formatPhone(" +2165656 "), "+2165656");
    assert.equal(formatPhone(null), "");
    assert.equal(formatPhone(""), "");
  });
});

describe("displaySubject", () => {
  test("a stored code becomes its label, in the reader's language (any case)", () => {
    assert.equal(displaySubject("math", "fr"), "Maths");
    assert.equal(displaySubject("math", "ar"), "رياضيات");
    assert.equal(displaySubject("Math", "fr"), "Maths");
    assert.equal(displaySubject("physique", "ar"), "فيزياء");
    assert.equal(displaySubject("histoire-geo", "fr"), "Histoire-Géo");
  });
  test("free text is shown as typed, with a capital first letter", () => {
    assert.equal(displaySubject("Mathématiques", "fr"), "Mathématiques");
    assert.equal(displaySubject("physique-chimie", "fr"), "Physique-chimie");
    assert.equal(displaySubject("رياضيات وفيزياء", "ar"), "رياضيات وفيزياء");
    assert.equal(displaySubject("", "fr"), "");
    assert.equal(displaySubject(null, "fr"), "");
  });
});

describe("the subject in an edit field (/onboarding, Réglages › Vitrine)", () => {
  test("a stored code shows as its label; free text exactly as typed", () => {
    assert.equal(editableSubject("math", "fr"), "Maths");
    assert.equal(editableSubject("math", "ar"), "رياضيات");
    assert.equal(editableSubject("Math", "fr"), "Maths");
    assert.equal(editableSubject("physique-chimie", "fr"), "physique-chimie", "not even a capital added");
    assert.equal(editableSubject("Mathématiques", "ar"), "Mathématiques");
    assert.equal(editableSubject(null, "fr"), "");
  });
  test("saved untouched, the ORIGINAL stored value goes back; edited, what was typed", () => {
    assert.equal(subjectToSave("Maths", "math", "fr"), "math");
    assert.equal(subjectToSave("رياضيات", "math", "ar"), "math");
    assert.equal(subjectToSave(" Maths ", "math", "fr"), "math");
    assert.equal(subjectToSave("Physique", "math", "fr"), "Physique");
    assert.equal(subjectToSave("Maths — Bac", "math", "fr"), "Maths — Bac");
    assert.equal(subjectToSave("physique-chimie", "physique-chimie", "fr"), "physique-chimie");
    assert.equal(subjectToSave("Maths", "", "fr"), "Maths", "no page yet: what was typed");
    assert.equal(subjectToSave("", "math", "fr"), "", "emptied: the API's « invalid-subject » decides");
  });
});
