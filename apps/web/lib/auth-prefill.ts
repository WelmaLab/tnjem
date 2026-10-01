/* espace prof v2 · auth (phase 2) — handing an address from a signup page to /auth.

   « Tu as déjà un compte — connecte-toi. » sends the visitor to /auth with the
   address already typed. The address travels in sessionStorage, NOT in the URL: a
   query string lands in proxy access logs, browser history and the Referer of the
   next request, and this codebase keeps addresses out of all three. One read, then
   gone; ten minutes at most. Storage can be missing or throw (private windows,
   blocked site data) — then the field is simply empty and the notice still shows. */
const KEY = "tnajem:auth-prefill";
const MAX_AGE_MS = 10 * 60_000;

export function stashAuthPrefill(identifier: string): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ id: identifier.slice(0, 320), at: Date.now() }));
  } catch {
    /* no storage: /auth opens with an empty field */
  }
}

export function takeAuthPrefill(): string | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { id?: unknown; at?: unknown };
    if (typeof v.id !== "string" || typeof v.at !== "number" || Date.now() - v.at > MAX_AGE_MS) return null;
    return v.id;
  } catch {
    return null;
  }
}
