import { test, expect } from "@playwright/test";
import { seedProfile } from "./support/seed";
import { mintSession } from "./support/session";

/* HEADERS (production readiness Stage 4). The web suite runs against a
   PRODUCTION build (standalone), so what is asserted here is what ships. */

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:4000";

test.describe("security: response headers", () => {
  for (const path of ["/fr", "/ar/explore", "/fr/unknown-slug-e2e-headers"]) {
    test(`a page (${path}) carries CSP, HSTS, nosniff, referrer and permissions policies`, async ({ request }) => {
      const res = await request.get(path, { maxRedirects: 0 });
      const h = res.headers();
      expect(h["content-security-policy"]).toContain("default-src 'self'");
      expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
      expect(h["content-security-policy"]).toContain("object-src 'none'");
      expect(h["strict-transport-security"]).toBe("max-age=63072000; includeSubDomains; preload");
      expect(h["x-content-type-options"]).toBe("nosniff");
      expect(h["x-frame-options"]).toBe("DENY");
      expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      expect(h["permissions-policy"]).toContain("camera=()");
      expect(h["x-powered-by"], "no framework advertisement").toBeUndefined();
    });
  }

  /* live-fixes-1 · I — THE SERVED POLICY, PINNED. Cloudflare fronts the site and injects
     its Web Analytics beacon; the CSP allows exactly its script origin and its report
     endpoint, and nothing else moved. Every directive and every source is held here (as
     served by this production build), so a new host fails this test and has to be added
     on purpose — together with its line on /privacy (apps/api/test/lf1-csp.test.ts).
     live-fixes-2 · D added one frame source, YouTube's no-cookie embed (the storefront
     video the policy had been refusing); e2e/lf2-d-material-csp.spec.ts plays it. */
  const PROD_CSP: Record<string, string[]> = {
    "default-src": ["'self'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "form-action": ["'self'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'", "data:"],
    "style-src": ["'self'", "'unsafe-inline'"],
    "script-src": ["'self'", "'unsafe-inline'", "https://static.cloudflareinsights.com"],
    "connect-src": ["'self'", "https://cloudflareinsights.com"],
    // live-fixes-2 · D: the storefront's YouTube embed (no-cookie), and nothing else framed.
    "frame-src": ["'self'", "https://www.youtube-nocookie.com"],
    "manifest-src": ["'self'"],
    "upgrade-insecure-requests": [],
  };
  const parseCsp = (csp: string) =>
    Object.fromEntries(
      csp.split(";").map((d) => d.trim()).filter(Boolean).map((d) => {
        const [name, ...sources] = d.split(/\s+/);
        return [name, sources.sort()];
      }),
    );
  const sorted = (p: Record<string, string[]>) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, [...v].sort()]));

  for (const path of ["/fr", "/ar/explore", "/fr/privacy", "/fr/unknown-slug-e2e-headers"]) {
    test(`${path}: the CSP is exactly the pinned policy, and its only hosts are Cloudflare's beacon and YouTube's embed`, async ({ request }) => {
      const csp = (await request.get(path, { maxRedirects: 0 })).headers()["content-security-policy"];
      expect(csp, "one CSP header, not two merged").not.toContain(",");
      const policy = parseCsp(csp);
      expect(policy).toEqual(sorted(PROD_CSP));
      const hosts = [...new Set(Object.values(policy).flat().filter((s) => !s.startsWith("'") && !/^[a-z][a-z0-9+.-]*:$/.test(s)))].sort();
      expect(hosts).toEqual(["https://cloudflareinsights.com", "https://static.cloudflareinsights.com", "https://www.youtube-nocookie.com"]);
      expect(policy["script-src"]).toContain("https://static.cloudflareinsights.com");
      expect(policy["connect-src"]).toContain("https://cloudflareinsights.com");
      expect(policy["script-src"], "YouTube is framed, never a script source").not.toContain("https://www.youtube-nocookie.com");
      expect(policy["script-src"], "prod never allows eval").not.toContain("'unsafe-eval'");
    });
  }

  test("the image optimizer is not reachable (GHSA-2xp9-vwfh-vxw4)", async ({ request }) => {
    const res = await request.get("/_next/image?url=%2Flogo.webp&w=128&q=75");
    expect(res.status()).toBe(404);
  });

  test("every API response refuses sniffing, framing, referrers and scripts", async () => {
    const res = await fetch(`${API}/health`);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("a response to a signed-in request is never cacheable; an anonymous one is left to its route", async () => {
    const me = await seedProfile({ role: "student" });
    const authed = await fetch(`${API}/me`, { headers: { cookie: `tnajem_session=${await mintSession(me.id)}` } });
    expect(authed.headers.get("cache-control")).toBe("private, no-store");

    const anonymous = await fetch(`${API}/health`);
    expect(anonymous.headers.get("cache-control")).not.toBe("private, no-store");
  });

  test("a 5xx never carries an internal message to the client", async () => {
    // A malformed multipart body reaches the upload route's parser and fails there.
    const me = await seedProfile({ role: "tutor", birthYear: 1985 });
    const res = await fetch(`${API}/verification`, {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x", cookie: `tnajem_session=${await mintSession(me.id)}` },
      body: "--x\r\nContent-Disposition: form-data; name=\"idFront\"; filename=\"a.png\"\r\n\r\nnot-closed",
    });
    const body = await res.text();
    if (res.status >= 500) expect(body).toContain('"message":"Internal Server Error"');
    expect(body).not.toMatch(/at \w+ \(|node_modules|postgres|select |insert /i);
  });
});
