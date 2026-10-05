"use client";
import { useEffect, useState } from "react";

/* The coarse role for the PUBLIC chrome (header, footer), read from the readable
   ROLE_HINT_COOKIE (lib/auth.ts) — the same hint <SiteHeader> has used since it
   replaced a getMe() server-action POST on every page load. Reading a cookie is zero
   network, and it happens AFTER hydration, so the server HTML stays the logged-out
   one: /[slug] and /class/[id] stay ISR (e2e/isr.spec.ts, static-render.spec.ts).

   It is a display hint only: set with the session (same expiry) and deleted with it
   on sign-out. A stale or forged value at worst shows a link that bounces to /auth
   (proxy.ts) — every action re-checks the real session.

   student-space-v1 · A: moved out of SiteHeader so the footer reads the same thing. */
export type RoleHint = "student" | "tutor" | "guardian" | null;

export function readRoleHint(): RoleHint {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|;\s*)tnajem_role=([^;]+)/);
  const v = m ? decodeURIComponent(m[1]) : null;
  return v === "student" || v === "tutor" || v === "guardian" ? v : null;
}

/** The role hint, null on the server and on the first client render (no hydration mismatch). */
export function useRoleHint(): RoleHint {
  const [role, setRole] = useState<RoleHint>(null);
  useEffect(() => {
    setRole(readRoleHint());
  }, []);
  return role;
}
