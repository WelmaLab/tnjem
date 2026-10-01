-- 0035 — promotions, 20 % maximum (Espace prof v2 · Phase 5 B).
--
-- THE CAP IS ENFORCED IN THREE PLACES, on purpose (spec P5.B.2): this CHECK, the
-- Zod schema (packages/shared/src/growth-input.ts) and the ONE price calculation
-- (packages/shared/src/pricing.ts, contract C6). A raw INSERT of 25 % fails here
-- whatever the code above it does.
--
--   code      optional. NULL = a PUBLIC promotion, shown to everyone on cards,
--             the profile and class pages. A code makes it PRIVATE: it applies
--             only through /{slug}?promo=CODE. Uppercase A–Z 0–9 and "-", unique
--             per tutor.
--   scope     all | class | pack | monthly, with target_id naming the one class,
--             pack or offer (target_id may stay NULL for monthly = every offer).
--   uses      incremented ATOMICALLY when a booking or a subscription request
--             takes the discount (UPDATE … WHERE uses < max_uses), given back when
--             that booking or request is cancelled. The CHECK keeps it in range.
--   ended_at  ending is terminal and audited (admin_actions, "promotion.end");
--             pausing is `active = false` and reversible.
--
-- NO STACKING: only the best single promotion applies — pricing.ts decides that,
-- and a booking records the one it used.
--
-- THE PRICE SHOWN IS KEPT, so online payment can plug in later: bookings get
-- price_tnd (what the student was shown, after the promotion) and promotion_id;
-- student_subscriptions get promotion_id (price_tnd is in 0034).
--
-- IDEMPOTENT throughout. Additive only.

BEGIN;

CREATE TABLE IF NOT EXISTS "promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tutor_id" uuid NOT NULL,
	"code" text,
	"percent" integer NOT NULL,
	"scope" text DEFAULT 'all' NOT NULL,
	"target_id" uuid,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"max_uses" integer,
	"uses" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
 ALTER TABLE "promotions" ADD CONSTRAINT "promotions_tutor_id_tutors_id_fk"
   FOREIGN KEY ("tutor_id") REFERENCES "public"."tutors"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
 ALTER TABLE "promotions" ADD CONSTRAINT "promotions_percent_1_20" CHECK ("percent" BETWEEN 1 AND 20);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
 ALTER TABLE "promotions" ADD CONSTRAINT "promotions_scope_known" CHECK ("scope" IN ('all', 'class', 'pack', 'monthly'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
 ALTER TABLE "promotions" ADD CONSTRAINT "promotions_scope_target"
   CHECK (("scope" = 'all' AND "target_id" IS NULL) OR ("scope" IN ('class', 'pack') AND "target_id" IS NOT NULL) OR "scope" = 'monthly');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
 ALTER TABLE "promotions" ADD CONSTRAINT "promotions_window" CHECK ("ends_at" > "starts_at");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
 ALTER TABLE "promotions" ADD CONSTRAINT "promotions_uses_in_range"
   CHECK ("uses" >= 0 AND ("max_uses" IS NULL OR ("max_uses" >= 1 AND "uses" <= "max_uses")));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
 ALTER TABLE "promotions" ADD CONSTRAINT "promotions_code_shape" CHECK ("code" IS NULL OR "code" ~ '^[A-Z0-9-]{3,20}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "promotions_tutor_id_code_unique" ON "promotions" ("tutor_id", "code") WHERE "code" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "promotions_tutor_id_created_at_idx" ON "promotions" USING btree ("tutor_id", "created_at");

ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "price_tnd" numeric(7, 2);
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "promotion_id" uuid;

DO $$ BEGIN
 ALTER TABLE "bookings" ADD CONSTRAINT "bookings_promotion_id_promotions_id_fk"
   FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "student_subscriptions" ADD COLUMN IF NOT EXISTS "promotion_id" uuid;

DO $$ BEGIN
 ALTER TABLE "student_subscriptions" ADD CONSTRAINT "student_subscriptions_promotion_id_promotions_id_fk"
   FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
