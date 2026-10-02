/* HOW STORED VALUES ARE SHOWN — live-fixes-1 · C2. Pure, client-safe, safe in the barrel.

   Three values reached the screen exactly as typed or stored: a name in lower case
   (« walid T. »), the subject's CODE (« math » in the preview header), a phone as
   E.164 digits (« +21656561226 »). These functions shape them FOR DISPLAY ONLY —
   nothing here is ever written back: the stored value stays what the person typed,
   and every comparison, search or check keeps using it. */
import type { Locale } from "./types";
import { SUBJECT_LABELS, isSubjectCode } from "./subjects";

/** « walid T. » → « Walid T. », « ben ali » → « Ben Ali », « jean-pierre » → « Jean-Pierre ».
    The first letter of each word (and after a hyphen or an apostrophe) in capitals; the
    rest exactly as typed — « McLeod » and « AMINE » are left alone. Arabic has no case
    and is returned unchanged. Spaces are collapsed. Null/blank → "". */
export function displayName(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/(^|[\s\-'’])(\p{Ll})/gu, (_m, sep: string, ch: string) => sep + ch.toLocaleUpperCase("fr"));
}

/** A Tunisian number, grouped the way it is said: « +216 56 561 226 ».
    Accepts the stored E.164 form and the usual hand-typed ones (00216…, 216…, the bare
    8 digits, with spaces, dots or dashes). Anything else — a foreign number, a partial
    one — is returned as stored (trimmed): better shown as typed than mis-grouped. */
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const s = raw.trim();
  const compact = s.replace(/[\s.\-()]/g, "");
  const m = /^(?:\+|00)?216(\d{8})$/.exec(compact) ?? /^(\d{8})$/.exec(compact);
  if (!m) return s;
  const d = m[1];
  return `+216 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}`;
}

/** The tutor's subject as a reader sees it: a stored CODE (any case — « math », « Math »)
    becomes its label in the page's language (« Maths » / « رياضيات »); free text the tutor
    typed is shown as typed, with a capital first letter (« physique-chimie » →
    « Physique-chimie »). Builds on subjectLabel's table (./subjects.ts). */
export function displaySubject(raw: string | null | undefined, locale: Locale): string {
  if (!raw) return "";
  const v = raw.trim();
  const code = v.toLowerCase();
  if (isSubjectCode(code)) return SUBJECT_LABELS[code][locale];
  return v.replace(/^\p{Ll}/u, (ch) => ch.toLocaleUpperCase("fr"));
}

/** The subject in an EDIT field (/onboarding, Réglages › Vitrine): a stored code shows as
    its label (« Maths », never « math »); free text exactly as the tutor typed it — an
    editor must not rewrite their words, not even a first letter. */
export function editableSubject(stored: string | null | undefined, locale: Locale): string {
  if (!stored) return "";
  const code = stored.trim().toLowerCase();
  return isSubjectCode(code) ? SUBJECT_LABELS[code][locale] : stored;
}

/** What an editor sends back for the subject. The field untouched — still the label it was
    shown with — sends the ORIGINAL stored value, so a code stays a code and is never
    re-stored as a French or Arabic label; anything else is what the tutor typed, exactly,
    for POST /tutors to validate as before. */
export function subjectToSave(field: string, stored: string | null | undefined, locale: Locale): string {
  if (stored && field.trim() === editableSubject(stored, locale).trim()) return stored;
  return field;
}
