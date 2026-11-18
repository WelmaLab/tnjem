import type { ReactNode } from "react";
import type { Metadata } from "next";
import { SiteShell } from "@/components/SiteShell";
import { bilingual } from "@/lib/i18n";
import { isLocale, DEFAULT_LOCALE } from "@/lib/locale";
import { minorsAllowed } from "@tnajem/shared";

/* Pass-through layout: it exists only to make this route REQUEST-TIME.
   The consent form reads ?next= during the server render; prerendered, it would
   ship the Suspense fallback instead of the form.
   A "use client" page cannot export `dynamic`, so the segment config lives here. */
export const dynamic = "force-dynamic";

/* december-sprint · A (D17, gate amendment 3): noindex, FOLLOW. It used to inherit
   index from [locale]/layout.tsx; robots.ts keeps it crawlable so the tag is read. */
export const metadata: Metadata = { robots: { index: false, follow: true } };

/* phase-a lane L5 (A18.1): the guardian-consent form is KEPT BEHIND ALLOW_MINORS.
   D6 — adult-only pilot. Minors come back only after Phase D (parent sign-up,
   parent-confirmed consent: Dm3). Until then this form must not collect a
   parent's details, and its informational line ("Ton parent recevra un e-mail pour
   confirmer") describes Dm3 behaviour, so it may only show once Dm3 exists.

   Read per request through the ONE switch the API and every other page use:
   minorsAllowed() (packages/shared/src/age.ts). */

const closed = bilingual({
  fr: {
    title: "Le pilote est réservé aux 18 ans et plus",
    body: "Ton compte reste ouvert, mais tu ne peux pas réserver de séance pour l'instant.",
    home: "Retour à l'accueil",
  },
  ar: {
    title: "التجربة للّي عمرهم 18 سنة وفوق برك",
    body: "حسابك يبقى محلول، أما ما تنجّمش تحجز حصة توّا.",
    home: "ارجع للرئيسية",
  },
});

export default async function Layout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  if (minorsAllowed()) return children;

  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const c = closed[locale];
  return (
    <SiteShell>
      <section className="web-section">
        <div className="container container-narrow">
          <div className="panel panel-pad rise" data-e2e="consent-closed" style={{ maxWidth: 520, marginInline: "auto" }}>
            <h1 className="web-h2" style={{ marginBottom: 12 }}>{c.title}</h1>
            <p className="web-lead" style={{ marginBottom: 22 }}>{c.body}</p>
            <a href={`/${locale}`} className="btn btn-ghost btn-sm">{c.home}</a>
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
