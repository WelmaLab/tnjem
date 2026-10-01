/* /auth - SERVER shell.

   ?next= is read here rather than with the client search-params hook. That hook
   forced the entire login form into a <Suspense> boundary, and Next bails such a
   boundary to client-only rendering on a statically-rendered route: the shipped
   HTML for /fr/auth had no <h1>, no phone field and no submit button at all - a
   blank login page for the whole JS window on 3G, and permanently blank if the
   bundle failed. Verified by tools/ui-audit/nojs.mjs.

   Reading searchParams makes this route dynamic, which is correct: its content
   genuinely depends on the query string, and a login page is never cacheable.
   The OTP CHANNEL is resolved here too. otpChannel() is server-only, and reading
   it on the server keeps OTP_CHANNEL a runtime env var — a NEXT_PUBLIC_ value
   would be baked in at build time, so reverting to SMS would mean a rebuild
   rather than a restart. */
import type { Metadata } from "next";
import { AuthInner } from "@/components/auth/AuthInner";
import { safeNext } from "@tnajem/shared";
import { minorsAllowed } from "@tnajem/shared"; // phase-a lane L2 (A24)
import { otpChannel } from "@/lib/auth";
import { bilingual } from "@/lib/i18n";
import { isLocale, DEFAULT_LOCALE } from "@/lib/locale";
import { pageMetadata } from "@/lib/metadata";

/* REQUEST-TIME ONLY. The OTP channel is a runtime environment switch and ?next=
   differs per visitor; prerendered, both would be frozen at build. It used to be
   dynamic only by accident (app/[locale]/not-found.tsx called headers()). */
export const dynamic = "force-dynamic";

/* No channel in the description: OTP_CHANNEL is a runtime switch (email today),
   and a search snippet cannot follow it. "A one-time code" is true either way. */
const meta = bilingual({
  fr: {
    title: "Se connecter",
    description: "Connecte-toi à Tnajem avec ton mot de passe ou un code à usage unique.",
  },
  ar: {
    title: "تسجيل الدخول",
    description: "ادخل لـ Tnajem بكلمة السرّ متاعك ولا بكود يتستعمل مرّة وحدة.",
  },
});

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const params = await props.params;
  const locale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  return pageMetadata({ locale, path: "/auth", ...meta[locale] });
}

export default async function AuthPage(props: { searchParams: Promise<{ next?: string | string[]; existing?: string | string[] }> }) {
  const searchParams = await props.searchParams;
  const raw = Array.isArray(searchParams.next) ? searchParams.next[0] : searchParams.next;
  // phase-a lane L2 (A24): ALLOW_MINORS, per request, on the server (never a build-time value).
  /* espace prof v2 · auth: ?existing=1 — a signup page found an account for the address
     (« Tu as déjà un compte — connecte-toi. »). A flag only: the address itself is
     handed over in sessionStorage (lib/auth-prefill.ts), never in the URL. */
  const existing = (Array.isArray(searchParams.existing) ? searchParams.existing[0] : searchParams.existing) === "1";
  return <AuthInner next={safeNext(raw ?? null)} channel={otpChannel()} minorsAllowed={minorsAllowed()} existingAccount={existing} />;
}
