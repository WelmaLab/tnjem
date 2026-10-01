import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { sql } from "./support/db";
import { seedClass, seedProfile, seedTutor } from "./support/seed";
import { loginAs } from "./support/session";
import { BASE_URL } from "./support/env";
import { fillWallTime } from "./support/datetime";

/* ════════════════════════════════════════════════════════════════════════════
   espace prof v2 · phase 3 — SHARING A PROFILE (growth).

   The share sheet from every place a tutor shares (the home « Ma vitrine » card,
   Ma vitrine, Mes classes, right after publishing a class): the link carries
   utm_source={target} for every network, « Copier le lien », the QR code; a link
   opened with utm_source is counted once in « Vues · Clics » (and the owner's own
   visit is not); the social preview tags (og: and twitter:) in FR and AR on the
   profile and on a class page, and the card image they point to answers.
   ADDED as its own spec; the API side is apps/api/test/ep2-vitrine.test.ts and
   ep2-share-links.test.ts.
   ════════════════════════════════════════════════════════════════════════════ */

test.use({ contextOptions: { reducedMotion: "reduce" } });

const HOST = new URL(BASE_URL).hostname;

async function tutorCtx(browser: Browser, profileId: string): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
    permissions: ["clipboard-read", "clipboard-write"],
  });
  await loginAs(ctx, profileId);
  await ctx.addCookies([{ name: "tnajem_role", value: "tutor", domain: HOST, path: "/" }]);
  /* The sheet opens each network in a new tab; record the address instead of
     leaving the test machine for wa.me or facebook.com. */
  await ctx.addInitScript(() => {
    (window as unknown as { __opened: string[] }).__opened = [];
    window.open = ((url?: string | URL) => {
      (window as unknown as { __opened: string[] }).__opened.push(String(url ?? ""));
      return null;
    }) as typeof window.open;
  });
  return ctx;
}

async function verifiedTutor(fullName = "Walid Partage") {
  const profile = await seedProfile({ role: "tutor", birthYear: 1988, fullName });
  const tutor = await seedTutor({ profileId: profile.id, status: "verified", fullName });
  return { profile, tutor };
}

const opened = (page: Page) => page.evaluate(() => [...(window as unknown as { __opened: string[] }).__opened]);

/** Press the sheet's main button and return the address it opened. Facebook and
    LinkedIn write the clipboard FIRST, so the open is awaited, not assumed. */
async function go(page: Page): Promise<string> {
  const before = (await opened(page)).length;
  await page.locator("[data-e2e=share-sheet] [data-e2e=share-go]").click();
  await expect.poll(async () => (await opened(page)).length).toBe(before + 1);
  return (await opened(page))[before];
}

/** The link inside a network's share address (wa.me, sharer.php, x.com, t.me …). */
function linkInside(intent: string): string {
  const u = new URL(intent);
  for (const key of ["u", "url", "link"]) {
    const v = u.searchParams.get(key);
    if (v) return v;
  }
  const text = u.searchParams.get("text") ?? "";
  return /(https?:\/\/\S+)\s*$/.exec(text)?.[1] ?? "";
}

test.describe("the share sheet", () => {
  test("from the home « Ma vitrine » card: the page link, utm_source per network, copy and QR", async ({ browser }) => {
    const { profile, tutor } = await verifiedTutor();
    const ctx = await tutorCtx(browser, profile.id);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard", { waitUntil: "networkidle" });

    await page.locator("[data-e2e=share-open-profile]").first().click();
    const sheet = page.locator("[data-e2e=share-sheet]");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("heading", { name: "Partager ma page" })).toBeVisible();

    const pagePath = new RegExp(`^https?://[^/]+/${tutor.slug}\\?utm_source=`);
    const link = sheet.locator("[data-e2e=share-link]");
    await expect(link).toHaveValue(new RegExp(`^https?://[^/]+/${tutor.slug}\\?utm_source=copy$`));

    // « Copier le lien » puts exactly that link on the clipboard.
    await sheet.locator("[data-e2e=share-copy]").click();
    await expect(sheet.getByRole("status")).toHaveText("Lien copié");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await link.inputValue());

    // Every network gets its own utm_source.
    for (const target of ["whatsapp", "facebook", "x", "telegram", "linkedin"] as const) {
      await sheet.locator(`[data-e2e=share-target-${target}]`).click();
      await expect(sheet.locator(`[data-e2e=share-target-${target}]`)).toHaveAttribute("aria-checked", "true");
      const intent = await go(page);
      const shared = linkInside(intent);
      expect(shared, `${target}: ${intent}`).toMatch(pagePath);
      expect(new URL(shared).searchParams.get("utm_source"), target).toBe(target);
    }
    // Messenger on a computer: messenger.com opens and the link is on the clipboard.
    await sheet.locator("[data-e2e=share-target-messenger]").click();
    expect(await go(page)).toBe("https://www.messenger.com/");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(`/${tutor.slug}?utm_source=messenger`);

    // The message: pre-written, editable, in either language — and what is sent is what was typed.
    await sheet.locator("[data-e2e=share-target-whatsapp]").click();
    const msg = sheet.locator("[data-e2e=share-message]");
    await expect(msg).toHaveValue(/Tnajem/);
    await sheet.getByRole("button", { name: "ع" }).click();
    await expect(msg).toHaveAttribute("dir", "rtl");
    await expect(msg).toHaveValue(/Tnajem/);
    await expect(msg).not.toHaveValue(/Salut/);
    await sheet.getByRole("button", { name: "FR" }).click();
    await msg.fill("Mes séances de la semaine :");
    const wa = new URL(await go(page));
    expect(wa.origin + wa.pathname).toBe("https://wa.me/");
    expect(wa.searchParams.get("text")).toMatch(new RegExp(`^Mes séances de la semaine :\\n.+/${tutor.slug}\\?utm_source=whatsapp$`));

    // The QR code: drawn on demand, downloadable as a PNG.
    await sheet.locator("[data-e2e=share-qr-toggle]").click();
    await expect(sheet.locator("[data-e2e=share-qr] canvas")).toBeVisible();
    await expect(sheet.locator("[data-e2e=share-qr-download]")).toHaveAttribute("download", `tnajem-${tutor.slug}-qr.png`);
    await expect(sheet.locator("[data-e2e=share-qr-download]")).toHaveAttribute("href", /^data:image\/png;base64,/);

    // Escape closes it (a native modal dialog).
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await ctx.close();
  });

  test("Ma vitrine shares the page; Mes classes shares the class", async ({ browser }) => {
    const { profile, tutor } = await verifiedTutor();
    const klass = await seedClass({ tutorId: tutor.id, isFreeFirst: false, priceTnd: 30, hoursFromNow: 80 });
    const ctx = await tutorCtx(browser, profile.id);
    const page = await ctx.newPage();

    await page.goto("/fr/dashboard/storefront", { waitUntil: "networkidle" });
    await page.locator("[data-e2e=share-open-profile]").first().click();
    await expect(page.locator("[data-e2e=share-sheet] [data-e2e=share-link]")).toHaveValue(new RegExp(`/${tutor.slug}\\?utm_source=copy$`));
    await page.keyboard.press("Escape");

    await page.goto("/fr/dashboard/classes", { waitUntil: "networkidle" });
    await page.locator("[data-e2e=share-open-class]").first().click();
    const sheet = page.locator("[data-e2e=share-sheet]");
    await expect(sheet.getByRole("heading", { name: "Partager cette séance" })).toBeVisible();
    await expect(sheet.locator("[data-e2e=share-link]")).toHaveValue(new RegExp(`/class/${klass.id}\\?utm_source=copy$`));
    await expect(sheet.locator("[data-e2e=share-message]")).toHaveValue(new RegExp(klass.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    await sheet.locator("[data-e2e=share-target-telegram]").click();
    expect(linkInside(await go(page))).toMatch(new RegExp(`/class/${klass.id}\\?utm_source=telegram$`));
    await ctx.close();
  });

  test("right after publishing a class, the sheet opens on that class", async ({ browser }) => {
    const { profile, tutor } = await verifiedTutor();
    const ctx = await tutorCtx(browser, profile.id);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard/new-class", { waitUntil: "networkidle" });
    await page.locator("form input[type=text]").first().fill("Suites — exercices corrigés");
    const d = new Date(Date.now() + 6 * 86_400_000);
    await fillWallTime(page, `${d.toISOString().slice(0, 10)}T18:00`);
    await page.getByPlaceholder("15").fill("25");
    await page.locator('form button[type="submit"]').click();

    await expect.poll(async () => (await sql<{ n: number }[]>`select count(*)::int n from classes where tutor_id = ${tutor.id}`)[0].n, { timeout: 15_000 }).toBe(1);
    const [{ id }] = await sql<{ id: string }[]>`select id from classes where tutor_id = ${tutor.id}`;
    await expect(page.locator("[data-e2e=published-share]")).toContainText("Ta séance est publiée.");
    const sheet = page.locator("[data-e2e=share-sheet]");
    await expect(sheet).toBeVisible();
    await expect(sheet.locator("[data-e2e=share-link]")).toHaveValue(new RegExp(`/class/${id}\\?utm_source=copy$`));
    // Closed, it can be opened again from the line that stays.
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await page.locator("[data-e2e=published-share] [data-e2e=share-open-class]").click();
    await expect(page.locator("[data-e2e=share-sheet]").first()).toBeVisible();
    await ctx.close();
  });
});

test.describe("Vues · Clics", () => {
  test("a shared link opened by a visitor counts once, with its source; the owner's own visit does not", async ({ browser }) => {
    // The beacon's limiter is Postgres-backed and outlives runs.
    await sql`delete from rate_limits where key like 'vitrine:%'`;
    const { profile, tutor } = await verifiedTutor();

    const visitor = await browser.newContext({ reducedMotion: "reduce" });
    const vp = await visitor.newPage();
    await vp.goto(`/fr/${tutor.slug}?utm_source=whatsapp`, { waitUntil: "networkidle" });
    const counts = async (source: string) =>
      (await sql<{ views: number; clicks: number }[]>`
        select views, clicks from vitrine_stats_daily where tutor_id = ${tutor.id} and source = ${source}`)[0] ?? null;
    await expect.poll(() => counts("whatsapp"), { timeout: 15_000 }).toEqual({ views: 1, clicks: 1 });
    // Nothing about the visitor is stored: the row is (tutor, day, source, views, clicks).
    const cols = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns where table_name = 'vitrine_stats_daily' order by column_name`;
    expect(cols.map((c) => c.column_name)).toEqual(["clicks", "day", "source", "tutor_id", "views"]);

    // The same visitor reloading is the same visit.
    await vp.reload({ waitUntil: "networkidle" });
    await vp.waitForTimeout(1_000);
    expect(await counts("whatsapp")).toEqual({ views: 1, clicks: 1 });
    await visitor.close();

    // The owner looking at their own page is not an audience.
    const ctx = await tutorCtx(browser, profile.id);
    const page = await ctx.newPage();
    await page.goto(`/fr/${tutor.slug}?utm_source=facebook`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1_000);
    expect(await counts("facebook")).toBeNull();

    // Ma vitrine shows it: 1 view, 1 click, from WhatsApp.
    await page.goto("/fr/dashboard/storefront", { waitUntil: "networkidle" });
    const stats = page.locator("[data-e2e=vitrine-stats]");
    await expect(stats.locator("[data-e2e=vitrine-views]")).toHaveText("1");
    await expect(stats.locator("[data-e2e=vitrine-clicks]")).toHaveText("1");
    await expect(page.locator("[data-e2e=vitrine-source-whatsapp]")).toContainText("WhatsApp");
    await ctx.close();
  });
});

test.describe("social preview cards", () => {
  for (const locale of ["fr", "ar"] as const) {
    test(`/${locale}: og: and twitter: tags on the profile and a class page, and the card image answers`, async ({ page }) => {
      const { tutor } = await verifiedTutor("Mouna Ben Salah");
      const klass = await seedClass({ tutorId: tutor.id, isFreeFirst: false, priceTnd: 25, hoursFromNow: 96 });
      const meta = (p: Page) =>
        p.evaluate(() => {
          const out: Record<string, string> = {};
          for (const m of Array.from(document.head.querySelectorAll("meta[property], meta[name]"))) {
            const k = m.getAttribute("property") ?? m.getAttribute("name") ?? "";
            if (/^(og|twitter):/.test(k) && !(k in out)) out[k] = m.getAttribute("content") ?? "";
          }
          return out;
        });

      for (const [path, cardPath, mustSay] of [
        [`/${locale}/${tutor.slug}`, `/${locale}/${tutor.slug}/opengraph-image`, "Mouna B."],
        [`/${locale}/class/${klass.id}`, `/${locale}/class/${klass.id}/opengraph-image`, klass.title],
      ] as const) {
        await page.goto(path, { waitUntil: "networkidle" });
        const m = await meta(page);
        expect(m["og:title"], path).toContain(mustSay);
        expect(m["og:title"], `${path}: no last name in a link preview`).not.toContain("Ben Salah");
        expect(m["og:locale"], path).toBe(locale === "ar" ? "ar_TN" : "fr_TN");
        expect(new URL(m["og:url"]).pathname, path).toBe(path);
        expect(new URL(m["og:image"]).pathname, path).toBe(cardPath);
        expect(m["og:image:width"], path).toBe("1200");
        expect(m["og:image:height"], path).toBe("630");
        expect(m["og:image:alt"], path).toContain(locale === "ar" ? "على Tnajem" : "sur Tnajem");
        expect(m["twitter:card"], path).toBe("summary_large_image");
        expect(m["twitter:image"], path).toBe(m["og:image"]);
        expect(m["twitter:title"], path).toBe(m["og:title"]);
        expect(m["og:description"], path).toBeTruthy();
        if (locale === "ar") expect(m["og:description"], `${path}: an Arabic page previews in Arabic`).toMatch(/[؀-ۿ]/);

        const img = await page.request.get(cardPath);
        expect(img.status(), cardPath).toBe(200);
        expect(img.headers()["content-type"], cardPath).toContain("image/png");
        expect((await img.body()).length, cardPath).toBeGreaterThan(10_000);
      }
    });
  }
});
