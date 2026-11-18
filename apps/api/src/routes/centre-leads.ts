import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { centreLeads, desc, eq, sql as raw } from "@tnajem/db";
import { CENTRE_LEAD_STATUSES, isUuid, LEVEL_CODES, sortLevels } from "@tnajem/shared";
import { centreLeadInputSchema } from "@tnajem/shared/centre-lead-input";
import { db } from "../db";
import { requireAdmin } from "../lib/admin";
import { auditAdmin, auditAdminStrict } from "../lib/audit";
import { checkRateLimit, ipBucket, rlSubject } from "../lib/rate-limit";
import { parseBody } from "../lib/parse-body";
import { sendCentreLeadMail } from "../lib/centre-lead-mail";

/* december-sprint · B (D13) — the centre lead form, and the admin's view of it.

   POST /centre-leads                 PUBLIC. One lead from /<locale>/pour-les-centres.
   GET  /admin/centre-leads           admin: the list, newest first.
   PATCH /admin/centre-leads/:id      admin: new → contacted → won | lost.
   GET  /admin/centre-leads.csv       admin: the same rows as a spreadsheet.

   LEADS ARE PERSONAL DATA (gate amendment 9): a name and a phone number. Every admin
   route asks requireAdmin() itself — the web side only forwards the session cookie
   and decides nothing. Reading the list and exporting it are DISCLOSURES, so they are
   written to the append-only audit log BEFORE the data leaves (auditAdminStrict: no
   record, no disclosure). How long a lead is kept is CENTRE_LEAD_RETENTION_DAYS in
   @tnajem/shared/legal (LEGAL-REVIEW, not decided, no purge built).

   NO RAW IP is stored: not in centre_leads (no column), and the rate-limit key is a
   keyed hash of the address's bucket (rlSubject), as for the unsubscribe limiter.

   THE HONEYPOT (`website`): any non-empty value — a string, a number, an object —
   gets the same 200 { ok: true } as a person, and nothing is stored or mailed. It is
   checked before validation, so a bot learns nothing from field errors either.

   ARRAYS (`levels`): the body is read through lib/parse-body (GHSA-mrhx), and a
   `levels` that is not a short array is refused with a 400 before zod sees it. With
   that bound in place, a body that fails is parsed once more only to name the FIRST
   problem as a machine code the form translates (« invalid-phone »…). */

/* TWO BUDGETS, per hashed address bucket and per hour. A loose one every request
   spends (it bounds the work a script can make the route do), and the strict one,
   spent only by a lead that would really be stored: the body parsed and the honeypot
   empty. So a typo that comes back as a field error, or a bot caught by the
   honeypot, never eats the 5 a real centre has. */
const LOOSE_LIMIT = 30;
const STRICT_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60_000;
/** The admin LIST is capped (the page says so when it is); the CSV export is not. */
export const LIST_LIMIT = 500;

const statusBody = z.object({ status: z.enum(CENTRE_LEAD_STATUSES) });

type LeadRow = typeof centreLeads.$inferSelect;

const iso = (d: Date | string) => new Date(d).toISOString();

function toAdminLead(r: LeadRow) {
  return {
    id: r.id,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
    name: r.name,
    centreName: r.centreName,
    city: r.city,
    phone: r.phone,
    teachersCount: r.teachersCount,
    levels: sortLevels(r.levels),
    message: r.message,
    locale: r.locale,
    page: r.page,
    utmSource: r.utmSource,
    utmMedium: r.utmMedium,
    utmCampaign: r.utmCampaign,
    referrer: r.referrer,
    status: r.status,
  };
}

/* ── CSV ──────────────────────────────────────────────────────────────────────
   For French Excel (the founder's): « ; » between cells, the separator it expects
   under a French locale. Otherwise RFC 4180: every cell quoted (so a « ; » or a
   newline inside a cell stays in it), a quote doubled, CRLF between rows. A cell that a
   spreadsheet would run as a formula (= + - @, or a tab / CR that some apps strip
   first) gets a leading apostrophe — a visitor writes the text, an admin opens it.
   The file starts with a UTF-8 BOM so Excel shows accents and Arabic. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

const CSV_COLUMNS: [string, (r: ReturnType<typeof toAdminLead>) => unknown][] = [
  ["created_at", (r) => r.createdAt],
  ["status", (r) => r.status],
  ["name", (r) => r.name],
  ["centre_name", (r) => r.centreName],
  ["city", (r) => r.city],
  ["phone", (r) => r.phone],
  ["teachers_count", (r) => r.teachersCount],
  ["levels", (r) => r.levels.join(" ")],
  ["message", (r) => r.message],
  ["locale", (r) => r.locale],
  ["page", (r) => r.page],
  ["utm_source", (r) => r.utmSource],
  ["utm_medium", (r) => r.utmMedium],
  ["utm_campaign", (r) => r.utmCampaign],
  ["referrer", (r) => r.referrer],
  ["updated_at", (r) => r.updatedAt],
  ["id", (r) => r.id],
];

export const CSV_SEP = ";";

export function leadsCsv(rows: ReturnType<typeof toAdminLead>[]): string {
  const lines = [CSV_COLUMNS.map(([h]) => csvCell(h)).join(CSV_SEP)];
  for (const r of rows) lines.push(CSV_COLUMNS.map(([, get]) => csvCell(get(r))).join(CSV_SEP));
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** Newest first. `limit` for the list; the export passes none and gets every row. */
async function newestLeads(limit?: number) {
  const q = db.select().from(centreLeads).orderBy(desc(centreLeads.createdAt));
  const rows = limit === undefined ? await q : await q.limit(limit);
  return rows.map(toAdminLead);
}

const ipKey = (kind: "any" | "ip", ip: string | undefined) => `centre-lead:${kind}:${rlSubject(ipBucket(ip))}`;

/** Any value a person would not have typed into a hidden field counts as filled. */
function honeypotFilled(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim() !== "";
  return true;
}

export async function centreLeadRoutes(app: FastifyInstance): Promise<void> {
  /* ── POST /centre-leads (public) ─────────────────────────────────────────── */
  app.post("/centre-leads", async (req, reply) => {
    const body = req.body as Record<string, unknown> | null | undefined;
    if (!body || typeof body !== "object" || Array.isArray(body)) return reply.code(400).send({ error: "bad-request" });
    // The array bound, before any schema runs (see the header).
    if (body.levels !== undefined && (!Array.isArray(body.levels) || body.levels.length > LEVEL_CODES.length)) {
      return reply.code(400).send({ error: "bad-request" });
    }

    const loose = await checkRateLimit(ipKey("any", req.ip), LOOSE_LIMIT, RATE_WINDOW_MS);
    if (!loose.ok) return { ok: false, error: "rate-limited", retryAfter: loose.retryAfter };

    // Honeypot: the same answer as a person, nothing stored, nothing sent, no strict budget spent.
    if (honeypotFilled(body.website)) return { ok: true };

    const parsed = parseBody(centreLeadInputSchema, body);
    if (!parsed.success) {
      // Bounded above, so this second pass is cheap; it only names the first problem.
      const detail = centreLeadInputSchema.safeParse(body);
      const issue = detail.success ? undefined : detail.error.issues[0];
      const code = issue && /^[a-z-]+$/.test(issue.message) ? issue.message : "invalid";
      const field = issue?.path[0];
      return { ok: false, error: code, ...(typeof field === "string" ? { field } : {}) };
    }
    const input = parsed.data;

    // Only a lead that would be stored spends the strict budget.
    const strict = await checkRateLimit(ipKey("ip", req.ip), STRICT_LIMIT, RATE_WINDOW_MS);
    if (!strict.ok) return { ok: false, error: "rate-limited", retryAfter: strict.retryAfter };

    const [row] = await db
      .insert(centreLeads)
      .values({
        name: input.name,
        centreName: input.centreName,
        city: input.city,
        phone: input.phone,
        teachersCount: input.teachersCount ?? null,
        levels: sortLevels(input.levels),
        message: input.message ?? null,
        locale: input.locale,
        page: input.page,
        utmSource: input.utmSource ?? null,
        utmMedium: input.utmMedium ?? null,
        utmCampaign: input.utmCampaign ?? null,
        referrer: input.referrer ?? null,
      })
      .returning();

    // After the commit, never awaited: a mail failure cannot lose the lead.
    sendCentreLeadMail({
      id: row.id,
      name: row.name,
      centreName: row.centreName,
      city: row.city,
      phone: row.phone,
      teachersCount: row.teachersCount,
      levels: row.levels,
      message: row.message,
      locale: row.locale === "ar" ? "ar" : "fr",
      page: row.page,
      utmSource: row.utmSource,
      utmMedium: row.utmMedium,
      utmCampaign: row.utmCampaign,
      referrer: row.referrer,
    });
    return { ok: true };
  });

  /* ── GET /admin/centre-leads ─────────────────────────────────────────────── */
  app.get("/admin/centre-leads", async (req) => {
    const session = await requireAdmin(req);
    if (!session) return { ok: false, error: "forbidden" };
    await auditAdminStrict(session.profile.id, "centre_leads.read", { kind: "centre_leads", id: "list" }, `request ${req.id}`);
    // One more than shown, to know whether the list is capped (the page says so).
    const rows = await newestLeads(LIST_LIMIT + 1);
    return { ok: true, leads: rows.slice(0, LIST_LIMIT), capped: rows.length > LIST_LIMIT, limit: LIST_LIMIT };
  });

  /* ── GET /admin/centre-leads.csv ─────────────────────────────────────────── */
  app.get("/admin/centre-leads.csv", async (req, reply) => {
    const session = await requireAdmin(req);
    reply.header("cache-control", "private, no-store, max-age=0").header("x-content-type-options", "nosniff");
    if (!session) return reply.code(403).type("application/json; charset=utf-8").send({ ok: false, error: "forbidden" });
    await auditAdminStrict(session.profile.id, "centre_leads.export", { kind: "centre_leads", id: "csv" }, `request ${req.id}`);
    const day = new Date().toISOString().slice(0, 10);
    return reply
      .type("text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="tnajem-centre-leads-${day}.csv"`)
      .send(leadsCsv(await newestLeads())); // every row, not capped
  });

  /* ── PATCH /admin/centre-leads/:id ───────────────────────────────────────── */
  app.patch<{ Params: { id: string } }>("/admin/centre-leads/:id", async (req) => {
    const session = await requireAdmin(req);
    if (!session) return { ok: false, error: "forbidden" };
    if (!isUuid(req.params.id)) return { ok: false, error: "not-found" };
    const parsed = statusBody.safeParse(req.body ?? {}); // no array field
    if (!parsed.success) return { ok: false, error: "invalid-status" };
    const { status } = parsed.data;

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(centreLeads)
        .set({ status, updatedAt: raw`now()` })
        .where(eq(centreLeads.id, req.params.id))
        .returning();
      if (!row) return null;
      // No audit row, no change (lib/audit.ts). The note says what was done, nothing about the lead.
      await auditAdmin(session.profile.id, "centre_lead.status", { kind: "centre_lead", id: row.id }, `status ${status}`, tx);
      return row;
    });
    if (!updated) return { ok: false, error: "not-found" };
    return { ok: true, lead: toAdminLead(updated) };
  });
}
