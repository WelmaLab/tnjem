/* ══════════════════════════════════════════════════════════════════════════════
   student-space-v1 · A — THE STUDENT SPACE'S NAVIGATION, with its icons and badges.

   The table itself (items, hrefs, labels, sub-pages, the five phone tabs, the active
   item and the breadcrumbs) lives in packages/shared/src/student-shell.ts, pure, so
   the API tests check the same rows the shell draws. This file only dresses it for
   the AppShell's <NavList>: an icon per item, and the badge each one reads from the
   shell's counts (the « Mes cours » upcoming count, new fiches, unread messages).

   ADDING A PAGE: append a row in student-shell.ts (STUDENT_NAV or STUDENT_SUBPAGES)
   and, for a sidebar item, its icon below. Every href is locale-bare.
   ══════════════════════════════════════════════════════════════════════════════ */
import { STUDENT_NAV, type StudentNavKey, type StudentShellCounts } from "@tnajem/shared";
import { Book, Chat, Help, Home, User, Users, Video } from "@/components/icons";
import type { Bilingual, NavGroup, NavItem } from "./nav";

export const STUDENT_ICONS: Record<StudentNavKey, NavItem["icon"]> = {
  home: Home,
  courses: Video,
  tutors: Users,
  fiches: Book,
  messages: Chat,
  profile: User,
  help: Help,
};

/** What a screen reader hears after the label: ", 2 séances à venir". */
const BADGE_LABEL: Record<Exclude<keyof StudentShellCounts, "notifications">, (n: number) => Bilingual> = {
  upcoming: (n) => ({ fr: n === 1 ? "1 séance à venir" : `${n} séances à venir`, ar: `${n} حصص جايين` }),
  fiches: (n) => ({ fr: n === 1 ? "1 nouvelle fiche" : `${n} nouvelles fiches`, ar: `${n} ملفات جداد` }),
  messages: (n) => ({ fr: n === 1 ? "1 message non lu" : `${n} messages non lus`, ar: `${n} رسالة موش مقروية` }),
};

/** A count as the sidebar shows it: nothing at 0 (no invented « 0 » pill), "99+" past 99. */
export function badgeText(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 99 ? "99+" : String(Math.floor(n));
}

/** The sidebar of the student space, for <NavList nav={STUDENT_APP_NAV} data={counts} />. */
export const STUDENT_APP_NAV: NavGroup<StudentShellCounts>[] = STUDENT_NAV.map((g) => ({
  key: g.key,
  label: g.label,
  items: g.items.map((item) => {
    const which = item.badge;
    return {
      key: item.key,
      href: item.href,
      label: item.label,
      icon: STUDENT_ICONS[item.key],
      badge: which
        ? (counts: StudentShellCounts) => {
            const text = badgeText(counts[which]);
            return text ? { text, label: BADGE_LABEL[which](counts[which]) } : null;
          }
        : undefined,
    };
  }),
}));
