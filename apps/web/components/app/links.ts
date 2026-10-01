/* espace prof v2 · shell — the public links a tutor copies and shares. One place,
   so the home card, Ma vitrine and Mes classes can never hand out different URLs.
   Locale-bare on purpose: the proxy sends each visitor to their own language. */

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://tnajem.com").replace(/\/+$/, "");

/** https://tnajem.com/<slug> — the tutor's page. */
export const pageUrl = (slug: string) => `${SITE}/${slug}`;

/** https://tnajem.com/class/<id> — one class. */
export const classUrl = (id: string) => `${SITE}/class/${id}`;

/** "tnajem.com/walid-tester" — the same link, as a person reads it. */
export const shownUrl = (url: string) => url.replace(/^https?:\/\//, "");
