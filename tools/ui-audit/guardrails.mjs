#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════════
   guardrails.mjs — the properties this codebase already got RIGHT, asserted so
   they stay right.

   A prior audit verified these by hand. Hand-verification does not survive the
   next pass, so each one is a test now:

     1. RTL          zero physical left/right CSS. The whole Arabic layout works
                     because every rule is logical (margin-inline-start,
                     inset-inline, text-align:start). One `margin-left` is all it
                     takes to break the mirror on one screen and nowhere else.
     2. FR/AR parity every page-local `copy = { fr, ar }` object must have the
                     SAME key set in both locales. A key present in fr and
                     missing in ar renders `undefined` to an Arabic reader.
     3. Literal copy no user-visible French string hardcoded in JSX or in
                     aria-label / placeholder / title. Those attributes are the
                     usual leak: they are invisible in review and monolingual to
                     a screen reader.
     4. Tokens       no raw hex outside globals.css. Every colour is a token, so
                     contrast.mjs can actually see all of them.
     7. Controls     no native <select>, and every <input type=file> visually
                     hidden behind its own labelled control (live-fixes-2 · C).

   Exit code 1 on any violation.
   ══════════════════════════════════════════════════════════════════════════════ */

import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { readdirSync, statSync } from "node:fs";
import { ROOT, WEB_ROOT } from "./lib-color.mjs";

/* ── file walk ─────────────────────────────────────────────────────────────── */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === ".next" || name === "shots") continue;
      walk(p, out);
    } else if (/\.(tsx?|css)$/.test(name)) out.push(p);
  }
  return out;
}
// The SOURCE being audited lives in apps/web, not at the repo root (Step 1).
const FILES = [join(WEB_ROOT, "app"), join(WEB_ROOT, "components")].flatMap((d) => walk(d));
const rel = (p) => relative(ROOT, p).replace(/\\/g, "/");
/** The one file where raw hex is correct: it is where the tokens are declared. */
const TOKENS_FILE = join(WEB_ROOT, "app", "globals.css");

let fails = 0;
const section = (title) => console.log(`\n  ── ${title} ──`);
const fail = (msg) => {
  fails++;
  console.log(`  FAIL  ${msg}`);
};

console.log("\nGuardrails — properties that must not regress\n");

/* ── 1. physical CSS properties ────────────────────────────────────────────── */
section("1. RTL: logical properties only");
/* `left`/`right` as a POSITIONING offset or a margin/padding/border side, and
   text-align:left|right. Deliberately not matched: `right` inside a word
   (bright, copyright), background-position keywords, and transform-origin,
   which has no logical equivalent and is handled per-direction where used. */
const PHYSICAL = [
  /(?:^|[;{\s"'`])(margin|padding|border)-(left|right)\s*:/i,
  /(?:^|[;{\s"'`])(left|right)\s*:\s*(?!auto\b)[-\d.]/i,
  /text-align\s*:\s*(left|right)\b/i,
  /\b(marginLeft|marginRight|paddingLeft|paddingRight|borderLeft|borderRight)\s*:/,
  /textAlign\s*:\s*["'](left|right)["']/,
  /\bclass(?:Name)?="[^"]*\b(ml|mr|pl|pr)-(?!inline)[\w.[\]]+/,
  /\bclass(?:Name)?="[^"]*\btext-(left|right)\b/,
];
/* Strip comments across the WHOLE file before testing. These files are heavily
   commented, and several comments explain the very physical property they
   replaced ("Centred via inset-inline instead of left:50%") — a rule about the
   code must not fire on prose about the code. Newlines are preserved so the
   reported line numbers still point at real source lines. */
function stripComments(src) {
  let out = "";
  let i = 0;
  let str = null;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (str) {
      out += ch;
      if (ch === "\\") { out += next ?? ""; i += 2; continue; }
      if (ch === str) str = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { str = ch; out += ch; i++; continue; }
    if (ch === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      const block = src.slice(i, end === -1 ? src.length : end + 2);
      out += block.replace(/[^\n]/g, " ");
      i += block.length;
      continue;
    }
    if (ch === "/" && next === "/") {
      const end = src.indexOf("\n", i);
      i = end === -1 ? src.length : end;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

let physicalHits = 0;
for (const f of FILES) {
  const src = stripComments(readFileSync(f, "utf8"));
  src.split("\n").forEach((line, i) => {
    // transform-origin: left|right IS direction-aware at its call sites (the
    // pour-les-profs split bar sets it per dir) — not a physical-property leak.
    if (/transform-origin/.test(line)) return;
    if (!line.trim()) return;
    for (const re of PHYSICAL) {
      if (re.test(line)) {
        physicalHits++;
        fail(`${rel(f)}:${i + 1}  ${line.trim().slice(0, 96)}`);
        return;
      }
    }
  });
}
if (!physicalHits) console.log("  ok    0 physical left/right declarations in app/ or components/");

/* ── 2. FR/AR key parity ───────────────────────────────────────────────────── */
section("2. FR/AR key parity in page-local copy objects");

/** Top-level keys of the object literal starting at `open` (index of its `{`). */
function keysOf(src, open) {
  const keys = [];
  let depth = 0;
  let i = open;
  let str = null;
  let atKeyPos = true;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (str) {
      if (ch === "\\") { i++; continue; }
      if (ch === str) str = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { str = ch; continue; }
    if (ch === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i) + 1; continue; }
    if (ch === "/" && src[i + 1] === "/") { i = src.indexOf("\n", i); continue; }
    if (ch === "{" || ch === "[" || ch === "(") { depth++; if (depth === 1) atKeyPos = true; continue; }
    if (ch === "}" || ch === "]" || ch === ")") { depth--; if (depth === 0) break; continue; }
    if (depth === 1) {
      if (ch === ",") { atKeyPos = true; continue; }
      if (atKeyPos && /[A-Za-z_$]/.test(ch)) {
        const m = /^([A-Za-z_$][\w$]*)\s*:/.exec(src.slice(i));
        if (m) keys.push(m[1]);
        atKeyPos = false;
      }
    }
  }
  return { keys, end: i };
}

let objs = 0;
let parityKeys = 0;
/* Copy that is rendered OUTSIDE the web app is held to the same rule: the
   notification catalog (packages/shared, rendered by the API for the bell, e-mails
   and SMS) and the API's e-mail copy. An Arabic reader of an e-mail meets a missing
   key exactly as they would on a page. */
const PARITY_EXTRA = [join(ROOT, "packages", "shared", "src"), join(ROOT, "apps", "api", "src")].flatMap((d) => walk(d));
for (const f of [...FILES, ...PARITY_EXTRA].filter((p) => /\.tsx?$/.test(p))) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/\bfr\s*:\s*\{/g)) {
    const frOpen = m.index + m[0].length - 1;
    const fr = keysOf(src, frOpen);
    // the ar block must follow within the same parent object
    const after = src.slice(fr.end, fr.end + 400);
    const am = /\bar\s*:\s*\{/.exec(after);
    if (!am) continue;
    const arOpen = fr.end + am.index + am[0].length - 1;
    const ar = keysOf(src, arOpen);
    objs++;
    parityKeys += fr.keys.length;
    const missingAr = fr.keys.filter((k) => !ar.keys.includes(k));
    const missingFr = ar.keys.filter((k) => !fr.keys.includes(k));
    const line = src.slice(0, m.index).split("\n").length;
    if (missingAr.length) fail(`${rel(f)}:${line}  missing in ar: ${missingAr.join(", ")}`);
    if (missingFr.length) fail(`${rel(f)}:${line}  missing in fr: ${missingFr.join(", ")}`);
  }
}
console.log(`  ok    ${objs} bilingual copy objects, ${parityKeys} keys per locale, key sets identical`);

/* ── 3. hardcoded user-visible French ──────────────────────────────────────── */
section("3. No hardcoded French in JSX or a11y attributes");
const FRENCH = /[àâçéèêëîïôûùüœ]|\b(le|la|les|des|une|pour|avec|ton|ta|tes|vous|nous|sur|dans|est|sans)\b/i;
let literalHits = 0;
for (const f of FILES.filter((p) => p.endsWith(".tsx"))) {
  const src = readFileSync(f, "utf8");
  src.split("\n").forEach((line, i) => {
    // A literal (non-{expression}) value on an attribute a user or screen
    // reader will actually receive.
    const attr = /\b(aria-label|placeholder|title|alt|aria-description)\s*=\s*"([^"]{3,})"/.exec(line);
    if (attr && FRENCH.test(attr[2])) {
      literalHits++;
      fail(`${rel(f)}:${i + 1}  ${attr[1]}="${attr[2].slice(0, 60)}"`);
    }
  });
}
if (!literalHits) console.log("  ok    0 hardcoded French aria-label / placeholder / title / alt values");

/* ── 4. colour tokens ──────────────────────────────────────────────────────── */
section("4. Colours come from tokens");
const HEX = /#[0-9a-f]{3}(?:[0-9a-f]{3})?\b/gi;
/* #fff / #ffffff on a token background is the one literal the system keeps —
   it is not a brand colour, it is "the label on a dark fill", and contrast.mjs
   checks every such pair explicitly. */
const ALLOWED = /^#(fff|ffffff|000|000000)$/i;
/* Next serialises viewport.themeColor into a <meta> tag at build time, where a
   CSS custom property cannot be resolved. Genuine exception, and the only one. */
const ALLOWED_LINE = /themeColor/;
let hexHits = 0;
for (const f of FILES) {
  /* globals.css is the TOKEN SOURCE — raw hex is what belongs there, and nowhere
     else. This was `rel(f) === "app/globals.css"`, a bare string compare against
     a repo-relative path; the Step 1 move made rel() return
     "apps/web/app/globals.css" and the exclusion silently stopped matching,
     turning the token definitions themselves into 43 failures. Comparing
     RESOLVED PATHS instead means the layout can move again without this lying. */
  if (f === TOKENS_FILE) continue;
  const src = stripComments(readFileSync(f, "utf8"));
  src.split("\n").forEach((line, i) => {
    if (ALLOWED_LINE.test(line)) return;
    for (const h of line.match(HEX) || []) {
      if (ALLOWED.test(h)) continue;
      hexHits++;
      fail(`${rel(f)}:${i + 1}  ${h}  ${line.trim().slice(0, 70)}`);
    }
  });
}
if (!hexHits) console.log(`  ok    0 raw hex colours outside ${rel(TOKENS_FILE)}`);

/* -- 5. every declared button/chip variant survives the production purge ----- */
section("variant classes survive the Tailwind purge");
{
  const cssDir = join(WEB_ROOT, ".next", "static", "css");
  let built = "";
  try {
    for (const f of readdirSync(cssDir)) {
      if (f.endsWith(".css")) built += readFileSync(join(cssDir, f), "utf8");
    }
  } catch {
    /* Left empty on purpose: the failure is reported below, once. */
  }
  if (!built) {
    /* A gate that cannot check is not a pass. In dev Tailwind purges nothing, so
       this question is only answerable against a PRODUCTION build. */
    fail("no production stylesheet under apps/web/.next/static/css - run `npm run build -w @tnajem/web` first");
  } else {
    const tokens = readFileSync(TOKENS_FILE, "utf8");
    /* Only the two families whose class name is assembled at runtime in
       components/ui.tsx. Scoped deliberately: a broader sweep would turn genuinely
       dead CSS into a build failure, which is a different and much weaker claim. */
    const declared = [...new Set(
      [...tokens.matchAll(/^\s*\.((?:btn|chip)-[a-z0-9-]+)\s*\{/gm)].map((m) => m[1]),
    )];
    const missing = declared.filter((c) => !new RegExp("\." + c + "[{,:\s]").test(built));
    if (missing.length) {
      for (const c of missing) {
        fail("." + c + " is declared in " + rel(TOKENS_FILE) + " but PURGED from the built CSS - write the class name as a literal (see BTN_VARIANT / CHIP_KIND in components/ui.tsx)");
      }
    } else {
      console.log("  ok    " + declared.length + " btn/chip variant(s) present in the shipped stylesheet");
    }
  }
}


/* -- 6. no demo fixture reaches a production build ---------------------------- */
section("6. no demo fixture text in the production build");
{
  /* The fixtures describe tutors who do not exist. Gating the calls on demoEnabled
     kept them off the page but not out of the bundle — the 15 Sept production build
     shipped them in the /explore client chunk — so next.config.mjs now swaps
     lib/demo-fixtures.ts for an empty stub. This proves the swap still happens.

     Needles come from the fixture file itself, so a renamed tutor is still caught —
     each searched raw AND in the minifier's escaped spellings ("Int\xe9grales"),
     and only literals that appear in no other source file (an "ex. Yassine
     Khelifi" placeholder is not a fixture). A check with fewer than 3 needles
     fails rather than passing on nothing. */
  const NEXT_DIR = join(WEB_ROOT, ".next");
  const fixturesFile = join(WEB_ROOT, "lib", "demo-fixtures.ts");
  const fixtures = readFileSync(fixturesFile, "utf8");
  const others = [join(WEB_ROOT, "app"), join(WEB_ROOT, "components"), join(WEB_ROOT, "lib")]
    .flatMap((d) => walk(d))
    .filter((p) => !/demo-fixtures/.test(p))
    .map((p) => readFileSync(p, "utf8"))
    .join("\n");
  const needles = [
    ...new Set(
      [...fixtures.matchAll(/\b(?:slug|full_name|tutor_name|title|subject|bio|description|meet_url):\s*"([^"]{6,})"/g)]
        .map((m) => m[1])
        .filter((s) => !others.includes(s)),
    ),
  ];
  const hex2 = (c) => c.charCodeAt(0).toString(16).padStart(2, "0");
  const hex4 = (c) => c.charCodeAt(0).toString(16).padStart(4, "0");
  /** The spellings a minifier may emit for one literal: raw; Latin-1 as \xNN; everything as \x/\u. */
  const spellings = (s) => [...new Set([
    s,
    s.replace(/[\x80-\xff]/g, (c) => "\\x" + hex2(c)),
    s.replace(/[\x80-\xff]/g, (c) => "\\x" + hex2(c)).replace(/[^\x00-\xff]/g, (c) => "\\u" + hex4(c)),
  ])];
  let builtId = "";
  try { builtId = readFileSync(join(NEXT_DIR, "BUILD_ID"), "utf8").trim(); } catch { /* reported below */ }
  if (!builtId) {
    fail("no production build under apps/web/.next (no BUILD_ID) - run `npm run build -w @tnajem/web` first");
  } else if (needles.length < 3) {
    fail(`only ${needles.length} usable needle(s) extracted from ${rel(fixturesFile)} - the check would prove nothing`);
  } else {
    const js = (dir, out = []) => {
      let entries = [];
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
      for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== "cache" && e.name !== "standalone") js(p, out); }
        else if (/\.(js|html|rsc|body|json)$/.test(e.name)) out.push(p);
      }
      return out;
    };
    const built = [...js(join(NEXT_DIR, "static")), ...js(join(NEXT_DIR, "server"))];
    let hits = 0;
    for (const f of built) {
      const text = readFileSync(f, "utf8");
      for (const n of needles) {
        if (spellings(n).some((v) => text.includes(v))) {
          hits++;
          fail(`fixture text "${n}" found in ${rel(f)} - lib/demo-fixtures.ts reached a production build`);
        }
      }
    }
    if (!hits) console.log(`  ok    ${needles.length} fixture needle(s) absent from ${built.length} built file(s)`);
  }
}

/* ── 7. no native <select>, no visible file input ─────────────────────────── */
section("7. No native <select>; a file input is always visually hidden");
/* live-fixes-2 · C. The browser's own <select> list and « Choose File / No file
   chosen » render in the SYSTEM's language and style (English on most machines,
   whatever the page says). Every choice is components/app/Select.tsx; every upload
   is a labelled zone or button whose real <input type=file> is .sr-only (FileDrop,
   the verification cards, the profile photo) — still what the keyboard, a screen
   reader and the phone's picker use. This reads the source; its runtime twin, on
   every route in FR and AR, is e2e/lf2-c-native-controls.spec.ts. */
let nativeHits = 0;
let fileInputs = 0;
for (const f of FILES.filter((p) => p.endsWith(".tsx"))) {
  const src = stripComments(readFileSync(f, "utf8"));
  const lineOf = (i) => src.slice(0, i).split("\n").length;
  for (const m of src.matchAll(/<select[\s>]/g)) {
    nativeHits++;
    fail(`${rel(f)}:${lineOf(m.index)}  a native <select> — use <Select> (components/app/Select.tsx)`);
  }
  for (const m of src.matchAll(/<input\b/g)) {
    // An <input> is void: in JSX it always ends with "/>", which ends its attributes.
    const end = src.indexOf("/>", m.index);
    const tag = src.slice(m.index, end === -1 ? undefined : end);
    if (!/\btype\s*=\s*(?:"file"|'file'|\{\s*["']file["']\s*\})/.test(tag)) continue;
    fileInputs++;
    if (!/\bsr-only\b/.test(tag)) {
      nativeHits++;
      fail(`${rel(f)}:${lineOf(m.index)}  a file input that is not .sr-only — hide it behind a labelled zone (FileDrop)`);
    }
  }
}
if (!nativeHits) console.log(`  ok    0 native <select>; ${fileInputs} file input(s), every one .sr-only behind its own control`);

/* ── 8. prices in the figure face, never --fd or a monospace ─────────────────── */
section("8. Prices: the figure face (--fn), never --fd or a monospace");
/* live-fixes-3 · F. LIVE_FIXES_1 C1: a price is set in --fn (the brand's text face —
   the Arabic face in Arabic) with tabular figures. --fd is Space Grotesk, whose figures
   come from Space Mono: « 0 TND » read as a monospace font on /checkout a whole run
   after C1, because .ck-pay-amount sat in a `.ck-h1,.ck-pay-amount{font-family:var(--fd)}`
   group. Two source rules:
     a. no monospace anywhere (`monospace`, `ui-monospace`, Tailwind `font-mono`);
     b. no CSS rule whose selector names a price (.…price…, .…amount…, .…amt…) sets
        font-family to --fd.
   Its runtime twin, which also sees prices whose class says nothing (a <b> in a row, a
   Tailwind span), is e2e/lf3-f-price-font.spec.ts. */
const PRICE_SELECTOR = /\.[a-z0-9_-]*(price|amount|amt)[a-z0-9_-]*/i;
let priceHits = 0;
let priceRules = 0;
for (const f of FILES) {
  /* stripComments keeps what sits inside a string — the CSS of a <style> template —
     so the CSS comments are removed here as well: prose about monospace is not code. */
  const src = stripComments(readFileSync(f, "utf8")).replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const lineOf = (i) => src.slice(0, i).split("\n").length;
  for (const m of src.matchAll(/\bui-monospace\b|\bmonospace\b|\bfont-mono\b/g)) {
    priceHits++;
    fail(`${rel(f)}:${lineOf(m.index)}  « ${m[0]} » — prices and figures use --fn with tabular-nums (C1)`);
  }
  for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, segment, body] = m;
    // In a .tsx the text before a <style> template's first rule ends at its backtick.
    const selectors = segment.slice(segment.lastIndexOf("`") + 1).replace(/\s+/g, " ").trim();
    if (!PRICE_SELECTOR.test(selectors) || !/font-family\s*:/.test(body)) continue;
    priceRules++;
    if (/font-family\s*:[^;]*var\(--fd\)/.test(body)) {
      priceHits++;
      fail(`${rel(f)}:${lineOf(m.index + segment.length)}  ${selectors.slice(0, 60)} sets a price in --fd — use var(--fn) + tabular-nums`);
    }
  }
}
if (!priceHits) console.log(`  ok    0 monospace; ${priceRules} price rule(s) with a font-family, none in --fd`);

console.log(`\n  ${fails} guardrail violation(s)\n`);
if (fails) process.exit(1);
console.log("  OK — RTL logical-only, FR/AR parity exact, no hardcoded French, no untokenised colour, no native select.\n");
