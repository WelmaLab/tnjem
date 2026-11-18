/* THE CENTRE PACKS AND THEIR SWITCHES (december-sprint · lane B, D12 + gate 8).

   One file the founder edits: the three setup packs a tutoring centre buys, and
   the switches that decide what /pour-les-centres says about them. Pure values —
   safe in the barrel and in client components.

   A centre pays a FIXED pack price. No commission is taken on the centre's own
   pupils for the period the pack covers. That is a property of the pack, never a
   permanent promise: the page must not say "jamais" or "pour toujours". */

export type CentrePackCode = "stage" | "fondateur" | "academie";

export interface CentrePack {
  code: CentrePackCode;
  name: { fr: string; ar: string };
  /** Price in TND, excluding tax (HT). Shown ONLY while SHOW_PACK_PRICES is true. */
  priceTndHt: number;
  /** A cap on how many centres can buy it, or null. */
  maxCentres: number | null;
}

export const CENTRE_PACKS: readonly CentrePack[] = [
  { code: "stage", name: { fr: "Stage en ligne", ar: "ستاج أونلاين" }, priceTndHt: 350, maxCentres: null },
  { code: "fondateur", name: { fr: "Centre Fondateur", ar: "مركز مؤسّس" }, priceTndHt: 790, maxCentres: 10 },
  { code: "academie", name: { fr: "Académie", ar: "أكاديمية" }, priceTndHt: 1490, maxCentres: null },
];

/** false = the page shows « Prix sur demande. Réponse sous 24 heures. » and no amount.
    Walid sets it to true once he confirms the prices. */
export const SHOW_PACK_PRICES = false;

/** false = no refund line anywhere on the page. */
export const SHOW_REFUND_GUARANTEE = false;

/** false = the reminder key point is hidden. When true the page adds:
    « Vos élèves reçoivent un rappel par email 24 h et 1 h avant chaque cours. »
    (true today in code: apps/api/src/lib/reminders.ts — but it only reaches pupils
    with an e-mail address, and only if the reminders cron is scheduled.) */
export const SHOW_REMINDERS_LINE = false;

/* ── The lead form ─────────────────────────────────────────────────────────── */

/** Lead statuses, in the order an admin moves a lead through them (SQL CHECK in 0044). */
export const CENTRE_LEAD_STATUSES = ["new", "contacted", "won", "lost"] as const;
export type CentreLeadStatus = (typeof CENTRE_LEAD_STATUSES)[number];

export function isCentreLeadStatus(raw: unknown): raw is CentreLeadStatus {
  return typeof raw === "string" && (CENTRE_LEAD_STATUSES as readonly string[]).includes(raw);
}

/** Field limits, shared by the form and the API validator (./centre-lead-input.ts). */
export const CENTRE_LEAD_LIMITS = {
  name: 80,
  centreName: 120,
  city: 60,
  phoneMin: 8,
  phoneMax: 20,
  teachersMax: 500,
  message: 1000,
  utm: 100,
  referrer: 300,
  page: 200,
} as const;
