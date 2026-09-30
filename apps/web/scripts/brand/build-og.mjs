#!/usr/bin/env node
/* NOTE: the social preview card used to read "1ère séance offerte" in the
   subtitle AND in two chips, one per locale. That claim became a per-tutor
   opt-in in Step 6, and a claim baked into a PNG cannot be made conditional —
   which is exactly why it had to come out rather than be gated. Replaced with
   hand verification, which is true of every tutor who is public.
   REGENERATE public/og.png after editing this file: `npm run brand:build`
   (needs Python for the raster step). The committed PNG is what social
   platforms actually read; editing this file alone changes nothing. */
/* Build public/og.png — the WhatsApp / Twitter / Facebook link preview.
 *
 *     node scripts/brand/build-og.mjs
 *
 * WHY A BROWSER AND NOT AN IMAGE LIBRARY
 *   The card carries Arabic ("تنجّم", "الحصة الأولى مجانية"). Pillow cannot shape
 *   Arabic on this machine (libraqm is absent), so it would render the letters
 *   unjoined and in the wrong order — visibly broken to every Arabic reader.
 *   Chromium shapes it correctly for free. Playwright is already a devDependency
 *   from the UI-audit harness, so this adds nothing.
 *
 * WHY IT MATTERS MORE THAN A NORMAL OG IMAGE
 *   Tutors distribute this product by pasting their link into WhatsApp groups.
 *   This card IS the landing experience for most first-time visitors.
 *
 * The palette is read from app/globals.css rather than retyped, so the card
 * cannot drift from the design system.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// The harness moved to tools/ui-audit in Step 1; WEB_ROOT is apps/web.
import { readTokens, WEB_ROOT as ROOT } from "../../../../tools/ui-audit/lib-color.mjs";

const T = readTokens();
const OUT = resolve(ROOT, "public/og.png");

/* Inlined as a data URI: the page is loaded with setContent (no server), so a
   relative /logo.png would not resolve. */
const logo = readFileSync(resolve(ROOT, "public/logo.png")).toString("base64");

const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700&family=Space+Grotesk:wght@600;700&family=IBM+Plex+Sans+Arabic:wght@500;600&display=swap">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{
    width:1200px;height:630px;overflow:hidden;position:relative;
    background:
      radial-gradient(900px 520px at 8% -10%, #FFF4E0 0%, transparent 55%),
      radial-gradient(760px 620px at 108% 4%, #E6EFFA 0%, transparent 50%),
      ${T.cream};
    font-family:"Plus Jakarta Sans","Segoe UI",system-ui,sans-serif;
    color:${T.ink};
    padding:74px 78px;
    display:flex;flex-direction:column;justify-content:space-between;
  }
  /* the zellige lattice the app uses on its hero surfaces, at low opacity */
  body::before{
    content:"";position:absolute;inset:0;opacity:.055;
    background-image:conic-gradient(from 45deg at 14px 14px,
      transparent 0 25%, ${T.ink} 0 26%, transparent 0 50%, ${T.ink} 0 51%, transparent 0);
    background-size:56px 56px;
  }
  .row{position:relative;display:flex;align-items:center;gap:22px}
  .row img{width:118px;height:82px;display:block}
  .word{font-family:"Space Grotesk","Segoe UI",sans-serif;font-weight:700;font-size:46px;letter-spacing:-1.4px}
  .word .ar{font-family:"IBM Plex Sans Arabic","Segoe UI",sans-serif;font-weight:600;color:${T.blue};letter-spacing:0;margin-inline-start:12px;font-size:40px}
  /* 62px keeps "Reserve, apprends, reussis." on ONE line at 1044px of usable
     width; at 70px it wrapped to three and the card lost its hierarchy. */
  h1{position:relative;font-family:"Space Grotesk","Segoe UI",sans-serif;font-weight:700;
     font-size:62px;line-height:1.08;letter-spacing:-2.2px;max-width:22ch}
  h1 em{font-style:normal;color:${T.blue}}
  p.sub{position:relative;font-size:25px;color:${T.ink2};margin-top:20px}
  .chips{position:relative;display:flex;align-items:center;gap:14px}
  .chip{font-size:20px;font-weight:700;padding:11px 22px;border-radius:999px;white-space:nowrap}
  .c-free{background:${T["green-btn"]};color:#fff}
  .c-ar{background:${T["ochre-btn"]};color:#fff;font-family:"IBM Plex Sans Arabic","Segoe UI",sans-serif;font-weight:600}
  .c-url{background:${T.paper};color:${T.ink2};border:1px solid ${T.line}}
  .bar{position:absolute;inset-inline:0;bottom:0;height:12px;background:${T.ochre}}
</style></head><body>
  <div class="row">
    <img src="data:image/png;base64,${logo}" alt="">
    <span class="word">Tnajem <span class="ar">تنجّم</span></span>
  </div>
  <div>
    <h1>Ton prof, en direct.<br><em>Réserve, apprends, réussis.</em></h1>
    <p class="sub">Profs tunisiens vérifiés un par un · du primaire au Bac · cours en direct</p>
  </div>
  <div class="chips">
    <span class="chip c-free">Profs vérifiés</span>
    <span class="chip c-ar">أساتذة متثبّت منهم</span>
    <span class="chip c-url">tnajem.com</span>
  </div>
  <div class="bar"></div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "domcontentloaded" });
/* Fonts come over the network; without this the card can screenshot mid-swap
   and ship with a system fallback. Falls through after 6s rather than hanging,
   because a slightly-off card beats no card. */
await page.evaluate(() => document.fonts.ready).catch(() => {});
await page.waitForTimeout(1200);
await page.screenshot({ path: OUT });
await browser.close();

const { statSync } = await import("node:fs");
console.log(`  ${(statSync(OUT).size / 1024).toFixed(1)} kB  public/og.png`);
