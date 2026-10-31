import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { seedProfile } from "./support/seed";
import { loginAs } from "./support/session";
import { BASE_URL } from "./support/env";
import { socialHref } from "../apps/web/lib/social";

/* ════════════════════════════════════════════════════════════════════════════
   home v2 · D — THE PUBLIC CHROME (UI_options/home-v2-reference.png, top and bottom).

   Header: logo · Trouver un prof · Pour les profs · FR/ع pill · « Se connecter » ·
   a FILLED cobalt « Créer ma page » (→ /signup/prof, the tutor sign-up door).
   Footer: brand + tagline · ÉLÈVES & PARENTS · PROFS · LÉGAL, then the bottom bar
   « © 2026 Tnajem · Tunisie » + social icons + the contact address.

   Honesty rule 5: a social icon only for an account whose URL is configured
   (NEXT_PUBLIC_SOCIAL_*, apps/web/lib/social.ts). The suite's web build pins all
   three to "" (playwright.config.ts), so NO icon, no empty list and no href="#"
   may render. Signed-in states (« Mon espace » / « Tableau de bord » / « Espace
   parent ») are unchanged — ssv1-a-shell.spec.ts covers them on an ISR storefront;
   here they are re-checked on the chrome itself, FR + AR.
   ════════════════════════════════════════════════════════════════════════════ */

const HOST = new URL(BASE_URL).hostname;
const DESKTOP = { width: 1440, height: 900 };
const BLUE = "rgb(14, 90, 166)"; // --blue
const WHITE = "rgb(255, 255, 255)";
const TRANSPARENT = "rgba(0, 0, 0, 0)";

type Role = "student" | "tutor" | "guardian";

async function ctxAs(browser: Browser, role: Role | null, viewport = DESKTOP): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport, reducedMotion: "reduce" });
  if (role) {
    const p = await seedProfile({ role, birthYear: 1990 });
    await loginAs(ctx, p.id);
    // The readable role hint the public chrome reads (lib/auth.ts sets it with the session).
    await ctx.addCookies([{ name: "tnajem_role", value: role, domain: HOST, path: "/" }]);
  }
  return ctx;
}

const L = {
  fr: {
    find: "Trouver un prof", forTutors: "Pour les profs", signIn: "Se connecter", create: "Créer ma page",
    space: "Mon espace", dashboard: "Tableau de bord", guardian: "Espace parent",
    cols: ["Élèves & parents", "Profs", "Légal"],
    tagline: "Le lien entre les élèves tunisiens et leurs profs.",
    rights: "© 2026 Tnajem · Tunisie",
    menu: "Menu",
  },
  ar: {
    find: "لقّي أستاذ", forTutors: "للأساتذة", signIn: "دخول", create: "اعمل صفحتك",
    space: "فضائي", dashboard: "لوحتي", guardian: "فضاء الولي",
    cols: ["تلامذة وأولياء", "أساتذة", "قانوني"],
    tagline: "الرابط بين التلامذة التوانسة وأساتذتهم.",
    rights: "© 2026 تنجّم · تونس",
    menu: "القائمة",
  },
} as const;

const colours = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, color: s.color };
  });

/** No social link of any kind, and no dead `#` link, anywhere in the chrome. */
async function expectNoSocial(page: Page) {
  await expect(page.locator("[data-e2e=footer-social]")).toHaveCount(0);
  await expect(page.locator(".site-footer .qf-social")).toHaveCount(0);
  await expect(
    page.locator('.site-footer a[href*="instagram.com"], .site-footer a[href*="facebook.com"], .site-footer a[href*="fb.com"], .site-footer a[href*="linkedin.com"]'),
  ).toHaveCount(0);
  await expect(page.locator('.site-header a[href="#"], .site-footer a[href="#"]')).toHaveCount(0);
}

test.describe("lib/social.ts — only a real https profile URL on the network's own domain", () => {
  test("accepts profile URLs, rejects everything else", () => {
    expect(socialHref("instagram", "https://www.instagram.com/tnajem.tn")).toBe("https://www.instagram.com/tnajem.tn");
    expect(socialHref("instagram", "  https://instagram.com/tnajem/  ")).toBe("https://instagram.com/tnajem/");
    expect(socialHref("facebook", "https://www.facebook.com/tnajem")).toBe("https://www.facebook.com/tnajem");
    expect(socialHref("linkedin", "https://www.linkedin.com/company/tnajem")).toBe("https://www.linkedin.com/company/tnajem");
    for (const bad of [undefined, null, "", "   ", "#", "/tnajem", "tnajem", "instagram.com/tnajem",
      "http://www.instagram.com/tnajem", "javascript:alert(1)", "https://www.instagram.com/", "https://www.instagram.com",
      "https://evil.example/instagram.com/tnajem", "https://instagram.com.evil.example/tnajem",
      "https://user:pw@www.instagram.com/tnajem", "https://www.facebook.com/tnajem"]) {
      expect(socialHref("instagram", bad), String(bad)).toBeNull();
    }
    expect(socialHref("linkedin", "https://www.instagram.com/tnajem")).toBeNull();
  });
});

for (const locale of ["fr", "ar"] as const) {
  const c = L[locale];

  test.describe(`${locale} · the public chrome`, () => {
    test("signed out at 1440: the mockup's header, the 4-column footer, the bottom bar, no social icon", async ({ browser }) => {
      const ctx = await ctxAs(browser, null);
      const page = await ctx.newPage();
      await page.goto(`/${locale}`);
      const header = page.locator(".site-header");

      // Header: brand · two audience links · FR/ع pill · « Se connecter » · filled « Créer ma page ».
      await expect(header.locator(`a[href="/${locale}"]`).first()).toBeVisible();
      const nav = header.locator("nav.qh-nav");
      await expect(nav.getByRole("link", { name: c.find })).toHaveAttribute("href", `/${locale}/explore`);
      await expect(nav.getByRole("link", { name: c.forTutors })).toHaveAttribute("href", `/${locale}/pour-les-profs`);
      const langs = header.locator(".qlt button");
      await expect(langs).toHaveCount(2);
      await expect(header.locator(`.qlt button[lang=${locale}]`)).toHaveAttribute("aria-pressed", "true");
      await expect(header.locator(`.qlt button[lang=${locale === "fr" ? "ar" : "fr"}]`)).toHaveAttribute("aria-pressed", "false");
      await expect(page.locator("[data-e2e=header-signin]")).toHaveText(c.signIn);
      await expect(page.locator("[data-e2e=header-signin]")).toHaveAttribute("href", `/${locale}/auth`);
      const create = page.locator("[data-e2e=header-create]");
      await expect(create).toHaveText(c.create);
      await expect(create).toHaveAttribute("href", `/${locale}/signup/prof`);
      await expect(create).toHaveClass(/qh-cta/);
      expect(await colours(page, "[data-e2e=header-create]")).toEqual({ bg: BLUE, color: WHITE });
      await expect(page.locator("[data-e2e=header-space]")).toHaveCount(0);

      // Footer: brand + tagline, then the three link columns, in the mockup's order.
      const footer = page.locator(".site-footer");
      await expect(footer.locator(".qf-brand")).toContainText(c.tagline);
      expect(await footer.locator(".qf-col h2").allTextContents()).toEqual([...c.cols]);
      const hrefs = await footer.locator(".qf-col a").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
      expect(hrefs).toEqual([
        `/${locale}/explore`, `/${locale}/student`, `/${locale}/auth`,
        `/${locale}/pour-les-profs`, `/${locale}/tarifs`, `/${locale}/signup/prof`, `/${locale}/dashboard`,
        `/${locale}/terms`, `/${locale}/privacy`, "mailto:contact@tnajem.com",
      ]);
      await expect(page.locator("[data-e2e=footer-signin]")).toHaveText(c.signIn);
      await expect(page.locator("[data-e2e=footer-dashboard]")).toBeVisible();

      // Bottom bar: the year, the contact address, and NO social icon (none configured).
      await expect(page.locator("[data-e2e=footer-rights]")).toHaveText(c.rights);
      await expect(page.locator("[data-e2e=footer-email]")).toHaveAttribute("href", "mailto:contact@tnajem.com");
      await expect(page.locator("[data-e2e=footer-email]")).toHaveText("contact@tnajem.com");
      await expectNoSocial(page);

      // The server HTML too: the icons are decided at build time, not after hydration.
      const html = await (await ctx.request.get(`/${locale}`)).text();
      expect(html).not.toContain("footer-social");
      expect(html).toContain('data-e2e="footer-email"');
      await ctx.close();
    });

    test("signed in at 1440: « Mon espace » / « Tableau de bord » / « Espace parent », unchanged", async ({ browser }) => {
      const expected: Record<Role, { href: string; label: string }> = {
        student: { href: `/${locale}/student`, label: c.space },
        tutor: { href: `/${locale}/dashboard`, label: c.dashboard },
        guardian: { href: `/${locale}/guardian`, label: c.guardian },
      };
      for (const role of ["student", "tutor", "guardian"] as const) {
        const ctx = await ctxAs(browser, role);
        const page = await ctx.newPage();
        await page.goto(`/${locale}/tarifs`);
        const space = page.locator("[data-e2e=header-space]");
        await expect(space, role).toHaveText(expected[role].label);
        await expect(space, role).toHaveAttribute("href", expected[role].href);
        // Signed in, it stays the cobalt OUTLINE — a way in, not the filled sign-up CTA.
        expect(await colours(page, "[data-e2e=header-space]"), role).toEqual({ bg: TRANSPARENT, color: BLUE });
        await expect(page.locator("[data-e2e=header-signin]"), role).toHaveCount(0);
        await expect(page.locator("[data-e2e=header-create]"), role).toHaveCount(0);
        await expect(page.locator("[data-e2e=footer-signin]"), role).toHaveCount(0);
        if (role === "tutor") {
          await expect(page.locator("[data-e2e=footer-dashboard]")).toHaveAttribute("href", `/${locale}/dashboard`);
          await expect(page.locator("[data-e2e=footer-space]")).toHaveCount(0);
          await expect(page.locator(`.site-footer a[href="/${locale}/signup/prof"]`)).toHaveCount(0);
        } else {
          await expect(page.locator("[data-e2e=footer-space]"), role).toHaveText(expected[role].label);
          await expect(page.locator("[data-e2e=footer-space]"), role).toHaveAttribute("href", expected[role].href);
          await expect(page.locator("[data-e2e=footer-dashboard]"), role).toHaveCount(0);
        }
        await expect(page.locator("[data-e2e=footer-rights]")).toHaveText(c.rights);
        await expectNoSocial(page);
        await ctx.close();
      }
    });

    test("no horizontal overflow from 360 to 1440; phone targets ≥ 44px; the menu carries every door", async ({ browser }) => {
      for (const width of [360, 390, 768, 1024, 1280, 1440]) {
        const ctx = await ctxAs(browser, null, { width, height: 800 });
        const page = await ctx.newPage();
        await page.goto(`/${locale}/tarifs`);
        await expect(page.locator(".site-header")).toBeVisible();
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(over, `${locale} @${width}: page wider than the viewport`).toBeLessThanOrEqual(0);
        // The header row itself never spills either.
        const row = await page.locator(".site-header .container").evaluate((el) => el.scrollWidth - el.clientWidth);
        expect(row, `${locale} @${width}: header row overflows`).toBeLessThanOrEqual(0);
        await ctx.close();
      }

      const ctx = await ctxAs(browser, null, { width: 360, height: 780 });
      const page = await ctx.newPage();
      await page.goto(`/${locale}/tarifs`);
      const small = await page.locator(".site-header a:visible, .site-header button:visible, .site-footer a:visible").evaluateAll((els) =>
        els
          .map((e) => ({ t: (e.textContent ?? "").trim() || e.getAttribute("aria-label") || "", h: e.getBoundingClientRect().height }))
          .filter((r) => r.h < 44),
      );
      expect(small, "chrome tap targets under 44px at 360").toEqual([]);

      await page.getByRole("button", { name: c.menu }).click();
      const menu = page.locator("#qh-menu");
      await expect(menu.getByRole("link", { name: c.find })).toHaveAttribute("href", `/${locale}/explore`);
      await expect(menu.getByRole("link", { name: c.forTutors })).toHaveAttribute("href", `/${locale}/pour-les-profs`);
      await expect(menu.getByRole("link", { name: c.signIn })).toHaveAttribute("href", `/${locale}/auth`);
      const cta = menu.locator(".qh-menu-cta");
      await expect(cta).toHaveText(c.create);
      await expect(cta).toHaveAttribute("href", `/${locale}/signup/prof`);
      expect(await colours(page, "#qh-menu .qh-menu-cta")).toEqual({ bg: BLUE, color: WHITE });
      const heights = await menu.locator("a").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
      await expectNoSocial(page);
      await ctx.close();
    });
  });
}
