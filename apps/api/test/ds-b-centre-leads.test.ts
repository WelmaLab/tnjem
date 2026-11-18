import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { CONTACT_EMAIL } from "@tnajem/shared";
import { startApp, stopApp, seedProfile, login, call, sql, fxClientIp, type App } from "./support/fx";
import { setCentreLeadMailForTests, settleCentreLeadMail } from "../src/lib/centre-lead-mail";
import { csvCell, leadsCsv, LIST_LIMIT } from "../src/routes/centre-leads";
import { rlSubject, ipBucket } from "../src/lib/rate-limit";

/* december-sprint · B (D13) — POST /centre-leads and the three admin routes.

   Every lead this file writes carries a centre name starting with TAG, and after()
   deletes exactly those rows (and this file's rate-limit rows). Mail goes to the
   test seam, never to a provider (MAIL_* are blank in the lane's .env). */

const TAG = `FXB-${Date.now().toString(36)}`;
type Sent = { to: string; subject: string; text: string };
const outbox: Sent[] = [];
const ips: string[] = [];

let app: App;
let adminCookie: string;
let outsiderCookie: string;
const saved = { ADMIN_EMAILS: process.env.ADMIN_EMAILS, OTP_CHANNEL: process.env.OTP_CHANNEL };

before(async () => {
  app = await startApp();
  const admin = await seedProfile({ role: "tutor" });
  process.env.ADMIN_EMAILS = admin.email;
  process.env.OTP_CHANNEL = "email";
  adminCookie = await login(admin.id);
  outsiderCookie = await login((await seedProfile({ role: "student" })).id);
  setCentreLeadMailForTests(async (to, subject, text) => {
    outbox.push({ to, subject, text });
    return true;
  });
});
after(async () => {
  setCentreLeadMailForTests(null);
  await sql`delete from centre_leads where centre_name like ${`${TAG}%`}`;
  for (const ip of ips) {
    for (const kind of ["any", "ip"]) await sql`delete from rate_limits where key = ${`centre-lead:${kind}:${rlSubject(ipBucket(ip))}`}`;
  }
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await stopApp(app);
});
beforeEach(() => {
  outbox.length = 0;
});

/** A fresh client address per test: its own 5-per-hour budget. */
function newIp(): string {
  const ip = fxClientIp();
  ips.push(ip);
  return ip;
}

function lead(over: Record<string, unknown> = {}) {
  return {
    name: "Sonia Trabelsi",
    centreName: `${TAG} Centre Ibn Khaldoun`,
    city: "Sfax",
    phone: "+216 98 123 456",
    teachersCount: 12,
    levels: ["bac", "college"],
    message: "Stage de décembre pour le Bac.",
    locale: "fr",
    page: "/fr/pour-les-centres",
    utmSource: "whatsapp",
    website: "",
    ...over,
  };
}

async function post(body: unknown, ip: string) {
  const res = await app.inject({
    method: "POST",
    url: "/centre-leads",
    payload: body as Record<string, unknown>,
    headers: { "x-forwarded-for": ip },
  });
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

const rowsFor = (centre: string) => sql<{ utm_source: string | null; levels: string[]; status: string }[]>`
  select utm_source, levels, status from centre_leads where centre_name = ${centre}`;

describe("POST /centre-leads", () => {
  test("a valid lead is stored with its source, levels in ladder order, status new — and mailed once", async () => {
    const body = lead({ centreName: `${TAG} A` });
    const res = await post(body, newIp());
    assert.deepEqual(res.body, { ok: true });
    const rows = await rowsFor(`${TAG} A`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].utm_source, "whatsapp");
    assert.deepEqual(rows[0].levels, ["college", "bac"]);
    assert.equal(rows[0].status, "new");
    await settleCentreLeadMail();
    assert.equal(outbox.length, 1, "one mail per lead");
    assert.equal(outbox[0].to, CONTACT_EMAIL);
    assert.match(outbox[0].subject, new RegExp(`^Nouveau centre : ${TAG} A \\(Sfax\\)$`));
    assert.ok(outbox[0].text.includes("Téléphone / WhatsApp : +216 98 123 456"), outbox[0].text);
    assert.ok(outbox[0].text.includes("Niveaux : Collège, Bac"), outbox[0].text);
    assert.ok(outbox[0].text.includes("Source : whatsapp"), outbox[0].text);
  });

  test("a mail failure does not lose the lead", async () => {
    setCentreLeadMailForTests(async () => {
      throw new Error("smtp down");
    });
    try {
      const res = await post(lead({ centreName: `${TAG} B` }), newIp());
      assert.deepEqual(res.body, { ok: true });
      await settleCentreLeadMail();
      assert.equal((await rowsFor(`${TAG} B`)).length, 1);
    } finally {
      setCentreLeadMailForTests(async (to, subject, text) => {
        outbox.push({ to, subject, text });
        return true;
      });
    }
  });

  test("validation answers machine codes, field by field, and stores nothing", async () => {
    const cases: [Record<string, unknown>, string, string][] = [
      [{ name: "S" }, "invalid-name", "name"],
      [{ centreName: "" }, "invalid-centre", "centreName"],
      [{ city: " " }, "invalid-city", "city"],
      [{ phone: "abc" }, "invalid-phone", "phone"],
      [{ phone: "1234" }, "invalid-phone", "phone"],
      [{ phone: `+216 98 123 456${" ".repeat(40)}1` }, "invalid-phone", "phone"],
      [{ teachersCount: 0 }, "invalid-teachers", "teachersCount"],
      [{ teachersCount: 2.5 }, "invalid-teachers", "teachersCount"],
      [{ levels: ["maternelle"] }, "invalid-levels", "levels"],
      [{ levels: [1] }, "invalid-levels", "levels"],
      [{ locale: "en" }, "invalid-locale", "locale"],
    ];
    // The limit is 5 per hour per address: one fresh address per case.
    for (const [over, error, field] of cases) {
      const res = await post(lead({ centreName: `${TAG} V`, ...over }), newIp());
      assert.deepEqual(res.body, { ok: false, error, field }, JSON.stringify(over));
    }
    assert.equal((await rowsFor(`${TAG} V`)).length, 0);
    await settleCentreLeadMail();
    assert.equal(outbox.length, 0);
  });

  test("levels must be a short array: a long one, or a non-array, is a 400", async () => {
    const ip = newIp();
    assert.equal((await post(lead({ levels: new Array(6).fill("bac") }), ip)).status, 400);
    assert.equal((await post(lead({ levels: "bac" }), ip)).status, 400);
    assert.equal((await post(["x"], ip)).status, 400);
    // An empty selection is allowed; the field is optional.
    const ok = await post(lead({ centreName: `${TAG} L`, levels: [] }), ip);
    assert.deepEqual(ok.body, { ok: true });
    const { levels: _drop, ...noLevels } = lead({ centreName: `${TAG} L2` });
    assert.deepEqual((await post(noLevels, ip)).body, { ok: true });
  });

  test("the honeypot: any non-empty value — the same success, nothing stored, no mail", async () => {
    const ip = newIp();
    for (const website of ["https://spam.example", 42, true, { a: 1 }, ["x"]]) {
      const res = await post(lead({ centreName: `${TAG} H`, website, phone: "not a phone" }), ip);
      assert.deepEqual(res.body, { ok: true }, JSON.stringify(website));
    }
    assert.equal((await rowsFor(`${TAG} H`)).length, 0);
    await settleCentreLeadMail();
    assert.equal(outbox.length, 0);
    // An empty or absent honeypot is a person.
    assert.deepEqual((await post(lead({ centreName: `${TAG} H0`, website: "" }), ip)).body, { ok: true });
    const { website: _w, ...noHp } = lead({ centreName: `${TAG} H1` });
    assert.deepEqual((await post(noHp, ip)).body, { ok: true });
    assert.equal((await rowsFor(`${TAG} H0`)).length + (await rowsFor(`${TAG} H1`)).length, 2);
  });

  test("field errors and honeypot hits do not spend the strict 5-per-hour budget", async () => {
    const ip = newIp();
    for (let i = 0; i < 6; i++) assert.equal((await post(lead({ phone: "abc" }), ip)).body.error, "invalid-phone");
    for (let i = 0; i < 6; i++) assert.deepEqual((await post(lead({ website: "bot" }), ip)).body, { ok: true });
    for (let i = 0; i < 5; i++) assert.deepEqual((await post(lead({ centreName: `${TAG} S${i}` }), ip)).body, { ok: true }, `lead ${i}`);
    assert.equal((await post(lead({ centreName: `${TAG} S5` }), ip)).body.error, "rate-limited");
  });

  test("the loose budget: 30 requests per hour per address, whatever they carry", async () => {
    const ip = newIp();
    for (let i = 0; i < 30; i++) assert.notEqual((await post(lead({ phone: "abc" }), ip)).body.error, "rate-limited", `request ${i}`);
    const over = await post(lead({ website: "bot" }), ip);
    assert.equal(over.body.error, "rate-limited", "even a honeypot hit is refused past the loose budget");
    assert.ok(over.body.retryAfter > 0);
  });

  test("5 per hour per address, then rate-limited; another address is not affected", async () => {
    const ip = newIp();
    for (let i = 0; i < 5; i++) assert.deepEqual((await post(lead({ centreName: `${TAG} R${i}` }), ip)).body, { ok: true });
    const sixth = await post(lead({ centreName: `${TAG} R5` }), ip);
    assert.equal(sixth.body.ok, false);
    assert.equal(sixth.body.error, "rate-limited");
    assert.ok(sixth.body.retryAfter > 0);
    assert.equal((await rowsFor(`${TAG} R5`)).length, 0);
    assert.deepEqual((await post(lead({ centreName: `${TAG} R6` }), newIp())).body, { ok: true });
  });

  test("no raw IP is kept: not in the lead, not in the rate-limit key", async () => {
    const ip = newIp();
    await post(lead({ centreName: `${TAG} P` }), ip);
    const [row] = await sql<Record<string, unknown>[]>`select * from centre_leads where centre_name = ${`${TAG} P`}`;
    assert.ok(row);
    assert.equal(Object.values(row).some((v) => String(v).includes(ip)), false);
    const keys = await sql<{ key: string }[]>`select key from rate_limits where key like 'centre-lead:%'`;
    assert.ok(keys.length > 0);
    assert.equal(keys.some((k) => k.key.includes(ip)), false);
  });
});

describe("the admin routes", () => {
  test("refused to a non-admin and to nobody, on all three", async () => {
    for (const cookie of [outsiderCookie, null]) {
      assert.deepEqual((await call(app, "GET", "/admin/centre-leads", cookie)).body, { ok: false, error: "forbidden" });
      const csv = await call(app, "GET", "/admin/centre-leads.csv", cookie);
      assert.equal(csv.status, 403);
      assert.equal(csv.raw.includes(TAG), false);
      const id = "00000000-0000-4000-8000-000000000000";
      assert.deepEqual((await call(app, "PATCH", `/admin/centre-leads/${id}`, cookie, { status: "won" })).body, { ok: false, error: "forbidden" });
    }
  });

  test("an admin lists newest first, changes a status (updated_at moves, audited), and exports the CSV", async () => {
    const ip = newIp();
    await post(lead({ centreName: `${TAG} Old` }), ip);
    await sql`update centre_leads set created_at = now() - interval '1 hour', updated_at = now() - interval '1 hour' where centre_name = ${`${TAG} Old`}`;
    await post(lead({ centreName: `${TAG} New`, name: "=HYPERLINK(\"x\")", message: 'Il a dit "oui", puis\nnon' }), ip);

    const list = await call(app, "GET", "/admin/centre-leads", adminCookie);
    assert.equal(list.body.ok, true);
    assert.equal(list.body.limit, LIST_LIMIT);
    assert.equal(typeof list.body.capped, "boolean");
    const mine = list.body.leads.filter((l: { centreName: string }) => l.centreName.startsWith(TAG));
    const iNew = mine.findIndex((l: { centreName: string }) => l.centreName === `${TAG} New`);
    const iOld = mine.findIndex((l: { centreName: string }) => l.centreName === `${TAG} Old`);
    assert.ok(iNew >= 0 && iOld > iNew, "newest first");
    const old = mine[iOld];
    const [{ n: reads }] = await sql<{ n: number }[]>`select count(*)::int n from admin_actions where action = 'centre_leads.read'`;
    assert.ok(reads >= 1, "the read is audited");

    const patched = await call(app, "PATCH", `/admin/centre-leads/${old.id}`, adminCookie, { status: "contacted" });
    assert.equal(patched.body.ok, true);
    assert.equal(patched.body.lead.status, "contacted");
    assert.ok(new Date(patched.body.lead.updatedAt) > new Date(old.updatedAt), "updated_at is set");
    const [{ n: changes }] = await sql<{ n: number }[]>`
      select count(*)::int n from admin_actions where action = 'centre_lead.status' and subject_id = ${old.id}`;
    assert.equal(changes, 1);
    assert.deepEqual((await call(app, "PATCH", `/admin/centre-leads/${old.id}`, adminCookie, { status: "maybe" })).body, { ok: false, error: "invalid-status" });
    assert.deepEqual((await call(app, "PATCH", "/admin/centre-leads/nope", adminCookie, { status: "won" })).body, { ok: false, error: "not-found" });

    const csv = await app.inject({ method: "GET", url: "/admin/centre-leads.csv", headers: { cookie: adminCookie } });
    assert.equal(csv.statusCode, 200);
    assert.match(String(csv.headers["content-type"]), /^text\/csv; charset=utf-8/);
    assert.match(String(csv.headers["content-disposition"]), /^attachment; filename="tnajem-centre-leads-\d{4}-\d{2}-\d{2}\.csv"$/);
    assert.equal(csv.headers["cache-control"], "private, no-store, max-age=0");
    const body = csv.body;
    assert.equal(body.charCodeAt(0), 0xfeff, "UTF-8 BOM");
    assert.ok(body.includes(`"'=HYPERLINK(""x"")"`), "formula neutralised and quotes doubled");
    assert.ok(body.includes(`"Il a dit ""oui"", puis\nnon"`), "a newline stays inside its quoted cell");
    assert.ok(body.includes(`"'+216 98 123 456"`), "a leading + is neutralised too");
    assert.ok(body.includes(`"${TAG} New"`));
    assert.ok(body.startsWith('\uFEFF"created_at";"status";"name"'), "« ; » between cells, for French Excel");
    const [{ n: exports }] = await sql<{ n: number }[]>`select count(*)::int n from admin_actions where action = 'centre_leads.export'`;
    assert.ok(exports >= 1, "the export is audited");
  });
});

describe("the list is capped and says so; the export is not", () => {
  test(`more than ${LIST_LIMIT} leads: the list shows ${LIST_LIMIT} with capped: true, the CSV has every row`, async () => {
    await sql`insert into centre_leads (name, centre_name, city, phone, locale, page)
              select 'Bulk', ${`${TAG} Bulk `} || g, 'Tunis', '+216 20 000 000', 'fr', '/fr/pour-les-centres'
              from generate_series(1, ${LIST_LIMIT + 1}) g`;
    const list = await call(app, "GET", "/admin/centre-leads", adminCookie);
    assert.equal(list.body.leads.length, LIST_LIMIT);
    assert.equal(list.body.capped, true);
    const csv = await app.inject({ method: "GET", url: "/admin/centre-leads.csv", headers: { cookie: adminCookie } });
    const bulk = csv.body.split("\r\n").filter((l) => l.includes(`${TAG} Bulk `));
    assert.equal(bulk.length, LIST_LIMIT + 1);
  });
});

describe("csvCell / leadsCsv", () => {
  test("quotes every cell, doubles quotes, neutralises formulas", () => {
    assert.equal(csvCell(null), '""');
    assert.equal(csvCell(12), '"12"');
    assert.equal(csvCell('a"b'), '"a""b"');
    for (const f of ["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx"]) assert.equal(csvCell(f).startsWith(`"'`), true, f);
    assert.equal(csvCell("مركز النجاح"), '"مركز النجاح"');
    const out = leadsCsv([]);
    assert.ok(out.startsWith('\uFEFF"created_at";"status";"name"'));
    assert.equal(csvCell("a;b"), '"a;b"', "a « ; » stays inside its quoted cell");
    assert.ok(out.endsWith("\r\n"));
  });
});
