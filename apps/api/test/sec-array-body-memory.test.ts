import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startApp, stopApp, type App } from "./support/fx";

/* GHSA-mrhx-c7xc-m3w5. A Zod array schema collects one issue per bad element, with no
   cap: a 13 MB body of `[1,1,1,…]` takes gigabytes of heap and crashes the process.
   Upgrading to the « patched » zod 4.6.6 does NOT change that for safeParse (measured:
   4 MB → +1.45 GB): the fix is schema.validate(). These routes read their body BEFORE
   checking the session, so the attack needs no account.

   Any route that parses a body with z.array() goes through lib/parse-body. Add it here. */
const ROUTES: { url: string; field: string; base: Record<string, unknown> }[] = [
  { url: "/notifications/read", field: "ids", base: {} },
  { url: "/profile/student", field: "subjects", base: { fullName: "x" } },
  { url: "/tutors", field: "levels", base: {} },
  { url: "/centre-leads", field: "levels", base: {} }, // december-sprint · B (D13)
];

let app: App;
before(async () => { app = await startApp(); });
after(async () => { await stopApp(app); });

describe("a huge array of bad elements stays cheap", () => {
  for (const { url, field, base } of ROUTES) {
    test(`POST ${url}: refused with a 400, without allocating per element`, async () => {
      // 3 MB, well inside the 13 MB bodyLimit: over 700 MB of heap through a plain safeParse.
      const payload = JSON.stringify({ ...base, [field]: new Array(3 * 1024 * 512).fill(1) });
      global.gc?.();
      const before = process.memoryUsage().heapUsed;
      const res = await app.inject({ method: "POST", url, payload, headers: { "content-type": "application/json" } });
      const grownMb = (process.memoryUsage().heapUsed - before) / 1048576;
      assert.equal(res.statusCode, 400);
      assert.ok(grownMb < 300, `heap grew by ${Math.round(grownMb)} MB`);
    });
  }
});
