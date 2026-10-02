"use client";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  defaultShareMessage, formatNumericDate, shareIntentUrl, shareUrl, tunisClock,
  type ShareKind, type ShareTarget,
} from "@tnajem/shared";
import { useLocale } from "@/components/LocaleProvider";
import { Copy, Check, Share } from "@/components/icons";
import { pageUrl } from "@/components/app/links";
import { bilingual } from "@/lib/i18n";

/** The origin of the links the tutor copies (NEXT_PUBLIC_SITE_URL, via links.ts). */
const SITE_ORIGIN = new URL(pageUrl("x")).origin;

/* THE SHARE SHEET — Espace prof v2 · Phase 3 · contract C3.

   Opened from the home "Ma vitrine" card, Ma vitrine, Mes classes, right after a
   class is published, and from Promotions/Abonnements. One sheet for the four
   things a tutor shares (their page, a class, the monthly offer, a promotion):

     • a target per network — WhatsApp, Facebook, Messenger, X, Telegram, LinkedIn —
       each with its own pre-written FR and AR message the tutor can edit first;
     • "Copier le lien" and a QR code they can download as a PNG (for a printed
       flyer or a classroom wall);
     • the phone's native sheet when navigator.share exists — the only way to
       reach Instagram and TikTok, which have no web share intent.

   Every link carries utm_source={target} (packages/shared/src/share-links.ts) —
   ANALYTICS ONLY, it says which button was pressed and nothing about the reader.

   A native <dialog> opened with showModal(): focus moves in and is trapped, Escape
   closes, the page behind is inert, and focus returns to the trigger — all from
   the platform. `onShared` fires on any share, copy or QR by the owner (Ma vitrine
   wires it to the "link shared" setup step, contract C2). */

const copy = bilingual({
  fr: {
    titles: { profile: "Partager ma page", class: "Partager cette séance", offer: "Partager mon abonnement", promo: "Partager ma promotion", pack: "Partager cette fiche" } as Record<ShareKind, string>,
    close: "Fermer",
    link: "Ton lien",
    copyLink: "Copier le lien",
    copied: "Lien copié",
    sendOn: "Envoyer sur",
    more: "Plus d'apps",
    moreHint: "Instagram, TikTok…",
    message: "Ton message",
    messageLang: "Langue du message",
    reset: "Remettre le message proposé",
    shareOn: (t: string) => `Partager sur ${t}`,
    shareNative: "Partager avec une autre app",
    postNote: "Facebook et LinkedIn n'acceptent pas de texte : ton message est copié, colle-le dans ta publication.",
    messengerNote: "Sur ordinateur, Messenger ne s'ouvre pas tout seul : le lien est copié, colle-le dans ta conversation.",
    msgCopied: "Message copié — colle-le dans ta publication",
    linkCopiedFor: "Lien copié — colle-le dans Messenger",
    qr: "QR code",
    qrHide: "Masquer le QR code",
    qrAlt: "QR code de ton lien Tnajem",
    qrDownload: "Télécharger le PNG",
    qrHint: "À imprimer sur une affiche ou à montrer en classe : il ouvre ta page.",
    copyFailed: "Copie impossible — sélectionne le lien et copie-le à la main.",
  },
  ar: {
    titles: { profile: "شارك صفحتي", class: "شارك الحصة هاذي", offer: "شارك الاشتراك متاعي", promo: "شارك التخفيض متاعي", pack: "شارك الملخّص هذا" } as Record<ShareKind, string>,
    close: "سكّر",
    link: "الرابط متاعك",
    copyLink: "انسخ الرابط",
    copied: "الرابط تنسخ",
    sendOn: "ابعث على",
    more: "تطبيقات أخرى",
    moreHint: "Instagram، TikTok…",
    message: "الرسالة متاعك",
    messageLang: "لغة الرسالة",
    reset: "رجّع الرسالة المقترحة",
    shareOn: (t: string) => `شارك على ${t}`,
    shareNative: "شارك بتطبيق آخر",
    postNote: "Facebook و LinkedIn ما يقبلوش نص : الرسالة متاعك تنسخت، الصقها في البوست.",
    messengerNote: "على الكمبيوتر، Messenger ما يتحلّش وحدو : الرابط تنسخ، الصقو في المحادثة.",
    msgCopied: "الرسالة تنسخت — الصقها في البوست",
    linkCopiedFor: "الرابط تنسخ — الصقو في Messenger",
    qr: "QR code",
    qrHide: "خبّي الـ QR code",
    qrAlt: "QR code متاع الرابط متاعك في Tnajem",
    qrDownload: "نزّل الصورة PNG",
    qrHint: "اطبعو على أفيش ولا ورّيه في القسم : يحلّ صفحتك.",
    copyFailed: "النسخ ما مشاش — اختار الرابط وانسخو بيدك.",
  },
});

/** Display names are brands — the same in both languages. */
const TARGET_LABEL: Record<Exclude<ShareTarget, "copy" | "qr" | "native">, string> = {
  whatsapp: "WhatsApp",
  facebook: "Facebook",
  messenger: "Messenger",
  x: "X",
  telegram: "Telegram",
  linkedin: "LinkedIn",
};
type IntentTarget = keyof typeof TARGET_LABEL;
const INTENT_TARGETS = Object.keys(TARGET_LABEL) as IntentTarget[];

export type ShareSheetProps = {
  kind: ShareKind;
  slug: string;
  classId?: string | null;
  promoCode?: string | null;
  /* Message context — only what the page actually shows (truth rule). */
  subject?: string | null;
  classTitle?: string | null;
  /** ISO instant of the class; formatted DD/MM/YYYY + HH:MM in Tunis. */
  startsAt?: string | null;
  sessionsPerMonth?: number | null;
  priceTnd?: number | null;
  percent?: number | null;
  /** ISO instant the promotion ends. */
  endsAt?: string | null;
  /** live-fixes-1 · B: the fiche's title (kind "pack"). */
  ficheTitle?: string | null;
  /** Fired on any share / copy / QR (the owner's "link shared" step, contract C2). */
  onShared?: (target: ShareTarget) => void;
};

const isPhone = () => typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* Older WebViews: the select-and-copy fallback. */
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function ShareSheet({ open, onClose, ...props }: ShareSheetProps & { open: boolean; onClose: () => void }) {
  const { locale } = useLocale();
  const c = copy[locale];
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [msgLang, setMsgLang] = useState<"fr" | "ar">(locale);
  const [target, setTarget] = useState<IntentTarget>("whatsapp");
  /* Per (language, target) edits: switching target shows THAT target's message,
     and coming back keeps what the tutor typed. */
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [canNative, setCanNative] = useState(false);
  const [showQr, setShowQr] = useState(false);
  // The public origin every copied link uses (components/app/links.ts) — never the
  // address this page happens to be served from.
  const origin = SITE_ORIGIN;
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    setCanNative(typeof navigator.share === "function");
  }, []);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const say = useCallback((m: string) => {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  const ctx = useMemo(() => ({
    subject: props.subject ?? null,
    classTitle: props.classTitle ?? null,
    classDate: props.startsAt ? formatNumericDate(props.startsAt) : null,
    classTime: props.startsAt ? tunisClock(props.startsAt) : null,
    sessionsPerMonth: props.sessionsPerMonth ?? null,
    priceTnd: props.priceTnd ?? null,
    percent: props.percent ?? null,
    endsOn: props.endsAt ? formatNumericDate(props.endsAt) : null,
    promoCode: props.promoCode ?? null,
    ficheTitle: props.ficheTitle ?? null,
  }), [props.subject, props.classTitle, props.startsAt, props.sessionsPerMonth, props.priceTnd, props.percent, props.endsAt, props.promoCode, props.ficheTitle]);

  const subject = { kind: props.kind, slug: props.slug, classId: props.classId, promoCode: props.promoCode };
  const urlFor = (t: ShareTarget) => shareUrl(origin, subject, t);
  const editKey = `${msgLang}:${target}`;
  const message = edits[editKey] ?? defaultShareMessage(props.kind, target, msgLang, ctx);

  const shared = (t: ShareTarget) => props.onShared?.(t);

  async function copyLink() {
    const ok = await writeClipboard(urlFor("copy"));
    say(ok ? c.copied : c.copyFailed);
    if (ok) shared("copy");
  }

  async function shareIntent() {
    const url = urlFor(target);
    if (target === "facebook" || target === "linkedin") {
      // Neither accepts pre-filled text: hand the message over through the clipboard.
      if (await writeClipboard(`${message}\n${url}`)) say(c.msgCopied);
    }
    if (target === "messenger" && !isPhone()) {
      if (await writeClipboard(`${message}\n${url}`)) say(c.linkCopiedFor);
      window.open("https://www.messenger.com/", "_blank", "noopener,noreferrer");
      shared(target);
      return;
    }
    const href = shareIntentUrl(target, url, message);
    if (href) window.open(href, "_blank", "noopener,noreferrer");
    shared(target);
  }

  async function shareNative() {
    try {
      await navigator.share({ text: message, url: urlFor("native") });
      shared("native");
    } catch {
      /* dismissed — not an error */
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="shs"
      aria-labelledby="shs-title"
      onClose={onClose}
      onClick={(e) => {
        // A click on the backdrop lands on the <dialog> itself.
        if (e.target === dialogRef.current) onClose();
      }}
      data-e2e="share-sheet"
    >
      <div className="shs-body">
        <div className="shs-head">
          <h2 id="shs-title" className="shs-title">{c.titles[props.kind]}</h2>
          <button type="button" className="iconbtn shs-x" onClick={onClose} aria-label={c.close}>
            <span aria-hidden="true">×</span>
          </button>
        </div>

        {/* ── The link, and copying it ── */}
        <div className="shs-label">{c.link}</div>
        <div className="shs-linkrow">
          <input className="shs-link" readOnly value={urlFor("copy")} aria-label={c.link} dir="ltr" data-e2e="share-link" onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="btn btn-ghost btn-sm shs-copy" onClick={copyLink} data-e2e="share-copy">
            <Copy />
            {c.copyLink}
          </button>
        </div>

        {/* ── Which network ── */}
        <div className="shs-label" id="shs-targets">{c.sendOn}</div>
        <div className="shs-targets" role="radiogroup" aria-labelledby="shs-targets">
          {INTENT_TARGETS.map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={target === t}
              className={`shs-target${target === t ? " is-on" : ""}`}
              onClick={() => setTarget(t)}
              data-e2e={`share-target-${t}`}
            >
              {target === t && <Check />}
              {TARGET_LABEL[t]}
            </button>
          ))}
        </div>

        {/* ── The message: pre-written per target and language, editable ── */}
        <div className="shs-msghead">
          <label className="shs-label" htmlFor="shs-msg">{c.message}</label>
          <div className="shs-lang" role="group" aria-label={c.messageLang}>
            {(["fr", "ar"] as const).map((l) => (
              <button key={l} type="button" aria-pressed={msgLang === l} className={`shs-langbtn${msgLang === l ? " is-on" : ""}`} onClick={() => setMsgLang(l)} lang={l}>
                {l === "fr" ? "FR" : "ع"}
              </button>
            ))}
          </div>
        </div>
        <textarea
          id="shs-msg"
          className="shs-msg"
          rows={4}
          dir={msgLang === "ar" ? "rtl" : "ltr"}
          lang={msgLang}
          value={message}
          maxLength={600}
          onChange={(e) => setEdits((m) => ({ ...m, [editKey]: e.target.value }))}
          data-e2e="share-message"
        />
        {edits[editKey] !== undefined && (
          <button type="button" className="shs-reset" onClick={() => setEdits((m) => { const n = { ...m }; delete n[editKey]; return n; })}>
            {c.reset}
          </button>
        )}
        {(target === "facebook" || target === "linkedin") && <p className="shs-note">{c.postNote}</p>}
        {target === "messenger" && <p className="shs-note">{c.messengerNote}</p>}

        {/* The ONE main action of the sheet. */}
        <button type="button" className="btn btn-primary shs-go" onClick={shareIntent} data-e2e="share-go">
          <Share />
          {c.shareOn(TARGET_LABEL[target])}
        </button>

        <div className="shs-secondary">
          {canNative && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={shareNative} data-e2e="share-native">
              {c.more} <span className="shs-hint">· {c.moreHint}</span>
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" aria-expanded={showQr} onClick={() => setShowQr((v) => !v)} data-e2e="share-qr-toggle">
            {showQr ? c.qrHide : c.qr}
          </button>
        </div>

        {showQr && (
          <QrPanel url={urlFor("qr")} fileName={`tnajem-${props.slug}-qr.png`} alt={c.qrAlt} hint={c.qrHint} download={c.qrDownload} onDownload={() => shared("qr")} />
        )}
      </div>

      {toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}

      <style dangerouslySetInnerHTML={{ __html: SHEET_CSS }} />
    </dialog>
  );
}

type QrFactory = (typeNumber: 0, level: "M") => {
  addData(s: string): void;
  make(): void;
  getModuleCount(): number;
  isDark(row: number, col: number): boolean;
};

/* The QR code, drawn on a canvas so it can be saved as a PNG. The library is
   loaded only when the tutor asks for a QR — it never ships on page load. Black
   on white with a 4-module quiet zone: the combination every scanner reads. */
function QrPanel({ url, fileName, alt, hint, download, onDownload }: {
  url: string; fileName: string; alt: string; hint: string; download: string; onDownload: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [png, setPng] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void import("qrcode-generator").then((mod) => {
      // A CommonJS module: the factory is `default` under the bundler's interop, or the module itself.
      const factory = ((mod as { default?: unknown }).default ?? mod) as QrFactory;
      const qr = factory(0, "M");
      qr.addData(url);
      qr.make();
      const n = qr.getModuleCount();
      const cell = 8;
      const margin = 4 * cell;
      const size = n * cell + margin * 2;
      const canvas = canvasRef.current;
      if (!alive || !canvas) return;
      canvas.width = size;
      canvas.height = size;
      const g = canvas.getContext("2d");
      if (!g) return;
      g.fillStyle = "#fff";
      g.fillRect(0, 0, size, size);
      g.fillStyle = "#000";
      for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (qr.isDark(r, col)) g.fillRect(margin + col * cell, margin + r * cell, cell, cell);
      setPng(canvas.toDataURL("image/png"));
    });
    return () => {
      alive = false;
    };
  }, [url]);

  return (
    <div className="shs-qr" data-e2e="share-qr">
      <canvas ref={canvasRef} className="shs-qr-canvas" role="img" aria-label={alt} />
      <p className="shs-note">{hint}</p>
      {png && (
        <a className="btn btn-outline btn-sm" href={png} download={fileName} onClick={onDownload} data-e2e="share-qr-download">
          {download}
        </a>
      )}
    </div>
  );
}

/* margin:auto restores the native <dialog> centring that globals.css's `*{margin:0}`
   reset removes (ConfirmDialog's .aps-dialog does the same); on a phone the
   block-end and inline margins drop to 0, so the sheet sits on the bottom edge. */
const SHEET_CSS = `
  .shs{margin:auto;border:0;padding:0;background:var(--paper);color:var(--ink);border-radius:var(--r-l);
    inline-size:min(520px,calc(100% - 32px));max-block-size:calc(100% - 32px);box-shadow:var(--sh-l)}
  .shs::backdrop{background:rgba(10,23,38,.48)}
  .shs-body{padding:20px 20px 22px;display:grid;gap:10px}
  .shs-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-block-end:4px}
  .shs-title{font-family:var(--fd);font-size:19px;letter-spacing:-.3px;line-height:1.25;margin:0}
  .shs-x{font-size:24px;line-height:1}
  .shs-label{font-size:13px;font-weight:700;color:var(--ink2);margin-block-start:4px}
  .shs-linkrow{display:flex;gap:8px;align-items:stretch;flex-wrap:wrap}
  .shs-link{flex:1 1 220px;min-width:0;min-height:44px;border:1.6px solid var(--line);border-radius:12px;
    padding-inline:12px;font-size:13.5px;color:var(--ink2);background:var(--cream);text-align:start}
  .shs-link:focus-visible{outline:3px solid var(--blue);outline-offset:2px}
  .shs-copy{flex:none;display:inline-flex;align-items:center;gap:6px}
  .shs-copy .ic{width:16px;height:16px}
  .shs-targets{display:flex;flex-wrap:wrap;gap:8px}
  .shs-target{display:inline-flex;align-items:center;gap:6px;min-height:44px;padding-inline:14px;border-radius:999px;
    border:1.5px solid var(--line);background:var(--paper);color:var(--ink);font-weight:700;font-size:13.5px;cursor:pointer}
  .shs-target .ic{width:15px;height:15px}
  .shs-target.is-on{border-color:var(--blue);background:var(--blue50);color:var(--blue700)}
  .shs-target:focus-visible,.shs-langbtn:focus-visible,.shs-reset:focus-visible{outline:3px solid var(--blue);outline-offset:2px}
  .shs-msghead{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-block-start:4px}
  .shs-msghead .shs-label{margin:0}
  .shs-lang{display:inline-flex;border:1.5px solid var(--line);border-radius:10px;overflow:hidden;flex:none}
  .shs-langbtn{min-width:44px;min-height:44px;border:0;background:transparent;color:var(--ink2);font-weight:700;font-size:14px;cursor:pointer}
  .shs-langbtn.is-on{background:var(--blue50);color:var(--blue700)}
  .shs-msg{inline-size:100%;min-height:104px;border:1.6px solid var(--line);border-radius:12px;padding:12px;
    font:inherit;font-size:14px;line-height:1.55;color:var(--ink);background:var(--paper);resize:vertical}
  .shs-msg:focus-visible{outline:3px solid var(--blue);outline-offset:2px;border-color:var(--blue)}
  .shs-reset{justify-self:start;border:0;background:none;color:var(--blue700);font-weight:700;font-size:13px;min-height:44px;cursor:pointer;padding:0}
  .shs-note{font-size:13px;color:var(--muted);line-height:1.55;margin:0}
  .shs-go{margin-block-start:6px;min-height:50px;display:inline-flex;align-items:center;justify-content:center;gap:8px}
  .shs-go .ic{width:17px;height:17px}
  .shs-secondary{display:flex;flex-wrap:wrap;gap:8px}
  .shs-secondary .btn{flex:1 1 160px}
  .shs-hint{font-weight:600;color:var(--muted)}
  .shs-qr{display:grid;justify-items:center;gap:10px;padding:14px;border:1px solid var(--line);border-radius:var(--r);background:var(--cream)}
  .shs-qr-canvas{inline-size:min(220px,70vw);block-size:auto;image-rendering:pixelated;background:#fff;border-radius:8px}
  @media (max-width:599px){
    .shs{inline-size:100%;max-inline-size:100%;margin-block-end:0;margin-inline:0;
      border-end-start-radius:0;border-end-end-radius:0;max-block-size:92dvh}
  }
`;
