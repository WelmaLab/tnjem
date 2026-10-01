import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/* Espace prof v2 · Phase 3 — the social preview cards (apps/web/lib/og-card.tsx)
   carry colours BY VALUE, because Satori cannot resolve CSS custom properties.
   This keeps them honest: every value must equal its token in app/globals.css,
   the one place colours are defined (guardrail 4), so a palette change cannot
   leave the cards behind and contrast.mjs keeps covering what they render. */

const WEB = fileURLToPath(new URL("../../web/", import.meta.url));

const TOKEN_OF: Record<string, string> = {
  ink: "--ink", ink2: "--ink2", muted: "--muted", blue: "--blue", blue50: "--blue50",
  cream: "--cream", paper: "--paper", line: "--line", ochre: "--ochre",
  ochreTint: "--ochre-tint", ochreInk: "--ochre-ink", greenBtn: "--green-btn",
};

describe("P3 · OG card palette mirrors the design tokens", () => {
  test("every OG_PALETTE value equals its globals.css token", () => {
    const css = readFileSync(`${WEB}app/globals.css`, "utf8");
    const card = readFileSync(`${WEB}lib/og-card.tsx`, "utf8");
    const block = /OG_PALETTE = \{([\s\S]*?)\} as const/.exec(card)?.[1] ?? "";
    const entries = [...block.matchAll(/(\w+):\s*"(#[0-9A-Fa-f]{6})"/g)].map((m) => [m[1], m[2].toUpperCase()] as const);
    assert.ok(entries.length >= 10, "the palette block was found and parsed");
    for (const [key, value] of entries) {
      const token = TOKEN_OF[key];
      assert.ok(token, `${key} is mapped to a token`);
      const declared = new RegExp(`${token}:\\s*(#[0-9A-Fa-f]{6})\\b`).exec(css)?.[1]?.toUpperCase();
      assert.equal(value, declared, `${key} = ${value}, but ${token} = ${declared}`);
    }
  });
});
