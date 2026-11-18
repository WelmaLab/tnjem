import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ADDRESS, COMPANY_NAME, INPDP_NUMBER, LEGAL_FORM, MATRICULE_FISCAL, RNE } from "@tnajem/shared/legal";
import {
  COMPANY_IDENTITY,
  companyIdentityLine,
  companyIdentityParts,
  type CompanyIdentityInput,
} from "../../web/lib/company-identity";

/* december-sprint · D (D15) — what the footer and the home « Qui sommes-nous » show
   of the company's identity, from fixtures (no browser). An empty value is hidden
   with its label; all empty → nothing at all. The live pages (empty today) are
   e2e/ds-d-age-identity.spec.ts. */

const EMPTY: CompanyIdentityInput = { companyName: "", legalForm: "", address: "", matriculeFiscal: "", rne: "", inpdpNumber: "" };
const FILLED: CompanyIdentityInput = {
  companyName: "Société Exemple",
  legalForm: "SUARL",
  address: "1 rue Exemple, Tunis",
  matriculeFiscal: "0000000X",
  rne: "B000000",
  inpdpNumber: "INPDP-0",
};

describe("D15 · company identity", () => {
  test("today: legal.ts holds six empty values, and COMPANY_IDENTITY reads exactly them", () => {
    for (const v of [COMPANY_NAME, LEGAL_FORM, ADDRESS, MATRICULE_FISCAL, RNE, INPDP_NUMBER]) assert.equal(v, "");
    assert.deepEqual(COMPANY_IDENTITY, EMPTY);
  });

  test("all empty → no part and no line, in FR and AR (the footer renders nothing)", () => {
    for (const locale of ["fr", "ar"] as const) {
      assert.deepEqual(companyIdentityParts(EMPTY, locale), []);
      assert.equal(companyIdentityLine(EMPTY, locale), null);
      assert.equal(companyIdentityLine(COMPANY_IDENTITY, locale), null);
    }
  });

  test("blank values count as empty", () => {
    const blank = { ...EMPTY, companyName: "  ", rne: "\t" };
    assert.equal(companyIdentityLine(blank, "fr"), null);
  });

  test("all filled → the compact line, in order, with labels", () => {
    assert.equal(
      companyIdentityLine(FILLED, "fr"),
      "Tnajem — Société Exemple, SUARL · 1 rue Exemple, Tunis · MF 0000000X · RNE B000000 · INPDP INPDP-0",
    );
    assert.equal(
      companyIdentityLine(FILLED, "ar"),
      "Tnajem — Société Exemple, SUARL · 1 rue Exemple, Tunis · المعرّف الجبائي 0000000X · RNE B000000 · INPDP INPDP-0",
    );
    assert.deepEqual(companyIdentityParts(FILLED, "fr").map((p) => p.key), ["company", "address", "mf", "rne", "inpdp"]);
  });

  test("each empty value is hidden with its label", () => {
    const noMf = companyIdentityLine({ ...FILLED, matriculeFiscal: "" }, "fr")!;
    assert.ok(!noMf.includes("MF"), noMf);
    assert.equal(noMf, "Tnajem — Société Exemple, SUARL · 1 rue Exemple, Tunis · RNE B000000 · INPDP INPDP-0");
    const onlyRne = companyIdentityLine({ ...EMPTY, rne: "B000000" }, "fr");
    assert.equal(onlyRne, "Tnajem — RNE B000000");
    const noInpdp = companyIdentityParts({ ...FILLED, inpdpNumber: "" }, "ar");
    assert.ok(!noInpdp.some((p) => p.label === "INPDP"));
  });

  test("name and legal form: either one alone, no dangling comma", () => {
    assert.equal(companyIdentityLine({ ...EMPTY, companyName: "Société Exemple" }, "fr"), "Tnajem — Société Exemple");
    assert.equal(companyIdentityLine({ ...EMPTY, legalForm: "SUARL" }, "fr"), "Tnajem — SUARL");
  });

  test("values are trimmed", () => {
    assert.equal(companyIdentityLine({ ...EMPTY, address: "  Tunis  " }, "fr"), "Tnajem — Tunis");
  });
});
