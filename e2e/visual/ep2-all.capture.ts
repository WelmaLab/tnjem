import { test, expect, type Browser, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "../support/db";
import { email, seedBooking, seedClass, seedFollow, seedOffer, seedPassword, seedProfile, seedPromotion, seedTutor } from "../support/seed";
import { mintSession, sessionCookie } from "../support/session";
import { api } from "../support/journey";
import { recoverOtp, resetRateLimits } from "../support/otp";
import { fillOtp } from "../support/otp-ui";
import { chooseOption } from "../support/select-ui"; // live-fixes-2 · C
import { E2E_PASSWORD } from "../support/password-ui";
import { BASE_URL } from "../support/env";

/* espace prof v2 · phase 8 (gate) — ONE harness for every prof page, in FR and AR,
   at 1440 and 390, plus the public pages this project changed. NOT part of
   `npm run test` (*.capture.ts). Run with

     npm run ui:shots-ep2          (= playwright test -c e2e/visual/visual.config.ts ep2-all)

   against a running production build. Output: ui-espace-prof-v2/ (gitignored), or
   UI_SHOTS_DIR. Files are <page>-<fr|ar>-<1440|390>.png, and index.md lists them.
   Replaces nothing: the phase harnesses (ep2-shell / -growth / -polish / -auth) stay.

   The data (scratch DB only — never `tnajem`):
     • « Amel Ben Salah », VERIFIED: three classes (two upcoming, one past), bookings,
       a pack, two followers, a monthly offer with one request and one subscriber,
       a public −15 % and a coded −20 % promotion, a month of « Vues · Clics »,
       unread notifications and a message thread;
     • « Walid Tester », DRAFT (the « Fais-toi vérifier » state, the owner preview);
       a second draft walks the 3 verification steps, so the first never changes;
     • « Karim Mansour », PENDING (« En cours » and the public « arrive bientôt »);
       « Rim Ben Ali », REJECTED with the team's reason;
     • « Nour Haddad », VERIFIED, publishes a class and uploads a fiche (so Amel's
       lists stay identical in every shot);
     • a tutor account with no page yet (/onboarding).
   Slugs are readable (amel-ben-salah-<run>) for the shots and renamed to e2e-… at
   the end, so the suite's teardown removes every row. */

const OUT = resolve(process.env.UI_SHOTS_DIR ?? "ui-espace-prof-v2");
const RUN = randomBytes(2).toString("hex");

type Who = "anon" | "fresh" | "draft" | "walker" | "pending" | "rejected" | "verified" | "publisher";
type Act =
  | "share" | "bell" | "fab" | "sheet"
  | "fill-class" | "publish-class" | "pack-file"
  | "verify-2" | "verify-3"
  | "auth-password" | "signup-password";
type Shot = { name: string; path: string; who: Who; act?: Act; phoneOnly?: boolean; note: string };

const SHOTS: Shot[] = [
  // ── the prof space (AppShell) ──
  { name: "home-draft", path: "/dashboard", who: "draft", note: "Accueil, draft tutor: step 2 of 5, « Fais-toi vérifier » blocker, greyed zeros" },
  { name: "home-verified", path: "/dashboard", who: "verified", note: "Accueil, verified tutor with real classes, bookings, unread bell + messages counts" },
  { name: "bell-open", path: "/dashboard", who: "verified", act: "bell", note: "the notifications bell, open" },
  { name: "fab-open", path: "/dashboard", who: "verified", act: "fab", phoneOnly: true, note: "phone: the « + » sheet (Nouvelle classe / Nouvelle fiche)" },
  { name: "profile-sheet", path: "/dashboard", who: "verified", act: "sheet", phoneOnly: true, note: "phone: the « Profil » tab sheet (the rest of the navigation)" },
  { name: "classes", path: "/dashboard/classes", who: "verified", note: "Mes classes: upcoming and past, with actions" },
  { name: "new-class", path: "/dashboard/new-class", who: "verified", act: "fill-class", note: "Nouvelle classe, filled: 3 sections, live student preview, sticky « Publier »" },
  { name: "new-class-draft", path: "/dashboard/new-class", who: "draft", note: "Nouvelle classe for an unverified tutor: the verification banner on top" },
  { name: "new-class-published", path: "/dashboard/new-class", who: "publisher", act: "publish-class", note: "Nouvelle classe, published: the class link + the share sheet opened on it" },
  { name: "materials", path: "/dashboard/materials", who: "verified", note: "Mes fiches" },
  { name: "new-pack", path: "/dashboard/new-pack", who: "publisher", act: "pack-file", note: "Nouvelle fiche with the file uploaded right there" },
  { name: "students", path: "/dashboard/students", who: "verified", note: "Mes élèves: bookers, followers (« Suit ta page »), subscribers (« Abonnement mensuel »), first names only" },
  { name: "subscriptions", path: "/dashboard/subscriptions", who: "verified", note: "Abonnements: the offer, a request to confirm, an active subscriber" },
  { name: "storefront", path: "/dashboard/storefront", who: "verified", note: "Ma vitrine: the link, « Vues · Clics · Abonnés » for 30 days" },
  { name: "storefront-share", path: "/dashboard/storefront", who: "verified", act: "share", note: "Ma vitrine with the share sheet open" },
  { name: "storefront-preview", path: "/dashboard/storefront/preview", who: "draft", note: "the owner preview: « Aperçu privé · pas encore en ligne »" },
  { name: "promotions", path: "/dashboard/promotions", who: "verified", note: "Promotions: the 1–20 % slider with the live preview, the two promotions" },
  { name: "verify-1", path: "/onboarding/verify", who: "walker", note: "Vérification step 1 · Identité" },
  { name: "verify-2", path: "/onboarding/verify", who: "walker", act: "verify-2", note: "Vérification step 2 · Parcours (optional, « Passer »)" },
  { name: "verify-3", path: "/onboarding/verify", who: "walker", act: "verify-3", note: "Vérification step 3 · Déclaration" },
  { name: "verify-pending", path: "/onboarding/verify", who: "pending", note: "Vérification sent: « En cours · 24–48 h »" },
  { name: "verify-rejected", path: "/onboarding/verify", who: "rejected", note: "Vérification « Refusée » with the reason" },
  { name: "verify-verified", path: "/onboarding/verify", who: "verified", note: "Vérification « Validée »" },
  { name: "onboarding", path: "/onboarding", who: "fresh", note: "/onboarding: a tutor account with no page yet" },
  { name: "plan", path: "/dashboard/plan", who: "verified", note: "Mon offre: Pilote + the compact plan summary" },
  { name: "settings-compte", path: "/dashboard/settings", who: "verified", note: "Réglages › Compte" },
  { name: "settings-vitrine", path: "/dashboard/settings?tab=vitrine", who: "verified", note: "Réglages › Vitrine" },
  { name: "settings-notifications", path: "/dashboard/settings?tab=notifications", who: "verified", note: "Réglages › Notifications" },
  { name: "settings-securite", path: "/dashboard/settings?tab=securite", who: "verified", note: "Réglages › Sécurité" },
  { name: "messages", path: "/messages", who: "verified", note: "Messages: the tutor's threads" },
  { name: "messages-thread", path: "/messages/__THREAD__", who: "verified", note: "a message thread" },
  // ── public pages this project changed ──
  { name: "public-profile", path: "/__SLUG__", who: "anon", note: "/{slug}: verified profile, Suivre, offer, promo prices" },
  { name: "coming-soon", path: "/__PENDING__", who: "anon", note: "/{slug} of a tutor not online yet: « Ce prof arrive bientôt » + Suivre" },
  { name: "class", path: "/class/__CLASS__", who: "anon", note: "/class/{id}: struck price, badge, Suivre" },
  { name: "aide", path: "/aide", who: "anon", note: "/aide" },
  { name: "tarifs", path: "/tarifs", who: "anon", note: "/tarifs: one CTA per plan, « +10 % » and « Bientôt » once" },
  { name: "auth-password", path: "/auth", who: "anon", act: "auth-password", note: "/auth: the password step" },
  { name: "signup-prof-password", path: "/signup/prof", who: "anon", act: "signup-password", note: "/signup/prof: « Crée ton mot de passe » after the code" },
];

const VIEWPORTS = [
  { tag: "1440", width: 1440, height: 900 },
  { tag: "390", width: 390, height: 844 },
] as const;
const LOCALES = ["fr", "ar"] as const;

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

/** Tomorrow-ish, as the DD/MM/YYYY the date field takes. */
function soonDate(): string {
  const d = new Date(Date.now() + 36 * 3600_000);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/** A class at a round Tunis hour (UTC+1, no DST), `days` from today. */
function tunisAt(days: number, hour: number): Date {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setUTCHours(hour - 1, 0, 0, 0);
  return d;
}

/* ONE session per account for the whole run, so Réglages › Sécurité lists the
   handful of devices a real tutor has, not one per screenshot. */
const tokens = new Map<string, string>();

async function contextFor(browser: Browser, who: Who, viewport: { width: number; height: number }, ids: Partial<Record<Who, string>>) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: "reduce" });
  if (who !== "anon") {
    const id = ids[who]!;
    if (!tokens.has(id)) tokens.set(id, await mintSession(id));
    await ctx.addCookies([sessionCookie(tokens.get(id)!)]);
    const u = new URL(BASE_URL);
    await ctx.addCookies([{ name: "tnajem_role", value: "tutor", domain: u.hostname, path: "/" }]);
  }
  // The share sheet opens networks in new tabs; nothing leaves the machine.
  await ctx.addInitScript(() => { window.open = (() => null) as typeof window.open; });
  return ctx;
}

async function act(page: Page, a: Act | undefined, locale: "fr" | "ar", withPassword: string) {
  if (!a) return;
  if (a === "share") {
    await page.locator("[data-e2e=share-open-profile]").first().click({ timeout: 5_000 });
    await page.locator("[data-e2e=share-sheet]").waitFor({ timeout: 5_000 });
  }
  if (a === "bell") {
    await page.locator("[data-e2e=shell-bell]").click({ timeout: 5_000 });
    await page.locator("#aps-bell-panel").waitFor({ timeout: 5_000 });
  }
  if (a === "fab") {
    await page.locator("[data-e2e=shell-fab]").click({ timeout: 5_000 });
    await page.locator("[data-e2e=shell-fab-menu]").waitFor({ timeout: 5_000 });
  }
  if (a === "sheet") {
    await page.locator("[data-e2e=tab-profile]").click({ timeout: 5_000 });
    await page.locator("[data-e2e=shell-sheet]").waitFor({ timeout: 5_000 });
  }
  if (a === "fill-class" || a === "publish-class") {
    await page.locator("main form input[type=text]").first().fill(locale === "fr" ? "Intégrales : révision express" : "التكامل: مراجعة سريعة");
    await page.locator("[data-e2e=date-input]").fill(soonDate());
    await page.locator("[data-e2e=time-input]").fill("18:00");
    await page.locator("[data-e2e=class-level] label").nth(1).click();
    await page.locator("main form input[type=number]").first().fill("15");
    await page.locator("[data-e2e=class-seats]").fill("6");
    if (a === "publish-class") {
      await page.locator("main form button[type=submit]").click();
      await page.locator("[data-e2e=class-published]").waitFor({ timeout: 15_000 });
      await page.locator("[data-e2e=share-sheet]").waitFor({ timeout: 5_000 }).catch(() => {});
    } else {
      await page.waitForTimeout(800); // the draft autosave
    }
  }
  if (a === "pack-file") {
    await page.locator("main form input[type=text]").first().fill(locale === "fr" ? "Pack révision : Dérivées" : "باك مراجعة: المشتقات");
    await page.locator("main form input[type=text]").nth(1).fill(locale === "fr" ? "42 pages · 3 exercices corrigés" : "42 صفحة · 3 تمارين مصلّحة");
    await page.locator("[data-e2e=pack-file-input]").setInputFiles({ name: "derivees.png", mimeType: "image/png", buffer: PNG });
    await page.locator("main form input[type=number]").first().fill("8");
  }
  if (a === "verify-2" || a === "verify-3") {
    await page.locator("input[name=idFront]").setInputFiles({ name: "cin-recto.png", mimeType: "image/png", buffer: PNG });
    await page.locator("[data-e2e=verify-next]").click();
    if (a === "verify-3") await page.locator("[data-e2e=verify-skip]").click();
  }
  if (a === "auth-password") {
    await resetRateLimits();
    await page.locator('input[type="email"]').fill(withPassword);
    await page.locator("main form").first().evaluate((f: HTMLFormElement) => f.requestSubmit());
    await page.locator('[data-e2e="auth-step-password"]').waitFor({ timeout: 20_000 });
  }
  if (a === "signup-password") {
    await resetRateLimits();
    const address = email(`e2e-ep2all-${randomBytes(4).toString("hex")}`);
    await page.locator('input[type="email"]').fill(address);
    // live-fixes-2 · C: the shell Selects, by their hooks (either language)
    await chooseOption(page, page.locator("[data-e2e=birth-month]"), "3");
    await chooseOption(page, page.locator("[data-e2e=birth-year]"), "1988");
    await page.locator("main form").first().evaluate((f: HTMLFormElement) => f.requestSubmit());
    await page.locator('[data-e2e="auth-step-code"]').waitFor({ timeout: 20_000 });
    await expect.poll(async () => (await sql<{ n: number }[]>`select count(*)::int n from otp_codes where identifier = ${address}`)[0].n, { timeout: 20_000 }).toBe(1);
    await fillOtp(page, await recoverOtp(address));
    await page.locator('[data-e2e="auth-step-password-create"]').waitFor({ timeout: 20_000 });
    await page.locator('[data-e2e="new-password"]').fill("Ma prof de maths 2026!");
  }
  await page.mouse.move(0, 0);
  await page.waitForTimeout(250);
}

test("capture every prof page + the changed public pages, FR + AR, 1440 + 390", async ({ browser }) => {
  test.setTimeout(45 * 60_000);
  await mkdir(OUT, { recursive: true });

  const tutorRow = async (fullName: string, status: "draft" | "pending" | "rejected" | "verified", slug: string, birthYear = 1988) => {
    const p = await seedProfile({ role: "tutor", fullName, birthYear });
    const t = await seedTutor({ profileId: p.id, status, fullName });
    await sql`update tutors set slug = ${`${slug}-${RUN}`}, subject = 'Mathématiques', level = 'Bac',
                bio = ${"Prof de maths au lycée. Je prépare le bac en petits groupes : la méthode, les exercices types et beaucoup de pratique."}
              where id = ${t.id}`;
    return { p, t: { ...t, slug: `${slug}-${RUN}` } };
  };
  const madeTutors: string[] = [];
  const track = <T extends { t: { id: string } }>(x: T) => { madeTutors.push(x.t.id); return x; };

  try {
    const amel = track(await tutorRow("Amel Ben Salah", "verified", "amel-ben-salah", 1986));
    const draft = track(await tutorRow("Walid Tester", "draft", "walid-tester", 1990));
    const walker = track(await tutorRow("Walid Tester", "draft", "walid-verif", 1990));
    const pending = track(await tutorRow("Karim Mansour", "pending", "karim-mansour", 1989));
    const rejected = track(await tutorRow("Rim Ben Ali", "rejected", "rim-ben-ali", 1991));
    await sql`update tutors set review_note = ${"La photo de la CIN est floue : reprends-la en pleine lumière."} where id = ${rejected.t.id}`;
    const publisher = track(await tutorRow("Nour Haddad", "verified", "nour-haddad", 1987));
    const fresh = await seedProfile({ role: "tutor", fullName: "Hedi Nouveau", birthYear: 1992 });

    // Amel's classes, with real titles.
    const named = async (id: string, title: string, description: string) =>
      sql`update classes set title = ${title}, description = ${description} where id = ${id}`;
    const soon = await seedClass({ tutorId: amel.t.id, isFreeFirst: false, priceTnd: 40, at: tunisAt(1, 18), seats: 6 });
    await named(soon.id, "Intégrales — révision express", "Les intégrales du programme de bac, en 90 minutes : méthode et exercices types.");
    const later = await seedClass({ tutorId: amel.t.id, isFreeFirst: false, priceTnd: 25, at: tunisAt(5, 10), seats: 10 });
    await named(later.id, "Suites numériques : exercices corrigés", "Raisonnement par récurrence, limites, suites adjacentes.");
    const past = await seedClass({ tutorId: amel.t.id, isFreeFirst: false, priceTnd: 30, at: tunisAt(-4, 18), seats: 8 });
    await named(past.id, "Probabilités — bac blanc", "Un sujet de bac blanc corrigé ensemble.");
    await sql`insert into packs (tutor_id, title, description, price_tnd)
              values (${amel.t.id}, 'Fiches de révision : Analyse', '36 pages · méthodes et exercices corrigés', 12)`;

    // Students: bookers, followers, a subscription request, an active subscriber.
    const student = (n: string, y: number) => seedProfile({ role: "student", fullName: n, birthYear: y });
    const yosra = await student("Yosra Trabelsi", 1999);
    const mehdi = await student("Mehdi Jaziri", 2000);
    const rania = await student("Rania Gharbi", 1996);
    const omar = await student("Omar Jlassi", 1995);
    await seedBooking({ classId: past.id, studentId: yosra.id, status: "attended" });
    await seedBooking({ classId: past.id, studentId: mehdi.id, status: "attended" });
    await seedBooking({ classId: soon.id, studentId: mehdi.id, isFree: false });
    await seedFollow(rania.id, amel.t.id);
    await seedFollow(omar.id, amel.t.id);
    const offer = await seedOffer({ tutorId: amel.t.id, title: "Suivi Bac — 4 séances", sessionsPerMonth: 4, priceTnd: 120 });
    await seedPromotion({ tutorId: amel.t.id, percent: 15, endsInDays: 9 });
    await seedPromotion({ tutorId: amel.t.id, percent: 20, code: "RENTREE", endsInDays: 20, maxUses: 30 });
    await sql`insert into student_subscriptions (offer_id, tutor_id, student_profile_id, status, sessions_per_month, price_tnd)
              values (${offer.id}, ${amel.t.id}, ${rania.id}, 'requested', 4, 102)`;
    await sql`insert into student_subscriptions (offer_id, tutor_id, student_profile_id, status, sessions_per_month, price_tnd,
                                                 period_start, period_end, confirmed_at)
              values (${offer.id}, ${amel.t.id}, ${omar.id}, 'active', 4, 120,
                      now() - interval '26 days', now() + interval '4 days', now() - interval '26 days')`;
    /* A month of « Vues · Clics », reset before every shot: the harness's own visits
       to the public page are real beacons and would otherwise grow it shot by shot. */
    const resetStats = async () => {
      await sql`delete from vitrine_stats_daily where tutor_id = ${amel.t.id}`;
      for (const [source, views, clicks] of [["whatsapp", 14, 14], ["direct", 9, 0], ["facebook", 5, 5], ["qr", 2, 2]] as const) {
        await sql`insert into vitrine_stats_daily (tutor_id, day, source, views, clicks)
                  values (${amel.t.id}, (now() at time zone 'Africa/Tunis')::date, ${source}, ${views}, ${clicks})`;
      }
    };

    // A real thread: Yosra books the next class through the API and writes; Amel answers.
    const yosraToken = await mintSession(yosra.id);
    const booked = await api("/bookings", yosraToken, { classId: soon.id });
    expect(booked.ok, JSON.stringify(booked)).toBe(true);
    const [{ id: bookingId }] = await sql<{ id: string }[]>`select id from bookings where class_id = ${soon.id} and student_id = ${yosra.id}`;
    const threadId = String((await api("/threads", yosraToken, { bookingId })).threadId);
    expect((await api(`/threads/${threadId}/messages`, yosraToken, { body: "Bonjour Madame, est-ce qu'on verra aussi les intégrales par parties ?" })).ok).toBe(true);
    const amelToken = await mintSession(amel.p.id);
    expect((await api(`/threads/${threadId}/messages`, amelToken, { body: "Bonjour Yosra, oui : la deuxième partie de la séance. Prépare l'exercice 3 de la fiche." })).ok).toBe(true);
    expect((await api(`/threads/${threadId}/messages`, yosraToken, { body: "Merci, à jeudi !" })).ok).toBe(true);

    // Unread notifications for the bell (kinds the product writes).
    for (const [kind, title, body, href] of [
      ["new_follower", "Nouvel abonné", "Omar te suit : il sera prévenu de tes nouvelles séances et fiches.", "/dashboard/students"],
      ["subscription_requested", "Nouvelle demande d'abonnement", "Rania demande « Suivi Bac — 4 séances ».", "/dashboard/subscriptions"],
      ["new_booking", "Nouvelle réservation", "Yosra a réservé « Intégrales — révision express ».", "/dashboard/classes"],
    ] as const) {
      await sql`insert into notifications (id, profile_id, kind, title, body, href) values (${randomUUID()}, ${amel.p.id}, ${kind}, ${title}, ${body}, ${href})`;
    }

    // /auth's password step: an account that has one.
    const withPw = await seedProfile({ role: "student", birthYear: 1994 });
    await seedPassword(withPw.id, E2E_PASSWORD);

    const ids: Partial<Record<Who, string>> = {
      fresh: fresh.id, draft: draft.p.id, walker: walker.p.id, pending: pending.p.id,
      rejected: rejected.p.id, verified: amel.p.id, publisher: publisher.p.id,
    };
    const fill = (path: string) => path
      .replace("__SLUG__", amel.t.slug).replace("__PENDING__", pending.t.slug)
      .replace("__CLASS__", soon.id).replace("__THREAD__", threadId);

    const written: { file: string; shot: Shot; locale: string; vp: string }[] = [];
    const failed: string[] = [];
    for (const locale of LOCALES) {
      for (const vp of VIEWPORTS) {
        for (const s of SHOTS) {
          if (s.phoneOnly && vp.width >= 900) continue;
          // Same state in every shot: the stats, the bell and the thread unread again.
          await resetStats();
          await sql`update notifications set read_at = null where profile_id = ${amel.p.id}`;
          await sql`update message_threads set tutor_read_at = null where id = ${threadId}`;
          const ctx = await contextFor(browser, s.who, { width: vp.width, height: vp.height }, ids);
          const page = await ctx.newPage();
          const file = `${s.name}-${locale}-${vp.tag}.png`;
          try {
            await page.goto(`/${locale}${fill(s.path)}`);
            await settle(page);
            await act(page, s.act, locale, withPw.email);
            const modal = s.act === "share" || s.act === "bell" || s.act === "fab" || s.act === "sheet";
            // Filling a form scrolls it; a full-page shot then draws the sticky bars mid-image.
            if (!modal && s.act !== "publish-class") await page.evaluate(() => window.scrollTo(0, 0));
            await page.screenshot({ path: join(OUT, file), fullPage: !modal, animations: "disabled", caret: "hide" });
            written.push({ file, shot: s, locale, vp: vp.tag });
          } catch (e) {
            failed.push(`${file}: ${(e as Error).message.split("\n")[0]}`);
          } finally {
            await ctx.close();
          }
        }
      }
    }

    const lines = [
      "# Espace prof v2 — screenshots (phase 8)",
      "",
      `Captured by \`e2e/visual/ep2-all.capture.ts\` (\`npm run ui:shots-ep2\`) against a production build on a scratch database, ${new Date().toISOString().slice(0, 10)}.`,
      "Files: `<page>-<fr|ar>-<1440|390>.png`. Full page unless the shot is an open sheet / menu (viewport only). Test data only (seeded tutors and students, `.invalid` addresses).",
      "",
      "| page | what it shows | FR 1440 | FR 390 | AR 1440 | AR 390 |",
      "|---|---|---|---|---|---|",
      ...SHOTS.map((s) => {
        const cell = (l: string, v: string) => {
          const f = `${s.name}-${l}-${v}.png`;
          return written.some((w) => w.file === f) ? `[png](${f})` : s.phoneOnly && v === "1440" ? "—" : "**missing**";
        };
        return `| \`${s.name}\` | ${s.note} | ${cell("fr", "1440")} | ${cell("fr", "390")} | ${cell("ar", "1440")} | ${cell("ar", "390")} |`;
      }),
      "",
      `${written.length} files.${failed.length ? ` ${failed.length} failed:` : ""}`,
      ...failed.map((f) => `- ${f}`),
      "",
    ];
    await writeFile(join(OUT, "index.md"), lines.join("\n"), "utf8");
    expect(failed, failed.join("\n")).toEqual([]);
  } finally {
    // Readable slugs back to e2e-… so the suite's teardown removes these rows.
    for (const id of madeTutors) await sql`update tutors set slug = ${`e2e-ep2all-${randomBytes(5).toString("hex")}`} where id = ${id}`;
  }
});
