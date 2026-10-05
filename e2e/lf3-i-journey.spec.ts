import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { sql } from "./support/db";
import { seedProfile, seedTutor } from "./support/seed";
import { loginAs } from "./support/session";
import { BASE_URL } from "./support/env";
import { fillWallTime } from "./support/datetime";
import { notificationTexts } from "./support/journey";
import { CANCEL_GRACE_MINUTES, tunisClock, tunisWallTime } from "@tnajem/shared";

/* ════════════════════════════════════════════════════════════════════════════
   live-fixes-3 · I — THE LIVE CLASS OF 4 OCT 2026, END TO END, THROUGH THE REAL UI.

   The founder ran a real class on tnajem.com: the prof created it, a student booked
   it, and both tried to join. The prof had no way in (A), « Entrer » opened the bare
   token on tnajem.com (B), the student who cancelled 30 s after booking had 40 %
   recorded against them (C). This replays that class, in one spec, with the case's
   own numbers — a 10 TND class about 30 h away, the prof « walid tester »:

     1. a VERIFIED prof creates the class on « Nouvelle classe » (the real form);
     2. a student opens the class page → « Réserver cette séance » → the checkout
        (the « moins de 48 h » note BEFORE confirming) → « Confirmer ma place »;
     3. the prof reaches /live/<id> in ONE click — « Démarrer la séance » on Accueil,
        then on Mes classes — and the student through « Rejoindre le direct »;
     4. each « Entrer dans la classe » asks the browser for an ABSOLUTE
        https://meet.jit.si/tnajem-… URL — the same room for both — titled with the
        class (#config.subject) and naming the viewer (#userInfo.displayName). The
        prof reads the moderator line above the button; the student does not;
     5. the student cancels inside the 15 min after booking: the confirm and the
        message say it is free, and the ledger agrees — 0 retained, reason
        booking-grace — though the class is < 48 h away (the 40 % case).

   FR at 1440×900, AR at 390×844 (Arabic title, Derja copy, the phone's sticky
   « Réserver » bar). Nothing leaves this machine: window.open is replaced by a
   recorder (as in lf3-b-live-room.spec.ts), and every request to another host is
   aborted and listed — the run fails if one ever went to meet.jit.si.
   ADDED as its own spec. */

const HOST = new URL(BASE_URL).hostname;
const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

const T = {
  fr: {
    title: "Intégrales — révision express",
    publish: "Publier la classe",
    book: "Réserver cette séance",
    confirm: "Confirmer ma place",
    booked: "C'est réservé !",
    note: "Cette séance est dans moins de 48 h : après 15 min, une annulation compte 40 % pour le prof.",
    owner: "C'est ta séance",
    start: "Démarrer la séance",
    tutorNote: "Tu es le prof de cette séance.",
    moderator:
      "Pour ouvrir la salle, connecte-toi une fois avec Google (ou Microsoft/Facebook) quand Jitsi le demande. Tes élèves entrent ensuite directement.",
    enter: /Entrer dans la classe/,
    videoTile: "Rejoindre la vidéo",
    startsAt: "Démarre le ",
    join: "Rejoindre le direct",
    cancel: /Annuler ma place/,
    sure: "Annuler cette réservation ?",
    yes: /Oui, annuler/,
    flash: /Réservation annulée/,
    grace: (until: string) => `Annulation gratuite jusqu'à ${until}`,
    graceDone: `C'était dans les ${CANCEL_GRACE_MINUTES} min après ta réservation`,
    retained: "4 TND",
    lateNotice: "Annulation tardive",
    locked: "Cette séance est réservée aux élèves inscrits",
  },
  ar: {
    title: "التكامل — مراجعة سريعة",
    publish: "انشر الحصة",
    book: "احجز الحصة هاذي",
    confirm: "أكّد مكاني",
    booked: "حجزت بلاصتك!",
    note: "الحصة هاذي في أقل من 48 ساعة : بعد 15 دقيقة، الإلغاء يتحسب ⁦40 %⁩ للأستاذ.",
    owner: "هاذي حصتك",
    start: "ابدا الحصة",
    tutorNote: "إنت الأستاذ متاع الحصة هاذي.",
    moderator: "باش تحلّ القاعة، ادخل مرّة وحدة بـ Google (ولا Microsoft/Facebook) كي Jitsi يطلب منك. التلامذة متاعك يدخلو مباشرة من بعد.",
    enter: /ادخل للحصة/,
    videoTile: "ادخل للفيديو",
    startsAt: "تبدا يوم ",
    join: "ادخل للدايركت",
    cancel: /ألغي مكاني/,
    sure: "تحب تلغي هذا الحجز ؟",
    yes: /إيه، ألغي/,
    flash: /الحجز تلغى/,
    grace: (until: string) => `الإلغاء بلاش حتى لـ ${until}`,
    graceDone: `كان في الـ${CANCEL_GRACE_MINUTES} دقيقة اللي بعد الحجز`,
    retained: "4 د.ت",
    lateNotice: "إلغاء متأخّر",
    locked: "الحصة هاذي للتلامذة اللي حاجزين برك",
  },
} as const;

type Opened = { url: string; target?: string; features?: string };
type Actor = { ctx: BrowserContext; page: Page; external: string[] };

/** A signed-in browser whose « Entrer » is recorded, never followed, and that cannot reach another host. */
async function actor(browser: Browser, profileId: string, role: "tutor" | "student", viewport: { width: number; height: number }): Promise<Actor> {
  const ctx = await browser.newContext({ viewport, reducedMotion: "reduce" });
  await loginAs(ctx, profileId);
  await ctx.addCookies([{ name: "tnajem_role", value: role, domain: HOST, path: "/" }]);
  await ctx.addInitScript(() => {
    const w = window as unknown as { __opened: Opened[] };
    w.__opened = [];
    window.open = ((url?: string | URL, target?: string, features?: string) => {
      w.__opened.push({ url: String(url), target, features });
      return null;
    }) as typeof window.open;
  });
  const external: string[] = [];
  await ctx.route(
    (url) => !LOCAL.has(url.hostname),
    (route) => {
      external.push(route.request().url());
      return route.abort();
    },
  );
  return { ctx, page: await ctx.newPage(), external };
}

/** Click « Entrer dans la classe » once; return what it asked the browser to open. */
async function enter(page: Page, label: RegExp): Promise<Opened> {
  const btn = page.getByRole("button", { name: label });
  await expect(btn, "one « Entrer » — the duplicate video button is gone (B4)").toHaveCount(1);
  await btn.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __opened: Opened[] }).__opened.length)).toBe(1);
  return page.evaluate(() => (window as unknown as { __opened: Opened[] }).__opened[0]);
}

/** One setting of a Jitsi URL fragment (#config.subject=%22…%22&userInfo.displayName=%22…%22). */
function setting(url: string, key: string): unknown {
  const fragment = url.slice(url.indexOf("#") + 1);
  const pair = fragment.split("&").find((p) => p.split("=")[0] === key);
  return pair === undefined ? undefined : JSON.parse(decodeURIComponent(pair.slice(key.length + 1)));
}

/** The room as the browser would open it: absolute, https, meet.jit.si, the class's room. */
function expectRoom(opened: Opened, token: string, who: string) {
  let parsed: URL | null = null;
  try {
    parsed = new URL(opened.url); // throws on a relative URL — the live bug opened tnajem.com/fr/live/<token>
  } catch {
    /* asserted below */
  }
  expect(parsed, `${who}: an ABSOLUTE URL, not « ${opened.url} »`).not.toBeNull();
  expect(parsed!.protocol, who).toBe("https:");
  expect(parsed!.host, who).toBe("meet.jit.si");
  expect(parsed!.pathname, `${who}: the class's own room`).toBe(`/tnajem-${token}`);
  expect(opened.target, `${who}: a new tab`).toBe("_blank");
  expect(opened.features ?? "", `${who}: the room gets no handle on Tnajem`).toContain("noopener");
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const wallOf = (ms: number) => {
  const w = tunisWallTime(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${w.year}-${p(w.month)}-${p(w.day)}T${p(w.hour)}:${p(w.minute)}`;
};

for (const run of [
  { loc: "fr" as const, vp: { width: 1440, height: 900 } },
  { loc: "ar" as const, vp: { width: 390, height: 844 } },
]) {
  const { loc, vp } = run;
  const L = T[loc];

  test(`I · ${loc} ${vp.width}×${vp.height}: a verified prof creates a class, a student books it, both enter the same titled Jitsi room, a cancel inside 15 min is free`, async ({ browser }) => {
    test.setTimeout(240_000);
    // The live case: « walid tester », a 10 TND class about 30 h away (inside 48 h).
    const tutorProfile = await seedProfile({ role: "tutor", birthYear: 1988, fullName: "walid tester" });
    const tutor = await seedTutor({ profileId: tutorProfile.id, status: "verified", fullName: "walid tester" });
    const studentProfile = await seedProfile({ role: "student", birthYear: 1996, fullName: "mehdi jaziri" });
    const FIVE_MIN = 5 * 60_000;
    const startMs = Math.ceil((Date.now() + 30 * 3600_000) / FIVE_MIN) * FIVE_MIN;

    const prof = await actor(browser, tutorProfile.id, "tutor", vp);
    const student = await actor(browser, studentProfile.id, "student", vp);
    const p = prof.page;
    const s = student.page;
    let classId = "";
    let token = "";
    let bookingId = "";
    let bookedAt = 0;
    let profRoom: Opened | null = null;

    try {
      await test.step("1 · the verified prof publishes the class on « Nouvelle classe »", async () => {
        await p.goto(`/${loc}/dashboard/new-class`, { waitUntil: "networkidle" }); // hydrated: a fill before hydration is wiped
        await expect(p.locator("[data-e2e=save-draft]"), "verified: no draft-only button (D2)").toHaveCount(0);
        const publish = p.getByRole("button", { name: L.publish });
        await expect(publish).toBeVisible();
        await p.locator("form.nc-form input[type=text]").first().fill(L.title);
        await fillWallTime(p, wallOf(startMs));
        await p.locator('form.nc-form input[type=number][placeholder="15"]').fill("10");
        await publish.click();
        await expect(p.locator("[data-e2e=class-published]")).toBeVisible({ timeout: 20_000 });

        const rows = await sql<{ id: string; title: string; price_tnd: string; scheduled_at: Date; status: string; room_token: string; meet_url: string | null }[]>`
          select id, title, price_tnd, scheduled_at, status, room_token, meet_url from classes where tutor_id = ${tutor.id}`;
        expect(rows, "exactly one class, written by the form").toHaveLength(1);
        const k = rows[0];
        expect(k.title).toBe(L.title);
        expect(Number(k.price_tnd)).toBe(10);
        expect(new Date(k.scheduled_at).getTime(), "the wall time typed, in Tunis").toBe(startMs);
        expect(k.status).toBe("scheduled");
        expect(k.meet_url ?? "", "no own link: Tnajem's default room").toBe("");
        classId = k.id;
        token = k.room_token;
        expect(token).toBeTruthy();
      });

      await test.step("the prof's own class page: « C'est ta séance », never « Réserver » (A3)", async () => {
        await p.goto(`/${loc}/class/${classId}`);
        const panel = p.locator("[data-e2e=owner-panel]:visible");
        await expect(panel).toContainText(L.owner);
        await expect(panel.locator("[data-e2e=class-start]")).toHaveAttribute("href", `/${loc}/live/${classId}`);
        await expect(p.locator('a[href*="/checkout"]')).toHaveCount(0);
      });

      await test.step("2 · the student books it: class page → checkout → « Confirmer ma place »", async () => {
        await s.goto(`/${loc}/class/${classId}`);
        const book = s.getByRole("link", { name: L.book }).filter({ visible: true }).first();
        await expect(book).toBeVisible({ timeout: 20_000 });
        await expect(s.locator("main"), "the tutor's public name (E)").toContainText("Walid T.");
        await expect(s.locator("main")).not.toContainText("walid tester");
        await book.click();
        await expect(s).toHaveURL(new RegExp(`/${loc}/checkout\\?class=${classId}$`));

        const confirm = s.getByRole("button", { name: L.confirm });
        await expect(confirm).toBeVisible({ timeout: 20_000 });
        // C: said BEFORE confirming — the class is already inside 48 h.
        const note = s.locator("[data-e2e=late-cancel-note]");
        await expect(note).toHaveText(L.note);
        const [n, b] = await Promise.all([note.boundingBox(), confirm.boundingBox()]);
        expect(n!.y + n!.height, "the note comes before the button").toBeLessThanOrEqual(b!.y);
        await expect(s.locator("main")).toContainText("Walid T.");
        // F: the price in the brand face with tabular figures, never monospace.
        const font = await s.locator(".ck-pay-amount").evaluate((el) => {
          const cs = getComputedStyle(el);
          return { family: cs.fontFamily, numeric: cs.fontVariantNumeric };
        });
        expect(font.family).not.toMatch(/mono/i);
        expect(font.numeric).toContain("tabular-nums");

        await confirm.click();
        // G: back at the top, focus on the success heading.
        const title = s.locator("[data-e2e=checkout-success-title]");
        await expect(title).toHaveText(L.booked, { timeout: 20_000 });
        await expect(title).toBeFocused();
        await expect(title).toBeInViewport({ ratio: 1 });

        const [bk] = await sql<{ id: string; status: string; created_at: Date }[]>`
          select id, status, created_at from bookings where class_id = ${classId} and student_id = ${studentProfile.id}`;
        expect(bk.status).toBe("reserved");
        bookingId = bk.id;
        bookedAt = new Date(bk.created_at).getTime();
        const [k] = await sql<{ seats_taken: number }[]>`select seats_taken from classes where id = ${classId}`;
        expect(k.seats_taken).toBe(1);
      });

      await test.step("3a · the prof: Accueil › Prochaines séances — « Démarrer la séance » is one click to /live (A2)", async () => {
        await p.goto(`/${loc}/dashboard`);
        const row = p.locator(`[data-e2e=home-class-row][data-class-id="${classId}"]`);
        await expect(row.locator("[data-e2e=home-class-title]")).toHaveAttribute("href", `/${loc}/live/${classId}`);
        const start = row.locator("[data-e2e=class-start]");
        await expect(start).toHaveText(L.start);
        await start.click();
        await expect(p).toHaveURL(new RegExp(`/${loc}/live/${classId}$`));
        await expect(p.getByText(L.tutorNote)).toBeVisible();
      });

      await test.step("3b · the prof: Mes classes — « Démarrer la séance » (secondary, 30 h before) is one click to /live (A1)", async () => {
        await p.goto(`/${loc}/dashboard/classes`);
        const start = p.locator(`[data-e2e=class-row][data-class-id="${classId}"] [data-e2e=class-start]`);
        await expect(start).toHaveText(L.start);
        await expect(start, "before the 30-min window: the secondary button").toHaveAttribute("data-state", "soon");
        await expect(start).toHaveClass(/btn-outline/);
        expect(await start.evaluate((el) => el.tagName), "one link, nothing nested (H)").toBe("A");
        await start.click();
        await expect(p).toHaveURL(new RegExp(`/${loc}/live/${classId}$`));
      });

      await test.step("4a · the prof's lobby: the moderator line above the one « Entrer »; the room is absolute, titled, named", async () => {
        await expect(p.getByText(L.tutorNote)).toBeVisible();
        const note = p.locator("[data-e2e=live-moderator-note]");
        await expect(note).toHaveText(L.moderator);
        const join = p.getByRole("button", { name: L.enter });
        expect((await note.boundingBox())!.y, "the line is ABOVE the button (B3)").toBeLessThan((await join.boundingBox())!.y);
        await expect(p.getByRole("button", { name: L.videoTile }), "no duplicate video tile (B4)").toHaveCount(0);
        // B5: 30 h away → « Démarre le <jour> <mois> · HH:MM », never a bare « Démarre le ».
        const tag = p.locator(".tag.tag-neutral").first();
        await expect(tag).toHaveText(new RegExp(`^${L.startsAt}\\d{1,2} \\S+ · ${tunisClock(startMs)}$`));
        // E: the prof as their students see them.
        await expect(p.locator("main")).toContainText("Walid T.");
        await expect(p.locator("main")).not.toContainText("walid tester");

        profRoom = await enter(p, L.enter);
        expectRoom(profRoom, token, "prof");
        expect(setting(profRoom.url, "config.subject"), "the meeting is titled with the class (B2)").toBe(L.title);
        expect(setting(profRoom.url, "userInfo.displayName"), "the prof's public name").toBe("Walid T.");
      });

      await test.step("3c/4b · the student: « Rejoindre le direct » → the lobby; no moderator line; the same room under their first name", async () => {
        await s.goto(`/${loc}/student`);
        const join = s.getByRole("link", { name: L.join }).first();
        await expect(join).toBeVisible({ timeout: 20_000 });
        expect(await join.locator("a, button").count(), "one link, nothing inside it (H)").toBe(0);
        await join.click();
        await expect(s).toHaveURL(new RegExp(`/${loc}/live/${classId}$`));
        await expect(s.getByRole("button", { name: L.enter })).toBeVisible();
        await expect(s.locator("[data-e2e=live-moderator-note]"), "not for a student (B3)").toHaveCount(0);
        await expect(s.locator("main")).not.toContainText(L.moderator);
        await expect(s.getByRole("button", { name: L.videoTile })).toHaveCount(0);

        const room = await enter(s, L.enter);
        expectRoom(room, token, "student");
        expect(room.url.split("#")[0], "the prof and the student are sent to the same room").toBe(profRoom!.url.split("#")[0]);
        expect(setting(room.url, "config.subject")).toBe(L.title);
        expect(setting(room.url, "userInfo.displayName"), "the student's first name").toBe("Mehdi");
      });

      await test.step("5 · the student cancels within 15 min of booking: free, said before and after, nothing in the ledger", async () => {
        expect(Date.now() - bookedAt, "still inside the grace").toBeLessThan(CANCEL_GRACE_MINUTES * 60_000);
        await s.goto(`/${loc}/student`);
        // student-space-v1 · B: « Annuler ma place » is behind the next class's « ⋯ » menu now.
        await s.locator("[data-e2e=seat-menu]").first().click({ timeout: 20_000 });
        const cancel = s.getByRole("button", { name: L.cancel }).first();
        await expect(cancel).toBeVisible({ timeout: 20_000 });
        await cancel.click();
        const box = s.getByText(L.sure).locator("..");
        await expect(box).toBeVisible();
        const warning = norm(await box.innerText());
        expect(warning).toContain(L.grace(tunisClock(bookedAt + CANCEL_GRACE_MINUTES * 60_000)));
        expect(warning, "no 40 % of 10 TND").not.toContain(L.retained);
        await s.getByRole("button", { name: L.yes }).click();
        const flash = s.getByText(L.flash);
        await expect(flash).toBeVisible({ timeout: 20_000 });
        const said = norm(await flash.innerText());
        expect(said).toContain(L.graceDone);
        expect(said).not.toContain(L.retained);

        // The API's own record — what the ledger keeps for the prof.
        const [b] = await sql<{ status: string }[]>`select status from bookings where id = ${bookingId}`;
        expect(b.status).toBe("cancelled");
        const ledger = await sql<{ actor: string; retained_tnd: string; reason: string | null; late: boolean }[]>`
          select actor, retained_tnd, reason, late from cancellations where booking_id = ${bookingId}`;
        expect(ledger).toHaveLength(1);
        expect(ledger[0].actor).toBe("student");
        expect(ledger[0].late, "inside 48 h: without the grace this was the 40 % case").toBe(true);
        expect(Number(ledger[0].retained_tnd), "nothing retained").toBe(0);
        expect(ledger[0].reason).toBe("booking-grace");
        const [k] = await sql<{ seats_taken: number }[]>`select seats_taken from classes where id = ${classId}`;
        expect(k.seats_taken, "the seat is free again").toBe(0);
        // The prof is told — and not that it was a late cancellation.
        const told = await notificationTexts(tutorProfile.id, "booking_cancelled", loc);
        expect(told).toHaveLength(1);
        expect(told[0].body).toContain(L.title);
        expect(told[0].body, "the grace is not a late cancellation").not.toContain(L.lateNotice);

        // Access follows the booking: the lobby is closed to them now.
        await s.goto(`/${loc}/live/${classId}`);
        await expect(s.getByText(L.locked)).toBeVisible({ timeout: 20_000 });
      });

      expect([...prof.external, ...student.external].filter((u) => /meet\.jit\.si/i.test(u)), "nothing ever went to meet.jit.si").toEqual([]);
    } finally {
      await prof.ctx.close();
      await student.ctx.close();
    }
  });
}
