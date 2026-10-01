"use server";
/* espace prof v2 · auth (phase 2) — the password half of sign-in, as server actions.

   Same contract as app/actions.ts: every rule lives in apps/api (routes/passwords.ts);
   this file forwards the call through lib/api.ts (its five rules apply — the client
   address is forwarded, transport failures rethrow) and does the one thing the API
   cannot: write the session cookie on the browser (adoptSession), for the three
   routes that mint one. The token never reaches the client component — it is
   stripped here, exactly as verifyOtp strips it.

   Demo mode (no API, dev only) answers as an account that does not exist yet, so the
   screens stay walkable for the UI audit without pretending a password was checked. */
import { adoptSession } from "@/lib/auth";
import { call } from "@/lib/api";
import { demoFallback } from "@/lib/backend";

type Fail = { ok: false; error: string; retryAfter?: number; reason?: string };
type SessionBody = { session?: { token: string; expiresAt: string } };

/** What the post-login screens need (lib/auth-destination.ts reads these). */
export type PasswordLoginResult =
  | { ok: true; role?: string; needsConsent?: boolean; needsProfile?: boolean; hasStorefront?: boolean }
  | Fail;

async function adopt<T extends { ok: boolean; role?: string } & SessionBody>(res: T): Promise<Omit<T, "session">> {
  if (res.ok && res.session) await adoptSession(res.session.token, new Date(res.session.expiresAt), res.role);
  const { session: _session, ...rest } = res;
  return rest;
}

/** « Tu as déjà un compte ? » — { exists, hasPassword } for an address, nothing else. */
export async function accountStatus(identifier: string): Promise<{ ok: true; exists: boolean; hasPassword: boolean } | Fail> {
  if (demoFallback) return { ok: true, exists: false, hasPassword: false };
  return call("/auth/account-status", { identifier: String(identifier ?? "").slice(0, 320) });
}

export async function passwordLogin(input: { identifier: string; password: string; locale?: string }): Promise<PasswordLoginResult> {
  if (demoFallback) return { ok: false, error: "invalid-credentials" };
  const res = await call<PasswordLoginResult & SessionBody>("/auth/password/login", {
    identifier: input.identifier,
    password: input.password,
    locale: input.locale,
  });
  return adopt(res) as Promise<PasswordLoginResult>;
}

/** « Mot de passe oublié » — a code, a new password; signs this device in. */
export async function resetPassword(input: { identifier: string; code: string; password: string; locale?: string }): Promise<PasswordLoginResult> {
  if (demoFallback) return { ok: false, error: "invalid-code" };
  const res = await call<PasswordLoginResult & SessionBody>("/auth/password/reset", {
    identifier: input.identifier,
    code: input.code,
    password: input.password,
    locale: input.locale,
  });
  return adopt(res) as Promise<PasswordLoginResult>;
}

/** The FIRST password: with the grant a code sign-in just returned, or a fresh code. */
export async function setPassword(input: { password: string; grant?: string; code?: string }): Promise<{ ok: true; ended?: number } | Fail> {
  if (demoFallback) return { ok: true, ended: 0 };
  return call("/auth/password/set", { password: input.password, grant: input.grant, code: input.code });
}

export async function changePassword(input: { currentPassword: string; newPassword: string }): Promise<{ ok: true; ended?: number } | Fail> {
  if (demoFallback) return { ok: true, ended: 0 };
  return call("/auth/password/change", { currentPassword: input.currentPassword, newPassword: input.newPassword });
}

/** A code to one's OWN address (the API takes it from the session), to create a password. */
export async function requestPasswordCode(input: { locale?: string }): Promise<
  { ok: true; devCode?: string; resendAfter?: number; expiresIn?: number } | Fail
> {
  if (demoFallback) return { ok: true, devCode: "000000" };
  return call("/auth/password/code", { locale: input.locale });
}

export type SecurityState = {
  ok: true;
  password: { set: boolean; setAt: string | null };
  sessions: { current: boolean; createdAt: string; lastSeenAt: string; expiresAt: string }[];
};

/** Réglages › Sécurité: the password's state and the live sessions, as stored. */
export async function getSecurityState(): Promise<SecurityState | Fail> {
  if (demoFallback) return { ok: true, password: { set: false, setAt: null }, sessions: [] };
  return call("/auth/security", undefined, "GET");
}
