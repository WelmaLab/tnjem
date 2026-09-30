/* Type a code into the six-box OTP field (components/auth/OtpInput.tsx).

   Auth Option B replaced the single `placeholder="000000"` input with six boxes.
   The code goes into the FIRST box in one fill(): OtpInput has no maxLength and
   distributes a multi-digit value across the boxes, because that is exactly what
   iOS/Android SMS autofill (autocomplete="one-time-code") delivers — all six digits
   into the first box at once. So this helper exercises the autofill path, not six
   keystrokes; typing and paste are pinned separately in auth-option-b.spec.ts.

   The check reads all six boxes in ONE evaluateAll round trip, straight after the
   fill. OtpInput's onComplete fires on the sixth digit and starts a verify, and a
   successful verify navigates away (the boxes unmount). That verify is a server
   action → the API → Postgres → an RSC fetch of the next page, tens of ms at the
   very least; one CDP round trip is a few ms. Six separate retrying assertions
   would be a race the product never promised to lose; one snapshot is not.

   `check: false` is for the one flow where the boxes vanish in the SAME render as
   the value lands: a signup with no birth date, where the verify is refused on the
   client and the form goes straight back to step 1 (the A24 guarantee). */
import { expect, type Page } from "@playwright/test";

export const OTP_GROUP = '[data-e2e="otp"]';
export const OTP_DIGIT = '[data-e2e="otp"] input[data-e2e="otp-digit"]';

export async function fillOtp(page: Page, code: string, opts: { check?: boolean } = {}): Promise<void> {
  expect(code, "an OTP is six digits").toMatch(/^\d{6}$/);
  const boxes = page.locator(OTP_DIGIT);
  await expect(boxes, "the code step shows six digit boxes").toHaveCount(6, { timeout: 20_000 });

  await boxes.first().fill(code);
  if (opts.check === false) return;

  const values = await boxes.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
  expect(values, "the six digits are distributed one per box, in order").toEqual(code.split(""));
}
