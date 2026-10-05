"use client";
import { LocaleToggle } from "@/components/LocaleToggle";
import { useLocale } from "@/components/LocaleProvider";
import { Phone, Forward } from "@/components/icons";
import { DeleteAccount } from "@/components/account/DeleteAccount";
import { SecurityPanel } from "@/components/settings/SecurityPanel"; // espace prof v2 · auth (C8)
import { accountRole, supportWhatsAppHref, type Me } from "@tnajem/shared";

/* Profil › SÉCURITÉ — student-space-v1 · F. Everything /account held before: the
   language and the role (moved here by the spec), the support WhatsApp row (only
   when a real number is configured — phase-a A12), the password and the sessions
   with « Déconnecter partout » (SecurityPanel, contract C8), and closing the account
   with its full text, last on the page, behind its two-step confirm (Step 15).
   A parent (guardian) sees this content alone, without tabs. */

/* phase-a A12 (decision D5): the support number is read from the environment —
   never hard-coded — and hidden when unset or not digits only. Written as
   process.env.NEXT_PUBLIC_… so Next inlines it at build. */
const WA_LINK = supportWhatsAppHref(process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP);

export function AccountSecurityTab({ me, tabbed = true }: { me: Me | null; tabbed?: boolean }) {
  const { t } = useLocale();
  return (
    <div className="st-stack" data-e2e="profile-securite">
      <section className="u-card st-card" aria-label={t.account.language}>
        <div className="st-row">
          <span className="st-row-t">{t.account.language}</span>
          <LocaleToggle />
        </div>
        <div className="st-row">
          <span className="st-row-t">{t.account.role}</span>
          {/* phase-a lane L5 (A18.13): a role NAME (Élève · Prof · Parent · Admin), not the sign-up button text. */}
          <span className="chip chip-soft" data-e2e="account-role">{me ? t.roles[accountRole(me)] : null}</span>
        </div>
        {WA_LINK && (
          <a data-testid="support-whatsapp" href={WA_LINK} target="_blank" rel="noopener noreferrer" className="st-row ssv-wa" aria-label={t.account.help}>
            <span className="inline-flex items-center gap-3 min-w-0">
              <Phone className="text-blue" />
              <span className="st-row-t">{t.account.help}</span>
            </span>
            <Forward className="text-muted" />
          </a>
        )}
      </section>

      {/* password + sessions; its card carries « Se déconnecter » / « Déconnecter partout ». */}
      {/* A student's tab already names the panel « Sécurité »; a parent's page has no tabs, so it keeps its heading. */}
      <SecurityPanel heading={!tabbed} />

      <div data-e2e="account-delete">
        <DeleteAccount />
      </div>
    </div>
  );
}
