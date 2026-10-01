/* The OTP message copy, moved with the sender.

   Bilingual because a login code that arrives in the wrong language is a support
   ticket at best. The locale comes from the caller (the login screen knows which
   one the user is on); anything but "ar" falls back to "fr".

   espace prof v2 · phase 2: the same code also proves the mailbox before a password
   is chosen (« Mot de passe oublié », or creating one from Réglages › Sécurité). Same
   row, same budget — only the wording changes, so the e-mail says what the code is
   FOR. And the old closing line ("personne ne peut se connecter sans lui") stopped
   being true the day passwords arrived: an account with a password signs in without
   any code. */

export type OtpPurpose = "login" | "password";

export const OTP_MAIL = {
  fr: {
    subject: (code: string, purpose: OtpPurpose = "login") =>
      purpose === "password" ? `Tnajem — ton code pour le mot de passe : ${code}` : `Tnajem — ton code : ${code}`,
    body: (code: string, purpose: OtpPurpose = "login") =>
      `${purpose === "password" ? "Ton code pour choisir ton mot de passe Tnajem est :" : "Ton code de connexion Tnajem est :"}

    ${code}

` +
      `Il est valable 5 minutes. Ne le donne à personne.

` +
      (purpose === "password"
        ? `Si tu n'as pas demandé à choisir un mot de passe, ignore cet email : sans ce code, rien ne change.`
        : `Si tu n'as pas demandé ce code, ignore cet email.`),
    sms: (code: string) => `Tnajem : ton code de connexion est ${code} (valable 5 min).`,
  },
  ar: {
    subject: (code: string, purpose: OtpPurpose = "login") =>
      purpose === "password" ? `تنجّم — كود كلمة السرّ : ${code}` : `تنجّم — الكود متاعك : ${code}`,
    body: (code: string, purpose: OtpPurpose = "login") =>
      `${purpose === "password" ? "الكود باش تختار كلمة السرّ متاعك في تنجّم :" : "كود الدخول متاعك في تنجّم :"}

    ${code}

` +
      `صالح 5 دقايق. ما تعطيه لحتّى حد.

` +
      (purpose === "password"
        ? `إذا ما طلبتش تختار كلمة سرّ، ما تعبّرش لهذا الإيميل : بلا الكود هذا، حتّى شي ما يتبدّل.`
        : `إذا ما طلبتش هذا الكود، ما تعبّرش لهذا الإيميل.`),
    sms: (code: string) => `تنجّم : كود الدخول متاعك هو ${code} (صالح 5 دقايق).`,
  },
} as const;
