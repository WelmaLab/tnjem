import { and, eq, classes } from "@tnajem/db";
import { onSaleClassSql } from "./class-sale";

/* december-sprint · E (D18) — UNLISTED CLASSES (classes.unlisted, 0045).

   An unlisted class is bookable by whoever holds its link or its QR code — a centre
   hands both to its own pupils — and is OFFERED nowhere: not on the storefront's
   class list or its JSON-LD, not in Explore's aggregates (the « à partir de » price,
   the promotion price), not on the home card, not in the follow digest, not in a
   student's « Cette semaine » / « Mes profs » suggestions. GET /classes/:id, booking
   and everything that follows a booking (agenda, live room, reviews, reminders) do
   not read this flag: holding the link is the whole access rule.

   One constant, so every public list says "listed" the same way. */
export const listedClassSql = eq(classes.unlisted, false);

/** On sale (class-sale.ts) AND listed: what a public list may offer. */
export const listedOnSaleClassSql = and(onSaleClassSql, listedClassSql);
