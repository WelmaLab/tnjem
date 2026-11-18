/* december-sprint · B (D13) — first-party attribution for the centre lead form.
   PURE (no React, no DOM access of its own), so the e2e spec can test it directly.
   The form keeps what attributionFrom() returns in sessionStorage under STORE_KEY
   until the lead is sent. The referrer is kept as origin + path only (a query string
   can carry anything), and only when it is another site. */
import { CENTRE_LEAD_LIMITS as LIM } from "@tnajem/shared";

export const STORE_KEY = "tnajem.centre-lead.attribution";
export type Attribution = { utmSource?: string; utmMedium?: string; utmCampaign?: string; referrer?: string };

function cut(v: string | null | undefined, max: number): string | undefined {
  const s = (v ?? "").trim();
  return s ? s.slice(0, max) : undefined;
}

/** What this landing says, or null when it says nothing worth keeping. Exported for the spec. */
export function attributionFrom(search: string, referrer: string, ownOrigin: string): Attribution | null {
  const q = new URLSearchParams(search);
  let ref: string | undefined;
  try {
    const u = referrer ? new URL(referrer) : null;
    if (u && u.origin !== ownOrigin) ref = cut(`${u.origin}${u.pathname}`, LIM.referrer);
  } catch {
    ref = undefined;
  }
  const a: Attribution = {
    utmSource: cut(q.get("utm_source"), LIM.utm),
    utmMedium: cut(q.get("utm_medium"), LIM.utm),
    utmCampaign: cut(q.get("utm_campaign"), LIM.utm),
    referrer: ref,
  };
  return Object.values(a).some(Boolean) ? a : null;
}

