import { test, expect } from "@playwright/test";
import { sql } from "./support/db";
import { seedAdmin, seedProfile } from "./support/seed";
import { loginAs, mintSession, SESSION_COOKIE } from "./support/session";

/* december-sprint · B (D13) — the centre lead form, end to end.

   A visitor lands on /fr/pour-les-centres?utm_source=whatsapp, fills the form and
   sends it: the success line shows, the lead is stored with its source, and the
   admin's CSV (through the web pass-through to the API) contains it. A non-admin
   gets the API's 403 from the same URL. ADDED as its own spec. */

const CENTRE = `E2E-B Centre ${Date.now().toString(36)}`;

test.beforeAll(async () => {
  /* Every request of the suite comes from loopback: one rate-limit bucket (5 / hour).
     This spec's own budget starts empty; the key is a keyed hash, so clear the kind. */
  await sql`delete from rate_limits where key like 'centre-lead:%'`;
});
test.afterAll(async () => {
  await sql`delete from centre_leads where centre_name = ${CENTRE}`;
  await sql`delete from rate_limits where key like 'centre-lead:%'`;
});

test("a centre asks for a demo from a WhatsApp link: stored with utm_source=whatsapp, in the admin CSV", async ({ page, browser }) => {
  await page.goto("/fr/pour-les-centres?utm_source=whatsapp&utm_campaign=decembre");
  await expect(page.locator("h1")).toHaveText("Votre stage de décembre, aussi en ligne. Prêt en 72 heures.");

  // The hero's main action is the anchor to the form.
  await page.locator("[data-e2e=centres-demo]").click();
  await expect(page).toHaveURL(/#demo$/);
  const form = page.locator("[data-e2e=centre-lead-form]");
  await expect(form).toBeVisible();
  await expect(page.locator("[data-e2e=centre-lead-consent]")).toHaveText(
    "En envoyant ce formulaire, vous acceptez d'être recontacté par Tnajem.",
  );

  // An invalid phone is marked on its field, described, and focused (form-a11y contract).
  await form.getByLabel("Votre nom").fill("Sonia Trabelsi");
  await form.getByLabel("Nom du centre").fill(CENTRE);
  await form.getByLabel("Ville").fill("Sfax");
  await form.getByLabel("Téléphone ou WhatsApp").fill("abc");
  await page.locator("[data-e2e=centre-lead-submit]").click();
  const phone = form.getByLabel("Téléphone ou WhatsApp");
  await expect(phone).toHaveAttribute("aria-invalid", "true");
  await expect(phone).toBeFocused();
  await expect(form.getByRole("alert")).toHaveText("Ce numéro n'est pas valide (8 à 20 chiffres).");

  await phone.fill("+216 98 123 456");
  await expect(phone).not.toHaveAttribute("aria-invalid", "true");
  await form.getByLabel("Nombre de profs").fill("12");
  await form.getByRole("checkbox", { name: "Bac" }).check();
  await form.getByRole("checkbox", { name: "Collège" }).check();
  await form.getByLabel("Message (facultatif)").fill("Stage de décembre pour le Bac.");
  // No control inside another: the level chips are labels around their own checkbox.
  await expect(form.locator("label input + input, button button, a button, button a")).toHaveCount(0);
  await page.locator("[data-e2e=centre-lead-submit]").click();

  await expect(page.locator("[data-e2e=centre-lead-success]")).toHaveText("Merci, on vous contacte sous 24 heures.");

  const rows = await sql<{ utm_source: string | null; utm_campaign: string | null; levels: string[]; locale: string; page: string; status: string; phone: string }[]>`
    select utm_source, utm_campaign, levels, locale, page, status, phone from centre_leads where centre_name = ${CENTRE}`;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    utm_source: "whatsapp",
    utm_campaign: "decembre",
    levels: ["college", "bac"],
    locale: "fr",
    page: "/fr/pour-les-centres",
    status: "new",
    phone: "+216 98 123 456",
  });

  // The admin's CSV, through the web pass-through: the API decides, the row is in it.
  const admin = await seedAdmin();
  const adminTok = await mintSession(admin.id);
  const csv = await page.request.get("/api/admin/centre-leads-csv", { headers: { cookie: `${SESSION_COOKIE}=${adminTok}` } });
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(csv.headers()["content-disposition"]).toMatch(/^attachment; filename="tnajem-centre-leads-/);
  const body = await csv.text();
  expect(body).toContain(`"${CENTRE}"`);
  expect(body).toContain('"whatsapp"');
  expect(body).toContain(`"'+216 98 123 456"`);

  // Anyone else: the API's 403, and not a byte of the list.
  const outsider = await seedProfile({ role: "student", birthYear: 1990 });
  const denied = await page.request.get("/api/admin/centre-leads-csv", {
    headers: { cookie: `${SESSION_COOKIE}=${await mintSession(outsider.id)}` },
  });
  expect(denied.status()).toBe(403);
  expect(await denied.text()).not.toContain(CENTRE);
  expect((await page.request.get("/api/admin/centre-leads-csv", { headers: { cookie: "" } })).status()).toBe(403);

  // The admin page lists it, newest first, and a status change sticks.
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  await loginAs(ctx, admin.id);
  const ap = await ctx.newPage();
  await ap.goto("/fr/admin/leads");
  await expect(ap.locator("[data-e2e=admin-nav] a[aria-current=page]")).toHaveText("Centres");
  const row = ap.locator("[data-e2e=lead-row]", { hasText: CENTRE });
  await expect(row).toBeVisible();
  await expect(row).toContainText("whatsapp / decembre");
  await row.locator("[data-status=contacted]").click();
  await expect(row.locator("[data-status=contacted]")).toHaveAttribute("aria-pressed", "true");
  const [after] = await sql<{ status: string }[]>`select status from centre_leads where centre_name = ${CENTRE}`;
  expect(after.status).toBe("contacted");
  await ctx.close();
});
