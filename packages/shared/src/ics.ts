/* "AJOUTER AU CALENDRIER" — one iCalendar (RFC 5545) event, built by hand.

   Espace prof v2 · phase 7. Attached to every booking email and served by
   GET /bookings/:id/calendar.ics. No dependency: the format is small, and the
   four things calendar clients actually trip on are all handled here —

     1. TIME ZONE. A class is an appointment in Tunis (./time.ts). Times are
        written as Tunis wall-clock with TZID=Africa/Tunis, and the VTIMEZONE the
        RFC requires for that TZID is generated from the offset Tunis really has
        at that instant — never assumed. If the start and end ever fell on two
        different offsets (a DST change), the event falls back to UTC ("Z") times,
        which are always exact.
     2. UPDATES AND CANCELLATIONS. A stable UID per event and a SEQUENCE that only
        grows (icsSequence): a moved class re-sent with the same UID replaces the
        old entry, and METHOD:CANCEL with the same UID removes it.
     3. LINES. CRLF endings, and lines folded at 75 OCTETS (not characters) without
        splitting a UTF-8 sequence — an Arabic title is 2 bytes a letter.
     4. TEXT. Backslash, semicolon, comma and newlines escaped; other control
        characters (a class title is user input) dropped.

   Pure — no node builtins, safe anywhere. */

import { tunisWallTime } from "./time";

export type IcsMethod = "PUBLISH" | "CANCEL";

export type IcsEvent = {
  /** Globally unique and STABLE for this event — e.g. "booking-<id>@tnajem.com". */
  uid: string;
  /** Revision number; see icsSequence(). Must not go down between two sends of one UID. */
  sequence: number;
  start: Date | string | number;
  durationMin: number;
  summary: string;
  description?: string;
  /** The Tnajem page for this event (the live page) — never a raw room URL. */
  url?: string;
  location?: string;
  organizer?: { name: string; email: string } | null;
  /** DTSTAMP. Defaults to now; injectable so tests are deterministic. */
  stamp?: Date | string | number;
};

/* SEQUENCE as seconds since 2026-01-01T00:00Z of the revision that produced the
   event (the booking, the last move, the cancellation). Monotonic by construction,
   needs no counter column, and stays below 2^31 until 2094. */
const SEQUENCE_EPOCH_MS = Date.UTC(2026, 0, 1);

export function icsSequence(revision: Date | string | number): number {
  const ms = new Date(revision).getTime();
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.floor((ms - SEQUENCE_EPOCH_MS) / 1000));
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** "20261002T170000Z" — an instant in UTC (DTSTAMP, and the DST fallback). */
export function icsUtc(instant: Date | string | number): string {
  const d = new Date(instant);
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** "20261002T180000" — the Tunis wall clock at an instant (used with TZID). */
export function icsTunisLocal(instant: Date | string | number): string {
  const w = tunisWallTime(instant);
  return `${w.year}${pad(w.month)}${pad(w.day)}T${pad(w.hour)}${pad(w.minute)}${pad(w.second)}`;
}

/** Tunis's UTC offset at an instant, in minutes (+60 today). */
function tunisOffsetMinutes(instant: Date | string | number): number {
  const ms = Math.floor(new Date(instant).getTime() / 1000) * 1000;
  const w = tunisWallTime(ms);
  return Math.round((Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - ms) / 60_000);
}

/** "+0100" */
function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
}

/** RFC 5545 §3.3.11 TEXT escaping. CR/LF become the two characters "\n". */
export function icsEscapeText(raw: string): string {
  return stripControls(raw)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/* Every C0 control except the line breaks icsEscapeText turns into "\n", and DEL.
   A tab or a stray NUL in a user-written title must not reach the file raw. */
function stripControls(s: string): string {
  let out = "";
  for (const ch of String(s ?? "")) {
    const c = ch.codePointAt(0) ?? 0;
    if (c === 0x0a || c === 0x0d) out += ch;
    else if (c < 0x20 || c === 0x7f) out += c === 0x09 ? " " : "";
    else out += ch;
  }
  return out;
}

/** A URI value (URL, mailto): no escaping in the RFC, so only controls and spaces go. */
function icsUri(raw: string): string {
  return stripControls(raw).replace(/[\r\n\s]/g, "");
}

/** A parameter value (CN=…): quoted, with the one character a quoted value cannot hold removed. */
function icsParam(raw: string): string {
  return `"${stripControls(raw).replace(/[\r\n"]/g, "").trim()}"`;
}

const encoder = new TextEncoder();
const octets = (s: string) => encoder.encode(s).length;

/** RFC 5545 §3.1: lines longer than 75 octets are folded with CRLF + one space.
    Splits between characters only, so a multi-byte UTF-8 letter is never cut. */
export function icsFold(line: string): string {
  if (octets(line) <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  let limit = 75; // the first line; continuation lines lose one octet to the leading space
  for (const ch of line) {
    const n = octets(ch);
    if (size + n > limit) {
      parts.push(current);
      current = "";
      size = 0;
      limit = 74;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** The whole .ics file: one VCALENDAR, one VEVENT, CRLF line endings. */
export function buildIcs(ev: IcsEvent, method: IcsMethod): string {
  const start = new Date(ev.start);
  const minutes = Number.isFinite(ev.durationMin) && ev.durationMin > 0 ? ev.durationMin : 60;
  const end = new Date(start.getTime() + minutes * 60_000);
  const offStart = tunisOffsetMinutes(start);
  const sameOffset = offStart === tunisOffsetMinutes(end);

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Tnajem//Seances//FR",
    "CALSCALE:GREGORIAN",
    `METHOD:${method}`,
  ];

  if (sameOffset) {
    lines.push(
      "BEGIN:VTIMEZONE",
      "TZID:Africa/Tunis",
      "BEGIN:STANDARD",
      "DTSTART:19700101T000000",
      `TZOFFSETFROM:${formatOffset(offStart)}`,
      `TZOFFSETTO:${formatOffset(offStart)}`,
      ...(offStart === 60 ? ["TZNAME:CET"] : []),
      "END:STANDARD",
      "END:VTIMEZONE",
    );
  }

  lines.push(
    "BEGIN:VEVENT",
    `UID:${icsUri(ev.uid)}`,
    `DTSTAMP:${icsUtc(ev.stamp ?? Date.now())}`,
    `SEQUENCE:${Math.max(0, Math.floor(ev.sequence))}`,
    sameOffset ? `DTSTART;TZID=Africa/Tunis:${icsTunisLocal(start)}` : `DTSTART:${icsUtc(start)}`,
    sameOffset ? `DTEND;TZID=Africa/Tunis:${icsTunisLocal(end)}` : `DTEND:${icsUtc(end)}`,
    `SUMMARY:${icsEscapeText(ev.summary)}`,
  );
  if (ev.description) lines.push(`DESCRIPTION:${icsEscapeText(ev.description)}`);
  if (ev.location) lines.push(`LOCATION:${icsEscapeText(ev.location)}`);
  if (ev.url) lines.push(`URL:${icsUri(ev.url)}`);
  if (ev.organizer?.email) {
    lines.push(`ORGANIZER;CN=${icsParam(ev.organizer.name)}:mailto:${icsUri(ev.organizer.email)}`);
  }
  lines.push(
    `STATUS:${method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  );

  return lines.map(icsFold).join("\r\n") + "\r\n";
}

/** The Content-Type a .ics attachment or download is served with. */
export function icsContentType(method: IcsMethod): string {
  return `text/calendar; charset=utf-8; method=${method}`;
}
