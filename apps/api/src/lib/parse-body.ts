import type { z } from "zod";

/* A body parse whose cost a bad array cannot blow up (GHSA-mrhx-c7xc-m3w5).

   safeParse() collects one issue per bad array element, with no cap, so a 13 MB body of
   `[1,1,1,…]` takes gigabytes of heap and crashes the process. The « patched » zod 4.6.6
   does not change that: its fix is schema.validate(), which stops at the first bad
   element. validate() answers a boolean, so a body that passes is then parsed for its
   output, and that second pass has no issues to collect.

   Any route that parses a body containing z.array() goes through here, and is listed in
   apps/api/test/sec-array-body-memory.test.ts. */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.ZodSafeParseResult<z.output<S>> | { success: false } {
  return schema.validate(body) ? schema.safeParse(body) : { success: false };
}
