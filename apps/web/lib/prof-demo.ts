/* THE DEMO BUTTON OF /pour-les-profs (profs-v2 — honesty rule 3).

   « Voir la démo (2 min) » only exists once a demo video exists, and the proof that
   it exists is its URL in config:

     NEXT_PUBLIC_PROF_DEMO_URL   https://…

   Unset, empty, not https://, or carrying a user:password → no demo button, and the
   hero keeps « Voir les profs sur Tnajem ». Never `href="#"`: a button that goes
   nowhere claims a demo we do not have.

   NEXT_PUBLIC_* values are INLINED INTO THE BUNDLE AT BUILD TIME (Next replaces the
   literal `process.env.NEXT_PUBLIC_PROF_DEMO_URL` below), so a change needs a rebuild,
   not a restart, and the variable is read by its full literal name: a computed key
   is not inlined and reads undefined in the browser. */

/** The normalised https URL when `raw` is a usable link, else null. */
export function profDemoHref(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  return url.toString();
}

export const PROF_DEMO_URL: string | null = profDemoHref(process.env.NEXT_PUBLIC_PROF_DEMO_URL);
