/* THE CENTRE LEAD FORM'S INPUT (december-sprint · lane B, D13).

   A SUBPATH export (@tnajem/shared/centre-lead-input), never the barrel: zod must
   not reach every client component (the pattern of ./growth-input.ts). The zod
   MESSAGES are the machine error codes the API returns.

   `website` is the honeypot: a hidden field a person never fills. The API accepts
   it in the shape (so a bot gets the same 200 as a person, up to 10 000 characters) and drops the lead
   when it is non-empty. */
import { z } from "zod";
import { CENTRE_LEAD_LIMITS as L } from "./centres";
import { LEVEL_CODES } from "./levels";

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "too-long")
    .optional()
    .transform((v) => (v ? v : undefined));

export const centreLeadInputSchema = z.object({
  name: z.string().trim().min(2, "invalid-name").max(L.name, "invalid-name"),
  centreName: z.string().trim().min(2, "invalid-centre").max(L.centreName, "invalid-centre"),
  city: z.string().trim().min(2, "invalid-city").max(L.city, "invalid-city"),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ]+$/, "invalid-phone")
    .refine((v) => {
      const d = v.replace(/\D/g, "").length;
      return d >= L.phoneMin && d <= L.phoneMax;
    }, "invalid-phone"),
  teachersCount: z.number({ error: "invalid-teachers" }).int("invalid-teachers").min(1, "invalid-teachers").max(L.teachersMax, "invalid-teachers").nullish(),
  /* AN ARRAY FIELD: the API route MUST read the body through apps/api/src/lib/parse-body.ts
     (parseBody), never a bare safeParse (GHSA-mrhx memory blow-up), and be listed in
     apps/api/test/sec-array-body-memory.test.ts with field "levels". */
  levels: z.array(z.enum(LEVEL_CODES, { error: "invalid-levels" })).max(LEVEL_CODES.length, "invalid-levels").default([]),
  message: optText(L.message),
  locale: z.enum(["fr", "ar"], { error: "invalid-locale" }),
  page: z.string().trim().min(1, "invalid-page").max(L.page, "invalid-page"),
  utmSource: optText(L.utm),
  utmMedium: optText(L.utm),
  utmCampaign: optText(L.utm),
  referrer: optText(L.referrer),
  /** Honeypot. */
  website: z.string().max(10_000).optional(),
});

export type CentreLeadInput = z.infer<typeof centreLeadInputSchema>;
