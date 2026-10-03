import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

/* live-fixes-1 · I — THE SITE'S CONTENT-SECURITY-POLICY, PINNED, DEV AND PROD.

   Cloudflare fronts tnajem.com and injects its Web Analytics beacon into every
   HTML page; the CSP refused it, one console error per page. The fix allows it
   by exact origin (script + report endpoint) and nothing else. This file holds
   the policy apps/web/next.config.mjs builds — every directive, every source, in
   both modes — so a new origin, a dropped directive or a dev-only grant leaking
   into prod fails HERE, and has to be made on purpose. e2e/security-headers.spec.ts
   pins the header a production build actually serves; e2e/lf1-i-csp-beacon.spec.ts
   proves a browser runs the beacon and still refuses any other host.

   The config is evaluated in a child process per mode (NODE_ENV decides the
   policy when the module loads), exactly as Next loads it: import, call headers().

   Truth rule: a third party the CSP lets run must be disclosed on /privacy, FR and
   AR. The last block reads the page source and holds the two together. */

const WEB = fileURLToPath(new URL("../../web/", import.meta.url));
const CONFIG = pathToFileURL(`${WEB}next.config.mjs`).href;
const PRIVACY = `${WEB}app/[locale]/privacy/page.tsx`;

type Header = { key: string; value: string };
type Rule = { source: string; headers: Header[] };

function rulesUnder(nodeEnv: "production" | "development"): Rule[] {
  const probe = `import(${JSON.stringify(CONFIG)}).then(async (m) => console.log(JSON.stringify(await m.default.headers())))`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", probe], {
    env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", NODE_ENV: nodeEnv },
    encoding: "utf8",
    cwd: WEB,
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split("\n").pop()!) as Rule[];
}

/** directive → its sources, sorted (the order of sources carries no meaning). */
function parse(csp: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const part of csp.split(";").map((s) => s.trim()).filter(Boolean)) {
    const [name, ...sources] = part.split(/\s+/);
    assert.ok(!(name in out), `directive ${name} appears twice`);
    out[name] = sources.sort();
  }
  return out;
}

/** Everything that names a host: not a keyword ('self'…), not a bare scheme (data:, ws:…). */
const hostsOf = (policy: Record<string, string[]>) =>
  [...new Set(Object.values(policy).flat().filter((s) => !s.startsWith("'") && !/^[a-z][a-z0-9+.-]*:$/.test(s)))].sort();

const CF_SCRIPT = "https://static.cloudflareinsights.com";
const CF_REPORT = "https://cloudflareinsights.com";
// live-fixes-2 · D: the storefront's one embed (youTubeEmbedUrl, packages/shared/src/uploads.ts).
const YT_EMBED = "https://www.youtube-nocookie.com";

/* THE POLICY. Changing a line here is the decision; the config follows it. */
const PROD: Record<string, string[]> = {
  "default-src": ["'self'"],
  "base-uri": ["'self'"],
  "object-src": ["'none'"],
  "frame-ancestors": ["'none'"],
  "form-action": ["'self'"],
  "img-src": ["'self'", "blob:", "data:"],
  "font-src": ["'self'", "data:"],
  "style-src": ["'self'", "'unsafe-inline'"],
  "script-src": ["'self'", "'unsafe-inline'", CF_SCRIPT],
  "connect-src": ["'self'", CF_REPORT],
  "frame-src": ["'self'", YT_EMBED],
  "manifest-src": ["'self'"],
  "upgrade-insecure-requests": [],
};
/* Dev differs by exactly what HMR needs — eval and its websocket — and never upgrades
   requests (it runs over plain http). Same third parties as prod, no more. */
const DEV: Record<string, string[]> = {
  ...PROD,
  "script-src": [...PROD["script-src"], "'unsafe-eval'"],
  "connect-src": [...PROD["connect-src"], "ws:", "wss:"],
};
delete DEV["upgrade-insecure-requests"];
for (const p of [PROD, DEV]) for (const k of Object.keys(p)) p[k] = [...p[k]].sort();

/* The ONLY hosts the site lets a page load code from, talk to or frame, and who they
   are — as /privacy names them in French and in Arabic. */
const THIRD_PARTIES: Record<string, { fr: string; ar: string }> = {
  [CF_SCRIPT]: { fr: "Cloudflare Web Analytics", ar: "Cloudflare Web Analytics" },
  [CF_REPORT]: { fr: "Cloudflare Web Analytics", ar: "Cloudflare Web Analytics" },
  [YT_EMBED]: { fr: "YouTube", ar: "يوتيوب" },
};

const cspOf = (rule: Rule | undefined) => rule?.headers.find((h) => h.key === "Content-Security-Policy")?.value;

describe("live-fixes-1 · I — the CSP allows Cloudflare's beacon and nothing else", () => {
  const prod = rulesUnder("production");
  const dev = rulesUnder("development");
  const siteWide = (rules: Rule[]) => rules.find((r) => r.source === "/:path((?!api/admin/doc/|api/material/).*)");

  test("production: every directive and every source is exactly the pinned policy", () => {
    const csp = cspOf(siteWide(prod));
    assert.ok(csp, "the site-wide rule carries a CSP");
    assert.deepEqual(parse(csp), PROD);
  });

  test("development: the same policy plus only HMR's eval and websocket, no upgrade", () => {
    const csp = cspOf(siteWide(dev));
    assert.ok(csp, "dev sends a CSP too");
    assert.deepEqual(parse(csp), DEV);
  });

  test("the two Cloudflare origins and YouTube's no-cookie embed are the only hosts, each in its one directive", () => {
    for (const rules of [prod, dev]) {
      const policy = parse(cspOf(siteWide(rules))!);
      assert.deepEqual(hostsOf(policy), Object.keys(THIRD_PARTIES).sort());
      assert.ok(policy["script-src"].includes(CF_SCRIPT) && !policy["connect-src"].includes(CF_SCRIPT), "the CDN serves the script, it is not an endpoint");
      assert.ok(policy["connect-src"].includes(CF_REPORT) && !policy["script-src"].includes(CF_REPORT), "the report endpoint serves no script");
      for (const d of Object.keys(policy).filter((k) => k !== "frame-src")) {
        assert.ok(!policy[d].includes(YT_EMBED), `YouTube may be framed, nothing more (${d})`);
      }
      for (const d of ["default-src", "img-src", "font-src", "style-src", "frame-ancestors", "form-action"]) {
        assert.equal(hostsOf({ [d]: policy[d] }).length, 0, `${d} stays first-party`);
      }
    }
  });

  test("the ID-scan viewer still gets NO page CSP from the config (it keeps the API's sandbox)", () => {
    for (const rules of [prod, dev]) {
      const doc = rules.find((r) => r.source === "/api/admin/doc/:id");
      assert.ok(doc, "the ID-scan rule exists");
      assert.equal(cspOf(doc), undefined);
      assert.equal(rules.length, 3, "three rules: the site, the ID-scan route and the material route");
    }
  });

  /* live-fixes-2 · D — a material keeps the API's policy, the same way. A header the
     config names REPLACES the route handler's (Next 15/16), so the page CSP used to
     land on every PDF and image a student opened. */
  test("the material route gets NO CSP, referrer or nosniff from the config: the API's pass through", () => {
    const fromApi = ["Content-Security-Policy", "Referrer-Policy", "X-Content-Type-Options"];
    for (const rules of [prod, dev]) {
      const site = siteWide(rules);
      assert.ok(site, "the site-wide rule keeps its exact source, which excludes both file routes");
      const material = rules.find((r) => r.source === "/api/material/:id");
      assert.ok(material, "the material rule exists");
      const keys = material.headers.map((h) => h.key);
      for (const h of fromApi) assert.ok(!keys.includes(h), `${h} comes from the API, never from the config`);
      // Everything else the site sends, the file gets too (framing, permissions, HSTS in prod).
      assert.deepEqual(keys.sort(), site.headers.map((h) => h.key).filter((k) => !fromApi.includes(k)).sort());
      assert.deepEqual(material.headers, rules.find((r) => r.source === "/api/admin/doc/:id")!.headers, "the same set as the ID-scan route");
    }
  });
});

/* ── Truth rule: what the CSP lets run, /privacy names ─────────────────────────── */

/** Comments out, strings in (as apps/api/test/legal-truth.test.ts reads the page). */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

describe("live-fixes-1 · I — /privacy discloses every third party the CSP allows", () => {
  const copy = stripComments(readFileSync(PRIVACY, "utf8"));
  const at = copy.search(/\n {2}ar: \{/);
  const fr = copy.slice(0, at);
  const ar = copy.slice(at);

  test("each allowed host has a named vendor, and the page names it in French and in Arabic", () => {
    assert.ok(at > 0, "the page keeps its { fr, ar } copy object");
    const hosts = hostsOf(parse(cspOf(rulesUnder("production").find((r) => r.source.startsWith("/:path")))!));
    for (const host of hosts) {
      const vendor = THIRD_PARTIES[host];
      assert.ok(vendor, `${host} is allowed by the CSP but has no vendor here — name it, and disclose it on /privacy`);
      assert.ok(fr.includes(vendor.fr), `/fr/privacy does not name ${vendor.fr}`);
      assert.ok(ar.includes(vendor.ar), `/ar/privacy does not name ${vendor.ar}`);
    }
  });

  test("the sentence that stopped being true is gone, and the measurement is described", () => {
    assert.ok(!fr.includes("pas de mesure d'audience tierce"), "fr still denies third-party audience measurement");
    assert.ok(!ar.includes("ما فمّاش قياس جمهور خارجي"), "ar still denies third-party audience measurement");
    assert.ok(fr.includes("9. Cookies et mesure d'audience"), "fr §9 heading");
    assert.ok(ar.includes("9. الكوكيز وقياس الزيارات"), "ar §9 heading");
    assert.ok(fr.includes("et Cloudflare, par qui passent les échanges entre ton navigateur et le site"), "fr §4 sub-processors");
    assert.ok(ar.includes("و Cloudflare، اللي يتعدّى منها كل شيء بين المتصفّح متاعك والموقع"), "ar §4 sub-processors");
    assert.ok(fr.includes("jamais qui a visité quoi"), "fr: only totals are seen");
    assert.ok(ar.includes("عمرنا ما نشوفو شكون زار شنوّة"), "ar: only totals are seen");
  });
});
