import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { sql } from "./support/db";
import { seedProfile, seedTutor, seedClass, seedAdmin } from "./support/seed";
import { mintSession } from "./support/session";
import { PLANS, planByCode, tnd, classLimitLabel, requirePlan, COMMISSION_PCT, commissionOn } from "@tnajem/shared";

/* PLANS AND ENTITLEMENTS (Step 16).

   THE POINT OF THIS FILE is that an entitlement is only real if the SERVER
   refuses. /tarifs sells "1 cours en ligne" on the free plan; a limit enforced
   only by hiding a button is not a limit, it is a suggestion a crafted POST
   ignores — exactly the hole Step 6 closed for the free first session.

   The second thing it pins is that the page and the server say the SAME number.
   The prices and the class limit used to be strings in the pricing copy; they
   now come from one catalogue, and the tests below read the published page and
   the database and compare both against it.

   NOTHING HERE IMPLIES A PAYMENT. Payments are off; every grant is an admin
   handing out entitlements, and no row means anybody owes anything.

   ADDED, never edited into an existing spec — the Stage A rule still holds. */

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

/** A verified tutor with a session for their own profile. */
async function verifiedTutor(fullName?: string) {
  const profile = await seedProfile({ role: "tutor" });
  const tutor = await seedTutor({ profileId: profile.id, status: "verified", fullName });
  const token = await mintSession(profile.id);
  return { profile, tutor, token };
}

async function adminToken(): Promise<string> {
  const admin = await seedAdmin();
  return mintSession(admin.id);
}

let classCounter = 0;

/* A LETTER-ONLY suffix, and that is not fussiness. A random hex tail after a
   counter produces things like "Class 22 625922", which detectContactInfo
   correctly reads as a Tunisian mobile with a space separator — so ~3% of runs
   had a class refused for contact info and this spec failed with a class count
   one short of what it expected, on a different test each time. The detector is
   right; the fixture was wrong. */
function letters(n: number): string {
  const A = "abcdefghijklmnopqrstuvwxyz";
  return Array.from(randomBytes(n), (b) => A[b % 26]).join("");
}

async function createClass(token: string) {
  classCounter += 1;
  const when = new Date(Date.now() + (72 + classCounter) * 3600_000).toISOString();
  return post(
    "/classes",
    {
      title: `E2E Plan Class ${letters(8)}`,
      description: "Seeded by the plans spec.",
      scheduledAt: when,
      durationMin: 90,
      priceTnd: 40,
      seats: 10,
      isFreeFirst: false,
    },
    token,
  );
}

/* phase-a lane L3 (A25): during the pilot, POST /admin/subscriptions REFUSES a
   grant that would lower a tutor's limits (Gratuit → 1, Essentiel → 5, against the
   pilot's unlimited) — see the refusal test in section 4. The enforcement tests
   below are about POST /classes BINDING a grant, not about how the row got there,
   so they write the live grant row directly, as a grant made once payments are
   on would. */
async function seedGrant(tutorId: string, planCode: string, months?: number) {
  await sql`insert into subscriptions (tutor_id, plan_code, status, note, expires_at)
            values (${tutorId}, ${planCode}, 'active', 'e2e',
                    ${months ? sql`now() + (${months} * interval '1 month')` : null})`;
}

/** Push a live grant's expiry into the past, without waiting for it. */
async function ageGrant(tutorId: string, days = 1) {
  await sql`update subscriptions
               set expires_at = now() - (${days} * interval '1 day')
             where tutor_id = ${tutorId} and status = 'active'`;
}

/* ══════════════════════════════════════════════════════════════════════════════
   1. THE CATALOGUE — the database, the code and the published page agree
   ══════════════════════════════════════════════════════════════════════════════ */

test.describe("the catalogue is one catalogue", () => {
  test("every plan row in the database matches the shared catalogue exactly", async () => {
    /* The one deliberate duplication in this step: the numbers live in
       @tnajem/shared (what the server enforces) and in the `plans` table (the FK
       target and what anyone reading the database sees). This is the test that
       stops the row becoming a lie. */
    const rows = (await get("/plans")) as
      | {
          code: string;
          monthlyMillimes: number;
          yearlyMillimes: number;
          maxClasses: number | null;
          exploreBoost: number;
          listed: boolean;
        }[]
      | null;
    expect(rows, "GET /plans must serve the catalogue").not.toBeNull();

    expect(
      rows!.map((r) => r.code).sort(),
      "the database knows a different set of plans than the code does",
    ).toEqual(PLANS.map((p) => p.code).sort());

    for (const row of rows!) {
      const spec = planByCode(row.code);
      expect(spec, `plans row ${row.code} is not in the shared catalogue`).not.toBeNull();
      expect(
        {
          monthlyMillimes: row.monthlyMillimes,
          yearlyMillimes: row.yearlyMillimes,
          maxClasses: row.maxClasses,
          exploreBoost: row.exploreBoost,
          listed: row.listed,
        },
        `plan "${row.code}": the stored row and the enforced catalogue disagree`,
      ).toEqual({
        monthlyMillimes: spec!.monthlyMillimes,
        yearlyMillimes: spec!.yearlyMillimes,
        maxClasses: spec!.maxClasses,
        exploreBoost: spec!.exploreBoost,
        listed: spec!.listed,
      });
    }
  });

  test("/tarifs publishes the prices and the limits the server enforces", async ({ page }) => {
    await page.goto("/fr/tarifs");
    const body = page.locator("body");

    for (const plan of PLANS.filter((p) => p.listed)) {
      await expect(
        body,
        `/tarifs must publish the ${plan.code} monthly price the API knows`,
      ).toContainText(`${tnd(plan.monthlyMillimes)} TND`);
      await expect(
        body,
        `/tarifs must publish the ${plan.code} class limit the API enforces`,
      ).toContainText(classLimitLabel(plan.maxClasses, "fr"));
    }
  });

  test("the pilot plan is never advertised", async ({ page }) => {
    /* It grants everything and nobody buys it. A card for it would read as a free
       unlimited tier anyone can choose.

       Counted by the per-month label rather than by searching for the word
       "pilot": the page legitimately says "pendant le pilote" three times, which
       is the pilot BANNER — the true statement that nothing is billed yet — and
       a test that forbids the word would be forbidding the honesty, not the
       card. What must not exist is a fifth priced card. */
    await page.goto("/fr/tarifs");
    const listed = PLANS.filter((p) => p.listed).length;
    await expect(
      page.getByText("/ mois", { exact: true }),
      "the pricing grid must show exactly the listed plans — no more, no fewer",
    ).toHaveCount(listed);
  });
});

test.describe("the marketing pages state the catalogue's numbers", () => {
  /* THE COPY AUDIT, pinned. /pour-les-profs advertised "un abonnement à partir de
     29 TND/mois" while /tarifs rendered a 0 TND tier as its first card, and its
     worked example deducted a subscription from a tutor the same site placed in
     the free band. Both pages now derive from PLANS; these tests are what stops
     either drifting back into a number nobody checked. */

  test("no page advertises a subscription floor the catalogue contradicts", async ({ page }) => {
    const cheapestPaid = [...PLANS]
      .filter((p) => p.listed && p.monthlyMillimes > 0)
      .sort((a, b) => a.monthlyMillimes - b.monthlyMillimes)[0];
    const freeTier = PLANS.find((p) => p.listed && p.monthlyMillimes === 0);
    expect(freeTier, "the catalogue must still have a free listed tier").toBeTruthy();

    for (const path of ["/fr/pour-les-profs", "/fr/tarifs"]) {
      await page.goto(path);
      const body = await page.locator("body").innerText();
      expect(
        body.includes(`${tnd(cheapestPaid.monthlyMillimes)}`),
        `${path} should still quote the ${cheapestPaid.code} price`,
      ).toBe(true);

      /* The floor price MAY be quoted — it is real — but never as the point where
         paying starts, because paying starts at zero. So every sentence that
         mentions the subscription must also say it is free at the entry tier.
         Asserting on the sentence rather than banning the phrase is deliberate:
         "à partir de 29" is honest when "gratuit ..." sits in front of it, and a
         test that forbade the substring would push the copy into a worse shape. */
      /* Target the CLAIM SHAPE, not the digits. What was wrong was "à partir de
         29 TND/mois" — a statement about where paying BEGINS — while a 0 TND tier
         was listed. A fee breakdown like "− 128 (10 %) − 29 (abonnement)" quotes
         the same number and claims nothing; an assertion that cannot tell those
         apart would force the arithmetic off the page to stay green. */
      const claims = body
        .split(/(?<=[.!?])\s+/)
        .flatMap((t) => t.split("\n"))
        .filter((t) => /à partir de|لفوق/i.test(t))
        .filter((t) => new RegExp(`${tnd(cheapestPaid.monthlyMillimes)}`).test(t));

      for (const claim of claims) {
        expect(
          /gratuit|فابور/i.test(claim),
          `${path}: "${claim.trim().slice(0, 140)}" says paying starts at ${tnd(cheapestPaid.monthlyMillimes)} without saying the entry tier is free`,
        ).toBe(true);
      }
    }
  });

  test("the worked example on /pour-les-profs matches the catalogue", async ({ page }) => {
    /* The example: 8 students x 2 sessions x 20 TND x 4 weeks, and the plan is
       chosen by OPEN CLASSES because that is what POST /classes enforces. */
    const gross = 8 * 2 * 20 * 4;
    const commission = commissionOn(gross);
    const plan = [...PLANS]
      .filter((p) => p.listed)
      .sort((a, b) => a.monthlyMillimes - b.monthlyMillimes)
      .find((p) => p.maxClasses === null || p.maxClasses >= 2);
    expect(plan, "some listed plan must allow 2 open classes").toBeTruthy();
    const net = gross - commission - tnd(plan!.monthlyMillimes);

    await page.goto("/fr/pour-les-profs");
    const body = await page.locator("body").innerText();
    const nf = (v: number) => v.toLocaleString("fr-FR");
    expect(body, "the gross figure must be the arithmetic, not a typed-in number").toContain(nf(gross));
    expect(body, "the net figure must follow from the catalogue").toContain(nf(net));
    // december sprint · C (D23): the first 3 months carry no subscription — the commission only.
    expect(body, "the free-months figure is the gross less the commission").toContain(nf(gross - commission));
    expect(body, "the commission rate must come from COMMISSION_PCT").toContain(`${COMMISSION_PCT} %`);
  });

  test("EVERY unbuilt feature carries its Bientôt marker", async ({ page }) => {
    /* Six features across the three paid tiers do not exist. They are allowed on
       the page — the truth rule permits a future claim, unmistakably labelled —
       and this is the test that keeps the label attached. An unmarked one is a
       feature somebody pays 99 TND for and does not receive. */
    const NOT_BUILT = [
      "Rappels SMS et WhatsApp",
      "Statistiques de base",
      "Vends tes fiches et enregistrements",
      "Statistiques complètes",
      "Replays de tes séances",
      "Vérification prioritaire (48 h)",
      "Support prioritaire",
    ];
    await page.goto("/fr/tarifs");
    for (const feature of NOT_BUILT) {
      const row = page.locator("li.tf-soon", { hasText: feature });
      await expect(row, `"${feature}" is not built and must sit in a tf-soon row`).toHaveCount(1);
      /* The marker is a group label plus an sr-only word per row, not a chip on
         every row — per-row chips wrapped and orphaned themselves. What must stay
         true is that the row says "Bientôt" to a screen reader as well as to the
         eye, so the label can never be visual-only. */
      await expect(row, `"${feature}" must be marked Bientôt in its own row text`).toContainText(
        "Bientôt",
      );
    }
    /* And the visible group label exists on every card that has unbuilt items. */
    const cardsWithSoon = new Set(["essentiel", "pro", "prestige"]).size;
    await expect(
      page.locator("li.tf-soon-head"),
      "each paid tier with unbuilt features needs its visible Bientôt label",
    ).toHaveCount(cardsWithSoon);
    /* And the marker means nothing if it is on everything: the two entitlements
       that ARE enforced must NOT be marked. */
    for (const real of ["Mis en avant dans Explorer", "Placement prioritaire dans Explorer"]) {
      await expect(
        page.locator("li.tf-soon", { hasText: real }),
        `"${real}" is built and enforced — marking it Bientôt understates the product`,
      ).toHaveCount(0);
    }
  });

  test("the cost breakdown adds up, from the catalogue", async ({ page }) => {
    const processed = 1000;
    const plan = requirePlan("pro");
    const fee = commissionOn(processed);
    const sub = tnd(plan.monthlyMillimes);
    const nf = (v: number) => v.toLocaleString("fr-FR");

    await page.goto("/fr/tarifs");
    const body = await page.locator("body").innerText();
    for (const [label, value] of [
      ["processed", processed],
      ["commission", fee],
      ["subscription", sub],
      ["net", processed - fee - sub],
      // december sprint · C (D23): the same month in the first 3 months, no subscription.
      ["net, first 3 months", processed - fee],
    ] as const) {
      expect(body, `the ${label} figure must be derived, not typed in`).toContain(nf(value));
    }
    expect(body, "the commission rate comes from COMMISSION_PCT").toContain(`${COMMISSION_PCT} %`);
  });

  test("the free plan lists what it really gives", async ({ page }) => {
    /* The founder asked for these three by name. They are all shipped and all
       ungated — only maxClasses and exploreBoost are gated by a plan — so a
       Gratuit card that omits them undersells the product. */
    await page.goto("/fr/tarifs");
    const body = await page.locator("body").innerText();
    for (const claim of [
      "Ta page de prof et ton lien à partager",
      "Réservations, avis et note",
      "Ta photo de profil",
    ]) {
      expect(body, `the free plan must list "${claim}"`).toContain(claim);
    }
  });

  test("no page invents a verification turnaround", async ({ page }) => {
    /* There is no SLA behind it: one e-mail on submission, a FIFO queue, no
       timer and no escalation. Nothing in the system would notice three weeks. */
    for (const path of ["/fr/pour-les-profs", "/ar/pour-les-profs"]) {
      await page.goto(path);
      const body = await page.locator("body").innerText();
      expect(/24\s*[–-]\s*48/.test(body), `${path} promises a turnaround nothing measures`).toBe(false);
    }
  });

  test("the free plan's class limit is stated as the rule, not the student count", async ({ page }) => {
    await page.goto("/fr/tarifs");
    const body = await page.locator("body").innerText();
    expect(body, "the enforced limit must appear").toContain(
      classLimitLabel(requirePlan("gratuit").maxClasses, "fr"),
    );
    expect(
      body.includes("indication") || body.includes("Convient à"),
      "the student band must read as a hint, not as the plan's definition",
    ).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   2. THE CLASS LIMIT IS ENFORCED BY THE SERVER
   ══════════════════════════════════════════════════════════════════════════════ */

test.describe("the class limit binds on the API, not in the form", () => {
  test("THE PILOT REFUSES NOBODY — no grant, payments off, three classes", async () => {
    /* Today's behaviour, pinned. Enforcing the Gratuit limit while /tarifs says
       "gratuit pendant le pilote, rien n'est facturé" would be charging tutors in
       capability and calling it free. */
    const { token } = await verifiedTutor();
    for (let i = 0; i < 3; i += 1) {
      const res = await createClass(token);
      expect(res.ok, "a tutor on the pilot plan must not hit a class limit").toBe(true);
    }
  });

  test("a granted 1-class plan refuses the second class, and names the number", async () => {
    const { tutor, token } = await verifiedTutor();
    await seedGrant(tutor.id, "gratuit"); // phase-a lane L3 (A25)

    expect((await createClass(token)).ok, "the first class is within the plan").toBe(true);

    const second = await createClass(token);
    expect(second.ok, "the plan limit must be enforced server-side").toBe(false);
    expect(second.error).toBe("plan-limit-classes");
    /* The limit travels with the refusal. "Not allowed" with no figure is a dead
       end for a tutor who would happily move up an offer if they knew what they
       had hit. */
    expect(second.limit, "the refusal must carry the limit so the UI can name it").toBe(1);
    expect(second.planCode).toBe("gratuit");
  });

  test("CANCELLING A CLASS FREES THE SLOT — the limit counts open listings", async () => {
    /* "1 cours en ligne" is a listing limit, not a lifetime quota. A tutor whose
       one class was cancelled must be able to open another; the other reading
       would silently mean "one class ever". */
    const { tutor, token } = await verifiedTutor();
    await seedGrant(tutor.id, "gratuit"); // phase-a lane L3 (A25)

    const created = await createClass(token);
    expect(created.ok).toBe(true);
    expect((await createClass(token)).error).toBe("plan-limit-classes");

    await sql`update classes set status = 'cancelled'
               where tutor_id = ${tutor.id} and status <> 'cancelled'`;

    expect(
      (await createClass(token)).ok,
      "a cancelled class occupies nothing and must not keep counting",
    ).toBe(true);
  });

  test("A CLASS THAT ALREADY RAN does not count against the limit", async () => {
    const { tutor, token } = await verifiedTutor();
    await seedClass({ tutorId: tutor.id, hoursFromNow: -72 });
    await seedGrant(tutor.id, "gratuit"); // phase-a lane L3 (A25)

    expect(
      (await createClass(token)).ok,
      "a class taught last month must not consume this month's allowance",
    ).toBe(true);
  });

  test("the 5-class plan allows five and refuses the sixth", async () => {
    const { tutor, token } = await verifiedTutor();
    await seedGrant(tutor.id, "essentiel"); // phase-a lane L3 (A25)

    for (let i = 0; i < 5; i += 1) {
      expect((await createClass(token)).ok, `class ${i + 1} of 5 must be allowed`).toBe(true);
    }
    const sixth = await createClass(token);
    expect(sixth.error).toBe("plan-limit-classes");
    expect(sixth.limit).toBe(5);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   3. EXPIRY — the resolver is authoritative, the sweep is only bookkeeping
   ══════════════════════════════════════════════════════════════════════════════ */

test.describe("an expired grant stops binding immediately", () => {
  test("a grant whose expiry has passed returns the tutor to the default plan", async () => {
    /* Without this, liveness would depend on the nightly cron having run: a tutor
       would keep an entitlement for up to a day after it ended, and — worse — an
       admin could not grant a new plan, because the partial unique index would
       still see the old row as active. */
    const { tutor, token } = await verifiedTutor();
    await seedGrant(tutor.id, "gratuit", 1); // phase-a lane L3 (A25)

    expect((await createClass(token)).ok).toBe(true);
    expect((await createClass(token)).error).toBe("plan-limit-classes");

    await ageGrant(tutor.id);

    expect(
      (await createClass(token)).ok,
      "an expired grant must stop binding without waiting for a job to run",
    ).toBe(true);
  });

  test("the cron sweep flips expired rows, and is idempotent", async () => {
    const { tutor } = await verifiedTutor();
    const admin = await adminToken();
    await post("/admin/subscriptions", { tutorId: tutor.id, planCode: "pro", months: 3 }, admin);
    await ageGrant(tutor.id);

    const res = await fetch(`${API}/cron/purge`, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` },
    });
    const body = (await res.json()) as { subscriptions?: { due: number; expired: number } };
    expect(body.subscriptions, "the purge must report the subscription sweep").toBeTruthy();

    const [row] = await sql<{ status: string }[]>`
      select status from subscriptions where tutor_id = ${tutor.id}`;
    expect(row.status, "an expired grant must be recorded as expired, not left active").toBe(
      "expired",
    );

    // Running it again changes nothing — the job runs unattended every night.
    await fetch(`${API}/cron/purge`, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` },
    });
    const [again] = await sql<{ status: string }[]>`
      select status from subscriptions where tutor_id = ${tutor.id}`;
    expect(again.status).toBe("expired");
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   4. THE GRANT IS PRIVILEGED
   ══════════════════════════════════════════════════════════════════════════════ */

test.describe("only an admin may grant a plan", () => {
  test("A TUTOR CANNOT GRANT THEMSELVES PRESTIGE", async () => {
    /* The whole entitlement system is worth nothing if the person it limits can
       lift their own limit. */
    const { tutor, token } = await verifiedTutor();
    const res = await post(
      "/admin/subscriptions",
      { tutorId: tutor.id, planCode: "prestige" },
      token,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toBe("forbidden");

    const rows = await sql`select 1 from subscriptions where tutor_id = ${tutor.id}`;
    expect(rows.length, "a refused grant must not leave a row behind").toBe(0);
  });

  test("an anonymous caller cannot grant a plan", async () => {
    const { tutor } = await verifiedTutor();
    const res = await post("/admin/subscriptions", { tutorId: tutor.id, planCode: "pro" });
    expect(res.ok).toBe(false);
    const rows = await sql`select 1 from subscriptions where tutor_id = ${tutor.id}`;
    expect(rows.length).toBe(0);
  });

  test("an unknown plan code is refused BY NAME, and writes nothing", async () => {
    /* The dangerous direction is silence: without this, "pr0" would store, fail
       to resolve, and quietly fall back to the DEFAULT — giving the tutor less
       than the admin meant to give them, with no error anywhere. */
    const { tutor } = await verifiedTutor();
    const admin = await adminToken();
    const res = await post("/admin/subscriptions", { tutorId: tutor.id, planCode: "pr0" }, admin);
    expect(res.error).toBe("unknown-plan");
    const rows = await sql`select 1 from subscriptions where tutor_id = ${tutor.id}`;
    expect(rows.length).toBe(0);
  });

  test("the pilot plan cannot be granted explicitly", async () => {
    /* It is the DEFAULT, not a grant. An explicit pilot row would be
       indistinguishable from every tutor who is on it because billing has not
       started — and it would SURVIVE the day payments go live, quietly keeping
       one tutor unlimited for a reason nobody recorded. */
    const { tutor } = await verifiedTutor();
    const admin = await adminToken();
    const res = await post("/admin/subscriptions", { tutorId: tutor.id, planCode: "pilot" }, admin);
    expect(res.error).toBe("not-grantable");
  });

  test("a grant is written to the audit log", async () => {
    const { tutor } = await verifiedTutor();
    const admin = await adminToken();
    await post("/admin/subscriptions", { tutorId: tutor.id, planCode: "pro", note: "e2e" }, admin);

    const rows = await sql<{ action: string; note: string | null }[]>`
      select action, note from admin_actions
       where subject_kind = 'tutor' and subject_id = ${tutor.id}
       order by created_at desc limit 1`;
    expect(rows.length, "moving a tutor up the /explore ranking needs an answerable record").toBe(1);
    expect(rows[0].action).toBe("subscription.grant");
    expect(rows[0].note).toContain("pro");
  });

  test("SUPERSEDING A GRANT leaves exactly one live row", async () => {
    /* Two active rows would make "which plan am I on?" a question answered by
       whichever row the planner returned first. */
    const { tutor } = await verifiedTutor();
    const admin = await adminToken();
    // phase-a lane L3 (A25): pro → prestige; essentiel is refused during the pilot.
    await post("/admin/subscriptions", { tutorId: tutor.id, planCode: "pro" }, admin);
    await post("/admin/subscriptions", { tutorId: tutor.id, planCode: "prestige" }, admin);

    const active = await sql<{ plan_code: string }[]>`
      select plan_code from subscriptions
       where tutor_id = ${tutor.id} and status = 'active'`;
    expect(active.length, "a tutor may have at most one live grant").toBe(1);
    expect(
      active[0].plan_code,
      "the NEW grant must be the live one — a supersede that leaves the old plan in place is a grant that silently did nothing",
    ).toBe("prestige");
  });

  test("revoking returns the tutor to the default plan", async () => {
    const { tutor, token } = await verifiedTutor();
    const admin = await adminToken();
    await seedGrant(tutor.id, "gratuit"); // phase-a lane L3 (A25)
    expect((await createClass(token)).ok).toBe(true);
    expect((await createClass(token)).error).toBe("plan-limit-classes");

    const revoked = await post("/admin/subscriptions/revoke", { tutorId: tutor.id }, admin);
    expect(revoked.ok).toBe(true);
    expect((await createClass(token)).ok, "a revoked limit must stop applying").toBe(true);

    // Idempotent: revoking nothing is the state being asked for, not an error.
    expect((await post("/admin/subscriptions/revoke", { tutorId: tutor.id }, admin)).ok).toBe(true);
  });

  test("DURING THE PILOT a grant that would LOWER a tutor's limits is refused, by name, and writes nothing", async () => {
    /* phase-a lane L3 (A25). Every tutor is on `pilot` (unlimited) while nothing is
       billed; Gratuit (1) or Essentiel (5) would take capability away. */
    const { tutor, token } = await verifiedTutor();
    const admin = await adminToken();
    for (const planCode of ["gratuit", "essentiel"]) {
      const res = await post("/admin/subscriptions", { tutorId: tutor.id, planCode }, admin);
      expect(res.ok, `${planCode} must be refused during the pilot`).toBe(false);
      expect(res.error).toBe("lowers-pilot-limits");
      expect(typeof res.reason, "the refusal says why").toBe("string");
    }
    const rows = await sql`select 1 from subscriptions where tutor_id = ${tutor.id}`;
    expect(rows.length, "a refused grant must not leave a row behind").toBe(0);
    for (let i = 0; i < 3; i += 1) expect((await createClass(token)).ok).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   5. PAID PLACEMENT — it orders, it discloses, and it never touches a rating
   ══════════════════════════════════════════════════════════════════════════════ */

test.describe("paid placement on /explore", () => {
  test("a boosted tutor ranks first, is MARKED, and nobody is hidden", async () => {
    const tag = `PlanBoost${randomBytes(4).toString("hex")}`;
    const plain = await verifiedTutor(`${tag} Plain`);
    const boosted = await verifiedTutor(`${tag} Boosted`);
    const admin = await adminToken();

    /* Give the UNBOOSTED tutor the better rating, so ranking first can only come
       from the plan and not from being better reviewed. */
    await sql`update tutors set rating = '5.0' where id = ${plain.tutor.id}`;
    await sql`update tutors set rating = '1.0' where id = ${boosted.tutor.id}`;

    const before = (await get(`/tutors/explore?q=${tag}`)) as {
      slug: string;
      featured: boolean;
      rating: number;
    }[];
    expect(before.length).toBe(2);
    expect(before[0].slug, "before any grant, the better-rated tutor leads").toBe(plain.tutor.slug);
    expect(
      before.every((t) => t.featured === false),
      "nothing may be marked as promoted while nobody is on a paid plan",
    ).toBe(true);
    const ratingBefore = new Map(before.map((t) => [t.slug, t.rating]));

    await post("/admin/subscriptions", { tutorId: boosted.tutor.id, planCode: "pro" }, admin);

    const after = (await get(`/tutors/explore?q=${tag}`)) as {
      slug: string;
      featured: boolean;
      rating: number;
    }[];
    expect(after[0].slug, "a Pro grant must move the tutor up the list").toBe(boosted.tutor.slug);
    expect(
      after[0].featured,
      "paid placement the reader cannot see is an advertisement pretending to be a recommendation",
    ).toBe(true);

    /* IT ORDERS, IT DOES NOT FILTER. */
    expect(after.length, "a tutor on no plan must never be hidden by someone else's plan").toBe(2);
    expect(after[1].slug).toBe(plain.tutor.slug);
    expect(after[1].featured).toBe(false);
    /* The rating each card reports comes from the reviews table and nowhere else
       — tutors.rating is only a cached mirror used for ordering. Granting a plan
       must leave both cards' reported ratings exactly as they were. */
    for (const row of after) {
      expect(
        row.rating,
        "money moves you up the list; it does not change anybody's rating",
      ).toBe(ratingBefore.get(row.slug));
    }
  });

  test("the free and Essentiel plans buy no placement", async () => {
    /* Only the two plans that advertise it. A boost nobody was sold would be
       ranking with no disclosure and no reason. */
    const tag = `PlanNoBoost${randomBytes(4).toString("hex")}`;
    const a = await verifiedTutor(`${tag} A`);
    const admin = await adminToken();
    await post("/admin/subscriptions", { tutorId: a.tutor.id, planCode: "essentiel" }, admin);

    const rows = (await get(`/tutors/explore?q=${tag}`)) as { featured: boolean }[];
    expect(rows[0].featured).toBe(false);
  });

  test("an expired Pro grant stops promoting the card", async () => {
    const tag = `PlanExpired${randomBytes(4).toString("hex")}`;
    const t = await verifiedTutor(`${tag} One`);
    const admin = await adminToken();
    await post("/admin/subscriptions", { tutorId: t.tutor.id, planCode: "pro", months: 1 }, admin);

    let rows = (await get(`/tutors/explore?q=${tag}`)) as { featured: boolean }[];
    expect(rows[0].featured).toBe(true);

    await ageGrant(t.tutor.id);
    rows = (await get(`/tutors/explore?q=${tag}`)) as { featured: boolean }[];
    expect(rows[0].featured, "an expired plan must stop buying placement immediately").toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   6. THE TUTOR CAN SEE THEIR OWN PLAN
   ══════════════════════════════════════════════════════════════════════════════ */

test.describe("the dashboard reports the plan", () => {
  test("a tutor on the pilot is told they are on the pilot, with no limit", async () => {
    const { token } = await verifiedTutor();
    const d = (await get("/dashboard", token)) as {
      plan: { code: string; maxClasses: number | null; isPilot: boolean; granted: boolean };
    };
    expect(d.plan.code).toBe("pilot");
    expect(d.plan.maxClasses).toBeNull();
    expect(d.plan.isPilot).toBe(true);
    expect(d.plan.granted).toBe(false);
  });

  test("the usage count is the number the API enforces", async () => {
    /* A limit a tutor cannot see is a limit they discover by hitting it, halfway
       through a form. The dashboard has to report the SAME count POST /classes
       uses, or it is a second implementation of the rule. */
    const { tutor, token } = await verifiedTutor();
    const admin = await adminToken();
    /* phase-a/integrate (A25): during the pilot a grant may not LOWER a tutor's
       limits, so Essentiel (5) is refused here now. Pro keeps the point of this
       test — a granted plan, and the count the dashboard shows is the count the
       API uses — without being a lower limit than the pilot's. */
    expect((await post("/admin/subscriptions", { tutorId: tutor.id, planCode: "pro" }, admin)).ok).toBe(true);
    /* Assert each creation, so a refusal for an unrelated reason shows up as
       itself rather than as a class count that is quietly one short. */
    expect((await createClass(token)).ok).toBe(true);
    expect((await createClass(token)).ok).toBe(true);

    const d = (await get("/dashboard", token)) as {
      plan: { code: string; maxClasses: number | null; openClasses: number; isPilot: boolean };
    };
    expect(d.plan.code).toBe("pro");
    expect(d.plan.maxClasses).toBeNull();
    expect(d.plan.openClasses).toBe(2);
    expect(d.plan.isPilot, "a granted plan is not the pilot, even while payments are off").toBe(
      false,
    );
  });

  test("a tutor cannot read another tutor's plan", async () => {
    const mine = await verifiedTutor();
    const theirs = await verifiedTutor();
    const admin = await adminToken();
    await post("/admin/subscriptions", { tutorId: theirs.tutor.id, planCode: "prestige" }, admin);

    const d = (await get("/dashboard", mine.token)) as { plan: { code: string } };
    expect(d.plan.code, "the dashboard resolves the plan of the SIGNED-IN tutor").toBe("pilot");
  });

  test("the admin plan list is refused to a non-admin", async () => {
    const { token } = await verifiedTutor();
    const res = (await get("/admin/plans", token)) as { admin: boolean; items: unknown[] };
    expect(res.admin).toBe(false);
    expect(res.items).toEqual([]);
  });
});
