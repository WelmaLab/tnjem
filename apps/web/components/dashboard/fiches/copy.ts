import { bilingual } from "@/lib/i18n";

/* live-fixes-1 · B — the words of « Mes fiches » (the page, its rows, the edit
   dialog and the library form), FR + Tunisian Derja. One object so the three files
   cannot drift apart on the same word. */
export const fichesCopy = bilingual({
  fr: {
    title: "Mes fiches",
    sub: "Tes fiches, tes corrigés et tes vidéos : sur ta page avec ton prix, ou seulement pour tes élèves.",
    newPack: "Nouvelle fiche",
    listTitle: "Tes fiches",
    emptyT: "Pas encore de fiche",
    emptyB: "Un PDF, une image ou une vidéo YouTube : sur ta page avec ton prix, et le fichier pour tes élèves inscrits.",
    emptyCta: "Créer ma 1ʳᵉ fiche",
    emptyNoPage: "Commence par ta page : tes fiches s'y afficheront.",
    emptyNoPageCta: "Créer ma page",

    // a row
    free: "Gratuit",
    noPrice: "Sans prix",
    priceLabel: "Prix",
    open: "Ouvrir",
    video: "Vidéo YouTube",
    noSource: "Pas de fichier",
    forStudents: "pour tes élèves inscrits",
    classLabel: "Séance :",
    classCancelled: "annulée",
    onPage: "Sur ta page",
    notOnline: "Sur ta page dès ta vérification",
    shareAria: (t: string) => `Partager « ${t} »`,
    editAria: (t: string) => `Modifier « ${t} »`,
    removeAria: (t: string) => `Retirer « ${t} »`,

    // removing
    removeTitle: (t: string) => `Retirer « ${t} » ?`,
    removeBody: "Plus personne n'y aura accès, tes élèves non plus. Ça ne se défait pas.",
    removePackBody: "Elle disparaît de ta page, et son fichier n'est plus accessible à tes élèves. Ça ne se défait pas.",
    removePackBodyNoFile: "Elle disparaît de ta page. Ça ne se défait pas.",
    removeYes: "Retirer",
    keep: "Garder",
    okRemoved: "Retiré de ta bibliothèque.",
    okPackRemoved: "Fiche retirée de ta page.",

    // the library form
    libT: "Pour tes élèves seulement",
    libB: "Un corrigé, une fiche ou une vidéo sans prix, pas affiché sur ta page : tu choisis qui peut l'ouvrir.",
    libOpen: "Ajouter un fichier ou une vidéo",
    libClose: "Fermer le formulaire",
    fTitle: "Titre",
    fTitlePh: "Fiche de révision — Intégrales",
    fDesc: "Description (optionnel)",
    fDescPh: "Ce qu'il y a dedans, en une ligne.",
    fSource: "Le contenu",
    srcFile: "Un fichier",
    srcVideo: "Une vidéo YouTube",
    fYoutube: "Lien YouTube",
    fYoutubePh: "https://www.youtube.com/watch?v=…",
    fYoutubeHelp: "On n'enregistre que l'identifiant de la vidéo, et on l'affiche sans cookie de suivi.",
    fClass: "Séance (optionnel)",
    fClassNone: "Aucune séance en particulier",
    fVis: "Qui peut l'ouvrir",
    visPublic: "Tout le monde",
    visStudents: "Tous mes élèves",
    visThisClass: "Élèves de cette séance",
    visPrivate: "Moi seulement",
    visHelp: "Par défaut, seuls tes élèves inscrits y ont accès. Rattaché à une séance : seulement les élèves inscrits à cette séance.",
    submit: "Ajouter",
    submitting: "Envoi…",
    okAdded: "Ajouté. C'est visible selon le réglage choisi.",

    // the edit dialog
    editT: "Modifier la fiche",
    fMeta: "Détail (optionnel)",
    fPrice: "Prix",
    priceHelp: "Affiché sur ta page. Rien ne s'achète sur Tnajem pour l'instant.",
    save: "Enregistrer",
    cancel: "Annuler",
    saved: "Fiche enregistrée.",

    // refusals
    errTitle: "Donne un titre (3 caractères au moins).",
    errMeta: "Ce détail ne peut pas dépasser 200 caractères.",
    errDesc: "La description ne peut pas dépasser 1000 caractères.",
    errPrice: "Le prix doit être entre 0 et 5000 TND.",
    errSource: "Choisis un fichier OU un lien YouTube.",
    errBoth: "Un fichier ou une vidéo, pas les deux.",
    errYoutube: "Ce lien n'est pas une vidéo YouTube.",
    errType: "Format refusé. PDF, PNG, JPEG ou WEBP.",
    errSize: "Fichier trop lourd (8 Mo max).",
    errQuota: "Ton espace de fichiers est plein. Retire un ancien fichier.",
    errNotVerified: "Ton profil doit d'abord être vérifié.",
    errContact: "Enlève le numéro, l'email ou le lien : les coordonnées ne sont pas autorisées.",
    errGeneric: "Ça n'a pas marché. Réessaie.",
  },
  ar: {
    title: "ملفاتي",
    sub: "ملفاتك، إصلاحاتك وفيديوهاتك: في صفحتك بالسوم متاعك، ولا كان لتلامذتك.",
    newPack: "ملف جديد",
    listTitle: "الملفات متاعك",
    emptyT: "ما فمّا حتى ملف لتوّا",
    emptyB: "PDF، صورة ولا فيديو يوتيوب: في صفحتك بالسوم متاعك، والملف لتلامذتك المسجّلين.",
    emptyCta: "اعمل أوّل ملف",
    emptyNoPage: "ابدا بصفحتك: الملفات متاعك تبان فيها.",
    emptyNoPageCta: "اعمل صفحتي",

    free: "فابور",
    noPrice: "بلا سوم",
    priceLabel: "السوم",
    open: "حلّ",
    video: "فيديو يوتيوب",
    noSource: "ما فماش ملف",
    forStudents: "لتلامذتك المسجّلين",
    classLabel: "الحصة:",
    classCancelled: "ملغية",
    onPage: "في صفحتك",
    notOnline: "يبان في صفحتك كي يتثبّت حسابك",
    shareAria: (t: string) => `شارك « ${t} »`,
    editAria: (t: string) => `بدّل « ${t} »`,
    removeAria: (t: string) => `نحّي « ${t} »`,

    removeTitle: (t: string) => `تنحّي « ${t} » ؟`,
    removeBody: "حتى حد ما عاد يوصلو، حتى تلامذتك. ما تنجّمش ترجّعو.",
    removePackBody: "يتنحّى من صفحتك، والملف متاعو ما عادش يوصلولو تلامذتك. ما تنجّمش ترجّعو.",
    removePackBodyNoFile: "يتنحّى من صفحتك. ما تنجّمش ترجّعو.",
    removeYes: "نحّي",
    keep: "خلّيه",
    okRemoved: "تنحّى من مكتبتك.",
    okPackRemoved: "الملف تنحّى من صفحتك.",

    libT: "لتلامذتك برك",
    libB: "إصلاح، ملف ولا فيديو بلا سوم، ما يبانش في صفحتك: إنت تختار شكون ينجّم يحلّو.",
    libOpen: "زيد ملف ولا فيديو",
    libClose: "سكّر الفورمولار",
    fTitle: "العنوان",
    fTitlePh: "ملف — التكامل",
    fDesc: "الوصف (اختياري)",
    fDescPh: "شنوّة فيه، في سطر.",
    fSource: "المحتوى",
    srcFile: "ملف",
    srcVideo: "فيديو يوتيوب",
    fYoutube: "رابط يوتيوب",
    fYoutubePh: "https://www.youtube.com/watch?v=…",
    fYoutubeHelp: "نسجّلو برك معرّف الفيديو، ونعرضوه بلا كوكي تتبّع.",
    fClass: "الحصة (اختياري)",
    fClassNone: "موش مربوطة بحصة",
    fVis: "شكون ينجّم يحلّو",
    visPublic: "الكلّ",
    visStudents: "تلامذتي الكل",
    visThisClass: "تلامذة الحصة هاذي",
    visPrivate: "أنا برك",
    visHelp: "بالافتراض، تلامذتك المسجّلين برك يوصلولو. كان تربطو بحصة: كان التلامذة اللي حاجزين في الحصة هاذي.",
    submit: "زيد",
    submitting: "قاعد يبعث…",
    okAdded: "تزاد. يبان حسب الإعداد اللي اخترت.",

    editT: "بدّل الملف",
    fMeta: "التفاصيل (اختياري)",
    fPrice: "السوم",
    priceHelp: "يبان في صفحتك. ما فمّا شي يتشرى على Tnajem لتوّا.",
    save: "سجّل",
    cancel: "ارجع",
    saved: "الملف تسجّل.",

    errTitle: "أعطي عنوان (3 حروف على الأقلّ).",
    errMeta: "التفاصيل ما تنجّمش تفوت 200 حرف.",
    errDesc: "الوصف ما ينجّمش يفوت 1000 حرف.",
    errPrice: "السوم لازم يكون بين 0 و 5000 د.ت.",
    errSource: "اختار ملف ولا رابط يوتيوب.",
    errBoth: "ملف ولا فيديو، موش الزوز.",
    errYoutube: "الرابط هذا موش فيديو يوتيوب.",
    errType: "الصيغة مرفوضة. PDF، PNG، JPEG ولا WEBP.",
    errSize: "الملف ثقيل برشا (8 ميڨا أقصى).",
    errQuota: "البلاصة متاع ملفاتك تعبّات. نحّي ملف قديم.",
    errNotVerified: "لازم بروفايلك يتثبّت الأول.",
    errContact: "نحّي النمرة، الإيميل ولا الرابط: معلومات الاتصال موش مسموحة.",
    errGeneric: "ما مشاتش. عاود حاول.",
  },
});

export type FichesCopy = (typeof fichesCopy)["fr"] | (typeof fichesCopy)["ar"];

/** A server refusal → the sentence to show. */
export function ficheError(c: FichesCopy, code: string | undefined): string {
  switch (code) {
    case "one-source-only": return c.errBoth;
    case "invalid-youtube-url": return c.errYoutube;
    case "file-required": return c.errSource;
    case "bad-file-type": return c.errType;
    case "file-too-large": return c.errSize;
    case "storage-quota-reached": return c.errQuota;
    case "not-verified": return c.errNotVerified;
    case "contact-info-not-allowed": return c.errContact;
    case "invalid-title":
    case "title-too-short":
    case "title-too-long": return c.errTitle;
    case "meta-too-long": return c.errMeta;
    case "description-too-long": return c.errDesc;
    case "invalid-price":
    case "negative-price":
    case "price-too-high": return c.errPrice;
    default: return c.errGeneric;
  }
}
