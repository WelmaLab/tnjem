/* THE STUDENT SPACE — the payloads of apps/api/src/routes/student-space.ts
   (student-space-v1 · pages). Pure types and small pure helpers: safe in the barrel,
   on the client and in unit tests.

   Every instant is an ISO string (the client formats it in Tunis time); every
   tutor is named as the public sees them (« Walid T. », publicTutorName); nothing
   here carries a phone, an e-mail or a last name (contract C8). A class is past
   from start + duration (classEndMs) whatever classes.status says (contract C7). */

/** A prof as the student sees them. `id` is tutors.id — the key of /messages/with/<id> (C2). */
export type StudentTutorRef = {
  id: string;
  slug: string;
  /** « Walid T. » */
  name: string;
  /** « WT » */
  initials: string;
  /** The stored subject (a code or the tutor's text) — shown through displaySubject(). */
  subject: string;
  /** LEVEL_CODES, sorted. */
  levels: string[];
  verified: boolean;
};

/** Where a booking stands for the student. upcoming + live = « À venir »; past = « Passées ». */
export type StudentClassState = "upcoming" | "live" | "past" | "cancelled";

/** What the seat costs the student: a price, « offerte » (free first session) or
    « couverte par l'abonnement » (a monthly subscription seat). */
export type StudentPrice = { kind: "free" | "subscription" | "paid"; tnd: number };

/** One booking of the student, as « Mes cours » and Accueil list it. */
export type StudentClassRow = {
  bookingId: string;
  classId: string;
  title: string;
  tutor: StudentTutorRef;
  startsAt: string;
  endsAt: string;
  durationMin: number;
  state: StudentClassState;
  price: StudentPrice;
  /** Who cancelled — set only when state is "cancelled". "system" = Tnajem (an admin, a withdrawn consent). */
  cancelledBy: "student" | "tutor" | "system" | null;
  /** The student cancelled inside 48 h: what the cancellation ledger noted as retained (never charged while payments are off). */
  lateCancel: { retainedTnd: number; paymentsEnabled: boolean } | null;
  /** For the cancel confirmation of an upcoming seat: what a late cancel would retain now. */
  lateCancelRetainedTnd: number;
  /** When the seat was booked (ms) — the 15-minute grace (cancellation.ts). */
  bookedAt: number;
  /** How many materials of THIS class the student may open (lib/material-access.ts). */
  fiches: number;
};

/** A prof's next class, as a card shows it. */
export type StudentNextClass = { classId: string; title: string; startsAt: string };

/** An open class of a followed prof, in « Cette semaine ». */
export type StudentOpenClass = {
  classId: string;
  title: string;
  tutor: StudentTutorRef;
  startsAt: string;
  durationMin: number;
  /** After the prof's best live public promotion (pricing.ts) — the price the checkout opens with. */
  priceTnd: number;
  seatsLeft: number;
};

export type StudentWeekItem =
  | { kind: "booked"; row: StudentClassRow }
  | { kind: "open"; open: StudentOpenClass };

/** A fiche (a material) the student may open. */
export type StudentFiche = {
  id: string;
  title: string;
  /** pdf | image | youtube | file (any other stored type). */
  type: "pdf" | "image" | "youtube" | "file";
  sizeBytes: number | null;
  /** Videos only: the 11-character id, embedded through youtube-nocookie. */
  youtubeId: string | null;
  tutor: StudentTutorRef;
  /** « Séance « … » · date » or « Fiche de sa page ». */
  origin: { kind: "class"; classId: string; classTitle: string; startsAt: string } | { kind: "page" };
  createdAt: string;
  /** Added after the student's last visit to « Mes fiches » (profiles.last_seen_fiches_at). */
  isNew: boolean;
};

/** A prof card on Accueil (« Mes profs », up to 3). */
export type StudentHomeProf = {
  tutor: StudentTutorRef;
  following: boolean;
  nextClass: StudentNextClass | null;
  newFiches: number;
};

/** GET /student/home — Accueil. */
export type StudentHome = {
  firstName: string;
  /** The next class the student holds a seat in (live now, or the soonest ahead). */
  next: StudentClassRow | null;
  /** The student's OTHER seats this week, and open classes of followed profs this week. */
  week: StudentWeekItem[];
  profs: StudentHomeProf[];
  /** Followed + had-a-class profs in all (« Voir tout » when there are more than shown). */
  profsTotal: number;
  /** The latest 3 fiches the student may open. */
  newFiches: StudentFiche[];
  /** Only when there is nothing at all (no booking, no prof): up to 3 verified profs. */
  suggestions: StudentTutorRef[] | null;
  /** true = they match the student's level and subjects; false = the newest verified profs. */
  suggestionsMatched: boolean;
};

/** « WT » from « Walid T. » / « Walid Trabelsi ». Two letters at most, upper case. */
export function initialsOfName(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toLocaleUpperCase("fr");
}

/** The kind of file a stored type is, as « Mes fiches » labels it. */
export function ficheType(kind: string, mime: string | null | undefined): StudentFiche["type"] {
  if (kind === "youtube") return "youtube";
  if (mime === "application/pdf") return "pdf";
  if (mime && mime.startsWith("image/")) return "image";
  return "file";
}


/* ── Mes cours (letter C) ─────────────────────────────────────────────────── */

/** GET /student/classes — every booking, by tab. */
export type StudentClasses = {
  /** « À venir »: not cancelled, not ended (live ones included), soonest first. */
  ahead: StudentClassRow[];
  /** « Passées »: not cancelled, ended (start + duration), latest first. */
  past: StudentClassRow[];
  /** « Annulées »: by the student, the prof or Tnajem, latest first. */
  cancelled: StudentClassRow[];
};

/** The student's review of a class, as stored (a masked one shows its masked text). */
export type StudentReview = { rating: number; text: string | null };

/** GET /student/classes/:bookingId — the detail panel / the phone page. */
export type StudentClassDetail = {
  row: StudentClassRow;
  /** The fiches of THIS class the student may open (lib/material-access.ts). */
  fiches: StudentFiche[];
  review: StudentReview | null;
  /** Why the student cannot review (yet), or null when they can (review-eligibility.ts). */
  reviewBlock: "not-booked" | "class-not-started" | "class-not-ended" | null;
  /** « Réserver la prochaine »: this prof's next class the student holds no seat in, with a seat left. */
  nextClass: StudentNextClass | null;
};
