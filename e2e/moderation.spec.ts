import { test, expect } from "@playwright/test";
import { sql } from "./support/db";
import { seedProfile, seedTutor, seedClass, seedBooking, seedAdmin } from "./support/seed";
import { backdateBooking } from "./support/seed"; // live-fixes-3 · C
import { mintSession } from "./support/session";

/* REPORTING, MODERATION AND ACCOUNT DELETION (Step 15).

   The deletion tests carry the weight. Erasure is the one irreversible thing a
   user can do to themselves, and the two failure modes are opposite:

     TOO LITTLE  the account is "deleted" and the e-mail is still in the table.
     TOO MUCH    deleting one account rewrites somebody ELSE'S record — a tutor's
                 rating drops because a student left, or a money ledger vanishes.

   ADDED, never edited into an existing spec. */

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:4000";

async function post(path: string, body: unknown, token?: string) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { cookie: `tnajem_session=${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<Record<string, unknown>>;
}

async function get(path: string, token?: string) {
  const res = await fetch(`${API}${path}`, {
    headers: token ? { cookie: `tnajem_session=${token}` } : {},
  });
  if (!res.ok) return null;
  return res.json();
}

/** Force the grace period to have elapsed, without waiting 30 days. */
async function ageDeletionRequest(profileId: string, days = 31) {
  await sql`update profiles
               set deletion_requested_at = now() - (${days} * interval '1 day')
             where id = ${profileId}`;
}

async function runPurge(): Promise<{ purged: number }> {
  /* Through the real cron endpoint, so the test exercises the path that actually
     runs in production rather than a helper only it calls. */
  const [{ secret }] = await sql<{ secret: string }[]>`select 'x' as secret`;
  void secret;
  const res = await fetch(`${API}/cron/purge`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` },
  });
  const body = (await res.json()) as { accounts?: { purged: number } };
  return { purged: body.accounts?.purged ?? 0 };
}

test.describe("reports are reachable WITHOUT an account", () => {
  test("an anonymous report is accepted", async () => {
    /* The person most likely to need this is a parent with no login, or someone
       already driven off the platform by what they are reporting. */
    const tutor = await seedTutor({ status: "verified" });
    const res = await post("/reports", {
      subjectKind: "tutor",
      subjectId: tutor.id,
      reason: "Ce prof demande aux élèves de le contacter en dehors de la plateforme.",
    });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(res.status, "and it must not imply the content is already gone").toBe("received");

    const [row] = await sql<{ reporter_profile_id: string | null; status: string }[]>`
      select reporter_profile_id, status from reports where id = ${res.id as string}`;
    expect(row.reporter_profile_id, "no account, and that is not second class").toBeNull();
    expect(row.status).toBe("open");
  });

  test("filing a report removes nothing", async () => {
    const tutor = await seedTutor({ status: "verified" });
    await post("/reports", { subjectKind: "tutor", subjectId: tutor.id, reason: "x".repeat(20) });
    const [t] = await sql<{ status: string }[]>`select status from tutors where id = ${tutor.id}`;
    expect(t.status, "an unauthenticated take-down button is a censorship button").toBe("verified");
  });

  test("a contact number in the reason is KEPT, not masked", async () => {
    /* The deliberate exception to Step 8. "He asked me to text him on 98123456"
       is the entire substance of the complaint; masking it would destroy the
       report in order to enforce a rule that exists to protect the reporter. */
    const res = await post("/reports", {
      subjectKind: "other",
      reason: "Il m'a demandé de le contacter sur WhatsApp au 98123456 après le cours.",
    });
    expect(res.ok).toBe(true);
    expect(res.containsContactInfo, "and the admin is told it is in there").toBe(true);
    const [row] = await sql<{ reason: string }[]>`
      select reason from reports where id = ${res.id as string}`;
    expect(row.reason, "the evidence must survive").toContain("98123456");
  });

  test("a too-short reason is refused", async () => {
    const res = await post("/reports", { subjectKind: "other", reason: "bad" });
    expect(res.ok).toBe(false);
  });
});

test.describe("moderation is audited", () => {
  test("resolving a report writes an audit row naming the admin", async () => {
    const res = await post("/reports", { subjectKind: "other", reason: "y".repeat(20) });
    const admin = await seedAdmin();
    const adminToken = await mintSession(admin.id);

    const done = await post(`/admin/reports/${res.id}`, { action: "actioned", note: "Compte suspendu" }, adminToken);
    expect(done.ok).toBe(true);

    const [a] = await sql<{ admin_profile_id: string; action: string; subject_id: string }[]>`
      select admin_profile_id, action, subject_id from admin_actions
       where subject_id = ${res.id as string} order by created_at desc limit 1`;
    expect(a, "\"who did this?\" must have an answer").toBeTruthy();
    expect(a.admin_profile_id).toBe(admin.id);
    expect(a.action).toBe("report.actioned");
  });

  test("a non-admin cannot resolve a report", async () => {
    const res = await post("/reports", { subjectKind: "other", reason: "z".repeat(20) });
    const nobody = await seedProfile({ role: "student", birthYear: 1995 });
    const out = await post(`/admin/reports/${res.id}`, { action: "dismissed" }, await mintSession(nobody.id));
    expect(out.ok).toBe(false);
    expect(out.error).toBe("forbidden");
  });

  test("resolving twice does not double the audit trail", async () => {
    const res = await post("/reports", { subjectKind: "other", reason: "w".repeat(20) });
    const admin = await seedAdmin();
    const t = await mintSession(admin.id);
    await post(`/admin/reports/${res.id}`, { action: "dismissed" }, t);
    const again = await post(`/admin/reports/${res.id}`, { action: "actioned" }, t);
    expect(again.already).toBe(true);
    const [n] = await sql<{ n: number }[]>`
      select count(*)::int n from admin_actions where subject_id = ${res.id as string}`;
    expect(n.n).toBe(1);
  });
});

test.describe("account deletion — the grace period", () => {
  test("a request is a REQUEST, and can be taken back", async () => {
    const me = await seedProfile({ role: "student", birthYear: 1995 });
    const token = await mintSession(me.id);

    const req = await post("/account/delete", {}, token);
    expect(req.ok, JSON.stringify(req)).toBe(true);
    expect(req.graceDays).toBe(30);

    const state = (await get("/account/deletion", token)) as { requested: boolean; purgeAt: string };
    expect(state.requested).toBe(true);
    expect(new Date(state.purgeAt).getTime()).toBeGreaterThan(Date.now());

    expect((await post("/account/delete/cancel", {}, token)).ok).toBe(true);
    const after = (await get("/account/deletion", token)) as { requested: boolean };
    expect(after.requested, "the commonest regret is doing it irreversibly").toBe(false);
  });

  test("nothing is purged before the grace expires", async () => {
    const me = await seedProfile({ role: "student", birthYear: 1995 });
    await post("/account/delete", {}, await mintSession(me.id));
    await runPurge();
    const [n] = await sql<{ n: number }[]>`select count(*)::int n from profiles where id = ${me.id}`;
    expect(n.n).toBe(1);
  });

  test("BLOCKED while a student has an upcoming booking", async () => {
    /* A courtesy to the OTHER side: vanishing from a class the tutor prepared for
       is a no-show dressed up as a privacy action. */
    const tutor = await seedTutor({ status: "verified" });
    const klass = await seedClass({ tutorId: tutor.id, seats: 5, hoursFromNow: 72 });
    const me = await seedProfile({ role: "student", birthYear: 1995 });
    await seedBooking({ classId: klass.id, studentId: me.id });

    const res = await post("/account/delete", {}, await mintSession(me.id));
    expect(res.ok).toBe(false);
    expect(res.error).toBe("has-upcoming-bookings");
  });

  test("BLOCKED while a tutor has an upcoming class", async () => {
    const profile = await seedProfile({ role: "tutor", birthYear: 1985 });
    const tutor = await seedTutor({ profileId: profile.id, status: "verified" });
    await seedClass({ tutorId: tutor.id, seats: 5, hoursFromNow: 72 });
    const res = await post("/account/delete", {}, await mintSession(profile.id));
    expect(res.ok).toBe(false);
    expect(res.error).toBe("has-upcoming-classes");
  });

  test("a PAST booking does not block it", async () => {
    const tutor = await seedTutor({ status: "verified" });
    const klass = await seedClass({ tutorId: tutor.id, seats: 5, hoursFromNow: -72 });
    const me = await seedProfile({ role: "student", birthYear: 1995 });
    await seedBooking({ classId: klass.id, studentId: me.id });
    const res = await post("/account/delete", {}, await mintSession(me.id));
    expect(res.ok, "the obligation is to future counterparties, not to history").toBe(true);
  });
});

test.describe("account deletion — the purge", () => {
  /* ANONYMISED, NOT DELETED (Stage 5). The row used to be DELETEd, which cascaded
     away other people's records; it is now a tombstone a CHECK keeps identity-free.
     e2e/deletion.spec.ts covers files in storage and the name in every response. */
  test("the identity is GONE; the row that remains is an identity-free tombstone", async () => {
    const me = await seedProfile({ role: "student", birthYear: 1995 });
    const [before] = await sql<{ email: string }[]>`select email from profiles where id = ${me.id}`;
    await post("/account/delete", {}, await mintSession(me.id));
    await ageDeletionRequest(me.id);

    expect((await runPurge()).purged).toBeGreaterThan(0);

    const [tomb] = await sql<{ email: string | null; full_name: string | null; purged_at: Date | null }[]>`
      select email, full_name, purged_at from profiles where id = ${me.id}`;
    expect(tomb.purged_at, "erased").toBeTruthy();
    expect(tomb.email).toBeNull();
    expect(tomb.full_name).toBeNull();
    const [e] = await sql<{ n: number }[]>`
      select count(*)::int n from profiles where email = ${before.email}`;
    expect(e.n, "and the e-mail must not survive anywhere in the table").toBe(0);

    const [s] = await sql<{ n: number }[]>`
      select count(*)::int n from sessions where profile_id = ${me.id}`;
    expect(s.n).toBe(0);
  });

  test("A TUTOR'S RATING DOES NOT MOVE WHEN THE REVIEWER LEAVES", async () => {
    /* The rule the plan names explicitly. reviews.student_id was CASCADE, so a
       student closing their account deleted their reviews — a tutor's public
       rating dropping for a reason nobody could see or explain. */
    const tutor = await seedTutor({ status: "verified" });
    const klass = await seedClass({ tutorId: tutor.id, seats: 5, hoursFromNow: -48 });
    const reviewer = await seedProfile({ role: "student", birthYear: 1995, fullName: "Amine Karoui" });
    await seedBooking({ classId: klass.id, studentId: reviewer.id });
    await sql`insert into reviews (id, tutor_id, student_id, class_id, rating, text)
              values (gen_random_uuid(), ${tutor.id}, ${reviewer.id}, ${klass.id}, 5, 'Excellent cours.')`;

    await post("/account/delete", {}, await mintSession(reviewer.id));
    await ageDeletionRequest(reviewer.id);
    await runPurge();

    const rows = await sql<{ student_id: string | null; rating: number; text: string }[]>`
      select student_id, rating, text from reviews where tutor_id = ${tutor.id}`;
    expect(rows, "the review must survive its author").toHaveLength(1);
    expect(rows[0].rating).toBe(5);
    expect(rows[0].text).toBe("Excellent cours.");
    /* The review keeps its anonymous seat (the tombstone id), and that tombstone
       carries no name: the author is gone, the review is not. */
    const [author] = await sql<{ full_name: string | null; purged_at: Date | null }[]>`
      select full_name, purged_at from profiles where id = ${rows[0].student_id}`;
    expect(author.purged_at, "but it must lose the author — anonymised, not deleted").toBeTruthy();
    expect(author.full_name).toBeNull();

    const feed = (await get(`/tutors/${tutor.slug}/reviews`)) as { items: { studentName: string | null }[] };
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0].studentName, "and the public byline becomes anonymous").toBeNull();
  });

  test("THE CANCELLATION LEDGER SURVIVES THE ACCOUNT", async () => {
    /* bookings cascade from a profile, so the ledger rows hanging off them used
       to go too. A money ledger the counterparty can erase by closing their
       account is not a ledger. */
    const tutorProfile = await seedProfile({ role: "tutor", birthYear: 1985 });
    const tutor = await seedTutor({ profileId: tutorProfile.id, status: "verified" });
    const klass = await seedClass({ tutorId: tutor.id, seats: 5, priceTnd: 30, hoursFromNow: 5 });
    const me = await seedProfile({ role: "student", birthYear: 1995 });
    const booking = await seedBooking({ classId: klass.id, studentId: me.id, isFree: false });
    await backdateBooking(booking.id); // live-fixes-3 · C: outside the 15-minute grace after booking
    const token = await mintSession(me.id);

    // A late cancellation, so there is a real retained amount on the ledger.
    await post("/bookings/cancel", { bookingId: booking.id }, token);
    const [before] = await sql<{ n: number }[]>`
      select count(*)::int n from cancellations where class_id = ${klass.id}`;
    expect(before.n).toBe(1);

    await post("/account/delete", {}, token);
    await ageDeletionRequest(me.id);
    await runPurge();

    const rows = await sql<{ booking_id: string | null; retained_tnd: string; actor_profile_id: string | null }[]>`
      select booking_id, retained_tnd, actor_profile_id from cancellations where class_id = ${klass.id}`;
    expect(rows, "the ledger row must outlive the account").toHaveLength(1);
    expect(Number(rows[0].retained_tnd)).toBe(12); // 40% of 30
    /* The booking shell is KEPT now (Stage 5): the ledger still points at it, and
       the actor is the erased tombstone — an id that identifies nobody. */
    expect(rows[0].booking_id, "the booking shell survives the account").toBe(booking.id);
    const [actor] = await sql<{ email: string | null; full_name: string | null; purged_at: Date | null }[]>`
      select email, full_name, purged_at from profiles where id = ${rows[0].actor_profile_id}`;
    expect(actor, "and carrying nothing that identifies a person").toMatchObject({ email: null, full_name: null });
    expect(actor.purged_at).toBeTruthy();
  });
});
