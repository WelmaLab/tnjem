import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { seedProfile, seedTutor } from "./support/seed";
import { mintSession } from "./support/session";
import { contextAs } from "./support/journey";

/* live-fixes-2 · D — /api/material/:id is served with the API's policy.

   The web route is a pass-through (app/api/material/[id]/route.ts): it forwards the
   API's Content-Security-Policy. But a header named in next.config.mjs REPLACES the
   route handler's (Next 15/16), and the site-wide set named one — so every PDF and
   image a student opened carried the PAGE policy (inline scripts, Cloudflare's
   beacon) instead of the API's `default-src 'none'`. The material route is now
   excluded from the site-wide set the way the ID-scan route already was.

   What must not break with it, each proven in the browser:
     - a PDF still opens INLINE, in the browser's own viewer (not a download);
     - an image still displays, both inside our pages and opened on its own;
     - a YouTube material still plays: the storefront's no-cookie embed loads. That
       one had been refused by the PAGE policy all along (no frame-src, so
       default-src 'self' applied) — the video slot showed a broken frame; the page
       policy now names exactly youtube-nocookie in frame-src.

   Files go through the real upload (POST /materials: magic-byte sniffing, the
   object store), so what is served is what a tutor's upload produces. */

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:4000";
/* The API's policy for a material (apps/api/src/routes/materials.ts MATERIAL_FILE_CSP):
   its baseline plus the inline styles Chrome's image viewer lays its page out with. */
const MATERIAL_CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'";
// Every other API response (a refusal included): apps/api/src/server.ts, the onSend baseline.
const API_BASELINE = "default-src 'none'; frame-ancestors 'none'";
const YT_ID = "dQw4w9WgXcQ";
const EMBED = `https://www.youtube-nocookie.com/embed/${YT_ID}`;

/* The FULL Chromium for this file (Playwright's "chromium" channel, new headless) — the
   browser a student has. The default headless shell has no PDF viewer and downloads
   every PDF whatever the headers say, so it could not show the one thing this file
   must prove. `npx playwright install chromium` installs both (CI included). */
test.use({ channel: "chromium" });

const L = {
  fr: { open: "Ouvrir", watch: "Voir la vidéo" },
  ar: { open: "حلّ", watch: "شوف الفيديو" },
} as const;

async function upload(token: string, title: string, src: { file: Buffer; name: string; type: string } | { youtube: string }, visibility = "public") {
  const form = new FormData();
  form.set("title", title);
  form.set("visibility", visibility);
  if ("youtube" in src) form.set("youtubeUrl", src.youtube);
  else form.set("file", new Blob([new Uint8Array(src.file)], { type: src.type }), src.name);
  const res = await fetch(`${API}/materials`, { method: "POST", headers: { cookie: `tnajem_session=${token}` }, body: form });
  const body = (await res.json()) as { ok: boolean; id?: string; error?: string };
  expect(body.ok, body.error).toBe(true);
  return body.id!;
}

/** A verified tutor with a PDF, a 300×200 PNG, a students-only file and a YouTube video. */
async function scenario(browser: Browser) {
  const me = await seedProfile({ role: "tutor", birthYear: 1985 });
  const tutor = await seedTutor({ profileId: me.id, status: "verified" });
  const token = await mintSession(me.id);

  // Real files, made by the browser: a one-page PDF and a PNG of known size.
  const maker = await browser.newPage({ viewport: { width: 400, height: 300 } });
  await maker.setContent(`<h1 style="font:32px sans-serif">Fiche LF2 D</h1>
    <div id="img" style="width:300px;height:200px;background:#2a6f97"></div>`);
  const pdf = await maker.pdf({ format: "A6" });
  const png = await maker.locator("#img").screenshot();
  await maker.close();

  return {
    me,
    slug: tutor.slug,
    pdf: await upload(token, "LF2 D — Fiche PDF", { file: pdf, name: "fiche.pdf", type: "application/pdf" }),
    png: await upload(token, "LF2 D — Schéma", { file: png, name: "schema.png", type: "image/png" }),
    studentsOnly: await upload(token, "LF2 D — Corrigé", { file: png, name: "corrige.png", type: "image/png" }, "students"),
    video: await upload(token, "LF2 D — Vidéo", { youtube: `https://www.youtube.com/watch?v=${YT_ID}` }),
  };
}

/** Chrome prints a refused resource as a console error naming the policy. */
function cspErrors(ctx: BrowserContext): string[] {
  const out: string[] = [];
  ctx.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy/i.test(m.text())) out.push(m.text());
  });
  return out;
}

/** Click a link that opens in a new tab; resolve with that tab, recording any download it starts. */
async function openInNewTab(page: Page, click: () => Promise<void>): Promise<{ tab: Page; downloads: string[] }> {
  const downloads: string[] = [];
  const [tab] = await Promise.all([
    page.context().waitForEvent("page").then((p) => {
      p.on("download", (d) => downloads.push(d.suggestedFilename()));
      return p;
    }),
    click(),
  ]);
  await tab.waitForLoadState("load");
  return { tab, downloads };
}

const fileRow = (page: Page, title: string) => page.locator("li").filter({ hasText: title }).last();

test.describe("D · the header", () => {
  test("the material route serves the API's policy, byte for byte — not the page policy", async ({ browser, request }) => {
    const s = await scenario(browser);
    for (const id of [s.pdf, s.png]) {
      const api = await fetch(`${API}/materials/${id}/file`);
      const web = await request.get(`/api/material/${id}`);
      expect(web.status()).toBe(200);
      const csps = web.headersArray().filter((h) => h.name.toLowerCase() === "content-security-policy");
      expect(csps, "exactly one policy: the config adds none of its own").toHaveLength(1);
      expect(csps[0].value, "the web route passes the API's policy through").toBe(api.headers.get("content-security-policy"));
      expect(csps[0].value).toBe(MATERIAL_CSP);

      const h = web.headers();
      expect(h["content-disposition"], "inline: the browser shows it, it does not download it").toMatch(/^inline; filename="/);
      // The API's own, passed through — the site's would be strict-origin-when-cross-origin.
      expect(h["referrer-policy"]).toBe("no-referrer");
      expect(h["x-content-type-options"]).toBe("nosniff");
      expect(h["cache-control"]).toBe("private, no-store");
      // What the API does not send, the site still adds.
      expect(h["x-frame-options"]).toBe("DENY");
      expect(h["permissions-policy"]).toContain("camera=()");
      expect(h["strict-transport-security"]).toBe("max-age=63072000; includeSubDomains; preload");
    }

    // A refusal passes through the same way (it is the API's baseline: it renders nothing).
    const refused = await request.get(`/api/material/${s.studentsOnly}`);
    expect(refused.status()).toBe(403);
    expect(refused.headers()["content-security-policy"]).toBe(API_BASELINE);
    expect((await fetch(`${API}/materials/${s.studentsOnly}/file`)).headers.get("content-security-policy")).toBe(API_BASELINE);

    // ...and the pages around it keep the page policy.
    expect((await request.get(`/fr/${s.slug}`)).headers()["content-security-policy"]).toContain("script-src 'self'");
  });
});

test.describe("D · a PDF still opens inline", () => {
  test("from the storefront's « Ouvrir » and from the tutor's « Mes fiches », in the browser's PDF viewer", async ({ browser }) => {
    const s = await scenario(browser);
    const anonymous = await browser.newContext();
    const tutor = await contextAs(browser, s.me.id);

    for (const [ctx, path, link] of [
      [anonymous, `/fr/${s.slug}`, (p: Page) => fileRow(p, "LF2 D — Fiche PDF").getByRole("link", { name: L.fr.open })],
      [tutor, "/fr/dashboard/materials", (p: Page) => p.locator("[data-e2e=fiche-row]", { hasText: "LF2 D — Fiche PDF" }).locator("[data-e2e=fiche-source] a")],
    ] as const) {
      const errors = cspErrors(ctx);
      const page = await ctx.newPage();
      await page.goto(path, { waitUntil: "networkidle" });
      const { tab, downloads } = await openInNewTab(page, () => link(page).click());

      expect(downloads, "the PDF is shown, not downloaded").toEqual([]);
      expect(new URL(tab.url()).pathname).toBe(`/api/material/${s.pdf}`);
      expect(await tab.evaluate(() => document.contentType)).toBe("application/pdf");
      /* Chrome's viewer is an extension frame inside the tab; once it has parsed the
         file its toolbar knows the page count. One page: the PDF made above. */
      await expect
        .poll(async () => {
          const viewer = tab.frames().find((f) => f.url().startsWith("chrome-extension://"));
          if (!viewer) return "no viewer frame";
          return viewer
            .evaluate(() => {
              const shadow = (sel: string, root: Document | ShadowRoot | null | undefined) =>
                (root?.querySelector(sel) as (Element & { shadowRoot: ShadowRoot | null; docLength?: number }) | null);
              return shadow("viewer-toolbar", shadow("pdf-viewer", document)?.shadowRoot)?.docLength ?? "no page count yet";
            })
            .catch((e: Error) => e.message);
        }, { message: "Chrome's PDF viewer rendered the file", timeout: 15_000 })
        .toBe(1);
      expect(errors, "nothing refused by the policy").toEqual([]);
      await ctx.close();
    }
  });
});

test.describe("D · an image still displays", () => {
  test("inside our page (an <img>), and opened on its own from « Ouvrir », with no CSP error", async ({ browser }) => {
    const s = await scenario(browser);
    const ctx = await browser.newContext();
    const errors = cspErrors(ctx);
    const page = await ctx.newPage();
    await page.goto(`/fr/${s.slug}`, { waitUntil: "networkidle" });

    // As an <img> on one of our pages (img-src 'self').
    const width = await page.evaluate(async (src) => {
      const img = document.createElement("img");
      img.src = src;
      img.alt = "";
      document.body.append(img);
      await img.decode();
      return img.naturalWidth;
    }, `/api/material/${s.png}`);
    expect(width).toBe(300);

    // Opened in its own tab: the browser's image viewer, laid out as usual (centred).
    const { tab, downloads } = await openInNewTab(page, () => fileRow(page, "LF2 D — Schéma").getByRole("link", { name: L.fr.open }).click());
    expect(downloads).toEqual([]);
    expect(await tab.evaluate(() => document.contentType)).toBe("image/png");
    const shown = await tab.evaluate(() => {
      const img = document.querySelector("img")!;
      const r = img.getBoundingClientRect();
      return { natural: img.naturalWidth, complete: img.complete, offCentre: Math.abs(r.left - (innerWidth - r.width) / 2) };
    });
    expect(shown.complete && shown.natural).toBe(300);
    expect(shown.offCentre, "the viewer's own layout still applies").toBeLessThanOrEqual(1);
    expect(errors, "the viewer's inline styles are not refused").toEqual([]);
    await ctx.close();
  });
});

test.describe("D · the YouTube option still works", () => {
  for (const locale of ["fr", "ar"] as const) {
    test(`${locale}: « ${L[locale].watch} » loads the no-cookie embed, and the policy refuses nothing`, async ({ browser }) => {
      const s = await scenario(browser);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.addInitScript(() => {
        (window as unknown as { __csp: string[] }).__csp = [];
        document.addEventListener("securitypolicyviolation", (e) =>
          (window as unknown as { __csp: string[] }).__csp.push(`${e.effectiveDirective} ${e.blockedURI}`));
      });
      // Nothing leaves the machine: YouTube's player is a stub, answered here.
      let player = 0;
      await page.route("https://www.youtube-nocookie.com/**", (r) => {
        player++;
        return r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>player</title><p id=player>lecteur</p>" });
      });

      await page.goto(`/${locale}/${s.slug}`, { waitUntil: "networkidle" });
      expect(player, "no request to YouTube until someone asks for the video").toBe(0);
      const watch = fileRow(page, "LF2 D — Vidéo").getByRole("button", { name: L[locale].watch });
      await watch.click();
      await expect(watch).toHaveAttribute("aria-expanded", "true");

      const frame = page.locator(`iframe[src="${EMBED}"]`);
      await expect(frame).toBeVisible();
      await expect(frame.contentFrame().locator("#player"), "the embed loaded (it was a refused, broken frame)").toHaveText("lecteur");
      expect(player).toBe(1);
      expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);

      if (locale === "fr") {
        // The tutor's own « Mes fiches » row still links the same video, in a new tab.
        const tutor = await contextAs(browser, s.me.id);
        const dash = await tutor.newPage();
        await dash.goto("/fr/dashboard/materials", { waitUntil: "networkidle" });
        const link = dash.locator("[data-e2e=fiche-row]", { hasText: "LF2 D — Vidéo" }).locator("[data-e2e=fiche-source] a");
        await expect(link).toHaveAttribute("href", EMBED);
        await expect(link).toHaveAttribute("target", "_blank");
        await tutor.close();
      }
      await ctx.close();
    });
  }
});
