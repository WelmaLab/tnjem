/* espace prof v2 · phase 2 — the e-mail sent after every password set, change and
   reset (lib/password.ts::sendPasswordNotice). Plain text, FR and Derja, same tone as
   the code e-mail (otp-copy.ts).

   It states only what just happened and the one thing to do if it was not them:
   « Mot de passe oublié » on the sign-in page, which proves the mailbox again,
   replaces the password and signs every device out. No support address is quoted —
   none is promised elsewhere in the product yet. */

export type PasswordEvent = "set" | "change" | "reset";

const FR_WHAT: Record<PasswordEvent, string> = {
  set: "Un mot de passe vient d'être créé pour ton compte Tnajem",
  change: "Le mot de passe de ton compte Tnajem vient d'être modifié",
  reset: "Le mot de passe de ton compte Tnajem vient d'être réinitialisé",
};

const AR_WHAT: Record<PasswordEvent, string> = {
  set: "تعملت كلمة سرّ جديدة لحسابك في تنجّم",
  change: "كلمة السرّ متاع حسابك في تنجّم تبدّلت",
  reset: "كلمة السرّ متاع حسابك في تنجّم تعاودت",
};

export const PASSWORD_MAIL = {
  fr: {
    subject: (e: PasswordEvent) => (e === "set" ? "Tnajem — mot de passe créé" : "Tnajem — mot de passe modifié"),
    body: (e: PasswordEvent, date: string, time: string) =>
      `${FR_WHAT[e]}, le ${date} à ${time} (heure de Tunis).

` +
      `Par sécurité, tes autres appareils ont été déconnectés.

` +
      `Ce n'est pas toi ? Va sur la page de connexion, choisis « Mot de passe oublié » : ` +
      `un code envoyé à cette adresse te permettra d'en choisir un nouveau, et tous les appareils seront déconnectés.`,
  },
  ar: {
    subject: (e: PasswordEvent) => (e === "set" ? "تنجّم — كلمة سرّ جديدة" : "تنجّم — كلمة السرّ تبدّلت"),
    body: (e: PasswordEvent, date: string, time: string) =>
      `${AR_WHAT[e]}، نهار ${date} على ${time} (بتوقيت تونس).

` +
      `للأمان، خرّجناك من الأجهزة الأخرى الكل.

` +
      `موش إنتي ؟ امشي لصفحة الدخول واختار « نسيت كلمة السرّ » : ` +
      `كود يوصلك على العنوان هذا يخلّيك تختار كلمة سرّ جديدة، والأجهزة الكل يخرجو.`,
  },
} as const;
