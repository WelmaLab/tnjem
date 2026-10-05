/* student-space-v1 · A — THE STUDENT SPACE'S FRAME, as data (pure; safe in the barrel).

   What the StudentShell (apps/web/components/app/StudentShell.tsx) needs to know
   about the routes of the student space, kept here — with no React and no icons —
   so the API tests and the Playwright specs can check the same table the shell
   draws from:

     STUDENT_NAV        the sidebar: Accueil, then APPRENDRE / ÉCHANGER / COMPTE
                        (UI_options/espace-eleve-1-shell-accueil.png)
     STUDENT_SUBPAGES   pages under an item (a class's detail under Mes cours…)
     STUDENT_TABS       the five tabs of the phone bar; Profil is reached through the avatar
     studentActiveKey   the item a locale-bare path lights up
     studentCrumbs      the top bar's breadcrumbs for a path (a page may override them)
     studentDeepLink    where an OLD link into the student space goes now (the bell)

   Every href is locale-bare ("/student/cours"); the web <Link> adds the locale. */

export type StudentNavLabel = { fr: string; ar: string };

/** GET /student/shell — what the shell shows on every student page. The student's OWN data. */
export type StudentShellInfo = {
  /** The student's own full name (their own screen, not a counterparty one). null if unset. */
  name: string | null;
  /** "AM" — for the avatar. "?" when there is no name. */
  initials: string;
  /** Bookings not cancelled, on classes not cancelled, that have not ENDED yet (classEndMs). */
  upcoming: number;
  /** Payments are off: the platform is in its pilot — the « Pilote » of "Élève · Pilote". */
  pilot: boolean;
};

/** The badges of the student shell (apps/web/app/actions-shell.ts getStudentShellCounts). */
export type StudentShellCounts = {
  /** Unread bell items (GET /notifications). */
  notifications: number;
  /** Unread messages (GET /messages/unread-count). */
  messages: number;
  /** Fiches added since the last visit to Mes fiches (GET /student/fiches/new-count). */
  fiches: number;
  /** Upcoming classes (GET /student/shell). */
  upcoming: number;
};

export const EMPTY_STUDENT_COUNTS: StudentShellCounts = { notifications: 0, messages: 0, fiches: 0, upcoming: 0 };

export type StudentNavKey = "home" | "courses" | "tutors" | "fiches" | "messages" | "profile" | "help";

export type StudentNavItem = {
  key: StudentNavKey;
  href: string;
  label: StudentNavLabel;
  /** Which count, if any, the item shows as a badge. */
  badge?: Exclude<keyof StudentShellCounts, "notifications">;
};

export type StudentNavGroup = { key: string; label: StudentNavLabel | null; items: StudentNavItem[] };

export const STUDENT_NAV: StudentNavGroup[] = [
  { key: "top", label: null, items: [{ key: "home", href: "/student", label: { fr: "Accueil", ar: "الرئيسية" } }] },
  {
    key: "learn",
    label: { fr: "Apprendre", ar: "نتعلّم" },
    items: [
      { key: "courses", href: "/student/cours", label: { fr: "Mes cours", ar: "حصصي" }, badge: "upcoming" },
      { key: "tutors", href: "/student/profs", label: { fr: "Mes profs", ar: "أساتذتي" } },
      { key: "fiches", href: "/student/fiches", label: { fr: "Mes fiches", ar: "ملخّصاتي" }, badge: "fiches" },
    ],
  },
  {
    key: "talk",
    label: { fr: "Échanger", ar: "نتواصلو" },
    items: [{ key: "messages", href: "/messages", label: { fr: "Messages", ar: "الرسائل" }, badge: "messages" }],
  },
  {
    key: "account",
    label: { fr: "Compte", ar: "الحساب" },
    items: [
      { key: "profile", href: "/account", label: { fr: "Profil", ar: "حسابي" } },
      // The public help page: it opens outside the shell, like the prof space's « Aide ».
      { key: "help", href: "/aide", label: { fr: "Aide", ar: "مساعدة" } },
    ],
  },
];

/** Pages under an item: they light it up and read "<item> › <label>" in the breadcrumbs.
    A path ending in "/*" covers everything below it. */
export const STUDENT_SUBPAGES: { path: string; parent: StudentNavKey; label: StudentNavLabel }[] = [
  // The phone's own page for one class (C1); desktop shows it in the right column of Mes cours.
  { path: "/student/cours/*", parent: "courses", label: { fr: "Séance", ar: "الحصة" } },
  // One conversation (C2: /messages/with/<id>), and the per-class thread URLs that came before it.
  { path: "/messages/*", parent: "messages", label: { fr: "Conversation", ar: "المحادثة" } },
  // The first-run screen after sign-up.
  { path: "/student/welcome", parent: "home", label: { fr: "Bienvenue", ar: "مرحبا بيك" } },
];

/** The phone's bottom bar (< 900px): five tabs. Profil is reached through the avatar. */
export const STUDENT_TABS: { key: StudentNavKey; label: StudentNavLabel }[] = [
  { key: "home", label: { fr: "Accueil", ar: "الرئيسية" } },
  { key: "courses", label: { fr: "Cours", ar: "حصصي" } },
  { key: "tutors", label: { fr: "Profs", ar: "أساتذتي" } },
  { key: "fiches", label: { fr: "Fiches", ar: "ملخّصاتي" } },
  { key: "messages", label: { fr: "Messages", ar: "الرسائل" } },
];

/* ── lookups (pure) ─────────────────────────────────────────────────────────── */

const ALL = STUDENT_NAV.flatMap((g) => g.items.map((item) => ({ item, group: g })));

export function studentNavItem(key: string): StudentNavItem | undefined {
  return ALL.find((x) => x.item.key === key)?.item;
}

function matches(path: string, pattern: string): boolean {
  if (pattern.endsWith("/*")) return path.startsWith(pattern.slice(0, -1));
  return path === pattern;
}

/** The sidebar item a locale-bare `path` belongs to, or null. */
export function studentActiveKey(path: string): StudentNavKey | null {
  const exact = ALL.find(({ item }) => item.href === path);
  if (exact) return exact.item.key;
  const sub = STUDENT_SUBPAGES.find((s) => matches(path, s.path));
  if (sub) return sub.parent;
  // An item's own children ("/student/fiches/x"); « Accueil » (/student) is never a prefix.
  let best: StudentNavItem | null = null;
  for (const { item } of ALL) {
    if (item.href !== "/student" && path.startsWith(`${item.href}/`) && (!best || item.href.length > best.href.length)) best = item;
  }
  return best?.key ?? null;
}

/** Breadcrumbs for a locale-bare path: « Apprendre › Mes cours », « Accueil », « Mes cours › Séance ». */
export function studentCrumbs(path: string, locale: "fr" | "ar"): { label: string; href?: string }[] {
  const exact = ALL.find(({ item }) => item.href === path);
  if (exact) {
    return exact.group.label
      ? [{ label: exact.group.label[locale] }, { label: exact.item.label[locale] }]
      : [{ label: exact.item.label[locale] }];
  }
  const sub = STUDENT_SUBPAGES.find((s) => matches(path, s.path));
  if (sub) {
    const parent = studentNavItem(sub.parent);
    return parent
      ? [{ label: parent.label[locale], href: parent.href }, { label: sub.label[locale] }]
      : [{ label: sub.label[locale] }];
  }
  const key = studentActiveKey(path);
  const item = key ? studentNavItem(key) : undefined;
  return item ? [{ label: item.label[locale], href: item.href }] : [];
}

/* ── OLD DEEP LINKS ───────────────────────────────────────────────────────────
   Before the student space, « Mes cours » WAS /student: every link that meant "your
   classes" pointed there. Now /student is Accueil and the classes live in Mes cours.
   No URL disappeared (git history: no student page was ever removed, and nothing
   ever linked /student?… or /student#…), so there is nothing for the proxy to
   redirect — /student is still a real page. What did go stale is the MEANING of the
   links stored in rows that outlive this release: the bell's notifications. A
   « Séance annulée » row says "/student" and wants the cancelled tab; a « Séance
   déplacée » row wants the upcoming list; a subscription row with no prof page
   wants Mes profs, where the subscriptions now live. The bell maps them here, by
   (kind, href), so old rows and rows written by the unchanged API both land right.
   E-mails link /student for "your space" (booking-mail.ts studentSpace): Accueil is
   the right place for those, unchanged. Per-class thread links (/messages/<thread>)
   belong to the merged conversation (contract C2, the messages lane's page). */
export function studentDeepLink(kind: string, href: string | null): string | null {
  if (href !== "/student") return href;
  if (kind === "booking_cancelled") return "/student/cours?tab=annulees";
  if (kind === "class_reminder") return "/student/cours?tab=avenir";
  if (kind.startsWith("subscription_")) return "/student/profs";
  return href;
}
