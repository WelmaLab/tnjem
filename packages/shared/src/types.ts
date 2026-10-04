import type { LevelCode } from "./levels"; // phase-a lane L5 (A18.7)
import type { ClassPhase } from "./class-phase"; // phase-a lane L5 (A18.10)
import type { PublicOffer, PublicPromotion } from "./offers"; // espace prof v2 · growth (P5)

export type Locale = "fr" | "ar";
export type Role = "tutor" | "student" | "guardian";
export type Rail = "flouci" | "konnect" | "d17";
export type PayoutMethod = "flouci_wallet" | "bank_rib";

export type Tutor = {
  id: string;
  slug: string;
  full_name: string;
  subject: string;       // e.g. "Prof de Maths · Bac"
  level: string;         // phase-a lane L5 (A18.7): the FR labels of `levels` ("Collège · Bac"), "" when none — never a default
  // phase-a lane L5 (A18.7): the levels this tutor teaches, as codes (translate with levelLabel).
  levels: LevelCode[];
  bio: string;
  avatar_initials: string;
  rating: number;
  students_count: number;
  verified: boolean;
  /* TRUE only when an APPROVED photo exists on a public tutor. The URL is derived
     from the slug, so no path or timestamp leaks into a public payload — and a
     false here means "render the monogram", which is what every avatar slot did
     before Step 13 and still does for most tutors. */
  has_photo: boolean;
  /* Opt-in, per tutor, default false. The storefront needs it separately from
     ClassItem.is_free_first because tutor-level copy ("Première séance offerte"
     as a badge on the profile, the JSON-LD Offer) is rendered even when the
     tutor has published no class at all — which is exactly how a claim ended up
     on every storefront in the catalogue. */
  offers_free_first_session: boolean;
};

export type ClassItem = {
  id: string;
  tutor_id: string;
  tutor_name?: string;
  title: string;
  description?: string;
  /* The instant the class starts, ISO 8601. The display strings below are for
     reading; this is for deciding (isOpenForBooking) and for <time datetime>. */
  starts_at: string;
  day: string;           // "23"
  month: string;         // localized short month, e.g. "JUIN"
  time: string;          // "18:00"
  duration_min: number;
  price_tnd: number;
  seats: number;
  seats_left: number;
  /* EFFECTIVE, not raw. This is already
     tutors.offers_free_first_session AND classes.is_free_first — see
     isEffectivelyFreeFirst(). Every producer of a ClassItem applies it, so no
     consumer has to remember to, and a UI that renders this alone cannot
     over-promise. */
  is_free_first: boolean;
  meet_url?: string;        // Jitsi/Meet room
  whiteboard_url?: string;  // Bitpaper / Excalidraw
  quiz_url?: string;        // Wooclap / Quizizz
  replay_url?: string;      // recorded session
  status?: "scheduled" | "live" | "done" | "cancelled";
  // phase-a lane L4 (A9): the class page links its tutor BY SLUG. It used to
  // search Explore for the tutor's name, so two tutors with the same name could
  // send a student to the wrong storefront. Optional: only GET /classes/:id sets them.
  tutor_slug?: string | null;
  tutor_subject?: string | null;
  /** phase-a/integrate (A9 × A18.7): the levels the tutor CHOSE, as codes — never the
      legacy tutors.level column, which still holds the old 'Bac' default. */
  tutor_levels?: LevelCode[];
  // phase-a lane L5 (A18.7): the one level this class is for, if the tutor set it.
  level?: LevelCode | null;
  /* live-fixes-3 · A3: true only when the SIGNED-IN viewer is the tutor who owns the
     class (GET /classes/:id with a session). The class page swaps the booking CTA
     for the owner's panel on it; anonymous reads (ISR, JSON-LD) always get false. */
  viewer_is_owner?: boolean;
};

export type Pack = {
  id: string;
  tutor_id: string;
  title: string;
  meta: string;          // "42 pages · 6 vidéos"
  price_tnd: number;
  kind?: "pdf" | "video";
};

export type Booking = {
  id: string;
  class: ClassItem;
  is_free: boolean;
  status: "reserved" | "paid" | "attended" | "cancelled";
};

export type ActivityItem = {
  id: string;
  kind: "class" | "pack" | "payout";
  title: string;
  sub: string;           // "Aujourd'hui · 18 élèves"
  amount_tnd: number;    // +264, etc.
};

export type Storefront = {
  tutor: Tutor;
  classes: ClassItem[];
  packs: Pack[];
  /* espace prof v2 · growth (P5): the active monthly offers, and the LIVE PUBLIC
     promotions (no code) — anonymous data, safe in the ISR page. Optional so a
     producer that predates them (demo fixtures) still type-checks. */
  offers?: PublicOffer[];
  promotions?: PublicPromotion[];
};

export type TutorStats = {
  balance_tnd: number;
  students: number;
  sessions: number;
  rating: number;
  trend_pct: number;     // +38
  spark: number[];       // sparkline points
  recent: ActivityItem[];
};

// A class as shown on the logged-in tutor's dashboard.
export type DashboardClass = {
  id: string;
  title: string;
  starts_at: string;     // ISO 8601 — for <time datetime>; the strings below are for reading
  day: string;           // "23"
  month: string;         // localized short month
  time: string;          // "18:00"
  price_tnd: number;
  seats: number;
  seats_left: number;
  status: ClassItem["status"];
  // phase-a lane L5 (A18.10): real duration, and where the class stands when the API answered.
  duration_min?: number;
  phase?: ClassPhase;
};

// A pack (downloadable revision material) as shown on the dashboard.
export type DashboardPack = {
  id: string;
  title: string;
  meta: string;              // "42 pages · 6 vidéos"
  price_tnd: number;
};

// One student who booked one of the tutor's classes (see getDashboard).
export type DashboardBooking = {
  bookingId: string;
  classId: string;
  classTitle: string;
  /* FIRST NAME ONLY, via publicProfile(). Step 8: zero contact exchange.

     This field used to be the full name, and it sat beside studentPhone and
     studentEmail — which the dashboard rendered as a `tel:` link and a `mailto:`
     link with the address as the visible label. That was the product's largest
     counterparty-PII surface, and its own copy promised the opposite ("Ton
     numéro reste privé"). Both contact fields are GONE from this type, not
     nulled: a type that still declares them invites the next person to fill them
     back in. */
  studentName: string | null;
  /** Monogram from the first name. Never the surname initial. */
  studentInitials: string;
  bookedAt: string;              // ISO
  classTs: number;               // epoch ms of the class start (sort/upcoming)
  isFree: boolean;
  status: "reserved" | "paid" | "attended" | "cancelled";
};

// Real dashboard payload for the signed-in tutor (see getDashboard in app/actions.ts).
export type DashboardPlan = {
  code: string;
  /** null = unlimited. */
  maxClasses: number | null;
  /** Upcoming, non-cancelled classes — what the limit actually counts. */
  openClasses: number;
  /** true while payments are off and the tutor has no explicit grant. */
  isPilot: boolean;
  /** true when an admin has granted this plan, rather than it being the default. */
  granted: boolean;
  /** ISO, or null for an open-ended grant / the default plan. */
  expiresAt: string | null;
};

export type DashboardData = {
  name: string | null;       // tutor display name (for the greeting)
  slug: string | null;       // storefront slug; null until they publish a page
  has_storefront: boolean;
  balance_tnd: number;       // real withdrawable balance — 0 while payments are OFF
  paymentsEnabled: boolean;  // false → the UI must not promise earnings/payouts
  students: number;
  sessions: number;          // number of classes created
  rating: number;
  reviewCount: number;       // how many reviews back that rating
  status: TutorVerifStatus;   // verification state (draft until submitted)
  /* The tutor's own opt-in for the free first session. Surfaced on the dashboard
     so they can turn it on — without it the policy change would leave the
     feature permanently off for everyone, which is not "opt-in", it is
     "removed". */
  offersFreeFirstSession: boolean;
  /* The tutor's own photo state, or null when they have none. Only THEY see this
     — it is on the dashboard payload, not the public storefront, which reports a
     plain has_photo and only for an approved one. */
  avatarStatus: "pending" | "approved" | "rejected" | null;
  /* THE TUTOR'S OWN PLAN (Step 16). On the dashboard because a limit a person
     cannot see is a limit they hit by surprise, at the moment they are trying to
     do something. `openClasses` is what counts against `maxClasses`, and
     `isPilot` is what lets the UI say the true thing today: everyone has the
     full offer and nothing is billed. */
  plan: DashboardPlan;
  classes: DashboardClass[];
  packs: DashboardPack[];
  bookings: DashboardBooking[]; // who actually booked (across all their classes)
  /* espace prof v2 · shell (0036): the owner has copied or shared their own link at
     least once — the last step of the home checklist. Optional: an older API omits it. */
  linkShared?: boolean;
};

// A booked class as shown on the student's dashboard.
export type StudentClass = {
  bookingId: string;
  classId: string;
  title: string;
  tutorName: string;
  day: string;
  month: string;
  time: string;
  ts: number;            // epoch ms of the scheduled start (for countdown/sort)
  isFree: boolean;
  status: string;        // class status (scheduled/live/done/cancelled)
  meetUrl?: string;
  replayUrl?: string;
  // phase-a lane L3 (A21): TND a late cancel of this seat would retain (0: free seat, or moved after booking).
  lateCancelRetainedTnd?: number;
};

// Real student dashboard payload (see getStudentDashboard in app/actions.ts).
export type StudentDashboard = {
  upcoming: StudentClass[];
  past: StudentClass[];
};

/* ---- Parent accounts (Step 14) ----
   A guardian's view of THEIR OWN child. The child's full name is theirs to see —
   this is not a counterparty surface. Every TUTOR name in here is
   publicDisplayName'd like everywhere else: a guardian is not a contact bridge. */
export type GuardianChild = {
  id: string;
  name: string | null;
  isMinor: boolean;
  /** The consent this child's account rests on, as given to THIS guardian (0023). */
  consent: { signedAt: string; policyVersion: string; withdrawnAt: string | null } | null;
  /** How many conversations exist, so the parent knows there is something to read. */
  threadCount: number;
  upcoming: {
    classId: string;
    title: string;
    starts_at: string;          // ISO 8601, for <time datetime>
    day: string;
    month: string;
    time: string;
    tutorName: string | null;   // first name only
  }[];
};

/* ---- Materials (Step 10) ----
   A material the CURRENT VIEWER is allowed to see. The API filters the list per
   viewer, so the mere presence of an item is already the access decision — a
   client never has to reproduce the rule, and cannot get it wrong. */
export type MaterialItem = {
  id: string;
  kind: "file" | "youtube";
  visibility: "public" | "students" | "private";
  title: string;
  description?: string;
  classId?: string;
  fileName?: string;
  /** The SNIFFED type, never the uploader's claim. */
  mime?: string;
  sizeBytes?: number;
  /** 11 characters. Rendered ONLY through youtube-nocookie. */
  youtubeId?: string;
  createdAt: string;
};

/* ---- Messaging (Step 8b) ----
   The counterparty name is ALREADY publicDisplayName'd by the API. A thread list
   is a counterparty surface like any other, and Step 8's allow-list does not stop
   applying because this feature is new. */
export type MessageThreadSummary = {
  id: string;
  classId: string;
  classTitle: string;
  classTs: number;              // epoch ms of the class start
  withName: string | null;      // first name only
  lastMessageAt: string | null; // ISO, null until someone writes
  studentIsMinor: boolean;
  iAm: "tutor" | "student" | "guardian";
};

export type MessageItem = {
  id: string;
  mine: boolean;
  /* Guardian view only (Step 14): whose message this is, so a parent can follow
     a conversation they are not in. `mine` is false for every message there —
     none of them are the guardian's — which is exactly why this second flag is
     needed rather than reusing it. */
  fromChild?: boolean;
  /** PLAIN TEXT. Never render through dangerouslySetInnerHTML. */
  body: string;
  /** True when contact details were removed from it before storage. */
  masked: boolean;
  at: string;                   // ISO
};

export type MessageThreadDetail = {
  id: string;
  classTitle: string;
  withName: string | null;
  /* "guardian" is a READER, not a participant. The UI hides the composer on it:
     a read-only view that still renders a text box invites a feature that does
     not exist, and a guardian must never be able to write as their child. */
  iAm: "tutor" | "student" | "guardian";
  studentIsMinor: boolean;
  messages: MessageItem[];
  // phase-a lane L1 (A2): open, or closed — the UI shows the banner and disables the composer.
  state: ThreadStateShown;
};

// phase-a lane L1 (A2) — see ./thread-state.ts for when and why a thread closes.
export type ThreadStateShown = "open" | "closed" | "closed:booking-cancelled" | "closed:class-ended";

/* ---- Wrong-role result ----
   /dashboard serves tutors and /student serves students, but nothing stopped a
   signed-in student loading /dashboard (they got the tutor shell with a "create
   your storefront" prompt — an invitation to the exact silent role conversion we
   just closed) or a tutor loading /student (an empty bookings list that reads like
   a bug). Both actions now return this instead of data when the session's role is
   not the one the page serves, so each page can say WHICH account you are signed
   in as and link to the right place.

   Discriminated by the presence of the key, so callers narrow with
   `"wrongRole" in d` — no extra tag field on the happy-path payloads. */
export type WrongRole = { wrongRole: Role };

/* null still means "no session / no DB" on both — the signed-out panels already
   depend on that and it is a different message from "wrong role". */
export type DashboardResult = DashboardData | WrongRole | null;
export type StudentDashboardResult = StudentDashboard | WrongRole | null;

/* ---- Student profile (/student/welcome) ----
   School level. A closed set because it is written to the DB from a public action
   and read back into UI copy; `autre` is the escape hatch so the list never blocks
   someone. Order is the Tunisian school ladder, not alphabetical. */
export const STUDENT_LEVELS = ["primaire", "college", "lycee", "bac", "superieur", "autre"] as const;
export type StudentLevel = (typeof STUDENT_LEVELS)[number];

// What /student/welcome pre-fills from, and what saveStudentProfile writes.
export type StudentProfile = {
  fullName: string | null;
  level: StudentLevel | null;
  subjects: string[];        // stored comma-joined, exposed as a list
  /* Optional CONTACT number — not a credential. Email is the login identity, so
     this is where a student's phone is collected, and it is what keeps the tutor's
     call button and notify()'s SMS side-channel meaningful. */
  phone: string | null;
};

// ---- Tutor verification ----
export type TutorVerifStatus = "draft" | "pending" | "verified" | "rejected";
export type VerificationLinks = {
  linkedin: string | null;
  instagram: string | null;
  tiktok: string | null;
  youtube: string | null;
  facebook: string | null;
  website: string | null;
  introVideo: string | null;
};
// The signed-in tutor's own verification state (getMyVerification).
export type TutorVerification = {
  status: TutorVerifStatus;
  experienceYears: number | null;
  institution: string | null;
  languages: string | null;
  pitch: string | null;
  links: VerificationLinks;
  reviewNote: string | null;
  docKinds: string[];
};
/* ---- Tutor onboarding state (getOnboardingState) ----
   What /onboarding and /onboarding/verify need on the server: where the tutor is in
   the ladder (structurally the TutorProgress that lib/onboarding-steps.ts consumes)
   plus the storefront values to pre-fill the form with.

   `draft` is why revisiting /onboarding is now an edit rather than a blank slate:
   createTutor() has always UPDATED an existing storefront in place, but the form
   opened empty every time, so a tutor coming back to fix a typo was retyping their
   whole page from memory. */
export type OnboardingState = {
  hasStorefront: boolean;
  status: TutorVerifStatus;
  hasClass: boolean;
  hasSlug: boolean;
  draft: { fullName: string; subject: string; bio: string; slug: string; phone: string } | null;
  /* The tutor's free-first-session option (false when there is no storefront yet).
     The form warns when the bio promises a free session this option does not
     honour — see mentionsFreeFirstSession. */
  offersFreeFirstSession: boolean;
  // phase-a lane L5 (A18.7): the storefront's saved levels, to pre-fill the form ([] when none).
  levels?: LevelCode[];
  // espace prof v2 · shell: the photo and link-shared steps of the 5-step ladder (lib/onboarding-steps.ts).
  avatarStatus?: "pending" | "approved" | "rejected" | null;
  linkShared?: boolean;
};

// ---- Explore feed ----
// A verified tutor card on /explore. rating/review_count are computed from the
// reviews table — an empty feed returns [] (we never ship demo tutors as real).
export type ExploreTutor = {
  slug: string;
  full_name: string;
  subject: string;
  level: string; // phase-a lane L5 (A18.7): FR labels of `levels`, "" when none
  // phase-a lane L5 (A18.7): the levels this tutor teaches, as codes.
  levels: LevelCode[];
  bio: string;
  avatar_initials: string;
  rating: number;          // 0 when nobody has reviewed yet
  review_count: number;
  students_count: number;
  price_from_tnd: number | null; // cheapest upcoming class; null if none published
  /* espace prof v2 · growth (P5): the "from" price after the best PUBLIC promotion
     (pricing.ts), when one applies — the card strikes price_from_tnd through, shows
     "−15 %" and the end date. Absent/null = no promotion. */
  price_from_promo?: { final_tnd: number; percent: number; ends_at: string } | null;
  /* Step 16. This tutor is on a plan that buys a higher position in the list.
     The card MUST mark it: an ordering somebody paid for and the reader cannot
     see is an advertisement disguised as a recommendation. False for everyone
     during the pilot. */
  featured: boolean;
};

// ---- Reviews ----
export type Review = {
  id: string;
  rating: number;              // 1–5
  text: string | null;
  studentName: string | null;  // "Amine K." — never the phone
  classTitle: string | null;
  createdAt: string;           // ISO
};

export type TutorReviews = {
  items: Review[];
  average: number;             // 0 when there are none
  count: number;
};

// ---- Notifications ----
export type NotificationKind =
  | "booking_confirmed"
  | "class_reminder"
  | "verification_approved"
  | "verification_rejected"
  | "new_booking"
  | "booking_cancelled"   // student pulled out — the tutor needs to know a seat freed up
  | "message"             // Step 8b: someone wrote in a booking thread
  // espace prof v2 · growth (P4): follows
  | "new_follower"        // the tutor: a student now follows them (first name only)
  | "follow_digest"       // a follower: the daily digest of new classes and fiches
  // espace prof v2 · growth (P5): monthly subscriptions
  | "subscription_requested"  // the tutor: a student asked to subscribe
  | "subscription_confirmed"  // the student: the tutor confirmed (payment received outside Tnajem)
  | "subscription_renewed"    // the student: one more month
  | "subscription_paused"     // the student
  | "subscription_resumed"    // the student
  | "subscription_cancelled"  // the other party
  | "subscription_ending"     // both: 3 days before period_end
  | "subscription_expired";   // both: the nightly job closed it

export type NotificationItem = {
  id: string;
  kind: NotificationKind;
  /** Rendered by the API in the reader's language (@tnajem/shared/notification-messages). */
  title: string;
  body: string;
  /** The language title/body are actually in: the reader's, or "fr" for a row stored before 0040. */
  lang: Locale;
  href: string | null;
  read: boolean;
  createdAt: string;           // ISO
};

// A pending application as seen by an admin reviewer (getPendingVerifications).
export type PendingTutor = {
  tutorId: string;
  slug: string;
  name: string;
  subject: string;
  experienceYears: number | null;
  institution: string | null;
  languages: string | null;
  pitch: string | null;
  links: VerificationLinks;
  submittedAt: string | null;
  /** Décret 2015-1619: the tutor's declaration, or null if the application predates it. */
  publicTeacherDeclaration: { declaredAt: string; version: string } | null;
  /** url: a signed link valid for minutes and only for the admin it was issued to. */
  docs: { id: string; kind: string; fileName: string; url: string }[];
  // phase-a lane L4 (A10): `docs` is the CURRENT round only — one submission, one
  // upload time. Earlier rounds are kept apart, newest first, each dated, so an
  // admin can never approve against last month's scan by mistake.
  /** When the documents in `docs` were uploaded (ISO), or null when there are none. */
  docsSubmittedAt: string | null;
  previousRounds: { submittedAt: string; docs: { id: string; kind: string; fileName: string; url: string }[] }[];
  // phase-a lane L4 (A26): an ALREADY VERIFIED tutor with something to review — a
  // rename (pendingName) and/or a new round. They stay public meanwhile; `name` is
  // still the approved name. Send pendingName back with approve: it is bound too.
  reReview: boolean;
  pendingName: string | null;
};

/* ── The moderation queue (/admin/moderation) ─────────────────────────────── */

/** An open report. `subject` is what it is about, resolved by the API. */
export type AdminReport = {
  id: string;
  subjectKind: "tutor" | "class" | "review" | "message" | "material" | "other";
  subjectId: string | null;
  // phase-a lane L4 (A28): hidden → a message/review an admin has already hidden.
  subject: { label: string; href: string | null; hidden?: boolean } | null;
  reason: string;
  reporterEmail: string | null;
  createdAt: string;
  // phase-a lane L5 (A18.14): the signed-in reporter's role and account e-mail (null = nobody was signed in).
  reporterRole?: string | null;
  reporterAccountEmail?: string | null;
};

/** An open copyright claim on a material. */
export type AdminTakedown = {
  id: string;
  claimantName: string;
  claimantEmail: string;
  reason: string;
  createdAt: string;
  materialId: string;
  materialTitle: string;
  tutorName: string;
  tutorSlug: string;
};

/** A photo waiting for review. `version` names the exact file: a decision is bound to it. */
export type PendingAvatar = {
  tutorId: string;
  slug: string;
  fullName: string;
  updatedAt: string | null;
  version: string | null;
};

/** An account as an ADMIN sees it on /admin/accounts (POST /admin/accounts/find).
    The admin typed the address, so it is echoed back; nothing else identifying. */
export type AdminAccount = {
  id: string;
  email: string | null;
  role: string;
  name: string | null;
  blockedAt: string | null;     // ISO
  blockedReason: string | null;
  /** On the ADMIN_EMAILS allowlist — cannot be blocked from this page. */
  isAdmin: boolean;
  /** id: the tutors row — the admin read-only promotions view (growth, phase 5) asks by it. */
  tutor: { id: string; slug: string; status: string; suspended: boolean } | null;
  /** Scheduled, not yet started. A block refuses while either is > 0 unless asked to cancel them. */
  upcomingClasses: number;
  upcomingBookings: number;
};

/** What getMe() returns: the caller's OWN profile summary.

    email and phone are present here and that is correct even under the Step 8
    zero-contact rule — this is self-view, not a counterparty view. /account
    renders your own address. The rule Step 8 enforces is that a TUTOR never sees
    a STUDENT's contact and vice versa; it has never meant hiding your own. */
export type Me = {
  id: string;
  name: string | null;
  role: string;
  email: string | null;
  phone: string | null;
  // phase-a lane L5 (A18.13): on the admin allowlist — the account page names the role "Admin".
  isAdmin?: boolean;
};

/** One public storefront reference, for app/sitemap.ts. */
export type PublicTutorRef = { slug: string; lastModified: Date };
