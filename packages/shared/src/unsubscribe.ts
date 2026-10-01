/* ONE-CLICK UNSUBSCRIBE — Espace prof v2 · Phase 4 · contract C5.
   SERVER-ONLY (node:crypto), reached through the "@tnajem/shared/unsubscribe"
   subpath and never the barrel, exactly like ./auth-core and ./mail.

   Every e-mail Tnajem sends that is not a login code carries a link that turns
   its kind off with one click, and the RFC 8058 headers that let a mail client do
   the same from its own "Unsubscribe" button:

     List-Unsubscribe:      <https://tnajem.com/api/email/unsubscribe?token=…>
     List-Unsubscribe-Post: List-Unsubscribe=One-Click

   THE TOKEN IS SIGNED, NOT STORED. v1.<profileId>.<kind>.<sig>, where sig is an
   HMAC-SHA256 under AUTH_SECRET: no table, nothing to expire or to leak from a
   backup, and it can only ever switch OFF one kind for one profile — the worst a
   forwarded e-mail can do is unsubscribe its own recipient. It never logs in
   anyone. It is still a capability, so it travels as `token` (redacted in logs and
   error reports) and in a query string (logged path-only).

   The link points at the WEB app (one public origin), whose route handler shows a
   confirm button on GET — a mail scanner prefetching links must not unsubscribe
   anyone — and unsubscribes on POST, the one-click a mail client sends. */
import { createHmac, timingSafeEqual } from "node:crypto";
import { authSecret } from "./auth-core";
import { isEmailPrefKind, type EmailPrefKind } from "./email-prefs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function sign(profileId: string, kind: EmailPrefKind): string {
  return createHmac("sha256", authSecret())
    .update(`tnajem:unsubscribe:v1:${profileId}:${kind}`)
    .digest("base64url")
    .slice(0, 32);
}

export function unsubscribeToken(profileId: string, kind: EmailPrefKind): string {
  const id = profileId.toLowerCase();
  return `v1.${id}.${kind}.${sign(id, kind)}`;
}

/** The profile and kind a token switches off, or null if it is not one we signed. */
export function verifyUnsubscribeToken(token: unknown): { profileId: string; kind: EmailPrefKind } | null {
  if (typeof token !== "string" || token.length > 120) return null;
  const parts = token.trim().split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  const [, profileId, kind, sig] = parts;
  if (!UUID_RE.test(profileId) || !isEmailPrefKind(kind)) return null;
  const expected = Buffer.from(sign(profileId, kind));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return { profileId, kind };
}

/** The public site origin every e-mail links to (the same fallback as the web's SITE_URL). */
export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://tnajem.com").replace(/\/+$/, "");
}

/** The link printed in the e-mail footer and named by List-Unsubscribe. */
export function unsubscribeUrl(profileId: string, kind: EmailPrefKind): string {
  return `${siteUrl()}/api/email/unsubscribe?token=${encodeURIComponent(unsubscribeToken(profileId, kind))}`;
}

/** RFC 2369 + RFC 8058 headers, for sendMail's `headers` option. */
export function listUnsubscribeHeaders(profileId: string, kind: EmailPrefKind): Record<string, string> {
  return {
    "List-Unsubscribe": `<${unsubscribeUrl(profileId, kind)}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
