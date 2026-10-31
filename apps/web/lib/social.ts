/* THE FOOTER'S SOCIAL LINKS (home v2 · D — honesty rule 5).

   The mockup's footer shows Instagram, Facebook and LinkedIn icons. Tnajem only
   gets an icon for an account that EXISTS, and the proof that it exists is its URL
   in config:

     NEXT_PUBLIC_SOCIAL_INSTAGRAM   https://www.instagram.com/…
     NEXT_PUBLIC_SOCIAL_FACEBOOK    https://www.facebook.com/…
     NEXT_PUBLIC_SOCIAL_LINKEDIN    https://www.linkedin.com/company/…

   Unset, empty, not https://, carrying a user:password, or on another host than
   the network's own → no icon for that network. None valid → no icons and no
   empty list. Never `href="#"`: an icon that goes nowhere claims an account we
   do not have.

   NEXT_PUBLIC_* values are INLINED INTO THE BUNDLE AT BUILD TIME (Next replaces
   each literal `process.env.NEXT_PUBLIC_…` expression below), so a change needs a
   rebuild, not a restart. That is also why each variable is read by its full
   literal name, never through a computed key: a computed key is not inlined and
   reads undefined in the browser. */

export type SocialNetwork = "instagram" | "facebook" | "linkedin";
export type SocialLink = { network: SocialNetwork; href: string };

/** The network's own domains; a URL elsewhere is a misconfiguration, not an account. */
const HOSTS: Record<SocialNetwork, readonly string[]> = {
  instagram: ["instagram.com"],
  facebook: ["facebook.com", "fb.com"],
  linkedin: ["linkedin.com"],
};

/** The normalised https URL when `raw` is a real profile URL on `network`'s domain, else null. */
export function socialHref(network: SocialNetwork, raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (!HOSTS[network].some((d) => host === d || host.endsWith(`.${d}`))) return null;
  // A bare domain is the network's home page, not Tnajem's account.
  if (url.pathname === "/" || url.pathname === "") return null;
  return url.toString();
}

/** In display order (the mockup's): Instagram · Facebook · LinkedIn. Empty when nothing is configured. */
export const SOCIAL_LINKS: readonly SocialLink[] = (
  [
    ["instagram", process.env.NEXT_PUBLIC_SOCIAL_INSTAGRAM],
    ["facebook", process.env.NEXT_PUBLIC_SOCIAL_FACEBOOK],
    ["linkedin", process.env.NEXT_PUBLIC_SOCIAL_LINKEDIN],
  ] as const
).flatMap(([network, raw]) => {
  const href = socialHref(network, raw);
  return href ? [{ network, href }] : [];
});
