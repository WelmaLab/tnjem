/* SERVER-ONLY INFRASTRUCTURE. Reached via the "@tnajem/shared/mail" (or /sms)
   SUBPATH and deliberately NOT re-exported from the barrel — the barrel is
   imported by client components, and dragging a mail transport into the
   browser bundle is the same mistake that broke the build when auth-core
   was barrelled (UnhandledSchemeError: node:crypto).

   There is no `import "server-only"` here for the same reason as @tnajem/db:
   Fastify and tsx both load this and server-only throws under tsx.

   It lives in shared rather than apps/api because BOTH apps need it during
   the Step 4 transition: the API sends OTP mail, and apps/web still runs
   lib/notify.ts. Once notify moves in the notif domain, this can follow it
   into apps/api. */
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { logEvent } from "./observability";

/* Email delivery for OTP codes — the sibling of lib/sms.ts, deliberately shaped the
   same way (mailEnabled / sendMail) so the two channels stay swappable behind
   otpChannel() in lib/auth.ts.

   WHY A DEPENDENCY HERE, WHEN lib/sms.ts HAS NONE. That file talks to Twilio over
   HTTPS, so `fetch` is the whole client and an SDK would be dead weight. SMTP is not
   HTTP: it is a stateful socket conversation (EHLO → AUTH → MAIL FROM → RCPT TO →
   DATA → QUIT) over implicit TLS, with base64 auth, RFC 2047 encoded-words for the
   Arabic subject line, CRLF discipline and dot-stuffing. `fetch` cannot speak it at
   all. nodemailer has ZERO transitive dependencies, so this adds one entry rather
   than a tree — and a subtle hand-rolled protocol bug here means nobody can log in.

   Configure with MAIL_HOST / MAIL_PORT / MAIL_SECURE / MAIL_USER / MAIL_PASS /
   MAIL_FROM_NAME / MAIL_FROM_ADDRESS / MAIL_REPLY_TO. When those are absent
   mailEnabled() is false and requestOtp() falls back to showing the code on-screen
   (dev mode only — it never does that once a provider is configured). */

export function mailEnabled(): boolean {
  return Boolean(
    process.env.MAIL_HOST &&
      process.env.MAIL_USER &&
      process.env.MAIL_PASS &&
      process.env.MAIL_FROM_ADDRESS,
  );
}

/* ── TRUE SINGLETON, cached on globalThis ────────────────────────────────────
   Same pattern and the same reason as the Postgres client in lib/db/index.ts:
   Next's dev server re-evaluates this module on every save, and a bundler can
   instantiate a module twice in one process. A module-level createTransport()
   would therefore leak a whole pooled TLS connection set per edit, walking Gmail
   up to its concurrent-connection limit over an afternoon of work.

   pool:true also matters in production: without it every single login pays for a
   fresh TLS handshake with Gmail before the code can go out. */
const g = globalThis as unknown as { __tnajemMail?: Transporter };

function transport(): Transporter | null {
  if (!mailEnabled()) return null;
  if (g.__tnajemMail) return g.__tnajemMail;

  const port = Number(process.env.MAIL_PORT ?? 465) || 465;
  const t = nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port,
    /* true = implicit TLS (port 465, what Gmail wants). false = plain connect then
       STARTTLS (587). Derived from the port when MAIL_SECURE is unset, so a
       half-configured env still does the right thing rather than the insecure one. */
    secure: process.env.MAIL_SECURE ? process.env.MAIL_SECURE === "true" : port === 465,
    auth: { user: process.env.MAIL_USER as string, pass: process.env.MAIL_PASS as string },
    pool: true,
    maxConnections: 3,
    /* Bound every stage. The default is to wait indefinitely, which would turn a
       blocked SMTP port into a login request that hangs until the platform kills
       it — instead of the clean "send-failed, try again" the UI already handles. */
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  g.__tnajemMail = t;
  return t;
}

/** Sender header, e.g. `Tnajem <support@tnajem.com>`. Gmail rewrites From to the
    authenticated account unless the address is a verified alias, so MAIL_FROM_ADDRESS
    should equal MAIL_USER — see .env.example. */
function fromHeader(): string {
  const address = process.env.MAIL_FROM_ADDRESS as string;
  const name = process.env.MAIL_FROM_NAME?.trim();
  return name ? `${name} <${address}>` : address;
}

/* espace prof v2 (contract C5): the optional 4th parameter, the same shape the pro
   team wrote. Every existing three-argument call is unchanged. `headers` carries
   List-Unsubscribe (packages/shared/src/unsubscribe.ts); `attachments` the booking
   .ics (pro P7); `html` an optional alternative part — the text part is always sent. */
export type MailExtras = {
  headers?: Record<string, string>;
  attachments?: { filename: string; content: string | Buffer; contentType: string }[];
  html?: string;
};

/** Send one transactional email. Returns false on any failure; never throws — the
    caller turns that into a retryable error, exactly as with sendSms(). */
export async function sendMail(to: string, subject: string, text: string, extras?: MailExtras): Promise<boolean> {
  const opts = extras ?? {};
  const t = transport();
  if (!t) return false;
  try {
    await t.sendMail({
      from: fromHeader(),
      to,
      subject,
      /* Plain text only, on purpose. A six-digit code needs no layout, and a
         text-only body is the least likely to be held back by a spam filter —
         which for a login code is the whole product. nodemailer handles the RFC
         2047 encoding of the Arabic subject and the base64 of the UTF-8 body. */
      text,
      ...(opts.html ? { html: opts.html } : {}),
      ...(opts.headers ? { headers: opts.headers } : {}),
      ...(opts.attachments?.length
        ? { attachments: opts.attachments.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })) }
        : {}),
      ...(process.env.MAIL_REPLY_TO ? { replyTo: process.env.MAIL_REPLY_TO } : {}),
    });
    return true;
  } catch (e) {
    /* WHAT failed, never TO WHOM. The whole nodemailer error used to be logged, and
       an SMTP refusal carries the recipient in `response` ("550 5.1.1 <a@b.tn>"),
       `command` ("RCPT TO:<a@b.tn>") and `rejected[]`. This line bypasses the
       API's redacting logger, so it must not contain an address.

       A JSON `event` line since Stage 7: this is the "OTP send failures" signal
       PRODUCTION_READINESS.md asks to alert on, and it has to be queryable. Every
       login code goes through here, so a broken mail provider means nobody can log
       in — with no user-visible error, because requestOtp still returns ok. */
    logEvent("error", "mail_send_failed", { detail: describeMailError(e) });
    return false;
  }
}

/** A mail error reduced to what an operator needs and nothing personal:
    the nodemailer code, the SMTP status and the SMTP verb. */
export function describeMailError(e: unknown): string {
  const err = e as { code?: string; responseCode?: number; command?: string; name?: string };
  const verb = err.command ? String(err.command).split(/[\s:]/)[0] : "";
  return [err.code ?? err.name ?? "Error", err.responseCode ? String(err.responseCode) : "", verb ? `during ${verb}` : ""]
    .filter(Boolean)
    .join(" ");
}

/** Can we log in to the SMTP server? Connects and authenticates WITHOUT sending
    anything (nodemailer's verify()). Used by `npm run db:check`; never throws and
    never returns a credential or an address. */
export async function verifyMail(timeoutMs = 15_000): Promise<{ ok: true } | { ok: false; error: string }> {
  const t = transport();
  if (!t) return { ok: false, error: "not-configured" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      t.verify(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })), timeoutMs);
      }),
    ]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describeMailError(e) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Close the pooled connections (one-shot scripts like db:check must not hang on them). */
export function closeMail(): void {
  g.__tnajemMail?.close();
  g.__tnajemMail = undefined;
}
