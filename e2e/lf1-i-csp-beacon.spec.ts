import { test, expect, type Page } from "@playwright/test";

/* live-fixes-1 · I — CLOUDFLARE'S BEACON RUNS; EVERY OTHER HOST IS STILL REFUSED.

   On tnajem.com, Cloudflare (which fronts the site) inserts its Web Analytics beacon
   right before </body> of every HTML page:
     <script type="module" src="https://static.cloudflareinsights.com/beacon.min.js/v…"
             integrity="…" data-cf-beacon='{…}' crossorigin="anonymous"></script>
   and the site's CSP refused it — "Refused to load the script …" on every page.

   The lane has no Cloudflare in front, so this spec does the injection itself: the
   page's own HTML is rewritten on the way in, its headers (the CSP among them) kept
   as served. The beacon is a stub from the real origin that reports to the endpoint
   the CSP allows — and also tries a script and a report on another host, which must
   be refused. Nothing leaves the machine: page.route answers every third-party URL.

   The exact header is pinned in e2e/security-headers.spec.ts; dev + prod and the
   /privacy disclosure in apps/api/test/lf1-csp.test.ts. */

const BEACON = "https://static.cloudflareinsights.com/beacon.min.js/ve2e";
const REPORT = "https://cloudflareinsights.com/cdn-cgi/rum";
const OTHER_SCRIPT = "https://scripts.example.net/tracker.js";
const OTHER_REPORT = "https://collect.example.net/rum";

/* What the stub "beacon" does once it runs: report where Cloudflare's does (the
   endpoint for a proxied site is this origin's /cdn-cgi/rum, else cloudflareinsights.com),
   then try a host the policy does not name. no-cors: an allowed request resolves
   (opaque), a CSP-refused one rejects — so the outcome is the CSP's, not CORS's. */
const STUB = `
  window.__beacon = "ran";
  const post = (url, key) => fetch(url, { method: "POST", body: "{}", mode: "no-cors" })
    .then(() => { window[key] = "sent"; }, () => { window[key] = "refused"; });
  post(${JSON.stringify(REPORT)}, "__report");
  post("/cdn-cgi/rum", "__sameOrigin");
  post(${JSON.stringify(OTHER_REPORT)}, "__other");
`;

type Hits = { beacon: number; report: number; other: number };

async function withInjectedBeacon(page: Page, path: string): Promise<{ hits: Hits; csp: string }> {
  const hits: Hits = { beacon: 0, report: 0, other: 0 };
  let csp = "";
  /* The live-review console line ("Refused to load the script …") is how Chrome prints a
     securitypolicyviolation event; Playwright does not see browser log lines, so the
     events themselves are recorded. */
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      (window as unknown as { __csp: string[] }).__csp.push(`${e.effectiveDirective} ${e.blockedURI}`));
  });

  const cors = { "access-control-allow-origin": "*" };
  await page.route("https://static.cloudflareinsights.com/**", (r) => {
    hits.beacon++;
    return r.fulfill({ status: 200, contentType: "text/javascript", headers: cors, body: STUB });
  });
  await page.route("https://cloudflareinsights.com/**", (r) => { hits.report++; return r.fulfill({ status: 204, headers: cors }); });
  // This origin's /cdn-cgi/rum (Cloudflare answers it at the edge; the lane has no edge).
  await page.route((url) => url.pathname === "/cdn-cgi/rum" && !url.hostname.endsWith("cloudflareinsights.com"), (r) =>
    r.fulfill({ status: 204 }));
  await page.route(/^https:\/\/[^/]*example\.net\//, (r) => { hits.other++; return r.fulfill({ status: 200, headers: cors, body: "" }); });

  // Cloudflare's injection, as tnajem.com serves it — into this page's own HTML, its headers kept.
  await page.route((url) => url.pathname === path, async (r) => {
    if (r.request().resourceType() !== "document") return r.fallback();
    const response = await r.fetch();
    const headers = { ...response.headers() };
    delete headers["content-encoding"]; // the body below is the decoded text
    delete headers["content-length"];
    csp = headers["content-security-policy"] ?? "";
    const html = (await response.text()).replace(
      "</body>",
      `<script type="module" src="${BEACON}" data-cf-beacon='{"token":"e2e"}' crossorigin="anonymous"></script>` +
        `<script src="${OTHER_SCRIPT}"></script></body>`,
    );
    return r.fulfill({ status: response.status(), headers, body: html });
  });

  await page.goto(path);
  return { hits, csp };
}

for (const path of ["/fr", "/ar"]) {
  test(`${path}: Cloudflare's beacon loads and reports, with no CSP error; another host is refused`, async ({ page }) => {
    const { hits, csp } = await withInjectedBeacon(page, path);
    expect(csp, "the page was served with its CSP (else nothing below would be tested)").toContain("script-src 'self'");

    const flag = (k: string) => page.evaluate((key) => (window as unknown as Record<string, string | undefined>)[key], k);
    await expect.poll(() => flag("__report"), { message: "the beacon's report reached cloudflareinsights.com" }).toBe("sent");
    await expect.poll(() => flag("__sameOrigin")).toBe("sent");
    await expect.poll(() => flag("__other"), { message: "a report to any other host is refused" }).toBe("refused");
    expect(await flag("__beacon"), "the beacon script executed").toBe("ran");
    expect(hits).toEqual({ beacon: 1, report: 1, other: 0 });

    const violations = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
    expect(violations.filter((v) => v.includes("cloudflareinsights")), "the live-review error: nothing of Cloudflare's is refused").toEqual([]);
    expect(violations.sort(), "and the other host is, script and report").toEqual([`connect-src ${OTHER_REPORT}`, `script-src-elem ${OTHER_SCRIPT}`]);
  });
}
