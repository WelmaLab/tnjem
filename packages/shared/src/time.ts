/* ══════════════════════════════════════════════════════════════════════════════
   Time, in the only timezone this product has: Africa/Tunis.

   ── WHY ONE MODULE ──────────────────────────────────────────────────────────
   A class is an appointment in Tunisia. "18:00" means 18:00 in Tunis to the
   student in Sfax, the tutor in Paris and the server in Frankfurt alike. Until
   15 Sept every formatter used the timezone of whatever process ran it:

     • the API built "day / month / time" with getDate()/getMonth() and
       toLocaleTimeString — so a UTC server showed a 18:00 class as "17:00", and a
       class at 00:30 in Tunis on the wrong DAY;
     • a new class was parsed with `new Date("2026-09-20T18:00")` in the API's
       timezone, while a rescheduled one was converted to UTC in the TUTOR'S
       BROWSER — the same typed "18:00" became two different instants;
     • client pages (messages, plan expiry, account deletion) used the browser's
       timezone.

   Everything here pins timeZone: APP_TIME_ZONE explicitly, and never reads the
   process or browser zone. Pure Intl — no dependencies, safe in client bundles,
   in the edge middleware and in the API. Tunisia has had no DST since 2009, but
   nothing below assumes a fixed offset: the offset is looked up per instant.
   ══════════════════════════════════════════════════════════════════════════════ */

export const APP_TIME_ZONE = "Africa/Tunis";

/** Month keys as the API sends them (ClassItem.month). Display goes through monthLabel(). */
export const MONTHS_FR = [
  "JANV", "FÉVR", "MARS", "AVR", "MAI", "JUIN", "JUIL", "AOÛT", "SEPT", "OCT", "NOV", "DÉC",
] as const;
export type MonthKey = (typeof MONTHS_FR)[number];

/* Tunisian Arabic month names (the ones on a Tunisian calendar: جانفي, not يناير).
   There used to be three copies of this map, in the storefront, checkout and
   class page — and the dashboard, student space, live page and guardian page had
   none, so /ar showed "JUIN". */
const MONTHS_AR: Record<MonthKey, string> = {
  JANV: "جانفي", FÉVR: "فيفري", MARS: "مارس", AVR: "أفريل", MAI: "ماي", JUIN: "جوان",
  JUIL: "جويل", AOÛT: "أوت", SEPT: "سبتمبر", OCT: "أكتوبر", NOV: "نوفمبر", DÉC: "ديسمبر",
};

type Locale = "fr" | "ar";
const intlLocale = (locale: Locale) => (locale === "ar" ? "ar-TN" : "fr-FR");

/** A month key (e.g. "JUIN") in the reader's language. Unknown keys pass through. */
export function monthLabel(key: string, locale: Locale): string {
  if (locale !== "ar") return key;
  return (MONTHS_AR as Record<string, string>)[key] ?? key;
}

/** Wall-clock fields of an instant, in Tunis. month is 1–12. */
export type WallTime = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  hourCycle: "h23",
});

const toDate = (d: Date | string | number): Date => (d instanceof Date ? d : new Date(d));

/** The Tunis wall clock at an instant. */
export function tunisWallTime(instant: Date | string | number): WallTime {
  const out: Record<string, number> = {};
  for (const p of PARTS.formatToParts(toDate(instant))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return {
    year: out.year, month: out.month, day: out.day,
    hour: out.hour === 24 ? 0 : out.hour, minute: out.minute, second: out.second,
  };
}

/** Tunis's UTC offset at an instant, in milliseconds (+3_600_000 today). */
function offsetAt(ms: number): number {
  const w = tunisWallTime(ms);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** The instant a Tunis wall-clock time names, or null if no such time exists
    (an impossible date like 30 Feb, or a time skipped by a DST change). */
export function wallTimeToInstant(w: Pick<WallTime, "year" | "month" | "day" | "hour" | "minute"> & { second?: number }): Date | null {
  const second = w.second ?? 0;
  const guess = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, second);
  if (!Number.isFinite(guess)) return null;
  let instant = guess - offsetAt(guess);
  const retry = guess - offsetAt(instant); // the offset may differ on the other side of a change
  if (retry !== instant) instant = retry;
  const back = tunisWallTime(instant);
  const same = back.year === w.year && back.month === w.month && back.day === w.day &&
    back.hour === w.hour && back.minute === w.minute && back.second === second;
  return same ? new Date(instant) : null;
}

const WALL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/;
const ZONED_INPUT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/i;

/** A submitted class start time → the instant it means.

      "2026-09-20T18:00"          wall time (a datetime-local input) → 18:00 IN TUNIS
      "2026-09-20T17:00:00.000Z"  explicit instant → as written
      "2026-09-20T18:00+01:00"    explicit offset  → as written
      anything else               → null (a bare date, "tomorrow", 30 Feb) */
export function parseScheduleInput(raw: string): Date | null {
  const s = raw.trim();
  const wall = WALL_INPUT.exec(s);
  if (wall) {
    const [, y, mo, d, h, mi, sec] = wall;
    return wallTimeToInstant({
      year: Number(y), month: Number(mo), day: Number(d),
      hour: Number(h), minute: Number(mi), second: sec ? Number(sec) : 0,
    });
  }
  if (ZONED_INPUT.test(s)) {
    const ms = Date.parse(s);
    return Number.isNaN(ms) ? null : new Date(ms);
  }
  return null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** An instant as a datetime-local value in Tunis ("2026-09-20T18:00") — to prefill an input. */
export function toWallInput(instant: Date | string | number): string {
  const w = tunisWallTime(instant);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

/** "HH:MM" in Tunis, 24h. */
export function tunisClock(instant: Date | string | number): string {
  const w = tunisWallTime(instant);
  return `${pad(w.hour)}:${pad(w.minute)}`;
}

/** The display fields every class DTO carries, all in Tunis. */
export function classWhen(instant: Date | string | number): { starts_at: string; day: string; month: MonthKey; time: string } {
  const d = toDate(instant);
  const w = tunisWallTime(d);
  return { starts_at: d.toISOString(), day: String(w.day), month: MONTHS_FR[w.month - 1], time: tunisClock(d) };
}

/** A Tunis wall time N calendar days from now (the seed and the demo fixtures). */
export function tunisWallTimeFromNow(daysFromNow: number, hour: number, minute: number, now: Date = new Date()): Date {
  const today = tunisWallTime(now);
  const day = new Date(Date.UTC(today.year, today.month - 1, today.day + daysFromNow));
  return (
    wallTimeToInstant({ year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate(), hour, minute }) ??
    new Date(now.getTime() + daysFromNow * 86_400_000)
  );
}

/** Intl formatting with the zone pinned. The only way a date should reach a screen. */
export function formatInTunis(instant: Date | string | number, locale: Locale, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { ...options, timeZone: APP_TIME_ZONE }).format(toDate(instant));
}

/** "20 septembre 2026" / "20 سبتمبر 2026". */
export const formatLongDate = (instant: Date | string | number, locale: Locale) =>
  formatInTunis(instant, locale, { day: "2-digit", month: "long", year: "numeric" });

/** "20 sept." */
export const formatShortDate = (instant: Date | string | number, locale: Locale) =>
  formatInTunis(instant, locale, { day: "2-digit", month: "short" });

/** "20 sept., 18:00". Always 24 h: ar-TN defaults to a 12-hour clock (« 06:00 م »). */
export const formatShortDateTime = (instant: Date | string | number, locale: Locale) =>
  formatInTunis(instant, locale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** "20/09/2026", in Tunis. */
export function formatNumericDate(instant: Date | string | number): string {
  const w = tunisWallTime(instant);
  return `${pad(w.day)}/${pad(w.month)}/${w.year}`;
}

