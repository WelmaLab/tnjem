import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CENTRE_PACKS, SHOW_PACK_PRICES, SHOW_REFUND_GUARANTEE, SHOW_REMINDERS_LINE, CENTRE_LEAD_STATUSES, isCentreLeadStatus,
  supportWhatsAppHref, CONTACT_EMAIL, SUPPORT_HOURS, SUPPORT_WHATSAPP_MESSAGE,
  COMPANY_NAME, LEGAL_FORM, ADDRESS, MATRICULE_FISCAL, RNE, INPDP_NUMBER, CENTRE_LEAD_CONSENT_TEXT, CENTRE_LEAD_RETENTION_DAYS,
} from "@tnajem/shared";
import { centreLeadInputSchema } from "@tnajem/shared/centre-lead-input";
import { tutors, classes, centreLeads } from "@tnajem/db/schema";

/** The SQL names of a Drizzle table's columns (drizzle-orm itself is not a dependency of the API tests). */
type Col = { name: string; notNull: boolean; default: unknown; columnType: string };
const columnsOf = (t: object): Col[] => Object.values(t).filter((v): v is Col => !!v && typeof v === "object" && "columnType" in v);

/* december-sprint · lane S — the foundation every lane builds on: the three
   migrations, their Drizzle twins, and the founder's constants. */

const SQL = fileURLToPath(new URL("../../../packages/db/sql/", import.meta.url));
const sql = (f: string) => readFileSync(join(SQL, f), "utf8");

describe("december-sprint migrations are additive and mirrored in schema.ts", () => {
  test("0043 tutors.is_test: NOT NULL, default false", () => {
    assert.match(sql("0043_tutor_is_test.sql"), /ADD COLUMN IF NOT EXISTS "is_test" boolean DEFAULT false NOT NULL/);
    const col = columnsOf(tutors).find((c) => c.name === "is_test");
    assert.ok(col?.notNull);
    assert.equal(col?.default, false);
  });
  test("0045 classes.unlisted: NOT NULL, default false", () => {
    assert.match(sql("0045_class_unlisted.sql"), /ADD COLUMN IF NOT EXISTS "unlisted" boolean DEFAULT false NOT NULL/);
    const col = columnsOf(classes).find((c) => c.name === "unlisted");
    assert.ok(col?.notNull);
    assert.equal(col?.default, false);
  });
  test("0044 centre_leads: every SQL column is declared, no raw IP column, status CHECK", () => {
    const text = sql("0044_centre_leads.sql");
    const body = text.slice(text.indexOf('CREATE TABLE IF NOT EXISTS "centre_leads"'), text.indexOf(");", text.indexOf("centre_leads\" (")));
    const sqlCols = [...body.matchAll(/^\s*"([a-z_]+)"/gm)].map((m) => m[1]).sort();
    const declared = columnsOf(centreLeads).map((c) => c.name).sort();
    assert.deepEqual(declared, sqlCols);
    assert.ok(!declared.some((c) => /ip/.test(c)), "no IP address column");
    assert.match(text, /CHECK \("status" IN \('new', 'contacted', 'won', 'lost'\)\)/);
    assert.deepEqual([...CENTRE_LEAD_STATUSES], ["new", "contacted", "won", "lost"]);
    assert.equal(isCentreLeadStatus("won"), true);
    assert.equal(isCentreLeadStatus("spam"), false);
  });
  test("no migration drops or renames anything", () => {
    for (const f of ["0043_tutor_is_test.sql", "0044_centre_leads.sql", "0045_class_unlisted.sql"]) {
      const code = sql(f).replace(/--[^\n]*/g, "");
      assert.doesNotMatch(code, /\b(DROP|RENAME|DELETE|TRUNCATE)\b/i, f);
    }
  });
});

describe("centre packs and switches", () => {
  test("the three packs and their HT prices, as the founder set them", () => {
    assert.deepEqual(CENTRE_PACKS.map((p) => [p.code, p.priceTndHt, p.maxCentres]), [
      ["stage", 350, null],
      ["fondateur", 790, 10],
      ["academie", 1490, null],
    ]);
  });
  test("every switch ships OFF", () => {
    assert.equal(SHOW_PACK_PRICES, false);
    assert.equal(SHOW_REFUND_GUARANTEE, false);
    assert.equal(SHOW_REMINDERS_LINE, false);
  });
});

describe("support contact", () => {
  test("a prefilled message is URL-encoded; no number still means no link", () => {
    assert.equal(supportWhatsAppHref("21612345678", "Bonjour, ça va ?"), "https://wa.me/21612345678?text=Bonjour%2C%20%C3%A7a%20va%20%3F");
    assert.equal(supportWhatsAppHref("", SUPPORT_WHATSAPP_MESSAGE.fr), null);
    assert.equal(supportWhatsAppHref(undefined, SUPPORT_WHATSAPP_MESSAGE.ar), null);
  });
  test("one mailbox and the hours in both languages", () => {
    assert.equal(CONTACT_EMAIL, "contact@tnajem.com");
    assert.equal(SUPPORT_HOURS.fr, "Lundi à samedi, 9h à 20h");
    assert.ok(SUPPORT_HOURS.ar.length > 0);
  });
});

describe("company identity and lead legal values", () => {
  test("the six identity values ship empty (hidden until the founder fills them)", () => {
    for (const v of [COMPANY_NAME, LEGAL_FORM, ADDRESS, MATRICULE_FISCAL, RNE, INPDP_NUMBER]) assert.equal(v, "");
  });
  test("the consent sentence is the approved one, and lead retention is undecided", () => {
    assert.equal(CENTRE_LEAD_CONSENT_TEXT.fr, "En envoyant ce formulaire, vous acceptez d'être recontacté par Tnajem.");
    assert.equal(CENTRE_LEAD_RETENTION_DAYS, null);
  });
  test("each new legal value carries a LEGAL-REVIEW marker", () => {
    const src = readFileSync(fileURLToPath(new URL("../../../packages/shared/src/legal.ts", import.meta.url)), "utf8");
    for (const name of ["COMPANY_NAME", "LEGAL_FORM", "ADDRESS", "MATRICULE_FISCAL", "RNE", "INPDP_NUMBER", "CENTRE_LEAD_CONSENT_TEXT", "CENTRE_LEAD_RETENTION_DAYS"]) {
      const at = src.indexOf(`export const ${name}`);
      assert.ok(at > 0, name);
      assert.match(src.slice(Math.max(0, at - 400), at), /LEGAL-REVIEW:/, name);
    }
  });
});

describe("centre lead input", () => {
  const ok = { name: "Sami", centreName: "Centre Excellence", city: "Sfax", phone: "+216 22 123 456", locale: "fr", page: "/fr/pour-les-centres" };
  test("a minimal valid lead passes and defaults levels to []", () => {
    const r = centreLeadInputSchema.safeParse(ok);
    assert.ok(r.success);
    assert.deepEqual(r.data.levels, []);
  });
  test("phone is required and checked", () => {
    for (const phone of ["", "abc", "12", "+216 22 123 456 789 012 3456"]) {
      const r = centreLeadInputSchema.safeParse({ ...ok, phone });
      assert.ok(!r.success, phone);
    }
    const { phone: _p, ...noPhone } = ok;
    assert.ok(!centreLeadInputSchema.safeParse(noPhone).success);
  });
  test("unknown levels and locales are refused", () => {
    assert.ok(!centreLeadInputSchema.safeParse({ ...ok, levels: ["maternelle"] }).success);
    assert.ok(!centreLeadInputSchema.safeParse({ ...ok, locale: "en" }).success);
    assert.ok(centreLeadInputSchema.safeParse({ ...ok, levels: ["bac", "college"], teachersCount: 12 }).success);
  });
});
