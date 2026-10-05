import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { seedClass, seedProfile, seedTutor } from "./support/seed";
import { contextAs } from "./support/journey";
import { sql } from "./support/db";

/* live-fixes-1 · B — « Mes fiches » is in the shell.

   One list (a pack and its file are ONE row), edit in a dialog, remove after a
   confirmation, share; « Nouvelle fiche » goes to /dashboard/new-pack and ties the
   uploaded file to the pack; the library form (a file or a YouTube video for the
   students, no price) keeps the YouTube option and its privacy note. No browser
   « Choose File » and no native <select> left visible on a prof page. */

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function verifiedTutor() {
  const me = await seedProfile({ role: "tutor", birthYear: 1985 });
  const tutor = await seedTutor({ profileId: me.id, status: "verified" });
  return { me, tutor };
}

async function seedFile(tutorId: string, title: string, classId: string | null = null): Promise<string> {
  const id = randomUUID();
  await sql`insert into materials (id, tutor_id, class_id, kind, visibility, title, storage_path, file_name, mime, size_bytes)
            values (${id}, ${tutorId}, ${classId}, 'file', 'students', ${title}, ${`materials/${tutorId}/lf1.pdf`}, 'revision.pdf', 'application/pdf', 2048)`;
  return id;
}

async function seedPackRow(tutorId: string, title: string, materialId: string | null, price = 18): Promise<string> {
  const id = randomUUID();
  await sql`insert into packs (id, tutor_id, title, description, price_tnd, material_id)
            values (${id}, ${tutorId}, ${title}, '42 pages', ${String(price)}, ${materialId})`;
  return id;
}

test.describe("B · the list of fiches", () => {
  test("a pack and its file are one row: price, file, class, status; edit and remove", async ({ browser }) => {
    const { me, tutor } = await verifiedTutor();
    const klass = await seedClass({ tutorId: tutor.id, hoursFromNow: 96 });
    const fileId = await seedFile(tutor.id, "Pack Dérivées", klass.id);
    const packId = await seedPackRow(tutor.id, "Pack Dérivées", fileId, 18);
    const ctx = await contextAs(browser, me.id);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard/materials", { waitUntil: "networkidle" });

    const rows = page.locator("[data-e2e=fiche-row]");
    await expect(rows).toHaveCount(1);
    const row = rows.first();
    await expect(row).toHaveAttribute("data-kind", "pack");
    await expect(row.locator("[data-e2e=fiche-price]")).toHaveText(/18 TND/);
    await expect(row.locator("[data-e2e=fiche-source]")).toContainText("revision.pdf");
    await expect(row.locator("[data-e2e=fiche-source] a")).toHaveAttribute("href", `/api/material/${fileId}`);
    await expect(row.locator("[data-e2e=fiche-class]")).toContainText("Séance :");
    await expect(row.locator("[data-e2e=fiche-status]")).toHaveText("Sur ta page");
    // « Nouvelle fiche » is the page's ochre action and goes to the new-pack form.
    await expect(page.locator("[data-e2e=fiche-new]")).toHaveAttribute("href", "/fr/dashboard/new-pack");
    await expect(page.locator("main .btn-primary:visible")).toHaveCount(1);

    // Edit: a dialog, the title and the price.
    await row.getByRole("button", { name: "Modifier « Pack Dérivées »" }).click();
    const dialog = page.locator("[data-e2e=fiche-edit-dialog][open]");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("[data-e2e=fiche-edit-title]")).toBeFocused();
    await dialog.locator("[data-e2e=fiche-edit-title]").fill("Pack Dérivées & Limites");
    await dialog.locator("[data-e2e=fiche-edit-price]").fill("6000");
    await dialog.locator("[data-e2e=fiche-edit-save]").click();
    await expect(dialog.locator("[data-e2e=fiche-edit-error]")).toContainText("entre 0 et 5000");
    await dialog.locator("[data-e2e=fiche-edit-price]").fill("22");
    await dialog.locator("[data-e2e=fiche-edit-save]").click();
    await expect(page.locator(".toast")).toHaveText("Fiche enregistrée.");
    await expect(row.locator(".fx-title")).toHaveText("Pack Dérivées & Limites");
    await expect(row.locator("[data-e2e=fiche-price]")).toHaveText(/22 TND/);
    const [p] = await sql<{ title: string; price_tnd: string }[]>`select title, price_tnd from packs where id = ${packId}`;
    expect([p.title, Number(p.price_tnd)]).toEqual(["Pack Dérivées & Limites", 22]);
    const [m] = await sql<{ title: string }[]>`select title from materials where id = ${fileId}`;
    expect(m.title).toBe("Pack Dérivées & Limites");

    // Remove: asks first; « Garder » keeps; « Retirer » removes the fiche AND its file.
    await row.locator("[data-e2e=pack-remove]").click();
    const confirm = page.locator("[data-e2e=confirm-dialog][open]");
    await expect(confirm).toContainText("Retirer « Pack Dérivées & Limites » ?");
    await expect(confirm).toContainText("son fichier n'est plus accessible");
    await confirm.getByRole("button", { name: "Garder" }).click();
    expect((await sql`select 1 from packs where id = ${packId}`).length).toBe(1);
    await row.locator("[data-e2e=pack-remove]").click();
    await page.locator("[data-e2e=confirm-dialog][open]").getByRole("button", { name: "Retirer", exact: true }).click();
    await expect(page.locator(".toast")).toHaveText("Fiche retirée de ta page.");
    await expect(page.locator("[data-e2e=shell-empty]")).toBeVisible();
    expect((await sql`select 1 from packs where id = ${packId}`).length).toBe(0);
    const [gone] = await sql<{ removed_at: Date | null }[]>`select removed_at from materials where id = ${fileId}`;
    expect(gone.removed_at).not.toBeNull();
    await ctx.close();
  });

  test("empty: one ochre action, « Créer ma 1ʳᵉ fiche » → new-pack (FR + AR)", async ({ browser }) => {
    const { me } = await verifiedTutor();
    const ctx = await contextAs(browser, me.id);
    const page = await ctx.newPage();
    for (const [loc, label] of [["fr", "Créer ma 1ʳᵉ fiche"], ["ar", "اعمل أوّل ملف"]] as const) {
      await page.goto(`/${loc}/dashboard/materials`, { waitUntil: "networkidle" });
      const empty = page.locator("[data-e2e=shell-empty]");
      await expect(empty).toBeVisible();
      await expect(empty.getByRole("link", { name: label })).toHaveAttribute("href", `/${loc}/dashboard/new-pack`);
      await expect(page.locator("main .btn-primary:visible")).toHaveCount(1);
    }
    await ctx.close();
  });

  test("no page yet: « Créer ma page », not an error", async ({ browser }) => {
    const me = await seedProfile({ role: "tutor", birthYear: 1985 });
    const ctx = await contextAs(browser, me.id);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard/materials", { waitUntil: "networkidle" });
    await expect(page.locator("[data-e2e=shell-error]")).toHaveCount(0);
    const empty = page.locator("[data-e2e=shell-empty]");
    await expect(empty.getByRole("link", { name: "Créer ma page" })).toHaveAttribute("href", "/fr/onboarding");
    await expect(page.locator("main .btn-primary:visible")).toHaveCount(1);
    await ctx.close();
  });

  test("share opens the sheet on the fiche, with its title in the message", async ({ browser }) => {
    const { me, tutor } = await verifiedTutor();
    await seedPackRow(tutor.id, "Fiche Bac Maths", null, 0);
    const ctx = await contextAs(browser, me.id);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard/materials", { waitUntil: "networkidle" });
    const row = page.locator("[data-e2e=fiche-row]").first();
    await expect(row.locator("[data-e2e=fiche-price]")).toHaveText(/Gratuit/);
    await row.getByRole("button", { name: "Partager « Fiche Bac Maths »" }).click();
    const sheet = page.locator("[data-e2e=share-sheet][open]");
    await expect(sheet).toContainText("Partager cette fiche");
    await expect(sheet.locator("[data-e2e=share-message]")).toHaveValue(/Ma fiche « Fiche Bac Maths »/);
    await expect(sheet.locator("[data-e2e=share-link]")).toHaveValue(new RegExp(`/${tutor.slug}\\?utm_source=copy$`));
    await ctx.close();
  });
});

test.describe("B · « Nouvelle fiche » ties the file to the fiche", () => {
  test("upload + publish → ONE row in Mes fiches, with its price and its file", async ({ browser }) => {
    const { me, tutor } = await verifiedTutor();
    const ctx = await contextAs(browser, me.id);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard/new-pack", { waitUntil: "networkidle" });
    const title = `Fiche LF1 ${Date.now().toString(36)}`;
    await page.locator("main form input[type=text]").first().fill(title);
    await page.locator("[data-e2e=pack-file-input]").setInputFiles({ name: "fiche.png", mimeType: "image/png", buffer: PNG });
    await expect(page.locator("[data-e2e=pack-file]")).toContainText("fiche.png");
    await page.locator("main form input[type=number]").fill("12");
    await page.getByRole("button", { name: "Publier" }).click();
    await expect(page.locator("[data-e2e=pack-published]")).toBeVisible();

    const [link] = await sql<{ material_id: string | null; mtitle: string | null }[]>`
      select p.material_id, m.title as mtitle from packs p left join materials m on m.id = p.material_id
       where p.tutor_id = ${tutor.id} and p.title = ${title}`;
    expect(link.material_id).not.toBeNull();
    expect(link.mtitle).toBe(title);

    await page.goto("/fr/dashboard/materials", { waitUntil: "networkidle" });
    const rows = page.locator("[data-e2e=fiche-row]");
    await expect(rows).toHaveCount(1);
    await expect(rows.first().locator("[data-e2e=fiche-source]")).toContainText("fiche.png");
    await expect(rows.first().locator("[data-e2e=fiche-price]")).toHaveText(/12 TND/);
    await ctx.close();
  });
});

test.describe("B · the library form (a file or a video for the students, no price)", () => {
  test("upload through the drop zone; YouTube keeps its privacy note; the class picker is keyboard-operable", async ({ browser }) => {
    const { me, tutor } = await verifiedTutor();
    const klass = await seedClass({ tutorId: tutor.id, hoursFromNow: 72 });
    const ctx = await contextAs(browser, me.id);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard/materials", { waitUntil: "networkidle" });
    await page.locator("[data-e2e=library-toggle]").click();

    // The drop zone speaks French; the browser's input is there but never shown.
    await expect(page.locator("[data-e2e=material-drop]")).toContainText("Choisis un fichier ou glisse-le ici");
    await expect(page.locator("[data-e2e=material-drop]")).toContainText("PDF ou image (PNG, JPEG, WEBP) · 8 Mo max");
    await page.locator("#m-title").fill("Corrigé série 3");
    await page.locator("[data-e2e=material-file-input]").setInputFiles({ name: "corrige.png", mimeType: "image/png", buffer: PNG });
    await expect(page.locator("[data-e2e=material-file]")).toContainText("corrige.png");

    // The class, by keyboard: focus, ↓ opens on the current choice, ↓ moves, Enter picks.
    const picker = page.locator("[data-e2e=material-class]");
    await picker.focus();
    await page.keyboard.press("ArrowDown");
    await expect(picker).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("[data-e2e=material-class-list]")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(picker).toHaveAttribute("aria-expanded", "false");
    await expect(picker).toBeFocused();
    await expect(picker).toHaveAttribute("data-value", klass.id);
    await expect(page.locator("[data-e2e=material-visibility] [data-value=students]")).toHaveText("Élèves de cette séance");

    await page.getByRole("button", { name: "Ajouter", exact: true }).click();
    await expect(page.locator(".toast")).toHaveText("Ajouté. C'est visible selon le réglage choisi.");
    await expect.poll(async () => (await sql<{ class_id: string | null; kind: string }[]>`
      select class_id, kind::text as kind from materials where tutor_id = ${tutor.id} and title = 'Corrigé série 3'`)[0] ?? null,
    { timeout: 15_000 }).toEqual({ class_id: klass.id, kind: "file" });
    const row = page.locator("[data-e2e=fiche-row][data-kind=material]");
    await expect(row).toHaveCount(1);
    await expect(row.locator("[data-e2e=fiche-status]")).toHaveText("Élèves de cette séance");

    // YouTube: the option and its privacy note are still there.
    await page.locator("[data-e2e=library-toggle]").click();
    await page.locator("[data-e2e=material-source] [data-value=youtube]").click();
    await expect(page.locator("#m-yt")).toHaveAttribute("dir", "ltr");
    await expect(page.locator("[data-e2e=library-form]")).toContainText("On n'enregistre que l'identifiant de la vidéo, et on l'affiche sans cookie de suivi.");
    await ctx.close();
  });

  test("Arabic: the drop zone and the source choice speak Arabic", async ({ browser }) => {
    const { me } = await verifiedTutor();
    const ctx = await contextAs(browser, me.id);
    const page = await ctx.newPage();
    await page.goto("/ar/dashboard/materials", { waitUntil: "networkidle" });
    await page.locator("[data-e2e=library-toggle]").click();
    await expect(page.locator("[data-e2e=material-drop]")).toContainText("اختار ملف ولا جرّو لهوني");
    await expect(page.locator("[data-e2e=material-source]")).toContainText("فيديو يوتيوب");
    await ctx.close();
  });
});

/* ── No browser control left on a prof page ─────────────────────────────────── */

async function nativeControlsShown(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const shown = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      // .sr-only: a 1px clipped box — present for the keyboard and screen readers, never seen.
      return r.width > 2 && r.height > 2 && cs.clipPath === "none" && cs.clip === "auto";
    };
    document.querySelectorAll("main input[type=file]").forEach((el) => { if (shown(el)) out.push(`file: ${el.outerHTML.slice(0, 80)}`); });
    document.querySelectorAll("main select").forEach((el) => { if (shown(el)) out.push(`select: ${el.outerHTML.slice(0, 80)}`); });
    return out;
  });
}

const PROF_PAGES: { path: string; open?: (p: Page) => Promise<void> }[] = [
  { path: "/dashboard" },
  { path: "/dashboard/materials", open: (p) => p.locator("[data-e2e=library-toggle]").click() },
  { path: "/dashboard/new-pack" },
  { path: "/dashboard/new-class" },
  { path: "/dashboard/classes" },
  { path: "/dashboard/students" },
  { path: "/dashboard/storefront" },
  { path: "/dashboard/subscriptions", open: (p) => p.locator("[data-e2e=offer-new]").click() },
  { path: "/dashboard/promotions", open: (p) => p.locator("[data-e2e=promo-scope-class]").click() },
  { path: "/dashboard/plan" },
  { path: "/dashboard/settings?tab=compte" },
  { path: "/dashboard/settings?tab=vitrine" },
  { path: "/dashboard/settings?tab=notifications" },
  { path: "/onboarding/verify" },
];

test.describe("B · no « Choose File » and no native select on a prof page", () => {
  for (const loc of ["fr", "ar"] as const) {
    test(`every prof page, ${loc}, phone and desktop`, async ({ browser }) => {
      test.setTimeout(180_000);
      const { me, tutor } = await verifiedTutor();
      await seedClass({ tutorId: tutor.id, hoursFromNow: 72 });
      const draft = await seedProfile({ role: "tutor", birthYear: 1985 });
      await seedTutor({ profileId: draft.id, status: "draft" });
      for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
        for (const who of [me.id, draft.id]) {
          const ctx = await contextAs(browser, who);
          const page = await ctx.newPage();
          await page.setViewportSize(vp);
          for (const { path, open } of PROF_PAGES) {
            if (who === draft.id && path !== "/onboarding/verify") continue; // the draft tutor is for the verification uploads
            await page.goto(`/${loc}${path}`, { waitUntil: "networkidle" });
            if (open) await open(page).catch(() => {});
            expect(await nativeControlsShown(page), `${loc}${path} @${vp.width}`).toEqual([]);
          }
          await ctx.close();
        }
      }
    });
  }
});

test.describe("B · Promotions: the target is the shell's Select", () => {
  test("choose a class for a promotion with the listbox", async ({ browser }) => {
    const { me, tutor } = await verifiedTutor();
    const klass = await seedClass({ tutorId: tutor.id, hoursFromNow: 72 });
    const ctx = await contextAs(browser, me.id);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard/promotions", { waitUntil: "networkidle" });
    await page.locator("[data-e2e=promo-scope-class]").click();
    const target = page.locator("[data-e2e=promo-target]");
    await expect(target).toHaveAttribute("aria-haspopup", "listbox");
    await target.click();
    const option = page.locator(`[data-e2e=promo-target-list] [data-value="${klass.id}"]`);
    await expect(option).toHaveAttribute("role", "option");
    await option.click();
    await expect(target).toHaveAttribute("data-value", klass.id);
    await expect(page.locator(`[data-e2e=promo-target-list]`)).toHaveCount(0);
    await ctx.close();
  });
});
