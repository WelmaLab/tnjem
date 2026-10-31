/* Shared colour maths + token parsing for the ui-audit harness.
   WCAG 2.1 relative luminance / contrast ratio, verbatim from the spec:
   https://www.w3.org/TR/WCAG21/#dfn-relative-luminance */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/* TWO roots, because the Step 1 monorepo move split them and this file silently
   kept answering the old question.

   ROOT was `<repo>` for both, so readTokens() defaulted to `<repo>/app/globals.css`
   — a path that stopped existing when the app moved to apps/web. `npm run ui:audit`
   died with ENOENT and `npm run brand:build` could not even resolve this module.
   Neither is covered by a gate, which is how both stayed broken.

   ROOT      the repository root — where the harness writes its own artefacts.
   WEB_ROOT  apps/web — what the harness actually AUDITS. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const WEB_ROOT = resolve(ROOT, "apps", "web");

/** Parse every `--name:#hex` / `--name:rgb(...)` declaration out of globals.css `:root{}`.
    home-v2 · A: EVERY `:root{}` block, not only the first. Later feature blocks
    (espace prof v2's frame sizes, home v2's band / doodle tokens) declare their tokens in
    their own appended `:root{}`; reading only the first made those invisible to the audit.
    The first declaration of a name wins, so the main table keeps its old meaning. */
export function readTokens(cssPath = resolve(WEB_ROOT, "app/globals.css")) {
  const css = readFileSync(cssPath, "utf8");
  const roots = [...css.matchAll(/:root\s*\{([^{}]*)\}/g)];
  if (!roots.length) throw new Error("could not find :root{} in " + cssPath);
  const tokens = {};
  for (const root of roots) {
    for (const m of root[1].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
      if (!(m[1] in tokens)) tokens[m[1]] = m[2].trim();
    }
  }
  return tokens;
}

/** #rgb | #rrggbb | rgb(r,g,b) → [r,g,b] 0-255. Throws on anything non-solid. */
export function toRgb(value) {
  const v = String(value).trim();
  if (/^#[0-9a-f]{3}$/i.test(v)) {
    return [1, 2, 3].map((i) => parseInt(v[i] + v[i], 16));
  }
  if (/^#[0-9a-f]{6}$/i.test(v)) {
    return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16));
  }
  const rgb = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  throw new Error(`not a solid colour: ${value}`);
}

const lin = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

export function luminance(value) {
  const [r, g, b] = toRgb(value);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.1 contrast ratio, 1..21. */
export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Composite a semi-transparent foreground over an opaque backdrop → solid rgb. */
export function over(fg, alpha, bg) {
  const f = toRgb(fg);
  const b = toRgb(bg);
  return `rgb(${f.map((c, i) => Math.round(c * alpha + b[i] * (1 - alpha))).join(",")})`;
}
