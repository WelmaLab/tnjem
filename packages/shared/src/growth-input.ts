/* THE INPUTS OF ESPACE PROF V2 · growth — ONE set of Zod schemas, used by the API
   routes and, where a form wants to pre-check, by the teacher's own pages.

   A SUBPATH export (@tnajem/shared/growth-input), never the barrel: zod must not
   reach every client component (see ./index.ts and ./class-input.ts, the pattern
   this follows). The zod MESSAGES are the machine error codes the API returns, so
   a form maps them to its own FR/AR copy.

     offers       title 3–80, 1–31 sessions a month, price > 0 (≤ 5000 TND)
     promotions   1–20 % (the cap, enforced here AND in SQL AND in pricing.ts),
                  optional code, scope + target, a window that ends after it starts
                  and within 180 days, optional max uses
     subscription request, promo code check, share/stat inputs */
import { z } from "zod";
import { OFFER_PRICE_MAX, OFFER_SESSIONS_MAX, OFFER_SESSIONS_MIN, OFFER_TITLE_MAX } from "./offers";
import { PROMO_PERCENT_MAX, PROMO_PERCENT_MIN, PROMO_SCOPES } from "./pricing";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "not-found");

export const offerInputSchema = z.object({
  title: z.string().trim().min(3, "invalid-title").max(OFFER_TITLE_MAX, "title-too-long"),
  sessionsPerMonth: z
    .number({ invalid_type_error: "invalid-sessions" })
    .int("invalid-sessions")
    .min(OFFER_SESSIONS_MIN, "invalid-sessions")
    .max(OFFER_SESSIONS_MAX, "invalid-sessions"),
  priceTnd: z
    .number({ invalid_type_error: "invalid-price" })
    .finite("invalid-price")
    .gt(0, "price-must-be-positive")
    .max(OFFER_PRICE_MAX, "price-too-high"),
  active: z.boolean().optional(),
});
export type OfferInput = z.output<typeof offerInputSchema>;

/** An edit: any subset of the fields, same rules. */
export const offerPatchSchema = offerInputSchema.partial();

export const PROMO_MAX_DAYS = 180;

export const promotionInputSchema = z
  .object({
    percent: z
      .number({ invalid_type_error: "percent-out-of-range" })
      .int("percent-out-of-range")
      .min(PROMO_PERCENT_MIN, "percent-out-of-range")
      .max(PROMO_PERCENT_MAX, "percent-out-of-range"),
    code: z
      .string()
      .trim()
      .transform((s) => s.toUpperCase())
      .pipe(z.string().regex(/^[A-Z0-9-]{3,20}$/, "invalid-code"))
      .nullable()
      .optional(),
    scope: z.enum(PROMO_SCOPES, { errorMap: () => ({ message: "invalid-scope" }) }),
    targetId: uuid.nullable().optional(),
    /** ISO instants. Absent start = now. */
    startsAt: z.string().datetime({ offset: true, message: "invalid-dates" }).optional(),
    endsAt: z.string().datetime({ offset: true, message: "invalid-dates" }),
    maxUses: z.number().int("invalid-max-uses").min(1, "invalid-max-uses").max(100_000, "invalid-max-uses").nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if ((v.scope === "class" || v.scope === "pack") && !v.targetId) ctx.addIssue({ code: "custom", message: "target-required" });
    if (v.scope === "all" && v.targetId) ctx.addIssue({ code: "custom", message: "target-not-allowed" });
    const start = v.startsAt ? Date.parse(v.startsAt) : Date.now();
    const end = Date.parse(v.endsAt);
    if (!(end > start)) ctx.addIssue({ code: "custom", message: "invalid-dates" });
    if (end - start > PROMO_MAX_DAYS * 86_400_000) ctx.addIssue({ code: "custom", message: "too-long" });
  });
export type PromotionInput = z.output<typeof promotionInputSchema>;

export const subscriptionRequestSchema = z.object({
  offerId: uuid,
  promoCode: z.string().max(40).nullable().optional(),
});

/** The first issue's code, in the API's `{ ok, value | error }` shape. */
export function checkInput<S extends z.ZodTypeAny>(
  schema: S,
  input: unknown,
): { ok: true; value: z.output<S> } | { ok: false; error: string } {
  const r = schema.safeParse(input);
  if (r.success) return { ok: true, value: r.data };
  return { ok: false, error: r.error.issues[0]?.message ?? "bad-request" };
}
