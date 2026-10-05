/* student-space-v1 · pages — how the student space writes dates, durations and prices.
   All in Tunis time, 24 h (packages/shared/src/time.ts); every figure in the brand's
   number face (.hp-num). Pure, client-safe. */
import { formatInTunis, MONTHS_FR, monthLabel, tunisClock, tunisWallTime, displaySubject, type StudentPrice } from "@tnajem/shared";

type Locale = "fr" | "ar";

/** « lun. 5 oct. » / « الإثنين 5 أكتوبر » — the day of a class, in words. */
export function dayLabel(iso: string, locale: Locale): string {
  return formatInTunis(iso, locale, { weekday: "short", day: "numeric", month: "short" });
}

/** « lun. 5 oct. · 18:00 ». */
export function whenLabel(iso: string, locale: Locale): string {
  return `${dayLabel(iso, locale)} · ${tunisClock(iso)}`;
}

/** « 11:30 → 13:00 » (always left to right: it is a range of clock times). */
export function rangeLabel(startIso: string, endIso: string): string {
  return `${tunisClock(startIso)} → ${tunisClock(endIso)}`;
}

/** The date tile of a row: day number + month (« 7 » / « OCT », « أكتوبر »). */
export function tileOf(iso: string, locale: Locale): { day: string; month: string } {
  const w = tunisWallTime(iso);
  return { day: String(w.day), month: monthLabel(MONTHS_FR[w.month - 1], locale) };
}

/** « 90 min » / « 90 دقيقة ». */
export function minutesLabel(n: number, locale: Locale): string {
  return locale === "ar" ? `${n} دقيقة` : `${n} min`;
}

/** « 15 TND » / « 15 د.ت », whole numbers without decimals. */
export function tnd(n: number, locale: Locale): string {
  const v = n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
  return locale === "ar" ? `${v} د.ت` : `${v} TND`;
}

/** What a seat cost: a price, « offerte », or « couverte par l'abonnement ». */
export function priceLabel(p: StudentPrice, locale: Locale): string {
  if (p.kind === "free") return locale === "ar" ? "مجانية" : "offerte";
  if (p.kind === "subscription") return locale === "ar" ? "في الاشتراك" : "couverte par l'abonnement";
  return tnd(p.tnd, locale);
}

/** The prof's subject as shown (« Maths »). */
export function subjectOf(subject: string, locale: Locale): string {
  return displaySubject(subject, locale);
}
