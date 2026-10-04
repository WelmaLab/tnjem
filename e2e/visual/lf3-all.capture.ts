import { test, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { sql } from "../support/db";
import { seedBooking, seedClass, seedProfile, seedTutor } from "../support/seed";
import { mintSession, sessionCookie } from "../support/session";
import { BASE_URL } from "../support/env";
import { tunisWallTimeFromNow } from "@tnajem/shared";

/* live-fixes-3 · I — screenshots of every page or state items A–H touched, FR + AR, at
   1440×900 and 390×844. NOT part of `npm run test` (*.capture.ts). Run with

     npm run ui:shots-lf3          (= playwright test -c e2e/visual/visual.config.ts lf3-all)

   against a running production build. Output: ui-live-fixes-3/ (gitignored), or
   UI_SHOTS_DIR. Files are <shot>-<fr|ar>-<viewport>.png, and index.md lists them.

   Kinds of shot:
     full   the whole page;
     view   what the screen shows — a dialog, a toast, a confirm box, the success state,
            the sticky bars of a phone.

   The data (scratch DB only — never `tnajem`), shaped on the live class of 4 Oct:
     • « walid tester », VERIFIED, three 10–25 TND classes: one starting in 25 min (the
       live window: ochre « Démarrer », full — its one seat is booked), one 25–47 h
       away (before the window, inside 48 h: the late-cancel note) and one 6 days away;
       a whiteboard and a quiz on each, so the lobby shows the tiles that stay (B4);
     • « mehdi jaziri », a student booked on the 25-min and the 6-day class;
     • « amine » (books on the checkout, G) and « rania » (cancels inside the grace, C),
       each on a fresh class of a second prof, « sonia ben salah », created for the shot;
     • « karim », a DRAFT prof (D2), and nobody (the public pages).
   A shot that changes data (a booking, the own-class race, a follow) prepares its own
   rows and puts things back after, so the next shot sees the same world. Nothing leaves
   this machine: window.open and navigator.share are stubbed, other hosts are aborted.
   Readable slug for the shots, renamed to e2e-… at the end so teardown removes it. */

const OUT = resolve(process.env.UI_SHOTS_DIR ?? "ui-live-fixes-3");
const RUN = randomBytes(2).toString("hex");
const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

type Loc = "fr" | "ar";
type Who = "anon" | "walid" | "mehdi" | "amine" | "rania" | "karim";
type Mode = "full" | "view";
type Vars = Record<string, string>;
type Shot = {
  name: string;
  path: string;
  who: Who;
  mode?: Mode;
  only?: "phone" | "desk";
  /** Rows this shot needs, made fresh before it opens; returns placeholders for the path. */
  prep?: () => Promise<Vars>;
  act?: (p: Page, loc: Loc, v: Vars) => Promise<void>;
  /** Put the world back (runs even when the shot fails). */
  after?: (v: Vars) => Promise<void>;
  note: string;
};

const VIEWPORTS = [
  { tag: "1440x900", width: 1440, height: 900 },
  { tag: "390x844", width: 390, height: 844 },
] as const;
const LOCALES = ["fr", "ar"] as const;

const L = {
  fr: { confirm: "Confirmer ma place", cancel: /Annuler ma place/, sure: "Annuler cette réservation ?", yes: /Oui, annuler/, flash: /Réservation annulée/ },
  ar: { confirm: "أكّد مكاني", cancel: /ألغي مكاني/, sure: "تحب تلغي هذا الحجز ؟", yes: /إيه، ألغي/, flash: /الحجز تلغى/ },
} as const;

/* The world's ids, filled in by the test before the shots run. */
const W = { walidTutor: "", walidProfile: "", soniaTutor: "", mehdi: "", amine: "", rania: "", slug: "", soon: "", later: "", far: "" };

/** A daytime Tunis slot 25–47 h ahead: past a day (the lobby's « Démarre le … » tag), inside 48 h (the note). */
function slotWithin48h(): Date {
  const now = Date.now();
  for (const days of [1, 2]) {
    for (const hour of [10, 14, 18]) {
      const at = tunisWallTimeFromNow(days, hour, 0);
      const left = at.getTime() - now;
      if (left > 25 * 3600_000 && left < 47 * 3600_000) return at;
    }
  }
  return new Date(Math.ceil((now + 30 * 3600_000) / 3600_000) * 3600_000);
}

/** A fresh, paid class of the second prof. */
async function soniaClass(at: Date, price = 10): Promise<string> {
  const k = await seedClass({ tutorId: W.soniaTutor, isFreeFirst: false, priceTnd: price, at, seats: 8 });
  await sql`update classes set title = ${"Dérivées — exercices types"}, description = ${"Méthode et exercices types du bac."} where id = ${k.id}`;
  return k.id;
}

/** Scroll the sentence containing `text` to the middle of the screen. */
async function centreOn(p: Page, text: string): Promise<void> {
  const el = p.getByText(text, { exact: false }).first();
  await el.waitFor();
  await el.evaluate((node) => node.scrollIntoView({ block: "center" }));
}

/** Scroll the first element matching `selector` to the middle of the screen. */
async function centreOnSelector(p: Page, selector: string): Promise<void> {
  const el = p.locator(selector).first();
  await el.waitFor();
  await el.evaluate((node) => node.scrollIntoView({ block: "center" }));
}

/** Rania's seat on a fresh class inside 48 h, booked NOW: inside the 15-min grace. */
async function graceSeat(): Promise<Vars> {
  const classId = await soniaClass(slotWithin48h());
  const b = await seedBooking({ classId, studentId: W.rania, isFree: false });
  await sql`update classes set seats_taken = 1 where id = ${classId}`;
  return { __NEW__: classId, __BOOKING__: b.id };
}

const SHOTS: Shot[] = [
  // ── A · the prof's way into their own class ──
  { name: "classes", path: "/dashboard/classes", who: "walid", note: "A1 · Mes classes: « Démarrer la séance » — ochre with the live dot (starts in 25 min), outline before the window (30 h, 6 days); « Nouvelle classe » steps back to outline" },
  { name: "classes-edit", path: "/dashboard/classes?edit=__LATER__", who: "walid", mode: "view", note: "A3 · « Modifier » from the owner panel: Mes classes with this class's date dialog open",
    act: async (p) => { await p.locator("dialog[open]").waitFor(); } },
  { name: "home", path: "/dashboard", who: "walid", note: "A2 · Accueil › Prochaines séances: the title → /live/<id>, « Démarrer la séance » on each row (ochre in the window)" },
  { name: "class-owner", path: "/class/__LATER__", who: "walid", note: "A3 · the owner on their own class page (25–47 h away): « C'est ta séance », Démarrer (outline) / Modifier / Partager — no « Réserver »" },
  { name: "class-owner-live", path: "/class/__SOON__", who: "walid", note: "A3 · the owner's class page inside the live window: « Démarrer la séance » ochre with the dot" },
  { name: "checkout-own", path: "/checkout?class=__NEW__", who: "walid", mode: "view", note: "A5 · the checkout's `own-class` refusal (the class became the prof's own before « Confirmer »): « C'est ta propre séance. » + the link to the room",
    prep: async () => ({ __NEW__: await soniaClass(tunisWallTimeFromNow(3, 18, 0), 20) }),
    act: async (p, loc, v) => {
      const confirm = p.getByRole("button", { name: L[loc].confirm });
      await confirm.waitFor();
      await sql`update classes set tutor_id = ${W.walidTutor} where id = ${v.__NEW__}`;
      await confirm.click();
      const alert = p.locator(".ck-alert[role=alert]");
      await alert.waitFor();
      await alert.evaluate((el) => el.scrollIntoView({ block: "center" }));
    },
    after: async (v) => { await sql`update classes set tutor_id = ${W.soniaTutor}, status = 'cancelled' where id = ${v.__NEW__}`; } },
  // ── B · the live lobby ──
  { name: "live-tutor", path: "/live/__LATER__", who: "walid", note: "B · the prof's lobby, 25–47 h ahead: « Démarre le <jour> <mois> · HH:MM » (B5), the moderator line above the one « Entrer dans la classe » (B3), whiteboard + quiz tiles and no video tile (B4), « avec Walid T. » (E)" },
  { name: "live-tutor-soon", path: "/live/__SOON__", who: "walid", note: "B · the prof's lobby 25 min before: the countdown, the moderator line, one « Entrer »" },
  { name: "live-student", path: "/live/__FAR__", who: "mehdi", note: "B · the student's lobby, 6 days ahead: « Démarre le … », NO moderator line, one « Entrer », « avec Walid T. »" },
  { name: "live-student-soon", path: "/live/__SOON__", who: "mehdi", note: "B · the student's lobby 25 min before: the countdown, no moderator line" },
  // ── C · cancellation: the grace and the 48 h note ──
  { name: "checkout-note", path: "/checkout?class=__LATER__", who: "mehdi", note: "C · the checkout of a class < 48 h away: « Cette séance est dans moins de 48 h : après 15 min… » before « Confirmer ma place »; the rule line; « Avec Walid T. » (E); « 0 TND » in the brand face (F)" },
  { name: "storefront", path: "/__SLUG__", who: "anon", note: "C · the storefront: the < 48 h note above « Réserver » (desk: the aside; phone: the sticky bar, + « Rien n'est prélevé pendant le pilote. »); prices in the brand face (F)" },
  { name: "storefront-view", path: "/__SLUG__", who: "anon", mode: "view", note: "C · the storefront's first screen: the note where the visitor decides (aside / sticky bar)" },
  { name: "student-cancel-grace", path: "/student", who: "rania", mode: "view", note: "C · /student, booked a moment ago, class 29 h away: the confirm says « Annulation gratuite jusqu'à HH:MM … Rien n'est retenu pour ton prof. »",
    prep: graceSeat,
    act: async (p, loc) => {
      await p.getByRole("button", { name: L[loc].cancel }).first().click();
      const box = p.getByText(L[loc].sure).locator("..");
      await box.waitFor();
      await box.evaluate((el) => el.scrollIntoView({ block: "center" }));
    },
    after: async (v) => { await sql`update bookings set status = 'cancelled' where id = ${v.__BOOKING__}`; } },
  { name: "student-cancelled-grace", path: "/student", who: "rania", mode: "view", note: "C · /student after « Oui, annuler » inside the grace: « C'était dans les 15 min après ta réservation : c'est gratuit, rien n'est retenu. »",
    prep: graceSeat,
    act: async (p, loc) => {
      await p.getByRole("button", { name: L[loc].cancel }).first().click();
      await p.getByRole("button", { name: L[loc].yes }).click();
      const flash = p.getByText(L[loc].flash);
      await flash.waitFor({ timeout: 15_000 });
      await flash.evaluate((el) => el.scrollIntoView({ block: "center" }));
    } },
  // The legal pages are long: each shot is the screen around the sentence C changed.
  { name: "terms-s5", path: "/terms", who: "anon", mode: "view", note: "C · /terms §5 (the free first session): kept when cancelled within 15 min of booking — wording for the founder's legal review",
    act: (p, loc) => centreOn(p, loc === "fr" ? "ou dans les 15 minutes qui suivent ta réservation" : "ولا في الـ15 دقيقة اللي بعد الحجز") },
  { name: "terms-s7", path: "/terms", who: "anon", mode: "view", note: "C · /terms §7 (cancellation): free within 15 min of booking, unless the class starts within 15 min; « Exactement 15 minutes … compte encore comme gratuit »",
    act: (p, loc) => centreOn(p, loc === "fr" ? "Tu peux aussi annuler gratuitement dans les 15 minutes" : "تنجّم زادة تلغي بلا مصاريف") },
  { name: "aide", path: "/aide", who: "anon", mode: "view", note: "C · /aide: the same rule in the help answer about money",
    act: (p, loc) => centreOn(p, loc === "fr" ? "Une annulation dans les 15 min qui suivent la réservation" : "الإلغاء في الـ15 دقيقة اللي بعد الحجز") },
  // ── D · toasts above bars; the draft button ──
  { name: "new-class-draft", path: "/dashboard/new-class", who: "karim", mode: "view", note: "D · Nouvelle classe, unverified prof: the blocker on top, « Enregistrer le brouillon » in the action bar, the toast ABOVE the bar",
    act: async (p) => {
      await p.locator("main form.nc-form input[type=text]").first().fill("Révision Bac — dérivées");
      await p.locator("[data-e2e=save-draft]").click();
      await p.locator("[data-e2e=toast]").waitFor();
    } },
  { name: "new-pack-draft", path: "/dashboard/new-pack", who: "karim", mode: "view", note: "D · Nouvelle fiche, unverified prof: the same button, the toast above the bar",
    act: async (p) => {
      await p.locator("main form.nc-form input[type=text]").first().fill("Pack révision dérivées");
      await p.getByPlaceholder("8").fill("12");
      await p.locator("[data-e2e=save-draft]").click();
      await p.locator("[data-e2e=toast]").waitFor();
    } },
  { name: "settings-toast", path: "/dashboard/settings?tab=notifications", who: "walid", mode: "view", only: "phone", note: "D · the prof space on a phone: a toast above the tab bar",
    act: async (p) => { await p.locator("[data-e2e=pref-bookings] [role=switch]").click(); await p.locator("[data-e2e=toast]").waitFor(); } },
  { name: "storefront-follow", path: "/__SLUG__", who: "mehdi", mode: "view", only: "phone", note: "D · « Suivre » on a phone: the toast above the storefront's sticky « Réserver » bar",
    act: async (p) => { await p.locator("[data-e2e=follow-button]").first().click(); await p.locator("[data-e2e=toast]").waitFor(); },
    after: async () => { await sql`delete from tutor_follows where student_profile_id = ${W.mehdi} and tutor_id = ${W.walidTutor}`; } },
  // ── E · names ──
  { name: "class-student", path: "/class/__LATER__", who: "mehdi", note: "E · the public class page as a student: « Walid T. » (Avec, the tutor card, Suivre); the price in the brand face (F); the booking CTA" },
  { name: "class-og", path: "/class/__LATER__", who: "anon", mode: "view", only: "desk", note: "E · the class's share image (opengraph-image): « Walid T. »",
    act: async (p) => {
      const og = await p.locator('meta[property="og:image"]').first().getAttribute("content");
      expect(og, "the class page names its share image").toBeTruthy();
      const u = new URL(og!, BASE_URL);
      await p.goto(`${u.pathname}${u.search}`);
      await p.waitForFunction(() => document.querySelector("img")?.complete === true);
    } },
  // ── F · prices in the brand face ──
  { name: "tarifs", path: "/tarifs", who: "anon", note: "F · /tarifs: the example rows and the commission rates in the brand face, tabular figures" },
  { name: "pour-les-profs", path: "/pour-les-profs", who: "anon", note: "F · /pour-les-profs: the « later » amounts, split labels and chip in the brand face" },
  // The two price pages are long: the screens around F's figures, readable on a phone too.
  { name: "tarifs-prices", path: "/tarifs", who: "anon", mode: "view", note: "F · /tarifs, the example month (1 000 / − 100 / − 59 / 841 TND) in the brand face, tabular figures",
    act: (p) => centreOnSelector(p, ".tf-ex-row") },
  { name: "tarifs-rates", path: "/tarifs", who: "anon", mode: "view", note: "F · /tarifs, the commission rates of the other platforms (10 %, 18–33 %, 25 % + 9 %)",
    act: (p) => centreOnSelector(p, ".tf-cmp-rate") },
  { name: "pour-les-profs-prices", path: "/pour-les-profs", who: "anon", mode: "view", note: "F · /pour-les-profs, « Combien tu peux gagner »: 1 280 TND today, 1 123 TND later, the split labels",
    act: (p) => centreOnSelector(p, "[data-e2e=lpp-later-net]") },
  // ── G · after « Confirmer ma place » ──
  { name: "checkout-success", path: "/checkout?class=__NEW__", who: "amine", mode: "view", note: "G · after « Confirmer ma place » pressed from far down the page: back at the top, focus (ring) on « C'est réservé ! »",
    prep: async () => ({ __NEW__: await soniaClass(tunisWallTimeFromNow(3, 18, 0), 20) }),
    act: async (p, loc) => {
      const confirm = p.getByRole("button", { name: L[loc].confirm });
      await confirm.waitFor();
      await confirm.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await confirm.click();
      const title = p.locator("[data-e2e=checkout-success-title]");
      await title.waitFor({ timeout: 20_000 });
      await expect(title).toBeFocused();
      await expect.poll(() => p.evaluate(() => window.scrollY)).toBe(0);
    } },
  // ── H · one link, nothing nested ──
  { name: "student", path: "/student", who: "mehdi", note: "H · /student: « Rejoindre le direct » is one link styled as a button (the class in 25 min, then the 6-day one)" },
  { name: "admin-verifications-refused", path: "/admin/verifications", who: "walid", mode: "view", note: "H · /admin/verifications as a prof: « Accès réservé », its « Se connecter » one link" },
  { name: "admin-plans-refused", path: "/admin/plans", who: "walid", mode: "view", note: "H · /admin/plans as a prof: the same panel" },
  { name: "admin-accounts-refused", path: "/admin/accounts", who: "walid", mode: "view", note: "H · /admin/accounts as a prof: the same panel" },
  { name: "admin-moderation-refused", path: "/admin/moderation", who: "walid", mode: "view", note: "H · /admin/moderation as a prof: the same panel" },
];

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => {});
  await page.waitForTimeout(250);
}

test("capture every page live-fixes-3 touched, FR + AR, 1440×900 · 390×844", async ({ browser }) => {
  test.setTimeout(60 * 60_000);
  await mkdir(OUT, { recursive: true });
  const tokens = new Map<string, string>();
  const tokenOf = async (id: string) => {
    if (!tokens.has(id)) tokens.set(id, await mintSession(id));
    return tokens.get(id)!;
  };

  try {
    const wp = await seedProfile({ role: "tutor", fullName: "walid tester", birthYear: 1988, phone: "+21656561226" });
    const wt = await seedTutor({ profileId: wp.id, status: "verified", fullName: "walid tester" });
    W.walidProfile = wp.id;
    W.walidTutor = wt.id;
    W.slug = `walid-tester-${RUN}`;
    await sql`update tutors set slug = ${W.slug}, subject = 'math', levels = '{secondaire,bac}',
                bio = ${"Prof de maths au lycée. Je prépare le bac en petits groupes : la méthode, les exercices types et beaucoup de pratique."}
              where id = ${wt.id}`;
    const later = slotWithin48h();
    for (const [key, at, title, price, seats] of [
      ["soon", new Date(Math.ceil((Date.now() + 25 * 60_000) / 60_000) * 60_000), "Intégrales — révision express", 10, 1],
      ["later", later, "Suites numériques : exercices corrigés", 10, 8],
      ["far", tunisWallTimeFromNow(6, 18, 0), "Probabilités — annales du bac", 25, 8],
    ] as const) {
      const k = await seedClass({ tutorId: wt.id, isFreeFirst: false, priceTnd: price, at, seats });
      await sql`update classes set title = ${title}, description = ${"Méthode et exercices types du bac."},
                  whiteboard_url = 'https://bitpaper.io/go/e2e', quiz_url = 'https://www.wooclap.com/E2E'
                where id = ${k.id}`;
      W[key] = k.id;
    }

    const so = await seedTutor({ status: "verified", fullName: "sonia ben salah" });
    W.soniaTutor = so.id;
    const mehdi = await seedProfile({ role: "student", fullName: "mehdi jaziri", birthYear: 1996 });
    const amine = await seedProfile({ role: "student", fullName: "amine karoui", birthYear: 1995 });
    const rania = await seedProfile({ role: "student", fullName: "rania gharbi", birthYear: 1996 });
    W.mehdi = mehdi.id;
    W.amine = amine.id;
    W.rania = rania.id;
    for (const k of [W.soon, W.far]) {
      await seedBooking({ classId: k, studentId: mehdi.id, isFree: false });
      await sql`update classes set seats_taken = 1 where id = ${k}`;
    }
    const kp = await seedProfile({ role: "tutor", fullName: "karim draft", birthYear: 1990 });
    await seedTutor({ profileId: kp.id, status: "draft", fullName: "karim draft" });

    const ids: Record<Exclude<Who, "anon">, string> = { walid: wp.id, mehdi: mehdi.id, amine: amine.id, rania: rania.id, karim: kp.id };
    const tutors = new Set<Who>(["walid", "karim"]);
    const host = new URL(BASE_URL).hostname;

    const written = new Set<string>();
    const failed: string[] = [];
    for (const loc of LOCALES) {
      for (const vp of VIEWPORTS) {
        const phone = vp.width < 900;
        for (const s of SHOTS) {
          if ((s.only === "phone" && !phone) || (s.only === "desk" && phone)) continue;
          const file = `${s.name}-${loc}-${vp.tag}.png`;
          let v: Vars = {};
          const ctx = await browser.newContext({ baseURL: BASE_URL, viewport: { width: vp.width, height: vp.height }, reducedMotion: "reduce" });
          try {
            if (s.prep) v = await s.prep();
            const fill = (path: string) =>
              path.replace("__SLUG__", W.slug).replace("__SOON__", W.soon).replace("__LATER__", W.later).replace("__FAR__", W.far)
                .replace("__NEW__", v.__NEW__ ?? "");
            if (s.who !== "anon") {
              await ctx.addCookies([sessionCookie(await tokenOf(ids[s.who]))]);
              // The display hint a real sign-in sets (SiteHeader reads it for the nav).
              await ctx.addCookies([{ name: "tnajem_role", value: tutors.has(s.who) ? "tutor" : "student", domain: host, path: "/" }]);
            }
            // The room, the share sheet's networks and the phone's native sheet stay on this machine.
            await ctx.addInitScript(() => {
              window.open = (() => null) as typeof window.open;
              Object.defineProperty(navigator, "share", { value: async () => undefined, configurable: true });
            });
            await ctx.route((url) => !LOCAL.has(url.hostname), (route) => route.abort());
            const page = await ctx.newPage();
            await page.goto(`/${loc}${fill(s.path)}`);
            await settle(page);
            if (s.act) await s.act(page, loc, v);
            const mode = s.mode ?? "full";
            if (mode === "full") await page.evaluate(() => window.scrollTo(0, 0));
            // The pointer off the page's controls: a click's hover must not look like a state.
            await page.mouse.move(0, vp.height - 1);
            await settle(page);
            await page.screenshot({ path: join(OUT, file), fullPage: mode === "full", animations: "disabled", caret: "hide" });
            written.add(file);
          } catch (e) {
            failed.push(`${file}: ${(e as Error).message.split("\n")[0]}`);
          } finally {
            await ctx.close();
            if (s.after) await s.after(v).catch((e: Error) => failed.push(`${file} (after): ${e.message.split("\n")[0]}`));
          }
        }
      }
    }

    const cell = (s: Shot, loc: Loc, v: string) => {
      const phone = v === "390x844";
      if ((s.only === "phone" && !phone) || (s.only === "desk" && phone)) return "—";
      const f = `${s.name}-${loc}-${v}.png`;
      return written.has(f) ? `[png](${f})` : "**missing**";
    };
    const cols = LOCALES.flatMap((l) => VIEWPORTS.map((v) => `${l.toUpperCase()} ${v.tag}`));
    const lines = [
      "# Live fixes 3 — screenshots (I)",
      "",
      `Captured by \`e2e/visual/lf3-all.capture.ts\` (\`npm run ui:shots-lf3\`) against a production build on a scratch database, ${new Date().toISOString().slice(0, 10)}.`,
      "Files: `<shot>-<fr|ar>-<1440x900|390x844>.png`. **full** = the whole page; **view** = what the screen shows (a dialog, a toast, a confirm box, the success state, a phone's sticky bars). Phone-only or desk-only states have « — » in the other column. Test data only (`.invalid` addresses); « walid tester » is the live case's lowercase name, shown publicly as « Walid T. ».",
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
    // The readable slug back to e2e-… so the suite's teardown removes these rows.
    if (W.walidTutor) await sql`update tutors set slug = ${`e2e-lf3all-${randomBytes(5).toString("hex")}`} where id = ${W.walidTutor}`;
  }
});
