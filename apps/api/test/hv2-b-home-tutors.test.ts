import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startApp, stopApp, seedTutor, seedClass, call, sql, type App, type Tutor } from "./support/fx";
import { getHomeTutors } from "../src/lib/home-tutors";
import { HOME_RATING_MIN_REVIEWS, HOME_TUTORS_MAX, type HomeTutor } from "@tnajem/shared";

/* home v2 · B — GET /tutors/home, the home page's « real tutors » card.

   Every route test file runs in parallel against ONE database, so the global list
   cannot be asserted to hold 0 or 1 tutor. Two layers instead:
     • the ROUTE: the tutors seeded here are verified « in the year 2100 », so the
       newest-verified-first order puts them at the top of the real answer — the
       count, the order and the exclusions are proved on the live endpoint;
     • the FUNCTION, narrowed to a known set of ids (restrictTo — it narrows the
       public predicate, never widens it), for the 0- and 1-tutor cards. */

let app: App;
const FUTURE = (s: number) => new Date(Date.UTC(2100, 0, 1, 0, 0, s)).toISOString();

let a: Tutor; // newest — 3 reviews, approved photo, a class on sale
let b: Tutor; // 2 reviews, pending photo, only a monthly offer
let c: Tutor; // nothing: no class, no offer, no review
let d: Tutor; // 4th — verified, but older than a/b/c: past the cap
let suspended: Tutor;
let pending: Tutor;
let rejected: Tutor;

async function verifiedAt(t: Tutor, s: number) {
  await sql`update tutors set reviewed_at = ${FUTURE(s)} where id = ${t.id}`;
}
async function addReviews(t: Tutor, ratings: number[]) {
  for (const r of ratings) {
    await sql`insert into reviews (tutor_id, rating, text) values (${t.id}, ${r}, ${"hv2-b"})`;
  }
}

before(async () => {
  app = await startApp();

  a = await seedTutor({ fullName: "Mohamed Ben Ali" }); // subject « Mathématiques » (fx default)
  b = await seedTutor({ fullName: "Sarra Trabelsi" });
  c = await seedTutor({ fullName: "Amine Gharbi" });
  d = await seedTutor({ fullName: "Ines Jaziri" });
  suspended = await seedTutor({ fullName: "Hidden Suspended" });
  pending = await seedTutor({ fullName: "Hidden Pending", status: "pending" });
  rejected = await seedTutor({ fullName: "Hidden Rejected", status: "rejected" });

  // Order: the hidden ones are the NEWEST of all, so only the predicate keeps them out.
  await verifiedAt(suspended, 50);
  await verifiedAt(pending, 49);
  await verifiedAt(rejected, 48);
  await verifiedAt(a, 30);
  await verifiedAt(b, 20);
  await verifiedAt(c, 10);
  await verifiedAt(d, 1);
  await sql`update tutors set suspended_at = now() where id = ${suspended.id}`;

  // a: levels out of order (sorted on the way out), an approved photo, a phone on file.
  await sql`update tutors set levels = ${sql.array(["bac", "primaire", "nonsense"])},
                              avatar_path = ${`avatars/${a.id}/1`}, avatar_status = 'approved'
            where id = ${a.id}`;
  await sql`update profiles set phone = '+21698123456' where id = ${a.profileId}`;
  // Two on-sale classes (40 TND by fx default, then 25), a cheaper PAST one and a cheaper CANCELLED one.
  await seedClass({ tutorId: a.id, hoursFromNow: 72 });
  const cheaper = await seedClass({ tutorId: a.id, hoursFromNow: 96 });
  await sql`update classes set price_tnd = '25' where id = ${cheaper.id}`;
  const past = await seedClass({ tutorId: a.id, hoursFromNow: -48 });
  await sql`update classes set price_tnd = '5' where id = ${past.id}`;
  const cancelled = await seedClass({ tutorId: a.id, hoursFromNow: 48, status: "cancelled" });
  await sql`update classes set price_tnd = '6' where id = ${cancelled.id}`;
  await addReviews(a, [5, 4, 4]);

  // b: a free-text subject, a PENDING photo, no class — two monthly offers (one archived, cheaper).
  await sql`update tutors set subject = 'Physique-Chimie',
                              avatar_path = ${`avatars/${b.id}/1`}, avatar_status = 'pending'
            where id = ${b.id}`;
  await sql`insert into tutor_offers (tutor_id, title, sessions_per_month, price_tnd_per_month)
            values (${b.id}, 'hv2-b 4/mois', 4, '120')`;
  await sql`insert into tutor_offers (tutor_id, title, sessions_per_month, price_tnd_per_month, active, archived_at)
            values (${b.id}, 'hv2-b old', 4, '80', false, now())`;
  await addReviews(b, [5, 5]);

  // c: a subject typed as free text that maps to no code.
  await sql`update tutors set subject = 'Soutien en algorithmique' where id = ${c.id}`;
});

after(async () => {
  const ids = [a, b, c, d, suspended, pending, rejected].filter(Boolean).map((t) => t.id);
  if (ids.length) {
    await sql`delete from reviews where tutor_id in ${sql(ids)}`;
    await sql`delete from tutor_offers where tutor_id in ${sql(ids)}`;
  }
  await stopApp(app);
});

async function home(): Promise<HomeTutor[]> {
  const res = await call(app, "GET", "/tutors/home", null);
  assert.equal(res.status, 200, res.raw);
  return res.body as HomeTutor[];
}

describe("home v2 · B — GET /tutors/home", () => {
  test("3+ public tutors → exactly 3, newest-verified first; the 4th is past the cap", async () => {
    const rows = await home();
    assert.equal(rows.length, HOME_TUTORS_MAX);
    assert.deepEqual(rows.map((r) => r.slug), [a.slug, b.slug, c.slug]);
    assert.ok(!rows.some((r) => r.slug === d.slug));
  });

  test("a suspended, a pending and a rejected tutor are never on the card", async () => {
    const all = await getHomeTutors({ restrictTo: [suspended.id, pending.id, rejected.id] });
    assert.deepEqual(all, []);
    const slugs = (await home()).map((r) => r.slug);
    for (const t of [suspended, pending, rejected]) assert.ok(!slugs.includes(t.slug), t.slug);
  });

  test("0 public tutors → [] (and an empty restriction is [], not everything)", async () => {
    assert.deepEqual(await getHomeTutors({ restrictTo: [] }), []);
    assert.deepEqual(await getHomeTutors({ restrictTo: [pending.id] }), []);
  });

  test("1 public tutor → that one", async () => {
    const rows = await getHomeTutors({ restrictTo: [c.id, pending.id] });
    assert.deepEqual(rows.map((r) => r.slug), [c.slug]);
  });

  test("the public name only — never the surname, no e-mail, no phone, no id", async () => {
    const rows = await home();
    const ra = rows.find((r) => r.slug === a.slug)!;
    assert.equal(ra.name, "Mohamed B.");
    assert.equal(ra.initials, "MB");
    const json = JSON.stringify(rows);
    for (const leak of ["Ben Ali", "Trabelsi", "Gharbi", "@", "98123456", a.id, a.profileId]) {
      assert.ok(!json.includes(leak), `payload leaks ${leak}`);
    }
    for (const r of rows) {
      assert.deepEqual(
        Object.keys(r).sort(),
        ["avatar_url", "initials", "levels", "name", "price", "slug", "subject", ...(r.reviews ? ["reviews"] : [])].sort(),
      );
    }
  });

  test(`reviews: absent below ${HOME_RATING_MIN_REVIEWS}, present (count + average) at ${HOME_RATING_MIN_REVIEWS}`, async () => {
    const rows = await home();
    const ra = rows.find((r) => r.slug === a.slug)!;
    const rb = rows.find((r) => r.slug === b.slug)!;
    const rc = rows.find((r) => r.slug === c.slug)!;
    assert.deepEqual(ra.reviews, { average: 4.3, count: 3 });
    assert.equal("reviews" in rb, false, "2 reviews must send neither count nor average");
    assert.equal("reviews" in rc, false);
  });

  test("the photo only when APPROVED", async () => {
    const rows = await home();
    assert.equal(rows.find((r) => r.slug === a.slug)!.avatar_url, `/api/avatar/${a.slug}/md`);
    assert.equal(rows.find((r) => r.slug === b.slug)!.avatar_url, null, "pending photo");
    assert.equal(rows.find((r) => r.slug === c.slug)!.avatar_url, null, "no photo");
  });

  test("price: cheapest class ON SALE per session · else cheapest ACTIVE offer per month · else none", async () => {
    const rows = await home();
    assert.deepEqual(rows.find((r) => r.slug === a.slug)!.price, { tnd: 25, per: "session" });
    assert.deepEqual(rows.find((r) => r.slug === b.slug)!.price, { tnd: 120, per: "month" });
    assert.equal(rows.find((r) => r.slug === c.slug)!.price, null);
  });

  test("subject: a code with both labels · free text kept as typed · levels sorted, unknown dropped", async () => {
    const rows = await home();
    const ra = rows.find((r) => r.slug === a.slug)!;
    const rb = rows.find((r) => r.slug === b.slug)!;
    const rc = rows.find((r) => r.slug === c.slug)!;
    assert.deepEqual(ra.subject, { code: "math", fr: "Maths", ar: "رياضيات" });
    assert.equal(rb.subject.code, "physique"); // « Physique-Chimie » is an alias of physique
    assert.deepEqual(rc.subject, { code: null, fr: "Soutien en algorithmique", ar: "Soutien en algorithmique" });
    assert.deepEqual(ra.levels, ["primaire", "bac"]);
    assert.deepEqual(rc.levels, []);
  });
});
