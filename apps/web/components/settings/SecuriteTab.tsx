"use client";
import { Link } from "@/components/Link";
import { useLocale } from "@/components/LocaleProvider";
import { DeleteAccount } from "@/components/account/DeleteAccount";
import { SecurityPanel } from "@/components/settings/SecurityPanel";
import { bilingual } from "@/lib/i18n";

/* Réglages › Sécurité — password and sessions (auth's SecurityPanel, contract C8:
   it carries « Se déconnecter » and « Déconnecter partout », so no other logout
   button is drawn here), then closing the account, with the detail and the legal
   links folded behind « Ce qui est effacé ▸ » (image 4). The legal links lived in
   the marketing footer, which the prof space does not have (rule 2). */

const CONTACT_EMAIL = "contact@tnajem.com";

const copy = bilingual({
  fr: { legal: "Textes légaux" },
  ar: { legal: "النصوص القانونية" },
});

export function SecuriteTab() {
  const { t, locale } = useLocale();
  const c = copy[locale];
  return (
    <div className="st-stack" data-e2e="settings-securite">
      {/* The tab already names the panel, so no second « Sécurité » heading. */}
      <SecurityPanel heading={false} />

      <DeleteAccount
        variant="compact"
        legal={
          <nav aria-label={c.legal} className="mt-3" data-e2e="settings-legal">
            <ul className="flex flex-wrap gap-x-5 list-none">
              <li><Link href="/terms" className="linklike text-[13.5px]">{t.footer.terms}</Link></li>
              <li><Link href="/privacy" className="linklike text-[13.5px]">{t.footer.privacy}</Link></li>
              <li><a href={`mailto:${CONTACT_EMAIL}`} className="linklike text-[13.5px]">{t.footer.contact}</a></li>
            </ul>
          </nav>
        }
      />
    </div>
  );
}
