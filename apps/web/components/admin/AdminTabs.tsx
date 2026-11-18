"use client";

import { Link } from "@/components/Link";
import { useLocale } from "@/components/LocaleProvider";
import { bilingual } from "@/lib/i18n";

/* UI Option A (A9): ONE row of admin tabs, the same on all four admin pages, with the
   current one marked in cobalt on blue50 (.adm-tab[aria-current] in globals.css).
   Each page used to show a different subset of links, in a different place, under
   different names. The labels are the short ones the pages already used. */
const TABS = ["verifications", "accounts", "moderation", "plans", "leads", "exports"] as const; // december-sprint · B: + leads, F: + exports
export type AdminTab = (typeof TABS)[number];

const copy = bilingual({
  fr: { verifications: "Vérifications", accounts: "Comptes", moderation: "Modération", plans: "Offres", leads: "Centres", exports: "Exports" },
  ar: { verifications: "التثبّت", accounts: "الحسابات", moderation: "المراقبة", plans: "العروض", leads: "المراكز", exports: "التصدير" },
});

export function AdminTabs({ current }: { current: AdminTab }) {
  const { locale, t } = useLocale();
  const c = copy[locale];
  return (
    <nav className="adm-tabs" aria-label={t.roles.admin} data-e2e="admin-nav">
      {TABS.map((tab) => (
        <Link key={tab} href={`/admin/${tab}`} className="adm-tab" aria-current={tab === current ? "page" : undefined}>
          {c[tab]}
        </Link>
      ))}
    </nav>
  );
}
