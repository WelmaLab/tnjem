import type { Locator, Page } from "@playwright/test";

/* espace prof v2 · shell (rule 6) — the prof pages have no native datetime-local
   any more: components/app/DatePicker.tsx shows DD/MM/YYYY + a 24-hour HH:MM field
   and hands the form the same wall time ("2026-10-08T18:00", Tunis) the native
   input used to. This fills it the way a person types it. */

/** Type a wall time "YYYY-MM-DDTHH:MM" into the first DateTimeField under `scope`. */
export async function fillWallTime(scope: Page | Locator, wall: string): Promise<void> {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(wall);
  if (!m) throw new Error(`fillWallTime: not a wall time: ${wall}`);
  const [, y, mo, d, h, mi] = m;
  await scope.locator("[data-e2e=date-input]").first().fill(`${d}/${mo}/${y}`);
  await scope.locator("[data-e2e=time-input]").first().fill(`${h}:${mi}`);
}

/** The wall time a DateTimeField currently holds ("" while incomplete). */
export async function wallTimeOf(scope: Page | Locator): Promise<string> {
  return (await scope.locator("[data-e2e=datetime-field]").first().getAttribute("data-value")) ?? "";
}

/** "YYYY-MM-DDTHH:MM" for a date N days ahead (the runner's calendar), at hh:mm. */
export function wallDaysAhead(days: number, hhmm = "18:00"): string {
  const d = new Date(Date.now() + days * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${hhmm}`;
}
