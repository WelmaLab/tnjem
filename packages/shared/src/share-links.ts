/* SHARE LINKS — Espace prof v2 · Phase 3. Pure, client-safe, safe in the barrel.

   Tutors grow this product by pasting their link into WhatsApp groups, so every
   link the share sheet hands out is built HERE, once:

     profile  /{slug}
     class    /class/{id}
     offer    /{slug}?offre=mensuel
     promo    /{slug}?promo=CODE
     pack     /{slug}                 a fiche (live-fixes-1 · B): it is listed on the page

   each with `utm_source={target}`. LOCALE-BARE, like apps/web/components/app/links.ts
   (the links the tutor copies): the proxy sends each reader to THEIR language (the
   query survives that hop), and every surface of the tutor hands out one address.

   utm_source IS ANALYTICS ONLY, NEVER IDENTITY. It says which button the TUTOR
   pressed ("whatsapp"), nothing about who opened the link, and it feeds one
   aggregate counter (vitrine_stats_daily). normalizeUtmSource() maps anything
   outside the closed vocabulary to "other", so a hand-edited URL cannot write an
   arbitrary string into the database. */
import type { Locale } from "./types";

/** Buttons of the share sheet. `native` is navigator.share (Instagram, TikTok… on a phone). */
export const SHARE_TARGETS = [
  "whatsapp", "facebook", "messenger", "x", "telegram", "linkedin", "copy", "qr", "native",
] as const;
export type ShareTarget = (typeof SHARE_TARGETS)[number];

/** Every value vitrine_stats_daily.source can hold: a share target, a plain visit, or anything else. */
export const VITRINE_SOURCES = [...SHARE_TARGETS, "direct", "other"] as const;
export type VitrineSource = (typeof VITRINE_SOURCES)[number];

export function isShareTarget(raw: unknown): raw is ShareTarget {
  return typeof raw === "string" && (SHARE_TARGETS as readonly string[]).includes(raw);
}

/** utm_source → a stats source. Absent/empty → "direct"; unknown → "other". Never throws. */
export function normalizeUtmSource(raw: unknown): VitrineSource {
  if (raw === null || raw === undefined) return "direct";
  if (typeof raw !== "string") return "other";
  const v = raw.trim().toLowerCase();
  if (!v) return "direct";
  if (isShareTarget(v)) return v;
  // Common spellings people type by hand, folded onto the button that made them.
  if (v === "wa" || v === "whats" || v === "whatsapp_web") return "whatsapp";
  if (v === "fb") return "facebook";
  if (v === "twitter") return "x";
  if (v === "tg") return "telegram";
  return "other";
}

export type ShareKind = "profile" | "class" | "offer" | "promo" | "pack"; // live-fixes-1 · B: + pack (a fiche)

/** What is being shared. `classId` for kind "class", `promoCode` for kind "promo". */
export type ShareSubject = {
  kind: ShareKind;
  slug: string;
  classId?: string | null;
  promoCode?: string | null;
};

/** The path of a share link (locale-bare), before utm_source. */
export function sharePath(s: ShareSubject): string {
  const slug = encodeURIComponent(s.slug);
  switch (s.kind) {
    case "class":
      return s.classId ? `/class/${encodeURIComponent(s.classId)}` : `/${slug}`;
    case "offer":
      return `/${slug}?offre=mensuel`;
    case "promo":
      // A promotion with no code is public: it already shows on the plain profile.
      return s.promoCode ? `/${slug}?promo=${encodeURIComponent(s.promoCode)}` : `/${slug}`;
    default:
      return `/${slug}`;
  }
}

/** The full link one share target hands out: origin + path + utm_source={target}. */
export function shareUrl(origin: string, s: ShareSubject, target: ShareTarget): string {
  const path = sharePath(s);
  const sep = path.includes("?") ? "&" : "?";
  return `${origin.replace(/\/+$/, "")}${path}${sep}utm_source=${target}`;
}

/** The web intent a target opens, or null for the ones the sheet handles itself
    (copy, QR, native). Facebook and LinkedIn ignore pre-filled text: the sheet copies
    the message to the clipboard before opening them. Messenger's share intent is the
    app scheme; a desktop has no app, so the sheet copies the link there instead. */
export function shareIntentUrl(target: ShareTarget, url: string, message: string): string | null {
  const u = encodeURIComponent(url);
  const text = message.trim();
  switch (target) {
    case "whatsapp":
      return `https://wa.me/?text=${encodeURIComponent(text ? `${text}\n${url}` : url)}`;
    case "facebook":
      return `https://www.facebook.com/sharer/sharer.php?u=${u}`;
    case "messenger":
      return `fb-messenger://share/?link=${u}`;
    case "x":
      return `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${u}`;
    case "telegram":
      return `https://t.me/share/url?url=${u}&text=${encodeURIComponent(text)}`;
    case "linkedin":
      return `https://www.linkedin.com/sharing/share-offsite/?url=${u}`;
    default:
      return null;
  }
}

/* ── THE PRE-WRITTEN MESSAGES ─────────────────────────────────────────────────
   In the TUTOR's voice, because the tutor is the one sending them, and editable in
   the sheet before anything leaves. Three tones: chat apps (WhatsApp, Telegram,
   Messenger, copy, QR, native), X (short), and the "post" networks (Facebook,
   LinkedIn). Nothing here may claim more than the page shows: no rating, no
   student count, no payment promise — only the tutor's own subject, class,
   price and promotion. */
export type ShareMessageContext = {
  subject?: string | null;
  classTitle?: string | null;
  /** "DD/MM" and "HH:MM", already in Africa/Tunis. */
  classDate?: string | null;
  classTime?: string | null;
  sessionsPerMonth?: number | null;
  priceTnd?: number | null;
  percent?: number | null;
  /** "DD/MM", Africa/Tunis. */
  endsOn?: string | null;
  promoCode?: string | null;
  /** live-fixes-1 · B: the fiche's title (kind "pack"). */
  ficheTitle?: string | null;
};

type Tone = "chat" | "short" | "post";
const toneOf = (target: ShareTarget): Tone =>
  target === "x" ? "short" : target === "facebook" || target === "linkedin" ? "post" : "chat";

const MESSAGES: Record<Locale, Record<ShareKind, Record<Tone, (c: ShareMessageContext) => string>>> = {
  fr: {
    profile: {
      chat: (c) => `Salut ! Je donne des cours${c.subject ? ` de ${c.subject}` : ""} en direct sur Tnajem. Mes prochaines séances sont ici 👇`,
      short: (c) => `Cours${c.subject ? ` de ${c.subject}` : ""} en direct sur Tnajem — mes prochaines séances :`,
      post: (c) => `Je donne des cours${c.subject ? ` de ${c.subject}` : ""} en direct. Ma page prof et mes prochaines séances sont sur Tnajem :`,
    },
    class: {
      chat: (c) => `Je donne une séance en direct${c.classTitle ? ` : « ${c.classTitle} »` : ""}${c.classDate ? `, le ${c.classDate}` : ""}${c.classTime ? ` à ${c.classTime}` : ""}. Réserve ta place ici 👇`,
      short: (c) => `Séance en direct${c.classTitle ? ` « ${c.classTitle} »` : ""}${c.classDate ? ` le ${c.classDate}` : ""}${c.classTime ? ` à ${c.classTime}` : ""} :`,
      post: (c) => `Nouvelle séance en direct${c.classTitle ? ` : « ${c.classTitle} »` : ""}${c.classDate ? `, le ${c.classDate}` : ""}${c.classTime ? ` à ${c.classTime}` : ""}. Les places se réservent sur Tnajem :`,
    },
    offer: {
      chat: (c) => `Je propose un abonnement mensuel${c.sessionsPerMonth ? ` : ${c.sessionsPerMonth} séance${c.sessionsPerMonth > 1 ? "s" : ""} par mois` : ""}${c.priceTnd ? ` pour ${c.priceTnd} TND / mois` : ""}. Les détails sont ici 👇`,
      short: (c) => `Abonnement mensuel${c.priceTnd ? ` — ${c.priceTnd} TND / mois` : ""} :`,
      post: (c) => `Je propose un abonnement mensuel${c.sessionsPerMonth ? ` (${c.sessionsPerMonth} séance${c.sessionsPerMonth > 1 ? "s" : ""} par mois)` : ""}${c.priceTnd ? ` à ${c.priceTnd} TND / mois` : ""}. Tous les détails sur ma page Tnajem :`,
    },
    promo: {
      chat: (c) => `${c.percent ? `−${c.percent} % sur mes cours` : "Promo sur mes cours"}${c.endsOn ? ` jusqu'au ${c.endsOn}` : ""}${c.promoCode ? ` avec le code ${c.promoCode}` : ""}. C'est ici 👇`,
      short: (c) => `${c.percent ? `−${c.percent} %` : "Promo"} sur mes cours${c.endsOn ? ` jusqu'au ${c.endsOn}` : ""}${c.promoCode ? ` (code ${c.promoCode})` : ""} :`,
      post: (c) => `${c.percent ? `−${c.percent} % sur mes cours` : "Une promotion sur mes cours"}${c.endsOn ? ` jusqu'au ${c.endsOn}` : ""}${c.promoCode ? ` avec le code ${c.promoCode}` : ""}. Tout est sur ma page Tnajem :`,
    },
    // live-fixes-1 · B — a fiche. It is on the page; its file opens for enrolled students only.
    pack: {
      chat: (c) => `${c.ficheTitle ? `Ma fiche « ${c.ficheTitle} » est` : "Mes fiches sont"} sur ma page Tnajem. C'est ici 👇`,
      short: (c) => `${c.ficheTitle ? `Ma fiche « ${c.ficheTitle} »` : "Mes fiches"} sur Tnajem :`,
      post: (c) => `${c.ficheTitle ? `Ma fiche « ${c.ficheTitle} » est` : "Mes fiches sont"} sur ma page Tnajem, avec mes prochaines séances :`,
    },
  },
  ar: {
    profile: {
      chat: (c) => `عسلامة! نقرّي${c.subject ? ` ${c.subject}` : ""} دايركت على Tnajem. الحصص الجاية متاعي هوني 👇`,
      short: (c) => `دروس${c.subject ? ` ${c.subject}` : ""} دايركت على Tnajem — الحصص الجاية متاعي :`,
      post: (c) => `نقرّي${c.subject ? ` ${c.subject}` : ""} دايركت. صفحتي والحصص الجاية متاعي على Tnajem :`,
    },
    class: {
      chat: (c) => `عندي حصة دايركت${c.classTitle ? ` : « ${c.classTitle} »` : ""}${c.classDate ? ` نهار ${c.classDate}` : ""}${c.classTime ? ` على ${c.classTime}` : ""}. احجز بلاصتك هوني 👇`,
      short: (c) => `حصة دايركت${c.classTitle ? ` « ${c.classTitle} »` : ""}${c.classDate ? ` نهار ${c.classDate}` : ""}${c.classTime ? ` على ${c.classTime}` : ""} :`,
      post: (c) => `حصة دايركت جديدة${c.classTitle ? ` : « ${c.classTitle} »` : ""}${c.classDate ? ` نهار ${c.classDate}` : ""}${c.classTime ? ` على ${c.classTime}` : ""}. البلايص تتحجز على Tnajem :`,
    },
    offer: {
      chat: (c) => `عندي اشتراك شهري${c.sessionsPerMonth ? ` : ${c.sessionsPerMonth} حصص في الشهر` : ""}${c.priceTnd ? ` بـ ${c.priceTnd} د.ت في الشهر` : ""}. التفاصيل هوني 👇`,
      short: (c) => `اشتراك شهري${c.priceTnd ? ` — ${c.priceTnd} د.ت في الشهر` : ""} :`,
      post: (c) => `عندي اشتراك شهري${c.sessionsPerMonth ? ` (${c.sessionsPerMonth} حصص في الشهر)` : ""}${c.priceTnd ? ` بـ ${c.priceTnd} د.ت في الشهر` : ""}. التفاصيل الكل في صفحتي على Tnajem :`,
    },
    promo: {
      chat: (c) => `${c.percent ? `\u2066−${c.percent} %\u2069 على دروسي` : "تخفيض على دروسي"}${c.endsOn ? ` حتى لـ ${c.endsOn}` : ""}${c.promoCode ? ` بالكود ${c.promoCode}` : ""}. هوني 👇`,
      short: (c) => `${c.percent ? `\u2066−${c.percent} %\u2069` : "تخفيض"} على دروسي${c.endsOn ? ` حتى لـ ${c.endsOn}` : ""}${c.promoCode ? ` (كود ${c.promoCode})` : ""} :`,
      post: (c) => `${c.percent ? `\u2066−${c.percent} %\u2069 على دروسي` : "تخفيض على دروسي"}${c.endsOn ? ` حتى لـ ${c.endsOn}` : ""}${c.promoCode ? ` بالكود ${c.promoCode}` : ""}. كل شي في صفحتي على Tnajem :`,
    },
    pack: {
      chat: (c) => `${c.ficheTitle ? `الملخّص متاعي « ${c.ficheTitle} »` : "الملخّصات متاعي"} في صفحتي على Tnajem. هوني 👇`,
      short: (c) => `${c.ficheTitle ? `الملخّص متاعي « ${c.ficheTitle} »` : "الملخّصات متاعي"} على Tnajem :`,
      post: (c) => `${c.ficheTitle ? `الملخّص متاعي « ${c.ficheTitle} »` : "الملخّصات متاعي"} في صفحتي على Tnajem، مع الحصص الجاية متاعي :`,
    },
  },
};

/** The pre-written message for one target, in one language. The tutor can edit it. */
export function defaultShareMessage(kind: ShareKind, target: ShareTarget, locale: Locale, ctx: ShareMessageContext = {}): string {
  return MESSAGES[locale][kind][toneOf(target)](ctx);
}
