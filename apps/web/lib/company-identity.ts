/* december-sprint · D (D15) — THE COMPANY'S IDENTITY, as the footer and the home
   page's « Qui sommes-nous » show it.

   The six values live in packages/shared/src/legal.ts (COMPANY_NAME, LEGAL_FORM,
   ADDRESS, MATRICULE_FISCAL, RNE, INPDP_NUMBER), each with a LEGAL-REVIEW marker,
   and are EMPTY until the founder gives them. This module only decides what is
   shown: an empty (or blank) value is left out WITH its label — never a
   placeholder, never « — » — and when every value is empty there is nothing at
   all (companyIdentityParts → [], companyIdentityLine → null), so the surfaces
   render no element.

   Pure: no React, no environment. apps/api/test/ds-d-company-identity.test.ts runs
   it with filled and empty inputs. /terms and /privacy do NOT use it: they keep
   their own bracketed placeholders (R6). */
import { ADDRESS, COMPANY_NAME, INPDP_NUMBER, LEGAL_FORM, MATRICULE_FISCAL, RNE } from "@tnajem/shared/legal";

export type IdentityLocale = "fr" | "ar";

export type CompanyIdentityInput = {
  companyName: string;
  legalForm: string;
  address: string;
  matriculeFiscal: string;
  rne: string;
  inpdpNumber: string;
};

export type IdentityKey = "company" | "address" | "mf" | "rne" | "inpdp";

/** One shown value. `label` is null for the company name and the address, which read without one. */
export type IdentityPart = { key: IdentityKey; label: string | null; value: string };

/** Today's values, from legal.ts. */
export const COMPANY_IDENTITY: CompanyIdentityInput = {
  companyName: COMPANY_NAME,
  legalForm: LEGAL_FORM,
  address: ADDRESS,
  matriculeFiscal: MATRICULE_FISCAL,
  rne: RNE,
  inpdpNumber: INPDP_NUMBER,
};

/* The labels. « MF », « RNE » and « INPDP » are how these numbers are written in
   Tunisia; the Arabic spells out the tax number as /terms and /privacy do
   (« المعرّف الجبائي ») and keeps the two acronyms. */
export const IDENTITY_LABELS: Record<IdentityLocale, Record<"mf" | "rne" | "inpdp", string>> = {
  fr: { mf: "MF", rne: "RNE", inpdp: "INPDP" },
  ar: { mf: "المعرّف الجبائي", rne: "RNE", inpdp: "INPDP" },
};

/** The filled values, in reading order. Empty or blank values are left out. */
export function companyIdentityParts(input: CompanyIdentityInput, locale: IdentityLocale): IdentityPart[] {
  const v = (s: string | null | undefined) => (s ?? "").trim();
  const L = IDENTITY_LABELS[locale];
  const parts: IdentityPart[] = [];
  // « <COMPANY_NAME>, <LEGAL_FORM> » — either one alone when the other is missing.
  const company = [v(input.companyName), v(input.legalForm)].filter(Boolean).join(", ");
  if (company) parts.push({ key: "company", label: null, value: company });
  if (v(input.address)) parts.push({ key: "address", label: null, value: v(input.address) });
  if (v(input.matriculeFiscal)) parts.push({ key: "mf", label: L.mf, value: v(input.matriculeFiscal) });
  if (v(input.rne)) parts.push({ key: "rne", label: L.rne, value: v(input.rne) });
  if (v(input.inpdpNumber)) parts.push({ key: "inpdp", label: L.inpdp, value: v(input.inpdpNumber) });
  return parts;
}

/** « MF 1234567A » — a part as it reads in a line. */
export function identityPartText(p: IdentityPart): string {
  return p.label ? `${p.label} ${p.value}` : p.value;
}

/** The footer's compact line: « Tnajem — <name>, <form> · <address> · MF … · RNE … · INPDP … ».
    null when every value is empty: the footer then renders nothing for it. */
export function companyIdentityLine(input: CompanyIdentityInput, locale: IdentityLocale): string | null {
  const parts = companyIdentityParts(input, locale);
  if (parts.length === 0) return null;
  return `Tnajem — ${parts.map(identityPartText).join(" · ")}`;
}
