import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { profileJsonLd, personJsonLd, courseJsonLd, bookablePrices } from "@tnajem/shared";

/* espace prof v2 · pro (P7) — JSON-LD builders for /[slug] and /class/[id].

   The truth rules, asserted on the builders the pages render: no rating without
   real reviews, no Review objects, prices only from bookable classes (never a "0"
   for a free first session), no markup for a cancelled class, the public name. */

const NOW = Date.parse("2026-10-01T10:00:00.000Z");
const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

const profile = {
  siteUrl: "https://tnajem.com/",
  locale: "fr" as const,
  slug: "mohamed-math",
  name: "Mohamed B.",
  subject: "Maths",
  bio: "Prof de maths depuis 8 ans.",
  imageUrl: null,
  reviews: { count: 0, average: 0 },
  students: 3,
  classes: [
    { starts_at: iso(NOW + 48 * H), status: "scheduled" as const, price_tnd: 30 },
    { starts_at: iso(NOW + 72 * H), status: "scheduled" as const, price_tnd: 45 },
    { starts_at: iso(NOW - 2 * H), status: "scheduled" as const, price_tnd: 5 }, // started: not an offer
    { starts_at: iso(NOW + 24 * H), status: "cancelled" as const, price_tnd: 1 }, // cancelled: not an offer
  ],
  now: NOW,
};

const byType = (list: Record<string, unknown>[], t: string) => list.find((o) => o["@type"] === t) as Record<string, any>;

describe("ep2 · JSON-LD — tutor profile", () => {
  test("Person, Service and BreadcrumbList; URLs are locale-prefixed and the site has no double slash", () => {
    const out = profileJsonLd(profile);
    assert.deepEqual(out.map((o) => o["@type"]), ["Person", "Service", "BreadcrumbList"]);
    const person = byType(out, "Person");
    assert.equal(person.url, "https://tnajem.com/fr/mohamed-math");
    assert.equal(person.name, "Mohamed B.");
  });

  test("NO rating without real reviews, and never a Review object", () => {
    const json = JSON.stringify(profileJsonLd(profile));
    assert.equal(json.includes("AggregateRating"), false);
    assert.equal(json.includes('"Review"'), false);
    assert.equal(json.includes('"review"'), false);
  });

  test("a real rating when real reviews exist", () => {
    const person = personJsonLd({ ...profile, reviews: { count: 4, average: 4.5 } });
    assert.deepEqual(person.aggregateRating, {
      "@type": "AggregateRating", ratingValue: 4.5, reviewCount: 4, bestRating: 5, worstRating: 1,
    });
  });

  test("prices come only from classes on sale", () => {
    assert.deepEqual(bookablePrices(profile), [30, 45]);
    const service = byType(profileJsonLd(profile), "Service");
    assert.deepEqual(service.offers, { "@type": "AggregateOffer", priceCurrency: "TND", lowPrice: "30", highPrice: "45", offerCount: 2 });
  });

  test("no offer at all when nothing is on sale", () => {
    const service = byType(profileJsonLd({ ...profile, classes: [] }), "Service");
    assert.equal("offers" in service, false);
  });

  test("a promotion quote (C6) is what the markup says", () => {
    assert.deepEqual(bookablePrices({ ...profile, quotedPrice: (c) => c.price_tnd - 5 }), [25, 40]);
  });

  test("a photo only when one is given", () => {
    assert.equal("image" in personJsonLd(profile), false);
    assert.equal(personJsonLd({ ...profile, imageUrl: "https://tnajem.com/api/avatar/mohamed-math/md" }).image, "https://tnajem.com/api/avatar/mohamed-math/md");
  });

  test("Arabic breadcrumbs on the Arabic page", () => {
    const crumbs = byType(profileJsonLd({ ...profile, locale: "ar" }), "BreadcrumbList");
    assert.equal(crumbs.itemListElement[0].name, "الرئيسية");
    assert.equal(crumbs.itemListElement[2].item, "https://tnajem.com/ar/mohamed-math");
  });
});

describe("ep2 · JSON-LD — class page", () => {
  const cls = {
    siteUrl: "https://tnajem.com",
    locale: "fr" as const,
    classId: "c1",
    title: "Bac — fonctions",
    description: "",
    startsAt: iso(NOW + 48 * H),
    durationMin: 90,
    status: "scheduled" as const,
    priceTnd: 30,
    seatsLeft: 4,
    tutor: { name: "Mohamed B.", slug: "mohamed-math" },
    now: NOW,
  };

  test("Course with an online CourseInstance, start and end, the instructor's public page", () => {
    const c = courseJsonLd(cls) as Record<string, any>;
    assert.equal(c["@type"], "Course");
    assert.equal(c.description, "Bac — fonctions"); // empty description → the title, never invented text
    assert.equal(c.hasCourseInstance["@type"], "CourseInstance");
    assert.equal(c.hasCourseInstance.courseMode, "online");
    assert.equal(c.hasCourseInstance.startDate, iso(NOW + 48 * H));
    assert.equal(c.hasCourseInstance.endDate, iso(NOW + 48 * H + 90 * 60_000));
    assert.equal(c.hasCourseInstance.instructor.url, "https://tnajem.com/fr/mohamed-math");
    assert.equal(c.offers.price, "30");
    assert.equal(c.offers.availability, "https://schema.org/InStock");
  });

  test("no Course markup for a cancelled class", () => {
    assert.equal(courseJsonLd({ ...cls, status: "cancelled" }), null);
  });

  test("a full class is SoldOut; a past class has no offer", () => {
    assert.equal((courseJsonLd({ ...cls, seatsLeft: 0 }) as any).offers.availability, "https://schema.org/SoldOut");
    assert.equal("offers" in (courseJsonLd({ ...cls, startsAt: iso(NOW - H) }) as object), false);
  });

  test("never a rating or a review on a class", () => {
    const json = JSON.stringify(courseJsonLd(cls));
    assert.equal(/AggregateRating|"Review"|"review"/.test(json), false);
  });

  test("the offer is the class price, never 0 for a free-first class", () => {
    // The free first session is per student and per tutor; the class still costs its price.
    assert.equal((courseJsonLd({ ...cls, priceTnd: 30 }) as any).offers.price, "30");
    assert.equal((courseJsonLd({ ...cls, priceTnd: 0 }) as any).offers.category, "Free");
  });
});
