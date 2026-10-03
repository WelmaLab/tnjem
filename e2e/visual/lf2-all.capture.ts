import { test, expect, chromium, type Browser, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "../support/db";
import { seedAdmin, seedClass, seedOffer, seedProfile, seedPromotion, seedTutor } from "../support/seed";
import { mintSession, sessionCookie } from "../support/session";
import { api, API } from "../support/journey";
import { BASE_URL } from "../support/env";

/* live-fixes-2 · F — screenshots of every page or state items A–F touched, FR + AR, at
   1440×900, 1440×674 and 390×844. NOT part of `npm run test` (*.capture.ts). Run with

     npm run ui:shots-lf2          (= playwright test -c e2e/visual/visual.config.ts lf2-all)

   against a running production build. Output: ui-live-fixes-2/ (gitignored), or
   UI_SHOTS_DIR. Files are <shot>-<fr|ar>-<viewport>.png (a file opened on its own has no
   language: <shot>-<viewport>.png), and index.md lists them.

   Kinds of shot:
     full     the whole page;
     view     what the screen shows — a list, sheet, dialog, menu or « ? » open, or a
              file opened on its own;
     element  one part of the page, at 2× (the sidebar, to judge A's alignment).
   The keyboard shots (kb-…) reach their control with the real Tab key and open it with
   Enter, so the focus ring on screen is the one a keyboard user sees.

   The data (scratch DB only — never `tnajem`):
     • « Walid Tester », VERIFIED: two classes, two fiches, a PDF, a picture and a YouTube
       video (real uploads through POST /materials), an offer with a request and a
       subscriber, two promotions, followers (real API calls: the bell has real
       notifications);
     • a student (/student/welcome), a student with no birth date (/onboarding/upgrade),
       the allowlisted admin (/admin/plans), and nobody (signup, the storefront, files).
   Readable slugs for the shots, renamed to e2e-… at the end so the suite's teardown
   removes every row. */

const OUT = resolve(process.env.UI_SHOTS_DIR ?? "ui-live-fixes-2");
const RUN = randomBytes(2).toString("hex");

type Loc = "fr" | "ar";
type Who = "anon" | "walid" | "student" | "nobirth" | "admin";
type Mode = "full" | "view" | "element";
type Shot = {
  name: string;
  path: string;
  who: Who;
  mode?: Mode;
  only?: "phone" | "desk";
  /** A file opened on its own: no locale in the URL, one shot per viewport. */
  bare?: boolean;
  /** The full Chromium (its PDF viewer); the default headless shell downloads PDFs. */
  fullBrowser?: boolean;
  element?: string;
  act?: (p: Page, loc: Loc) => Promise<void>;
  note: string;
};

const VIEWPORTS = [
  { tag: "1440x900", width: 1440, height: 900 },
  { tag: "1440x674", width: 1440, height: 674 },
  { tag: "390x844", width: 390, height: 844 },
] as const;
const LOCALES = ["fr", "ar"] as const;
const isPhone = (p: Page) => (p.viewportSize()?.width ?? 1440) < 900;

/** Tab (forward) until `selector` has focus — the way a keyboard user gets there. */
async function tabTo(p: Page, selector: string, max = 200) {
  const target = p.locator(selector).first();
  await target.waitFor();
  await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await p.keyboard.press("Tab");
  }
  throw new Error(`could not Tab to ${selector}`);
}

async function openSelect(p: Page, e2e: string) {
  const btn = p.locator(`[data-e2e=${e2e}]`).first();
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await p.locator(`[data-e2e=${e2e}-list]`).waitFor();
}

const WATCH = { fr: "Voir la vidéo", ar: "شوف الفيديو" } as const;

const SHOTS: Shot[] = [
  // ── A · the sidebar's group titles ──
  { name: "sidebar", path: "/dashboard", who: "walid", mode: "view", note: "A · the sidebar: group titles start where the icons start (phone: the « Profil » sheet, the same list)",
    act: async (p) => { if (isPhone(p)) { await p.locator("[data-e2e=tab-profile]").click(); await p.locator("dialog[open][data-e2e=shell-sheet]").waitFor(); } } },
  { name: "sidebar-zoom", path: "/dashboard", who: "walid", mode: "element", only: "desk", element: "[data-e2e=shell-sidebar] .aps-nav", note: "A · the sidebar's nav list alone, at 2×" },
  // ── B ──
  { name: "settings-notifications", path: "/dashboard/settings?tab=notifications", who: "walid", note: "B · Réglages › Notifications: the « Bientôt » switches drawn off" },
  // ── C · the shell's Select everywhere ──
  { name: "signup-eleve", path: "/signup/eleve", who: "anon", note: "C · student sign-up: birth month + year, closed" },
  { name: "signup-eleve-month", path: "/signup/eleve", who: "anon", mode: "view", note: "C · student sign-up: the month list open",
    act: (p) => openSelect(p, "birth-month") },
  { name: "signup-eleve-year", path: "/signup/eleve", who: "anon", mode: "view", note: "C · student sign-up: the year list open",
    act: (p) => openSelect(p, "birth-year") },
  { name: "signup-prof", path: "/signup/prof", who: "anon", note: "C · tutor sign-up: birth month + year, closed" },
  { name: "signup-prof-month", path: "/signup/prof", who: "anon", mode: "view", note: "C · tutor sign-up: the month list open",
    act: (p) => openSelect(p, "birth-month") },
  { name: "student-welcome", path: "/student/welcome", who: "student", note: "C · /student/welcome: the level, closed" },
  { name: "student-welcome-open", path: "/student/welcome", who: "student", mode: "view", note: "C · /student/welcome: the level list open",
    act: (p) => openSelect(p, "welcome-level") },
  { name: "upgrade", path: "/onboarding/upgrade", who: "nobirth", note: "C · /onboarding/upgrade (no birth date on file): year + month, closed" },
  { name: "upgrade-open", path: "/onboarding/upgrade", who: "nobirth", mode: "view", note: "C · /onboarding/upgrade: the year list open",
    act: (p) => openSelect(p, "upgrade-birth-year") },
  { name: "admin-plans", path: "/admin/plans", who: "admin", mode: "view", note: "C · /admin/plans: the plan choice, closed (first screen; the list is every tutor)" },
  { name: "admin-plans-open", path: "/admin/plans", who: "admin", mode: "view", note: "C · /admin/plans: a plan list open",
    act: (p) => openSelect(p, "plan-choice") },
  // ── D · the material route and the storefront embed ──
  { name: "material-pdf", path: "/api/material/__PDF__", who: "anon", mode: "view", bare: true, fullBrowser: true, note: "D · a fiche PDF opened on its own: the browser's PDF viewer, under the API's policy",
    act: async (p) => {
      await expect.poll(async () => {
        const viewer = p.frames().find((f) => f.url().startsWith("chrome-extension://"));
        if (!viewer) return "no viewer";
        return viewer.evaluate(() => {
          const q = (sel: string, root: Document | ShadowRoot | null | undefined) => root?.querySelector(sel) as (Element & { shadowRoot: ShadowRoot | null; docLength?: number }) | null;
          return q("viewer-toolbar", q("pdf-viewer", document)?.shadowRoot)?.docLength ?? "loading";
        }).catch((e: Error) => e.message);
      }, { timeout: 15_000 }).toBe(1);
      await p.waitForTimeout(800);
    } },
  { name: "material-image", path: "/api/material/__PNG__", who: "anon", mode: "view", bare: true, fullBrowser: true, note: "D · a picture opened on its own: the browser's image viewer, centred",
    act: async (p) => { await p.waitForFunction(() => document.querySelector("img")?.complete === true); } },
  { name: "storefront-youtube", path: "/__SLUG__", who: "anon", mode: "view", note: "D · the storefront's YouTube video opened: the no-cookie embed loads (it was refused before)",
    act: async (p, loc) => {
      const btn = p.getByRole("button", { name: WATCH[loc] }).first();
      await btn.scrollIntoViewIfNeeded();
      await btn.click();
      const frame = p.locator('iframe[src*="youtube-nocookie.com/embed/"]');
      await frame.waitFor();
      await frame.scrollIntoViewIfNeeded();
      await frame.contentFrame().locator("body").waitFor({ timeout: 15_000 }).catch(() => {});
      await p.waitForTimeout(2500);
    } },
  // ── E · the « ? » ──
  { name: "promotions-tip", path: "/dashboard/promotions", who: "walid", mode: "view", note: "E · Promotions: the « ? » opened by a click (pinned)",
    act: async (p) => { await p.locator("[data-e2e=promo-info]").scrollIntoViewIfNeeded(); await p.locator("[data-e2e=promo-info]").click(); await p.locator("[data-e2e=promo-info-text]").waitFor(); } },
  { name: "subscriptions-tip", path: "/dashboard/subscriptions", who: "walid", mode: "view", note: "E · Abonnements: the « ? » opened by a click (pinned)",
    act: async (p) => { await p.locator("[data-e2e=subs-info]").scrollIntoViewIfNeeded(); await p.locator("[data-e2e=subs-info]").click(); await p.locator("[data-e2e=subs-info-text]").waitFor(); } },
  // ── F · the keyboard pass: every overlay reached and opened with the keyboard ──
  { name: "kb-skip", path: "/dashboard", who: "walid", mode: "view", note: "F · the first Tab: the skip link, visible",
    act: async (p) => { await p.keyboard.press("Tab"); await p.locator(".skip-link:focus").waitFor(); } },
  { name: "kb-share", path: "/dashboard/storefront", who: "walid", mode: "view", note: "F · Ma vitrine: the share sheet opened with Enter, focus inside it",
    act: async (p) => { await tabTo(p, "[data-e2e=share-open-profile]"); await p.keyboard.press("Enter"); await p.locator("dialog[open][data-e2e=share-sheet]").waitFor(); await p.keyboard.press("Tab"); } },
  { name: "kb-calendar", path: "/dashboard/new-class", who: "walid", mode: "view", note: "F · Nouvelle classe: the calendar opened with Enter, today's day focused (Tab stays in it)",
    act: async (p) => { await tabTo(p, "[data-e2e=date-open]"); await p.keyboard.press("Enter"); await p.locator("[data-e2e=date-calendar]").waitFor(); await p.waitForTimeout(200); } },
  { name: "kb-cancel", path: "/dashboard/classes", who: "walid", mode: "view", note: "F · Mes classes: « Annuler » — the ConfirmDialog, focus on « Garder »",
    act: async (p) => { await tabTo(p, "[data-e2e=class-cancel]"); await p.keyboard.press("Enter"); await p.locator("dialog[open][data-e2e=confirm-dialog]").waitFor(); } },
  { name: "kb-move", path: "/dashboard/classes", who: "walid", mode: "view", note: "F · Mes classes: « Modifier » — the calendar inside the dialog (Esc closes the calendar only)",
    act: async (p) => {
      await tabTo(p, "[data-e2e=class-edit]"); await p.keyboard.press("Enter");
      await p.locator("dialog[open][data-e2e=confirm-dialog]").waitFor();
      await tabTo(p, "dialog[open] [data-e2e=date-open]"); await p.keyboard.press("Enter");
      await p.locator("dialog[open] [data-e2e=date-calendar]").waitFor(); await p.waitForTimeout(200);
    } },
  { name: "kb-edit", path: "/dashboard/materials", who: "walid", mode: "view", note: "F · Mes fiches: the edit dialog opened with Enter, focus in the title",
    act: async (p) => { await tabTo(p, "[data-e2e=fiche-edit]"); await p.keyboard.press("Enter"); await p.locator("dialog[open][data-e2e=fiche-edit-dialog]").waitFor(); await p.waitForTimeout(200); } },
  { name: "kb-remove", path: "/dashboard/materials", who: "walid", mode: "view", note: "F · Mes fiches: « Retirer » — the ConfirmDialog, focus on « Garder »",
    act: async (p) => { await tabTo(p, "[data-e2e=pack-remove]"); await p.keyboard.press("Enter"); await p.locator("dialog[open][data-e2e=confirm-dialog]").waitFor(); } },
  { name: "kb-plus", path: "/dashboard", who: "walid", mode: "view", only: "phone", note: "F · the « + » opened with Enter: the next Tab is in its menu",
    act: async (p) => { await tabTo(p, "[data-e2e=shell-fab]"); await p.keyboard.press("Enter"); await p.locator("[data-e2e=shell-fab-menu]").waitFor(); await p.keyboard.press("Tab"); } },
  { name: "kb-bell", path: "/dashboard", who: "walid", mode: "view", note: "F · the bell opened with Enter: the next Tab is on a notification",
    act: async (p) => { await tabTo(p, "[data-e2e=shell-bell]"); await p.keyboard.press("Enter"); await p.locator("#aps-bell-panel a[href]").first().waitFor(); await p.keyboard.press("Tab"); } },
  { name: "kb-avatar", path: "/dashboard", who: "walid", mode: "view", only: "desk", note: "F · the avatar menu opened with Enter: the next Tab is in the menu",
    act: async (p) => { await tabTo(p, "[data-e2e=shell-me]"); await p.keyboard.press("Enter"); await p.locator("[data-e2e=shell-me-menu]").waitFor(); await p.keyboard.press("Tab"); } },
  { name: "kb-tip", path: "/dashboard/promotions", who: "walid", mode: "view", note: "F · Promotions: the « ? » reached with Tab and opened with Enter (Esc or Tab closes it)",
    act: async (p) => { await tabTo(p, "[data-e2e=promo-info]"); await p.keyboard.press("Enter"); await p.locator("[data-e2e=promo-info-text]").waitFor(); } },
  { name: "kb-sheet", path: "/dashboard", who: "walid", mode: "view", only: "phone", note: "F · the « Profil » sheet opened with Enter, focus inside it",
    act: async (p) => { await tabTo(p, "[data-e2e=tab-profile]"); await p.keyboard.press("Enter"); await p.locator("dialog[open][data-e2e=shell-sheet]").waitFor(); await p.keyboard.press("Tab"); } },
];

async function settle(page: Page): Promise<void> {
  // /admin/plans lists every tutor and never goes idle: the wait is capped.
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => {});
  await page.waitForTimeout(250);
}

/** A real upload through POST /materials (magic bytes, the object store), as a tutor does. */
async function upload(token: string, title: string, src: { file: Buffer; name: string; type: string } | { youtube: string }) {
  const form = new FormData();
  form.set("title", title);
  form.set("visibility", "public");
  if ("youtube" in src) form.set("youtubeUrl", src.youtube);
  else form.set("file", new Blob([new Uint8Array(src.file)], { type: src.type }), src.name);
  const res = await fetch(`${API}/materials`, { method: "POST", headers: { cookie: `tnajem_session=${token}` }, body: form });
  const body = (await res.json()) as { ok: boolean; id?: string; error?: string };
  expect(body.ok, body.error).toBe(true);
  return body.id!;
}

test("capture every page live-fixes-2 touched, FR + AR, 1440×900 · 1440×674 · 390×844", async ({ browser }) => {
  test.setTimeout(60 * 60_000);
  await mkdir(OUT, { recursive: true });
  const full: Browser = await chromium.launch({ channel: "chromium" });
  const tokens = new Map<string, string>();
  const tokenOf = async (id: string) => {
    if (!tokens.has(id)) tokens.set(id, await mintSession(id));
    return tokens.get(id)!;
  };
  let walidTutor = "";

  try {
    const wp = await seedProfile({ role: "tutor", fullName: "walid tester", birthYear: 1988, phone: "+21656561226" });
    const wt = await seedTutor({ profileId: wp.id, status: "verified", fullName: "walid tester" });
    walidTutor = wt.id;
    const slug = `walid-tester-${RUN}`;
    await sql`update tutors set slug = ${slug}, subject = 'math', levels = '{secondaire,bac}',
                bio = ${"Prof de maths au lycée. Je prépare le bac en petits groupes : la méthode, les exercices types et beaucoup de pratique."}
              where id = ${wt.id}`;

    const at = (days: number, hour: number) => {
      const d = new Date(Date.now() + days * 86_400_000);
      d.setUTCHours(hour - 1, 0, 0, 0); // Tunis = UTC+1
      return d;
    };
    for (const [days, hour, title, price] of [[2, 18, "Intégrales — révision express", 40], [6, 10, "Suites numériques : exercices corrigés", 25]] as const) {
      const k = await seedClass({ tutorId: wt.id, isFreeFirst: false, priceTnd: price, at: at(days, hour), seats: 8 });
      await sql`update classes set title = ${title}, description = ${"Méthode et exercices types du bac."} where id = ${k.id}`;
    }
    for (const [title, meta, price] of [["Fiches de révision : Analyse", "36 pages · méthodes et exercices corrigés", "12"], ["Annales corrigées : Probabilités", "20 sujets corrigés", "15"]] as const) {
      await sql`insert into packs (id, tutor_id, title, description, price_tnd) values (${randomUUID()}, ${wt.id}, ${title}, ${meta}, ${price})`;
    }

    // A real PDF, a real picture and a YouTube video, uploaded the way a tutor does.
    const maker = await browser.newPage({ viewport: { width: 600, height: 400 } });
    await maker.setContent(`<div style="font:16px/1.5 sans-serif;padding:24px">
      <h1 style="font-size:26px;margin:0 0 12px">Fiche de révision — Intégrales</h1>
      <p>1. Primitives usuelles. 2. Intégration par parties. 3. Changement de variable.</p>
      <p>Exercice : calculer ∫₀¹ x·eˣ dx.</p></div>
      <div id="img" style="width:300px;height:200px;background:linear-gradient(135deg,#1f5f99,#e3a33b)"></div>`);
    const pdf = await maker.pdf({ format: "A5" });
    const png = await maker.locator("#img").screenshot();
    await maker.close();
    const wtoken = await tokenOf(wp.id);
    const pdfId = await upload(wtoken, "Fiche PDF — Intégrales", { file: pdf, name: "integrales.pdf", type: "application/pdf" });
    const pngId = await upload(wtoken, "Schéma — aire sous la courbe", { file: png, name: "schema.png", type: "image/png" });
    await upload(wtoken, "Corrigé vidéo — séance 1", { youtube: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });

    // Students: followers (real API calls → the bell), a request and a subscriber.
    const student = await seedProfile({ role: "student", fullName: "yosra trabelsi", birthYear: 1999 });
    const rania = await seedProfile({ role: "student", fullName: "rania gharbi", birthYear: 1996 });
    const nobirth = await seedProfile({ role: "student", fullName: "Nour Sans Date", birthYear: null, birthMonth: null });
    for (const s of [student, rania]) expect((await api("/follows", await tokenOf(s.id), { slug })).ok).toBe(true);
    const offer = await seedOffer({ tutorId: wt.id, title: "Suivi Bac — 4 séances", sessionsPerMonth: 4, priceTnd: 120 });
    await sql`insert into student_subscriptions (offer_id, tutor_id, student_profile_id, status, sessions_per_month, price_tnd)
              values (${offer.id}, ${wt.id}, ${rania.id}, 'requested', 4, 102)`;
    await seedPromotion({ tutorId: wt.id, percent: 15, endsInDays: 9 });
    await seedPromotion({ tutorId: wt.id, percent: 20, code: "RENTREE", endsInDays: 20, maxUses: 30 });
    const admin = await seedAdmin();

    const ids: Record<Exclude<Who, "anon">, string> = { walid: wp.id, student: student.id, nobirth: nobirth.id, admin: admin.id };
    const fill = (path: string) => path.replace("__SLUG__", slug).replace("__PDF__", pdfId).replace("__PNG__", pngId);
    const host = new URL(BASE_URL).hostname;

    const written = new Set<string>();
    const failed: string[] = [];
    for (const loc of LOCALES) {
      for (const vp of VIEWPORTS) {
        const phone = vp.width < 900;
        for (const s of SHOTS) {
          if ((s.only === "phone" && !phone) || (s.only === "desk" && phone)) continue;
          if (s.bare && loc !== "fr") continue; // one file, no language
          await sql`update notifications set read_at = null where profile_id = ${wp.id}`;
          const b = s.fullBrowser ? full : browser;
          // baseURL spelled out: the full Chromium is launched here, outside the config's `use`.
          const ctx = await b.newContext({ baseURL: BASE_URL, viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: s.mode === "element" ? 2 : 1, reducedMotion: "reduce" });
          if (s.who !== "anon") {
            await ctx.addCookies([sessionCookie(await tokenOf(ids[s.who]))]);
            if (s.who === "walid") await ctx.addCookies([{ name: "tnajem_role", value: "tutor", domain: host, path: "/" }]);
          }
          // The share sheet's networks and the phone's native sheet stay on this machine.
          await ctx.addInitScript(() => {
            window.open = (() => null) as typeof window.open;
            Object.defineProperty(navigator, "share", { value: async () => undefined, configurable: true });
          });
          const page = await ctx.newPage();
          const file = s.bare ? `${s.name}-${vp.tag}.png` : `${s.name}-${loc}-${vp.tag}.png`;
          try {
            await page.goto(s.bare ? fill(s.path) : `/${loc}${fill(s.path)}`);
            await settle(page);
            if (s.act) await s.act(page, loc);
            const mode = s.mode ?? "full";
            if (mode === "full") await page.evaluate(() => window.scrollTo(0, 0));
            // The pointer off the page's controls: a click's hover must not look like a state.
            await page.mouse.move(0, vp.height - 1);
            await settle(page);
            if (mode === "element") await page.locator(s.element!).first().screenshot({ path: join(OUT, file), animations: "disabled" });
            else await page.screenshot({ path: join(OUT, file), fullPage: mode === "full", animations: "disabled", caret: "hide" });
            written.add(file);
          } catch (e) {
            failed.push(`${file}: ${(e as Error).message.split("\n")[0]}`);
          } finally {
            await ctx.close();
          }
        }
      }
    }

    const cell = (s: Shot, loc: Loc, v: string) => {
      const phone = v === "390x844";
      if ((s.only === "phone" && !phone) || (s.only === "desk" && phone)) return "—";
      const f = s.bare ? `${s.name}-${v}.png` : `${s.name}-${loc}-${v}.png`;
      if (s.bare && loc === "ar") return written.has(f) ? `same file ([png](${f}))` : "**missing**";
      return written.has(f) ? `[png](${f})` : "**missing**";
    };
    const cols = LOCALES.flatMap((l) => VIEWPORTS.map((v) => `${l.toUpperCase()} ${v.tag}`));
    const lines = [
      "# Live fixes 2 — screenshots (F)",
      "",
      `Captured by \`e2e/visual/lf2-all.capture.ts\` (\`npm run ui:shots-lf2\`) against a production build on a scratch database, ${new Date().toISOString().slice(0, 10)}.`,
      "Files: `<shot>-<fr|ar>-<1440x900|1440x674|390x844>.png`; a file opened on its own has no language: `<shot>-<viewport>.png`. **full** = the whole page; **view** = what the screen shows (a list, sheet, dialog, menu or « ? » open, a file opened alone); **element** = one part of the page at 2×. The `kb-…` shots reach their control with the real Tab key and open it with Enter: the ring is the one a keyboard user sees. Test data only (`.invalid` addresses).",
      "",
      `| shot | kind | what it shows | ${cols.join(" | ")} |`,
      `|---|---|---|${cols.map(() => "---").join("|")}|`,
      ...SHOTS.map((s) => `| \`${s.name}\` | ${s.mode ?? "full"} | ${s.note} | ${LOCALES.flatMap((l) => VIEWPORTS.map((v) => cell(s, l, v.tag))).join(" | ")} |`),
      "",
      `${written.size} files.${failed.length ? ` ${failed.length} failed:` : ""}`,
      ...failed.map((f) => `- ${f}`),
      "",
    ];
    await writeFile(join(OUT, "index.md"), lines.join("\n"), "utf8");
    expect(failed, failed.join("\n")).toEqual([]);
  } finally {
    await full.close();
    // The readable slug back to e2e-… so the suite's teardown removes these rows.
    if (walidTutor) await sql`update tutors set slug = ${`e2e-lf2all-${randomBytes(5).toString("hex")}`} where id = ${walidTutor}`;
  }
});
