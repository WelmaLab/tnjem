import { test, expect, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { sql } from "../support/db";
import { seedBooking, seedClass, seedFollow, seedOffer, seedProfile, seedTutor } from "../support/seed";
import { mintSession, sessionCookie } from "../support/session";
import { api } from "../support/journey";
import { BASE_URL } from "../support/env";
import { tunisWallTimeFromNow } from "@tnajem/shared";

/* student-space-v1 · I — screenshots of every page of the student space (A–H), FR + AR,
   at 1440×900 and 390×844, and one side-by-side per approved mockup. NOT part of
   `npm run test` (*.capture.ts). Run with

     npm run ui:shots-ssv1          (= playwright test -c e2e/visual/visual.config.ts ssv1-all)

   against a running production build on a SCRATCH database (never `tnajem`). Output:
   ui-student-v1/ (gitignored), or UI_SHOTS_DIR: `<shot>-<fr|ar>-<1440x900|390x844>.png`,
   `sbs-<n>-<name>.png` (the mockup on the left, our page on the right at the same scale)
   and index.md. The mockups are read from SSV1_MOCKUPS, else ../UI_options next to the
   repository (or next to the main checkout, from an agent worktree); without them the
   side-by-sides are skipped and index.md says so.

   The world (test data only, `.invalid` addresses), shaped on the mockups:
     • « Ahmed Malek » (bac · maths, physique): the next class in 9 h with « Walid
       Trabelsi » (2 fiches), another on Wednesday, a past one (« testing right now »,
       2 fiches, one new), a late cancellation, a past class with « Sana Ben Salah »
       whom he follows (her open class this week, her public video, new), the monthly
       « Pack Bac maths » with Walid, and a conversation with each prof (Sana's unread);
     • « Rania Gharbi » follows Sana only — Mes profs without a subscription;
     • « Youssef Amri » has nothing at all — every empty state (bac · physique, so
       Accueil's suggestions match);
     • Walid himself — the prof's side of the merged conversation; and nobody (the
       public header signed out).
   Before each shot « last seen » (fiches) and the read markers (messages) are put back,
   so « Nouveau » and the unread count look the same in every shot. Nothing leaves this
   machine: other hosts are aborted. Readable slugs, renamed to e2e-… at the end so the
   suite's teardown removes the rows. */

const OUT = resolve(process.env.UI_SHOTS_DIR ?? "ui-student-v1");
const RUN = randomBytes(2).toString("hex");
const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const DAY = 86_400_000;

type Loc = "fr" | "ar";
type Who = "anon" | "ahmed" | "rania" | "youssef" | "walid";
type Shot = {
  name: string;
  path: string;
  who: Who;
  mode?: "full" | "view";
  only?: "phone" | "desk";
  act?: (p: Page, loc: Loc, phone: boolean) => Promise<void>;
  note: string;
};

const VIEWPORTS = [
  { tag: "1440x900", width: 1440, height: 900 },
  { tag: "390x844", width: 390, height: 844 },
] as const;
const LOCALES = ["fr", "ar"] as const;

const W = {
  walidTutor: "", walidProfile: "", sanaTutor: "", sanaProfile: "", ahmed: "", rania: "", youssef: "",
  slug: "", sanaSlug: "", next: "", wed: "", past: "", pastBooking: "", sanaThread: "", walidThread: "", seenAt: "",
};

const SHOTS: Shot[] = [
  // ── A · the shell and the auth-aware public header ──
  { name: "header-student", path: "", who: "ahmed", note: "A3 · the public home signed in as a student: « Mon espace » (→ /student); the footer has no « Se connecter » / « Tableau de bord »" },
  { name: "header-explore", path: "/explore", who: "ahmed", note: "A3 · Explore signed in as a student (the header)" },
  { name: "header-anon", path: "", who: "anon", note: "A3 · the public home signed out, as before (for comparison)" },
  { name: "avatar-menu", path: "/student", who: "ahmed", mode: "view", note: "A1 · the avatar menu: Profil · Aide · Se déconnecter",
    act: async (p, _loc, phone) => {
      await p.locator(phone ? "[data-e2e=shell-me-top]" : "[data-e2e=shell-me]").first().click();
      await p.locator(phone ? "[data-e2e=shell-me-top-menu]" : "[data-e2e=shell-me-menu]").first().waitFor();
    } },
  // ── B · Accueil ──
  { name: "accueil", path: "/student", who: "ahmed", note: "B · Accueil filled: the next-class hero (countdown, Rejoindre, Fiches (2), Message, Calendrier, « ⋯ »), Cette semaine, Mes profs, Nouvelles fiches" },
  { name: "accueil-seat-menu", path: "/student", who: "ahmed", mode: "view", note: "B · the hero's « ⋯ » menu open: « Annuler ma place »",
    act: async (p) => { await p.locator("[data-e2e=next-class] [data-e2e=seat-menu]").click(); await p.waitForTimeout(200); } },
  { name: "accueil-empty", path: "/student", who: "youssef", note: "B · nothing at all: « Trouve ton premier prof » + the profs matching bac · physique" },
  // ── C · Mes cours ──
  { name: "cours-avenir", path: "/student/cours", who: "ahmed", note: "C · À venir (counts on the tabs, « Inscrit »), the detail in the right column on a computer" },
  { name: "cours-passees", path: "/student/cours?tab=passees", who: "ahmed", note: "C · Passées with the detail: Fiches de la séance, Ton avis, Réserver la prochaine, Message (mockup 2a)" },
  { name: "cours-annulees", path: "/student/cours?tab=annulees", who: "ahmed", note: "C · Annulées: « Annulée par toi » + the late note" },
  { name: "cours-detail", path: "/student/cours/__PASTB__", who: "ahmed", note: "C · the phone's detail page /student/cours/<bookingId> (also reachable on a computer)" },
  { name: "cours-empty", path: "/student/cours", who: "youssef", note: "C · À venir empty: one primary action" },
  // ── D · Mes profs ──
  { name: "profs", path: "/student/profs", who: "ahmed", note: "D · Mes profs with « Abonnements mensuels » (mockup 2b)" },
  { name: "profs-nosub", path: "/student/profs", who: "rania", note: "D · Mes profs without a subscription: no « Abonnements mensuels » section" },
  { name: "profs-empty", path: "/student/profs", who: "youssef", note: "D · nobody yet: one primary action" },
  // ── E · Mes fiches ──
  { name: "fiches", path: "/student/fiches", who: "ahmed", note: "E · grouped by prof, chips, search, « Nouveau », the privacy line (mockup 3a)" },
  { name: "fiches-class", path: "/student/fiches?class=__PAST__", who: "ahmed", note: "E · ?class= — one class's fiches (from the hero's « Fiches (n) »)" },
  { name: "fiches-empty", path: "/student/fiches", who: "youssef", note: "E · nothing yet: one primary action" },
  // ── G · Messages ──
  { name: "messages", path: "/messages", who: "ahmed", note: "G · the student's list: one entry per prof (Sana unread)" },
  { name: "messages-conv", path: "/messages/with/__WALIDT__", who: "ahmed", note: "G · the merged conversation with Walid: the session markers, the privacy line, the composer (mockup 3b)" },
  { name: "messages-empty", path: "/messages", who: "youssef", note: "G · no booking: the honest empty state" },
  { name: "prof-messages", path: "/messages", who: "walid", note: "G · the prof's list: one entry per student (« Ahmed M. »)" },
  { name: "prof-conv", path: "/messages/with/__AHMED__", who: "walid", note: "G · the prof's merged conversation with Ahmed" },
  // ── F · Profil ──
  { name: "profil-moi", path: "/account?tab=moi", who: "ahmed", note: "F · Profil › Moi (mockup 4a)" },
  { name: "profil-notifications", path: "/account?tab=notifications", who: "ahmed", note: "F · Profil › Notifications: real e-mails, « Bientôt » off and disabled, the bell always on" },
  { name: "profil-securite", path: "/account?tab=securite", who: "ahmed", note: "F · Profil › Sécurité: language, role, password, sessions, deletion" },
  // ── H · the booked student on the public pages ──
  { name: "storefront-booked", path: "/__SLUG__", who: "ahmed", note: "H1 · the prof's page for a booked student: « ✓ Tu es inscrit », « Rejoindre (dans 9 h) », « Annuler »; the row tagged « Inscrit »" },
  { name: "class-booked", path: "/class/__NEXT__", who: "ahmed", note: "H1 · the class page for a booked student (mockup 4b)" },
];

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => {});
  await page.waitForTimeout(300);
}

/** The fiches « last seen » and the read markers, as the world was made. */
async function resetMarkers(): Promise<void> {
  await sql`update profiles set last_seen_fiches_at = ${W.seenAt} where id = ${W.ahmed}`;
  await sql`update message_threads set student_read_at = null where id = ${W.sanaThread}`;
  await sql`update message_threads set student_read_at = now(), tutor_read_at = now() where id = ${W.walidThread}`;
}

async function material(o: { tutorId: string; classId: string | null; title: string; kind: "pdf" | "png" | "youtube"; visibility?: string; size?: number }) {
  if (o.kind === "youtube") {
    await sql`insert into materials (tutor_id, class_id, kind, visibility, title, youtube_id)
              values (${o.tutorId}, ${o.classId}, 'youtube', ${o.visibility ?? "students"}, ${o.title}, 'dQw4w9WgXcQ')`;
    return;
  }
  const mime = o.kind === "pdf" ? "application/pdf" : "image/png";
  await sql`insert into materials (tutor_id, class_id, kind, visibility, title, mime, file_name, storage_path, size_bytes)
            values (${o.tutorId}, ${o.classId}, 'file', ${o.visibility ?? "students"}, ${o.title}, ${mime},
                    ${`fiche.${o.kind}`}, ${`materials/${o.tutorId}/ssv1-${randomBytes(4).toString("hex")}.${o.kind}`}, ${o.size ?? 1_258_291})`;
}

async function klass(tutorId: string, at: Date, title: string, price: number, durationMin = 90): Promise<string> {
  const k = await seedClass({ tutorId, at, isFreeFirst: false, priceTnd: price, seats: 8 });
  await sql`update classes set title = ${title}, duration_min = ${durationMin}, description = ${"Méthode et exercices types du bac."} where id = ${k.id}`;
  return k.id;
}

async function book(classId: string, studentId: string, status: "reserved" | "cancelled" = "reserved"): Promise<string> {
  const b = await seedBooking({ classId, studentId, isFree: false, status });
  if (status === "reserved") await sql`update classes set seats_taken = seats_taken + 1 where id = ${classId}`;
  await sql`update bookings set created_at = now() - interval '3 days' where id = ${b.id}`;
  return b.id;
}

test("capture every page of the student space, FR + AR, 1440×900 · 390×844, and the four side-by-sides", async ({ browser }) => {
  test.setTimeout(60 * 60_000);
  await mkdir(OUT, { recursive: true });
  const tokens = new Map<string, string>();
  const tokenOf = async (id: string) => {
    if (!tokens.has(id)) tokens.set(id, await mintSession(id));
    return tokens.get(id)!;
  };
  try {
    // ── the profs ──
    const wp = await seedProfile({ role: "tutor", fullName: "Walid Trabelsi", birthYear: 1985 });
    const wt = await seedTutor({ profileId: wp.id, status: "verified", fullName: "Walid Trabelsi" });
    W.walidProfile = wp.id;
    W.walidTutor = wt.id;
    W.slug = `walid-trabelsi-${RUN}`;
    await sql`update tutors set slug = ${W.slug}, subject = 'math', levels = '{bac,universite}',
                bio = ${"Prof de maths au lycée. Je prépare le bac en petits groupes : la méthode, les exercices types et beaucoup de pratique."}
              where id = ${wt.id}`;
    const sp = await seedProfile({ role: "tutor", fullName: "Sana Ben Salah", birthYear: 1988 });
    const st = await seedTutor({ profileId: sp.id, status: "verified", fullName: "Sana Ben Salah" });
    W.sanaProfile = sp.id;
    W.sanaTutor = st.id;
    W.sanaSlug = `sana-ben-salah-${RUN}`;
    await sql`update tutors set slug = ${W.sanaSlug}, subject = 'physique', levels = '{secondaire,bac}' where id = ${st.id}`;

    // ── the classes ──
    const FIVE = 5 * 60_000;
    W.next = await klass(wt.id, new Date(Math.ceil((Date.now() + 9 * 3600_000) / FIVE) * FIVE), "Intégrales — révision express", 20);
    W.wed = await klass(wt.id, tunisWallTimeFromNow(2, 18, 30), "Suites numériques — Bac", 20);
    const later = await klass(wt.id, tunisWallTimeFromNow(6, 18, 30), "Limites et continuité", 20);
    W.past = await klass(wt.id, new Date(Date.now() - DAY - 2 * 3600_000), "testing right now", 35);
    const cancelled = await klass(wt.id, tunisWallTimeFromNow(1, 10, 0), "Dérivées — exercices types", 40);
    const sanaPast = await klass(st.id, new Date(Date.now() - 3 * DAY), "Électricité — RC", 15);
    await klass(st.id, tunisWallTimeFromNow(4, 17, 0), "Physique — Électricité", 15);
    void later;

    // ── the students ──
    const ahmed = await seedProfile({ role: "student", fullName: "Ahmed Malek", birthYear: 2007, phone: `+2162${String(1_000_000 + Math.floor(Math.random() * 8_999_999))}` });
    const rania = await seedProfile({ role: "student", fullName: "Rania Gharbi", birthYear: 2006 });
    const youssef = await seedProfile({ role: "student", fullName: "Youssef Amri", birthYear: 2007 });
    W.ahmed = ahmed.id;
    W.rania = rania.id;
    W.youssef = youssef.id;
    await sql`update profiles set level = 'bac', subjects = 'math,physique' where id = ${ahmed.id}`;
    await sql`update profiles set level = 'bac', subjects = 'physique' where id = ${youssef.id}`;

    await book(W.next, ahmed.id);
    await book(W.wed, ahmed.id);
    W.pastBooking = await book(W.past, ahmed.id);
    const sanaPastB = await book(sanaPast, ahmed.id);
    const cancelledB = await book(cancelled, ahmed.id, "cancelled");
    await sql`insert into cancellations (booking_id, class_id, actor_profile_id, actor, hours_before_start, late, amount_tnd, retained_tnd, released_tnd, retained_pct)
              values (${cancelledB}, ${cancelled}, ${ahmed.id}, 'student', 20, true, 40, 16, 24, 0.4)`;
    await seedFollow(ahmed.id, st.id);
    await seedFollow(rania.id, st.id);
    const offer = await seedOffer({ tutorId: wt.id, title: "Pack Bac maths", sessionsPerMonth: 8, priceTnd: 160 });
    await sql`insert into student_subscriptions (offer_id, tutor_id, student_profile_id, status, sessions_per_month, price_tnd, period_start, period_end)
              values (${offer.id}, ${wt.id}, ${ahmed.id}, 'active', 8, 160, now() - interval '4 days', now() + interval '26 days')`;

    // ── the fiches: seen up to now, then two new ones ──
    await material({ tutorId: wt.id, classId: W.next, title: "Fiche méthode — intégration par parties", kind: "pdf" });
    await material({ tutorId: wt.id, classId: W.next, title: "Exercices — intégrales", kind: "png", size: 240_000 });
    await material({ tutorId: wt.id, classId: W.past, title: "Énoncé — intégrales", kind: "pdf" });
    await material({ tutorId: st.id, classId: sanaPast, title: "Schéma — loi des mailles", kind: "png", size: 180_000 });
    const [{ at }] = await sql<{ at: string }[]>`select now()::text at`;
    W.seenAt = at;
    await new Promise((r) => setTimeout(r, 50));
    await material({ tutorId: wt.id, classId: W.past, title: "Corrigé — série 3", kind: "pdf", size: 980_000 });
    await material({ tutorId: st.id, classId: null, title: "Vidéo — circuits RC", kind: "youtube", visibility: "public" });

    // ── the conversations (through the API, as the apps do) ──
    const wTok = await tokenOf(wp.id);
    const aTok = await tokenOf(ahmed.id);
    const sTok = await tokenOf(sp.id);
    const t1 = await api("/threads", wTok, { bookingId: W.pastBooking });
    expect(t1.ok, JSON.stringify(t1)).toBe(true);
    W.walidThread = String(t1.threadId);
    for (const [tok, body] of [
      [wTok, "Bonjour Ahmed, j'ai ajouté le corrigé de la série 3 dans tes fiches."],
      [aTok, "Merci ! L'exercice 4, je n'ai pas compris la primitive."],
      [wTok, "D'accord, on revoit ça mercredi."],
    ] as const) {
      const r = await api(`/threads/${W.walidThread}/messages`, tok, { body });
      expect(r.ok, JSON.stringify(r)).toBe(true);
    }
    const t2 = await api("/threads", sTok, { bookingId: sanaPastB });
    expect(t2.ok, JSON.stringify(t2)).toBe(true);
    W.sanaThread = String(t2.threadId);
    expect((await api(`/threads/${W.sanaThread}/messages`, sTok, { body: "Tu peux regarder la vidéo avant la prochaine séance." })).ok).toBe(true);

    const ids: Record<Exclude<Who, "anon">, string> = { ahmed: ahmed.id, rania: rania.id, youssef: youssef.id, walid: wp.id };
    const host = new URL(BASE_URL).hostname;
    const fill = (path: string) =>
      path.replace("__SLUG__", W.slug).replace("__NEXT__", W.next).replace("__PASTB__", W.pastBooking).replace("__PAST__", W.past)
        .replace("__WALIDT__", W.walidTutor).replace("__AHMED__", W.ahmed);

    const written = new Set<string>();
    const failed: string[] = [];
    for (const loc of LOCALES) {
      for (const vp of VIEWPORTS) {
        const phone = vp.width < 900;
        for (const s of SHOTS) {
          if ((s.only === "phone" && !phone) || (s.only === "desk" && phone)) continue;
          const file = `${s.name}-${loc}-${vp.tag}.png`;
          const ctx = await browser.newContext({ baseURL: BASE_URL, viewport: { width: vp.width, height: vp.height }, reducedMotion: "reduce" });
          try {
            await resetMarkers();
            if (s.who !== "anon") {
              await ctx.addCookies([sessionCookie(await tokenOf(ids[s.who]))]);
              await ctx.addCookies([{ name: "tnajem_role", value: s.who === "walid" ? "tutor" : "student", domain: host, path: "/" }]);
            }
            await ctx.addInitScript(() => {
              window.open = (() => null) as typeof window.open;
            });
            await ctx.route((url) => !LOCAL.has(url.hostname), (route) => route.abort());
            const page = await ctx.newPage();
            await page.goto(`/${loc}${fill(s.path)}`);
            await settle(page);
            if (s.act) await s.act(page, loc, phone);
            const mode = s.mode ?? "full";
            if (mode === "full") await page.evaluate(() => window.scrollTo(0, 0));
            if (!s.act) await page.mouse.move(0, vp.height - 1);
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

    // ── the side-by-sides: the mockup on the left, our pages on the right, same scale ──
    const sbs = await sideBySides(browser, written);

    const cell = (s: Shot, loc: Loc, v: string) => {
      const ph = v === "390x844";
      if ((s.only === "phone" && !ph) || (s.only === "desk" && ph)) return "—";
      const f = `${s.name}-${loc}-${v}.png`;
      return written.has(f) ? `[png](${f})` : "**missing**";
    };
    const cols = LOCALES.flatMap((l) => VIEWPORTS.map((v) => `${l.toUpperCase()} ${v.tag}`));
    const lines = [
      "# Student space v1 — screenshots (I)",
      "",
      `Captured by \`e2e/visual/ssv1-all.capture.ts\` (\`npm run ui:shots-ssv1\`) against a production build on a scratch database, ${new Date().toISOString().slice(0, 10)}.`,
      "Files: `<shot>-<fr|ar>-<1440x900|390x844>.png`. **full** = the whole page; **view** = what the screen shows (an open menu). Test data only (`.invalid` addresses).",
      "",
      "## Side-by-sides (mockup left, ours right, same scale)",
      "",
      ...sbs.map((l) => `- ${l}`),
      "",
      "## Pages",
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
    if (W.walidTutor) await sql`update tutors set slug = ${`e2e-ssv1all-${randomBytes(5).toString("hex")}`} where id = ${W.walidTutor}`;
    if (W.sanaTutor) await sql`update tutors set slug = ${`e2e-ssv1all-${randomBytes(5).toString("hex")}`} where id = ${W.sanaTutor}`;
  }
});

/* The mockups' desktop frames are ~1857 px wide (3000-px PNGs) for a 1440-px screen:
   our screenshots are drawn at that scale, cropped to one screen (900 / 844 px tall). */
const MOCKUP_DESKTOP_FRAME = 1857;
const SCALE = MOCKUP_DESKTOP_FRAME / 1440;

function mockupDir(): string | null {
  const candidates = [
    process.env.SSV1_MOCKUPS,
    resolve("..", "UI_options"),
    resolve("..", "..", "..", "..", "UI_options"), // from .claude/worktrees/<agent>
  ].filter(Boolean) as string[];
  return candidates.find((d) => existsSync(join(d, "espace-eleve-1-shell-accueil.png"))) ?? null;
}

async function sideBySides(browser: import("@playwright/test").Browser, written: Set<string>): Promise<string[]> {
  const dir = mockupDir();
  if (!dir) return ["skipped: the mockups were not found (set SSV1_MOCKUPS to the UI_options folder)"];
  const SETS: { out: string; mockup: string; rows: string[][]; note: string }[] = [
    { out: "sbs-1-accueil.png", mockup: "espace-eleve-1-shell-accueil.png", rows: [["accueil-fr-1440x900.png", "accueil-fr-390x844.png"]], note: "mockup 1 · Accueil (desktop + the phone's tab bar)" },
    { out: "sbs-2-cours-profs.png", mockup: "espace-eleve-2-cours-profs.png", rows: [["cours-passees-fr-1440x900.png"], ["profs-fr-1440x900.png"]], note: "mockup 2 · Mes cours › Passées with the detail; Mes profs" },
    { out: "sbs-3-fiches-messages.png", mockup: "espace-eleve-3-fiches-messages.png", rows: [["fiches-fr-1440x900.png"], ["messages-conv-fr-1440x900.png"]], note: "mockup 3 · Mes fiches; Messages (the conversation)" },
    { out: "sbs-4-profil-mobile-ar.png", mockup: "espace-eleve-4-profil-mobile-ar.png", rows: [["profil-moi-fr-1440x900.png", "class-booked-fr-1440x900.png", "cours-passees-ar-390x844.png"]], note: "mockup 4 · Profil › Moi; the class page for a booked student; Mes cours in Arabic on a phone" },
  ];
  const out: string[] = [];
  const page = await browser.newPage();
  try {
    for (const set of SETS) {
      const missing = set.rows.flat().filter((f) => !written.has(f));
      if (missing.length) {
        out.push(`${set.out}: skipped — missing ${missing.join(", ")}`);
        continue;
      }
      const uri = async (p: string) => `data:image/png;base64,${(await readFile(p)).toString("base64")}`;
      const left = await uri(join(dir, set.mockup));
      const rows: string[] = [];
      for (const row of set.rows) {
        const cells: string[] = [];
        for (const f of row) {
          const phone = f.includes("390x844");
          const w = Math.round((phone ? 390 : 1440) * SCALE);
          const h = Math.round((phone ? 844 : 900) * SCALE);
          cells.push(`<figure><div class="crop" style="width:${w}px;height:${h}px"><img src="${await uri(join(OUT, f))}" style="width:${w}px"></div><figcaption>${f}</figcaption></figure>`);
        }
        rows.push(`<div class="row">${cells.join("")}</div>`);
      }
      await page.setContent(`<!doctype html><html><head><style>
        body{margin:0;background:#e9e3d9;font:600 28px system-ui,sans-serif;color:#333}
        .wrap{display:flex;gap:60px;align-items:flex-start;padding:40px;width:max-content}
        h2{margin:0 0 16px;font-size:34px}
        .row{display:flex;gap:40px;margin-block-end:40px;align-items:flex-start}
        figure{margin:0}.crop{overflow:hidden;border:2px solid #999;background:#fff}
        .crop img{display:block}figcaption{font-size:22px;margin-top:8px}
        </style></head><body><div class="wrap">
        <section><h2>Mockup — ${set.mockup}</h2><img src="${left}"></section>
        <section><h2>Ours (production build, same scale)</h2>${rows.join("")}</section>
        </div></body></html>`);
      await page.waitForLoadState("load");
      const size = await page.evaluate(() => ({ w: document.querySelector(".wrap")!.scrollWidth, h: document.querySelector(".wrap")!.scrollHeight }));
      await page.setViewportSize({ width: Math.min(size.w, 16000), height: Math.min(size.h, 16000) });
      await page.locator(".wrap").screenshot({ path: join(OUT, set.out) });
      out.push(`[${set.out}](${set.out}) — ${set.note}`);
    }
  } finally {
    await page.close();
  }
  return out;
}
