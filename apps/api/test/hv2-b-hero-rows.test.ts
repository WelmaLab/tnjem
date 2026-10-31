import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { HomeTutor } from "@tnajem/shared";
import { heroRows, exploreHref, type HeroRow } from "../../web/components/home/hero-rows";

/* home v2 · B — the hero card's rows, from fixtures (no database, no browser).

   heroRows() is everything the card SAYS; HeroTutorsCard.tsx only lays it out. So
   the card with 0, 1 and 3 tutors, « no rating below 3 reviews » and « no invented
   number » are proved here exactly, whatever else the shared e2e database holds.
   e2e/home-v2-hero.spec.ts proves the live page renders what the API returns. */

const tutor = (over: Partial<HomeTutor> = {}): HomeTutor => ({
  slug: "mohamed-b",
  name: "Mohamed B.",
  initials: "MB",
  subject: { code: "math", fr: "Maths", ar: "رياضيات" },
  levels: ["bac"],
  avatar_url: null,
  price: null,
  ...over,
});

const subjectRows = (rows: HeroRow[]) => rows.filter((r) => r.kind === "subject");
const tutorRows = (rows: HeroRow[]) => rows.filter((r): r is Extract<HeroRow, { kind: "tutor" }> => r.kind === "tutor");

describe("home v2 · B — the hero card's rows", () => {
  test("0 tutors → today's three neutral rows, each a filtered /explore link, no figure at all", () => {
    const rows = heroRows([], "fr");
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((r) => r.kind), ["subject", "subject", "subject"]);
    assert.deepEqual(rows.map((r) => r.title), ["Prof de Maths", "Prof de Physique", "Prof de Français"]);
    assert.deepEqual(rows.map((r) => r.meta), ["Bac · en ligne", "Lycée · en ligne", "Primaire · en ligne"]);
    assert.deepEqual(rows.map((r) => r.href), [
      "/explore?subject=maths&level=bac",
      "/explore?subject=physique&level=secondaire",
      "/explore?subject=francais&level=primaire",
    ]);
    for (const r of rows) {
      assert.equal(r.kind === "subject" && r.cta, "Voir les profs");
      assert.doesNotMatch(`${r.title} ${r.meta} ${r.kind === "subject" ? r.cta : ""}`, /\d/, "a neutral row carries no number");
      assert.equal("price" in r, false);
      assert.equal("rating" in r, false);
    }
  });

  test("1 tutor → the tutor first, then two neutral rows — never the tutor's subject twice", () => {
    const rows = heroRows([tutor()], "fr");
    assert.deepEqual(rows.map((r) => r.kind), ["tutor", "subject", "subject"]);
    const [t] = tutorRows(rows);
    assert.equal(t.href, "/mohamed-b");
    assert.equal(t.title, "Prof de Maths");
    assert.equal(t.meta, "Bac · en ligne");
    assert.deepEqual(subjectRows(rows).map((r) => r.title), ["Prof de Physique", "Prof de Français"]);
  });

  test("3 tutors → three tutor rows, no neutral row; a 4th is ignored", () => {
    const four = ["a", "b", "c", "d"].map((s) => tutor({ slug: s }));
    const rows = heroRows(four, "fr");
    assert.deepEqual(rows.map((r) => r.kind), ["tutor", "tutor", "tutor"]);
    assert.deepEqual(rows.map((r) => r.href), ["/a", "/b", "/c"]);
  });

  test("a neutral subject a real tutor already covers is skipped — the card still has 3 rows", () => {
    const rows = heroRows(
      [tutor({ slug: "p", subject: { code: "physique", fr: "Physique", ar: "فيزياء" } }), tutor({ slug: "f", subject: { code: "francais", fr: "Français", ar: "فرنسية" } })],
      "fr",
    );
    assert.deepEqual(subjectRows(rows).map((r) => r.title), ["Prof de Maths"]);
    const rows2 = heroRows([tutor({ slug: "m" }), tutor({ slug: "p", subject: { code: "physique", fr: "Physique", ar: "فيزياء" } })], "fr");
    assert.deepEqual(subjectRows(rows2).map((r) => r.title), ["Prof de Français"]);
  });

  test(`no rating below 3 reviews — even if one slipped into the payload`, () => {
    const two = tutorRows(heroRows([tutor({ reviews: { average: 5, count: 2 } })], "fr"))[0];
    assert.equal(two.rating, null);
    const none = tutorRows(heroRows([tutor()], "fr"))[0];
    assert.equal(none.rating, null);
    const three = tutorRows(heroRows([tutor({ reviews: { average: 4.333, count: 3 } })], "fr"))[0];
    assert.deepEqual(three.rating, { value: "4,3", count: "(3 avis)" });
  });

  test("a price only when the payload has one, with its own unit", () => {
    assert.equal(tutorRows(heroRows([tutor()], "fr"))[0].price, null);
    assert.equal(tutorRows(heroRows([tutor({ price: { tnd: 0, per: "session" } })], "fr"))[0].price, null, "0 is not a price");
    assert.deepEqual(tutorRows(heroRows([tutor({ price: { tnd: 25, per: "session" } })], "fr"))[0].price, { amount: "25", currency: "TND", unit: "/ séance" });
    assert.deepEqual(tutorRows(heroRows([tutor({ price: { tnd: 120, per: "month" } })], "fr"))[0].price, { amount: "120", currency: "TND", unit: "/ mois" });
    assert.deepEqual(tutorRows(heroRows([tutor({ price: { tnd: 22.5, per: "session" } })], "fr"))[0].price?.amount, "22,5");
  });

  test("the photo only from the payload (the API sends it only when approved) — else initials", () => {
    const withPhoto = tutorRows(heroRows([tutor({ avatar_url: "/api/avatar/mohamed-b/md" })], "fr"))[0];
    assert.equal(withPhoto.avatarUrl, "/api/avatar/mohamed-b/md");
    const without = tutorRows(heroRows([tutor()], "fr"))[0];
    assert.equal(without.avatarUrl, null);
    assert.equal(without.initials, "MB");
  });

  test("levels: none → « en ligne » alone · two → both · three+ → the range", () => {
    assert.equal(tutorRows(heroRows([tutor({ levels: [] })], "fr"))[0].meta, "en ligne");
    assert.equal(tutorRows(heroRows([tutor({ levels: ["college", "bac"] })], "fr"))[0].meta, "Collège · Bac · en ligne");
    assert.equal(tutorRows(heroRows([tutor({ levels: ["college", "secondaire", "bac"] })], "fr"))[0].meta, "Collège–Bac · en ligne");
  });

  test("French elision: « Prof d'Anglais », « Prof d'Histoire-Géo »", () => {
    const en = tutorRows(heroRows([tutor({ subject: { code: "anglais", fr: "Anglais", ar: "إنقليزية" } })], "fr"))[0];
    assert.equal(en.title, "Prof d'Anglais");
    const hg = tutorRows(heroRows([tutor({ subject: { code: "histoire-geo", fr: "Histoire-Géo", ar: "تاريخ وجغرافيا" } })], "fr"))[0];
    assert.equal(hg.title, "Prof d'Histoire-Géo");
  });

  test("a free-text subject is shown as typed, without « Prof de »", () => {
    const r = tutorRows(heroRows([tutor({ subject: { code: null, fr: "Soutien en algorithmique", ar: "Soutien en algorithmique" } })], "fr"))[0];
    assert.equal(r.title, "Soutien en algorithmique");
  });

  test("Arabic: the same rows in Derija, the same links", () => {
    const rows = heroRows([tutor({ price: { tnd: 25, per: "session" }, reviews: { average: 4.5, count: 4 } })], "ar");
    const [t] = tutorRows(rows);
    assert.equal(t.title, "أستاذ رياضيات");
    assert.equal(t.meta, "باك · أونلاين");
    assert.deepEqual(t.price, { amount: "25", currency: "د.ت", unit: "للحصة" });
    assert.equal(t.rating?.count, "(4 تقييم)");
    assert.deepEqual(subjectRows(rows).map((r) => [r.title, r.meta, r.kind === "subject" && r.cta]), [
      ["أستاذ فيزياء", "ثانوي · أونلاين", "شوف الأساتذة"],
      ["أستاذ فرنسية", "ابتدائي · أونلاين", "شوف الأساتذة"],
    ]);
    assert.deepEqual(rows.map((r) => r.href), heroRows([tutor()], "fr").map((r) => r.href));
  });

  test("exploreHref: the /explore chip slugs, and no subject filter for a subject without a chip", () => {
    assert.equal(exploreHref("math", "bac"), "/explore?subject=maths&level=bac");
    assert.equal(exploreHref("philosophie"), "/explore?subject=philo");
    assert.equal(exploreHref("informatique"), "/explore");
    assert.equal(exploreHref(null, "college"), "/explore?level=college");
  });
});
