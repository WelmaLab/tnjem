"use client";
import { useEffect, useState } from "react";
import { getMe } from "@/app/actions";
import { LocaleToggle } from "@/components/LocaleToggle";
import { useLocale } from "@/components/LocaleProvider";
import { Phone, User, Forward } from "@/components/icons";
import { SiteShell } from "@/components/SiteShell";
import { DeleteAccount } from "@/components/account/DeleteAccount";
import { SecurityPanel } from "@/components/settings/SecurityPanel"; // espace prof v2 · auth (C8)
import { UserText } from "@/components/UserText";
import { bilingual } from "@/lib/i18n";
import { supportWhatsAppHref } from "@tnajem/shared";
import { accountRole } from "@tnajem/shared"; // phase-a lane L5 (A18.13)

/* phase-a A12 (decision D5): the support number is InnoviaBurst's, read from the
   environment — never hard-coded — and the row is hidden when it is unset or not
   digits only. Written as process.env.NEXT_PUBLIC_… so Next inlines it at build. */
const WA_LINK = supportWhatsAppHref(process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP);

/* espace prof v2 · shell (phase 6): /account is the student's (and parent's) page.
   A tutor is redirected to /dashboard/settings by account/layout.tsx, so the
   tutor-only blocks it carried in phase 1 (photo, free first session, legal links
   inside the shell) now live in Réglages. */

/* Page-local copy (lib/i18n.ts is shared/read-only). */
const copy = bilingual({
  fr: {
    sub: "Ta langue, ton rôle, et comment nous joindre.",
  },
  ar: {
    sub: "لغتك، دورك، وكيفاش تتصل بينا.",
  },
});

export default function AccountPage() {
  const { t, locale } = useLocale();
  const c = copy[locale];
  const [me, setMe] = useState<{ name: string | null; role: string; email: string | null; phone: string | null; isAdmin?: boolean } | null>(null); // phase-a lane L5 (A18.13): + isAdmin

  useEffect(() => { getMe().then(setMe).catch(() => setMe(null)); }, []);

  return (
    <SiteShell>
      <section className="web-section">
        <div className="container container-narrow max-w-[760px]">

          {/* Page heading — the eyebrow used to repeat the h1 verbatim */}
          <div className="mb-[clamp(20px,_3vw,_36px)]">
            <h1 className="web-h2">{t.account.title}</h1>
            <p className="muted text-[13.5px] mt-1.5">{c.sub}</p>
          </div>

          {/* Settings panel */}
          <div className="panel panel-pad">

            {/* Avatar + identity block */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "clamp(14px, 2vw, 22px)",
                paddingBottom: "clamp(16px, 2vw, 22px)",
                borderBottom: "1px solid var(--line)",
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  width: 72,
                  height: 72,
                  minWidth: 72,
                  borderRadius: 22,
                  background: "linear-gradient(150deg, var(--blue), var(--blue900))",
                  display: "grid",
                  placeItems: "center",
                  color: "#fff",
                  fontFamily: "var(--fd)",
                  fontSize: 28,
                  boxShadow: "var(--sh)",
                  flexShrink: 0,
                }}
                aria-hidden="true"
              >
                <User style={{ width: 32, height: 32, stroke: "#fff" }} />
              </div>
              <div className="flex-[1_1_160px] min-w-0">
                <UserText as="div" style={{ fontFamily: "var(--fd)", fontSize: "clamp(16px, 2vw, 20px)", fontWeight: 700, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {me?.name || "—"}
                </UserText>
                {/* The login identity first — that is what they type to get back in.
                    The phone is an optional contact and may simply not be set. */}
                {me?.email && (
                  <div dir="ltr" className="text-[14px] text-muted text-start break-all">{me.email}</div>
                )}
                {me?.phone && (
                  <div dir="ltr" className="text-[14px] text-muted text-start">{me.phone}</div>
                )}
              </div>
            </div>

            {/* Language row */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "clamp(14px, 2vw, 18px) 0",
                borderBottom: "1px solid var(--line)",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <span className="text-[15px] font-semibold">{t.account.language}</span>
              <LocaleToggle />
            </div>

            {/* Role row */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "clamp(14px, 2vw, 18px) 0",
                borderBottom: "1px solid var(--line)",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <span className="text-[15px] font-semibold">{t.account.role}</span>
              <span
                className="text-[13px] font-bold py-1.5 px-3.5 rounded-[999px] bg-blue50 text-blue shrink-0 min-h-8 inline-flex items-center"
              >
                {/* phase-a lane L5 (A18.13): a role NAME (Élève · Prof · Parent · Admin), not the sign-up button text. */}
                {me ? t.roles[accountRole(me)] : null}
              </span>
            </div>

            {/* Help / WhatsApp row — only when a real number is configured (A12). */}
            {WA_LINK && (
            <a
              data-testid="support-whatsapp"
              href={WA_LINK}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "clamp(14px, 2vw, 18px) 0",
                gap: 12,
                textDecoration: "none",
                color: "var(--ink)",
                minHeight: 44,
              }}
              aria-label={t.account.help}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="w-10 h-10 min-w-10 rounded-[11px] bg-blue50 grid place-items-center shrink-0" /* Phase A+ (U1): decorative, not a success */
                  aria-hidden="true"
                >
                  <Phone style={{ width: 18, height: 18, stroke: "var(--blue)" }} />
                </div>
                <span className="text-[15px] font-semibold min-w-0">{t.account.help}</span>
              </div>
              <Forward className="text-muted w-[18px] h-[18px] shrink-0" aria-hidden="true" />
            </a>
            )}

          </div>

          {/* espace prof v2 · auth (C8): password + sessions. Its Sessions card carries
              « Se déconnecter » / « Déconnecter partout », so the old logout buttons are gone.
              Students keep this page; a tutor is sent to Réglages (account/layout.tsx). */}
          <SecurityPanel />

          {/* Step 15. LAST on the page, and behind a two-step confirm: the
              destructive control must never be the one under the cursor when the
              section first renders. */}
          <div className="mt-[clamp(20px,3vw,32px)]">
            <DeleteAccount />
          </div>

        </div>
      </section>
    </SiteShell>
  );
}
