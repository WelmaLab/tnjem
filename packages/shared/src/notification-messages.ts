import type { Locale, NotificationKind } from "./types";
import { formatNumericDate, tunisClock } from "./time";

/* NOTIFICATIONS, IN THE READER'S LANGUAGE.

   A notification row used to hold its title and body as rendered French text, so
   the Arabic bell showed French. A row now holds a message KEY (one of the keys
   below) and its PARAMETERS (JSON: names, titles, ISO instants, numbers), and is
   rendered when it is read: the bell in the page's language, an e-mail or SMS in the
   recipient's stored language. Dates are stored as instants, so they too come out
   in the reader's format (DD/MM/YYYY, 24 h, Tunis).

   Rows written before 0040 keep their French text in title/body; renderNotification
   falls back to it (lang "fr") whenever a row has no key it knows.

   THE PERSON A ROW NAMES is always the `who` parameter, and the row's
   about_profile_id points at them. Erasing that account removes `who` and sets
   `whoErased` (packages/db/src/erasure.ts), which renders as "Un compte supprimé".

   FR and AR must have the same keys (guardrail 2 reads this file; the
   `satisfies` below checks the parameters too). Parameters are our own JSON, but a
   row can outlive a key's shape, so every renderer tolerates a missing field. */

/** The person a notification names, by first name ("Amine", "Mohamed B."). */
type Who = { who?: string | null; whoErased?: boolean };

export type DigestItem = { type: "class"; title: string; at: string } | { type: "pack"; title: string };

export type NotificationParams = {
  bookingConfirmed: Who & { classTitle: string; at: string };
  bookingNew: Who & { classTitle: string; at: string };
  bookingCancelledByStudent: Who & { classTitle: string; at: string; late?: boolean; lateHours?: number };
  classCancelledByTutor: { classTitle: string; at: string };
  classCancelledByPlatform: { classTitle: string; at: string };
  classMoved: { classTitle: string; at: string };
  seatFreed: { classTitle: string };
  messageNew: { classTitle: string };
  verificationApproved: { slug?: string };
  verificationChangeApprovedName: Record<string, never>;
  verificationChangeApprovedDocs: Record<string, never>;
  verificationChangeRejected: { note: string };
  verificationRejected: { note: string };
  followNew: Who;
  followDigest: Who & { items: DigestItem[]; more?: number };
  subscriptionRequested: Who & { offerTitle: string; priceTnd: number };
  subscriptionConfirmed: Who & { offerTitle: string; until: string };
  subscriptionRenewed: Who & { offerTitle: string; until: string };
  subscriptionPaused: Who & { offerTitle: string };
  subscriptionResumed: Who & { offerTitle: string };
  subscriptionCancelledByStudent: Who & { offerTitle: string };
  subscriptionCancelledByTutor: Who & { offerTitle: string };
  subscriptionEndingStudent: Who & { offerTitle: string; until: string };
  subscriptionEndingTutor: Who & { offerTitle: string; until: string };
  subscriptionExpiredStudent: Who & { offerTitle: string };
  subscriptionExpiredTutor: Who & { offerTitle: string };
  // student-space-v1 · E: a prof added a material to a class the student booked.
  materialAdded: { classTitle: string; materialTitle: string; tutorName?: string | null; video?: boolean };
};

export type NotificationKey = keyof NotificationParams;

/** The category each message files under (`notifications.kind`, what the UI groups on). */
export const NOTIFICATION_KIND_OF: Record<NotificationKey, NotificationKind> = {
  bookingConfirmed: "booking_confirmed",
  bookingNew: "new_booking",
  bookingCancelledByStudent: "booking_cancelled",
  classCancelledByTutor: "booking_cancelled",
  classCancelledByPlatform: "booking_cancelled",
  classMoved: "class_reminder",
  seatFreed: "booking_cancelled",
  messageNew: "message",
  verificationApproved: "verification_approved",
  verificationChangeApprovedName: "verification_approved",
  verificationChangeApprovedDocs: "verification_approved",
  verificationChangeRejected: "verification_rejected",
  verificationRejected: "verification_rejected",
  followNew: "new_follower",
  followDigest: "follow_digest",
  subscriptionRequested: "subscription_requested",
  subscriptionConfirmed: "subscription_confirmed",
  subscriptionRenewed: "subscription_renewed",
  subscriptionPaused: "subscription_paused",
  subscriptionResumed: "subscription_resumed",
  subscriptionCancelledByStudent: "subscription_cancelled",
  subscriptionCancelledByTutor: "subscription_cancelled",
  subscriptionEndingStudent: "subscription_ending",
  subscriptionEndingTutor: "subscription_ending",
  subscriptionExpiredStudent: "subscription_expired",
  subscriptionExpiredTutor: "subscription_expired",
  materialAdded: "material_added", // student-space-v1 · E
};

export type NotificationText = { title: string; body: string; sms?: string };

/* ── Formatting, per language ─────────────────────────────────────────────────
   In Arabic every value that comes from outside the sentence (a class title, a
   name, a date, a price) is wrapped in a first-strong isolate, so a Latin title or
   a "08/10/2026" never drags the guillemets and full stops around it. French needs
   no isolates: its sentence direction is the values' direction. */
const FSI = "⁨";
const PDI = "⁩";

type Fmt = {
  /** A value from outside the sentence (title, note, slug, name). */
  v: (s: unknown) => string;
  /** DD/MM/YYYY à HH:MM (Tunis). */
  when: (iso: unknown) => string;
  /** DD/MM/YYYY (Tunis). */
  date: (iso: unknown) => string;
  /** The named person, the erased marker, or the fallback when there is no name. */
  who: (p: Who, fallback: string) => string;
  num: (n: unknown) => string;
};

const ERASED = { fr: "Un compte supprimé", ar: "حساب محذوف" } as const;

function validDate(iso: unknown): Date | null {
  if (typeof iso !== "string" && typeof iso !== "number") return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmt(locale: Locale): Fmt {
  const iso = (s: string) => (locale === "ar" ? `${FSI}${s}${PDI}` : s);
  const v = (s: unknown) => iso(typeof s === "string" || typeof s === "number" ? String(s) : "");
  return {
    v,
    when: (x) => {
      const d = validDate(x);
      if (!d) return "";
      return locale === "ar" ? `${iso(formatNumericDate(d))} على ${iso(tunisClock(d))}` : `${formatNumericDate(d)} à ${tunisClock(d)}`;
    },
    date: (x) => {
      const d = validDate(x);
      return d ? iso(formatNumericDate(d)) : "";
    },
    who: (p, fallback) => (p.whoErased ? ERASED[locale] : p.who ? v(p.who) : fallback),
    num: (n) => v(typeof n === "number" && Number.isFinite(n) ? n : ""),
  };
}

/** Optional piece of a sentence: `text` when `on`, otherwise nothing. */
const opt = (on: unknown, text: string) => (on ? text : "");

type Renderer<K extends NotificationKey> = (p: NotificationParams[K], f: Fmt) => NotificationText;
type Catalog = { [K in NotificationKey]: Renderer<K> };

const digestLineFr = (it: DigestItem, f: Fmt) =>
  it.type === "class" ? "« " + f.v(it.title) + " » le " + f.when(it.at) : "nouvelle fiche « " + f.v(it.title) + " »";
const digestLineAr = (it: DigestItem, f: Fmt) =>
  it.type === "class" ? "« " + f.v(it.title) + " » نهار " + f.when(it.at) : "فيشة جديدة « " + f.v(it.title) + " »";

export const NOTIFICATION_MESSAGES = {
  fr: {
    bookingConfirmed: (p, f) => ({
      title: "Place réservée ✅",
      body: "« " + f.v(p.classTitle) + " » — " + f.when(p.at) + opt(p.who || p.whoErased, " avec " + f.who(p, "")) + ".",
      sms: "Tnajem : ta place pour « " + f.v(p.classTitle) + " » le " + f.when(p.at) + " est réservée. Lien de la séance dans ton espace élève.",
    }),
    bookingNew: (p, f) => ({
      title: "Nouvelle réservation 🎉",
      body: f.who(p, "Un élève") + " a réservé « " + f.v(p.classTitle) + " » (" + f.when(p.at) + ").",
    }),
    bookingCancelledByStudent: (p, f) => ({
      title: "Annulation",
      body: f.who(p, "Un élève") + " a annulé sa place pour « " + f.v(p.classTitle) + " » (" + f.when(p.at) + "). La place est de nouveau libre."
        + opt(p.late, " Annulation tardive (moins de " + f.num(p.lateHours) + " h avant)."),
    }),
    classCancelledByTutor: (p, f) => ({
      title: "Séance annulée",
      body: "« " + f.v(p.classTitle) + " » (" + f.when(p.at) + ") est annulée par le prof. Tu ne dois rien.",
    }),
    classCancelledByPlatform: (p, f) => ({
      title: "Séance annulée",
      body: "« " + f.v(p.classTitle) + " » (" + f.when(p.at) + ") n'aura pas lieu. Ta place est libérée, tu ne dois rien.",
    }),
    classMoved: (p, f) => ({
      title: "Séance déplacée",
      body: "« " + f.v(p.classTitle) + " » est déplacée au " + f.when(p.at) + ". Si ça ne te convient pas, tu peux annuler sans frais.",
    }),
    seatFreed: (p, f) => ({
      title: "Place libérée",
      body: "Une place s'est libérée pour « " + f.v(p.classTitle) + " ». Elle est de nouveau disponible.",
    }),
    messageNew: (p, f) => ({
      title: "Nouveau message",
      body: "Tu as un nouveau message à propos de « " + f.v(p.classTitle) + " ».",
    }),
    verificationApproved: (p, f) => ({
      title: "Profil vérifié ✅",
      body: "Ton profil est validé. Ta page est en ligne et visible dans Explorer.",
      sms: "Tnajem : ton profil est vérifié ✅ Ta page" + opt(p.slug, " tnajem.com/" + f.v(p.slug)) + " est en ligne.",
    }),
    verificationChangeApprovedName: () => ({
      title: "Modification validée ✅",
      body: "Ton nouveau nom est validé : il est maintenant affiché sur ta page.",
    }),
    verificationChangeApprovedDocs: () => ({
      title: "Modification validée ✅",
      body: "Tes nouveaux documents sont validés. Ta page reste en ligne.",
    }),
    verificationChangeRejected: (p, f) => ({
      title: "Modification non validée",
      body: "Ta modification n'a pas été validée : " + f.v(p.note) + ". Ta page reste en ligne telle qu'elle a été validée.",
    }),
    verificationRejected: (p, f) => ({
      title: "Dossier à compléter",
      body: "Ton dossier n'a pas été validé : " + f.v(p.note) + ". Tu peux corriger et renvoyer.",
      sms: "Tnajem : ton dossier de vérification doit être complété. Détails dans ton espace prof.",
    }),
    followNew: (p, f) => ({
      title: "Un élève te suit", // student-space-v1 · D: never « abonné » for a follow
      body: f.who(p, "Un élève") + " te suit : il sera prévenu de tes nouvelles séances et fiches.",
    }),
    followDigest: (p, f) => {
      const items = Array.isArray(p.items) ? p.items : [];
      const more = Number(p.more) > 0 ? Number(p.more) : 0;
      return {
        title: f.who(p, "Ton prof") + " a publié du nouveau",
        body: items.map((it) => digestLineFr(it, f)).join(" · ")
          + opt(more, " et " + f.num(more) + (more > 1 ? " autres" : " autre")) + ".",
      };
    },
    subscriptionRequested: (p, f) => ({
      title: "Demande d'abonnement",
      body: f.who(p, "Un élève") + " demande l'abonnement « " + f.v(p.offerTitle) + " » (" + f.num(p.priceTnd)
        + " TND / mois). Confirme-le quand tu as reçu le paiement.",
    }),
    subscriptionConfirmed: (p, f) => ({
      title: "Abonnement confirmé",
      body: f.who(p, "Ton prof") + " a confirmé ton abonnement « " + f.v(p.offerTitle) + " » jusqu'au " + f.date(p.until) + ".",
    }),
    subscriptionRenewed: (p, f) => ({
      title: "Abonnement renouvelé",
      body: f.who(p, "Ton prof") + " a renouvelé ton abonnement « " + f.v(p.offerTitle) + " » jusqu'au " + f.date(p.until) + ".",
    }),
    subscriptionPaused: (p, f) => ({
      title: "Abonnement en pause",
      body: f.who(p, "Ton prof") + " a mis ton abonnement « " + f.v(p.offerTitle) + " » en pause.",
    }),
    subscriptionResumed: (p, f) => ({
      title: "Abonnement repris",
      body: f.who(p, "Ton prof") + " a repris ton abonnement « " + f.v(p.offerTitle) + " ».",
    }),
    subscriptionCancelledByStudent: (p, f) => ({
      title: "Abonnement annulé",
      body: f.who(p, "Un élève") + " a annulé son abonnement « " + f.v(p.offerTitle) + " ».",
    }),
    subscriptionCancelledByTutor: (p, f) => ({
      title: "Abonnement annulé",
      body: f.who(p, "Ton prof") + " a annulé ton abonnement « " + f.v(p.offerTitle) + " ».",
    }),
    subscriptionEndingStudent: (p, f) => ({
      title: "Abonnement : fin dans 3 jours",
      body: "Ton abonnement « " + f.v(p.offerTitle) + " »" + opt(p.who || p.whoErased, " avec " + f.who(p, "")) + " se termine le "
        + f.date(p.until) + ". Pour continuer, vois avec ton prof : il le renouvelle en un clic.",
    }),
    subscriptionEndingTutor: (p, f) => ({
      title: "Abonnement : fin dans 3 jours",
      body: "L'abonnement de " + f.who(p, "ton élève") + " (« " + f.v(p.offerTitle) + " ») se termine le " + f.date(p.until) + ".",
    }),
    subscriptionExpiredStudent: (p, f) => ({
      title: "Abonnement terminé",
      body: "Ton abonnement « " + f.v(p.offerTitle) + " »" + opt(p.who || p.whoErased, " avec " + f.who(p, ""))
        + " est arrivé à son terme. Ton prof peut le renouveler en un clic.",
    }),
    subscriptionExpiredTutor: (p, f) => ({
      title: "Abonnement terminé",
      body: "L'abonnement de " + f.who(p, "ton élève") + " (« " + f.v(p.offerTitle)
        + " ») est arrivé à son terme. Renouvelle-le en un clic quand tu as reçu le paiement.",
    }),
    // student-space-v1 · E
    materialAdded: (p, f) => ({
      title: p.video ? "Nouvelle vidéo pour ta séance" : "Nouvelle fiche pour ta séance",
      body: (p.tutorName ? f.v(p.tutorName) : "Ton prof") + " a ajouté « " + f.v(p.materialTitle) + " » à la séance « " + f.v(p.classTitle) + " ». Elle est dans Mes fiches.",
    }),
  },
  ar: {
    bookingConfirmed: (p, f) => ({
      title: "بلاصتك محجوزة ✅",
      body: "« " + f.v(p.classTitle) + " » — نهار " + f.when(p.at) + opt(p.who || p.whoErased, " مع " + f.who(p, "")) + ".",
      sms: "Tnajem : بلاصتك في « " + f.v(p.classTitle) + " » نهار " + f.when(p.at) + " محجوزة. رابط الحصة في فضاء التلميذ متاعك.",
    }),
    bookingNew: (p, f) => ({
      title: "حجز جديد 🎉",
      body: f.who(p, "تلميذ") + " حجز بلاصة في « " + f.v(p.classTitle) + " » (" + f.when(p.at) + ").",
    }),
    bookingCancelledByStudent: (p, f) => ({
      title: "إلغاء",
      body: f.who(p, "تلميذ") + " ألغى بلاصتو في « " + f.v(p.classTitle) + " » (" + f.when(p.at) + "). البلاصة رجعت فارغة."
        + opt(p.late, " إلغاء متأخّر (أقلّ من " + f.num(p.lateHours) + " ساعة قبل)."),
    }),
    classCancelledByTutor: (p, f) => ({
      title: "الحصة تلغات",
      body: "« " + f.v(p.classTitle) + " » (" + f.when(p.at) + ") تلغات من عند الأستاذ. ما عليك شي.",
    }),
    classCancelledByPlatform: (p, f) => ({
      title: "الحصة تلغات",
      body: "« " + f.v(p.classTitle) + " » (" + f.when(p.at) + ") ما عادش باش تصير. بلاصتك تحرّرت، ما عليك شي.",
    }),
    classMoved: (p, f) => ({
      title: "الحصة تبدّل وقتها",
      body: "« " + f.v(p.classTitle) + " » ولّات نهار " + f.when(p.at) + ". كان الوقت ما يناسبكش، تنجّم تلغي بلاش.",
    }),
    seatFreed: (p, f) => ({
      title: "بلاصة تحرّرت",
      body: "تحرّرت بلاصة في « " + f.v(p.classTitle) + " ». رجعت متاحة من جديد.",
    }),
    messageNew: (p, f) => ({
      title: "ميساج جديد",
      body: "عندك ميساج جديد على « " + f.v(p.classTitle) + " ».",
    }),
    verificationApproved: (p, f) => ({
      title: "البروفيل متاعك تثبّت ✅",
      body: "البروفيل متاعك تقبل. صفحتك على الخط وتبان في « اكتشف ».",
      sms: "Tnajem : البروفيل متاعك تثبّت ✅ صفحتك" + opt(p.slug, " tnajem.com/" + f.v(p.slug)) + " على الخط.",
    }),
    verificationChangeApprovedName: () => ({
      title: "التبديل تقبل ✅",
      body: "إسمك الجديد تقبل : ولّى يبان في صفحتك.",
    }),
    verificationChangeApprovedDocs: () => ({
      title: "التبديل تقبل ✅",
      body: "الوثائق الجديدة متاعك تقبلت. صفحتك تبقى على الخط.",
    }),
    verificationChangeRejected: (p, f) => ({
      title: "التبديل ما تقبلش",
      body: "التبديل متاعك ما تقبلش : " + f.v(p.note) + ". صفحتك تبقى على الخط كيما تثبّتت.",
    }),
    verificationRejected: (p, f) => ({
      title: "الملف لازمو يتكمّل",
      body: "الملف متاعك ما تقبلش : " + f.v(p.note) + ". تنجّم تصلّح وتبعث من جديد.",
      sms: "Tnajem : ملف التثبّت متاعك لازمو يتكمّل. التفاصيل في فضاء الأستاذ متاعك.",
    }),
    followNew: (p, f) => ({
      title: "متابع جديد",
      body: f.who(p, "تلميذ") + " ولّى يتبع فيك : باش يوصلو خبر بحصصك وفيشاتك الجدد.",
    }),
    followDigest: (p, f) => {
      const items = Array.isArray(p.items) ? p.items : [];
      const more = Number(p.more) > 0 ? Number(p.more) : 0;
      return {
        title: f.who(p, "أستاذك") + " نشر حاجة جديدة",
        body: items.map((it) => digestLineAr(it, f)).join(" · ") + opt(more, " و" + f.num(more) + " أخرين") + ".",
      };
    },
    subscriptionRequested: (p, f) => ({
      title: "طلب اشتراك",
      body: f.who(p, "تلميذ") + " طلب الاشتراك « " + f.v(p.offerTitle) + " » (" + f.num(p.priceTnd)
        + " د.ت / الشهر). أكّدو كيف توصل بالخلاص.",
    }),
    subscriptionConfirmed: (p, f) => ({
      title: "الاشتراك تأكّد",
      body: f.who(p, "أستاذك") + " أكّد الاشتراك متاعك « " + f.v(p.offerTitle) + " » حتى لـ " + f.date(p.until) + ".",
    }),
    subscriptionRenewed: (p, f) => ({
      title: "الاشتراك تجدّد",
      body: f.who(p, "أستاذك") + " جدّد الاشتراك متاعك « " + f.v(p.offerTitle) + " » حتى لـ " + f.date(p.until) + ".",
    }),
    subscriptionPaused: (p, f) => ({
      title: "الاشتراك موقوف",
      body: f.who(p, "أستاذك") + " وقّف الاشتراك متاعك « " + f.v(p.offerTitle) + " » مؤقتاً.",
    }),
    subscriptionResumed: (p, f) => ({
      title: "الاشتراك رجع",
      body: f.who(p, "أستاذك") + " رجّع الاشتراك متاعك « " + f.v(p.offerTitle) + " ».",
    }),
    subscriptionCancelledByStudent: (p, f) => ({
      title: "الاشتراك تلغى",
      body: f.who(p, "تلميذ") + " ألغى الاشتراك متاعو « " + f.v(p.offerTitle) + " ».",
    }),
    subscriptionCancelledByTutor: (p, f) => ({
      title: "الاشتراك تلغى",
      body: f.who(p, "أستاذك") + " ألغى الاشتراك متاعك « " + f.v(p.offerTitle) + " ».",
    }),
    subscriptionEndingStudent: (p, f) => ({
      title: "الاشتراك : يوفى بعد 3 أيام",
      body: "الاشتراك متاعك « " + f.v(p.offerTitle) + " »" + opt(p.who || p.whoErased, " مع " + f.who(p, "")) + " يوفى نهار "
        + f.date(p.until) + ". باش تكمّل، تفاهم مع أستاذك : يجدّدو بكليك وحدة.",
    }),
    subscriptionEndingTutor: (p, f) => ({
      title: "الاشتراك : يوفى بعد 3 أيام",
      body: "الاشتراك متاع " + f.who(p, "تلميذك") + " (« " + f.v(p.offerTitle) + " ») يوفى نهار " + f.date(p.until) + ".",
    }),
    subscriptionExpiredStudent: (p, f) => ({
      title: "الاشتراك وفى",
      body: "الاشتراك متاعك « " + f.v(p.offerTitle) + " »" + opt(p.who || p.whoErased, " مع " + f.who(p, ""))
        + " وفى. أستاذك ينجّم يجدّدو بكليك وحدة.",
    }),
    subscriptionExpiredTutor: (p, f) => ({
      title: "الاشتراك وفى",
      body: "الاشتراك متاع " + f.who(p, "تلميذك") + " (« " + f.v(p.offerTitle) + " ») وفى. جدّدو بكليك وحدة كيف توصل بالخلاص.",
    }),
    // student-space-v1 · E
    materialAdded: (p, f) => ({
      title: p.video ? "فيديو جديد لحصّتك" : "ملف جديد لحصّتك",
      body: (p.tutorName ? f.v(p.tutorName) : "أستاذك") + " زاد « " + f.v(p.materialTitle) + " » للحصة « " + f.v(p.classTitle) + " ». تلقاه في ملفّاتي.",
    }),
  },
} satisfies Record<Locale, Catalog>;

/** What a row that cannot be rendered shows: no key we know, and no stored text. */
const UNKNOWN = {
  fr: { title: "Notification", body: "" },
  ar: { title: "إشعار", body: "" },
} as const;

export function isNotificationKey(k: unknown): k is NotificationKey {
  return typeof k === "string" && Object.prototype.hasOwnProperty.call(NOTIFICATION_MESSAGES.fr, k);
}

/** One message, rendered. Throws only on a programming error (an unknown key is typed out). */
export function renderMessage<K extends NotificationKey>(key: K, params: NotificationParams[K], locale: Locale): NotificationText {
  const r = NOTIFICATION_MESSAGES[locale][key] as Renderer<K>;
  return r(params, fmt(locale));
}

/** A stored row, in `locale`. `lang` is the language the text is actually in: a row
    from before 0040 (or with a key this build does not know) shows its stored
    French text whatever the reader's language. */
export function renderNotification(
  row: { key: string | null | undefined; params: unknown; title: string | null | undefined; body: string | null | undefined },
  locale: Locale,
): { title: string; body: string; lang: Locale } {
  if (isNotificationKey(row.key)) {
    try {
      const params = (row.params && typeof row.params === "object" ? row.params : {}) as never;
      const t = renderMessage(row.key, params, locale);
      return { title: t.title, body: t.body, lang: locale };
    } catch {
      /* a row whose params no longer fit: fall through to its stored text */
    }
  }
  if (row.title || row.body) return { title: row.title ?? "", body: row.body ?? "", lang: "fr" };
  return { ...UNKNOWN[locale], lang: locale };
}

/** The digest's one-line summary of a class or fiche, for e-mails as well as the bell. */
export function digestLine(item: DigestItem, locale: Locale): string {
  return locale === "ar" ? digestLineAr(item, fmt(locale)) : digestLineFr(item, fmt(locale));
}
