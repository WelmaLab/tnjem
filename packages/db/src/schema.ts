import { pgTable, pgEnum, uuid, text, integer, numeric, boolean, timestamp, unique, index, jsonb } from "drizzle-orm/pg-core";

/* Tnajem DB schema (local Postgres + Drizzle). Plain Postgres — no Supabase auth.users,
   no RLS. Authorization is enforced in the server data layer (lib/data.ts, app/actions.ts).
   Money tables (payments/payouts) exist but stay unused until legal sign-off. */

/* ── INDEXES ──────────────────────────────────────────────────────────────────
   Every index below is here because a query in lib/auth.ts, lib/data.ts or
   app/actions.ts runs it — none are speculative. The rule of thumb applied:

     • A UNIQUE constraint (or a PRIMARY KEY) already creates a btree index.
       We do NOT add a second index on the same leading columns. Already covered
       for free, and NOT re-declared below:
         profiles.phone            .unique()  → every login (verifyOtp)
         tutors.slug               .unique()  → every storefront hit
         sessions.token            PK         → every authenticated request
         bookings (class_id, student_id) unique → also serves lookups by class_id
         reviews  (student_id, class_id) unique → also serves lookups by student_id
         referrals.code            .unique()

     • Composite indexes are ordered so the leading column alone is still useful
       (btree prefix rule), which is why e.g. classes has ONE index on
       (tutor_id, scheduled_at) rather than two.

     • No DESC indexes: Postgres scans a btree backwards at the same cost, so
       (tutor_id, created_at) serves `ORDER BY created_at DESC` fine.

   All of this is additive — `drizzle-kit push` emits CREATE INDEX only. No data
   is touched. On a large table prefer `CREATE INDEX CONCURRENTLY` by hand; at
   pilot size (hundreds of rows) push is instant.
   ─────────────────────────────────────────────────────────────────────────── */

export const userRole = pgEnum("user_role", ["tutor", "student", "guardian"]);
export const classStatus = pgEnum("class_status", ["scheduled", "live", "done", "cancelled"]);
export const bookingStatus = pgEnum("booking_status", ["reserved", "paid", "attended", "cancelled"]);
export const payRail = pgEnum("pay_rail", ["flouci", "konnect", "d17"]);
export const payStatus = pgEnum("pay_status", ["pending", "paid", "failed", "refunded"]);
export const payoutMethod = pgEnum("payout_method", ["flouci_wallet", "bank_rib"]);
export const tutorStatus = pgEnum("tutor_status", ["draft", "pending", "verified", "rejected"]);
export const docKind = pgEnum("doc_kind", ["id_front", "id_back", "selfie", "diploma", "certificate", "role_proof", "other"]);
/* Who cancelled. "tutor" and "system" are not reachable yet (Step 11 gives the
   tutor a cancel path); the column exists now so the ledger never has to be
   back-filled with a guess about rows written before the option existed. */
export const cancelActor = pgEnum("cancel_actor", ["student", "tutor", "system"]);
/* MATERIALS (Step 10). Closed sets, because these are the columns access control
   and moderation branch on — a typo in a free-text "visibility" is an access
   control failure, and Postgres refusing the write is cheaper than discovering it. */
export const materialKind = pgEnum("material_kind", ["file", "youtube"]);
/* WHO CAN SEE IT. Ordered least to most restrictive, and the DEFAULT is the
   middle one, not "public": a tutor uploading a worksheet is far more likely to
   mean "for my students" than "for the internet", and the safe default is the one
   that cannot surprise them. */
export const materialVisibility = pgEnum("material_visibility", ["public", "students", "private"]);
export const takedownStatus = pgEnum("takedown_status", ["open", "upheld", "rejected"]);
/* PHOTO MODERATION (Step 13). A face on a public page that children browse is
   reviewed before anyone but its owner can see it. "pending" is the only state a
   fresh upload can be in — there is no path that publishes one directly. */
export const avatarStatus = pgEnum("avatar_status", ["pending", "approved", "rejected"]);
/* REPORTING (Step 15). What is being reported, and what happened to it. */
export const reportSubject = pgEnum("report_subject", [
  "tutor", "class", "review", "message", "material", "other",
]);
export const reportStatus = pgEnum("report_status", ["open", "actioned", "dismissed"]);
/* ACCOUNT DELETION. `requested` starts a 30-day grace the person can cancel;
   `purged` is terminal. There is no "deleting" state, because the row either
   still exists or it does not. */
export const deletionStatus = pgEnum("deletion_status", ["requested", "cancelled", "purged"]);
/* PLANS (Step 16). `expired` is set by the nightly sweep when expires_at passes;
   `cancelled` is an admin revoking a grant. Both mean the same thing to the
   resolver — not live — but they are different events and a log that cannot tell
   "it ran out" from "we took it away" is not worth keeping. */
export const subscriptionStatus = pgEnum("subscription_status", ["active", "expired", "cancelled"]);
/* Where the text was written. Not a free string: this is the column a moderator
   filters on, and "review" vs "reviews" vs "Review" would quietly split it. */
export const leakSurface = pgEnum("leak_surface", [
  "tutor_bio", "tutor_name", "tutor_subject",
  "class_title", "class_description",
  "pack_title", "review", "message",
]);
/* What the author's text hit. MIRRORS ContactKind in
   packages/shared/src/contact-info.ts — add there and here together. */
export const leakKind = pgEnum("leak_kind", [
  "phone", "email", "url", "social-handle", "social-platform", "spelled-digits",
]);
/* What we did about it. Rejected: the write was refused and the author re-edits.
   Masked: the text was stored with the details removed. */
export const leakAction = pgEnum("leak_action", ["rejected", "masked"]);

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  role: userRole("role").notNull().default("student"),
  fullName: text("full_name"),
  /* ---- Login identity ----
     `email` is what a login code is sent to (lib/auth.ts::otpChannel); `phone` was,
     and still is under OTP_CHANNEL=sms. Both are nullable-but-unique: Postgres does
     not conflict NULLs, so exactly one of them is populated at signup and the other
     is filled in later — phone is now an OPTIONAL CONTACT collected during
     onboarding, which is what keeps the tutor's call button and notify()'s SMS
     side-channel working. Added by scripts/sql/0005_email_identity.sql. */
  email: text("email").unique(),
  phone: text("phone").unique(),
  locale: text("locale").notNull().default("fr"),
  birthYear: integer("birth_year"),
  // phase-a lane L2 (A24) — 0025_birth_month.sql: 1–12, NULL = unknown (isAdult treats it as a minor).
  birthMonth: integer("birth_month"),
  // end phase-a lane L2
  /* ---- Student profile (collected at /student/welcome) ----
     Nullable on purpose: the welcome screen is skippable, and every profile
     written before scripts/sql/0004_student_profile.sql predates these columns.
     `subjects` is a comma-joined list, matching tutors.languages rather than
     inventing a second convention for "a short list of tags" in one schema. */
  level: text("level"),
  subjects: text("subjects"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /* ACCOUNT DELETION (Step 15). A REQUEST, not an act: 30 days in which the
     person can change their mind, because the commonest reason to close an
     account is a bad day and the commonest regret is doing it irreversibly.
     Null means no request — the state of every account that has never asked. */
  deletionRequestedAt: timestamp("deletion_requested_at", { withTimezone: true }),
  deletionStatus: deletionStatus("deletion_status"),
  /* ACCOUNT BLOCK (0019). Set by an admin; a blocked account has no session and
     cannot log in. The reason is admin-only. blocked_by → profiles(id) ON DELETE
     SET NULL lives in the SQL file (a self-reference drizzle types awkwardly). */
  blockedAt: timestamp("blocked_at", { withTimezone: true }),
  blockedReason: text("blocked_reason"),
  blockedBy: uuid("blocked_by"),
  /* ERASURE (0022). A tombstone: the row stays so nothing that belongs to someone
     else cascades away, and a CHECK guarantees it carries no identity. */
  purgedAt: timestamp("purged_at", { withTimezone: true }),
  /* The /terms version the account was created under, and when (0023). */
  termsVersion: text("terms_version"),
  termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
  /* The inactivity clock (0022), moved by getSession at most every 15 minutes. */
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  /* espace prof v2 · auth (0032_passwords.sql). argon2id PHC string, written only by
     apps/api/src/lib/password.ts; a CHECK refuses anything else. NULL = signs in by code. */
  passwordHash: text("password_hash"),
  passwordSetAt: timestamp("password_set_at", { withTimezone: true }),
  /* When a password-less account was offered "Crée un mot de passe" once (prompt-once). */
  passwordPromptedAt: timestamp("password_prompted_at", { withTimezone: true }),


});

export const tutors = pgTable("tutors", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id").references(() => profiles.id, { onDelete: "set null" }),
  slug: text("slug").notNull().unique(),
  fullName: text("full_name").notNull(),
  subject: text("subject").notNull(),
  level: text("level"), // phase-a lane L5 (A18.7): legacy, kept; the 'Bac' default is dropped in 0027_levels.sql
  // phase-a lane L5 (A18.7): the levels taught, as @tnajem/shared LEVEL_CODES (0027_levels.sql).
  levels: text("levels").array().notNull().default([]),
  bio: text("bio"),
  /* THE PHOTO. Renamed from the dead `avatar_url` column, which was declared and
     never once written or read — a URL is the wrong shape for this: nothing is
     served statically, and the bytes live under STORAGE_DIR with an endpoint in
     front. Holding a storage path in a column called "url" would mislead the next
     reader on the most privacy-sensitive field the table has. */
  avatarPath: text("avatar_path"),
  /* Every upload lands as `pending` and stays invisible to everyone but its owner
     until a human approves it. There is deliberately no "publish immediately"
     path: this is a photograph, on a public page, in a product used by minors. */
  avatarStatus: avatarStatus("avatar_status"),
  avatarUpdatedAt: timestamp("avatar_updated_at", { withTimezone: true }),
  introVideoUrl: text("intro_video_url"),
  rating: numeric("rating", { precision: 2, scale: 1 }).default("0"),
  studentsCount: integer("students_count").default(0),
  verified: boolean("verified").default(false),
  // ---- Verification (identity required; diploma/experience optional trust boosters) ----
  status: tutorStatus("status").notNull().default("draft"),
  experienceYears: integer("experience_years"),
  institution: text("institution"),
  languages: text("languages"),
  pitch: text("pitch"),
  linkedinUrl: text("linkedin_url"),
  instagramUrl: text("instagram_url"),
  tiktokUrl: text("tiktok_url"),
  youtubeUrl: text("youtube_url"),
  facebookUrl: text("facebook_url"),
  websiteUrl: text("website_url"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  /* Décret 2015-1619 (0024): the tutor declared they do not teach in a public
     school, when, and under which wording version. Set with every submission. */
  publicTeacherDeclaredAt: timestamp("public_teacher_declared_at", { withTimezone: true }),
  publicTeacherDeclarationVersion: text("public_teacher_declaration_version"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewNote: text("review_note"),
  payoutMethod: payoutMethod("payout_method"),
  /* THE FREE FIRST SESSION IS OPT-IN, PER TUTOR, AND DEFAULT OFF.
     notNull + default false, both deliberate:
       • nullable would make "not set" and "declined" indistinguishable, and every
         read site would have to pick a meaning for null — which is how
         classes.is_free_first ended up nullable-with-default-true, i.e. a claim
         nobody chose to make.
       • default FALSE because this is a promise to a student about money. A
         default that promises on the tutor's behalf is the thing being fixed.
     Terms §5 already says a tutor "peut choisir"; until now the product did not
     let them. */
  offersFreeFirstSession: boolean("offers_free_first_session").notNull().default(false),
  /* Set while the tutor's ACCOUNT is blocked (0019): the storefront is off every
     public read and unbookable. The verification decision (status) is untouched. */
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  /* The tutor record of an erased account (0022): scrubbed, suspended, slug retired. */
  erasedAt: timestamp("erased_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // phase-a lane L4 (A26, 0029): a VERIFIED tutor's requested new name, waiting for
  // review. fullName stays the approved, public one until an admin approves this.
  pendingFullName: text("pending_full_name"),
  // espace prof v2 · shell (0036): the first time the owner copied or shared their own link. NULL = never.
  linkSharedAt: timestamp("link_shared_at", { withTimezone: true }),
}, (t) => ({
  /* /explore: `where status = 'verified' order by rating desc` (getExploreTutors),
     the sitemap's `where status = 'verified'`, and the admin queue's
     `where status = 'pending'` (getPendingVerifications) all lead with status.
     One composite serves all three: status filters on the leading column, rating
     gives the planner a pre-sorted read for the Explore ordering. */
  statusRatingIdx: index("tutors_status_rating_idx").on(t.status, t.rating),
  /* `where profile_id = <me>` — the single hottest authenticated tutor query:
     getDashboard, createTutor, createClass, createPack, submitVerification and
     getMyVerification all run it. Without this it is a seq scan on every
     dashboard render. (Not unique: a duplicate row would be a bug, but making it
     unique could fail `db:push` on existing data — see SCALABILITY.md.) */
  profileIdIdx: index("tutors_profile_id_idx").on(t.profileId),
}));

// Uploaded verification documents (sensitive — INPDP: access-restricted, retained per policy).
export const verificationDocs = pgTable("verification_docs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tutorId: uuid("tutor_id").notNull().references(() => tutors.id, { onDelete: "cascade" }),
  kind: docKind("kind").notNull(),
  fileName: text("file_name").notNull(),
  storagePath: text("storage_path").notNull(),
  mime: text("mime"),
  sizeBytes: integer("size_bytes"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  /* getMyVerification + the admin queue's per-tutor doc fetch (an N+1 loop over
     pending tutors) + the retention purge join in lib/retention.ts. Also makes
     the ON DELETE CASCADE from tutors an index scan instead of a seq scan. */
  tutorIdIdx: index("verification_docs_tutor_id_idx").on(t.tutorId),
}));

/* What is left once a document is purged (0021): its kind, the dates and the
   decision — the "trace minimale" /privacy §5 promises. No file, no name, no path. */
export const verificationTraces = pgTable("verification_traces", {
  id: uuid("id").primaryKey().defaultRandom(),
  tutorId: uuid("tutor_id").notNull().references(() => tutors.id, { onDelete: "cascade" }),
  kind: docKind("kind").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull(),
  decision: tutorStatus("decision").notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  purgedAt: timestamp("purged_at", { withTimezone: true }).notNull().defaultNow(),
  /** "retention" (the 90-day window) or "account-erased". */
  reason: text("reason").notNull().default("retention"),
}, (t) => ({
  tutorIdx: index("verification_traces_tutor_id_idx").on(t.tutorId),
}));

export const classes = pgTable("classes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tutorId: uuid("tutor_id").notNull().references(() => tutors.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  durationMin: integer("duration_min").default(90),
  priceTnd: numeric("price_tnd", { precision: 7, scale: 2 }).notNull().default("0"),
  seats: integer("seats").default(20),
  seatsTaken: integer("seats_taken").default(0),
  /* Per-class, and it is only ever HALF the answer: the effective rule is
     tutors.offers_free_first_session AND classes.is_free_first. See
     isEffectivelyFreeFirst() in @tnajem/shared. Default flipped from true to
     false in 0008 — the old default made the platform promise a free session on
     behalf of every tutor who never touched the checkbox. */
  isFreeFirst: boolean("is_free_first").notNull().default(false),
  /* WHEN THE TUTOR LAST MOVED THIS CLASS (Step 11), or null.

     A student who booked BEFORE this timestamp agreed to a time that no longer
     exists, so they may cancel free whatever the 48h window says — the window is
     measured against a time they never chose. Comparing bookings.created_at to
     this is the whole rule; a per-booking flag would need writing to every row on
     every reschedule and would drift the first time one write failed. */
  rescheduledAt: timestamp("rescheduled_at", { withTimezone: true }),
  /* The private name of this class's fallback live room (0018). Never on a public
     page — see packages/shared/src/live.ts. Unique index in the SQL file. */
  roomToken: uuid("room_token").notNull().defaultRandom(),
  meetUrl: text("meet_url"),
  whiteboardUrl: text("whiteboard_url"),
  quizUrl: text("quiz_url"),
  replayUrl: text("replay_url"),
  status: classStatus("status").default("scheduled"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // phase-a lane L5 (A18.7): optional, one @tnajem/shared LEVEL_CODES code (0027_levels.sql).
  level: text("level"),
  // espace prof v2 · pro (0039): the tutor's reminders, one per class (apps/api/src/lib/reminders.ts).
  tutorReminder24hSentAt: timestamp("tutor_reminder_24h_sent_at", { withTimezone: true }),
  tutorReminder1hSentAt: timestamp("tutor_reminder_1h_sent_at", { withTimezone: true }),
}, (t) => ({
  /* THE storefront query: getStorefront() does `where tutor_id = ?` on every
     viral page hit; getDashboard does the same; getExploreTutors aggregates
     min(price) grouped by tutor_id. scheduled_at rides along as the second
     column so "this tutor's classes, in date order" (and any future
     upcoming-only filter) is served by the same index — a plain tutor_id index
     would be a redundant prefix of this one. */
  tutorScheduledIdx: index("classes_tutor_id_scheduled_at_idx").on(t.tutorId, t.scheduledAt),
  /* Global time-ordered scan: the class_reminder notification job (and any
     "starting soon" sweep) asks for classes across ALL tutors in a time window. */
  scheduledAtIdx: index("classes_scheduled_at_idx").on(t.scheduledAt),
}));

export const packs = pgTable("packs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tutorId: uuid("tutor_id").notNull().references(() => tutors.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  priceTnd: numeric("price_tnd", { precision: 7, scale: 2 }).notNull().default("0"),
  fileUrl: text("file_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /* live-fixes-1 · B (0041): the file or video this fiche hands to enrolled students —
     a materials row, so the access decision stays canRead()'s. set null: removing the
     file leaves the listed fiche, without a file. */
  materialId: uuid("material_id").references((): AnyPgColumn => materials.id, { onDelete: "set null" }),
}, (t) => ({
  // getStorefront() + getDashboard(): `where tutor_id = ?`. Same hot path as classes.
  tutorIdIdx: index("packs_tutor_id_idx").on(t.tutorId),
  materialIdx: index("packs_material_id_idx").on(t.materialId),
}));

export const bookings = pgTable("bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  classId: uuid("class_id").notNull().references(() => classes.id, { onDelete: "cascade" }),
  studentId: uuid("student_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  isFree: boolean("is_free").default(false),
  status: bookingStatus("status").default("reserved"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // espace prof v2 · growth (P5). C7: set when a subscriber's seat is covered by
  // their monthly subscription (0034). price_tnd + promotion_id: the price SHOWN at
  // booking, after the one promotion applied (0035) — kept for online payment later.
  subscriptionId: uuid("subscription_id").references((): AnyPgColumn => studentSubscriptions.id, { onDelete: "set null" }),
  priceTnd: numeric("price_tnd", { precision: 7, scale: 2 }),
  promotionId: uuid("promotion_id").references((): AnyPgColumn => promotions.id, { onDelete: "set null" }),
  /* espace prof v2 · pro (0039): "sent" markers, which double as the cron's claim.
     A marker older than the booking or the class's last move is stale (see the SQL). */
  reminder24hSentAt: timestamp("reminder_24h_sent_at", { withTimezone: true }),
  reminder1hSentAt: timestamp("reminder_1h_sent_at", { withTimezone: true }),
  reviewPromptSentAt: timestamp("review_prompt_sent_at", { withTimezone: true }),
}, (t) => ({
  /* Correctness first: one booking per (class, student). reserveSeat() relies on
     this to be idempotent — it catches the insert conflict and returns
     { already: true } rather than double-booking a seat under a race.
     Performance bonus: the unique constraint's btree also serves
     `where class_id = ?` and `where class_id = ? and student_id = ?`
     (reserveSeat, createReview, canJoinClass) — so NO separate class_id index. */
  uniqClassStudent: unique().on(t.classId, t.studentId),
  /* student_id is NOT the leading column above, so it needs its own index:
     getStudentDashboard does `where student_id = ? and status <> 'cancelled'`.
     status rides along so the cancelled rows are filtered in the index. */
  studentStatusIdx: index("bookings_student_id_status_idx").on(t.studentId, t.status),
  // espace prof v2 · growth (P5): "how many sessions has this subscription used".
  subscriptionIdx: index("bookings_subscription_id_idx").on(t.subscriptionId),
}));

/* THE CANCELLATION LEDGER.

   One row per cancellation, written in the SAME transaction as the status change
   and the seat release. Not a log: it is the record of what each party is owed
   under the 48h/40% rule, and it is what a dispute gets settled from.

   NOTHING IS CHARGED TODAY. Payments are off, so retained_tnd is what WOULD be
   retained. payments_enabled records the state at write time precisely so a
   future reader can tell a "would have been" row from a real one — without it,
   the day payments open, every historical row becomes indistinguishable from a
   real debit. Do not drop that column.

   retained_pct is stored per row rather than read from the constant. If the rate
   ever changes, history must keep the rate that was actually applied; a ledger
   that recomputes itself from today's constant is not a ledger. */
export const cancellations = pgTable("cancellations", {
  id: uuid("id").primaryKey().defaultRandom(),
  /* UNIQUE. A booking is cancelled once. The endpoint is idempotent and the
     status flip is atomic, but two concurrent cancels racing past the ledger
     insert would otherwise write two rows and double the retained amount — the
     same class of bug as the missing unique index on bookings (see 0007). */
  /* NULLABLE and SET NULL since Step 15, not CASCADE.

     bookings.student_id cascades from a profile, so deleting an account deleted
     the bookings — and every ledger row hanging off them went with it. A money
     ledger that the counterparty can erase by closing their account is not a
     ledger. The row survives carrying amounts and a class, and nothing that
     identifies a person: actor_profile_id is already SET NULL.

     UNIQUE still holds. Postgres does not treat NULLs as equal, so the
     one-row-per-booking guarantee is unaffected for live bookings. */
  // phase-a lane L3 (A8): no longer unique on its own — one row per CANCELLATION (0026), see below.
  bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
  classId: uuid("class_id").notNull().references(() => classes.id, { onDelete: "cascade" }),
  /* Nullable + set null: a deleted account must not take the tutor's record of
     what happened with it, and Step 15 deletes accounts. */
  actorProfileId: uuid("actor_profile_id").references(() => profiles.id, { onDelete: "set null" }),
  actor: cancelActor("actor").notNull(),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }).notNull().defaultNow(),
  /** Class start minus cancellation time. Signed — negative means it had started. */
  hoursBeforeStart: numeric("hours_before_start", { precision: 10, scale: 2 }).notNull(),
  late: boolean("late").notNull(),
  /* numeric(7,2) throughout, matching classes.price_tnd exactly. Money in a float
     column is how ledgers stop balancing. */
  amountTnd: numeric("amount_tnd", { precision: 7, scale: 2 }).notNull().default("0"),
  retainedTnd: numeric("retained_tnd", { precision: 7, scale: 2 }).notNull().default("0"),
  releasedTnd: numeric("released_tnd", { precision: 7, scale: 2 }).notNull().default("0"),
  retainedPct: numeric("retained_pct", { precision: 4, scale: 3 }).notNull().default("0"),
  /** False for every row written during the pilot. See the note above. */
  paymentsEnabled: boolean("payments_enabled").notNull().default(false),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // The tutor's "what do I get for the no-shows" view is per class.
  classIdx: index("cancellations_class_id_idx").on(t.classId),
  // And the student's own history is per actor.
  actorIdx: index("cancellations_actor_profile_id_idx").on(t.actorProfileId),
  // phase-a lane L3 (A8) — 0026_cancellation_ledger_rekey.sql. A re-booked seat
  // reactivates the same bookings row, so one booking can be cancelled more than
  // once; each cancellation is its own row (id is the cancellation id). This still
  // refuses a double-write of ONE cancellation: cancelled_at is the tx's now().
  // The SQL creates it as a unique index; declared with the imported unique().
  bookingCancelledAtUniq: unique("cancellations_booking_id_cancelled_at_unique").on(t.bookingId, t.cancelledAt),
}));

/* CONTACT-LEAK FLAGS — moderation signal, not evidence storage.

   ⚠ THE RAW MATCH IS NEVER STORED. Only the pattern CLASS (phone / email / url /
   …) and where it happened. The entire point of Step 8 is to stop contact
   details moving between people; a moderation table that keeps the phone number
   it caught has copied that number into a second place, made it reachable by
   every admin, and given the retention job something new to promise about. If
   you find yourself adding a `matched_text` column, the feature has inverted.

   No unique constraint: repeated attempts are the signal. One flag is a typo,
   eleven in an evening is a person working around the filter, and that pattern is
   only visible if every attempt is a row. */
export const contactLeakFlags = pgTable("contact_leak_flags", {
  id: uuid("id").primaryKey().defaultRandom(),
  /* Nullable + set null: Step 15 deletes accounts, and a moderation history must
     not vanish because the account it describes closed. */
  profileId: uuid("profile_id").references(() => profiles.id, { onDelete: "set null" }),
  surface: leakSurface("surface").notNull(),
  kind: leakKind("kind").notNull(),
  action: leakAction("action").notNull(),
  /** How many matches of this kind were in the text. A count, never the text. */
  hits: integer("hits").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // "show me everything this person tried" — the only query a moderator runs.
  profileIdx: index("contact_leak_flags_profile_id_created_at_idx").on(t.profileId, t.createdAt),
}));

/* ══════════════════════════════════════════════════════════════════════════════
   MESSAGING (Step 8b) — the replacement channel for the contact details Step 8
   closed. Without it, "we removed the phone number" is just a removal.

   SCOPED TO A BOOKING. There are no cold DMs and no way to address a stranger:
   a thread exists only where a student has actually taken a seat in that tutor's
   class. That single rule removes the entire class of abuse a marketplace inbox
   normally invites, and it is enforced by the UNIQUE booking_id below rather than
   by a check somebody can forget.
   ══════════════════════════════════════════════════════════════════════════════ */
export const messageThreads = pgTable("message_threads", {
  id: uuid("id").primaryKey().defaultRandom(),
  /* ONE THREAD PER BOOKING, enforced by the database. The alternative — a thread
     per (tutor, student) pair — would silently outlive the booking that justified
     it, so a single cancelled seat would leave a permanent channel to a minor. */
  bookingId: uuid("booking_id").notNull().unique().references(() => bookings.id, { onDelete: "cascade" }),
  classId: uuid("class_id").notNull().references(() => classes.id, { onDelete: "cascade" }),
  tutorProfileId: uuid("tutor_profile_id").references(() => profiles.id, { onDelete: "set null" }),
  studentProfileId: uuid("student_profile_id").references(() => profiles.id, { onDelete: "set null" }),
  /* Snapshotted at creation, not recomputed. A thread that started with a minor
     stays a minor's thread for its whole retention life even after they turn 18 —
     the messages in it were still written to a child. */
  studentIsMinor: boolean("student_is_minor").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** Denormalised so the thread LIST does not need a per-row subquery. */
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  /* espace prof v2 · shell (0036): when each side last opened the thread. Unread =
     the other side's messages after it; NULL = never opened. */
  tutorReadAt: timestamp("tutor_read_at", { withTimezone: true }),
  studentReadAt: timestamp("student_read_at", { withTimezone: true }),
}, (t) => ({
  // "my conversations, most recent first" — the only list query there is.
  tutorIdx: index("message_threads_tutor_profile_id_idx").on(t.tutorProfileId, t.lastMessageAt),
  studentIdx: index("message_threads_student_profile_id_idx").on(t.studentProfileId, t.lastMessageAt),
}));

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  threadId: uuid("thread_id").notNull().references(() => messageThreads.id, { onDelete: "cascade" }),
  /* set null, not cascade: deleting an account must not silently rewrite the
     other side's conversation into a monologue. Step 15 anonymises rather than
     erases, for the same reason it anonymises reviews. */
  senderProfileId: uuid("sender_profile_id").references(() => profiles.id, { onDelete: "set null" }),
  /* PLAIN TEXT, always. Stripped of markup on the way IN (apps/api) and escaped
     by React on the way OUT. This column is the product's only stored-XSS
     surface: it is user-authored, rendered to another user, and persisted. It
     must never be fed to dangerouslySetInnerHTML. */
  body: text("body").notNull(),
  /** True when detectContactInfo found something and it was masked out. */
  masked: boolean("masked").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // phase-a lane L4 (A28, 0029): hidden by an admin — a soft delete. `body` stays as
  // evidence (admins read it); every other reader gets the moderation placeholder.
  hiddenAt: timestamp("hidden_at", { withTimezone: true }),
  hiddenBy: uuid("hidden_by").references(() => profiles.id, { onDelete: "set null" }),
  hiddenReason: text("hidden_reason"),
}, (t) => ({
  threadIdx: index("messages_thread_id_created_at_idx").on(t.threadId, t.createdAt),
}));

/* Reports. Deliberately minimal here — Step 15 builds the moderation queue this
   feeds. What matters now is that the button exists and the row is durable: a
   Report button that does nothing is worse than none, because it teaches people
   that reporting does not work. */
export const messageReports = pgTable("message_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  messageId: uuid("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  reporterProfileId: uuid("reporter_profile_id").references(() => profiles.id, { onDelete: "set null" }),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // One report per person per message; pressing twice is not two reports.
  uniqReporterMessage: unique().on(t.messageId, t.reporterProfileId),
}));

/* ══════════════════════════════════════════════════════════════════════════════
   MATERIALS (Step 10) — worksheets, corrections and videos a tutor attaches.

   FILES NEVER GO IN public/. They land under STORAGE_DIR, exactly like identity
   documents, and the ONLY reader is an endpoint that makes an access decision
   first. A static directory cannot ask "did this student book the class?", so
   putting a "students only" worksheet there would make the visibility column a
   decoration.

   VIDEOS STORE AN ID, NOT A URL (see parseYouTubeId in @tnajem/shared). A stored
   URL is a stored redirect that some future surface renders as a link; an id can
   only ever be embedded, and only through youtube-nocookie.
   ══════════════════════════════════════════════════════════════════════════════ */
export const materials = pgTable("materials", {
  id: uuid("id").primaryKey().defaultRandom(),
  tutorId: uuid("tutor_id").notNull().references(() => tutors.id, { onDelete: "cascade" }),
  /* Optional. A material can belong to one class ("corrections for Tuesday") or
     to the tutor's library. set null, not cascade: deleting a finished class must
     not destroy the worksheet, which is the thing students keep. */
  classId: uuid("class_id").references(() => classes.id, { onDelete: "set null" }),
  kind: materialKind("kind").notNull(),
  visibility: materialVisibility("visibility").notNull().default("students"),
  title: text("title").notNull(),
  description: text("description"),
  /* Files only. POSIX separators always — see storage.ts on why a backslash in
     here does not resolve on Linux. */
  storagePath: text("storage_path"),
  fileName: text("file_name"),
  /** The SNIFFED type. Never the client's claim: this is served as Content-Type. */
  mime: text("mime"),
  sizeBytes: integer("size_bytes"),
  /** Videos only. 11 characters, validated by parseYouTubeId. */
  youtubeId: text("youtube_id"),
  /* TAKEDOWN. Soft removal, not a DELETE: a copyright dispute needs a record that
     the thing existed and was acted on, and an upheld claim that leaves no trace
     is indistinguishable from one that was never made. Every read path filters on
     removedAt IS NULL. */
  removedAt: timestamp("removed_at", { withTimezone: true }),
  removedReason: text("removed_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // "this tutor's library" and "this class's attachments" are the only listings.
  tutorIdx: index("materials_tutor_id_idx").on(t.tutorId, t.createdAt),
  classIdx: index("materials_class_id_idx").on(t.classId),
}));

/* COPYRIGHT TAKEDOWN. Ships WITH the upload, not after it — a platform hosting
   other people's teaching material without a way to complain about it is one that
   discovers its process during the first dispute.

   reporter_profile_id is NULLABLE and there is no auth on the write path. A
   rights-holder is almost never a user of this site, and requiring them to sign
   up to file a claim is the same as not having a process. */
export const materialTakedowns = pgTable("material_takedowns", {
  id: uuid("id").primaryKey().defaultRandom(),
  materialId: uuid("material_id").notNull().references(() => materials.id, { onDelete: "cascade" }),
  reporterProfileId: uuid("reporter_profile_id").references(() => profiles.id, { onDelete: "set null" }),
  /** Who is complaining. Free text — a rights-holder is not a row in our tables. */
  claimantName: text("claimant_name").notNull(),
  claimantEmail: text("claimant_email").notNull(),
  reason: text("reason").notNull(),
  status: takedownStatus("status").notNull().default("open"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: uuid("resolved_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  materialIdx: index("material_takedowns_material_id_idx").on(t.materialId),
  statusIdx: index("material_takedowns_status_created_at_idx").on(t.status, t.createdAt),
}));

/* STRIKES. One row per upheld claim, against the TUTOR rather than the file.

   Counted, not enforced automatically. A threshold that suspends an account on
   its own would be a system nobody can argue with, and a wrong strike would take
   a livelihood off the platform with no human in the loop. Step 15 builds the
   moderation surface that acts on these. */
export const tutorStrikes = pgTable("tutor_strikes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tutorId: uuid("tutor_id").notNull().references(() => tutors.id, { onDelete: "cascade" }),
  /* One strike per upheld takedown. Without this a moderator refreshing the queue
     twice doubles a tutor's count — and a count that can be wrong upward is one
     nobody can act on. */
  takedownId: uuid("takedown_id").unique().references(() => materialTakedowns.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tutorIdx: index("tutor_strikes_tutor_id_idx").on(t.tutorId, t.createdAt),
}));

/* ══════════════════════════════════════════════════════════════════════════════
   GUARDIAN LINKS (Step 14) — a parent's real account, not a name on a form.

   Before this, "the guardian" was two denormalised strings on a consent row:
   guardian_name and guardian_phone. That is a legal record, and it stays one, but
   it is not a person who can sign in, see what their child booked, or read a
   conversation with an adult stranger.

   HOW A LINK IS MADE, and why it is not an invitation. The consent form collects
   the parent's e-mail. Nothing is created on their behalf and no invitation is
   sent — an e-mail we cannot guarantee arrives is not a foundation for a
   safeguarding feature. Instead, when someone signs in with that address, the
   link resolves: login is e-mail OTP, so controlling the inbox already proves
   control of the address to exactly the standard the rest of the product uses.

   ⚠ A GUARDIAN IS NOT A CONTACT BRIDGE. Step 8 applies to them identically: they
   see a tutor's first name and nothing else. The point of this table is oversight
   of their own child, never a second route to an adult's phone number.
   ══════════════════════════════════════════════════════════════════════════════ */
export const guardianLinks = pgTable("guardian_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  guardianProfileId: uuid("guardian_profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  minorProfileId: uuid("minor_profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  /* The consent this link came from. set null so revoking or re-signing a consent
     does not silently drop a parent's oversight mid-term. */
  consentId: uuid("consent_id").references(() => consents.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  /* One link per (guardian, child). The resolve-on-login path runs on EVERY
     login, so without this a parent of two children would accumulate a row per
     sign-in. */
  uniqPair: unique().on(t.guardianProfileId, t.minorProfileId),
  guardianIdx: index("guardian_links_guardian_profile_id_idx").on(t.guardianProfileId),
  minorIdx: index("guardian_links_minor_profile_id_idx").on(t.minorProfileId),
}));

/* ══════════════════════════════════════════════════════════════════════════════
   REPORTS (Step 15) — reachable WITHOUT an account, deliberately.

   The person most likely to need this is a parent who found something on a
   public storefront and does not have a login, or a student who has already
   been driven off the platform by whatever they are reporting. Requiring an
   account to report abuse means the reports we most need never arrive.

   That makes the write path an unauthenticated write, so it is rate-limited per
   IP and stores only what was submitted. A reporter e-mail is optional: a report
   nobody can follow up is still a signal, and demanding contact details is
   another reason not to file one.
   ══════════════════════════════════════════════════════════════════════════════ */
export const reports = pgTable("reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  subjectKind: reportSubject("subject_kind").notNull(),
  /* Free-form rather than a foreign key: the subject is a tutor, a class, a
     message or a material, and no single FK can point at all four. A dangling id
     is acceptable here — the report is still evidence that something was
     reported, even after the thing is gone. */
  subjectId: text("subject_id"),
  reporterProfileId: uuid("reporter_profile_id").references(() => profiles.id, { onDelete: "set null" }),
  reporterEmail: text("reporter_email"),
  reason: text("reason").notNull(),
  status: reportStatus("status").notNull().default("open"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: uuid("resolved_by").references(() => profiles.id, { onDelete: "set null" }),
  resolutionNote: text("resolution_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  statusIdx: index("reports_status_created_at_idx").on(t.status, t.createdAt),
  subjectIdx: index("reports_subject_kind_subject_id_idx").on(t.subjectKind, t.subjectId),
}));

/* ADMIN AUDIT LOG (Step 15).

   Every privileged action, written in the same transaction as the action itself.
   The admin surface can approve a tutor, remove someone's teaching material,
   reject a photograph and purge an account — powers that need a record for the
   ordinary reason: so that "who un-verified this tutor?" has an answer, and so
   that an admin knows their actions are attributable before they take them.

   NOT deletable through the app. There is no endpoint that writes to this table
   except the logger, and none that removes from it. */
export const adminActions = pgTable("admin_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  /* set null: the log outlives the admin account. A record of who did what that
     disappears when they leave is not an audit log. */
  adminProfileId: uuid("admin_profile_id").references(() => profiles.id, { onDelete: "set null" }),
  /** A stable verb, e.g. "tutor.approve", "material.takedown.uphold". */
  action: text("action").notNull(),
  subjectKind: text("subject_kind"),
  subjectId: text("subject_id"),
  /** Free text, for the human reason. Never personal data about a third party. */
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  adminIdx: index("admin_actions_admin_profile_id_created_at_idx").on(t.adminProfileId, t.createdAt),
  subjectIdx: index("admin_actions_subject_kind_subject_id_idx").on(t.subjectKind, t.subjectId),
}));

/* ══════════════════════════════════════════════════════════════════════════════
   PLANS (Step 16) — the catalogue of record.

   THE ROW IS NOT WHAT THE SERVER ENFORCES. packages/shared/src/plans.ts is; see
   its header for why. This table exists for two concrete reasons:

     1. It is the FK target for subscriptions.plan_code, so granting "pr0" is
        refused by Postgres instead of silently resolving to the default plan —
        i.e. instead of quietly giving a tutor LESS than the admin intended.
     2. Anyone reading the database can see what the plans are and cost without
        reading TypeScript.

   A test compares every row here against the shared catalogue, so (2) can never
   drift into a lie.
   ══════════════════════════════════════════════════════════════════════════════ */
export const plans = pgTable("plans", {
  /** "pilot" | "gratuit" | "essentiel" | "pro" | "prestige". */
  code: text("code").primaryKey(),
  /* MILLIMES, integer. Not numeric(10,3) and never a float: these are prices,
     and the only safe representation of money is an integer count of the
     smallest unit. 1 TND = 1000 millimes. */
  monthlyMillimes: integer("monthly_millimes").notNull(),
  yearlyMillimes: integer("yearly_millimes").notNull(),
  /** NULL = unlimited. Not 0 and not -1: "no limit" is the absence of a limit. */
  maxClasses: integer("max_classes"),
  exploreBoost: integer("explore_boost").notNull().default(0),
  /** false for `pilot` — it is what everyone is on, not something anyone buys. */
  listed: boolean("listed").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* SUBSCRIPTIONS (Step 16) — which plan a tutor is on, and who put them there.

   EVERY ROW IS AN ADMIN GRANT TODAY. There is no checkout: payments are off, so
   nothing here was ever paid for and no row implies a debt. `granted_by` and
   `note` exist because a plan handed out by hand needs the same answerability as
   any other privileged action — the grant is also written to admin_actions. */
export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tutorId: uuid("tutor_id").notNull().references(() => tutors.id, { onDelete: "cascade" }),
  planCode: text("plan_code").notNull().references(() => plans.code),
  status: subscriptionStatus("status").notNull().default("active"),
  /* set null: the grant outlives the admin who made it, for the same reason
     admin_actions.admin_profile_id does. */
  grantedBy: uuid("granted_by").references(() => profiles.id, { onDelete: "set null" }),
  note: text("note"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  /** NULL = open-ended. The resolver treats a past date as not live immediately,
      without waiting for the nightly sweep to flip the status. */
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  /* Reads are "the live grant for this tutor" and the /explore join. The partial
     UNIQUE that makes at most one row active per tutor is a WHERE-clause index
     drizzle cannot express, so it lives in the SQL migration — see 0017. Without
     it "which plan am I on?" would be answered by whichever row the planner
     happened to return first. */
  tutorIdx: index("subscriptions_tutor_id_status_idx").on(t.tutorId, t.status),
}));

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
  packId: uuid("pack_id").references(() => packs.id, { onDelete: "set null" }),
  payerId: uuid("payer_id").references(() => profiles.id, { onDelete: "set null" }),
  amountTnd: numeric("amount_tnd", { precision: 7, scale: 2 }).notNull(),
  platformFeeTnd: numeric("platform_fee_tnd", { precision: 7, scale: 2 }).notNull().default("0"),
  rail: payRail("rail"),
  status: payStatus("status").default("pending"),
  providerRef: text("provider_ref"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const payouts = pgTable("payouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tutorId: uuid("tutor_id").notNull().references(() => tutors.id, { onDelete: "cascade" }),
  amountTnd: numeric("amount_tnd", { precision: 7, scale: 2 }).notNull(),
  method: payoutMethod("method").notNull(),
  status: payStatus("status").default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const referrals = pgTable("referrals", {
  id: uuid("id").primaryKey().defaultRandom(),
  inviterId: uuid("inviter_id").references(() => profiles.id, { onDelete: "set null" }),
  inviteeId: uuid("invitee_id").references(() => profiles.id, { onDelete: "set null" }),
  code: text("code").notNull().unique(),
  rewarded: boolean("rewarded").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const consents = pgTable("consents", {
  id: uuid("id").primaryKey().defaultRandom(),
  minorId: uuid("minor_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  guardianName: text("guardian_name").notNull(),
  guardianPhone: text("guardian_phone"), // phase-a lane L5 (A18.2): nullable — optional, not collected (0030_consent_phone_optional.sql)
  /* THE GUARDIAN'S E-MAIL, and it is what turns this row from a record INTO a
     link (Step 14). Login is e-mail OTP, so an address is the only identifier
     that can ever resolve to an account; the phone never could.

     Nullable, because every consent signed before Step 14 has none and back-filling
     a guessed address would be worse than an empty column — those parents simply
     have no linked account until the consent is re-signed. */
  guardianEmail: text("guardian_email"),
  consentText: text("consent_text").notNull(),
  /* The privacy-policy version the consent was given under (0023); 'unversioned'
     for rows signed before versions were recorded. Refreshed with signed_at. */
  policyVersion: text("policy_version").notNull(),
  signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
  /* WITHDRAWN (0023): kept as a record, and counted as no consent everywhere.
     withdrawn_by → profiles(id) ON DELETE SET NULL lives in the SQL file. */
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  withdrawnBy: uuid("withdrawn_by"),
}, (t) => ({
  /* verifyOtp() does `where minor_id = ?` on EVERY student login to decide
     needsConsent. That is on the critical path of the signup funnel. */
  minorIdIdx: index("consents_minor_id_idx").on(t.minorId),
}));

/* Reviews: one per (student, class). Written only after the class has started and
   only by a student who actually booked it (enforced in app/actions.ts → createReview).
   tutors.rating / tutors.students_count are recomputed from this table, so the
   storefront stars are real. rating is 1–5 — validated in lib/validation.ts. */
export const reviews = pgTable("reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  tutorId: uuid("tutor_id").notNull().references(() => tutors.id, { onDelete: "cascade" }),
  /* NULLABLE, and SET NULL on delete. Step 15.

     It was CASCADE, which meant a student closing their account DELETED their
     reviews — silently rewriting a tutor's rating and review count, downward,
     with no event anybody could see and no way to explain the change. A
     tutor's public reputation is not the student's to retract by leaving.

     The review survives and loses its AUTHOR instead. publicDisplayName(null)
     is null, and the storefront already renders an anonymous byline for it.
     This is what "anonymise reviews rather than delete" means in practice.

     NOTE bookings.student_id is deliberately still CASCADE+notNull: a booking
     with no student is not a record, it is a corrupt row, and the seat count
     is derived from it. The cancellation LEDGER is what survives an account
     deletion there — see cancellations.bookingId. */
  studentId: uuid("student_id").references(() => profiles.id, { onDelete: "set null" }),
  classId: uuid("class_id").references(() => classes.id, { onDelete: "set null" }),
  rating: integer("rating").notNull(),
  text: text("text"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // phase-a lane L4 (A28, 0029): hidden by an admin — a soft delete, like messages.
  hiddenAt: timestamp("hidden_at", { withTimezone: true }),
  hiddenBy: uuid("hidden_by").references(() => profiles.id, { onDelete: "set null" }),
  hiddenReason: text("hidden_reason"),
}, (t) => ({
  /* Correctness: one review per (student, class). createReview() catches the
     conflict and returns "already-reviewed" — this constraint IS the check.
     Its btree also serves lookups by student_id (leading column). */
  uniqStudentClass: unique().on(t.studentId, t.classId),
  /* tutor_id is not the leading column above, and it is read on every public
     storefront: getTutorReviews (`where tutor_id = ? order by created_at desc
     limit 50`), recomputeTutorStats (avg/count per tutor) and getExploreTutors
     (`where tutor_id in (...) group by tutor_id`). created_at second → the
     ORDER BY ... LIMIT 50 is a backward index scan, no sort. */
  tutorCreatedIdx: index("reviews_tutor_id_created_at_idx").on(t.tutorId, t.createdAt),
}));

/* In-app notifications (the always-on channel; SMS is best-effort on top — see lib/notify.ts).
   `kind` is plain text on purpose: adding a kind must not require a DB migration.
   Allowed values are typed as NotificationKind in lib/types.ts. */
export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  /* Free text, not an enum, so a new kind needs no migration. The closed set
     lives in NotificationKind (@tnajem/shared) and is what the UI switches on:
     booking_confirmed | booking_cancelled | class_reminder |
     verification_approved | verification_rejected | new_booking | message */
  kind: text("kind").notNull(),
  /* 0040: a row is a message key + JSON parameters, rendered in the reader's
     language (@tnajem/shared/notification-messages). title/body are the French
     text rows had BEFORE 0040, kept as their fallback; new rows leave them null.
     CHECK notifications_key_or_text: one or the other. */
  msgKey: text("msg_key"),
  msgParams: jsonb("msg_params"),
  title: text("title"),
  body: text("body"),
  href: text("href"),
  /* Whom the row names, when it names someone other than the recipient (0022), so
     erasing that person can rewrite this row. FK ON DELETE SET NULL in the SQL. */
  aboutProfileId: uuid("about_profile_id"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  /* getNotifications(): `where profile_id = ? order by created_at desc limit 50`
     → backward index scan, no sort, no heap scan of other users' rows. */
  profileCreatedIdx: index("notifications_profile_id_created_at_idx").on(t.profileId, t.createdAt),
  /* markNotificationsRead(): `where profile_id = ? and read_at is null`.
     btree indexes NULLs, so IS NULL is a real index condition here. This is also
     the index a future unread-badge count would use. */
  profileReadIdx: index("notifications_profile_id_read_at_idx").on(t.profileId, t.readAt),
}));

/* Slugs erased tutors held (0022), stored as a hash: an old storefront address must
   never be claimable by someone else, and the slug is often the person's name. */
export const retiredSlugs = pgTable("retired_slugs", {
  slugHash: text("slug_hash").primaryKey(),
  retiredAt: timestamp("retired_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---- Auth ----
export const sessions = pgTable("sessions", {
  /* sha256(cookie token), hex — NEVER the token itself (0020). The table is a
     list of logins; stored raw, every backup was a set of live sessions.

     PRIMARY KEY = unique btree. This is the index hit on EVERY authenticated
     request (getSession → `where token_hash = ?` joined to profiles), and the
     uniqueness is a correctness property: two rows with the same hash would be
     two identities behind one cookie. */
  tokenHash: text("token_hash").primaryKey(),
  profileId: uuid("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /* The idle clock (0020). Moved at most every 15 minutes by getSession(). */
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  lastSeenAtIdx: index("sessions_last_seen_at_idx").on(t.lastSeenAt),
  /* The retention sweep this table needs: `delete from sessions where
     expires_at < now()`. Without it, the purge is a full scan of a table that
     grows by one row per login, forever (see SCALABILITY.md §Housekeeping). */
  expiresAtIdx: index("sessions_expires_at_idx").on(t.expiresAt),
  /* ON DELETE CASCADE from profiles, and "log out all my devices" later.
     An unindexed FK turns every profile delete into a seq scan of sessions. */
  profileIdIdx: index("sessions_profile_id_idx").on(t.profileId),
}));

/* Durable, cross-instance rate limiting (SCALABILITY.md). One row per
   (endpoint, subject) key; checkRateLimit() in lib/auth.ts does a single atomic
   INSERT ... ON CONFLICT DO UPDATE against it so every instance shares one
   fixed-window counter instead of each Node process keeping its own in-memory Map.
   Created by scripts/sql/0002_rate_limits.sql. */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
}, (t) => ({
  /* The retention sweep: `delete from rate_limits where reset_at < now()`.
     Without it, a key hit once and never again lingers forever. */
  resetAtIdx: index("rate_limits_reset_at_idx").on(t.resetAt),
}));

export const otpCodes = pgTable("otp_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  /* An email address under OTP_CHANNEL=email, a phone number under =sms. One
     column for both, so flipping the channel needs no migration (renamed from
     `phone` by scripts/sql/0005_email_identity.sql). */
  identifier: text("identifier").notNull(),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  /* Every step of the login funnel scans this by identity: otpCooldownRemaining
     (select), createOtp (delete + insert), verifyOtpCode (select, then delete).
     Four lookups per successful login — without this, all of them are seq scans.
     NOTE: this is deliberately a plain index, not unique. createOtp's
     delete-then-insert under an advisory lock means at most one live row per
     identity, so unique WOULD be the correct constraint — but `db:push` would fail
     if two rows already exist from a concurrent send. Dedupe first, then upgrade
     (SQL in SCALABILITY.md). */
  identifierIdx: index("otp_codes_identifier_idx").on(t.identifier),
  /* Retention sweep: `delete from otp_codes where expires_at < now()`. */
  expiresAtIdx: index("otp_codes_expires_at_idx").on(t.expiresAt),
}));

/* ══════════════════════════════════════════════════════════════════════════════
   ESPACE PROF V2 · growth (Phases 3–5). Appended as one block so the four teams'
   schema edits merge cleanly; the extra pg-core helpers are imported here for the
   same reason (the import line at the top is everyone's).
   ══════════════════════════════════════════════════════════════════════════════ */
import { date, primaryKey, type AnyPgColumn } from "drizzle-orm/pg-core";

/* VITRINE STATISTICS (Phase 3, 0037). An AGGREGATE: one row per (tutor, Tunis
   day, source) with two counters. No visitor, IP, user agent or session can be
   stored here — there is no column for one. `source` is a closed vocabulary
   (utm_source of a shared link, or "direct"), CHECKed in the SQL. */
export const vitrineStatsDaily = pgTable("vitrine_stats_daily", {
  tutorId: uuid("tutor_id").notNull().references(() => tutors.id, { onDelete: "cascade" }),
  day: date("day").notNull(),
  source: text("source").notNull(),
  /** Loads of the public profile /{slug}. */
  views: integer("views").notNull().default(0),
  /** Arrivals through a link the tutor shared (it carries utm_source), profile or class page. */
  clicks: integer("clicks").notNull().default(0),
}, (t) => ({
  /* The upsert's conflict target AND the owner's "last 30 days" read
     (tutor_id = ? and day >= ?) — one btree serves both. */
  pk: primaryKey({ name: "vitrine_stats_daily_pk", columns: [t.tutorId, t.day, t.source] }),
}));

/* FOLLOWS (Phase 4, 0033). "Suivre / Abonné ✓". The primary key is the spec's
   unique(student, tutor). Unfollowing deletes the row — who follows whom is
   personal data. `notified_through` is the followers-digest cursor: a new follow
   starts at now(), so following never mails out a tutor's back catalogue. */
export const tutorFollows = pgTable("tutor_follows", {
  studentProfileId: uuid("student_profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  tutorId: uuid("tutor_id").notNull().references(() => tutors.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  notifiedThrough: timestamp("notified_through", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ name: "tutor_follows_student_tutor_pk", columns: [t.studentProfileId, t.tutorId] }),
  // "my followers, newest first" and the count. The PK serves the student side.
  tutorCreatedIdx: index("tutor_follows_tutor_id_created_at_idx").on(t.tutorId, t.createdAt),
}));

/* E-MAIL PREFERENCES (Phase 4, 0033 — contract C5). NO ROW = EVERYTHING ON, the
   default every account had before this table; a missing row must never read as
   "unsubscribed". The one reader is notification-prefs.ts::wantsEmail(). In-app
   notifications are not governed by this table: the bell is always on. */
export const notificationPrefs = pgTable("notification_prefs", {
  profileId: uuid("profile_id").primaryKey().references(() => profiles.id, { onDelete: "cascade" }),
  followers: boolean("followers").notNull().default(true),
  bookings: boolean("bookings").notNull().default(true),
  messages: boolean("messages").notNull().default(true),
  reminders: boolean("reminders").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** When a profile last got the followers digest — at most one a day (Phase 4, 0033). */
export const followDigests = pgTable("follow_digests", {
  profileId: uuid("profile_id").primaryKey().references(() => profiles.id, { onDelete: "cascade" }),
  lastSentAt: timestamp("last_sent_at", { withTimezone: true }).notNull(),
});

/* MONTHLY OFFERS (Phase 5 A, 0034) — a tutor's "N séances / mois pour X TND". NOT
   `subscriptions` (0017), which is the tutor's own Tnajem plan. At most 3
   non-archived per tutor (API); 1–31 sessions and price > 0 (CHECKs + Zod). An
   offer someone subscribed to is archived, never deleted. */
export const tutorOffers = pgTable("tutor_offers", {
  id: uuid("id").primaryKey().defaultRandom(),
  tutorId: uuid("tutor_id").notNull().references(() => tutors.id, { onDelete: "cascade" }),
  /** Always "monthly" today (CHECK). A column, so another kind needs no table. */
  kind: text("kind").notNull().default("monthly"),
  title: text("title").notNull(),
  sessionsPerMonth: integer("sessions_per_month").notNull(),
  priceTndPerMonth: numeric("price_tnd_per_month", { precision: 7, scale: 2 }).notNull(),
  /** Shown on the profile and open to new requests. */
  active: boolean("active").notNull().default(true),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tutorIdx: index("tutor_offers_tutor_id_created_at_idx").on(t.tutorId, t.createdAt),
}));

/* requested → active → (renewed) · paused · cancelled · expired. */
export const studentSubscriptionStatus = pgEnum("student_subscription_status", ["requested", "active", "paused", "cancelled", "expired"]);

/* A STUDENT'S SUBSCRIPTION to a monthly offer (Phase 5 A, 0034). Payments are off:
   the tutor confirms each month by hand ("paiement reçu hors Tnajem"). The price
   and quota AGREED are kept on the row (an offer edited later does not rewrite
   them), with payments_enabled as the cancellation ledger keeps it — what was true
   when written. At most one live (requested/active/paused) per student per tutor:
   a partial unique index in the SQL (drizzle cannot express one). */
export const studentSubscriptions = pgTable("student_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  offerId: uuid("offer_id").notNull().references(() => tutorOffers.id, { onDelete: "cascade" }),
  /** Denormalised from the offer: every read is "this tutor's" or "this student's". */
  tutorId: uuid("tutor_id").notNull().references(() => tutors.id, { onDelete: "cascade" }),
  studentProfileId: uuid("student_profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  status: studentSubscriptionStatus("status").notNull().default("requested"),
  sessionsPerMonth: integer("sessions_per_month").notNull(),
  /** The monthly price shown when requested, after the promotion (promotion_id, 0035). */
  priceTnd: numeric("price_tnd", { precision: 7, scale: 2 }).notNull(),
  paymentsEnabled: boolean("payments_enabled").notNull().default(false),
  periodStart: timestamp("period_start", { withTimezone: true }),
  periodEnd: timestamp("period_end", { withTimezone: true }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  renewedAt: timestamp("renewed_at", { withTimezone: true }),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  /** The period_end the 3-days-before reminder was sent for (a renewal resets it). */
  reminderSentFor: timestamp("reminder_sent_for", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  promotionId: uuid("promotion_id").references((): AnyPgColumn => promotions.id, { onDelete: "set null" }),
}, (t) => ({
  tutorStatusIdx: index("student_subscriptions_tutor_id_status_idx").on(t.tutorId, t.status),
  studentIdx: index("student_subscriptions_student_profile_id_idx").on(t.studentProfileId),
  sweepIdx: index("student_subscriptions_status_period_end_idx").on(t.status, t.periodEnd),
}));

/* PROMOTIONS, 20 % MAXIMUM (Phase 5 B, 0035). The cap lives in three places: the
   SQL CHECK, Zod (growth-input.ts) and the one price calculation (pricing.ts, C6).
   code NULL = public; a code = only through ?promo=CODE. No stacking: the best
   single promotion applies. `uses` moves atomically (WHERE uses < max_uses). */
export const promotions = pgTable("promotions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tutorId: uuid("tutor_id").notNull().references(() => tutors.id, { onDelete: "cascade" }),
  code: text("code"),
  percent: integer("percent").notNull(),
  /** all | class | pack | monthly (CHECK). */
  scope: text("scope").notNull().default("all"),
  targetId: uuid("target_id"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  maxUses: integer("max_uses"),
  uses: integer("uses").notNull().default(0),
  /** false = paused (reversible). */
  active: boolean("active").notNull().default(true),
  /** Ended for good (audited). */
  endedAt: timestamp("ended_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tutorIdx: index("promotions_tutor_id_created_at_idx").on(t.tutorId, t.createdAt),
}));
