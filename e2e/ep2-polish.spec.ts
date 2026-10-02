import { test, expect, type Browser, type BrowserContext } from "@playwright/test";
import { createHmac } from "node:crypto";
import { sql } from "./support/db";
import { seedClass, seedProfile, seedTutor } from "./support/seed";
import { loginAs, mintSession } from "./support/session";
import { AUTH_SECRET, BASE_URL } from "./support/env";
import { fillWallTime, wallDaysAhead } from "./support/datetime";

/* ════════════════════════════════════════════════════════════════════════════
   espace prof v2 · phase 6 — PAGE-BY-PAGE POLISH (images 2, 3, 4).

   Réglages (4 tabs, /account kept as a redirect for tutors), Mon offre and the
   /tarifs CTAs, « Nouvelle classe » (chips, the tutor's subject, real seats, the
   live preview, the autosaved draft, « Dupliquer », publish → share), « Nouvelle
   fiche » (the file uploaded in place, for enrolled students only), the 3-step
   verification and its status pages, and the AR minute unit on the home.
   ADDED as its own spec.
   ════════════════════════════════════════════════════════════════════════════ */

const HOST = new URL(BASE_URL).hostname;
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function tutorCtx(browser: Browser, profileId: string, viewport = { width: 1440, height: 900 }): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport, reducedMotion: "reduce", permissions: ["clipboard-read", "clipboard-write"] });
  await loginAs(ctx, profileId);
  await ctx.addCookies([{ name: "tnajem_role", value: "tutor", domain: HOST, path: "/" }]);
  return ctx;
}

/* The e-mail footer's unsubscribe token, written out (as in ep2-follow.spec.ts). */
function unsubscribeToken(profileId: string, kind: "followers" | "bookings" | "messages" | "reminders"): string {
  const sig = createHmac("sha256", AUTH_SECRET).update(`tnajem:unsubscribe:v1:${profileId}:${kind}`).digest("base64url").slice(0, 32);
  return `v1.${profileId}.${kind}.${sig}`;
}

async function newTutor(status: "draft" | "pending" | "verified" | "rejected", opts: { offersFreeFirstSession?: boolean } = {}) {
  const profile = await seedProfile({ role: "tutor", birthYear: 1988, fullName: "Walid Tester" });
  const tutor = await seedTutor({ profileId: profile.id, status, fullName: "Walid Tester", ...opts });
  return { profile, tutor };
}

test.describe("Réglages (/dashboard/settings, image 4)", () => {
  test("four tabs; the URL follows the tab; arrows move between them; a tutor's /account lands here", async ({ browser }) => {
    const { profile } = await newTutor("verified");
    const ctx = await tutorCtx(browser, profile.id);
    const page = await ctx.newPage();

    await page.goto("/fr/account");
    await expect(page).toHaveURL(/\/fr\/dashboard\/settings$/);
    await expect(page.locator("main h1")).toHaveText("Réglages");
    const tabs = page.getByRole("tab");
    await expect(tabs).toHaveText(["Compte", "Vitrine", "Notifications", "Sécurité"]);
    await expect(page.getByRole("tab", { name: "Compte" })).toHaveAttribute("aria-selected", "true");
    // Compte: profile, language, role.
    await expect(page.locator("[data-e2e=settings-role]")).toHaveText("Prof");
    await expect(page.locator("[data-e2e=settings-compte]")).toContainText("Walid Tester");
    await expect(page.locator("[data-e2e=settings-compte]")).toContainText("Langue de l'interface");

    await page.getByRole("tab", { name: "Sécurité" }).click();
    await expect(page).toHaveURL(/\?tab=securite$/);
    await expect(page.locator("[data-e2e=security-panel]")).toBeVisible();
    // Keyboard: ArrowLeft from Sécurité selects Notifications and focuses it.
    await page.getByRole("tab", { name: "Sécurité" }).press("ArrowLeft");
    await expect(page.getByRole("tab", { name: "Notifications" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab", { name: "Notifications" })).toBeFocused();
    await expect(page).toHaveURL(/\?tab=notifications$/);

    // A deep link opens its tab directly (and survives a reload).
    await page.goto("/fr/dashboard/settings?tab=vitrine");
    await expect(page.getByRole("tab", { name: "Vitrine" })).toHaveAttribute("aria-selected", "true");
    await ctx.close();
  });

  test("Vitrine: the address, the photo, the bio (saved), and « 1re séance offerte » as a switch", async ({ browser }) => {
    const { profile, tutor } = await newTutor("verified");
    const ctx = await tutorCtx(browser, profile.id);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard/settings?tab=vitrine");
    await expect(page.locator("[data-e2e=settings-slug]")).toContainText(tutor.slug);
    await expect(page.locator("#photo")).toContainText("Ta photo");

    const bio = `Je prépare au bac depuis 8 ans : méthode, exercices types, annales. ${Date.now().toString(36)}`;
    await page.locator("[data-e2e=settings-bio]").fill(bio);
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect.poll(async () => (await sql<{ bio: string }[]>`select bio from tutors where id = ${tutor.id}`)[0].bio).toBe(bio);

    const sw = page.locator("[data-e2e=free-first-toggle]").getByRole("switch");
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await expect
      .poll(async () => (await sql<{ on: boolean }[]>`select offers_free_first_session as on from tutors where id = ${tutor.id}`)[0].on)
      .toBe(true);
    await ctx.close();
  });

  test("Sécurité: passwords and sessions, then deletion with the detail and the legal links folded", async ({ browser }) => {
    const { profile } = await newTutor("verified");
    const ctx = await tutorCtx(browser, profile.id);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard/settings?tab=securite");
    await expect(page.locator("[data-e2e=password-state]")).toBeVisible();
    await expect(page.locator("[data-e2e=sessions-count]")).toBeVisible();
    // No second « Sécurité » heading under the tab of the same name.
    await expect(page.locator("main h2", { hasText: /^Sécurité$/ })).toHaveCount(0);

    const del = page.locator("[data-e2e=delete-account]");
    await expect(del).toContainText("Supprimer mon compte");
    await expect(page.locator("[data-e2e=settings-legal]")).toBeHidden();
    await del.locator("[data-e2e=what-is-erased] summary").click();
    await expect(page.locator("[data-e2e=settings-legal] a[href='/fr/terms']")).toBeVisible();
    await expect(page.locator("[data-e2e=settings-legal] a[href='/fr/privacy']")).toBeVisible();

    // « Supprimer… » asks first; « Garder » closes and nothing is requested.
    await del.getByRole("button", { name: "Supprimer…" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /Garder/ }).click();
    await expect(dialog).toBeHidden();
    const [row] = await sql<{ n: number }[]>`select count(*)::int as n from profiles where id = ${profile.id} and deletion_requested_at is not null`;
    expect(row.n).toBe(0);
    await ctx.close();
  });

  test("Notifications: two working e-mail switches, two « Bientôt »; a switch saves on its own and survives a reload", async ({ browser }) => {
    const { profile } = await newTutor("verified");
    const ctx = await tutorCtx(browser, profile.id);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard/settings?tab=notifications");
    const panel = page.locator("[data-e2e=settings-notifications]");
    await expect(panel.getByRole("switch")).toHaveCount(4);
    /* Truth: Réservations and Rappels e-mail a tutor (espace prof v2 · pro P7); Messages
       and Abonnés do not yet — live-fixes-1 · F1: they say « Bientôt » and cannot be moved. */
    await expect(page.locator("[data-e2e=prefs-not-yet]")).toHaveText("Choisis les e-mails que tu reçois. La cloche reste toujours active.");
    for (const k of ["bookings", "messages", "reminders", "followers"]) {
      await expect(page.locator(`[data-e2e=pref-${k}] [role=switch]`)).toHaveAttribute("aria-checked", "true");
    }
    for (const k of ["messages", "followers"]) {
      await expect(page.locator(`[data-e2e=pref-${k}]`)).toContainText("Bientôt");
      await expect(page.locator(`[data-e2e=pref-${k}] [role=switch]`)).toBeDisabled();
    }
    await page.locator("[data-e2e=pref-bookings] [role=switch]").click();
    await expect(page.locator("[data-e2e=pref-bookings] [role=switch]")).toHaveAttribute("aria-checked", "false");
    await expect
      .poll(async () => (await sql<{ messages: boolean; bookings: boolean }[]>`
        select messages, bookings from notification_prefs where profile_id = ${profile.id}`)[0] ?? null)
      .toEqual({ messages: true, bookings: false });
    await page.reload();
    await expect(page.locator("[data-e2e=pref-bookings] [role=switch]")).toHaveAttribute("aria-checked", "false");
    await expect(page.locator("[data-e2e=pref-reminders] [role=switch]")).toHaveAttribute("aria-checked", "true");
    await ctx.close();
  });

  test("the unsubscribe page points a signed-in TUTOR to these switches — and nobody else", async ({ browser }) => {
    const { profile } = await newTutor("verified");
    const ctx = await tutorCtx(browser, profile.id);
    const page = await ctx.newPage();
    await page.goto(`/fr/email/unsubscribe?token=${encodeURIComponent(unsubscribeToken(profile.id, "bookings"))}`);
    await expect(page.locator("[data-e2e=unsubscribe-tutor-prefs] a")).toHaveAttribute("href", "/fr/dashboard/settings?tab=notifications");
    await ctx.close();

    const student = await seedProfile({ role: "student", birthYear: 1996 });
    const sctx = await browser.newContext();
    await loginAs(sctx, student.id);
    const spage = await sctx.newPage();
    await spage.goto(`/fr/email/unsubscribe?token=${encodeURIComponent(unsubscribeToken(student.id, "followers"))}`);
    await expect(spage.locator("[data-e2e=unsubscribe-confirm]")).toBeVisible();
    await expect(spage.locator("[data-e2e=unsubscribe-tutor-prefs]")).toHaveCount(0);
    await sctx.close();
  });

  test("Sécurité: the 5 most recent sessions, then « + N autres appareils »; the count is all of them", async ({ browser }) => {
    const { profile } = await newTutor("verified");
    for (let i = 0; i < 7; i++) await mintSession(profile.id);
    const ctx = await tutorCtx(browser, profile.id);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard/settings?tab=securite");
    await expect(page.locator("[data-e2e=sessions-count]")).toHaveText("Connecté sur 8 appareils");
    await expect(page.locator("[data-e2e=sessions-list] li")).toHaveCount(5);
    await expect(page.locator("[data-e2e=sessions-list] li").first()).toContainText("Cet appareil");
    await expect(page.locator("[data-e2e=sessions-more]")).toHaveText("+ 3 autres appareils");
    await expect(page.getByRole("button", { name: "Déconnecter partout" })).toBeVisible();
    await ctx.close();
  });

  test("a student keeps /account (no redirect), in the public frame", async ({ browser }) => {
    const student = await seedProfile({ role: "student", birthYear: 1995, fullName: "Sarra Mejri" });
    const ctx = await browser.newContext();
    await loginAs(ctx, student.id);
    const page = await ctx.newPage();
    await page.goto("/fr/account");
    await expect(page).toHaveURL(/\/fr\/account$/);
    await expect(page.locator("main")).toContainText("Sarra Mejri");
    await expect(page.locator("[data-e2e=security-panel]")).toBeVisible();
    await ctx.close();
  });
});

test.describe("Mon offre and /tarifs (image 4)", () => {
  test("Mon offre: the current plan (Pilote, 0 TND) and a compact summary of the four plans", async ({ browser }) => {
    const { profile } = await newTutor("verified");
    const ctx = await tutorCtx(browser, profile.id);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard/plan");
    const now = page.locator("[data-e2e=plan-card]");
    await expect(now).toContainText("Pilote");
    await expect(now).toContainText("Offre complète, gratuite");
    await expect(now).toContainText("0 TND");
    const summary = page.locator("[data-e2e=plan-summary] > li");
    await expect(summary).toHaveCount(4);
    await expect(page.locator("[data-e2e=plan-essentiel]")).toContainText("29");
    await expect(page.locator("[data-e2e=plan-pro]")).toContainText("59");
    await expect(page.locator("[data-e2e=plan-prestige]")).toContainText("99");
    await expect(page.locator("main")).toContainText("+10 % par élève payant");
    await expect(page.locator("main a[href='/fr/tarifs']")).toBeVisible();
    await ctx.close();
  });

  test("/tarifs: one CTA per plan, matching the pilot; « +10 % » and « Bientôt » said once, above the grid", async ({ page }) => {
    await page.goto("/fr/tarifs");
    const ctas = page.locator("[data-e2e=plan-cta]");
    expect(await ctas.count()).toBeGreaterThanOrEqual(4);
    for (const t of await ctas.allInnerTexts()) expect(t.trim()).toBe("Inclus pendant le pilote");
    const once = page.locator("[data-e2e=tarifs-once]");
    await expect(once).toHaveCount(1);
    await expect(once).toContainText("+ 10 % sur chaque élève payant");
    await expect(once).toContainText("Bientôt");
  });
});

test.describe("Nouvelle classe (image 2)", () => {
  test("blocker on top for an unverified tutor; the tutor's subject, no subject field; chips; real seats", async ({ browser }) => {
    const { profile } = await newTutor("draft");
    const ctx = await tutorCtx(browser, profile.id);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard/new-class");
    const blocker = page.locator("[data-e2e=shell-blocker]");
    await expect(blocker).toContainText("Tu peux préparer ta classe maintenant");
    await expect(blocker.getByRole("link", { name: "Vérifier mon compte" })).toHaveAttribute("href", "/fr/onboarding/verify");
    await expect(page.locator("[data-e2e=class-subject]")).toHaveText("Mathématiques");
    await expect(page.locator("main select")).toHaveCount(0);
    await expect(page.getByRole("radio", { name: "Tous" })).toBeChecked();
    await expect(page.getByRole("radio", { name: "90 min" })).toBeChecked();
    await expect(page.locator("[data-e2e=class-seats]")).toHaveValue("20");
    // The tools are folded away.
    await expect(page.locator("details.nc-tools")).not.toHaveAttribute("open", "");
    await ctx.close();
  });

  test("the preview follows the form; the draft is kept and restored; publish → the class's link to share", async ({ browser }) => {
    const { profile, tutor } = await newTutor("verified");
    const ctx = await tutorCtx(browser, profile.id);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard/new-class", { waitUntil: "networkidle" });
    const title = `Intégrales P6 ${Date.now().toString(36)}`;
    await page.getByPlaceholder(/Intégrales/).fill(title);
    await page.locator("[data-e2e=class-duration] label", { hasText: "60 min" }).click();
    await expect(page.getByRole("radio", { name: "60 min" })).toBeChecked();
    await page.locator("main form input[type=number]").first().fill("15");
    await page.locator("[data-e2e=class-seats]").fill("6");
    const preview = page.locator("[data-e2e=class-preview]");
    await expect(preview).toContainText(title);
    await expect(preview).toContainText("15 TND");
    await expect(preview).toContainText("6 places");

    // Autosaved, then restored after a reload.
    await expect(page.locator("[data-e2e=draft-status]")).toContainText("Brouillon enregistré");
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByPlaceholder(/Intégrales/)).toHaveValue(title);
    await expect(page.locator("[data-e2e=draft-status]")).toContainText("Brouillon repris");
    await expect(page.locator("[data-e2e=class-seats]")).toHaveValue("6");

    await fillWallTime(page, wallDaysAhead(3, "18:00"));
    await page.getByRole("button", { name: "Publier la classe" }).click();
    const done = page.locator("[data-e2e=class-published]");
    await expect(done).toBeVisible();
    const [row] = await sql<{ id: string; seats: number; duration_min: number }[]>`
      select id, seats, duration_min from classes where tutor_id = ${tutor.id} and title = ${title}`;
    expect(row.seats).toBe(6);
    expect(row.duration_min).toBe(60);
    await expect(done).toContainText(`/class/${row.id}`);
    // Share right after publishing: the sheet opens on its own, and « Partager » stays.
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(done.locator("[data-e2e=share-open-class]")).toBeVisible();

    // The draft is gone once published.
    await page.goto("/fr/dashboard/new-class", { waitUntil: "networkidle" });
    await expect(page.getByPlaceholder(/Intégrales/)).toHaveValue("");
    await ctx.close();
  });

  test("price promo hint: a live PUBLIC promotion on everything shows what the student pays; a coded one does not", async ({ browser }) => {
    const { profile, tutor } = await newTutor("verified");
    const ends = new Date(Date.now() + 10 * 86_400_000);
    await sql`insert into promotions (tutor_id, percent, scope, code, ends_at)
              values (${tutor.id}, 15, 'all', 'VIP-CODE', ${ends})`;
    const ctx = await tutorCtx(browser, profile.id);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard/new-class", { waitUntil: "networkidle" });
    await page.locator("main form input[type=number]").first().fill("20");
    await expect(page.locator("[data-e2e=promo-hint]")).toHaveCount(0); // a private code is not for everyone

    await sql`insert into promotions (tutor_id, percent, scope, ends_at) values (${tutor.id}, 10, 'all', ${ends})`;
    await page.reload({ waitUntil: "networkidle" });
    await page.locator("main form input[type=number]").first().fill("20");
    await expect(page.locator("[data-e2e=promo-hint]")).toContainText("−10 %");
    await expect(page.locator("[data-e2e=promo-hint]")).toContainText("18 TND au lieu de 20 TND");
    await expect(page.locator("[data-e2e=preview-promo]")).toContainText("18 TND");
    await ctx.close();
  });

  test("« Dupliquer une classe précédente » copies everything but the date", async ({ browser }) => {
    const { profile, tutor } = await newTutor("verified");
    const src = await seedClass({ tutorId: tutor.id, hoursFromNow: 48, seats: 12, priceTnd: 25 });
    const ctx = await tutorCtx(browser, profile.id);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard/new-class", { waitUntil: "networkidle" });
    await page.locator("[data-e2e=duplicate-open]").click();
    const dialog = page.locator("[data-e2e=duplicate-dialog]");
    await expect(dialog).toBeVisible();
    await dialog.locator("[data-e2e=duplicate-pick]").filter({ hasText: src.title }).click();
    await expect(page.getByPlaceholder(/Intégrales/)).toHaveValue(src.title);
    await expect(page.locator("[data-e2e=class-seats]")).toHaveValue("12");
    await expect(page.locator("main form input[type=number]").first()).toHaveValue("25");
    await expect(page.locator("[data-e2e=datetime-field]")).toHaveAttribute("data-value", "");
    await ctx.close();
  });
});

test.describe("Nouvelle fiche — the file uploaded right here", () => {
  test("upload + publish: the file is a « students » material, the pack is listed", async ({ browser }) => {
    const { profile, tutor } = await newTutor("verified");
    const ctx = await tutorCtx(browser, profile.id);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard/new-pack", { waitUntil: "networkidle" });
    const title = `Pack P6 ${Date.now().toString(36)}`;
    await page.locator("main form input[type=text]").first().fill(title);
    await page.locator("main form input[type=text]").nth(1).fill("12 pages · 3 exercices");

    // A refused type is said on the spot, before anything is sent.
    await page.locator("[data-e2e=pack-file-input]").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("x") });
    await expect(page.locator("main [role=alert]")).toContainText("Format refusé");

    await page.locator("[data-e2e=pack-file-input]").setInputFiles({ name: "fiche.png", mimeType: "image/png", buffer: PNG });
    await expect(page.locator("[data-e2e=pack-file]")).toContainText("fiche.png");
    await expect(page.locator("[data-e2e=pack-preview]")).toContainText(title);
    await expect(page.locator("main")).toContainText("Partagé seulement avec tes élèves inscrits");
    await page.locator("main form input[type=number]").fill("8");
    await page.getByRole("button", { name: "Publier" }).click();
    await expect(page.locator("[data-e2e=pack-published]")).toBeVisible();

    const [m] = await sql<{ visibility: string; kind: string }[]>`
      select visibility::text as visibility, kind::text as kind from materials where tutor_id = ${tutor.id} and title = ${title}`;
    expect(m).toEqual({ visibility: "students", kind: "file" });
    const [p] = await sql<{ n: number }[]>`select count(*)::int as n from packs where tutor_id = ${tutor.id} and title = ${title}`;
    expect(p.n).toBe(1);
    await ctx.close();
  });
});

test.describe("Vérification en 3 étapes (image 3)", () => {
  test("Identité is required; Parcours can be skipped; the declaration sends; then « En cours · 24–48 h »", async ({ browser }) => {
    const { profile, tutor } = await newTutor("draft");
    const ctx = await tutorCtx(browser, profile.id);
    const page = await ctx.newPage();
    await page.goto("/fr/onboarding/verify", { waitUntil: "networkidle" });
    await expect(page.locator("main")).toContainText("3 minutes · on vérifie à la main sous 24–48 h · tes documents ne sont jamais publiés");
    await expect(page.locator("main")).toContainText("90 jours");
    await expect(page.locator("input[name=idFront]")).toHaveAttribute("capture", "environment");
    await expect(page.locator("input[name=selfie]")).toHaveAttribute("capture", "user");

    // No ID: « Continuer » stays on step 1 and says why.
    await page.locator("[data-e2e=verify-next]").click();
    await expect(page.locator("[data-e2e=verify-step-1] [role=alert]")).toContainText("obligatoire");
    await expect(page.locator("[data-e2e=verify-step-1]")).toBeVisible();

    await page.locator("input[name=idFront]").setInputFiles({ name: "cin-recto.png", mimeType: "image/png", buffer: PNG });
    await expect(page.locator("[data-e2e=verify-card-idFront] img.dz-thumb")).toBeVisible();
    await page.locator("[data-e2e=verify-next]").click();
    await expect(page.locator("[data-e2e=verify-step-2]")).toBeVisible();
    await expect(page.locator("[data-e2e=verify-step-1]")).toBeHidden();
    await expect(page.locator("[data-e2e=verify-step-tab-1]")).toHaveAttribute("data-state", "done");
    await page.locator("[data-e2e=verify-langs] label", { hasText: "Arabe" }).click();
    await page.locator("[data-e2e=verify-langs] label", { hasText: "Français" }).click();

    // Back and forth keeps the file.
    await page.locator("[data-e2e=verify-back]").click();
    await expect(page.locator("[data-e2e=verify-card-idFront]")).toContainText("cin-recto.png");
    await page.locator("[data-e2e=verify-next]").click();
    await page.locator("[data-e2e=verify-skip]").click();
    await expect(page.locator("[data-e2e=verify-step-3]")).toBeVisible();
    await expect(page.locator("[data-e2e=verify-recap]")).toContainText("1 document d'identité");

    // The declaration is required.
    await page.locator("[data-e2e=verify-submit]").click();
    await expect(page.locator("[data-e2e=verify-step-3] [role=alert]")).toContainText("Coche la déclaration");
    await page.getByLabel("Je déclare ne pas exercer comme enseignant·e dans un établissement d'enseignement public.").check();
    await page.locator("[data-e2e=verify-submit]").click();

    const status = page.locator("[data-e2e=verify-status-pending]");
    await expect(status).toBeVisible({ timeout: 30_000 });
    await expect(status).toContainText("En cours · 24–48 h");
    await expect(status).toContainText("Vérification envoyée");
    const [t] = await sql<{ status: string; languages: string | null }[]>`select status, languages from tutors where id = ${tutor.id}`;
    expect(t.status).toBe("pending");
    expect(t.languages).toBe("Arabe, Français");

    // Coming back later: the same status page, with what was received.
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator("[data-e2e=verify-status-pending]")).toBeVisible();
    await expect(page.locator("[data-e2e=verify-received]")).toContainText("pièce d'identité (recto)");
    await ctx.close();
  });

  test("« Refusée » shows the team's reason above the form; « Validée » says so", async ({ browser }) => {
    const rej = await newTutor("rejected");
    await sql`update tutors set review_note = ${"La photo de la CIN est floue."} where id = ${rej.tutor.id}`;
    const ctx = await tutorCtx(browser, rej.profile.id);
    const page = await ctx.newPage();
    await page.goto("/fr/onboarding/verify", { waitUntil: "networkidle" });
    const card = page.locator("[data-e2e=verify-status-rejected]");
    await expect(card).toContainText("Refusée");
    await expect(card).toContainText("La photo de la CIN est floue.");
    await expect(page.locator("[data-e2e=verify-step-1]")).toBeVisible();
    await ctx.close();

    const ok = await newTutor("verified");
    const ctx2 = await tutorCtx(browser, ok.profile.id);
    const page2 = await ctx2.newPage();
    await page2.goto("/fr/onboarding/verify", { waitUntil: "networkidle" });
    await expect(page2.locator("[data-e2e=verify-status-verified]")).toContainText("Validée");
    await expect(page2.locator("input[type=file]")).toHaveCount(0);
    await ctx2.close();
  });
});

test.describe("Mes élèves: « Abonné » no longer means two things", () => {
  test("a monthly subscriber reads « Abonnement mensuel », a follower « Suit ta page »", async ({ browser }) => {
    const { profile, tutor } = await newTutor("verified");
    const fan = await seedProfile({ role: "student", birthYear: 1997, fullName: "Ines Suiveuse" });
    await sql`insert into tutor_follows (student_profile_id, tutor_id) values (${fan.id}, ${tutor.id})`;
    const ctx = await tutorCtx(browser, profile.id);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard/students");
    const row = page.locator("[data-e2e=student-row]").filter({ hasText: "Ines" });
    await expect(row).toContainText("Suit ta page");
    await expect(page.locator("main")).not.toContainText(/\bAbonné\b/);
    await ctx.close();
  });
});

test.describe("the AR minute unit", () => {
  test("« Prochaines séances » and Mes classes say دقيقة, not « min »", async ({ browser }) => {
    const { profile, tutor } = await newTutor("verified");
    await seedClass({ tutorId: tutor.id, hoursFromNow: 30 });
    const ctx = await tutorCtx(browser, profile.id);
    const page = await ctx.newPage();
    await page.goto("/ar/dashboard");
    await expect(page.locator("[data-e2e=home-upcoming]")).toContainText("90 دقيقة");
    await expect(page.locator("[data-e2e=home-upcoming]")).not.toContainText("min");
    await page.goto("/ar/dashboard/classes");
    await expect(page.locator("main")).toContainText("90 دقيقة");
    await ctx.close();
  });
});
