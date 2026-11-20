import { otpChannel } from "@tnajem/shared/auth-core";

/* VULN-006 — the one rule for a phone number written from a FORM (the student
   profile, the tutor storefront). Not from a sign-in: only an SMS proof in
   routes/auth.ts ever sets profiles.phone_verified_at.

     • A number typed on a form is CONTACT DATA: stored with phone_verified_at
       null. Changing the number (or clearing it) clears the verification too —
       a proof of the old number says nothing about the new one.
     • Under OTP_CHANNEL=sms the phone is the sign-in identity, so a form can
       neither set nor change it: `phone-locked`. Re-sending the number already on
       file is not a change (the welcome screen prefills it), and omitting it
       leaves it alone.

   `next`: the normalised number the form asks for, null to clear it, undefined
   when the submit says nothing about the phone. */
export type PhoneWrite =
  | { ok: true; set: { phone?: string | null; phoneVerifiedAt?: null } }
  | { ok: false; error: "phone-locked" };

export function phoneWrite(current: string | null, next: string | null | undefined): PhoneWrite {
  if (next === undefined || next === current) return { ok: true, set: {} };
  if (otpChannel() === "sms") return { ok: false, error: "phone-locked" };
  return { ok: true, set: { phone: next, phoneVerifiedAt: null } };
}
