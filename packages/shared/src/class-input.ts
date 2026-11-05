/* THE LIMITS OF A CLASS — ONE schema, imported by the new-class form AND by
   POST /classes. Phase A · A18.16 (lane L5).

   They disagreed: the form said title ≤ 80, duration ≤ 240, seats ≤ 200; the
   server said 120, 480 and 500. So a crafted POST published what the form called
   impossible, and the form refused what the server allowed. Now both read this.

   FOUNDER defaults (spec A18.16): title 120 characters, duration 240 minutes,
   seats 200. Price and description keep the server's existing limits.

   The zod MESSAGES are the machine error codes the API has always returned
   (invalid-title, title-too-long, invalid-duration, invalid-seats,
   negative-price, price-too-high, description-too-long), so the form's
   field mapping and every existing caller keep working.

   A SUBPATH export (@tnajem/shared/class-input), never the barrel: the barrel is
   imported by every client component and must not drag zod into them (see the
   header of ./index.ts). Only the new-class page pays for it. */
import { z } from "zod";

export const CLASS_LIMITS = {
  titleMin: 3,
  titleMax: 120, // FOUNDER default
  descriptionMax: 1000,
  durationMin: 15,
  durationMax: 240, // FOUNDER default (minutes)
  seatsMin: 1,
  seatsMax: 200, // FOUNDER default
  priceMax: 5000,
} as const;

const L = CLASS_LIMITS;

export const classLimitsSchema = z.object({
  title: z.string().trim().min(L.titleMin, "invalid-title").max(L.titleMax, "title-too-long"),
  description: z.string().trim().max(L.descriptionMax, "description-too-long").optional(),
  durationMin: z
    .number({ error: "invalid-duration" })
    .int("invalid-duration")
    .min(L.durationMin, "invalid-duration")
    .max(L.durationMax, "invalid-duration"),
  seats: z
    .number({ error: "invalid-seats" })
    .int("invalid-seats")
    .min(L.seatsMin, "invalid-seats")
    .max(L.seatsMax, "invalid-seats"),
  priceTnd: z
    .number({ error: "invalid-price" })
    .finite("invalid-price")
    .min(0, "negative-price")
    .max(L.priceMax, "price-too-high"),
});

export type ClassLimitsInput = z.input<typeof classLimitsSchema>;

/** The limits check, as the API's `{ ok, value | error }` shape: the first issue's code. */
export function checkClassLimits(
  input: ClassLimitsInput,
): { ok: true; value: z.output<typeof classLimitsSchema> } | { ok: false; error: string } {
  const r = classLimitsSchema.safeParse(input);
  if (r.success) return { ok: true, value: r.data };
  return { ok: false, error: r.error.issues[0]?.message ?? "bad-request" };
}
