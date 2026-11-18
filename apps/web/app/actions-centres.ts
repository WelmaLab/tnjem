"use server";
/* december-sprint · B (D13) — the centre lead form and the admin's lead list.

   THIN, ON PURPOSE. Every decision is the API's (apps/api/src/routes/centre-leads.ts):
   validation, the honeypot, the rate limit, and — for the three admin calls — who is
   an admin (requireAdmin). This file only forwards: call() sends the session cookie
   and the client's address (the rate limiter's key), and returns what the API said. */
import type { CentreLeadStatus } from "@tnajem/shared";
import { call } from "@/lib/api";
import { demoFallback } from "@/lib/backend";

export type CentreLeadForm = {
  name: string;
  centreName: string;
  city: string;
  phone: string;
  teachersCount: number | null;
  levels: string[];
  message: string;
  locale: "fr" | "ar";
  page: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  referrer?: string;
  website: string;
};

export type CentreLeadResult = { ok: boolean; error?: string; field?: string; retryAfter?: number };

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

export async function submitCentreLead(input: CentreLeadForm): Promise<CentreLeadResult> {
  if (demoFallback) return { ok: false, error: "unavailable" };
  /* Only the form's own keys travel; their values are the API's to judge. A server
     action can be called with anything, so nothing here trusts the shape. */
  const i = (input ?? {}) as Record<string, unknown>;
  return call<CentreLeadResult>("/centre-leads", {
    name: str(i.name) ?? "",
    centreName: str(i.centreName) ?? "",
    city: str(i.city) ?? "",
    phone: str(i.phone) ?? "",
    teachersCount: i.teachersCount ?? null,
    levels: i.levels ?? [],
    message: str(i.message),
    locale: i.locale,
    page: str(i.page) ?? "",
    utmSource: str(i.utmSource),
    utmMedium: str(i.utmMedium),
    utmCampaign: str(i.utmCampaign),
    referrer: str(i.referrer),
    website: str(i.website) ?? "",
  });
}

export type AdminCentreLead = {
  id: string;
  createdAt: string;
  updatedAt: string;
  name: string;
  centreName: string;
  city: string;
  phone: string;
  teachersCount: number | null;
  levels: string[];
  message: string | null;
  locale: string;
  page: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  referrer: string | null;
  status: CentreLeadStatus;
};

export async function listCentreLeads(): Promise<{ ok: boolean; error?: string; leads?: AdminCentreLead[]; capped?: boolean; limit?: number }> {
  if (demoFallback) return { ok: false, error: "forbidden" };
  return call("/admin/centre-leads", undefined, "GET");
}

export async function setCentreLeadStatus(id: string, status: CentreLeadStatus): Promise<{ ok: boolean; error?: string; lead?: AdminCentreLead }> {
  if (demoFallback) return { ok: false, error: "forbidden" };
  return call(`/admin/centre-leads/${encodeURIComponent(String(id))}`, { status }, "PATCH");
}
