import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { MONTHLY_PAYMENT_NOTE, PAYMENT_STORY, paymentStoryText } from "@tnajem/shared";
import { PAYMENT_STORY as FROM_PAYMENTS } from "@tnajem/shared/payments";

/* phase-a lane L3 (A22) — ONE payment story (decision D4).

   The web told four: pay the tutor "directement", "en main propre", "juste avant
   chaque séance — ou au mois", and "après"; Explore and the site description said
   a "paying in dinars" line; the tutor dashboard promised "Flouci et D17". D4: the
   student pays online, through Tnajem, before the session — and while payments
   are off that sentence only appears beside a visible "Bientôt" label.

   This is the part the API gate can run: the sentence, its gate, and a scan of
   the web's copy (comments stripped) for every contradicting story. The rendered
   proof — every public page, both locales — is e2e/payment-story.spec.ts. */

const WEB = fileURLToPath(new URL("../../web/", import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

/** Comments out, strings and JSX text in. `//` only when it starts a comment,
    so a URL inside a string survives. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")) // keep line numbers
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

/* Nothing is out of scope any more.
   • lib/i18n.ts was excluded while it was add-only for the lanes; its dead payment
     keys (checkout.noCharge, checkout.payPaid, dashboard.s3t/s3p) were deleted at
     merge and the payout labels no longer name a provider (phase-a/integrate), so
     the shared dictionary is scanned like every page.
   phase-a lane L6 (A19): /terms and /privacy are rewritten against the merged code
   and are scanned like every other page (their own proof: legal-truth.test.ts). */
const EXCLUDED: RegExp[] = [];

const CONTRADICTIONS: [RegExp, string][] = [
  [/en main propre/i, "cash in hand"],
  [/de la main à la main/i, "hand to hand"],
  [/(paies|payes|règles|réglez) (ton|le|ta) prof/i, "pay your tutor directly"],
  [/te paie(nt)? directement|te paie en main/i, "the student pays the tutor directly"],
  [/directement avec (ton prof|lui)/i, "settle directly with the tutor"],
  [/au mois, si tu préfères|ou au mois/i, "pay monthly"],
  [/après la séance|, après\.|règles directement avec ton prof, après/i, "pay after the session"],
  [/paie(ment)? en dinar/i, "paiement en dinar"],
  [/Paiement direct/i, "paiement direct"],
  [/konnect|clictopay|e-?dinar|flouci|\bD17\b/i, "a named payment provider"],
  [/يد بيد|في يدك|بالشهر(?! الفارط)|تخلّص أستاذك مباشرة|يخلّصك مباشرة|خلاص مباشر|فلوسي|خلّص بالدينار|الخلاص بالدينار/, "the same stories in Arabic"],
  [/pay the tutor|paid (by hand|in cash)|never pay Tnajem/i, "the same stories in English (llms.txt)"],
  // phase-a/verify-fix (D2): the /tarifs meta description (Google snippet, link preview) still said it.
  [/ne paie(nt)? jamais Tnajem|ما يخلّص حتى حاجة لـ Tnajem/i, "the student never pays Tnajem (contradicts D4)"],
];

/* espace prof v2 · growth (phase 5) — ONE allowed sentence, by coordinator decision:
   the monthly offer's note, the spec's own words (MONTHLY_PAYMENT_NOTE,
   packages/shared/src/offers.ts). It opens with "Paiement en ligne bientôt" — it
   says the D4 story is coming and what holds until then — and is rendered beside
   the "Bientôt" tag. EXACTLY these two strings are cut out of a line before it is
   scanned; any other "règles directement" phrasing, or this one with a word
   changed, is still a hit. Written out literally so that changing the constant
   breaks this file instead of silently widening the exception. */
const ALLOWED_SENTENCES = [
  "Paiement en ligne bientôt — pour l'instant tu règles directement avec ton prof.",
  "الخلاص أونلاين قريب — للوقت هذا تخلّص أستاذك مباشرة.",
] as const;

function contradictionsIn(line: string): string[] {
  let rest = line;
  for (const ok of ALLOWED_SENTENCES) rest = rest.split(ok).join(" ");
  return CONTRADICTIONS.filter(([re]) => re.test(rest)).map(([, why]) => why);
}

/* The rendered copy that lives in packages/shared (the growth surfaces' sentences:
   the offer note, the share messages, the e-mail preference labels). Not the whole
   package: payments.ts and types.ts name providers as CODE (the provider switch),
   which no page shows. */
const SHARED = fileURLToPath(new URL("../../../packages/shared/src/", import.meta.url));
const SHARED_COPY = ["offers.ts", "share-links.ts", "email-prefs.ts", "pricing.ts"];

describe("A22 · the one payment story", () => {
  test("the sentence, from the one source, reachable from payments.ts too", () => {
    assert.equal(PAYMENT_STORY.fr.student, "Tu paies en ligne, via Tnajem, avant la séance.");
    assert.equal(FROM_PAYMENTS, PAYMENT_STORY, "payments.ts re-exports the same object");
    assert.equal(PAYMENT_STORY.fr.soon, "Bientôt");
    assert.equal(PAYMENT_STORY.ar.soon, "قريب");
  });

  test("with payments OFF the sentence never stands alone", () => {
    assert.match(paymentStoryText("fr", "student", false), /^Bientôt : /);
    assert.match(paymentStoryText("ar", "student", false), /^قريب : /);
    assert.equal(paymentStoryText("fr", "student", true), PAYMENT_STORY.fr.student);
  });

  test("no web copy tells another payment story, or names a provider", () => {
    const hits: string[] = [];
    for (const file of walk(join(WEB, "app")).concat(walk(join(WEB, "components")), walk(join(WEB, "lib")))) {
      if (EXCLUDED.some((re) => re.test(file))) continue;
      const lines = stripComments(readFileSync(file, "utf8")).split("\n");
      lines.forEach((line, i) => {
        for (const why of contradictionsIn(line)) {
          hits.push(`${relative(WEB, file)}:${i + 1} (${why}) ${line.trim().slice(0, 110)}`);
        }
      });
    }
    assert.deepEqual(hits, [], `\n${hits.join("\n")}`);
  });

  test("growth · the shared copy files tell no other story either", () => {
    const hits: string[] = [];
    for (const name of SHARED_COPY) {
      stripComments(readFileSync(join(SHARED, name), "utf8")).split("\n").forEach((line, i) => {
        for (const why of contradictionsIn(line)) hits.push(`shared/${name}:${i + 1} (${why}) ${line.trim().slice(0, 110)}`);
      });
    }
    assert.deepEqual(hits, [], `\n${hits.join("\n")}`);
  });

  test("growth · the allow-list is exactly MONTHLY_PAYMENT_NOTE, and nothing near it", () => {
    assert.deepEqual([...ALLOWED_SENTENCES], [MONTHLY_PAYMENT_NOTE.fr, MONTHLY_PAYMENT_NOTE.ar]);
    // It is the "Bientôt" kind of sentence: online payment is named first, as coming.
    assert.match(MONTHLY_PAYMENT_NOTE.fr, /^Paiement en ligne bientôt — /);
    assert.match(MONTHLY_PAYMENT_NOTE.ar, /^الخلاص أونلاين قريب — /);
    // The sentence itself passes; the same words without it, or edited, do not.
    assert.deepEqual(contradictionsIn(`x ${MONTHLY_PAYMENT_NOTE.fr} y`), []);
    assert.deepEqual(contradictionsIn(MONTHLY_PAYMENT_NOTE.ar), []);
    assert.notDeepEqual(contradictionsIn("Pour l'instant tu règles directement avec ton prof."), []);
    assert.notDeepEqual(contradictionsIn("Paiement en ligne bientôt — pour l'instant tu règles directement avec ton prof, après."), []);
    assert.notDeepEqual(contradictionsIn(`${MONTHLY_PAYMENT_NOTE.fr} Tu règles directement avec lui.`), []);
    assert.notDeepEqual(contradictionsIn("للوقت هذا تخلّص أستاذك مباشرة."), []);
  });

  test("the dead payment keys left in lib/i18n.ts are rendered by nothing", () => {
    const users: string[] = [];
    for (const file of walk(join(WEB, "app")).concat(walk(join(WEB, "components")))) {
      const src = readFileSync(file, "utf8");
      if (/checkout\.(noCharge|payPaid)|dashboard\.(s3t|s3p)/.test(src)) users.push(relative(WEB, file));
    }
    assert.deepEqual(users, []);
  });
});
