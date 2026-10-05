import type { StudentTutorRef } from "@tnajem/shared";

/* A prof's monogram in the student space (« WT »). Initials only: the student space
   never fetches a photo (an approved photo lives on the prof's public page). The
   colour is picked from the prof's id, so one prof keeps one colour on every page. */
const TONES = ["ssv-av ssv-av-ochre", "ssv-av ssv-av-blue", "ssv-av ssv-av-sand"] as const;

export function ProfAvatar({ tutor, size = 40 }: { tutor: Pick<StudentTutorRef, "id" | "initials">; size?: number }) {
  let h = 0;
  for (const ch of tutor.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const tone = TONES[h % TONES.length];
  return (
    <span className={tone} style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }} aria-hidden="true">
      {tutor.initials || "·"}
    </span>
  );
}
