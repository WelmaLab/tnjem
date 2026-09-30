"use client";
/* ───────────────────────────────────────────────────────────────────────────
   /terms — Conditions d'utilisation (FR + AR).

   ⚠️  DRAFT / MODÈLE. Written by the product team, NOT by a lawyer. It must be
   reviewed by a Tunisian lawyer before go-live. The dated "modèle — à faire
   relire par un avocat" banner at the top of the page is deliberate: do not
   remove it until counsel has signed off and the bracketed placeholders
   (company form, registered office, matricule fiscal, competent court) are
   filled in.

   Self-contained bilingual copy lives in `copy` below (same pattern as
   /pour-les-profs). Design system: SiteShell + .panel + .container-narrow.
   RTL-safe: logical properties only. Page-scoped CSS is prefixed `lg-` and
   injected with dangerouslySetInnerHTML (an inline <style>{`…`}</style> inside a
   client component causes hydration errors).

   phase-a lane L6 (A19, 24 Sept 2026) — rewritten against the merged Phase A code:
   the adult-only pilot (A24/A14), reporting a message needs a participant's account,
   conversations that close (A2), the whole-handle contact mask (A1), moderation
   that can hide a message or a review (A28), tutors shown as first name + initial
   (A23), the free first session once per student per tutor (A6), the waived late
   cancel (A21), the phone used only for Tnajem's own SMS (A3), and the one payment
   story, labelled « Bientôt » (A22/D4). The old "arrange payment outside Tnajem"
   paragraph is gone (it told the cash-to-the-tutor story D4 retired).
   Proof: apps/api/test/legal-truth.test.ts + e2e/legal-truth.spec.ts.
   ─────────────────────────────────────────────────────────────────────────── */
import { Link } from "@/components/Link";
import { SiteShell } from "@/components/SiteShell";
import { useLocale } from "@/components/LocaleProvider";
import { PaymentStory } from "@/components/PaymentStory";
import {
  DELETION_GRACE_DAYS, MINOR_AGE_YEARS, TERMS_VERSION, THREAD_CLOSE_DAYS, formatLongDate, type PaymentAudience,
} from "@tnajem/shared";

/* Describes what is implemented (Stage 5, rewritten 15 Sept 2026; Phase A, 24 Sept 2026).
   Numbers come from @tnajem/shared; bracketed passages are open questions for counsel. */
const versionDate = (locale: "fr" | "ar") => formatLongDate(`${TERMS_VERSION}T12:00:00Z`, locale);

/* `story`: the one payment sentence (A22), rendered by <PaymentStory> with its
   visible « Bientôt » label — never as plain text that could read as true today. */
type Section = {
  h: string;
  p?: string[];
  list?: string[];
  after?: string[];
  story?: { audience: PaymentAudience; note: string };
};
type LegalCopy = {
  notice: string;
  noticeSub: string;
  eyebrow: string;
  title: string;
  updated: string;
  lead: string;
  sections: Section[];
  seeAlso: string;
};

const CSS = `
.lg-notice{display:flex;gap:12px;align-items:flex-start;padding:14px 16px;margin-bottom:26px;
  background:var(--rose50);border:1px solid rgba(226,72,61,.28);border-radius:var(--r);}
.lg-notice .ic{color:var(--rose);flex:none;margin-top:2px}
.lg-notice b{display:block;color:var(--rose700);font-size:14px;line-height:1.5}
.lg-notice span{display:block;margin-top:4px;color:var(--rose600);font-size:13px;line-height:1.6}
.lg-head{margin-bottom:24px}
.lg-head .web-h2{margin:8px 0 6px}
.lg-updated{font-size:13px;font-weight:700;color:var(--muted);margin-bottom:14px}
.lg-doc h2{font-family:var(--fd);font-size:18px;line-height:1.35;margin:30px 0 10px;color:var(--ink)}
.lg-doc h2:first-child{margin-top:0}
.lg-doc p{font-size:15px;line-height:1.75;color:var(--ink2);margin-bottom:10px}
.lg-doc ul{margin:6px 0 12px;padding-inline-start:20px;list-style:disc}
.lg-doc li{font-size:15px;line-height:1.75;color:var(--ink2);margin-bottom:6px}
.lg-doc hr{border:0;height:1px;background:var(--line);margin:26px 0 0}
.lg-seealso{margin-top:20px;font-size:14px}
`;

const copy: { fr: LegalCopy; ar: LegalCopy } = {
  fr: {
    notice: "Modèle — à faire relire par un avocat avant la mise en ligne.",
    noticeSub:
      `Version du ${versionDate("fr")}. Ce texte est un projet rédigé par l'équipe produit pour cadrer le service. Il décrit ce que le service fait à cette date, mais il ne constitue pas un conseil juridique et n'a pas encore été validé par un avocat. Les passages entre crochets restent à compléter par l'avocat.`,
    eyebrow: "Légal",
    title: "Conditions d'utilisation",
    updated: `Version du ${versionDate("fr")}`,
    lead:
      "Ces conditions expliquent, en langage simple, ce que Tnajem fait, ce que Tnajem ne fait pas, et les règles que chacun accepte en utilisant la plateforme. En créant un compte ou en réservant une séance, tu les acceptes.",
    sections: [
      {
        h: "1. Ce qu'est Tnajem (et ce qu'il n'est pas)",
        p: [
          "Tnajem (تنجّم) est une plateforme de mise en relation. Elle permet à des élèves — et à leurs parents — de trouver des profs particuliers indépendants en Tunisie, de voir leurs séances et de réserver une place.",
          "Tnajem n'est pas une école, ne délivre aucun diplôme, et n'est pas l'employeur des profs. Les profs sont indépendants : ils choisissent leurs matières, leurs horaires, leur méthode et leurs prix. Le cours lui-même est un accord entre l'élève (ou son parent) et le prof. Tnajem fournit l'outil, pas l'enseignement.",
          "Tnajem ne garantit aucun résultat scolaire, aucune note et aucun niveau.",
        ],
      },
      {
        h: "2. Qui peut utiliser Tnajem",
        p: [
          "Il faut être une personne physique et donner des informations exactes. Un compte est personnel : tu ne le partages pas et tu es responsable de ce qui en est fait.",
          // A24 / A14 — packages/shared/src/age.ts isAdult(): adult once the month of the 18th birthday is over (Africa/Tunis).
          "Pendant le pilote, Tnajem est réservé aux 18 ans et plus, élèves comme profs. À l'inscription, tu indiques ton mois et ton année de naissance : tu comptes comme majeur à partir du mois qui suit celui de tes 18 ans.",
        ],
        list: [
          "Élève de 18 ans ou plus : tu peux créer ton compte toi-même.",
          // LEGAL-REVIEW: age threshold (MINOR_AGE_YEARS). The guardian-consent flow stays in the code behind ALLOW_MINORS.
          `Élève de moins de ${MINOR_AGE_YEARS} ans : l'inscription est refusée pendant le pilote, et un compte d'élève de moins de ${MINOR_AGE_YEARS} ans ne peut réserver aucune séance. Si Tnajem s'ouvre un jour aux moins de ${MINOR_AGE_YEARS} ans, ces conditions seront mises à jour avant.`,
          "Prof : tu dois avoir 18 ans ou plus (cette règle vaut toujours, pas seulement pendant le pilote), pouvoir prouver ton identité (voir article 9), déclarer que tu n'enseignes pas dans un établissement d'enseignement public (décret n° 2015-1619), et être en règle avec tes propres obligations (statut, fiscalité, autorisations éventuelles). Tnajem ne s'en charge pas à ta place.",
        ],
      },
      {
        h: "3. Compte, e-mail et code de connexion",
        p: [
          "La connexion se fait avec ton adresse e-mail et un code à usage unique qu'on t'envoie par e-mail. Ce code est personnel et temporaire : ne le communique jamais, à personne. Tnajem ne te demandera jamais ton code par téléphone, par WhatsApp ou par message.",
          // A3: the phone feeds notify()'s SMS only (booking confirmation, verification result); no API sends it to the other party.
          "Ton numéro de téléphone est facultatif. Il sert uniquement aux messages que Tnajem peut t'envoyer sur ton compte et tes séances ; il n'est jamais montré à un prof ou à un élève, et ne sert jamais à te connecter.",
          "Si tu perds l'accès à ton adresse e-mail, écris-nous : nous pouvons devoir vérifier ton identité avant de rétablir l'accès.",
        ],
      },
      {
        h: "4. Les profs fixent leurs prix",
        p: [
          "Chaque prof affiche librement le prix de ses séances, en dinar tunisien (TND), ainsi que la durée, le nombre de places et le contenu. Tnajem n'impose aucun tarif et ne négocie pas à la place du prof.",
          "Les prix affichés sont ceux du prof. Le prof est seul responsable de ses obligations fiscales et déclaratives liées à ses revenus.",
        ],
      },
      {
        h: "5. La première séance offerte",
        p: [
          "Un prof peut choisir d'offrir la première séance à un nouvel élève. Quand c'est le cas, c'est indiqué clairement sur sa page.",
          "L'offre est limitée à une séance gratuite par élève et par prof. Elle ne peut être ni revendue, ni cumulée, ni transformée en argent. Un prof peut retirer l'offre pour ses futures séances à tout moment ; cela n'affecte pas une séance gratuite déjà réservée.",
          // A6 (D2): apps/api/src/routes/bookings.ts freeFirstSeatFor + packages/shared/src/free-first.ts cancelSpendsFreeFirst.
          "Si tu annules ta séance offerte moins de 48 heures avant le début, elle compte comme utilisée. Si tu l'annules à temps, si le prof l'annule, ou si le prof a déplacé la séance après ta réservation, tu la gardes pour une prochaine séance avec ce prof.",
        ],
      },
      {
        /* A22 / D4 — ONE payment story, and not today. The "s'arranger financièrement en dehors
           de Tnajem" paragraph is deleted: it described paying the tutor off-platform, the
           story D4 retired (and article 8 forbids exchanging the contact details it needs).
           No provider, card or wallet is named (Phase E decides). LEGAL-REVIEW: whether the
           terms need a clause on payments while the pilot collects none. */
        h: "6. Paiements : pas encore actifs",
        p: [
          "Aujourd'hui, Tnajem n'encaisse aucun paiement : aucun montant n'est débité via la plateforme, et réserver une séance ne déclenche aucun prélèvement.",
          "Les éléments liés au paiement que tu peux voir dans l'application décrivent une fonctionnalité en préparation. Ils ne s'appliquent pas tant que les paiements ne sont pas officiellement activés — ce qui suppose les accords, agréments et vérifications nécessaires.",
        ],
        story: {
          audience: "student",
          note: "C'est ainsi que les paiements fonctionneront une fois activés — pas encore aujourd'hui. Ces conditions seront alors mises à jour, et tu en seras informé avant que cela ne s'applique à toi.",
        },
      },
      {
        h: "7. Réservation et annulation (règle des 48 h)",
        p: ["Une séance a un nombre de places limité. La réservation est confirmée dans la limite des places disponibles."],
        list: [
          "Tu peux annuler gratuitement jusqu'à 48 heures avant le début de la séance. Exactement 48 heures avant compte encore comme « à temps ».",
          "À moins de 48 heures du début, tu peux toujours annuler et ta place est immédiatement remise à disposition. 40 % du prix de la place est alors enregistré comme retenu pour le prof, au titre du créneau qu'il avait bloqué.",
          "Ce pourcentage est aujourd'hui une écriture, pas un prélèvement : Tnajem n'encaisse aucun paiement pendant le pilote et aucun montant ne t'est débité. Si les paiements sont activés un jour, ces conditions seront mises à jour et tu en seras informé avant.",
          "Une séance qui a déjà commencé ne peut plus être annulée en ligne.",
          "Une séance offerte vaut zéro : 40 % de zéro reste zéro, même en cas d'annulation tardive.",
          // A21: packages/shared/src/cancellation.ts movedAfterBooking() waives the late share.
          "Si le prof a déplacé la séance après ta réservation, rien n'est retenu, même si tu annules moins de 48 heures avant.",
          "Si le prof annule ou ne se présente pas, tu ne dois rien et la séance est reprogrammée ou annulée.",
          "Les annulations répétées de dernière minute (élève ou prof) peuvent entraîner une suspension du compte.",
        ],
      },
      {
        h: "8. Règles d'usage",
        p: ["En utilisant Tnajem, tu t'engages à ne pas :"],
        list: [
          "échanger des coordonnées personnelles (numéro, email, lien, compte de messagerie) avec un prof ou un élève en dehors de Tnajem ;",
          "harceler, insulter, menacer ou discriminer qui que ce soit — élève, parent ou prof ;",
          "publier un contenu illégal, violent, haineux, sexuel, ou inadapté à des mineurs ;",
          "usurper l'identité d'une autre personne, ou mentir sur tes diplômes et ton expérience ;",
          "enregistrer, filmer ou rediffuser une séance sans l'accord clair de toutes les personnes présentes ;",
          "revendre, copier ou redistribuer les cours, fiches et enregistrements d'un prof ;",
          "utiliser des robots ou du scraping pour extraire des données de la plateforme ;",
          "envoyer du spam, de la publicité, ou détourner Tnajem de son objet éducatif.",
        ],
        after: [
          // Reporting a message: POST /messages/:id/report needs a session and a participant (apps/api/test/legal-truth.test.ts).
          "Chacun peut signaler la page d'un prof, une séance ou un document avec le bouton « Signaler », même sans être connecté. Un message se signale depuis sa conversation, par l'élève ou le prof qui y participe, connecté à son compte — même quand la conversation est fermée. Un signalement ne retire rien automatiquement : une personne de l'équipe le lit et décide.",
          "Les documents et vidéos que tu publies restent les tiens, mais tu garantis avoir le droit de les partager. Un ayant droit peut demander le retrait d'un document sans avoir de compte chez nous, depuis le bouton « Signaler » du document ; nous examinons la demande, et si elle est fondée le document est retiré et un avertissement est enregistré sur le compte du prof. Les avertissements sont comptés, jamais appliqués automatiquement — une décision de suspension est prise par une personne.",
          // A23 (D1): students see "Prénom N."; the conversation shows the first name only (said so since phase-a/verify-fix D12).
          "Les coordonnées personnelles restent privées des deux côtés. Un prof voit le prénom de son élève, jamais son numéro ni son e-mail ; un élève voit le prénom de son prof et l'initiale de son nom (par exemple « Sami B. ») — dans une conversation, son prénom seulement —, jamais son nom complet, son numéro ni son e-mail. Nous ne transmettons ces informations à personne.",
          // A1: packages/shared/src/contact-info.ts masks the union span — the whole handle or number, with its link.
          "Les textes que tu écris — page de prof, séance, avis, message — sont analysés automatiquement pour repérer un numéro, un e-mail, un lien ou un nom de messagerie. Sur ta page et tes séances, l'enregistrement est refusé et tu peux corriger. Dans un avis ou un message, les coordonnées sont masquées en entier — le numéro ou l'identifiant, avec le lien qui le porte (wa.me, t.me, Facebook, Instagram…) — et le reste de ton texte est publié tel quel. Nous conservons le TYPE de ce qui a été détecté, jamais le texte détecté lui-même.",
          // A2: apps/api/src/lib/thread-state.ts threadState().
          `Chaque réservation permet d'ouvrir une conversation entre l'élève et le prof. Elle se ferme tout de suite quand la réservation est annulée, quand l'un des deux comptes est suspendu ou quand un parent retire son accord, et sinon ${THREAD_CLOSE_DAYS} jours après la fin de la séance. Une conversation fermée reste lisible, et on peut encore y signaler un message, mais plus personne ne peut y écrire.`,
          /* A28: POST /admin/moderation/hide (reason required, audited; the text is kept for admins).
             LEGAL-REVIEW: retention of hidden content kept as evidence. */
          "En cas de manquement, nous pouvons masquer un message ou un avis, retirer un document ou suspendre un compte — sans préavis lorsque la sécurité des utilisateurs, en particulier des mineurs, l'exige. Un message ou un avis masqué est remplacé, pour tout le monde, par « Contenu retiré par la modération » ; son texte est conservé comme preuve, et seuls les administrateurs peuvent encore le lire. Chaque retrait est décidé par une personne de l'équipe, avec un motif, et enregistré.",
        ],
      },
      {
        h: "9. Vérification des profs",
        p: [
          "Avant d'apparaître publiquement, un prof doit soumettre une pièce d'identité (CIN ou passeport, recto/verso). Les diplômes et attestations sont facultatifs et servent à renforcer la confiance.",
          // A15: approval refused without the current round's declaration. A26: rename / resubmit by a verified tutor.
          "Ces documents sont examinés manuellement par un administrateur de Tnajem, avec ta déclaration de ne pas enseigner dans un établissement public : sans elle, le dossier ne peut être ni envoyé ni approuvé. Les documents ne sont jamais publiés. Leur traitement, leur durée de conservation et leur suppression sont décrits dans la politique de confidentialité.",
          "Un prof vérifié qui change de nom reste affiché sous le nom déjà vérifié jusqu'à ce qu'un administrateur valide le nouveau. S'il envoie de nouveaux documents, il reste vérifié pendant leur examen.",
          "Le badge « Vérifié » signifie uniquement que des documents d'identité ont été présentés et contrôlés visuellement. Ce n'est ni une enquête judiciaire, ni un agrément de l'État, ni une garantie de compétence pédagogique ou de bonne conduite. Nous pouvons refuser ou retirer une vérification à tout moment.",
        ],
      },
      {
        h: "10. Contenus et propriété intellectuelle",
        p: [
          "Le prof reste propriétaire de ses cours, fiches, enregistrements et supports. En les publiant sur Tnajem, il accorde à Tnajem une licence gratuite et non exclusive, limitée à l'hébergement, l'affichage et la promotion de son offre sur la plateforme et ses canaux de communication, pour la durée de la publication.",
          "L'élève reçoit un droit d'usage strictement personnel : il peut apprendre avec ces supports, pas les revendre ni les diffuser.",
          "Le nom « Tnajem », « تنجّم », le logo et l'identité visuelle appartiennent à Tnajem et ne peuvent pas être utilisés sans autorisation écrite.",
        ],
      },
      {
        h: "11. Cours en direct et outils tiers",
        p: [
          "Les séances en direct peuvent s'appuyer sur des outils tiers (visioconférence, tableau blanc, quiz). Ces outils ont leurs propres conditions et leur propre politique de confidentialité. Tnajem ne les contrôle pas et n'est pas responsable de leur disponibilité.",
        ],
      },
      {
        h: "12. Disponibilité du service",
        p: [
          "Tnajem est fourni « en l'état ». Le service peut être interrompu pour maintenance, mise à jour ou incident technique. Nous faisons de notre mieux pour limiter ces interruptions, sans garantie de disponibilité continue.",
        ],
      },
      {
        h: "13. Responsabilité",
        p: [
          "Tnajem met en relation ; elle ne dispense pas le cours. Dans les limites permises par le droit tunisien, Tnajem n'est pas responsable du contenu pédagogique, de la qualité, du comportement ou des propos d'un prof, d'un élève ou d'un parent, ni des dommages indirects (perte de temps, perte d'une note, perte de chance).",
          "Rien dans ces conditions n'exclut la responsabilité de Tnajem en cas de dol, de faute lourde ou d'atteinte à l'intégrité physique, ni les droits que la loi tunisienne reconnaît impérativement aux consommateurs.",
        ],
      },
      {
        h: "14. Suspension et fermeture du compte",
        p: [
          `Tu peux supprimer ton compte à tout moment depuis « Mon compte ». Ce n'est pas possible tant qu'une séance est à venir : annule-la d'abord, pour que l'autre personne soit prévenue. La suppression a lieu ${DELETION_GRACE_DAYS} jours plus tard, et tu peux changer d'avis d'ici là ; ce qui est effacé et ce qui reste est décrit dans la politique de confidentialité.`,
          "Nous pouvons suspendre un compte qui enfreint ces conditions, la loi, ou qui met en danger d'autres utilisateurs. Ses séances à venir sont alors annulées sans frais, ses conversations se ferment, et les élèves d'un prof suspendu sont prévenus que la séance n'aura pas lieu.",
        ],
      },
      {
        h: "15. Modification des conditions",
        p: [
          "Ces conditions peuvent évoluer, notamment lors de l'activation des paiements. La version applicable est celle publiée sur cette page ; la version en vigueur quand tu as créé ton compte est enregistrée avec lui. [À compléter par l'avocat : comment prévenir d'un changement important, et si une nouvelle acceptation est nécessaire.]",
        ],
      },
      {
        h: "16. Droit applicable et litiges",
        p: [
          "Ces conditions sont soumises au droit tunisien. En cas de désaccord, on commence par en parler : écris-nous, nous cherchons une solution amiable. À défaut d'accord, le litige relève des tribunaux tunisiens compétents.",
          "[À compléter par l'avocat : forme sociale et dénomination exacte de l'éditeur, siège social, matricule fiscal, registre national des entreprises, tribunal compétent, éventuelle clause de médiation de la consommation.]",
        ],
      },
      {
        h: "17. Nous contacter",
        p: ["Une question sur ces conditions : contact@tnajem.com."],
      },
    ],
    seeAlso: "Voir aussi : politique de confidentialité",
  },

  ar: {
    notice: "نموذج — لازم يقراه محامي قبل ما ينشر رسميًا.",
    noticeSub:
      `نسخة ${versionDate("ar")}. النصّ هذا مسودّة كتبها فريق المنتج باش يوضّح الخدمة. يوصف شنوّة تعمل الخدمة في التاريخ هذا، أما ما هوش استشارة قانونية وما زال ما صادقش عليه محامي. اللي بين معقّفات يكمّلو المحامي.`,
    eyebrow: "قانوني",
    title: "شروط الاستعمال",
    updated: `نسخة ${versionDate("ar")}`,
    lead:
      "الشروط هاذي تشرح، بكلام بسيط، شنوّة تعمل تنجّم، شنوّة ما تعملهاش، والقواعد اللي كل واحد يقبلها كي يستعمل المنصّة. كي تعمل حساب ولا تحجز حصة، إنت تقبل بيهم.",
    sections: [
      {
        h: "1. شنوّة هي تنجّم (وشنوّة ما هيش)",
        p: [
          "تنجّم (Tnajem) هي منصّة ربط. تعاون التلاميذ — وأولياءهم — باش يلقاو أساتذة خصوصيين مستقلّين في تونس، يشوفو حصصهم ويحجزو بلاصة.",
          "تنجّم ماهيش مدرسة، ما تعطي حتى شهادة، وماهيش المشغّل متاع الأساتذة. الأساتذة مستقلّين: هوما اللي يختارو الموادّ، الأوقات، الطريقة والأسعار. الحصة روحها اتفاق بين التلميذ (ولا وليّه) والأستاذ. تنجّم توفّر الأداة، موش التدريس.",
          "تنجّم ما تضمنش حتى نتيجة دراسية ولا عدد ولا مستوى.",
        ],
      },
      {
        h: "2. شكون ينجّم يستعمل تنجّم",
        p: [
          "لازم تكون شخص طبيعي وتعطي معلومات صحيحة. الحساب شخصي: ما تشاركوش مع حتى واحد وإنت مسؤول على كل شيء يتعمل بيه.",
          // A24 / A14 — age.ts isAdult().
          "في فترة التجربة، تنجّم كان للّي عمرهم 18 سنة وفوق، تلامذة وأساتذة. كي تعمل حسابك، تعطي شهر وعام ولادتك: تتحسب راشد من الشهر اللي بعد شهر الـ18 سنة متاعك.",
        ],
        list: [
          "تلميذ عمرو 18 سنة ولا أكثر: تنجّم تعمل حسابك وحدك.",
          // LEGAL-REVIEW: age threshold (MINOR_AGE_YEARS). The guardian-consent flow stays in the code behind ALLOW_MINORS.
          `تلميذ عمرو أقلّ من ${MINOR_AGE_YEARS} سنة: الحساب يترفض في فترة التجربة، وحساب تلميذ عمرو أقلّ من ${MINOR_AGE_YEARS} سنة ما ينجّم يحجز حتى حصة. كان تنجّم تتحلّ يومًا ما للّي عمرهم أقلّ من ${MINOR_AGE_YEARS} سنة، الشروط هاذي باش تتحيّن قبل.`,
          "أستاذ: لازم يكون عمرك 18 سنة ولا أكثر (القاعدة هاذي ديما، موش كان في فترة التجربة)، تثبت هويتك (شوف الفصل 9)، تصرّح إنّك ما تقرّيش في مؤسسة تعليم عمومية (الأمر عدد 1619 لسنة 2015)، وتكون في القانون مع واجباتك (الوضعية، الجباية، الرخص إذا لزمو). تنجّم ما تعملهمش عوضك.",
        ],
      },
      {
        h: "3. الحساب، الإيميل وكود الدخول",
        p: [
          "الدخول يتمّ بالإيميل متاعك وبكود وحيد يوصلك في الإيميل. الكود هذا شخصي ووقتي: ما تعطيه لحتى واحد. تنجّم عمرها ما تطلب منّك الكود بالتليفون ولا بواتساب ولا برسالة.",
          "رقم التليفون اختياري. ما يخدم كان للرسائل اللي تنجّم تبعثهملك Tnajem على حسابك وحصصك؛ عمرو ما يتوّرى لأستاذ ولا لتلميذ، وعمرو ما يخدم للدخول.",
          "إذا ضيّعت الإيميل متاعك، اكتبلنا: نجّمو نحتاجو نتثبّتو في هويتك قبل ما نرجّعولك الدخول.",
        ],
      },
      {
        h: "4. الأساتذة هوما اللي يحدّدو أسعارهم",
        p: [
          "كل أستاذ يحطّ سعر حصصه بالدينار التونسي (TND) بكل حرّية، مع المدّة، عدد الأماكن والمحتوى. تنجّم ما تفرضش تعريفة وما تفاوضش عوض الأستاذ.",
          "الأسعار الظاهرة هي أسعار الأستاذ. الأستاذ وحدو مسؤول على واجباته الجبائية والتصريحية على مداخيله.",
        ],
      },
      {
        h: "5. الحصة الأولى مجانية",
        p: [
          "الأستاذ ينجّم يختار يعطي الحصة الأولى مجانا لتلميذ جديد. وقتها يتكتب بوضوح في صفحته.",
          "العرض محدود بحصة مجانية وحدة لكل تلميذ مع كل أستاذ. ما ينباعش، ما يتجمّعش وما يتحوّلش لفلوس. الأستاذ ينجّم ينحّي العرض على حصصه الجايّة وقت ما يحبّ؛ هذا ما يمسّش حصة مجانية محجوزة من قبل.",
          "كان تلغي الحصة المجانية متاعك أقلّ من 48 ساعة قبل ما تبدا، تتحسب مستعملة. كان تلغيها في الوقت، كان الأستاذ يلغيها، ولا كان الأستاذ بدّل وقت الحصة بعد ما حجزت، تبقالك لحصة جاية مع نفس الأستاذ.",
        ],
      },
      {
        // A22 / D4 — see the FR note: one story, not today; the off-platform paragraph is deleted.
        h: "6. الخلاص: ما زال ما تفعّلش",
        p: [
          "اليوم، تنجّم ما تقبض حتى مليم: حتى مبلغ ما يتخصم عبر المنصّة، والحجز ما يجرّ حتى خصم.",
          "كل حاجة تشوفها في التطبيق على الخلاص تخصّ ميزة ما زالت في التحضير. ما تنطبقش قبل ما الخلاص يتفعّل رسميًا — وهذا يستوجب الاتفاقات والتراخيص والتثبّتات اللازمة.",
        ],
        story: {
          audience: "student",
          note: "هكّا باش يمشي الخلاص كي يتفعّل — موش اليوم. وقتها الشروط هاذي باش تتحيّن، وباش نعلموك قبل ما تنطبق عليك.",
        },
      },
      {
        h: "7. الحجز والإلغاء (قاعدة الـ48 ساعة)",
        p: ["الحصة عندها عدد أماكن محدود. الحجز يتأكّد على قدّ الأماكن المتوفّرة."],
        list: [
          "تنجّم تلغي بلا مصاريف حتى 48 ساعة قبل بداية الحصة. 48 ساعة بالضبط ما زالت تتعدّ « في الوقت ».",
          "أقلّ من 48 ساعة قبل البداية، تنجّم برك تلغي ومكانك يرجع متوفّر على طول. وقتها 40 % من ثمن البلاصة يتسجّل كمستحق للأستاذ، مقابل الوقت اللي حبسو.",
          "هالنسبة اليوم هي قيد في الدفاتر، موش خصم: تنجّم ما تقبض حتى خلاص في فترة التجربة وما يتخصم منك حتى مليم. إذا تفعّل الخلاص في المستقبل، الشروط هاذي تتحيّن ونعلموك قبل.",
          "الحصة اللي بدات ما عادش تتلغى أونلاين.",
          "الحصة المجانية تساوي صفر: 40 % من صفر تبقى صفر، حتى كان الإلغاء متأخّر.",
          "كان الأستاذ بدّل وقت الحصة بعد ما حجزت، ما يتسجّل حتى مستحق للأستاذ، حتى كان تلغي أقلّ من 48 ساعة قبل.",
          "إذا الأستاذ لغى ولا ما جاش، ما عليك والو والحصة تتبرمج من جديد ولا تتلغى.",
          "الإلغاء المتكرّر في آخر لحظة (تلميذ ولا أستاذ) ينجّم يجرّ تعليق الحساب.",
        ],
      },
      {
        h: "8. قواعد الاستعمال",
        p: ["كي تستعمل تنجّم، إنت تلتزم ما تعملش:"],
        list: [
          "تبادل معلومات الاتصال الشخصية (نمرة، إيميل، رابط، حساب مراسلة) مع أستاذ ولا تلميذ برّة تنجّم؛",
          "مضايقة، شتيمة، تهديد ولا تمييز ضدّ أيّ واحد — تلميذ، وليّ ولا أستاذ؛",
          "نشر محتوى غير قانوني، عنيف، فيه كراهية، جنسي، ولا ما يصلحش للقاصرين؛",
          "انتحال شخصية غيرك، ولا الكذب على شهائدك وخبرتك؛",
          "تسجيل ولا تصوير حصة، ولا تعاود تنشرها، من غير موافقة واضحة من الكلّ؛",
          "بيع ولا نسخ ولا توزيع دروس وملخّصات وتسجيلات أستاذ؛",
          "استعمال روبوات ولا أدوات آلية باش تسحب البيانات من المنصّة؛",
          "إرسال سبام ولا إشهار، ولا استعمال تنجّم في حاجة ما عندهاش علاقة بالتعليم.",
        ],
        after: [
          "كل واحد ينجّم يبلّغ على صفحة أستاذ، حصة ولا وثيقة بزرّ « بلّغ »، حتى من غير ما يدخل لحسابو. الرسالة تتبلّغ من المحادثة متاعها، من التلميذ ولا الأستاذ اللي فيها، وهو داخل لحسابو — حتى كي المحادثة تكون مسكّرة. التبليغ ما ينحّي حتى شي آليًا: واحد من الفريق يقراه ويقرّر.",
          "الوثائق والفيديوهات اللي تنشرهم يبقاو متاعك، أما إنت تضمن إلّي عندك الحقّ باش تشاركهم. صاحب الحقوق ينجّم يطلب نحّي وثيقة حتى كان ما عندوش حساب عندنا، من زرّ « بلّغ » متاع الوثيقة؛ نشوفو الطلب، وكان يكون في محلّو الوثيقة تتنحّى ويتسجّل إنذار على حساب الأستاذ. الإنذارات تتعدّ برك، عمرها ما تتطبّق آليًا — قرار التعليق ياخذو إنسان.",
          "معلومات الاتصال الشخصية تبقى مخبّية من الجهتين. الأستاذ يشوف الإسم الأول متاع تلميذو، عمرو ما يشوف نمرتو ولا إيميلو؛ والتلميذ يشوف الإسم الأول متاع أستاذو والحرف الأوّل من لقبو (مثلاً « سامي ب. ») — وفي المحادثة الإسم الأول برك —، عمرو ما يشوف إسمو الكامل، نمرتو ولا إيميلو. ما نعطيو هالمعلومات لحتّى حد.",
          "النصوص اللي تكتبها — صفحة الأستاذ، الحصة، التقييم، الرسالة — تتفحّص آليًا باش نلقاو نمرة، إيميل، رابط ولا إسم تطبيق مراسلة. في صفحتك وحصصك، التسجيل يترفض وتنجّم تصلّح. في التقييم ولا الرسالة، معلومات الاتصال تتخبّى بالكامل — النمرة ولا الإسم، مع اللينك اللي فيه (wa.me، t.me، فايسبوك، إنستغرام…) — والباقي يتنشر كيما هو. نحتفظو بنوع اللي تلقى، عمرنا ما نحتفظو بالنصّ روحو.",
          `كل حجز ينجّم يحلّ محادثة بين التلميذ والأستاذ. المحادثة تتسكّر على طول كي يتلغى الحجز، كي حساب من الزوز يتعلّق، ولا كي الوليّ يسحب موافقتو، وإلا ${THREAD_CLOSE_DAYS} أيّام بعد ما تكمل الحصة. المحادثة المسكّرة تبقى تتقرا، وتنجّم ديما تبلّغ فيها على رسالة، أما حتى حد ما عادش ينجّم يكتب فيها.`,
          // LEGAL-REVIEW: retention of hidden content kept as evidence (A28).
          "في صورة الإخلال، ننجّمو نخبّيو رسالة ولا تقييم، ننحّيو وثيقة ولا نعلّقو حساب — وبلا إعلام مسبق كي تكون سلامة المستعملين، وبالخصوص القاصرين، في خطر. الرسالة ولا التقييم المخبّي يتبدّل عند الناس الكل بـ« المحتوى هذا تنحّى من طرف المراقبة »؛ النصّ متاعو يتحفظ كدليل وما يقراه كان الإداريين. كل قرار ياخذو واحد من الفريق، بسبب، ويتسجّل.",
        ],
      },
      {
        h: "9. توثيق الأساتذة",
        p: [
          "قبل ما يظهر للعموم، الأستاذ لازم يبعث وثيقة هوية (بطاقة تعريف وطنية ولا جواز سفر، وجه وظهر). الشهائد والوثائق الأخرى اختيارية وتزيد في الثقة.",
          "الوثائق هاذي يشوفها إداري من تنجّم بصفة يدوية، مع تصريحك إنّك ما تقرّيش في مؤسسة عمومية: من غيرو الملف ما يتبعثش وما يتقبلش. الوثائق ما تتنشرش عمرها. طريقة معالجتها، مدّة الاحتفاظ بيها وحذفها مشروحين في سياسة الخصوصية.",
          "الأستاذ الموثّق اللي يبدّل إسمو يقعد يبان بالإسم الموثّق حتى يوافق إداري على الإسم الجديد. وكان يبعث وثائق جديدة، يقعد موثّق وقت ما يتشافو.",
          "شارة « موثّق » تعني برك إلّي وثائق الهوية تقدّمت واتشافت بالعين. ماهيش تحرّي قضائي، لا ترخيص من الدولة، ولا ضمان للكفاءة البيداغوجية ولا لحسن السلوك. ننجّمو نرفضو ولا ننحّيو التوثيق وقت ما نحبّو.",
        ],
      },
      {
        h: "10. المحتوى والملكية الفكرية",
        p: [
          "الأستاذ يبقى مالك دروسه، ملخّصاته، تسجيلاته وموادّه. كي ينشرهم في تنجّم، يعطي لتنجّم رخصة مجانية وغير حصرية، محدودة في الاستضافة والعرض والترويج لعرضه في المنصّة وقنواتها، طول مدّة النشر.",
          "التلميذ عندو حقّ استعمال شخصي برك: يقرا بيهم، ما ينجّمش يبيعهم ولا يوزّعهم.",
          "الاسم « تنجّم »، « Tnajem »، الشعار والهوية البصرية ملك لتنجّم وما يتستعملوش من غير إذن كتابي.",
        ],
      },
      {
        h: "11. الحصص الدايركت والأدوات الخارجية",
        p: [
          "الحصص الدايركت تنجّم تتعمل بأدوات خارجية (فيديو، سبورة، كويز). الأدوات هاذي عندها شروطها وسياسة خصوصيتها. تنجّم ما تتحكّمش فيهم وماهيش مسؤولة على توفّرهم.",
        ],
      },
      {
        h: "12. توفّر الخدمة",
        p: [
          "تنجّم تتقدّم « كيما هي ». الخدمة تنجّم تتقطع للصيانة، التحيين ولا مشكل تقني. نعملو جهدنا باش نقلّلو التقطّعات، أما بلا ضمان استمرارية.",
        ],
      },
      {
        h: "13. المسؤولية",
        p: [
          "تنجّم تربط برك؛ ماهيش اللي تعطي الدرس. في حدود ما يسمح بيه القانون التونسي، تنجّم ماهيش مسؤولة على المحتوى البيداغوجي، الجودة، السلوك ولا كلام أستاذ ولا تلميذ ولا وليّ، ولا على الأضرار غير المباشرة (ضياع وقت، عدد، ولا فرصة).",
          "ما فمّا حتى حاجة في الشروط هاذي تنفي مسؤولية تنجّم في صورة التدليس، الخطأ الجسيم، ولا المساس بالسلامة الجسدية، ولا الحقوق اللي يضمنها القانون التونسي وجوبًا للمستهلك.",
        ],
      },
      {
        h: "14. تعليق الحساب وغلقه",
        p: [
          `تنجّم تمسح حسابك وقت ما تحبّ من « حسابي ». ما ينجّمش يصير ما دامت عندك حصة جاية: ألغيها الأول، باش الطرف الآخر يتعلم. المسح يصير ${DELETION_GRACE_DAYS} يوم من بعد، وتنجّم تبدّل رايك قبل؛ شنوّة يتمسح وشنوّة يبقى مشروح في سياسة الخصوصية.`,
          "ننجّمو نعلّقو حساب يخالف الشروط هاذي، ولا القانون، ولا يحطّ مستعملين آخرين في خطر. الحصص الجاية متاعو تتلغى وقتها بلا مصاريف، المحادثات متاعو تتسكّر، وتلامذة الأستاذ المعلّق يتعلمو اللي الحصة ما باش تصير.",
        ],
      },
      {
        h: "15. تغيير الشروط",
        p: [
          "الشروط هاذي تنجّم تتبدّل، بالخصوص وقت تفعيل الخلاص. النسخة المعتمدة هي اللي منشورة في الصفحة هاذي؛ والنسخة اللي كانت معمول بيها وقت عملت حسابك تتسجّل معاه. [يكمّلو المحامي: كيفاش نعلمو بتغيير مهمّ، وإذا لازم قبول جديد.]",
        ],
      },
      {
        h: "16. القانون المنطبق والنزاعات",
        p: [
          "الشروط هاذي تخضع للقانون التونسي. في صورة خلاف، نبداو بالكلام: اكتبلنا ونلوّجو على حلّ ودّي. وإذا ما تفاهمناش، النزاع يرجع للمحاكم التونسية المختصّة.",
          "[يكمّلو المحامي: الشكل القانوني والتسمية الدقيقة للناشر، المقرّ الاجتماعي، المعرّف الجبائي، السجلّ الوطني للمؤسّسات، المحكمة المختصّة، وإمكانية بند وساطة استهلاكية.]",
        ],
      },
      {
        h: "17. اتصل بينا",
        p: ["عندك سؤال على الشروط هاذي: contact@tnajem.com."],
      },
    ],
    seeAlso: "شوف زادة: سياسة الخصوصية",
  },
};

export default function TermsPage() {
  const { locale } = useLocale();
  const c = copy[locale];

  return (
    <SiteShell>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <section className="web-section">
        <div className="container container-narrow">
          {/* Lawyer-review banner — required until counsel signs off. */}
          <div className="lg-notice" role="note">
            <svg viewBox="0 0 24 24" className="ic" aria-hidden="true">
              <path d="M12 3.6 21 19.5H3L12 3.6z" />
              <line x1="12" y1="10" x2="12" y2="14" />
              <circle cx="12" cy="16.8" r="0.9" className="fill" />
            </svg>
            <div>
              <b>{c.notice}</b>
              <span>{c.noticeSub}</span>
            </div>
          </div>

          <header className="lg-head">
            <span className="web-eyebrow">{c.eyebrow}</span>
            <h1 className="web-h2">{c.title}</h1>
            <p className="lg-updated">{c.updated}</p>
            <p className="web-lead">{c.lead}</p>
          </header>

          <article className="panel panel-pad lg-doc">
            {c.sections.map((s) => (
              <section key={s.h}>
                <h2>{s.h}</h2>
                {s.p?.map((line) => <p key={line}>{line}</p>)}
                {s.list && (
                  <ul>
                    {s.list.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                )}
                {s.after?.map((line) => <p key={line}>{line}</p>)}
                {s.story && (
                  <p>
                    <PaymentStory locale={locale} audience={s.story.audience} /> {s.story.note}
                  </p>
                )}
              </section>
            ))}
          </article>

          <p className="lg-seealso">
            <Link href="/privacy" className="linklike">{c.seeAlso}</Link>
          </p>
        </div>
      </section>
    </SiteShell>
  );
}
