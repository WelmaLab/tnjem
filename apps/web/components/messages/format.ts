import { formatInTunis, tunisClock, tunisWallTime } from "@tnajem/shared";

/* student-space-v1 · G — how times read in the conversations. Tunis time, 24 h. */

type L = "fr" | "ar";

const sameTunisDay = (a: Date | string | number, b: Date | string | number) => {
  const x = tunisWallTime(a);
  const y = tunisWallTime(b);
  return x.year === y.year && x.month === y.month && x.day === y.day;
};

/** « 10:42 » today, « 4 oct » before. */
export function listTime(iso: string, locale: L, now: number = Date.now()): string {
  return sameTunisDay(iso, now) ? tunisClock(iso) : shortDay(iso, locale);
}

/** « 4 oct » / « 4 أكتوبر » — the marker's date. */
export function shortDay(instant: string | number, locale: L): string {
  return formatInTunis(instant, locale, { day: "numeric", month: "short" }).replace(/\.$/, "");
}

/** « 10:42 » today, « 4 oct · 10:42 » before — under a message. */
export function messageTime(iso: string, locale: L, now: number = Date.now()): string {
  return sameTunisDay(iso, now) ? tunisClock(iso) : `${shortDay(iso, locale)} · ${tunisClock(iso)}`;
}

/** « mer. 8 oct · 18:30 » — the header's next class. */
export function classWhenLabel(iso: string, locale: L): string {
  return `${formatInTunis(iso, locale, { weekday: "short", day: "numeric", month: "short" }).replace(/\.$/, "")} · ${tunisClock(iso)}`;
}
