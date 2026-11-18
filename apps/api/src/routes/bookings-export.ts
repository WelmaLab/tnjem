import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, asc, bookings, classes, count, eq, gte, inArray, lt, or, profiles, sql as raw, tutors } from "@tnajem/db";
import { isLevelCode, levelLabel, publicDisplayName, tunisWallTime, wallTimeToInstant } from "@tnajem/shared";
import { db } from "../db";
import { requireAdmin } from "../lib/admin";
import { auditAdminStrict } from "../lib/audit";
import { csvFile } from "../lib/csv";

/* december-sprint · F (D19, gate amendment 4) — the centre export.

   GET /admin/bookings-export      admin: a JSON PREVIEW (counts per tutor and status,
                                   the first rows) so the page shows what the file
                                   will hold before anyone downloads it.
   GET /admin/bookings-export.csv  admin: the bookings themselves, as a spreadsheet.

   Both take ?tutors=<slugs or account e-mails, separated by commas, spaces or new
   lines>&from=YYYY-MM-DD&to=YYYY-MM-DD. A centre is a list of tutors for now.

   WHAT IS EXPORTED: bookings and their status, and nothing else. No attendance
   exists — bookings.status is reserved | paid | attended | cancelled, and the only
   values ever written are reserved and cancelled (the page says so). A booking is in
   the range when its CLASS starts on one of those days IN TUNIS (Africa/Tunis):
   from 00:00 on `from` to 00:00 the day after `to`, exclusive.

   DATA MINIMISATION: what a centre needs to know who booked which class. The student
   appears as a tutor already sees them — first name only, publicDisplayName — and
   never with an e-mail, a phone, a birth date or an id.

   ORDER: requireAdmin before anything is read; then validation; then the tutors are
   resolved (an unknown one is REPORTED: listed in the preview, and the CSV refuses
   with the list rather than quietly exporting fewer tutors than asked); then the
   disclosure is written to the append-only audit log BEFORE any booking is read
   (auditAdminStrict: no record, no disclosure). Never sent anywhere automatically:
   the file exists only as the response to an admin's request. */

export const MAX_TUTORS = 50;
export const MAX_RANGE_DAYS = 366;
/** The CSV refuses beyond this rather than truncating silently. */
export const EXPORT_ROW_LIMIT = 20_000;
let rowLimit = EXPORT_ROW_LIMIT;
/** Tests only: a small cap, so the refusal is provable without 20 000 rows. null restores it. */
export function setExportRowLimitForTests(n: number | null): void {
  rowLimit = n ?? EXPORT_ROW_LIMIT;
}
export const PREVIEW_ROWS = 20;
const MAX_QUERY_CHARS = 8_000;

const STATUSES = ["reserved", "paid", "attended", "cancelled"] as const;
type BookingStatus = (typeof STATUSES)[number];

export type ExportQuery = { tokens: string[]; from: string; to: string; start: Date; end: Date };
type QueryError =
  | "missing-tutors" | "too-many-tutors" | "invalid-tutors"
  | "invalid-from" | "invalid-to" | "range-reversed" | "range-too-long";

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "YYYY-MM-DD" → the instant 00:00 that day in Tunis, or null (bad shape, 30 Feb). */
export function tunisDayStart(day: string): Date | null {
  const m = DAY.exec(day);
  if (!m) return null;
  return wallTimeToInstant({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), hour: 0, minute: 0 });
}

/** The day after a "YYYY-MM-DD", as "YYYY-MM-DD" (calendar arithmetic, no zone involved). */
function nextDay(day: string): string {
  const [y, mo, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d + 1)).toISOString().slice(0, 10);
}

/** The tutor list as typed: split on commas, semicolons and white space, lower-cased, deduped. */
export function splitTutorTokens(raw: unknown): string[] | null {
  const parts = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  if (!parts.every((p) => typeof p === "string")) return null;
  const joined = (parts as string[]).join(",");
  if (joined.length > MAX_QUERY_CHARS) return null;
  const out: string[] = [];
  for (const t of joined.split(/[\s,;]+/)) {
    const v = t.trim().toLowerCase();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

export function parseExportQuery(q: Record<string, unknown>): { ok: true; query: ExportQuery } | { ok: false; error: QueryError } {
  const tokens = splitTutorTokens(q.tutors);
  if (tokens === null) return { ok: false, error: "invalid-tutors" };
  if (tokens.length === 0) return { ok: false, error: "missing-tutors" };
  if (tokens.length > MAX_TUTORS) return { ok: false, error: "too-many-tutors" };
  if (tokens.some((t) => t.length > 254)) return { ok: false, error: "invalid-tutors" };
  const from = typeof q.from === "string" ? q.from.trim() : "";
  const to = typeof q.to === "string" ? q.to.trim() : "";
  const start = tunisDayStart(from);
  if (!start) return { ok: false, error: "invalid-from" };
  if (!tunisDayStart(to)) return { ok: false, error: "invalid-to" };
  if (to < from) return { ok: false, error: "range-reversed" };
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  if (days > MAX_RANGE_DAYS) return { ok: false, error: "range-too-long" };
  const end = tunisDayStart(nextDay(to));
  if (!end) return { ok: false, error: "invalid-to" };
  return { ok: true, query: { tokens, from, to, start, end } };
}

type FoundTutor = { id: string; slug: string; name: string };

/** Each token matched to a tutor by slug or by the e-mail of the tutor's account. */
async function resolveTutors(tokens: string[]): Promise<{ found: FoundTutor[]; unknown: string[] }> {
  const emails = tokens.filter((t) => t.includes("@"));
  const slugs = tokens.filter((t) => !t.includes("@"));
  const conds = [
    slugs.length ? inArray(raw`lower(${tutors.slug})`, slugs) : undefined,
    emails.length ? inArray(raw`lower(${profiles.email})`, emails) : undefined,
  ].filter((c) => c !== undefined);
  const rows = await db
    .select({ id: tutors.id, slug: tutors.slug, name: tutors.fullName, email: profiles.email })
    .from(tutors)
    .leftJoin(profiles, eq(profiles.id, tutors.profileId))
    .where(conds.length === 1 ? conds[0] : or(...conds));
  const unknown = tokens.filter((t) => !rows.some((r) => r.slug.toLowerCase() === t || (r.email ?? "").toLowerCase() === t));
  const found: FoundTutor[] = [];
  for (const r of rows) if (!found.some((f) => f.id === r.id)) found.push({ id: r.id, slug: r.slug, name: r.name });
  found.sort((a, b) => a.slug.localeCompare(b.slug));
  return { found, unknown };
}

const inRange = (ids: string[], q: ExportQuery) =>
  and(inArray(classes.tutorId, ids), gte(classes.scheduledAt, q.start), lt(classes.scheduledAt, q.end));

/** The latest cancellation of the booking (0026: one ledger row per cancellation). */
const cancelledAtSql = raw<Date | string | null>`(select max(x.cancelled_at) from cancellations x where x.booking_id = ${bookings.id})`;

export type ExportRow = {
  classAt: Date | string;
  tutorName: string;
  tutorSlug: string;
  classTitle: string;
  classLevel: string | null;
  studentName: string | null;
  status: string | null;
  bookedAt: Date | string;
  cancelledAt: Date | string | null;
  priceTnd: string | null;
};

async function exportRows(ids: string[], q: ExportQuery, limit?: number): Promise<ExportRow[]> {
  const base = db
    .select({
      classAt: classes.scheduledAt,
      tutorName: tutors.fullName,
      tutorSlug: tutors.slug,
      classTitle: classes.title,
      classLevel: classes.level,
      studentFullName: profiles.fullName, // reduced to the first name below, never sent whole
      status: bookings.status,
      bookedAt: bookings.createdAt,
      cancelledAt: cancelledAtSql,
      priceTnd: bookings.priceTnd,
    })
    .from(bookings)
    .innerJoin(classes, eq(classes.id, bookings.classId))
    .innerJoin(tutors, eq(tutors.id, classes.tutorId))
    .leftJoin(profiles, eq(profiles.id, bookings.studentId))
    .where(inRange(ids, q))
    .orderBy(asc(classes.scheduledAt), asc(tutors.slug), asc(classes.id), asc(bookings.createdAt), asc(bookings.id));
  const rows = limit === undefined ? await base : await base.limit(limit);
  return rows.map(({ studentFullName, ...r }) => ({ ...r, studentName: publicDisplayName(studentFullName) }));
}

async function countsByTutorAndStatus(ids: string[], q: ExportQuery) {
  return db
    .select({ tutorId: classes.tutorId, status: bookings.status, n: count() })
    .from(bookings)
    .innerJoin(classes, eq(classes.id, bookings.classId))
    .where(inRange(ids, q))
    .groupBy(classes.tutorId, bookings.status);
}

/* ── formatting ─────────────────────────────────────────────────────────────── */
const pad = (n: number) => String(n).padStart(2, "0");
/** "2026-12-05 18:00", Tunis wall clock. */
export function tunisStamp(at: Date | string | null): string {
  if (at === null) return "";
  const w = tunisWallTime(at);
  return `${w.year}-${pad(w.month)}-${pad(w.day)} ${pad(w.hour)}:${pad(w.minute)}`;
}
/** French Excel reads « 40,00 » as a number (the file is « ; »-separated for it). */
const frenchDecimal = (v: string | null) => (v === null ? "" : v.replace(".", ","));
const levelFr = (v: string | null) => (v && isLevelCode(v) ? levelLabel(v, "fr") : (v ?? ""));

export const EXPORT_COLUMNS: readonly (readonly [string, (r: ExportRow) => unknown])[] = [
  ["class_date", (r) => tunisStamp(r.classAt).slice(0, 10)],
  ["class_time", (r) => tunisStamp(r.classAt).slice(11)],
  ["tutor_name", (r) => r.tutorName],
  ["tutor_slug", (r) => r.tutorSlug],
  ["class_title", (r) => r.classTitle],
  ["class_level", (r) => levelFr(r.classLevel)],
  ["student_first_name", (r) => r.studentName],
  ["booking_status", (r) => r.status],
  ["booked_at", (r) => tunisStamp(r.bookedAt)],
  ["cancelled_at", (r) => (r.status === "cancelled" ? tunisStamp(r.cancelledAt) : "")],
  ["price_tnd", (r) => frenchDecimal(r.priceTnd)],
];

export const bookingsCsv = (rows: ExportRow[]) => csvFile(EXPORT_COLUMNS, rows);

/** A row as the preview shows it: the same fields as the CSV, already formatted. */
function previewRow(r: ExportRow) {
  return {
    classAt: tunisStamp(r.classAt),
    tutorName: r.tutorName,
    tutorSlug: r.tutorSlug,
    classTitle: r.classTitle,
    classLevel: r.classLevel,
    studentName: r.studentName,
    status: r.status,
    bookedAt: tunisStamp(r.bookedAt),
    cancelledAt: r.status === "cancelled" ? tunisStamp(r.cancelledAt) || null : null,
    priceTnd: r.priceTnd,
  };
}

/* ── routes ─────────────────────────────────────────────────────────────────── */
const noStore = (reply: FastifyReply) =>
  reply.header("cache-control", "private, no-store, max-age=0").header("x-content-type-options", "nosniff");

/** What was disclosed, about whom: the resolved tutor slugs (public storefront names), never a student. */
const auditNote = (req: FastifyRequest, q: ExportQuery, found: FoundTutor[]) =>
  `request ${req.id} · ${q.from}..${q.to} · ${found.length} tutor(s): ${found.map((t) => t.slug).join(",")}`;

export async function bookingsExportRoutes(app: FastifyInstance): Promise<void> {
  /* ── GET /admin/bookings-export (JSON preview) ──────────────────────────────
     Domain outcomes are 200 { ok:false, error } like every other admin JSON route
     (the web proxy treats a non-200 as a transport failure). */
  app.get("/admin/bookings-export", async (req, reply) => {
    noStore(reply);
    const session = await requireAdmin(req);
    if (!session) return { ok: false, error: "forbidden" };
    const parsed = parseExportQuery((req.query ?? {}) as Record<string, unknown>);
    if (!parsed.ok) return { ok: false, error: parsed.error, maxTutors: MAX_TUTORS, maxDays: MAX_RANGE_DAYS };
    const q = parsed.query;

    const { found, unknown } = await resolveTutors(q.tokens);
    await auditAdminStrict(session.profile.id, "bookings_export.preview", { kind: "bookings_export", id: "preview" }, auditNote(req, q, found));

    const ids = found.map((t) => t.id);
    const counts = ids.length ? await countsByTutorAndStatus(ids, q) : [];
    const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<BookingStatus, number>;
    const perTutor = new Map<string, number>();
    for (const c of counts) {
      const n = Number(c.n);
      if (c.status && c.status in byStatus) byStatus[c.status as BookingStatus] += n;
      perTutor.set(c.tutorId, (perTutor.get(c.tutorId) ?? 0) + n);
    }
    const total = [...perTutor.values()].reduce((a, b) => a + b, 0);
    const sample = ids.length ? (await exportRows(ids, q, PREVIEW_ROWS)).map(previewRow) : [];
    return {
      ok: true,
      from: q.from,
      to: q.to,
      tutors: found.map((t) => ({ slug: t.slug, name: t.name, bookings: perTutor.get(t.id) ?? 0 })),
      unknown,
      total,
      byStatus,
      sample,
      rowLimit,
    };
  });

  /* ── GET /admin/bookings-export.csv ─────────────────────────────────────── */
  app.get("/admin/bookings-export.csv", async (req, reply) => {
    noStore(reply);
    const json = (code: number, body: Record<string, unknown>) =>
      reply.code(code).type("application/json; charset=utf-8").send({ ok: false, ...body });
    const session = await requireAdmin(req);
    if (!session) return json(403, { error: "forbidden" });
    const parsed = parseExportQuery((req.query ?? {}) as Record<string, unknown>);
    if (!parsed.ok) return json(400, { error: parsed.error });
    const q = parsed.query;

    const { found, unknown } = await resolveTutors(q.tokens);
    // Reported, never dropped: a file with fewer tutors than asked would read as complete.
    if (unknown.length) return json(400, { error: "unknown-tutors", unknown });
    await auditAdminStrict(session.profile.id, "bookings_export.csv", { kind: "bookings_export", id: "csv" }, auditNote(req, q, found));
    const ids = found.map((t) => t.id);
    const [{ n }] = await db.select({ n: count() }).from(bookings).innerJoin(classes, eq(classes.id, bookings.classId)).where(inRange(ids, q));
    // Refused, not truncated: the preview shows the total, so the admin narrows the range.
    if (Number(n) > rowLimit) return json(400, { error: "too-many-rows", total: Number(n), rowLimit });
    return reply
      .type("text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="tnajem-reservations-${q.from}_${q.to}.csv"`)
      .send(bookingsCsv(await exportRows(ids, q)));
  });
}
