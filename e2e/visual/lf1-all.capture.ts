import { test, expect, type Browser, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "../support/db";
import { seedBooking, seedClass, seedOffer, seedProfile, seedPromotion, seedTutor } from "../support/seed";
import { mintSession, sessionCookie } from "../support/session";
import { api } from "../support/journey";
import { BASE_URL } from "../support/env";

/* live-fixes-1 · K — screenshots of every page items A–I touched, FR + AR, at the three
   viewports of the spec (1440×674, 1440×900, 390×844). NOT part of `npm run test`
   (*.capture.ts). Run with

     npm run ui:shots-lf1          (= playwright test -c e2e/visual/visual.config.ts lf1-all)

   against a running production build. Output: ui-live-fixes-1/ (gitignored), or
   UI_SHOTS_DIR. Files are <page>-<fr|ar>-<viewport>.png, and index.md lists them.

   Three kinds of shot:
     full  the whole page (fixed bars are drawn where the first screen has them);
     view  what the screen shows, e.g. with a sheet, dialog, « ? » or menu open;
     end   the screen scrolled to the very bottom: the last field above the action bar (A1).

   The data (scratch DB only — never `tnajem`):
     • « walid tester » (stored lower-case, subject stored as the code `math`, phone
       +21656561226 — C2 shows « Walid T. », « Maths », « +216 56 561 226 »), VERIFIED,
       « 1re séance offerte » OFF: classes, bookings, followers (real API calls, so the
       bell has real notifications), an offer with a request and a subscriber, two
       promotions, a fiche and a library video, a month of « Vues · Clics », a thread;
     • « Nour Haddad », VERIFIED with « 1re séance offerte » ON (the D1 toggle);
     • « Karim Draft », DRAFT (blockers, verification);
     • « Sami Vide », VERIFIED with nothing (the H empty states).
   Readable slugs for the shots, renamed to e2e-… at the end so the suite's teardown
   removes every row. */

const OUT = resolve(process.env.UI_SHOTS_DIR ?? "ui-live-fixes-1");
const RUN = randomBytes(2).toString("hex");

type Who = "anon" | "walid" | "nour" | "draft" | "empty" | "student";
type Mode = "full" | "view" | "end";
type Shot = { name: string; path: string; who: Who; mode?: Mode; phoneOnly?: boolean; act?: (p: Page, loc: "fr" | "ar") => Promise<void>; note: string };

const VIEWPORTS = [
  { tag: "1440x674", width: 1440, height: 674 },
  { tag: "1440x900", width: 1440, height: 900 },
  { tag: "390x844", width: 390, height: 844 },
] as const;
const LOCALES = ["fr", "ar"] as const;

/** A day at a round Tunis hour (UTC+1, no DST). */
function tunisAt(days: number, hour: number): Date {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setUTCHours(hour - 1, 0, 0, 0);
  return d;
}
function ddmmyyyy(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

async function fillClass(p: Page, loc: "fr" | "ar") {
  await p.locator("main form input[type=text]").first().fill(loc === "fr" ? "Intégrales : révision express" : "التكامل: مراجعة سريعة");
  await p.locator("[data-e2e=date-input]").fill(ddmmyyyy(tunisAt(3, 18)));
  await p.locator("[data-e2e=time-input]").fill("18:00");
  await p.locator("[data-e2e=class-level] label").nth(1).click();
  await p.locator("main form input[type=number]").first().fill("15");
  await p.locator("[data-e2e=class-seats]").fill("6");
  await p.locator("main form textarea").first().fill(loc === "fr" ? "Méthode, exercices types du bac, et une fiche à la fin." : "الطريقة، تمارين الباك، وملخّص في الآخر.");
}

const SHOTS: Shot[] = [
  { name: "home", path: "/dashboard", who: "walid", note: "Accueil, verified tutor (C2 name, A frame, A4 sidebar at 674)" },
  { name: "home-draft", path: "/dashboard", who: "draft", note: "Accueil, draft tutor: the blocker holds the one ochre" },
  { name: "tabbar-plus", path: "/dashboard", who: "walid", mode: "view", phoneOnly: true, note: "phone: the « + » inside the tab bar, its menu open (A3)",
    act: async (p) => { await p.locator("[data-e2e=shell-fab]").click(); await p.locator("[data-e2e=shell-fab-menu]").waitFor(); } },
  { name: "classes", path: "/dashboard/classes", who: "walid", note: "Mes classes" },
  { name: "classes-empty", path: "/dashboard/classes", who: "empty", note: "Mes classes, empty (H: one primary action)" },
  { name: "students", path: "/dashboard/students", who: "walid", note: "Mes élèves (C2 capitalised first names)" },
  { name: "students-empty", path: "/dashboard/students", who: "empty", note: "Mes élèves, empty (H: « Partager ma page »)" },
  { name: "storefront", path: "/dashboard/storefront", who: "walid", note: "Ma vitrine with Vues · Clics · Abonnés" },
  { name: "storefront-share", path: "/dashboard/storefront", who: "walid", mode: "view", note: "Ma vitrine, share sheet open (G: « Plus d'apps » and « QR code »)",
    act: async (p) => { await p.locator("[data-e2e=share-open-profile]").first().click(); await p.locator("[data-e2e=share-sheet]").waitFor(); } },
  { name: "storefront-empty", path: "/dashboard/storefront", who: "empty", note: "Ma vitrine, no visit yet (H: how the first visit comes, Share button)" },
  { name: "materials", path: "/dashboard/materials", who: "walid", note: "Mes fiches: the list (B)" },
  { name: "materials-edit", path: "/dashboard/materials", who: "walid", mode: "view", note: "Mes fiches, the edit dialog (B)",
    act: async (p) => { await p.locator("[data-e2e=fiche-edit]").first().click(); await p.locator("[data-e2e=fiche-edit-dialog]").waitFor(); } },
  { name: "materials-library", path: "/dashboard/materials", who: "walid", mode: "end", note: "Mes fiches, « Pour tes élèves seulement » open: drop zone + YouTube (B)",
    act: async (p) => { await p.locator("[data-e2e=library-toggle]").click(); await p.locator("[data-e2e=library-form]").waitFor(); } },
  { name: "materials-empty", path: "/dashboard/materials", who: "empty", note: "Mes fiches, empty" },
  { name: "new-class", path: "/dashboard/new-class", who: "walid", note: "Nouvelle classe: « 1re séance offerte : désactivée » line (D1), empty preview in the brand face (D2)" },
  { name: "new-class-toggle", path: "/dashboard/new-class", who: "nour", note: "Nouvelle classe with the option on: the toggle (D1)" },
  { name: "new-class-calendar", path: "/dashboard/new-class", who: "walid", mode: "view", note: "Nouvelle classe, calendar open, never under the bar (D3)",
    act: async (p) => { await p.locator("[data-e2e=date-input]").scrollIntoViewIfNeeded(); await p.locator("[data-e2e=date-open]").click(); await p.locator("[data-e2e=date-calendar]").waitFor(); } },
  { name: "new-class-end", path: "/dashboard/new-class", who: "walid", mode: "end", note: "Nouvelle classe filled, scrolled to the end: last field above the bar (A1), preview filled",
    act: async (p, loc) => { await fillClass(p, loc); await p.waitForTimeout(600); } },
  { name: "new-pack", path: "/dashboard/new-pack", who: "walid", note: "Nouvelle fiche: the info in the subtitle (E), drop zone (B)" },
  { name: "new-pack-end", path: "/dashboard/new-pack", who: "walid", mode: "end", note: "Nouvelle fiche scrolled to the end (A1)" },
  { name: "verify", path: "/onboarding/verify", who: "draft", note: "Vérification step 1" },
  { name: "verify-end", path: "/onboarding/verify", who: "draft", mode: "end", note: "Vérification scrolled to the end (A1, A2: no tab bar on a phone form)" },
  { name: "settings-compte", path: "/dashboard/settings", who: "walid", note: "Réglages › Compte (C2 name + phone, F3)" },
  { name: "settings-vitrine", path: "/dashboard/settings?tab=vitrine", who: "walid", note: "Réglages › Vitrine: name, subject, levels inline (F2)" },
  { name: "settings-vitrine-end", path: "/dashboard/settings?tab=vitrine", who: "walid", mode: "end", note: "Réglages › Vitrine scrolled to the end (A1)" },
  { name: "settings-notifications", path: "/dashboard/settings?tab=notifications", who: "walid", note: "Réglages › Notifications: one-line intro, « Bientôt » switches (F1)" },
  { name: "settings-securite", path: "/dashboard/settings?tab=securite", who: "walid", note: "Réglages › Sécurité" },
  { name: "promotions", path: "/dashboard/promotions", who: "walid", note: "Promotions: no second note (E), the target picker (B)" },
  { name: "promotions-tip", path: "/dashboard/promotions", who: "walid", mode: "view", note: "Promotions, the « ? » open (E)",
    act: async (p) => { await p.locator("[data-e2e=promo-info]").scrollIntoViewIfNeeded(); await p.locator("[data-e2e=promo-info]").click(); await p.waitForTimeout(200); } },
  { name: "promotions-end", path: "/dashboard/promotions", who: "walid", mode: "end", note: "Promotions scrolled to the end (A1)" },
  { name: "subscriptions", path: "/dashboard/subscriptions", who: "walid", note: "Abonnements: request, subscriber (E « ? » beside « Demandes »)" },
  { name: "subscriptions-tip", path: "/dashboard/subscriptions", who: "walid", mode: "view", note: "Abonnements, the « ? » open (E)",
    act: async (p) => { await p.locator("[data-e2e=subs-info]").scrollIntoViewIfNeeded(); await p.locator("[data-e2e=subs-info]").click(); await p.waitForTimeout(200); } },
  { name: "subscriptions-form", path: "/dashboard/subscriptions", who: "walid", mode: "end", note: "Abonnements, the offer form open, scrolled to the end (A1, A2)",
    act: async (p) => { await p.locator("[data-e2e=offer-new]").click(); await p.locator("[data-e2e=offer-form]").waitFor(); } },
  { name: "plan", path: "/dashboard/plan", who: "walid", note: "Mon offre: figures in the brand face (C1)" },
  { name: "onboarding", path: "/onboarding", who: "walid", note: "/onboarding, prefilled: the subject shows its label, not `math` (C2)" },
  { name: "messages", path: "/messages", who: "walid", note: "Messages" },
  { name: "messages-thread", path: "/messages/__THREAD__", who: "walid", note: "a conversation (760 column)" },
  { name: "privacy", path: "/privacy", who: "anon", note: "/privacy: Cloudflare Web Analytics disclosed (I)" },
  { name: "public-profile", path: "/__SLUG__", who: "anon", note: "/{slug}: « Walid T. », « Maths »" },
  { name: "public-class", path: "/class/__CLASS__", who: "anon", note: "/class/{id}: subject label, capitalised name" },
  { name: "explore", path: "/explore", who: "anon", note: "Explore, searched for the tutor: subject label, capitalised name",
    act: async (p) => { await p.locator('input[type="search"]').fill("Walid"); await p.waitForTimeout(800); } },
];

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(250);
}

const tokens = new Map<string, string>();

async function contextFor(browser: Browser, who: Who, vp: { width: number; height: number }, ids: Partial<Record<Who, string>>) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, reducedMotion: "reduce" });
  if (who !== "anon") {
    const id = ids[who]!;
    if (!tokens.has(id)) tokens.set(id, await mintSession(id));
    await ctx.addCookies([sessionCookie(tokens.get(id)!)]);
    if (who !== "student") {
      const u = new URL(BASE_URL);
      await ctx.addCookies([{ name: "tnajem_role", value: "tutor", domain: u.hostname, path: "/" }]);
    }
  }
  // The share sheet's networks and the phone's native sheet stay on this machine.
  await ctx.addInitScript(() => {
    window.open = (() => null) as typeof window.open;
    Object.defineProperty(navigator, "share", { value: async () => undefined, configurable: true });
  });
  return ctx;
}

test("capture every page live-fixes-1 touched, FR + AR, 1440×674 · 1440×900 · 390×844", async ({ browser }) => {
  test.setTimeout(60 * 60_000);
  await mkdir(OUT, { recursive: true });

  const madeTutors: string[] = [];
  const tutor = async (fullName: string, status: "draft" | "verified", slug: string, extra?: { phone?: string; freeFirst?: boolean }) => {
    const p = await seedProfile({ role: "tutor", fullName, birthYear: 1988, phone: extra?.phone ?? null });
    const t = await seedTutor({ profileId: p.id, status, fullName, offersFreeFirstSession: extra?.freeFirst ?? false });
    const s = `${slug}-${RUN}`;
    await sql`update tutors set slug = ${s}, subject = 'math', levels = '{secondaire,bac}',
                bio = ${"Prof de maths au lycée. Je prépare le bac en petits groupes : la méthode, les exercices types et beaucoup de pratique."}
              where id = ${t.id}`;
    madeTutors.push(t.id);
    return { p, t: { ...t, slug: s } };
  };

  try {
    const walid = await tutor("walid tester", "verified", "walid-tester", { phone: "+21656561226" });
    const nour = await tutor("Nour Haddad", "verified", "nour-haddad", { freeFirst: true });
    const draft = await tutor("Karim Draft", "draft", "karim-draft");
    const empty = await tutor("Sami Vide", "verified", "sami-vide");

    const named = (id: string, title: string, description: string) =>
      sql`update classes set title = ${title}, description = ${description} where id = ${id}`;
    const soon = await seedClass({ tutorId: walid.t.id, isFreeFirst: false, priceTnd: 40, at: tunisAt(1, 18), seats: 6 });
    await named(soon.id, "Intégrales — révision express", "Les intégrales du programme de bac, en 90 minutes : méthode et exercices types.");
    const later = await seedClass({ tutorId: walid.t.id, isFreeFirst: false, priceTnd: 25, at: tunisAt(5, 10), seats: 10 });
    await named(later.id, "Suites numériques : exercices corrigés", "Récurrence, limites, suites adjacentes.");
    const past = await seedClass({ tutorId: walid.t.id, isFreeFirst: false, priceTnd: 30, at: tunisAt(-4, 18), seats: 8 });
    await named(past.id, "Probabilités — bac blanc", "Un sujet de bac blanc corrigé ensemble.");

    // A fiche (pack) and a library video for the class.
    await sql`insert into packs (id, tutor_id, title, description, price_tnd)
              values (${randomUUID()}, ${walid.t.id}, 'Fiches de révision : Analyse', '36 pages · méthodes et exercices corrigés', '12')`;
    await sql`insert into materials (id, tutor_id, class_id, kind, visibility, title, youtube_id)
              values (${randomUUID()}, ${walid.t.id}, ${soon.id}, 'youtube', 'students', 'Corrigé vidéo — séance 1', 'dQw4w9WgXcQ')`;

    // Students, stored lower-case (C2 capitalises on screen).
    const student = (n: string, y: number) => seedProfile({ role: "student", fullName: n, birthYear: y });
    const yosra = await student("yosra trabelsi", 1999);
    const mehdi = await student("mehdi jaziri", 2000);
    const rania = await student("rania gharbi", 1996);
    const omar = await student("omar jlassi", 1995);
    await seedBooking({ classId: past.id, studentId: yosra.id, status: "attended" });
    await seedBooking({ classId: past.id, studentId: mehdi.id, status: "attended" });

    // Real API calls, so the bell holds real (key + params) notifications.
    const tokenOf = async (id: string) => { const t = await mintSession(id); tokens.set(id, t); return t; };
    const yt = await tokenOf(yosra.id);
    expect((await api("/bookings", yt, { classId: soon.id })).ok).toBe(true);
    for (const s of [rania, omar]) expect((await api("/follows", await tokenOf(s.id), { slug: walid.t.slug })).ok).toBe(true);
    const [{ id: bookingId }] = await sql<{ id: string }[]>`select id from bookings where class_id = ${soon.id} and student_id = ${yosra.id}`;
    const threadId = String((await api("/threads", yt, { bookingId })).threadId);
    const wt = await tokenOf(walid.p.id);
    expect((await api(`/threads/${threadId}/messages`, yt, { body: "Bonjour Monsieur, on verra aussi les intégrales par parties ?" })).ok).toBe(true);
    expect((await api(`/threads/${threadId}/messages`, wt, { body: "Bonjour Yosra, oui : en deuxième partie de séance." })).ok).toBe(true);

    const offer = await seedOffer({ tutorId: walid.t.id, title: "Suivi Bac — 4 séances", sessionsPerMonth: 4, priceTnd: 120 });
    await seedPromotion({ tutorId: walid.t.id, percent: 15, endsInDays: 9 });
    await seedPromotion({ tutorId: walid.t.id, percent: 20, code: "RENTREE", endsInDays: 20, maxUses: 30 });
    await sql`insert into student_subscriptions (offer_id, tutor_id, student_profile_id, status, sessions_per_month, price_tnd)
              values (${offer.id}, ${walid.t.id}, ${rania.id}, 'requested', 4, 102)`;
    await sql`insert into student_subscriptions (offer_id, tutor_id, student_profile_id, status, sessions_per_month, price_tnd, period_start, period_end, confirmed_at)
              values (${offer.id}, ${walid.t.id}, ${omar.id}, 'active', 4, 120, now() - interval '26 days', now() + interval '4 days', now() - interval '26 days')`;

    const resetStats = async () => {
      await sql`delete from vitrine_stats_daily where tutor_id in (${walid.t.id}, ${empty.t.id})`;
      for (const [source, views, clicks] of [["whatsapp", 14, 14], ["direct", 9, 0], ["facebook", 5, 5], ["qr", 2, 2]] as const) {
        await sql`insert into vitrine_stats_daily (tutor_id, day, source, views, clicks)
                  values (${walid.t.id}, (now() at time zone 'Africa/Tunis')::date, ${source}, ${views}, ${clicks})`;
      }
    };

    const ids: Partial<Record<Who, string>> = { walid: walid.p.id, nour: nour.p.id, draft: draft.p.id, empty: empty.p.id, student: yosra.id };
    const fill = (path: string) => path.replace("__SLUG__", walid.t.slug).replace("__CLASS__", soon.id).replace("__THREAD__", threadId);

    const written = new Set<string>();
    const failed: string[] = [];
    for (const loc of LOCALES) {
      for (const vp of VIEWPORTS) {
        for (const s of SHOTS) {
          if (s.phoneOnly && vp.width >= 900) continue;
          await resetStats();
          await sql`update notifications set read_at = null where profile_id = ${walid.p.id}`;
          await sql`update message_threads set tutor_read_at = null where id = ${threadId}`;
          const ctx = await contextFor(browser, s.who, { width: vp.width, height: vp.height }, ids);
          const page = await ctx.newPage();
          const file = `${s.name}-${loc}-${vp.tag}.png`;
          try {
            await page.goto(`/${loc}${fill(s.path)}`);
            await settle(page);
            if (s.act) await s.act(page, loc);
            const mode = s.mode ?? "full";
            if (mode === "end") await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
            else if (mode === "full") await page.evaluate(() => window.scrollTo(0, 0));
            await page.mouse.move(0, 0);
            await settle(page);
            await page.screenshot({ path: join(OUT, file), fullPage: mode === "full", animations: "disabled", caret: "hide" });
            written.add(file);
          } catch (e) {
            failed.push(`${file}: ${(e as Error).message.split("\n")[0]}`);
          } finally {
            await ctx.close();
          }
        }
      }
    }

    const cell = (s: Shot, loc: string, v: string) => {
      const f = `${s.name}-${loc}-${v}.png`;
      return written.has(f) ? `[png](${f})` : s.phoneOnly && v !== "390x844" ? "—" : "**missing**";
    };
    const cols = LOCALES.flatMap((l) => VIEWPORTS.map((v) => `${l.toUpperCase()} ${v.tag}`));
    const lines = [
      "# Live fixes 1 — screenshots (K)",
      "",
      `Captured by \`e2e/visual/lf1-all.capture.ts\` (\`npm run ui:shots-lf1\`) against a production build on a scratch database, ${new Date().toISOString().slice(0, 10)}.`,
      "Files: `<page>-<fr|ar>-<1440x674|1440x900|390x844>.png`. **full** = the whole page (fixed bars are drawn where the first screen has them); **view** = what the screen shows with a sheet / dialog / menu / « ? » open; **end** = the screen scrolled to the very bottom (the last field above the action bar). Test data only (`.invalid` addresses).",
      "",
      `| page | shot | what it shows | ${cols.join(" | ")} |`,
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
    // Readable slugs back to e2e-… so the suite's teardown removes these rows.
    for (const id of madeTutors) await sql`update tutors set slug = ${`e2e-lf1all-${randomBytes(5).toString("hex")}`} where id = ${id}`;
  }
});
