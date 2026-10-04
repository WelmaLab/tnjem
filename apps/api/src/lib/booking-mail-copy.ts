import { CANCEL_FREE_WINDOW_HOURS, LATE_CANCEL_RETAINED_PCT, MONTHLY_PAYMENT_NOTE } from "@tnajem/shared";
import { CANCEL_GRACE_MINUTES, CANCEL_GRACE_MIN_LEAD_MINUTES } from "@tnajem/shared"; // live-fixes-3 · C

/* THE BOOKING EMAILS — copy only (espace prof v2 · phase 7). The sender is
   ./booking-mail.ts; this file is words, so it can be read and tested on its own.

   Same shape as otp-copy.ts: one object per language with IDENTICAL keys, chosen
   by the RECIPIENT's stored language (profiles.locale) — not the sender's. Plain
   text, like the OTP mail, for the same reason: least likely to be filtered.

   EVERY SENTENCE IS TRUE TODAY. In particular:
     • Payments are off. A price is shown as a price, followed by the ONE allowed
       sentence about it (MONTHLY_PAYMENT_NOTE: "Paiement en ligne bientôt — pour
       l'instant tu règles directement avec ton prof.", decision D4 + coordinator);
       the tutor reads growth's own phrasing ("l'élève te paie hors Tnajem"). Nothing
       says "payé", and apps/api/test/ep2-booking-mail-copy.test.ts scans for the rest.
     • The cancellation rule is the one routes/bookings.ts enforces (48 h free,
       then 40 % NOTED, never taken while payments are off — and, live-fixes-3 · C,
       always free within 15 min of booking unless the class starts within 15 min),
       from the same constants as the student space.
     • The link to the class is the Tnajem live page (/live/<id>), never the room
       URL: that page re-checks the booking every time, and a cancelled seat or a
       rotated room token stops working there (lib/room-rotation.ts).
     • Names: the tutor as "Mohamed B." (publicTutorName), a student by first
       name only (publicDisplayName) — the rule everywhere else. */

export type MailText = { subject: string; text: string };

/** The class as an email names it. Date "DD/MM/YYYY", time "HH:MM", both in Tunis. */
export type MailClass = { title: string; tutorName: string; date: string; time: string; durationMin: number };

/** What the student owes for this seat, as far as Tnajem knows — the price RECORDED
    on the booking (bookings.price_tnd, after the one promotion it took — C6/C7). */
export type Coverage =
  | { kind: "paid"; priceTnd: number; promo?: { percent: number; listTnd: number } | null }
  | { kind: "zero" } // a class the tutor priced at 0 TND
  | { kind: "free" } // the free first session with this tutor (bookings.is_free)
  | { kind: "subscription" }; // covered by the student's monthly subscription (C7, bookings.subscription_id)

export type CancelOutcome = {
  late: boolean; waived: boolean; wasFree: boolean; wasCovered?: boolean; retainedTnd: number;
  /** live-fixes-3 · C: cancelled within 15 min of booking — free, whatever the time to the class. */
  grace?: boolean;
};

const pct = Math.round(LATE_CANCEL_RETAINED_PCT * 100);
const H = CANCEL_FREE_WINDOW_HOURS;
const G = CANCEL_GRACE_MINUTES; // live-fixes-3 · C
const GL = CANCEL_GRACE_MIN_LEAD_MINUTES;
const tnd = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ""));

/* A percentage inside Arabic text is wrapped in Unicode isolates (LRI … PDI): in a
   right-to-left paragraph "−20 %" otherwise reorders to "% 20−". Mail clients and
   browsers honour isolates; they are invisible. French needs none. */
const ltr = (s: string) => `⁦${s}⁩`;
const promoFr = (cov: Coverage) => (cov.kind === "paid" && cov.promo ? ` (−${cov.promo.percent} % sur ${tnd(cov.promo.listTnd)} TND)` : "");
const promoAr = (cov: Coverage) => (cov.kind === "paid" && cov.promo ? ` (${ltr(`−${cov.promo.percent} %`)} على ${tnd(cov.promo.listTnd)} د.ت)` : "");
const paidTnd = (cov: Coverage) => tnd(cov.kind === "paid" ? cov.priceTnd : 0);

function lines(...parts: (string | null | undefined | false)[]): string {
  return parts.filter((p) => p !== null && p !== undefined && p !== false).join("\n");
}

const fr = {
  // The calendar entry (.ics) itself, in the recipient's language.
  icsSummary: (title: string, tutor: string) => `${title} — avec ${tutor}`,
  icsTutorSummary: (title: string) => `${title} — ta séance Tnajem`,
  icsDescription: (liveUrl: string) => `Séance en direct sur Tnajem.\nPour rejoindre la salle, ouvre cette page : ${liveUrl}`,
  icsLocation: "En ligne · Tnajem",

  hello: (first?: string | null) => (first ? `Bonjour ${first},` : "Bonjour,"),
  sign: "— L'équipe Tnajem",
  unsubscribe: (url: string) => `Ne plus recevoir ces emails : ${url}`,
  when: (c: MailClass) => `Le ${c.date} à ${c.time} (heure de Tunis), ${c.durationMin} min.`,
  liveLine: "Le jour de la séance, ouvre cette page : le bouton pour rejoindre la salle s'y trouve.",
  someone: "Un élève",
  price: (cov: Coverage) =>
    ({
      paid: `Prix : ${paidTnd(cov)} TND${promoFr(cov)}. ${MONTHLY_PAYMENT_NOTE.fr}`,
      zero: "Prix : séance gratuite.",
      free: "Prix : séance offerte (ta 1re séance avec ce prof).",
      subscription: "Prix : comprise dans ton abonnement mensuel avec ce prof (elle compte dans tes séances du mois).",
    })[cov.kind],
  cancelRule: (cov: Coverage, spaceUrl: string) =>
    lines(
      `Annulation gratuite jusqu'à ${H} h avant, depuis « Mes cours » : ${spaceUrl}`,
      // live-fixes-3 · C: only where a late cancel could cost something (a paid seat, or the free first session).
      cov.kind === "paid" || cov.kind === "free"
        ? `Tu changes d'avis ? Dans les ${G} min qui suivent ta réservation, l'annulation est toujours gratuite (sauf si la séance commence dans moins de ${GL} min).`
        : null,
      {
        paid: `Plus tard, tu peux encore annuler : ${pct} % du prix de la place sont alors notés comme retenus pour le prof. Rien n'est prélevé pendant le pilote.`,
        zero: null,
        free: "Plus tard, tu peux encore annuler, mais la séance offerte avec ce prof compte alors comme utilisée.",
        subscription: "Si tu annules, la séance revient dans ton abonnement du mois.",
      }[cov.kind],
    ),
  tutorPayment: (cov: Coverage) =>
    ({
      paid: `Paiement en ligne bientôt : pour l'instant, ton élève te paie hors Tnajem (${paidTnd(cov)} TND${promoFr(cov)}).`,
      zero: "Séance gratuite : rien à régler.",
      free: "C'est sa 1re séance avec toi : elle est offerte, comme tu l'as choisi.",
      subscription: "Cette place est comprise dans son abonnement mensuel (elle compte dans ses séances du mois).",
    })[cov.kind],

  studentConfirmed: (p: { first?: string | null; cls: MailClass; coverage: Coverage; liveUrl: string; calendarUrl: string; spaceUrl: string; unsubscribeUrl?: string | null }): MailText => ({
    subject: `Place réservée : « ${p.cls.title} », le ${p.cls.date} à ${p.cls.time}`,
    text: lines(
      fr.hello(p.first),
      "",
      "Ta place est réservée.",
      "",
      `« ${p.cls.title} » avec ${p.cls.tutorName}`,
      fr.when(p.cls),
      fr.price(p.coverage),
      "",
      fr.liveLine,
      p.liveUrl,
      "",
      "Ajouter au calendrier : ouvre le fichier .ics joint à cet email, ou télécharge-le ici :",
      p.calendarUrl,
      "",
      fr.cancelRule(p.coverage, p.spaceUrl),
      "",
      fr.sign,
      p.unsubscribeUrl ? fr.unsubscribe(p.unsubscribeUrl) : null,
    ),
  }),

  tutorNewBooking: (p: { first?: string | null; cls: MailClass; student: string; coverage: Coverage; seatsTaken: number; seats: number; liveUrl: string; dashboardUrl: string; unsubscribeUrl?: string | null }): MailText => ({
    subject: `Nouvelle réservation : « ${p.cls.title} », le ${p.cls.date} à ${p.cls.time}`,
    text: lines(
      fr.hello(p.first),
      "",
      `${p.student} a réservé une place pour « ${p.cls.title} ».`,
      fr.when(p.cls),
      `Places réservées : ${p.seatsTaken} sur ${p.seats}.`,
      fr.tutorPayment(p.coverage),
      "",
      "Ta salle, le jour de la séance :",
      p.liveUrl,
      `Tes classes : ${p.dashboardUrl}`,
      "",
      "Le fichier .ics joint ajoute la séance à ton calendrier.",
      "",
      fr.sign,
      p.unsubscribeUrl ? fr.unsubscribe(p.unsubscribeUrl) : null,
    ),
  }),

  studentCancelled: (p: { first?: string | null; cls: MailClass; outcome: CancelOutcome; spaceUrl: string; exploreUrl: string; unsubscribeUrl?: string | null }): MailText => ({
    subject: `Réservation annulée : « ${p.cls.title} », le ${p.cls.date}`,
    text: lines(
      fr.hello(p.first),
      "",
      `Ta place pour « ${p.cls.title} » (${p.cls.date} à ${p.cls.time}) est annulée. Elle est de nouveau libre pour un autre élève.`,
      p.outcome.wasCovered
        ? "Rien n'est retenu, et la séance revient dans ton abonnement du mois."
        : p.outcome.waived
        ? "Le prof avait déplacé la séance après ta réservation : l'annulation est sans frais."
        : p.outcome.grace && p.outcome.late // live-fixes-3 · C
          ? `Tu as annulé dans les ${G} min qui ont suivi ta réservation : c'est gratuit, rien n'est retenu.`
        : !p.outcome.late
          ? "Tu as annulé à temps : rien n'est retenu."
          : p.outcome.wasFree
            ? `C'était à moins de ${H} h : rien n'est retenu, mais ta séance offerte avec ce prof compte comme utilisée.`
            : p.outcome.retainedTnd > 0
              ? `C'était à moins de ${H} h : ${tnd(p.outcome.retainedTnd)} TND sont notés comme retenus pour ton prof dans le registre des annulations. Rien n'est prélevé pendant le pilote.`
              : "Rien n'est retenu pour cette place.",
      "",
      "Le fichier .ics joint retire la séance de ton calendrier.",
      `Tes cours : ${p.spaceUrl}`,
      `Trouver une autre séance : ${p.exploreUrl}`,
      "",
      fr.sign,
      p.unsubscribeUrl ? fr.unsubscribe(p.unsubscribeUrl) : null,
    ),
  }),

  tutorStudentCancelled: (p: { first?: string | null; cls: MailClass; student: string; late: boolean; dashboardUrl: string; unsubscribeUrl?: string | null }): MailText => ({
    subject: `Annulation : « ${p.cls.title} », le ${p.cls.date}`,
    text: lines(
      fr.hello(p.first),
      "",
      `${p.student} a annulé sa place pour « ${p.cls.title} » (${p.cls.date} à ${p.cls.time}). La place est de nouveau libre.`,
      p.late ? `Annulation tardive (moins de ${H} h avant).` : null,
      "",
      `Tes classes : ${p.dashboardUrl}`,
      "",
      fr.sign,
      p.unsubscribeUrl ? fr.unsubscribe(p.unsubscribeUrl) : null,
    ),
  }),

  studentClassCancelled: (p: { first?: string | null; cls: MailClass; spaceUrl: string; exploreUrl: string; unsubscribeUrl?: string | null }): MailText => ({
    subject: `Séance annulée : « ${p.cls.title} », le ${p.cls.date}`,
    text: lines(
      fr.hello(p.first),
      "",
      `« ${p.cls.title} » avec ${p.cls.tutorName}, prévue le ${p.cls.date} à ${p.cls.time}, est annulée. Tu ne dois rien.`,
      "",
      "Le fichier .ics joint retire la séance de ton calendrier.",
      `Tes cours : ${p.spaceUrl}`,
      `Trouver une autre séance : ${p.exploreUrl}`,
      "",
      fr.sign,
      p.unsubscribeUrl ? fr.unsubscribe(p.unsubscribeUrl) : null,
    ),
  }),

  tutorClassCancelled: (p: { first?: string | null; cls: MailClass; notified: number; dashboardUrl: string; unsubscribeUrl?: string | null }): MailText => ({
    subject: `Séance annulée : « ${p.cls.title} », le ${p.cls.date}`,
    text: lines(
      fr.hello(p.first),
      "",
      `Ta séance « ${p.cls.title} » du ${p.cls.date} à ${p.cls.time} est annulée.`,
      p.notified === 0
        ? "Personne n'avait réservé."
        : p.notified === 1
          ? "L'élève inscrit est prévenu, et sa place est libérée sans frais."
          : `Les ${p.notified} élèves inscrits sont prévenus, et leurs places sont libérées sans frais.`,
      "",
      "Le fichier .ics joint retire la séance de ton calendrier.",
      `Tes classes : ${p.dashboardUrl}`,
      "",
      fr.sign,
      p.unsubscribeUrl ? fr.unsubscribe(p.unsubscribeUrl) : null,
    ),
  }),

  studentClassMoved: (p: { first?: string | null; cls: MailClass; liveUrl: string; spaceUrl: string; unsubscribeUrl?: string | null }): MailText => ({
    subject: `Séance déplacée : « ${p.cls.title} », maintenant le ${p.cls.date} à ${p.cls.time}`,
    text: lines(
      fr.hello(p.first),
      "",
      `Ton prof a déplacé « ${p.cls.title} ».`,
      `Nouvelle date : ${fr.when(p.cls)}`,
      "",
      `Si ça ne te convient pas, tu peux annuler sans frais depuis « Mes cours » : ${p.spaceUrl}`,
      "",
      fr.liveLine,
      p.liveUrl,
      "",
      "Le fichier .ics joint met ton calendrier à jour.",
      "",
      fr.sign,
      p.unsubscribeUrl ? fr.unsubscribe(p.unsubscribeUrl) : null,
    ),
  }),

  studentReminder: (p: { first?: string | null; cls: MailClass; step: "24h" | "1h"; liveUrl: string; spaceUrl: string; unsubscribeUrl?: string | null }): MailText => ({
    subject: `Rappel : « ${p.cls.title} », le ${p.cls.date} à ${p.cls.time}`,
    text: lines(
      fr.hello(p.first),
      "",
      p.step === "1h" ? "Ta séance commence bientôt." : "Petit rappel pour ta séance.",
      `« ${p.cls.title} » avec ${p.cls.tutorName}`,
      fr.when(p.cls),
      "",
      p.step === "1h" ? "Pour rejoindre la salle, ouvre cette page :" : fr.liveLine,
      p.liveUrl,
      "",
      p.step === "24h" ? `Un empêchement ? Tu peux annuler depuis « Mes cours » : ${p.spaceUrl}` : null,
      p.step === "24h" ? "" : null,
      fr.sign,
      p.unsubscribeUrl ? fr.unsubscribe(p.unsubscribeUrl) : null,
    ),
  }),

  tutorReminder: (p: { first?: string | null; cls: MailClass; step: "24h" | "1h"; booked: number; liveUrl: string; dashboardUrl: string; unsubscribeUrl?: string | null }): MailText => ({
    subject: `Rappel : ta séance « ${p.cls.title} », le ${p.cls.date} à ${p.cls.time}`,
    text: lines(
      fr.hello(p.first),
      "",
      p.step === "1h" ? "Ta séance commence bientôt." : "Petit rappel pour ta séance.",
      `« ${p.cls.title} »`,
      fr.when(p.cls),
      p.booked === 1 ? "1 élève inscrit." : `${p.booked} élèves inscrits.`,
      "",
      "Ta salle :",
      p.liveUrl,
      `Tes classes : ${p.dashboardUrl}`,
      "",
      fr.sign,
      p.unsubscribeUrl ? fr.unsubscribe(p.unsubscribeUrl) : null,
    ),
  }),

  reviewPrompt: (p: { first?: string | null; cls: MailClass; reviewUrl: string; unsubscribeUrl?: string | null }): MailText => ({
    subject: `Comment s'est passée « ${p.cls.title} » ?`,
    text: lines(
      fr.hello(p.first),
      "",
      `Tu as suivi « ${p.cls.title} » avec ${p.cls.tutorName} le ${p.cls.date}.`,
      "Ton avis aide les autres élèves à choisir leur prof. Ça prend une minute, et c'est facultatif :",
      p.reviewUrl,
      "",
      fr.sign,
      p.unsubscribeUrl ? fr.unsubscribe(p.unsubscribeUrl) : null,
    ),
  }),
};

const ar: typeof fr = {
  icsSummary: (title: string, tutor: string) => `${title} — مع ${tutor}`,
  icsTutorSummary: (title: string) => `${title} — الحصة متاعك على Tnajem`,
  icsDescription: (liveUrl: string) => `حصة مباشرة على Tnajem.\nباش تدخل للقاعة، حلّ الصفحة هاذي : ${liveUrl}`,
  icsLocation: "أونلاين · Tnajem",

  hello: (first?: string | null) => (first ? `عسلامة ${first}،` : "عسلامة،"),
  sign: "— فريق Tnajem",
  unsubscribe: (url: string) => `باش ما عادش توصلك الإيميلات هاذي : ${url}`,
  when: (c: MailClass) => `نهار ${c.date} على ${c.time} (بتوقيت تونس)، ${c.durationMin} دقيقة.`,
  liveLine: "نهار الحصة، حلّ الصفحة هاذي : فيها الزر باش تدخل للقاعة.",
  someone: "تلميذ",
  price: (cov: Coverage) =>
    ({
      paid: `الثمن : ${paidTnd(cov)} د.ت${promoAr(cov)}. ${MONTHLY_PAYMENT_NOTE.ar}`,
      zero: "الثمن : حصة بلاش.",
      free: "الثمن : حصة فابور (أول حصة ليك مع هالأستاذ).",
      subscription: "الثمن : داخلة في الاشتراك الشهري متاعك مع هالأستاذ (تتحسب من حصصك متاع الشهر).",
    })[cov.kind],
  cancelRule: (cov: Coverage, spaceUrl: string) =>
    lines(
      `الإلغاء مجاني حتى ${H} ساعة قبل، من « حصصي » : ${spaceUrl}`,
      cov.kind === "paid" || cov.kind === "free"
        ? `بدّلت رايك ؟ في الـ${G} دقيقة اللي بعد الحجز، الإلغاء ديما بلاش (إلّا كان الحصة تبدا في أقل من ${GL} دقيقة).`
        : null,
      {
        paid: `من بعد تنجّم برك تلغي : وقتها ${ltr(`${pct} %`)} من ثمن البلاصة يتسجّل كمستحق للأستاذ. ما يتخصم حتى مليم في فترة التجربة.`,
        zero: null,
        free: "من بعد تنجّم برك تلغي، أما الحصة الفابور مع هالأستاذ تتحسب مستعملة.",
        subscription: "كان تلغي، الحصة ترجع للاشتراك متاعك متاع الشهر.",
      }[cov.kind],
    ),
  tutorPayment: (cov: Coverage) =>
    ({
      paid: `الخلاص أونلاين قريب : للوقت هذا، التلميذ يخلّصك برّا Tnajem (${paidTnd(cov)} د.ت${promoAr(cov)}).`,
      zero: "حصة بلاش : ما فما حتى خلاص.",
      free: "هاذي أول حصة ليه معاك : فابور، كيما اخترت إنت.",
      subscription: "البلاصة هاذي داخلة في الاشتراك الشهري متاعو (تتحسب من حصصو متاع الشهر).",
    })[cov.kind],

  studentConfirmed: (p) => ({
    subject: `بلاصتك محجوزة : « ${p.cls.title} »، نهار ${p.cls.date} على ${p.cls.time}`,
    text: lines(
      ar.hello(p.first),
      "",
      "بلاصتك محجوزة.",
      "",
      `« ${p.cls.title} » مع ${p.cls.tutorName}`,
      ar.when(p.cls),
      ar.price(p.coverage),
      "",
      ar.liveLine,
      p.liveUrl,
      "",
      "زيدها للأجندة متاعك : حلّ الملف .ics اللي مع الإيميل هذا، ولا نزّلو من هوني :",
      p.calendarUrl,
      "",
      ar.cancelRule(p.coverage, p.spaceUrl),
      "",
      ar.sign,
      p.unsubscribeUrl ? ar.unsubscribe(p.unsubscribeUrl) : null,
    ),
  }),

  tutorNewBooking: (p) => ({
    subject: `حجز جديد : « ${p.cls.title} »، نهار ${p.cls.date} على ${p.cls.time}`,
    text: lines(
      ar.hello(p.first),
      "",
      `${p.student} حجز بلاصة في « ${p.cls.title} ».`,
      ar.when(p.cls),
      `البلايص المحجوزة : ${p.seatsTaken} من ${p.seats}.`,
      ar.tutorPayment(p.coverage),
      "",
      "القاعة متاعك نهار الحصة :",
      p.liveUrl,
      `حصصك : ${p.dashboardUrl}`,
      "",
      "الملف .ics اللي مع الإيميل يزيد الحصة للأجندة متاعك.",
      "",
      ar.sign,
      p.unsubscribeUrl ? ar.unsubscribe(p.unsubscribeUrl) : null,
    ),
  }),

  studentCancelled: (p) => ({
    subject: `الحجز تلغى : « ${p.cls.title} »، نهار ${p.cls.date}`,
    text: lines(
      ar.hello(p.first),
      "",
      `بلاصتك في « ${p.cls.title} » (${p.cls.date} على ${p.cls.time}) تلغات. ولّات فارغة لتلميذ آخر.`,
      p.outcome.wasCovered
        ? "حتى شي ما يتحسب، والحصة ترجع للاشتراك متاعك متاع الشهر."
        : p.outcome.waived
        ? "الأستاذ بدّل وقت الحصة بعد ما حجزت : الإلغاء بلاش مصاريف."
        : p.outcome.grace && p.outcome.late
          ? `لغيت في الـ${G} دقيقة اللي بعد الحجز : بلاش، حتى شي ما يتحسب.`
        : !p.outcome.late
          ? "لغيت في الوقت : حتى شي ما يتحسب."
          : p.outcome.wasFree
            ? `كان قبل أقل من ${H} ساعة : حتى شي ما يتحسب، أما الحصة الفابور مع هالأستاذ تتحسب مستعملة.`
            : p.outcome.retainedTnd > 0
              ? `كان قبل أقل من ${H} ساعة : ${tnd(p.outcome.retainedTnd)} د.ت تسجّلو كمستحقين للأستاذ في سجلّ الإلغاءات. ما يتخصم حتى مليم في فترة التجربة.`
              : "حتى شي ما يتحسب على البلاصة هاذي.",
      "",
      "الملف .ics اللي مع الإيميل ينحّي الحصة من الأجندة متاعك.",
      `حصصك : ${p.spaceUrl}`,
      `لقّى حصة أخرى : ${p.exploreUrl}`,
      "",
      ar.sign,
      p.unsubscribeUrl ? ar.unsubscribe(p.unsubscribeUrl) : null,
    ),
  }),

  tutorStudentCancelled: (p) => ({
    subject: `إلغاء : « ${p.cls.title} »، نهار ${p.cls.date}`,
    text: lines(
      ar.hello(p.first),
      "",
      `${p.student} لغى بلاصتو في « ${p.cls.title} » (${p.cls.date} على ${p.cls.time}). البلاصة ولّات فارغة.`,
      p.late ? `إلغاء متأخّر (قبل أقل من ${H} ساعة).` : null,
      "",
      `حصصك : ${p.dashboardUrl}`,
      "",
      ar.sign,
      p.unsubscribeUrl ? ar.unsubscribe(p.unsubscribeUrl) : null,
    ),
  }),

  studentClassCancelled: (p) => ({
    subject: `الحصة تلغات : « ${p.cls.title} »، نهار ${p.cls.date}`,
    text: lines(
      ar.hello(p.first),
      "",
      `« ${p.cls.title} » مع ${p.cls.tutorName}، اللي كانت نهار ${p.cls.date} على ${p.cls.time}، تلغات. ما عليك حتى شي.`,
      "",
      "الملف .ics اللي مع الإيميل ينحّي الحصة من الأجندة متاعك.",
      `حصصك : ${p.spaceUrl}`,
      `لقّى حصة أخرى : ${p.exploreUrl}`,
      "",
      ar.sign,
      p.unsubscribeUrl ? ar.unsubscribe(p.unsubscribeUrl) : null,
    ),
  }),

  tutorClassCancelled: (p) => ({
    subject: `الحصة تلغات : « ${p.cls.title} »، نهار ${p.cls.date}`,
    text: lines(
      ar.hello(p.first),
      "",
      `الحصة متاعك « ${p.cls.title} » نهار ${p.cls.date} على ${p.cls.time} تلغات.`,
      p.notified === 0
        ? "حتى حد ما كان حاجز."
        : p.notified === 1
          ? "التلميذ اللي حاجز وصلو الخبر، وبلاصتو تحرّرت بلاش مصاريف."
          : `الـ${p.notified} تلامذة اللي حاجزين وصلهم الخبر، وبلايصهم تحرّرت بلاش مصاريف.`,
      "",
      "الملف .ics اللي مع الإيميل ينحّي الحصة من الأجندة متاعك.",
      `حصصك : ${p.dashboardUrl}`,
      "",
      ar.sign,
      p.unsubscribeUrl ? ar.unsubscribe(p.unsubscribeUrl) : null,
    ),
  }),

  studentClassMoved: (p) => ({
    subject: `الحصة تبدّل وقتها : « ${p.cls.title} »، ولّات نهار ${p.cls.date} على ${p.cls.time}`,
    text: lines(
      ar.hello(p.first),
      "",
      `أستاذك بدّل وقت « ${p.cls.title} ».`,
      `الوقت الجديد : ${ar.when(p.cls)}`,
      "",
      `كان ما يناسبكش، تنجّم تلغي بلاش مصاريف من « حصصي » : ${p.spaceUrl}`,
      "",
      ar.liveLine,
      p.liveUrl,
      "",
      "الملف .ics اللي مع الإيميل يحدّث الأجندة متاعك.",
      "",
      ar.sign,
      p.unsubscribeUrl ? ar.unsubscribe(p.unsubscribeUrl) : null,
    ),
  }),

  studentReminder: (p) => ({
    subject: `تذكير : « ${p.cls.title} »، نهار ${p.cls.date} على ${p.cls.time}`,
    text: lines(
      ar.hello(p.first),
      "",
      p.step === "1h" ? "الحصة متاعك قريب تبدا." : "تذكير صغير بالحصة متاعك.",
      `« ${p.cls.title} » مع ${p.cls.tutorName}`,
      ar.when(p.cls),
      "",
      p.step === "1h" ? "باش تدخل للقاعة، حلّ الصفحة هاذي :" : ar.liveLine,
      p.liveUrl,
      "",
      p.step === "24h" ? `عندك ظرف ؟ تنجّم تلغي من « حصصي » : ${p.spaceUrl}` : null,
      p.step === "24h" ? "" : null,
      ar.sign,
      p.unsubscribeUrl ? ar.unsubscribe(p.unsubscribeUrl) : null,
    ),
  }),

  tutorReminder: (p) => ({
    subject: `تذكير : الحصة متاعك « ${p.cls.title} »، نهار ${p.cls.date} على ${p.cls.time}`,
    text: lines(
      ar.hello(p.first),
      "",
      p.step === "1h" ? "الحصة متاعك قريب تبدا." : "تذكير صغير بالحصة متاعك.",
      `« ${p.cls.title} »`,
      ar.when(p.cls),
      p.booked === 1 ? "تلميذ واحد حاجز." : `${p.booked} تلامذة حاجزين.`,
      "",
      "القاعة متاعك :",
      p.liveUrl,
      `حصصك : ${p.dashboardUrl}`,
      "",
      ar.sign,
      p.unsubscribeUrl ? ar.unsubscribe(p.unsubscribeUrl) : null,
    ),
  }),

  reviewPrompt: (p) => ({
    subject: `كيفاش كانت « ${p.cls.title} » ؟`,
    text: lines(
      ar.hello(p.first),
      "",
      `تبّعت « ${p.cls.title} » مع ${p.cls.tutorName} نهار ${p.cls.date}.`,
      "رأيك يعاون التلامذة الآخرين باش يختارو أستاذهم. ياخو دقيقة، وموش إجباري :",
      p.reviewUrl,
      "",
      ar.sign,
      p.unsubscribeUrl ? ar.unsubscribe(p.unsubscribeUrl) : null,
    ),
  }),
};

export const BOOKING_MAIL = { fr, ar } as const;
export type MailLocale = keyof typeof BOOKING_MAIL;

/** The recipient's language: their stored profile locale, French otherwise. */
export function mailLocale(stored: string | null | undefined): MailLocale {
  return stored === "ar" ? "ar" : "fr";
}
