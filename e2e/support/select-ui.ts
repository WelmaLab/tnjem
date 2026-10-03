/* live-fixes-2 · C — driving the shell's Select (apps/web/components/app/Select.tsx)
   THROUGH THE UI, now that no page has a native <select> left: Playwright's
   selectOption() only speaks to the browser's control.

   The Select is a <button role="combobox"> (aria-haspopup="listbox") named « its
   label + the current choice », which opens a listbox of role="option" items carrying
   data-value. These helpers do what a person does — open it, pick the option — and
   check it took. */
import { expect, type Locator, type Page } from "@playwright/test";

/** Open `trigger` (a Select's button) and pick the option whose value is `value`. */
export async function chooseOption(page: Page, trigger: Locator, value: string): Promise<void> {
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const listId = await trigger.getAttribute("aria-controls");
  expect(listId, "an open Select names its listbox").toBeTruthy();
  await page.locator(`[id="${listId}"] [role=option][data-value="${value}"]`).click();
  await expect(trigger).toHaveAttribute("data-value", value);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
}

/** A Select found by its accessible name, which STARTS with its label (« Mois de naissance Mars »). */
export function selectByLabel(page: Page, label: string): Locator {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return page.getByRole("combobox", { name: new RegExp(`^${esc} `) });
}

const BIRTH = {
  fr: { month: "Mois de naissance", year: "Année de naissance" },
  ar: { month: "شهر الولادة", year: "عام الولادة" },
} as const;

/** The sign-up birth date (/signup/prof, /signup/eleve): month 1–12 and year, each
    Select found by the name a screen reader announces, in the page's language. */
export async function chooseBirthDate(page: Page, opts: { month: number; year: number; locale?: "fr" | "ar" }): Promise<void> {
  const l = BIRTH[opts.locale ?? "fr"];
  await chooseOption(page, selectByLabel(page, l.month), String(opts.month));
  await chooseOption(page, selectByLabel(page, l.year), String(opts.year));
}
