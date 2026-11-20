import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startApp, stopApp, seedProfile, seedTutor, seedClass, seedBooking, login, call, sql, type App, type Tutor, grantAdmin } from "./support/fx";
import { parseExportQuery, splitTutorTokens, tunisDayStart, setExportRowLimitForTests, MAX_TUTORS, EXPORT_ROW_LIMIT } from "../src/routes/bookings-export";
import { csvCell as leadsCsvCell, CSV_SEP as LEADS_SEP, leadsCsv } from "../src/routes/centre-leads";
import { csvCell, CSV_SEP } from "../src/lib/csv";

/* december-sprint · F (D19) — GET /admin/bookings-export (preview) and .csv.

   Seeded data only: three fx tutors, their classes around the Tunis day boundaries of
   March 2031, and fx students with an e-mail AND a phone, so the file can be checked
   for leaking neither. stopApp() → cleanup() removes every fx row (the cancellation
   rows go with their class). */

let app: App;
let adminCookie: string;
let outsiderCookie: string;
let tutorA: Tutor;
let tutorB: Tutor;
let tutorC: Tutor;
let tutorBEmail: string;
const students: { id: string; email: string; phone: string }[] = [];
const saved = { ADMIN_EMAILS: process.env.ADMIN_EMAILS, OTP_CHANNEL: process.env.OTP_CHANNEL };

/** A Tunis wall time (UTC+1, no DST) as an instant. */
const tunis = (iso: string) => new Date(`${iso}:00+01:00`);

async function student(fullName: string) {
  const p = await seedProfile({ role: "student", fullName });
  const phone = `+2169${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
  await sql`update profiles set phone = ${phone} where id = ${p.id}`;
  students.push({ id: p.id, email: p.email, phone });
  return p.id;
}

async function setClass(id: string, title: string, level: string | null) {
  await sql`update classes set title = ${title}, level = ${level} where id = ${id}`;
}

before(async () => {
  app = await startApp();
  const admin = await seedProfile({ role: "tutor" });
  await grantAdmin(admin.id); // VULN-006: admin is profiles.admin_granted_at
  process.env.OTP_CHANNEL = "email";
  adminCookie = await login(admin.id);
  outsiderCookie = await login((await seedProfile({ role: "student" })).id);

  tutorA = await seedTutor({ fullName: "Amel Ben Salah" });
  tutorB = await seedTutor({ fullName: "Karim Jaziri" });
  tutorC = await seedTutor({ fullName: "Not Asked" });
  [{ email: tutorBEmail }] = await sql<{ email: string }[]>`select email from profiles where id = ${tutorB.profileId}`;

  const sami = await student("Sami Trabelsi");
  const ines = await student("ines ben ammar");
  const yassine = await student("Yassine Gharbi");

  // A1: 00:30 on 1 March in Tunis — still 28 Feb in UTC. In range.
  const a1 = await seedClass({ tutorId: tutorA.id, at: tunis("2031-03-01T00:30") });
  await setClass(a1.id, "Maths Bac — séance 1", "bac");
  // A0: 23:30 on 28 Feb in Tunis. Out of range.
  const a0 = await seedClass({ tutorId: tutorA.id, at: tunis("2031-02-28T23:30") });
  // B1: 23:59 on 31 March in Tunis. In range; a title that needs escaping.
  const b1 = await seedClass({ tutorId: tutorB.id, at: tunis("2031-03-31T23:59") });
  await setClass(b1.id, '=HYPERLINK("x");Physique', null);
  // B2: 00:00 on 1 April in Tunis — still 31 March in UTC. Out of range.
  const b2 = await seedClass({ tutorId: tutorB.id, at: tunis("2031-04-01T00:00") });
  // C1: a tutor nobody asked for, in range.
  const c1 = await seedClass({ tutorId: tutorC.id, at: tunis("2031-03-15T18:00") });

  await seedBooking({ classId: a1.id, studentId: sami });
  const cancelled = await seedBooking({ classId: a1.id, studentId: ines, status: "cancelled" });
  await sql`insert into cancellations (id, booking_id, class_id, actor, cancelled_at, hours_before_start, late)
            values (${randomUUID()}, ${cancelled.id}, ${a1.id}, 'student', ${tunis("2031-02-20T09:15").toISOString()}, 200, false)`;
  const b1booking = await seedBooking({ classId: b1.id, studentId: yassine });
  await sql`update bookings set price_tnd = '35.50' where id = ${b1booking.id}`;
  await seedBooking({ classId: a0.id, studentId: sami });
  await seedBooking({ classId: b2.id, studentId: sami });
  await seedBooking({ classId: c1.id, studentId: sami });
});

after(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await stopApp(app);
});

const qs = (p: Record<string, string>) => new URLSearchParams(p).toString();
const march = () => ({ tutors: `${tutorA.slug}, ${tutorBEmail}`, from: "2031-03-01", to: "2031-03-31" });

describe("access", () => {
  test("anonymous and non-admin are refused, with no data", async () => {
    for (const cookie of [null, outsiderCookie]) {
      const preview = await call(app, "GET", `/admin/bookings-export?${qs(march())}`, cookie);
      assert.deepEqual(preview.body, { ok: false, error: "forbidden" });
      const csv = await call(app, "GET", `/admin/bookings-export.csv?${qs(march())}`, cookie);
      assert.equal(csv.status, 403);
      assert.equal(csv.raw.includes("Sami"), false);
      assert.equal(csv.raw.includes(tutorA.slug), false);
    }
  });

  test("validation runs after the admin check: an outsider's bad query is still just forbidden", async () => {
    const res = await call(app, "GET", "/admin/bookings-export.csv?from=nope", outsiderCookie);
    assert.equal(res.status, 403);
  });
});

describe("validation", () => {
  const many = Array.from({ length: MAX_TUTORS + 1 }, (_, i) => `t${i}`).join(",");
  const cases: [Record<string, string>, string][] = [
    [{ from: "2031-03-01", to: "2031-03-31" }, "missing-tutors"],
    [{ tutors: " , ;", from: "2031-03-01", to: "2031-03-31" }, "missing-tutors"],
    [{ tutors: many, from: "2031-03-01", to: "2031-03-31" }, "too-many-tutors"],
    [{ tutors: "a", from: "", to: "2031-03-31" }, "invalid-from"],
    [{ tutors: "a", from: "2031-02-30", to: "2031-03-31" }, "invalid-from"],
    [{ tutors: "a", from: "1/3/2031", to: "2031-03-31" }, "invalid-from"],
    [{ tutors: "a", from: "2031-03-01", to: "2031-3-31" }, "invalid-to"],
    [{ tutors: "a", from: "2031-03-31", to: "2031-03-01" }, "range-reversed"],
    [{ tutors: "a", from: "2031-01-01", to: "2032-01-02" }, "range-too-long"],
  ];
  test("each bad query names its problem, on the preview (200) and on the CSV (400)", async () => {
    for (const [p, error] of cases) {
      const preview = await call(app, "GET", `/admin/bookings-export?${qs(p)}`, adminCookie);
      assert.equal(preview.status, 200);
      assert.equal(preview.body.ok, false, JSON.stringify(p));
      assert.equal(preview.body.error, error, JSON.stringify(p));
      const csv = await call(app, "GET", `/admin/bookings-export.csv?${qs(p)}`, adminCookie);
      assert.equal(csv.status, 400, JSON.stringify(p));
      assert.equal(csv.body.error, error, JSON.stringify(p));
    }
  });

  test("366 days is allowed (a leap year), 50 tutors is allowed", () => {
    const ok = parseExportQuery({ tutors: Array.from({ length: MAX_TUTORS }, (_, i) => `t${i}`).join("\n"), from: "2032-01-01", to: "2032-12-31" });
    assert.equal(ok.ok, true);
  });

  test("the tutor list splits on commas, semicolons, spaces and new lines; lower-cased; deduped", () => {
    assert.deepEqual(splitTutorTokens("a, B;c\n a\r\nX@Y.tn"), ["a", "b", "c", "x@y.tn"]);
    assert.deepEqual(splitTutorTokens(["a", "b,c"]), ["a", "b", "c"]);
    assert.equal(splitTutorTokens([1] as unknown as string[]), null);
    assert.equal(splitTutorTokens("x".repeat(9000)), null);
  });

  test("a day starts at 00:00 in Tunis", () => {
    assert.equal(tunisDayStart("2031-03-01")?.toISOString(), "2031-02-28T23:00:00.000Z");
    assert.equal(tunisDayStart("2031-02-29"), null);
  });
});

describe("the export", () => {
  test("preview: per-tutor counts, counts by status, the first rows, nothing unknown", async () => {
    const res = await call(app, "GET", `/admin/bookings-export?${qs(march())}`, adminCookie);
    assert.equal(res.body.ok, true);
    assert.deepEqual(res.body.unknown, []);
    assert.equal(res.body.total, 3);
    assert.deepEqual(res.body.byStatus, { reserved: 2, paid: 0, attended: 0, cancelled: 1 });
    const per = Object.fromEntries(res.body.tutors.map((t: { slug: string; bookings: number }) => [t.slug, t.bookings]));
    assert.deepEqual(per, { [tutorA.slug]: 2, [tutorB.slug]: 1 });
    assert.equal(res.body.sample.length, 3);
    assert.equal(res.body.sample[0].classAt, "2031-03-01 00:30");
    assert.equal(JSON.stringify(res.body).includes("@"), false, "no e-mail in the preview");
  });

  test("CSV: the right rows (Tunis day boundaries), statuses incl. cancelled, escaping, headers", async () => {
    const res = await app.inject({ method: "GET", url: `/admin/bookings-export.csv?${qs(march())}`, headers: { cookie: adminCookie } });
    assert.equal(res.statusCode, 200);
    assert.match(String(res.headers["content-type"]), /^text\/csv; charset=utf-8/);
    assert.equal(res.headers["content-disposition"], 'attachment; filename="tnajem-reservations-2031-03-01_2031-03-31.csv"');
    assert.equal(res.headers["cache-control"], "private, no-store, max-age=0");
    assert.equal(res.headers["x-content-type-options"], "nosniff");

    const body = res.body;
    assert.equal(body.charCodeAt(0), 0xfeff, "BOM first");
    assert.ok(body.endsWith("\r\n"));
    const lines = body.slice(1).split("\r\n").filter(Boolean);
    assert.equal(
      lines[0],
      ["class_date", "class_time", "tutor_name", "tutor_slug", "class_title", "class_level", "student_first_name", "booking_status", "booked_at", "cancelled_at", "price_tnd"]
        .map(csvCell).join(CSV_SEP),
    );
    assert.equal(lines.length, 4, body);

    const cells = (l: string) => l.slice(1, -1).split('";"');
    const [r1, r2, r3] = lines.slice(1).map(cells);
    // A1, ordered by booking time: Sami (reserved), then Inès (cancelled).
    assert.deepEqual([r1[0], r1[1], r1[2], r1[3], r1[4], r1[5], r1[6], r1[7], r1[9]],
      ["2031-03-01", "00:30", "Amel Ben Salah", tutorA.slug, "Maths Bac — séance 1", "Bac", "Sami", "reserved", ""]);
    assert.deepEqual([r2[6], r2[7], r2[9]], ["Ines", "cancelled", "2031-02-20 09:15"]);
    assert.match(r2[8], /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    // B1: the formula guard and the doubled quote, the « ; » kept inside its cell, the price.
    assert.equal(lines[3], [
      "2031-03-31", "23:59", "Karim Jaziri", tutorB.slug, '=HYPERLINK("x");Physique', "", "Yassine", "reserved", r3[8], "", "35,50",
    ].map(csvCell).join(CSV_SEP));
    assert.ok(lines[3].includes(`"'=HYPERLINK(""x"");Physique"`));

    // Never: the tutor nobody asked for, the classes just outside the range, a last name, an e-mail, a phone.
    assert.equal(body.includes(tutorC.slug), false);
    assert.equal(body.includes("2031-02-28"), false);
    assert.equal(body.includes("2031-04-01"), false);
    for (const s of students) {
      assert.equal(body.includes(s.email), false);
      assert.equal(body.includes(s.phone), false);
      assert.equal(body.includes(s.phone.slice(4)), false);
    }
    for (const last of ["Trabelsi", "ammar", "Gharbi"]) assert.equal(body.includes(last), false, last);
    assert.equal(body.includes("@"), false);
  });

  test("the export and the preview are audited", async () => {
    const before = await sql<{ n: number }[]>`select count(*)::int n from admin_actions where action = 'bookings_export.csv'`;
    await app.inject({ method: "GET", url: `/admin/bookings-export.csv?${qs(march())}`, headers: { cookie: adminCookie } });
    const after = await sql<{ n: number }[]>`select count(*)::int n from admin_actions where action = 'bookings_export.csv'`;
    assert.equal(after[0].n, before[0].n + 1);
    const [row] = await sql<{ note: string }[]>`select note from admin_actions where action = 'bookings_export.csv' order by created_at desc limit 1`;
    const slugs = [tutorA.slug, tutorB.slug].sort((x, y) => x.localeCompare(y)).join(",");
    assert.ok(row.note.endsWith(` · 2031-03-01..2031-03-31 · 2 tutor(s): ${slugs}`), row.note);
    assert.equal(row.note.includes("@"), false, "the note names tutors by slug, never by e-mail");
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from admin_actions where action = 'bookings_export.preview'`;
    assert.ok(n >= 1);
  });

  test("an unknown tutor is reported: listed in the preview, and the CSV refuses with the list", async () => {
    const p = { ...march(), tutors: `${tutorA.slug}, nobody-here, ghost@tnajem.invalid` };
    const preview = await call(app, "GET", `/admin/bookings-export?${qs(p)}`, adminCookie);
    assert.equal(preview.body.ok, true);
    assert.deepEqual(preview.body.unknown, ["nobody-here", "ghost@tnajem.invalid"]);
    assert.equal(preview.body.total, 2);
    const csv = await call(app, "GET", `/admin/bookings-export.csv?${qs(p)}`, adminCookie);
    assert.equal(csv.status, 400);
    assert.deepEqual(csv.body, { ok: false, error: "unknown-tutors", unknown: ["nobody-here", "ghost@tnajem.invalid"] });
  });

  test("over the row cap the CSV refuses (not truncates), and the preview says what the cap is", async () => {
    setExportRowLimitForTests(2);
    try {
      const csv = await call(app, "GET", `/admin/bookings-export.csv?${qs(march())}`, adminCookie);
      assert.equal(csv.status, 400);
      assert.deepEqual(csv.body, { ok: false, error: "too-many-rows", total: 3, rowLimit: 2 });
      assert.equal(csv.raw.includes("Sami"), false);
      const preview = await call(app, "GET", `/admin/bookings-export?${qs(march())}`, adminCookie);
      assert.equal(preview.body.total, 3);
      assert.equal(preview.body.rowLimit, 2);
      // At the cap exactly, it is served.
      setExportRowLimitForTests(3);
      const ok = await app.inject({ method: "GET", url: `/admin/bookings-export.csv?${qs(march())}`, headers: { cookie: adminCookie } });
      assert.equal(ok.statusCode, 200);
    } finally {
      setExportRowLimitForTests(null);
    }
    const back = await call(app, "GET", `/admin/bookings-export?${qs(march())}`, adminCookie);
    assert.equal(back.body.rowLimit, EXPORT_ROW_LIMIT);
  });

  test("a range with no booking gives the header row only", async () => {
    const res = await app.inject({ method: "GET", url: `/admin/bookings-export.csv?${qs({ ...march(), from: "2031-05-01", to: "2031-05-31" })}`, headers: { cookie: adminCookie } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.slice(1).split("\r\n").filter(Boolean).length, 1);
  });
});

test("the CSV writer is the one the centre-leads export uses", () => {
  assert.equal(leadsCsvCell, csvCell);
  assert.equal(LEADS_SEP, CSV_SEP);
  // leadsCsv now goes through csvFile: the same bytes the old inline writer made.
  const row = {
    id: "id-1", createdAt: "2026-11-18T10:00:00.000Z", updatedAt: "2026-11-18T10:00:00.000Z", name: "=Sonia", centreName: 'Centre "A"; Sfax',
    city: "Sfax", phone: "+216 98", teachersCount: 3, levels: ["bac"], message: "l1\nl2", locale: "fr", page: "/fr/pour-les-centres",
    utmSource: null, utmMedium: null, utmCampaign: null, referrer: null, status: "new",
  } as unknown as Parameters<typeof leadsCsv>[0][number];
  const out = leadsCsv([row]);
  assert.equal(out.charCodeAt(0), 0xfeff);
  const lines = out.slice(1).split("\r\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[2], "");
  assert.ok(lines[1].startsWith(`"2026-11-18T10:00:00.000Z";"new";"'=Sonia";"Centre ""A""; Sfax";"Sfax";"'+216 98";"3";"bac";"l1\nl2";`), lines[1]);
});
