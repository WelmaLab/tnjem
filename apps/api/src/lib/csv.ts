/* The admin CSV exports' shared writer (december-sprint · B wrote it for the centre
   leads, F moved it here for the bookings export: one escaping rule, not two).

   For French Excel (the founder's): « ; » between cells, the separator it expects
   under a French locale. Otherwise RFC 4180: every cell quoted (so a « ; » or a
   newline inside a cell stays in it), a quote doubled, CRLF between rows. A cell that a
   spreadsheet would run as a formula (= + - @, or a tab / CR that some apps strip
   first) gets a leading apostrophe — a visitor writes the text, an admin opens it.
   The file starts with a UTF-8 BOM so Excel shows accents and Arabic. */

export const CSV_SEP = ";";
export const CSV_BOM = "﻿";

export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** A whole file: the header row, one row per item, BOM first, CRLF after every row. */
export function csvFile<T>(columns: readonly (readonly [string, (r: T) => unknown])[], rows: readonly T[]): string {
  const lines = [columns.map(([h]) => csvCell(h)).join(CSV_SEP)];
  for (const r of rows) lines.push(columns.map(([, get]) => csvCell(get(r))).join(CSV_SEP));
  return `${CSV_BOM}${lines.join("\r\n")}\r\n`;
}
