/* Helpers shared by the journey specs (journey-*.spec.ts). Nothing here weakens a
   production path: sessions are minted exactly like e2e/support/session.ts does,
   and the API is called over HTTP the way the web app calls it. */
import type { Browser, BrowserContext } from "@playwright/test";
import { sql } from "./db";
import { mintSession, sessionCookie } from "./session";
import { renderNotification } from "@tnajem/shared/notification-messages";

export const API = process.env.E2E_API_URL ?? "http://127.0.0.1:4000";

export async function api(path: string, token?: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${API}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { cookie: `tnajem_session=${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return (await res.json()) as Record<string, unknown>;
}

/** A browser context signed in as this profile. reducedMotion: the dashboards animate. */
export async function contextAs(browser: Browser, profileId: string): Promise<BrowserContext> {
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  await ctx.addCookies([sessionCookie(await mintSession(profileId))]);
  return ctx;
}

/** The session token the browser actually holds (after a real OTP login). */
export async function browserSession(ctx: BrowserContext): Promise<string> {
  const c = (await ctx.cookies()).find((x) => x.name === "tnajem_session");
  if (!c) throw new Error("E2E: the browser holds no session cookie");
  return c.value;
}

/** A real PNG of a clearly FICTITIOUS identity document, rendered by Chromium. */
export async function specimenIdPng(browser: Browser, name: string): Promise<Buffer> {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  await page.setContent(`
    <div id="card" style="width:600px;height:360px;margin:20px;border-radius:18px;background:#e8f0f8;
         border:3px solid #0e5aa6;font-family:Arial,sans-serif;padding:26px;box-sizing:border-box;color:#10223a">
      <div style="font-size:15px;letter-spacing:2px;color:#0e5aa6;font-weight:700">SPECIMEN — DOCUMENT FICTIF (E2E)</div>
      <div style="margin-top:34px;font-size:28px;font-weight:700">${name}</div>
      <div style="margin-top:12px;font-size:17px">Carte d'identité de test · aucune personne réelle</div>
      <div style="margin-top:70px;font-size:14px;color:#445">N° 00000000 · généré par la suite Playwright</div>
    </div>`);
  const png = await page.locator("#card").screenshot();
  await page.close();
  return png;
}

/** The notifications' bodies as the bell shows them in French: since 0040 a row is a
    message key + parameters, rendered when read (@tnajem/shared/notification-messages). */
export async function notificationBodies(profileId: string, kind: string): Promise<string[]> {
  return (await notificationTexts(profileId, kind)).map((t) => t.body);
}

export async function notificationTexts(profileId: string, kind: string, locale: "fr" | "ar" = "fr"): Promise<{ title: string; body: string }[]> {
  const rows = await sql<{ msg_key: string | null; msg_params: unknown; title: string | null; body: string | null }[]>`
    select msg_key, msg_params, title, body from notifications where profile_id = ${profileId} and kind = ${kind} order by created_at`;
  return rows.map((r) => renderNotification({ key: r.msg_key, params: r.msg_params, title: r.title, body: r.body }, locale));
}

export async function auditActions(subjectId: string): Promise<string[]> {
  const rows = await sql<{ action: string }[]>`
    select action from admin_actions where subject_id = ${subjectId} order by created_at`;
  return rows.map((r) => r.action);
}
