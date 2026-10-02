"use client";
/* ───────────────────────────────────────────────────────────────────────────
   /privacy — Politique de confidentialité (FR + AR).

   ⚠️  DRAFT / MODÈLE. Written by the product team, NOT by a lawyer. Must be
   reviewed by a Tunisian lawyer (and the INPDP formalities completed) before
   go-live. The dated "modèle — à faire relire par un avocat" banner at the top
   is deliberate: do not remove it until counsel has signed off and the bracketed
   placeholders (legal entity, INPDP declaration number, host, e-mail provider) are
   filled in.

   EVERY SENTENCE HERE DESCRIBES WHAT IS IMPLEMENTED (production readiness Stage 5,
   rewritten 15 Sept 2026). The numbers come from @tnajem/shared/legal; bracketed
   passages are open questions for counsel, listed with LEGAL-REVIEW markers there.
   Deletion: packages/db/src/erasure.ts. Retention: packages/db/src/retention.ts.
   Consent: apps/api/src/routes/misc.ts + guardian.ts. Reports: moderation.ts.

   Accuracy notes for whoever maintains this page — keep the copy in sync with
   the code:
   • ID documents are SEALED (AES-256-GCM, packages/db/src/doc-crypto.ts) and written
     to the object store (STORAGE_DRIVER: a private directory or a private bucket) by
     apps/api — see apps/api/src/routes/admin.ts (POST /verification). apps/web never
     touches them.
   • They are only ever served through app/api/admin/doc/[id]/route.ts, which is a
     STREAMING PASS-THROUGH that makes no access decision of its own: apps/api
     decides, using the ADMIN_EMAILS allow-list (packages/shared/src/admin.ts).
     Not ADMIN_PHONES — login is e-mail OTP and most admin profiles have no phone
     at all. The link is signed, admin-bound and short-lived (apps/api/src/lib/doc-links.ts),
     the document downloads, and every read is audited before a byte is sent.
   • Retention promises below (90 days after the review decision) are a POLICY, and
     the job that keeps it is apps/api/src/routes/cron.ts (GET/POST /cron/purge,
     bearer CRON_SECRET). If that job stops being scheduled, this page starts
     lying — treat a silent purge as a legal problem, not an ops one.

   phase-a lane L6 (A19, 24 Sept 2026) — rewritten against the merged Phase A code:
   the adult-only pilot (A24/A14), conversations that close (A2), the contact mask
   (A1), every photo erased (A11), a guardian erased from the consent (A27),
   moderation that can hide a message or a review (A28), tutors shown as first
   name + initial (A23), the phone used only for Tnajem's own SMS (A3), no guardian
   phone (A18.2), and the one payment story, labelled « Bientôt » (A22/D4).
   Proof: apps/api/test/legal-truth.test.ts (source) + e2e/legal-truth.spec.ts
   (rendered); phase-a-logs/l6.md names the behavioural test behind each claim.

   espace prof v2 · auth (phase 2, 1 Oct 2026): passwords. An argon2id hash
   (profiles.password_hash, 0032) and its date are stored, never the password; the
   lockout (5 failures → 15 min per address-hash + IP pair; caps of 50 per IP / 15 min
   and 20 per address / hour; all in rate_limits); every
   set/change/reset e-mails the account and signs other devices out; erasure clears
   the hash (erasure.ts). Proof: apps/api/test/ep2-passwords.test.ts.

   Design system: SiteShell + .panel + .container-narrow. RTL-safe (logical
   properties). Page CSS prefixed `lg-`, injected via dangerouslySetInnerHTML.
   ─────────────────────────────────────────────────────────────────────────── */
import { Link } from "@/components/Link";
import { SiteShell } from "@/components/SiteShell";
import { useLocale } from "@/components/LocaleProvider";
import { PaymentStory } from "@/components/PaymentStory";
import {
  DELETION_GRACE_DAYS, ID_DOCUMENT_RETENTION_DAYS, INACTIVE_ACCOUNT_RETENTION_DAYS, MINOR_AGE_YEARS, PRIVACY_CONTACT_EMAIL,
  PRIVACY_POLICY_VERSION, SESSION_DAYS, SESSION_IDLE_DAYS, THREAD_CLOSE_DAYS, formatLongDate,
  type PaymentAudience,
} from "@tnajem/shared";

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
.lg-seealso{margin-top:20px;font-size:14px}
`;

/* The numbers in this text come from @tnajem/shared/legal, so the page cannot
   quote a period the code does not enforce. The version date is the policy version. */
const YEARS_INACTIVE = Math.round(INACTIVE_ACCOUNT_RETENTION_DAYS / 365);
const versionDate = (locale: "fr" | "ar") => formatLongDate(`${PRIVACY_POLICY_VERSION}T12:00:00Z`, locale);

const copy: { fr: LegalCopy; ar: LegalCopy } = {
  fr: {
    notice: "Modèle — à faire relire par un avocat avant la mise en ligne.",
    noticeSub:
      `Version du ${versionDate("fr")}. Ce texte est un projet rédigé par l'équipe produit. Il décrit ce que le service fait réellement à cette date, mais il ne constitue pas un conseil juridique, n'a pas encore été validé par un avocat, et les formalités auprès de l'INPDP ne sont pas encore finalisées. Les passages entre crochets restent à compléter par l'avocat.`,
    eyebrow: "Légal",
    title: "Politique de confidentialité",
    updated: `Version du ${versionDate("fr")}`,
    lead:
      "Tnajem collecte peu de données, mais certaines sont sensibles : pour être vérifiés, les profs nous envoient une pièce d'identité. Pendant le pilote, Tnajem est réservé aux 18 ans et plus : les passages qui concernent les élèves mineurs et leurs parents ne s'appliquent pas tant que cet accès est fermé (section 8). Cette page explique exactement ce que nous collectons, pourquoi, qui peut le voir, combien de temps nous le gardons, et comment tu peux faire supprimer tes données.",
    sections: [
      {
        h: "1. Qui est responsable de tes données",
        p: [
          "Tnajem (تنجّم), plateforme tunisienne de mise en relation entre élèves et profs particuliers, est responsable du traitement des données décrites ici.",
          `Contact données personnelles : ${PRIVACY_CONTACT_EMAIL} — c'est l'adresse à utiliser pour toute demande d'accès, de rectification ou de suppression.`,
          "[À compléter par l'avocat : dénomination sociale exacte, siège social, matricule fiscal, numéro de déclaration / d'autorisation auprès de l'INPDP conformément à la loi organique n° 2004-63 du 27 juillet 2004 relative à la protection des données à caractère personnel.]",
        ],
      },
      {
        h: "2. Ce que nous collectons",
        p: ["Nous ne collectons que ce qui sert à faire fonctionner le service."],
        list: [
          "Compte : ton adresse e-mail (c'est avec elle que tu te connectes), ton nom, ton rôle (élève, parent/tuteur ou prof), ta langue, ton mois et ton année de naissance (pour vérifier que tu as 18 ans ou plus — section 8), la version des conditions d'utilisation en vigueur quand tu as créé ton compte, et la date de ta dernière visite (pour appliquer la durée de conservation de la section 5). Si tu es élève, tu peux aussi indiquer ton niveau et les matières qui t'intéressent. Ton numéro de téléphone est facultatif : il sert uniquement aux messages que Tnajem peut t'envoyer sur ton compte et tes séances, jamais à te connecter, et il n'est jamais montré à un prof ou à un élève.",
          // LEGAL-REVIEW: consent record (A18.2: the form no longer asks the guardian's phone; the column stays nullable).
          "Accord parental (élève mineur — accès fermé pendant le pilote) : le nom et l'adresse e-mail du parent ou tuteur — nous ne demandons pas son téléphone —, le texte de l'accord, la version de cette politique sous laquelle il a été donné, sa date et, s'il est retiré, la date du retrait.",
          "Page publique du prof : nom (affiché sous la forme prénom + initiale, section 4), matière, niveaux, présentation, photo, années d'expérience, établissement, liens vers tes réseaux — tout ce que tu publies toi-même et qui est visible par tout le monde.",
          "Dossier de vérification (profs uniquement) : pièce d'identité (CIN ou passeport, recto/verso), éventuellement un selfie et des diplômes ou attestations, et ta déclaration de ne pas enseigner dans un établissement public, avec sa date. Les documents d'identité sont les données les plus sensibles que nous détenons.",
          "Réservations : quelles séances tu as réservées, chez quel prof, à quelle date, et leur statut.",
          "Messages et signalements : les messages échangés dans la conversation d'une séance, et les signalements que tu nous envoies (avec ton adresse e-mail seulement si tu choisis de la donner ; si tu es connecté, le signalement est rattaché à ton compte).",
          "Technique : ton mot de passe, si tu en as un — jamais en clair : nous n'en gardons qu'une empreinte argon2id, qui ne permet pas de le retrouver — et la date de sa dernière modification ; un cookie de session pour te garder connecté (le serveur n'en garde qu'une empreinte, jamais le jeton lui-même), les codes de connexion (stockés uniquement sous forme hachée) et des journaux techniques qui ne contiennent ni ton adresse e-mail, ni ton numéro, ni ton mot de passe.",
        ],
        after: [
          "Nous ne collectons aucune donnée bancaire : les paiements ne sont pas actifs sur Tnajem. Nous ne collectons pas ta géolocalisation, ni tes contacts, ni de données de santé.",
        ],
        story: {
          audience: "student",
          note: "Ce n'est pas encore le cas aujourd'hui. Quand les paiements seront activés, cette politique sera mise à jour avant (section 10).",
        },
      },
      {
        h: "3. Pourquoi, et sur quelle base",
        p: [
          "Chaque donnée a une raison d'être précise.",
          "[À compléter par l'avocat : la base légale de chaque traitement au sens de la loi n° 2004-63. Celles indiquées entre parenthèses sont des propositions de l'équipe produit.]",
        ],
        list: [
          // LEGAL-REVIEW: the lawful bases in parentheses are product-team proposals (see the bracket above).
          "Adresse e-mail → créer ton compte et t'identifier, avec ton mot de passe ou un code à usage unique envoyé à cette adresse (exécution du service que tu demandes). Elle sert aussi aux e-mails sur tes séances — réservation, annulation, rappels 24 h et 1 h avant, et une demande d'avis après un cours suivi —, au rappel avant la fin d'un abonnement mensuel et, si tu suis des profs, à un récapitulatif de leurs nouvelles séances au plus une fois par jour. Chacun de ces e-mails a un lien pour ne plus le recevoir. Mot de passe → te connecter sans attendre de code ; chaque fois qu'il est créé, changé ou réinitialisé, nous t'envoyons un e-mail et tes autres appareils sont déconnectés. Numéro de téléphone, si tu le donnes → les messages que Tnajem peut t'envoyer sur ton compte et tes séances (une confirmation de réservation, par exemple), rien d'autre ; il n'est jamais montré à un prof ou à un élève.",
          "Nom et rôle → permettre au prof de savoir qui a réservé, et à l'élève de savoir avec qui il apprend.",
          /* LEGAL-REVIEW: age threshold (MINOR_AGE_YEARS) and the lawful basis proposed for the age check.
             What the code does: packages/shared/src/age.ts isAdult() — adult only once the month of the
             18th birthday is over, in Africa/Tunis; a missing month or year is a minor. */
          `Mois et année de naissance → vérifier que tu as 18 ans ou plus : pendant le pilote, Tnajem est réservé aux adultes, et un prof doit toujours avoir 18 ans ou plus (protection des mineurs). Nous ne demandons pas le jour : tu comptes comme majeur à partir du mois qui suit celui de tes 18 ans. Un mois ou une année inconnus comptent comme « moins de ${MINOR_AGE_YEARS} ans ». Si l'accès des moins de ${MINOR_AGE_YEARS} ans est ouvert, ils servent aussi à exiger l'accord d'un parent ou tuteur avant toute réservation.`,
          // LEGAL-REVIEW: consent (lawful basis: the guardian's consent). A18.2: no phone is asked.
          "Nom et adresse e-mail du parent → recueillir et prouver son accord (consentement). Nous ne demandons pas son téléphone.",
          /* Accuracy (CEO report finding 3, Phase D / Dm1): nothing CREATES a parent account; a consent
             naming this address is linked to whichever account signs in with it (guardian.ts
             resolveGuardianLinks). Behind the pilot framing: minors are off (A24). */
          "E-mail du parent → relier à son enfant le compte que le parent ouvre avec cette adresse. Avec ce compte, le parent voit les séances réservées et peut LIRE les conversations de son enfant — l'enfant en est informé sur chaque conversation. Le parent ne peut ni écrire ni réserver à sa place, et les coordonnées des profs ne lui sont jamais communiquées. Il peut en revanche retirer son accord depuis son espace parent : son enfant ne peut alors plus réserver, et ses séances à venir sont annulées sans frais. Lui seul peut redonner cet accord.",
          /* LEGAL-REVIEW: retention after erasure — reported messages (KEEP_REPORTED_MESSAGES_ON_ERASURE)
             and, A27, the anonymised consent proof (packages/db/src/erasure.ts: guardian_name "Un compte
             supprimé", guardian_email NULL, guardian_phone ""; signed_at, policy_version, consent_text and
             withdrawn_at kept). A11: every object under avatars/<tutorId>/ is deleted, files first. */
          `Suppression de ton compte → tu peux la demander depuis « Mon compte ». Ce n'est pas possible tant que tu as une séance à venir : annule-la d'abord. Nous te laissons ${DELETION_GRACE_DAYS} jours pour changer d'avis, et tes autres appareils sont déconnectés tout de suite. Ensuite, ton compte est anonymisé : ton nom, ton e-mail, ton téléphone, l'empreinte de ton mot de passe, ton mois et ton année de naissance sont effacés, tu es déconnecté partout, les messages que tu as écrits sont supprimés et ton nom est retiré des notifications des autres. Si tu es le parent ou tuteur désigné dans l'accord parental d'un enfant, ton nom, ton e-mail et ton téléphone sont aussi effacés de cet accord : il n'en reste que le fait qu'il a été donné, sa date, son texte et sa version. Si tu es prof, ta page est retirée, son adresse ne peut plus être reprise par quelqu'un d'autre, et tes pièces d'identité, tes documents partagés et toutes tes photos — y compris les versions que tu avais remplacées — sont effacés du stockage. Ce qui reste ne permet pas de te reconnaître : la trace des places réservées (pour l'historique du prof et le registre des annulations), tes avis sans ton nom, les signalements, et un message que quelqu'un a signalé, gardé comme preuve. [À valider par l'avocat : la conservation des messages signalés après la suppression d'un compte, et celle d'un accord parental dont le signataire n'est plus identifiable.]`,
          // LEGAL-REVIEW: lawful basis (product-team proposal). "souvent mineurs" dropped: the pilot is adults only.
          "Documents d'identité → vérifier qu'un prof est bien la personne qu'il prétend être, avant de le présenter à des élèves (consentement du prof + intérêt légitime de sécurité de la communauté). Un prof qui refuse ne peut pas être vérifié, donc pas listé publiquement.",
          "Déclaration de ne pas enseigner dans le public → respecter le décret n° 2015-1619 : Tnajem ne met pas en avant un enseignant en exercice dans un établissement public. Sans cette déclaration, un dossier de vérification ne peut être ni envoyé ni approuvé, et l'administrateur la compare à l'établissement indiqué.",
          "Réservations → organiser les séances, gérer les places, la règle d'annulation à 48 h et le registre des annulations.",
          /* A1 (packages/shared/src/contact-info.ts, whole-span mask), A2 (apps/api/src/lib/thread-state.ts:
             closed on a block/suspension or a withdrawn consent, else THREAD_CLOSE_DAYS after start + duration). */
          `Messages échangés dans la conversation d'une séance → permettre à un prof et un élève de se parler sans échanger de coordonnées. Personne chez Tnajem ne lit une conversation, sauf un message signalé, qui arrive avec son texte dans la file de modération. Avant l'enregistrement, les coordonnées sont masquées automatiquement, en entier : un numéro de téléphone (avec ou sans +216), une adresse e-mail, un lien, ou un lien de messagerie (wa.me, t.me, Facebook, Instagram) avec le numéro ou l'identifiant qui le suit. Nous conservons le TYPE de ce qui a été détecté, jamais le texte détecté. Ce filtre n'attrape pas tout : échanger ses coordonnées reste interdit (conditions d'utilisation, article 8). Une conversation se ferme tout de suite quand la réservation est annulée, quand l'un des deux comptes est suspendu ou quand un parent retire son accord, et sinon ${THREAD_CLOSE_DAYS} jours après la fin de la séance. Une conversation fermée reste lisible, et on peut encore y signaler un message, mais plus personne ne peut y écrire.`,
          /* LEGAL-REVIEW: retention of hidden content (A28: messages/reviews hidden_at — the text is kept as
             evidence, read by admins only). Reporting a message: POST /messages/:id/report needs a session
             and a participant (apps/api/test/legal-truth.test.ts). A18.14: the queue shows a signed-in
             reporter's role and account e-mail. */
          "Signalements → protéger les utilisateurs, en particulier les mineurs. Chacun peut signaler la page d'un prof, une séance ou un document avec le bouton « Signaler », même sans être connecté ; l'adresse e-mail est alors facultative. Un message, lui, se signale depuis sa conversation, par l'élève ou le prof qui y participe, connecté à son compte — même quand la conversation est fermée. Si tu signales en étant connecté, le signalement est rattaché à ton compte : l'équipe voit ton rôle et l'adresse e-mail de ton compte. Un signalement ne retire rien automatiquement : une personne de l'équipe le lit et décide. Elle peut masquer un message ou un avis : son texte est alors remplacé par « Contenu retiré par la modération » pour tout le monde, auteur compris ; il reste conservé comme preuve, et seuls les administrateurs peuvent encore le lire. Un ayant droit peut demander le retrait d'un document par le même bouton.",
          "Documents et vidéos partagés par un prof → permettre à ses élèves d'y accéder. Les fichiers sont stockés hors du web public et ne sont servis qu'après vérification de tes droits (public, élève inscrit chez ce prof — ou à cette séance, si le document y est rattaché —, ou le prof lui-même) — jamais par une adresse devinable. Une vidéo n'est pas hébergée ici : nous n'enregistrons que son identifiant YouTube et l'affichons sans cookie de suivi.",
          `Photo de profil d'un prof → mettre un visage sur sa page. Elle est vérifiée par une personne avant d'être visible. Nous ne conservons PAS le fichier d'origine : la photo est réencodée en trois tailles et toutes ses données cachées sont effacées, y compris la localisation GPS que ton téléphone y inscrit. Quand tu remplaces ou supprimes ta photo, l'ancienne est effacée du stockage, dans ses trois tailles. Les moins de ${MINOR_AGE_YEARS} ans n'ont jamais de photo, seulement leurs initiales.`,
          "Journaux, codes hachés et limites de fréquence → sécurité, lutte contre la fraude et les abus. Une limite liée à une adresse e-mail n'en garde qu'une empreinte. Après 5 mots de passe erronés pour une adresse e-mail depuis une même adresse IP, la connexion par mot de passe est suspendue 15 minutes pour cette adresse e-mail depuis cette adresse IP. Elle l'est aussi pour toute une adresse IP après 50 échecs en 15 minutes, et pour une adresse e-mail après 20 échecs en une heure. La connexion par code reste toujours possible.",
        ],
        after: [
          "Nous n'utilisons pas tes données pour de la publicité. Nous ne les vendons pas, ne les louons pas et ne les échangeons pas.",
        ],
      },
      {
        h: "4. Qui peut voir quoi",
        p: ["C'est le point le plus important, alors soyons précis :"],
        list: [
          // A23 (D1): packages/shared/src/public-profile.ts publicTutorName(), applied by the API, never in the browser.
          "Ta page publique de prof : ton prénom suivi de l'initiale de ton nom (par exemple « Sami B. »), ta matière, tes niveaux, ta bio et ta photo — visibles par tout le monde, c'est le but. Ton nom complet n'est montré ni aux élèves ni au public : seuls toi et les administrateurs de Tnajem le voient. L'adresse de ta page, que tu choisis toi-même, est publique elle aussi.",
          "Ton prénom d'élève : visible par le prof chez qui tu as réservé, et par lui seul. Les autres élèves ne voient pas ton nom.",
          "Pour un élève mineur : son parent ou tuteur lié voit ses séances à venir et lit ses conversations.",
          "Ton numéro de téléphone : jamais affiché publiquement, jamais montré à un prof ou à un élève.",
          "Tes documents d'identité : jamais publics, jamais partagés avec les élèves, jamais partagés avec les autres profs, jamais utilisés pour autre chose que la vérification.",
        ],
        after: [
          "Concrètement, les documents d'identité sont chiffrés avant d'être enregistrés, en dehors de tout ce qui est servi publiquement : un fichier copié depuis le disque ou une sauvegarde est illisible sans la clé. Aucune adresse web ne permet de les ouvrir. Un administrateur autorisé (liste restreinte d'adresses e-mail définie côté serveur) reçoit, pour chaque document, un lien valable quelques minutes et utilisable par lui seul. Le document est téléchargé, jamais mis en cache, et chaque consultation est enregistrée — qui, quand — avant l'envoi du fichier.",
          "Sous-traitants : l'hébergeur du serveur et de la base de données, le service de stockage des fichiers s'il est externe, et le fournisseur d'e-mail qui envoie nos e-mails — ton code de connexion, les avis de mot de passe, les e-mails sur tes séances et tes abonnements (il reçoit ton adresse et le contenu de ces e-mails, rien d'autre). Ils agissent sur nos instructions et n'ont pas le droit d'utiliser tes données pour eux-mêmes. [À compléter par l'avocat : identité de ces prestataires, pays d'hébergement, et — si les serveurs sont hors de Tunisie — l'autorisation de transfert requise par la loi n° 2004-63.]",
          "Nous ne communiquons des données à une autorité que si la loi tunisienne nous y oblige.",
        ],
      },
      {
        h: "5. Combien de temps nous gardons tes données",
        p: [
          "Les documents d'identité sont les données que nous gardons le moins longtemps. Ils servent à une décision, pas à constituer un fichier.",
        ],
        list: [
          /* LEGAL-REVIEW: ID-document retention. packages/db/src/retention.ts purges every document of a
             tutor ID_DOCUMENT_RETENTION_DAYS after the LATEST decision (tutors.reviewed_at), and skips a
             round submitted after it — so an earlier round's scans wait for the newer round's decision
             (A26 kept a resubmitting verified tutor verified; the clock itself is unchanged). Not invented:
             stated as the code does it; whether each document needs its own clock is for counsel. */
          `Documents d'identité et diplômes : conservés le temps de l'examen du dossier, puis supprimés au plus tard ${ID_DOCUMENT_RETENTION_DAYS} jours après la décision — que le prof soit accepté ou refusé — ou dès la suppression du compte. Si un prof envoie un nouveau dossier, ses documents précédents sont gardés avec lui jusqu'à ${ID_DOCUMENT_RETENTION_DAYS} jours après la décision sur ce nouveau dossier. [À compléter par l'avocat : durée maximale pour un dossier qui n'a jamais reçu de décision.]`,
          "Après suppression, il ne reste qu'une trace minimale sans le document lui-même : le type de document présenté, sa date d'envoi, la décision et sa date. C'est ce qui nous permet de prouver que la vérification a bien eu lieu. [Durée de conservation de cette trace à fixer par l'avocat.]",
          `Compte et profil : conservés tant que tu utilises ton compte. Un compte inutilisé pendant ${YEARS_INACTIVE} ans est supprimé comme si tu l'avais demandé (section 3). Aucun e-mail de rappel n'est envoyé avant. [À valider par l'avocat : cette durée, et l'obligation éventuelle de prévenir.]`,
          "Réservations et registre des annulations : conservés, et anonymisés quand le compte est supprimé. [Durée à fixer par l'avocat.]",
          // LEGAL-REVIEW: message retention — closing a conversation (A2) deletes nothing; hidden content (A28) keeps its text.
          "Messages : conservés tant que les deux comptes existent, y compris après la fermeture de la conversation ; ceux d'un compte supprimé sont supprimés, sauf un message signalé. Un message ou un avis masqué par la modération garde son texte, que seuls les administrateurs peuvent lire. [Durée à fixer par l'avocat.]",
          /* LEGAL-REVIEW: retention of consent proof. What the code does (erasure.ts): the consent row is
             deleted with the CHILD's account; kept after a withdrawal (withdrawn_at); anonymised when the
             GUARDIAN's account is erased (A27). No period is set — none is invented here. */
          "Accord parental : conservé tant que le compte de l'enfant existe, y compris après un retrait (avec sa date), et supprimé avec le compte de l'enfant ; si le compte du parent est supprimé, son nom, son e-mail et son téléphone en sont effacés. [Durée à fixer par l'avocat.]",
          "Signalements et journal des actions des administrateurs : conservés. [Durée à fixer par l'avocat.]",
          "Codes de connexion : hachés, inutilisables au bout de quelques minutes, puis supprimés.",
          // espace prof v2 · auth (0032): profiles.password_hash, cleared by packages/db/src/erasure.ts.
          "Mot de passe : seule son empreinte argon2id est conservée, tant que le compte existe ; elle est effacée avec le compte.",
          `Session de connexion : elle se termine ${SESSION_DAYS} jours après la connexion, après ${SESSION_IDLE_DAYS} jours sans utilisation, ou quand tu te déconnectes — y compris avec « Se déconnecter de tous les appareils ».`,
        ],
        after: [
          "Supprimer signifie supprimer : le fichier est effacé du stockage et la ligne correspondante est effacée de la base de données. Ce n'est pas une simple mise en « archive ».",
          "Les sauvegardes de la base de données et des fichiers contiennent encore les données effacées jusqu'à ce qu'elles-mêmes soient supprimées. [Durée de conservation des sauvegardes à fixer par l'avocat.]",
        ],
      },
      {
        h: "6. Sécurité",
        p: [
          "Les documents d'identité sont chiffrés et ne sont accessibles qu'à des administrateurs désignés, par un lien personnel et temporaire ; chaque consultation est enregistrée. Les mots de passe (argon2id), les codes de connexion et les jetons de session ne sont stockés que sous forme d'empreinte : ton mot de passe ne peut pas être relu à partir de ce que nous conservons. Les échanges avec le site sont chiffrés (HTTPS). L'accès administrateur est limité à une liste d'adresses e-mail définie côté serveur.",
          "Aucun système n'est infaillible. En cas d'incident de sécurité affectant tes données, nous t'informerons et informerons l'INPDP dans les conditions prévues par la loi.",
        ],
      },
      {
        h: "7. Tes droits",
        p: [
          "Conformément à la loi organique n° 2004-63 du 27 juillet 2004 relative à la protection des données à caractère personnel, tu disposes des droits suivants :",
        ],
        list: [
          "Accès : savoir quelles données nous détenons sur toi et en obtenir une copie.",
          "Rectification : corriger une donnée fausse ou incomplète.",
          "Suppression : demander l'effacement de tes données, directement depuis « Mon compte » (section 3), y compris tes documents d'identité.",
          "Opposition : t'opposer, pour un motif légitime, à un traitement.",
          "Retrait du consentement : à tout moment, sans que cela remette en cause ce qui a été fait avant. Pour un élève mineur, le parent retire son accord depuis son espace parent. Retirer ton consentement à la vérification (en supprimant ton compte ou en nous écrivant) signifie que ta page de prof ne peut plus être publiée.",
          "Réclamation : saisir l'Instance Nationale de Protection des Données Personnelles (INPDP) si tu estimes que tes droits ne sont pas respectés.",
        ],
        after: [
          `Pour exercer un autre droit, écris à ${PRIVACY_CONTACT_EMAIL} depuis l'adresse associée à ton compte. Nous pouvons devoir vérifier ton identité (sans te demander de nouveaux documents inutiles). Nous répondons au plus tard dans un délai d'un mois. [Délai à confirmer par l'avocat.]`,
          "Pour un élève mineur, ces droits sont exercés par le parent ou le tuteur qui a donné l'accord.",
        ],
      },
      {
        h: "8. Les mineurs",
        p: [
          /* A24 (ALLOW_MINORS off by default: sign-up and booking refuse a minor on the server) and A14
             (a tutor must be 18+, whatever the switch). packages/shared/src/age.ts. */
          "Pendant le pilote, Tnajem est réservé aux 18 ans et plus, élèves comme profs. À l'inscription, nous demandons ton mois et ton année de naissance, et le serveur refuse l'inscription si tu n'as pas encore 18 ans : tu comptes comme majeur à partir du mois qui suit celui de tes 18 ans. Un prof doit toujours avoir 18 ans ou plus. Un compte d'élève de moins de 18 ans peut se connecter, mais ne peut réserver aucune séance.",
          /* LEGAL-REVIEW: guardian consent wording, and a consent entered by the child without checking
             the parent's identity. A18.2: no guardian phone. A13: once the guardian's account is linked,
             the child cannot change the guardian's address (apps/api/src/routes/misc.ts POST /consent). */
          `Tant que cet accès est fermé, nous ne demandons aucune donnée à un parent. S'il est ouvert, un élève de moins de ${MINOR_AGE_YEARS} ans ne peut réserver aucune séance sans l'accord d'un parent ou tuteur, dont nous conservons le nom, l'adresse e-mail, la version de cette politique et la date de l'accord. L'accord est saisi par l'élève au nom de son parent ; une fois le compte du parent relié à l'accord, l'élève ne peut plus changer l'adresse du parent. Le parent voit l'accord, et peut le retirer ou le redonner, depuis son propre compte. [À valider par l'avocat : un accord saisi par l'élève, sans vérification de l'identité du parent.]`,
          "Nous limitons volontairement ce que nous demandons à un mineur : une adresse e-mail, un nom, un mois et une année de naissance, et un téléphone facultatif. Un mineur ne nous envoie jamais de pièce d'identité — cette obligation ne concerne que les profs — et n'a jamais de photo.",
        ],
      },
      {
        h: "9. Cookies",
        p: [
          "Nous utilisons trois cookies, et aucun ne sert à te suivre : un cookie de session, indispensable, qui te garde connecté une fois que tu t'es identifié (mot de passe ou code) ; un cookie qui retient ton rôle pour afficher le bon menu (il ne donne accès à rien) ; et un cookie qui retient la langue que tu as choisie.",
          "Pas de cookie publicitaire, pas de pixel de réseau social, pas de mesure d'audience tierce. Une vidéo YouTube n'est chargée que si tu la lances, depuis le domaine sans cookie de YouTube.",
        ],
      },
      {
        h: "10. Modifications de cette politique",
        p: [
          "Cette politique évoluera — notamment lors de l'activation des paiements, qui introduira de nouvelles données (transactions). La version applicable est celle publiée sur cette page ; la version sous laquelle un accord parental a été donné est enregistrée avec lui. [À compléter par l'avocat : comment les utilisateurs sont informés d'un changement important, et si un nouvel accord est nécessaire.]",
        ],
      },
      {
        h: "11. Nous contacter",
        p: [
          `Questions sur tes données, demande d'accès : ${PRIVACY_CONTACT_EMAIL}.`,
          "Autres questions : contact@tnajem.com.",
        ],
      },
    ],
    seeAlso: "Voir aussi : conditions d'utilisation",
  },

  ar: {
    notice: "نموذج — لازم يقراه محامي قبل ما ينشر رسميًا.",
    noticeSub:
      `نسخة ${versionDate("ar")}. النصّ هذا مسودّة كتبها فريق المنتج. يوصف شنوّة تعمل الخدمة فعلاً في التاريخ هذا، أما ما هوش استشارة قانونية، ما زال ما صادقش عليه محامي، والإجراءات مع الهيئة الوطنية لحماية المعطيات الشخصية (INPDP) ما زالت ما كمّلتش. اللي بين معقّفات يكمّلو المحامي.`,
    eyebrow: "قانوني",
    title: "سياسة الخصوصية",
    updated: `نسخة ${versionDate("ar")}`,
    lead:
      "تنجّم تجمع معطيات قليلة، أما فمّا منها حسّاسة: باش يتوثّق الأستاذ، يبعثلنا وثيقة هوية. في فترة التجربة، تنجّم كان للّي عمرهم 18 سنة وفوق: الأجزاء اللي تحكي على التلامذة القاصرين والأولياء متاعهم ما تنطبقش ما دام الباب هذا مسكّر (الفصل 8). الصفحة هاذي تشرحلك بالضبط شنوّة نجمعو، علاش، شكون ينجّم يشوفو، قدّاش نحتافظو بيه، وكيفاش تنجّم تطلب حذفو.",
    sections: [
      {
        h: "1. شكون مسؤول على معطياتك",
        p: [
          "تنجّم (Tnajem)، منصّة تونسية تربط التلاميذ بالأساتذة الخصوصيين، هي المسؤولة على معالجة المعطيات الموصوفة هوني.",
          `الاتصال بخصوص المعطيات الشخصية: ${PRIVACY_CONTACT_EMAIL} — هذا هو العنوان لأيّ طلب نفاذ، تصحيح ولا حذف.`,
          "[يكمّلو المحامي: التسمية الاجتماعية الدقيقة، المقرّ، المعرّف الجبائي، ورقم التصريح/الترخيص لدى الهيئة الوطنية لحماية المعطيات الشخصية (INPDP) طبقًا للقانون الأساسي عدد 63 لسنة 2004 المؤرخ في 27 جويلية 2004 المتعلّق بحماية المعطيات الشخصية.]",
        ],
      },
      {
        h: "2. شنوّة نجمعو",
        p: ["ما نجمعو كان اللي يلزم باش الخدمة تمشي."],
        list: [
          "الحساب: الإيميل متاعك (بيه تدخل)، اسمك، دورك (تلميذ، وليّ ولا أستاذ)، لغتك، شهر وعام ولادتك (باش نتأكّدو اللي عمرك 18 سنة ولا أكثر — الفصل 8)، نسخة شروط الاستعمال اللي كانت معمول بيها وقت عملت حسابك، وتاريخ آخر زيارة (باش نطبّقو مدّة الاحتفاظ متاع الفصل 5). كان إنت تلميذ، تنجّم زادة تعطينا المستوى متاعك والموادّ اللي تهمّك. رقم التليفون اختياري: ما يخدم كان للرسائل اللي تنجّم تبعثهملك Tnajem على حسابك وحصصك، عمرو ما يخدم للدخول، وعمرو ما يتوّرى لأستاذ ولا لتلميذ.",
          // LEGAL-REVIEW: consent record (A18.2: the form no longer asks the guardian's phone).
          "موافقة الوليّ (تلميذ قاصر — الباب مسكّر في فترة التجربة): اسم الوليّ والإيميل متاعو — ما نطلبوش التليفون متاعو —، نصّ الموافقة، نسخة السياسة هاذي اللي تعطات تحتها، تاريخها، وكان تسحبت، تاريخ السحب.",
          "الصفحة العمومية متاع الأستاذ: الاسم (يبان بالإسم الأوّل والحرف الأوّل من اللقب، شوف الفصل 4)، المادة، المستويات، التقديم، الصورة، سنوات الخبرة، المؤسسة، وروابط شبكاتك — كل شيء إنت اللي تنشرو وكل الناس تشوفو.",
          "ملف التوثيق (الأساتذة برك): وثيقة هوية (بطاقة تعريف وطنية ولا جواز سفر، وجه وظهر)، وأحيانًا صورة سيلفي وشهائد، وتصريحك إنّك ما تقرّيش في مؤسسة عمومية، مع تاريخو. وثائق الهوية هاذي أكثر معطيات حسّاسة عندنا.",
          "الحجوزات: أنهي حصص حجزت، مع أنهي أستاذ، في أنهي تاريخ، وشنوّة وضعيتها.",
          "الرسائل والتبليغات: الرسائل في محادثة الحصة، والتبليغات اللي تبعثهملنا (مع الإيميل متاعك كان تحب تعطيه برك؛ وكان إنت داخل لحسابك، التبليغ يتربط بحسابك).",
          "تقني: كلمة السرّ متاعك كان عندك وحدة — عمرها ما تتحفظ كيما هي: نحتفظو كان ببصمة argon2id ما تخلّيناش نرجعولها — وتاريخ آخر تبديل ليها؛ كوكي للجلسة باش تبقى داخل (السيرفر ما يحتفظ كان ببصمة منّو، عمرو ما يحتفظ بالرمز روحو)، كودات الدخول (محفوظين مشفّرين بـhash برك)، وسجلاّت تقنية ما فيهاش لا الإيميل متاعك، لا نمرتك، لا كلمة السرّ.",
        ],
        after: [
          "ما نجمعو حتى معطيات بنكية: الخلاص موش مفعّل في تنجّم. ما نجمعوش موقعك الجغرافي، لا جهات الاتصال متاعك، لا معطيات صحّية.",
        ],
        story: {
          audience: "student",
          note: "اليوم ما زال موش هكّا. كي يتفعّل الخلاص، السياسة هاذي باش تتحيّن قبل (الفصل 10).",
        },
      },
      {
        h: "3. علاش، وعلى أيّ أساس",
        p: [
          "كل معطى عندو سبب واضح.",
          "[يكمّلو المحامي: الأساس القانوني متاع كل معالجة حسب القانون عدد 63 لسنة 2004. اللي مكتوب بين قوسين اقتراحات من فريق المنتج.]",
        ],
        list: [
          // LEGAL-REVIEW: the lawful bases in parentheses are product-team proposals (see the bracket above).
          "الإيميل ← نعملو حسابك ونتثبّتو منّك بكود وحيد يوصلك للعنوان هذا، ولا بكلمة السرّ متاعك (تنفيذ الخدمة اللي طلبتها). ويستعمل زادة للإيمايلات على حصصك — الحجز، الإلغاء، التذكير 24 ساعة وساعة قبل، وطلب رأيك بعد حصة حضرتها —، للتذكير قبل نهاية اشتراك شهري، وكان تتابع أساتذة، لملخّص على حصصهم الجديدة على الأكثر مرّة في النهار. كل إيميل من هاذوما فيه رابط باش ما عادش يوصلك. كلمة السرّ ← تدخل بلا ما تستنّى كود؛ كل مرّة تتعمل، تتبدّل ولا تتعاود، نبعثولك إيميل والأجهزة الأخرى يخرجو. رقم التليفون، إذا عطيتو ← للرسائل اللي تنجّم تبعثهملك Tnajem على حسابك وحصصك (تأكيد حجز مثلاً)، وخلاص؛ وعمرو ما يتوّرى لأستاذ ولا لتلميذ.",
          "الاسم والدور ← الأستاذ يعرف شكون حجز، والتلميذ يعرف مع شكون باش يقرا.",
          // LEGAL-REVIEW: age threshold (MINOR_AGE_YEARS) and the lawful basis proposed for the age check (age.ts isAdult).
          `شهر وعام الولادة ← نتأكّدو اللي عمرك 18 سنة ولا أكثر: في فترة التجربة تنجّم كان للكبار، والأستاذ لازم ديما يكون عمرو 18 سنة ولا أكثر (حماية القاصرين). ما نطلبوش النهار: تتحسب راشد من الشهر اللي بعد شهر الـ18 سنة متاعك. شهر ولا عام مجهول يتحسب « أقلّ من ${MINOR_AGE_YEARS} سنة ». كان الباب يتحلّ للّي عمرهم أقلّ من ${MINOR_AGE_YEARS} سنة، يخدمو زادة باش نطلبو موافقة الوليّ قبل أيّ حجز.`,
          // LEGAL-REVIEW: consent (lawful basis: the guardian's consent). A18.2: no phone is asked.
          "اسم الوليّ والإيميل متاعو ← نجمعو موافقتو ونثبّتوها (الموافقة). ما نطلبوش التليفون متاعو.",
          "إيميل الولي ← باش نربطو بولدو الحساب اللي يحلّو الولي بالإيميل هذا. بالحساب هذا الولي يشوف الحصص المحجوزة ويقرا محادثات ولدو — والولد يتعلم بيها في كل محادثة. الولي ما ينجّمش يكتب ولا يحجز في بلاصتو، ومعلومات الاتصال متاع الأساتذة عمرها ما تتعطالو. أما ينجّم يسحب موافقتو من فضاء الولي: ولدو ما عادش ينجّم يحجز، والحصص الجاية متاعو تتلغى بلا مصاريف. هو برك ينجّم يرجّع الموافقة هاذي.",
          // LEGAL-REVIEW: retention after erasure — reported messages, and the anonymised consent proof (A27). A11: every photo.
          `مسح حسابك ← تنجّم تطلبو من « حسابي ». ما ينجّمش يصير ما دام عندك حصة جاية: ألغيها الأول. نخلّيولك ${DELETION_GRACE_DAYS} يوم باش تبدّل رايك، والأجهزة الأخرى تخرج من توّا. من بعد، حسابك يولّي مجهول: إسمك، الإيميل، التليفون، بصمة كلمة السرّ، شهر وعام ولادتك يتمسحو، تخرج من الأجهزة الكل، الرسائل اللي كتبتهم يتمسحو، وإسمك يتنحّى من إشعارات الناس الأخرى. كان إنت الوليّ المذكور في موافقة متاع طفل، إسمك، الإيميل والتليفون متاعك يتمسحو زادة من الموافقة هاذي: ما يبقى منها كان إلّي الموافقة تعطات، تاريخها، نصّها ونسختها. كان إنت أستاذ، صفحتك تتنحّى، عنوانها ما عادش ينجّم ياخذو حد آخر، ووثائق هويتك، الملفات اللي شاركتهم والتصاور متاعك الكل — حتى النسخ القديمة اللي بدّلتها — يتمسحو من التخزين. اللي يبقى ما يعرّفش بيك: أثر البلايص المحجوزة (لتاريخ الأستاذ وسجل الإلغاءات)، التقييمات متاعك بلا إسمك، التبليغات، ورسالة بلّغ عليها حد، تتحفظ كدليل. [يثبّت المحامي: الاحتفاظ بالرسائل المبلّغ عليها بعد مسح الحساب، وبموافقة وليّ ما عادش يتعرف شكون مولاها.]`,
          // LEGAL-REVIEW: lawful basis (product-team proposal). "وأغلبهم قاصرين" dropped: the pilot is adults only.
          "وثائق الهوية ← نتثبّتو إلّي الأستاذ هو فعلاً اللي يقول، قبل ما نعرّضوه للتلامذة (موافقة الأستاذ + مصلحة مشروعة في سلامة المجموعة). الأستاذ اللي يرفض ما ينجّمش يتوثّق، وبالتالي ما يظهرش للعموم.",
          "التصريح إنّك ما تقرّيش في العمومي ← نحترمو الأمر عدد 1619 لسنة 2015: تنجّم ما تعرضش أستاذ يخدم في مؤسسة تعليم عمومية. من غير التصريح هذا، ملف التوثيق ما يتبعثش وما يتقبلش، والإداري يقارنو بالمؤسسة المذكورة.",
          "الحجوزات ← تنظيم الحصص، الأماكن، قاعدة الإلغاء في 48 ساعة وسجل الإلغاءات.",
          `الرسائل في محادثة الحصة ← باش الأستاذ والتلميذ يتكلّمو بلا ما يتبادلو معلومات اتصال. حتى حد في Tnajem ما يقرا محادثة، كان رسالة مبلّغ عليها، توصل بنصّها لليستة المراقبة. قبل التسجيل، معلومات الاتصال تتخبّى آليًا وبالكامل: نمرة تليفون (بـ+216 ولا من غيرها)، إيميل، لينك، ولا لينك متاع تطبيق مراسلة (wa.me، t.me، فايسبوك، إنستغرام) مع النمرة ولا الإسم اللي بعدو. نحتفظو بنوع اللي تلقى، عمرنا ما نحتفظو بالنصّ. الفلتر هذا ما يشدّش كل شيء: تبادل معلومات الاتصال يبقى ممنوع (شروط الاستعمال، الفصل 8). المحادثة تتسكّر على طول كي يتلغى الحجز، كي حساب من الزوز يتعلّق، ولا كي الوليّ يسحب موافقتو، وإلا ${THREAD_CLOSE_DAYS} أيّام بعد ما تكمل الحصة. المحادثة المسكّرة تبقى تتقرا، وتنجّم ديما تبلّغ فيها على رسالة، أما حتى حد ما عادش ينجّم يكتب فيها.`,
          // LEGAL-REVIEW: retention of hidden content (A28). Reporting a message needs a participant's session.
          `التبليغات ← نحميو المستعملين، بالخصوص القاصرين. كل واحد ينجّم يبلّغ على صفحة أستاذ، حصة ولا وثيقة بزرّ « بلّغ »، حتى من غير ما يدخل لحسابو؛ الإيميل وقتها اختياري. أما الرسالة، تتبلّغ من المحادثة متاعها، من التلميذ ولا الأستاذ اللي فيها، وهو داخل لحسابو — حتى كي المحادثة تكون مسكّرة. كي تبلّغ وإنت داخل لحسابك، التبليغ يتربط بحسابك: الفريق يشوف دورك والإيميل متاع حسابك. التبليغ ما ينحّي حتى شي آليًا: واحد من الفريق يقراه ويقرّر. ينجّم يخبّي رسالة ولا تقييم: النصّ متاعو يتبدّل عند الناس الكل، حتى عند اللي كتبو، بـ« المحتوى هذا تنحّى من طرف المراقبة »، ويتحفظ كدليل، وما يقراه كان الإداريين. صاحب الحقوق ينجّم يطلب نحّي وثيقة بنفس الزرّ.`,
          "الوثائق والفيديوهات اللي ينشرهم الأستاذ ← باش تلامذتو يوصلولهم. الملفات تتخزّن برّة الويب العمومي وما تتقدّمش كان بعد ما نتثبّتو من حقّك (عمومي، تلميذ مسجّل عند الأستاذ — ولا في الحصة هاذيكا، كان الوثيقة مربوطة بيها —، ولا الأستاذ روحو) — عمرها ما تكون بعنوان يتحزّر. الفيديو ما هوش مستضاف عندنا: نسجّلو برك المعرّف متاعو في يوتيوب ونعرضوه بلا كوكي تتبّع.",
          `تصويرة الأستاذ ← باش يكون فمّا وجه في صفحتو. تتشاف من طرف إنسان قبل ما تظهر. ما نحتفظوش بالملف الأصلي: التصويرة تتعاود ترمّز في ثلاث أحجام وتتمسح المعطيات المخبّية الكل، ومنها موقع الـGPS اللي يكتبو تليفونك. كي تبدّل تصويرتك ولا تنحّيها، القديمة تتمسح من التخزين، بأحجامها الثلاثة. اللي عمرو أقلّ من ${MINOR_AGE_YEARS} سنة عمرو ما تكون عندو تصويرة، برك الحروف الأولى.`,
          "السجلاّت، الكودات المشفّرة وحدود التكرار ← الأمان ومقاومة الغشّ والتجاوزات. الحدّ المربوط بإيميل ما يحتفظ كان ببصمة منّو. بعد 5 كلمات سرّ غالطين لإيميل واحد من نفس العنوان IP، الدخول بكلمة السرّ يتوقّف 15 دقيقة للإيميل هذا من العنوان IP هذا. ويتوقّف زادة لعنوان IP كامل بعد 50 غلطة في 15 دقيقة، ولإيميل بعد 20 غلطة في ساعة. الدخول بالكود يبقى ديما ممكن.",
        ],
        after: [
          "ما نستعملوش معطياتك في الإشهار. ما نبيعوهمش، ما نكروهمش وما نبدّلوهمش.",
        ],
      },
      {
        h: "4. شكون ينجّم يشوف شنوّة",
        p: ["هاذي أهمّ نقطة، خلّينا نكونو دقيقين:"],
        list: [
          // A23 (D1): publicTutorName(), applied by the API.
          "صفحتك العمومية كأستاذ: إسمك الأوّل والحرف الأوّل من لقبك (مثلاً « سامي ب. »)، المادة، المستويات، التقديم والصورة — يشوفها الكلّ، هذا هو الهدف. إسمك الكامل ما يتوّرى لا للتلامذة لا للعموم: ما يشوفو كان إنت والإداريين متاع Tnajem. عنوان صفحتك، اللي تختارو إنت، عمومي زادة.",
          "إسمك الأوّل كتلميذ: يشوفو برك الأستاذ اللي حجزت عندو. التلاميذ الآخرين ما يشوفوش اسمك.",
          "للتلميذ القاصر: الوليّ المربوط بيه يشوف الحصص الجاية متاعو ويقرا محادثاتو.",
          "رقم تليفونك: عمرو ما يتعرض للعموم، وعمرو ما يتوّرى لأستاذ ولا لتلميذ.",
          "وثائق هويتك: عمرها ما تكون عمومية، ما تتشاركش مع التلاميذ، ما تتشاركش مع الأساتذة الآخرين، وما تتستعملش في حتى حاجة أخرى غير التوثيق.",
        ],
        after: [
          "بصفة ملموسة، وثائق الهوية تتشفّر قبل ما تتسجّل، برّة كل شيء يتقدّم للعموم: ملف يتنسخ من القرص ولا من نسخة احتياطية ما يتقراش من غير المفتاح. ما فمّا حتى رابط عمومي يفتحهم. الإداري المرخّص (قائمة محدودة من الإيميلات معرّفة في السيرفر) ياخذ، لكل وثيقة، رابط يخدم دقائق قليلة وما يستعملو كان هو. الوثيقة تتنزّل، عمرها ما تتخزّن في الكاش، وكل اطّلاع يتسجّل — شكون ووقتاش — قبل ما يتبعث الملفّ.",
          "المناولين: مستضيف السيرفر وقاعدة البيانات، خدمة تخزين الملفات إذا كانت خارجية، ومزوّد الإيميل اللي يبعث الإيمايلات متاعنا — كود الدخول، تنبيهات كلمة السرّ، والإيمايلات على حصصك واشتراكاتك (ياخذ الإيميل متاعك ومحتوى الإيمايلات هاذي، وخلاص). يخدمو بتعليماتنا وما عندهمش الحقّ يستعملو معطياتك لروحهم. [يكمّلو المحامي: هوية المناولين هاذم، بلاد الاستضافة، وإذا كانت السيرفرات برّة تونس، الترخيص بالإحالة اللي يستوجبو القانون عدد 63 لسنة 2004.]",
          "ما نعطيوش معطيات لسلطة كان إذا القانون التونسي يلزمنا.",
        ],
      },
      {
        h: "5. قدّاش نحتافظو بمعطياتك",
        p: [
          "وثائق الهوية هي المعطيات اللي نحتافظو بيها أقلّ وقت. تخدم في قرار، موش باش نعملو بيها أرشيف.",
        ],
        list: [
          // LEGAL-REVIEW: ID-document retention — the clock runs from the latest decision (retention.ts); see the FR note.
          `وثائق الهوية والشهائد: نحتافظو بيهم وقت دراسة الملفّ برك، ومن بعد يتحذفو في أجل أقصاه ${ID_DOCUMENT_RETENTION_DAYS} يوم بعد القرار — سواء الأستاذ تقبل ولا تنرفض — ولا كي يتمسح الحساب. كان الأستاذ يبعث ملف جديد، الوثائق القديمة متاعو تتحفظ معاه حتى ${ID_DOCUMENT_RETENTION_DAYS} يوم بعد القرار على الملف الجديد. [يكمّلو المحامي: المدّة القصوى لملف عمرو ما خذا قرار.]`,
          "بعد الحذف، ما يبقى كان أثر بسيط بلا الملفّ روحو: نوع الوثيقة اللي تقدّمت، تاريخ إرسالها، القرار وتاريخو. هذا اللي يخلّينا نثبّتو إلّي التوثيق صار فعلاً. [مدّة الاحتفاظ بالأثر هذا يحدّدها المحامي.]",
          `الحساب والملفّ الشخصي: نحتافظو بيهم ما دامك تستعمل حسابك. حساب ما تستعملش ${YEARS_INACTIVE} سنين يتمسح كيف ما كان طلبت إنت (الفصل 3). ما نبعثو حتى إيميل تذكير قبل. [يثبّت المحامي: المدّة هاذي، وإذا لازم نعلمو قبل.]`,
          "الحجوزات وسجل الإلغاءات: نحتافظو بيهم، ويولّيو مجهولين كي يتمسح الحساب. [المدّة يحدّدها المحامي.]",
          // LEGAL-REVIEW: message retention — closing (A2) deletes nothing; hidden content (A28) keeps its text.
          "الرسائل: تتحفظ ما دام الحسابين موجودين، حتى بعد ما المحادثة تتسكّر؛ رسائل الحساب اللي يتمسح يتمسحو، كان رسالة مبلّغ عليها. الرسالة ولا التقييم اللي خبّاتو المراقبة يقعد نصّو محفوظ، وما يقراه كان الإداريين. [المدّة يحدّدها المحامي.]",
          // LEGAL-REVIEW: retention of consent proof (A27) — no period is set in the code; none is invented.
          "موافقة الوليّ: تتحفظ ما دام حساب الطفل موجود، حتى بعد ما تتسحب (مع تاريخ السحب)، وتتمسح مع حساب الطفل؛ وكان حساب الوليّ يتمسح، إسمو، الإيميل والتليفون متاعو يتمسحو منها. [المدّة يحدّدها المحامي.]",
          "التبليغات وسجل أعمال الإداريين: يتحفظو. [المدّة يحدّدها المحامي.]",
          "كودات الدخول: مشفّرة، ما عادش تخدم بعد دقائق، ومن بعد تتحذف.",
          "كلمة السرّ: نحتفظو كان ببصمتها argon2id، ما دام الحساب موجود؛ وتتمسح مع الحساب.",
          `جلسة الدخول: تتسكّر ${SESSION_DAYS} يوم بعد الدخول، ولا بعد ${SESSION_IDLE_DAYS} يوم بلا استعمال، ولا كي تخرج — ومنها « اخرج من حسابك في الأجهزة الكل ».`,
        ],
        after: [
          "الحذف يعني الحذف: الملفّ يتمسح من التخزين والسطر يتمسح من قاعدة البيانات. موش برك يتحطّ في « أرشيف ».",
          "النسخ الاحتياطية متاع قاعدة البيانات والملفات تبقى فيها المعطيات الممسوحة حتى تتمسح هي روحها. [مدّة الاحتفاظ بالنسخ الاحتياطية يحدّدها المحامي.]",
        ],
      },
      {
        h: "6. الأمان",
        p: [
          "وثائق الهوية مشفّرة وما يوصلّها كان إداريين معيّنين، برابط شخصي ومؤقت؛ وكل اطّلاع يتسجّل. كلمات السرّ (argon2id)، كودات الدخول ورموز الجلسة يتحفظو كبصمة برك: كلمة السرّ متاعك ما تنجّمش تتقرا من اللي نحتفظو بيه. الاتّصال بالموقع مشفّر (HTTPS). النفاذ الإداري محدود بقائمة إيميلات معرّفة في السيرفر.",
          "ما فمّا نظام كامل. إذا صار حادث أمني يمسّ معطياتك، باش نعلموك ونعلمو الـINPDP كيما يستوجبو القانون.",
        ],
      },
      {
        h: "7. حقوقك",
        p: [
          "طبقًا للقانون الأساسي عدد 63 لسنة 2004 المؤرّخ في 27 جويلية 2004 المتعلّق بحماية المعطيات الشخصية، عندك الحقوق هاذي:",
        ],
        list: [
          "النفاذ: تعرف شنوّة معطيات عندنا عليك وتاخذ نسخة منها.",
          "التصحيح: تصلّح معطى غالط ولا ناقص.",
          "الحذف: تطلب مسح معطياتك، مباشرة من « حسابي » (الفصل 3)، بما فيها وثائق هويتك.",
          "الاعتراض: تعترض، لسبب مشروع، على معالجة.",
          "سحب الموافقة: وقت ما تحبّ، بلا ما يمسّ هذا اللي صار قبل. للتلميذ القاصر، الوليّ يسحب موافقتو من فضاء الولي. سحب موافقتك على التوثيق (كي تمسح حسابك ولا تكتبلنا) معناها صفحتك كأستاذ ما تبقاش منشورة.",
          "الشكاية: ترفع شكاية للهيئة الوطنية لحماية المعطيات الشخصية (INPDP) إذا شفت إلّي حقوقك ما تحترمتش.",
        ],
        after: [
          `باش تمارس حقّ آخر، اكتب لـ${PRIVACY_CONTACT_EMAIL} من العنوان المرتبط بحسابك. نجّمو نحتاجو نتثبّتو في هويتك (بلا ما نطلبو منّك وثائق جديدة بلا فايدة). نجاوبوك في أجل أقصاه شهر. [الأجل يثبّتو المحامي.]`,
          "للتلميذ القاصر، الحقوق هاذي يمارسها الوليّ اللي أعطى الموافقة.",
        ],
      },
      {
        h: "8. القاصرين",
        p: [
          // A24 / A14 — packages/shared/src/age.ts.
          "في فترة التجربة، تنجّم كان للّي عمرهم 18 سنة وفوق، تلامذة وأساتذة. كي تعمل حسابك، نطلبو منك شهر وعام ولادتك، والسيرفر يرفض الحساب كان عمرك ما وصلش 18 سنة: تتحسب راشد من الشهر اللي بعد شهر الـ18 سنة متاعك. الأستاذ لازم ديما يكون عمرو 18 سنة ولا أكثر. حساب تلميذ عمرو أقلّ من 18 سنة ينجّم يدخل، أما ما ينجّم يحجز حتى حصة.",
          // LEGAL-REVIEW: guardian consent wording; a consent entered by the child (A18.2 no phone, A13 guardian lock).
          `ما دام الباب هذا مسكّر، ما نطلبو حتى معطى من وليّ. كان يتحلّ، تلميذ عمرو أقلّ من ${MINOR_AGE_YEARS} سنة ما ينجّم يحجز حتى حصة من غير موافقة وليّ، ونحتافظو باسمو، الإيميل متاعو، نسخة السياسة هاذي وتاريخ الموافقة. الموافقة يعمّرها التلميذ باسم وليّو؛ وكي يترابط حساب الوليّ بالموافقة، التلميذ ما عادش ينجّم يبدّل الإيميل متاع وليّو. الوليّ يشوفها، وينجّم يسحبها ولا يرجّعها، من حسابو هو. [يثبّت المحامي: موافقة يعمّرها التلميذ، بلا تثبّت من هوية الوليّ.]`,
          "نقلّلو بإرادتنا في اللي نطلبوه من القاصر: إيميل، اسم، شهر وعام ولادة، وتليفون اختياري. القاصر عمرو ما يبعثلنا وثيقة هوية — الواجب هذا يخصّ الأساتذة برك — وعمرو ما تكون عندو تصويرة.",
        ],
      },
      {
        h: "9. الكوكيز",
        p: [
          "نستعملو ثلاثة كوكيز، وحتى واحد ما يتبّعك: كوكي الجلسة، ضروري، يخلّيك داخل بعد ما تعمّر كود الدخول ولا كلمة السرّ؛ كوكي يتفكّر دورك باش يبان المنيو الصحيح (ما يعطي نفاذ لحتى شي)؛ وكوكي يتفكّر اللغة اللي اخترتها.",
          "ما فمّا كوكي إشهاري، ما فمّا بيكسل شبكات اجتماعية، ما فمّاش قياس جمهور خارجي. فيديو يوتيوب ما يتحمّلش كان كي تشغّلو، من دومين يوتيوب اللي بلا كوكيز.",
        ],
      },
      {
        h: "10. تغيير السياسة هاذي",
        p: [
          "السياسة هاذي باش تتطوّر — بالخصوص وقت تفعيل الخلاص، اللي باش يزيد معطيات جديدة (المعاملات). النسخة المعتمدة هي اللي منشورة في الصفحة هاذي؛ والنسخة اللي تعطات تحتها موافقة الوليّ تتسجّل معاها. [يكمّلو المحامي: كيفاش نعلمو المستعملين بتغيير مهمّ، وإذا لازمة موافقة جديدة.]",
        ],
      },
      {
        h: "11. اتصل بينا",
        p: [
          `أسئلة على معطياتك، طلب نفاذ: ${PRIVACY_CONTACT_EMAIL}.`,
          "أسئلة أخرى: contact@tnajem.com.",
        ],
      },
    ],
    seeAlso: "شوف زادة: شروط الاستعمال",
  },
};

export default function PrivacyPage() {
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
            <Link href="/terms" className="linklike">{c.seeAlso}</Link>
          </p>
        </div>
      </section>
    </SiteShell>
  );
}
