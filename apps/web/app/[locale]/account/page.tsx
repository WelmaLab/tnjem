import type { Metadata } from "next";
import { ProfileView } from "@/components/account/ProfileView";
import { profileTab } from "@/components/account/profile-tabs";
import { bilingual } from "@/lib/i18n";
import { isLocale, DEFAULT_LOCALE } from "@/lib/locale";
import { pageMetadata } from "@/lib/metadata";

/* /account — the student's PROFIL (student-space-v1 · F): Moi · Notifications ·
   Sécurité (?tab=moi|notifications|securite, read here — no client search-params
   hook). A parent gets the account's security content alone; a tutor is sent to
   Réglages by account/layout.tsx. NOINDEX: private. */

const copy = bilingual({
  fr: { title: "Mon profil", description: "Ton profil, tes e-mails et la sécurité de ton compte Tnajem." },
  ar: { title: "البروفايل متاعي", description: "البروفايل متاعك، الإيمايلات وأمان حسابك في Tnajem." },
});

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const params = await props.params;
  const locale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  return pageMetadata({ locale, path: "/account", ...copy[locale], noindex: true });
}

export default async function AccountPage(props: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const sp = await props.searchParams;
  return <ProfileView initialTab={profileTab(sp.tab)} />;
}
