"use client";
import { Link } from "@/components/Link";
import { LocaleToggle } from "@/components/LocaleToggle";
import { useLocale } from "@/components/LocaleProvider";
import { UserText } from "@/components/UserText";
import { accountRole, initials } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";
import type { SettingsData } from "./SettingsView";

/* Réglages › Compte (image 4): who the account is — the name, the login address and
   the optional phone, the interface language, the role. « Modifier » opens the page
   editor, where the name and the phone are written (the name is the one on the
   public page, and a verified tutor's rename goes to review — see POST /tutors). */

const copy = bilingual({
  fr: { edit: "Modifier", language: "Langue de l'interface", role: "Rôle" },
  ar: { edit: "بدّل", language: "لغة التطبيقة", role: "الدور" },
});

export function CompteTab({ data }: { data: SettingsData }) {
  const { t, locale } = useLocale();
  const c = copy[locale];
  const name = data.dash?.name ?? data.me?.name ?? "";
  const contact = [data.me?.email, data.me?.phone].filter(Boolean) as string[];
  return (
    <section className="u-card st-card" aria-label={t.account.title} data-e2e="settings-compte">
      <div className="st-id">
        <span className="avatar st-av" aria-hidden="true">{name ? initials(name) : "?"}</span>
        <div className="min-w-0 flex-1">
          <UserText as="div" className="st-id-name">{name || "—"}</UserText>
          {contact.length > 0 && (
            <div className="st-id-contact" dir="ltr">
              {contact.join(" · ")}
            </div>
          )}
        </div>
        <Link href="/onboarding" className="btn btn-ghost btn-sm flex-none">{c.edit}</Link>
      </div>
      <div className="st-row">
        <div className="st-row-t">{c.language}</div>
        <LocaleToggle />
      </div>
      <div className="st-row">
        <div className="st-row-t">{c.role}</div>
        <span className="tag tag-neutral" data-e2e="settings-role">{data.me ? t.roles[accountRole(data.me)] : "—"}</span>
      </div>
    </section>
  );
}
