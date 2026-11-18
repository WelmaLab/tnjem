import { bilingual } from "@/lib/i18n";

/* december-sprint · B (D12, D13) — the copy of /pour-les-centres.

   FRENCH: the title, the subtitle, the key points (./centres-offer.ts), « À savoir »,
   the two buttons and the success line are DECEMBER_SPRINT.md's, word for word.
   ARABIC: the title and the subtitle are the founder's; the rest is ours, in the
   site's Tunisian darija, and is listed in the lane report for his native review.
   « Bac » in Arabic is « باك », so a pack is never « باك » here: it is « العرض ». */

export const PAGE_PATH = "/pour-les-centres";

export const pageCopy = bilingual({
  fr: {
    metaTitle: "Votre stage de décembre en ligne, prêt en 72 heures",
    metaDescription:
      "Tnajem met en ligne les cours de votre centre : une page par prof, votre planning et les réservations. Vous gardez vos élèves, vos prix et vos profs.",
    crumb: "Pour les centres",
    pill: "Pour les centres",
    h1: "Votre stage de décembre, aussi en ligne. Prêt en 72 heures.",
    lead: "Tnajem met en ligne les cours de votre centre : une page par prof, votre planning et les réservations. Vous gardez vos élèves, vos prix et vos profs.",
    demo: "Demander une démo de 10 minutes",
    whatsapp: "Écrire sur WhatsApp",
    pointsTitle: "Comment ça marche",
    knowTitle: "À savoir",
    know: "Pendant le pilote, les élèves doivent avoir 18 ans ou plus. Cela couvre les classes de Bac et les adultes.",
    packsTitle: "Les packs",
    contactTitle: "Vous préférez WhatsApp ?",
    emailLabel: "Ou par email",
  },
  ar: {
    metaTitle: "ستاج ديسمبر أونلاين، حاضر في 72 ساعة",
    metaDescription:
      "تنجّم تحضّرلك فضاء أونلاين باسم المركز: صفحة لكل أستاذ، البرنامج والحجز. تلامذتك، أسوامك وأساتذتك يقعدوا عندك.",
    crumb: "للمراكز",
    pill: "للمراكز",
    h1: "ستاج ديسمبر متاعك، أونلاين زادة. حاضر في 72 ساعة.",
    lead: "تنجّم تحضّرلك فضاء أونلاين باسم المركز: صفحة لكل أستاذ، البرنامج والحجز. تلامذتك، أسوامك وأساتذتك يقعدوا عندك.",
    demo: "اطلب ديمو في 10 دقايق",
    whatsapp: "ابعثلنا على WhatsApp",
    pointsTitle: "كيفاش يخدم",
    knowTitle: "خلّي في بالك",
    know: "في فترة التجربة، لازم التلامذة يكون عمرهم 18 سنة ولا أكثر. هذا يشمل أقسام الباك والكبار.",
    packsTitle: "العروض",
    contactTitle: "تحب WhatsApp خير؟",
    emailLabel: "ولا بالإيميل",
  },
});

export const formCopy = bilingual({
  fr: {
    title: "Demander une démo de 10 minutes",
    name: "Votre nom",
    centreName: "Nom du centre",
    city: "Ville",
    phone: "Téléphone ou WhatsApp",
    teachers: "Nombre de profs",
    levels: "Niveaux enseignés",
    message: "Message (facultatif)",
    honeypot: "Ne remplissez pas ce champ",
    submit: "Envoyer la demande",
    sending: "Envoi…",
    success: "Merci, on vous contacte sous 24 heures.",
    errName: "Écrivez votre nom (2 caractères au moins).",
    errCentre: "Écrivez le nom du centre.",
    errCity: "Écrivez la ville.",
    errPhone: "Ce numéro n'est pas valide (8 à 20 chiffres).",
    errTeachers: "Un nombre entre 1 et 500.",
    errLevels: "Choisissez parmi les niveaux proposés.",
    errTooLong: "Ce texte est trop long.",
    errRate: "Trop de demandes depuis cette connexion. Réessayez dans une heure.",
    errGeneric: "Une erreur s'est produite. Réessayez.",
  },
  ar: {
    title: "اطلب ديمو في 10 دقايق",
    name: "إسمك",
    centreName: "إسم المركز",
    city: "المدينة",
    phone: "تليفون ولا WhatsApp",
    teachers: "عدد الأساتذة",
    levels: "المستويات اللي تقرّيوها",
    message: "ميساج (موش لازم)",
    honeypot: "ما تعمّرش الخانة هاذي",
    submit: "ابعث الطلب",
    sending: "قاعد يتبعث…",
    success: "يعيشك، نكلّموك في ظرف 24 ساعة.",
    errName: "اكتب إسمك (حرفين على الأقل).",
    errCentre: "اكتب إسم المركز.",
    errCity: "اكتب المدينة.",
    errPhone: "النومرو هذا موش صحيح (من 8 لـ 20 رقم).",
    errTeachers: "عدد بين 1 و 500.",
    errLevels: "اختار من المستويات اللي فوق.",
    errTooLong: "النص هذا طويل برشا.",
    errRate: "برشا طلبات من نفس الكونيكسيون. عاود بعد ساعة.",
    errGeneric: "صار مشكل. عاود.",
  },
});
