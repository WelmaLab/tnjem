/* ══════════════════════════════════════════════════════════════════════════════
   espace prof v2 · THE PROF SPACE'S NAVIGATION — one file (contract C1).

   Everything the AppShell needs to know about the routes of the prof space lives
   here, and nowhere else:

     APP_NAV          the sidebar: Accueil, then the ENSEIGNER / MA PAGE / COMPTE
                      groups of image 1. The mobile « Profil » sheet lists the same.
     APP_SUBPAGES     pages that are not in the sidebar but live under an item
                      (Nouvelle classe under Mes classes…) — they light that item up
                      and get its breadcrumb.
     MOBILE_TABS      the four links of the bottom tab bar (< 900px); « Profil » is
                      the last tab and opens the sheet.
     CREATE_ACTIONS   what the « + » offers on a phone — the raised middle slot of the
                      tab bar (CREATE_TAB_AT), never floating over the page.

   ADDING A PAGE (other teams): append ONE entry — an item to a group's `items`
   when it belongs in the sidebar, else a row to APP_SUBPAGES. Labels are
   { fr, ar } (Derja for the Arabic, like the rest of the space). Every href is
   locale-bare ("/dashboard/x"); <Link> adds the locale. Nothing else changes:
   active state, breadcrumbs and the mobile sheet all read from here.
   ══════════════════════════════════════════════════════════════════════════════ */
import type { ReactElement } from "react";
import type { TutorShell } from "@tnajem/shared";
import {
  Home, Video, Book, Users, Repeat, Store, Percent, Shield, Star, Gear, Plus, Help,
} from "@/components/icons";

export type Bilingual = { fr: string; ar: string };

/* student-space-v1 · A: generic over what the badges read (`T`) — the prof space's items
   read the TutorShell (the default), the student space's read its counts
   (components/app/student-nav.tsx). Everything else is the same shape. */
export type NavItem<T = TutorShell | null> = {
  key: string;
  href: string;
  label: Bilingual;
  icon: (p: { className?: string }) => ReactElement;
  /** More locale-bare paths that mark this item as the current page (exact, or a prefix when ending in "/*"). */
  match?: string[];
  /** A small count beside the label, from the shell data. `label` is what a screen reader hears. */
  badge?: (shell: T) => { text: string; label: Bilingual } | null;
};

export type NavGroup<T = TutorShell | null> = {
  key: string;
  /** null = an ungrouped item at the top (Accueil). */
  label: Bilingual | null;
  items: NavItem<T>[];
};

export const APP_NAV: NavGroup[] = [
  {
    key: "top",
    label: null,
    items: [{ key: "home", href: "/dashboard", label: { fr: "Accueil", ar: "الرئيسية" }, icon: Home }],
  },
  {
    key: "teach",
    label: { fr: "Enseigner", ar: "التدريس" },
    items: [
      {
        key: "classes",
        href: "/dashboard/classes",
        label: { fr: "Mes classes", ar: "حصصي" },
        icon: Video,
      },
      {
        key: "materials",
        href: "/dashboard/materials",
        label: { fr: "Mes fiches", ar: "ملخّصاتي" },
        icon: Book,
      },
      {
        key: "students",
        href: "/dashboard/students",
        label: { fr: "Mes élèves", ar: "تلامذتي" },
        icon: Users,
      },
      // growth · phase 5 builds the page.
      {
        key: "subscriptions",
        href: "/dashboard/subscriptions",
        label: { fr: "Abonnements", ar: "الاشتراكات" },
        icon: Repeat,
      },
    ],
  },
  {
    key: "page",
    label: { fr: "Ma page", ar: "صفحتي" },
    items: [
      {
        key: "storefront",
        href: "/dashboard/storefront",
        label: { fr: "Ma vitrine", ar: "واجهتي" },
        icon: Store,
      },
      // growth · phase 5 builds the page.
      {
        key: "promotions",
        href: "/dashboard/promotions",
        label: { fr: "Promotions", ar: "التخفيضات" },
        icon: Percent,
      },
      {
        key: "verify",
        href: "/onboarding/verify",
        label: { fr: "Vérification", ar: "التثبّت" },
        icon: Shield,
        /* "While it's pending" (spec): from the first visit until the account is
           verified — something to do (draft, rejected) or something under way (pending). */
        badge: (shell) =>
          !shell || shell.status === "verified"
            ? null
            : shell.status === "pending"
              ? { text: "1", label: { fr: "en cours de vérification", ar: "التثبّت في الطريق" } }
              : { text: "1", label: { fr: "1 étape à faire", ar: "مرحلة وحدة باش تعملها" } },
      },
    ],
  },
  {
    key: "account",
    label: { fr: "Compte", ar: "الحساب" },
    items: [
      { key: "plan", href: "/dashboard/plan", label: { fr: "Mon offre", ar: "العرض متاعي" }, icon: Star },
      // Réglages (4 tabs: ?tab=compte|vitrine|notifications|securite); /account redirects tutors here.
      { key: "settings", href: "/dashboard/settings", label: { fr: "Réglages", ar: "الإعدادات" }, icon: Gear },
      // espace prof v2 · pro (P7, C9): the public help page — it opens outside the shell.
      { key: "help", href: "/aide", label: { fr: "Aide", ar: "مساعدة" }, icon: Help },
    ],
  },
];

/** Pages under an item: they light it up and read "<item> › <label>" in the breadcrumbs. */
export const APP_SUBPAGES: { path: string; parent: string; label: Bilingual }[] = [
  { path: "/dashboard/new-class", parent: "classes", label: { fr: "Nouvelle classe", ar: "حصة جديدة" } },
  { path: "/dashboard/new-pack", parent: "materials", label: { fr: "Nouvelle fiche", ar: "ملخّص جديد" } },
  { path: "/dashboard/storefront/preview", parent: "storefront", label: { fr: "Aperçu privé", ar: "معاينة خاصة" } },
  { path: "/onboarding", parent: "storefront", label: { fr: "Modifier ma page", ar: "بدّل صفحتي" } },
  { path: "/dashboard/payout", parent: "home", label: { fr: "Retirer mes gains", ar: "اسحب أرباحي" } },
];

/** Shell-level pages with no sidebar item (reached from the top bar). */
export const APP_STANDALONE: { path: string; label: Bilingual }[] = [
  { path: "/messages", label: { fr: "Messages", ar: "الرسائل" } },
];

/** The bottom tab bar (< 900px). The fifth tab, « Profil », opens the full menu. */
export const MOBILE_TABS: { key: string; label: Bilingual }[] = [
  { key: "home", label: { fr: "Accueil", ar: "الرئيسية" } },
  { key: "classes", label: { fr: "Classes", ar: "الحصص" } },
  { key: "students", label: { fr: "Élèves", ar: "التلامذة" } },
  { key: "storefront", label: { fr: "Vitrine", ar: "الواجهة" } },
];

/** live-fixes-1 · A3 — where the « + » sits in the tab bar: before MOBILE_TABS[CREATE_TAB_AT],
    so Accueil · Classes · [+] · Élèves · Vitrine · Profil (mirrored in Arabic). */
export const CREATE_TAB_AT = 2;

/** The « + » on a phone (the tab bar's middle slot). */
export const CREATE_ACTIONS: { href: string; label: Bilingual; icon: NavItem["icon"] }[] = [
  { href: "/dashboard/new-class", label: { fr: "Nouvelle classe", ar: "حصة جديدة" }, icon: Plus },
  { href: "/dashboard/new-pack", label: { fr: "Nouvelle fiche", ar: "ملخّص جديد" }, icon: Plus },
];

/* ── lookups (pure) ─────────────────────────────────────────────────────────── */

const ALL_ITEMS = APP_NAV.flatMap((g) => g.items.map((item) => ({ item, group: g })));

export function navItem(key: string): NavItem | undefined {
  return ALL_ITEMS.find((x) => x.item.key === key)?.item;
}

function matches(path: string, pattern: string): boolean {
  if (pattern.endsWith("/*")) return path === pattern.slice(0, -2) || path.startsWith(pattern.slice(0, -1));
  return path === pattern;
}

/** The sidebar item the locale-bare `path` belongs to, if any. */
export function activeItemKey(path: string): string | null {
  // An exact item, then a sub-page, then an item's own children ("/dashboard/classes/x").
  for (const { item } of ALL_ITEMS) {
    if (path === item.href || item.match?.some((m) => matches(path, m))) return item.key;
  }
  const sub = APP_SUBPAGES.find((s) => s.path === path);
  if (sub) return sub.parent;
  let best: NavItem | null = null;
  for (const { item } of ALL_ITEMS) {
    if (item.href !== "/dashboard" && path.startsWith(`${item.href}/`) && (!best || item.href.length > best.href.length)) best = item;
  }
  return best?.key ?? null;
}

/** Breadcrumbs for a locale-bare path, from this file alone (a page may override them). */
export function crumbsFor(path: string, locale: "fr" | "ar"): { label: string; href?: string }[] {
  const exact = ALL_ITEMS.find(({ item }) => item.href === path);
  if (exact) {
    return exact.group.label
      ? [{ label: exact.group.label[locale] }, { label: exact.item.label[locale] }]
      : [{ label: exact.item.label[locale] }];
  }
  const sub = APP_SUBPAGES.find((s) => s.path === path);
  if (sub) {
    const parent = navItem(sub.parent);
    return parent
      ? [{ label: parent.label[locale], href: parent.href }, { label: sub.label[locale] }]
      : [{ label: sub.label[locale] }];
  }
  const standalone = APP_STANDALONE.find((s) => path === s.path || path.startsWith(`${s.path}/`));
  if (standalone) {
    return path === standalone.path
      ? [{ label: standalone.label[locale] }]
      : [{ label: standalone.label[locale], href: standalone.path }];
  }
  const key = activeItemKey(path);
  const item = key ? navItem(key) : undefined;
  return item ? [{ label: item.label[locale], href: item.href }] : [];
}
