"use server";
/* december-sprint · F (D19) — the bookings export's preview, for /admin/exports.

   THIN, ON PURPOSE. Who is an admin, what a valid query is, which tutors exist and
   what may be shown are all the API's decisions (apps/api/src/routes/bookings-export.ts,
   behind requireAdmin). This only forwards the session cookie and the query. */
import { call } from "@/lib/api";
import { demoFallback } from "@/lib/backend";

export type BookingExportRow = {
  classAt: string;
  tutorName: string;
  tutorSlug: string;
  classTitle: string;
  classLevel: string | null;
  studentName: string | null;
  status: string | null;
  bookedAt: string;
  cancelledAt: string | null;
  priceTnd: string | null;
};

export type BookingExportPreview = {
  ok: boolean;
  error?: string;
  from?: string;
  to?: string;
  tutors?: { slug: string; name: string; bookings: number }[];
  unknown?: string[];
  total?: number;
  byStatus?: Record<"reserved" | "paid" | "attended" | "cancelled", number>;
  sample?: BookingExportRow[];
  rowLimit?: number;
  maxTutors?: number;
  maxDays?: number;
};

const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 8_000) : "");

/** With an empty query the API answers "forbidden" to a non-admin and
    "missing-tutors" to an admin — which is how the page learns which one it is. */
export async function previewBookingsExport(input: { tutors: string; from: string; to: string }): Promise<BookingExportPreview> {
  if (demoFallback) return { ok: false, error: "forbidden" };
  const i = (input ?? {}) as Record<string, unknown>;
  const q = new URLSearchParams({ tutors: str(i.tutors), from: str(i.from), to: str(i.to) });
  return call<BookingExportPreview>(`/admin/bookings-export?${q.toString()}`, undefined, "GET");
}
